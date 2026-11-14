import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { verifyDigestId } from '../_shared/signing.ts'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405)
  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  const token = url.searchParams.get('token')
  const secret = Deno.env.get('MARK_READ_SECRET')
  if (!id || !token || !secret) return jsonResponse({ error: 'Invalid mark-read link' }, 400)

  if (!await verifyDigestId(id, token, secret)) {
    return jsonResponse({ error: 'Invalid mark-read link' }, 403)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return jsonResponse({ error: 'Supabase service configuration is missing' }, 500)
  const supabase = createClient(supabaseUrl, serviceKey)
  const { error } = await supabase.from('digests').update({ opened_at: new Date().toISOString() }).eq('id', id).is('opened_at', null)
  if (error) return jsonResponse({ error: 'Unable to mark the digest as read' }, 500)

  const appUrl = Deno.env.get('APP_URL')
  if (appUrl) return Response.redirect(`${appUrl.replace(/\/$/, '')}/digests/${encodeURIComponent(id)}`, 302)
  return jsonResponse({ success: true })
})
