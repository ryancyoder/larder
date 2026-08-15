import { db } from '../db/db'
import type { ItemView, PlanEntry, Recipe, ShopItem, Unit, Category } from '../db/schema'
import { bestMatch, isAssumedStaple, normalize, titleCase } from './match'
import { convert } from './units'
import { guessCategory } from './categories'
import { suggestPlace } from './locations'
import { todayISO } from './dates'
import { restock, addItem } from './inventory'

export interface GeneratedLine {
  name: string
  qty: number
  unit: Unit
  category: Category
  source: ShopItem['source']
  reason: string
  itemId?: number
}

/**
 * Builds the list from two sources: staples that have dropped below their par
 * level, and ingredients the coming week's meals are short of.
 */
export function generateList(
  stock: ItemView[],
  plan: PlanEntry[],
  recipes: Recipe[],
  existing: ShopItem[],
): GeneratedLine[] {
  const lines: GeneratedLine[] = []

  // 1. Staples running low.
  for (const item of stock) {
    if (!item.isStaple || !item.parQty) continue
    if (item.available >= item.parQty) continue
    lines.push({
      name: item.name,
      qty: Math.max(1, Math.round((item.parQty - item.available) * 100) / 100),
      unit: item.unit,
      category: item.category,
      source: 'staple',
      reason: item.available <= 0 ? 'Out of stock' : `Below your usual ${item.parQty} ${item.unit}`,
      itemId: item.id,
    })
  }

  // 2. What the planned meals are short of.
  const byId = new Map(recipes.filter((r) => r.id).map((r) => [r.id!, r]))
  for (const entry of plan) {
    if (entry.status !== 'planned' || !entry.recipeId) continue
    const recipe = byId.get(entry.recipeId)
    if (!recipe) continue
    const scale = recipe.servings ? entry.servings / recipe.servings : 1

    for (const ing of recipe.ingredients) {
      if (ing.optional || isAssumedStaple(ing.name)) continue
      const match = bestMatch(ing.name, stock, (i) => i.name)
      const wanted = ing.qty ? ing.qty * scale : 1
      const unit = ing.unit ?? 'ea'

      if (!match) {
        lines.push({
          name: titleCase(ing.name),
          qty: Math.round(wanted * 100) / 100,
          unit,
          category: guessCategory(ing.name),
          source: 'plan',
          reason: `For ${recipe.title}`,
        })
        continue
      }

      const needed = ing.qty && ing.unit ? convert(ing.qty * scale, ing.unit, match.unit) : null
      if (needed == null) continue // Have it; can't compare amounts, so assume enough.
      const short = needed - match.available
      if (short > 0.01) {
        lines.push({
          name: match.name,
          qty: Math.round(short * 100) / 100,
          unit: match.unit,
          category: match.category,
          source: 'plan',
          reason: `${recipe.title} needs more`,
          itemId: match.id,
        })
      }
    }
  }

  return dedupe(lines, existing)
}

/** Merges duplicate lines and drops anything already on the list. */
function dedupe(lines: GeneratedLine[], existing: ShopItem[]): GeneratedLine[] {
  const merged = new Map<string, GeneratedLine>()

  for (const line of lines) {
    const key = normalize(line.name)
    const prior = merged.get(key)
    if (!prior) {
      merged.set(key, { ...line })
      continue
    }
    const converted = convert(line.qty, line.unit, prior.unit)
    if (converted != null) {
      prior.qty = Math.round((prior.qty + converted) * 100) / 100
      // A staple restock plus a recipe need is really one shopping line.
      if (prior.reason !== line.reason) prior.reason = `${prior.reason} + ${line.reason}`
    }
  }

  const alreadyListed = new Set(existing.map((e) => normalize(e.name)))
  return [...merged.values()].filter((l) => !alreadyListed.has(normalize(l.name)))
}

export async function addGeneratedLines(lines: GeneratedLine[]) {
  if (!lines.length) return
  await db.shop.bulkAdd(
    lines.map((l) => ({
      name: l.name,
      qty: l.qty,
      unit: l.unit,
      category: l.category,
      checked: false,
      source: l.source,
      reason: l.reason,
      itemId: l.itemId,
    })),
  )
}

export interface CheckoutInput {
  store: string
  /** Per-line price the user typed at the till, keyed by shop-item id. */
  prices: Record<number, number>
}

/**
 * Turns ticked lines into kitchen stock: tops up staples in place, creates rows
 * for anything new, and records the trip so Insights can track intervals.
 */
export async function checkout(items: ShopItem[], input: CheckoutInput): Promise<number | null> {
  const bought = items.filter((i) => i.checked)
  if (!bought.length) return null

  // Read the user's own locations so new stock lands somewhere that exists.
  const places = await db.places.toArray()

  const total = bought.reduce((sum, i) => sum + (input.prices[i.id!] ?? i.estPrice ?? 0), 0)
  const tripId = await db.trips.add({
    date: todayISO(),
    store: input.store || 'Groceries',
    total: Math.round(total * 100) / 100,
    itemCount: bought.length,
  })

  for (const line of bought) {
    const price = input.prices[line.id!] ?? line.estPrice
    if (line.itemId) {
      const existing = await db.items.get(line.itemId)
      if (existing) {
        await restock(line.itemId, line.qty, price, existing.location, undefined)
        await db.items.update(line.itemId, { tripId })
        continue
      }
    }
    await addItem({
      name: line.name,
      category: line.category,
      location: suggestPlace(places, line.category),
      qty: line.qty,
      qtyInitial: line.qty,
      unit: line.unit,
      price,
      purchasedAt: todayISO(),
      isStaple: false,
      archived: false,
      tripId,
    })
  }

  await db.shop.bulkDelete(bought.map((i) => i.id!))
  return tripId
}

