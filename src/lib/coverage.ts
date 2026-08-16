import { db } from '../db/db'
import type { ItemView, MealDay, MealSlot } from '../db/schema'
import { addDays, formatDate, todayISO } from './dates'
import { adjustQuantity, consume } from './inventory'

/**
 * Meal coverage — "how many more dinners do I actually have?"
 *
 * One main dish feeds one day, so the answer is just the number of main-dish
 * units on hand. Laying that out on a calendar turns an abstract count into
 * something you can see running out, which is the whole point: an empty second
 * half of the month is a shopping trip you can see coming.
 */

/** A day on the calendar. Either something you ate, or something you might. */
export interface CoverageDay {
  date: string
  /** The item filling this day, if any. */
  item?: ItemView
  /** Free-text stand-in for the days you ate something that isn't in stock. */
  label?: string
  /**
   * `eaten` is history and renders solid. `forecast` is a guess and renders
   * translucent. `empty` means coverage ran out before this day.
   */
  state: 'eaten' | 'forecast' | 'empty'
  /** Set on eaten days so the day sheet can offer to undo. */
  record?: MealDay
}

/** Main dishes for one slot that still have stock free to plan against. */
export function mainsForSlot(stock: ItemView[], slot: MealSlot): ItemView[] {
  return stock
    .filter((i) => i.meal === slot && i.isMain && i.available >= 1)
    // Stable order so the forecast doesn't reshuffle between renders.
    .sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
}

/** Total days of coverage — whole units only, since half a main isn't a dinner. */
export function coverageDays(mains: ItemView[]): number {
  return mains.reduce((sum, i) => sum + Math.floor(i.available), 0)
}

/**
 * Spreads each item's units evenly across the window instead of stacking them.
 *
 * Four salmon and one lasagna shouldn't read salmon-salmon-salmon-salmon-lasagna
 * — the point of the forecast is variety, so the salmon gets spaced out and the
 * lasagna lands in a gap. The rule each day is "whatever has the most left,
 * except what we just had", which spaces the big stacks apart naturally and
 * only repeats when there's genuinely nothing else on the shelf.
 *
 * Deterministic: same stock in, same plan out. A forecast that reshuffled on
 * every render would be impossible to shop against.
 */
export function spreadMains(mains: ItemView[]): ItemView[] {
  const pool = mains
    .map((item) => ({ item, left: Math.floor(item.available) }))
    .filter((e) => e.left > 0)

  const order: ItemView[] = []
  let previous: number | undefined

  while (pool.some((e) => e.left > 0)) {
    const available = pool.filter((e) => e.left > 0)
    // Prefer anything other than yesterday's dish; take the repeat only when
    // it's the last thing left.
    const fresh = available.filter((e) => e.item.id !== previous)
    const pick = mostRemaining(fresh.length ? fresh : available)
    order.push(pick.item)
    pick.left--
    previous = pick.item.id
  }

  return order
}

/** Ties break on id, never on array position, so the result can't drift. */
function mostRemaining<T extends { left: number; item: ItemView }>(entries: T[]): T {
  return entries.reduce((best, e) => {
    if (e.left !== best.left) return e.left > best.left ? e : best
    return (e.item.id ?? 0) < (best.item.id ?? 0) ? e : best
  })
}

/**
 * The whole forecast, not clipped to a month — every day of coverage from today
 * until the stock runs out, in order.
 *
 * Kept separate from the month grid because the day sheet needs it too: to
 * offer Thursday's salmon as tonight's dinner it has to know the salmon was
 * pencilled in for Thursday in the first place.
 */
export function forecastPlan(
  stock: ItemView[],
  slot: MealSlot,
  records: MealDay[],
  today = todayISO(),
): Map<string, ItemView> {
  const eaten = new Map(records.filter((r) => r.slot === slot).map((r) => [r.date, r]))
  const mains = mainsForSlot(stock, slot)
  // The forecast runs from today, not from the first of the month — a month you
  // are halfway through has already spent half its coverage.
  const horizon = forecastDates(today, coverageDays(mains), eaten)

  const planned = new Map<string, ItemView>()
  spreadMains(mains).forEach((item, i) => {
    if (horizon[i]) planned.set(horizon[i], item)
  })
  return planned
}

/**
 * The day each item is currently pencilled in for. An item with several units
 * shows its *earliest* day, which is the one you'd be pulling forward.
 */
export function plannedDays(planned: Map<string, ItemView>): Map<number, string> {
  const first = new Map<number, string>()
  for (const date of [...planned.keys()].sort()) {
    const id = planned.get(date)!.id
    if (id != null && !first.has(id)) first.set(id, date)
  }
  return first
}

/**
 * Builds the calendar for one month.
 *
 * Days already recorded are fixed points — they happened. The forecast fills
 * forward from today into whatever is left, so eating tonight's dinner shortens
 * the tail by a day rather than shifting everything sideways.
 */
export function buildCoverage(
  monthDates: string[],
  stock: ItemView[],
  slot: MealSlot,
  records: MealDay[],
  today = todayISO(),
): CoverageDay[] {
  const eaten = new Map(records.filter((r) => r.slot === slot).map((r) => [r.date, r]))
  const byId = new Map(stock.map((i) => [i.id!, i]))
  const planned = forecastPlan(stock, slot, records, today)

  return monthDates.map((date) => {
    const record = eaten.get(date)
    if (record) {
      return {
        date,
        item: record.itemId != null ? byId.get(record.itemId) : undefined,
        label: record.label,
        state: 'eaten' as const,
        record,
      }
    }
    const item = planned.get(date)
    return item ? { date, item, state: 'forecast' as const } : { date, state: 'empty' as const }
  })
}

/**
 * The next `count` un-eaten days starting today. Days you've already logged are
 * skipped rather than double-booked — the stock behind them is long gone.
 */
function forecastDates(today: string, count: number, eaten: Map<string, MealDay>): string[] {
  const dates: string[] = []
  for (let offset = 0; dates.length < count; offset++) {
    // A stale database shouldn't be able to spin this forever.
    if (offset > count + 400) break
    const date = addDays(today, offset)
    if (!eaten.has(date)) dates.push(date)
  }
  return dates
}

/** Every date in a `yyyy-mm` month. */
export function monthDates(key: string): string[] {
  const [y, m] = key.split('-').map(Number)
  const total = new Date(y, m, 0).getDate()
  return Array.from({ length: total }, (_, i) => `${key}-${String(i + 1).padStart(2, '0')}`)
}

/** Leading blanks so the 1st lands under the right weekday (Monday-based). */
export function leadingBlanks(key: string): number {
  const [y, m] = key.split('-').map(Number)
  return (new Date(y, m - 1, 1).getDay() + 6) % 7
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function formatMonthLong(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/** Headline numbers above the grid. */
export interface CoverageSummary {
  days: number
  /** Last covered date, or null when there's nothing to plan with. */
  through: string | null
  distinct: number
}

export function summarise(stock: ItemView[], slot: MealSlot, records: MealDay[], today = todayISO()): CoverageSummary {
  const mains = mainsForSlot(stock, slot)
  const days = coverageDays(mains)
  const eaten = new Map(records.filter((r) => r.slot === slot).map((r) => [r.date, r]))
  const dates = forecastDates(today, days, eaten)
  return { days, through: dates.length ? dates[dates.length - 1] : null, distinct: mains.length }
}

// ---------------------------------------------------------------------------
// Mutations. Logging a meal moves stock, so these go through the ledger.
// ---------------------------------------------------------------------------

const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack',
}

/**
 * Records what actually filled a meal, and takes it out of the kitchen.
 *
 * One main dish is one unit — that's the assumption the whole calendar rests
 * on, and it's why mains are held to 'ea'. Re-logging a day replaces whatever
 * was there and hands the old item back first, so switching Tuesday from salmon
 * to chicken doesn't quietly eat both.
 */
export async function recordMeal(
  date: string,
  slot: MealSlot,
  item: ItemView | undefined,
  label?: string,
): Promise<void> {
  const existing = await db.days.where('[date+slot]').equals([date, slot]).first()
  if (existing) await undoRecord(existing)

  if (item?.id != null) {
    const fresh = await db.items.get(item.id)
    if (fresh) await consume(fresh, 1, `${SLOT_LABEL[slot]} on ${formatDate(date)}`)
  }

  await db.days.put({
    date,
    slot,
    itemId: item?.id,
    // Kept as text as well as an id: the item may be used up or deleted later,
    // and the calendar still has to be able to say what you ate.
    label: label?.trim() || item?.name || 'Something else',
    createdAt: todayISO(),
  })
}

/** Un-logs a day, putting the unit back on the shelf. */
export async function clearMeal(record: MealDay): Promise<void> {
  await undoRecord(record)
  if (record.id != null) await db.days.delete(record.id)
}

/**
 * Gives back the unit a record consumed.
 *
 * The ledger is append-only, so this can't erase the original consume event —
 * and shouldn't, because the correction is itself a fact. It writes an `adjust`
 * instead, which Insights deliberately ignores: un-logging a dinner you never
 * ate must not read as a grocery purchase.
 */
async function undoRecord(record: MealDay): Promise<void> {
  if (record.itemId == null) return
  const item = await db.items.get(record.itemId)
  // Deleted since it was logged — nothing to hand back to.
  if (!item) return
  await adjustQuantity(item, item.qty + 1, `Un-logged ${SLOT_LABEL[record.slot]} on ${formatDate(record.date)}`)
}
