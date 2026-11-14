import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { researchCapture } from '../_shared/research.ts'
import { localDateAndMinute, localMidnightAsUtc } from '../_shared/time.ts'

interface CaptureRow {
  id: string
  user_id: string
  text: string
  created_at: string
  status: string
  result: Record<string, unknown> | null
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const authorization = request.headers.get('Authorization')
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!accessToken) return jsonResponse({ error: 'Sign in to research your saved thoughts' }, 401)
  if (!supabaseUrl || !serviceKey) return jsonResponse({ error: 'Supabase service configuration is missing' }, 500)

  const supabase = createClient(supabaseUrl, serviceKey)
  async function markDigestFailed(digestId: string) {
    const { error } = await supabase.from('digests').update({ status: 'failed' }).eq('id', digestId)
    if (error) console.error('Unable to mark immediate digest as failed:', error.message)
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken)
  if (authError || !authData.user) return jsonResponse({ error: 'Your session is invalid or expired' }, 401)
  const userId = authData.user.id

  const { data: settings, error: settingsError } = await supabase
    .from('settings')
    .select('preset_context,timezone')
    .eq('user_id', userId)
    .maybeSingle()
  if (settingsError) return jsonResponse({ error: 'Unable to load your study preferences' }, 500)

  const timezone = settings?.timezone ?? 'Africa/Lagos'
  let digestDate: string
  let startAt: string
  let endAt: string
  try {
    digestDate = localDateAndMinute(timezone, new Date()).date
    const tomorrow = new Date(`${digestDate}T12:00:00Z`)
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    const tomorrowDate = tomorrow.toISOString().slice(0, 10)
    startAt = localMidnightAsUtc(digestDate, timezone)
    endAt = localMidnightAsUtc(tomorrowDate, timezone)
  } catch (error) {
    console.error('Invalid timezone in settings:', error)
    return jsonResponse({ error: 'Your saved time zone is invalid. Update it in Settings.' }, 400)
  }

  const { data: pending, error: pendingError } = await supabase.from('captures')
    .select('id,user_id,text,created_at,status,result')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .gte('created_at', startAt)
    .lt('created_at', endAt)
    .order('created_at', { ascending: true })
  if (pendingError) return jsonResponse({ error: 'Unable to load your saved thoughts' }, 500)

  const { data: existing, error: lookupError } = await supabase.from('digests')
    .select('id,status,content,emailed_at')
    .eq('user_id', userId)
    .eq('digest_date', digestDate)
    .maybeSingle()
  if (lookupError) return jsonResponse({ error: 'Unable to check today’s digest' }, 500)
  if (!pending?.length && !existing) return jsonResponse({ status: 'no_pending' })
  if (existing?.emailed_at) return jsonResponse({ status: 'already_sent', digest_id: existing.id })
  if (existing?.status === 'processing') return jsonResponse({ error: 'Your digest is already being prepared. Please wait a moment.' }, 409)

  let digestId: string
  if (existing) {
    if (pending?.length) {
      const { data: claimed, error: claimError } = await supabase.from('digests')
        .update({ status: 'processing' })
        .eq('id', existing.id)
        .in('status', ['ready', 'failed'])
        .is('emailed_at', null)
        .select('id')
        .maybeSingle()
      if (claimError || !claimed) {
        if (claimError) console.error('Immediate digest claim failed:', claimError.message)
        return jsonResponse({ error: 'Your digest is already being prepared. Please try again shortly.' }, 409)
      }
      digestId = claimed.id
    } else {
      digestId = existing.id
      if (existing.status === 'ready') return jsonResponse({ status: 'ready', digest_id: digestId })
      const { data: claimed, error: claimError } = await supabase.from('digests')
        .update({ status: 'processing' })
        .eq('id', existing.id)
        .eq('status', 'failed')
        .is('emailed_at', null)
        .select('id')
        .maybeSingle()
      if (claimError || !claimed) {
        if (claimError) console.error('Immediate digest retry claim failed:', claimError.message)
        return jsonResponse({ error: 'Your digest is already being prepared. Please try again shortly.' }, 409)
      }
      digestId = claimed.id
    }
  } else {
    const { data: created, error: createError } = await supabase.from('digests')
      .insert({ user_id: userId, digest_date: digestDate, status: 'processing' })
      .select('id')
      .single()
    if (createError || !created) {
      if (createError?.code === '23505') return jsonResponse({ error: 'Your digest is already being prepared. Please try again shortly.' }, 409)
      console.error('Immediate digest creation failed:', createError?.message)
      return jsonResponse({ error: 'Unable to start your digest' }, 500)
    }
    digestId = created.id
  }

  const { data: attached, error: attachedError } = await supabase.from('captures')
    .select('id,user_id,text,created_at,status,result')
    .eq('user_id', userId)
    .eq('digest_id', digestId)
  if (attachedError) {
    await markDigestFailed(digestId)
    console.error('Attached capture lookup failed:', attachedError.message)
    return jsonResponse({ error: 'Unable to load the digest’s saved thoughts' }, 500)
  }

  const presetContext = settings?.preset_context ?? 'Explain simply and clearly, using a warm and encouraging tone.'
  const researched = await Promise.all((pending ?? []).map(async (capture) => {
    try {
      const result = await researchCapture(capture.text, presetContext)
      return { ...capture, status: 'researched', result }
    } catch (error) {
      console.error(`Research failed for capture ${capture.id}:`, error)
      return { ...capture, status: 'failed', result: { error: 'Research could not be completed.' } }
    }
  }))

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
      await markDigestFailed(digestId)
      console.error('Immediate capture results save failed:', saveCaptureError.message)
      return jsonResponse({ error: 'Unable to save the research results' }, 500)
    }
  }

  const contentById = new Map<string, { id: string; text: string; status: string; result: Record<string, unknown> | null }>()
  for (const item of Array.isArray(existing?.content) ? existing.content : []) {
    if (item && typeof item.id === 'string') contentById.set(item.id, item)
  }
  for (const capture of attached ?? []) {
    contentById.set(capture.id, { id: capture.id, text: capture.text, status: capture.status, result: capture.result })
  }
  for (const capture of researched) {
    contentById.set(capture.id, { id: capture.id, text: capture.text, status: capture.status, result: capture.result })
  }

  const { error: saveDigestError } = await supabase.from('digests')
    .update({ content: [...contentById.values()], status: 'ready' })
    .eq('id', digestId)
  if (saveDigestError) {
    await markDigestFailed(digestId)
    console.error('Immediate digest save failed:', saveDigestError.message)
    return jsonResponse({ error: 'Unable to save your digest' }, 500)
  }

  return jsonResponse({ status: 'ready', digest_id: digestId, count: contentById.size })
})
