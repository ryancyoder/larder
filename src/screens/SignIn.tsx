import { useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * The way into the kitchen.
 *
 * Password is the primary route because a household signs in on several
 * devices and a password works without reaching for an inbox each time. The
 * magic link sits underneath as the way back in when the password is gone —
 * worth having, but not worth depending on, since Supabase rate-limits its
 * built-in email on the free tier and being locked out of your own food for an
 * hour is a poor failure mode.
 */

type Mode = 'signIn' | 'signUp'

export default function SignIn() {
  const [mode, setMode] = useState<Mode>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  const canSubmit = email.includes('@') && password.length >= 8

  async function submit() {
    setBusy(true)
    setError('')
    setNote('')
    try {
      if (mode === 'signUp') {
        const { error: err } = await supabase.auth.signUp({ email: email.trim(), password })
        if (err) throw err
        // Confirmation is on for this project, so there is no session yet.
        setNote(`Check ${email.trim()} for a confirmation link, then sign in.`)
        setMode('signIn')
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (err) throw err
        // The auth listener takes it from here.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  async function emailLink() {
    if (!email.includes('@')) {
      setError('Enter your email address first.')
      return
    }
    setBusy(true)
    setError('')
    setNote('')
    try {
      const { error: err } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin + window.location.pathname },
      })
      if (err) throw err
      setNote(`A sign-in link is on its way to ${email.trim()}. It opens the kitchen directly.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the link.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-brand"><span aria-hidden>🥬</span> Larder</div>
        <h1 className="gate-title">
          {mode === 'signIn' ? 'Sign in to your kitchen' : 'Create your kitchen'}
        </h1>
        <p className="gate-sub">
          {mode === 'signIn'
            ? 'One login for the household, shared across every device.'
            : 'One account for the house. Everyone signs in with the same details.'}
        </p>

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) submit() }}
          />
        </label>

        {error && <p className="gate-error">{error}</p>}
        {note && <p className="gate-note">{note}</p>}

        <button className="btn primary block" disabled={!canSubmit || busy} onClick={submit}>
          {busy ? 'Working…' : mode === 'signIn' ? 'Sign in' : 'Create the kitchen'}
        </button>

        <button className="btn ghost block" disabled={busy} onClick={emailLink}>
          Email me a link instead
        </button>

        <button
          className="gate-switch"
          onClick={() => { setMode(mode === 'signIn' ? 'signUp' : 'signIn'); setError(''); setNote('') }}
        >
          {mode === 'signIn' ? 'No kitchen yet? Create one' : 'Already have one? Sign in'}
        </button>

        <p className="gate-fine">
          Your kitchen lives in your own Supabase project. Losing a device no longer loses the data.
        </p>
      </div>
    </div>
  )
}
