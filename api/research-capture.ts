import { requireUser, requestMethod, type VercelRequest, type VercelResponse } from '../backend/server.js'
import { researchCapture } from '../backend/research.js'

interface CaptureRow {
  id: string
  user_id: string
  text: string
  status: 'pending' | 'failed'
}

export default async function researchOneCapture(request: VercelRequest, response: VercelResponse) {
  if (!requestMethod(request, response, ['POST'])) return

  const body = request.body
  const captureId = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>).capture_id
    : undefined
  if (typeof captureId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(captureId)) {
    return response.status(400).json({ error: 'A valid capture_id is required' })
  }

  try {
    const auth = await requireUser(request)
    if (auth.error || !auth.client || !auth.user) {
      return response.status(401).json({ error: auth.error ?? 'Sign in to continue' })
    }

    const { data: capture, error: captureError } = await auth.client.from('captures')
      .select('id,user_id,text,status')
      .eq('id', captureId)
      .eq('user_id', auth.user.id)
      .is('digest_id', null)
      .in('status', ['pending', 'failed'])
      .maybeSingle()
    if (captureError) {
      console.error('Queue capture lookup failed:', captureError.message)
      return response.status(500).json({ error: 'Unable to load this saved thought' })
    }
    if (!capture) return response.status(409).json({ error: 'This thought is no longer waiting in your queue' })

    const { data: settings, error: settingsError } = await auth.client.from('settings')
      .select('preset_context')
      .eq('user_id', auth.user.id)
      .maybeSingle()
    if (settingsError) {
      console.error('Queue research settings lookup failed:', settingsError.message)
      return response.status(500).json({ error: 'Unable to load your preferences' })
    }

    let result: Record<string, unknown>
    let status: 'researched' | 'failed'
    try {
      result = { ...await researchCapture(capture.text, settings?.preset_context ?? 'Explain simply and clearly, using a warm and encouraging tone.') }
      status = 'researched'
    } catch (researchError) {
      console.error(`Queue research failed for capture ${capture.id}:`, researchError)
      result = { error: 'Research could not be completed. You can try again.' }
      status = 'failed'
    }

    const { data: updated, error: updateError } = await auth.client.from('captures')
      .update({ status, result })
      .eq('id', capture.id)
      .eq('user_id', auth.user.id)
      .is('digest_id', null)
      .in('status', ['pending', 'failed'])
      .select('id,text,status,result,created_at')
      .maybeSingle()
    if (updateError) {
      console.error('Queue capture result save failed:', updateError.message)
      return response.status(500).json({ error: 'Unable to save the research result' })
    }
    if (!updated) return response.status(409).json({ error: 'This thought was updated elsewhere. Refresh your queue.' })
    if (status === 'failed') {
      return response.status(502).json({ error: 'Research could not be completed. You can try again.', status, result })
    }
    return response.status(200).json({ status, capture: updated })
  } catch (error) {
    console.error('Queue capture research request failed:', error)
    return response.status(500).json({ error: 'Unable to research this thought right now' })
  }
}
