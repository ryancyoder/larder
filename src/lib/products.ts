import { db } from '../db/db'
import type { Category, Nutrition, Product, Unit } from '../db/schema'
import { guessCategory } from './categories'
import { matchFood } from './foods'
import { lookupBarcode } from './openfoodfacts'
import { todayISO } from './dates'

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
    timesBought: 0,
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
    patch.brand = found.brand ?? product.brand
    patch.category = found.category
    patch.nutrition = found.nutrition ?? product.nutrition
    patch.foodKey = matchFood(found.name, found.brand) ?? product.foodKey
    if (product.size == null && found.qty != null) {
      patch.size = found.qty
      patch.sizeUnit = found.unit
    }
  }

  await db.products.update(productId, patch)
  return { product: { ...product, ...patch }, named: Boolean(found) }
}

/** Bookkeeping, so the catalogue can be sorted by what actually gets bought. */
export async function recordPurchase(
  productId: number,
  opts: { price?: number; date?: string; qty?: number } = {},
): Promise<void> {
  const product = await db.products.get(productId)
  if (!product) return
  await db.products.update(productId, {
    timesBought: (product.timesBought ?? 0) + (opts.qty ?? 1),
    lastBoughtAt: opts.date ?? todayISO(),
    lastPrice: opts.price ?? product.lastPrice,
  })
}

// ---------------------------------------------------------------------------
// Reading the catalogue
// ---------------------------------------------------------------------------

export function sortProducts(list: Product[]): Product[] {
  return [...list].sort(
    (a, b) => b.timesBought - a.timesBought || a.name.localeCompare(b.name),
  )
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
