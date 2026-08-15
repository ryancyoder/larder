import { db } from '../db/db'
import type { Category, StorageKind, StoragePlace } from '../db/schema'
import { categoryMeta } from './categories'
import { addDays, todayISO } from './dates'

/**
 * Storage locations are user data, not a fixed enum — kitchens have garage
 * fridges, chest freezers and spice drawers. Each place declares a `kind`,
 * which is what shelf-life estimates actually key off, so a new location gets
 * sensible expiry dates without anyone filling in a table.
 */

export const KINDS: Array<{ key: StorageKind; label: string; hint: string }> = [
  { key: 'chilled', label: 'Chilled', hint: 'A fridge — days to a couple of weeks' },
  { key: 'frozen', label: 'Frozen', hint: 'A freezer — months' },
  { key: 'pantry', label: 'Cupboard', hint: 'Cool, dark and dry — months to years' },
  { key: 'counter', label: 'Room temperature', hint: 'Out on the side, in the light — shortest of all' },
]

export function kindLabel(kind: StorageKind): string {
  return KINDS.find((k) => k.key === kind)?.label ?? kind
}

export const DEFAULT_PLACES: Array<Omit<StoragePlace, 'id'>> = [
  { key: 'fridge', label: 'Fridge', emoji: '🧊', blurb: 'Eat me first', kind: 'chilled', order: 0 },
  { key: 'freezer', label: 'Freezer', emoji: '❄️', blurb: 'The long game', kind: 'frozen', order: 1 },
  { key: 'pantry', label: 'Pantry', emoji: '🗄️', blurb: 'Shelf-stable', kind: 'pantry', order: 2 },
  { key: 'counter', label: 'Counter', emoji: '🧺', blurb: 'Out in the open', kind: 'counter', order: 3 },
  { key: 'spice', label: 'Spices', emoji: '🧂', blurb: 'Flavour rack', kind: 'pantry', order: 4 },
]

/**
 * Fills the table on first run — and on upgrade from a version that had no
 * locations table. Idempotent, so it's safe to call on every boot.
 */
export async function ensurePlaces(): Promise<void> {
  const count = await db.places.count()
  if (count > 0) return
  await db.places.bulkAdd(DEFAULT_PLACES as StoragePlace[])
}

export function sortPlaces(places: StoragePlace[]): StoragePlace[] {
  return [...places].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
}

/** A location that was deleted still leaves its key on historical items. */
export function placeByKey(places: StoragePlace[], key: string): StoragePlace | undefined {
  return places.find((p) => p.key === key)
}

export function placeLabel(places: StoragePlace[], key: string): string {
  return placeByKey(places, key)?.label ?? key
}

export function placeEmoji(places: StoragePlace[], key: string): string {
  return placeByKey(places, key)?.emoji ?? '📦'
}

export function kindOf(places: StoragePlace[], key: string): StorageKind {
  return placeByKey(places, key)?.kind ?? 'pantry'
}

/** Shelf life in days for a category stored in a particular place. */
export function shelfLifeDays(places: StoragePlace[], category: Category, key: string): number {
  const kind = kindOf(places, key)
  return categoryMeta(category).shelfLife[kind] ?? 14
}

export function suggestExpiry(places: StoragePlace[], category: Category, key: string): string {
  return addDays(todayISO(), shelfLifeDays(places, category, key))
}

/** Where a category naturally goes: first place of the matching kind. */
export function suggestPlace(places: StoragePlace[], category: Category): string {
  const ordered = sortPlaces(places)
  const wanted = categoryMeta(category).homeKind
  return (ordered.find((p) => p.kind === wanted) ?? ordered[0])?.key ?? 'pantry'
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

function slugify(label: string): string {
  return label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'place'
}

async function uniqueKey(label: string): Promise<string> {
  const base = slugify(label)
  const taken = new Set((await db.places.toArray()).map((p) => p.key))
  if (!taken.has(base)) return base
  for (let n = 2; n < 500; n++) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
  }
  return `${base}-${Date.now()}`
}

export async function addPlace(input: { label: string; emoji: string; blurb: string; kind: StorageKind }) {
  const places = await db.places.toArray()
  const maxOrder = places.reduce((max, p) => Math.max(max, p.order), -1)
  await db.places.add({
    key: await uniqueKey(input.label),
    label: input.label.trim(),
    emoji: input.emoji.trim() || '📦',
    blurb: input.blurb.trim(),
    kind: input.kind,
    order: maxOrder + 1,
  })
}

/** The key is deliberately immutable — items reference it. Everything else is fair game. */
export async function updatePlace(id: number, patch: Partial<Omit<StoragePlace, 'id' | 'key'>>) {
  await db.places.update(id, patch)
}

export async function movePlace(id: number, direction: -1 | 1) {
  const ordered = sortPlaces(await db.places.toArray())
  const index = ordered.findIndex((p) => p.id === id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= ordered.length) return

  const swapped = [...ordered]
  ;[swapped[index], swapped[target]] = [swapped[target], swapped[index]]
  // Rewrite the whole sequence rather than swapping two values, so a list that
  // somehow got duplicate orders repairs itself.
  await db.transaction('rw', db.places, async () => {
    for (let i = 0; i < swapped.length; i++) {
      if (swapped[i].order !== i) await db.places.update(swapped[i].id!, { order: i })
    }
  })
}

export async function countItemsIn(key: string): Promise<number> {
  return db.items.where('location').equals(key).count()
}

/**
 * Deleting a place has to say where its contents go — silently orphaning items
 * into a location that no longer exists would hide them from the Kitchen.
 */
export async function deletePlace(id: number, moveItemsTo: string) {
  const place = await db.places.get(id)
  if (!place) return
  const remaining = await db.places.count()
  if (remaining <= 1) throw new Error('At least one storage location is needed.')

  await db.transaction('rw', db.items, db.places, async () => {
    await db.items.where('location').equals(place.key).modify({ location: moveItemsTo })
    await db.places.delete(id)
  })
}
