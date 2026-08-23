import { useMemo, useRef, useState } from 'react'
import type { Product } from '../db/schema'
import { useAllStock, useProducts } from '../app/data'
import { categoryMeta } from '../lib/categories'
import { foodMeta } from '../lib/foods'
import {
  lastPaidByProduct, offLabel, searchProducts, sweepOpenFoodFacts,
  type LastPaid, type SweepProgress,
} from '../lib/products'
import { CatDot, Empty, Glyph, Seg } from '../components/ui'
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
/**
 * Every column sorts, and clicking the one already sorted reverses it.
 *
 * Each key carries the direction it should open in, because "sensible first" is
 * not one answer for every column: names read A–Z, prices read dearest first.
 */
type SortKey = 'photo' | 'name' | 'food' | 'category' | 'sku' | 'barcode' | 'off' | 'size' | 'price'
type Dir = 'asc' | 'desc'

const OPENS_DESC: SortKey[] = ['price', 'size', 'photo']

interface SortState { key: SortKey; dir: Dir }

/** Sorts last whatever the direction, so blanks never crowd the top. */
const LAST = '\uffff'

/**
 * Answered, then unanswered, then unasked — the order that puts what still
 * needs doing at one end rather than scattering it.
 */
function offRank(p: Product): number {
  if (!p.barcode) return 3
  return p.offStatus === 'found' ? 0 : p.offStatus === 'missing' ? 1 : 2
}

function value(p: Product, key: SortKey, paid: Map<number, LastPaid>): string | number {
  switch (key) {
    case 'photo': return p.photoId != null ? 1 : 0
    case 'food': return foodMeta(p.foodKey)?.name.toLowerCase() ?? LAST
    case 'category': return p.category
    case 'sku': return p.sku ?? LAST
    case 'barcode': return p.barcode ?? LAST
    case 'off': return offRank(p)
    case 'size': return p.size ?? -1
    case 'price': return (p.id != null ? paid.get(p.id)?.unitPrice : undefined) ?? -1
    default: return p.name.toLowerCase()
  }
}

function compare(a: Product, b: Product, sort: SortState, paid: Map<number, LastPaid>): number {
  const va = value(a, sort.key, paid)
  const vb = value(b, sort.key, paid)
  let n = typeof va === 'number' && typeof vb === 'number'
    ? va - vb
    : String(va).localeCompare(String(vb))
  if (sort.dir === 'desc') n = -n
  // Name breaks every tie, so the order is stable and reads alphabetically
  // within a group.
  return n || a.name.localeCompare(b.name)
}

export default function Catalogue() {
  const products = useProducts()
  const stock = useAllStock()
  const toast = useToast()
  const [view, setView] = useState<View>('all')
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' })

  /** The same column reverses; a new one opens whichever way reads best. */
  function toggle(key: SortKey) {
    setSort((prev) => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: OPENS_DESC.includes(key) ? 'desc' : 'asc' })
  }
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
                    <SortTh sort={sort} onSort={toggle} col="photo" className="c-pic" label="" title="Picture" />
                    <SortTh sort={sort} onSort={toggle} col="name" className="k-name" label="Product" />
                    {/* The basic food, not the product: fresh, canned and frozen
                        beets are three products and one food. See lib/foods.ts. */}
                    <SortTh sort={sort} onSort={toggle} col="food" className="c-food" label="Food" />
                    <SortTh sort={sort} onSort={toggle} col="category" className="k-cat" label="Category" />
                    <SortTh sort={sort} onSort={toggle} col="sku" className="c-sku" label="SKU" />
                    <SortTh sort={sort} onSort={toggle} col="barcode" className="c-barcode" label="Barcode" />
                    {/* Written out wherever there is room. "OFF" saves space and
                        costs comprehension — it reads as off/on, which is the
                        first thing anyone asked about this table. */}
                    <SortTh
                      sort={sort}
                      onSort={toggle}
                      col="off"
                      className="c-off"
                      label="Open Food Facts"
                      short="OFF"
                      title="Is this product listed in Open Food Facts?"
                    />
                    {/* Pack size, not stock: what one of them contains. How many
                        you have is the Kitchen's question, not this table's. */}
                    <SortTh sort={sort} onSort={toggle} col="size" className="c-size" label="Size" />
                    {/* What one costs, not what a line came to. A line total is a
                        quantity in disguise and compares against nothing. */}
                    <SortTh sort={sort} onSort={toggle} col="price" className="k-qty" label="Price each" />
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

/**
 * A column heading that sorts.
 *
 * A button inside the th rather than a click handler on it, so it is reachable
 * by keyboard and announces itself; `aria-sort` on the th is what a screen
 * reader reads to say which column the table is ordered by.
 */
function SortTh({
  sort, onSort, col, className, label, short, title,
}: {
  sort: SortState
  onSort: (key: SortKey) => void
  col: SortKey
  className: string
  label: string
  short?: string
  title?: string
}) {
  const active = sort.key === col
  return (
    <th
      className={`${className}${active ? ' sorted' : ''}`}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      title={title}
    >
      <button type="button" className="th-sort" onClick={() => onSort(col)}>
        {short
          ? <><span className="c-off-full">{label}</span><span className="c-off-abbr">{short}</span></>
          : label}
        <span className="th-arrow" aria-hidden>{active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  )
}

function Row({ product, paid }: { product: Product; paid?: LastPaid }) {
  const meta = categoryMeta(product.category)
  const food = foodMeta(product.foodKey)
  const off = offLabel(product)

  return (
    <tr className={`krow${product.barcode ? '' : ' spent'}`}>
      <td className="c-pic">
        <Glyph emoji={meta.emoji} photoId={product.photoId} size={30} rounded />
      </td>

      <td className="k-name">
        <span className="nm">{product.name}</span>
        {product.brand && <span className="chip">{product.brand}</span>}
      </td>

      <td className="c-food">
        {food
          ? <><span aria-hidden>{food.icon}</span> <span>{food.name}</span></>
          : <span className="muted">—</span>}
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
