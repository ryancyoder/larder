import { useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ItemView, MealSlot, StoragePlace } from '../db/schema'
import { useKitchen, usePlaces } from '../app/data'
import { usePhoto } from '../app/usePhoto'
import { freshnessOf, sortByUrgency } from '../lib/inventory'
import { similarity } from '../lib/match'
import { SLOTS } from '../lib/plan'
import { Seg } from './ui'

/**
 * The full-screen tile shell: locations first, like photo albums, then the
 * shelf itself. Big targets, minimal text, no app chrome.
 *
 * Shared by the two things you do standing in front of a cupboard — building a
 * shopping list and going through what's actually in there. Only the tile's
 * tap action and the footer differ, so everything else lives here rather than
 * being copied and left to drift apart.
 */

export type Filter = 'all' | 'low' | 'expiring' | 'staples' | 'main' | MealSlot
export type Sort = 'name' | 'low' | 'expiring'
type TileSize = 'regular' | 'large'

const SIZE_KEY = 'larder-tile-size'

function readSize(): TileSize {
  try {
    return localStorage.getItem(SIZE_KEY) === 'large' ? 'large' : 'regular'
  } catch {
    return 'regular'
  }
}

// One scrollable control rather than a second row — chrome is at a premium here.
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'low', label: 'Low' },
  { value: 'expiring', label: 'Expiring' },
  { value: 'staples', label: 'Staples' },
  { value: 'main', label: '⭐ Mains' },
  ...SLOTS.map((s) => ({ value: s.key as Filter, label: `${s.emoji} ${s.label}` })),
]

const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'name', label: 'A–Z' },
  { value: 'low', label: 'Emptiest' },
  { value: 'expiring', label: 'Soonest' },
]

export function isLow(item: ItemView): boolean {
  if (item.available <= 0) return true
  return Boolean(item.isStaple && item.parQty && item.available < item.parQty)
}

export function isExpiring(item: ItemView): boolean {
  const f = freshnessOf(item)
  return f.days !== null && f.days <= 5
}

/** 0 = empty, 1 = full. Staples measure against par; everything else against what it came in as. */
export function fillRatio(item: ItemView): number {
  const denominator = item.isStaple && item.parQty ? item.parQty : item.qtyInitial || 1
  return Math.max(0, Math.min(1, item.available / denominator))
}

/** What the footer and tile renderer get to work with. */
export interface TileContext {
  /** The open location, or undefined on the album page and under "Everything". */
  place: StoragePlace | undefined
  placeKey: string | null
  visible: ItemView[]
  all: ItemView[]
}

export default function TileBrowser({
  heading, hint, itemHint, closeLabel, onClose, renderItem, footer,
}: {
  /** Shown on the album page, before a location is picked. */
  heading: string
  hint: string
  /** Subtitle once a location is open — says what tapping a tile does. */
  itemHint: (count: number) => string
  closeLabel: string
  onClose: () => void
  renderItem: (item: ItemView) => ReactNode
  footer: (ctx: TileContext) => ReactNode
}) {
  const items = useKitchen()
  const places = usePlaces()

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

  const visible = useMemo(() => {
    if (!items) return []
    let out = placeKey === '__all__' ? items : items.filter((i) => i.location === placeKey)

    if (filter === 'low') out = out.filter(isLow)
    if (filter === 'expiring') out = out.filter(isExpiring)
    if (filter === 'staples') out = out.filter((i) => i.isStaple)
    if (filter === 'main') out = out.filter((i) => i.isMain)
    if (SLOTS.some((s) => s.key === filter)) out = out.filter((i) => i.meal === filter)

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

  if (!items || !places) return null

  const ctx: TileContext = { place, placeKey, visible, all: items }

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
            {place ? `${place.emoji} ${place.label}` : placeKey === '__all__' ? 'Everything' : heading}
          </div>
          <div className="pos-sub">{placeKey ? itemHint(visible.length) : hint}</div>
        </div>

        {/* Labelled with what it switches to, so the toggle needs no legend. */}
        <button
          className="pos-size"
          onClick={toggleSize}
          aria-label={size === 'regular' ? 'Switch to large tiles' : 'Switch to regular tiles'}
        >
          {size === 'regular' ? 'Big' : 'Small'}
        </button>

        <button className="pos-back" onClick={onClose} aria-label={closeLabel}>✕</button>
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
            <div className="pos-tile-wrap">
              <button className="pos-tile pos-tile-quiet" onClick={() => setPlaceKey('__all__')}>
                <span className="pos-glyph">🗂️</span>
                <span className="pos-name">Everything</span>
                <span className="pos-meta">{items.length} items</span>
              </button>
            </div>
          </>
        ) : visible.length === 0 ? (
          <p className="pos-empty">
            Nothing here matches. Try a different filter, or head back and pick another place.
          </p>
        ) : (
          visible.map(renderItem)
        )}
      </div>

      <footer className="pos-foot">{footer(ctx)}</footer>
    </div>
  )

  return createPortal(body, document.body)
}

function PlaceTile({ place, items, onOpen }: { place: StoragePlace; items: ItemView[]; onOpen: () => void }) {
  const mine = items.filter((i) => i.location === place.key)
  const low = mine.filter(isLow).length
  const { url: photo, cutout } = usePhoto(place.photoId, 'thumb')

  return (
    <div className="pos-tile-wrap">
      {/* Same treatment as an item tile: the picture is the button, and the
          label sits on a scrim over it rather than beneath a thumbnail. */}
      <button
        className={`pos-tile${photo ? ' has-photo' : ''}${cutout ? ' has-cutout' : ''}`}
        onClick={onOpen}
      >
        {photo
          ? <img className={`pos-fill${cutout ? ' is-cutout' : ''}`} src={photo} alt="" loading="lazy" />
          : <span className="pos-glyph">{place.emoji}</span>}
        <span className="pos-label">
          <span className="pos-name">{place.label}</span>
          <span className="pos-meta">{mine.length} items</span>
        </span>
        {low > 0 && <span className="pos-flag">{low} low</span>}
      </button>
    </div>
  )
}
