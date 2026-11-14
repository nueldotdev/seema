import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { digestHtml, sendEmail } from '../_shared/email.ts'
import { researchCapture } from '../_shared/research.ts'
import { signDigestId } from '../_shared/signing.ts'

interface UserSetting {
  user_id: string
  preset_context: string
  delivery_time: string
  timezone: string
}

interface CaptureRow {
  id: string
  text: string
  created_at: string
  user_id: string
}

function isAuthorized(request: Request) {
  const secret = Deno.env.get('CRON_SECRET')
  return Boolean(secret && request.headers.get('Authorization') === `Bearer ${secret}`)
}

function localDateAndMinute(timezone: string, now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const date = `${values.year}-${values.month}-${values.day}`
  const currentMinute = Number(values.hour) * 60 + Number(values.minute)
  return { date, currentMinute }
}

function localMidnightAsUtc(date: string, timezone: string) {
  const [year, month, day] = date.split('-').map(Number)
  const desiredUtc = Date.UTC(year, month - 1, day)
  let candidate = desiredUtc
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })

  for (let attempt = 0; attempt < 3; attempt++) {
    const values = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]))
    const formattedAsUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    )
    const adjustment = desiredUtc - formattedAsUtc
    candidate += adjustment
    if (adjustment === 0) break
  }
  return new Date(candidate).toISOString()
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  if (!isAuthorized(request)) return jsonResponse({ error: 'Unauthorized' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return jsonResponse({ error: 'Supabase service configuration is missing' }, 500)
  const supabase = createClient(supabaseUrl, serviceKey)

  const { data: settings, error: settingsError } = await supabase
    .from('settings')
    .select('user_id,preset_context,delivery_time,timezone')
  if (settingsError) return jsonResponse({ error: settingsError.message }, 500)

  const now = new Date()
  const outcomes: Array<{ user_id: string; status: string; digest_id?: string }> = []
  for (const setting of (settings ?? []) as UserSetting[]) {
    let local: { date: string; currentMinute: number }
    try {
      local = localDateAndMinute(setting.timezone, now)
    } catch (error) {
      console.error(`Invalid timezone for ${setting.user_id}:`, error)
      outcomes.push({ user_id: setting.user_id, status: 'invalid_timezone' })
      continue
    }
    const [hour, minute] = setting.delivery_time.split(':').map(Number)
    if (local.currentMinute < hour * 60 + minute) continue
    const yesterday = new Date(`${local.date}T12:00:00Z`)
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const previousDate = yesterday.toISOString().slice(0, 10)
    const startAt = localMidnightAsUtc(previousDate, setting.timezone)
    const endAt = localMidnightAsUtc(local.date, setting.timezone)

    const existing = await supabase.from('digests').select('id,emailed_at,status').eq('user_id', setting.user_id).eq('digest_date', previousDate).maybeSingle()
    if (existing.error) {
      outcomes.push({ user_id: setting.user_id, status: 'lookup_failed' })
      console.error('Digest lookup failed:', existing.error.message)
      continue
    }
    if (existing.data) {
      outcomes.push({ user_id: setting.user_id, digest_id: existing.data.id, status: existing.data.emailed_at ? 'already_sent' : 'already_claimed' })
      continue
    }

    const { data: captures, error: capturesError } = await supabase
      .from('captures')
      .select('id,text,created_at,user_id')
      .eq('user_id', setting.user_id)
      .eq('status', 'pending')
      .gte('created_at', startAt)
      .lt('created_at', endAt)
      .order('created_at', { ascending: true })
    if (capturesError) {
      outcomes.push({ user_id: setting.user_id, status: 'capture_lookup_failed' })
      console.error('Capture lookup failed:', capturesError.message)
      continue
    }
    if (!captures?.length) {
      outcomes.push({ user_id: setting.user_id, status: 'no_captures' })
      continue
    }

    const { data: digest, error: insertError } = await supabase.from('digests')
      .insert({ user_id: setting.user_id, digest_date: previousDate, status: 'processing' })
      .select('id')
      .single()
    if (insertError) {
      if (insertError.code === '23505') outcomes.push({ user_id: setting.user_id, status: 'already_claimed' })
      else {
        outcomes.push({ user_id: setting.user_id, status: 'digest_create_failed' })
        console.error('Digest create failed:', insertError.message)
      }
      continue
    }

    const researched = await Promise.all((captures as CaptureRow[]).map(async (capture) => {
      try {
        const result = await researchCapture(capture.text, setting.preset_context)
        return { ...capture, status: 'researched', result }
      } catch (error) {
        console.error(`Research failed for capture ${capture.id}:`, error)
        return { ...capture, status: 'failed', result: { error: 'Research could not be completed.' } }
      }
    }))

    const { error: saveCaptureError } = await supabase.from('captures').upsert(
      researched.map((capture) => ({
        id: capture.id,
        user_id: capture.user_id,
        text: capture.text,
        created_at: capture.created_at,
        status: capture.status,
        result: capture.result,
        digest_id: digest.id,
      })),
      { onConflict: 'id' },
    )
    if (saveCaptureError) {
      await supabase.from('digests').update({ status: 'failed' }).eq('id', digest.id)
      outcomes.push({ user_id: setting.user_id, digest_id: digest.id, status: 'save_failed' })
      console.error('Capture result save failed:', saveCaptureError.message)
      continue
    }

    const content = researched.map(({ id, text, status, result }) => ({ id, text, status, result }))
    const { error: updateDigestError } = await supabase.from('digests').update({ content, status: 'ready' }).eq('id', digest.id)
    if (updateDigestError) {
      outcomes.push({ user_id: setting.user_id, digest_id: digest.id, status: 'digest_save_failed' })
      console.error('Digest content save failed:', updateDigestError.message)
      continue
    }

    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(setting.user_id)
    if (userError) {
      outcomes.push({ user_id: setting.user_id, digest_id: digest.id, status: 'email_lookup_failed' })
      console.error('Auth user lookup failed:', userError.message)
      continue
    }
    const email = userData.user.email
    if (!email) {
      outcomes.push({ user_id: setting.user_id, digest_id: digest.id, status: 'missing_email' })
      continue
    }
    const tokenSecret = Deno.env.get('MARK_READ_SECRET')
    if (!tokenSecret) return jsonResponse({ error: 'MARK_READ_SECRET must be configured' }, 500)
    const token = await signDigestId(digest.id, tokenSecret)
    const readUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/mark-read?id=${encodeURIComponent(digest.id)}&token=${token}`
    try {
      await sendEmail({
        to: email,
        subject: `Your Seema digest for ${previousDate}`,
        html: digestHtml(content, readUrl),
      })
      const { error: emailUpdateError } = await supabase.from('digests').update({ emailed_at: new Date().toISOString() }).eq('id', digest.id)
      if (emailUpdateError) throw emailUpdateError
      outcomes.push({ user_id: setting.user_id, digest_id: digest.id, status: 'sent' })
    } catch (error) {
      outcomes.push({ user_id: setting.user_id, digest_id: digest.id, status: 'email_failed' })
      console.error('Digest email failed:', error)
    }
  }
  return jsonResponse({ processed: outcomes.length, outcomes })
})
