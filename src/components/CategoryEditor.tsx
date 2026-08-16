import { useEffect, useState } from 'react'
import type { StorageCategory, StorageKind } from '../db/schema'
import {
  HUES, addCategory, countItemsWithCategory, deleteCategory, updateCategory,
} from '../lib/categories'
import { KINDS, kindLabel } from '../lib/locations'
import { Field, Sheet } from './ui'
import PhotoCapture from './PhotoCapture'
import { useToast } from '../app/toast'

/**
 * Add or edit one food category.
 *
 * A category carries more than a name: it decides where a new item is filed,
 * how long the app thinks it keeps, and where it lands on the shopping list.
 * Those are all editable here, because a category you invent is useless if the
 * app can't guess a best-before date for it.
 */
export default function CategoryEditor({
  category, allCategories, onClose,
}: {
  /** Undefined when adding. */
  category?: StorageCategory
  allCategories: StorageCategory[]
  onClose: () => void
}) {
  const toast = useToast()
  const [label, setLabel] = useState(category?.label ?? '')
  const [emoji, setEmoji] = useState(category?.emoji ?? '📦')
  const [photoId, setPhotoId] = useState<number | undefined>(category?.photoId)
  const [hue, setHue] = useState(category?.hue ?? 'other')
  const [homeKind, setHomeKind] = useState<StorageKind>(category?.homeKind ?? 'pantry')
  const [shelfLife, setShelfLife] = useState<Partial<Record<StorageKind, string>>>(() => {
    const from = category?.shelfLife ?? { pantry: 180, chilled: 14, frozen: 180, counter: 7 }
    return Object.fromEntries(KINDS.map((k) => [k.key, from[k.key] != null ? String(from[k.key]) : '']))
  })

  const [itemCount, setItemCount] = useState<number | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [moveTo, setMoveTo] = useState('')

  const others = allCategories.filter((c) => c.id !== category?.id)
  const isLast = Boolean(category) && others.length === 0

  useEffect(() => {
    if (!category) return
    countItemsWithCategory(category.key).then(setItemCount)
    setMoveTo(others[0]?.key ?? '')
    // `others` derives from props that don't change while the sheet is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category])

  const canSave = label.trim().length > 0

  function packShelfLife(): Partial<Record<StorageKind, number>> {
    const out: Partial<Record<StorageKind, number>> = {}
    for (const k of KINDS) {
      const raw = shelfLife[k.key]
      const n = raw != null && raw.trim() ? Number(raw) : NaN
      // A blank means "no idea", which is different from zero days.
      if (Number.isFinite(n) && n > 0) out[k.key] = Math.round(n)
    }
    return out
  }

  async function save() {
    const patch = {
      label: label.trim(),
      emoji: emoji.trim() || '📦',
      photoId,
      hue,
      homeKind,
      shelfLife: packShelfLife(),
    }
    if (category?.id) {
      await updateCategory(category.id, patch)
      toast(`${patch.label} updated`)
    } else {
      await addCategory(patch)
      toast(`${patch.label} added`)
    }
    onClose()
  }

  async function remove() {
    if (!category?.id) return
    try {
      await deleteCategory(category.id, moveTo)
      toast(itemCount ? `Deleted — ${itemCount} items recategorised` : 'Category deleted')
      onClose()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete that category')
    }
  }

  return (
    <Sheet
      title={category ? `Edit ${category.label}` : 'New category'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!canSave} onClick={save}>
            {category ? 'Save' : 'Add category'}
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
              placeholder="Baby food"
              autoFocus
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
        </div>
      </div>

      <PhotoCapture photoId={photoId} onChange={setPhotoId} label="Picture (optional)" />
      <p style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: -4 }}>
        Used instead of the icon wherever this category is shown. The icon stays as the fallback.
      </p>

      <div className="field">
        <label>Colour</label>
        <div className="hue-row">
          {HUES.map((h) => (
            <button
              key={h}
              type="button"
              className={`hue-swatch${hue === h ? ' on' : ''}`}
              style={{ background: `var(--cat-${h})` }}
              aria-label={h}
              aria-pressed={hue === h}
              onClick={() => setHue(h)}
            />
          ))}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 6 }}>
          A fixed palette rather than a colour picker — these are the twelve that stay legible
          against both themes and are safe for colour-blind readers.
        </p>
      </div>

      <Field label="Usually lives in">
        <select value={homeKind} onChange={(e) => setHomeKind(e.target.value as StorageKind)}>
          {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
      </Field>

      <div className="field">
        <label>Keeps for, in days</label>
        <div className="grid-2">
          {KINDS.map((k) => (
            <Field key={k.key} label={kindLabel(k.key)}>
              <input
                type="number"
                min="0"
                step="1"
                placeholder="—"
                value={shelfLife[k.key] ?? ''}
                onChange={(e) => setShelfLife((s) => ({ ...s, [k.key]: e.target.value }))}
              />
            </Field>
          ))}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 6 }}>
          What the suggested best-before date is built from. Leave one blank if this never goes
          there — the app falls back to a fortnight rather than guessing wildly.
        </p>
      </div>

      {category && (
        <div className="card card-pad stack">
          {isLast ? (
            <p style={{ fontSize: 12.5, color: 'var(--text-mute)' }}>
              This is your only category, so it can't be deleted. Add another one first.
            </p>
          ) : !confirmingDelete ? (
            <button className="btn danger block" onClick={() => setConfirmingDelete(true)}>
              Delete this category
            </button>
          ) : (
            <>
              <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                {itemCount
                  ? `${itemCount} ${itemCount === 1 ? 'item is' : 'items are'} filed under ${category.label}. What should they become?`
                  : `Nothing is filed under ${category.label}, so nothing will move.`}
              </p>
              {!!itemCount && (
                <Field label="Recategorise them as">
                  <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                    {others.map((c) => (
                      <option key={c.key} value={c.key}>{c.emoji} {c.label}</option>
                    ))}
                  </select>
                </Field>
              )}
              <p style={{ fontSize: 12, color: 'var(--text-mute)' }}>
                Past spend and waste keep the old category — that's what they were bought as, and
                rewriting history would make the figures wrong.
              </p>
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
