import { useEffect, useState } from 'react'
import type { Person } from '../db/schema'
import { addPerson, countHoldsFor, deletePerson, updatePerson } from '../lib/people'
import { HUES } from '../lib/categories'
import { Field, Sheet } from './ui'
import { useToast } from '../app/toast'

/**
 * Add or edit someone in the household.
 *
 * Deliberately thin: a name, a face and a colour. This is a list of who food
 * gets set aside for, not a list of accounts — nothing signs in, and nothing
 * here is private to anyone.
 */
export default function PersonEditor({
  person, allPeople, onClose,
}: {
  /** Undefined when adding. */
  person?: Person
  allPeople: Person[]
  onClose: () => void
}) {
  const toast = useToast()
  const [name, setName] = useState(person?.name ?? '')
  const [emoji, setEmoji] = useState(person?.emoji ?? '🙂')
  const [hue, setHue] = useState(person?.hue ?? 'other')
  const [holds, setHolds] = useState<number | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const isLast = Boolean(person) && allPeople.length <= 1
  const canSave = name.trim().length > 0

  useEffect(() => {
    if (person) countHoldsFor(person.key).then(setHolds)
  }, [person])

  async function save() {
    const patch = { name: name.trim(), emoji: emoji.trim() || '🙂', hue }
    if (person?.id) {
      await updatePerson(person.id, patch)
      toast(`${patch.name} updated`)
    } else {
      await addPerson(patch)
      toast(`${patch.name} added`)
    }
    onClose()
  }

  async function remove() {
    if (person?.id == null) return
    try {
      await deletePerson(person.id)
      toast(`${person.name} removed`)
      onClose()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not remove them')
    }
  }

  return (
    <Sheet
      title={person ? `Edit ${person.name}` : 'Add someone'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!canSave} onClick={save}>
            {person ? 'Save' : 'Add'}
          </button>
        </>
      }
    >
      <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
        <Field label="Face">
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
              value={name}
              placeholder="Grandma"
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </div>
      </div>

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
      </div>

      {person && (
        <div className="card card-pad stack">
          {isLast ? (
            <p style={{ fontSize: 12.5, color: 'var(--text-mute)' }}>
              This is the only person in the household, so they can't be removed. Add someone else
              first.
            </p>
          ) : !confirmingDelete ? (
            <button className="btn danger block" onClick={() => setConfirmingDelete(true)}>
              Remove from the household
            </button>
          ) : (
            <>
              <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                {holds
                  ? `${holds} ${holds === 1 ? 'hold is' : 'holds are'} set aside for ${person.name}. Those stay exactly as they are — a hold records a decision that was made, and quietly handing someone's dinner to somebody else would be worse than a name that no longer appears here.`
                  : `Nothing is currently set aside for ${person.name}.`}
              </p>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn ghost" style={{ flex: 1 }} onClick={() => setConfirmingDelete(false)}>
                  Keep them
                </button>
                <button className="btn danger" style={{ flex: 1 }} onClick={remove}>Remove</button>
              </div>
            </>
          )}
        </div>
      )}
    </Sheet>
  )
}
