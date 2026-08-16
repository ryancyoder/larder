import { useMemo, useState } from 'react'
import type { Recipe } from '../db/schema'
import { useKitchen, useRecipes } from '../app/data'
import { BAND_META, bandOf, rankRecipes, type Suggestion } from '../lib/suggest'
import { Empty, Section, Seg } from '../components/ui'
import RecipeSheet from '../components/RecipeSheet'
import RecipeEditor from '../components/RecipeEditor'
import AISheet from '../components/AISheet'
import Combos from './Combos'

type View = 'suggest' | 'library' | 'combos'

export default function Recipes({ onOpenSettings }: { onOpenSettings: () => void }) {
  const stock = useKitchen()
  const recipes = useRecipes()
  const [view, setView] = useState<View>('suggest')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Recipe | null>(null)
  const [editing, setEditing] = useState<Recipe | null | 'new'>(null)
  const [askingAI, setAskingAI] = useState(false)

  const ranked = useMemo(
    () => (recipes && stock ? rankRecipes(recipes, stock) : []),
    [recipes, stock],
  )

  const bands = useMemo(() => {
    const groups: Record<string, Suggestion[]> = { ready: [], close: [], shop: [] }
    for (const s of ranked) groups[bandOf(s)].push(s)
    return groups
  }, [ranked])

  const library = useMemo(() => {
    if (!recipes) return []
    const q = query.trim().toLowerCase()
    const list = q
      ? recipes.filter((r) => r.title.toLowerCase().includes(q) || r.tags.some((t) => t.includes(q)) || r.ingredients.some((i) => i.name.toLowerCase().includes(q)))
      : recipes
    return [...list].sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.title.localeCompare(b.title))
  }, [recipes, query])

  if (!stock || !recipes) return null

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Recipes</h1>
          <div className="sub">
            {bands.ready.length > 0
              ? `${bands.ready.length} you can cook right now`
              : `${recipes.length} in your collection`}
          </div>
        </div>
        <button className="btn ghost sm" onClick={() => setAskingAI(true)}>✨ Ask AI</button>
      </div>

      <div className="section">
        <Seg
          value={view}
          onChange={setView}
          options={[
            { value: 'suggest' as View, label: 'What can I cook?' },
            { value: 'library' as View, label: 'My recipes' },
            { value: 'combos' as View, label: 'Combos' },
          ]}
        />
      </div>

      {view === 'combos' ? (
        <Combos stock={stock} />
      ) : view === 'suggest' ? (
        recipes.length === 0 ? (
          <div className="section">
            <Empty emoji="🍳" title="No recipes yet">
              Add a few of your own, or let Claude suggest some from what's in the kitchen.
            </Empty>
          </div>
        ) : (
          (['ready', 'close', 'shop'] as const).map((band) =>
            bands[band].length === 0 ? null : (
              <Section key={band} title={BAND_META[band].label} hint={BAND_META[band].blurb}>
                <div className="stack auto-cols">
                  {bands[band].slice(0, band === 'shop' ? 4 : 12).map((s, i) => (
                    <SuggestionRow key={s.recipe.id} s={s} index={i} onClick={() => setOpen(s.recipe)} />
                  ))}
                </div>
              </Section>
            ),
          )
        )
      ) : (
        <>
          <div className="section">
            <div className="search">
              <span className="icon">🔍</span>
              <input type="search" placeholder="Search recipes and ingredients…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
          <div className="section">
            {library.length === 0 ? (
              <Empty emoji="📖" title="Nothing here yet">Tap + to write your first recipe.</Empty>
            ) : (
              <div className="stack auto-cols">
                {library.map((r, i) => (
                  <button key={r.id} className="item" style={{ animationDelay: `${Math.min(i, 10) * 22}ms` }} onClick={() => setOpen(r)}>
                    <span style={{ fontSize: 25, flex: 'none', width: 40, textAlign: 'center' }}>{r.emoji}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="name">{r.favorite && '★ '}{r.title}</div>
                      <div className="meta">
                        <span>{r.prepMin + r.cookMin} min</span>
                        <span>·</span>
                        <span>{r.servings} servings</span>
                        {r.timesCooked > 0 && <><span>·</span><span>cooked {r.timesCooked}×</span></>}
                        {r.source === 'ai' && <span className="chip tone-hold"><span className="dot" />AI</span>}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Combinations have their own New button, and this one makes a recipe —
          leaving it up would both overlap the list and do the wrong thing. */}
      {view !== 'combos' && (
        <button className="fab" onClick={() => setEditing('new')} aria-label="New recipe">+</button>
      )}

      {open && (
        <RecipeSheet
          recipe={open}
          stock={stock}
          onClose={() => setOpen(null)}
          onEdit={() => { setEditing(open); setOpen(null) }}
        />
      )}
      {editing && (
        <RecipeEditor
          recipe={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {askingAI && (
        <AISheet stock={stock} onClose={() => setAskingAI(false)} onOpenSettings={onOpenSettings} />
      )}
    </>
  )
}

function SuggestionRow({ s, index, onClick }: { s: Suggestion; index: number; onClick: () => void }) {
  const pct = Math.round(s.coverage * 100)
  const gaps = [...s.missing, ...s.blocked]

  return (
    <button className="item" onClick={onClick} style={{ alignItems: 'flex-start', animationDelay: `${Math.min(index, 10) * 24}ms` }}>
      <span style={{ fontSize: 25, flex: 'none', width: 40, textAlign: 'center', marginTop: 2 }}>{s.recipe.emoji}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="name">{s.recipe.title}</div>
        <div className="meta">
          <span>{s.recipe.prepMin + s.recipe.cookMin} min</span>
          {s.rescues.length > 0 && (
            <span className="chip tone-urgent"><span className="dot" />rescues {s.rescues[0].name}{s.rescues.length > 1 ? ` +${s.rescues.length - 1}` : ''}</span>
          )}
          {s.blocked.length > 0 && (
            <span className="chip tone-hold"><span className="dot" />{s.blocked.length} reserved elsewhere</span>
          )}
        </div>

        <div className="row" style={{ gap: 9, marginTop: 8 }}>
          <div className="meter" style={{ flex: 1 }}>
            <span style={{ width: `${Math.max(3, pct)}%` }} />
          </div>
          <span className="tabular" style={{ fontSize: 11.5, fontWeight: 700, color: pct === 100 ? 'var(--fresh-fresh)' : 'var(--text-mute)' }}>
            {pct}%
          </span>
        </div>

        {gaps.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 6 }}>
            Short on {gaps.slice(0, 3).map((g) => g.ingredient.name).join(', ')}
            {gaps.length > 3 && ` +${gaps.length - 3} more`}
          </div>
        )}
      </div>
    </button>
  )
}
