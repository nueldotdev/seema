interface EmailMessage {
  to: string
  subject: string
  html: string
}

function base64(bytes: Uint8Array) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function base64Lines(value: string) {
  const encoded = base64(new TextEncoder().encode(value))
  return encoded.match(/.{1,76}/g)?.join('\r\n') ?? ''
}

function base64Url(value: string) {
  return base64(new TextEncoder().encode(value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function encodeHeader(value: string) {
  if (/[\r\n]/.test(value)) throw new Error('Email headers cannot contain newlines')
  if (/^[\x20-\x7e]*$/.test(value)) return value
  return `=?UTF-8?B?${base64(new TextEncoder().encode(value))}?=`
}

function plainTextFromHtml(html: string) {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<\/(p|div|section|h[1-6]|li|main|tr)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function mimeMessage({ to, subject, html }: EmailMessage) {
  if (/[\r\n]/.test(to)) throw new Error('Recipient address cannot contain newlines')
  if (!to.trim()) throw new Error('Recipient address is required')

  const boundary = `seema-${crypto.randomUUID()}`
  const text = plainTextFromHtml(html)
  return [
    `To: ${to.trim()}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(html),
    `--${boundary}--`,
    '',
  ].join('\r\n')
}

export async function sendEmail(message: EmailMessage) {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
  const refreshToken = Deno.env.get('GOOGLE_REFRESH_TOKEN')
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN must be configured')
  }

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!tokenResponse.ok) {
    throw new Error(`Google OAuth token refresh failed (${tokenResponse.status}): ${await tokenResponse.text()}`)
  }
  const tokenPayload = await tokenResponse.json() as { access_token?: string }
  if (!tokenPayload.access_token) throw new Error('Google OAuth returned no access token')

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenPayload.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: base64Url(mimeMessage(message)) }),
  })
  if (!response.ok) {
    throw new Error(`Gmail API send failed (${response.status}): ${await response.text()}`)
  }
  return response.json()
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!)
}

export function digestHtml(items: Array<{ text: string; status: string; result: Record<string, unknown> | null }>, readUrl: string) {
  const sections = items.map((item) => {
    const title = escapeHtml(item.text)
    const result = item.result ?? {}
    const explanation = typeof result.explanation === 'string'
      ? `<p style="font-size:15px;line-height:1.75;color:#526057">${escapeHtml(result.explanation)}</p>`
      : '<p style="font-size:14px;color:#7c7568">We couldn’t research this one today. It’s still saved for another time.</p>'
    const resources = Array.isArray(result.resources) ? result.resources.map((resource) => {
      if (!resource || typeof resource !== 'object') return ''
      const entry = resource as { title?: unknown; url?: unknown; source?: unknown }
      if (typeof entry.url !== 'string' || typeof entry.title !== 'string') return ''
      return `<li style="margin:8px 0"><a href="${escapeHtml(entry.url)}" style="color:#385a4a">${escapeHtml(entry.title)}</a>${typeof entry.source === 'string' ? ` <span style="color:#888">(${escapeHtml(entry.source)})</span>` : ''}</li>`
    }).join('') : ''
    const selfTest = typeof result.self_test === 'string' ? `<p style="background:#eff1eb;padding:14px 16px;color:#405047"><strong>Try this:</strong> ${escapeHtml(result.self_test)}</p>` : ''
    return `<section style="margin:30px 0;padding-top:20px;border-top:1px solid #e6e8e1"><h2 style="font-family:Georgia,serif;font-size:23px;font-weight:normal;color:#334239">${title}</h2>${explanation}${resources ? `<h3 style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#7f887f">A little further</h3><ul style="padding-left:20px">${resources}</ul>` : ''}${selfTest}</section>`
  }).join('')

  return `<!doctype html><html><body style="margin:0;background:#f8f8f5;font-family:Arial,sans-serif;color:#26342d"><main style="max-width:620px;margin:0 auto;padding:32px 22px"><p style="font-family:Georgia,serif;color:#385a4a;font-size:23px;margin:0">seema.</p><p style="margin:30px 0 10px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#879087">Your morning reading</p><h1 style="font-family:Georgia,serif;font-weight:normal;font-size:36px;line-height:1.2;margin:0 0 28px">A little more room to understand.</h1>${sections}<p style="margin-top:38px;border-top:1px solid #e6e8e1;padding-top:24px;color:#7d857e;font-size:13px">Already read this? <a href="${escapeHtml(readUrl)}" style="color:#385a4a">Mark this digest as read</a>.</p><p style="color:#9aa198;font-size:11px">You’re receiving this because you saved a thought in Seema.</p></main></body></html>`
}
