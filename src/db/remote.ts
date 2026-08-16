import { supabase } from '../lib/supabase'

/**
 * Postgres behind the API the app already speaks.
 *
 * The app has called `db.items.update(id, patch)` and `useLiveQuery(...)` from
 * the first version. Rewriting twenty-five files to speak REST directly would
 * be a large change with a large blast radius for no behavioural gain, so this
 * presents the same surface and talks to Supabase underneath.
 *
 * Two things are genuinely different, and both matter:
 *
 *   * `transaction()` no longer makes anything atomic. PostgREST has no
 *     multi-statement transaction, so a group of writes can now fail halfway.
 *     The ledger writes are the ones where that would hurt, and they're marked.
 *   * Every row carries `household_id`, filled in on write and never sent by
 *     callers. Row-level security would reject a row without it anyway.
 */

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

let householdId: number | null = null

export function setHouseholdId(id: number | null): void {
  householdId = id
  bump()
}

export function getHouseholdId(): number | null {
  return householdId
}

function requireHousehold(): number {
  if (householdId == null) {
    throw new Error('Not signed in to a household yet.')
  }
  return householdId
}

// ---------------------------------------------------------------------------
// Change notification
//
// One counter for the whole database rather than per-table subscriptions.
// The data here is small — a few hundred rows — so re-reading everything after
// any change is cheaper than the bookkeeping needed to be precise about it,
// and it cannot go stale in the ways a finer-grained scheme can.
// ---------------------------------------------------------------------------

type Listener = () => void
const listeners = new Set<Listener>()
let version = 0

export function bump(): void {
  version++
  for (const fn of listeners) fn()
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getVersion(): number {
  return version
}

/**
 * Realtime, so a change made on the iPad shows up on the phone.
 *
 * Local writes bump the counter themselves rather than waiting for the round
 * trip, so the device making a change never sees lag on its own edit.
 */
export function watchRemoteChanges(): () => void {
  const channel = supabase
    .channel('larder-any-change')
    .on('postgres_changes', { event: '*', schema: 'public' }, () => bump())
    .subscribe()
  return () => { void supabase.removeChannel(channel) }
}

// ---------------------------------------------------------------------------
// Column naming
//
// Postgres is snake_case, the domain types are camelCase. Mapping is explicit
// per table rather than automatic: a generic converter would silently mangle
// anything that doesn't round-trip, and a wrong column name fails as a runtime
// error rather than a type error.
// ---------------------------------------------------------------------------

type FieldMap = Record<string, string>

const MAPS: Record<string, FieldMap> = {
  items: {
    photoId: 'photo_id', qtyInitial: 'qty_initial', sizeUnit: 'size_unit',
    purchasedAt: 'purchased_at', expiresAt: 'expires_at', openedAt: 'opened_at',
    isMain: 'is_main', isStaple: 'is_staple', parQty: 'par_qty', tripId: 'trip_id',
  },
  reservations: {
    itemId: 'item_id', planId: 'plan_id', personKey: 'person_key', createdAt: 'created_at',
  },
  recipes: {
    prepMin: 'prep_min', cookMin: 'cook_min', createdAt: 'created_at',
    lastCookedAt: 'last_cooked_at', timesCooked: 'times_cooked',
  },
  plan_entries: { recipeId: 'recipe_id' },
  meal_days: { itemId: 'item_id', createdAt: 'created_at' },
  shop_items: { estPrice: 'est_price', itemId: 'item_id' },
  trips: { itemCount: 'item_count' },
  ledger_events: { itemId: 'item_id' },
  photos: {
    fullPath: 'full_path', thumbPath: 'thumb_path', remoteUrl: 'remote_url',
    createdAt: 'created_at',
  },
  places: { photoId: 'photo_id' },
  categories: { photoId: 'photo_id', homeKind: 'home_kind', shelfLife: 'shelf_life' },
  combos: {
    photoId: 'photo_id', createdAt: 'created_at', timesUsed: 'times_used',
    lastUsedAt: 'last_used_at',
  },
  people: {},
  settings: {},
}

function toRow(table: string, obj: Record<string, unknown>): Record<string, unknown> {
  const map = MAPS[table] ?? {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'id') continue
    // `order` is a reserved word, quoted in the schema and passed through as-is.
    out[map[key] ?? key] = value
  }
  return out
}

function fromRow<T>(table: string, row: Record<string, unknown>): T {
  const map = MAPS[table] ?? {}
  const back = Object.fromEntries(Object.entries(map).map(([camel, snake]) => [snake, camel]))
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (key === 'household_id') continue
    // Undefined reads better than null through code that checks `?? fallback`.
    out[back[key] ?? key] = value === null ? undefined : value
  }
  return out as T
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

class WhereClause<T> {
  constructor(
    private table: string,
    private column: string,
    private value: unknown,
  ) {}

  private query() {
    return supabase
      .from(this.table)
      .select('*')
      .eq('household_id', requireHousehold())
      .eq(this.column, this.value as never)
  }

  async toArray(): Promise<T[]> {
    const { data, error } = await this.query()
    if (error) throw error
    return (data ?? []).map((r) => fromRow<T>(this.table, r))
  }

  async count(): Promise<number> {
    const { count, error } = await supabase
      .from(this.table)
      .select('*', { count: 'exact', head: true })
      .eq('household_id', requireHousehold())
      .eq(this.column, this.value as never)
    if (error) throw error
    return count ?? 0
  }

  async delete(): Promise<void> {
    const { error } = await supabase
      .from(this.table)
      .delete()
      .eq('household_id', requireHousehold())
      .eq(this.column, this.value as never)
    if (error) throw error
    bump()
  }

  async first(): Promise<T | undefined> {
    const { data, error } = await this.query().limit(1).maybeSingle()
    if (error) throw error
    return data ? fromRow<T>(this.table, data) : undefined
  }

  /** Dexie's `modify` with a patch object; the callback form isn't used here. */
  async modify(patch: Partial<T>): Promise<void> {
    const { error } = await supabase
      .from(this.table)
      .update(toRow(this.table, patch as Record<string, unknown>))
      .eq('household_id', requireHousehold())
      .eq(this.column, this.value as never)
    if (error) throw error
    bump()
  }
}

class Table<T extends { id?: number }> {
  /**
   * @param conflict Columns that make a row unique besides the id, for tables
   *   where `put` means "replace whatever is already at this slot" — a day has
   *   one dinner, so logging a second has to replace the first.
   */
  constructor(public readonly name: string, private conflict?: string) {}

  async toArray(): Promise<T[]> {
    const { data, error } = await supabase
      .from(this.name)
      .select('*')
      .eq('household_id', requireHousehold())
    if (error) throw error
    return (data ?? []).map((r) => fromRow<T>(this.name, r))
  }

  async get(id: number): Promise<T | undefined> {
    const { data, error } = await supabase
      .from(this.name)
      .select('*')
      .eq('household_id', requireHousehold())
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    return data ? fromRow<T>(this.name, data) : undefined
  }

  async add(row: Omit<T, 'id'> | T): Promise<number> {
    const { data, error } = await supabase
      .from(this.name)
      .insert({ ...toRow(this.name, row as Record<string, unknown>), household_id: requireHousehold() })
      .select('id')
      .single()
    if (error) throw error
    bump()
    return data.id as number
  }

  async bulkAdd(rows: Array<Omit<T, 'id'> | T>): Promise<void> {
    if (!rows.length) return
    const household = requireHousehold()
    const { error } = await supabase
      .from(this.name)
      .insert(rows.map((r) => ({
        ...toRow(this.name, r as Record<string, unknown>),
        household_id: household,
      })))
    if (error) throw error
    bump()
  }

  async update(id: number, patch: Partial<T>): Promise<void> {
    const { error } = await supabase
      .from(this.name)
      .update(toRow(this.name, patch as Record<string, unknown>))
      .eq('household_id', requireHousehold())
      .eq('id', id)
    if (error) throw error
    bump()
  }

  /** Insert, or replace what's there: by id when it has one, else by conflict. */
  async put(row: T): Promise<number> {
    if (row.id != null) {
      await this.update(row.id, row)
      return row.id
    }
    if (!this.conflict) return this.add(row)

    const { data, error } = await supabase
      .from(this.name)
      .upsert(
        { ...toRow(this.name, row as Record<string, unknown>), household_id: requireHousehold() },
        { onConflict: this.conflict },
      )
      .select('id')
      .single()
    if (error) throw error
    bump()
    return data.id as number
  }

  async delete(id: number): Promise<void> {
    const { error } = await supabase
      .from(this.name)
      .delete()
      .eq('household_id', requireHousehold())
      .eq('id', id)
    if (error) throw error
    bump()
  }

  async bulkDelete(ids: number[]): Promise<void> {
    if (!ids.length) return
    const { error } = await supabase
      .from(this.name)
      .delete()
      .eq('household_id', requireHousehold())
      .in('id', ids)
    if (error) throw error
    bump()
  }

  async clear(): Promise<void> {
    const { error } = await supabase
      .from(this.name)
      .delete()
      .eq('household_id', requireHousehold())
    if (error) throw error
    bump()
  }

  async count(): Promise<number> {
    const { count, error } = await supabase
      .from(this.name)
      .select('*', { count: 'exact', head: true })
      .eq('household_id', requireHousehold())
    if (error) throw error
    return count ?? 0
  }

  /** `where('location').equals('fridge')`, the shape the call sites already use. */
  where(column: string): BoundWhere<T> {
    const map = MAPS[this.name] ?? {}
    return new BoundWhere<T>(this.name, map[column] ?? column)
  }
}

/** The column is known before the value is, so binding happens in two steps. */
class BoundWhere<T> {
  constructor(private table: string, private column: string) {}
  equals(value: unknown): WhereClause<T> {
    return new WhereClause<T>(this.table, this.column, value)
  }
}

export { Table, BoundWhere, WhereClause, toRow, fromRow }
