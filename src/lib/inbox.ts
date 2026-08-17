import { db } from '../db/db'
import type { Category, InboxItem, Unit } from '../db/schema'
import { savePhoto, deletePhoto } from './photos'
import { readBarcodeFromImage } from './barcode'
import { lookupBarcode } from './openfoodfacts'
import { guessCategory } from './categories'
import { addItem } from './inventory'
import { suggestExpiry, suggestPlace } from './locations'
import { titleCase } from './match'
import { todayISO } from './dates'

/**
 * Unpacking the shopping.
 *
 * The bet is that photographing a counter full of groceries is quick, and
 * naming them is the slow part — so the import takes the photos now and works
 * out what they are afterwards, in whatever order suits: barcodes first because
 * they're free and exact, AI for the things without one, and typing for the
 * rest.
 */

export interface ImportProgress {
  done: number
  total: number
  /** What the current photo turned into, for a running list on screen. */
  lastLabel?: string
}

/**
 * Brings a batch of photos in.
 *
 * Each photo is handled independently on purpose. A single unreadable image
 * out of thirty should cost you that one, not the whole batch — so failures
 * are recorded on the row and the loop carries on.
 */
export async function importPhotos(
  files: File[],
  onProgress?: (p: ImportProgress) => void,
): Promise<{ imported: number; failed: number }> {
  let imported = 0
  let failed = 0

  for (const [index, file] of files.entries()) {
    let photoId: number | undefined
    try {
      photoId = await savePhoto(file, 'library')

      // Read the barcode from the original file rather than the compressed
      // copy: compression is tuned for looking at, and it softens exactly the
      // fine black-and-white edges a detector needs.
      const barcode = await readBarcodeFromImage(file)
      const found = barcode ? await lookupBarcode(barcode).catch(() => null) : null

      const row: Omit<InboxItem, 'id'> = {
        photoId,
        qty: 1,
        unit: 'ea',
        scanned: true,
        createdAt: todayISO(),
        ...(found
          ? {
              name: found.name,
              brand: found.brand,
              barcode: found.barcode,
              category: found.category,
              nutrition: found.nutrition,
              guessSource: 'barcode' as const,
            }
          : barcode
            ? { barcode, guessSource: 'barcode' as const, guessNote: 'Barcode read, but not in Open Food Facts' }
            : { guessNote: 'No barcode found in this photo' }),
      }

      await db.inbox.add(row)
      imported++
      onProgress?.({ done: index + 1, total: files.length, lastLabel: found?.name ?? file.name })
    } catch {
      failed++
      // Don't leave the picture behind if the row never got written.
      if (photoId != null) await deletePhoto(photoId).catch(() => {})
      onProgress?.({ done: index + 1, total: files.length, lastLabel: `${file.name} failed` })
    }
  }

  return { imported, failed }
}

/** Re-reads the barcode for one row, for a photo taken at a better angle. */
export async function rescan(row: InboxItem): Promise<boolean> {
  if (row.photoId == null || row.id == null) return false
  const { loadPhotoBlob } = await import('./photos')
  const blob = await loadPhotoBlob(row.photoId)
  if (!blob) return false

  const barcode = await readBarcodeFromImage(blob)
  if (!barcode) {
    await db.inbox.update(row.id, { scanned: true, guessNote: 'Still no barcode in this photo' })
    return false
  }

  const found = await lookupBarcode(barcode).catch(() => null)
  await db.inbox.update(row.id, {
    barcode,
    name: found?.name ?? row.name,
    brand: found?.brand ?? row.brand,
    category: found?.category ?? row.category,
    nutrition: found?.nutrition ?? row.nutrition,
    guessSource: 'barcode',
    guessNote: found ? undefined : 'Barcode read, but not in Open Food Facts',
  })
  return true
}

/**
 * Re-reads every photo still waiting for a name.
 *
 * The scanner has been wrong before — it spent a release never running at all
 * on Safari — and a batch already imported under a broken reader is otherwise
 * stuck being typed out by hand. Rescanning is free and local, so it is worth
 * offering for the whole pile rather than one tile at a time.
 */
export async function rescanAll(
  rows: InboxItem[],
  onProgress?: (p: ImportProgress) => void,
): Promise<number> {
  const targets = rows.filter((r) => !r.name?.trim() && r.photoId != null)
  let found = 0
  for (const [index, row] of targets.entries()) {
    if (await rescan(row).catch(() => false)) found++
    onProgress?.({ done: index + 1, total: targets.length })
  }
  return found
}

export async function updateInbox(id: number, patch: Partial<InboxItem>): Promise<void> {
  await db.inbox.update(id, patch)
}

/**
 * Turns a row into real stock.
 *
 * The photo moves across rather than being copied — it was always the item's
 * picture, it just arrived before the item did.
 */
export async function confirmInbox(
  row: InboxItem,
  overrides: { name?: string; category?: Category; location?: string; qty?: number; unit?: Unit } = {},
): Promise<number | null> {
  if (row.id == null) return null
  const name = titleCase((overrides.name ?? row.name ?? '').trim())
  if (!name) return null

  const places = await db.places.toArray()
  const category = overrides.category ?? row.category ?? guessCategory(name)
  const location = overrides.location ?? suggestPlace(places, category)
  const qty = overrides.qty ?? row.qty ?? 1
  const unit = overrides.unit ?? row.unit ?? 'ea'

  const itemId = await addItem({
    name,
    category,
    location,
    qty,
    qtyInitial: qty,
    unit,
    purchasedAt: todayISO(),
    expiresAt: suggestExpiry(places, category, location),
    isStaple: false,
    archived: false,
    photoId: row.photoId,
    barcode: row.barcode,
    brand: row.brand,
    nutrition: row.nutrition,
  })

  // Clear the row without deleting the photo — the item owns it now.
  await db.inbox.delete(row.id)
  return itemId
}

/** Drops a row and the picture with it: nothing else ever referenced it. */
export async function discardInbox(row: InboxItem): Promise<void> {
  if (row.id == null) return
  await db.inbox.delete(row.id)
  if (row.photoId != null) await deletePhoto(row.photoId)
}

/** Everything still waiting to be named, for the count on the Kitchen button. */
export function unnamedCount(rows: InboxItem[]): number {
  return rows.filter((r) => !r.name?.trim()).length
}
