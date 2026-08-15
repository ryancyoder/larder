import { useMemo, useState } from 'react'
import type { ShopItem } from '../db/schema'
import { useAllStock, usePlan, useRecipes, useShopList, useTrips } from '../app/data'
import { CATEGORIES, categoryMeta, guessCategory } from '../lib/categories'
import { addGeneratedLines, checkout, generateList, type GeneratedLine } from '../lib/shopping'
import { formatAmount } from '../lib/units'
import { titleCase } from '../lib/match'
import { db } from '../db/db'
import { daysBetween, todayISO } from '../lib/dates'
import { CatDot, Empty, Field, Section, Sheet } from '../components/ui'
import { useToast } from '../app/toast'

export default function Shop() {
  const stock = useAllStock()
  const plan = usePlan()
  const recipes = useRecipes()
  const list = useShopList()
  const trips = useTrips()
  const toast = useToast()

  const [draft, setDraft] = useState('')
  const [checkingOut, setCheckingOut] = useState(false)

  const suggestions = useMemo(() => {
    if (!stock || !plan || !recipes || !list) return []
    const upcoming = plan.filter((p) => p.status === 'planned' && p.date >= todayISO())
    return generateList(stock, upcoming, recipes, list)
  }, [stock, plan, recipes, list])

  const grouped = useMemo(() => {
    if (!list) return []
    return CATEGORIES
      .map((c) => ({ meta: c, items: list.filter((i) => i.category === c.key) }))
      .filter((g) => g.items.length > 0)
  }, [list])

  if (!list || !stock) return null

  const pending = list.filter((i) => !i.checked)
  const ticked = list.filter((i) => i.checked)
  const estimate = ticked.reduce((sum, i) => sum + (i.estPrice ?? 0), 0)

  const lastTrip = trips?.length ? [...trips].sort((a, b) => b.date.localeCompare(a.date))[0] : null
  const sinceLast = lastTrip ? daysBetween(lastTrip.date, todayISO()) : null

  async function quickAdd() {
    const name = draft.trim()
    if (!name) return
    await db.shop.add({
      name: titleCase(name),
      qty: 1,
      unit: 'ea',
      category: guessCategory(name),
      checked: false,
      source: 'manual',
    })
    setDraft('')
  }

  async function toggle(item: ShopItem) {
    await db.shop.update(item.id!, { checked: !item.checked })
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Shopping</h1>
          <div className="sub">
            {pending.length} to get{ticked.length > 0 && ` · ${ticked.length} in the basket`}
            {sinceLast != null && ` · last shop ${sinceLast}d ago`}
          </div>
        </div>
        {ticked.length > 0 && (
          <button className="btn primary sm" onClick={() => setCheckingOut(true)}>
            Check out {estimate > 0 && `· $${estimate.toFixed(0)}`}
          </button>
        )}
      </div>

      <section className="section">
        <form
          className="row"
          style={{ gap: 8 }}
          onSubmit={(e) => { e.preventDefault(); quickAdd() }}
        >
          <div className="search" style={{ flex: 1 }}>
            <span className="icon">＋</span>
            <input
              type="text"
              placeholder="Add anything…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </div>
          <button className="btn" type="submit" disabled={!draft.trim()}>Add</button>
        </form>
      </section>

      {suggestions.length > 0 && (
        <Section
          title="Larder suggests"
          action={
            <button
              className="btn ghost sm"
              onClick={async () => {
                await addGeneratedLines(suggestions)
                toast(`${suggestions.length} suggestions added`)
              }}
            >
              Add all {suggestions.length}
            </button>
          }
        >
          <div className="stack" style={{ gap: 7 }}>
            {suggestions.map((s, i) => <SuggestionLine key={`${s.name}-${i}`} line={s} index={i} />)}
          </div>
        </Section>
      )}

      {list.length === 0 ? (
        <div className="section">
          <Empty emoji="🛒" title="The list is empty">
            Staples that run low and gaps in your meal plan show up here automatically.
          </Empty>
        </div>
      ) : (
        grouped.map((g) => (
          <Section key={g.meta.key} title={`${g.meta.emoji} ${g.meta.label}`}>
            <div className="stack" style={{ gap: 6 }}>
              {g.items.map((item, i) => (
                <div
                  key={item.id}
                  className="item"
                  style={{ padding: '9px 12px', opacity: item.checked ? 0.5 : 1, animationDelay: `${Math.min(i, 8) * 20}ms` }}
                >
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={() => toggle(item)}
                    aria-label={`Got ${item.name}`}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="name" style={{ fontSize: 14, textDecoration: item.checked ? 'line-through' : undefined }}>
                      {item.name}
                    </div>
                    <div className="meta">
                      <span>{formatAmount(item.qty, item.unit)}</span>
                      {item.reason && <><span>·</span><span>{item.reason}</span></>}
                      {item.source === 'staple' && <span className="chip"><span className="dot" />staple</span>}
                      {item.source === 'plan' && <span className="chip tone-hold"><span className="dot" />meal plan</span>}
                    </div>
                  </div>
                  <button className="close-x" aria-label={`Remove ${item.name}`} onClick={() => db.shop.delete(item.id!)}>✕</button>
                </div>
              ))}
            </div>
          </Section>
        ))
      )}

      {checkingOut && (
        <CheckoutSheet items={ticked} onClose={() => setCheckingOut(false)} />
      )}
    </>
  )
}

function SuggestionLine({ line, index }: { line: GeneratedLine; index: number }) {
  const [added, setAdded] = useState(false)
  const meta = categoryMeta(line.category)
  return (
    <div className="item" style={{ padding: '9px 12px', opacity: added ? 0.5 : 1, animationDelay: `${Math.min(index, 8) * 20}ms` }}>
      <span style={{ fontSize: 18, flex: 'none', width: 26, textAlign: 'center' }}>{meta.emoji}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="name" style={{ fontSize: 14 }}>{line.name}</div>
        <div className="meta">
          <CatDot category={line.category} />
          <span>{formatAmount(line.qty, line.unit)}</span>
          <span>·</span>
          <span>{line.reason}</span>
        </div>
      </div>
      <button
        className="btn ghost sm"
        disabled={added}
        onClick={async () => { await addGeneratedLines([line]); setAdded(true) }}
      >
        {added ? '✓' : 'Add'}
      </button>
    </div>
  )
}

function CheckoutSheet({ items, onClose }: { items: ShopItem[]; onClose: () => void }) {
  const toast = useToast()
  const [store, setStore] = useState('')
  const [prices, setPrices] = useState<Record<number, string>>({})

  const total = items.reduce((sum, i) => sum + (Number(prices[i.id!]) || 0), 0)

  async function confirm() {
    const numeric: Record<number, number> = {}
    for (const [id, value] of Object.entries(prices)) {
      const n = Number(value)
      if (n > 0) numeric[Number(id)] = n
    }
    await checkout(items, { store, prices: numeric })
    toast(`${items.length} items stocked${total > 0 ? ` · $${total.toFixed(2)} logged` : ''}`)
    onClose()
  }

  return (
    <Sheet
      title="Put the shopping away"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Not yet</button>
          <button className="btn primary" onClick={confirm}>
            Stock the kitchen{total > 0 && ` · $${total.toFixed(2)}`}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
        These {items.length} items go straight into the kitchen with today's date. Prices are optional,
        but they're what makes the spend and waste tracking work.
      </p>

      <Field label="Where did you shop?">
        <input type="text" value={store} placeholder="Trader Joe's" onChange={(e) => setStore(e.target.value)} />
      </Field>

      <div className="stack" style={{ gap: 7 }}>
        {items.map((item) => (
          <div className="row" key={item.id} style={{ gap: 9 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{item.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-mute)' }}>{formatAmount(item.qty, item.unit)}</div>
            </div>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="$"
              value={prices[item.id!] ?? ''}
              onChange={(e) => setPrices((p) => ({ ...p, [item.id!]: e.target.value }))}
              style={{ width: 88 }}
            />
          </div>
        ))}
      </div>

      <div className="row" style={{ justifyContent: 'space-between', paddingTop: 9, borderTop: '1px solid var(--line)' }}>
        <span style={{ fontSize: 13, color: 'var(--text-mute)', fontWeight: 600 }}>Trip total</span>
        <span className="tabular" style={{ fontSize: 19, fontWeight: 700 }}>${total.toFixed(2)}</span>
      </div>
    </Sheet>
  )
}
