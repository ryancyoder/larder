import { db } from '../db/db'
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

async function encode(bitmap: ImageBitmap, edge: number, quality: number): Promise<Blob> {
  const { w, h } = fit(bitmap.width, bitmap.height, edge)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is unavailable in this browser.')
  ctx.drawImage(bitmap, 0, 0, w, h)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  )
  if (!blob) throw new Error('Could not encode the image.')
  return blob
}

/** Decodes, honours EXIF rotation, and re-encodes at both sizes. */
export async function processImage(source: Blob): Promise<{ full: Blob; thumb: Blob }> {
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' })
  try {
    const [full, thumb] = await Promise.all([
      encode(bitmap, FULL_EDGE, FULL_QUALITY),
      encode(bitmap, THUMB_EDGE, THUMB_QUALITY),
    ])
    return { full, thumb }
  } finally {
    bitmap.close()
  }
}

export async function savePhoto(
  source: Blob,
  origin: Photo['source'],
  attribution?: string,
): Promise<number> {
  const { full, thumb } = await processImage(source)
  return db.photos.add({ full, thumb, source: origin, createdAt: todayISO(), attribution })
}

/**
 * Stores a photo we could not re-encode — a cross-origin fetch that was
 * blocked. The URL still renders; it just needs the network.
 */
export async function saveRemotePhoto(url: string, attribution?: string): Promise<number> {
  return db.photos.add({
    full: null, thumb: null, remoteUrl: url,
    source: 'openfoodfacts', createdAt: todayISO(), attribution,
  })
}

export async function deletePhoto(photoId?: number) {
  if (photoId == null) return
  releaseCached(photoId)
  await db.photos.delete(photoId)
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

const keyOf = (photoId: number, size: Size) => `${photoId}:${size}`

export function cachedPhotoUrl(photoId: number, size: Size): string | undefined {
  return urlCache.get(keyOf(photoId, size))
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
    const blob = size === 'thumb' ? photo.thumb ?? photo.full : photo.full ?? photo.thumb
    const url = blob ? URL.createObjectURL(blob) : photo.remoteUrl
    if (url) urlCache.set(key, url)
    return url
  })().finally(() => pending.delete(key))

  pending.set(key, task)
  return task
}

function releaseCached(photoId: number) {
  for (const size of ['thumb', 'full'] as Size[]) {
    const key = keyOf(photoId, size)
    const url = urlCache.get(key)
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
    urlCache.delete(key)
  }
}

/** Rough on-disk size of all stored photos, for the Settings screen. */
export async function photoStorageBytes(): Promise<number> {
  const photos = await db.photos.toArray()
  return photos.reduce((sum, p) => sum + (p.full?.size ?? 0) + (p.thumb?.size ?? 0), 0)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
