import type { MealSlot } from '../db/schema'
import { SLOTS } from '../lib/plan'

/**
 * Meal category and main-dish marker, shared by the add and edit sheets so the
 * two can't drift.
 *
 * The meal is single-select: an item belongs to one eating occasion, or to
 * none — most things (flour, soy sauce) aren't meal-specific. Tapping the
 * active chip clears it.
 *
 * Main dish is secondary and only meaningful on breakfast, lunch or dinner. A
 * snack is a whole occasion with no centrepiece, so selecting it clears and
 * disables the marker rather than leaving an unreachable state.
 */
export const MAIN_ALLOWED: MealSlot[] = ['breakfast', 'lunch', 'dinner']

export function mainAllowedFor(meal: MealSlot | undefined): boolean {
  return meal != null && MAIN_ALLOWED.includes(meal)
}

export default function MealTags({
  meal, isMain, onChange,
}: {
  meal: MealSlot | undefined
  isMain: boolean
  onChange: (next: { meal: MealSlot | undefined; isMain: boolean }) => void
}) {
  const canBeMain = mainAllowedFor(meal)

  const pickMeal = (slot: MealSlot) => {
    const next = meal === slot ? undefined : slot
    // Clear the marker whenever it stops being applicable.
    onChange({ meal: next, isMain: mainAllowedFor(next) ? isMain : false })
  }

  return (
    <div className="field">
      <label>Meal</label>
      <div className="tag-row">
        {SLOTS.map((slot) => (
          <button
            key={slot.key}
            type="button"
            className={`chip toggle${meal === slot.key ? ' on' : ''}`}
            aria-pressed={meal === slot.key}
            onClick={() => pickMeal(slot.key)}
          >
            {slot.emoji} {slot.label}
          </button>
        ))}
      </div>

      <div className="tag-row" style={{ marginTop: 8 }}>
        <button
          type="button"
          className={`chip toggle is-main${isMain && canBeMain ? ' on' : ''}`}
          aria-pressed={isMain && canBeMain}
          disabled={!canBeMain}
          title={canBeMain ? undefined : 'Pick breakfast, lunch or dinner first'}
          onClick={() => onChange({ meal, isMain: !isMain })}
        >
          ⭐ Main dish
        </button>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 6 }}>
        {meal === 'snack'
          ? "Snacks don't have a main dish."
          : canBeMain
            ? 'Mark this if it’s the centrepiece rather than a component.'
            : 'Pick a meal to mark this as a main dish. Both are optional — leave them off for anything that isn’t meal-specific.'}
      </p>
    </div>
  )
}
