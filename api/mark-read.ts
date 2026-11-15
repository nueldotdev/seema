import { createHmac, timingSafeEqual } from 'node:crypto'
import { getAdminClient, requestMethod, type VercelRequest, type VercelResponse } from '../backend/server.js'

export default async function markRead(request: VercelRequest, response: VercelResponse) {
  if (!requestMethod(request, response, ['GET'])) return
  const { id, token } = request.query
  const digestId = Array.isArray(id) ? id[0] : id
  const signature = Array.isArray(token) ? token[0] : token
  const secret = process.env.MARK_READ_SECRET
  if (!digestId || !signature || !secret || !/^[\da-f]{64}$/i.test(signature)) {
    return response.status(400).json({ error: 'Invalid mark-read link' })
  }

  const expected = createHmac('sha256', secret).update(digestId).digest()
  const received = Buffer.from(signature, 'hex')
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return response.status(403).json({ error: 'Invalid mark-read link' })
  }

  try {
    const supabase = getAdminClient()
    const { error } = await supabase.from('digests')
      .update({ opened_at: new Date().toISOString() })
      .eq('id', digestId)
      .is('opened_at', null)
    if (error) {
      console.error('Mark-read update failed:', error.message)
      return response.status(500).json({ error: 'Unable to mark the digest as read' })
    }
    const appUrl = process.env.APP_URL
    if (!appUrl) return response.status(500).json({ error: 'APP_URL must be configured on the server' })
    return response.redirect(302, `${appUrl.replace(/\/$/, '')}/digests/${encodeURIComponent(digestId)}`)
  } catch (error) {
    console.error('Mark-read request failed:', error)
    return response.status(500).json({ error: 'Unable to mark the digest as read' })
  }
}
