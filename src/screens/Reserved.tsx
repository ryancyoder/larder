import { useMemo, useState } from 'react'
import type { ItemView, Person, Reservation } from '../db/schema'
import { useKitchen, usePeople } from '../app/data'
import { personLabel } from '../lib/people'
import { releaseHold } from '../lib/inventory'
import { formatAmount } from '../lib/units'
import { categoryMeta } from '../lib/categories'
import { Empty, Section } from '../components/ui'
import { useToast } from '../app/toast'

/**
 * Everything currently spoken for, and who for.
 *
 * Holds are scattered across the kitchen by definition — one on the cheese, one
 * on the salmon — so the only place you can see the whole picture is a list
 * that ignores where things live and groups by who they're for instead.
 */

interface Held {
  item: ItemView
  hold: Reservation
}

export default function Reserved() {
  const stock = useKitchen()
  const people = usePeople()
  const toast = useToast()
  const [who, setWho] = useState<string>('all')

  const all = useMemo<Held[]>(
    () => (stock ?? []).flatMap((item) => item.holds.map((hold) => ({ item, hold }))),
    [stock],
  )

  const shown = useMemo(
    () => all.filter((h) => who === 'all' || (h.hold.personKey ?? '') === who),
    [all, who],
  )

  // Only offer a filter for someone who actually has something set aside —
  // a row of names that all lead to an empty list is just noise.
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const h of all) map.set(h.hold.personKey ?? '', (map.get(h.hold.personKey ?? '') ?? 0) + 1)
    return map
  }, [all])

  if (!stock || !people) return null

  const withHolds = people.filter((p) => counts.has(p.key))
  const untagged = counts.get('') ?? 0

  async function release(h: Held) {
    await releaseHold(h.hold.id!)
    toast(`${h.item.name} released`)
  }

  return (
    <>
      {all.length === 0 ? (
        <Section title="Set aside">
          <Empty emoji="🔒" title="Nothing is spoken for">
            Reserve something from its tile or its item sheet and it shows up here, under whoever
            it's for. Planning a recipe holds its ingredients too.
          </Empty>
        </Section>
      ) : (
        <>
          <section className="section">
            <div className="tag-row">
              <button
                className={`chip toggle${who === 'all' ? ' on' : ''}`}
                onClick={() => setWho('all')}
              >
                Everyone ({all.length})
              </button>
              {withHolds.map((p) => (
                <button
                  key={p.key}
                  className={`chip toggle${who === p.key ? ' on' : ''}`}
                  onClick={() => setWho(p.key)}
                >
                  {p.emoji} {p.name} ({counts.get(p.key)})
                </button>
              ))}
              {untagged > 0 && (
                <button
                  className={`chip toggle${who === '' ? ' on' : ''}`}
                  onClick={() => setWho('')}
                >
                  Unassigned ({untagged})
                </button>
              )}
            </div>
          </section>

          <Section
            title={who === 'all' ? 'Set aside' : `Set aside for ${personLabel(people, who || undefined)}`}
            hint={`${shown.length} ${shown.length === 1 ? 'hold' : 'holds'}`}
          >
            <div className="stack auto-cols">
              {shown.map((h) => (
                <HeldRow key={h.hold.id} held={h} people={people} onRelease={() => release(h)} />
              ))}
            </div>
          </Section>
        </>
      )}
    </>
  )
}

function HeldRow({ held, people, onRelease }: { held: Held; people: Person[]; onRelease: () => void }) {
  const { item, hold } = held
  const meta = categoryMeta(item.category)
  const person = people.find((p) => p.key === hold.personKey)

  return (
    <div className="item">
      <span style={{ fontSize: 20, flex: 'none' }} aria-hidden>{meta.emoji}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="name">{item.displayName}</div>
        <div className="meta">
          <span
            className="cat-dot"
            style={{ background: person ? `var(--cat-${person.hue})` : 'var(--text-mute)' }}
            aria-hidden
          />
          <span>{personLabel(people, hold.personKey)}</span>
          {hold.label && hold.label !== 'Set aside' && hold.label !== 'Saved for later' && (
            <><span>·</span><span>{hold.label}</span></>
          )}
          {hold.planId != null && <><span>·</span><span>from the meal plan</span></>}
        </div>
      </div>
      <div className="qty" style={{ marginRight: 8 }}>{formatAmount(hold.qty, item.unit)}</div>
      <button className="btn ghost sm" onClick={onRelease}>Release</button>
    </div>
  )
}
