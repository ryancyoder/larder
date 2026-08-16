import { ensurePlaces } from '../lib/locations'
import { ensureCategories } from '../lib/categories'
import { ensurePeople } from '../lib/people'

/**
 * Fills a brand-new household with the things it cannot work without.
 *
 * No demo food. The reference data — where things live, what kinds of food
 * there are, who is in the house — would otherwise have to be typed in before
 * the app could be used at all, so it is seeded. Actual groceries are yours to
 * add, and a pantry full of invented items would only be something to delete.
 *
 * Each part checks for itself, so this is safe to call on every launch and a
 * half-finished first run completes on the next one rather than doubling up.
 */
export async function seedIfEmpty(): Promise<void> {
  await ensurePlaces()
  await ensureCategories()
  await ensurePeople()
}

/**
 * Kept for the Settings button that used to restore the demo kitchen. There is
 * no demo any more, so it just makes sure the reference data is present.
 */
export async function runSeed(): Promise<void> {
  await seedIfEmpty()
}
