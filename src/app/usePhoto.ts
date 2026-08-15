import { useEffect, useState } from 'react'
import { cachedPhotoUrl, loadPhotoUrl } from '../lib/photos'

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
