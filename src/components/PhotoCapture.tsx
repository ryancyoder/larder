import { useRef, useState } from 'react'
import { savePhoto } from '../lib/photos'
import { usePhotoUrl } from '../app/usePhoto'

/**
 * Take a photo or pick one from the library.
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
  const url = usePhotoUrl(photoId, 'full')

  async function handleFile(file: File | undefined, source: 'camera' | 'library') {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const id = await savePhoto(file, source)
      onChange(id)
    } catch {
      setError('That image could not be read. Try a different one.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="field">
      <label>{label}</label>

      {url ? (
        <div className="photo-preview">
          <img src={url} alt="" />
          <div className="photo-preview-actions">
            <button className="btn sm" onClick={() => cameraRef.current?.click()} disabled={busy}>Retake</button>
            <button className="btn ghost sm" onClick={() => onChange(undefined)} disabled={busy}>Remove</button>
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
