import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './supabase'

interface AuthContextValue {
  session: Session | null
  loading: boolean
  configured: boolean
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  loading: true,
  configured: isSupabaseConfigured,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
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
    <AuthContext.Provider value={{ session, loading, configured: isSupabaseConfigured }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
