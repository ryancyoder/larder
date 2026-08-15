import { useEffect, useRef, useState } from 'react'
import { ScanError, startScanner, type ScannerHandle } from '../lib/barcode'
import { Field, Sheet } from './ui'

/**
 * Live camera scanner. Always offers manual barcode entry alongside it — the
 * camera can be denied, absent, or simply worse than reading the digits off
 * the pack yourself.
 */
export default function BarcodeScanner({
  onDetected, onClose,
}: {
  onDetected: (barcode: string) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const handleRef = useRef<ScannerHandle | null>(null)
  const [error, setError] = useState<string>('')
  const [engine, setEngine] = useState<ScannerHandle['engine'] | null>(null)
  const [manual, setManual] = useState('')

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const video = videoRef.current
      if (!video) return
      try {
        const handle = await startScanner(video, (code) => {
          handleRef.current?.stop()
          onDetected(code)
        })
        if (cancelled) {
          handle.stop()
          return
        }
        handleRef.current = handle
        setEngine(handle.engine)
      } catch (err) {
        if (!cancelled) setError(err instanceof ScanError ? err.message : 'The camera could not be started.')
      }
    })()

    return () => {
      cancelled = true
      handleRef.current?.stop()
      handleRef.current = null
    }
  }, [onDetected])

  return (
    <Sheet
      title="Scan a barcode"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={manual.replace(/\D/g, '').length < 6}
            onClick={() => onDetected(manual.replace(/\D/g, ''))}
          >
            Use typed code
          </button>
        </>
      }
    >
      <div className="scanner">
        <video ref={videoRef} muted playsInline />
        {!error && <div className="scanner-frame" aria-hidden />}
        {error && (
          <div className="scanner-error">
            <div style={{ fontSize: 28, marginBottom: 8 }}>📷</div>
            <p style={{ fontSize: 13.5 }}>{error}</p>
          </div>
        )}
      </div>

      {!error && (
        <p style={{ fontSize: 12.5, color: 'var(--text-mute)', textAlign: 'center' }}>
          Hold the barcode inside the frame.
          {engine === 'zxing' && ' Using the software decoder — give it a second.'}
          {engine === null && ' Starting the camera…'}
        </p>
      )}

      <Field label="Or type the number under the barcode">
        <input
          type="text"
          inputMode="numeric"
          placeholder="3017624010701"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
        />
      </Field>

      <p style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>
        The barcode is sent to Open Food Facts to look up the product name and picture.
        Nothing else about your kitchen is shared, and you can always add the item by hand instead.
      </p>
    </Sheet>
  )
}
