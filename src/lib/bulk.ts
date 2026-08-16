import { db } from '../db/db'
import type { Category, Item, MealSlot, StorageLocation } from '../db/schema'
import { deleteItem } from './inventory'

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

      if (Object.keys(patch).length) {
        await db.items.update(id, patch)
        touched++
      }
    }
  })

  return touched
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
