import { db } from '../db/db'
import { supabase } from './supabase'
import { getHouseholdId } from '../db/remote'
import type { Photo } from '../db/schema'
import { todayISO } from './dates'

/**
 * Photos are stored as compressed JPEG blobs in their own table, so item rows
 * stay small and the whole kitchen keeps working offline. Two sizes: a thumb
 * for lists, a larger one for the detail sheet.
 */

const FULL_EDGE = 1200
const THUMB_EDGE = 200
const FULL_QUALITY = 0.82
const THUMB_QUALITY = 0.7

/** Longest-edge downscale that never upscales a small source. */
function fit(width: number, height: number, edge: number) {
  const scale = Math.min(1, edge / Math.max(width, height))
  return { w: Math.round(width * scale), h: Math.round(height * scale) }
}

async function encode(bitmap: ImageBitmap, edge: number, quality: number, mime: string): Promise<Blob> {
  const { w, h } = fit(bitmap.width, bitmap.height, edge)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is unavailable in this browser.')
  ctx.drawImage(bitmap, 0, 0, w, h)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mime, quality),
  )
  if (!blob) throw new Error('Could not encode the image.')
  return blob
}

/**
 * Decodes, honours EXIF rotation, and re-encodes at both sizes.
 *
 * `transparent` switches the output to WebP. JPEG has no alpha channel, so
 * running a cutout through the default path would silently composite it onto
 * black — the transparency would be gone with no error to notice.
 */
export async function processImage(
  source: Blob,
  transparent = false,
): Promise<{ full: Blob; thumb: Blob }> {
  const mime = transparent ? 'image/webp' : 'image/jpeg'
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' })
  try {
    const [full, thumb] = await Promise.all([
      encode(bitmap, FULL_EDGE, FULL_QUALITY, mime),
      encode(bitmap, THUMB_EDGE, THUMB_QUALITY, mime),
    ])
    return { full, thumb }
  } finally {
    bitmap.close()
  }
}

const BUCKET = 'photos'

/**
 * Puts the two sizes in the bucket and returns their paths.
 *
 * Uploaded before the row is written rather than after, so a failure leaves
 * orphaned objects rather than a photo row pointing at nothing — the first is
 * invisible, the second renders as a broken image forever.
 *
 * The household id leads the path because the storage policy checks the first
 * folder segment; a file outside your own folder is rejected on upload.
 */
async function upload(full: Blob, thumb: Blob): Promise<{ fullPath: string; thumbPath: string }> {
  const household = getHouseholdId()
  if (household == null) throw new Error('Not signed in.')
  const stem = `${household}/${crypto.randomUUID()}`
  const fullPath = `${stem}-full.webp`
  const thumbPath = `${stem}-thumb.webp`

  const [a, b] = await Promise.all([
    supabase.storage.from(BUCKET).upload(fullPath, full, { contentType: full.type || 'image/webp' }),
    supabase.storage.from(BUCKET).upload(thumbPath, thumb, { contentType: thumb.type || 'image/webp' }),
  ])
  if (a.error) throw a.error
  if (b.error) throw b.error
  return { fullPath, thumbPath }
}

export async function savePhoto(
  source: Blob,
  origin: Photo['source'],
  attribution?: string,
): Promise<number> {
  const { full, thumb } = await processImage(source)
  const paths = await upload(full, thumb)
  return db.photos.add({ ...paths, source: origin, createdAt: todayISO(), attribution })
}

/** Stores a background-removed image, keeping its alpha channel intact. */
export async function saveCutoutPhoto(
  source: Blob,
  origin: Photo['source'],
  attribution?: string,
): Promise<number> {
  const { full, thumb } = await processImage(source, true)
  const paths = await upload(full, thumb)
  return db.photos.add({ ...paths, source: origin, cutout: true, createdAt: todayISO(), attribution })
}

/**
 * Stores a photo we could not re-encode — a cross-origin fetch that was
 * blocked. The URL still renders; it just needs the network.
 */
export async function saveRemotePhoto(url: string, attribution?: string): Promise<number> {
  return db.photos.add({
    remoteUrl: url,
    source: 'openfoodfacts', createdAt: todayISO(), attribution,
  })
}

export async function deletePhoto(photoId?: number) {
  if (photoId == null) return
  releaseCached(photoId)
  // Read the paths before the row goes, or the objects can never be found again.
  const photo = await db.photos.get(photoId)
  const paths = [photo?.fullPath, photo?.thumbPath].filter(Boolean) as string[]
  await db.photos.delete(photoId)
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths)
}

/** Swaps an item's photo and cleans up the one it replaces. */
export async function setItemPhoto(itemId: number, photoId: number | undefined) {
  const item = await db.items.get(itemId)
  if (!item) return
  const previous = item.photoId
  await db.items.update(itemId, { photoId })
  if (previous != null && previous !== photoId) await deletePhoto(previous)
}

// ---------------------------------------------------------------------------
// Object URLs
//
// Blobs need an object URL to render. Creating one per render would flicker and
// leak, so URLs are cached for the session and revoked only when the photo
// itself goes away.
// ---------------------------------------------------------------------------

type Size = 'thumb' | 'full'

const urlCache = new Map<string, string>()
const pending = new Map<string, Promise<string | undefined>>()
/** Whether each loaded photo is a cutout — display needs it alongside the URL. */
const cutoutCache = new Map<number, boolean>()

const keyOf = (photoId: number, size: Size) => `${photoId}:${size}`

export function cachedPhotoUrl(photoId: number, size: Size): string | undefined {
  return urlCache.get(keyOf(photoId, size))
}

export function cachedPhotoIsCutout(photoId: number): boolean {
  return cutoutCache.get(photoId) ?? false
}

export async function loadPhotoUrl(photoId: number, size: Size): Promise<string | undefined> {
  const key = keyOf(photoId, size)
  const cached = urlCache.get(key)
  if (cached) return cached

  const inFlight = pending.get(key)
  if (inFlight) return inFlight

  const task = (async () => {
    const photo = await db.photos.get(photoId)
    if (!photo) return undefined
    cutoutCache.set(photoId, Boolean(photo.cutout))

    const path = size === 'thumb'
      ? photo.thumbPath ?? photo.fullPath
      : photo.fullPath ?? photo.thumbPath
    if (!path) return photo.remoteUrl

    // The bucket is private, so this is a signed URL. An hour outlives any
    // session spent looking at a fridge, and a stale one simply re-signs.
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
    if (error) return photo.remoteUrl
    if (data?.signedUrl) urlCache.set(key, data.signedUrl)
    return data?.signedUrl
  })().finally(() => pending.delete(key))

  pending.set(key, task)
  return task
}

function releaseCached(photoId: number) {
  cutoutCache.delete(photoId)
  for (const size of ['thumb', 'full'] as Size[]) {
    const key = keyOf(photoId, size)
    const url = urlCache.get(key)
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
    urlCache.delete(key)
  }
}

/**
 * Downloads the stored bytes again.
 *
 * Background removal needs the actual image, not a URL, and since the bytes no
 * longer sit in the row this has to fetch them. Prefers the full size — the
 * thumbnail is too small to cut a usable mask from.
 */
export async function loadPhotoBlob(photoId: number): Promise<Blob | undefined> {
  const photo = await db.photos.get(photoId)
  const path = photo?.fullPath ?? photo?.thumbPath
  if (!path) return undefined
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error) return undefined
  return data ?? undefined
}

/**
 * How much the bucket holds, for the Settings screen. Asked of storage rather
 * than derived from the rows, since the bytes no longer live in the database.
 */
export async function photoStorageBytes(): Promise<number> {
  const household = getHouseholdId()
  if (household == null) return 0
  const { data, error } = await supabase.storage.from(BUCKET).list(String(household), { limit: 1000 })
  if (error || !data) return 0
  return data.reduce((sum, f) => sum + ((f.metadata?.size as number | undefined) ?? 0), 0)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
