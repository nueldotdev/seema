import { createHmac, timingSafeEqual } from 'node:crypto'
import { digestHtml, sendEmail } from '../../backend/email.js'
import { mapWithConcurrency, researchCapture } from '../../backend/research.js'
import {
  getAdminClient,
  requestMethod,
  todayInTimezone,
  type VercelRequest,
  type VercelResponse,
} from '../../backend/server.js'

export const maxDuration = 60

interface DailySetting {
  user_id: string
  preset_context: string
  delivery_time: string
  timezone: string
  email_enabled: boolean
}

interface CaptureRow {
  id: string
  user_id: string
  text: string
  created_at: string
  status: string
  result: Record<string, unknown> | null
}

interface DigestContentItem {
  id: string
  text: string
  status: string
  result: Record<string, unknown> | null
}

function contentItems(value: unknown): DigestContentItem[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is DigestContentItem =>
    Boolean(
      item &&
      typeof item.id === 'string' &&
      typeof item.text === 'string' &&
      (item.result === null || (typeof item.result === 'object' && !Array.isArray(item.result))),
    ),
  )
}

function isAuthorized(request: VercelRequest) {
  const secret = process.env.CRON_SECRET
  const header = request.headers.authorization
  const authorization = Array.isArray(header) ? header[0] : header
  if (!secret || !authorization?.startsWith('Bearer ')) return false
  const provided = Buffer.from(authorization.slice(7))
  const expected = Buffer.from(secret)
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

async function sendDailyDigest(setting: DailySetting, supabase: ReturnType<typeof getAdminClient>, now: Date) {
  const local = todayInTimezone(setting.timezone, now)
  const [deliveryHour, deliveryMinute] = setting.delivery_time.split(':').map(Number)
  if (local.minute < deliveryHour * 60 + deliveryMinute) return 'not_due'

  const digestDate = local.date
  const cutoff = now.toISOString()
  const { data: existing, error: existingError } = await supabase.from('digests')
    .select('id,status,content,emailed_at,email_skipped_at')
    .eq('user_id', setting.user_id)
    .eq('digest_date', digestDate)
    .maybeSingle()
  if (existingError) throw new Error(`Digest lookup failed: ${existingError.message}`)
  if (existing?.emailed_at) return 'already_sent'
  if (existing?.email_skipped_at) return 'already_processed_no_email'
  if (existing?.status === 'processing') return 'already_claimed'

  const { data: pending, error: capturesError } = await supabase.from('captures')
    .select('id,user_id,text,created_at,status,result')
    .eq('user_id', setting.user_id)
    .eq('status', 'pending')
    .is('digest_id', null)
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
  if (capturesError) throw new Error(`Capture lookup failed: ${capturesError.message}`)
  if (!pending?.length && !existing) return 'no_captures'

  let digestId: string
  if (existing) {
    const { data: claimed, error: claimError } = await supabase.from('digests')
      .update({ status: 'processing' })
      .eq('id', existing.id)
      .in('status', ['ready', 'failed'])
      .is('emailed_at', null)
      .select('id')
      .maybeSingle()
    if (claimError || !claimed) {
      if (claimError) throw new Error(`Digest claim failed: ${claimError.message}`)
      return 'already_claimed'
    }
    digestId = claimed.id
  } else {
    const { data: created, error: createError } = await supabase.from('digests')
      .insert({ user_id: setting.user_id, digest_date: digestDate, status: 'processing' })
      .select('id')
      .single()
    if (createError || !created) {
      if (createError?.code === '23505') return 'already_claimed'
      throw new Error(`Digest create failed: ${createError?.message ?? 'No row returned'}`)
    }
    digestId = created.id
  }

  try {
    const { data: attached, error: attachedError } = await supabase.from('captures')
      .select('id,user_id,text,created_at,status,result')
      .eq('user_id', setting.user_id)
      .eq('digest_id', digestId)
    if (attachedError) throw new Error(`Attached capture lookup failed: ${attachedError.message}`)

    const researched = await mapWithConcurrency((pending ?? []) as CaptureRow[], 3, async (capture) => {
      try {
        return { ...capture, status: 'researched', result: await researchCapture(capture.text, setting.preset_context) }
      } catch (error) {
        console.error(`Research failed for capture ${capture.id}:`, error)
        return { ...capture, status: 'failed', result: { error: 'Research could not be completed.' } }
      }
    })

    if (researched.length) {
      const { error } = await supabase.from('captures').upsert(
        researched.map((capture) => ({ ...capture, digest_id: digestId })),
        { onConflict: 'id' },
      )
      if (error) throw new Error(`Capture result save failed: ${error.message}`)
    }

    const byId = new Map<string, DigestContentItem>()
    for (const item of contentItems(existing?.content)) byId.set(item.id, item)
    for (const item of attached ?? []) {
      byId.set(item.id, { id: item.id, text: item.text, status: item.status, result: item.result })
    }
    for (const item of researched) {
      byId.set(item.id, { id: item.id, text: item.text, status: item.status, result: item.result })
    }
    const content = [...byId.values()]
    const { error: contentError } = await supabase.from('digests')
      .update({ content, status: 'ready' })
      .eq('id', digestId)
    if (contentError) throw new Error(`Digest content save failed: ${contentError.message}`)

    if (!setting.email_enabled) {
      const { error: skippedError } = await supabase.from('digests')
        .update({ email_skipped_at: new Date().toISOString(), status: 'ready' })
        .eq('id', digestId)
      if (skippedError) throw new Error(`Digest email opt-out save failed: ${skippedError.message}`)
      return 'researched_no_email'
    }

    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(setting.user_id)
    if (userError) throw new Error(`User email lookup failed: ${userError.message}`)
    const email = userData.user.email
    if (!email) throw new Error('No email address is associated with the user')

    const markReadSecret = process.env.MARK_READ_SECRET
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
    if (!markReadSecret || !supabaseUrl) throw new Error('MARK_READ_SECRET and SUPABASE_URL are required')
    const signature = createHmac('sha256', markReadSecret).update(digestId).digest('hex')
    const appUrl = process.env.APP_URL
    if (!appUrl) throw new Error('APP_URL must be configured on the server')
    const readUrl = `${appUrl.replace(/\/$/, '')}/api/mark-read?id=${encodeURIComponent(digestId)}&token=${signature}`
    await sendEmail({
      to: email,
      subject: `Your Seema digest for ${digestDate}`,
      html: digestHtml(content, readUrl),
    })
    const { error: emailedError } = await supabase.from('digests')
      .update({ emailed_at: new Date().toISOString(), status: 'ready' })
      .eq('id', digestId)
    if (emailedError) throw new Error(`Digest sent but email status update failed: ${emailedError.message}`)
    return 'sent'
  } catch (error) {
    const { error: updateError } = await supabase.from('digests').update({ status: 'failed' }).eq('id', digestId)
    if (updateError) console.error('Unable to release failed digest claim:', updateError.message)
    throw error
  }
}

async function sendReminders(supabase: ReturnType<typeof getAdminClient>, now: Date, emailDisabledUsers: Set<string>) {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const { data: digests, error } = await supabase.from('digests')
    .select('id,user_id,digest_date,content,emailed_at')
    .eq('status', 'ready')
    .not('emailed_at', 'is', null)
    .is('opened_at', null)
    .is('reminder_sent_at', null)
    .lt('emailed_at', cutoff)
  if (error) throw new Error(`Reminder digest lookup failed: ${error.message}`)
  const markReadSecret = process.env.MARK_READ_SECRET
  const appUrl = process.env.APP_URL
  if (digests?.length && (!markReadSecret || !appUrl)) {
    throw new Error('MARK_READ_SECRET and APP_URL are required to send reminders')
  }

  const outcomes: Array<{ digest_id: string; status: string }> = []
  for (const digest of digests ?? []) {
    if (emailDisabledUsers.has(digest.user_id)) {
      outcomes.push({ digest_id: digest.id, status: 'email_disabled' })
      continue
    }
    const claimTime = new Date().toISOString()
    const { data: claimed, error: claimError } = await supabase.from('digests')
      .update({ reminder_sent_at: claimTime })
      .eq('id', digest.id)
      .is('opened_at', null)
      .is('reminder_sent_at', null)
      .select('id')
      .maybeSingle()
    if (claimError || !claimed) {
      if (claimError) console.error('Reminder claim failed:', claimError.message)
      outcomes.push({ digest_id: digest.id, status: 'not_claimed' })
      continue
    }

    try {
      const { data: userData, error: userError } = await supabase.auth.admin.getUserById(digest.user_id)
      if (userError) throw new Error(`Reminder email lookup failed: ${userError.message}`)
      if (!userData.user.email) throw new Error('No email address is associated with the user')
      const signature = createHmac('sha256', markReadSecret!).update(digest.id).digest('hex')
      const readUrl = `${appUrl!.replace(/\/$/, '')}/api/mark-read?id=${encodeURIComponent(digest.id)}&token=${signature}`
      await sendEmail({
        to: userData.user.email,
        subject: 'A gentle reminder: your Seema digest is here',
        html: `<p style="font-family:Arial,sans-serif;color:#526057">A little reminder in case it slipped by — your digest is ready.</p>${digestHtml(contentItems(digest.content), readUrl)}`,
      })
      outcomes.push({ digest_id: digest.id, status: 'sent' })
    } catch (sendError) {
      const { error: resetError } = await supabase.from('digests').update({ reminder_sent_at: null })
        .eq('id', digest.id)
        .eq('reminder_sent_at', claimTime)
      if (resetError) console.error('Reminder claim rollback failed:', resetError.message)
      console.error(`Reminder email failed for digest ${digest.id}:`, sendError)
      outcomes.push({ digest_id: digest.id, status: 'email_failed' })
    }
  }
  return outcomes
}

export default async function runDaily(request: VercelRequest, response: VercelResponse) {
  if (!requestMethod(request, response, ['GET', 'POST'])) return
  if (!isAuthorized(request)) return response.status(401).json({ error: 'Unauthorized' })

  try {
    const supabase = getAdminClient()
    const { data: settings, error } = await supabase
      .from('settings')
      .select('user_id,preset_context,delivery_time,timezone,email_enabled')
    if (error) throw new Error(`Settings lookup failed: ${error.message}`)

    const outcomes: Array<{ user_id: string; status: string }> = []
    for (const setting of (settings ?? []) as DailySetting[]) {
      try {
        const status = await sendDailyDigest(setting, supabase, new Date())
        outcomes.push({ user_id: setting.user_id, status })
      } catch (userError) {
        console.error(`Daily digest failed for ${setting.user_id}:`, userError)
        outcomes.push({ user_id: setting.user_id, status: 'failed' })
      }
    }
    const emailDisabledUsers = new Set(((settings ?? []) as DailySetting[])
      .filter((setting) => !setting.email_enabled)
      .map((setting) => setting.user_id))
    const reminders = await sendReminders(supabase, new Date(), emailDisabledUsers)
    return response.status(200).json({ processed: outcomes.length, outcomes, reminders })
  } catch (error) {
    console.error('Daily digest scheduler failed:', error)
    return response.status(500).json({ error: 'Unable to process scheduled digests' })
  }
}

export { sendDailyDigest, sendReminders }
