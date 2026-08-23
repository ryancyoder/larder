import type { InboxItem } from '../db/schema'

/**
 * Scanning a shop against the receipt that bought it.
 *
 * A big import parks a row per unrecognised product — 72 of them, on the shop
 * that prompted this — and naming them one dialog at a time is worse than the
 * problem it solves. But the receipt already knows *what* was bought and what
 * it cost; the only missing fact is which packet each line refers to. So the
 * session works the other way round from the rapid scanner: the list is fixed
 * and known in advance, and scanning fills in the one blank on each row.
 *
 * That difference is why this is not `rapid.ts`. There, a scan creates a line.
 * Here, a scan *claims* one, and the interesting logic is deciding which.
 */

/** A parked receipt line waiting for its barcode. */
export interface PendingRow {
  id: number
  productId?: number
  name: string
  sku?: string
  price?: number
  qty: number
}

export function pendingFromInbox(rows: InboxItem[], tripId: number): PendingRow[] {
  return rows
    .filter((r) => r.id != null && r.tripId === tripId && !r.barcode)
    .map((r) => ({
      id: r.id!,
      productId: r.productId,
      name: r.name?.trim() || 'Unnamed',
      sku: r.sku,
      price: r.price,
      qty: r.qty ?? 1,
    }))
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** Words too common in grocery names to carry any signal. */
const STOPWORDS = new Set([
  'the', 'and', 'of', 'with', 'in', 'a', 'oz', 'lb', 'ct', 'pk', 'g', 'ml',
  'organic', 'original', 'classic', 'fresh', 'natural', 'large', 'small',
])

/**
 * Words out of a grocery name, including the ones a till ran together.
 *
 * "FrzFineGreenBeans" is a single whitespace-delimited token and matches
 * nothing on its own, so case boundaries are treated as word breaks first —
 * that is the only reason the real ALDI lines are recognisable at all.
 */
function tokens(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
}

/**
 * How well an Open Food Facts name matches a till line, 0 to 1.
 *
 * Token overlap rather than edit distance: a till writes "FrzFineGreenBeans"
 * and the database says "Fine Green Beans, Frozen", which share every word and
 * almost no character positions. Scored against the shorter side so that a
 * long database name does not dilute a complete match.
 */
export function nameScore(a: string, b: string): number {
  const left = new Set(tokens(a))
  const right = new Set(tokens(b))
  if (!left.size || !right.size) return 0

  let shared = 0
  for (const word of left) {
    // Prefix matching catches the till's truncations: "lunchmeat" vs "lunch",
    // "chedd" vs "cheddar".
    for (const other of right) {
      if (word === other || word.startsWith(other) || other.startsWith(word)) {
        shared++
        break
      }
    }
  }
  return shared / Math.min(left.size, right.size)
}

/** Confident enough to reassign a scan away from the row you were pointed at. */
export const MATCH_THRESHOLD = 0.6

export interface MatchResult {
  row: PendingRow
  /** Why this row, so the screen can say whether it guessed or just obeyed. */
  reason: 'name' | 'current'
  score: number
}

/**
 * Which row a scan belongs to.
 *
 * Ordinarily it is simply the row the screen is pointing at — you are working
 * down a list holding the shopping. But when the lookup comes back with a real
 * name and that name clearly matches some *other* pending row, the packet in
 * your hand is more trustworthy than the cursor, so the scan moves. That is
 * what makes it safe to grab things out of the bag in whatever order they come.
 */
export function matchScan(
  pending: PendingRow[],
  current: PendingRow | undefined,
  lookupName: string | undefined,
): MatchResult | null {
  if (!pending.length) return null

  if (lookupName) {
    let best: MatchResult | null = null
    for (const row of pending) {
      const score = nameScore(lookupName, row.name)
      if (score >= MATCH_THRESHOLD && (!best || score > best.score)) {
        best = { row, reason: 'name', score }
      }
    }
    // Only override the cursor when the name points somewhere else. Landing on
    // the current row is the same outcome by a different route.
    if (best) return best
  }

  return current ? { row: current, reason: 'current', score: 0 } : null
}

/** The next row still waiting, after the one just dealt with. */
export function advance(pending: PendingRow[], doneIds: Set<number>, afterId?: number): PendingRow | undefined {
  const remaining = pending.filter((r) => !doneIds.has(r.id))
  if (!remaining.length) return undefined
  if (afterId == null) return remaining[0]

  const at = pending.findIndex((r) => r.id === afterId)
  // Continue past the row just handled, wrapping to pick up anything skipped.
  const after = pending.slice(at + 1).find((r) => !doneIds.has(r.id))
  return after ?? remaining[0]
}

export interface SessionProgress {
  done: number
  total: number
  spent: number
}

export function progress(pending: PendingRow[], doneIds: Set<number>): SessionProgress {
  const done = pending.filter((r) => doneIds.has(r.id))
  return {
    done: done.length,
    total: pending.length,
    spent: Math.round(done.reduce((n, r) => n + (r.price ?? 0), 0) * 100) / 100,
  }
}
