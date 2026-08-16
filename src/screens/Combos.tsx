import { useMemo, useState } from 'react'
import type { Combo, ItemView } from '../db/schema'
import { useCombos, useEvents, useRecipes, useShopList } from '../app/data'
import {
  comboFromSuggestion, resolveAll, saveCombo, shopMissing, suggestCombos, useCombo,
  type ComboView,
} from '../lib/combos'
import { Empty, Section } from '../components/ui'
import ComboEditor from '../components/ComboEditor'
import { useToast } from '../app/toast'

/**
 * Combinations: the sets of things you actually use together.
 *
 * Each one answers one question at a glance — have I got the whole set? — and
 * offers the two things worth doing about the answer: put the gaps on the list,
 * or use what's there.
 */
export default function Combos({ stock }: { stock: ItemView[] }) {
  const combos = useCombos()
  const events = useEvents()
  const recipes = useRecipes()
  const list = useShopList()
  const toast = useToast()
  const [editing, setEditing] = useState<Combo | 'new' | null>(null)

  const views = useMemo(() => resolveAll(combos ?? [], stock), [combos, stock])

  const suggestions = useMemo(
    () => suggestCombos(events ?? [], recipes ?? [], combos ?? [], stock),
    [events, recipes, combos, stock],
  )

  if (!combos || !events || !recipes || !list) return null

  const ready = views.filter((v) => v.complete).length

  async function shop(view: ComboView) {
    const added = await shopMissing(view, list ?? [])
    toast(added ? `${added} added to the shopping list` : 'Already on the list')
  }

  async function use(view: ComboView) {
    const used = await useCombo(view)
    toast(used ? `Used ${used} ${used === 1 ? 'thing' : 'things'} from ${view.combo.name}` : 'Nothing in stock to use')
  }

  return (
    <>
      <Section
        title="Your combinations"
        hint={views.length ? `${ready} of ${views.length} ready to go` : undefined}
        action={<button className="btn sm" onClick={() => setEditing('new')}>+ New</button>}
      >
        {views.length === 0 ? (
          <Empty emoji="🧩" title="No combinations yet">
            Group the things you always use together — pasta and sauce, chips and salsa — and the
            app can tell you at a glance whether you've got the whole set, and put the missing half
            on your list.
          </Empty>
        ) : (
          <div className="stack auto-cols">
            {views.map((view) => (
              <ComboCard
                key={view.combo.id}
                view={view}
                onEdit={() => setEditing(view.combo)}
                onShop={() => shop(view)}
                onUse={() => use(view)}
              />
            ))}
          </div>
        )}
      </Section>

      {suggestions.length > 0 && (
        <Section title="Larder noticed" hint="From what you've eaten and cooked">
          <div className="stack">
            {suggestions.map((s) => (
              <div className="item" key={s.names.join('|')}>
                <span style={{ fontSize: 20, flex: 'none' }} aria-hidden>🧩</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="name">{s.names.join(' + ')}</div>
                  <div className="meta"><span>{s.reason}</span></div>
                </div>
                <button
                  className="btn sm"
                  onClick={async () => {
                    await saveCombo(comboFromSuggestion(s, stock))
                    toast(`${s.names.join(' + ')} saved`)
                  }}
                >
                  Keep it
                </button>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 8 }}>
            These come from things you've used on the same day more than once, and from ingredients
            that share one of your recipes. Keeping one makes it a normal combination you can edit.
          </p>
        </Section>
      )}

      {editing && (
        <ComboEditor
          combo={editing === 'new' ? undefined : editing}
          stock={stock}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

function ComboCard({
  view, onEdit, onShop, onUse,
}: {
  view: ComboView
  onEdit: () => void
  onShop: () => void
  onUse: () => void
}) {
  const { combo, parts, haveCount, total, complete, missing } = view
  const anyPresent = parts.some((p) => p.have)

  return (
    <div className="card card-pad stack">
      <div className="row" style={{ gap: 10 }}>
        <span style={{ fontSize: 24, flex: 'none' }} aria-hidden>{combo.emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 650, lineHeight: 1.25 }}>{combo.name}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-mute)', marginTop: 2 }}>
            {complete ? 'You have everything' : `${haveCount} of ${total}`}
            {combo.timesUsed > 0 && ` · used ${combo.timesUsed}×`}
          </div>
        </div>
        <span className={`chip ${complete ? 'tone-fresh' : 'tone-soon'}`}>
          <span className="dot" />
          {complete ? 'Ready' : `${missing.length} short`}
        </span>
      </div>

      <div className="tag-row">
        {parts.map((p, i) => (
          <span key={`${p.part.name}-${i}`} className={`chip part${p.have ? ' has' : ''}`}>
            {p.have ? '✓' : '○'} {p.part.name}
            {p.part.optional && <em style={{ opacity: 0.7, fontStyle: 'normal' }}> · optional</em>}
          </span>
        ))}
      </div>

      {combo.notes && (
        <p style={{ fontSize: 12.5, color: 'var(--text-mute)' }}>{combo.notes}</p>
      )}

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {missing.length > 0 && (
          <button className="btn sm" onClick={onShop}>🛒 Shop the {missing.length} missing</button>
        )}
        {anyPresent && (
          <button className="btn sm" onClick={onUse}>🍽️ Use it</button>
        )}
        <span className="spacer" />
        <button className="btn ghost sm" onClick={onEdit}>Edit</button>
      </div>
    </div>
  )
}
