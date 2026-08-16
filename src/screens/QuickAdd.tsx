import type { ItemView } from '../db/schema'
import { useShopList } from '../app/data'
import { usePhoto } from '../app/usePhoto'
import { categoryMeta } from '../lib/categories'
import { freshnessOf } from '../lib/inventory'
import { formatAmount } from '../lib/units'
import { bumpShopLine, clearShopLine, shopQtyFor } from '../lib/shopping'
import { Glyph } from '../components/ui'
import TileBrowser, { isLow } from '../components/TileBrowser'

/**
 * Walk-the-kitchen mode: one tap per thing you need, straight onto the list.
 *
 * Deliberately not a screen in the tab bar — it's a task you enter, blitz
 * through with one thumb, and leave. The tile shell it runs in is shared with
 * the kitchen's own full-screen view.
 */
export default function QuickAdd({ onClose }: { onClose: () => void }) {
  const list = useShopList()
  const basket = list?.filter((l) => !l.checked).length ?? 0

  if (!list) return null

  return (
    <TileBrowser
      heading="What are you low on?"
      hint="Pick a place to start"
      itemHint={(n) => `${n} items · tap to add`}
      closeLabel="Close quick add"
      onClose={onClose}
      renderItem={(item) => (
        <ShopTile key={item.id} item={item} qty={shopQtyFor(list, item)} list={list} />
      )}
      footer={() => (
        <>
          <span className="pos-count">
            {basket === 0 ? 'Nothing on the list yet' : `${basket} on the list`}
          </span>
          <button className="btn primary" onClick={onClose}>Done</button>
        </>
      )}
    />
  )
}

function ShopTile({ item, qty, list }: { item: ItemView; qty: number; list: Parameters<typeof shopQtyFor>[0] }) {
  const { url: photo, cutout } = usePhoto(item.photoId, 'thumb')
  const meta = categoryMeta(item.category)
  const fresh = freshnessOf(item)
  const low = isLow(item)

  return (
    <div className="pos-tile-wrap">
      <button
        className={`pos-tile${qty > 0 ? ' on' : ''}${photo ? ' has-photo' : ''}${cutout ? ' has-cutout' : ''}${item.qty <= 0 ? ' spent' : ''}`}
        onClick={() => bumpShopLine(item, list)}
        aria-label={`Add ${item.name} to the shopping list`}
      >
        {photo
          ? <img className={`pos-fill${cutout ? ' is-cutout' : ''}`} src={photo} alt="" loading="lazy" />
          : <Glyph emoji={meta.emoji} photoId={meta.photoId} size={34} className="pos-glyph" />}

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
