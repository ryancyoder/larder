/** All dates in this app are `yyyy-mm-dd` strings in the user's local timezone. */

export function todayISO(): string {
  return toISO(new Date())
}

export function toISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fromISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

export function addDays(iso: string, days: number): string {
  const d = fromISO(iso)
  d.setDate(d.getDate() + days)
  return toISO(d)
}

/** Positive = in the future. Negative = already passed. */
export function daysUntil(iso: string, from = todayISO()): number {
  const ms = fromISO(iso).getTime() - fromISO(from).getTime()
  return Math.round(ms / 86_400_000)
}

export function daysBetween(a: string, b: string): number {
  return Math.abs(Math.round((fromISO(b).getTime() - fromISO(a).getTime()) / 86_400_000))
}

/** Monday-based week start. */
export function startOfWeek(iso = todayISO()): string {
  const d = fromISO(iso)
  const dow = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - dow)
  return toISO(d)
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function weekdayShort(iso: string): string {
  return WEEKDAY[(fromISO(iso).getDay() + 6) % 7]
}

export function dayNum(iso: string): string {
  return String(fromISO(iso).getDate())
}

export function formatDate(iso: string): string {
  return fromISO(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function formatMonth(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short' })
}

/** "in 3 days" / "today" / "2 days ago" — the phrasing used on expiry chips. */
export function relativeDays(iso: string): string {
  const n = daysUntil(iso)
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n === -1) return 'yesterday'
  if (n > 0) return `in ${n} days`
  return `${-n} days ago`
}
