import { useMemo, useState } from 'react'
import type { MealSlot, PlanEntry, Recipe } from '../db/schema'
import { useKitchen, usePlan, useRecipes } from '../app/data'
import { addDays, dayNum, formatDate, startOfWeek, todayISO, weekdayShort } from '../lib/dates'
import { SLOTS, cookPlan, planMeal, unplanMeal } from '../lib/plan'
import { bandOf, rankRecipes } from '../lib/suggest'
import { db } from '../db/db'
import { Empty, Section, Sheet } from '../components/ui'
import { useToast } from '../app/toast'
import { useLayout } from '../app/layout'

export default function Plan() {
  const stock = useKitchen()
  const plan = usePlan()
  const recipes = useRecipes()
  const toast = useToast()
  const { resolved } = useLayout()

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

  const entriesFor = (date: string) =>
    (byDay.get(date) ?? []).sort(
      (a, b) => SLOTS.findIndex((s) => s.key === a.slot) - SLOTS.findIndex((s) => s.key === b.slot),
    )

  if (!stock || !plan || !recipes) return null

  const weekEntries = days.flatMap((d) => byDay.get(d) ?? [])
  const heldCount = new Set(
    stock.filter((i) => i.holds.some((h) => h.planId != null)).map((i) => `${i.id}`),
  ).size

  return (
    <>
      <section className="section">
        <div className="row" style={{ gap: 5 }}>
          {/* Truncates rather than wrapping into the week buttons beside it. */}
          <span style={{
            flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text-mute)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {weekEntries.length
              ? `${weekEntries.length} planned · ${heldCount} reserved`
              : 'Nothing scheduled'}
          </span>
          <button className="btn ghost sm" onClick={() => setWeekOffset((w) => w - 1)} aria-label="Previous week">‹</button>
          <button className="btn ghost sm" onClick={() => setWeekOffset(0)}>
            {weekOffset === 0 ? 'This week' : formatDate(weekStart)}
          </button>
          <button className="btn ghost sm" onClick={() => setWeekOffset((w) => w + 1)} aria-label="Next week">›</button>
        </div>
      </section>

      {resolved === 'wide' ? (
        // Landscape: the week as an actual week, seven columns across.
        <section className="section">
          <div className="week-grid">
            {days.map((date) => (
              <DayColumn
                key={date}
                date={date}
                entries={entriesFor(date)}
                onAdd={() => setPicking({ date, slot: 'dinner' })}
                onOpen={setActing}
              />
            ))}
          </div>
        </section>
      ) : (
        days.map((date) => (
          <DayRow
            key={date}
            date={date}
            entries={entriesFor(date)}
            onAdd={() => setPicking({ date, slot: 'dinner' })}
            onOpen={setActing}
          />
        ))
      )}

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

interface DayProps {
  date: string
  entries: PlanEntry[]
  onAdd: () => void
  onOpen: (entry: PlanEntry) => void
}

/** One scheduled meal. Shared by both layouts so they can't drift apart. */
function MealCard({ entry, compact, onOpen }: { entry: PlanEntry; compact: boolean; onOpen: () => void }) {
  const slot = SLOTS.find((s) => s.key === entry.slot)!
  const done = entry.status !== 'planned'
  return (
    <button
      className="item"
      style={{
        padding: compact ? '9px 12px' : '9px 10px',
        opacity: done ? 0.55 : 1,
        alignItems: compact ? 'center' : 'flex-start',
        gap: compact ? 10 : 8,
      }}
      onClick={onOpen}
    >
      {/* The emoji costs ~23px of a ~118px column, and the slot name below
          already says which meal it is — so it only earns its place in the
          roomier compact layout. */}
      {compact && <span style={{ fontSize: 17, flex: 'none' }}>{slot.emoji}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="name"
          style={{
            fontSize: compact ? 14 : 12.5,
            lineHeight: 1.3,
            textDecoration: entry.status === 'skipped' ? 'line-through' : undefined,
            ...(compact ? {} : {
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical' as const,
              overflow: 'hidden',
            }),
          }}
          title={entry.title}
        >
          {entry.title}
        </div>
        <div className="meta">
          <span>{slot.label}</span>
          {compact && <><span>·</span><span>{entry.servings} servings</span></>}
          {entry.status === 'cooked' && <span className="chip tone-fresh"><span className="dot" />cooked</span>}
          {entry.status === 'skipped' && <span className="chip"><span className="dot" />skipped</span>}
        </div>
      </div>
    </button>
  )
}

/** Compact layout: a horizontal row per day, stacked down the screen. */
function DayRow({ date, entries, onAdd, onOpen }: DayProps) {
  const isToday = date === todayISO()
  return (
    <section className="section" style={{ marginTop: 18 }}>
      <div className="row" style={{ marginBottom: 9, gap: 10, alignItems: 'flex-start' }}>
        <DayBadge date={date} isToday={isToday} />
        <div className="stack" style={{ flex: 1, gap: 6 }}>
          {entries.length === 0 && (
            <button
              className="btn ghost sm"
              style={{ justifyContent: 'flex-start', width: '100%', borderStyle: 'dashed' }}
              onClick={onAdd}
            >
              + Plan something
            </button>
          )}
          {entries.map((entry) => (
            <MealCard key={entry.id} entry={entry} compact onOpen={() => onOpen(entry)} />
          ))}
          {entries.length > 0 && (
            <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={onAdd}>
              + Add another
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

/** Wide layout: a vertical column per day, seven side by side. */
function DayColumn({ date, entries, onAdd, onOpen }: DayProps) {
  const isToday = date === todayISO()
  return (
    <div
      className="card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 8,
        minHeight: 190,
        background: isToday ? 'var(--accent-soft)' : 'var(--bg-1)',
        borderColor: isToday ? 'var(--accent)' : 'var(--line)',
      }}
    >
      <div style={{ textAlign: 'center', paddingBottom: 2 }}>
        <div style={{
          fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
          color: isToday ? 'var(--accent)' : 'var(--text-mute)',
        }}>
          {weekdayShort(date)}
        </div>
        <div style={{
          fontSize: 19, fontWeight: 700, letterSpacing: '-0.03em',
          color: isToday ? 'var(--accent)' : 'var(--text)',
        }}>
          {dayNum(date)}
        </div>
      </div>

      {entries.map((entry) => (
        <MealCard key={entry.id} entry={entry} compact={false} onOpen={() => onOpen(entry)} />
      ))}

      {/* Sits at the bottom of every column so the + buttons line up across the week. */}
      <button
        className="btn ghost sm"
        style={{ marginTop: 'auto', width: '100%', borderStyle: 'dashed', padding: '7px 6px' }}
        onClick={onAdd}
        aria-label={`Plan a meal for ${date}`}
      >
        +
      </button>
    </div>
  )
}

function DayBadge({ date, isToday }: { date: string; isToday: boolean }) {
  return (
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
