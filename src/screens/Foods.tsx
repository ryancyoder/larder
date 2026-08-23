import { useMemo, useState } from 'react'
import type { ItemView, StorageKind, StoragePlace } from '../db/schema'
import { useKitchen, usePlaces } from '../app/data'
import {
  FOODS, FOOD_GROUPS, FORM_LABEL, foodForm, foodKeysMatching, groupMeta, matchFood,
  type Food, type FoodForm, type FoodGroupKey,
} from '../lib/foods'
import { formatAmount } from '../lib/units'
import { placeEmoji, placeLabel } from '../lib/locations'
import { Empty, Seg, Sheet } from '../components/ui'
import ItemSheet from '../components/ItemSheet'

/**
 * Browsing by food rather than by product.
 *
 * The kitchen screen answers "what is on the shelf" — every jar and packet,
 * named the way it was named. This one answers the question you actually have
 * while cooking: *have we got any carrots?* Fresh, canned and frozen carrots
 * are three products and one answer, and this is where they meet.
 *
 * Icons throughout, never product photos. See `foods.ts` for why.
 */

type Scope = 'have' | 'all'

interface Stocked {
  food: Food
  items: ItemView[]
  forms: FoodForm[]
  /** Whether any of it is actually there, as opposed to a row sitting at zero. */
  inStock: boolean
}

export default function Foods() {
  const items = useKitchen()
  const places = usePlaces() ?? []
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>('have')
  const [group, setGroup] = useState<FoodGroupKey | 'all'>('all')
  const [open, setOpen] = useState<Stocked | null>(null)

  /** Storage kind per location, so a form can be inferred from where it lives. */
  const kindOf = useMemo(() => {
    const map = new Map<string, StorageKind>()
    places.forEach((p) => map.set(p.key, p.kind))
    return map
  }, [places])

  /**
   * Products grouped under their food.
   *
   * Items filed at import keep their key; anything from before the library
   * existed is matched on the fly rather than left invisible, which also means
   * a food added to the library starts collecting old products immediately.
   */
  const byFood = useMemo(() => {
    const map = new Map<string, ItemView[]>()
    for (const item of items ?? []) {
      const key = item.foodKey ?? matchFood(item.name, item.brand)
      if (!key) continue
      const list = map.get(key)
      if (list) list.push(item)
      else map.set(key, [item])
    }
    return map
  }, [items])

  const shelf = useMemo<Stocked[]>(() => {
    return FOODS.map((food) => {
      const list = byFood.get(food.key) ?? []
      const forms: FoodForm[] = []
      for (const item of list) {
        const form = foodForm(item, kindOf.get(item.location))
        if (form && !forms.includes(form)) forms.push(form)
      }
      return { food, items: list, forms, inStock: list.some((i) => i.qty > 0) }
    })
  }, [byFood, kindOf])

  const visible = useMemo(() => {
    let list = shelf
    if (scope === 'have') list = list.filter((s) => s.items.length > 0)
    if (group !== 'all') list = list.filter((s) => s.food.group === group)
    const allowed = foodKeysMatching(query)
    if (allowed) list = list.filter((s) => allowed.has(s.food.key))
    // In stock first — the question is nearly always about what's here now.
    return [...list].sort((a, b) =>
      Number(b.inStock) - Number(a.inStock)
      || b.items.length - a.items.length
      || a.food.name.localeCompare(b.food.name))
  }, [shelf, scope, group, query])

  /** Only offer a group chip when there is something behind it. */
  const groups = useMemo(() => {
    const pool = scope === 'have' ? shelf.filter((s) => s.items.length > 0) : shelf
    const live = new Set(pool.map((s) => s.food.group))
    return FOOD_GROUPS.filter((g) => live.has(g.key))
  }, [shelf, scope])

  if (!items) return null

  const held = shelf.filter((s) => s.items.length > 0).length
  const stocked = shelf.filter((s) => s.inStock).length

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Foods</h1>
          <div className="sub">
            {stocked} of {FOODS.length} basic foods in the kitchen
            {held > stocked && (
              <> · <span style={{ color: 'var(--text-dim)' }}>{held - stocked} run out</span></>
            )}
          </div>
        </div>
      </div>

      <section className="section">
        <div className="row" style={{ marginBottom: 11 }}>
          <div className="search">
            <span className="icon">🔍</span>
            <input
              type="search"
              placeholder="Search foods — carrots, beef, beans…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        <Seg
          value={scope}
          onChange={setScope}
          options={[
            { value: 'have' as Scope, label: 'In my kitchen' },
            { value: 'all' as Scope, label: 'Whole library' },
          ]}
        />

        <div style={{ marginTop: 8 }}>
          <Seg
            value={group}
            onChange={setGroup}
            options={[
              { value: 'all' as FoodGroupKey | 'all', label: 'All groups' },
              ...groups.map((g) => ({ value: g.key as FoodGroupKey | 'all', label: `${g.icon} ${g.label}` })),
            ]}
          />
        </div>

        {visible.length === 0 ? (
          <Empty emoji="🥕" title={scope === 'have' ? 'Nothing filed yet' : 'No food by that name'}>
            {scope === 'have'
              ? 'Add something to the kitchen and it gets filed under its basic food automatically.'
              : 'The library covers everyday foods. Search a plainer word — "beef" rather than a cut.'}
          </Empty>
        ) : (
          <div className="food-grid">
            {visible.map((entry) => (
              <FoodTile key={entry.food.key} entry={entry} onOpen={() => setOpen(entry)} />
            ))}
          </div>
        )}
      </section>

      {open && (
        <FoodSheet
          entry={shelf.find((s) => s.food.key === open.food.key) ?? open}
          kindOf={kindOf}
          places={places}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  )
}

function FoodTile({ entry, onOpen }: { entry: Stocked; onOpen: () => void }) {
  const { food, items, forms, inStock } = entry
  const group = groupMeta(food.group)

  return (
    <button
      className={`food-tile${inStock ? '' : ' bare'}`}
      onClick={onOpen}
      aria-label={`${food.name}, ${items.length} in the kitchen`}
    >
      <span className="food-icon" aria-hidden>{food.icon}</span>
      <span className="food-name">{food.name}</span>
      {items.length > 0 ? (
        <span className="food-forms">
          {forms.length
            ? forms.map((f) => <span className="food-form" key={f}>{FORM_LABEL[f]}</span>)
            : <span className="food-form">{items.length} here</span>}
        </span>
      ) : (
        <span className="food-sub">{group.label}</span>
      )}
      {items.length > 1 && <span className="food-count">{items.length}</span>}
    </button>
  )
}

/** What you actually own of one food, grouped by the state it's kept in. */
function FoodSheet({
  entry, kindOf, places, onClose,
}: {
  entry: Stocked
  kindOf: Map<string, StorageKind>
  places: StoragePlace[]
  onClose: () => void
}) {
  const [picked, setPicked] = useState<ItemView | null>(null)
  const { food, items } = entry
  const group = groupMeta(food.group)

  const buckets = useMemo(() => {
    const map = new Map<string, ItemView[]>()
    for (const item of items) {
      const form = foodForm(item, kindOf.get(item.location))
      const label = form ? FORM_LABEL[form] : 'Other'
      const list = map.get(label)
      if (list) list.push(item)
      else map.set(label, [item])
    }
    // Anything you actually have first, then the empties.
    return [...map.entries()].sort((a, b) =>
      Number(b[1].some((i) => i.qty > 0)) - Number(a[1].some((i) => i.qty > 0))
      || a[0].localeCompare(b[0]))
  }, [items, kindOf])

  return (
    <>
      <Sheet title={food.name} onClose={onClose}>
        <div className="food-head">
          <span className="food-head-icon" aria-hidden>{food.icon}</span>
          <div>
            <div style={{ fontWeight: 650 }}>{food.name}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-mute)' }}>
              {group.icon} {group.label}
              {food.aka?.length ? ` · also ${food.aka.slice(0, 3).join(', ')}` : ''}
            </div>
          </div>
        </div>

        {items.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-mute)' }}>
            Nothing in the kitchen under {food.name.toLowerCase()} — in any form.
          </p>
        ) : (
          buckets.map(([label, list]) => (
            <div key={label} style={{ marginTop: 12 }}>
              <div className="food-bucket">{label}</div>
              {list.map((item) => (
                <button
                  key={item.id}
                  className={`food-row${item.qty > 0 ? '' : ' bare'}`}
                  onClick={() => setPicked(item)}
                >
                  <span className="food-row-name">{item.displayName}</span>
                  <span className="food-row-meta">
                    {placeEmoji(places, item.location)} {placeLabel(places, item.location)}
                  </span>
                  <span className="food-row-qty">
                    {item.qty > 0 ? formatAmount(item.available, item.unit) : 'run out'}
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
      </Sheet>

      {picked && <ItemSheet item={picked} onClose={() => setPicked(null)} />}
    </>
  )
}
