import { useMemo, useState } from 'react'
import type { ItemView, MealSlot, Recipe } from '../db/schema'
import { scoreRecipe, type LineStatus } from '../lib/suggest'
import { formatAmount } from '../lib/units'
import { SLOTS, cookNow, planMeal } from '../lib/plan'
import { addDays, formatDate, todayISO, weekdayShort } from '../lib/dates'
import { db } from '../db/db'
import { guessCategory } from '../lib/categories'
import { Field, Sheet } from './ui'
import { useToast } from '../app/toast'

const STATUS_META: Record<LineStatus, { chip: string; label: string }> = {
  have: { chip: 'tone-fresh', label: 'in stock' },
  reserved: { chip: 'tone-hold', label: 'held for another meal' },
  low: { chip: 'tone-soon', label: 'not enough' },
  missing: { chip: 'tone-expired', label: 'need to buy' },
  assumed: { chip: '', label: 'assumed' },
}

export default function RecipeSheet({
  recipe, stock, onClose, onEdit,
}: {
  recipe: Recipe
  stock: ItemView[]
  onClose: () => void
  onEdit?: () => void
}) {
  const toast = useToast()
  const [mode, setMode] = useState<'view' | 'schedule'>('view')
  const [date, setDate] = useState(todayISO())
  const [slot, setSlot] = useState<MealSlot>('dinner')
  const [servings, setServings] = useState(recipe.servings)

  const result = useMemo(() => scoreRecipe(recipe, stock), [recipe, stock])
  const shortfall = [...result.missing, ...result.blocked]

  async function addMissingToList() {
    if (!shortfall.length) return
    await db.shop.bulkAdd(
      shortfall.map((line) => ({
        name: line.ingredient.name,
        qty: line.ingredient.qty ?? 1,
        unit: line.ingredient.unit ?? 'ea',
        category: guessCategory(line.ingredient.name),
        checked: false,
        source: 'manual' as const,
        reason: `For ${recipe.title}`,
        itemId: line.item?.id,
      })),
    )
    toast(`${shortfall.length} items added to the shopping list`)
  }

  async function schedule() {
    await planMeal(recipe, date, slot, servings, stock)
    toast(`${recipe.title} planned for ${formatDate(date)} — ingredients reserved`)
    onClose()
  }

  async function cook() {
    const n = await cookNow(recipe, servings, stock)
    toast(n ? `Cooked. ${n} ingredients deducted from the kitchen.` : 'Marked as cooked')
    onClose()
  }

  return (
    <Sheet
      title={`${recipe.emoji} ${recipe.title}`}
      onClose={onClose}
      footer={
        mode === 'view' ? (
          <>
            <button className="btn ghost" onClick={() => setMode('schedule')}>Add to plan</button>
            <button className="btn primary" onClick={cook}>Cook it now</button>
          </>
        ) : (
          <>
            <button className="btn ghost" onClick={() => setMode('view')}>Back</button>
            <button className="btn primary" onClick={schedule}>Schedule & reserve</button>
          </>
        )
      }
    >
      {mode === 'schedule' ? (
        <>
          <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
            Scheduling puts a hold on everything this recipe needs that's already in the kitchen,
            so nothing else claims it first.
          </p>
          <Field label="Day">
            <div className="scroll-x" style={{ margin: 0, padding: 0 }}>
              {Array.from({ length: 14 }, (_, i) => addDays(todayISO(), i)).map((d) => (
                <button
                  key={d}
                  className="btn sm"
                  aria-pressed={date === d}
                  onClick={() => setDate(d)}
                  style={date === d
                    ? { background: 'var(--accent)', color: 'var(--accent-ink)', borderColor: 'transparent', flexDirection: 'column', minWidth: 54, gap: 0 }
                    : { flexDirection: 'column', minWidth: 54, gap: 0 }}
                >
                  <span style={{ fontSize: 10.5, opacity: 0.8 }}>{weekdayShort(d)}</span>
                  <span>{d.slice(8)}</span>
                </button>
              ))}
            </div>
          </Field>
          <Field label="Meal">
            <select value={slot} onChange={(e) => setSlot(e.target.value as MealSlot)}>
              {SLOTS.map((s) => <option key={s.key} value={s.key}>{s.emoji} {s.label}</option>)}
            </select>
          </Field>
          <Field label="Servings">
            <input type="number" min="1" value={servings} onChange={(e) => setServings(Number(e.target.value) || 1)} />
          </Field>
        </>
      ) : (
        <>
          {recipe.description && <p style={{ fontSize: 14, color: 'var(--text-dim)' }}>{recipe.description}</p>}

          <div className="row" style={{ gap: 7, flexWrap: 'wrap' }}>
            <span className="chip">🍽️ {recipe.servings} servings</span>
            <span className="chip">⏱️ {recipe.prepMin + recipe.cookMin} min</span>
            {recipe.timesCooked > 0 && <span className="chip">cooked {recipe.timesCooked}×</span>}
            {recipe.source === 'ai' && <span className="chip tone-hold"><span className="dot" />AI suggestion</span>}
            {recipe.tags.map((t) => <span className="chip" key={t}>{t}</span>)}
          </div>

          <div className="card card-pad">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 9 }}>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-mute)' }}>
                Ingredients
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: result.coverage === 1 ? 'var(--fresh-fresh)' : 'var(--text-dim)' }}>
                {Math.round(result.coverage * 100)}% in stock
              </span>
            </div>
            <div className="meter" style={{ marginBottom: 12 }}>
              <span style={{ width: `${Math.max(2, result.coverage * 100)}%` }} />
            </div>

            <ul className="stack" style={{ gap: 7 }}>
              {result.lines.map((line, i) => (
                <li key={i} className="row" style={{ fontSize: 13.5, alignItems: 'flex-start' }}>
                  <span style={{ flex: 1, color: line.status === 'missing' ? 'var(--text-mute)' : 'var(--text)' }}>
                    {line.ingredient.qty != null && line.ingredient.unit
                      ? `${formatAmount(line.ingredient.qty, line.ingredient.unit)} `
                      : ''}
                    {line.ingredient.name}
                    {line.ingredient.optional && <span style={{ color: 'var(--text-mute)' }}> (optional)</span>}
                  </span>
                  {line.status !== 'assumed' && (
                    <span className={`chip ${STATUS_META[line.status].chip}`}>
                      <span className="dot" />{STATUS_META[line.status].label}
                    </span>
                  )}
                </li>
              ))}
            </ul>

            {shortfall.length > 0 && (
              <button className="btn block sm" style={{ marginTop: 12 }} onClick={addMissingToList}>
                🛒 Add the {shortfall.length} missing to my list
              </button>
            )}
          </div>

          {result.rescues.length > 0 && (
            <div className="card card-pad" style={{ borderLeft: '3px solid var(--fresh-urgent)' }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--fresh-urgent)' }}>
                Uses up {result.rescues.map((r) => r.name).join(', ')}
              </div>
              <p style={{ fontSize: 12.5, color: 'var(--text-mute)', marginTop: 4 }}>
                Cooking this saves food that's about to go off.
              </p>
            </div>
          )}

          <div>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-mute)', marginBottom: 9 }}>
              Method
            </div>
            <ol className="stack" style={{ gap: 11 }}>
              {recipe.steps.map((step, i) => (
                <li key={i} className="row" style={{ alignItems: 'flex-start', gap: 11 }}>
                  <span style={{
                    flex: 'none', width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center',
                    background: 'var(--bg-3)', fontSize: 11.5, fontWeight: 700, marginTop: 1,
                  }}>{i + 1}</span>
                  <span style={{ fontSize: 14, lineHeight: 1.55 }}>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {onEdit && (
            <button className="btn ghost block" onClick={onEdit}>Edit this recipe</button>
          )}
        </>
      )}
    </Sheet>
  )
}
