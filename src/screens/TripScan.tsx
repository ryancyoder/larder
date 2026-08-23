import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Trip } from '../db/schema'
import { useInbox } from '../app/data'
import { useToast } from '../app/toast'
import { ScanError, startScanner, type ScannerHandle } from '../lib/barcode'
import { applyBarcode, confirmInbox } from '../lib/inbox'
import { lookupBarcode } from '../lib/openfoodfacts'
import {
  advance, matchScan, pendingFromInbox, progress,
  type PendingRow,
} from '../lib/tripScan'
import { Sheet } from '../components/ui'

/**
 * Scanning a shop against the receipt that bought it.
 *
 * The receipt already knows what was bought and what it cost. The only thing
 * missing on each parked line is which packet it refers to, so this session
 * fills in exactly that blank and nothing else: camera stays live, the screen
 * says which line it is waiting on, and a scan claims it and moves along.
 *
 * Nothing is confirmed into the kitchen until the end, and every scan is
 * written the moment it lands — so closing halfway keeps the barcodes learned
 * and leaves the rest parked, and reopening carries on where it stopped.
 */

const money = (n: number) => `$${n.toFixed(2)}`

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

export default function TripScan({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const toast = useToast()
  const beep = useBeep()
  const rows = useInbox()
  const videoRef = useRef<HTMLVideoElement>(null)
  const handleRef = useRef<ScannerHandle | null>(null)

  const [doneIds, setDoneIds] = useState<Set<number>>(new Set())
  const [currentId, setCurrentId] = useState<number | undefined>(undefined)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(0)

  /**
   * Frozen on open. `useInbox` is live and each scan rewrites a row, so a list
   * derived straight from it would reshuffle under the camera mid-session.
   */
  const [pending, setPending] = useState<PendingRow[] | null>(null)
  useEffect(() => {
    if (pending || !rows) return
    const list = pendingFromInbox(rows, trip.id!)
    setPending(list)
    setCurrentId(list[0]?.id)
  }, [rows, pending, trip.id])

  const list = useMemo(() => pending ?? [], [pending])
  const current = list.find((r) => r.id === currentId)
  const stats = progress(list, doneIds)

  // Read through refs so the scanner callback stays stable — rebuilding it
  // tears down the camera, and a session here can run for several minutes.
  const stateRef = useRef({ list, current, doneIds })
  useEffect(() => { stateRef.current = { list, current, doneIds } }, [list, current, doneIds])

  const onCode = useCallback((code: string) => {
    const clean = code.replace(/\D/g, '')
    if (!clean) return

    const { list: rowList, current: cursor, doneIds: done } = stateRef.current
    const waiting = rowList.filter((r) => !done.has(r.id))
    if (!waiting.length) return

    setFlash((n) => n + 1)
    setBusy(true)

    // The lookup runs first, because its answer is what decides *which* row
    // this scan belongs to — not just what to call it afterwards.
    lookupBarcode(clean)
      .catch(() => null)
      .then(async (found) => {
        const hit = matchScan(waiting, cursor, found?.name)
        if (!hit) { setBusy(false); return }

        const row = rows?.find((r) => r.id === hit.row.id)
        if (!row) { setBusy(false); return }

        // Writes the barcode onto the *product*, which is the lasting part:
        // the next receipt carrying this till code will not park at all.
        await applyBarcode(row, clean)

        setDoneIds((prev) => {
          const next = new Set(prev)
          next.add(hit.row.id)
          setCurrentId(advance(rowList, next, hit.row.id)?.id)
          return next
        })

        beep(true)
        setNote(
          hit.reason === 'name'
            ? `${found?.name} → matched "${hit.row.name}"`
            : found?.name
              ? `${hit.row.name} → ${found.name}`
              : `${hit.row.name} → code saved (not in Open Food Facts)`,
        )
        setBusy(false)
      })
      .catch(() => { beep(false); setBusy(false) })
  }, [beep, rows])

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

  /** Puts everything scanned this session onto the shelf, under this trip. */
  async function finish() {
    if (!doneIds.size) { onClose(); return }
    setBusy(true)
    handleRef.current?.stop()
    let added = 0
    try {
      for (const id of doneIds) {
        const row = rows?.find((r) => r.id === id)
        if (row && await confirmInbox(row)) added++
      }
      toast(
        stats.total - added > 0
          ? `${added} put away · ${stats.total - added} still waiting`
          : `${added} put away — that's the whole shop`,
      )
      onClose()
    } catch (err) {
      setBusy(false)
      toast(err instanceof Error ? err.message : 'Could not put those away.')
    }
  }

  return (
    <Sheet
      title={`${trip.store} · ${stats.done} of ${stats.total}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Stop</button>
          <button className="btn primary" onClick={finish} disabled={busy || !doneIds.size}>
            {busy ? 'Working…' : `Put away ${stats.done}`}
          </button>
        </>
      }
    >
      {/* No key on this container — keying it would remount the subtree and
          destroy the <video> the camera stream is attached to. The key lives on
          the throwaway flash overlay beside it. */}
      <div className="scanner rapid">
        <video ref={videoRef} muted playsInline />
        {!error && <div className="scanner-frame" aria-hidden />}
        {flash > 0 && <span key={flash} className="scan-flash" aria-hidden />}
      </div>

      {error && <p className="gate-error">{error}</p>}

      {current ? (
        <div className="card card-pad" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>Scan this one next</div>
          <div style={{ fontSize: 19, fontWeight: 700, margin: '2px 0' }}>{current.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-mute)' }}>
            {current.sku ? `#${current.sku}` : ''}
            {current.price != null ? ` · ${money(current.price)}` : ''}
            {current.qty > 1 ? ` · ${current.qty} of them` : ''}
          </div>
          <button
            className="btn ghost sm"
            style={{ marginTop: 8 }}
            disabled={busy}
            onClick={() => setCurrentId(advance(list, doneIds, current.id)?.id)}
          >
            Can't find it — skip
          </button>
        </div>
      ) : (
        <p style={{ fontSize: 14, textAlign: 'center', padding: '10px 0', fontWeight: 600 }}>
          {stats.total ? 'Everything scanned. Put it away.' : 'Nothing is waiting on a barcode.'}
        </p>
      )}

      <p style={{ fontSize: 12, color: 'var(--text-mute)', margin: 0, minHeight: 16 }}>
        {note || 'Grab them in any order — a recognised barcode finds its own line.'}
      </p>

      <div className="stack" style={{ gap: 2 }}>
        {list.map((row) => {
          const done = doneIds.has(row.id)
          return (
            <button
              key={row.id}
              className="item"
              onClick={() => setCurrentId(row.id)}
              disabled={done || busy}
              style={{
                padding: '6px 10px', width: '100%', textAlign: 'left',
                opacity: done ? 0.45 : 1,
                outline: row.id === currentId ? '2px solid var(--accent, #6a9)' : 'none',
              }}
            >
              <span style={{ flex: 'none', width: 18 }}>{done ? '✓' : '·'}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                  display: 'block', fontSize: 13.5, fontWeight: 600,
                  textDecoration: done ? 'line-through' : 'none',
                }}>
                  {row.name}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-mute)' }}>
                  {row.sku ? `#${row.sku}` : 'no code'}
                </span>
              </span>
              {row.price != null && (
                <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', flex: 'none' }}>
                  {money(row.price)}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}
