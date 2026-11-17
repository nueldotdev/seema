import { useEffect, useState, type FormEvent } from 'react'
import { Check, LogOut } from 'lucide-react'
import AppHeader from '../components/AppHeader'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import type { UserSettings } from '../lib/types'
import { isLocalDemoMode } from '../lib/AuthContext'
import { getDemoSettings, saveDemoSettings, saveDemoSuggestion } from '../lib/demo'
import { applyTheme, getSavedTheme, type Theme } from '../lib/theme'

const DEFAULT_SETTINGS: UserSettings = {
  preset_context: 'Explain clearly and accessibly, using a warm and encouraging tone.',
  delivery_time: '07:00',
  timezone: 'Africa/Lagos',
  email_enabled: true,
}

export default function SettingsPage() {
  const { session } = useAuth()
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [theme, setTheme] = useState<Theme>(getSavedTheme)
  const [themeError, setThemeError] = useState('')
  const [suggestion, setSuggestion] = useState('')
  const [suggestionBusy, setSuggestionBusy] = useState(false)
  const [suggestionMessage, setSuggestionMessage] = useState('')
  const [suggestionError, setSuggestionError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      if (isLocalDemoMode) {
        try {
          setSettings(getDemoSettings())
        } catch (loadError) {
          setError('Local demo settings couldn’t be loaded.')
          console.error('Local demo settings load failed:', loadError)
        }
        setLoading(false)
        return
      }
      if (!supabase) return
      const { data, error: queryError } = await supabase.from('settings').select('preset_context,delivery_time,timezone,email_enabled').maybeSingle()
      if (!active) return
      if (queryError) {
        setError('Your settings couldn’t be loaded.')
        console.error('Settings query failed:', queryError.message)
      } else if (data) {
        setSettings({
          preset_context: data.preset_context,
          delivery_time: data.delivery_time.slice(0, 5),
          timezone: data.timezone,
          email_enabled: data.email_enabled,
        })
      } else {
        setSettings((current) => ({ ...current, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Lagos' }))
      }
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase && !isLocalDemoMode) return
    setSaving(true)
    setMessage('')
    setError('')
    if (isLocalDemoMode) {
      try {
        saveDemoSettings(settings)
        setMessage('Saved in this browser’s local demo.')
      } catch (saveError) {
        setError('Local demo settings couldn’t be saved.')
        console.error('Local demo settings save failed:', saveError)
      }
      setSaving(false)
      return
    }
    if (!supabase) return
    const { error: saveError } = await supabase.from('settings').upsert(settings)
    setSaving(false)
    if (saveError) {
      setError('Your changes couldn’t be saved. Please try again.')
      console.error('Settings save failed:', saveError.message)
    } else {
      setMessage('Saved. This will guide your next research run.')
    }
  }

  async function submitSuggestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = suggestion.trim()
    if (!text || (!supabase && !isLocalDemoMode)) return
    setSuggestionBusy(true)
    setSuggestionMessage('')
    setSuggestionError('')
    if (isLocalDemoMode) {
      try {
        saveDemoSuggestion(text)
        setSuggestion('')
        setSuggestionMessage('Thanks — your suggestion was saved in this local demo.')
      } catch (submitError) {
        console.error('Local demo suggestion save failed:', submitError)
        setSuggestionError('Your suggestion couldn’t be saved. Check browser storage and try again.')
      }
      setSuggestionBusy(false)
      return
    }
    if (!supabase) return
    const { error: submitError } = await supabase.from('user_suggestions').insert({ suggestion: text })
    setSuggestionBusy(false)
    if (submitError) {
      console.error('Suggestion submission failed:', submitError.message)
      setSuggestionError('Your suggestion couldn’t be sent. Please try again.')
      return
    }
    setSuggestion('')
    setSuggestionMessage('Thanks — your suggestion has been sent.')
  }

  async function signOut() {
    if (isLocalDemoMode) return
    if (!supabase) return
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) console.error('Sign-out failed:', signOutError.message)
  }

  function changeTheme(nextTheme: Theme) {
    setThemeError('')
    try {
      applyTheme(nextTheme)
      setTheme(nextTheme)
    } catch (themeChangeError) {
      setThemeError('Your appearance preference could not be saved. Please check browser storage.')
      console.error('Appearance preference update failed:', themeChangeError)
    }
  }

  return (
    <main className="page-shell">
      <AppHeader backTo="/" backLabel="Capture" />
      <section className="settings-content">
        <h1>Settings</h1>
        <p className="intro-copy">Set your learning preferences and delivery time.</p>
        <section className="appearance-setting" aria-labelledby="appearance-heading">
          <div>
            <h2 id="appearance-heading">Appearance</h2>
            <p className="field-hint">Choose the look that feels comfortable.</p>
          </div>
          <label className="theme-toggle">
            <span>Dark mode</span>
            <input
              type="checkbox"
              role="switch"
              checked={theme === 'dark'}
              onChange={(event) => changeTheme(event.target.checked ? 'dark' : 'light')}
              aria-label="Dark mode"
            />
          </label>
          {themeError && <p className="form-error theme-error" role="alert">{themeError}</p>}
        </section>
        {loading ? <div className="list-loading"><span className="loading-dot" /></div> : (
          <form className="settings-form" onSubmit={save}>
            <label htmlFor="context">Your learning context</label>
            <p className="field-hint">Level, tone, explanation style — whatever helps things click.</p>
            <textarea id="context" rows={5} maxLength={1500} value={settings.preset_context} onChange={(e) => setSettings({ ...settings, preset_context: e.target.value })} required />
            <div className="field-divider" />
            <label htmlFor="delivery">When should your digest arrive?</label>
            <p className="field-hint">We’ll send today’s saved thoughts at this time. Thoughts saved after delivery go in tomorrow’s digest.</p>
            <input id="delivery" type="time" value={settings.delivery_time} onChange={(e) => setSettings({ ...settings, delivery_time: e.target.value })} required />
            <div className="timezone-note">Your time zone <strong>{settings.timezone}</strong></div>
            <label className="email-preference">
              <span>
                <strong>Send me email digests and reminders</strong>
                <small>Turn this off to keep your research in the app without receiving email.</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={settings.email_enabled}
                onChange={(event) => setSettings({ ...settings, email_enabled: event.target.checked })}
                aria-label="Receive digest and reminder emails"
              />
            </label>
            {message && <p className="success-text" role="status"><Check size={16} /> {message}</p>}
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button settings-save" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save my preferences'}</button>
          </form>
        )}
        <section className="suggestion-section" aria-labelledby="suggestion-heading">
          <h2 id="suggestion-heading">Have an idea?</h2>
          <p className="field-hint">Tell us what would make Seema more useful for you.</p>
          <form className="suggestion-form" onSubmit={submitSuggestion}>
            <label className="visually-hidden" htmlFor="suggestion">Your suggestion</label>
            <textarea
              id="suggestion"
              rows={4}
              maxLength={3000}
              value={suggestion}
              onChange={(event) => setSuggestion(event.target.value)}
              placeholder="Share a feature idea or something we could improve…"
              required
            />
            {suggestionMessage && <p className="success-text" role="status"><Check size={16} /> {suggestionMessage}</p>}
            {suggestionError && <p className="form-error" role="alert">{suggestionError}</p>}
            <button className="primary-button settings-save" type="submit" disabled={suggestionBusy || !suggestion.trim()}>
              {suggestionBusy ? 'Sending…' : 'Send suggestion'}
            </button>
          </form>
        </section>
        <div className="account-row"><div><span className="field-hint">{isLocalDemoMode ? 'Demo mode' : 'Signed in as'}</span><p>{isLocalDemoMode ? 'No account is connected' : session?.user.email}</p></div>{!isLocalDemoMode && <button className="quiet-button" onClick={signOut}><LogOut size={15} /> Sign out</button>}</div>
      </section>
    </main>
  )
}
