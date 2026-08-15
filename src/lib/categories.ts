import type { Category, StorageLocation, Unit } from '../db/schema'

export interface CategoryMeta {
  key: Category
  label: string
  emoji: string
  /** CSS custom-property suffix — resolves to --cat-<key> in global.css. */
  hue: string
  /** Rough shelf life in days, per location. Used to pre-fill the expiry date. */
  shelfLife: Partial<Record<StorageLocation, number>>
  defaultUnit: Unit
  /** Sort order on the shopping list — roughly a supermarket walk. */
  aisle: number
}

export const CATEGORIES: CategoryMeta[] = [
  { key: 'produce',   label: 'Produce',    emoji: '🥬', hue: 'produce',   aisle: 1, defaultUnit: 'ea',  shelfLife: { fridge: 7, counter: 4, freezer: 240, pantry: 10 } },
  { key: 'bakery',    label: 'Bakery',     emoji: '🥖', hue: 'bakery',    aisle: 2, defaultUnit: 'loaf', shelfLife: { counter: 4, pantry: 5, fridge: 10, freezer: 90 } },
  { key: 'protein',   label: 'Meat & fish', emoji: '🥩', hue: 'protein',  aisle: 3, defaultUnit: 'lb',  shelfLife: { fridge: 3, freezer: 180, pantry: 730 } },
  { key: 'dairy',     label: 'Dairy & eggs', emoji: '🥛', hue: 'dairy',   aisle: 4, defaultUnit: 'ea',  shelfLife: { fridge: 14, freezer: 90, counter: 2 } },
  { key: 'frozen',    label: 'Frozen',     emoji: '🧊', hue: 'frozen',    aisle: 5, defaultUnit: 'pkg', shelfLife: { freezer: 180, fridge: 3 } },
  { key: 'grain',     label: 'Grains & pasta', emoji: '🍚', hue: 'grain', aisle: 6, defaultUnit: 'lb',  shelfLife: { pantry: 540, fridge: 7, freezer: 365 } },
  { key: 'canned',    label: 'Canned & jarred', emoji: '🥫', hue: 'canned', aisle: 7, defaultUnit: 'can', shelfLife: { pantry: 730, fridge: 5 } },
  { key: 'condiment', label: 'Condiments', emoji: '🫙', hue: 'condiment', aisle: 8, defaultUnit: 'ea',  shelfLife: { fridge: 180, pantry: 365 } },
  { key: 'spice',     label: 'Spices & oils', emoji: '🧂', hue: 'spice',  aisle: 9, defaultUnit: 'ea',  shelfLife: { spice: 730, pantry: 730 } },
  { key: 'snack',     label: 'Snacks',     emoji: '🍿', hue: 'snack',     aisle: 10, defaultUnit: 'pkg', shelfLife: { pantry: 120, counter: 60 } },
  { key: 'beverage',  label: 'Drinks',     emoji: '🧃', hue: 'beverage',  aisle: 11, defaultUnit: 'ea',  shelfLife: { fridge: 30, pantry: 365 } },
  { key: 'other',     label: 'Other',      emoji: '📦', hue: 'other',     aisle: 12, defaultUnit: 'ea',  shelfLife: { pantry: 180, fridge: 14, freezer: 180 } },
]

const BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]))

export function categoryMeta(key: Category): CategoryMeta {
  return BY_KEY.get(key) ?? CATEGORIES[CATEGORIES.length - 1]
}

export interface LocationMeta {
  key: StorageLocation
  label: string
  emoji: string
  blurb: string
}

export const LOCATIONS: LocationMeta[] = [
  { key: 'fridge',  label: 'Fridge',  emoji: '🧊', blurb: 'Eat me first' },
  { key: 'freezer', label: 'Freezer', emoji: '❄️', blurb: 'The long game' },
  { key: 'pantry',  label: 'Pantry',  emoji: '🗄️', blurb: 'Shelf-stable' },
  { key: 'counter', label: 'Counter', emoji: '🧺', blurb: 'Out in the open' },
  { key: 'spice',   label: 'Spices',  emoji: '🧂', blurb: 'Flavour rack' },
]

export function locationMeta(key: StorageLocation): LocationMeta {
  return LOCATIONS.find((l) => l.key === key) ?? LOCATIONS[0]
}

/**
 * Best guess at a category from a bare product name, so quick-add doesn't make
 * you pick from a dropdown every time. Longest keyword wins.
 */
const KEYWORDS: Array<[Category, string[]]> = [
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
  let best: { cat: Category; len: number } | null = null
  for (const [cat, words] of KEYWORDS) {
    for (const w of words) {
      if (n.includes(w) && (!best || w.length > best.len)) best = { cat, len: w.length }
    }
  }
  return best?.cat ?? 'other'
}

export function guessLocation(category: Category): StorageLocation {
  switch (category) {
    case 'produce': case 'dairy': case 'protein': case 'condiment': return 'fridge'
    case 'frozen': return 'freezer'
    case 'spice': return 'spice'
    case 'bakery': return 'counter'
    default: return 'pantry'
  }
}
