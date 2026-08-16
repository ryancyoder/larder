import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ItemView, StoragePlace } from '../db/schema'
import { useKitchen, usePlaces, useShopList } from '../app/data'
import { usePhoto } from '../app/usePhoto'
import { categoryMeta } from '../lib/categories'
import { freshnessOf, sortByUrgency } from '../lib/inventory'
import { formatAmount } from '../lib/units'
import { similarity } from '../lib/match'
import { bumpShopLine, clearShopLine, shopQtyFor } from '../lib/shopping'
import { Seg } from '../components/ui'

/**
 * Walk-the-kitchen mode: a chrome-free grid of big targets, tapped once per
 * thing you need. Locations first, like photo albums, then the shelf itself.
 *
 * Deliberately not a screen in the tab bar — it's a task you enter, blitz
 * through with one thumb, and leave.
 */

type Filter = 'all' | 'low' | 'expiring' | 'staples'
type Sort = 'name' | 'low' | 'expiring'
type TileSize = 'regular' | 'large'

const SIZE_KEY = 'larder-tile-size'

function readSize(): TileSize {
  try {
    return localStorage.getItem(SIZE_KEY) === 'large' ? 'large' : 'regular'
  } catch {
    return 'regular'
  }
}

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'low', label: 'Low' },
  { value: 'expiring', label: 'Expiring' },
  { value: 'staples', label: 'Staples' },
]

const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'name', label: 'A–Z' },
  { value: 'low', label: 'Emptiest' },
  { value: 'expiring', label: 'Soonest' },
]

function isLow(item: ItemView): boolean {
  if (item.available <= 0) return true
  return Boolean(item.isStaple && item.parQty && item.available < item.parQty)
}

function isExpiring(item: ItemView): boolean {
  const f = freshnessOf(item)
  return f.days !== null && f.days <= 5
}

/** 0 = empty, 1 = full. Staples measure against par; everything else against what it came in as. */
function fillRatio(item: ItemView): number {
  const denominator = item.isStaple && item.parQty ? item.parQty : item.qtyInitial || 1
  return Math.max(0, Math.min(1, item.available / denominator))
}

export default function QuickAdd({ onClose }: { onClose: () => void }) {
  const items = useKitchen()
  const places = usePlaces()
  const list = useShopList()

  const [placeKey, setPlaceKey] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('name')
  const [query, setQuery] = useState('')
  const [size, setSize] = useState<TileSize>(readSize)

  function toggleSize() {
    const next: TileSize = size === 'regular' ? 'large' : 'regular'
    setSize(next)
    try {
      localStorage.setItem(SIZE_KEY, next)
    } catch {
      // Not persisting is survivable — the session still respects the choice.
    }
  }

  const place = places?.find((p) => p.key === placeKey)
  const basket = list?.filter((l) => !l.checked).length ?? 0

  const visible = useMemo(() => {
    if (!items) return []
    let out = placeKey === '__all__' ? items : items.filter((i) => i.location === placeKey)

    if (filter === 'low') out = out.filter(isLow)
    if (filter === 'expiring') out = out.filter(isExpiring)
    if (filter === 'staples') out = out.filter((i) => i.isStaple)

    const q = query.trim()
    if (q) {
      out = out.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()) || similarity(q, i.name) > 0.4)
    }

    const sorted = [...out]
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name))
    if (sort === 'low') sorted.sort((a, b) => fillRatio(a) - fillRatio(b) || a.name.localeCompare(b.name))
    if (sort === 'expiring') sorted.sort(sortByUrgency)
    return sorted
  }, [items, placeKey, filter, sort, query])

  if (!items || !places || !list) return null

  const body = (
    <div className="pos">
      <header className="pos-head">
        {placeKey ? (
          <button className="pos-back" onClick={() => { setPlaceKey(null); setQuery('') }} aria-label="Back to locations">
            ‹
          </button>
        ) : (
          <span className="pos-back" aria-hidden style={{ visibility: 'hidden' }}>‹</span>
        )}

        <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
          <div className="pos-title">
            {place ? `${place.emoji} ${place.label}` : placeKey === '__all__' ? 'Everything' : 'What are you low on?'}
          </div>
          <div className="pos-sub">
            {placeKey ? `${visible.length} items · tap to add` : 'Pick a place to start'}
          </div>
        </div>

        {/* Labelled with what it switches to, so the toggle needs no legend. */}
        <button
          className="pos-size"
          onClick={toggleSize}
          aria-label={size === 'regular' ? 'Switch to large tiles' : 'Switch to regular tiles'}
        >
          {size === 'regular' ? 'Big' : 'Small'}
        </button>

        <button className="pos-back" onClick={onClose} aria-label="Close quick add">✕</button>
      </header>

      {placeKey && (
        <div className="pos-controls">
          <div className="search" style={{ flex: '1 1 180px' }}>
            <span className="icon">🔍</span>
            <input type="search" placeholder="Find…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <Seg value={filter} onChange={setFilter} options={FILTERS} />
          <Seg value={sort} onChange={setSort} options={SORTS} />
        </div>
      )}

      <div className={`pos-grid${size === 'large' ? ' large' : ''}`}>
        {!placeKey ? (
          <>
            {places.map((p) => (
              <PlaceTile key={p.key} place={p} items={items} onOpen={() => setPlaceKey(p.key)} />
            ))}
            <button className="pos-tile pos-tile-quiet" onClick={() => setPlaceKey('__all__')}>
              <span className="pos-glyph">🗂️</span>
              <span className="pos-name">Everything</span>
              <span className="pos-meta">{items.length} items</span>
            </button>
          </>
        ) : visible.length === 0 ? (
          <p className="pos-empty">
            Nothing here matches. Try a different filter, or head back and pick another place.
          </p>
        ) : (
          visible.map((item) => (
            <ItemTile key={item.id} item={item} qty={shopQtyFor(list, item)} list={list} />
          ))
        )}
      </div>

      <footer className="pos-foot">
        <span className="pos-count">
          {basket === 0 ? 'Nothing on the list yet' : `${basket} on the list`}
        </span>
        <button className="btn primary" onClick={onClose}>Done</button>
      </footer>
    </div>
  )

  return createPortal(body, document.body)
}

function PlaceTile({ place, items, onOpen }: { place: StoragePlace; items: ItemView[]; onOpen: () => void }) {
  const mine = items.filter((i) => i.location === place.key)
  const low = mine.filter(isLow).length

  return (
    <button className="pos-tile" onClick={onOpen}>
      <span className="pos-glyph">{place.emoji}</span>
      <span className="pos-label">
        <span className="pos-name">{place.label}</span>
        <span className="pos-meta">{mine.length} items</span>
      </span>
      {low > 0 && <span className="pos-flag">{low} low</span>}
    </button>
  )
}

function ItemTile({ item, qty, list }: { item: ItemView; qty: number; list: Parameters<typeof shopQtyFor>[0] }) {
  const { url: photo, cutout } = usePhoto(item.photoId, 'thumb')
  const meta = categoryMeta(item.category)
  const fresh = freshnessOf(item)
  const low = isLow(item)

  return (
    <div className="pos-tile-wrap">
      <button
        className={`pos-tile${qty > 0 ? ' on' : ''}${photo ? ' has-photo' : ''}${cutout ? ' has-cutout' : ''}`}
        onClick={() => bumpShopLine(item, list)}
        aria-label={`Add ${item.name} to the shopping list`}
      >
        {photo
          ? <img className={`pos-fill${cutout ? ' is-cutout' : ''}`} src={photo} alt="" loading="lazy" />
          : <span className="pos-glyph">{meta.emoji}</span>}

        {/* On a photo tile this becomes a scrimmed caption pinned to the bottom. */}
        <span className="pos-label">
          <span className="pos-name">{item.name}</span>
          <span className="pos-meta">
            {item.available <= 0 ? 'Out' : formatAmount(item.available, item.unit)}
          </span>
        </span>

        {qty === 0 && low && <span className="pos-flag">low</span>}
        {qty === 0 && !low && fresh.days !== null && fresh.days <= 5 && (
          <span className="pos-flag warn">{fresh.days < 0 ? 'old' : `${fresh.days}d`}</span>
        )}
        {qty > 0 && <span className="pos-badge">{qty}</span>}
      </button>

      {qty > 0 && (
        <button
          className="pos-clear"
          onClick={() => clearShopLine(item, list)}
          aria-label={`Remove ${item.name} from the shopping list`}
        >
          ✕
        </button>
      )}
    </div>
  )
}
