import type { ItemView, Recipe, Ingredient } from '../db/schema'
import { bestMatch, isAssumedStaple } from './match'
import { convert } from './units'
import { freshnessOf } from './inventory'
import { daysUntil, todayISO } from './dates'

export type LineStatus =
  | 'have'      // enough free stock
  | 'reserved'  // you own enough, but it's held for another meal
  | 'low'       // some in stock, not enough
  | 'missing'   // none at all
  | 'assumed'   // salt, water, oil — not worth blocking a recipe over

export interface MatchLine {
  ingredient: Ingredient
  item: ItemView | null
  status: LineStatus
  /** Amount required, expressed in the stocked item's unit. Null if not comparable. */
  needed: number | null
}

export interface Suggestion {
  recipe: Recipe
  lines: MatchLine[]
  coverage: number
  score: number
  missing: MatchLine[]
  blocked: MatchLine[]
  /** Items about to go off that this recipe would use up. The whole point. */
  rescues: ItemView[]
}

const RESCUE_WINDOW = 4

function resolveLine(ing: Ingredient, stock: ItemView[]): MatchLine {
  const item = bestMatch(ing.name, stock, (i) => i.name)

  if (!item) {
    return { ingredient: ing, item: null, needed: null, status: isAssumedStaple(ing.name) ? 'assumed' : 'missing' }
  }

  // No stated quantity, or units that can't be compared (2 cups flour vs a 5lb bag):
  // owning the ingredient at all is good enough to call it covered.
  const needed = ing.qty != null && ing.unit ? convert(ing.qty, ing.unit, item.unit) : null
  if (needed == null) {
    return { ingredient: ing, item, needed: null, status: item.available > 0 ? 'have' : 'reserved' }
  }

  if (item.available >= needed) return { ingredient: ing, item, needed, status: 'have' }
  if (item.qty >= needed) return { ingredient: ing, item, needed, status: 'reserved' }
  return { ingredient: ing, item, needed, status: item.qty > 0 ? 'low' : 'missing' }
}

export function scoreRecipe(recipe: Recipe, stock: ItemView[]): Suggestion {
  const lines = recipe.ingredients.map((ing) => resolveLine(ing, stock))
  const required = lines.filter((l) => !l.ingredient.optional && l.status !== 'assumed')

  const covered = required.filter((l) => l.status === 'have')
  const missing = required.filter((l) => l.status === 'missing' || l.status === 'low')
  const blocked = required.filter((l) => l.status === 'reserved')
  const coverage = required.length ? covered.length / required.length : 1

  const rescues = lines
    .map((l) => l.item)
    .filter((i): i is ItemView => {
      if (!i) return false
      const f = freshnessOf(i)
      return f.days !== null && f.days <= RESCUE_WINDOW && f.days >= 0
    })
  // One item can back several ingredient lines; count it once.
  const uniqueRescues = [...new Map(rescues.map((r) => [r.id, r])).values()]

  const staleness = recipe.lastCookedAt ? -daysUntil(recipe.lastCookedAt, todayISO()) : 60
  const score =
    coverage * 100 +
    uniqueRescues.length * 10 +
    (recipe.favorite ? 6 : 0) +
    Math.min(6, staleness / 7) -
    missing.length * 6 -
    blocked.length * 8

  return { recipe, lines, coverage, score, missing, blocked, rescues: uniqueRescues }
}

export function rankRecipes(recipes: Recipe[], stock: ItemView[]): Suggestion[] {
  return recipes.map((r) => scoreRecipe(r, stock)).sort((a, b) => b.score - a.score)
}

export type SuggestionBand = 'ready' | 'close' | 'shop'

export function bandOf(s: Suggestion): SuggestionBand {
  if (s.missing.length === 0 && s.blocked.length === 0) return 'ready'
  if (s.missing.length + s.blocked.length <= 2) return 'close'
  return 'shop'
}

export const BAND_META: Record<SuggestionBand, { label: string; blurb: string }> = {
  ready: { label: 'Cook tonight', blurb: 'Everything is in the kitchen and free to use' },
  close: { label: 'Almost there', blurb: 'One or two things short' },
  shop: { label: 'Needs a shop', blurb: 'Save these for after the next trip' },
}
