import { useCallback, useEffect, useState } from 'react'
import { ArrowUpRight, CircleAlert, LoaderCircle, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { getDemoQueueCaptures, researchDemoCapture } from '../lib/demo'
import type { Capture } from '../lib/types'

interface QueueCapture extends Capture {
  busy?: boolean
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

export default function QueuePage() {
  const { demoMode } = useAuth()
  const [captures, setCaptures] = useState<QueueCapture[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadQueue = useCallback(async () => {
    setError('')
    if (demoMode) {
      try {
        setCaptures(getDemoQueueCaptures())
      } catch (loadError) {
        console.error('Local demo queue load failed:', loadError)
        setError('Your local queue couldn’t be loaded.')
      }
      setLoading(false)
      return
    }
    if (!supabase) {
      setLoading(false)
      setError('The queue is unavailable because the app is not configured.')
      return
    }
    const { data, error: queryError } = await supabase.from('captures')
      .select('id,text,status,result,created_at')
      .is('digest_id', null)
      .in('status', ['pending', 'failed'])
      .order('created_at', { ascending: true })
    if (queryError) {
      console.error('Queue capture query failed:', queryError.message)
      setError('Your queue couldn’t be loaded. Please try again.')
    } else {
      setCaptures((data ?? []) as QueueCapture[])
    }
    setLoading(false)
  }, [demoMode])

  useEffect(() => {
    void loadQueue()
  }, [loadQueue])

  async function researchCapture(capture: QueueCapture) {
    if (capture.busy) return
    setError('')
    setCaptures((current) => current.map((item) => item.id === capture.id ? { ...item, busy: true } : item))
    if (demoMode) {
      try {
        const updated = researchDemoCapture(capture.id)
        if (!updated) throw new Error('Capture is no longer available in the local queue')
        setCaptures((current) => current.map((item) => item.id === capture.id ? updated : item))
      } catch (researchError) {
        console.error('Local demo capture research failed:', researchError)
        setError('This thought couldn’t be previewed. Please try again.')
        setCaptures((current) => current.map((item) => item.id === capture.id ? { ...item, busy: false } : item))
      }
      return
    }
    if (!supabase) return
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !session) {
      if (sessionError) console.error('Queue research session lookup failed:', sessionError.message)
      setError('Your sign-in session expired. Please sign in again.')
      setCaptures((current) => current.map((item) => item.id === capture.id ? { ...item, busy: false } : item))
      return
    }

    try {
      const response = await fetch('/api/research-capture', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ capture_id: capture.id }),
      })
      const data = await response.json() as { status?: string; capture?: Capture; error?: string; result?: Capture['result'] }
      if (!response.ok) {
        if (data.status === 'failed') {
          setCaptures((current) => current.map((item) => item.id === capture.id
            ? { ...item, status: 'failed', result: data.result ?? { error: data.error }, busy: false }
            : item))
        } else {
          setCaptures((current) => current.map((item) => item.id === capture.id ? { ...item, busy: false } : item))
        }
        setError(data.error ?? 'This thought couldn’t be researched. Please try again.')
        return
      }
      if (!data.capture) throw new Error('Research response did not include the updated capture')
      setCaptures((current) => current.map((item) => item.id === capture.id ? data.capture! : item))
    } catch (researchError) {
      console.error('Queue research request failed:', researchError)
      setError('This thought couldn’t be researched. Check your connection and try again.')
      setCaptures((current) => current.map((item) => item.id === capture.id ? { ...item, busy: false } : item))
    }
  }

  const waiting = captures.filter((capture) => capture.status === 'pending' || capture.status === 'failed')
  const completed = captures.filter((capture) => capture.status === 'researched')

  return (
    <main className="page-shell">
      <AppHeader backTo="/" backLabel="Capture" />
      <section className="queue-content">
        <h1>Queue</h1>
        <p className="intro-copy">Thoughts waiting for research. Work through them one at a time, whenever you like.</p>
        <p className="queue-note">Your digest arrives at the time set in Settings and includes thoughts saved before delivery. Research any queued thought here for an answer now.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        {loading ? <div className="list-loading"><span className="loading-dot" /></div> : waiting.length === 0 && completed.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><Sparkles size={21} /></div>
            <h2>Your queue is clear.</h2>
            <p>Save a thought and it’ll stay here until it’s researched.</p>
            <Link className="inline-link" to={demoMode ? '/app' : '/'}>Capture a thought <ArrowUpRight size={15} /></Link>
          </div>
        ) : (
          <>
            {waiting.length > 0 && <div className="queue-list">
              {waiting.map((capture) => (
                <article className="queue-card" key={capture.id}>
                  <div className="queue-card-main">
                    <span className={`queue-status ${capture.status}`}>{capture.status === 'failed' ? 'Needs another try' : 'Waiting'}</span>
                    <h2>{capture.text}</h2>
                    <time>{formatDate(capture.created_at)}</time>
                    {capture.status === 'failed' && capture.result?.error && <p className="queue-failure">{capture.result.error}</p>}
                  </div>
                  <button className="queue-research-button" type="button" onClick={() => void researchCapture(capture)} disabled={capture.busy}>
                    {capture.busy ? <LoaderCircle className="queue-spinner" size={16} /> : capture.status === 'failed' ? <CircleAlert size={16} /> : <Sparkles size={16} />}
                    {capture.busy ? 'Researching…' : capture.status === 'failed' ? 'Try again' : 'Research now'}
                  </button>
                </article>
              ))}
            </div>}
            {completed.length > 0 && <section className="queue-completed">
              <h2>Researched just now</h2>
              {completed.map((capture) => (
                <article className="queue-card queue-card-complete" key={capture.id}>
                  <div className="queue-card-main">
                    <span className="queue-status researched">Ready</span>
                    <h2>{capture.text}</h2>
                    {capture.result?.explanation && <p className="queue-result">{capture.result.explanation}</p>}
                    {capture.result?.resources?.map((resource, index) => (
                      <a className="queue-resource" href={resource.url} target="_blank" rel="noreferrer" key={`${resource.url}-${index}`}>
                        {resource.title} <ArrowUpRight size={14} />
                      </a>
                    ))}
                    {capture.result?.self_test && <p className="queue-self-test"><strong>Try this:</strong> {capture.result.self_test}</p>}
                  </div>
                </article>
              ))}
              <Link className="inline-link" to="/topics">Browse all researched topics <ArrowUpRight size={15} /></Link>
            </section>}
          </>
        )}
      </section>
    </main>
  )
}
