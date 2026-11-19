export type CaptureStatus = 'pending' | 'researched' | 'failed'

export interface Resource {
  title: string
  url: string
  source?: string
}

export interface CaptureResult {
  explanation?: string
  resources?: Resource[]
  self_test?: string
  error?: string
}

export interface Capture {
  id: string
  text: string
  status: CaptureStatus
  result: CaptureResult | null
  created_at: string
  followup_count?: number
}

export interface Digest {
  id: string
  digest_date: string
  content: Capture[]
  created_at: string
  emailed_at: string | null
  opened_at: string | null
  reminder_sent_at: string | null
}

export interface CaptureFollowUp {
  id: string
  capture_id: string
  question: string
  answer: string
  created_at: string
}

export interface UserSettings {
  preset_context: string
  delivery_time: string
  timezone: string
  email_enabled: boolean
}
