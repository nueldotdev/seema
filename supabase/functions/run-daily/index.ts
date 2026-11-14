import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { digestHtml, sendEmail } from '../_shared/email.ts'
import { researchCapture } from '../_shared/research.ts'
import { signDigestId } from '../_shared/signing.ts'
import { localDateAndMinute, localMidnightAsUtc } from '../_shared/time.ts'

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
  status?: string
  result?: Record<string, unknown> | null
}

function isAuthorized(request: Request) {
  const secret = Deno.env.get('CRON_SECRET')
  return Boolean(secret && request.headers.get('Authorization') === `Bearer ${secret}`)
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

    const existing = await supabase.from('digests')
      .select('id,emailed_at,status,content')
      .eq('user_id', setting.user_id)
      .eq('digest_date', previousDate)
      .maybeSingle()
    if (existing.error) {
      outcomes.push({ user_id: setting.user_id, status: 'lookup_failed' })
      console.error('Digest lookup failed:', existing.error.message)
      continue
    }
    if (existing.data?.emailed_at) {
      outcomes.push({ user_id: setting.user_id, digest_id: existing.data.id, status: 'already_sent' })
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
    if (!captures?.length && !existing.data) {
      outcomes.push({ user_id: setting.user_id, status: 'no_captures' })
      continue
    }

    let digestId: string
    if (existing.data) {
      if (existing.data.status === 'processing') {
        outcomes.push({ user_id: setting.user_id, digest_id: existing.data.id, status: 'already_claimed' })
        continue
      }
      const { data: claimed, error: claimError } = await supabase.from('digests')
        .update({ status: 'processing' })
        .eq('id', existing.data.id)
        .in('status', ['ready', 'failed'])
        .is('emailed_at', null)
        .select('id')
        .maybeSingle()
      if (claimError || !claimed) {
        if (claimError) console.error('Existing digest claim failed:', claimError.message)
        outcomes.push({ user_id: setting.user_id, digest_id: existing.data.id, status: 'already_claimed' })
        continue
      }
      digestId = claimed.id
    } else {
      const { data: created, error: insertError } = await supabase.from('digests')
        .insert({ user_id: setting.user_id, digest_date: previousDate, status: 'processing' })
        .select('id')
        .single()
      if (insertError || !created) {
        if (insertError?.code === '23505') outcomes.push({ user_id: setting.user_id, status: 'already_claimed' })
        else {
          if (insertError) console.error('Digest create failed:', insertError.message)
          outcomes.push({ user_id: setting.user_id, status: 'digest_create_failed' })
        }
        continue
      }
      digestId = created.id
    }

    const { data: attached, error: attachedError } = await supabase.from('captures')
      .select('id,text,created_at,user_id,status,result')
      .eq('user_id', setting.user_id)
      .eq('digest_id', digestId)
    if (attachedError) {
      await supabase.from('digests').update({ status: 'failed' }).eq('id', digestId)
      outcomes.push({ user_id: setting.user_id, digest_id: digestId, status: 'attached_capture_lookup_failed' })
      console.error('Attached capture lookup failed:', attachedError.message)
      continue
    }

    const pending = (captures ?? []) as CaptureRow[]
    const researched = await Promise.all(pending.map(async (capture) => {
      try {
        const result = await researchCapture(capture.text, setting.preset_context)
        return { ...capture, status: 'researched', result }
      } catch (error) {
        console.error(`Research failed for capture ${capture.id}:`, error)
        return { ...capture, status: 'failed', result: { error: 'Research could not be completed.' } }
      }
    }))

    const allCaptures = new Map<string, { id: string; text: string; status: string; result: Record<string, unknown> | null }>()
    for (const item of Array.isArray(existing.data?.content) ? existing.data.content : []) {
      if (item && typeof item.id === 'string') allCaptures.set(item.id, item)
    }
    for (const capture of attached ?? []) {
      allCaptures.set(capture.id, { id: capture.id, text: capture.text, status: capture.status, result: capture.result })
    }

    if (researched.length) {
      const { error: saveCaptureError } = await supabase.from('captures').upsert(
        researched.map((capture) => ({
          id: capture.id,
          user_id: capture.user_id,
          text: capture.text,
          created_at: capture.created_at,
          status: capture.status,
          result: capture.result,
          digest_id: digestId,
        })),
        { onConflict: 'id' },
      )
      if (saveCaptureError) {
        await supabase.from('digests').update({ status: 'failed' }).eq('id', digestId)
        outcomes.push({ user_id: setting.user_id, digest_id: digestId, status: 'save_failed' })
        console.error('Capture result save failed:', saveCaptureError.message)
        continue
      }
      for (const capture of researched) {
        allCaptures.set(capture.id, { id: capture.id, text: capture.text, status: capture.status, result: capture.result })
      }
    }

    const content = [...allCaptures.values()]
    const { error: updateDigestError } = await supabase.from('digests').update({ content, status: 'ready' }).eq('id', digestId)
    if (updateDigestError) {
      await supabase.from('digests').update({ status: 'failed' }).eq('id', digestId)
      outcomes.push({ user_id: setting.user_id, digest_id: digestId, status: 'digest_save_failed' })
      console.error('Digest content save failed:', updateDigestError.message)
      continue
    }

    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(setting.user_id)
    if (userError) {
      outcomes.push({ user_id: setting.user_id, digest_id: digestId, status: 'email_lookup_failed' })
      console.error('Auth user lookup failed:', userError.message)
      continue
    }
    const email = userData.user.email
    if (!email) {
      outcomes.push({ user_id: setting.user_id, digest_id: digestId, status: 'missing_email' })
      continue
    }
    const tokenSecret = Deno.env.get('MARK_READ_SECRET')
    if (!tokenSecret) return jsonResponse({ error: 'MARK_READ_SECRET must be configured' }, 500)
    const token = await signDigestId(digestId, tokenSecret)
    const readUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/mark-read?id=${encodeURIComponent(digestId)}&token=${token}`
    try {
      await sendEmail({
        to: email,
        subject: `Your Seema digest for ${previousDate}`,
        html: digestHtml(content, readUrl),
      })
      const { error: emailUpdateError } = await supabase.from('digests').update({ emailed_at: new Date().toISOString() }).eq('id', digestId)
      if (emailUpdateError) throw emailUpdateError
      outcomes.push({ user_id: setting.user_id, digest_id: digestId, status: 'sent' })
    } catch (error) {
      outcomes.push({ user_id: setting.user_id, digest_id: digestId, status: 'email_failed' })
      console.error('Digest email failed:', error)
    }
  }
  return jsonResponse({ processed: outcomes.length, outcomes })
})
