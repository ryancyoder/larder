# Larder

A kitchen-inventory app: what's in the fridge, freezer and pantry, what's about to go off,
what's already spoken for, what to cook, what to buy, and what all of it costs you.

Runs entirely in the browser. React + Vite + TypeScript, IndexedDB for storage, installable
as a PWA from your phone's share menu.

```bash
npm install
npm run dev      # http://localhost:5180
npm run build    # typecheck + production bundle into dist/
```

First launch seeds a realistic demo kitchen — 39 items, 8 recipes, and three months of
shopping history — so every screen has something to show. Settings → *Reset to demo data*
replays it; wiping your browser data starts you empty.

## The five screens

**Kitchen** — everything you own, grouped by where it lives. Each item carries a freshness
ring that empties as its shelf life runs down, and an *Eat me first* strip surfaces whatever
is inside three days of expiring, with the dollar value at risk. Tapping an item lets you log
what you used, log what you binned (with a reason), or put a hold on part of it.

**Plan** — a week at a time. Scheduling a meal immediately reserves the ingredients it needs
from the kitchen, which is what makes something show as *off limits* elsewhere in the app.
Marking a meal cooked consumes those holds; skipping it releases them.

**Recipes** — your own recipes, ranked by what you can actually cook right now. The scoring
engine weighs how much of each recipe is in stock, gives a large bonus for using up
soon-to-expire items, and penalises ingredients that are reserved for another meal. Results
land in three bands: *Cook tonight*, *Almost there*, *Needs a shop*.

**Shop** — the list builds itself from two sources: staples that have dropped below the par
level you set, and gaps between your meal plan and your kitchen. Checking out creates a trip,
puts everything into the kitchen with today's date, and records the prices.

**Insights** — spend, waste, and shopping cadence, all derived from an append-only event
ledger. Monthly spend against monthly waste, where the money goes by category, days between
trips, and which items you throw away most often.

## Photos and barcodes

Items can carry a real picture. Three ways to get one:

- **Take a photo** — opens the phone's actual camera app (so you get its focus, flash and
  framing), or a file picker on desktop.
- **Choose from your library.**
- **Scan a barcode** — looks the product up on [Open Food Facts](https://world.openfoodfacts.org)
  and fills in the name, brand, pack size, category and product shot in one go.

Pictures render inside the freshness ring on every list, so an item shows what it *is* and how
long it has left in the same glance, and full-width at the top of the detail sheet.

**Storage.** Every image is downscaled and re-encoded to JPEG before it's saved — 1200px for the
detail view, 200px for lists — which takes a 5 MB camera frame down to roughly 20–60 KB. Product
shots fetched from Open Food Facts are re-encoded the same way, so they work offline afterwards;
if the fetch is blocked the URL is kept as a fallback. Settings shows the running total.

**Scanning** uses the browser's native `BarcodeDetector` on Chrome and Android. Safari and
Firefox don't have it, so those lazily load ZXing on the first scan — it sits in its own chunk
and never touches the main bundle. Either way the camera needs a secure context: `localhost`
in development, HTTPS on a real phone. There's always a manual barcode entry box next to the
viewfinder, and the whole feature is skippable.

**What leaves the device:** the barcode digits, sent to `world.openfoodfacts.org`, plus the
image download. Nothing else about your kitchen is shared, and typing items in by hand never
touches the network.

## AI suggestions (optional)

The ranking engine above needs no network and no key. Separately, Settings accepts an
Anthropic API key, which turns on a *Ask Claude what to cook* flow in Recipes: it sends your
current kitchen contents — quantities, expiry windows, and what's reserved — and gets back
recipes written around them, which you can save into your collection.

The key is stored in this browser's IndexedDB and sent only to `api.anthropic.com`. There is
no server in this project to send it anywhere else.

## How it's put together

```
src/
  db/schema.ts      domain types — the shape of the app in one file
  db/db.ts          Dexie tables
  db/seed.ts        the demo kitchen and its back-history
  lib/units.ts      unit conversion; count units only convert when interchangeable
  lib/match.ts      "2 cups finely chopped parsley" ↔ a fridge item called "Parsley"
  lib/inventory.ts  freshness, availability, and every mutation that touches the ledger
  lib/suggest.ts    recipe scoring
  lib/plan.ts       scheduling, auto-reservation, cooking
  lib/shopping.ts   list generation and checkout
  lib/insights.ts   ledger aggregations
  lib/ai.ts         the Claude hook
  components/       sheets, item rows, and the SVG charts
  screens/          one file per tab
```

Two design decisions worth knowing:

**Availability is computed, never stored.** An item has a quantity; reservations are separate
rows pointing at it. `available = qty − Σ holds`. Consuming stock trims holds so a reservation
can never outlive the food backing it.

**Every number on Insights comes from the event ledger.** Purchases, consumption and waste are
append-only rows with a dollar value attached, so the analytics can't drift out of sync with
the inventory.

Charts follow the data-viz conventions in the `dataviz` skill: one axis per chart, a validated
two-slot categorical palette for the spend-vs-waste comparison, a single sequential hue for
magnitude rankings, legends and direct labels rather than colour alone, and a table view under
every chart.

## Not built yet

- Barcode scanning (needs camera permissions and a product database)
- Cloud sync / household sharing — the data layer is shaped for it, but there's no backend
- Nutrition data
