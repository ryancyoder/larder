import { useMemo, useState } from 'react'
import type { Product } from '../db/schema'
import { useProducts } from '../app/data'
import { categoryMeta } from '../lib/categories'
import { foodMeta } from '../lib/foods'
import { formatDate } from '../lib/dates'
import { searchProducts, sortProducts, unlearned } from '../lib/products'
import { Seg, Sheet } from '../components/ui'

/**
 * The product catalogue — every distinct thing this household buys.
 *
 * Separate from the Kitchen, which is stock: what is on the shelf right now and
 * how much of it. This is identity, and it outlives the food. Running out of
 * hummus does not make you stop being a household that buys hummus, and the
 * next receipt saying 343825 needs somewhere that remembers what that is.
 *
 * The *Needs a scan* filter is the working list: those are the products whose
 * till code has never been tied to a real barcode, so they arrive named by an
 * abbreviation every single time until somebody scans one.
 */

type View = 'all' | 'unscanned'

export default function Catalogue({ onClose }: { onClose: () => void }) {
  const products = useProducts()
  const [view, setView] = useState<View>('all')
  const [query, setQuery] = useState('')

  const rows = useMemo(() => {
    const all = products ?? []
    const scoped = view === 'unscanned' ? unlearned(all) : sortProducts(all)
    return searchProducts(scoped, query)
  }, [products, view, query])

  const waiting = useMemo(() => unlearned(products ?? []).length, [products])

  return (
    <Sheet title="Everything you buy" onClose={onClose}>
      {products === undefined ? (
        <p style={{ fontSize: 13, color: 'var(--text-mute)', padding: '18px 0', textAlign: 'center' }}>
          Loading…
        </p>
      ) : products.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-mute)', padding: '18px 0' }}>
          Nothing catalogued yet. Import a receipt or name something in Unpack and it starts
          filling in — one entry per product, however many times you buy it.
        </p>
      ) : (
        <>
          <Seg
            value={view}
            onChange={setView}
            options={[
              { value: 'all' as View, label: `All ${products.length}` },
              { value: 'unscanned' as View, label: `Needs a scan ${waiting}` },
            ]}
          />

          <label className="field">
            <span>Search</span>
            <input
              type="text"
              value={query}
              placeholder="Name, brand, item number or barcode"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>

          {view === 'unscanned' && (
            <p style={{ fontSize: 12, color: 'var(--text-mute)', margin: 0 }}>
              These arrived from a receipt and have never been matched to a real barcode, so
              they come in wearing the till's abbreviation. Scan one from Unpack next time you
              buy it and it is linked for good.
            </p>
          )}

          {rows.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-mute)', padding: '14px 0', textAlign: 'center' }}>
              Nothing matches that.
            </p>
          ) : (
            <div className="stack" style={{ gap: 2 }}>
              {rows.map((product) => <Row key={product.id} product={product} />)}
            </div>
          )}
        </>
      )}
    </Sheet>
  )
}

function Row({ product }: { product: Product }) {
  const meta = categoryMeta(product.category)
  const food = foodMeta(product.foodKey)

  // Two identifiers, either of which may be missing, and the gap between them
  // is the whole point of the screen.
  const codes = [
    product.sku ? `${product.store || 'store'} #${product.sku}` : '',
    product.barcode ?? '',
  ].filter(Boolean).join(' · ')

  return (
    <div className="row" style={{ gap: 8, alignItems: 'center', padding: '7px 0' }}>
      <span style={{ fontSize: 17, flex: 'none' }}>{meta.emoji}</span>

      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>
          {product.name}
          {product.brand ? <span style={{ fontWeight: 400, color: 'var(--text-mute)' }}> · {product.brand}</span> : null}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-mute)' }}>
          {codes || 'no codes yet'}
          {food ? ` · ${food.name}` : ''}
        </span>
      </span>

      <span style={{ flex: 'none', textAlign: 'right' }}>
        {!product.barcode && (
          <span
            className="pos-flag warn"
            title="Never scanned — its till code is not linked to a barcode"
            style={{ fontSize: 11 }}
          >
            scan me
          </span>
        )}
        <span style={{ display: 'block', fontSize: 11, color: 'var(--text-mute)', fontVariantNumeric: 'tabular-nums' }}>
          {product.timesBought > 0
            ? `bought ${product.timesBought}×${product.lastBoughtAt ? ` · ${formatDate(product.lastBoughtAt)}` : ''}`
            : 'not bought yet'}
        </span>
      </span>
    </div>
  )
}
