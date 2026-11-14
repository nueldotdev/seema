async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function signDigestId(id: string, secret: string) {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(id))
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function verifyDigestId(id: string, token: string, secret: string) {
  if (!/^[\da-f]{64}$/i.test(token)) return false
  const signature = Uint8Array.from(token.match(/.{2}/g)!, (byte) => Number.parseInt(byte, 16))
  return crypto.subtle.verify('HMAC', await hmacKey(secret), signature, new TextEncoder().encode(id))
}
