import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowUp, Check, LogOut, Sparkles } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { createDemoDigest, getDemoPendingCount, saveDemoCapture } from '../lib/demo'

export default function CapturePage() {
  const { demoMode } = useAuth()
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [pendingCount, setPendingCount] = useState(0)
  const [researching, setResearching] = useState(false)
  const [researchError, setResearchError] = useState('')
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const shared = searchParams.get('text') || searchParams.get('url') || searchParams.get('title')
    if (shared) setText(shared)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80)
    return () => window.clearTimeout(timer)
  }, [searchParams])

  useEffect(() => {
    let active = true
    async function loadPendingCount() {
      if (demoMode) {
        try {
          setPendingCount(getDemoPendingCount())
        } catch (error) {
          console.error('Unable to load local demo captures:', error)
          setResearchError('Couldn’t load local demo data. Check browser storage and try again.')
        }
        return
      }
      if (!supabase) return
      const { data: settings, error: settingsError } = await supabase.from('settings')
        .select('timezone')
        .maybeSingle()
      if (settingsError) {
        console.error('Settings timezone lookup failed:', settingsError.message)
        if (active) setResearchError('Couldn’t check your saved thoughts. Please refresh and try again.')
        return
      }
      const timezone = settings?.timezone ?? 'Africa/Lagos'
      const dateParts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date())
      const dateValues = Object.fromEntries(dateParts.map((part) => [part.type, part.value]))
      const today = `${dateValues.year}-${dateValues.month}-${dateValues.day}`
      const { data, error } = await supabase.from('captures')
        .select('created_at')
        .eq('status', 'pending')
      if (!active) return
      if (error) {
        console.error('Pending capture count failed:', error.message)
        setResearchError('Couldn’t check your saved thoughts. Please refresh and try again.')
      } else {
        const dateFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
        setPendingCount((data ?? []).filter((capture) => {
          const parts = dateFormatter.formatToParts(new Date(capture.created_at))
          const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
          return `${values.year}-${values.month}-${values.day}` === today
        }).length)
      }
    }
    void loadPendingCount()
    return () => { active = false }
  }, [demoMode])

  async function capture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const captureText = text.trim()
    if (!captureText || (!supabase && !demoMode)) return
    setStatus('sending')
    setMessage('')
    if (demoMode) {
      try {
        saveDemoCapture(captureText)
        setText('')
        setPendingCount((count) => count + 1)
        setResearchError('')
        setStatus('sent')
        setMessage('Saved in this browser’s local demo.')
        window.setTimeout(() => setStatus('idle'), 2600)
        inputRef.current?.focus()
      } catch (error) {
        setStatus('error')
        setMessage('That didn’t save. Check browser storage and try again.')
        console.error('Local demo capture save failed:', error)
      }
      return
    }
    if (!supabase) return
    const { error } = await supabase.from('captures').insert({ text: captureText })
    if (error) {
      setStatus('error')
      setMessage('That didn’t save. Check your connection and try again.')
      console.error('Capture insert failed:', error.message)
      return
    }
    setText('')
    setPendingCount((count) => count + 1)
    setResearchError('')
    setStatus('sent')
    setMessage('Saved for later.')
    window.setTimeout(() => setStatus('idle'), 2600)
    inputRef.current?.focus()
  }

  async function researchNow() {
    if (demoMode) {
      try {
        const digestId = createDemoDigest()
        if (digestId) {
          setPendingCount(0)
          navigate(`/digests/${digestId}`)
        } else {
          setResearchError('No saved thoughts are waiting to be previewed.')
        }
      } catch (error) {
        console.error('Local demo digest creation failed:', error)
        setResearchError('Couldn’t create a local preview. Check browser storage and try again.')
      }
      return
    }
    if (!supabase || researching) return
    setResearching(true)
    setResearchError('')
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !session) {
      setResearching(false)
      setResearchError('Your sign-in session expired. Please sign in again.')
      if (sessionError) console.error('Unable to get session for research:', sessionError.message)
      return
    }

    let response: Response
    try {
      response = await fetch('/api/research-now', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
    } catch (requestError) {
      setResearching(false)
      console.error('Immediate research request failed:', requestError)
      setResearchError('Couldn’t prepare your digest right now. Please try again in a moment.')
      return
    }

    let data: { status?: string; digest_id?: string; error?: string }
    try {
      data = await response.json() as { status?: string; digest_id?: string; error?: string }
    } catch (parseError) {
      setResearching(false)
      console.error('Immediate research returned an invalid response:', parseError)
      setResearchError('The server returned an unexpected response. Please try again in a moment.')
      return
    }
    setResearching(false)
    if (!response.ok) {
      console.error('Immediate research failed:', data.error ?? response.statusText)
      setResearchError(data.error ?? 'Couldn’t prepare your digest right now. Please try again in a moment.')
      return
    }
    if (data.digest_id) {
      navigate(`/digests/${data.digest_id}`)
      return
    }
    setPendingCount(0)
    setResearchError('No saved thoughts are waiting to be researched.')
  }

  async function signOut() {
    if (demoMode) return
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) console.error('Sign-out failed:', error.message)
  }

  return (
    <main className="capture-shell">
      <AppHeader showQueue showDigests showTopics />
      <section className="capture-content">
        <h1>What came up<em>?</em></h1>
        <p className="intro-copy">Save a question now. Come back to a clear answer later.</p>
        <form className="capture-form" onSubmit={capture}>
          <div className="capture-input-wrap">
            <textarea ref={inputRef} id="capture" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a topic or question…" aria-label="Your thought" />
            <div className="capture-form-footer">
              <span className="character-count">{text.length > 0 ? `${text.length} / 2,000` : 'Save it for later'}</span>
              <button className="send-button" type="submit" disabled={!text.trim() || status === 'sending'} aria-label="Save thought">
                {status === 'sending' ? <span className="button-spinner" /> : status === 'sent' ? <Check size={19} /> : <ArrowUp size={19} />}
              </button>
            </div>
          </div>
          <p className={`save-status ${status === 'error' ? 'error-text' : ''}`} role="status">{message}</p>
        </form>
        {pendingCount > 0 && (
          <div className="research-now">
            <button className="research-now-button" type="button" onClick={researchNow} disabled={researching}>
              {researching ? <span className="button-spinner" /> : <Sparkles size={16} />}
              {demoMode ? 'Preview saved thoughts' : researching ? 'Looking into it…' : `Research ${pendingCount} saved ${pendingCount === 1 ? 'thought' : 'thoughts'} now`}
            </button>
            <p>{demoMode ? 'Creates a local preview only. No live research or email is sent.' : 'Your digest will open here. The morning email still arrives at your usual time.'}</p>
          </div>
        )}
        {researchError && <p className="form-error research-feedback" role="alert">{researchError}</p>}
      </section>
      {!demoMode && <footer className="capture-footer">
        <button className="quiet-button" onClick={signOut} aria-label="Sign out"><LogOut size={15} /> Sign out</button>
      </footer>}
    </main>
  )
}
