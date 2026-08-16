import { useState } from 'react'
import { Seg } from '../components/ui'
import Calendar from './Calendar'
import Plan from './Plan'
import Reserved from './Reserved'

/**
 * One tab, three ways of looking at what's coming.
 *
 * Month answers "how many dinners have I got?" — coverage from stock, plus what
 * was actually eaten. Week answers "what am I cooking Thursday?" — recipes on a
 * schedule, holding their ingredients. Set aside answers "what's already
 * claimed, and by whom?", which is the one view that cuts across the kitchen
 * rather than down it.
 *
 * They share a surface but not a model: the month view deliberately reserves
 * nothing, because a forecast that made food unavailable would be wrong. This
 * merges the chrome and frees a nav slot; the models are still separate.
 */

type View = 'month' | 'week' | 'reserved'

const VIEW_KEY = 'larder-plan-view'

function readView(): View {
  // An old #calendar link should still land on the calendar.
  if (window.location.hash.replace('#', '') === 'calendar') return 'month'
  try {
    const saved = localStorage.getItem(VIEW_KEY)
    return saved === 'week' || saved === 'reserved' ? saved : 'month'
  } catch {
    return 'month'
  }
}

export default function Planning() {
  const [view, setView] = useState<View>(readView)

  function choose(next: View) {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // Not persisting is survivable — the session still respects the choice.
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Plan</h1>
          <div className="sub">
            {view === 'month'
              ? 'How far the food goes, and what you ate'
              : view === 'week'
                ? 'Recipes on the week, ingredients held'
                : "What's spoken for, and who for"}
          </div>
        </div>
      </div>

      <div className="section">
        <Seg
          value={view}
          onChange={choose}
          options={[
            { value: 'month' as View, label: '🗓️ Month' },
            { value: 'week' as View, label: '📅 Week' },
            { value: 'reserved' as View, label: '🔒 Set aside' },
          ]}
        />
      </div>

      {view === 'month' ? <Calendar /> : view === 'week' ? <Plan /> : <Reserved />}
    </>
  )
}
