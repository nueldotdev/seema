import type { Capture, Digest, UserSettings } from './types'

const STORAGE_KEY = 'seema-local-demo-v1'

interface DemoState {
  captures: Capture[]
  digests: Digest[]
  settings: UserSettings
}

const DEFAULT_SETTINGS: UserSettings = {
  preset_context: 'Explain clearly and accessibly, using a warm and encouraging tone.',
  delivery_time: '07:00',
  timezone: 'Africa/Lagos',
}

function seedState(): DemoState {
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const digestDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`
  const createdAt = yesterday.toISOString()

  return {
    settings: { ...DEFAULT_SETTINGS },
    captures: [],
    digests: [{
      id: 'local-demo-digest',
      digest_date: digestDate,
      created_at: createdAt,
      emailed_at: null,
      opened_at: null,
      reminder_sent_at: null,
      content: [
        {
          id: 'local-demo-moon',
          text: 'Why does the Moon have phases?',
          status: 'researched',
          created_at: createdAt,
          result: {
            explanation: 'The Moon does not make its own light; it reflects sunlight. As it travels around Earth, we see different portions of its sunlit half, which creates the familiar phases. The full cycle takes about 29.5 days.',
            resources: [],
            self_test: 'Does the Moon itself change shape during its phases?',
          },
        },
        {
          id: 'local-demo-photosynthesis',
          text: 'How do plants make food?',
          status: 'researched',
          created_at: createdAt,
          result: {
            explanation: 'Plants use photosynthesis to turn light energy into chemical energy stored in sugars. Their leaves take in carbon dioxide from the air and water from the soil. Using sunlight and chlorophyll, they make glucose and release oxygen.',
            resources: [],
            self_test: 'Which three inputs does a plant use during photosynthesis?',
          },
        },
      ],
    }],
  }
}

function readState(): DemoState {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) {
    const initial = seedState()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial))
    return initial
  }
  const parsed = JSON.parse(stored) as Partial<DemoState>
  return {
    captures: Array.isArray(parsed.captures) ? parsed.captures : [],
    digests: Array.isArray(parsed.digests) ? parsed.digests : [],
    settings: parsed.settings ?? { ...DEFAULT_SETTINGS },
  }
}

function writeState(state: DemoState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function getDemoPendingCount() {
  return readState().captures.filter((capture) => capture.status === 'pending').length
}

export function getDemoQueueCaptures() {
  return readState().captures.filter((capture) => capture.status === 'pending' || capture.status === 'failed')
}

export function getDemoResearchedCaptures() {
  return readState().captures.filter((capture) => capture.status === 'researched')
}

export function researchDemoCapture(id: string) {
  const state = readState()
  const capture = state.captures.find((item) => item.id === id && (item.status === 'pending' || item.status === 'failed'))
  if (!capture) return null
  capture.status = 'researched'
  capture.result = {
    explanation: `This is a local demo preview for “${capture.text}”. In the live app, Seema researches this topic and prepares a tailored explanation with useful sources.`,
    resources: [],
    self_test: `What would you most like to understand about ${capture.text}?`,
  }
  writeState(state)
  return capture
}

export function saveDemoCapture(text: string) {
  const state = readState()
  state.captures.push({
    id: crypto.randomUUID(),
    text,
    status: 'pending',
    result: null,
    created_at: new Date().toISOString(),
  })
  writeState(state)
}

export function createDemoDigest() {
  const state = readState()
  const pending = state.captures.filter((capture) => capture.status === 'pending')
  if (!pending.length) return null

  const now = new Date()
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const id = crypto.randomUUID()
  const content = pending.map((capture) => ({
    ...capture,
    status: 'researched' as const,
    result: {
      explanation: `This is a local demo preview for “${capture.text}”. In the live app, Seema researches this topic and prepares a tailored explanation with useful sources.`,
      resources: [],
      self_test: `What would you most like to understand about ${capture.text}?`,
    },
  }))
  const digest: Digest = {
    id,
    digest_date: date,
    content,
    created_at: now.toISOString(),
    emailed_at: null,
    opened_at: null,
    reminder_sent_at: null,
  }
  state.captures = state.captures.filter((capture) => capture.status !== 'pending')
  state.digests.unshift(digest)
  writeState(state)
  return digest.id
}

export function getDemoDigests() {
  return readState().digests
}

export function getDemoDigest(id: string) {
  return readState().digests.find((digest) => digest.id === id) ?? null
}

export function markDemoDigestOpened(id: string) {
  const state = readState()
  const digest = state.digests.find((item) => item.id === id)
  if (!digest) return null
  digest.opened_at ??= new Date().toISOString()
  writeState(state)
  return digest
}

export function getDemoSettings() {
  return readState().settings
}

export function saveDemoSettings(settings: UserSettings) {
  const state = readState()
  state.settings = settings
  writeState(state)
}
