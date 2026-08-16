import Dexie, { type Table } from 'dexie'
import type {
  Item, Reservation, Recipe, PlanEntry, ShopItem, Trip, LedgerEvent, Setting, Photo, StoragePlace,
  StorageCategory, MealSlot, MealDay, Combo,
} from './schema'

/**
 * Everything lives in IndexedDB. The tables are deliberately shaped so a hosted
 * backend could take over later: each row is self-contained and referenced by id,
 * with no derived state persisted (availability, spend and waste are all computed).
 */
class LarderDB extends Dexie {
  items!: Table<Item, number>
  reservations!: Table<Reservation, number>
  recipes!: Table<Recipe, number>
  plan!: Table<PlanEntry, number>
  shop!: Table<ShopItem, number>
  trips!: Table<Trip, number>
  events!: Table<LedgerEvent, number>
  settings!: Table<Setting, string>
  photos!: Table<Photo, number>
  places!: Table<StoragePlace, number>
  days!: Table<MealDay, number>
  cats!: Table<StorageCategory, number>
  combos!: Table<Combo, number>

  constructor() {
    super('larder')
    this.version(1).stores({
      items: '++id, name, category, location, expiresAt, isStaple, archived, tripId',
      reservations: '++id, itemId, planId',
      recipes: '++id, title, favorite, source',
      plan: '++id, date, slot, recipeId, status',
      shop: '++id, name, category, checked, source',
      trips: '++id, date',
      events: '++id, type, date, category, itemId',
      settings: 'key',
    })
    // v2 adds photos. Existing rows migrate untouched — `photoId` is optional.
    this.version(2).stores({
      items: '++id, name, category, location, expiresAt, isStaple, archived, tripId, barcode',
      photos: '++id, source',
    })
    // v3 makes storage locations editable. The table starts empty for existing
    // installs and is filled by ensurePlaces() at boot, which is idempotent —
    // safer than an upgrade hook that only runs on one specific version jump.
    this.version(3).stores({
      places: '++id, &key, order',
    })
    // v4 turns the meal tag from a multi-select array into a single category.
    // No index changes, just data: keep the first tag anyone had already
    // applied rather than silently dropping their work.
    this.version(4).stores({}).upgrade(async (tx) => {
      await tx.table('items').toCollection().modify((item: Item & { meals?: MealSlot[] }) => {
        if (!item.meal && Array.isArray(item.meals) && item.meals.length) {
          item.meal = item.meals[0]
        }
        delete item.meals
        // A snack has no main dish, so the combination can't survive the move.
        if (item.meal === 'snack') delete item.isMain
      })
    })
    // v5 records the meals that actually happened, behind the calendar's solid
    // days. `&[date+slot]` is unique on purpose: a day has one dinner, so
    // logging a second one has to replace the first rather than stack.
    this.version(5).stores({
      days: '++id, &[date+slot], date, slot, itemId',
    })
    // v6 makes food categories editable, the same move locations made in v3.
    // Starts empty and is filled by ensureCategories() at boot rather than by
    // an upgrade hook, so an install that skipped a version still gets seeded.
    this.version(6).stores({
      cats: '++id, &key, aisle',
    })
    // v7 adds combinations — sets of things used together. Parts live inline on
    // the row rather than in a join table: a combination is only ever read
    // whole, and there's nothing to query a single part by.
    this.version(7).stores({
      combos: '++id, name, meal',
    })
    // v8 stops hiding things that ran out. Everything previously auto-archived
    // is brought back, because the only way to get archived was to reach zero,
    // and an empty shelf is information rather than a reason to forget the item.
    this.version(8).stores({}).upgrade(async (tx) => {
      await tx.table('items').toCollection().modify((item: Item) => {
        if (item.archived) item.archived = false
      })
    })
  }
}

export const db = new LarderDB()

export async function getSetting(key: string, fallback = ''): Promise<string> {
  const row = await db.settings.get(key)
  return row?.value ?? fallback
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.settings.put({ key, value })
}
