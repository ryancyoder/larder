import { useState } from 'react'
import type { NutrientSet, Nutrition } from '../db/schema'

/**
 * What the label says, as far as Open Food Facts knows.
 *
 * Coverage is uneven and thinner on own-brand products than on big brands, so
 * every row here is conditional and a half-filled panel is normal. The one
 * thing it must never do is imply precision it hasn't got — hence the
 * provenance line at the bottom rather than a bare table of numbers.
 */

const ROWS: Array<{ key: keyof NutrientSet; label: string; unit: string; indent?: boolean }> = [
  { key: 'kcal', label: 'Energy', unit: 'kcal' },
  { key: 'fat', label: 'Fat', unit: 'g' },
  { key: 'satFat', label: 'of which saturates', unit: 'g', indent: true },
  { key: 'carbs', label: 'Carbohydrate', unit: 'g' },
  { key: 'sugars', label: 'of which sugars', unit: 'g', indent: true },
  { key: 'fibre', label: 'Fibre', unit: 'g' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'salt', label: 'Salt', unit: 'g' },
]

const NOVA_LABEL: Record<number, string> = {
  1: 'Unprocessed',
  2: 'Culinary ingredient',
  3: 'Processed',
  4: 'Ultra-processed',
}

function tidy(value: number, unit: string): string {
  if (unit === 'kcal') return String(Math.round(value))
  // Sub-gram amounts of salt are the ones where a decimal actually matters.
  const rounded = value < 1 ? Math.round(value * 100) / 100 : Math.round(value * 10) / 10
  return String(rounded)
}

export default function NutritionPanel({ nutrition }: { nutrition: Nutrition }) {
  const hasServing = Boolean(nutrition.perServing)
  const [basis, setBasis] = useState<'100' | 'serving'>(hasServing ? 'serving' : '100')
  const [showIngredients, setShowIngredients] = useState(false)

  const set = basis === 'serving' ? nutrition.perServing : nutrition.per100
  const rows = ROWS.filter((r) => set?.[r.key] != null)

  return (
    <div className="card card-pad stack nutri">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 14 }}>Nutrition</strong>
        <span className="spacer" />
        {nutrition.nutriScore && (
          <span className={`nutri-score s-${nutrition.nutriScore}`} title="Nutri-Score">
            {nutrition.nutriScore.toUpperCase()}
          </span>
        )}
        {nutrition.nova && (
          <span className="chip" title="NOVA processing group">
            {NOVA_LABEL[nutrition.nova] ?? `NOVA ${nutrition.nova}`}
          </span>
        )}
      </div>

      {hasServing && nutrition.per100 && (
        <div className="seg" role="group">
          <button aria-pressed={basis === 'serving'} onClick={() => setBasis('serving')}>
            Per serving
          </button>
          <button aria-pressed={basis === '100'} onClick={() => setBasis('100')}>
            Per 100g
          </button>
        </div>
      )}

      {rows.length > 0 ? (
        <>
          {basis === 'serving' && nutrition.servingSize && (
            <div style={{ fontSize: 12, color: 'var(--text-mute)' }}>
              Serving: {nutrition.servingSize}
            </div>
          )}
          <table className="nutri-table">
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row" className={r.indent ? 'indent' : undefined}>{r.label}</th>
                  {/* Grams sit tight against the number; kcal needs the space. */}
                  <td>{tidy(set![r.key]!, r.unit)}{r.unit === 'kcal' ? ' kcal' : r.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p style={{ fontSize: 12.5, color: 'var(--text-mute)' }}>
          No per-amount figures published for this product.
        </p>
      )}

      {nutrition.allergens && nutrition.allergens.length > 0 && (
        <div className="tag-row">
          {nutrition.allergens.map((a) => (
            <span key={a} className="chip tone-urgent"><span className="dot" />{a}</span>
          ))}
        </div>
      )}

      {nutrition.ingredients && (
        <>
          <button
            className="btn ghost sm"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => setShowIngredients((v) => !v)}
          >
            {showIngredients ? 'Hide ingredients' : 'Ingredients'}
          </button>
          {showIngredients && (
            <p style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
              {nutrition.ingredients}
            </p>
          )}
        </>
      )}

      {/* Provenance matters here more than anywhere else in the app: these are
          someone else's numbers about someone else's product. */}
      <p style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>
        From Open Food Facts, {nutrition.fetchedAt}. Crowd-sourced from product labels — check the
        pack if it matters medically.
      </p>
    </div>
  )
}
