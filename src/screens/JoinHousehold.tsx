import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../app/auth'

/**
 * The way in for someone who is signed in but not yet part of a kitchen.
 *
 * New accounts no longer get a household created for them automatically — that
 * used to hand every new person their own empty kitchen instead of the family's,
 * which is the opposite of what a household app wants. They join an existing one
 * with a code instead.
 *
 * The code is shown in Settings on any device that is already in the household.
 * It is shared with the family's other apps, which all sit on the same Supabase
 * project: joining once is enough for all of them.
 */
export default function JoinHousehold({ onJoined }: { onJoined: () => void }) {
  const { session, signOut } = useAuth()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const email = session?.user?.email ?? ''

  async function join() {
    const trimmed = code.trim()
    if (!trimmed) {
      setError('Enter the code first.')
      return
    }
    setBusy(true)
    setError('')
    try {
      // A SECURITY DEFINER function: joining writes a membership row the caller
      // cannot write directly, and it only ever adds the caller.
      const { error: err } = await supabase.rpc('join_household', { code: trimmed })
      if (err) throw err
      onJoined()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'That did not work.'
      setError(
        /did not match/i.test(message)
          ? 'That code does not match a household. Check it and try again.'
          : message,
      )
      setBusy(false)
    }
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-brand"><span aria-hidden>🥬</span> Larder</div>
        <h1 className="gate-title">Join your kitchen</h1>
        <p className="gate-sub">
          You’re signed in{email ? ` as ${email}` : ''}, but you’re not part of a
          kitchen yet. Ask whoever set it up for the household code — it’s under
          Settings on their device.
        </p>

        <label className="field">
          <span>Household code</span>
          <input
            type="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter' && !busy) join() }}
            placeholder="e.g. 4K8S3E2P"
            style={{ textTransform: 'uppercase', letterSpacing: '2px', fontSize: 17 }}
          />
        </label>

        {error && <p className="gate-error">{error}</p>}

        <button className="btn primary block" disabled={busy || !code.trim()} onClick={join}>
          {busy ? 'Joining…' : 'Join'}
        </button>

        <button className="btn ghost block" disabled={busy} onClick={signOut}>
          Sign in as someone else
        </button>

        <p className="gate-fine">
          The same code works for the family’s other apps — you only need to join once.
        </p>
      </div>
    </div>
  )
}
