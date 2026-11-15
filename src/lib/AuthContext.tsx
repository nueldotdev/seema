import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './supabase'

export const isLocalDemoMode = import.meta.env.DEV &&
  import.meta.env.VITE_LOCAL_DEMO === 'true' &&
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)

interface AuthContextValue {
  session: Session | null
  loading: boolean
  configured: boolean
  demoMode: boolean
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  loading: true,
  configured: isSupabaseConfigured || isLocalDemoMode,
  demoMode: isLocalDemoMode,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(!isLocalDemoMode)

  useEffect(() => {
    if (isLocalDemoMode) return
    if (!supabase) {
      setLoading(false)
      return
    }

    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.error('Unable to load session:', error.message)
      setSession(data.session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })

    return () => subscription.unsubscribe()
  }, [])

  return (
    <AuthContext.Provider value={{ session, loading, configured: isSupabaseConfigured || isLocalDemoMode, demoMode: isLocalDemoMode }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
