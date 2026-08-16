import { useState } from 'react'
import type { ItemView, MealSlot } from '../db/schema'
import { useKitchen } from '../app/data'
import { usePhoto } from '../app/usePhoto'
import { categoryMeta } from '../lib/categories'
import { freshnessOf } from '../lib/inventory'
import { formatAmount } from '../lib/units'
import { setMain, setMealSlot, setStaple } from '../lib/bulk'
import TileBrowser, { isLow } from '../components/TileBrowser'
import { Glyph } from '../components/ui'
import ItemSheet from '../components/ItemSheet'
import AddItemSheet from '../components/AddItemSheet'
import { useToast } from '../app/toast'

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
        renderItem={(item, filter) => (
          <KitchenTile
            key={item.id}
            item={item}
            // A row of B/L/D under a Dinner filter would say what the filter
            // already says, and the space is better spent on the tile.
            showMeals={!MEAL_MARKS.some((m) => m.key === filter)}
            onOpen={() => setSelected(item)}
          />
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

/** Single letters, because a tile has room for a letter and not a word. */
const MEAL_MARKS: Array<{ key: MealSlot; letter: string; label: string }> = [
  { key: 'breakfast', letter: 'B', label: 'Breakfast' },
  { key: 'lunch', letter: 'L', label: 'Lunch' },
  { key: 'dinner', letter: 'D', label: 'Dinner' },
]

function KitchenTile({ item, showMeals, onOpen }: { item: ItemView; showMeals: boolean; onOpen: () => void }) {
  const toast = useToast()
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
      className={`pos-tile${photo ? ' has-photo' : ''}${cutout ? ' has-cutout' : ''}${item.qty <= 0 ? ' spent' : ''}${item.reserved > 0 ? ' reserved' : ''}`}
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

      {/* One flag only, and it sits inboard of the main-dish button. Being
          reserved is drawn as a slash across the whole tile instead. */}
      {low ? (
        <span className="pos-flag inset">{item.available <= 0 ? 'out' : 'low'}</span>
      ) : fresh.days !== null && fresh.days <= 5 ? (
        <span className="pos-flag warn inset">{fresh.days < 0 ? 'old' : `${fresh.days}d`}</span>
      ) : null}
    </button>

      {/* Siblings rather than children: the tile is itself a button, and one
          button cannot legally nest inside another. Same trick the quick-add
          clear button uses. */}
      {showMeals && (
        <div className="pos-meals">
          {MEAL_MARKS.map((m) => {
            const on = item.meal === m.key
            return (
              <button
                key={m.key}
                className={`pos-meal${on ? ' on' : ''}`}
                aria-pressed={on}
                aria-label={on ? `${item.name} is ${m.label} — tap to clear` : `Mark ${item.name} as ${m.label}`}
                title={on ? `${m.label} — tap to clear` : m.label}
                onClick={() => setMealSlot(item.id!, m.key)}
              >
                {m.letter}
              </button>
            )
          })}
        </div>
      )}

      <button
        className={`pos-main${item.isMain ? ' on' : ''}`}
        aria-pressed={Boolean(item.isMain)}
        aria-label={item.isMain ? `${item.name} is a main dish — tap to unmark` : `Mark ${item.name} as a main dish`}
        title={item.isMain ? 'A main dish' : 'Mark as a main dish'}
        onClick={async () => {
          const ok = await setMain(item.id!, !item.isMain)
          // A main belongs to a meal, and a tile can't ask which one.
          if (!ok) toast('Give it a meal first — mains belong to breakfast, lunch or dinner')
        }}
      >
        🍽️
      </button>

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
