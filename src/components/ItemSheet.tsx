import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { ItemView, StorageLocation } from '../db/schema'
import { categoryMeta } from '../lib/categories'
import { placeEmoji, placeLabel } from '../lib/locations'
import { usePlaces } from '../app/data'
import { formatAmount } from '../lib/units'
import { consume, deleteItem, freshnessOf, releaseHold, reserve, unitPrice, waste } from '../lib/inventory'
import { db } from '../db/db'
import { relativeDays } from '../lib/dates'
import { ExpiryChip, Field, FreshnessRing, Sheet } from './ui'
import { useToast } from '../app/toast'
import { usePhotoUrl } from '../app/usePhoto'
import { setItemPhoto } from '../lib/photos'
import PhotoCapture from './PhotoCapture'
import { db as database } from '../db/db'

type Mode = 'menu' | 'use' | 'toss' | 'hold' | 'photo'

export default function ItemSheet({ item, onClose }: { item: ItemView; onClose: () => void }) {
  const toast = useToast()
  const [mode, setMode] = useState<Mode>('menu')
  const [amount, setAmount] = useState(String(item.available || item.qty))
  const [reason, setReason] = useState('')
  const [label, setLabel] = useState('')

  const meta = categoryMeta(item.category)
  const fresh = freshnessOf(item)
  const perUnit = unitPrice(item)
  const places = usePlaces() ?? []
  const hero = usePhotoUrl(item.photoId, 'full')
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

  async function move(location: StorageLocation) {
    if (!item.id) return
    await db.items.update(item.id, { location })
    toast(`Moved to the ${placeLabel(places, location)}`)
  }

  return (
    <Sheet title={item.name} onClose={onClose}>
      {hero && (
        <div className="photo-hero">
          <img src={hero} alt={item.name} />
          {credit && <span className="photo-credit">{credit}</span>}
        </div>
      )}

      <div className="row" style={{ gap: 14 }}>
        <FreshnessRing item={item} big showPhoto={!hero} />
        <div>
          <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.03em' }}>
            {formatAmount(item.qty, item.unit)}
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 5 }}>
            <span className="chip"><span className="dot" style={{ background: `var(--cat-${meta.hue})` }} />{meta.label}</span>
            <span className="chip">{placeEmoji(places, item.location)} {placeLabel(places, item.location)}</span>
            <ExpiryChip item={item} />
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
          <div className="grid-2">
            <button className="btn" onClick={() => { setMode('use'); setAmount(String(item.available || item.qty)) }}>🍽️ Used some</button>
            <button className="btn" onClick={() => { setMode('toss'); setAmount(String(item.qty)) }}>🗑️ Threw out</button>
            <button className="btn" onClick={() => { setMode('hold'); setAmount(String(item.available)) }} disabled={item.available <= 0}>
              🔒 Save for a meal
            </button>
            <button className="btn" onClick={() => setMode('photo')}>
              {hero ? '🖼️ Change photo' : '📷 Add a photo'}
            </button>
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

      {mode !== 'menu' && mode !== 'photo' && (
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
