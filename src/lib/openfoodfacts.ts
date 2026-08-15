import type { Category, Unit } from '../db/schema'
import { guessCategory } from './categories'
import { savePhoto, saveRemotePhoto } from './photos'

/**
 * Open Food Facts lookup — a free, open product database. Barcodes are sent to
 * world.openfoodfacts.org; nothing else about your kitchen leaves the device,
 * and the whole feature is skippable (you can always type the item in by hand).
 */

const ENDPOINT = 'https://world.openfoodfacts.org/api/v2/product'
const FIELDS = 'product_name,product_name_en,generic_name,brands,quantity,categories_tags,image_front_url,image_url'
const TIMEOUT_MS = 8000

export interface ProductLookup {
  barcode: string
  name: string
  brand?: string
  /** Pack size as printed, e.g. "400 g" — parsed into qty/unit where possible. */
  quantity?: string
  qty?: number
  unit?: Unit
  category: Category
  imageUrl?: string
  attribution: string
}

export class LookupError extends Error {}

/** Maps Open Food Facts category tags onto the app's own categories. */
const TAG_MAP: Array<[RegExp, Category]> = [
  [/dairy|milk|cheese|yogurt|yoghurt|butter|cream|egg/i, 'dairy'],
  [/meat|poultry|chicken|beef|pork|fish|seafood|sausage|charcuterie/i, 'protein'],
  [/frozen/i, 'frozen'],
  [/bread|baker|viennoiser|pastr/i, 'bakery'],
  [/pasta|rice|cereal|grain|flour|oat|noodle|legume|lentil/i, 'grain'],
  [/canned|tinned|preserve|conserve/i, 'canned'],
  [/sauce|condiment|spread|dressing|mustard|ketchup|mayonnaise|jam|honey/i, 'condiment'],
  [/spice|herb|seasoning|salt|oil|vinegar|sugar/i, 'spice'],
  [/snack|crisp|chip|biscuit|cookie|chocolate|confection|nut/i, 'snack'],
  [/beverage|drink|water|juice|soda|coffee|tea|beer|wine/i, 'beverage'],
  [/fruit|vegetable|produce|salad|fresh/i, 'produce'],
]

function categoryFromTags(tags: string[] | undefined, name: string): Category {
  for (const tag of tags ?? []) {
    for (const [pattern, category] of TAG_MAP) {
      if (pattern.test(tag)) return category
    }
  }
  // No usable tags — fall back to the same keyword guess used for typed names.
  return guessCategory(name)
}

const UNIT_WORDS: Array<[RegExp, Unit]> = [
  [/^(g|gr|gram|grams|grammes)$/i, 'g'],
  [/^(kg|kilo|kilos|kilogram|kilograms)$/i, 'kg'],
  [/^(oz|ounce|ounces)$/i, 'oz'],
  [/^(lb|lbs|pound|pounds)$/i, 'lb'],
  [/^(ml|millilitre|milliliter)s?$/i, 'ml'],
  [/^(l|lt|litre|liter)s?$/i, 'l'],
  [/^(cl)$/i, 'ml'],
  [/^(fl\.?\s?oz|floz)$/i, 'floz'],
]

/** "400 g" → { qty: 400, unit: 'g' }. Anything unparseable is left alone. */
export function parseQuantity(raw?: string): { qty?: number; unit?: Unit } {
  if (!raw) return {}
  const match = raw.trim().match(/^([\d.,]+)\s*([a-zA-Z.\s]+)$/)
  if (!match) return {}
  const value = Number(match[1].replace(',', '.'))
  if (!Number.isFinite(value) || value <= 0) return {}
  const word = match[2].trim()
  for (const [pattern, unit] of UNIT_WORDS) {
    if (pattern.test(word)) {
      // Centilitres are the one unit worth converting rather than dropping.
      if (/^cl$/i.test(word)) return { qty: value * 10, unit: 'ml' }
      return { qty: value, unit }
    }
  }
  return {}
}

export async function lookupBarcode(barcode: string): Promise<ProductLookup | null> {
  const clean = barcode.replace(/\D/g, '')
  if (!clean) throw new LookupError('That barcode did not scan cleanly.')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(`${ENDPOINT}/${clean}.json?fields=${FIELDS}`, { signal: controller.signal })
  } catch {
    throw new LookupError('Could not reach Open Food Facts. Add the item by hand instead.')
  } finally {
    clearTimeout(timer)
  }

  if (res.status === 404) return null
  if (!res.ok) throw new LookupError(`Open Food Facts returned ${res.status}.`)

  const data = await res.json()
  if (data.status !== 1 || !data.product) return null

  const p = data.product
  const name: string = p.product_name_en || p.product_name || p.generic_name || ''
  if (!name.trim()) return null

  const parsed = parseQuantity(p.quantity)

  return {
    barcode: clean,
    name: name.trim(),
    brand: (p.brands || '').split(',')[0]?.trim() || undefined,
    quantity: p.quantity || undefined,
    ...parsed,
    category: categoryFromTags(p.categories_tags, name),
    imageUrl: p.image_front_url || p.image_url || undefined,
    attribution: 'Photo via Open Food Facts (CC BY-SA)',
  }
}

/**
 * Pulls the product shot down and re-encodes it locally so it works offline.
 * Falls back to keeping the URL if the fetch is blocked.
 */
export async function importProductPhoto(product: ProductLookup): Promise<number | undefined> {
  if (!product.imageUrl) return undefined
  try {
    const res = await fetch(product.imageUrl)
    if (!res.ok) throw new Error(String(res.status))
    const blob = await res.blob()
    return await savePhoto(blob, 'openfoodfacts', product.attribution)
  } catch {
    return saveRemotePhoto(product.imageUrl, product.attribution)
  }
}
