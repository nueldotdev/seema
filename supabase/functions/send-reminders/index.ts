import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { digestHtml, sendEmail } from '../_shared/email.ts'
import { signDigestId } from '../_shared/signing.ts'

interface ReminderDigest {
  id: string
  user_id: string
  digest_date: string
  content: Array<{ text: string; status: string; result: Record<string, unknown> | null }>
  emailed_at: string
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || request.headers.get('Authorization') !== `Bearer ${secret}`) return jsonResponse({ error: 'Unauthorized' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return jsonResponse({ error: 'Supabase service configuration is missing' }, 500)
  const supabase = createClient(supabaseUrl, serviceKey)
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase.from('digests')
    .select('id,user_id,digest_date,content,emailed_at')
    .eq('status', 'ready')
    .not('emailed_at', 'is', null)
    .is('opened_at', null)
    .is('reminder_sent_at', null)
    .lt('emailed_at', cutoff)
  if (error) return jsonResponse({ error: error.message }, 500)

  const tokenSecret = Deno.env.get('MARK_READ_SECRET')
  const supabaseProjectUrl = Deno.env.get('SUPABASE_URL')
  if (!supabaseProjectUrl || !tokenSecret) return jsonResponse({ error: 'SUPABASE_URL and MARK_READ_SECRET must be configured' }, 500)
  const outcomes: Array<{ digest_id: string; status: string }> = []
  for (const digest of (data ?? []) as ReminderDigest[]) {
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(digest.user_id)
    if (userError) {
      console.error('Auth user lookup failed:', userError.message)
      outcomes.push({ digest_id: digest.id, status: 'email_lookup_failed' })
      continue
    }
    if (!userData.user.email) {
      outcomes.push({ digest_id: digest.id, status: 'missing_email' })
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
    const token = await signDigestId(digest.id, tokenSecret)
    const readUrl = `${supabaseProjectUrl.replace(/\/$/, '')}/functions/v1/mark-read?id=${encodeURIComponent(digest.id)}&token=${token}`
    try {
      await sendEmail({
        to: userData.user.email,
        subject: `A gentle reminder: your Seema digest is here`,
        html: `<p style="font-family:Arial,sans-serif;color:#526057">A little reminder in case it slipped by — your digest is ready.</p>${digestHtml(digest.content, readUrl)}`,
      })
      outcomes.push({ digest_id: digest.id, status: 'sent' })
    } catch (sendError) {
      const { error: resetError } = await supabase.from('digests').update({ reminder_sent_at: null }).eq('id', digest.id).eq('reminder_sent_at', claimTime)
      if (resetError) console.error('Reminder claim rollback failed:', resetError.message)
      console.error('Reminder email failed:', sendError)
      outcomes.push({ digest_id: digest.id, status: 'email_failed' })
    }
  }
  return jsonResponse({ processed: outcomes.length, outcomes })
})
