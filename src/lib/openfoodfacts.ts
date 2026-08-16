import type { Category, NutrientSet, Nutrition, Unit } from '../db/schema'
import { guessCategory } from './categories'
import { savePhoto, saveRemotePhoto } from './photos'
import { todayISO } from './dates'

/**
 * Open Food Facts lookup — a free, open product database. Barcodes are sent to
 * world.openfoodfacts.org; nothing else about your kitchen leaves the device,
 * and the whole feature is skippable (you can always type the item in by hand).
 */

const ENDPOINT = 'https://world.openfoodfacts.org/api/v2/product'
/**
 * Nutrition rides along on the same request — it's the same product document,
 * so asking for it costs nothing beyond a slightly larger response.
 */
const FIELDS = [
  'product_name', 'product_name_en', 'generic_name', 'brands', 'quantity',
  'categories_tags', 'image_front_url', 'image_url',
  'nutriments', 'nutriscore_grade', 'nova_group', 'serving_size',
  'ingredients_text', 'ingredients_text_en', 'allergens_tags',
].join(',')
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
  /** Absent whenever the product carries no label data worth keeping. */
  nutrition?: Nutrition
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

/** Open Food Facts stores everything as flat, suffixed keys on one object. */
type Nutriments = Record<string, unknown>

function num(raw: unknown): number | undefined {
  const n = typeof raw === 'string' ? Number(raw) : raw
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined
}

/**
 * Reads one basis ('100g' or 'serving') out of the flat nutriments object.
 *
 * Energy is tried as kcal first and converted from kJ only as a fallback:
 * European products often carry both, US ones frequently only kJ.
 */
function nutrientSet(n: Nutriments, basis: '100g' | 'serving'): NutrientSet | undefined {
  const at = (key: string) => num(n[`${key}_${basis}`])
  const kj = at('energy-kj') ?? at('energy')
  const set: NutrientSet = {
    kcal: at('energy-kcal') ?? (kj != null ? Math.round(kj / 4.184) : undefined),
    fat: at('fat'),
    satFat: at('saturated-fat'),
    carbs: at('carbohydrates'),
    sugars: at('sugars'),
    fibre: at('fiber'),
    protein: at('proteins'),
    salt: at('salt'),
    sodium: at('sodium'),
  }
  // All-empty means the product simply doesn't declare this basis.
  return Object.values(set).some((v) => v != null) ? set : undefined
}

/** "en:milk" → "milk". The prefix is a locale tag, not part of the name. */
function cleanTag(tag: string): string {
  return tag.replace(/^[a-z]{2}:/, '').replace(/-/g, ' ')
}

function readNutrition(p: Record<string, unknown>): Nutrition | undefined {
  const n = (p.nutriments ?? {}) as Nutriments
  const per100 = nutrientSet(n, '100g')
  const perServing = nutrientSet(n, 'serving')
  const grade = typeof p.nutriscore_grade === 'string' ? p.nutriscore_grade.toLowerCase() : undefined
  const nova = num(p.nova_group)
  const ingredients = ((p.ingredients_text_en || p.ingredients_text) as string | undefined)?.trim()
  const allergens = Array.isArray(p.allergens_tags)
    ? (p.allergens_tags as string[]).map(cleanTag).filter(Boolean)
    : undefined

  // Nothing worth storing — the product is in the database but undocumented.
  if (!per100 && !perServing && !grade && !nova && !ingredients && !allergens?.length) return undefined

  return {
    per100,
    perServing,
    servingSize: typeof p.serving_size === 'string' ? p.serving_size.trim() || undefined : undefined,
    nutriScore: grade && /^[a-e]$/.test(grade) ? grade : undefined,
    nova: nova && nova >= 1 && nova <= 4 ? nova : undefined,
    ingredients: ingredients || undefined,
    allergens: allergens?.length ? allergens : undefined,
    source: 'openfoodfacts',
    fetchedAt: todayISO(),
  }
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
    nutrition: readNutrition(p),
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
