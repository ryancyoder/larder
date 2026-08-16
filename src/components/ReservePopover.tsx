import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { ItemView } from '../db/schema'
import { usePeople } from '../app/data'
import { personLabel } from '../lib/people'
import { releaseHold, reserve } from '../lib/inventory'
import { formatAmount } from '../lib/units'
import { useToast } from '../app/toast'

/**
 * Setting something aside straight from a tile.
 *
 * Small on purpose — the full sheet asks how much and what for, and this is the
 * one-tap version: who, and done. It still can't skip the person, because an
 * untagged hold is the thing this whole feature exists to prevent.
 */
export default function ReservePopover({ item, onClose }: { item: ItemView; onClose: () => void }) {
  const people = usePeople() ?? []
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  // One of whatever it's counted in, or the last of it if less than one is left.
  const amount = Math.min(1, item.available)

  async function hold(personKey: string) {
    setBusy(true)
    try {
      await reserve(item, amount, 'Set aside', undefined, personKey)
      toast(`${formatAmount(amount, item.unit)} of ${item.name} set aside for ${personLabel(people, personKey)}`)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  async function release(id: number) {
    setBusy(true)
    try {
      await releaseHold(id)
      toast('Hold released')
      if (item.holds.length <= 1) onClose()
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="pop-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="pop" role="dialog" aria-modal="true" aria-label={`Set aside ${item.name}`}>
        <div className="pop-head">
          <strong>{item.name}</strong>
          <button className="close-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {item.holds.length > 0 && (
          <div className="stack-sm">
            {item.holds.map((h) => (
              <div className="row" key={h.id} style={{ gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                  {formatAmount(h.qty, item.unit)} for <strong>{personLabel(people, h.personKey)}</strong>
                </span>
                <button className="btn ghost sm" disabled={busy} onClick={() => release(h.id!)}>Release</button>
              </div>
            ))}
          </div>
        )}

        {item.available > 0 ? (
          <>
            <label className="lbl">Set aside {formatAmount(amount, item.unit)} for</label>
            <div className="tag-row">
              {people.map((p) => (
                <button
                  key={p.key}
                  className="chip toggle"
                  disabled={busy}
                  onClick={() => hold(p.key)}
                >
                  {p.emoji} {p.name}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p style={{ fontSize: 12.5, color: 'var(--text-mute)' }}>
            Nothing free left to set aside — it's all spoken for already.
          </p>
        )}
      </div>
    </div>,
    document.body,
  )
}
