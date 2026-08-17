import { supabase } from '../lib/supabase'
import { Table, bump, getHouseholdId } from './remote'
import type {
  Item, Reservation, Recipe, PlanEntry, ShopItem, Trip, LedgerEvent, Photo, StoragePlace,
  StorageCategory, MealDay, Combo, Person, Setting, InboxItem,
} from './schema'

/**
 * The database, now Postgres.
 *
 * Deliberately the same shape the app has always imported — `db.items.get(id)`,
 * `db.events.add(...)` — so the swap from IndexedDB reached the storage layer
 * and stopped there rather than rippling through every screen.
 *
 * The names on the left are the app's; the strings are the real tables. They
 * differ where the old IndexedDB names were abbreviations that read badly in
 * SQL: `cats` is not a word, and `plan` is a poor name for a table of entries.
 */
class LarderDB {
  items = new Table<Item>('items')
  reservations = new Table<Reservation>('reservations')
  recipes = new Table<Recipe>('recipes')
  plan = new Table<PlanEntry>('plan_entries')
  shop = new Table<ShopItem>('shop_items')
  trips = new Table<Trip>('trips')
  events = new Table<LedgerEvent>('ledger_events')
  photos = new Table<Photo>('photos')
  places = new Table<StoragePlace>('places')
  cats = new Table<StorageCategory>('categories')
  combos = new Table<Combo>('combos')
  // A day has one dinner, so writing a second replaces the first.
  days = new Table<MealDay>('meal_days', 'household_id,date,slot')
  people = new Table<Person>('people')
  inbox = new Table<InboxItem>('inbox_items')
  settings = new SettingsTable()

  /**
   * Runs the work. Notably **not** a transaction any more.
   *
   * PostgREST has no multi-statement transaction, so the calls inside can now
   * fail independently — a consume could reduce a quantity and then fail to
   * write its ledger event. Kept as a wrapper rather than deleted so the call
   * sites still read as one operation, and so there is a single place to move
   * to a Postgres function if a partial failure ever actually bites.
   */
  async transaction<T>(_mode: string, ...args: unknown[]): Promise<T> {
    const work = args[args.length - 1] as () => Promise<T>
    const result = await work()
    bump()
    return result
  }
}

/**
 * Settings are keyed by name rather than by id, so they get a small table of
 * their own rather than being bent into the shape above.
 */
class SettingsTable {
  async get(key: string): Promise<Setting | undefined> {
    const household = getHouseholdId()
    if (household == null) return undefined
    const { data, error } = await supabase
      .from('settings')
      .select('key,value')
      .eq('household_id', household)
      .eq('key', key)
      .maybeSingle()
    if (error) throw error
    return data ?? undefined
  }

  async put(row: Setting): Promise<void> {
    const household = getHouseholdId()
    if (household == null) return
    const { error } = await supabase
      .from('settings')
      .upsert({ ...row, household_id: household }, { onConflict: 'household_id,key' })
    if (error) throw error
    bump()
  }

  async clear(): Promise<void> {
    const household = getHouseholdId()
    if (household == null) return
    const { error } = await supabase.from('settings').delete().eq('household_id', household)
    if (error) throw error
    bump()
  }
}

export const db = new LarderDB()

/**
 * Settings are keyed by name rather than by id, so they don't fit the table
 * shape above and get their own pair of functions — which is all the app ever
 * used them through anyway.
 */
export async function getSetting(key: string, fallback = ''): Promise<string> {
  const household = getHouseholdId()
  if (household == null) return fallback
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('household_id', household)
    .eq('key', key)
    .maybeSingle()
  if (error) throw error
  return data?.value ?? fallback
}

export async function setSetting(key: string, value: string): Promise<void> {
  const household = getHouseholdId()
  if (household == null) return
  const { error } = await supabase
    .from('settings')
    .upsert({ household_id: household, key, value }, { onConflict: 'household_id,key' })
  if (error) throw error
  bump()
}
