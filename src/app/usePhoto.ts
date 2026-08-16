import { useEffect, useState } from 'react'
import { cachedPhotoIsCutout, cachedPhotoUrl, loadPhotoUrl } from '../lib/photos'

/**
 * Resolves a stored photo to a renderable URL. Returns the cached URL
 * synchronously on repeat renders so lists don't flash while scrolling.
 */
export function usePhotoUrl(photoId: number | undefined, size: 'thumb' | 'full' = 'thumb') {
  const [url, setUrl] = useState<string | undefined>(() =>
    photoId == null ? undefined : cachedPhotoUrl(photoId, size),
  )

  useEffect(() => {
    if (photoId == null) {
      setUrl(undefined)
      return
    }
    const cached = cachedPhotoUrl(photoId, size)
    if (cached) {
      setUrl(cached)
      return
    }
    let cancelled = false
    loadPhotoUrl(photoId, size).then((resolved) => {
      if (!cancelled) setUrl(resolved)
    })
    return () => { cancelled = true }
  }, [photoId, size])

  return url
}

/**
 * URL plus whether it's a background-removed image. Callers that render the
 * photo need both: a cutout must be letterboxed, never cropped.
 */
export function usePhoto(photoId: number | undefined, size: 'thumb' | 'full' = 'thumb') {
  const url = usePhotoUrl(photoId, size)
  // Populated by the same load, so it's correct by the time a URL exists.
  const cutout = photoId != null && url ? cachedPhotoIsCutout(photoId) : false
  return { url, cutout }
}
