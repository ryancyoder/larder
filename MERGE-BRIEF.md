# Merge brief — three household apps into one

Written 2026-08-16 by the Claude session that built Larder, for whichever session does the
merge. Everything here about Larder is first-hand. Everything about the other two apps was
measured from their source on this machine, not assumed — but I did not build them, so treat
their sections as a survey to verify, not gospel.

**Read this whole file before writing code.** The collision inventory in §3 is the part that
will silently break things if skipped.

---

## 1. The three apps

| | **Larder** | **ChoreQuest** | **Laundry HQ** |
|---|---|---|---|
| Path | `~/Documents/Claude/FOODAPP` | `~/Documents/Claude/FAMILYCHORES` | `~/Documents/Claude/YODERAPP` |
| Purpose | Kitchen inventory, meal planning, food waste | Gamified family chores, rewards, schedule | Laundry loads, machines, rota |
| Language | **TypeScript** (`.tsx`) | **JavaScript** (`.jsx`) | Vanilla JS in HTML |
| Build | Vite 7 | Vite | **None** — one 140 KB `index.html` |
| UI | React 19 | React 19 | Hand-rolled DOM |
| Persistence | **Dexie** (IndexedDB), 10 tables, versioned schema | **One localStorage key** (`chorequest.state.v1`) + raw IndexedDB for photos | IndexedDB + localStorage |
| Deployed | Yes — GitHub Pages CI, `ryancyoder.github.io/larder` | No | No |
| Own docs | `README.md` | `README.md` | `README.md` + a 22 KB `HANDOFF.md` — **read it** |

They share zero code and three incompatible persistence models. That is the central fact of
this merge.

**Larder is the only one with CI, a deploy target, TypeScript and a versioned schema**, which is
why §5 recommends using it as the shell.

---

## 2. Larder in depth — what the code does and why

### 2.1 Layout of the source

```
src/
  db/schema.ts      Every domain type. Read this first — the app's shape in one file.
  db/db.ts          Dexie class, DB name 'larder', schema versions 1→3
  db/seed.ts        Demo kitchen + 3 months of fake history
  lib/units.ts      Unit conversion
  lib/match.ts      "2 cups chopped parsley" ↔ a fridge item called "Parsley"
  lib/categories.ts Food categories, shelf life by storage kind, name→category guessing
  lib/locations.ts  Storage places (user-editable) + CRUD
  lib/inventory.ts  Freshness, availability, and every mutation that touches the ledger
  lib/suggest.ts    Recipe scoring
  lib/plan.ts       Meal scheduling, auto-reservation, cooking
  lib/shopping.ts   List generation, tap-to-add, checkout
  lib/insights.ts   Ledger aggregations
  lib/photos.ts     Image compression + object-URL cache
  lib/barcode.ts    Scanner (native + ZXing fallback)
  lib/openfoodfacts.ts  Product lookup
  lib/ai.ts         Optional Claude recipe generation
  app/              React context + live-query hooks (data, layout, toast, usePhoto)
  components/       Sheets, tiles, charts, shared UI
  screens/          One file per tab, plus Settings and QuickAdd
  styles/global.css All styling. One file. Global namespace. See §3.
```

### 2.2 The load-bearing design decisions

These are the ones where a merge could quietly undo something deliberate.

**Availability is computed, never stored.** An `Item` has `qty`. Reservations are separate rows
pointing at it. `available = qty − Σ holds`. Nothing persists `available`.

*Why:* holds come and go from meal planning; a stored field would drift. There is a real
consequence: consuming stock must shrink holds, or a hold outlives the food backing it. That's
`trimHolds()` in `lib/inventory.ts` — it fires inside the same transaction as every consume/waste.
This fixed an actual bug where an item showed 2 pkgs reserved against 1 pkg in stock. **Do not
add a code path that decrements `qty` without going through `consume()`/`waste()`.**

**Every number on Insights comes from an append-only ledger.** `db.events` records purchase /
consume / waste / adjust with a dollar value. Insights never reads `items`.

*Why:* inventory is current state, analytics is history. Deriving spend from current stock would
mean the numbers change when you eat something. If the merge adds a new way to remove stock, it
must write a ledger event or the analytics silently under-report.

**Storage locations are data, with a `kind`.** `places` table. Each has `kind: chilled | frozen
| pantry | counter`. Per-category shelf lives key off **kind**, not the location's name.

*Why:* locations are user-editable. If shelf life were keyed by location name, a user adding
"Garage fridge" would get no expiry estimates. With kinds, it inherits the fridge's dates
immediately. Two invariants enforced in `lib/locations.ts`: a place's `key` is immutable once
created (items reference it), and deleting one **requires** choosing where its contents go —
orphaned items vanish from the Kitchen with no explanation.

**Unit conversion refuses to guess.** `convert()` returns `null` across dimensions (mass↔volume)
*and* between non-interchangeable count units. A clove is not a head; a slice is not a loaf.
Callers treat `null` as **"we have this, quantity not comparable"** — never as a shortfall.

*Why:* the first version converted all count units 1:1, so "5 cloves garlic" read as more than
"2 heads" and the app told the user to buy garlic they already had. Inventing a shortfall is
worse than admitting you can't compare.

**Layout is driven by `data-layout` on `<html>`, not media queries.** `app/layout.tsx` resolves
`auto | compact | wide` and stamps the attribute; CSS uses `:root[data-layout='wide']`.

*Why:* a pure media query cannot be overridden by a user setting. Settings offers Auto / iPhone /
iPad and the manual choice has to beat the viewport. Two details that matter: an inline script in
`index.html` resolves layout **and** theme before first paint (otherwise both flash), and the
resolver listens to `resize` and `orientationchange` **as well as** the media query — one missed
`change` event previously left the layout stale until reload.

**`base: './'` in `vite.config.ts` and hash routing.** Assets are emitted relative, so the same
bundle serves from a domain root or `github.io/larder/`. Routing is `#kitchen`, `#shop`, so there
are no server rewrites to configure.

*Why:* GitHub Pages serves from a subpath. This is the classic way such deploys break. **If the
merged app changes hosting, re-verify by serving `dist/` under a subdirectory — and use a port
you have confirmed is free.** I got a false pass once because another dev server was answering
200 for every path with its SPA fallback.

**Photos: separate table, two sizes, aggressively compressed.** `db.photos` holds `{full, thumb}`
JPEG blobs; items hold a `photoId`. `lib/photos.ts` re-encodes to 1200px / 200px long edge — a
5 MB camera frame becomes ~20–60 KB. Object URLs are cached in a module-level `Map` keyed by
`(photoId, size)` and revoked **only** when the photo is deleted.

*Why:* blobs in the `items` table would slow every list query, and creating an object URL per
render both flickers and leaks.

**Camera capture uses a file input, not `getUserMedia`.** `<input type="file" capture="environment">`.

*Why:* it opens the real camera app on iOS/Android — with its focus, flash and framing — and
degrades to a file picker on desktop. A custom `getUserMedia` viewfinder is worse on every axis
except branding.

**Barcode scanning has two engines.** Native `BarcodeDetector` (Chrome/Android); ZXing
**lazy-imported** on first scan for Safari/Firefox. ZXing is ~119 KB gzipped and sits in its own
chunk — do not let a merge pull it into the main bundle with a static import.

**AI is optional and additive.** `lib/ai.ts` calls the Messages API directly from the browser
(needs the `anthropic-dangerous-direct-browser-access` header), model `claude-opus-5`, structured
outputs via `output_config.format`. The key lives in `db.settings`, never in code. **The app is
fully functional with no key** — `lib/suggest.ts` is the real ranking engine. Keep that property.

**Charts follow the `dataviz` skill.** One axis per chart, a validated two-slot categorical
palette (`--viz-1/--viz-2`, run through the validator in both light and dark), one sequential hue
for magnitude, legends plus direct labels, and a table view under every chart. `.chart-svg` caps
at 620px because a fixed viewBox stretched to full width rendered ~450px tall.

### 2.3 Known constraints, learned the hard way

- **iOS evicts IndexedDB after 7 days** of not opening a site in Safari. Installed web apps
  (Add to Home Screen) are exempt. All three apps store everything client-side, so this is a
  data-loss risk for the merged app too. Keep an export.
- **Camera needs HTTPS.** `localhost` is fine; a LAN dev server over `http://` is not.
- **Safari has no `BarcodeDetector`** and **no Web NFC at all**. iPads have no NFC hardware
  either — NFC was investigated and correctly rejected.
- **React StrictMode double-invokes effects.** The seed guards against this with an in-flight
  promise; two concurrent seeds previously duplicated the demo data.

---

## 3. Collision inventory — measured, not guessed

I diffed Larder's and ChoreQuest's stylesheets. These are real and they carry **different values
in each app**, so a naive concatenation silently restyles both.

**15 colliding CSS class names:**

```
.app .brand .btn .card .chip .empty .fab .nav
.ring .row .scanner .sheet .stack .toast .topbar
```

**8 colliding CSS custom properties:**

```
--accent  --accent-2  --bg-2  --line  --r-lg  --r-md  --r-sm  --warn
```

**Other collisions:**

| Thing | Larder | ChoreQuest | Consequence |
|---|---|---|---|
| `src/components/ui.*` | `ui.tsx` | `ui.jsx` | Same path, different file |
| `<html>` attributes | writes `dataset.theme`, `dataset.layout` | has its own `settings.layoutMode` | Two systems fighting over one attribute |
| Photo subsystem | Dexie `larder` → `photos`, **async** API | own IndexedDB `chorequest-photos`, in-memory Map, **sync** `photoUrl(id)` | Two parallel implementations with incompatible call signatures |
| Camera component | `PhotoCapture.tsx` | `CameraCapture.jsx` | Duplicated functionality |
| AI module | `lib/ai.ts` → `api.anthropic.com` direct | `lib/ai.js` → `POST /api/check-photo` (a server route that doesn't exist yet) | Different models entirely |
| localStorage | `larder-theme`, `larder-layout`, `larder-tile-size` | `chorequest.state.v1` | No key collision today — keep it that way |

Laundry HQ was not diffed for CSS because it's a single self-contained file; its styles are
scoped to itself only until it's ported into the build.

---

## 4. What is genuinely shared

Worth unifying eventually. Not on day one.

- **Household members.** ChoreQuest has a real member model with XP, coins, badges. Laundry HQ
  has a rota of people. Larder has no concept of people at all. This is the strongest candidate
  for a shared entity.
- **Photos.** Both Larder and ChoreQuest compress and store images in IndexedDB. Larder's is the
  more developed (two sizes, URL cache, size accounting) but ChoreQuest's is synchronous, which
  its components rely on. Unifying means picking one API shape and porting the callers.
- **Settings / theme / layout mode.** All three have some version. One owner, one attribute.
- **The "big touch targets" idiom.** Larder's QuickAdd POS view and ChoreQuest's kid-facing
  screens want the same thing.

---

## 5. Recommended merge approach

A recommendation, not a menu. Deviate with reason.

**Use Larder's repo as the shell.** It has TypeScript, a working GitHub Pages pipeline, a
versioned schema and the most infrastructure. Bringing it into one of the others means giving
those up.

**Do these in order:**

1. **Namespace the CSS before merging a single component.** Either prefix every class per app
   (`.lr-card`, `.cq-card`) or move to CSS Modules. The 15-class collision list above is the
   minimum that must be resolved. Do this while the apps are still separate and testable.

2. **Decide the shell's navigation** — three apps under one roof needs a top-level switcher
   above each app's own nav. Larder's `App.tsx` tab bar is per-app, not global; it will need to
   move down a level.

3. **Port ChoreQuest to TypeScript as it comes across**, or accept `allowJs` and a mixed
   codebase. Mixed is fine short-term; decide deliberately rather than by drift.

4. **Keep the three data stores separate at first.** Larder's Dexie, ChoreQuest's localStorage
   blob, Laundry HQ's own IndexedDB. Unify *only* the shared entities from §4, and only after
   the merged app runs. Rewriting three persistence models simultaneously is how this fails.
   Note ChoreQuest's `migrate()` in `src/store/storage.js` is its schema-evolution mechanism —
   the equivalent of Larder's Dexie versions.

5. **Port Laundry HQ last.** It's a 140 KB no-build HTML file with hand-rolled DOM — the biggest
   rewrite of the three. Read its `HANDOFF.md` (22 KB, already written) before starting. A
   legitimate interim step is shipping it as-is in an iframe or a separate route while the other
   two merge properly.

6. **One PWA identity.** One manifest, one scope, one set of icons, one theme-color. Three
   `manifest.webmanifest` files cannot coexist. Users install *one* app.

**Preserve on the way through:** the ledger invariant, `trimHolds`, computed availability,
location `kind` inheritance, the conversion-returns-null contract, lazy ZXing, `base: './'`, and
the pre-paint boot script. Each exists because something broke without it.

---

## 6. Verification checklist

Data migration is the real risk — the user has live data on an iPad for Larder, and ChoreQuest
families have data on their devices.

- [ ] **Existing Larder data survives.** Open the merged app against a populated `larder` DB and
      confirm item/recipe/event counts and zero orphaned location keys. I verified the v2→v3
      upgrade this way: 39 items, 8 recipes, 326 ledger events, 0 orphans.
- [ ] **Existing ChoreQuest state survives** `chorequest.state.v1` → whatever replaces it.
- [ ] `npx tsc --noEmit` clean, `npx vite build` clean.
- [ ] Serve `dist/` **under a subdirectory on a confirmed-free port** and load it — catches
      absolute-path regressions. Include a deliberately bogus URL as a control; it must 404.
- [ ] Both themes and both layout modes, at phone (390) and iPad landscape (1180) widths.
- [ ] No horizontal overflow at any width (check `document.documentElement.scrollWidth`).
- [ ] Camera and barcode still work **on the deployed HTTPS URL**, not just localhost.
- [ ] Charts still pass the palette validator if their colours changed.

## 7. Where things live

- Repo: `github.com/ryancyoder/larder` — public, GitHub Pages via `.github/workflows/deploy.yml`,
  builds on push to `main`, Pages source is "GitHub Actions".
- Live: `https://ryancyoder.github.io/larder/`
- `gh` CLI is authenticated as `ryancyoder` with `repo` + `workflow` scopes.

## 8. Open work not yet built

Ranked. The first is the one the user most wants.

1. **ALDI failed-scan memory.** They shop mostly at ALDI, which is ~90% private label, and Open
   Food Facts coverage of those barcodes is poor. Scanning will feel broken there. The fix:
   remember barcode→item mappings the user enters by hand, so the second scan of a Millville or
   Friendly Farms product fills in instantly from their own first entry. Given ALDI's ~1,400 SKUs
   against a supermarket's ~30,000, a few shops would cover most of a typical run.
2. An ALDI private-label brand dictionary for the category matcher.
3. Receipt-total entry instead of per-line prices (ALDI checkout is too fast to type prices).
4. Action deep-links (`#scan`, `#add`) so an NFC sticker or QR on the fridge opens straight into
   the scanner.
