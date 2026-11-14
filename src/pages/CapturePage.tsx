import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowUp, Check, LogOut } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import { supabase } from '../lib/supabase'

export default function CapturePage() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [searchParams] = useSearchParams()
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const shared = searchParams.get('text') || searchParams.get('url') || searchParams.get('title')
    if (shared) setText(shared)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80)
    return () => window.clearTimeout(timer)
  }, [searchParams])

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
    setStatus('sent')
    setMessage('Saved for later.')
    window.setTimeout(() => setStatus('idle'), 2600)
    inputRef.current?.focus()
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
        <p className="intro-copy">Leave it here. We’ll look into it and bring you a clear explanation tomorrow.</p>
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
      </section>
      <footer className="capture-footer">
        <Link to="/digests">Your digests <span aria-hidden="true">↗</span></Link>
        <button className="quiet-button" onClick={signOut} aria-label="Sign out"><LogOut size={15} /> Sign out</button>
      </footer>
    </main>
  )
}
