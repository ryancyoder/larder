import { useEffect, useState } from 'react'
import type { StorageKind, StoragePlace } from '../db/schema'
import { KINDS, addPlace, countItemsIn, deletePlace, updatePlace } from '../lib/locations'
import { Field, Sheet } from './ui'
import PhotoCapture from './PhotoCapture'
import { useToast } from '../app/toast'

/**
 * Add or edit one storage location. Deleting always says where the contents go,
 * because items pointing at a location that no longer exists would vanish from
 * the Kitchen without explanation.
 */
export default function PlaceEditor({
  place, allPlaces, onClose,
}: {
  /** Undefined when adding. */
  place?: StoragePlace
  allPlaces: StoragePlace[]
  onClose: () => void
}) {
  const toast = useToast()
  const [label, setLabel] = useState(place?.label ?? '')
  const [emoji, setEmoji] = useState(place?.emoji ?? '📦')
  const [blurb, setBlurb] = useState(place?.blurb ?? '')
  const [kind, setKind] = useState<StorageKind>(place?.kind ?? 'pantry')
  const [photoId, setPhotoId] = useState<number | undefined>(place?.photoId)

  const [itemCount, setItemCount] = useState<number | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [moveTo, setMoveTo] = useState('')

  const others = allPlaces.filter((p) => p.id !== place?.id)
  const isLast = Boolean(place) && others.length === 0

  useEffect(() => {
    if (!place) return
    countItemsIn(place.key).then(setItemCount)
    setMoveTo(others[0]?.key ?? '')
    // `others` is derived from props that don't change while the sheet is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place])

  const canSave = label.trim().length > 0

  async function save() {
    if (place?.id) {
      await updatePlace(place.id, { label: label.trim(), emoji: emoji.trim() || '📦', photoId, blurb: blurb.trim(), kind })
      toast(`${label.trim()} updated`)
    } else {
      await addPlace({ label, emoji, photoId, blurb, kind })
      toast(`${label.trim()} added`)
    }
    onClose()
  }

  async function remove() {
    if (!place?.id) return
    try {
      await deletePlace(place.id, moveTo)
      toast(itemCount ? `Deleted — ${itemCount} items moved` : 'Location deleted')
      onClose()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete that location')
    }
  }

  return (
    <Sheet
      title={place ? `Edit ${place.label}` : 'New storage location'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!canSave} onClick={save}>
            {place ? 'Save' : 'Add location'}
          </button>
        </>
      }
    >
      <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
        <Field label="Icon">
          <input
            type="text"
            value={emoji}
            maxLength={4}
            style={{ width: 62, textAlign: 'center', fontSize: 20 }}
            onChange={(e) => setEmoji(e.target.value)}
          />
        </Field>
        <div style={{ flex: 1 }}>
          <Field label="Name">
            <input
              type="text"
              value={label}
              placeholder="Garage fridge"
              autoFocus
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
        </div>
      </div>

      <PhotoCapture photoId={photoId} onChange={setPhotoId} label="Picture (optional)" />
      <p style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: -4 }}>
        A shot of the actual shelf, shown instead of the icon wherever this location appears.
      </p>

      <Field label="Short note (optional)">
        <input
          type="text"
          value={blurb}
          placeholder="Overflow and drinks"
          onChange={(e) => setBlurb(e.target.value)}
        />
      </Field>

      <div className="field">
        <label>How it stores</label>
        <div className="stack" style={{ gap: 6 }}>
          {KINDS.map((k) => (
            <button
              key={k.key}
              className="item"
              style={{
                padding: '10px 12px',
                borderColor: kind === k.key ? 'var(--accent)' : 'var(--line)',
                background: kind === k.key ? 'var(--accent-soft)' : 'var(--bg-1)',
              }}
              onClick={() => setKind(k.key)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="name" style={{ fontSize: 14 }}>{k.label}</div>
                <div className="meta"><span>{k.hint}</span></div>
              </div>
              {kind === k.key && <span style={{ color: 'var(--accent)', fontWeight: 700 }}>✓</span>}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 6 }}>
          This is what drives the suggested best-before dates — a jar of pasta sauce gets a very
          different guess in a fridge than in a cupboard.
        </p>
      </div>

      {place && (
        <div className="card card-pad stack">
          {isLast ? (
            <p style={{ fontSize: 12.5, color: 'var(--text-mute)' }}>
              This is your only storage location, so it can't be deleted. Add another one first.
            </p>
          ) : !confirmingDelete ? (
            <button className="btn danger block" onClick={() => setConfirmingDelete(true)}>
              Delete this location
            </button>
          ) : (
            <>
              <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                {itemCount
                  ? `${itemCount} ${itemCount === 1 ? 'item is' : 'items are'} in ${place.label}. Where should they go?`
                  : `${place.label} is empty, so nothing will move.`}
              </p>
              {!!itemCount && (
                <Field label="Move them to">
                  <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                    {others.map((p) => (
                      <option key={p.key} value={p.key}>{p.emoji} {p.label}</option>
                    ))}
                  </select>
                </Field>
              )}
              <div className="row" style={{ gap: 8 }}>
                <button className="btn ghost" style={{ flex: 1 }} onClick={() => setConfirmingDelete(false)}>
                  Keep it
                </button>
                <button className="btn danger" style={{ flex: 1 }} onClick={remove}>
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Sheet>
  )
}
