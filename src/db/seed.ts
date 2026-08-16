import { db, getSetting, setSetting } from './db'
import type { Category, Item, LedgerEvent, Recipe, StorageLocation, Unit } from './schema'
import { addDays, startOfWeek, todayISO } from '../lib/dates'
import { DEFAULT_PLACES, ensurePlaces } from '../lib/locations'
import { DEFAULT_CATEGORIES, ensureCategories } from '../lib/categories'

/**
 * A believable kitchen so every screen has something to show on first run.
 * Runs once; "Reset demo data" in Settings replays it.
 */

type SeedItem = [name: string, category: Category, location: StorageLocation, qty: number, unit: Unit, price: number, expiresInDays: number | null, staple?: number]

const PANTRY: SeedItem[] = [
  // Fridge — the urgency lives here
  ['Baby spinach', 'produce', 'fridge', 1, 'pkg', 3.99, 1],
  ['Cherry tomatoes', 'produce', 'fridge', 1, 'pkg', 4.49, 3],
  ['Chicken thighs', 'protein', 'fridge', 1.8, 'lb', 8.62, 2],
  ['Greek yogurt', 'dairy', 'fridge', 32, 'oz', 6.29, 9],
  ['Eggs', 'dairy', 'fridge', 8, 'ea', 5.49, 16, 12],
  ['Whole milk', 'dairy', 'fridge', 0.5, 'gal', 4.19, 6, 1],
  ['Cheddar', 'dairy', 'fridge', 8, 'oz', 5.99, 24],
  ['Parmesan', 'dairy', 'fridge', 6, 'oz', 8.49, 45],
  ['Scallions', 'produce', 'fridge', 1, 'bunch', 1.29, 5],
  ['Carrots', 'produce', 'fridge', 1.5, 'lb', 2.19, 18],
  ['Celery', 'produce', 'fridge', 1, 'bunch', 2.49, 11],
  ['Lemons', 'produce', 'fridge', 3, 'ea', 2.07, 14],
  ['Butter', 'dairy', 'fridge', 8, 'oz', 4.79, 40, 8],
  ['Soy sauce', 'condiment', 'fridge', 15, 'floz', 3.99, 300],
  ['Sriracha', 'condiment', 'fridge', 17, 'floz', 4.29, 300],
  ['Miso paste', 'condiment', 'fridge', 14, 'oz', 6.99, 180],

  // Freezer
  ['Frozen peas', 'frozen', 'freezer', 1, 'pkg', 2.29, 150],
  ['Salmon fillets', 'protein', 'freezer', 2, 'ea', 13.98, 120],
  ['Ground beef', 'protein', 'freezer', 1, 'lb', 7.49, 110],
  ['Frozen berries', 'frozen', 'freezer', 1, 'pkg', 5.49, 160],

  // Pantry
  ['Spaghetti', 'grain', 'pantry', 2, 'lb', 3.58, 400, 2],
  ['Jasmine rice', 'grain', 'pantry', 4, 'lb', 6.99, 500, 3],
  ['Rolled oats', 'grain', 'pantry', 2, 'lb', 4.29, 300, 2],
  ['Chickpeas', 'canned', 'pantry', 3, 'can', 3.27, 700, 4],
  ['Crushed tomatoes', 'canned', 'pantry', 2, 'can', 3.98, 650, 3],
  ['Coconut milk', 'canned', 'pantry', 2, 'can', 4.58, 600],
  ['Chicken broth', 'canned', 'pantry', 1, 'qt', 3.49, 400, 2],
  ['Peanut butter', 'condiment', 'pantry', 16, 'oz', 4.99, 250],
  ['Yellow onions', 'produce', 'pantry', 4, 'ea', 3.16, 25, 4],
  ['Garlic', 'produce', 'pantry', 2, 'head', 1.58, 30, 2],
  ['Russet potatoes', 'produce', 'pantry', 3, 'lb', 4.29, 21],

  // Counter
  ['Sourdough loaf', 'bakery', 'counter', 1, 'loaf', 5.99, 2],
  ['Bananas', 'produce', 'counter', 5, 'ea', 2.15, 4],
  ['Avocados', 'produce', 'counter', 2, 'ea', 3.98, 3],

  // Spice rack
  ['Olive oil', 'spice', 'spice', 25, 'floz', 12.99, 400, 8],
  ['Cumin', 'spice', 'spice', 2, 'oz', 3.49, 600],
  ['Smoked paprika', 'spice', 'spice', 2, 'oz', 4.29, 600],
  ['Red pepper flakes', 'spice', 'spice', 1.5, 'oz', 2.99, 600],
  ['Curry powder', 'spice', 'spice', 2, 'oz', 4.49, 600],
]

const RECIPES: Array<Omit<Recipe, 'id'>> = [
  {
    title: 'Garlic butter chicken & rice',
    emoji: '🍗',
    description: 'One pan, thirty-five minutes, always disappears.',
    servings: 4, prepMin: 10, cookMin: 25,
    tags: ['weeknight', 'one-pan'],
    ingredients: [
      { name: 'chicken thighs', qty: 1.5, unit: 'lb' },
      { name: 'jasmine rice', qty: 1.5, unit: 'cup' },
      { name: 'chicken broth', qty: 3, unit: 'cup' },
      { name: 'garlic', qty: 5, unit: 'clove' },
      { name: 'butter', qty: 3, unit: 'tbsp' },
      { name: 'yellow onion', qty: 1, unit: 'ea' },
      { name: 'scallions', qty: 2, unit: 'ea', optional: true },
      { name: 'salt', optional: true },
    ],
    steps: [
      'Pat the thighs dry and season both sides generously with salt and paprika.',
      'Sear skin-side down in a wide oven-safe pan over medium-high, 6–7 minutes, until the skin releases cleanly. Flip, give it 2 minutes, then set aside.',
      'Drop the heat to medium. Melt the butter in the rendered fat and soften the diced onion for 4 minutes, then add the sliced garlic for 30 seconds.',
      'Stir in the rice until every grain is glossy, pour in the hot broth, and nestle the chicken back on top.',
      'Cover and bake at 400°F for 20 minutes, then rest 5 minutes off the heat before scattering scallions over the top.',
    ],
    favorite: true, source: 'custom', createdAt: addDays(todayISO(), -60), timesCooked: 6,
    lastCookedAt: addDays(todayISO(), -12),
  },
  {
    title: 'Spinach & chickpea curry',
    emoji: '🍛',
    description: 'Pantry curry that rescues whatever greens are on their last day.',
    servings: 4, prepMin: 8, cookMin: 22,
    tags: ['vegetarian', 'pantry', 'freezes well'],
    ingredients: [
      { name: 'chickpeas', qty: 2, unit: 'can' },
      { name: 'coconut milk', qty: 1, unit: 'can' },
      { name: 'baby spinach', qty: 1, unit: 'pkg' },
      { name: 'crushed tomatoes', qty: 1, unit: 'can' },
      { name: 'yellow onion', qty: 1, unit: 'ea' },
      { name: 'garlic', qty: 3, unit: 'clove' },
      { name: 'curry powder', qty: 2, unit: 'tbsp' },
      { name: 'cumin', qty: 1, unit: 'tsp' },
      { name: 'jasmine rice', qty: 1.5, unit: 'cup', optional: true },
    ],
    steps: [
      'Soften the diced onion in oil over medium heat for 5 minutes, then add garlic, curry powder and cumin and toast for a minute until fragrant.',
      'Add the crushed tomatoes and cook them down for 5 minutes so they lose their raw edge.',
      'Pour in the coconut milk and drained chickpeas, then simmer uncovered for 10 minutes.',
      'Fold in the spinach a handful at a time until it collapses. Season and serve over rice.',
    ],
    favorite: true, source: 'custom', createdAt: addDays(todayISO(), -45), timesCooked: 4,
    lastCookedAt: addDays(todayISO(), -8),
  },
  {
    title: 'Cacio e pepe, loosely',
    emoji: '🍝',
    description: 'Four ingredients. The only hard part is the emulsion.',
    servings: 2, prepMin: 2, cookMin: 12,
    tags: ['fast', 'vegetarian'],
    ingredients: [
      { name: 'spaghetti', qty: 8, unit: 'oz' },
      { name: 'parmesan', qty: 3, unit: 'oz' },
      { name: 'butter', qty: 2, unit: 'tbsp' },
      { name: 'black pepper', optional: true },
    ],
    steps: [
      'Boil the pasta in aggressively under-filled, well-salted water so the starch concentrates.',
      'Toast a heavy grind of pepper in the butter in a cold-ish pan while the pasta cooks.',
      'Move the pasta over two minutes early with a good splash of its water, then toss hard.',
      'Off the heat, rain in the parmesan while tossing constantly until it turns glossy rather than stringy.',
    ],
    favorite: false, source: 'custom', createdAt: addDays(todayISO(), -30), timesCooked: 9,
    lastCookedAt: addDays(todayISO(), -4),
  },
  {
    title: 'Miso salmon with peas',
    emoji: '🐟',
    description: 'Freezer to plate in twenty-five minutes.',
    servings: 2, prepMin: 5, cookMin: 18,
    tags: ['fast', 'freezer'],
    ingredients: [
      { name: 'salmon fillets', qty: 2, unit: 'ea' },
      { name: 'miso paste', qty: 2, unit: 'tbsp' },
      { name: 'soy sauce', qty: 1, unit: 'tbsp' },
      { name: 'frozen peas', qty: 1, unit: 'cup' },
      { name: 'jasmine rice', qty: 1, unit: 'cup' },
      { name: 'scallions', qty: 2, unit: 'ea' },
    ],
    steps: [
      'Whisk the miso and soy into a loose paste and smear it over the thawed fillets.',
      'Roast at 425°F for 11–13 minutes, until the thickest part flakes with light pressure.',
      'Simmer the peas for 3 minutes and stir them through the cooked rice with the sliced scallions.',
    ],
    favorite: false, source: 'custom', createdAt: addDays(todayISO(), -22), timesCooked: 3,
    lastCookedAt: addDays(todayISO(), -15),
  },
  {
    title: 'Everything-in-it fried rice',
    emoji: '🍚',
    description: 'The designated leftover eliminator. Works with almost anything.',
    servings: 3, prepMin: 10, cookMin: 12,
    tags: ['leftovers', 'fast'],
    ingredients: [
      { name: 'jasmine rice', qty: 3, unit: 'cup' },
      { name: 'eggs', qty: 3, unit: 'ea' },
      { name: 'frozen peas', qty: 1, unit: 'cup' },
      { name: 'carrots', qty: 2, unit: 'ea' },
      { name: 'scallions', qty: 3, unit: 'ea' },
      { name: 'soy sauce', qty: 3, unit: 'tbsp' },
      { name: 'garlic', qty: 2, unit: 'clove' },
    ],
    steps: [
      'Use rice that has been chilled overnight — fresh rice steams instead of frying.',
      'Scramble the eggs hard and fast in a screaming-hot wok, then pull them out.',
      'Fry the diced carrot and garlic for 2 minutes, add the rice, and press it flat so it catches.',
      'Return the eggs with the peas and soy, toss for another minute, and finish with scallions.',
    ],
    favorite: false, source: 'custom', createdAt: addDays(todayISO(), -18), timesCooked: 7,
    lastCookedAt: addDays(todayISO(), -6),
  },
  {
    title: 'Tomato & white bean soup',
    emoji: '🥣',
    description: 'Entirely from the pantry when the fridge is bare.',
    servings: 4, prepMin: 6, cookMin: 25,
    tags: ['pantry', 'vegetarian', 'freezes well'],
    ingredients: [
      { name: 'crushed tomatoes', qty: 2, unit: 'can' },
      { name: 'chickpeas', qty: 1, unit: 'can' },
      { name: 'chicken broth', qty: 2, unit: 'cup' },
      { name: 'yellow onion', qty: 1, unit: 'ea' },
      { name: 'celery', qty: 2, unit: 'ea' },
      { name: 'garlic', qty: 3, unit: 'clove' },
      { name: 'smoked paprika', qty: 1, unit: 'tsp' },
    ],
    steps: [
      'Sweat the onion and celery in oil for 8 minutes without browning.',
      'Add the garlic and paprika, then the tomatoes and broth, and simmer 15 minutes.',
      'Add the beans for the last 5 minutes and blend half the pot so it thickens without losing texture.',
    ],
    favorite: false, source: 'custom', createdAt: addDays(todayISO(), -40), timesCooked: 5,
    lastCookedAt: addDays(todayISO(), -20),
  },
  {
    title: 'Banana oat pancakes',
    emoji: '🥞',
    description: 'What the over-ripe bananas are for.',
    servings: 2, prepMin: 5, cookMin: 12,
    tags: ['breakfast', 'uses up'],
    ingredients: [
      { name: 'bananas', qty: 2, unit: 'ea' },
      { name: 'rolled oats', qty: 1, unit: 'cup' },
      { name: 'eggs', qty: 2, unit: 'ea' },
      { name: 'whole milk', qty: 0.5, unit: 'cup' },
      { name: 'butter', qty: 1, unit: 'tbsp' },
    ],
    steps: [
      'Blitz the oats to a coarse flour, then blend in the bananas, eggs and milk until just smooth.',
      'Rest the batter 5 minutes so the oats hydrate and it thickens.',
      'Cook in butter over medium-low — these brown faster than wheat pancakes, so give them room.',
    ],
    favorite: true, source: 'custom', createdAt: addDays(todayISO(), -14), timesCooked: 4,
    lastCookedAt: addDays(todayISO(), -3),
  },
  {
    title: 'Smashed potatoes with yogurt',
    emoji: '🥔',
    description: 'Side dish that keeps getting promoted to dinner.',
    servings: 3, prepMin: 5, cookMin: 45,
    tags: ['vegetarian'],
    ingredients: [
      { name: 'russet potatoes', qty: 2, unit: 'lb' },
      { name: 'greek yogurt', qty: 1, unit: 'cup' },
      { name: 'olive oil', qty: 3, unit: 'tbsp' },
      { name: 'garlic', qty: 2, unit: 'clove' },
      { name: 'lemons', qty: 1, unit: 'ea' },
      { name: 'red pepper flakes', qty: 0.5, unit: 'tsp' },
    ],
    steps: [
      'Boil the potatoes whole until a knife slides in with no resistance, then drain and dry them for 5 minutes.',
      'Smash each one flat on an oiled tray and roast at 450°F for 30 minutes, turning once.',
      'Stir grated garlic and lemon juice into the yogurt and spoon it under the potatoes so they stay crisp.',
    ],
    favorite: false, source: 'custom', createdAt: addDays(todayISO(), -10), timesCooked: 2,
    lastCookedAt: addDays(todayISO(), -10),
  },
]

/** Three months of plausible shopping and eating, so Insights isn't empty. */
function buildHistory(): { trips: Array<{ date: string; store: string; total: number; itemCount: number }>; events: LedgerEvent[] } {
  const trips: Array<{ date: string; store: string; total: number; itemCount: number }> = []
  const events: LedgerEvent[] = []
  const stores = ['Trader Joes', 'Safeway', 'Corner Market', 'Costco']

  // Deterministic pseudo-random so the demo looks the same every reset.
  let seed = 42
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }

  const cats: Category[] = ['produce', 'protein', 'dairy', 'grain', 'canned', 'bakery', 'frozen', 'condiment']
  const names: Record<Category, string[]> = {
    produce: ['Spinach', 'Tomatoes', 'Bell peppers', 'Bananas', 'Salad mix', 'Cucumber', 'Broccoli'],
    protein: ['Chicken breast', 'Ground beef', 'Salmon', 'Bacon', 'Tofu'],
    dairy: ['Whole milk', 'Greek yogurt', 'Cheddar', 'Eggs', 'Cream'],
    grain: ['Spaghetti', 'Jasmine rice', 'Rolled oats', 'Tortillas'],
    canned: ['Crushed tomatoes', 'Chickpeas', 'Coconut milk', 'Black beans'],
    bakery: ['Sourdough loaf', 'Bagels', 'Brioche buns'],
    frozen: ['Frozen peas', 'Frozen berries', 'Ice cream'],
    condiment: ['Olive oil', 'Soy sauce', 'Peanut butter', 'Salsa'],
    spice: ['Cumin', 'Paprika'],
    snack: ['Tortilla chips', 'Almonds'],
    beverage: ['Cold brew', 'Sparkling water'],
    other: ['Paper towels'],
  }

  // Trips get gradually further apart — the behaviour change the app is for.
  let cursor = addDays(todayISO(), -98)
  let gapBase = 4
  while (cursor < addDays(todayISO(), -2)) {
    const store = stores[Math.floor(rand() * stores.length)]
    const lineCount = 7 + Math.floor(rand() * 9)
    let total = 0

    for (let i = 0; i < lineCount; i++) {
      const category = cats[Math.floor(rand() * cats.length)]
      const pool = names[category]
      const name = pool[Math.floor(rand() * pool.length)]
      const value = Math.round((2 + rand() * 12) * 100) / 100
      total += value
      events.push({ type: 'purchase', name, category, qty: 1, unit: 'ea', value, date: cursor })

      // Most of it gets eaten a few days later; a slice of it doesn't.
      const eatenDate = addDays(cursor, 1 + Math.floor(rand() * 6))
      const wasteChance = category === 'produce' ? 0.24 : category === 'dairy' ? 0.12 : 0.05
      if (rand() < wasteChance) {
        const wasted = Math.round(value * (0.3 + rand() * 0.6) * 100) / 100
        events.push({
          type: 'waste', name, category, qty: 1, unit: 'ea', value: wasted,
          date: addDays(cursor, 6 + Math.floor(rand() * 8)),
          reason: rand() < 0.6 ? 'Went off before we got to it' : 'Forgot it was in there',
        })
        events.push({ type: 'consume', name, category, qty: 1, unit: 'ea', value: Math.round((value - wasted) * 100) / 100, date: eatenDate })
      } else {
        events.push({ type: 'consume', name, category, qty: 1, unit: 'ea', value, date: eatenDate })
      }
    }

    trips.push({ date: cursor, store, total: Math.round(total * 100) / 100, itemCount: lineCount })
    gapBase = Math.min(9, gapBase + 0.35)
    cursor = addDays(cursor, Math.max(2, Math.round(gapBase + (rand() * 3 - 1.5))))
  }

  return { trips, events }
}

/**
 * Guards against a second call landing while the first is still running —
 * React's StrictMode double-invokes effects in development, and two concurrent
 * seeds would both pass the flag check and double up the demo data.
 */
let inFlight: Promise<void> | null = null

export async function seedIfEmpty(): Promise<void> {
  // Locations and categories exist independently of the demo data: an upgrading
  // install keeps all its items but starts with those tables empty.
  await ensurePlaces()
  await ensureCategories()
  if (inFlight) return inFlight
  if ((await getSetting('seeded')) === '1') return
  inFlight = runSeed().finally(() => { inFlight = null })
  return inFlight
}

export async function runSeed(): Promise<void> {
  const today = todayISO()

  await db.transaction('rw', [db.items, db.recipes, db.plan, db.shop, db.trips, db.events, db.reservations, db.settings, db.photos, db.places, db.cats], async () => {
    await Promise.all([
      db.items.clear(), db.recipes.clear(), db.plan.clear(), db.shop.clear(),
      db.trips.clear(), db.events.clear(), db.reservations.clear(), db.photos.clear(),
      db.places.clear(), db.cats.clear(),
    ])
    // The demo kitchen assumes the default locations and categories exist.
    await db.places.bulkAdd(DEFAULT_PLACES as never[])
    await db.cats.bulkAdd(DEFAULT_CATEGORIES as never[])

    const items: Item[] = PANTRY.map(([name, category, location, qty, unit, price, expires, par]) => ({
      name, category, location, qty, qtyInitial: qty, unit, price,
      purchasedAt: addDays(today, -Math.min(10, Math.max(1, Math.round((expires ?? 30) / 6)))),
      expiresAt: expires == null ? undefined : addDays(today, expires),
      isStaple: par != null,
      parQty: par,
      archived: false,
    }))
    await db.items.bulkAdd(items)
    await db.recipes.bulkAdd(RECIPES as Recipe[])

    const { trips, events } = buildHistory()
    await db.trips.bulkAdd(trips)
    await db.events.bulkAdd(events)

    // A couple of meals already on the calendar this week.
    const recipeIds = await db.recipes.toArray()
    const monday = startOfWeek(today)
    const curry = recipeIds.find((r) => r.title.includes('curry'))
    const chicken = recipeIds.find((r) => r.title.includes('chicken & rice'))

    let curryPlanId: number | undefined
    if (curry?.id) {
      curryPlanId = await db.plan.add({ date: addDays(monday, 2), slot: 'dinner', recipeId: curry.id, title: curry.title, servings: 4, status: 'planned' })
    }
    if (chicken?.id) {
      await db.plan.add({ date: addDays(monday, 4), slot: 'dinner', recipeId: chicken.id, title: chicken.title, servings: 4, status: 'planned' })
    }

    // Hold back what the curry needs, so "reserved" is visible from the start.
    // Inside the transaction, so a re-seed can never leave orphaned holds behind.
    if (curryPlanId && curry) {
      const stocked = await db.items.toArray()
      const holds: Array<[string, number]> = [['Baby spinach', 1], ['Chickpeas', 2]]
      for (const [name, qty] of holds) {
        const item = stocked.find((i) => i.name === name)
        if (!item?.id) continue
        await db.reservations.add({
          itemId: item.id,
          qty: Math.min(qty, item.qty),
          planId: curryPlanId,
          label: curry.title,
          createdAt: today,
        })
      }
    }

    await db.settings.put({ key: 'seeded', value: '1' })
  })

  await setSetting('seeded', '1')
}
