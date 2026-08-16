import { useMemo, useState } from 'react'
import type { ItemView, MealDay, MealSlot } from '../db/schema'
import { useKitchen, useMealDays } from '../app/data'
import { categoryMeta } from '../lib/categories'
import { formatDate, todayISO, weekdayShort } from '../lib/dates'
import {
  buildCoverage, clearMeal, forecastPlan, formatMonthLong, leadingBlanks, mainsForSlot,
  monthDates, plannedDays, recordMeal, shiftMonth, summarise, type CoverageDay,
} from '../lib/coverage'
import { usePhoto } from '../app/usePhoto'
import { Empty, Field, Sheet } from '../components/ui'
import { useToast } from '../app/toast'

/** Snacks have no main dish, so they get no calendar. */
const TABS: Array<{ key: MealSlot; label: string; emoji: string }> = [
  { key: 'breakfast', label: 'Breakfast', emoji: '🌅' },
  { key: 'lunch', label: 'Lunch', emoji: '🥪' },
  { key: 'dinner', label: 'Dinner', emoji: '🌙' },
]

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * How many meals are actually on the shelf, laid out as days.
 *
 * The month grid answers a question a list can't: *when do I run out?* Solid
 * days already happened. Translucent days are the forecast — one main dish per
 * day, spread so the same thing doesn't land four nights running. Where the
 * colour stops is your next shopping trip.
 */
export default function Calendar() {
  const stock = useKitchen()
  const records = useMealDays()
  const toast = useToast()

  const today = todayISO()
  const [slot, setSlot] = useState<MealSlot>('dinner')
  const [month, setMonth] = useState(() => today.slice(0, 7))
  const [openDay, setOpenDay] = useState<CoverageDay | null>(null)

  const dates = useMemo(() => monthDates(month), [month])

  const days = useMemo(
    () => (stock && records ? buildCoverage(dates, stock, slot, records, today) : []),
    [dates, stock, slot, records, today],
  )

  const stats = useMemo(
    () => (stock && records ? summarise(stock, slot, records, today) : null),
    [stock, slot, records, today],
  )

  if (!stock || !records || !stats) return null

  const label = TABS.find((t) => t.key === slot)!.label
  const eatenThisMonth = days.filter((d) => d.state === 'eaten').length

  return (
    <div className="stack-lg">
      <div className="cal-tabs" role="tablist" aria-label="Meal">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={slot === t.key}
            className={slot === t.key ? 'on' : undefined}
            onClick={() => setSlot(t.key)}
          >
            <span aria-hidden>{t.emoji}</span> {t.label}
          </button>
        ))}
      </div>

      <div className="cover-bar">
        <div className="cover-stat">
          <strong>{stats.days}</strong>
          <span>{stats.days === 1 ? 'day' : 'days'} of {label.toLowerCase()}</span>
        </div>
        <div className="cover-stat">
          <strong>{stats.through ? formatDate(stats.through) : '—'}</strong>
          <span>covered through</span>
        </div>
        <div className="cover-stat">
          <strong>{stats.distinct}</strong>
          <span>{stats.distinct === 1 ? 'main dish' : 'different mains'}</span>
        </div>
      </div>

      <div className="cal-nav">
        <button className="btn ghost" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">‹</button>
        <h2>{formatMonthLong(month)}</h2>
        <button className="btn ghost" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">›</button>
        {month !== today.slice(0, 7) && (
          <button className="btn ghost sm" onClick={() => setMonth(today.slice(0, 7))}>Today</button>
        )}
      </div>

      {stats.days === 0 && eatenThisMonth === 0 ? (
        <Empty emoji="🍽️" title={`No ${label.toLowerCase()} mains in stock`}>
          Tag a few items as <strong>{label}</strong> and mark them <strong>main dish</strong> in the
          Kitchen, and they'll spread themselves across the month here.
        </Empty>
      ) : (
        <>
          <div className="cal-grid" role="grid">
            {WEEKDAYS.map((w) => <div key={w} className="cal-dow">{w}</div>)}
            {Array.from({ length: leadingBlanks(month) }, (_, i) => (
              <div key={`blank-${i}`} className="cal-cell blank" aria-hidden />
            ))}
            {days.map((day) => (
              <DayCell key={day.date} day={day} today={today} onOpen={() => setOpenDay(day)} />
            ))}
          </div>

          {/* State classes are `cal-` prefixed: a bare `.empty` would pick up the
              padding of the global Empty component and blow the swatch up. */}
          <div className="cal-key">
            <span><i className="swatch cal-eaten" /> Eaten</span>
            <span><i className="swatch cal-forecast" /> Forecast</span>
            <span><i className="swatch cal-empty" /> Nothing planned</span>
          </div>
        </>
      )}

      {openDay && (
        <DaySheet
          day={openDay}
          slot={slot}
          stock={stock}
          records={records}
          today={today}
          onClose={() => setOpenDay(null)}
          onDone={(message) => { toast(message); setOpenDay(null) }}
        />
      )}
    </div>
  )
}

function DayCell({ day, today, onOpen }: { day: CoverageDay; today: string; onOpen: () => void }) {
  const { url, cutout } = usePhoto(day.item?.photoId)
  const meta = day.item ? categoryMeta(day.item.category) : null
  const isToday = day.date === today
  const past = day.date < today

  return (
    <button
      className={`cal-cell cal-${day.state}${isToday ? ' today' : ''}${past ? ' past' : ''}`}
      onClick={onOpen}
      // The name is clipped to fit the square, so the full one lives here.
      title={day.label ?? day.item?.name}
      aria-label={`${formatDate(day.date)}${day.label || day.item ? `: ${day.label ?? day.item!.name}` : ', nothing planned'}`}
    >
      <span className="cal-num">{Number(day.date.slice(-2))}</span>
      {(day.item || day.label) && (
        <span className="cal-fill">
          {url ? (
            <img src={url} alt="" className={cutout ? 'cutout' : undefined} />
          ) : (
            <span className="cal-emoji" aria-hidden>{meta?.emoji ?? '🍽️'}</span>
          )}
          <span className="cal-name">{day.label ?? day.item!.name}</span>
        </span>
      )}
    </button>
  )
}

/**
 * What actually filled this day.
 *
 * The forecast is only a suggestion, so every other main in stock is offered
 * too — each labelled with the day it's currently pencilled in for, because
 * choosing one is really pulling it forward. Doing that consumes it, the tail
 * of the forecast re-spreads, and the day it vacated gets filled by whatever's
 * left.
 */
function DaySheet({
  day, slot, stock, records, today, onClose, onDone,
}: {
  day: CoverageDay
  slot: MealSlot
  stock: ItemView[]
  records: MealDay[]
  today: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [other, setOther] = useState('')
  const [busy, setBusy] = useState(false)

  const planned = useMemo(() => forecastPlan(stock, slot, records, today), [stock, slot, records, today])
  const pencilled = useMemo(() => plannedDays(planned), [planned])
  const mains = useMemo(() => mainsForSlot(stock, slot), [stock, slot])

  const suggestion = day.state === 'forecast' ? day.item : undefined
  const alternatives = mains.filter((m) => m.id !== suggestion?.id)
  const slotLabel = TABS.find((t) => t.key === slot)?.label ?? slot

  async function pick(item: ItemView | undefined, label?: string) {
    setBusy(true)
    try {
      await recordMeal(day.date, slot, item, label)
      onDone(`${label ?? item?.name} logged for ${formatDate(day.date)}`)
    } finally {
      setBusy(false)
    }
  }

  async function undo() {
    if (!day.record) return
    setBusy(true)
    try {
      await clearMeal(day.record)
      onDone(`${formatDate(day.date)} cleared`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      title={`${slotLabel} · ${formatDate(day.date)}`}
      onClose={onClose}
      footer={<button className="btn ghost" onClick={onClose}>Close</button>}
    >
      {day.state === 'eaten' ? (
        <>
          <div className="card card-pad stack">
            <div className="row" style={{ gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 22 }} aria-hidden>
                {day.item ? categoryMeta(day.item.category).emoji : '🍽️'}
              </span>
              <div>
                <strong>{day.label ?? day.item?.name}</strong>
                <div style={{ fontSize: 12.5, color: 'var(--text-mute)' }}>
                  Logged as {slotLabel.toLowerCase()} on {weekdayShort(day.date)}
                </div>
              </div>
            </div>
            <button className="btn ghost block" disabled={busy} onClick={undo}>
              Un-log this — put it back
            </button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-mute)' }}>
            Un-logging returns one unit to the kitchen and records the correction, so your spend
            and waste figures stay honest.
          </p>
        </>
      ) : (
        <>
          {suggestion && (
            <>
              <label className="lbl">Pencilled in</label>
              <button className="pick-row suggested" disabled={busy} onClick={() => pick(suggestion)}>
                <span aria-hidden>{categoryMeta(suggestion.category).emoji}</span>
                <span className="pick-name">
                  {suggestion.name}
                  <small>{suggestion.available} in stock</small>
                </span>
                <span className="pick-cta">Had this</span>
              </button>
            </>
          )}

          {alternatives.length > 0 && (
            <>
              <label className="lbl">{suggestion ? 'Or something else you have' : 'What did you have?'}</label>
              <div className="stack-sm">
                {alternatives.map((item) => {
                  const on = pencilled.get(item.id!)
                  return (
                    <button key={item.id} className="pick-row" disabled={busy} onClick={() => pick(item)}>
                      <span aria-hidden>{categoryMeta(item.category).emoji}</span>
                      <span className="pick-name">
                        {item.name}
                        <small>
                          {item.available} in stock
                          {on && on !== day.date && ` · pencilled in for ${formatDate(on)}`}
                        </small>
                      </span>
                      <span className="pick-cta">Pick</span>
                    </button>
                  )
                })}
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-mute)' }}>
                Choosing one of these pulls it forward — the day it was pencilled in for refills
                from whatever's left.
              </p>
            </>
          )}

          <Field label="Or something not in the kitchen">
            <input
              type="text"
              placeholder="Takeaway, dinner out, leftovers…"
              value={other}
              onChange={(e) => setOther(e.target.value)}
            />
          </Field>
          <button
            className="btn block"
            disabled={busy || !other.trim()}
            onClick={() => pick(undefined, other)}
          >
            Log “{other.trim() || '…'}” — no stock used
          </button>
        </>
      )}
    </Sheet>
  )
}
