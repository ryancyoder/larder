import { useMemo, useState } from 'react'
import type { ItemView, MealSlot, Person, StorageLocation } from '../db/schema'
import { useCategories, useKitchen, usePeople, usePlaces } from '../app/data'
import { categoryMeta, sortCategories } from '../lib/categories'
import { foodMeta } from '../lib/foods'
import { expiringSoon, sortByUrgency } from '../lib/inventory'
import { formatAmount } from '../lib/units'
import { similarity } from '../lib/match'
import { SLOTS } from '../lib/plan'
import { personLabel } from '../lib/people'
import { CatDot, Empty, ExpiryChip, Field, Section, Seg, Sheet } from '../components/ui'
import AddItemSheet from '../components/AddItemSheet'
import ItemSheet from '../components/ItemSheet'
import BulkEditSheet from '../components/BulkEditSheet'
import KitchenTiles from './KitchenTiles'
import Unpack from './Unpack'

type Filter = 'all' | StorageLocation
type MealFilter = 'any' | MealSlot | 'main'
/**
 * Everything ever tracked stays in the kitchen, including what's run out — so
 * there has to be a way to ask for one or the other. "Run out" is the shopping
 * question; "In stock" is the cooking one.
 */
type StockFilter = 'all' | 'in' | 'out'
/** Whether any of it is spoken for — a different question to whether it exists. */
type HoldFilter = 'any' | 'reserved' | 'free'
/** How the list is carved up. Explicit, rather than inferred from the filters. */
type GroupBy = 'location' | 'category' | 'none'
/**
 * "Use by" is the app's reason for existing, so it stays the default. The two
 * alphabetical orders answer different questions: by item is "where is that
 * exact packet", by food is "what have we got in the way of onions", which
 * gathers every brand and form of a thing together.
 */
type SortBy = 'urgency' | 'item' | 'food'

/** Sort and grouping are set once and expected to stick. */
const PREF_KEY = 'larder-kitchen-view'
function readPref<T extends string>(field: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREF_KEY)
    const v = raw ? (JSON.parse(raw) as Record<string, string>)[field] : null
    return (v as T) ?? fallback
  } catch { return fallback }
}
function writePref(field: string, value: string) {
  try {
    const raw = localStorage.getItem(PREF_KEY)
    const all = raw ? (JSON.parse(raw) as Record<string, string>) : {}
    all[field] = value
    localStorage.setItem(PREF_KEY, JSON.stringify(all))
  } catch { /* private browsing; the session default is fine */ }
}

/** What a food-name sort compares on: the basic food, else the item's own name. */
function foodName(item: ItemView): string {
  return (foodMeta(item.foodKey)?.name ?? item.name).toLowerCase()
}

export default function Kitchen({ onOpenSettings }: { onOpenSettings: () => void }) {
  const items = useKitchen()
  const places = usePlaces() ?? []
  const cats = useCategories() ?? []
  const people = usePeople() ?? []
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [mealFilter, setMealFilter] = useState<MealFilter>('any')
  const [stock, setStock] = useState<StockFilter>('all')
  const [held, setHeld] = useState<HoldFilter>('any')
  const [group, setGroupRaw] = useState<GroupBy>(() => readPref<GroupBy>('group', 'location'))
  const [sort, setSortRaw] = useState<SortBy>(() => readPref<SortBy>('sort', 'urgency'))
  const [filtersOpen, setFiltersOpen] = useState(false)
  const setGroup = (g: GroupBy) => { setGroupRaw(g); writePref('group', g) }
  const setSort = (v: SortBy) => { setSortRaw(v); writePref('sort', v) }
  const [adding, setAdding] = useState(false)
  const [tiling, setTiling] = useState(false)
  const [unpacking, setUnpacking] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [selected, setSelected] = useState<ItemView | null>(null)

  const visible = useMemo(() => {
    if (!items) return []
    let list = items
    if (filter !== 'all') list = list.filter((i) => i.location === filter)
    if (mealFilter === 'main') list = list.filter((i) => i.isMain)
    else if (mealFilter !== 'any') list = list.filter((i) => i.meal === mealFilter)
    if (stock === 'in') list = list.filter((i) => i.qty > 0)
    else if (stock === 'out') list = list.filter((i) => i.qty <= 0)
    if (held === 'reserved') list = list.filter((i) => i.reserved > 0)
    else if (held === 'free') list = list.filter((i) => i.reserved === 0)
    if (query.trim()) {
      const q = query.trim()
      list = list.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()) || similarity(q, i.name) > 0.4)
    }
    const out = [...list]
    if (sort === 'item') return out.sort((a, b) => a.name.localeCompare(b.name))
    if (sort === 'food') {
      // Ties inside a food fall back to the item name, so the run of onions is
      // itself ordered rather than arbitrary.
      return out.sort((a, b) => foodName(a).localeCompare(foodName(b)) || a.name.localeCompare(b.name))
    }
    return out.sort(sortByUrgency)
  }, [items, filter, query, mealFilter, stock, held, sort])

  // Keep the open sheet in sync after an edit rather than showing stale numbers.
  const live = selected && items ? items.find((i) => i.id === selected.id) ?? null : null

  const urgent = items ? expiringSoon(items, 3) : []
  const emptyCount = items ? items.filter((i) => i.qty <= 0).length : 0
  const heldCount = items ? items.filter((i) => i.reserved > 0).length : 0

  /**
   * Grouping is now the reader's choice rather than something that quietly
   * switched itself off the moment a filter was touched — which made the list
   * reshape for reasons that were never stated.
   */
  const grouped = useMemo(() => {
    if (group === 'none') return null
    if (group === 'location') {
      return places
        .map((loc) => ({ key: loc.key, title: `${loc.emoji} ${loc.label}`, hint: loc.blurb, items: visible.filter((i) => i.location === loc.key) }))
        .filter((g) => g.items.length > 0)
    }
    const present = new Map<string, ItemView[]>()
    visible.forEach((i) => {
      const list = present.get(i.category) ?? []
      list.push(i)
      present.set(i.category, list)
    })
    return sortCategories(cats.filter((c) => present.has(c.key)))
      .map((c) => ({ key: c.key, title: `${c.emoji} ${c.label}`, hint: undefined, items: present.get(c.key)! }))
  }, [visible, group, places, cats])

  const activeFilters =
    (filter !== 'all' ? 1 : 0) + (mealFilter !== 'any' ? 1 : 0) +
    (stock !== 'all' ? 1 : 0) + (held !== 'any' ? 1 : 0)

  function clearFilters() {
    setFilter('all'); setMealFilter('any'); setStock('all'); setHeld('any')
  }

  const visibleIds = visible.map((i) => i.id!).filter((id) => id != null)
  const allPicked = visibleIds.length > 0 && visibleIds.every((id) => picked.has(id))

  function toggleSelecting() {
    setSelecting((on) => !on)
    setPicked(new Set())
  }

  /** In selection mode a tap picks the row; otherwise it opens it. */
  function open(item: ItemView) {
    if (!selecting) { setSelected(item); return }
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(item.id!)) next.delete(item.id!)
      else next.add(item.id!)
      return next
    })
  }

  /** Selects everything currently on screen, so filters double as a picker. */
  function toggleAllVisible() {
    setPicked((prev) => {
      if (allPicked) {
        const next = new Set(prev)
        visibleIds.forEach((id) => next.delete(id))
        return next
      }
      return new Set([...prev, ...visibleIds])
    })
  }

  if (!items) return null

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Kitchen</h1>
          <div className="sub">
            {items.length} items tracked
            {emptyCount > 0 && <> · <span style={{ color: 'var(--text-dim)' }}>{emptyCount} run out</span></>}
            {urgent.length > 0 && <> · <span style={{ color: 'var(--fresh-urgent)' }}>{urgent.length} need using</span></>}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {!selecting && (
            <>
              <button className="btn sm" onClick={() => setUnpacking(true)}>📷 Unpack</button>
              <button className="btn sm" onClick={() => setTiling(true)}>▦ Tiles</button>
            </>
          )}
          <button className="btn ghost sm" onClick={toggleSelecting}>
            {selecting ? 'Done' : 'Select'}
          </button>
          {!selecting && <button className="btn ghost sm" onClick={onOpenSettings}>Settings</button>}
        </div>
      </div>

      {/* One toolbar. Four stacked segmented bars pushed the actual stock off
          the screen; the three least-used filters now live behind a button that
          says how many are on. */}
      <section className="section">
        <div className="ktools">
          <div className="search">
            <span className="icon">🔍</span>
            <input
              type="search"
              placeholder="Search the kitchen…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button
            className={`btn sm${activeFilters ? ' primary' : ''}`}
            onClick={() => setFiltersOpen(true)}
          >
            Filters{activeFilters ? ` (${activeFilters})` : ''}
          </button>
          <label className="ksel">
            <span>Group</span>
            <select value={group} onChange={(e) => setGroup(e.target.value as GroupBy)}>
              <option value="location">Location</option>
              <option value="category">Category</option>
              <option value="none">None</option>
            </select>
          </label>
          <label className="ksel">
            <span>Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortBy)}>
              <option value="urgency">Use by</option>
              <option value="item">Item A–Z</option>
              <option value="food">Food A–Z</option>
            </select>
          </label>
        </div>
      </section>

      {filtersOpen && (
        <Sheet
          title="Filters"
          onClose={() => setFiltersOpen(false)}
          footer={
            <>
              <button className="btn ghost" onClick={clearFilters} disabled={!activeFilters}>
                Clear all
              </button>
              <button className="btn primary" onClick={() => setFiltersOpen(false)}>Done</button>
            </>
          }
        >
          <Field label="Location">
            <Seg
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all' as Filter, label: 'Everywhere' },
                ...places.map((l) => ({ value: l.key as Filter, label: `${l.emoji} ${l.label}` })),
              ]}
            />
          </Field>
          <Field label="Meal">
            <Seg
              value={mealFilter}
              onChange={setMealFilter}
              options={[
                { value: 'any' as MealFilter, label: 'Any' },
                ...SLOTS.map((sl) => ({ value: sl.key as MealFilter, label: `${sl.emoji} ${sl.label}` })),
                { value: 'main' as MealFilter, label: '🍽️ Mains' },
              ]}
            />
          </Field>
          <Field label="Stock">
            <Seg
              value={stock}
              onChange={setStock}
              options={[
                { value: 'all' as StockFilter, label: 'All' },
                { value: 'in' as StockFilter, label: 'In stock' },
                { value: 'out' as StockFilter, label: `Run out${emptyCount ? ` (${emptyCount})` : ''}` },
              ]}
            />
          </Field>
          <Field label="Set aside">
            <Seg
              value={held}
              onChange={setHeld}
              options={[
                { value: 'any' as HoldFilter, label: 'Any' },
                { value: 'reserved' as HoldFilter, label: `🔒 Reserved${heldCount ? ` (${heldCount})` : ''}` },
                { value: 'free' as HoldFilter, label: 'Free' },
              ]}
            />
          </Field>
        </Sheet>
      )}

      {selecting && (
        <section className="section" style={{ marginTop: 12 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={toggleAllVisible}>
              {allPicked ? 'Deselect these' : `Select all ${visibleIds.length}`}
            </button>
            {picked.size > 0 && (
              <button className="btn ghost sm" onClick={() => setPicked(new Set())}>Clear</button>
            )}
            <span style={{ fontSize: 12.5, color: 'var(--text-mute)' }}>
              Filter first, then select all — that's the quick way to tag a whole shelf.
            </span>
          </div>
        </section>
      )}

      {visible.length === 0 ? (
        <div className="section">
          <Empty emoji="🫙" title={query ? 'Nothing matches that' : 'This spot is empty'}>
            {query ? 'Try a shorter search, or add it as a new item.' : 'Tap the + button to put something in.'}
          </Empty>
        </div>
      ) : grouped ? (
        grouped.map((g) => (
          <Section key={g.key} title={g.title} hint={g.hint}>
            <ItemTable items={g.items} people={people} selecting={selecting} picked={picked} onOpen={open} />
          </Section>
        ))
      ) : (
        <div className="section">
          <ItemTable items={visible} people={people} selecting={selecting} picked={picked} onOpen={open} />
        </div>
      )}

      {!selecting && <button className="fab" onClick={() => setAdding(true)} aria-label="Add an item">+</button>}

      {selecting && picked.size > 0 && (
        <div className="bulk-bar">
          <span className="bulk-count">{picked.size} selected</span>
          <button className="btn primary" onClick={() => setBulkOpen(true)}>Edit selected</button>
        </div>
      )}

      {bulkOpen && (
        <BulkEditSheet
          ids={[...picked]}
          onClose={() => setBulkOpen(false)}
          onDone={() => { setBulkOpen(false); setSelecting(false); setPicked(new Set()) }}
        />
      )}

      {adding && (
        <AddItemSheet
          onClose={() => setAdding(false)}
          // Whatever the list is narrowed to is what you're most likely adding.
          // 'main' is skipped: a main dish needs a meal, and the filter doesn't
          // say which one.
          defaultLocation={filter === 'all' ? undefined : filter}
          defaultMeal={mealFilter === 'any' || mealFilter === 'main' ? undefined : mealFilter}
        />
      )}
      {live && <ItemSheet item={live} onClose={() => setSelected(null)} />}
      {tiling && <KitchenTiles onClose={() => setTiling(false)} />}
      {unpacking && <Unpack onClose={() => setUnpacking(false)} />}
    </>
  )
}

/**
 * Who the holds on an item are for. Several people can have a claim on the same
 * jar, so this lists them; two is the point at which names stop fitting a chip.
 */
function heldFor(item: ItemView, people: Person[]): string {
  const names = [...new Set(item.holds.map((h) => personLabel(people, h.personKey)))]
  if (names.length <= 2) return names.join(' & ')
  return `${names.length} people`
}

/**
 * One line of the kitchen table.
 *
 * A table rather than cards: the point of this screen is scanning a shelf's
 * worth of stock, and aligned columns are read down far faster than repeated
 * blocks of prose. The narrow columns collapse on a phone, where only the name,
 * the date and the amount fit — those being the three you actually scan for.
 */
function ItemRow({ item, people, onClick, selecting, picked }: {
  item: ItemView
  people: Person[]
  onClick: () => void
  selecting?: boolean
  picked?: boolean
}) {
  const meta = categoryMeta(item.category)
  const low = item.isStaple && item.available < (item.parQty ?? 0)
  return (
    <tr
      className={`krow${item.reserved > 0 ? ' held' : ''}${picked ? ' picked' : ''}${item.qty <= 0 ? ' spent' : ''}`}
      onClick={onClick}
      aria-selected={selecting ? Boolean(picked) : undefined}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
    >
      {selecting && (
        <td className="k-pick">
          <span className={`pick-box${picked ? ' on' : ''}`} aria-hidden>{picked ? '✓' : ''}</span>
        </td>
      )}
      <td className="k-name">
        <span className="nm">{item.name}</span>
        {item.reserved > 0 && (
          <span className="chip tone-hold">
            <span className="dot" />
            {formatAmount(item.reserved, item.unit)} for {heldFor(item, people)}
          </span>
        )}
        {low && <span className="chip tone-urgent"><span className="dot" />low</span>}
        {item.isMain && <span className="chip"><span className="dot" style={{ background: 'var(--warn)' }} />main</span>}
      </td>
      <td className="k-cat">
        <CatDot category={item.category} />
        <span>{meta.label}</span>
      </td>
      <td className="k-when"><ExpiryChip item={item} /></td>
      <td className="k-qty">
        {formatAmount(item.available, item.unit)}
        {item.reserved > 0 && <small>of {formatAmount(item.qty, item.unit)}</small>}
      </td>
    </tr>
  )
}

/** The table shell, so the grouped and ungrouped lists stay identical. */
function ItemTable({ items, people, selecting, picked, onOpen }: {
  items: ItemView[]
  people: Person[]
  selecting: boolean
  picked: Set<number>
  onOpen: (item: ItemView) => void
}) {
  return (
    <div className="ktable-wrap">
      <table className="ktable">
        <thead>
          <tr>
            {selecting && <th className="k-pick" aria-label="Selected" />}
            <th className="k-name">Item</th>
            <th className="k-cat">Category</th>
            <th className="k-when">Use by</th>
            <th className="k-qty">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              people={people}
              selecting={selecting}
              picked={picked.has(item.id!)}
              onClick={() => onOpen(item)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
