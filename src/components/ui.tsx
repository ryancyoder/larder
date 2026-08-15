import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Category, ItemView } from '../db/schema'
import { categoryMeta } from '../lib/categories'
import { freshnessOf, type Freshness } from '../lib/inventory'
import { relativeDays } from '../lib/dates'
import { usePhotoUrl } from '../app/usePhoto'

export function Sheet({
  title, onClose, children, footer,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prior
    }
  }, [onClose])

  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <h3>{title}</h3>
          <button className="close-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

const FRESH_VAR: Record<Freshness, string> = {
  expired: 'var(--fresh-expired)',
  urgent: 'var(--fresh-urgent)',
  soon: 'var(--fresh-soon)',
  fresh: 'var(--fresh-fresh)',
  stable: 'var(--fresh-stable)',
}

/**
 * Donut that empties as an item's shelf life runs out. When the item has a
 * photo the ring wraps the photo; otherwise it falls back to the category icon.
 */
export function FreshnessRing({
  item, big, showPhoto = true,
}: {
  item: ItemView
  big?: boolean
  /** Off where the photo is already displayed larger nearby. */
  showPhoto?: boolean
}) {
  const f = freshnessOf(item)
  const meta = categoryMeta(item.category)
  const resolved = usePhotoUrl(item.photoId, big ? 'full' : 'thumb')
  const photo = showPhoto ? resolved : undefined
  const pct = f.state === 'stable' ? 100 : Math.max(4, f.remaining * 100)
  return (
    <div
      className={`ring${big ? ' big' : ''}${photo ? ' has-photo' : ''}`}
      style={{ ['--pct' as string]: pct, ['--ring-color' as string]: FRESH_VAR[f.state] }}
      title={item.expiresAt ? `Best before ${relativeDays(item.expiresAt)}` : 'No expiry tracked'}
    >
      {photo
        ? <img className="ring-photo" src={photo} alt="" loading="lazy" />
        : <span className="glyph">{meta.emoji}</span>}
    </div>
  )
}

export function ExpiryChip({ item }: { item: ItemView }) {
  const f = freshnessOf(item)
  if (f.state === 'stable') return null
  const label =
    f.state === 'expired' ? `Expired ${relativeDays(item.expiresAt!)}`
    : f.days === 0 ? 'Use today'
    : `${f.days}d left`
  return <span className={`chip tone-${f.state}`}><span className="dot" />{label}</span>
}

export function CatDot({ category }: { category: Category }) {
  const meta = categoryMeta(category)
  return <span className="cat-dot" style={{ background: `var(--cat-${meta.hue})` }} aria-hidden />
}

export function Stat({
  label, value, delta, tone,
}: {
  label: string
  value: string
  delta?: string
  tone?: 'up' | 'down'
}) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {delta && <div className={`delta${tone ? ` ${tone}` : ''}`}>{delta}</div>}
    </div>
  )
}

export function Empty({ emoji, title, children }: { emoji: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="big">{emoji}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  )
}

export function Seg<T extends string>({
  value, options, onChange,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
}) {
  return (
    <div className="seg" role="group">
      {options.map((o) => (
        <button key={o.value} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

export function Section({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <header>
        <h2>{title}</h2>
        {action ?? (hint && <span className="hint">{hint}</span>)}
      </header>
      {children}
    </section>
  )
}
