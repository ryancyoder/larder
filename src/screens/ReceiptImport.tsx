import { useCallback, useEffect, useRef, useState } from 'react'
import { Sheet } from '../components/ui'
import { useToast } from '../app/toast'
import { getSetting } from '../db/db'
import { AIError, readReceiptPhoto } from '../lib/ai'
import { lookupBarcode } from '../lib/openfoodfacts'
import { todayISO } from '../lib/dates'
import {
  applyLineLookup, commitReceipt, computedTotal, parseReceipt, receiptFromScan,
  setLineField, setLineQty,
  type LineLookup, type ParsedReceipt, type ReceiptLine,
} from '../lib/receipt'

/**
 * Importing a receipt.
 *
 * The third way into the kitchen, and the only one that already knows the
 * price, so it is also the only one where the ledger comes out complete.
 *
 * Two stages, deliberately. Paste or photograph first, then review — because a
 * receipt parser is guessing at somebody's layout and will occasionally be
 * wrong, and a wrong price that lands silently is worse than one you were shown
 * before it counted. Nothing touches the kitchen until the second screen.
 */

const money = (n: number) => `$${n.toFixed(2)}`

export default function ReceiptImport({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<ParsedReceipt | null>(null)
  const [lines, setLines] = useState<ReceiptLine[]>([])
  const [store, setStore] = useState('')
  const [date, setDate] = useState(todayISO())
  const [lookups, setLookups] = useState<Record<string, LineLookup>>({})
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  /** Shared landing point for both routes, so they cannot drift apart. */
  const accept = useCallback((result: ParsedReceipt) => {
    if (!result.lines.length) {
      setError('Nothing on that looked like a purchase. Check the lines have prices on them.')
      return
    }
    setError('')
    setParsed(result)
    setLines(result.lines)
    setStore(result.store ?? '')
    setDate(result.date ?? todayISO())
  }, [])

  function readText() {
    if (!text.trim()) return
    accept(parseReceipt(text))
  }

  async function readPhoto(file: File) {
    const key = await getSetting('anthropicKey')
    if (!key) {
      setError('Reading a photo needs an Anthropic API key — add one in Settings. Pasting the text works without one.')
      return
    }
    setError('')
    setReading(true)
    try {
      const scan = await readReceiptPhoto(key, file)
      if (!scan) {
        setError('Could not read that photo. Try a straighter, brighter shot — or paste the text instead.')
        return
      }
      accept(receiptFromScan(scan))
    } catch (err) {
      setError(err instanceof AIError ? err.message : 'Could not read that photo.')
    } finally {
      setReading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  /**
   * Names come in behind you, the way they do in the rapid scanner. The review
   * list is usable the moment it appears; Open Food Facts improves it in place
   * rather than holding it up, because a receipt's own description is already
   * good enough to import if nothing better ever arrives.
   */
  useEffect(() => {
    if (!parsed) return
    let cancelled = false
    const codes = [...new Set(parsed.lines.map((l) => l.barcode).filter((b): b is string => Boolean(b)))]

    for (const code of codes) {
      lookupBarcode(code)
        .then((found) => {
          if (cancelled || !found) return
          const lookup: LineLookup = {
            name: found.name,
            brand: found.brand,
            category: found.category,
            nutrition: found.nutrition,
            size: found.qty,
            sizeUnit: found.unit,
          }
          setLookups((prev) => ({ ...prev, [code]: lookup }))
          setLines((prev) => applyLineLookup(prev, code, lookup))
        })
        .catch(() => { /* the receipt's own description stands */ })
    }
    return () => { cancelled = true }
  }, [parsed])

  const items = lines.filter((l) => l.kind === 'item')
  const chosen = items.filter((l) => l.include && l.qty > 0)
  const units = chosen.reduce((n, l) => n + l.qty, 0)
  const computed = computedTotal(lines)
  const printed = parsed?.printedTotal
  // Tax and a summary savings line are the usual explanations, and neither is
  // an error, so the gap is reported rather than flagged — the number is there
  // to be recognised, not obeyed.
  const gap = printed != null ? Math.round((printed - computed) * 100) / 100 : null

  async function save() {
    setBusy(true)
    try {
      const result = await commitReceipt(lines, {
        store,
        date,
        printedTotal: printed,
        lookups,
      })
      if (!result) {
        toast('Nothing ticked to import')
        setBusy(false)
        return
      }
      toast(
        result.parked
          ? `${result.added} put away · ${result.parked} need a one-time scan in Unpack`
          : `${result.added} item${result.added === 1 ? '' : 's'} in from ${store || 'the shop'}`,
      )
      onClose()
    } catch (err) {
      setBusy(false)
      toast(err instanceof Error ? err.message : 'Could not save that receipt.')
    }
  }

  // -------------------------------------------------------------------------

  if (!parsed) {
    return (
      <Sheet
        title="Import a receipt"
        onClose={onClose}
        footer={
          <>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={readText} disabled={!text.trim() || reading}>
              Read it
            </button>
          </>
        }
      >
        <p style={{ fontSize: 12.5, color: 'var(--text-mute)', margin: 0 }}>
          Paste the text of a receipt — from the shop's emailed copy or its app. Every line
          with a price on it becomes an item, named by the receipt. Where a line carries a
          full barcode, Open Food Facts fills in a better name behind you; ALDI's six-digit
          item numbers are its own, so those keep the till's wording.
        </p>

        <label className="field">
          <span>Receipt text</span>
          <textarea
            value={text}
            rows={10}
            autoFocus
            placeholder={'  514025 CA Heritage Brut     4.89 NC\n  356525 Carrots              1.99 FA'}
            onChange={(e) => setText(e.target.value)}
            style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 1.5 }}
          />
        </label>

        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-mute)' }}>or</span>
          <button className="btn" disabled={reading} onClick={() => fileRef.current?.click()}>
            {reading ? 'Reading the photo…' : '📷 Photograph it'}
          </button>
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--text-mute)', margin: 0 }}>
          Photographing sends the picture to Anthropic and needs an API key in Settings.
          Pasting the text stays on the device.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void readPhoto(f) }}
        />

        {error && <p className="gate-error">{error}</p>}
      </Sheet>
    )
  }

  return (
    <Sheet
      title={`Receipt · ${units} item${units === 1 ? '' : 's'}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={() => setParsed(null)} disabled={busy}>Back</button>
          <button className="btn primary" onClick={save} disabled={busy || !chosen.length}>
            {busy ? 'Putting away…' : `Put away ${units}`}
          </button>
        </>
      }
    >
      <div className="row" style={{ gap: 8 }}>
        <label className="field" style={{ flex: 2, minWidth: 0 }}>
          <span>Shop</span>
          <input type="text" value={store} placeholder="Groceries" onChange={(e) => setStore(e.target.value)} />
        </label>
        <label className="field" style={{ flex: 1, minWidth: 0 }}>
          <span>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>

      <div
        className="row"
        style={{ gap: 10, alignItems: 'baseline', fontSize: 12.5, color: 'var(--text-mute)' }}
      >
        <span>Lines add up to <strong style={{ color: 'var(--text-dim)' }}>{money(computed)}</strong></span>
        {printed != null && <span>· receipt says {money(printed)}</span>}
        {gap != null && gap !== 0 && (
          <span>
            · {money(Math.abs(gap))} {gap > 0 ? 'unaccounted for — usually tax or savings' : 'over'}
          </span>
        )}
      </div>

      {parsed.ignored > 0 && (
        <p style={{ fontSize: 11.5, color: 'var(--text-mute)', margin: 0 }}>
          {parsed.ignored} line{parsed.ignored === 1 ? '' : 's'} skipped as totals, tax or card
          details. Untick anything below that shouldn't come in, and correct any name that came
          out wrong — the till's own text is underneath each one.
        </p>
      )}

      <div className="stack" style={{ gap: 4 }}>
        {lines.map((line) => (
          <LineRow
            key={line.key}
            line={line}
            onToggle={() => setLines((p) => setLineField(p, line.key, { include: !line.include }))}
            onQty={(qty) => setLines((p) => setLineQty(p, line.key, qty))}
            onName={(description) => setLines((p) => setLineField(p, line.key, { description }))}
          />
        ))}
      </div>
    </Sheet>
  )
}

function LineRow({
  line, onToggle, onQty, onName,
}: {
  line: ReceiptLine
  onToggle: () => void
  onQty: (qty: number) => void
  onName: (name: string) => void
}) {
  const discount = line.kind === 'discount'
  const size = line.size != null ? ` · ${line.size}${line.sizeUnit ?? ''}` : ''

  return (
    <div
      className="row"
      style={{
        gap: 8,
        alignItems: 'center',
        padding: '6px 0',
        opacity: line.include || discount ? 1 : 0.45,
      }}
    >
      <input
        type="checkbox"
        checked={line.include}
        disabled={discount}
        onChange={onToggle}
        aria-label={`Include ${line.description}`}
        style={{ flex: 'none', width: 18, height: 18 }}
      />

      <span style={{ flex: 1, minWidth: 0 }}>
        <input
          type="text"
          value={line.description}
          disabled={discount}
          onChange={(e) => onName(e.target.value)}
          aria-label="Item name"
          style={{
            width: '100%', border: 'none', background: 'transparent', padding: 0,
            font: 'inherit', fontWeight: 600, fontSize: 14, color: 'inherit',
          }}
        />
        <span style={{ display: 'block', fontSize: 11, color: 'var(--text-mute)' }}>
          {discount ? 'Discount — not stocked' : line.rawDescription}
          {line.barcode ? ` · ${line.barcode}` : ''}{size}
        </span>
      </span>

      {!discount && (
        <div className="row" style={{ gap: 4, alignItems: 'center', flex: 'none' }}>
          <button className="btn ghost sm" aria-label="One fewer" onClick={() => onQty(line.qty - 1)}>−</button>
          <span style={{ minWidth: 18, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
            {line.qty}
          </span>
          <button className="btn ghost sm" aria-label="One more" onClick={() => onQty(line.qty + 1)}>+</button>
        </div>
      )}

      <span
        className="qty"
        style={{
          flex: 'none', minWidth: 56, textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
          color: discount ? 'var(--ok, var(--text-mute))' : undefined,
        }}
      >
        {line.price != null ? money(line.price) : '—'}
      </span>
    </div>
  )
}
