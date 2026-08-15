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

## Deploying

Pushing to `main` builds and publishes to GitHub Pages via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). The build typechecks first, so a
type error fails the deploy instead of shipping a broken bundle.

Assets are emitted with **relative paths** (`base: './'`), so the same bundle serves correctly
from a domain root *or* a repo subpath like `you.github.io/larder/` — no rebuild, no per-host
config. Routing is hash-based (`#kitchen`, `#shop`), so there's no server rewrite to configure
either.

One-time setup on the repo: **Settings → Pages → Source → GitHub Actions.**

## Quick add — walking the kitchen

**Shop → ⚡ Quick add** opens a full-screen, chrome-free tile grid built for one thumb and a
kitchen door held open. Locations first, like photo albums; tap one and you get every item in
that place as a big square tile. Tap a tile to put it on the shopping list, tap again to add
another, and the ✕ clears it.

The first tap is smarter than "add one": a staple that's short of its par level goes on at the
gap. Eight eggs against a par of twelve puts **4** on the list, not 1.

Tiles show what you need to decide at a glance and nothing else — what's left, and a corner flag
for *low* or *3d* when something's near its date. An item with a photo uses it edge-to-edge, with
the label over a scrim heavy enough to stay readable on a near-white pack shot. Everything else
falls back to its category icon.

Filter by All / Low / Expiring / Staples, sort by A–Z / Emptiest / Soonest, or search.

**Big / Small** in the header switches tile size, and the choice sticks. On an iPad that's six
columns versus four. On a phone, regular is already about as large as a two-column square can
get, so large goes full width — but short and wide rather than one giant square per screen.

It writes to the same shopping list as everything else, and reflects what's already on it, so
you can walk the kitchen in several passes without double-adding.

## Storage locations

**Settings → Storage locations** — the five defaults (Fridge, Freezer, Pantry, Counter, Spices)
are just seed data. Rename them, change the icon, reorder them, add your own, or delete one.

Each location declares **how it stores**: chilled, frozen, cupboard, or room temperature. That's
what shelf-life estimates key off, not the location's name — so a newly added "Garage fridge"
immediately suggests the same best-before dates as the main fridge, with no shelf-life table to
fill in.

Two safeguards worth knowing:

- A location's internal key is fixed once created, because items reference it. Renaming
  "Pantry" to "Larder" keeps everything pointing at the right place.
- Deleting a location makes you choose where its contents go. Items pointing at a location that
  no longer existed would silently disappear from the Kitchen, so that isn't allowed — and the
  last remaining location can't be deleted at all.

## Layout modes

**Settings → Layout** switches between three modes, remembered per device:

| Mode | Behaviour |
|---|---|
| **Auto** (default) | Follows the viewport — tablet layout at ≥940px, phone layout below. An iPad swaps automatically when you rotate. |
| **iPhone** | Pinned to the phone layout: single column, floating tab bar along the bottom. |
| **iPad** | Pinned to the tablet layout regardless of width. |

The tablet layout is built for **landscape**: a side rail instead of a bottom bar, two-up
inventory / recipe / shopping lists, four-across KPI tiles, ranked charts paired side by side,
and the meal plan as a real seven-column week rather than a vertical list of days.

These are driven by a `data-layout` attribute on `<html>`, not by media queries alone — that's
what lets the manual override actually beat the viewport. An inline script in
[`index.html`](index.html) resolves layout *and* theme before first paint, so neither flashes
on load.

## Installing on an iPhone or iPad

Open the deployed URL in Safari, then **Share → Add to Home Screen**.

Do use Add to Home Screen rather than just bookmarking it — two reasons:

1. **iOS evicts IndexedDB after 7 days of not visiting a site in Safari.** Installed web apps
   are exempt from that cap; a plain Safari tab is not. Your whole kitchen lives in IndexedDB.
2. The camera, the standalone chrome-less window, and the app icon all behave properly.

Even so, the data lives in exactly one browser on one device. There's no sync. Use
**Settings → Export JSON** now and then if the history matters to you.

**The camera needs HTTPS.** GitHub Pages serves HTTPS, so the deployed app is fine — but the
`npm run dev` server on your laptop is `http://` on your LAN, and Safari will refuse camera
access there. Test scanning against the deployed URL, not the dev server.

**Barcode scanning is slower on iOS.** Safari has no native `BarcodeDetector`, so the first scan
pulls in the ZXing decoder (a separate ~119 KB gzipped chunk, cached afterwards) and decodes in
software. Give it a second or two, and use the manual entry box if the light is poor.

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
