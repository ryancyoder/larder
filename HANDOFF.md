# Larder — developer handoff

Everything you need to work on this app: what it is, how it is built, what changed most
recently, and the traps that will cost you time.

**Note:** `MERGE-BRIEF.md` in this repo is stale. The three-app merge it describes was
cancelled — Larder stays an independent app. It does share a Supabase project with a
second app; see §6.

---

## 1. What this is

Kitchen inventory, meal planning and food-waste tracking for one household.

- **Repo:** https://github.com/ryancyoder/larder (public)
- **Live:** https://ryancyoder.github.io/larder/
- **Stack:** React 19 + TypeScript + Vite. Real build, unlike the family's other app.
- **Deploy:** GitHub Actions on push to `main` (`.github/workflows/deploy.yml`). It runs
  `npm run build`, which **typechecks first** (`tsc --noEmit && vite build`), so a type
  error fails the deploy rather than shipping a broken bundle.
- Takes ~1–2 minutes (full `npm ci`). Poll the run, don't assume.

### Build stamp

`__BUILD_ID__` (git SHA + timestamp) is injected by `vite.config.ts` and shown in
Settings → *This build*. **Every build gets a new asset hash even from identical source**,
because the timestamp is baked in — so a changed hash is not evidence of changed code.
When a user says a fix isn't working, check their build stamp first.

---

## 2. Storage — read this before touching the data layer

**Larder is no longer offline-first, and `dexie` is no longer the database**, despite still
being in `package.json`. It was migrated to Postgres.

- `src/db/remote.ts` implements a `Table` class that presents the **same surface the app
  always used** (`db.items.get(id)`, `db.events.add(...)`) and talks to Supabase
  underneath. The migration reached the storage layer and stopped there instead of
  rippling through ~25 screens.
- `src/db/db.ts` maps app-side names to real table names (`cats` → `categories`,
  `plan` → `plan_entries`).
- Every row carries `household_id`, filled in on write and never passed by callers. RLS
  would reject it otherwise.

**Two behavioural differences that matter:**

1. **`db.transaction()` is no longer atomic.** PostgREST has no multi-statement
   transaction, so a group of writes can fail halfway. The ledger writes are where that
   hurts and they're marked in the source.
2. **Photos live in Supabase Storage**, not IndexedDB — uploaded as `<household>/<uuid>-full.webp`
   and `-thumb.webp` (see `src/lib/photos.ts`).

### Shopping trips

`trips` and `items.trip_id` shipped in `0001_init.sql` but only ever half-worked: the
shopping-list checkout was the one thing that wrote them and nothing read them back, so
the live database had **zero trips** against 24 items. Migrations `0003` and `0004`
finished the model:

- `items.trip_id` has a real foreign key at last (`on delete set null` — losing a receipt
  must not take the food off the shelf), plus an index for "what did this trip buy?".
- `trips.source` is `'checkout' | 'receipt' | 'scan'`, because the three routes carry
  different confidence.
- `trips.printed_total` sits beside `trips.total`. They disagree when a line was skipped or
  mis-read, and that gap is the only evidence an import was imperfect — recomputing `total`
  would erase it.
- `inbox_items.trip_id` carries the trip through the inbox, so a scan named three days
  later still lands on the shop it came from.

All three entry routes now record a trip. `TripSheet` (opened from *Recent trips* on
Insights) is the first screen that ever showed one.

### The stale Dexie import is gone

`src/components/ItemSheet.tsx` was the last file importing `useLiveQuery` from
`dexie-react-hooks`, which could not observe anything once Dexie stopped being the
database. It now uses `src/app/live.ts` like everything else. Nothing in `src/` imports
`dexie` or `dexie-react-hooks` any more, though both are still in `package.json` — safe to
drop whenever someone wants to touch the lockfile.

---

## 3. Auth

Google sign-in via Supabase, added recently. `src/screens/SignIn.tsx`.

- **Continue with Google** is primary. Email/password is kept underneath *deliberately* —
  accounts predating Google still use it, and a fallback matters when the alternative is
  the household locked out of the food. The magic link sits below that again.
- **`src/screens/JoinHousehold.tsx`** handles a signed-in account with no household. This
  is a normal state, not an error: households are no longer auto-created (§6), so a new
  account arrives with none and is shown a code field. `auth.tsx` exposes
  `refreshHousehold()` so joining takes effect without signing out and back in.
- **Sign out** is in Settings → *Account*. There was previously **no way to sign out at
  all** — `signOut()` existed but nothing called it.

### Config that must stay correct

- Supabase → URL Configuration must list **both** `https://ryancyoder.github.io/larder/`
  **and** `…/larder/**`. The docs don't confirm `**` matches an empty tail, and the app
  redirects to the bare path.
- **Nothing needs changing in Google Cloud** — both apps share the Supabase project, so
  they share the callback `https://ivjxtlznikqxyscyyxzk.supabase.co/auth/v1/callback`,
  which is already registered.
- The consent screen is in **Testing** mode, so each family Gmail must be added as a test
  user: `https://console.cloud.google.com/auth/audience?project=laundry-app-506314`

### `currentHouseholdId()` uses `.limit(1)`

`src/lib/supabase.ts` takes the first membership it finds. That was fine when everyone had
exactly one household, and is still fine today — but the other app hit a real bug from
this exact pattern and now picks deliberately. If a user can ever belong to two
households, fix this the same way.

---

## 4. Recent work (this session)

Newest first:

| Commit | What |
|---|---|
| `Import a receipt…` | Third rapid-entry route, and the trip model finished behind it. See below. |
| `Kitchen: one toolbar…` | Four stacked filter bars → one row: search, a Filters button reporting its active count, and Group / Sort selects. Filters moved into a sheet. |
| `Kitchen: drop "Eat me first"…` | Removed the scrolling urgency strip; the item list became a real table. |
| `Fix the camera going black…` | See §5 — the most instructive bug here. |
| `Unpack: scan a whole shop…` | New rapid-scan importer. |
| `Unpack: scan the barcode off the item…` | Live scan in the naming modal. |
| `Add a way to sign out` | There wasn't one. |
| `Let a new account join…` | Join-code screen. |
| `Sign in with Google` | Google as primary auth. |

### Kitchen view

- **Table, not cards.** Aligned columns (Item / Category / Use by / Amount) with tabular
  figures. Cards were fine for a handful of things and poor for a shelf. The Category
  column collapses under 620px.
- **Grouping is explicit** — location, category, or none. It previously switched itself off
  whenever any filter was touched, so the list reshaped for reasons it never stated.
- **Sorting**: Use by (default), Item A–Z, Food A–Z. *Use by* was kept as default on
  purpose — expiry is the app's reason for existing, and removing it silently would be a
  regression. *Food A–Z* sorts on the matched basic food (`foodMeta(item.foodKey)`), so all
  the onions gather regardless of brand, with ties falling back to item name.
- Group and sort persist to `localStorage` under `larder-kitchen-view`.

### Receipt import — `src/lib/receipt.ts` + `src/screens/ReceiptImport.tsx`

Unpack → **🧾 Import a receipt**. Paste the text of a receipt, or photograph it.

- **Why it exists:** it is the only entry route that knows what things *cost*. The ledger
  has had a `value` column since the first release and almost nothing to put in it, so
  Insights' spend figures were built on the shopping-list checkout alone — which the live
  database says has never once been used.
- **Everything above `commitReceipt` is pure.** Text in, lines out, no network and no
  database. That is the whole debugging story for a parser that has to cope with input
  nobody controls.
- **Two stages, deliberately.** Parse, then review, then commit. A parser guessing at
  somebody's layout will be wrong eventually, and a wrong *price* that lands silently is
  worse than one you were shown first. Nothing touches the kitchen until the second screen.
- **Unknown barcodes still go to the kitchen**, named by the receipt's own description —
  unlike the rapid scanner, which parks them in the inbox. The receipt always supplies a
  name and a price, so there is nothing left to ask.
- **Open Food Facts runs in the background** and overrides the name in place when it has a
  better one. It never overrides price or quantity: only the receipt knows those.
- **Discounts are kept, not dropped.** A negative line never becomes stock, but leaving it
  out would make every receipt with a coupon look mis-read.
- The **printed total is stored beside the computed one**, and the screen reports the gap
  rather than flagging it. Tax and summary savings lines explain almost all of it.

#### The parser, and its tests

`npm run test:receipt` — 38 assertions over five real chain layouts (Walmart, Kroger,
Costco, Sam's Club, Target) plus the photo route. **These were kept**, unlike the throwaway
`rapid.ts` tests. When a receipt reads wrong, paste it in as a new case, watch it fail, fix
the parser, and check the other five still pass. No test framework: the parser is pure, so
a file of assertions and an exit code is the whole requirement.

Things that cost a debugging cycle and are now pinned by a test:

- **Order matters.** Strip the price from the end first, then the barcode, then read the
  description. The other way round lets a price's digits look like a product code.
- **The `@` clause must be read against the line including its price.** On a bare
  `3 @ 0.39` the unit price *is* the price at the end, so searching only what survives the
  strip leaves `3 @` and the quantity vanishes.
- **A continuation line attaches by source row, not by "the last line we kept".** Without
  that, an amount line following a dropped row rewrites some earlier item — which is how
  2.14 lb of bananas became 2.14 gallons of milk.
- **Tax flags sit on both sides of the price** on Walmart-style layouts, and only the one
  after the barcode is reachable once the digits are gone.
- Noise matching allows leading decoration (`**** TOTAL`) but a line still survives as a
  product when it has a price and a real barcode — `TOTAL CEREAL` is a thing you can buy.
- Six-digit store codes are **not** barcodes. Sending one to Open Food Facts returns a
  confident answer about the wrong product, so only 8–14 digit runs are accepted.

The shorthand table (`GV` → Great Value, `SHRD` → Shredded) is deliberately conservative
and meant to be added to as real receipts turn up words it does not know.

### Barcode scanning

`src/lib/barcode.ts` `startScanner(video, onResult, { continuous, repeatMs })`.

- **Default is single-shot** (fires once, stops) — that's what the "scan this one thing"
  dialogs want. Don't change the default; `AddItemSheet` and the Unpack modal rely on it.
- **Continuous mode** keeps going. It needs its own guard: a barcode sits in frame for many
  frames, so the same tin would report itself dozens of times. The same code is ignored for
  `repeatMs` (default 1800) after firing — long enough to move the packet, short enough
  that a deliberate second identical tin still registers. **This window is a judgement call
  and may need tuning on real hardware.**
- Both engines (native `BarcodeDetector`, ZXing fallback for Safari/Firefox) honour it.

### Rapid scan — `src/screens/RapidScan.tsx` + `src/lib/rapid.ts`

Unpack → **⚡ Scan a shop**. Camera stays live; scan, beep, scan, beep, no dialogs.

- Lookups run **in the background** rather than gating the next read, so scanning speed
  isn't the network's decision.
- A repeat **raises that line's quantity** rather than adding a row — like a till. That also
  makes an accidental double-read visible and correctable instead of hidden.
- On finish: named products go **straight to the kitchen**; unrecognised ones go to the
  **inbox**, one row per unit, with the digits kept. Two tins of an unknown soup may not be
  the same soup, and an unnamed item in the kitchen is worse than one waiting in Unpack.
- The list logic in `rapid.ts` is pure (`addScan`, `applyLookup`, `setQty`) and was covered
  by throwaway tests — 10 cases, all passing, covering repeat folding, barcode
  normalisation, and lookups landing only on their own line. The test file was not kept;
  re-creating it is cheap if you change that logic.

### Unpack naming modal

Photos that the batch barcode pass couldn't read now offer **📷 Scan the barcode** (live,
primary) alongside **🔎 Re-read this photo** (secondary). The old retry could only
re-examine pixels that never contained a readable barcode. `applyBarcode()` in
`src/lib/inbox.ts` keeps the photo and fills in name/brand/category/nutrition from the
lookup; an unknown code is still saved with a note.

---

## 5. The bug worth learning from

**Symptom:** in rapid scan, the camera went black immediately after the first scan.

**Cause:** the green flash animation was restarted with `key={flash}` on the element
*wrapping the video*. Changing a React `key` destroys and rebuilds that subtree, so the
`<video>` was replaced while the camera stream stayed bound to the discarded element.

**Fix:** the key now lives on a throwaway overlay `<span>` that sits *beside* the video.

**The lesson:** never put a changing `key` on anything containing a `<video>`, `<canvas>`,
or other element holding external state. Also worth noting the other candidate was ruled
out first — the effect that starts the scanner depends only on stable callbacks, so it
wasn't re-running. Both faults produce an identical black screen, and fixing the wrong one
looks like the fix failing.

---

## 6. ⚠️ The shared Supabase project

Larder shares a Supabase project with **Laundry HQ** (repo `ryancyoder/laundry-hq`, a
single-file no-build app).

- Project ref `ivjxtlznikqxyscyyxzk`. Connection is in `.env.production`, **committed on
  purpose** — the publishable key is public by design; RLS is the security boundary.
- **Shared:** `auth.users`, `households`, `household_members`,
  `private.auth_household_ids()`. One sign-in covers both apps, and joining a household in
  either grants access in both.
- **Larder owns:** `people`, `items`, `inbox_items`, `photos`, `places`, `categories`,
  `recipes`, `plan_entries`, `meal_days`, `combos`, `shop_items`, `trips`, `reservations`,
  `ledger_events`, `settings`.
- **Laundry HQ owns:** everything prefixed `laundry_`, plus `wardrobe_items` and
  `outfit_plans`. Don't touch them.
- **`public.people` is Larder's**, and the other app deliberately does *not* share it — its
  roster needs individuals, whereas Larder's has "Littles" as a group and "Family meal"
  as a planning bucket. Keep it that way.

### A trigger that used to be yours was disabled

`handle_new_user()` on `auth.users` created a fresh "Our kitchen" household for every new
sign-up. That gave each new family member their own private household instead of the
family's, so **the trigger was dropped** at the user's request. The function is kept, so
restoring is one statement:

```sql
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
```

**Consequence for Larder:** a brand-new account now has no household and lands on the join
screen (§3). That's the intended flow. If you ever need auto-creation back, restore the
trigger *and* revisit the join screen.

**Current state:** one household (`10 Yoder`), three users, zero triggers on `auth.users`.

---

## 7. Known gaps and things I couldn't verify

- **The receipt parser has only been run against layouts I wrote by hand.** Five chains,
  no real paper. Expect the first genuine receipt to need a new case in
  `src/lib/receipt.test.ts`.
- **The photo route is untested end to end** — it needs an Anthropic API key, and the
  `settings` table currently has no rows at all, so nobody has ever set one.
- **`commitReceipt` is not atomic.** It cannot be (§2): the trip is written first, then the
  items one at a time, so a failure part-way leaves a trip with fewer items than it claims.
  Written in that order on purpose — items with a short trip read as an incomplete import,
  where items with no trip read as nothing at all.
- **Camera behaviour is untested by me.** Continuous scanning, the 1.8s cooldown, the beep,
  and vibration all need a real phone and real packets. On iOS, Safari may require a user
  gesture before audio plays; opening the sheet is a tap, which *should* satisfy it, but if
  the beep is silent the audio unlock needs moving to the button press.
- **Kitchen header buttons overflow** off the right edge on a narrow phone
  (Unpack / Tiles / Select / Settings). Pre-existing; noticed, not fixed.
- No test suite beyond `npm run test:receipt`. The `rapid.ts` tests were throwaway; the
  receipt ones were not.

---

## 8. Working practices that paid off

- **`npm run build` typechecks**, so run it before committing — it catches what a dev
  server won't.
- **Verifying UI without auth is awkward.** The Kitchen needs a session and data. A React
  harness failed (the category registry loads during app boot, which the harness bypassed);
  what worked was rendering the real markup against the real stylesheet in a throwaway page
  under `public/`, then deleting it. Good enough for layout, which is where the visual risk
  lives.
- **Poll the Actions run by head SHA**, not "the latest run" — the latest can still be the
  previous commit's when you check too early.
- **After deploy, grep the served bundle** for a string unique to your change. Note the
  entry chunk is not the only chunk; check the one your code actually landed in.
- **Read the Supabase auth logs** for any sign-in problem; they name the exact cause.
