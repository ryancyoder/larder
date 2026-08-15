import type { Category, LedgerEvent, Trip } from '../db/schema'
import { daysBetween, fromISO, monthKey, todayISO, toISO } from './dates'

/** Every number on the Insights screen comes from the append-only event ledger. */

export interface MonthBucket {
  key: string // yyyy-mm
  spend: number
  waste: number
  eaten: number
}

export function monthlySeries(events: LedgerEvent[], months = 6): MonthBucket[] {
  const now = fromISO(todayISO())
  const keys: string[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    keys.push(toISO(d).slice(0, 7))
  }
  const buckets = new Map(keys.map((k) => [k, { key: k, spend: 0, waste: 0, eaten: 0 }]))

  for (const e of events) {
    const bucket = buckets.get(monthKey(e.date))
    if (!bucket) continue
    if (e.type === 'purchase') bucket.spend += e.value
    else if (e.type === 'waste') bucket.waste += e.value
    else if (e.type === 'consume') bucket.eaten += e.value
  }
  return [...buckets.values()].map((b) => ({
    key: b.key,
    spend: round(b.spend),
    waste: round(b.waste),
    eaten: round(b.eaten),
  }))
}

export interface CategoryTotal {
  category: Category
  spend: number
  waste: number
}

export function categoryTotals(events: LedgerEvent[], months = 3): CategoryTotal[] {
  const cutoff = monthlySeries([], months)[0]?.key ?? ''
  const totals = new Map<Category, CategoryTotal>()
  for (const e of events) {
    if (monthKey(e.date) < cutoff) continue
    const row = totals.get(e.category) ?? { category: e.category, spend: 0, waste: 0 }
    if (e.type === 'purchase') row.spend += e.value
    if (e.type === 'waste') row.waste += e.value
    totals.set(e.category, row)
  }
  return [...totals.values()]
    .map((t) => ({ ...t, spend: round(t.spend), waste: round(t.waste) }))
    .filter((t) => t.spend > 0 || t.waste > 0)
    .sort((a, b) => b.spend - a.spend)
}

export interface WasteLeader {
  name: string
  category: Category
  value: number
  times: number
}

/** The repeat offenders — what to stop buying, or buy less of. */
export function wasteLeaders(events: LedgerEvent[], limit = 6): WasteLeader[] {
  const rows = new Map<string, WasteLeader>()
  for (const e of events) {
    if (e.type !== 'waste') continue
    const key = e.name.toLowerCase()
    const row = rows.get(key) ?? { name: e.name, category: e.category, value: 0, times: 0 }
    row.value += e.value
    row.times += 1
    rows.set(key, row)
  }
  return [...rows.values()]
    .map((r) => ({ ...r, value: round(r.value) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
}

export interface TripStats {
  count: number
  avgIntervalDays: number | null
  daysSinceLast: number | null
  avgBasket: number
  /** Gap in days before each trip, oldest first — the trend line. */
  intervals: Array<{ date: string; days: number }>
  recent: Trip[]
}

export function tripStats(trips: Trip[]): TripStats {
  const sorted = [...trips].sort((a, b) => a.date.localeCompare(b.date))
  const intervals: Array<{ date: string; days: number }> = []
  for (let i = 1; i < sorted.length; i++) {
    intervals.push({ date: sorted[i].date, days: daysBetween(sorted[i - 1].date, sorted[i].date) })
  }
  const avgInterval = intervals.length
    ? intervals.reduce((s, i) => s + i.days, 0) / intervals.length
    : null
  const spend = sorted.reduce((s, t) => s + t.total, 0)

  return {
    count: sorted.length,
    avgIntervalDays: avgInterval == null ? null : Math.round(avgInterval * 10) / 10,
    daysSinceLast: sorted.length ? daysBetween(sorted[sorted.length - 1].date, todayISO()) : null,
    avgBasket: sorted.length ? round(spend / sorted.length) : 0,
    intervals,
    recent: [...sorted].reverse().slice(0, 8),
  }
}

export interface Headline {
  spendThisMonth: number
  spendLastMonth: number
  wasteThisMonth: number
  wasteLastMonth: number
  /** Wasted dollars as a share of dollars bought — the number to drive down. */
  wasteRate: number
  savedVsLastMonth: number
}

export function headline(series: MonthBucket[]): Headline {
  const current = series[series.length - 1] ?? { spend: 0, waste: 0, eaten: 0, key: '' }
  const prior = series[series.length - 2] ?? { spend: 0, waste: 0, eaten: 0, key: '' }
  return {
    spendThisMonth: current.spend,
    spendLastMonth: prior.spend,
    wasteThisMonth: current.waste,
    wasteLastMonth: prior.waste,
    wasteRate: current.spend > 0 ? current.waste / current.spend : 0,
    savedVsLastMonth: round(prior.waste - current.waste),
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

export function money(n: number): string {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: n < 100 ? 2 : 0 })
}

export function percent(n: number): string {
  return `${Math.round(n * 100)}%`
}
