import { db } from '../db/db'
import type { Combo, ComboPart, ItemView, LedgerEvent, MealSlot, Recipe, ShopItem } from '../db/schema'
import { bestMatch, normalize, titleCase } from './match'
import { consume } from './inventory'
import { guessCategory } from './categories'
import { todayISO } from './dates'

/**
 * Combinations: sets of things that get used together.
 *
 * The useful question about a combination is never "how do I cook it" — it's
 * "have I got the whole set, and what's missing?" That's why this is not a
 * recipe: no method, no servings, no timings, just membership and whether the
 * cupboard can currently satisfy it.
 */

export interface ResolvedPart {
  part: ComboPart
  /** The stock row backing this part, when there is one with something in it. */
  item?: ItemView
  have: boolean
}

export interface ComboView {
  combo: Combo
  parts: ResolvedPart[]
  /** Required parts you have, out of required parts total. */
  haveCount: number
  total: number
  complete: boolean
  missing: ResolvedPart[]
}

/**
 * Matches each part against what's actually in the kitchen.
 *
 * The id is tried first because it's exact, but only counts if that row still
 * has something free — a combination whose pasta is at zero is not complete.
 * Otherwise it falls back to matching on name, which is what makes the
 * combination survive the original jar being finished and replaced.
 */
export function resolveCombo(combo: Combo, stock: ItemView[]): ComboView {
  const parts: ResolvedPart[] = combo.parts.map((part) => {
    const byId = part.itemId != null ? stock.find((i) => i.id === part.itemId) : undefined
    const item = byId?.available ? byId : bestMatch(part.name, stock, (i) => i.name) ?? undefined
    const need = part.qty ?? 1
    return { part, item, have: Boolean(item && item.available >= need) }
  })

  const required = parts.filter((p) => !p.part.optional)
  const haveCount = required.filter((p) => p.have).length
  return {
    combo,
    parts,
    haveCount,
    total: required.length,
    complete: required.length > 0 && haveCount === required.length,
    missing: parts.filter((p) => !p.have && !p.part.optional),
  }
}

export function resolveAll(combos: Combo[], stock: ItemView[]): ComboView[] {
  return combos
    .map((c) => resolveCombo(c, stock))
    // Closest to complete first: the ones worth acting on today lead.
    .sort((a, b) => {
      const ra = a.total ? a.haveCount / a.total : 0
      const rb = b.total ? b.haveCount / b.total : 0
      return rb - ra || a.combo.name.localeCompare(b.combo.name)
    })
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function saveCombo(combo: Omit<Combo, 'id'> & { id?: number }): Promise<number> {
  if (combo.id != null) {
    await db.combos.update(combo.id, combo)
    return combo.id
  }
  return db.combos.add(combo as Combo)
}

export async function deleteCombo(id: number): Promise<void> {
  await db.combos.delete(id)
}

/**
 * Puts everything the combination is short of onto the shopping list.
 *
 * Missing parts have no stock row to point at — that's what missing means — so
 * these are plain lines carrying the combination's name as the reason, which is
 * what makes a half-finished list explain itself at the shop.
 */
export async function shopMissing(view: ComboView, list: ShopItem[]): Promise<number> {
  let added = 0
  for (const { part } of view.missing) {
    const name = titleCase(part.name)
    // Don't stack a second line on something already written down.
    const existing = list.find((l) => normalize(l.name) === normalize(name) && !l.checked)
    if (existing) continue
    await db.shop.add({
      name,
      qty: part.qty ?? 1,
      unit: 'ea',
      category: guessCategory(part.name),
      checked: false,
      source: 'manual',
      reason: `For ${view.combo.name}`,
    })
    added++
  }
  return added
}

/**
 * Uses the combination: takes one of each part out of the kitchen and records
 * it, the same way cooking a recipe does, so spend and waste stay truthful.
 *
 * Only what's actually there is consumed. Using a combination you're one part
 * short of is a normal thing to do — you had the pasta, you improvised the
 * sauce — and it shouldn't be blocked or silently invent stock.
 */
export async function useCombo(view: ComboView): Promise<number> {
  let used = 0
  for (const resolved of view.parts) {
    if (!resolved.item?.id) continue
    const fresh = await db.items.get(resolved.item.id)
    if (!fresh || fresh.qty <= 0) continue
    const want = Math.min(resolved.part.qty ?? 1, fresh.qty)
    await consume(fresh, want, `Used ${view.combo.name}`)
    used++
  }
  if (view.combo.id != null) {
    await db.combos.update(view.combo.id, {
      timesUsed: (view.combo.timesUsed ?? 0) + 1,
      lastUsedAt: todayISO(),
    })
  }
  return used
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

export interface ComboSuggestion {
  names: string[]
  /** Why this is being offered, in words the user can check against reality. */
  reason: string
  /** Higher means a stronger signal; used only for ordering. */
  weight: number
}

/** A stable key for a set of names, so the same pair is never counted twice. */
function pairKey(a: string, b: string): string {
  return [normalize(a), normalize(b)].sort().join('|')
}

/**
 * Suggests combinations from two sources, strongest first.
 *
 * The honest signal is the ledger: things eaten on the same day, more than
 * once, are things that go together — that's observed behaviour rather than a
 * guess about food. Recipes are the weaker second source, but they work from
 * the first day, before there's any history to learn from.
 *
 * Anything already covered by an existing combination is dropped, so accepted
 * suggestions stop being offered.
 */
export function suggestCombos(
  events: LedgerEvent[],
  recipes: Recipe[],
  existing: Combo[],
  stock: ItemView[],
  limit = 6,
): ComboSuggestion[] {
  const taken = new Set<string>()
  for (const combo of existing) {
    for (let i = 0; i < combo.parts.length; i++) {
      for (let j = i + 1; j < combo.parts.length; j++) {
        taken.add(pairKey(combo.parts[i].name, combo.parts[j].name))
      }
    }
  }

  const scores = new Map<string, { names: [string, string]; days: number; fromRecipe: boolean }>()

  // --- Source 1: eaten on the same day, repeatedly ---
  const byDate = new Map<string, Set<string>>()
  for (const e of events) {
    if (e.type !== 'consume' || !e.name) continue
    const set = byDate.get(e.date) ?? new Set<string>()
    set.add(e.name)
    byDate.set(e.date, set)
  }
  for (const names of byDate.values()) {
    const list = [...names]
    // A day where everything got used at once is a clear-out, not a meal.
    if (list.length < 2 || list.length > 6) continue
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const key = pairKey(list[i], list[j])
        const prior = scores.get(key)
        if (prior) prior.days++
        else scores.set(key, { names: [list[i], list[j]], days: 1, fromRecipe: false })
      }
    }
  }

  // --- Source 2: appear together in a recipe you saved ---
  for (const recipe of recipes) {
    const named = recipe.ingredients.filter((i) => !i.optional).map((i) => i.name)
    if (named.length < 2 || named.length > 8) continue
    for (let i = 0; i < named.length; i++) {
      for (let j = i + 1; j < named.length; j++) {
        const key = pairKey(named[i], named[j])
        const prior = scores.get(key)
        if (prior) prior.fromRecipe = true
        else scores.set(key, { names: [named[i], named[j]], days: 0, fromRecipe: true })
      }
    }
  }

  const out: ComboSuggestion[] = []
  for (const [key, entry] of scores) {
    if (taken.has(key)) continue
    // A single shared day is noise — two things eaten on one Tuesday.
    const repeated = entry.days >= 2
    if (!repeated && !entry.fromRecipe) continue
    // Only suggest things the kitchen actually knows about, or the list fills
    // with pairs the user can't act on.
    const known = entry.names.every((n) => bestMatch(n, stock, (i) => i.name))
    if (!known) continue

    out.push({
      names: entry.names.map(titleCase),
      reason: repeated
        ? `Used together on ${entry.days} different days`
        : 'Appear together in one of your recipes',
      weight: repeated ? 100 + entry.days : 10,
    })
  }

  return out.sort((a, b) => b.weight - a.weight || a.names[0].localeCompare(b.names[0])).slice(0, limit)
}

/** Turns an accepted suggestion into a real, editable combination. */
export function comboFromSuggestion(s: ComboSuggestion, stock: ItemView[], meal?: MealSlot): Omit<Combo, 'id'> {
  return {
    name: s.names.join(' + '),
    emoji: '🍽️',
    parts: s.names.map((name) => ({
      name,
      itemId: bestMatch(name, stock, (i) => i.name)?.id,
    })),
    meal,
    createdAt: todayISO(),
    timesUsed: 0,
    source: 'suggested',
  }
}
