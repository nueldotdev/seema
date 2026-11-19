import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowUpRight, LoaderCircle, Send, Trash2 } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { deleteDemoFollowUp, getDemoCapture, getDemoFollowUpCount, getDemoFollowUps, saveDemoFollowUp } from '../lib/demo'
import type { Capture, CaptureFollowUp } from '../lib/types'

const suggestions = [
  'Can you explain that more simply?',
  'What is a practical example?',
  'What is the key thing to remember?',
]

export default function DiscussPage() {
  const { id } = useParams()
  const { demoMode } = useAuth()
  const [capture, setCapture] = useState<Capture | null>(null)
  const [followUps, setFollowUps] = useState<CaptureFollowUp[]>([])
  const [usedCount, setUsedCount] = useState(0)
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const threadEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError('')
      setFollowUps([])
      setUsedCount(0)
      if (demoMode) {
        try {
          const localCapture = id ? getDemoCapture(id) : null
          if (!localCapture) throw new Error('This saved topic could not be found.')
          setCapture(localCapture)
          setFollowUps(getDemoFollowUps(localCapture.id))
          setUsedCount(getDemoFollowUpCount(localCapture.id))
        } catch (loadError) {
          console.error('Local discussion load failed:', loadError)
          setError(loadError instanceof Error ? loadError.message : 'This topic could not be loaded.')
        }
        setLoading(false)
        return
      }
      if (!supabase || !id) {
        setError('This saved topic could not be found.')
        setLoading(false)
        return
      }
      const { data: savedCapture, error: captureError } = await supabase.from('captures')
        .select('id,text,status,result,created_at,followup_count')
        .eq('id', id)
        .single()
      if (!active) return
      if (captureError || !savedCapture) {
        if (captureError) console.error('Discussion capture lookup failed:', captureError.message)
        setError('This saved topic could not be found.')
        setLoading(false)
        return
      }
      setCapture(savedCapture as Capture)
      setUsedCount(savedCapture.followup_count ?? 0)
      const { data, error: followUpError } = await supabase.from('capture_followups')
        .select('id,capture_id,question,answer,created_at')
        .eq('capture_id', id)
        .order('created_at', { ascending: true })
      if (!active) return
      if (followUpError) {
        console.error('Capture discussion history lookup failed:', followUpError.message)
        setError('The topic loaded, but its discussion could not be retrieved.')
      } else {
        setFollowUps((data ?? []) as CaptureFollowUp[])
      }
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [demoMode, id])

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [followUps, submitting])

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = question.trim()
    if (!text || !capture || submitting || usedCount >= 10) return
    setSubmitting(true)
    setError('')
    if (demoMode) {
      try {
        const answer = `This is a local demo response about “${capture.text}”. In the live app, the answer is based only on this saved topic and its research.`
        setFollowUps((current) => [...current, saveDemoFollowUp(capture.id, text, answer)])
        setUsedCount((count) => count + 1)
        setQuestion('')
      } catch (saveError) {
        console.error('Local discussion save failed:', saveError)
        setError('This question could not be saved in the local demo.')
      }
      setSubmitting(false)
      return
    }
    if (!supabase) {
      setError('Discussion is unavailable because the app is not configured.')
      setSubmitting(false)
      return
    }
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !session) throw new Error(sessionError?.message ?? 'Your sign-in session has expired')
      const response = await fetch('/api/follow-up', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ capture_id: capture.id, question: text }),
      })
      const data = await response.json() as { follow_up?: CaptureFollowUp; used_count?: number; error?: string }
      if (!response.ok) throw new Error(data.error ?? 'This question could not be answered')
      const savedFollowUp = data.follow_up
      if (!savedFollowUp) throw new Error('The server returned an invalid answer')
      setFollowUps((current) => [...current, savedFollowUp])
      if (typeof data.used_count === 'number') setUsedCount(data.used_count)
      setQuestion('')
    } catch (askError) {
      console.error('Capture discussion request failed:', askError)
      setError(askError instanceof Error ? askError.message : 'This question could not be answered.')
    }
    setSubmitting(false)
  }

  async function deleteFollowUp(followUp: CaptureFollowUp) {
    if (deletingId) return
    setDeletingId(followUp.id)
    setError('')
    if (demoMode) {
      try {
        deleteDemoFollowUp(followUp.id)
        setFollowUps((current) => current.filter((entry) => entry.id !== followUp.id))
      } catch (deleteError) {
        console.error('Local discussion delete failed:', deleteError)
        setError('This question could not be deleted. Please try again.')
      }
      setDeletingId(null)
      return
    }
    if (!supabase) {
      setError('Discussion is unavailable because the app is not configured.')
      setDeletingId(null)
      return
    }
    const { error: deleteError } = await supabase.from('capture_followups').delete().eq('id', followUp.id)
    if (deleteError) {
      console.error('Capture discussion delete failed:', deleteError.message)
      setError('This question could not be deleted. Please try again.')
    } else {
      setFollowUps((current) => current.filter((entry) => entry.id !== followUp.id))
    }
    setDeletingId(null)
  }

  if (loading) return <main className="page-shell"><AppHeader backTo="/history" backLabel="History" /><div className="reader-loading"><span className="loading-dot" /></div></main>
  if (!capture) return <main className="page-shell"><AppHeader backTo="/history" backLabel="History" /><div className="reader-error"><h1>{error || 'Topic not found.'}</h1><Link to="/history" className="inline-link">Back to history <ArrowUpRight size={15} /></Link></div></main>

  const result = capture.result
  const remaining = Math.max(0, 10 - usedCount)

  return (
    <main className="page-shell discuss-shell">
      <AppHeader backTo="/history" backLabel="History" />
      <section className="discuss-content">
        <p className="discuss-kicker">A focused discussion</p>
        <h1>{capture.text}</h1>
        {result?.explanation && <p className="discuss-context">{result.explanation}</p>}
        {result?.resources && result.resources.length > 0 && (
          <div className="discuss-sources">
            <span>From this topic’s sources</span>
            {result.resources.map((resource, index) => (
              <a href={resource.url} key={`${resource.url}-${index}`} target="_blank" rel="noreferrer">
                {resource.title}<ArrowUpRight size={13} />
              </a>
            ))}
          </div>
        )}
        {error && <p className="form-error" role="status">{error}</p>}
        <div className="discuss-thread" aria-live="polite">
          {followUps.map((followUp) => (
            <article className="discuss-turn" key={followUp.id}>
              <div className="discuss-user-message">{followUp.question}</div>
              <div className="discuss-answer-row">
                <p className="discuss-answer">{followUp.answer}</p>
                <button
                  className="quiet-icon-button"
                  type="button"
                  aria-label="Delete this question and answer"
                  title="Delete this question and answer"
                  disabled={deletingId === followUp.id}
                  onClick={() => void deleteFollowUp(followUp)}
                >
                  {deletingId === followUp.id ? <LoaderCircle className="queue-spinner" size={16} /> : <Trash2 size={15} />}
                </button>
              </div>
            </article>
          ))}
          {!followUps.length && <p className="discuss-empty">Want to go a little deeper? Ask about this topic, and we’ll keep the discussion grounded in its saved research.</p>}
          <div ref={threadEndRef} />
        </div>
        <div className="discuss-composer">
          <div className="discuss-limit">{usedCount} of 10 questions used for this capture</div>
          {remaining > 0 ? (
            <>
              <div className="follow-up-suggestions" aria-label="Suggested questions">
                {suggestions.map((suggestion) => (
                  <button key={suggestion} type="button" onClick={() => setQuestion(suggestion)}>{suggestion}</button>
                ))}
              </div>
              <form className="follow-up-form" onSubmit={(event) => void ask(event)}>
                <textarea
                  value={question}
                  maxLength={1000}
                  rows={2}
                  placeholder="Ask a follow-up about this topic…"
                  aria-label="Ask a follow-up question"
                  onChange={(event) => setQuestion(event.target.value)}
                />
                <button type="submit" disabled={!question.trim() || submitting}>
                  {submitting ? <LoaderCircle className="queue-spinner" size={15} /> : <Send size={15} />}
                  Ask
                </button>
              </form>
            </>
          ) : <p className="follow-up-note">You’ve reached the 10-question limit for this capture.</p>}
          <p className="follow-up-note">This stays focused on this capture and its sources, not an open-ended chat.</p>
        </div>
      </section>
    </main>
  )
}
