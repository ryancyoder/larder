import { db } from '../db/db'
import type { Category, Item, Nutrition, Product, Unit } from '../db/schema'
import { guessCategory } from './categories'
import { matchFood } from './foods'
import { importProductPhoto, lookupBarcode } from './openfoodfacts'
import { todayISO } from './dates'
import { unitPrice } from './inventory'

/**
 * The product catalogue.
 *
 * `Item` is a purchase — this carton, bought Tuesday, off by Friday. `Product`
 * is the identity behind every such purchase, recorded once. Stock stays
 * per-purchase because two cartons bought a fortnight apart expire on different
 * days; what the app never had was any record that they were the same thing.
 *
 * The immediate reason it exists is the ALDI receipt. Its lines carry a
 * six-digit item number rather than a barcode, so nothing on one resolves
 * against Open Food Facts. The number is stable, though — that tub of hummus is
 * 343825 every week — so the barcode only has to be scanned off the packet
 * **once**. After that the catalogue answers, and every later receipt carrying
 * 343825 comes in already named.
 *
 * Which means an import gets quieter over time rather than staying equally
 * tedious: the first ALDI shop asks about everything, the tenth asks about
 * whatever was new that week.
 */

// ---------------------------------------------------------------------------
// The friendly name
// ---------------------------------------------------------------------------

/**
 * Trailing clauses that describe the packet rather than the food: a size, a
 * pack count, a net weight. Open Food Facts puts them in the name because the
 * name is the label, and the label has to carry them.
 */
const SIZE_CLAUSE = /^\s*\d+(?:\.\d+)?\s*(?:fl\.?\s?oz|oz|lb|lbs|g|kg|ml|l|ct|count|pk|pack|pc|pcs|gal|qt)\b\.?\s*$/i

/**
 * A short name for a shelf, out of the long one on a label.
 *
 * Conservative on purpose. It only removes things that are demonstrably not
 * part of what the food *is* — the brand, which the catalogue stores
 * separately, and trailing size clauses — and never rewords anything. A
 * derivation that paraphrased would produce names nobody chose and nobody
 * could search for.
 *
 * Returns the original whenever tidying would leave too little behind: half a
 * name is worse than a long one.
 */
export function friendlyName(name: string, brand?: string): string {
  let out = name.trim().replace(/\s+/g, ' ')
  if (!out) return name

  // The brand is its own column; repeating it in the name is noise.
  if (brand) {
    const b = brand.trim()
    if (b && out.toLowerCase().startsWith(b.toLowerCase() + ' ')) {
      out = out.slice(b.length).trim()
    }
  }

  // "Coca-Cola Classic, 12 pk, 12 fl oz" → drop the trailing measurements.
  const parts = out.split(',').map((p) => p.trim()).filter(Boolean)
  while (parts.length > 1 && SIZE_CLAUSE.test(parts[parts.length - 1])) parts.pop()
  out = parts.join(', ')

  // A trailing parenthetical is nearly always packaging or a translation.
  out = out.replace(/\s*\([^)]*\)\s*$/, '').trim()

  // A bare size left on the end after all that.
  out = out.replace(
    /[,\s]+\d+(?:\.\d+)?\s*(?:fl\.?\s?oz|oz|lb|lbs|g|kg|ml|l|ct|pk|pack|gal|qt)\.?$/i,
    '',
  ).trim()

  // A result that is only a size is not a name — "Oat 16 oz" minus the brand
  // "Oat" leaves "16 oz", which is long enough to pass a length check and
  // useless on a shelf. The original is always the safer answer.
  if (out.length < 3 || SIZE_CLAUSE.test(out) || !/[A-Za-z]{3}/.test(out)) return name.trim()
  return out
}

/**
 * What to call a product on screen. The only correct way to read the name:
 * `displayName` is optional and `name` is the fallback, and forgetting that
 * shows a blank where a product should be.
 */
export function productName(product: Pick<Product, 'name' | 'displayName'>): string {
  return product.displayName?.trim() || product.name
}

/** A till code only identifies a product alongside the shop that issued it. */
export interface StoreCode {
  store: string
  sku: string
}

/** Normalised so "ALDI", "Aldi" and " aldi " are one shop, not three. */
export function storeKey(store: string | undefined): string {
  return (store ?? '').trim().toLowerCase()
}

// ---------------------------------------------------------------------------
// Finding
// ---------------------------------------------------------------------------

/**
 * The catalogue entry for a till code, if this household has met it before.
 *
 * Matched on the code alone, never on the description: a shop renames its own
 * lines ("Assorted Hummus" becomes "Hummus Assorted") without the number
 * changing, and the number is the part that was designed to be an identifier.
 */
export async function productByCode(code: StoreCode): Promise<Product | undefined> {
  const sku = code.sku.trim()
  if (!sku) return undefined
  const rows = await db.products.where('sku').equals(sku).toArray()
  return rows.find((p) => storeKey(p.store) === storeKey(code.store))
}

export async function productByBarcode(barcode: string): Promise<Product | undefined> {
  const clean = barcode.replace(/\D/g, '')
  if (!clean) return undefined
  return await db.products.where('barcode').equals(clean).first()
}

/** True when the product still needs its one-time scan. */
export function needsScan(product: Product | undefined): boolean {
  return Boolean(product) && !product!.barcode
}

// ---------------------------------------------------------------------------
// Learning
// ---------------------------------------------------------------------------

export interface ProductDraft {
  name: string
  brand?: string
  barcode?: string
  store?: string
  sku?: string
  category?: Category
  unit?: Unit
  size?: number
  sizeUnit?: Unit
  nutrition?: Nutrition
}

/**
 * The catalogue entry for a draft, creating one only if it is genuinely new.
 *
 * Existing rows are filled in rather than overwritten. A field already known is
 * more trustworthy than the one arriving: a name that came from Open Food Facts
 * or from a person beats a till's abbreviation, and re-importing last month's
 * receipt should not undo either. The exception is a barcode, which is only
 * ever absent or right.
 */
export async function upsertProduct(draft: ProductDraft): Promise<Product> {
  const barcode = draft.barcode?.replace(/\D/g, '') || undefined
  const sku = draft.sku?.trim() || undefined

  const existing =
    (barcode ? await productByBarcode(barcode) : undefined) ??
    (sku ? await productByCode({ store: draft.store ?? '', sku }) : undefined)

  if (existing?.id != null) {
    const patch: Partial<Product> = {}
    // Only ever fills gaps.
    if (!existing.barcode && barcode) patch.barcode = barcode
    if (!existing.sku && sku) { patch.sku = sku; patch.store = draft.store }
    if (!existing.brand && draft.brand) patch.brand = draft.brand
    if (!existing.nutrition && draft.nutrition) patch.nutrition = draft.nutrition
    if (existing.size == null && draft.size != null) {
      patch.size = draft.size
      patch.sizeUnit = draft.sizeUnit
    }
    if (!existing.foodKey) {
      const food = matchFood(existing.name, existing.brand ?? draft.brand)
      if (food) patch.foodKey = food
    }
    if (Object.keys(patch).length) await db.products.update(existing.id, patch)
    return { ...existing, ...patch }
  }

  const category = draft.category ?? guessCategory(draft.name)
  const row: Omit<Product, 'id'> = {
    // A draft carrying a barcode came from a lookup that succeeded; one without
    // has never been asked.
    offStatus: barcode && draft.nutrition ? 'found' : undefined,
    name: draft.name.trim(),
    displayName: friendlyName(draft.name, draft.brand),
    brand: draft.brand,
    barcode,
    store: sku ? draft.store : undefined,
    sku,
    category,
    foodKey: matchFood(draft.name, draft.brand),
    unit: draft.unit ?? 'ea',
    size: draft.size,
    sizeUnit: draft.sizeUnit,
    nutrition: draft.nutrition,
    isStaple: false,
    createdAt: todayISO(),
  }
  const id = await db.products.add(row)
  return { ...row, id }
}

/**
 * The one-time scan: attaches a real barcode to a catalogue entry and asks Open
 * Food Facts what it is.
 *
 * This is the moment that pays for the whole table. Everything learned here —
 * the proper name, the brand, the nutrition panel — is what every future
 * receipt carrying the same till code gets for free.
 *
 * A barcode Open Food Facts has never heard of is still worth saving. The code
 * is what links the till line to the packet; the name can stay whatever the
 * receipt called it.
 */
export async function learnBarcode(
  productId: number,
  rawBarcode: string,
): Promise<{ product: Product | undefined; named: boolean }> {
  const barcode = rawBarcode.replace(/\D/g, '')
  if (!barcode) return { product: undefined, named: false }

  const product = await db.products.get(productId)
  if (!product) return { product: undefined, named: false }

  const found = await lookupBarcode(barcode).catch(() => null)

  // Recorded either way. "Not in Open Food Facts" is an answer, and one worth
  // keeping so the catalogue can stop presenting it as unfinished business.
  const patch: Partial<Product> = { barcode, offStatus: found ? 'found' : 'missing' }
  if (found) {
    // The lookup wins on naming — it knows the product, where the receipt only
    // knew how to abbreviate it into 22 characters.
    patch.name = found.name
    // Re-derived, because the lookup has just replaced the name it came from.
    patch.displayName = friendlyName(found.name, found.brand ?? product.brand)
    patch.brand = found.brand ?? product.brand
    patch.category = found.category
    patch.nutrition = found.nutrition ?? product.nutrition
    patch.foodKey = matchFood(found.name, found.brand) ?? product.foodKey
    if (product.size == null && found.qty != null) {
      patch.size = found.qty
      patch.sizeUnit = found.unit
    }
    // The product shot, fetched once and re-encoded locally. Failing to get a
    // picture must never fail the scan — the barcode is the point.
    if (product.photoId == null && found.imageUrl) {
      const photoId = await importProductPhoto(found).catch(() => undefined)
      if (photoId != null) patch.photoId = photoId
    }
  }

  await db.products.update(productId, patch)
  return { product: { ...product, ...patch }, named: Boolean(found) }
}

// ---------------------------------------------------------------------------
// Asking about everything at once
// ---------------------------------------------------------------------------

export interface SweepProgress {
  done: number
  total: number
  found: number
  missing: number
  /** What is being looked up right now, so the button can say something true. */
  current?: string
}

export interface SweepOptions {
  /** Ask again about codes already answered 'missing'. The database grows. */
  recheckMissing?: boolean
  onProgress?: (p: SweepProgress) => void
  signal?: { cancelled: boolean }
}

/**
 * Asks Open Food Facts about every barcode the catalogue holds.
 *
 * Needed because the answer was not always recorded. `off_status` arrived after
 * the scanning did, so a household that had already scanned forty products was
 * left with forty barcodes and no idea which of them the database knew — the
 * column read blank for every row, which looks like a broken feature rather
 * than a missing fact.
 *
 * Gaps are filled and the status is written; **names are never overwritten**.
 * A name in the catalogue came either from a scan that already consulted Open
 * Food Facts or from a person typing it, and both beat re-deciding it now.
 *
 * Sequential with a pause between calls. Open Food Facts is a free community
 * service and this is a background convenience, so it can afford to be polite.
 */
export async function sweepOpenFoodFacts(
  products: Product[],
  opts: SweepOptions = {},
): Promise<SweepProgress> {
  const targets = products.filter((p) => {
    if (!p.barcode) return false
    if (!p.offStatus) return true
    return opts.recheckMissing ? p.offStatus === 'missing' : false
  })

  const state: SweepProgress = { done: 0, total: targets.length, found: 0, missing: 0 }
  opts.onProgress?.({ ...state })

  for (const product of targets) {
    if (opts.signal?.cancelled) break
    state.current = product.name

    const found = await lookupBarcode(product.barcode!).catch(() => null)
    const patch: Partial<Product> = { offStatus: found ? 'found' : 'missing' }

    if (found) {
      state.found++
      // Gaps only. The name is deliberately not among them.
      if (!product.brand && found.brand) patch.brand = found.brand
      if (!product.displayName) patch.displayName = friendlyName(product.name, found.brand ?? product.brand)
      if (!product.nutrition && found.nutrition) patch.nutrition = found.nutrition
      if (product.size == null && found.qty != null) {
        patch.size = found.qty
        patch.sizeUnit = found.unit
      }
      if (!product.foodKey) {
        const food = matchFood(found.name, found.brand)
        if (food) patch.foodKey = food
      }
      if (product.photoId == null && found.imageUrl) {
        const photoId = await importProductPhoto(found).catch(() => undefined)
        if (photoId != null) patch.photoId = photoId
      }
    } else {
      state.missing++
    }

    if (product.id != null) await db.products.update(product.id, patch)
    state.done++
    opts.onProgress?.({ ...state })

    // A free community API, asked politely.
    if (!opts.signal?.cancelled) await new Promise((r) => setTimeout(r, 120))
  }

  state.current = undefined
  return state
}

/**
 * Marks a product a staple, or stops it being one.
 *
 * Every staple toggle in the app routes here, so there is exactly one place the
 * decision lives. Clearing it clears the par level too: "rebuy below two" is
 * meaningless once nothing is being rebought.
 */
export async function setProductStaple(
  productId: number,
  isStaple: boolean,
  parQty?: number,
): Promise<void> {
  await db.products.update(productId, {
    isStaple,
    parQty: isStaple ? (parQty && parQty > 0 ? parQty : 1) : undefined,
  })
}

// ---------------------------------------------------------------------------
// What it cost last time
//
// The catalogue does not store a price — that is a fact about a purchase, and
// every purchase is an Item that already records one. But "you paid more for
// this than last time" is exactly the question a second receipt raises, so the
// answer is derived here rather than cached there.
// ---------------------------------------------------------------------------

export interface LastPaid {
  unitPrice: number
  date: string
}

/**
 * The most recent price paid per product, from stock.
 *
 * One pass over every item rather than a query per line: a 73-line receipt
 * would otherwise be 73 round trips to answer a question about a few dozen
 * rows.
 *
 * Compared per *unit*, never per line. Two jars at $5.18 and one at $2.59 are
 * the same price, and a comparison that missed that would cry inflation every
 * time somebody bought a spare.
 */
export function lastPaidByProduct(items: Item[]): Map<number, LastPaid> {
  const out = new Map<number, LastPaid>()
  for (const item of items) {
    if (item.productId == null || !item.price || !item.qtyInitial) continue
    const seen = out.get(item.productId)
    // Ties break on the later row, which is the later purchase: two shops on
    // one date still happened in an order.
    if (seen && seen.date > item.purchasedAt) continue
    out.set(item.productId, {
      unitPrice: Math.round(unitPrice(item) * 100) / 100,
      date: item.purchasedAt,
    })
  }
  return out
}

export type PriceDirection = 'up' | 'down' | 'same'

export interface PriceChange {
  previous: number
  current: number
  /** Signed, in dollars, rounded to the cent. */
  delta: number
  /** Signed percentage, rounded to one place. */
  pct: number
  direction: PriceDirection
}

/**
 * Two unit prices compared.
 *
 * Rounded to the cent before comparing, so a stored 1.6966666 does not report
 * itself as a rise over 1.70.
 */
export function comparePrice(previous: number, current: number): PriceChange {
  const a = Math.round(previous * 100) / 100
  const b = Math.round(current * 100) / 100
  const delta = Math.round((b - a) * 100) / 100
  return {
    previous: a,
    current: b,
    delta,
    pct: a > 0 ? Math.round((delta / a) * 1000) / 10 : 0,
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'same',
  }
}

// ---------------------------------------------------------------------------
// Reading the catalogue
// ---------------------------------------------------------------------------

/**
 * Alphabetical, because the catalogue no longer knows what gets bought most —
 * that is a question about purchases, and `items` answers it.
 */
export function sortProducts(list: Product[]): Product[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name))
}

/** Everything still waiting on its one-time scan, most-bought first. */
export function unlearned(list: Product[]): Product[] {
  return sortProducts(list.filter((p) => !p.barcode))
}

/** How Open Food Facts answered, in a word. */
export function offLabel(product: Product): 'Y' | 'N' | '—' {
  if (!product.barcode) return '—'
  return product.offStatus === 'found' ? 'Y' : product.offStatus === 'missing' ? 'N' : '—'
}

export function searchProducts(list: Product[], query: string): Product[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter((p) =>
    p.name.toLowerCase().includes(q) ||
    (p.brand ?? '').toLowerCase().includes(q) ||
    (p.sku ?? '').includes(q) ||
    (p.barcode ?? '').includes(q),
  )
}
