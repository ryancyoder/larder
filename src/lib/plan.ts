import { db } from '../db/db'
import type { ItemView, MealSlot, PlanEntry, Recipe } from '../db/schema'
import { consume, consumeHoldsForPlan, releaseHoldsForPlan, reserve } from './inventory'
import { scoreRecipe } from './suggest'
import { householdKey } from './people'
import { todayISO } from './dates'

export const SLOTS: Array<{ key: MealSlot; label: string; emoji: string }> = [
  { key: 'breakfast', label: 'Breakfast', emoji: '🌅' },
  { key: 'lunch', label: 'Lunch', emoji: '🥪' },
  { key: 'dinner', label: 'Dinner', emoji: '🌙' },
  { key: 'snack', label: 'Snack', emoji: '🍿' },
]

/**
 * Schedules a meal and immediately puts a hold on whatever it needs that is
 * already in the kitchen — that's what makes an item show as "off limits".
 */
export async function planMeal(
  recipe: Recipe,
  date: string,
  slot: MealSlot,
  servings: number,
  stock: ItemView[],
): Promise<number> {
  const planId = await db.plan.add({
    date,
    slot,
    recipeId: recipe.id,
    title: recipe.title,
    servings,
    status: 'planned',
  })

  const scale = recipe.servings ? servings / recipe.servings : 1
  const { lines } = scoreRecipe(recipe, stock)
  // Planned meals are the household's — there's nobody to ask at this point,
  // and leaving them unassigned would be the one untagged hold in the app.
  const forHousehold = householdKey(await db.people.toArray())

  for (const line of lines) {
    if (!line.item || line.ingredient.optional) continue
    // With no comparable quantity, hold nothing — better than guessing wrong.
    if (line.needed == null) continue
    const want = line.needed * scale
    if (want <= 0) continue
    await reserve(line.item, want, recipe.title, planId, forHousehold)
  }

  return planId
}

export async function unplanMeal(entry: PlanEntry) {
  if (!entry.id) return
  await releaseHoldsForPlan(entry.id)
  await db.plan.delete(entry.id)
}

/**
 * Marks a planned meal cooked: reserved stock is consumed, anything else the
 * recipe needed and we own is deducted too, and the recipe's history updates.
 */
export async function cookPlan(entry: PlanEntry, recipe: Recipe | undefined, stock: ItemView[]) {
  if (!entry.id) return
  await consumeHoldsForPlan(entry.id, `Cooked ${entry.title}`)

  if (recipe) {
    const scale = recipe.servings ? entry.servings / recipe.servings : 1
    const { lines } = scoreRecipe(recipe, stock)
    for (const line of lines) {
      if (!line.item || line.ingredient.optional || line.needed == null) continue
      // Anything already covered by a hold was just consumed above.
      const heldForThisMeal = line.item.holds.some((h) => h.planId === entry.id)
      if (heldForThisMeal) continue
      const fresh = await db.items.get(line.item.id!)
      if (fresh) await consume(fresh, Math.min(line.needed * scale, fresh.qty), `Cooked ${entry.title}`)
    }
    if (recipe.id) {
      await db.recipes.update(recipe.id, {
        timesCooked: (recipe.timesCooked ?? 0) + 1,
        lastCookedAt: todayISO(),
      })
    }
  }

  await db.plan.update(entry.id, { status: 'cooked' })
}

/** Cooking straight from a recipe, with nothing scheduled. */
export async function cookNow(recipe: Recipe, servings: number, stock: ItemView[]): Promise<number> {
  const scale = recipe.servings ? servings / recipe.servings : 1
  const { lines } = scoreRecipe(recipe, stock)
  let deducted = 0

  for (const line of lines) {
    if (!line.item || line.ingredient.optional || line.needed == null) continue
    const fresh = await db.items.get(line.item.id!)
    if (!fresh || fresh.qty <= 0) continue
    await consume(fresh, Math.min(line.needed * scale, fresh.qty), `Cooked ${recipe.title}`)
    deducted++
  }

  if (recipe.id) {
    await db.recipes.update(recipe.id, {
      timesCooked: (recipe.timesCooked ?? 0) + 1,
      lastCookedAt: todayISO(),
    })
  }
  return deducted
}
