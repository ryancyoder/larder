/** Core domain types. One file, so the shape of the app is readable in one screen. */

/**
 * A location key. Free-form because locations are user-editable — the five
 * defaults ship with the keys 'fridge', 'freezer', 'pantry', 'counter' and
 * 'spice', but a kitchen can have a garage fridge or a chest freezer too.
 */
export type StorageLocation = string

/**
 * How a place keeps food. Shelf-life estimates hang off this rather than off a
 * specific location, so a newly added "Garage fridge" inherits sensible dates
 * without anyone having to re-enter a shelf-life table.
 */
export type StorageKind = 'chilled' | 'frozen' | 'pantry' | 'counter'

export interface StoragePlace {
  id?: number
  /** Stable slug referenced by Item.location. Never changes once created. */
  key: string
  label: string
  emoji: string
  /** A picture of the actual shelf, shown instead of the emoji when set. */
  photoId?: number
  blurb: string
  kind: StorageKind
  order: number
}

/**
 * A category key. Free-form for the same reason locations are: a kitchen might
 * want "Baby food" or "Dog", and the twelve defaults are only a starting point.
 */
export type Category = string

/**
 * An editable food category. Carries the things the app derives from a
 * category — where it lives, how long it keeps, and where it falls on a walk
 * round the shop — so a user-made category behaves like a built-in one.
 */
export interface StorageCategory {
  id?: number
  /** Stable slug referenced by items, shopping lines and the ledger. */
  key: string
  label: string
  emoji: string
  photoId?: number
  /** Palette slot; resolves to --cat-<hue> in global.css. */
  hue: string
  /** Sort order on the shopping list — roughly a supermarket walk. */
  aisle: number
  /** Where this naturally goes, matched against a location's kind. */
  homeKind: StorageKind
  /**
   * Rough shelf life in days, by *kind* of storage rather than by a named
   * location — so a user-added "Garage fridge" inherits the chilled figures.
   */
  shelfLife: Partial<Record<StorageKind, number>>
}

export type Unit =
  // mass
  | 'g' | 'kg' | 'oz' | 'lb'
  // volume
  | 'ml' | 'l' | 'tsp' | 'tbsp' | 'cup' | 'floz' | 'qt' | 'gal'
  // count-ish
  | 'ea' | 'bunch' | 'can' | 'pkg' | 'slice' | 'clove' | 'head' | 'loaf' | 'dozen'

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack'

/**
 * A picture of something in the kitchen. Stored as blobs so photos survive
 * offline; `remoteUrl` is only a fallback for when a fetch was blocked.
 */
export interface Photo {
  id?: number
  full: Blob | null
  thumb: Blob | null
  remoteUrl?: string
  source: 'camera' | 'library' | 'openfoodfacts'
  /**
   * Background removed, so the blob is a WebP with an alpha channel. Display
   * code must letterbox these (`contain`) rather than crop them (`cover`) —
   * a cropped cutout looks like a rendering bug.
   */
  cutout?: boolean
  createdAt: string
  /** Credit line for photos that came from someone else. */
  attribution?: string
}

/** A physical thing in your kitchen. */
export interface Item {
  id?: number
  name: string
  category: Category
  location: StorageLocation
  photoId?: number
  /** Product barcode, when the item was added by scanning one. */
  barcode?: string
  /** Quantity remaining right now (before reservations). */
  qty: number
  /** Quantity when it entered the kitchen — used for unit price + depletion %. */
  qtyInitial: number
  /**
   * The packaged unit you count in — usually 'ea', but also 'can', 'pkg', 'loaf'.
   * Can still be a measure ('lb', 'g') for loose goods bought by weight.
   */
  unit: Unit
  /**
   * How much is in *one* of those units: 2 ea × 500 g. Optional, and only
   * meaningful when `unit` is a count. This is what lets a recipe asking for
   * "400 g tomatoes" be compared against "2 cans" instead of giving up.
   */
  size?: number
  sizeUnit?: Unit
  /** Total paid for `qtyInitial`, in dollars. */
  price?: number
  purchasedAt: string // ISO date (yyyy-mm-dd)
  expiresAt?: string // ISO date
  openedAt?: string // ISO date — shortens effective shelf life
  /**
   * Which meal this belongs to — one at a time, or none at all for the many
   * things that aren't meal-specific. Uses the meal planner's own slots so
   * "what have I got for breakfast?" and "plan a breakfast" agree.
   */
  meal?: MealSlot
  /**
   * The centrepiece rather than a component — chicken thighs yes, soy sauce no.
   * A secondary marker on top of breakfast/lunch/dinner; never valid on a
   * snack, which is a whole eating occasion with no main.
   */
  isMain?: boolean
  /** Staples get auto-restocked on the shopping list when they drop below `parQty`. */
  isStaple: boolean
  parQty?: number
  brand?: string
  notes?: string
  tripId?: number
  /** Fully used/tossed and not a staple: hidden from the kitchen, kept for history. */
  archived: boolean
}

/**
 * A hold placed on part of an item — "this is saved for Thursday's curry."
 * Available quantity = item.qty - sum(reservations for that item).
 */
export interface Reservation {
  id?: number
  itemId: number
  qty: number
  /** Meal-plan entry this hold belongs to, if any. Manual holds have none. */
  planId?: number
  label: string
  createdAt: string
}

export interface Ingredient {
  name: string
  qty?: number
  unit?: Unit
  optional?: boolean
  note?: string
}

export interface Recipe {
  id?: number
  title: string
  emoji: string
  description?: string
  servings: number
  prepMin: number
  cookMin: number
  tags: string[]
  ingredients: Ingredient[]
  steps: string[]
  favorite: boolean
  source: 'custom' | 'ai'
  createdAt: string
  lastCookedAt?: string
  timesCooked: number
}

export interface PlanEntry {
  id?: number
  date: string // ISO date
  slot: MealSlot
  recipeId?: number
  title: string
  servings: number
  status: 'planned' | 'cooked' | 'skipped'
}

/**
 * A meal that actually happened — one record per date + slot.
 *
 * Distinct from PlanEntry, which is a *recipe* scheduled ahead of time. This is
 * the retrospective fact behind the calendar's solid days: what filled dinner
 * on the 14th. Recording one consumes the item, so coverage and stock can never
 * disagree.
 */
export interface MealDay {
  id?: number
  date: string // ISO date
  slot: MealSlot
  /** The item eaten. Absent when it was something not tracked in the kitchen. */
  itemId?: number
  /** Always set — survives the item being deleted or used up later. */
  label: string
  createdAt: string
}

/**
 * One member of a combination.
 *
 * Carries both an id and a name on purpose. The id points at the row it was
 * built from, which is exact while that row lives; the name is what survives
 * the jar being finished and a new one bought weeks later. Resolution prefers
 * the id and falls back to matching the name, so a combination outlives its
 * ingredients.
 */
export interface ComboPart {
  itemId?: number
  name: string
  /** Roughly how much gets used. Absent means "one of", which is usually right. */
  qty?: number
  /** Nice to have rather than required — doesn't count against completeness. */
  optional?: boolean
}

/**
 * Things that get used together: pasta and sauce, chips and salsa, rice and
 * curry paste. Lighter than a recipe on purpose — no method, no servings, no
 * timings — because the useful question is only ever "have I got the whole set,
 * and what's missing?"
 */
export interface Combo {
  id?: number
  name: string
  emoji: string
  photoId?: number
  parts: ComboPart[]
  meal?: MealSlot
  notes?: string
  createdAt: string
  timesUsed: number
  lastUsedAt?: string
  /** 'suggested' rows came from the app noticing a habit and being accepted. */
  source: 'custom' | 'suggested'
}

export interface ShopItem {
  id?: number
  name: string
  qty: number
  unit: Unit
  category: Category
  checked: boolean
  /** Where the line came from, so the list can explain itself. */
  source: 'manual' | 'staple' | 'plan'
  reason?: string
  estPrice?: number
  /** Staple restocks point back at the depleted item so checkout can top it up. */
  itemId?: number
}

export interface Trip {
  id?: number
  date: string
  store: string
  total: number
  itemCount: number
}

/** Append-only ledger. Every insight on the Insights screen is derived from this. */
export interface LedgerEvent {
  id?: number
  type: 'purchase' | 'consume' | 'waste' | 'adjust'
  itemId?: number
  name: string
  category: Category
  qty: number
  unit: Unit
  /** Dollar value of the movement. Waste events are what "money in the bin" means. */
  value: number
  date: string
  reason?: string
}

export interface Setting {
  key: string
  value: string
}

/** Denormalised view of an item with its holds resolved. */
export interface ItemView extends Item {
  reserved: number
  available: number
  holds: Reservation[]
}
