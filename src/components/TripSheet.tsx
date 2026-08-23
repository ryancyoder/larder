import type { ItemView, Trip } from '../db/schema'
import { useTripItems } from '../app/data'
import { formatDate } from '../lib/dates'
import { unitPrice } from '../lib/inventory'
import { formatAmount } from '../lib/units'
import { CatDot, Sheet } from './ui'

/**
 * One shop, opened up.
 *
 * The trip has been recorded since the first release and never had anywhere to
 * be looked at, which made it a number on the Insights page rather than a thing
 * that happened. This is the screen that answers "what did that $84 actually
 * buy, and is any of it left?".
 */

const money = (n: number) => `$${n.toFixed(2)}`

const SOURCE_NOTE: Record<Trip['source'], string> = {
  receipt: 'Imported from the receipt',
  scan: 'Scanned at the counter',
  checkout: 'Ticked off the shopping list',
}

export default function TripSheet({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const items = useTripItems(trip.id)
  const left = items?.filter((i) => i.qty > 0) ?? []
  const gone = items?.filter((i) => i.qty <= 0) ?? []

  // A scanned shop never saw a price, so showing "$0.00" would read as free
  // rather than as unknown.
  const priced = trip.total > 0
  const gap = trip.printedTotal != null
    ? Math.round((trip.printedTotal - trip.total) * 100) / 100
    : null

  return (
    <Sheet title={trip.store || 'Shopping trip'} onClose={onClose}>
      <div className="row" style={{ gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 15 }}>{formatDate(trip.date)}</strong>
        <span style={{ fontSize: 12.5, color: 'var(--text-mute)' }}>
          {SOURCE_NOTE[trip.source] ?? ''}
        </span>
        <span className="spacer" style={{ flex: 1 }} />
        {priced && <strong style={{ fontSize: 16, fontVariantNumeric: 'tabular-nums' }}>{money(trip.total)}</strong>}
      </div>

      {gap != null && gap !== 0 && (
        <p style={{ fontSize: 11.5, color: 'var(--text-mute)', margin: 0 }}>
          The receipt printed {money(trip.printedTotal!)} — {money(Math.abs(gap))} more than the
          lines came to, which is usually tax or a savings line.
        </p>
      )}
      {trip.note && (
        <p style={{ fontSize: 12, color: 'var(--text-mute)', margin: 0 }}>{trip.note}</p>
      )}

      {items === undefined ? (
        <p style={{ fontSize: 13, color: 'var(--text-mute)', padding: '18px 0', textAlign: 'center' }}>
          Loading…
        </p>
      ) : items.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-mute)', padding: '18px 0', textAlign: 'center' }}>
          Nothing from this trip is still on the books — every item has been used up and cleared,
          or was deleted.
        </p>
      ) : (
        <>
          <TripList
            title={`Still in the kitchen · ${left.length}`}
            items={left}
            priced={priced}
            empty="All of it has gone."
          />
          {gone.length > 0 && (
            <TripList
              title={`Used up · ${gone.length}`}
              items={gone}
              priced={priced}
              empty=""
              faded
            />
          )}
        </>
      )}
    </Sheet>
  )
}

function TripList({
  title, items, priced, empty, faded,
}: {
  title: string
  items: ItemView[]
  priced: boolean
  empty: string
  faded?: boolean
}) {
  return (
    <>
      <h4 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text-mute)', margin: '10px 0 2px' }}>
        {title}
      </h4>
      {items.length === 0 ? (
        empty ? <p style={{ fontSize: 12.5, color: 'var(--text-mute)', margin: 0 }}>{empty}</p> : null
      ) : (
        <div className="stack" style={{ gap: 2, opacity: faded ? 0.55 : 1 }}>
          {items.map((item) => (
            <div className="row" key={item.id} style={{ gap: 8, alignItems: 'center', padding: '5px 0' }}>
              <CatDot category={item.category} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{item.displayName}</span>
                <span style={{ fontSize: 11, color: 'var(--text-mute)' }}>
                  {formatAmount(item.qtyInitial, item.unit)} bought
                  {item.qty > 0 && item.qty !== item.qtyInitial
                    ? ` · ${formatAmount(item.qty, item.unit)} left`
                    : ''}
                </span>
              </span>
              {priced && item.price != null && (
                <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', flex: 'none', textAlign: 'right' }}>
                  {/* The price of one leads; the line total follows only when
                      they differ. A summed total compares against nothing. */}
                  {money(item.qtyInitial > 1 ? unitPrice(item) : item.price)}
                  {item.qtyInitial > 1 && (
                    <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-mute)' }}>
                      {item.qtyInitial} = {money(item.price)}
                    </span>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
