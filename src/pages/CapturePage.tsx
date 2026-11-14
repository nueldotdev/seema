import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowUp, Check, LogOut, Sparkles } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import { supabase } from '../lib/supabase'

export default function CapturePage() {
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
  }, [])

  async function capture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const captureText = text.trim()
    if (!captureText || !supabase) return
    setStatus('sending')
    setMessage('')
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
    if (!supabase || researching) return
    setResearching(true)
    setResearchError('')
    const { data, error } = await supabase.functions.invoke<{ status?: string; digest_id?: string; error?: string }>('research-now', {
      body: {},
    })
    setResearching(false)
    if (error) {
      console.error('Immediate research failed:', error.message)
      setResearchError('Couldn’t prepare your digest right now. Please try again in a moment.')
      return
    }
    if (data?.digest_id) {
      navigate(`/digests/${data.digest_id}`)
      return
    }
    setPendingCount(0)
    setResearchError('No saved thoughts are waiting to be researched.')
  }

  async function signOut() {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) console.error('Sign-out failed:', error.message)
  }

  return (
    <main className="capture-shell">
      <AppHeader />
      <section className="capture-content">
        <div className="eyebrow"><span className="eyebrow-line" /> A quieter kind of studying</div>
        <h1>What came up<br />that you want to <em>understand?</em></h1>
        <p className="intro-copy">Leave it here for tomorrow, or make a digest from today’s thoughts now.</p>
        <form className="capture-form" onSubmit={capture}>
          <label htmlFor="capture">Your thought, exactly as it is</label>
          <div className="capture-input-wrap">
            <textarea ref={inputRef} id="capture" rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="A word, a question, a half-formed thought…" />
            <div className="capture-form-footer">
              <span className="character-count">{text.length > 0 ? `${text.length} / 2,000` : 'Just type and let it go'}</span>
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
              {researching ? 'Looking into it…' : `Research ${pendingCount} saved ${pendingCount === 1 ? 'thought' : 'thoughts'} now`}
            </button>
            <p>Your digest will open here. The morning email still arrives at your usual time.</p>
          </div>
        )}
        {researchError && <p className="form-error research-feedback" role="alert">{researchError}</p>}
      </section>
      <footer className="capture-footer">
        <Link to="/digests">Your digests <span aria-hidden="true">↗</span></Link>
        <button className="quiet-button" onClick={signOut} aria-label="Sign out"><LogOut size={15} /> Sign out</button>
      </footer>
    </main>
  )
}
