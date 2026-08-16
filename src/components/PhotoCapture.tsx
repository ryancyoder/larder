import { useEffect, useRef, useState } from 'react'
import { deletePhoto, loadPhotoBlob, savePhoto, saveCutoutPhoto } from '../lib/photos'
import { usePhoto } from '../app/usePhoto'
import {
  CutoutError, MODEL_DOWNLOAD_MB, modelIsCached, removeBackground, webgpuAvailable,
  type CutoutProgress,
} from '../lib/cutout'

/**
 * Take a photo or pick one from the library, then optionally cut the
 * background out of it.
 *
 * A file input with `capture` is used rather than a live `getUserMedia`
 * preview: it opens the real camera app on iOS and Android — with its focus,
 * flash and framing — and degrades to a normal file picker on desktop.
 */
export default function PhotoCapture({
  photoId, onChange, label = 'Photo',
}: {
  photoId?: number
  onChange: (photoId: number | undefined) => void
  label?: string
}) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const libraryRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { url, cutout } = usePhoto(photoId, 'full')

  // Background removal
  const [cached, setCached] = useState<boolean | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [progress, setProgress] = useState<CutoutProgress | null>(null)
  /** The photo the cutout replaced, kept so "Undo" is instant and lossless. */
  const [previous, setPrevious] = useState<number | undefined>()

  useEffect(() => {
    modelIsCached().then(setCached)
  }, [])

  async function handleFile(file: File | undefined, source: 'camera' | 'library') {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const id = await savePhoto(file, source)
      onChange(id)
      setPrevious(undefined)
    } catch {
      setError('That image could not be read. Try a different one.')
    } finally {
      setBusy(false)
    }
  }

  async function runCutout() {
    if (photoId == null) return
    setConfirming(false)
    setError('')
    setProgress({ stage: cached ? 'loading' : 'downloading' })
    try {
      const { db } = await import('../db/db')
      const record = await db.photos.get(photoId)
      // The bytes live in storage now, so cutting the background out of a photo
      // means fetching it back rather than reading it off the row.
      const source = await loadPhotoBlob(photoId)
      if (!source) throw new CutoutError('That photo could not be read back.')

      const cut = await removeBackground(source, setProgress)
      const newId = await saveCutoutPhoto(cut, record?.source ?? 'camera', record?.attribution)
      setPrevious(photoId)
      onChange(newId)
      setCached(true)
    } catch (err) {
      setError(err instanceof CutoutError ? err.message : 'The cutout failed. The original is untouched.')
    } finally {
      setProgress(null)
    }
  }

  function undoCutout() {
    if (previous == null) return
    const discard = photoId
    onChange(previous)
    setPrevious(undefined)
    if (discard != null) void deletePhoto(discard)
  }

  const progressLabel =
    progress?.stage === 'downloading'
      ? `Downloading the cutout model… ${progress.ratio != null ? `${Math.round(progress.ratio * 100)}%` : ''}`
      : progress?.stage === 'loading'
        ? 'Starting the model…'
        : 'Removing the background…'

  return (
    <div className="field">
      <label>{label}</label>

      {url ? (
        <div className="photo-preview">
          <img src={url} alt="" className={cutout ? 'is-cutout' : undefined} />
          <div className="photo-preview-actions">
            <button className="btn sm" onClick={() => cameraRef.current?.click()} disabled={busy || !!progress}>Retake</button>
            <button className="btn ghost sm" onClick={() => onChange(undefined)} disabled={busy || !!progress}>Remove</button>
          </div>
        </div>
      ) : (
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" style={{ flex: 1 }} onClick={() => cameraRef.current?.click()} disabled={busy}>
            {busy ? 'Processing…' : '📷 Take a photo'}
          </button>
          <button className="btn ghost" onClick={() => libraryRef.current?.click()} disabled={busy}>
            Choose file
          </button>
        </div>
      )}

      {/* Cutout controls only make sense once there's something to cut out. */}
      {url && !progress && (
        <>
          {cutout ? (
            <div className="row" style={{ gap: 8 }}>
              <span className="chip tone-fresh"><span className="dot" />Background removed</span>
              {previous != null && (
                <button className="btn ghost sm" onClick={undoCutout}>Undo</button>
              )}
            </div>
          ) : confirming ? (
            <div className="card card-pad stack" style={{ gap: 9 }}>
              <p style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>
                This downloads a <strong>{MODEL_DOWNLOAD_MB} MB</strong> model the first time —
                once only, then it's cached. It runs entirely on this device; the photo is never
                uploaded.
                {!webgpuAvailable() && ' This browser has no WebGPU, so expect it to be slow.'}
              </p>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn ghost" style={{ flex: 1 }} onClick={() => setConfirming(false)}>Not now</button>
                <button className="btn primary" style={{ flex: 1 }} onClick={runCutout}>Download & run</button>
              </div>
            </div>
          ) : (
            <button
              className="btn sm"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => (cached ? runCutout() : setConfirming(true))}
            >
              ✂️ Cut out background{cached === false ? ` (${MODEL_DOWNLOAD_MB} MB first run)` : ''}
            </button>
          )}
        </>
      )}

      {progress && (
        <div className="card card-pad stack" style={{ gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{progressLabel}</div>
          <div className="meter">
            <span style={{ width: progress.ratio != null ? `${progress.ratio * 100}%` : '100%' }} />
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>
            Runs on this device. Takes a few seconds once the model is loaded.
          </p>
        </div>
      )}

      {error && <p style={{ fontSize: 12.5, color: 'var(--danger)' }}>{error}</p>}

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => { handleFile(e.target.files?.[0], 'camera'); e.target.value = '' }}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => { handleFile(e.target.files?.[0], 'library'); e.target.value = '' }}
      />
    </div>
  )
}
