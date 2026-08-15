import { useMemo, useState } from 'react'
import type { MealSlot, PlanEntry, Recipe } from '../db/schema'
import { useKitchen, usePlan, useRecipes } from '../app/data'
import { addDays, dayNum, formatDate, startOfWeek, todayISO, weekdayShort } from '../lib/dates'
import { SLOTS, cookPlan, planMeal, unplanMeal } from '../lib/plan'
import { bandOf, rankRecipes } from '../lib/suggest'
import { db } from '../db/db'
import { Empty, Section, Sheet } from '../components/ui'
import { useToast } from '../app/toast'

export default function Plan() {
  const stock = useKitchen()
  const plan = usePlan()
  const recipes = useRecipes()
  const toast = useToast()

  const [weekOffset, setWeekOffset] = useState(0)
  const [picking, setPicking] = useState<{ date: string; slot: MealSlot } | null>(null)
  const [acting, setActing] = useState<PlanEntry | null>(null)

  const weekStart = addDays(startOfWeek(todayISO()), weekOffset * 7)
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  const byDay = useMemo(() => {
    const map = new Map<string, PlanEntry[]>()
    for (const entry of plan ?? []) {
      const list = map.get(entry.date) ?? []
      list.push(entry)
      map.set(entry.date, list)
    }
    return map
  }, [plan])

  const recipeById = useMemo(
    () => new Map((recipes ?? []).filter((r) => r.id).map((r) => [r.id!, r])),
    [recipes],
  )

  if (!stock || !plan || !recipes) return null

  const weekEntries = days.flatMap((d) => byDay.get(d) ?? [])
  const heldCount = new Set(
    stock.filter((i) => i.holds.some((h) => h.planId != null)).map((i) => `${i.id}`),
  ).size

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Meal plan</h1>
          <div className="sub">
            {weekEntries.length
              ? `${weekEntries.length} meals planned · ${heldCount} items reserved`
              : 'Nothing scheduled this week'}
          </div>
        </div>
        <div className="row" style={{ gap: 5 }}>
          <button className="btn ghost sm" onClick={() => setWeekOffset((w) => w - 1)} aria-label="Previous week">‹</button>
          <button className="btn ghost sm" onClick={() => setWeekOffset(0)}>
            {weekOffset === 0 ? 'This week' : formatDate(weekStart)}
          </button>
          <button className="btn ghost sm" onClick={() => setWeekOffset((w) => w + 1)} aria-label="Next week">›</button>
        </div>
      </div>

      {days.map((date) => {
        const entries = (byDay.get(date) ?? []).sort(
          (a, b) => SLOTS.findIndex((s) => s.key === a.slot) - SLOTS.findIndex((s) => s.key === b.slot),
        )
        const isToday = date === todayISO()

        return (
          <section className="section" key={date} style={{ marginTop: 18 }}>
            <div className="row" style={{ marginBottom: 9, gap: 10 }}>
              <div
                style={{
                  flex: 'none', width: 44, textAlign: 'center', padding: '5px 0', borderRadius: 12,
                  background: isToday ? 'var(--accent)' : 'var(--bg-2)',
                  color: isToday ? 'var(--accent-ink)' : 'var(--text-dim)',
                  border: isToday ? 'none' : '1px solid var(--line)',
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.85 }}>
                  {weekdayShort(date)}
                </div>
                <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.03em' }}>{dayNum(date)}</div>
              </div>

              <div className="stack" style={{ flex: 1, gap: 6 }}>
                {entries.length === 0 && (
                  <button
                    className="btn ghost sm"
                    style={{ justifyContent: 'flex-start', width: '100%', borderStyle: 'dashed' }}
                    onClick={() => setPicking({ date, slot: 'dinner' })}
                  >
                    + Plan something
                  </button>
                )}

                {entries.map((entry) => {
                  const slot = SLOTS.find((s) => s.key === entry.slot)!
                  const done = entry.status !== 'planned'
                  return (
                    <button
                      key={entry.id}
                      className="item"
                      style={{ padding: '9px 12px', opacity: done ? 0.55 : 1 }}
                      onClick={() => setActing(entry)}
                    >
                      <span style={{ fontSize: 17, flex: 'none' }}>{slot.emoji}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="name" style={{ fontSize: 14, textDecoration: entry.status === 'skipped' ? 'line-through' : undefined }}>
                          {entry.title}
                        </div>
                        <div className="meta">
                          <span>{slot.label}</span>
                          <span>·</span>
                          <span>{entry.servings} servings</span>
                          {entry.status === 'cooked' && <span className="chip tone-fresh"><span className="dot" />cooked</span>}
                          {entry.status === 'skipped' && <span className="chip"><span className="dot" />skipped</span>}
                        </div>
                      </div>
                    </button>
                  )
                })}

                {entries.length > 0 && (
                  <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setPicking({ date, slot: 'dinner' })}>
                    + Add another
                  </button>
                )}
              </div>
            </div>
          </section>
        )
      })}

      {weekEntries.length === 0 && (
        <Section title="Why plan?">
          <Empty emoji="📅" title="Planning is what locks ingredients down">
            When you schedule a meal, Larder reserves what it needs from the kitchen so nothing else
            gets eaten first — and puts whatever's missing on the shopping list.
          </Empty>
        </Section>
      )}

      {picking && (
        <PickMeal
          date={picking.date}
          initialSlot={picking.slot}
          recipes={recipes}
          stock={stock}
          onClose={() => setPicking(null)}
        />
      )}

      {acting && (
        <Sheet title={acting.title} onClose={() => setActing(null)}>
          <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
            {formatDate(acting.date)} · {SLOTS.find((s) => s.key === acting.slot)?.label} · {acting.servings} servings
          </p>

          {acting.status === 'planned' ? (
            <div className="stack">
              <button
                className="btn primary block"
                onClick={async () => {
                  await cookPlan(acting, acting.recipeId ? recipeById.get(acting.recipeId) : undefined, stock)
                  toast('Cooked — ingredients deducted from the kitchen')
                  setActing(null)
                }}
              >
                ✅ We cooked this
              </button>
              <button
                className="btn block"
                onClick={async () => {
                  if (acting.id) {
                    await db.plan.update(acting.id, { status: 'skipped' })
                    await unplanHolds(acting)
                  }
                  toast('Skipped — reservations released')
                  setActing(null)
                }}
              >
                ⏭️ Skipped it (free up the ingredients)
              </button>
              <button
                className="btn danger block"
                onClick={async () => { await unplanMeal(acting); toast('Removed from the plan'); setActing(null) }}
              >
                Remove from plan
              </button>
            </div>
          ) : (
            <button
              className="btn danger block"
              onClick={async () => { await unplanMeal(acting); toast('Removed'); setActing(null) }}
            >
              Remove from plan
            </button>
          )}
        </Sheet>
      )}
    </>
  )
}

async function unplanHolds(entry: PlanEntry) {
  if (!entry.id) return
  await db.reservations.where('planId').equals(entry.id).delete()
}

function PickMeal({
  date, initialSlot, recipes, stock, onClose,
}: {
  date: string
  initialSlot: MealSlot
  recipes: Recipe[]
  stock: Parameters<typeof rankRecipes>[1]
  onClose: () => void
}) {
  const toast = useToast()
  const [slot, setSlot] = useState<MealSlot>(initialSlot)
  const ranked = useMemo(() => rankRecipes(recipes, stock), [recipes, stock])

  return (
    <Sheet title={`Plan ${formatDate(date)}`} onClose={onClose}>
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        {SLOTS.map((s) => (
          <button key={s.key} aria-pressed={slot === s.key} onClick={() => setSlot(s.key)}>
            {s.emoji} {s.label}
          </button>
        ))}
      </div>

      <p style={{ fontSize: 12.5, color: 'var(--text-mute)' }}>
        Sorted by what your kitchen can already cover. Picking one reserves its ingredients.
      </p>

      <div className="stack" style={{ gap: 7 }}>
        {ranked.map((s) => {
          const band = bandOf(s)
          return (
            <button
              key={s.recipe.id}
              className="item"
              style={{ padding: '10px 12px' }}
              onClick={async () => {
                await planMeal(s.recipe, date, slot, s.recipe.servings, stock)
                toast(`${s.recipe.title} planned — ingredients reserved`)
                onClose()
              }}
            >
              <span style={{ fontSize: 21, flex: 'none', width: 30, textAlign: 'center' }}>{s.recipe.emoji}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="name" style={{ fontSize: 14 }}>{s.recipe.title}</div>
                <div className="meta">
                  <span>{Math.round(s.coverage * 100)}% in stock</span>
                  {band === 'ready' && <span className="chip tone-fresh"><span className="dot" />ready</span>}
                  {s.missing.length > 0 && <span>· need {s.missing.length}</span>}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}
