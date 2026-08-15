import { useState } from 'react'
import type { Ingredient, Recipe, Unit } from '../db/schema'
import { ALL_UNITS } from '../lib/units'
import { db } from '../db/db'
import { todayISO } from '../lib/dates'
import { Field, Sheet } from './ui'
import { useToast } from '../app/toast'

const BLANK: Omit<Recipe, 'id'> = {
  title: '', emoji: '🍽️', description: '', servings: 2, prepMin: 10, cookMin: 20,
  tags: [], ingredients: [{ name: '' }], steps: [''], favorite: false,
  source: 'custom', createdAt: todayISO(), timesCooked: 0,
}

export default function RecipeEditor({ recipe, onClose }: { recipe?: Recipe; onClose: () => void }) {
  const toast = useToast()
  const [draft, setDraft] = useState<Recipe>(() => ({ ...(BLANK as Recipe), ...(recipe ?? {}) }))
  const set = <K extends keyof Recipe>(key: K, value: Recipe[K]) => setDraft((d) => ({ ...d, [key]: value }))

  const setIngredient = (i: number, patch: Partial<Ingredient>) =>
    set('ingredients', draft.ingredients.map((ing, n) => (n === i ? { ...ing, ...patch } : ing)))

  const canSave = draft.title.trim().length > 0 && draft.ingredients.some((i) => i.name.trim())

  async function save() {
    const clean: Recipe = {
      ...draft,
      title: draft.title.trim(),
      emoji: draft.emoji.trim() || '🍽️',
      ingredients: draft.ingredients.filter((i) => i.name.trim()).map((i) => ({ ...i, name: i.name.trim() })),
      steps: draft.steps.map((s) => s.trim()).filter(Boolean),
    }
    if (clean.id) await db.recipes.put(clean)
    else await db.recipes.add(clean)
    toast(recipe ? 'Recipe updated' : `${clean.title} saved`)
    onClose()
  }

  async function remove() {
    if (draft.id) await db.recipes.delete(draft.id)
    toast('Recipe deleted')
    onClose()
  }

  return (
    <Sheet
      title={recipe ? 'Edit recipe' : 'New recipe'}
      onClose={onClose}
      footer={
        <>
          {recipe ? <button className="btn danger" onClick={remove}>Delete</button> : <button className="btn ghost" onClick={onClose}>Cancel</button>}
          <button className="btn primary" disabled={!canSave} onClick={save}>Save</button>
        </>
      }
    >
      <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
        <Field label="Icon">
          <input type="text" value={draft.emoji} maxLength={4} style={{ width: 62, textAlign: 'center', fontSize: 20 }} onChange={(e) => set('emoji', e.target.value)} />
        </Field>
        <div style={{ flex: 1 }}>
          <Field label="Name">
            <input type="text" value={draft.title} placeholder="Sunday roast chicken" onChange={(e) => set('title', e.target.value)} autoFocus />
          </Field>
        </div>
      </div>

      <Field label="One-line description">
        <input type="text" value={draft.description ?? ''} placeholder="What makes it worth cooking" onChange={(e) => set('description', e.target.value)} />
      </Field>

      <div className="grid-2">
        <Field label="Servings">
          <input type="number" min="1" value={draft.servings} onChange={(e) => set('servings', Number(e.target.value) || 1)} />
        </Field>
        <Field label="Tags (comma separated)">
          <input type="text" value={draft.tags.join(', ')} placeholder="weeknight, vegetarian" onChange={(e) => set('tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))} />
        </Field>
        <Field label="Prep (min)">
          <input type="number" min="0" value={draft.prepMin} onChange={(e) => set('prepMin', Number(e.target.value) || 0)} />
        </Field>
        <Field label="Cook (min)">
          <input type="number" min="0" value={draft.cookMin} onChange={(e) => set('cookMin', Number(e.target.value) || 0)} />
        </Field>
      </div>

      <div className="field">
        <label>Ingredients</label>
        <div className="stack" style={{ gap: 7 }}>
          {draft.ingredients.map((ing, i) => (
            <div className="row" key={i} style={{ gap: 6 }}>
              <input
                type="text"
                value={ing.name}
                placeholder="chicken thighs"
                style={{ flex: 1 }}
                onChange={(e) => setIngredient(i, { name: e.target.value })}
              />
              <input
                type="number"
                value={ing.qty ?? ''}
                placeholder="qty"
                step="0.25"
                min="0"
                style={{ width: 68 }}
                onChange={(e) => setIngredient(i, { qty: e.target.value ? Number(e.target.value) : undefined })}
              />
              <select
                value={ing.unit ?? ''}
                style={{ width: 78 }}
                onChange={(e) => setIngredient(i, { unit: (e.target.value || undefined) as Unit | undefined })}
              >
                <option value="">—</option>
                {ALL_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
              <button
                className="close-x"
                aria-label="Remove ingredient"
                onClick={() => set('ingredients', draft.ingredients.filter((_, n) => n !== i))}
              >✕</button>
            </div>
          ))}
        </div>
        <button className="btn ghost sm" style={{ alignSelf: 'flex-start', marginTop: 6 }} onClick={() => set('ingredients', [...draft.ingredients, { name: '' }])}>
          + Add ingredient
        </button>
      </div>

      <Field label="Method — one step per line">
        <textarea
          rows={7}
          value={draft.steps.join('\n')}
          placeholder={'Sear the chicken skin-side down until it releases cleanly.\nSoften the onion in the rendered fat.'}
          onChange={(e) => set('steps', e.target.value.split('\n'))}
        />
      </Field>

      <label className="row" style={{ gap: 10, cursor: 'pointer' }}>
        <input type="checkbox" checked={draft.favorite} onChange={(e) => set('favorite', e.target.checked)} />
        <span style={{ fontSize: 13.5 }}>Favourite — ranks higher in suggestions</span>
      </label>
    </Sheet>
  )
}
