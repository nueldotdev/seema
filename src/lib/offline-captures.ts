import { supabase } from './supabase'

export interface OfflineCapture {
  id: string
  text: string
  created_at: string
}

const storagePrefix = 'seema-offline-captures-v1:'

function storageKey(userId: string) {
  return `${storagePrefix}${userId}`
}

export function getOfflineCaptures(userId: string): OfflineCapture[] {
  const stored = localStorage.getItem(storageKey(userId))
  if (!stored) return []
  const parsed: unknown = JSON.parse(stored)
  if (!Array.isArray(parsed)) throw new Error('Offline captures have an invalid format')
  return parsed.filter((capture): capture is OfflineCapture =>
    Boolean(
      capture &&
      typeof capture.id === 'string' &&
      typeof capture.text === 'string' &&
      typeof capture.created_at === 'string',
    ),
  )
}

function writeOfflineCaptures(userId: string, captures: OfflineCapture[]) {
  localStorage.setItem(storageKey(userId), JSON.stringify(captures))
  window.dispatchEvent(new CustomEvent('seema-offline-captures-changed', { detail: { userId } }))
}

export function saveOfflineCapture(userId: string, text: string): OfflineCapture {
  const capture = { id: crypto.randomUUID(), text, created_at: new Date().toISOString() }
  writeOfflineCaptures(userId, [...getOfflineCaptures(userId), capture])
  return capture
}

export async function syncOfflineCaptures(userId: string): Promise<number> {
  if (!supabase || !navigator.onLine) return getOfflineCaptures(userId).length
  const captures = getOfflineCaptures(userId)
  const remaining: OfflineCapture[] = []

  for (const capture of captures) {
    const { error: insertError } = await supabase.from('captures').insert({
      id: capture.id,
      text: capture.text,
      created_at: capture.created_at,
    })
    if (!insertError) continue

    if (insertError.code === '23505') {
      const { data, error: lookupError } = await supabase.from('captures')
        .select('id')
        .eq('id', capture.id)
        .maybeSingle()
      if (!lookupError && data?.id === capture.id) continue
      if (lookupError) console.error('Offline capture duplicate check failed:', lookupError.message)
    } else {
      console.error('Offline capture sync failed:', insertError.message)
    }
    remaining.push(capture)
  }

  writeOfflineCaptures(userId, remaining)
  return remaining.length
}
