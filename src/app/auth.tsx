import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from '../lib/supabase'

/**
 * Who is signed in, and which household they belong to.
 *
 * The household id is resolved once after sign-in and held here, because every
 * write needs it and re-querying the membership table on each one would be a
 * round trip to learn something that cannot change during a session.
 */

interface AuthState {
  session: Session | null
  householdId: number | null
  /** True until the stored session has been checked, so the app can wait. */
  loading: boolean
  /** Set when a signed-in account somehow has no household — recoverable, not fatal. */
  error: string | null
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  session: null,
  householdId: null,
  loading: true,
  error: null,
  signOut: async () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [householdId, setHouseholdId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!supabaseConfigured) {
      setError('This build has no Supabase connection configured.')
      setLoading(false)
      return
    }

    let cancelled = false

    // The stored session comes back asynchronously, so the app has to wait
    // rather than flash the sign-in screen at someone who is already signed in.
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSession(data.session)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!cancelled) setSession(next)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    if (!session) {
      setHouseholdId(null)
      // Only stop waiting once the session check has actually resolved.
      if (supabaseConfigured) setLoading(false)
      return
    }

    setLoading(true)
    supabase
      .from('household_members')
      .select('household_id')
      .limit(1)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) {
          setError(err.message)
        } else if (!data) {
          // The signup trigger should make this impossible. Saying so beats an
          // empty kitchen that looks like data loss.
          setError('This account has no household yet. Sign out and back in, or say so and it can be created.')
        } else {
          setError(null)
          setHouseholdId(data.household_id)
        }
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [session])

  const value: AuthState = {
    session,
    householdId,
    loading,
    error,
    async signOut() {
      await supabase.auth.signOut()
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
