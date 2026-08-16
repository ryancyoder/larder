import { useMemo, useState } from 'react'
import type { ItemView, StorageLocation } from '../db/schema'
import { useKitchen, usePlaces } from '../app/data'
import { categoryMeta } from '../lib/categories'
import { expiringSoon, freshnessOf, sortByUrgency, unitPrice } from '../lib/inventory'
import { formatAmount } from '../lib/units'
import { similarity } from '../lib/match'
import { CatDot, Empty, ExpiryChip, FreshnessRing, Section, Seg } from '../components/ui'
import AddItemSheet from '../components/AddItemSheet'
import ItemSheet from '../components/ItemSheet'

type Filter = 'all' | StorageLocation

export default function Kitchen({ onOpenSettings }: { onOpenSettings: () => void }) {
  const items = useKitchen()
  const places = usePlaces() ?? []
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [selected, setSelected] = useState<ItemView | null>(null)

  const visible = useMemo(() => {
    if (!items) return []
    let list = items
    if (filter !== 'all') list = list.filter((i) => i.location === filter)
    if (query.trim()) {
      const q = query.trim()
      list = list.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()) || similarity(q, i.name) > 0.4)
    }
    return [...list].sort(sortByUrgency)
  }, [items, filter, query])

  // Keep the open sheet in sync after an edit rather than showing stale numbers.
  const live = selected && items ? items.find((i) => i.id === selected.id) ?? null : null

  const urgent = items ? expiringSoon(items, 3) : []
  const atRisk = urgent.reduce((sum, i) => sum + unitPrice(i) * i.available, 0)

  const grouped = useMemo(() => {
    if (filter !== 'all' || query.trim()) return null
    return places.map((loc) => ({
      loc,
      items: visible.filter((i) => i.location === loc.key),
    })).filter((g) => g.items.length > 0)
  }, [visible, filter, query, places])

  if (!items) return null

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Kitchen</h1>
          <div className="sub">
            {items.length} items tracked
            {urgent.length > 0 && <> · <span style={{ color: 'var(--fresh-urgent)' }}>{urgent.length} need using</span></>}
          </div>
        </div>
        <button className="btn ghost sm" onClick={onOpenSettings}>Settings</button>
      </div>

      {urgent.length > 0 && (
        <Section
          title="Eat me first"
          hint={atRisk > 0 ? `$${atRisk.toFixed(2)} at risk` : undefined}
        >
          <div className="scroll-x">
            {urgent.map((item) => {
              const f = freshnessOf(item)
              return (
                <button
                  key={item.id}
                  className="card card-pad"
                  style={{
                    width: 148, textAlign: 'left', animation: 'fadeUp .34s var(--ease) both',
                    display: 'flex', flexDirection: 'column',
                  }}
                  onClick={() => setSelected(item)}
                >
                  <FreshnessRing item={item} />
                  <div style={{ fontWeight: 650, marginTop: 10, fontSize: 14, lineHeight: 1.25 }}>{item.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 3 }}>
                    {formatAmount(item.available, item.unit)} free
                  </div>
                  {/* Pushes the countdown chip to a common baseline across cards. */}
                  <div style={{ marginTop: 'auto', paddingTop: 10 }}>
                    <span className={`chip tone-${f.state}`}>
                      <span className="dot" />
                      {f.state === 'expired' ? 'Past date' : f.days === 0 ? 'Today' : f.days === 1 ? 'Tomorrow' : `${f.days} days`}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </Section>
      )}

      <section className="section">
        <div className="row" style={{ marginBottom: 11, gap: 9 }}>
          <div className="search">
            <span className="icon">🔍</span>
            <input
              type="search"
              placeholder="Search the kitchen…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <Seg
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all' as Filter, label: 'Everything' },
            ...places.map((l) => ({ value: l.key as Filter, label: `${l.emoji} ${l.label}` })),
          ]}
        />
      </section>

      {visible.length === 0 ? (
        <div className="section">
          <Empty emoji="🫙" title={query ? 'Nothing matches that' : 'This spot is empty'}>
            {query ? 'Try a shorter search, or add it as a new item.' : 'Tap the + button to put something in.'}
          </Empty>
        </div>
      ) : grouped ? (
        grouped.map((g) => (
          <Section key={g.loc.key} title={`${g.loc.emoji} ${g.loc.label}`} hint={g.loc.blurb}>
            <div className="stack auto-cols">
              {g.items.map((item, i) => <ItemRow key={item.id} item={item} index={i} onClick={() => setSelected(item)} />)}
            </div>
          </Section>
        ))
      ) : (
        <div className="section">
          <div className="stack auto-cols">
            {visible.map((item, i) => <ItemRow key={item.id} item={item} index={i} onClick={() => setSelected(item)} />)}
          </div>
        </div>
      )}

      <button className="fab" onClick={() => setAdding(true)} aria-label="Add an item">+</button>

      {adding && <AddItemSheet onClose={() => setAdding(false)} />}
      {live && <ItemSheet item={live} onClose={() => setSelected(null)} />}
    </>
  )
}

function ItemRow({ item, index, onClick }: { item: ItemView; index: number; onClick: () => void }) {
  const meta = categoryMeta(item.category)
  return (
    <button
      className={`item${item.reserved > 0 ? ' held' : ''}`}
      onClick={onClick}
      style={{ animationDelay: `${Math.min(index, 10) * 22}ms` }}
    >
      <FreshnessRing item={item} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="name">{item.name}</div>
        <div className="meta">
          <CatDot category={item.category} />
          <span>{meta.label}</span>
          <ExpiryChip item={item} />
          {item.reserved > 0 && (
            <span className="chip tone-hold"><span className="dot" />{formatAmount(item.reserved, item.unit)} held</span>
          )}
          {item.size && item.sizeUnit && (
            <span>· {formatAmount(item.size, item.sizeUnit)} each</span>
          )}
          {item.isStaple && item.available < (item.parQty ?? 0) && (
            <span className="chip tone-urgent"><span className="dot" />running low</span>
          )}
        </div>
      </div>
      <div className="qty">
        {formatAmount(item.available, item.unit)}
        {item.reserved > 0 && <small>of {formatAmount(item.qty, item.unit)}</small>}
      </div>
    </button>
  )
}
