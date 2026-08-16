import { db } from '../db/db'
import type { Person } from '../db/schema'

/**
 * The household. Not accounts — nothing signs in and nothing is private; this
 * is only about saying who a portion is for, so "Littles" and "Family meal"
 * belong on the list just as much as a name does.
 */

/** The key plan-generated holds fall back to: a planned meal is everyone's. */
export const HOUSEHOLD_KEY = 'family-meal'

export const DEFAULT_PEOPLE: Array<Omit<Person, 'id'>> = [
  { key: 'ryan', name: 'Ryan', emoji: '🧔', hue: 'produce', order: 0 },
  { key: 'bethany', name: 'Bethany', emoji: '👩', hue: 'condiment', order: 1 },
  { key: 'selah', name: 'Selah', emoji: '👧', hue: 'beverage', order: 2 },
  { key: 'seth', name: 'Seth', emoji: '👦', hue: 'dairy', order: 3 },
  { key: 'littles', name: 'Littles', emoji: '🧒', hue: 'snack', order: 4 },
  { key: HOUSEHOLD_KEY, name: 'Family meal', emoji: '🍲', hue: 'grain', order: 5 },
]

/** Fills the table on first run, and on upgrade from a version without it. */
export async function ensurePeople(): Promise<void> {
  const count = await db.people.count()
  if (count > 0) return
  await db.people.bulkAdd(DEFAULT_PEOPLE as Person[])
}

export function sortPeople(people: Person[]): Person[] {
  return [...people].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}

export function personByKey(people: Person[], key: string | undefined): Person | undefined {
  return key == null ? undefined : people.find((p) => p.key === key)
}

/**
 * What to show for a hold. A person removed from the household still leaves
 * their key on old reservations, so the raw key is a better answer than
 * nothing — it's still recognisable as a name.
 */
export function personLabel(people: Person[], key: string | undefined): string {
  if (!key) return 'Unassigned'
  return personByKey(people, key)?.name ?? key.replace(/-/g, ' ')
}

/** The household entry, or the last one standing if it's been renamed away. */
export function householdKey(people: Person[]): string {
  return personByKey(people, HOUSEHOLD_KEY)?.key ?? sortPeople(people)[people.length - 1]?.key ?? HOUSEHOLD_KEY
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'person'
}

async function uniqueKey(name: string): Promise<string> {
  const base = slugify(name)
  const taken = new Set((await db.people.toArray()).map((p) => p.key))
  if (!taken.has(base)) return base
  for (let n = 2; n < 500; n++) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
  }
  return `${base}-${Date.now()}`
}

export async function addPerson(input: { name: string; emoji: string; hue: string }): Promise<void> {
  const people = await db.people.toArray()
  const maxOrder = people.reduce((max, p) => Math.max(max, p.order), -1)
  await db.people.add({
    key: await uniqueKey(input.name),
    name: input.name.trim(),
    emoji: input.emoji.trim() || '🙂',
    hue: input.hue,
    order: maxOrder + 1,
  })
}

/** The key is deliberately immutable — reservations reference it. */
export async function updatePerson(id: number, patch: Partial<Omit<Person, 'id' | 'key'>>): Promise<void> {
  await db.people.update(id, patch)
}

export async function movePerson(id: number, direction: -1 | 1): Promise<void> {
  const ordered = sortPeople(await db.people.toArray())
  const index = ordered.findIndex((p) => p.id === id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= ordered.length) return

  const swapped = [...ordered]
  ;[swapped[index], swapped[target]] = [swapped[target], swapped[index]]
  await db.transaction('rw', db.people, async () => {
    for (let i = 0; i < swapped.length; i++) {
      if (swapped[i].order !== i) await db.people.update(swapped[i].id!, { order: i })
    }
  })
}

export async function countHoldsFor(key: string): Promise<number> {
  return db.reservations.where('personKey').equals(key).count()
}

/**
 * Removing someone leaves their existing holds alone rather than reassigning
 * them. A hold is a record of a decision that was made, and quietly moving
 * Seth's dinner to someone else would be a worse outcome than a name that no
 * longer appears in the household list.
 */
export async function deletePerson(id: number): Promise<void> {
  const remaining = await db.people.count()
  if (remaining <= 1) throw new Error('At least one person is needed.')
  await db.people.delete(id)
}
