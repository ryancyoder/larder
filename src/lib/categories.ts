import { db } from '../db/db'
import type { Category, StorageCategory } from '../db/schema'

export type CategoryMeta = StorageCategory

/**
 * Food categories are user data, not a fixed enum. The twelve below are only a
 * starting point — a household might want "Baby food", "Dog" or "Gluten free".
 *
 * Unlike locations, which are threaded through as a prop, categories are read
 * through a module-level registry so `categoryMeta()` can stay synchronous.
 * That's deliberate: it's called from `guessCategory` inside `openfoodfacts.ts`
 * and `shopping.ts`, which are plain async functions with no access to React
 * state. The registry is refreshed by `useCategories()` at the app root, so it
 * tracks the database for the lifetime of the session.
 */

/** Palette slots that exist as --cat-* custom properties in global.css. */
export const HUES = [
  'produce', 'bakery', 'protein', 'dairy', 'frozen', 'grain',
  'canned', 'condiment', 'spice', 'snack', 'beverage', 'other',
] as const

export const DEFAULT_CATEGORIES: Array<Omit<StorageCategory, 'id'>> = [
  { key: 'produce',   label: 'Produce',    emoji: '🥬', hue: 'produce',   aisle: 1, homeKind: 'chilled', shelfLife: { chilled: 7, counter: 4, frozen: 240, pantry: 10 } },
  { key: 'bakery',    label: 'Bakery',     emoji: '🥖', hue: 'bakery',    aisle: 2, homeKind: 'counter', shelfLife: { counter: 4, pantry: 5, chilled: 10, frozen: 90 } },
  { key: 'protein',   label: 'Meat & fish', emoji: '🥩', hue: 'protein',  aisle: 3, homeKind: 'chilled', shelfLife: { chilled: 3, frozen: 180, pantry: 730 } },
  { key: 'dairy',     label: 'Dairy & eggs', emoji: '🥛', hue: 'dairy',   aisle: 4, homeKind: 'chilled', shelfLife: { chilled: 14, frozen: 90, counter: 2 } },
  { key: 'frozen',    label: 'Frozen',     emoji: '🧊', hue: 'frozen',    aisle: 5, homeKind: 'frozen',  shelfLife: { frozen: 180, chilled: 3 } },
  { key: 'grain',     label: 'Grains & pasta', emoji: '🍚', hue: 'grain', aisle: 6, homeKind: 'pantry',  shelfLife: { pantry: 540, chilled: 7, frozen: 365 } },
  { key: 'canned',    label: 'Canned & jarred', emoji: '🥫', hue: 'canned', aisle: 7, homeKind: 'pantry', shelfLife: { pantry: 730, chilled: 5 } },
  { key: 'condiment', label: 'Condiments', emoji: '🫙', hue: 'condiment', aisle: 8, homeKind: 'chilled', shelfLife: { chilled: 180, pantry: 365 } },
  { key: 'spice',     label: 'Spices & oils', emoji: '🧂', hue: 'spice',  aisle: 9, homeKind: 'pantry',  shelfLife: { pantry: 730, counter: 365 } },
  { key: 'snack',     label: 'Snacks',     emoji: '🍿', hue: 'snack',     aisle: 10, homeKind: 'pantry', shelfLife: { pantry: 120, counter: 60 } },
  { key: 'beverage',  label: 'Drinks',     emoji: '🧃', hue: 'beverage',  aisle: 11, homeKind: 'chilled', shelfLife: { chilled: 30, pantry: 365 } },
  { key: 'other',     label: 'Other',      emoji: '📦', hue: 'other',     aisle: 12, homeKind: 'pantry',  shelfLife: { pantry: 180, chilled: 14, frozen: 180 } },
]

/** The fallback when a key has no category — a deleted one, or a bad import. */
const UNKNOWN: CategoryMeta = {
  key: 'other', label: 'Other', emoji: '📦', hue: 'other',
  aisle: 99, homeKind: 'pantry', shelfLife: { pantry: 180, chilled: 14, frozen: 180 },
}

let registry: CategoryMeta[] = DEFAULT_CATEGORIES as CategoryMeta[]
let byKey = new Map(registry.map((c) => [c.key, c]))

/** Called by `useCategories()` whenever the table changes. */
export function setCategoryRegistry(list: CategoryMeta[]): void {
  if (!list.length) return
  registry = sortCategories(list)
  byKey = new Map(registry.map((c) => [c.key, c]))
}

/** Every category, in aisle order. Safe to call from anywhere. */
export function allCategories(): CategoryMeta[] {
  return registry
}

export function categoryMeta(key: Category): CategoryMeta {
  return byKey.get(key) ?? UNKNOWN
}

export function sortCategories(list: CategoryMeta[]): CategoryMeta[] {
  return [...list].sort((a, b) => a.aisle - b.aisle || a.label.localeCompare(b.label))
}

/** Fills the table on first run, and on upgrade from a version without it. */
export async function ensureCategories(): Promise<void> {
  const count = await db.cats.count()
  if (count > 0) return
  await db.cats.bulkAdd(DEFAULT_CATEGORIES as StorageCategory[])
}

/**
 * Best guess at a category from a bare product name, so quick-add doesn't make
 * you pick from a dropdown every time. Longest keyword wins.
 *
 * The keywords are tied to the twelve default keys. A category you invent won't
 * be guessed at — it just has to be chosen once per item — and a default you
 * delete falls through to whatever is left.
 */
const KEYWORDS: Array<[string, string[]]> = [
  ['produce', ['lettuce', 'spinach', 'kale', 'tomato', 'onion', 'garlic', 'potato', 'carrot', 'pepper', 'cucumber', 'broccoli', 'cauliflower', 'zucchini', 'mushroom', 'apple', 'banana', 'orange', 'lemon', 'lime', 'berry', 'berries', 'grape', 'avocado', 'celery', 'ginger', 'herb', 'cilantro', 'parsley', 'basil', 'salad', 'greens', 'squash', 'cabbage', 'scallion', 'shallot', 'leek', 'corn', 'peach', 'pear', 'melon', 'sprouts']],
  ['protein', ['chicken', 'beef', 'pork', 'lamb', 'turkey', 'bacon', 'sausage', 'steak', 'mince', 'ground', 'salmon', 'tuna', 'shrimp', 'prawn', 'fish', 'cod', 'tofu', 'tempeh', 'ham', 'chorizo']],
  ['dairy', ['milk', 'cream', 'butter', 'cheese', 'yogurt', 'yoghurt', 'egg', 'eggs', 'mozzarella', 'cheddar', 'parmesan', 'feta', 'ricotta', 'kefir', 'sour cream']],
  ['grain', ['rice', 'pasta', 'noodle', 'spaghetti', 'penne', 'flour', 'oat', 'oats', 'quinoa', 'couscous', 'barley', 'cereal', 'tortilla', 'lentil', 'bulgur', 'polenta']],
  ['bakery', ['bread', 'bagel', 'bun', 'roll', 'baguette', 'croissant', 'muffin', 'pita', 'naan', 'sourdough', 'brioche']],
  ['frozen', ['frozen', 'ice cream', 'peas', 'fries', 'waffle']],
  ['canned', ['can', 'canned', 'tinned', 'beans', 'chickpea', 'crushed tomatoes', 'coconut milk', 'broth', 'stock', 'soup', 'tomato paste']],
  ['condiment', ['sauce', 'ketchup', 'mustard', 'mayo', 'mayonnaise', 'jam', 'honey', 'syrup', 'salsa', 'hummus', 'pesto', 'dressing', 'soy sauce', 'sriracha', 'vinegar', 'peanut butter', 'miso']],
  ['spice', ['salt', 'pepper', 'cumin', 'paprika', 'cinnamon', 'oregano', 'thyme', 'chili', 'chilli', 'curry', 'turmeric', 'oil', 'olive oil', 'spice', 'bay leaf', 'nutmeg', 'coriander seed', 'yeast', 'baking soda', 'baking powder', 'vanilla', 'sugar']],
  ['snack', ['chips', 'crisps', 'crackers', 'nuts', 'almond', 'cashew', 'popcorn', 'granola bar', 'chocolate', 'cookie', 'biscuit', 'pretzel']],
  ['beverage', ['juice', 'soda', 'coffee', 'tea', 'water', 'beer', 'wine', 'kombucha', 'seltzer', 'cola']],
]

export function guessCategory(name: string): Category {
  const n = name.toLowerCase()
  let best: { cat: string; len: number } | null = null
  for (const [cat, words] of KEYWORDS) {
    for (const w of words) {
      if (n.includes(w) && (!best || w.length > best.len)) best = { cat, len: w.length }
    }
  }
  // Never hand back a key that isn't a real category — the guess is only as
  // good as the keyword table, and the table doesn't know what's been deleted.
  return best && byKey.has(best.cat) ? best.cat : fallbackKey()
}

/** 'other' if it still exists, otherwise whatever's last on the shopping walk. */
export function fallbackKey(): Category {
  if (byKey.has('other')) return 'other'
  return registry[registry.length - 1]?.key ?? 'other'
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

function slugify(label: string): string {
  return label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'category'
}

async function uniqueKey(label: string): Promise<string> {
  const base = slugify(label)
  const taken = new Set((await db.cats.toArray()).map((c) => c.key))
  if (!taken.has(base)) return base
  for (let n = 2; n < 500; n++) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
  }
  return `${base}-${Date.now()}`
}

export async function addCategory(
  input: Omit<StorageCategory, 'id' | 'key' | 'aisle'> & { aisle?: number },
): Promise<void> {
  const cats = await db.cats.toArray()
  const maxAisle = cats.reduce((max, c) => Math.max(max, c.aisle), 0)
  await db.cats.add({
    ...input,
    key: await uniqueKey(input.label),
    label: input.label.trim(),
    emoji: input.emoji.trim() || '📦',
    aisle: input.aisle ?? maxAisle + 1,
  })
}

/** The key is deliberately immutable — items and history reference it. */
export async function updateCategory(
  id: number,
  patch: Partial<Omit<StorageCategory, 'id' | 'key'>>,
): Promise<void> {
  await db.cats.update(id, patch)
}

export async function moveCategory(id: number, direction: -1 | 1): Promise<void> {
  const ordered = sortCategories(await db.cats.toArray())
  const index = ordered.findIndex((c) => c.id === id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= ordered.length) return

  const swapped = [...ordered]
  ;[swapped[index], swapped[target]] = [swapped[target], swapped[index]]
  // Rewrite the whole sequence rather than swapping two values, so a list that
  // somehow got duplicate aisles repairs itself.
  await db.transaction('rw', db.cats, async () => {
    for (let i = 0; i < swapped.length; i++) {
      if (swapped[i].aisle !== i + 1) await db.cats.update(swapped[i].id!, { aisle: i + 1 })
    }
  })
}

export async function countItemsWithCategory(key: string): Promise<number> {
  return db.items.where('category').equals(key).count()
}

/**
 * Deleting a category says where its items go, for the same reason locations
 * do — an item pointing at a category that no longer exists would show up
 * under a fallback with no explanation.
 *
 * Ledger history is left alone on purpose: those rows record what a thing was
 * categorised as at the time, and rewriting them would falsify the past.
 * `categoryMeta` degrades to "Other" for them, which is the honest reading.
 */
export async function deleteCategory(id: number, moveItemsTo: string): Promise<void> {
  const cat = await db.cats.get(id)
  if (!cat) return
  const remaining = await db.cats.count()
  if (remaining <= 1) throw new Error('At least one category is needed.')

  await db.transaction('rw', db.items, db.shop, db.cats, async () => {
    await db.items.where('category').equals(cat.key).modify({ category: moveItemsTo })
    await db.shop.where('category').equals(cat.key).modify({ category: moveItemsTo })
    await db.cats.delete(id)
  })
}
