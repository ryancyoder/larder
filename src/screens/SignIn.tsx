import { useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * The way into the kitchen.
 *
 * Google is the primary route: it is one tap, there is no password for the
 * household to forget or share, and it is the same sign-in the other family
 * apps use — the same Supabase project, so an account carries across.
 *
 * Email and password stay underneath rather than being removed. Accounts
 * created before Google existed still use them, and a fallback matters when
 * the whole household is locked out of the food otherwise. The magic link sits
 * below that again, for when the password is gone.
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

        // Supabase answers identically whether or not that address already has
        // an account — deliberately, so this form can't be used to discover who
        // is registered. There is no reliable signal to tell the two apart, so
        // the honest thing is to describe both outcomes rather than assert the
        // one that sends someone to wait for an email that will never arrive.
        setNote(
          `If ${email.trim()} is new, a confirmation link is on its way — click it, then sign in. ` +
          'If it already has a kitchen, nothing was sent: just sign in below.',
        )
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
      const message = err instanceof Error ? err.message : 'That did not work.'
      setError(
        /invalid login credentials/i.test(message)
          ? 'That email and password do not match. Try again, or use the link below to get in without one.'
          : message,
      )
    } finally {
      setBusy(false)
    }
  }

  async function google() {
    setBusy(true)
    setError('')
    setNote('')
    try {
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        // Back to this build, wherever it is served from — the app runs at a
        // repo subpath on Pages and at the root elsewhere.
        options: { redirectTo: window.location.origin + window.location.pathname },
      })
      if (err) throw err
      // The browser leaves for Google here; the auth listener picks it up on
      // the way back.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start Google sign-in.')
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
            ? 'One kitchen for the household, shared across every device.'
            : 'One account for the house. Everyone signs in with the same details.'}
        </p>

        <button className="btn primary block" disabled={busy} onClick={google}>
          {busy ? 'Working…' : 'Continue with Google'}
        </button>

        <div className="gate-or"><span>or use an email and password</span></div>

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

        <button className="btn block" disabled={!canSubmit || busy} onClick={submit}>
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
