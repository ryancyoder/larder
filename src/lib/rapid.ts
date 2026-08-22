import { db } from '../db/db'
import type { Category, Nutrition } from '../db/schema'
import { guessCategory } from './categories'
import { addItem } from './inventory'
import { suggestExpiry, suggestPlace } from './locations'
import { titleCase } from './match'
import { todayISO } from './dates'

/**
 * Scanning a whole shop in one go.
 *
 * The unit of work is the pile on the counter, not the tin in your hand, so
 * nothing interrupts between items: scan, beep, scan, beep. Names arrive from
 * Open Food Facts in the background and land in the list when they land —
 * waiting for a lookup before accepting the next barcode would make the
 * scanning rate the network's decision.
 */

export type ScanStatus = 'looking' | 'found' | 'unknown'

export interface ScanLine {
  barcode: string
  qty: number
  status: ScanStatus
  name?: string
  brand?: string
  category?: Category
  nutrition?: Nutrition
}

/**
 * Folds a newly-read barcode into the running list.
 *
 * A repeat of something already scanned raises its quantity rather than adding
 * a second line — three identical yoghurts are one row of three, the way a till
 * would do it, and an accidental double-read is then visible and correctable
 * instead of hiding as a duplicate further down the list.
 */
export function addScan(lines: ScanLine[], barcode: string): ScanLine[] {
  const clean = barcode.replace(/\D/g, '')
  if (!clean) return lines
  const at = lines.findIndex((l) => l.barcode === clean)
  if (at >= 0) {
    const next = lines.slice()
    next[at] = { ...next[at], qty: next[at].qty + 1 }
    return next
  }
  return [{ barcode: clean, qty: 1, status: 'looking' }, ...lines]
}

/** Applies a finished lookup to whichever line is waiting for it. */
export function applyLookup(
  lines: ScanLine[],
  barcode: string,
  found: { name?: string; brand?: string; category?: Category; nutrition?: Nutrition } | null,
): ScanLine[] {
  return lines.map((l) =>
    l.barcode !== barcode
      ? l
      : found?.name
        ? { ...l, status: 'found', name: found.name, brand: found.brand, category: found.category, nutrition: found.nutrition }
        : { ...l, status: 'unknown' },
  )
}

export function setQty(lines: ScanLine[], barcode: string, qty: number): ScanLine[] {
  if (qty <= 0) return lines.filter((l) => l.barcode !== barcode)
  return lines.map((l) => (l.barcode === barcode ? { ...l, qty } : l))
}

export interface CommitResult {
  /** Named products written straight into the kitchen. */
  added: number
  /** Unknown barcodes parked in the inbox to be named. */
  parked: number
}

/**
 * Writes the scanned pile away.
 *
 * Anything Open Food Facts could name goes straight into the kitchen — there is
 * nothing left to ask. Anything it could not goes to the inbox instead, with
 * the digits kept, because an unnamed item in the kitchen is worse than one
 * sitting in Unpack waiting for a name.
 */
export async function commitScans(lines: ScanLine[]): Promise<CommitResult> {
  const places = await db.places.toArray()
  let added = 0
  let parked = 0

  for (const line of lines) {
    if (line.status === 'found' && line.name) {
      const name = titleCase(line.name.trim())
      const category = line.category ?? guessCategory(name)
      const location = suggestPlace(places, category)
      await addItem({
        name,
        category,
        location,
        qty: line.qty,
        qtyInitial: line.qty,
        unit: 'ea',
        purchasedAt: todayISO(),
        expiresAt: suggestExpiry(places, category, location),
        isStaple: false,
        archived: false,
        barcode: line.barcode,
        brand: line.brand,
        nutrition: line.nutrition,
      })
      added++
    } else {
      // One row per unit: the inbox names things one at a time, and two tins of
      // an unknown soup may not turn out to be the same soup.
      for (let i = 0; i < line.qty; i++) {
        await db.inbox.add({
          barcode: line.barcode,
          qty: 1,
          unit: 'ea',
          scanned: true,
          guessSource: 'barcode',
          guessNote: 'Scanned, but not in Open Food Facts — give it a name',
          createdAt: new Date().toISOString(),
        })
        parked++
      }
    }
  }

  return { added, parked }
}
