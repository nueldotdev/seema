import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowUp, Check, LogOut, Sparkles } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { createDemoDigest, getDemoPendingCount, getDemoQueueCaptures, getDemoSettings, researchDemoCapture, saveDemoCapture } from '../lib/demo'
import { getOfflineCaptures, saveOfflineCapture, syncOfflineCaptures } from '../lib/offline-captures'

export default function CapturePage() {
  const { demoMode, session } = useAuth()
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [pendingCount, setPendingCount] = useState(0)
  const [offlineCount, setOfflineCount] = useState(0)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [emailEnabled, setEmailEnabled] = useState(true)
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
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const refreshPendingCount = useCallback(async () => {
    if (demoMode) {
      try {
        setPendingCount(getDemoPendingCount())
        setEmailEnabled(getDemoSettings().email_enabled)
      } catch (error) {
        console.error('Unable to load local demo captures:', error)
        setResearchError('Couldn’t load local demo data. Check browser storage and try again.')
      }
      return
    }
    const userId = session?.user.id
    if (!supabase || !userId) return
    try {
      const offline = getOfflineCaptures(userId)
      const localDate = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })
      const todayLocal = localDate.format(new Date())
      setOfflineCount(offline.filter((capture) => localDate.format(new Date(capture.created_at)) === todayLocal).length)
    } catch (error) {
      console.error('Offline capture queue could not be loaded:', error)
      setResearchError('Your locally saved thoughts could not be loaded from this browser.')
      return
    }
    if (!navigator.onLine) return
    const { data: settings, error: settingsError } = await supabase.from('settings')
      .select('timezone,email_enabled')
      .maybeSingle()
    if (settingsError) {
      console.error('Settings timezone lookup failed:', settingsError.message)
      if (navigator.onLine) setResearchError('Couldn’t check your saved thoughts. Please refresh and try again.')
      return
    }
    setEmailEnabled(settings?.email_enabled ?? true)
    const timezone = settings?.timezone ?? 'Africa/Lagos'
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const dateKey = (value: string) => {
      const values = Object.fromEntries(formatter.formatToParts(new Date(value)).map((part) => [part.type, part.value]))
      return `${values.year}-${values.month}-${values.day}`
    }
    const today = dateKey(new Date().toISOString())
    const offline = getOfflineCaptures(userId)
    setOfflineCount(offline.filter((capture) => dateKey(capture.created_at) === today).length)
    const { data, error } = await supabase.from('captures')
      .select('created_at')
      .eq('status', 'pending')
    if (error) {
      console.error('Pending capture count failed:', error.message)
      if (navigator.onLine) setResearchError('Couldn’t check your saved thoughts. Please refresh and try again.')
      return
    }
    setPendingCount((data ?? []).filter((capture) => dateKey(capture.created_at) === today).length)
  }, [demoMode, session?.user.id])

  useEffect(() => {
    void refreshPendingCount()
  }, [refreshPendingCount])

  useEffect(() => {
    const userId = session?.user.id ?? ''
    if (demoMode || !userId) return
    let active = true
    async function sync() {
      try {
        await syncOfflineCaptures(userId)
        if (active) await refreshPendingCount()
      } catch (error) {
        console.error('Offline captures could not be synced:', error)
        if (active && navigator.onLine) setMessage('Your thought is saved on this device and will sync when the connection is stable.')
      }
    }
    const handleOnline = () => { void sync() }
    const handleQueueChange = (event: Event) => {
      if ((event as CustomEvent<{ userId: string }>).detail?.userId === userId) void refreshPendingCount()
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('seema-offline-captures-changed', handleQueueChange)
    if (navigator.onLine) void sync()
    return () => {
      active = false
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('seema-offline-captures-changed', handleQueueChange)
    }
  }, [demoMode, refreshPendingCount, session?.user.id])

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
    if (!supabase || !session?.user.id) {
      setStatus('error')
      setMessage('Your sign-in session is unavailable. Sign in again before saving.')
      return
    }
    try {
      saveOfflineCapture(session.user.id, captureText)
    } catch (error) {
      setStatus('error')
      setMessage('That didn’t save. Check browser storage and try again.')
      console.error('Local capture save failed:', error)
      return
    }
    setText('')
    setResearchError('')
    setStatus('sent')
    setMessage('Saved on this device. It will sync when you’re connected.')
    inputRef.current?.focus()
    if (navigator.onLine) {
      try {
        const remaining = await syncOfflineCaptures(session.user.id)
        setMessage(remaining === 0 ? 'Saved and synced.' : 'Saved on this device. It will sync when you’re connected.')
      } catch (error) {
        console.error('Capture sync failed after local save:', error)
      }
    }
    await refreshPendingCount()
    window.setTimeout(() => setStatus('idle'), 2600)
  }

  async function researchNow() {
    if (demoMode) {
      try {
        if (!emailEnabled) {
          for (const capture of getDemoQueueCaptures().filter((item) => item.status === 'pending')) {
            researchDemoCapture(capture.id)
          }
          setPendingCount(0)
          navigate('/history')
          return
        }
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
    if (!navigator.onLine) {
      setResearchError('You’re offline. Your saved thoughts will sync when you reconnect.')
      return
    }
    setResearching(true)
    setResearchError('')
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !session) {
      setResearching(false)
      setResearchError('Your sign-in session expired. Please sign in again.')
      if (sessionError) console.error('Unable to get session for research:', sessionError.message)
      return
    }
    try {
      const remaining = await syncOfflineCaptures(session.user.id)
      if (remaining > 0) {
        await refreshPendingCount()
        setResearching(false)
        setResearchError('Some saved thoughts are still waiting to sync. Please try again when your connection is stable.')
        return
      }
    } catch (syncError) {
      console.error('Saved thoughts could not be synced before research:', syncError)
      setResearching(false)
      setResearchError('Some saved thoughts are still waiting to sync. Please try again when your connection is stable.')
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
    if (data.status === 'researched') {
      setPendingCount(0)
      navigate('/history')
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
      <AppHeader showQueue showDigests={emailEnabled} showHistory />
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
        {pendingCount + offlineCount > 0 && (
          <div className="research-now">
            <button className="research-now-button" type="button" onClick={researchNow} disabled={researching || (!demoMode && !isOnline)}>
              {researching ? <span className="button-spinner" /> : <Sparkles size={16} />}
              {demoMode ? 'Preview saved thoughts' : researching ? 'Looking into it…' : !isOnline ? `${pendingCount + offlineCount} saved ${pendingCount + offlineCount === 1 ? 'thought' : 'thoughts'} waiting to sync` : `Research ${pendingCount + offlineCount} saved ${pendingCount + offlineCount === 1 ? 'thought' : 'thoughts'} now`}
            </button>
            <p>{demoMode ? 'Creates a local preview only. No live research or email is sent.' : !isOnline ? 'Research will be available after these thoughts sync.' : 'Your digest will open here. The email still arrives at your usual time.'}</p>
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
