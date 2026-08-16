import { useEffect, useRef, useState } from 'react'
import { getVersion, subscribe } from '../db/remote'

/**
 * Re-runs a query whenever the database changes, keeping the signature the app
 * already uses so every call site stayed as it was.
 *
 * Coarser than what it replaces: any write anywhere re-runs every query, rather
 * than only the ones touching the changed table. With a few hundred rows that
 * costs less than the bookkeeping needed to be precise, and it can't go stale
 * the way a finer scheme can — which matters more here than the saved requests.
 */
export function useLiveQuery<T>(query: () => Promise<T>, deps: unknown[]): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined)
  const [version, setVersion] = useState(getVersion)
  // Held in a ref so a query defined inline doesn't re-run on every render.
  const queryRef = useRef(query)
  queryRef.current = query

  useEffect(() => subscribe(() => setVersion(getVersion())), [])

  useEffect(() => {
    let cancelled = false
    queryRef.current()
      .then((result) => { if (!cancelled) setValue(result) })
      .catch((err) => {
        // A failed read leaves the last good value rather than blanking the
        // screen — a momentary network blip should not look like an empty
        // kitchen.
        console.error('live query failed', err)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version])

  return value
}
