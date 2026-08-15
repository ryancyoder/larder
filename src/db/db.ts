import Dexie, { type Table } from 'dexie'
import type {
  Item, Reservation, Recipe, PlanEntry, ShopItem, Trip, LedgerEvent, Setting, Photo,
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
