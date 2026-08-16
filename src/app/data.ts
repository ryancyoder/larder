import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { buildViews } from '../lib/inventory'
import { sortPlaces } from '../lib/locations'
import type { ItemView, LedgerEvent, MealDay, PlanEntry, Recipe, ShopItem, StoragePlace, Trip } from '../db/schema'

/** Live views over IndexedDB. Every screen reads through these, never the tables directly. */

export function useKitchen(): ItemView[] | undefined {
  return useLiveQuery(async () => {
    const [items, reservations] = await Promise.all([
      db.items.toArray(),
      db.reservations.toArray(),
    ])
    return buildViews(items.filter((i) => !i.archived), reservations)
  }, [])
}

/** Includes used-up staples (qty 0) so the shopping list can rebuy them. */
export function useAllStock(): ItemView[] | undefined {
  return useLiveQuery(async () => {
    const [items, reservations] = await Promise.all([db.items.toArray(), db.reservations.toArray()])
    return buildViews(items, reservations)
  }, [])
}

export function useRecipes(): Recipe[] | undefined {
  return useLiveQuery(() => db.recipes.toArray(), [])
}

export function usePlan(): PlanEntry[] | undefined {
  return useLiveQuery(() => db.plan.toArray(), [])
}

/** Meals that actually happened — the calendar's solid days. */
export function useMealDays(): MealDay[] | undefined {
  return useLiveQuery(() => db.days.toArray(), [])
}

export function useShopList(): ShopItem[] | undefined {
  return useLiveQuery(() => db.shop.toArray(), [])
}

export function useTrips(): Trip[] | undefined {
  return useLiveQuery(() => db.trips.toArray(), [])
}

export function useEvents(): LedgerEvent[] | undefined {
  return useLiveQuery(() => db.events.toArray(), [])
}

/** Always ordered — every screen renders locations in the user's chosen sequence. */
export function usePlaces(): StoragePlace[] | undefined {
  return useLiveQuery(async () => sortPlaces(await db.places.toArray()), [])
}

export function useSetting(key: string): string | undefined {
  return useLiveQuery(async () => (await db.settings.get(key))?.value ?? '', [key])
}
