import type { MealSlot } from '../db/schema'
import { SLOTS } from '../lib/plan'

/**
 * Meal tagging, shared by the add and edit sheets so the two can't drift.
 *
 * The slots are the planner's own, not a parallel list — tagging the pantry
 * with the same vocabulary you plan in is the whole point.
 */
export default function MealTags({
  meals, isMain, onChange,
}: {
  meals: MealSlot[]
  isMain: boolean
  onChange: (next: { meals: MealSlot[]; isMain: boolean }) => void
}) {
  const toggleMeal = (slot: MealSlot) => {
    const next = meals.includes(slot) ? meals.filter((m) => m !== slot) : [...meals, slot]
    onChange({ meals: next, isMain })
  }

  return (
    <div className="field">
      <label>Meals & role</label>
      <div className="tag-row">
        {SLOTS.map((slot) => (
          <button
            key={slot.key}
            type="button"
            className={`chip toggle${meals.includes(slot.key) ? ' on' : ''}`}
            aria-pressed={meals.includes(slot.key)}
            onClick={() => toggleMeal(slot.key)}
          >
            {slot.emoji} {slot.label}
          </button>
        ))}
        <button
          type="button"
          className={`chip toggle is-main${isMain ? ' on' : ''}`}
          aria-pressed={isMain}
          onClick={() => onChange({ meals, isMain: !isMain })}
        >
          ⭐ Main dish
        </button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 6 }}>
        Optional. Tagging lets you filter the kitchen by meal — handy for checking you're
        actually stocked for breakfasts, or counting how many mains you have left.
      </p>
    </div>
  )
}
