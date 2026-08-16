import { useState } from 'react'
import { Seg } from '../components/ui'
import Calendar from './Calendar'
import Plan from './Plan'

/**
 * One tab, two ways of looking at the same question.
 *
 * Month answers "how many dinners have I got?" — coverage from stock, plus
 * what was actually eaten. Week answers "what am I cooking Thursday?" — recipes
 * on a schedule, holding their ingredients.
 *
 * They share a surface but not a model: the month view deliberately reserves
 * nothing, because a forecast that made food unavailable would be wrong. This
 * merges the chrome and frees a nav slot; the two are still separate underneath.
 */

type View = 'month' | 'week'

const VIEW_KEY = 'larder-plan-view'

function readView(): View {
  // An old #calendar link should still land on the calendar.
  if (window.location.hash.replace('#', '') === 'calendar') return 'month'
  try {
    return localStorage.getItem(VIEW_KEY) === 'week' ? 'week' : 'month'
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
              : 'Recipes on the week, ingredients held'}
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
          ]}
        />
      </div>

      {view === 'month' ? <Calendar /> : <Plan />}
    </>
  )
}
