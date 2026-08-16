import { useState } from 'react'
import type { Category, ItemView, MealSlot, StorageLocation, Unit } from '../db/schema'

import { ALL_UNITS, MEASURE_UNITS, formatAmount, isCountUnit, toEachPack } from '../lib/units'
import { adjustQuantity } from '../lib/inventory'
import { db } from '../db/db'
import { useCategories, usePlaces } from '../app/data'
import { titleCase } from '../lib/match'
import { Field, Sheet } from './ui'
import MealTags, { mainAllowedFor } from './MealTags'
import { useToast } from '../app/toast'

/**
 * Correct anything about an item after the fact.
 *
 * Quantity is handled through `adjustQuantity` rather than a plain write, so a
 * correction lands in the ledger as an `adjust` — neither eaten nor binned —
 * and any holds that no longer fit get trimmed.
 */
export default function EditItemSheet({ item, onClose }: { item: ItemView; onClose: () => void }) {
  const toast = useToast()
  const places = usePlaces() ?? []
  const cats = useCategories() ?? []

  const [name, setName] = useState(item.name)
  const [qty, setQty] = useState(String(item.qty))
  const [unit, setUnit] = useState<Unit>(item.unit)
  const [size, setSize] = useState(item.size != null ? String(item.size) : '')
  const [sizeUnit, setSizeUnit] = useState<Unit>(item.sizeUnit ?? 'g')
  const [category, setCategory] = useState<Category>(item.category)
  const [location, setLocation] = useState<StorageLocation>(item.location)
  const [expiresAt, setExpiresAt] = useState(item.expiresAt ?? '')
  const [price, setPrice] = useState(item.price != null ? String(item.price) : '')
  const [isStaple, setIsStaple] = useState(item.isStaple)
  const [parQty, setParQty] = useState(String(item.parQty ?? 1))
  const [brand, setBrand] = useState(item.brand ?? '')
  const [meal, setMeal] = useState<MealSlot | undefined>(item.meal)
  const [isMain, setIsMain] = useState(Boolean(item.isMain))
  const [converted, setConverted] = useState<string | null>(null)

  const sizeAllowed = isCountUnit(unit)
  const canSave = name.trim().length > 0 && Number(qty) >= 0

  /**
   * A main dish has to be countable, because the calendar spends one per day.
   * Restate the item in 'ea' the moment it's marked as one — visibly, in the
   * open fields, so the change is something you can see and undo rather than a
   * surprise applied on save.
   */
  function onMealChange(next: { meal: MealSlot | undefined; isMain: boolean }) {
    setMeal(next.meal)
    setIsMain(next.isMain)
    if (!next.isMain || unit === 'ea') return

    const patch = toEachPack({
      unit,
      qty: Number(qty) || 1,
      size: size.trim() ? Number(size) : undefined,
      sizeUnit,
    })
    const before = formatAmount(Number(qty) || 1, unit)
    if (patch.unit) setUnit(patch.unit)
    if (patch.qty !== undefined) setQty(String(patch.qty))
    if (patch.size !== undefined) setSize(String(patch.size))
    if (patch.sizeUnit) setSizeUnit(patch.sizeUnit)
    setConverted(`${before} → ${formatAmount(patch.qty ?? (Number(qty) || 1), 'ea')} ea`)
  }

  async function save() {
    const nextQty = Number(qty)
    const sizeValue = sizeAllowed && size.trim() ? Number(size) : undefined

    const mainNow = isMain && mainAllowedFor(meal)
    /**
     * A measure was restated as one countable pack (1.8 lb → 1 ea × 1.8 lb).
     * Nothing was eaten, so the baseline has to move with it — leaving
     * `qtyInitial` at 1.8 would price the pack per pound and draw a full
     * package as half depleted.
     */
    const rebased = mainNow && item.unit !== 'ea' && !isCountUnit(item.unit)

    // Everything except quantity is a plain field update.
    await db.items.update(item.id!, {
      name: titleCase(name.trim()),
      ...(rebased ? { qtyInitial: nextQty } : {}),
      // The control is locked to 'ea' while main is on; enforced again here so
      // no path can persist a main the calendar is unable to count.
      unit: mainNow ? 'ea' : unit,
      size: sizeValue,
      sizeUnit: sizeValue != null ? sizeUnit : undefined,
      category,
      location,
      expiresAt: expiresAt || undefined,
      price: price.trim() ? Number(price) : undefined,
      isStaple,
      parQty: isStaple ? Number(parQty) || 1 : undefined,
      brand: brand.trim() || undefined,
      meal,
      // Belt and braces: the control prevents it, the write enforces it.
      isMain: isMain && mainAllowedFor(meal) ? true : undefined,
    })

    // Quantity goes through the ledger path so the correction is recorded, and
    // so any hold too big for the new count gets trimmed. On a restatement it
    // is handed the *new* baseline, otherwise it would raise qtyInitial straight
    // back to the old measure.
    if (nextQty !== item.qty) {
      await adjustQuantity(
        { ...item, unit: mainNow ? 'ea' : unit, ...(rebased ? { qtyInitial: nextQty } : {}) },
        nextQty,
        rebased ? 'Restated as a countable pack for the meal calendar' : undefined,
      )
    }

    toast(`${titleCase(name.trim())} updated`)
    onClose()
  }

  return (
    <Sheet
      title={`Edit ${item.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!canSave} onClick={save}>Save changes</button>
        </>
      }
    >
      <Field label="Name">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      <div className="grid-2">
        <Field label="How many">
          <input type="number" min="0" step="0.25" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="Counted in">
          <select
            value={unit}
            disabled={isMain}
            title={isMain ? 'Main dishes are counted in ea' : undefined}
            onChange={(e) => setUnit(e.target.value as Unit)}
          >
            {ALL_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Field>
      </div>

      {sizeAllowed ? (
        <>
          <div className="grid-2">
            <Field label="Size of each">
              <input
                type="number"
                min="0"
                step="any"
                placeholder="500"
                value={size}
                onChange={(e) => setSize(e.target.value)}
              />
            </Field>
            <Field label="Measured in">
              <select value={sizeUnit} onChange={(e) => setSizeUnit(e.target.value as Unit)}>
                {MEASURE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </Field>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: -4 }}>
            Optional, but it's what lets a recipe asking for 400g of something match against
            the tins you actually have.
          </p>
        </>
      ) : (
        <p style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: -4 }}>
          Counted by {unit} directly, so there's no separate pack size.
        </p>
      )}

      <div className="grid-2">
        <Field label="Category">
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {cats.map((c) => <option key={c.key} value={c.key}>{c.emoji} {c.label}</option>)}
          </select>
        </Field>
        <Field label="Where">
          <select value={location} onChange={(e) => setLocation(e.target.value)}>
            {places.map((p) => <option key={p.key} value={p.key}>{p.emoji} {p.label}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid-2">
        <Field label="Best before">
          <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </Field>
        <Field label="Price paid ($)">
          <input type="number" min="0" step="0.01" placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
      </div>

      <MealTags meal={meal} isMain={isMain} onChange={onMealChange} />

      {converted && isMain && (
        <p className="note-convert">
          Counted in <strong>ea</strong> now ({converted}) — the calendar spends one main dish per
          day, so mains have to be countable. The weight moved to the size field.
        </p>
      )}

      <Field label="Brand (optional)">
        <input type="text" value={brand} onChange={(e) => setBrand(e.target.value)} />
      </Field>

      <label className="row" style={{ gap: 10, cursor: 'pointer' }}>
        <input type="checkbox" checked={isStaple} onChange={(e) => setIsStaple(e.target.checked)} />
        <span style={{ fontSize: 13.5 }}>
          <strong>It's a staple</strong>
          <span style={{ display: 'block', color: 'var(--text-mute)', fontSize: 12.5 }}>
            Auto-adds itself to the shopping list when it runs low
          </span>
        </span>
      </label>

      {isStaple && (
        <Field label={`Restock when below (${unit})`}>
          <input type="number" min="0" step="0.5" value={parQty} onChange={(e) => setParQty(e.target.value)} />
        </Field>
      )}
    </Sheet>
  )
}
