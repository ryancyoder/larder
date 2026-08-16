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
  blurb: string
  kind: StorageKind
  order: number
}

export type Category =
  | 'produce'
  | 'protein'
  | 'dairy'
  | 'grain'
  | 'frozen'
  | 'canned'
  | 'condiment'
  | 'spice'
  | 'bakery'
  | 'snack'
  | 'beverage'
  | 'other'

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
