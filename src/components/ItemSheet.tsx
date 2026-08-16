import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { ItemView, StorageLocation } from '../db/schema'
import { categoryMeta } from '../lib/categories'
import { placeEmoji, placeLabel } from '../lib/locations'
import { SLOTS } from '../lib/plan'
import { usePlaces } from '../app/data'
import { formatAmount, formatPack, isCountUnit, packTotal } from '../lib/units'
import { adjustQuantity, consume, deleteItem, freshnessOf, releaseHold, reserve, unitPrice, waste } from '../lib/inventory'
import { db } from '../db/db'
import { relativeDays } from '../lib/dates'
import { ExpiryChip, Field, FreshnessRing, Sheet } from './ui'
import { useToast } from '../app/toast'
import { usePhoto } from '../app/usePhoto'
import { setItemPhoto } from '../lib/photos'
import PhotoCapture from './PhotoCapture'
import NutritionPanel from './NutritionPanel'
import EditItemSheet from './EditItemSheet'
import { db as database } from '../db/db'

type Mode = 'menu' | 'use' | 'toss' | 'hold' | 'photo' | 'edit'

export default function ItemSheet({ item, onClose }: { item: ItemView; onClose: () => void }) {
  const toast = useToast()
  const [mode, setMode] = useState<Mode>('menu')
  const [amount, setAmount] = useState(String(item.available || item.qty))
  const [reason, setReason] = useState('')
  const [label, setLabel] = useState('')
  const [fetchingNutrition, setFetchingNutrition] = useState(false)
  const [nutritionNote, setNutritionNote] = useState('')

  const meta = categoryMeta(item.category)
  const fresh = freshnessOf(item)
  const perUnit = unitPrice(item)
  const places = usePlaces() ?? []
  const { url: hero, cutout: heroCutout } = usePhoto(item.photoId, 'full')
  const total = packTotal(item.qty, item)
  const credit = useLiveQuery(
    async () => (item.photoId == null ? undefined : (await database.photos.get(item.photoId))?.attribution),
    [item.photoId],
  )

  async function doUse() {
    await consume(item, Number(amount) || 0, 'Used in the kitchen')
    toast(`Logged ${formatAmount(Number(amount), item.unit)} of ${item.name}`)
    onClose()
  }

  async function doToss() {
    const qty = Number(amount) || 0
    await waste(item, qty, reason || 'Thrown out')
    const cost = perUnit * qty
    toast(cost > 0 ? `Logged ${formatAmount(qty, item.unit)} wasted — $${cost.toFixed(2)}` : 'Logged as waste')
    onClose()
  }

  async function doHold() {
    await reserve(item, Number(amount) || 0, label.trim() || 'Saved for later')
    toast(`${formatAmount(Number(amount), item.unit)} of ${item.name} is now off limits`)
    onClose()
  }

  /** Whole units for counted things; halves for anything measured. */
  async function bump(direction: 1 | -1) {
    const step = isCountUnit(item.unit) ? 1 : 0.5
    await adjustQuantity(item, item.qty + direction * step)
  }

  async function move(location: StorageLocation) {
    if (!item.id) return
    await db.items.update(item.id, { location })
    toast(`Moved to the ${placeLabel(places, location)}`)
  }

  /** Re-asks Open Food Facts for the label figures on an item we already have. */
  async function loadNutrition() {
    if (!item.barcode || item.id == null) return
    setFetchingNutrition(true)
    setNutritionNote('')
    try {
      const { lookupBarcode } = await import('../lib/openfoodfacts')
      const product = await lookupBarcode(item.barcode)
      if (product?.nutrition) {
        await database.items.update(item.id, { nutrition: product.nutrition })
        toast('Nutrition added')
      } else {
        setNutritionNote(
          product
            ? 'Open Food Facts has this product but publishes no nutrition for it.'
            : `Barcode ${item.barcode} isn't in Open Food Facts.`,
        )
      }
    } catch (err) {
      setNutritionNote(err instanceof Error ? err.message : 'The lookup failed.')
    } finally {
      setFetchingNutrition(false)
    }
  }

  return (
    <Sheet title={item.name} onClose={onClose}>
      {hero && (
        <div className="photo-hero">
          <img src={hero} alt={item.name} className={heroCutout ? 'is-cutout' : undefined} />
          {credit && <span className="photo-credit">{credit}</span>}
        </div>
      )}

      <div className="row" style={{ gap: 14 }}>
        <FreshnessRing item={item} big showPhoto={!hero} />
        <div>
          <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.03em' }}>
            {formatPack(item.qty, item)}
          </div>
          {total && (
            <div style={{ fontSize: 12.5, color: 'var(--text-mute)', marginTop: 1 }}>
              {formatAmount(total.value, total.unit)} in total
            </div>
          )}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 5 }}>
            <span className="chip"><span className="dot" style={{ background: `var(--cat-${meta.hue})` }} />{meta.label}</span>
            <span className="chip">{placeEmoji(places, item.location)} {placeLabel(places, item.location)}</span>
            <ExpiryChip item={item} />
            {item.isMain && (
              <span className="chip" style={{ color: 'var(--warn)' }}><span className="dot" />Main dish</span>
            )}
            {(() => {
              const slot = SLOTS.find((s) => s.key === item.meal)
              return slot ? <span className="chip">{slot.emoji} {slot.label}</span> : null
            })()}
          </div>
        </div>
      </div>

      {item.reserved > 0 && (
        <div className="card card-pad" style={{ borderLeft: '3px solid var(--accent-2)' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--accent-2)', marginBottom: 6 }}>
            {formatAmount(item.reserved, item.unit)} is spoken for
          </div>
          <div className="stack" style={{ gap: 6 }}>
            {item.holds.map((h) => (
              <div className="row" key={h.id} style={{ fontSize: 13 }}>
                <span style={{ color: 'var(--text-dim)' }}>{h.label}</span>
                <span className="spacer" />
                <span className="tabular" style={{ color: 'var(--text-mute)' }}>{formatAmount(h.qty, item.unit)}</span>
                <button className="btn ghost sm" onClick={() => releaseHold(h.id!)}>Release</button>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 8 }}>
            Free to use right now: <strong style={{ color: 'var(--text-dim)' }}>{formatAmount(item.available, item.unit)}</strong>
          </p>
        </div>
      )}

      {mode === 'menu' && (
        <>
          {/* The common correction — "there are actually three" — shouldn't
              require opening a form. */}
          <div className="card card-pad row" style={{ justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-mute)' }}>
                Quantity
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-mute)', marginTop: 2 }}>
                Corrections are logged separately from eating or binning
              </div>
            </div>
            <div className="row" style={{ gap: 8, flex: 'none' }}>
              <button className="btn" aria-label="One fewer" disabled={item.qty <= 0} onClick={() => bump(-1)}>−</button>
              <span className="tabular" style={{ minWidth: 58, textAlign: 'center', fontWeight: 700, fontSize: 17 }}>
                {formatAmount(item.qty, item.unit)}
              </span>
              <button className="btn" aria-label="One more" onClick={() => bump(1)}>+</button>
            </div>
          </div>

          <div className="grid-2">
            <button className="btn" onClick={() => { setMode('use'); setAmount(String(item.available || item.qty)) }}>🍽️ Used some</button>
            <button className="btn" onClick={() => { setMode('toss'); setAmount(String(item.qty)) }}>🗑️ Threw out</button>
            <button className="btn" onClick={() => { setMode('hold'); setAmount(String(item.available)) }} disabled={item.available <= 0}>
              🔒 Save for a meal
            </button>
            <button className="btn" onClick={() => setMode('photo')}>
              {hero ? '🖼️ Change photo' : '📷 Add a photo'}
            </button>
            <button className="btn" onClick={() => setMode('edit')}>✏️ Edit details</button>
            <button
              className="btn danger"
              style={{ gridColumn: '1 / -1' }}
              onClick={async () => { await deleteItem(item.id!); toast('Removed'); onClose() }}
            >
              Remove entirely
            </button>
          </div>

          <Field label="Move it somewhere else">
            <select value={item.location} onChange={(e) => move(e.target.value as StorageLocation)}>
              {places.map((l) => <option key={l.key} value={l.key}>{l.emoji} {l.label}</option>)}
            </select>
          </Field>

          <dl style={{ margin: 0, fontSize: 12.5, color: 'var(--text-mute)', display: 'grid', gap: 4 }}>
            <div className="row"><dt>Bought</dt><span className="spacer" /><dd style={{ margin: 0, color: 'var(--text-dim)' }}>{relativeDays(item.purchasedAt)}</dd></div>
            {item.expiresAt && (
              <div className="row"><dt>Best before</dt><span className="spacer" /><dd style={{ margin: 0, color: 'var(--text-dim)' }}>{item.expiresAt} · {fresh.days}d</dd></div>
            )}
            {perUnit > 0 && (
              <div className="row">
                <dt>Value left</dt><span className="spacer" />
                <dd style={{ margin: 0, color: 'var(--text-dim)' }}>${(perUnit * item.qty).toFixed(2)} (${perUnit.toFixed(2)}/{item.unit})</dd>
              </div>
            )}
            {item.isStaple && (
              <div className="row"><dt>Staple</dt><span className="spacer" /><dd style={{ margin: 0, color: 'var(--text-dim)' }}>rebuy below {item.parQty} {item.unit}</dd></div>
            )}
          </dl>
        </>
      )}

      {mode === 'menu' && item.nutrition && <NutritionPanel nutrition={item.nutrition} />}

      {/* Items scanned before nutrition existed, and ones whose product was
          undocumented at the time, can go and ask again on demand. */}
      {mode === 'menu' && !item.nutrition && item.barcode && (
        <div className="card card-pad stack">
          <button className="btn ghost block" disabled={fetchingNutrition} onClick={loadNutrition}>
            {fetchingNutrition ? 'Looking it up…' : '🔎 Look up nutrition'}
          </button>
          {nutritionNote && (
            <p style={{ fontSize: 12, color: 'var(--text-mute)' }}>{nutritionNote}</p>
          )}
        </div>
      )}

      {mode === 'edit' && (
        <EditItemSheet item={item} onClose={() => { setMode('menu'); onClose() }} />
      )}

      {mode === 'photo' && (
        <div className="card card-pad stack">
          <PhotoCapture
            photoId={item.photoId}
            label="Picture of this item"
            onChange={async (next) => {
              await setItemPhoto(item.id!, next)
              toast(next == null ? 'Photo removed' : 'Photo saved')
            }}
          />
          <button className="btn ghost block" onClick={() => setMode('menu')}>Done</button>
        </div>
      )}

      {(mode === 'use' || mode === 'toss' || mode === 'hold') && (
        <div className="card card-pad stack">
          <Field label={`How much? (${item.unit})`}>
            <input type="number" min="0" step="0.25" max={mode === 'hold' ? item.available : item.qty} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Field>

          {mode === 'toss' && (
            <Field label="What happened?">
              <select value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">Pick a reason…</option>
                <option>Went off before we got to it</option>
                <option>Forgot it was in there</option>
                <option>Cooked too much</option>
                <option>Didn't like it</option>
                <option>Freezer burn</option>
              </select>
            </Field>
          )}

          {mode === 'hold' && (
            <Field label="Saving it for">
              <input type="text" placeholder="Sunday roast" value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
          )}

          {mode === 'toss' && perUnit > 0 && (
            <p style={{ fontSize: 12.5, color: 'var(--fresh-expired)' }}>
              That's ${(perUnit * (Number(amount) || 0)).toFixed(2)} in the bin. It'll show up in Insights.
            </p>
          )}

          <div className="row" style={{ gap: 9 }}>
            <button className="btn ghost" style={{ flex: 1 }} onClick={() => setMode('menu')}>Back</button>
            <button
              className="btn primary"
              style={{ flex: 1 }}
              onClick={mode === 'use' ? doUse : mode === 'toss' ? doToss : doHold}
              disabled={!(Number(amount) > 0)}
            >
              {mode === 'use' ? 'Log it' : mode === 'toss' ? 'Log the waste' : 'Reserve it'}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  )
}
