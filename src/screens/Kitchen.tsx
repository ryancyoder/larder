import { useMemo, useState } from 'react'
import type { ItemView, MealSlot, Person, StorageLocation } from '../db/schema'
import { useKitchen, usePeople, usePlaces } from '../app/data'
import { categoryMeta } from '../lib/categories'
import { expiringSoon, freshnessOf, sortByUrgency, unitPrice } from '../lib/inventory'
import { formatAmount } from '../lib/units'
import { similarity } from '../lib/match'
import { SLOTS } from '../lib/plan'
import { personLabel } from '../lib/people'
import { CatDot, Empty, ExpiryChip, FreshnessRing, Section, Seg } from '../components/ui'
import AddItemSheet from '../components/AddItemSheet'
import ItemSheet from '../components/ItemSheet'
import BulkEditSheet from '../components/BulkEditSheet'
import KitchenTiles from './KitchenTiles'

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

export default function Kitchen({ onOpenSettings }: { onOpenSettings: () => void }) {
  const items = useKitchen()
  const places = usePlaces() ?? []
  const people = usePeople() ?? []
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [mealFilter, setMealFilter] = useState<MealFilter>('any')
  const [stock, setStock] = useState<StockFilter>('all')
  const [held, setHeld] = useState<HoldFilter>('any')
  const [adding, setAdding] = useState(false)
  const [tiling, setTiling] = useState(false)
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
    return [...list].sort(sortByUrgency)
  }, [items, filter, query, mealFilter, stock, held])

  // Keep the open sheet in sync after an edit rather than showing stale numbers.
  const live = selected && items ? items.find((i) => i.id === selected.id) ?? null : null

  const urgent = items ? expiringSoon(items, 3) : []
  const emptyCount = items ? items.filter((i) => i.qty <= 0).length : 0
  const heldCount = items ? items.filter((i) => i.reserved > 0).length : 0
  const atRisk = urgent.reduce((sum, i) => sum + unitPrice(i) * i.available, 0)

  const grouped = useMemo(() => {
    if (filter !== 'all' || query.trim() || mealFilter !== 'any' || stock !== 'all' || held !== 'any') return null
    return places.map((loc) => ({
      loc,
      items: visible.filter((i) => i.location === loc.key),
    })).filter((g) => g.items.length > 0)
  }, [visible, filter, query, mealFilter, stock, held, places])

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
            <button className="btn sm" onClick={() => setTiling(true)}>▦ Tiles</button>
          )}
          <button className="btn ghost sm" onClick={toggleSelecting}>
            {selecting ? 'Done' : 'Select'}
          </button>
          {!selecting && <button className="btn ghost sm" onClick={onOpenSettings}>Settings</button>}
        </div>
      </div>

      {urgent.length > 0 && !selecting && (
        <Section
          title="Eat me first"
          hint={atRisk > 0 ? `$${atRisk.toFixed(2)} at risk` : undefined}
        >
          <div className="scroll-x">
            {urgent.map((item) => {
              const f = freshnessOf(item)
              return (
                <button
                  key={item.id}
                  className="card card-pad"
                  style={{
                    width: 148, textAlign: 'left', animation: 'fadeUp .34s var(--ease) both',
                    display: 'flex', flexDirection: 'column',
                  }}
                  onClick={() => setSelected(item)}
                >
                  <FreshnessRing item={item} />
                  <div style={{ fontWeight: 650, marginTop: 10, fontSize: 14, lineHeight: 1.25 }}>{item.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 3 }}>
                    {formatAmount(item.available, item.unit)} free
                  </div>
                  {/* Pushes the countdown chip to a common baseline across cards. */}
                  <div style={{ marginTop: 'auto', paddingTop: 10 }}>
                    <span className={`chip tone-${f.state}`}>
                      <span className="dot" />
                      {f.state === 'expired' ? 'Past date' : f.days === 0 ? 'Today' : f.days === 1 ? 'Tomorrow' : `${f.days} days`}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </Section>
      )}

      <section className="section">
        <div className="row" style={{ marginBottom: 11, gap: 9 }}>
          <div className="search">
            <span className="icon">🔍</span>
            <input
              type="search"
              placeholder="Search the kitchen…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <Seg
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all' as Filter, label: 'Everything' },
            ...places.map((l) => ({ value: l.key as Filter, label: `${l.emoji} ${l.label}` })),
          ]}
        />
        <div style={{ marginTop: 8 }}>
          <Seg
            value={mealFilter}
            onChange={setMealFilter}
            options={[
              { value: 'any' as MealFilter, label: 'Any meal' },
              ...SLOTS.map((sl) => ({ value: sl.key as MealFilter, label: `${sl.emoji} ${sl.label}` })),
              { value: 'main' as MealFilter, label: '🍽️ Mains' },
            ]}
          />
        </div>
        <div style={{ marginTop: 8 }}>
          <Seg
            value={stock}
            onChange={setStock}
            options={[
              { value: 'all' as StockFilter, label: 'All' },
              { value: 'in' as StockFilter, label: 'In stock' },
              { value: 'out' as StockFilter, label: `Run out${emptyCount ? ` (${emptyCount})` : ''}` },
            ]}
          />
        </div>
        <div style={{ marginTop: 8 }}>
          <Seg
            value={held}
            onChange={setHeld}
            options={[
              { value: 'any' as HoldFilter, label: 'Any' },
              { value: 'reserved' as HoldFilter, label: `🔒 Set aside${heldCount ? ` (${heldCount})` : ''}` },
              { value: 'free' as HoldFilter, label: 'Free' },
            ]}
          />
        </div>
      </section>

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
          <Section key={g.loc.key} title={`${g.loc.emoji} ${g.loc.label}`} hint={g.loc.blurb}>
            <div className="stack auto-cols">
              {g.items.map((item, i) => <ItemRow key={item.id} item={item} index={i} people={people} selecting={selecting} picked={picked.has(item.id!)} onClick={() => open(item)} />)}
            </div>
          </Section>
        ))
      ) : (
        <div className="section">
          <div className="stack auto-cols">
            {visible.map((item, i) => <ItemRow key={item.id} item={item} index={i} people={people} selecting={selecting} picked={picked.has(item.id!)} onClick={() => open(item)} />)}
          </div>
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

function ItemRow({ item, index, people, onClick, selecting, picked }: {
  item: ItemView
  index: number
  people: Person[]
  onClick: () => void
  selecting?: boolean
  picked?: boolean
}) {
  const meta = categoryMeta(item.category)
  return (
    <button
      className={`item${item.reserved > 0 ? ' held' : ''}${picked ? ' picked' : ''}${item.qty <= 0 ? ' spent' : ''}`}
      onClick={onClick}
      aria-pressed={selecting ? Boolean(picked) : undefined}
      style={{ animationDelay: `${Math.min(index, 10) * 22}ms` }}
    >
      {selecting && (
        <span className={`pick-box${picked ? ' on' : ''}`} aria-hidden>{picked ? '✓' : ''}</span>
      )}
      <FreshnessRing item={item} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="name">{item.name}</div>
        <div className="meta">
          <CatDot category={item.category} />
          <span>{meta.label}</span>
          <ExpiryChip item={item} />
          {item.reserved > 0 && (
            <span className="chip tone-hold">
              <span className="dot" />
              {formatAmount(item.reserved, item.unit)} for {heldFor(item, people)}
            </span>
          )}
          {item.isMain && <span className="chip"><span className="dot" style={{ background: 'var(--warn)' }} />main</span>}
          {item.size && item.sizeUnit && (
            <span>· {formatAmount(item.size, item.sizeUnit)} each</span>
          )}
          {item.isStaple && item.available < (item.parQty ?? 0) && (
            <span className="chip tone-urgent"><span className="dot" />running low</span>
          )}
        </div>
      </div>
      <div className="qty">
        {formatAmount(item.available, item.unit)}
        {item.reserved > 0 && <small>of {formatAmount(item.qty, item.unit)}</small>}
      </div>
    </button>
  )
}
