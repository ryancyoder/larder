import { useMemo, useRef, useState } from 'react'
import type { Product } from '../db/schema'
import { useAllStock, useProducts } from '../app/data'
import { categoryMeta } from '../lib/categories'
import { foodMeta } from '../lib/foods'
import {
  lastPaidByProduct, offLabel, searchProducts, sweepOpenFoodFacts,
  type LastPaid, type SweepProgress,
} from '../lib/products'
import { CatDot, Empty, Seg } from '../components/ui'
import { useToast } from '../app/toast'

/**
 * The master catalogue — every distinct product this household buys.
 *
 * Separate from the Kitchen, which is stock: what is on the shelf right now and
 * how much of it. This is identity, and it outlives the food. Running out of
 * hummus does not stop you being a household that buys hummus, and the next
 * receipt saying 343825 needs somewhere that remembers what that is.
 *
 * **Identity only.** It holds no counts and no prices: how often something is
 * bought and what it cost belong to purchases, and every purchase is an `Item`
 * that already records both. Trips and Insights answer those.
 *
 * Built as a table because the questions asked of it are comparisons down a
 * column — which of these have I scanned, which does Open Food Facts know,
 * what do I buy most — and aligned columns answer those far faster than a
 * paragraph per row. Laid out for a landscape iPad, which is where a catalogue
 * of several hundred products is actually readable; a phone drops the columns
 * it cannot fit rather than shrinking all of them past legibility.
 */

type View = 'all' | 'unscanned' | 'scanned'
/**
 * No sort by "most bought" or "last paid" — the catalogue does not know either,
 * on purpose. Those are facts about purchases, and Trips and Insights answer
 * them from the record that owns them.
 */
type SortKey = 'name' | 'sku' | 'category' | 'price'

function compare(
  a: Product, b: Product, key: SortKey, paid: Map<number, LastPaid>,
): number {
  switch (key) {
    case 'sku': return (a.sku ?? '\uffff').localeCompare(b.sku ?? '\uffff') || a.name.localeCompare(b.name)
    case 'category': return a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
    case 'price': {
      // Dearest first, and anything never bought sorts last rather than as free.
      const pa = a.id != null ? paid.get(a.id)?.unitPrice : undefined
      const pb = b.id != null ? paid.get(b.id)?.unitPrice : undefined
      return (pb ?? -1) - (pa ?? -1) || a.name.localeCompare(b.name)
    }
    default: return a.name.localeCompare(b.name)
  }
}

export default function Catalogue() {
  const products = useProducts()
  const stock = useAllStock()
  const toast = useToast()
  const [view, setView] = useState<View>('all')
  const [sort, setSort] = useState<SortKey>('name')
  const [query, setQuery] = useState('')
  const [sweep, setSweep] = useState<SweepProgress | null>(null)
  const cancelRef = useRef({ cancelled: false })

  const counts = useMemo(() => {
    const all = products ?? []
    return {
      all: all.length,
      unscanned: all.filter((p) => !p.barcode).length,
      scanned: all.filter((p) => p.barcode).length,
      known: all.filter((p) => p.offStatus === 'found').length,
      // Barcodes nobody has put to Open Food Facts yet. Not zero by default:
      // `off_status` arrived after the scanning did, so every code learned
      // before it exists with no answer recorded against it.
      unchecked: all.filter((p) => p.barcode && !p.offStatus).length,
      missing: all.filter((p) => p.offStatus === 'missing').length,
    }
  }, [products])

  /**
   * What each product cost per unit last time, worked out from stock.
   *
   * Derived, never stored: the catalogue holds identity, and a price belongs to
   * a purchase. Per unit rather than per line, because a line total is a
   * quantity in disguise — two salamis at $5.98 tells you nothing you can
   * compare against next month's single one.
   */
  const paid = useMemo(() => lastPaidByProduct(stock ?? []), [stock])

  const rows = useMemo(() => {
    const all = products ?? []
    const scoped = view === 'unscanned'
      ? all.filter((p) => !p.barcode)
      : view === 'scanned'
        ? all.filter((p) => p.barcode)
        : all
    return searchProducts(scoped, query).sort((a, b) => compare(a, b, sort, paid))
  }, [products, view, query, sort, paid])

  async function runSweep(recheckMissing: boolean) {
    cancelRef.current = { cancelled: false }
    setSweep({ done: 0, total: 0, found: 0, missing: 0 })
    try {
      const result = await sweepOpenFoodFacts(products ?? [], {
        recheckMissing,
        onProgress: setSweep,
        signal: cancelRef.current,
      })
      toast(
        cancelRef.current.cancelled
          ? `Stopped after ${result.done} — the rest keep their barcodes`
          : `${result.found} listed · ${result.missing} not in Open Food Facts`,
      )
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not reach Open Food Facts.')
    } finally {
      setSweep(null)
    }
  }

  if (!products) return null

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Catalog</h1>
          <div className="sub">
            {counts.all} product{counts.all === 1 ? '' : 's'}
            {counts.unscanned > 0 && ` · ${counts.unscanned} never scanned`}
            {counts.scanned > 0 && ` · ${counts.known} known to Open Food Facts`}
          </div>
        </div>
      </div>

      {counts.all === 0 ? (
        <div className="section">
          <Empty emoji="📇" title="Nothing catalogued yet">
            Import a receipt or name something in Unpack and this fills in — one entry per
            product, however many times you buy it.
          </Empty>
        </div>
      ) : (
        <>
          <section className="section">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <div className="search" style={{ flex: 1, minWidth: 180 }}>
                <span className="icon">🔎</span>
                <input
                  type="text"
                  placeholder="Name, brand, item number or barcode"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <Seg
                value={view}
                onChange={setView}
                options={[
                  { value: 'all' as View, label: `All ${counts.all}` },
                  { value: 'unscanned' as View, label: `To scan ${counts.unscanned}` },
                  { value: 'scanned' as View, label: `Scanned ${counts.scanned}` },
                ]}
              />
              {sweep ? (
                <button className="btn sm" onClick={() => { cancelRef.current.cancelled = true }}>
                  Checking {sweep.done}/{sweep.total || '…'} — stop
                </button>
              ) : counts.unchecked > 0 ? (
                <button className="btn primary sm" onClick={() => runSweep(false)}>
                  ✨ Check {counts.unchecked} against Open Food Facts
                </button>
              ) : counts.missing > 0 ? (
                <button className="btn sm" onClick={() => runSweep(true)} title="Open Food Facts grows; a barcode it did not know last month may be listed now">
                  ↻ Re-check the {counts.missing} it didn't know
                </button>
              ) : null}

              <label className="field" style={{ flex: 'none', minWidth: 130 }}>
                <span>Sort</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                  <option value="name">Name A–Z</option>
                  <option value="sku">Item number</option>
                  <option value="category">Category</option>
                  <option value="price">Price each</option>
                </select>
              </label>
            </div>

            {/* A legend, not a tooltip: the table is read on a touch screen where
                there is nothing to hover, and the dash needs saying out loud —
                it is an unasked question, not a negative answer. */}
            {counts.unchecked > 0 && !sweep && (
              <p style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 8 }}>
                {counts.unchecked} of your barcodes have never been put to Open Food Facts, so
                their answer is blank rather than negative. Run the check once and the column
                fills in; every scan from here records it as it goes.
              </p>
            )}

            {sweep && (
              <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8 }}>
                {sweep.current ? `Looking up ${sweep.current}…` : 'Starting…'}
                {sweep.done > 0 && ` · ${sweep.found} listed, ${sweep.missing} not`}
              </p>
            )}

            <p className="cat-legend">
              <span className="cat-legend-lead">
                <strong>Open Food Facts</strong> is the free product database barcodes are
                looked up in.
              </span>
              {/* Each flag stays glued to its meaning — wrapping between them
                  leaves a bare dash at the end of a line explaining nothing. */}
              <span className="legend-item"><span className="off-flag off-yes">Y</span> it's listed</span>
              <span className="legend-item"><span className="off-flag off-no">N</span> it isn't</span>
              <span className="legend-item"><span className="off-flag off-unknown">—</span> not scanned yet, so never asked</span>
            </p>

            {view === 'unscanned' && counts.unscanned > 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 8 }}>
                These came off a receipt and have never been matched to a real barcode, so they
                still wear the till's abbreviation. Scan each once from Unpack and every future
                receipt carrying that item number arrives already named.
              </p>
            )}
          </section>

          <section className="section">
            <div className="ktable-wrap">
              <table className="ktable cat-table">
                <thead>
                  <tr>
                    <th className="k-name">Product</th>
                    <th className="k-cat">Category</th>
                    <th className="c-sku">SKU</th>
                    <th className="c-barcode">Barcode</th>
                    {/* Written out wherever there is room. "OFF" saves space and
                        costs comprehension — it reads as off/on, which is the
                        first thing anyone asked about this table. */}
                    <th className="c-off" title="Is this product listed in Open Food Facts?">
                      <span className="c-off-full">Open Food Facts</span>
                      <span className="c-off-abbr">OFF</span>
                    </th>
                    {/* Pack size, not stock: what one of them contains. How many
                        you have is the Kitchen's question, not this table's. */}
                    <th className="c-size">Size</th>
                    {/* What one costs, not what a line came to. A line total is a
                        quantity in disguise and compares against nothing. */}
                    <th className="k-qty">Price each</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((product) => (
                    <Row
                      key={product.id}
                      product={product}
                      paid={product.id != null ? paid.get(product.id) : undefined}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {rows.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--text-mute)', padding: '18px 0', textAlign: 'center' }}>
                Nothing matches that.
              </p>
            )}
          </section>
        </>
      )}
    </>
  )
}

const money = (n: number) => `$${n.toFixed(2)}`

function Row({ product, paid }: { product: Product; paid?: LastPaid }) {
  const meta = categoryMeta(product.category)
  const food = foodMeta(product.foodKey)
  const off = offLabel(product)

  return (
    <tr className={`krow${product.barcode ? '' : ' spent'}`}>
      <td className="k-name">
        <span className="nm">{product.name}</span>
        {product.brand && <span className="chip">{product.brand}</span>}
        {food && <span className="chip"><span className="dot" />{food.name}</span>}
      </td>

      <td className="k-cat">
        <CatDot category={product.category} />
        <span>{meta.label}</span>
      </td>

      <td className="c-sku tabular">
        {product.sku
          ? <><span>{product.sku}</span>{product.store && <small>{product.store}</small>}</>
          : <span className="muted">—</span>}
      </td>

      <td className="c-barcode tabular">
        {product.barcode ?? <span className="muted">not scanned</span>}
      </td>

      <td className="c-off">
        {/* Three states, and the dash is not a failure: nobody has scanned a
            barcode yet, so the question has never been put. */}
        <span className={`off-flag off-${off === 'Y' ? 'yes' : off === 'N' ? 'no' : 'unknown'}`}>
          {off}
        </span>
      </td>

      <td className="c-size tabular">
        {product.size != null
          ? <span>{product.size}{product.sizeUnit ? ` ${product.sizeUnit}` : ''}</span>
          : <span className="muted">—</span>}
      </td>

      <td className="k-qty tabular">
        {paid ? money(paid.unitPrice) : <span className="muted">—</span>}
      </td>
    </tr>
  )
}
