import { useState } from 'react'
import type { Category, MealSlot } from '../db/schema'

import { useCategories, usePlaces } from '../app/data'
import { SLOTS } from '../lib/plan'
import { applyBulk, deleteMany, hasChanges, type BulkChanges } from '../lib/bulk'
import { Field, Sheet } from './ui'
import { useToast } from '../app/toast'

/**
 * Apply one change across many items.
 *
 * Every control starts at "leave unchanged" and stays there unless touched, so
 * editing the location of forty items can't quietly rewrite their categories.
 */
export default function BulkEditSheet({
  ids, onClose, onDone,
}: {
  ids: number[]
  onClose: () => void
  /** Called after a successful apply so the caller can leave selection mode. */
  onDone: () => void
}) {
  const toast = useToast()
  const places = usePlaces() ?? []
  const cats = useCategories() ?? []
  const [changes, setChanges] = useState<BulkChanges>({})
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const set = <K extends keyof BulkChanges>(key: K, value: BulkChanges[K]) =>
    setChanges((c) => ({ ...c, [key]: value }))

  const dirty = hasChanges(changes)
  const noun = `${ids.length} item${ids.length === 1 ? '' : 's'}`

  async function apply() {
    const touched = await applyBulk(ids, changes)
    toast(touched === ids.length ? `Updated ${noun}` : `Updated ${touched} of ${ids.length}`)
    onDone()
  }

  async function remove() {
    await deleteMany(ids)
    toast(`Deleted ${noun}`)
    onDone()
  }

  return (
    <Sheet
      title={`Edit ${noun}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!dirty} onClick={apply}>
            Apply to {ids.length}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>
        Anything left on “leave unchanged” stays exactly as it is on each item.
      </p>

      <Field label="Move to">
        <select
          value={changes.location ?? ''}
          onChange={(e) => set('location', e.target.value || undefined)}
        >
          <option value="">Leave unchanged</option>
          {places.map((p) => <option key={p.key} value={p.key}>{p.emoji} {p.label}</option>)}
        </select>
      </Field>

      <Field label="Category">
        <select
          value={changes.category ?? ''}
          onChange={(e) => set('category', (e.target.value || undefined) as Category | undefined)}
        >
          <option value="">Leave unchanged</option>
          {cats.map((c) => <option key={c.key} value={c.key}>{c.emoji} {c.label}</option>)}
        </select>
      </Field>

      <div className="field">
        <label>Meal</label>
        <div className="tag-row">
          <button
            type="button"
            className={`chip toggle${changes.meal === undefined ? ' on' : ''}`}
            onClick={() => set('meal', undefined)}
          >
            Leave unchanged
          </button>
          {SLOTS.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`chip toggle${changes.meal === s.key ? ' on' : ''}`}
              onClick={() => set('meal', s.key as MealSlot)}
            >
              {s.emoji} {s.label}
            </button>
          ))}
          <button
            type="button"
            className={`chip toggle${changes.meal === 'none' ? ' on' : ''}`}
            onClick={() => set('meal', 'none')}
          >
            Clear meal
          </button>
        </div>
      </div>

      <div className="field">
        <label>Main dish</label>
        <div className="tag-row">
          <button
            type="button"
            className={`chip toggle${changes.isMain === undefined ? ' on' : ''}`}
            onClick={() => set('isMain', undefined)}
          >
            Leave unchanged
          </button>
          <button
            type="button"
            className={`chip toggle is-main${changes.isMain === true ? ' on' : ''}`}
            onClick={() => set('isMain', true)}
          >
            ⭐ Mark as main
          </button>
          <button
            type="button"
            className={`chip toggle${changes.isMain === false ? ' on' : ''}`}
            onClick={() => set('isMain', false)}
          >
            Not a main
          </button>
        </div>
        {changes.isMain === true && (
          <p style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 6 }}>
            Skipped on anything that ends up as a snack or with no meal — those can't have a main.
            Anything not already counted in <strong>ea</strong> gets restated as one, with its weight
            moved to the size field.
          </p>
        )}
      </div>

      <div className="field">
        <label>Staple</label>
        <div className="tag-row">
          <button
            type="button"
            className={`chip toggle${changes.isStaple === undefined ? ' on' : ''}`}
            onClick={() => set('isStaple', undefined)}
          >
            Leave unchanged
          </button>
          <button
            type="button"
            className={`chip toggle${changes.isStaple === true ? ' on' : ''}`}
            onClick={() => set('isStaple', true)}
          >
            Make staples
          </button>
          <button
            type="button"
            className={`chip toggle${changes.isStaple === false ? ' on' : ''}`}
            onClick={() => set('isStaple', false)}
          >
            Not staples
          </button>
        </div>
      </div>

      <div className="card card-pad stack">
        {!confirmingDelete ? (
          <button className="btn danger block" onClick={() => setConfirmingDelete(true)}>
            Delete {noun}
          </button>
        ) : (
          <>
            <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
              Permanently remove {noun}, along with any photos and reservations. This can't be undone.
            </p>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn ghost" style={{ flex: 1 }} onClick={() => setConfirmingDelete(false)}>Keep them</button>
              <button className="btn danger" style={{ flex: 1 }} onClick={remove}>Delete</button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}
