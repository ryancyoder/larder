import { useState } from 'react'
import type { Category, MealSlot, StorageLocation, Unit } from '../db/schema'
import { categoryMeta, guessCategory } from '../lib/categories'
import { placeLabel, suggestExpiry, suggestPlace } from '../lib/locations'
import { useCategories, usePlaces } from '../app/data'
import { ALL_UNITS, MEASURE_UNITS, formatAmount, isCountUnit, toEachPack } from '../lib/units'
import { todayISO } from '../lib/dates'
import { addItem } from '../lib/inventory'
import { titleCase } from '../lib/match'
import { deletePhoto } from '../lib/photos'
import { LookupError, importProductPhoto, lookupBarcode, type ProductLookup } from '../lib/openfoodfacts'
import { scanningAvailable } from '../lib/barcode'
import { Field, Sheet } from './ui'
import PhotoCapture from './PhotoCapture'
import MealTags, { mainAllowedFor } from './MealTags'
import BarcodeScanner from './BarcodeScanner'
import { useToast } from '../app/toast'

export default function AddItemSheet({
  onClose, defaultLocation, defaultMeal,
}: {
  onClose: () => void
  /**
   * Carried in from the Kitchen's filters. Adding while looking at one shelf
   * almost always means adding *to* that shelf, and the same for a meal.
   */
  defaultLocation?: StorageLocation
  defaultMeal?: MealSlot
}) {
  const toast = useToast()
  const places = usePlaces() ?? []
  const cats = useCategories() ?? []
  const [name, setName] = useState('')
  const [touchedCategory, setTouchedCategory] = useState(false)
  // A filtered location counts as already chosen, so the name-based guess below
  // can't quietly move the item to a different shelf as you type.
  const [touchedLocation, setTouchedLocation] = useState(defaultLocation != null)
  const [touchedExpiry, setTouchedExpiry] = useState(false)

  const [categoryOverride, setCategoryOverride] = useState<Category>('other')
  const [locationOverride, setLocationOverride] = useState<StorageLocation>(defaultLocation ?? 'fridge')
  const [expiryOverride, setExpiryOverride] = useState('')

  const [qty, setQty] = useState('1')
  // 'ea' always — you count packages, and the measure goes in the size field.
  const [unit, setUnit] = useState<Unit>('ea')
  const [size, setSize] = useState('')
  const [sizeUnit, setSizeUnit] = useState<Unit>('g')
  const [price, setPrice] = useState('')
  const [meal, setMeal] = useState<MealSlot | undefined>(defaultMeal)
  const [isMain, setIsMain] = useState(false)
  const [converted, setConverted] = useState<string | null>(null)
  const [isStaple, setIsStaple] = useState(false)
  const [parQty, setParQty] = useState('1')

  const [photoId, setPhotoId] = useState<number | undefined>()
  const [barcode, setBarcode] = useState<string>()
  const [brand, setBrand] = useState<string>()
  const [scanning, setScanning] = useState(false)
  const [lookingUp, setLookingUp] = useState(false)
  const [lookupNote, setLookupNote] = useState('')
  const [found, setFound] = useState<ProductLookup | null>(null)

  // Everything the user hasn't explicitly set follows from the name.
  const category = touchedCategory ? categoryOverride : guessCategory(name)
  const location = touchedLocation ? locationOverride : suggestPlace(places, category)
  const expiresAt = touchedExpiry ? expiryOverride : suggestExpiry(places, category, location)
  const meta = categoryMeta(category)


  const canSave = name.trim().length > 0 && Number(qty) > 0

  /** Replaces the working photo, discarding whatever it displaced. */
  function swapPhoto(next: number | undefined) {
    const previous = photoId
    setPhotoId(next)
    if (previous != null && previous !== next) void deletePhoto(previous)
  }

  async function handleBarcode(code: string) {
    setScanning(false)
    setBarcode(code)
    setLookingUp(true)
    setLookupNote('')
    setFound(null)
    try {
      const product = await lookupBarcode(code)
      if (!product) {
        setLookupNote(`Barcode ${code} isn't in Open Food Facts yet. Fill it in below and it's saved just the same.`)
        return
      }

      setFound(product)
      // Prefix the brand only when it adds something — Open Food Facts often
      // stores the same word as both brand and product name ("Mars" / "Mars").
      const prefixed = product.brand && !product.name.toLowerCase().includes(product.brand.toLowerCase())
        ? `${product.brand} ${product.name}`
        : product.name
      setName(prefixed)
      setBrand(product.brand)
      setTouchedCategory(true)
      setCategoryOverride(product.category)
      // "400 g" describes one package, not how many you have — so it belongs
      // in the size field, with the count left at 1.
      if (product.qty && product.unit) {
        setSize(String(product.qty))
        setSizeUnit(product.unit)
      }
      const imported = await importProductPhoto(product)
      if (imported != null) swapPhoto(imported)
    } catch (err) {
      setLookupNote(err instanceof LookupError ? err.message : 'The lookup failed. Add the item by hand.')
    } finally {
      setLookingUp(false)
    }
  }

  /**
   * A main dish has to be countable — the calendar spends one per day — so
   * marking one restates the item in 'ea' straight away, in the open fields
   * where you can see it happen.
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
    const amount = Number(qty)
    const mainNow = isMain && mainAllowedFor(meal)
    await addItem({
      name: titleCase(name.trim()),
      category,
      location,
      qty: amount,
      qtyInitial: amount,
      // Locked to 'ea' in the form while main is on; enforced again here.
      unit: mainNow ? 'ea' : unit,
      size: isCountUnit(unit) && size.trim() ? Number(size) : undefined,
      sizeUnit: isCountUnit(unit) && size.trim() ? sizeUnit : undefined,
      price: price ? Number(price) : undefined,
      purchasedAt: todayISO(),
      expiresAt: expiresAt || undefined,
      meal,
      isMain: isMain && mainAllowedFor(meal) ? true : undefined,
      isStaple,
      parQty: isStaple ? Number(parQty) || 1 : undefined,
      archived: false,
      photoId,
      barcode,
      brand,
    })
    toast(`${titleCase(name.trim())} added to the ${placeLabel(places, location)}`)
    onClose()
  }

  /** Dropping out without saving shouldn't leave an orphaned photo behind. */
  function cancel() {
    if (photoId != null) void deletePhoto(photoId)
    onClose()
  }

  return (
    <>
      <Sheet
        title="Add to the kitchen"
        onClose={cancel}
        footer={
          <>
            <button className="btn ghost" onClick={cancel}>Cancel</button>
            <button className="btn primary" disabled={!canSave} onClick={save}>Add item</button>
          </>
        }
      >
        {scanningAvailable() && (
          <button className="btn block" onClick={() => setScanning(true)} disabled={lookingUp}>
            {lookingUp ? 'Looking it up…' : '🔎 Scan a barcode'}
          </button>
        )}

        {found && (
          <div className="product-hit">
            <ProductThumb product={found} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>Matched on Open Food Facts</div>
              <div style={{ fontWeight: 650, fontSize: 14, marginTop: 2 }}>{found.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-mute)' }}>
                {[found.brand, found.quantity].filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>
        )}

        {lookupNote && (
          <p style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>{lookupNote}</p>
        )}

        <PhotoCapture photoId={photoId} onChange={swapPhoto} />

        <Field label="What is it?">
          <input
            type="text"
            value={name}
            placeholder="Baby spinach"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        {name.trim() && (
          <p style={{ fontSize: 12.5, color: 'var(--text-mute)' }}>
            Filed as <strong style={{ color: `var(--cat-${meta.hue})` }}>{meta.emoji} {meta.label}</strong> in the{' '}
            <strong style={{ color: 'var(--text-dim)' }}>{placeLabel(places, location)}</strong> — change either below if that's wrong.
          </p>
        )}

        <div className="grid-2">
          <Field label="Quantity">
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

        {isCountUnit(unit) && (
          <div className="grid-2">
            <Field label="Size of each (optional)">
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
        )}

        <div className="grid-2">
          <Field label="Category">
            <select
              value={category}
              onChange={(e) => { setTouchedCategory(true); setCategoryOverride(e.target.value as Category) }}
            >
              {cats.map((c) => <option key={c.key} value={c.key}>{c.emoji} {c.label}</option>)}
            </select>
          </Field>
          <Field label="Where">
            <select
              value={location}
              onChange={(e) => { setTouchedLocation(true); setLocationOverride(e.target.value as StorageLocation) }}
            >
              {places.map((l) => <option key={l.key} value={l.key}>{l.emoji} {l.label}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid-2">
          <Field label="Best before">
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => { setTouchedExpiry(true); setExpiryOverride(e.target.value) }}
            />
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

        {barcode && (
          <p style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>Barcode {barcode}</p>
        )}
      </Sheet>

      {scanning && (
        <BarcodeScanner onDetected={handleBarcode} onClose={() => setScanning(false)} />
      )}
    </>
  )
}

function ProductThumb({ product }: { product: ProductLookup }) {
  if (!product.imageUrl) return <div style={{ width: 58, height: 58, flex: 'none' }} />
  return <img src={product.imageUrl} alt="" width={58} height={58} />
}
