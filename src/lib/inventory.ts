import { db } from '../db/db'
import type { Item, ItemView, Reservation, StorageLocation } from '../db/schema'
import { daysUntil, todayISO } from './dates'
import { matchFood } from './foods'

export type Freshness = 'expired' | 'urgent' | 'soon' | 'fresh' | 'stable'

export interface FreshnessInfo {
  state: Freshness
  days: number | null
  /** 0–1 of shelf life remaining; drives the ring on each item card. */
  remaining: number
}

const URGENT_DAYS = 2
const SOON_DAYS = 5

export function freshnessOf(item: Item): FreshnessInfo {
  if (!item.expiresAt) return { state: 'stable', days: null, remaining: 1 }
  const days = daysUntil(item.expiresAt)
  const total = Math.max(1, daysUntil(item.expiresAt, item.purchasedAt))
  const remaining = Math.max(0, Math.min(1, days / total))
  if (days < 0) return { state: 'expired', days, remaining: 0 }
  if (days <= URGENT_DAYS) return { state: 'urgent', days, remaining }
  if (days <= SOON_DAYS) return { state: 'soon', days, remaining }
  return { state: 'fresh', days, remaining }
}

/** Dollars per single unit, so partial use and partial waste can be costed. */
export function unitPrice(item: Item): number {
  if (!item.price || !item.qtyInitial) return 0
  return item.price / item.qtyInitial
}

/**
 * Joins holds onto items so every screen can reason about `available` directly.
 *
 * @param catalogue What each product is called and pictured as, keyed by
 *   product id. Resolved here, once, rather than in each tile: a per-component
 *   lookup would mean one live subscription per row, all re-running on any
 *   write.
 */
export function buildViews(
  items: Item[],
  reservations: Reservation[],
  catalogue?: Map<number, { name?: string; photoId?: number; isStaple?: boolean; parQty?: number }>,
): ItemView[] {
  const byItem = new Map<number, Reservation[]>()
  for (const r of reservations) {
    const list = byItem.get(r.itemId)
    if (list) list.push(r)
    else byItem.set(r.itemId, [r])
  }
  return items.map((item) => {
    const holds = item.id ? byItem.get(item.id) ?? [] : []
    const reserved = holds.reduce((sum, h) => sum + h.qty, 0)
    // The catalogue wins on both. Its name and picture were chosen for the
    // product; the item's are whatever that one purchase happened to record.
    const master = item.productId != null ? catalogue?.get(item.productId) : undefined
    return {
      ...item,
      holds,
      reserved,
      available: Math.max(0, item.qty - reserved),
      displayName: master?.name?.trim() || item.name,
      displayPhotoId: master?.photoId ?? item.photoId,
      // Overridden rather than shadowed, unlike the name and the picture. Those
      // are display choices with a sensible per-item answer; this is a decision
      // about the product, and every consumer — the shopping list included —
      // should be following the catalogue's version of it.
      isStaple: master ? Boolean(master.isStaple) : item.isStaple,
      parQty: master ? master.parQty : item.parQty,
    }
  })
}

export function sortByUrgency(a: ItemView, b: ItemView): number {
  const fa = freshnessOf(a)
  const fb = freshnessOf(b)
  if (fa.days === null && fb.days === null) return a.name.localeCompare(b.name)
  if (fa.days === null) return 1
  if (fb.days === null) return -1
  return fa.days - fb.days
}

/** Anything expired or within the "eat me now" window, most urgent first. */
export function expiringSoon(views: ItemView[], withinDays = SOON_DAYS): ItemView[] {
  return views
    .filter((v) => {
      const f = freshnessOf(v)
      return f.days !== null && f.days <= withinDays
    })
    .sort(sortByUrgency)
}

// ---------------------------------------------------------------------------
// Mutations. Each one writes to the ledger so Insights stays truthful.
// ---------------------------------------------------------------------------

async function logAndApply(
  item: Item,
  qty: number,
  type: 'consume' | 'waste',
  reason?: string,
) {
  if (!item.id) return
  const used = Math.min(qty, item.qty)
  if (used <= 0) return
  const remaining = Math.round((item.qty - used) * 1000) / 1000

  await db.transaction('rw', db.items, db.events, db.reservations, async () => {
    await db.events.add({
      type,
      itemId: item.id,
      name: item.name,
      category: item.category,
      qty: used,
      unit: item.unit,
      value: Math.round(unitPrice(item) * used * 100) / 100,
      date: todayISO(),
      reason,
    })
    // Running out is not the same as no longer owning it. An empty jar stays
    // in the kitchen, greyed out, because "I need to rebuy this" is exactly
    // what an empty shelf is telling you — and because a thing that vanished
    // when it hit zero looked like the app refusing to accept zero.
    await db.items.update(item.id!, { qty: remaining })
    await trimHolds(item.id!, remaining)
  })
}

/**
 * Holds can't outlive the stock backing them. When quantity drops, shrink the
 * newest reservations first so the earliest claim keeps its share.
 */
async function trimHolds(itemId: number, remaining: number) {
  const holds = await db.reservations.where('itemId').equals(itemId).toArray()
  const total = holds.reduce((sum, h) => sum + h.qty, 0)
  if (total <= remaining) return

  let excess = total - remaining
  for (const hold of [...holds].reverse()) {
    if (excess <= 0) break
    if (hold.qty <= excess) {
      excess -= hold.qty
      await db.reservations.delete(hold.id!)
    } else {
      await db.reservations.update(hold.id!, { qty: Math.round((hold.qty - excess) * 1000) / 1000 })
      excess = 0
    }
  }
}

export async function consume(item: Item, qty: number, reason?: string) {
  await logAndApply(item, qty, 'consume', reason)
}

export async function waste(item: Item, qty: number, reason?: string) {
  await logAndApply(item, qty, 'waste', reason)
}

/**
 * Places a hold. Never reserves more than is actually free.
 *
 * `personKey` says who the portion is for. The UI requires one; it stays
 * optional here so a caller with no opinion — a meal plan holding for the
 * household — doesn't have to invent an answer.
 */
export async function reserve(
  item: ItemView, qty: number, label: string, planId?: number, personKey?: string,
) {
  if (!item.id) return
  const amount = Math.min(qty, item.available)
  if (amount <= 0) return
  await db.reservations.add({
    itemId: item.id,
    qty: Math.round(amount * 1000) / 1000,
    planId,
    personKey,
    label,
    createdAt: todayISO(),
  })
}

export async function releaseHold(reservationId: number) {
  await db.reservations.delete(reservationId)
}

export async function releaseHoldsForPlan(planId: number) {
  await db.reservations.where('planId').equals(planId).delete()
}

/** Turn a plan's holds into actual consumption — the "I cooked it" path. */
export async function consumeHoldsForPlan(planId: number, label: string) {
  const holds = await db.reservations.where('planId').equals(planId).toArray()
  for (const hold of holds) {
    const item = await db.items.get(hold.itemId)
    if (item) await logAndApply(item, hold.qty, 'consume', label)
  }
  await db.reservations.where('planId').equals(planId).delete()
}

/**
 * A manual correction — "actually there are three, not two".
 *
 * Recorded as an `adjust` ledger event rather than a consume or a waste,
 * because it is neither: nothing was eaten and nothing was binned, the count
 * was simply wrong. Insights ignores `adjust` for exactly that reason, so a
 * correction never distorts spend or waste.
 */
export async function adjustQuantity(item: Item, newQty: number, reason?: string) {
  if (!item.id) return
  const target = Math.max(0, Math.round(newQty * 1000) / 1000)
  const delta = Math.round((target - item.qty) * 1000) / 1000
  if (delta === 0) return

  await db.transaction('rw', db.items, db.events, db.reservations, async () => {
    await db.events.add({
      type: 'adjust',
      itemId: item.id,
      name: item.name,
      category: item.category,
      qty: delta,
      unit: item.unit,
      value: Math.round(unitPrice(item) * delta * 100) / 100,
      date: todayISO(),
      reason: reason ?? 'Count corrected by hand',
    })
    await db.items.update(item.id!, {
      qty: target,
      // Correcting upward past the original amount makes that the new baseline,
      // otherwise unit price and the depletion ring go wrong.
      qtyInitial: Math.max(item.qtyInitial, target),
    })
    await trimHolds(item.id!, target)
  })
}

export async function addItem(item: Omit<Item, 'id'>): Promise<number> {
  // Filed against the food library on the way in, so browsing by food works
  // without anyone being asked a question they didn't want at the till. An
  // explicit key always wins — a correction must not be undone by the guesser.
  const filed: Omit<Item, 'id'> = item.foodKey
    ? item
    : { ...item, foodKey: matchFood(item.name, item.brand) }

  const id = await db.items.add(filed as Item)
  if (item.price) {
    await db.events.add({
      type: 'purchase',
      itemId: id,
      name: item.name,
      category: item.category,
      qty: item.qtyInitial,
      unit: item.unit,
      value: item.price,
      date: item.purchasedAt,
    })
  }
  return id
}

/**
 * Restocking an existing staple tops up the same row rather than creating a
 * duplicate, so par levels and history stay attached to one record.
 */
export async function restock(itemId: number, qty: number, price: number | undefined, location: StorageLocation, expiresAt?: string) {
  const item = await db.items.get(itemId)
  if (!item) return
  const newQty = Math.round((Math.max(0, item.qty) + qty) * 1000) / 1000
  await db.items.update(itemId, {
    qty: newQty,
    qtyInitial: qty,
    price,
    location,
    purchasedAt: todayISO(),
    expiresAt,
    archived: false,
  })
  if (price) {
    await db.events.add({
      type: 'purchase', itemId, name: item.name, category: item.category,
      qty, unit: item.unit, value: price, date: todayISO(),
    })
  }
}

export async function deleteItem(itemId: number) {
  const item = await db.items.get(itemId)
  await db.transaction('rw', db.items, db.reservations, async () => {
    await db.reservations.where('itemId').equals(itemId).delete()
    await db.items.delete(itemId)
  })
  // Imported lazily: photos.ts imports from here, and a static cycle would
  // leave one of the two modules half-initialised.
  if (item?.photoId != null) {
    const { deletePhoto } = await import('./photos')
    await deletePhoto(item.photoId)
  }
}
