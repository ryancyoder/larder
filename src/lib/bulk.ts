import { db } from '../db/db'
import type { Category, Item, MealSlot, StorageLocation } from '../db/schema'
import { deleteItem } from './inventory'
import { toEachPack } from './units'

/**
 * Bulk edits.
 *
 * Every field is optional and `undefined` means "leave alone" — the sheet has
 * to be able to change one attribute across fifty items without flattening the
 * other forty-nine differences between them.
 */
export interface BulkChanges {
  location?: StorageLocation
  category?: Category
  /** `'none'` clears the meal; `undefined` leaves it as-is. */
  meal?: MealSlot | 'none'
  isMain?: boolean
  isStaple?: boolean
}

const MAIN_ALLOWED: MealSlot[] = ['breakfast', 'lunch', 'dinner']

export function hasChanges(changes: BulkChanges): boolean {
  return Object.values(changes).some((v) => v !== undefined)
}

/**
 * Applies the changes in one transaction. Returns how many rows actually moved,
 * which is not always the count you selected — marking "main dish" skips
 * anything that ends up as a snack rather than silently writing a state the
 * single-item editor forbids.
 */
export async function applyBulk(ids: number[], changes: BulkChanges): Promise<number> {
  if (!ids.length || !hasChanges(changes)) return 0
  let touched = 0

  await db.transaction('rw', db.items, async () => {
    for (const id of ids) {
      const item = await db.items.get(id)
      if (!item) continue

      const patch: Partial<Item> = {}
      if (changes.location !== undefined) patch.location = changes.location
      if (changes.category !== undefined) patch.category = changes.category
      if (changes.isStaple !== undefined) {
        patch.isStaple = changes.isStaple
        // A staple with no par level would never trigger a restock.
        if (changes.isStaple && !item.parQty) patch.parQty = 1
        if (!changes.isStaple) patch.parQty = undefined
      }

      // Meal and main interact, so resolve them together against the row's
      // eventual state rather than its current one.
      const nextMeal = changes.meal === undefined
        ? item.meal
        : changes.meal === 'none' ? undefined : changes.meal
      if (changes.meal !== undefined) patch.meal = nextMeal

      const mainAllowed = nextMeal != null && MAIN_ALLOWED.includes(nextMeal)
      if (changes.isMain !== undefined) {
        patch.isMain = changes.isMain && mainAllowed ? true : undefined
      } else if (item.isMain && !mainAllowed) {
        // The meal moved to snack or none underneath an existing marker.
        patch.isMain = undefined
      }

      // Mains are counted in 'ea' so the calendar can spend one per day. Doing
      // this per row rather than in the sheet means a mixed selection — some in
      // lb, some in pkg — each converts on its own terms.
      if (patch.isMain === true && item.unit !== 'ea') {
        Object.assign(patch, toEachPack(item))
      }

      if (Object.keys(patch).length) {
        await db.items.update(id, patch)
        touched++
      }
    }
  })

  return touched
}

/**
 * Starring one item from a tile. Routes through the bulk path so "becoming a
 * staple" means exactly one thing — including the par level, without which a
 * staple would never trigger a restock.
 */
export async function setStaple(id: number, isStaple: boolean): Promise<void> {
  await applyBulk([id], { isStaple })
}

/**
 * Marking one item a main dish from a tile.
 *
 * Returns false when the rule won't allow it — a main belongs to breakfast,
 * lunch or dinner, and there's no sensible way to guess which from a tile — so
 * the caller can say why instead of the tap appearing to do nothing.
 */
export async function setMain(id: number, isMain: boolean): Promise<boolean> {
  const item = await db.items.get(id)
  if (!item) return false
  if (isMain && !(item.meal && MAIN_ALLOWED.includes(item.meal))) return false
  await applyBulk([id], { isMain })
  return true
}

/**
 * Setting an item's meal from a tile. Tapping the meal it already has clears
 * it, since one item has one meal and there's no other way to unset it here.
 *
 * Goes through the bulk path so the main-dish rule travels with it: moving
 * something to a snack drops the main marker rather than leaving a state the
 * editor forbids.
 */
export async function setMealSlot(id: number, slot: MealSlot): Promise<void> {
  const item = await db.items.get(id)
  if (!item) return
  await applyBulk([id], { meal: item.meal === slot ? 'none' : slot })
}

/** Deletes each row through the single-item path so holds and photos go too. */
export async function deleteMany(ids: number[]): Promise<number> {
  let removed = 0
  for (const id of ids) {
    await deleteItem(id)
    removed++
  }
  return removed
}
