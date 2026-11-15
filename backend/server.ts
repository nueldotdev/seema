import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface VercelRequest extends IncomingMessage {
  query: Record<string, string | string[] | undefined>
  body?: unknown
}

export interface VercelResponse extends ServerResponse {
  status(code: number): this
  json(body: unknown): this
  redirect(statusCode: number, url: string): this
}

export function getAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !secretKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be configured on the server')
  }
  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export function bearerToken(request: VercelRequest) {
  const header = request.headers.authorization
  const value = Array.isArray(header) ? header[0] : header
  return value?.match(/^Bearer\s+(.+)$/i)?.[1]
}

export async function requireUser(request: VercelRequest) {
  const token = bearerToken(request)
  if (!token) return { client: null, user: null, error: 'Sign in to continue' }

  const client = getAdminClient()
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) return { client: null, user: null, error: 'Your session is invalid or expired' }
  return { client, user: data.user, error: null }
}

export function requestMethod(request: VercelRequest, response: VercelResponse, allowed: string[]) {
  response.setHeader('Allow', allowed.join(', '))
  if (request.method && allowed.includes(request.method)) return true
  response.status(405).json({ error: 'Method not allowed' })
  return false
}

export function todayInTimezone(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minute: Number(values.hour) * 60 + Number(values.minute),
  }
}

export function localMidnightAsUtc(date: string, timezone: string) {
  const [year, month, day] = date.split('-').map(Number)
  const desiredUtc = Date.UTC(year, month - 1, day)
  let candidate = desiredUtc
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })

  for (let attempt = 0; attempt < 3; attempt++) {
    const values = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]))
    const formattedAsUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    )
    const adjustment = desiredUtc - formattedAsUtc
    candidate += adjustment
    if (adjustment === 0) break
  }
  return new Date(candidate).toISOString()
}

export function previousDate(date: string) {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() - 1)
  return value.toISOString().slice(0, 10)
}

export function nextDate(date: string) {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + 1)
  return value.toISOString().slice(0, 10)
}
