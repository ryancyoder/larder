import { useState } from 'react'
import type { Combo, ComboPart, ItemView, MealSlot } from '../db/schema'
import { deleteCombo, saveCombo } from '../lib/combos'
import { bestMatch, titleCase } from '../lib/match'
import { SLOTS } from '../lib/plan'
import { todayISO } from '../lib/dates'
import { Field, Sheet } from './ui'
import { useToast } from '../app/toast'

/**
 * Build or edit a combination.
 *
 * Parts are typed as names rather than picked from a fixed list, because half
 * the point is writing down a set you don't own yet — "pasta and sauce" is
 * worth recording on the day you've run out of both. Anything that does match
 * something in the kitchen is linked to it as you type.
 */
export default function ComboEditor({
  combo, stock, onClose,
}: {
  /** Undefined when creating. */
  combo?: Combo
  stock: ItemView[]
  onClose: () => void
}) {
  const toast = useToast()
  const [name, setName] = useState(combo?.name ?? '')
  const [emoji, setEmoji] = useState(combo?.emoji ?? '🍽️')
  const [meal, setMeal] = useState<MealSlot | undefined>(combo?.meal)
  const [notes, setNotes] = useState(combo?.notes ?? '')
  const [parts, setParts] = useState<ComboPart[]>(combo?.parts ?? [])
  const [draft, setDraft] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const canSave = name.trim().length > 0 && parts.length >= 2

  function addPart(raw: string) {
    const text = raw.trim()
    if (!text) return
    // Link it to a real row when one matches, so "have I got this?" is exact
    // rather than a name comparison every time it's read.
    const match = bestMatch(text, stock, (i) => i.name)
    setParts((p) => [...p, { name: match ? match.name : titleCase(text), itemId: match?.id }])
    setDraft('')
  }

  function toggleOptional(index: number) {
    setParts((p) => p.map((part, i) => (i === index ? { ...part, optional: !part.optional } : part)))
  }

  async function save() {
    await saveCombo({
      ...combo,
      id: combo?.id,
      name: name.trim(),
      emoji: emoji.trim() || '🍽️',
      parts,
      meal,
      notes: notes.trim() || undefined,
      createdAt: combo?.createdAt ?? todayISO(),
      timesUsed: combo?.timesUsed ?? 0,
      source: combo?.source ?? 'custom',
    })
    toast(combo ? `${name.trim()} updated` : `${name.trim()} saved`)
    onClose()
  }

  async function remove() {
    if (combo?.id == null) return
    await deleteCombo(combo.id)
    toast('Combination deleted')
    onClose()
  }

  return (
    <Sheet
      title={combo ? `Edit ${combo.name}` : 'New combination'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!canSave} onClick={save}>
            {combo ? 'Save' : 'Save combination'}
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
              value={name}
              placeholder="Pasta night"
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </div>
      </div>

      <div className="field">
        <label>What's in it</label>
        <div className="stack-sm">
          {parts.map((part, i) => (
            <div className="item" key={`${part.name}-${i}`} style={{ padding: '8px 10px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="name" style={{ fontSize: 14 }}>{part.name}</div>
                <div className="meta">
                  <span>{part.itemId != null ? 'Linked to your kitchen' : 'By name'}</span>
                </div>
              </div>
              <button
                className={`chip toggle${part.optional ? ' on' : ''}`}
                onClick={() => toggleOptional(i)}
                title="Optional parts don't count against the set being complete"
              >
                optional
              </button>
              <button
                className="btn ghost sm"
                aria-label={`Remove ${part.name}`}
                onClick={() => setParts((p) => p.filter((_, j) => j !== i))}
              >✕</button>
            </div>
          ))}
          {parts.length === 0 && (
            <p style={{ fontSize: 12.5, color: 'var(--text-mute)' }}>
              Add at least two things — a combination of one isn't one.
            </p>
          )}
        </div>

        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <input
            type="text"
            list="combo-stock"
            value={draft}
            placeholder="Add something…"
            style={{ flex: 1 }}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPart(draft) } }}
          />
          <button className="btn" disabled={!draft.trim()} onClick={() => addPart(draft)}>Add</button>
        </div>
        {/* Typeahead over the kitchen, but free text is still accepted. */}
        <datalist id="combo-stock">
          {stock.map((i) => <option key={i.id} value={i.name} />)}
        </datalist>
      </div>

      <div className="field">
        <label>Meal (optional)</label>
        <div className="tag-row">
          {SLOTS.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`chip toggle${meal === s.key ? ' on' : ''}`}
              aria-pressed={meal === s.key}
              onClick={() => setMeal(meal === s.key ? undefined : s.key)}
            >
              {s.emoji} {s.label}
            </button>
          ))}
        </div>
      </div>

      <Field label="Note (optional)">
        <input
          type="text"
          value={notes}
          placeholder="The one the kids actually eat"
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      {combo && (
        <div className="card card-pad stack">
          {!confirmingDelete ? (
            <button className="btn danger block" onClick={() => setConfirmingDelete(true)}>
              Delete this combination
            </button>
          ) : (
            <>
              <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                Removes the combination only. Nothing in your kitchen is touched.
              </p>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn ghost" style={{ flex: 1 }} onClick={() => setConfirmingDelete(false)}>
                  Keep it
                </button>
                <button className="btn danger" style={{ flex: 1 }} onClick={remove}>Delete</button>
              </div>
            </>
          )}
        </div>
      )}
    </Sheet>
  )
}
