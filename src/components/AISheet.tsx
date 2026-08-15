import { useState } from 'react'
import type { ItemView } from '../db/schema'
import { AIError, generateRecipes, toRecipe, type GeneratedRecipe } from '../lib/ai'
import { db, getSetting } from '../db/db'
import { formatAmount } from '../lib/units'
import { Field, Sheet } from './ui'
import { useToast } from '../app/toast'

export default function AISheet({
  stock, onClose, onOpenSettings,
}: {
  stock: ItemView[]
  onClose: () => void
  onOpenSettings: () => void
}) {
  const toast = useToast()
  const [note, setNote] = useState('')
  const [count, setCount] = useState(3)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<GeneratedRecipe[] | null>(null)
  const [saved, setSaved] = useState<Set<number>>(new Set())

  async function run() {
    setBusy(true)
    setError('')
    try {
      const key = await getSetting('anthropicKey')
      const recipes = await generateRecipes(key, stock, count, note)
      if (!recipes.length) setError('No recipes came back. Try again with a different note.')
      setResults(recipes)
    } catch (e) {
      setError(e instanceof AIError ? e.message : 'Something went wrong generating recipes.')
    } finally {
      setBusy(false)
    }
  }

  async function save(recipe: GeneratedRecipe, index: number) {
    await db.recipes.add(toRecipe(recipe) as never)
    setSaved((s) => new Set(s).add(index))
    toast(`${recipe.title} saved to your recipes`)
  }

  const usable = stock.filter((i) => i.available > 0)

  return (
    <Sheet
      title="Ask Claude what to cook"
      onClose={onClose}
      footer={
        results ? (
          <>
            <button className="btn ghost" onClick={() => setResults(null)}>Try again</button>
            <button className="btn primary" onClick={onClose}>Done</button>
          </>
        ) : (
          <>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={run} disabled={busy}>
              {busy ? 'Thinking…' : `Suggest ${count} recipes`}
            </button>
          </>
        )
      }
    >
      {!results && (
        <>
          <p style={{ fontSize: 13.5, color: 'var(--text-dim)' }}>
            Claude gets the full contents of your kitchen — {usable.length} items, with what's expiring
            and what's already reserved for other meals — and writes recipes around it.
          </p>

          <div className="card card-pad" style={{ maxHeight: 150, overflowY: 'auto' }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-mute)', marginBottom: 7 }}>
              What it will see
            </div>
            <div className="row" style={{ gap: 5, flexWrap: 'wrap' }}>
              {usable.slice(0, 40).map((i) => (
                <span className="chip" key={i.id}>{i.name} · {formatAmount(i.available, i.unit)}</span>
              ))}
            </div>
          </div>

          <Field label="Anything else? (optional)">
            <textarea
              rows={3}
              value={note}
              placeholder="Something quick, no dairy, feeding four"
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>

          <Field label="How many ideas">
            <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
              <option value={2}>2 recipes</option>
              <option value={3}>3 recipes</option>
              <option value={5}>5 recipes</option>
            </select>
          </Field>

          {error && (
            <div className="card card-pad" style={{ borderLeft: '3px solid var(--danger)' }}>
              <p style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</p>
              <button className="btn ghost sm" style={{ marginTop: 9 }} onClick={() => { onClose(); onOpenSettings() }}>
                Open Settings to add an API key
              </button>
            </div>
          )}
        </>
      )}

      {results?.map((r, i) => (
        <div className="card card-pad" key={i} style={{ animation: 'fadeUp .34s var(--ease) both', animationDelay: `${i * 60}ms` }}>
          <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 26 }}>{r.emoji}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, letterSpacing: '-0.02em' }}>{r.title}</div>
              <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 3 }}>{r.description}</p>
            </div>
          </div>

          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            <span className="chip">⏱️ {r.prepMin + r.cookMin} min</span>
            <span className="chip">🍽️ {r.servings}</span>
            {r.usesUpFirst?.length > 0 && (
              <span className="chip tone-urgent"><span className="dot" />uses up {r.usesUpFirst.join(', ')}</span>
            )}
          </div>

          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12.5, color: 'var(--text-mute)', fontWeight: 600 }}>
              {r.ingredients.length} ingredients · {r.steps.length} steps
            </summary>
            <ul className="stack" style={{ gap: 3, marginTop: 8, fontSize: 13 }}>
              {r.ingredients.map((ing, n) => (
                <li key={n} style={{ color: 'var(--text-dim)' }}>
                  {ing.qty != null && ing.unit ? `${formatAmount(ing.qty, ing.unit)} ` : ''}{ing.name}
                </li>
              ))}
            </ul>
            <ol className="stack" style={{ gap: 6, marginTop: 10, fontSize: 13, lineHeight: 1.5 }}>
              {r.steps.map((s, n) => <li key={n} style={{ color: 'var(--text-dim)' }}>{n + 1}. {s}</li>)}
            </ol>
          </details>

          <button
            className={`btn block sm ${saved.has(i) ? '' : 'primary'}`}
            style={{ marginTop: 11 }}
            disabled={saved.has(i)}
            onClick={() => save(r, i)}
          >
            {saved.has(i) ? '✓ Saved to your recipes' : 'Save this recipe'}
          </button>
        </div>
      ))}
    </Sheet>
  )
}
