import type { SupabaseClient } from '@supabase/supabase-js'
import { localMidnightAsUtc, nextDate, todayInTimezone, type VercelRequest, type VercelResponse } from '../backend/server'
import { mapWithConcurrency, researchCapture } from '../backend/research'
import { requireUser, requestMethod } from '../backend/server'

export const maxDuration = 60

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

export default async function researchNow(request: VercelRequest, response: VercelResponse) {
  if (!requestMethod(request, response, ['POST'])) return
  let adminClient: SupabaseClient | null = null
  let claimedDigestId: string | null = null
  try {
    const auth = await requireUser(request)
    if (auth.error || !auth.client || !auth.user) {
      return response.status(401).json({ error: auth.error ?? 'Sign in to continue' })
    }
    adminClient = auth.client

    const { data: settings, error: settingsError } = await auth.client.from('settings')
      .select('preset_context,timezone')
      .eq('user_id', auth.user.id)
      .maybeSingle()
    if (settingsError) {
      console.error('Immediate research settings lookup failed:', settingsError.message)
      return response.status(500).json({ error: 'Unable to load your study preferences' })
    }

    const timezone = settings?.timezone ?? 'Africa/Lagos'
    const digestDate = todayInTimezone(timezone).date
    const startAt = localMidnightAsUtc(digestDate, timezone)
    const endAt = localMidnightAsUtc(nextDate(digestDate), timezone)
    const { data: pending, error: pendingError } = await auth.client.from('captures')
      .select('id,user_id,text,created_at,status,result')
      .eq('user_id', auth.user.id)
      .eq('status', 'pending')
      .gte('created_at', startAt)
      .lt('created_at', endAt)
      .order('created_at', { ascending: true })
    if (pendingError) {
      console.error('Immediate research capture lookup failed:', pendingError.message)
      return response.status(500).json({ error: 'Unable to load today’s saved thoughts' })
    }

    const { data: existing, error: digestLookupError } = await auth.client.from('digests')
      .select('id,status,content,emailed_at')
      .eq('user_id', auth.user.id)
      .eq('digest_date', digestDate)
      .maybeSingle()
    if (digestLookupError) {
      console.error('Immediate research digest lookup failed:', digestLookupError.message)
      return response.status(500).json({ error: 'Unable to check today’s digest' })
    }
    if (!pending?.length && !existing) return response.status(200).json({ status: 'no_pending' })
    if (existing?.emailed_at) return response.status(200).json({ status: 'already_sent', digest_id: existing.id })
    if (existing?.status === 'processing') {
      return response.status(409).json({ error: 'Your digest is already being prepared. Please wait a moment.' })
    }

    let digestId: string
    if (existing) {
      if (existing.status === 'ready' && !pending?.length) {
        return response.status(200).json({ status: 'ready', digest_id: existing.id })
      }
      const { data: claimed, error: claimError } = await auth.client.from('digests')
        .update({ status: 'processing' })
        .eq('id', existing.id)
        .in('status', ['ready', 'failed'])
        .is('emailed_at', null)
        .select('id')
        .maybeSingle()
      if (claimError || !claimed) {
        if (claimError) console.error('Immediate research claim failed:', claimError.message)
        return response.status(409).json({ error: 'Your digest is already being prepared. Please try again shortly.' })
      }
      digestId = claimed.id
    } else {
      const { data: created, error: createError } = await auth.client.from('digests')
        .insert({ user_id: auth.user.id, digest_date: digestDate, status: 'processing' })
        .select('id')
        .single()
      if (createError || !created) {
        if (createError?.code === '23505') {
          return response.status(409).json({ error: 'Your digest is already being prepared. Please try again shortly.' })
        }
        console.error('Immediate research digest creation failed:', createError?.message)
        return response.status(500).json({ error: 'Unable to start your digest' })
      }
      digestId = created.id
    }
    claimedDigestId = digestId

    const { data: attached, error: attachedError } = await auth.client.from('captures')
      .select('id,user_id,text,created_at,status,result')
      .eq('user_id', auth.user.id)
      .eq('digest_id', digestId)
    if (attachedError) throw new Error(`Attached capture lookup failed: ${attachedError.message}`)

    const presetContext = settings?.preset_context ?? 'Explain simply and clearly, using a warm and encouraging tone.'
    const researched = await mapWithConcurrency((pending ?? []) as CaptureRow[], 3, async (capture) => {
      try {
        return { ...capture, status: 'researched', result: { ...await researchCapture(capture.text, presetContext) } }
      } catch (error) {
        console.error(`Research failed for capture ${capture.id}:`, error)
        return { ...capture, status: 'failed', result: { error: 'Research could not be completed.' } }
      }
    })

    if (researched.length) {
      const { error: saveCaptureError } = await auth.client.from('captures').upsert(
        researched.map((capture) => ({ ...capture, digest_id: digestId })),
        { onConflict: 'id' },
      )
      if (saveCaptureError) throw new Error(`Capture results save failed: ${saveCaptureError.message}`)
    }

    const byId = new Map<string, DigestContentItem>()
    for (const item of contentItems(existing?.content)) byId.set(item.id, item)
    for (const item of attached ?? []) {
      byId.set(item.id, { id: item.id, text: item.text, status: item.status, result: item.result })
    }
    for (const item of researched) {
      byId.set(item.id, { id: item.id, text: item.text, status: item.status, result: item.result })
    }

    const { error: saveDigestError } = await auth.client.from('digests')
      .update({ content: [...byId.values()], status: 'ready' })
      .eq('id', digestId)
    if (saveDigestError) throw new Error(`Digest save failed: ${saveDigestError.message}`)
    return response.status(200).json({ status: 'ready', digest_id: digestId, count: byId.size })
  } catch (error) {
    console.error('Immediate research request failed:', error)
    if (adminClient && claimedDigestId) {
      const { error: updateError } = await adminClient.from('digests')
        .update({ status: 'failed' })
        .eq('id', claimedDigestId)
      if (updateError) console.error('Unable to release failed immediate digest claim:', updateError.message)
    }
    return response.status(500).json({ error: 'Unable to prepare your digest right now. Please try again.' })
  }
}
