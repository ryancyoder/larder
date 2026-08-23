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
  /**
   * Object paths in the `photos` bucket, not the bytes. Keeping images out of
   * the row means a kitchen full of pictures doesn't make every query heavy,
   * and the bucket is private so these are only reachable through a signed URL.
   */
  fullPath?: string
  thumbPath?: string
  /** Only for an image we couldn't re-encode — a blocked cross-origin fetch. */
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

/**
 * Nutrients for a fixed amount. Every field is optional because Open Food Facts
 * coverage is uneven — a product often declares energy and fat but nothing
 * else, and a half-filled panel is more useful than none.
 */
export interface NutrientSet {
  kcal?: number
  fat?: number
  satFat?: number
  carbs?: number
  sugars?: number
  fibre?: number
  protein?: number
  salt?: number
  sodium?: number
}

/** What a product's label says, as far as the database knows it. */
export interface Nutrition {
  /** Per 100 g or 100 ml — the basis Open Food Facts normalises everything to. */
  per100?: NutrientSet
  /** Per serving, only when the pack declares a serving. */
  perServing?: NutrientSet
  /** The declared serving, as printed: "30 g", "1 cup (240 ml)". */
  servingSize?: string
  /** Nutri-Score 'a'–'e', where products carry one. */
  nutriScore?: string
  /** NOVA processing group, 1 (unprocessed) to 4 (ultra-processed). */
  nova?: number
  ingredients?: string
  allergens?: string[]
  source: 'openfoodfacts'
  /** So a figure that's years old can be identified and refreshed. */
  fetchedAt: string
}

/**
 * A photo waiting to become an item.
 *
 * Everything except the picture is a guess until someone confirms it, which is
 * why this is its own table rather than a draft flag on Item: an unidentified
 * photograph must never count towards dinner coverage or move a spend figure,
 * and that guarantee shouldn't depend on every query remembering to exclude it.
 */
export interface InboxItem {
  id?: number
  photoId?: number
  name?: string
  brand?: string
  barcode?: string
  category?: Category
  qty: number
  unit: Unit
  nutrition?: Nutrition
  /** How the guess was arrived at, so the screen can say how far to trust it. */
  guessSource?: 'barcode' | 'ai' | 'manual'
  /** Why there is no guess — distinct from not having looked yet. */
  guessNote?: string
  scanned: boolean
  /**
   * The shop this arrived from, carried through so a row named days later still
   * lands on the right trip. Absent for a photo imported on its own.
   */
  tripId?: number
  /**
   * Set when the row is a receipt line waiting for its one-time barcode scan.
   * The catalogue entry already exists — scanning fills in its barcode, which
   * is what stops the next receipt asking again.
   */
  productId?: number
  sku?: string
  store?: string
  /** What the receipt charged, carried through so the ledger stays complete. */
  price?: number
  createdAt: string
}

/**
 * A product the household buys — the catalogue entry, not the thing on the shelf.
 *
 * `Item` is one purchase: this carton, bought on Tuesday, going off on Friday.
 * `Product` is the identity behind every such purchase — "Friendly Farms Whole
 * Milk", once, no matter how many cartons pass through. Stock stays per-purchase
 * because two cartons bought a fortnight apart expire on different days; what was
 * missing was any record that they were the same thing.
 *
 * It is also where a till's item number becomes useful. An ALDI receipt carries
 * a six-digit SKU rather than a barcode, so nothing on it resolves against Open
 * Food Facts. The SKU is stable, though, so scanning the real barcode off the
 * packet **once** teaches this row, and every later receipt carrying that SKU
 * resolves without asking again.
 */
export interface Product {
  id?: number
  name: string
  brand?: string
  /**
   * The real product barcode, once someone has scanned one. Absent is the
   * meaningful state: it marks a product still waiting for its one-time scan.
   */
  barcode?: string
  /**
   * The till's own item number and the chain it belongs to. Neither means
   * anything without the other — ALDI's 514025 is not Target's 514025.
   */
  store?: string
  sku?: string
  category: Category
  foodKey?: string
  unit: Unit
  size?: number
  sizeUnit?: Unit
  nutrition?: Nutrition
  photoId?: number
  /**
   * What Open Food Facts said, once somebody asked it.
   *
   * Three states, and the absent one carries meaning: undefined means nobody
   * has scanned a barcode yet, so the question has never been put. `'missing'`
   * is a settled answer, not outstanding work — at ALDI almost everything is
   * own-brand and simply is not in the database.
   *
   * Recorded rather than inferred from `nutrition`, which is wrong both ways: a
   * listed product may declare nothing worth storing, and nutrition can be
   * typed in by hand.
   */
  offStatus?: 'found' | 'missing'
  timesBought: number
  lastBoughtAt?: string
  lastPrice?: number
  createdAt: string
}

/** A physical thing in your kitchen. */
export interface Item {
  id?: number
  name: string
  category: Category
  /**
   * The basic food this is an instance of — a key into the food library, not a
   * table. "Beets" for fresh beets, canned beets and freeze-dried beets alike,
   * which is the whole point: the product is what you bought, the food is what
   * it *is*, and only the second one answers "have we got any beets?".
   *
   * Optional because the library is finite and honest about it. A birthday cake
   * is not a basic food, and filing it under wheat would be worse than leaving
   * this unset.
   */
  foodKey?: string
  location: StorageLocation
  photoId?: number
  /** Product barcode, when the item was added by scanning one. */
  barcode?: string
  /**
   * Label figures from the barcode lookup. Absent is the normal case — plenty
   * of products aren't in the database, and loose produce has no barcode at all.
   */
  nutrition?: Nutrition
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
  /**
   * The catalogue entry this is an instance of. Optional because stock predates
   * the catalogue, and because a one-off from the market is not worth one.
   */
  productId?: number
  /**
   * Hidden from the kitchen. Nothing sets this automatically any more — running
   * out leaves an item on the shelf at zero. Kept on the model so older exports
   * still import cleanly, and so an explicit "hide this" has somewhere to live.
   */
  archived: boolean
}

/**
 * Someone a meal can be set aside for. A household, not a user list — there are
 * no accounts and nothing signs in. "Littles" and "Family meal" sit alongside
 * names because that's how food actually gets allocated.
 */
export interface Person {
  id?: number
  /** Stable slug referenced by reservations. Never changes once created. */
  key: string
  name: string
  emoji: string
  /** Palette slot; resolves to --cat-<hue> in global.css. */
  hue: string
  order: number
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
  /**
   * Who it's for. Required when holding by hand; plan-generated holds default
   * to the household, since a planned meal is everyone's unless said otherwise.
   * Optional on the type because holds made before this existed have none.
   */
  personKey?: string
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

/**
 * One shop: everything that came home at the same time.
 *
 * The link to stock is `Item.tripId`, so a trip can answer "what did this
 * receipt actually buy?" long after the paper is thrown away — which is the
 * point of recording it at all.
 */
export interface Trip {
  id?: number
  date: string
  store: string
  /** Sum of what the imported lines cost — the app's own figure. */
  total: number
  itemCount: number
  /**
   * How it was recorded. The three routes carry different confidence: a
   * receipt is what the till charged, a scan is what someone pointed a camera
   * at, and a checkout is what they meant to buy.
   */
  source: TripSource
  /**
   * The total printed on the receipt, when one was read. Kept beside `total`
   * rather than replacing it: the two disagree when a line was skipped or
   * mis-read, and that gap is the only evidence the import was imperfect.
   */
  printedTotal?: number
  note?: string
}

export type TripSource = 'checkout' | 'receipt' | 'scan'

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
