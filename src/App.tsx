import { useEffect, useState } from 'react'
import { seedIfEmpty } from './db/seed'
import { ToastProvider } from './app/toast'
import { LayoutProvider } from './app/layout'
import { useCategories, useKitchen, useShopList } from './app/data'
import { expiringSoon } from './lib/inventory'
import Kitchen from './screens/Kitchen'
import Planning from './screens/Planning'
import Recipes from './screens/Recipes'
import Shop from './screens/Shop'
import Insights from './screens/Insights'
import Settings from './screens/Settings'

type Tab = 'kitchen' | 'plan' | 'recipes' | 'shop' | 'insights'

const TABS: Array<{ key: Tab; label: string; glyph: string }> = [
  { key: 'kitchen', label: 'Kitchen', glyph: '🧊' },
  { key: 'plan', label: 'Plan', glyph: '🗓️' },
  { key: 'recipes', label: 'Recipes', glyph: '🍳' },
  { key: 'shop', label: 'Shop', glyph: '🛒' },
  { key: 'insights', label: 'Insights', glyph: '📈' },
]

function readTab(): Tab {
  const hash = window.location.hash.replace('#', '')
  // The calendar used to be its own tab; old links still land on it.
  if (hash === 'calendar') return 'plan'
  return TABS.some((t) => t.key === hash) ? (hash as Tab) : 'kitchen'
}

export default function App() {
  const [tab, setTab] = useState<Tab>(readTab)
  const [ready, setReady] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const kitchen = useKitchen()
  const shop = useShopList()
  // Mounted here for its side effect: this is what keeps the synchronous
  // category registry in step with the table, including for the plain async
  // libs that look categories up without being able to subscribe to anything.
  useCategories()

  useEffect(() => {
    seedIfEmpty().finally(() => setReady(true))
  }, [])

  useEffect(() => {
    const onHash = () => setTab(readTab())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = (next: Tab) => {
    setTab(next)
    window.location.hash = next
    window.scrollTo({ top: 0 })
  }

  const urgentCount = kitchen ? expiringSoon(kitchen, 2).length : 0
  const shopCount = shop?.filter((s) => !s.checked).length ?? 0

  const badges: Partial<Record<Tab, number>> = { kitchen: urgentCount, shop: shopCount }

  return (
    <LayoutProvider>
    <ToastProvider>
      <div className="app">
        <nav className="nav" aria-label="Sections">
          <div className="brand"><span>🥬</span> Larder</div>
          {TABS.map((t) => (
            <div className="slot" key={t.key}>
              <button
                aria-current={tab === t.key ? 'page' : undefined}
                onClick={() => go(t.key)}
                style={{ width: '100%' }}
              >
                <span className="glyph" aria-hidden>{t.glyph}</span>
                {t.label}
                {!!badges[t.key] && <span className="badge">{badges[t.key]}</span>}
              </button>
            </div>
          ))}
        </nav>

        <main className="main">
          {!ready ? (
            <div style={{ padding: '90px 0', textAlign: 'center', color: 'var(--text-mute)' }}>
              Stocking the shelves…
            </div>
          ) : (
            <>
              {tab === 'kitchen' && <Kitchen onOpenSettings={() => setSettingsOpen(true)} />}
              {tab === 'plan' && <Planning />}
              {tab === 'recipes' && <Recipes onOpenSettings={() => setSettingsOpen(true)} />}
              {tab === 'shop' && <Shop />}
              {tab === 'insights' && <Insights onOpenSettings={() => setSettingsOpen(true)} />}
            </>
          )}
        </main>
      </div>

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </ToastProvider>
    </LayoutProvider>
  )
}
