import { useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import AppHeader from './AppHeader'
import { useAuth } from '../lib/AuthContext'
import { getDemoSettings } from '../lib/demo'
import { supabase } from '../lib/supabase'

export default function DigestEmailGate({ children }: { children: ReactNode }) {
  const { demoMode } = useAuth()
  const [emailEnabled, setEmailEnabled] = useState<boolean | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function checkPreference() {
      try {
        let enabled: boolean
        if (demoMode) {
          enabled = getDemoSettings().email_enabled
        } else {
          if (!supabase) throw new Error('Supabase is not configured')
          const { data, error: queryError } = await supabase.from('settings').select('email_enabled').maybeSingle()
          if (queryError) throw queryError
          enabled = data?.email_enabled ?? true
        }
        if (active) setEmailEnabled(enabled)
      } catch (checkError) {
        console.error('Digest email preference check failed:', checkError)
        if (active) setError('Your email preference couldn’t be checked.')
      }
    }
    void checkPreference()
    return () => { active = false }
  }, [demoMode])

  if (emailEnabled === false) return <Navigate to="/history" replace />
  if (error) {
    return (
      <main className="page-shell">
        <AppHeader backTo="/" backLabel="Capture" />
        <div className="reader-error">
          <h1>{error}</h1>
          <Link to="/settings" className="inline-link">Check your settings</Link>
        </div>
      </main>
    )
  }
  if (emailEnabled === null) return <main className="reader-loading"><span className="loading-dot" /></main>
  return children
}
