import { useState } from 'react'
import type { ItemView } from '../db/schema'
import { useKitchen } from '../app/data'
import { usePhoto } from '../app/usePhoto'
import { categoryMeta } from '../lib/categories'
import { freshnessOf } from '../lib/inventory'
import { formatAmount } from '../lib/units'
import { setStaple } from '../lib/bulk'
import TileBrowser, { isLow } from '../components/TileBrowser'
import { Glyph } from '../components/ui'
import ItemSheet from '../components/ItemSheet'
import AddItemSheet from '../components/AddItemSheet'

/**
 * The kitchen as a wall of tiles rather than a list.
 *
 * Same shell as quick add — locations first, then the shelf — but a tap opens
 * the item instead of putting it on a list, so everything you'd do standing at
 * an open fridge door (use some, throw out, reserve, photograph) is one tap
 * away on a target big enough for a thumb.
 */
export default function KitchenTiles({ onClose }: { onClose: () => void }) {
  const items = useKitchen()
  const [selected, setSelected] = useState<ItemView | null>(null)
  const [addingTo, setAddingTo] = useState<string | null>(null)

  // Follow the row rather than the snapshot, so the sheet reflects each change
  // as it's made instead of showing the quantity it opened with.
  const live = selected && items ? items.find((i) => i.id === selected.id) ?? null : null

  return (
    <>
      <TileBrowser
        heading="What's in the kitchen?"
        hint="Pick a place to look inside"
        itemHint={(n) => `${n} items · tap to open`}
        closeLabel="Close the tile view"
        onClose={onClose}
        renderItem={(item) => (
          <KitchenTile key={item.id} item={item} onOpen={() => setSelected(item)} />
        )}
        footer={({ place, placeKey, visible, all }) => (
          <>
            <span className="pos-count">
              {placeKey ? `${visible.length} of ${all.length} items` : `${all.length} items tracked`}
            </span>
            <button
              className="btn pos-add"
              // Adding while inside a place means adding to that place. The
              // label stays short because the header already names the place.
              onClick={() => setAddingTo(place?.key ?? '')}
              aria-label={place ? `Add an item to the ${place.label}` : 'Add an item'}
            >
              ＋ Add
            </button>
            <button className="btn primary" onClick={onClose}>Done</button>
          </>
        )}
      />

      {live && <ItemSheet item={live} onClose={() => setSelected(null)} />}
      {addingTo !== null && (
        <AddItemSheet
          onClose={() => setAddingTo(null)}
          defaultLocation={addingTo || undefined}
        />
      )}
    </>
  )
}

function KitchenTile({ item, onOpen }: { item: ItemView; onOpen: () => void }) {
  const { url: photo, cutout } = usePhoto(item.photoId, 'thumb')
  const meta = categoryMeta(item.category)
  const fresh = freshnessOf(item)
  const low = isLow(item)

  return (
    // The wrapper is load-bearing, not decoration: a bare aspect-ratio tile as
    // a direct child of the scrolling grid makes row height depend on the
    // scrollbar and back again, and the rows collapse to min-content.
    <div className="pos-tile-wrap">
    <button
      className={`pos-tile${photo ? ' has-photo' : ''}${cutout ? ' has-cutout' : ''}${item.available <= 0 ? ' spent' : ''}`}
      onClick={onOpen}
      aria-label={`Open ${item.name}`}
    >
      {photo
        ? <img className={`pos-fill${cutout ? ' is-cutout' : ''}`} src={photo} alt="" loading="lazy" />
        // No photo of its own, so it borrows its category's — a picture of the
        // category beats a generic emoji when one has been uploaded.
        : <Glyph emoji={meta.emoji} photoId={meta.photoId} size={34} className="pos-glyph" />}

      <span className="pos-label">
        <span className="pos-name">{item.name}</span>
        <span className="pos-meta">
          {item.available <= 0 ? 'Out' : formatAmount(item.available, item.unit)}
          {item.reserved > 0 && ` · ${formatAmount(item.reserved, item.unit)} held`}
        </span>
      </span>

      {/* One flag only. Running out beats going off beats being spoken for. */}
      {low ? (
        <span className="pos-flag">{item.available <= 0 ? 'out' : 'low'}</span>
      ) : fresh.days !== null && fresh.days <= 5 ? (
        <span className="pos-flag warn">{fresh.days < 0 ? 'old' : `${fresh.days}d`}</span>
      ) : item.reserved > 0 ? (
        <span className="pos-flag held">🔒</span>
      ) : null}
    </button>

      {/* A sibling rather than a child: the tile is itself a button, and one
          button cannot legally nest inside another. Same trick the quick-add
          clear button uses. */}
      <button
        className={`pos-star${item.isStaple ? ' on' : ''}`}
        aria-pressed={item.isStaple}
        aria-label={item.isStaple ? `${item.name} is a staple — tap to unstar` : `Mark ${item.name} as a staple`}
        title={item.isStaple ? 'A staple — restocks itself when low' : 'Mark as a staple'}
        onClick={() => setStaple(item.id!, !item.isStaple)}
      >
        {item.isStaple ? '★' : '☆'}
      </button>
    </div>
  )
}
