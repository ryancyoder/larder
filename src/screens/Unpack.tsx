import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { InboxItem } from '../db/schema'
import { useCategories, useInbox, usePlaces } from '../app/data'
import { usePhoto } from '../app/usePhoto'
import { confirmInbox, discardInbox, importPhotos, rescan, rescanAll, updateInbox, type ImportProgress } from '../lib/inbox'
import { loadPhotoBlob } from '../lib/photos'
import { identifyPhoto, AIError } from '../lib/ai'
import { getSetting } from '../db/db'
import { guessCategory } from '../lib/categories'
import { useToast } from '../app/toast'

/**
 * Unpacking the shopping.
 *
 * Photograph everything on the counter, then work out what it all is — because
 * taking thirty pictures is a minute and typing thirty names is not. Barcodes
 * answer most of it for free; the rest gets a name from you, or from the model
 * if you ask for it.
 */
export default function Unpack({ onClose }: { onClose: () => void }) {
  const rows = useInbox()
  const places = usePlaces() ?? []
  const cats = useCategories() ?? []
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [aiBusy, setAiBusy] = useState<{ done: number; total: number } | null>(null)
  const [scanBusy, setScanBusy] = useState<ImportProgress | null>(null)
  const [error, setError] = useState('')

  const pending = rows ?? []
  const unnamed = pending.filter((r) => !r.name?.trim())

  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    setError('')
    setProgress({ done: 0, total: files.length })
    try {
      const { imported, failed } = await importPhotos([...files], setProgress)
      toast(failed ? `${imported} photos in, ${failed} failed` : `${imported} photos ready to name`)
    } finally {
      setProgress(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  /** Another look at every unnamed photo — free, and the scanner improves. */
  async function scanAgain() {
    setError('')
    setScanBusy({ done: 0, total: unnamed.length })
    try {
      const found = await rescanAll(unnamed, setScanBusy)
      toast(found ? `Read ${found} more barcode${found === 1 ? '' : 's'}` : 'No new barcodes in those photos')
    } finally {
      setScanBusy(null)
    }
  }

  /** Names whatever the barcode pass could not, one photo at a time. */
  async function runAI() {
    const key = await getSetting('anthropicKey')
    if (!key) {
      setError('Add an Anthropic API key in Settings first — this is the one feature that needs one.')
      return
    }
    const targets = unnamed.filter((r) => r.photoId != null)
    if (!targets.length) return

    setError('')
    setAiBusy({ done: 0, total: targets.length })
    const names = cats.map((c) => c.key)
    let named = 0

    for (const [i, row] of targets.entries()) {
      try {
        const blob = await loadPhotoBlob(row.photoId!)
        if (blob) {
          const guess = await identifyPhoto(key, blob, names)
          if (guess?.name) {
            await updateInbox(row.id!, {
              name: guess.name,
              brand: guess.brand || undefined,
              category: (names.includes(guess.category ?? '') ? guess.category : guessCategory(guess.name)) as string,
              guessSource: 'ai',
              // Carried through so the screen can flag a shaky guess rather than
              // presenting it with the same confidence as a scanned barcode.
              guessNote: guess.confident ? undefined : 'Model was unsure — worth a look',
            })
            named++
          }
        }
      } catch (err) {
        // One bad photo shouldn't stop the run; a rejected key should.
        if (err instanceof AIError && /key was rejected/i.test(err.message)) {
          setError(err.message)
          break
        }
      }
      setAiBusy({ done: i + 1, total: targets.length })
    }

    setAiBusy(null)
    toast(named ? `Named ${named} of ${targets.length}` : 'Nothing could be named from those photos')
  }

  async function confirmAll() {
    const ready = pending.filter((r) => r.name?.trim())
    let added = 0
    for (const row of ready) {
      if (await confirmInbox(row)) added++
    }
    toast(added ? `${added} added to the kitchen` : 'Nothing named yet')
  }

  const body = (
    <div className="pos">
      <header className="pos-head">
        <span className="pos-back" aria-hidden style={{ visibility: 'hidden' }}>‹</span>
        <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
          <div className="pos-title">Unpacking</div>
          <div className="pos-sub">
            {pending.length
              ? `${pending.length} photos · ${unnamed.length} still to name`
              : 'Photograph the shopping, name it after'}
          </div>
        </div>
        <button className="pos-back" onClick={onClose} aria-label="Close unpacking">✕</button>
      </header>

      <div className="pos-controls" style={{ gap: 8 }}>
        <button className="btn primary" disabled={!!progress} onClick={() => fileRef.current?.click()}>
          {progress ? `Importing ${progress.done}/${progress.total}…` : '＋ Add photos'}
        </button>
        {unnamed.length > 0 && (
          <button className="btn" disabled={!!scanBusy || !!aiBusy} onClick={scanAgain}>
            {scanBusy ? `Scanning ${scanBusy.done}/${scanBusy.total}…` : `🔎 Scan the ${unnamed.length} unknown`}
          </button>
        )}
        {unnamed.length > 0 && (
          <button className="btn" disabled={!!aiBusy || !!scanBusy} onClick={runAI}>
            {aiBusy ? `Naming ${aiBusy.done}/${aiBusy.total}…` : `✨ Name the ${unnamed.length} unknown`}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => onFiles(e.target.files)}
        />
      </div>

      {error && (
        <p style={{ padding: '0 14px', fontSize: 12.5, color: 'var(--danger)' }}>{error}</p>
      )}

      <div className="pos-grid">
        {pending.length === 0 ? (
          <p className="pos-empty">
            Pick a batch of photos — one per item — and they land here. Anything with a readable
            barcode names itself; the rest waits for you.
          </p>
        ) : (
          pending.map((row) => (
            <UnpackTile
              key={row.id}
              row={row}
              categories={cats.map((c) => ({ key: c.key, label: c.label, emoji: c.emoji }))}
              places={places.map((p) => ({ key: p.key, label: p.label, emoji: p.emoji }))}
              onToast={toast}
            />
          ))
        )}
      </div>

      <footer className="pos-foot">
        <span className="pos-count">
          {unnamed.length === 0 && pending.length > 0
            ? 'All named — ready to put away'
            : `${pending.length - unnamed.length} of ${pending.length} named`}
        </span>
        <button
          className="btn primary"
          disabled={pending.length === unnamed.length}
          onClick={confirmAll}
        >
          Put away the named
        </button>
        <button className="btn" onClick={onClose}>Done</button>
      </footer>
    </div>
  )

  return createPortal(body, document.body)
}

function UnpackTile({
  row, categories, places, onToast,
}: {
  row: InboxItem
  categories: Array<{ key: string; label: string; emoji: string }>
  places: Array<{ key: string; label: string; emoji: string }>
  onToast: (m: string) => void
}) {
  const { url: photo } = usePhoto(row.photoId, 'thumb')
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(row.name ?? '')
  const [busy, setBusy] = useState(false)

  const named = Boolean(row.name?.trim())

  async function save() {
    setBusy(true)
    try {
      const id = await confirmInbox(row, { name: name || row.name })
      onToast(id ? `${name || row.name} added` : 'Give it a name first')
      if (id) setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="pos-tile-wrap">
        <button
          className={`pos-tile${photo ? ' has-photo' : ''}${named ? '' : ' spent'}`}
          onClick={() => setOpen(true)}
        >
          {photo
            ? <img className="pos-fill" src={photo} alt="" loading="lazy" />
            : <span className="pos-glyph">🖼️</span>}
          <span className="pos-label">
            <span className="pos-name">{row.name || 'Not named yet'}</span>
            <span className="pos-meta">
              {row.guessSource === 'barcode' ? 'from barcode'
                : row.guessSource === 'ai' ? 'from the photo'
                : row.guessNote ?? 'tap to name'}
            </span>
          </span>
          {row.guessNote && <span className="pos-flag warn inset">?</span>}
        </button>
      </div>

      {open && (
        <div className="pop-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className="pop" role="dialog" aria-modal="true" aria-label="Name this item">
            <div className="pop-head">
              <strong>{row.name || 'What is it?'}</strong>
              <button className="close-x" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>

            {photo && <img src={photo} alt="" style={{ width: '100%', borderRadius: 12, maxHeight: 200, objectFit: 'cover' }} />}

            {row.guessNote && (
              <p style={{ fontSize: 12, color: 'var(--text-mute)' }}>{row.guessNote}</p>
            )}

            <label className="field">
              <span>Name</span>
              <input
                type="text"
                value={name}
                autoFocus
                placeholder="Bananas"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) save() }}
              />
            </label>

            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button
                className="btn ghost sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  const ok = await rescan(row)
                  setBusy(false)
                  onToast(ok ? 'Barcode found' : 'Still no barcode in that photo')
                }}
              >
                🔎 Try the barcode again
              </button>
              <span className="spacer" />
              <button
                className="btn danger sm"
                disabled={busy}
                onClick={async () => { await discardInbox(row); onToast('Photo discarded') }}
              >
                Discard
              </button>
            </div>

            <button className="btn primary block" disabled={busy || !name.trim()} onClick={save}>
              Put it in the kitchen
            </button>
            <p style={{ fontSize: 11.5, color: 'var(--text-mute)', textAlign: 'center' }}>
              Goes to {places[0]?.label ?? 'your first location'} unless the category suggests
              otherwise — move it afterwards if that's wrong.
              {categories.length ? '' : ''}
            </p>
          </div>
        </div>
      )}
    </>
  )
}
