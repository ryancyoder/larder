import { useEffect, useState } from 'react'
import { db, getSetting, setSetting } from '../db/db'
import { runSeed } from '../db/seed'
import { Field, Seg, Sheet } from '../components/ui'
import { useToast } from '../app/toast'
import { formatBytes, photoStorageBytes } from '../lib/photos'
import { useLayout, type LayoutMode } from '../app/layout'
import { kindLabel, movePlace } from '../lib/locations'
import { usePlaces } from '../app/data'
import PlaceEditor from '../components/PlaceEditor'
import type { StoragePlace } from '../db/schema'

type Theme = 'dark' | 'light'

export default function Settings({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const [theme, setTheme] = useState<Theme>(
    () => (document.documentElement.dataset.theme as Theme) || 'dark',
  )
  const [key, setKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [photoBytes, setPhotoBytes] = useState<number | null>(null)
  const { mode, setMode, viewportSuggests } = useLayout()
  const places = usePlaces() ?? []
  const [editingPlace, setEditingPlace] = useState<StoragePlace | 'new' | null>(null)

  useEffect(() => {
    getSetting('anthropicKey').then((k) => setHasKey(Boolean(k)))
    photoStorageBytes().then(setPhotoBytes)
  }, [])

  function applyTheme(next: Theme) {
    setTheme(next)
    document.documentElement.dataset.theme = next
    localStorage.setItem('larder-theme', next)
  }

  async function saveKey() {
    await setSetting('anthropicKey', key.trim())
    setHasKey(Boolean(key.trim()))
    setKey('')
    toast(key.trim() ? 'API key saved on this device' : 'API key cleared')
  }

  async function exportData() {
    const payload = {
      exportedAt: new Date().toISOString(),
      items: await db.items.toArray(),
      recipes: await db.recipes.toArray(),
      plan: await db.plan.toArray(),
      shop: await db.shop.toArray(),
      trips: await db.trips.toArray(),
      events: await db.events.toArray(),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `larder-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast('Export downloaded')
  }

  return (
    <Sheet title="Settings" onClose={onClose}>
      <Field label="Appearance">
        <Seg
          value={theme}
          onChange={applyTheme}
          options={[{ value: 'dark' as Theme, label: '🌙 Dark' }, { value: 'light' as Theme, label: '☀️ Light' }]}
        />
      </Field>

      <Field label="Layout">
        <Seg
          value={mode}
          onChange={setMode}
          options={[
            { value: 'auto' as LayoutMode, label: 'Auto' },
            { value: 'compact' as LayoutMode, label: '📱 iPhone' },
            { value: 'wide' as LayoutMode, label: '💻 iPad' },
          ]}
        />
      </Field>
      <p style={{ fontSize: 12.5, color: 'var(--text-mute)', marginTop: -4 }}>
        {mode === 'auto' && (
          <>
            Following the screen — currently showing the{' '}
            <strong style={{ color: 'var(--text-dim)' }}>{viewportSuggests === 'wide' ? 'iPad' : 'iPhone'}</strong>{' '}
            layout, and it'll swap automatically when you rotate.
          </>
        )}
        {mode === 'compact' && 'Pinned to the phone layout: one column, tab bar along the bottom.'}
        {mode === 'wide' && (
          <>
            Pinned to the tablet layout: side rail, two-up lists, and the meal plan as a full
            seven-day week. Best in landscape — in portrait it will feel tight.
          </>
        )}
      </p>

      <div className="card card-pad stack">
        <div>
          <div style={{ fontWeight: 650 }}>Storage locations</div>
          <p style={{ fontSize: 12.5, color: 'var(--text-mute)', marginTop: 4 }}>
            Where things live in your kitchen. Rename them, reorder them, or add your own — a
            garage fridge, a chest freezer, a spice drawer.
          </p>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          {places.map((place, i) => (
            <div className="item" key={place.id} style={{ padding: '8px 10px' }}>
              <span style={{ fontSize: 19, flex: 'none', width: 26, textAlign: 'center' }}>{place.emoji}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="name" style={{ fontSize: 14 }}>{place.label}</div>
                <div className="meta">
                  <span>{kindLabel(place.kind)}</span>
                  {place.blurb && <><span>·</span><span>{place.blurb}</span></>}
                </div>
              </div>
              <button
                className="btn ghost sm"
                aria-label={`Move ${place.label} up`}
                disabled={i === 0}
                onClick={() => movePlace(place.id!, -1)}
              >↑</button>
              <button
                className="btn ghost sm"
                aria-label={`Move ${place.label} down`}
                disabled={i === places.length - 1}
                onClick={() => movePlace(place.id!, 1)}
              >↓</button>
              <button className="btn sm" onClick={() => setEditingPlace(place)}>Edit</button>
            </div>
          ))}
        </div>

        <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setEditingPlace('new')}>
          + Add a location
        </button>
      </div>

      <div className="card card-pad stack">
        <div>
          <div style={{ fontWeight: 650 }}>AI recipe suggestions</div>
          <p style={{ fontSize: 12.5, color: 'var(--text-mute)', marginTop: 4 }}>
            Optional. Everything else works without it — the ranking engine already sorts your own
            recipes by what's in stock and what's about to expire. Add an Anthropic API key and the
            Recipes tab can also generate new ideas from your kitchen contents.
          </p>
        </div>

        <Field label={hasKey ? 'Replace the saved key' : 'Anthropic API key'}>
          <input
            type="password"
            value={key}
            placeholder={hasKey ? '•••••••••••••• saved' : 'sk-ant-…'}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
          />
        </Field>

        <div className="row" style={{ gap: 8 }}>
          <button className="btn primary sm" onClick={saveKey} disabled={!key.trim()}>Save key</button>
          {hasKey && (
            <button
              className="btn ghost sm"
              onClick={async () => { await setSetting('anthropicKey', ''); setHasKey(false); toast('API key removed') }}
            >
              Remove
            </button>
          )}
        </div>

        <p style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>
          The key is stored in this browser's local database and sent only to api.anthropic.com.
          It never touches a server of ours — there isn't one.
        </p>
      </div>

      <div className="card card-pad stack">
        <div>
          <div style={{ fontWeight: 650 }}>Your data</div>
          <p style={{ fontSize: 12.5, color: 'var(--text-mute)', marginTop: 4 }}>
            Everything lives in IndexedDB on this device. Nothing is uploaded. Clearing your browser
            data clears the app, so export if you care about the history.
            {photoBytes != null && photoBytes > 0 && (
              <> Photos currently take up <strong style={{ color: 'var(--text-dim)' }}>{formatBytes(photoBytes)}</strong>.</>
            )}
            {' '}The JSON export covers items, recipes, plans and history — photos are not included,
            since they'd bloat the file.
          </p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={exportData}>⬇ Export JSON</button>
          <button
            className="btn ghost sm"
            onClick={async () => {
              if (!confirm('Replace everything with the demo kitchen? Your current items, recipes and history will be deleted.')) return
              await runSeed()
              toast('Demo data restored')
              onClose()
            }}
          >
            Reset to demo data
          </button>
        </div>
      </div>

      <p style={{ fontSize: 11.5, color: 'var(--text-mute)', textAlign: 'center' }}>
        Larder · installable from your browser's share menu
      </p>

      {editingPlace && (
        <PlaceEditor
          place={editingPlace === 'new' ? undefined : editingPlace}
          allPlaces={places}
          onClose={() => setEditingPlace(null)}
        />
      )}
    </Sheet>
  )
}
