import { Webhook } from 'standardwebhooks'
import { escapeHtml, sendEmail } from '../../backend/email.js'
import type { VercelRequest, VercelResponse } from '../../backend/server.js'

export const config = { api: { bodyParser: false } }

const MAX_PAYLOAD_BYTES = 1024 * 1024

interface AuthEmailData {
  token?: string
  token_hash?: string
  redirect_to?: string
  email_action_type?: string
  token_new?: string
  token_hash_new?: string
}

interface AuthEmailPayload {
  user?: { email?: string; new_email?: string }
  email_data?: AuthEmailData
}

const actionCopy: Record<string, { subject: string; heading: string; message: string }> = {
  signup: {
    subject: 'Confirm your Seema account',
    heading: 'Welcome to Seema.',
    message: 'Confirm your email address to finish creating your account.',
  },
  invite: {
    subject: 'You’re invited to Seema',
    heading: 'You’re invited.',
    message: 'Use this link to accept your invitation and continue to Seema.',
  },
  magiclink: {
    subject: 'Your Seema sign-in link',
    heading: 'A little more room to think.',
    message: 'Use this secure link to sign in to Seema.',
  },
  recovery: {
    subject: 'Reset your Seema password',
    heading: 'Reset your password.',
    message: 'Use this secure link to reset your Seema password.',
  },
  email_change: {
    subject: 'Confirm your Seema email change',
    heading: 'Confirm your email change.',
    message: 'Use this secure link to confirm the email address change for your Seema account.',
  },
  email: {
    subject: 'Confirm your Seema email',
    heading: 'Confirm your email.',
    message: 'Use this secure link to confirm your email address.',
  },
  reauthentication: {
    subject: 'Your Seema verification code',
    heading: 'Confirm it’s you.',
    message: 'Use this verification code to continue.',
  },
  password_changed_notification: {
    subject: 'Your Seema password was changed',
    heading: 'Your password was changed.',
    message: 'The password for your Seema account was recently changed.',
  },
  email_changed_notification: {
    subject: 'Your Seema email was changed',
    heading: 'Your email address was changed.',
    message: 'The email address for your Seema account was recently changed.',
  },
  phone_changed_notification: {
    subject: 'Your Seema phone number was changed',
    heading: 'Your phone number was changed.',
    message: 'The phone number for your Seema account was recently changed.',
  },
  identity_linked_notification: {
    subject: 'An identity was linked to your Seema account',
    heading: 'An identity was linked.',
    message: 'A new identity was linked to your Seema account.',
  },
  identity_unlinked_notification: {
    subject: 'An identity was unlinked from your Seema account',
    heading: 'An identity was unlinked.',
    message: 'An identity was unlinked from your Seema account.',
  },
  mfa_factor_enrolled_notification: {
    subject: 'Multi-factor authentication enabled for Seema',
    heading: 'Multi-factor authentication enabled.',
    message: 'A multi-factor authentication method was added to your Seema account.',
  },
  mfa_factor_unenrolled_notification: {
    subject: 'Multi-factor authentication changed for Seema',
    heading: 'A multi-factor authentication method was removed.',
    message: 'A multi-factor authentication method was removed from your Seema account.',
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function optionalStrings(value: Record<string, unknown>, fields: string[]) {
  return fields.every((field) => value[field] === undefined || typeof value[field] === 'string')
}

function stringField(value: Record<string, unknown>, field: string) {
  return typeof value[field] === 'string' ? value[field] : undefined
}

async function readPayload(request: VercelRequest) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_PAYLOAD_BYTES) throw new RangeError('Webhook payload exceeds the size limit')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function authEmailHtml(
  actionType: string,
  supabaseUrl: string,
  redirectTo: string | undefined,
  tokenHash: string | undefined,
  token: string | undefined,
) {
  const copy = actionCopy[actionType]
  if (!copy) throw new Error(`Unsupported authentication email action: ${actionType}`)

  let button = ''
  if (tokenHash) {
    const link = new URL('/auth/v1/verify', supabaseUrl)
    link.searchParams.set('token', tokenHash)
    link.searchParams.set('type', actionType)
    if (redirectTo) link.searchParams.set('redirect_to', redirectTo)
    button = `<p style="margin:28px 0"><a href="${escapeHtml(link.toString())}" style="display:inline-block;background:#385a4a;color:#fff;padding:13px 20px;text-decoration:none;border-radius:4px">Continue to Seema</a></p>`
  }

  const code = token
    ? `<p style="margin-top:24px;color:#526057">Or enter this verification code: <strong style="letter-spacing:2px">${escapeHtml(token)}</strong></p>`
    : ''
  return `<!doctype html><html><body style="margin:0;background:#f8f8f5;font-family:Arial,sans-serif;color:#26342d"><main style="max-width:560px;margin:0 auto;padding:32px 22px"><p style="font-family:Georgia,serif;color:#385a4a;font-size:23px;margin:0">seema.</p><h1 style="font-family:Georgia,serif;font-weight:normal;font-size:30px;margin:32px 0 12px">${escapeHtml(copy.heading)}</h1><p style="font-size:15px;line-height:1.7;color:#526057">${escapeHtml(copy.message)}</p>${button}${code}<p style="margin-top:32px;color:#899087;font-size:12px">If you didn’t request this, you can ignore this email.</p></main></body></html>`
}

async function sendAuthEmail(
  to: string,
  actionType: string,
  data: AuthEmailData,
  supabaseUrl: string,
  tokenHash = data.token_hash,
  token = data.token,
) {
  const copy = actionCopy[actionType]
  if (!copy) throw new Error(`Unsupported authentication email action: ${actionType}`)
  await sendEmail({
    to,
    subject: copy.subject,
    html: authEmailHtml(actionType, supabaseUrl, data.redirect_to, tokenHash, token),
  })
}

export default async function sendAuthEmailHook(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).json({ error: 'Method not allowed' })
  }

  const hookSecret = process.env.SEND_EMAIL_HOOK_SECRET
  const supabaseUrl = process.env.SUPABASE_URL
  if (!hookSecret || !supabaseUrl) {
    console.error('Auth email hook requires SEND_EMAIL_HOOK_SECRET and SUPABASE_URL')
    return response.status(500).json({ error: 'Authentication email delivery is not configured' })
  }

  let rawPayload: string
  try {
    rawPayload = await readPayload(request)
  } catch (error) {
    if (error instanceof RangeError) return response.status(413).json({ error: 'Webhook payload is too large' })
    console.error('Unable to read auth email hook payload:', error)
    return response.status(400).json({ error: 'Invalid webhook request' })
  }

  const headers = {
    'webhook-id': request.headers['webhook-id'],
    'webhook-timestamp': request.headers['webhook-timestamp'],
    'webhook-signature': request.headers['webhook-signature'],
  }
  if (Object.values(headers).some((value) => typeof value !== 'string')) {
    return response.status(401).json({ error: 'Invalid webhook signature' })
  }

  let verifiedPayload: unknown
  try {
    const secret = hookSecret.replace(/^v1,whsec_/, '')
    verifiedPayload = new Webhook(secret).verify(rawPayload, headers as Record<string, string>)
  } catch (error) {
    console.error('Auth email hook signature verification failed:', error)
    return response.status(401).json({ error: 'Invalid webhook signature' })
  }

  if (!isRecord(verifiedPayload) || !isRecord(verifiedPayload.user) || !isRecord(verifiedPayload.email_data)) {
    return response.status(400).json({ error: 'Invalid authentication email payload' })
  }
  const user = verifiedPayload.user
  const emailData = verifiedPayload.email_data
  if (
    typeof user.email !== 'string' ||
    (user.new_email !== undefined && typeof user.new_email !== 'string') ||
    !optionalStrings(emailData, ['token', 'token_hash', 'redirect_to', 'email_action_type', 'token_new', 'token_hash_new'])
  ) {
    return response.status(400).json({ error: 'Invalid authentication email payload' })
  }

  const payload: AuthEmailPayload = {
    user: { email: user.email, new_email: stringField(user, 'new_email') },
    email_data: {
      token: stringField(emailData, 'token'),
      token_hash: stringField(emailData, 'token_hash'),
      redirect_to: stringField(emailData, 'redirect_to'),
      email_action_type: stringField(emailData, 'email_action_type'),
      token_new: stringField(emailData, 'token_new'),
      token_hash_new: stringField(emailData, 'token_hash_new'),
    },
  }
  const actionType = payload.email_data?.email_action_type
  const recipient = payload.user?.email
  const data = payload.email_data
  if (!actionType || !data || !recipient || !actionCopy[actionType]) {
    return response.status(400).json({ error: 'Unsupported authentication email request' })
  }

  try {
    if (actionType === 'email_change' && data.token_hash_new && data.token_new && payload.user?.new_email) {
      await Promise.all([
        sendAuthEmail(recipient, actionType, data, supabaseUrl, data.token_hash_new, data.token),
        sendAuthEmail(payload.user.new_email, actionType, data, supabaseUrl, data.token_hash, data.token_new),
      ])
    } else if (actionType === 'email_change' && data.token_hash && data.token_new && payload.user?.new_email) {
      await sendAuthEmail(payload.user.new_email, actionType, data, supabaseUrl, data.token_hash, data.token_new)
    } else {
      await sendAuthEmail(recipient, actionType, data, supabaseUrl)
    }
    return response.status(200).json({})
  } catch (error) {
    console.error('Auth email delivery failed:', error)
    return response.status(500).json({ error: 'Authentication email could not be delivered' })
  }
}
