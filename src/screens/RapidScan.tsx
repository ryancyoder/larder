import { useCallback, useEffect, useRef, useState } from 'react'
import { ScanError, startScanner, type ScannerHandle } from '../lib/barcode'
import { lookupBarcode } from '../lib/openfoodfacts'
import { addScan, applyLookup, commitScans, setQty, type ScanLine } from '../lib/rapid'
import { Sheet } from '../components/ui'
import { useToast } from '../app/toast'

/**
 * Scanning the whole shop.
 *
 * The camera stays on and nothing interrupts: scan, beep, scan, beep. Names
 * fill in behind you as Open Food Facts answers. The list is the receipt — you
 * check it once at the end rather than confirming thirty times.
 */

/** A short click, so a scan is felt without looking at the screen. */
function useBeep() {
  const ctxRef = useRef<AudioContext | null>(null)
  return useCallback((ok: boolean) => {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      const ctx = ctxRef.current ?? (ctxRef.current = new Ctor())
      if (ctx.state === 'suspended') void ctx.resume()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = ok ? 1180 : 320
      gain.gain.setValueAtTime(0, ctx.currentTime)
      gain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12)
      osc.connect(gain); gain.connect(ctx.destination)
      osc.start(); osc.stop(ctx.currentTime + 0.13)
    } catch { /* a silent scan still works */ }
    navigator.vibrate?.(ok ? 30 : [30, 40, 30])
  }, [])
}

export default function RapidScan({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const beep = useBeep()
  const videoRef = useRef<HTMLVideoElement>(null)
  const handleRef = useRef<ScannerHandle | null>(null)

  const [lines, setLines] = useState<ScanLine[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(0)

  // The scanner callback is installed once; reading state through a ref keeps
  // it stable so the camera is never torn down and restarted mid-shop.
  const linesRef = useRef(lines)
  useEffect(() => { linesRef.current = lines }, [lines])

  const onCode = useCallback((code: string) => {
    const clean = code.replace(/\D/g, '')
    if (!clean) return
    const known = linesRef.current.some((l) => l.barcode === clean)
    beep(true)
    setFlash((n) => n + 1)
    setLines((prev) => addScan(prev, clean))
    if (known) return          // already looked up, or already in flight

    lookupBarcode(clean)
      .then((found) => setLines((prev) => applyLookup(prev, clean, found)))
      .catch(() => setLines((prev) => applyLookup(prev, clean, null)))
  }, [beep])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const video = videoRef.current
      if (!video) return
      try {
        const handle = await startScanner(video, onCode, { continuous: true })
        if (cancelled) { handle.stop(); return }
        handleRef.current = handle
      } catch (err) {
        if (!cancelled) setError(err instanceof ScanError ? err.message : 'The camera could not be started.')
      }
    })()
    return () => {
      cancelled = true
      handleRef.current?.stop()
      handleRef.current = null
    }
  }, [onCode])

  const total = lines.reduce((n, l) => n + l.qty, 0)
  const unknown = lines.filter((l) => l.status === 'unknown').length

  async function finish() {
    if (!lines.length) { onClose(); return }
    setBusy(true)
    try {
      handleRef.current?.stop()
      const { added, parked } = await commitScans(lines)
      toast(
        parked
          ? `${added} put away · ${parked} need naming in Unpack`
          : `${added} put away`,
      )
      onClose()
    } catch (err) {
      setBusy(false)
      toast(err instanceof Error ? err.message : 'Could not save those.')
    }
  }

  return (
    <Sheet
      title={total ? `Scanning · ${total}` : 'Scan the shop'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={finish} disabled={busy || !lines.length}>
            {busy ? 'Saving…' : total ? `Put away ${total}` : 'Nothing yet'}
          </button>
        </>
      }
    >
      {/* No key on this container. Keying it to restart the flash animation
          would remount the subtree, destroying the <video> the camera stream is
          attached to — the picture goes black after the first scan. The key
          lives on the throwaway flash overlay instead. */}
      <div className="scanner rapid">
        <video ref={videoRef} muted playsInline />
        {!error && <div className="scanner-frame" aria-hidden />}
        {flash > 0 && <span key={flash} className="scan-flash" aria-hidden />}
      </div>

      {error && <p className="gate-error">{error}</p>}

      <p style={{ fontSize: 12, color: 'var(--text-mute)', margin: 0 }}>
        Keep going — one after another. Scanning the same thing twice counts two.
        {unknown ? ` ${unknown} not recognised; they'll wait in Unpack for a name.` : ''}
      </p>

      {lines.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-mute)', textAlign: 'center', padding: '18px 0' }}>
          Point the camera at a barcode.
        </p>
      ) : (
        <div className="stack" style={{ gap: 6 }}>
          {lines.map((l) => (
            <div key={l.barcode} className="row" style={{ gap: 10, alignItems: 'center' }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 600, fontSize: 14 }}>
                  {l.status === 'looking' ? 'Looking up…' : l.name ?? 'Not recognised'}
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>
                  {l.brand ? `${l.brand} · ` : ''}{l.barcode}
                </span>
              </span>
              <div className="row" style={{ gap: 4, alignItems: 'center' }}>
                <button
                  className="btn ghost sm"
                  aria-label="One fewer"
                  onClick={() => setLines((p) => setQty(p, l.barcode, l.qty - 1))}
                >−</button>
                <span style={{ minWidth: 18, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                  {l.qty}
                </span>
                <button
                  className="btn ghost sm"
                  aria-label="One more"
                  onClick={() => setLines((p) => setQty(p, l.barcode, l.qty + 1))}
                >+</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  )
}
