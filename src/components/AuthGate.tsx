import { useState, type FormEvent } from 'react'
import { Mail } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function AuthGate() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function sendLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError('')
    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    if (authError) setError(authError.message)
    else setSent(true)
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <a className="wordmark" href="/">seema<span>.</span></a>
        <div className="auth-icon"><Mail size={21} strokeWidth={1.7} /></div>
        {sent ? (
          <>
            <h1>Check your inbox.</h1>
            <p className="muted">Your sign-in link is on its way to <strong>{email}</strong>.</p>
            <button className="text-button" onClick={() => setSent(false)}>Use a different email</button>
          </>
        ) : (
          <>
            <h1>A little more room to think.</h1>
            <p className="muted">Sign in with a link sent to your email. No password to remember.</p>
            <form onSubmit={sendLink} className="auth-form">
              <label htmlFor="email">Email address</label>
              <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="primary-button full-width" type="submit" disabled={busy}>
                {busy ? 'Sending link…' : 'Email me a sign-in link'}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  )
}
