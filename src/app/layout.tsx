import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/**
 * Layout mode. `auto` follows the viewport — which already does the right thing
 * when an iPad rotates — but the explicit modes let you pin a layout when the
 * width guess doesn't match how you're actually holding the thing.
 */
export type LayoutMode = 'auto' | 'compact' | 'wide'
export type ResolvedLayout = 'compact' | 'wide'

/** Below this, a two-up list stops being readable and starts being cramped. */
export const WIDE_MIN_PX = 940

const STORAGE_KEY = 'larder-layout'

interface LayoutState {
  mode: LayoutMode
  resolved: ResolvedLayout
  setMode: (mode: LayoutMode) => void
  /** What `auto` would pick right now — shown next to the Auto option. */
  viewportSuggests: ResolvedLayout
}

const LayoutContext = createContext<LayoutState>({
  mode: 'auto',
  resolved: 'compact',
  setMode: () => {},
  viewportSuggests: 'compact',
})

export function useLayout() {
  return useContext(LayoutContext)
}

function readStoredMode(): LayoutMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'compact' || saved === 'wide' || saved === 'auto') return saved
  } catch {
    // Private browsing can throw on localStorage; the default is fine.
  }
  return 'auto'
}

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<LayoutMode>(readStoredMode)
  const [viewportSuggests, setViewportSuggests] = useState<ResolvedLayout>(() =>
    typeof window !== 'undefined' && window.innerWidth >= WIDE_MIN_PX ? 'wide' : 'compact',
  )

  useEffect(() => {
    const query = window.matchMedia(`(min-width: ${WIDE_MIN_PX}px)`)
    // Idempotent: React bails out when the value is unchanged, so wiring this to
    // noisy events costs nothing.
    const sync = () => setViewportSuggests(query.matches ? 'wide' : 'compact')
    sync()

    // The media query is the precise signal, but relying on it alone means a
    // single missed `change` event leaves the layout stale until the next
    // reload. `resize` and `orientationchange` are the belt and braces.
    query.addEventListener('change', sync)
    window.addEventListener('resize', sync)
    window.addEventListener('orientationchange', sync)
    return () => {
      query.removeEventListener('change', sync)
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', sync)
    }
  }, [])

  const resolved: ResolvedLayout = mode === 'auto' ? viewportSuggests : mode

  useEffect(() => {
    document.documentElement.dataset.layout = resolved
  }, [resolved])

  const value = useMemo<LayoutState>(() => ({
    mode,
    resolved,
    viewportSuggests,
    setMode(next) {
      setModeState(next)
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // Not persisting is survivable — the session still respects the choice.
      }
    },
  }), [mode, resolved, viewportSuggests])

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
}
