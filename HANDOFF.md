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

### The product catalogue — `products`

**`Item` is a purchase. `Product` is the identity behind every such purchase.**
Added in `0005_products.sql` to solve two problems with one table.

The visible one is the ALDI receipt: its lines carry a six-digit item number rather than a
UPC, so nothing on one resolves against Open Food Facts. That number is stable — the same
tub of hummus is `343825` every week — so the barcode only has to be scanned off the packet
**once**. `learnBarcode()` writes it onto the *product*, and every later receipt carrying
that code arrives already named. An import therefore gets quieter over time: the first ALDI
shop asks about everything, the tenth asks about whatever was new that week.

The older, quieter problem is that `addItem` creates a new row per purchase, so buying
carrots monthly left twelve rows called "Carrots", eleven at zero, with nothing recording
that they were the same thing. **Stock is still one row per purchase** — two cartons bought
a fortnight apart expire on different days, and collapsing them would lose that — but the
identity now lives somewhere.

Worth knowing, because it is a common misreading: **an item at zero has never been deleted
or archived.** Nothing sets `archived` automatically; only an explicit delete removes stock.
The complaint that motivated this table was really about duplicates, not disappearance.

- `products` is keyed loosely on `(store, sku)` *and* `barcode`, both unique per household
  and both partial — most rows have one identifier or the other, and the gap between them is
  exactly what the scan closes.
- `items.product_id` and `inbox_items.product_id` link back, both `on delete set null`.
- `inbox_items` also carries `sku`, `store` and `price`, because a parked receipt line has to
  remember enough of itself to become stock after the scan.
- `lib/products.ts` holds the logic: `productByCode`, `upsertProduct` (fills gaps, never
  overwrites — a name from a person or from Open Food Facts beats a till abbreviation, and
  re-importing an old receipt must not undo either), `learnBarcode`, `recordPurchase`.
- **The Catalog tab** browses it — Product / Category / SKU / Barcode / Open Food Facts /
  Size, with filters for *To scan* and *Scanned*.

  **The catalogue holds identity, never quantity.** `times_bought`, `last_bought_at` and
  `last_price` lived here briefly and were dropped in `0007`. Each duplicated something
  `items` already records per purchase, and the copy had already drifted: `times_bought` was
  incremented by the line quantity while claiming to count shops, so two pot pies bought
  twice read "4×". How often and how much are questions about purchases; Trips and Insights
  answer them from the rows that own them. `size`/`sizeUnit`/`unit` stay because they say
  what a product *is* and do not change when you buy more. Built for a landscape iPad,
  which is where several hundred products are readable; *Size* drops under 900px and *SKU*
  under 620px, leaving a phone with what it is, its code, and whether the database knows it.
- The Open Food Facts column is **headed with the words**, abbreviated to "OFF" only under
  780px, and carries a visible legend rather than a tooltip. "OFF" alone reads as off/on and
  was the first thing anyone asked about the table; a tooltip does not answer it on a touch
  screen, where there is nothing to hover.
- **Catalog → "Check N against Open Food Facts"** sweeps every barcode the catalogue holds
  and records the answer. It exists because `off_status` arrived *after* the scanning did:
  a household forty products deep had forty barcodes and no recorded answer for any of them,
  so the column read blank for every row and looked broken rather than unanswered. The sweep
  fills gaps and writes the status but **never overwrites a name** — a catalogue name came
  either from a scan that already consulted Open Food Facts or from a person, and both beat
  re-deciding it now. Sequential with a pause between calls, cancellable, and once everything
  is answered the button becomes *"re-check the N it didn't know"*, since the database grows.
- **`products.off_status`** (`0006`) records what Open Food Facts said, rather than the
  catalogue inferring it from whether `nutrition` came back — which is wrong both ways, since
  a listed product may declare nothing worth storing and nutrition can be typed by hand.
  Three states, and the absent one means something: null is *never asked* (no barcode yet),
  `'missing'` is a settled answer. At ALDI `'missing'` is the expected result and must not
  read as outstanding work.

Trips are listed under **Shop → Previous trips** (all of them, newest first, tappable into
`TripSheet`, with a count of rows still waiting on a barcode). Insights keeps its own
*Recent trips* block, which is the aggregate view rather than the history.

Barcode detection is now strict about length — 8, 12, 13 or 14 digits, the lengths that
actually exist. Anything else is a till code. Sam's Club prints nine-digit item numbers that
used to sail through as barcodes and would have fetched a confident answer about a
completely different product.

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
- **A line whose product has never been scanned parks in Unpack** for its one-time barcode
  scan, rather than going on the shelf under a till abbreviation. A line whose product the
  catalogue already knows goes straight to the kitchen wearing the real name. Which branch
  a line takes is the catalogue's answer, not the receipt's.
- **Open Food Facts runs in the background** and overrides the name in place when it has a
  better one. It never overrides price or quantity: only the receipt knows those.
- **Discounts are kept, not dropped.** A negative line never becomes stock, but leaving it
  out would make every receipt with a coupon look mis-read.
- The **printed total is stored beside the computed one**, and the screen reports the gap
  rather than flagging it. Tax and summary savings lines explain almost all of it.

#### ALDI is the reference case

**Almost every receipt this household imports comes from ALDI**, and its layout is the one
the parser is tuned against. A real one is transcribed into `receipt.test.ts`. It broke
five assumptions at once, and between them they dropped every item on it:

- **The tax code after the price is two letters** (`NC`, `FA`), where Walmart prints one
  (`F`). Nothing matched a price, so all eight items were discarded in silence. The code is
  now matched as part of the price pattern rather than stripped by an alphabet of guesses.
- **The total is letter-spaced** — `T O T A L   $ 30.92` — which hid it from the word
  `total` and imported it as a $30.92 item. `collapseSpacedLetters` is used when deciding
  what a line *is*, never on a description.
- **`AMOUNT DUE` and `8 ITEMS`** are furniture that carries a price.
- **`C-Taxable @7.000%`** is not matched by `\btax\b`.
- **The till prints mixed case**, so the title-caser demoted "CA Heritage Brut" to "Ca".
  `expandDescription` now only re-cases a description that is shouting in capitals.

**ALDI's item codes are six digits — its own numbering, not UPCs.** Nothing on an ALDI
receipt will ever resolve against Open Food Facts, so the till's description *is* the name.
That makes the shorthand table load-bearing here in a way it is not for a Walmart shopper,
and it is the first place to look when an import comes out unreadable. The codes are kept
in `rawDescription` and shown under each name on the review screen, so a bad expansion can
be checked against the paper.

Repeat lines fold: a till prints one line per scan, so two identical salamis are one row of
two rather than two rows on the shelf. Matched on the till's own text and the unit price,
never the expanded name.

#### Scanning a shop against its receipt — `src/lib/tripScan.ts` + `src/screens/TripScan.tsx`

Unpack shows a banner per shop still waiting on barcodes: **"72 from ALDI need a barcode ·
⚡ Scan them"**. One session, camera live, no tapping between items.

This is the inverse of `rapid.ts` and that is the whole design. In the rapid scanner a scan
*creates* a line. Here the list is fixed and known in advance — the receipt already said
what was bought and what it cost — so a scan **claims** a line, and the only interesting
question is which one.

- **Ordinarily the cursor decides.** The screen names the row it wants next; you scan that
  packet. Unknown barcodes are the norm at ALDI, so this is the common path.
- **A recognised name overrides it.** When Open Food Facts knows the code and the name
  matches some *other* pending row above `MATCH_THRESHOLD`, the scan moves there — the
  packet in your hand beats the cursor, which is what makes it safe to unpack in any order.
- **Matching is token overlap, not edit distance.** A till writes `FrzFineGreenBeans` and
  the database says "Fine Green Beans, Frozen": every word shared, almost no character
  positions. `tokens()` splits on case boundaries first, which is the only reason the real
  ALDI lines are recognisable at all — without it that name is one token matching nothing.
- **Barcodes are written the instant they land; items are confirmed only at the end.** So
  closing halfway keeps everything learned, leaves the rest parked, and reopening resumes.
- The frozen `pending` list is deliberate: `useInbox` is live and each scan rewrites a row,
  so a list derived straight from it would reshuffle under the camera mid-session.

#### The tests

`npm test` runs both suites. `npm run test:receipt` — assertions over six layouts (ALDI, Walmart, Kroger, Costco,
Sam's Club, Target) plus the photo route. **These were kept**, unlike the throwaway
`rapid.ts` tests. When a receipt reads wrong, paste it in as a new case, watch it fail, fix
the parser, and check the others still pass. No test framework: the parser is pure, so a
file of assertions and an exit code is the whole requirement.

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

### …and then the second cause happened

`TripScan` shipped with `useCallback(…, [beep, rows])`, where `rows` is `useInbox()`. The
live-query subscription is deliberately coarse — **any** write re-runs **every** query — so
each scan's own `applyBarcode` handed back a fresh array, which recreated the callback, which
re-ran the effect that owns the camera, whose cleanup stops the stream. Black viewport after
the first scan, indistinguishable from the `key` bug above. The comment above the ref in that
file already said the callback had to stay stable; the dependency array said otherwise.

`BarcodeScanner` had the same exposure by a different route: it depended on an `onDetected`
prop that `UnpackTile` redefines on every render, so the single-shot scanner restarted
whenever the inbox changed underneath it.

**All three camera surfaces now hold their callback in a ref and depend on nothing**
(`}, [])`). A correct dependency array is a promise someone has to keep; depending on nothing
is the only version that cannot regress. If you add a fourth camera surface, do the same.

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

- **Only ALDI has been checked against real paper.** The other five layouts were written
  from memory and may be wrong in detail. Expect the first genuine receipt from any of them
  to need a new case in `src/lib/receipt.test.ts`.
- **The shorthand table has only the ALDI words seen on one receipt.** It will need adding
  to as more come through — that is the expected maintenance, not a defect.
- **The photo route is untested end to end** — it needs an Anthropic API key, and the
  `settings` table currently has no rows at all, so nobody has ever set one.
- **`commitReceipt` is not atomic.** It cannot be (§2): the trip is written first, then the
  items one at a time, so a failure part-way leaves a trip with fewer items than it claims.
  Written in that order on purpose — items with a short trip read as an incomplete import,
  where items with no trip read as nothing at all.
- **Nothing here can drive a real camera**, so every camera regression so far has been found
  by a user rather than by a check. Both black-viewport bugs reached production.
- **Camera behaviour is untested by me.** Continuous scanning, the 1.8s cooldown, the beep,
  and vibration all need a real phone and real packets. On iOS, Safari may require a user
  gesture before audio plays; opening the sheet is a tap, which *should* satisfy it, but if
  the beep is silent the audio unlock needs moving to the button press.
- **Kitchen header buttons overflow** off the right edge on a narrow phone
  (Unpack / Tiles / Select / Settings). Pre-existing; noticed, not fixed.
  The bottom nav had the same disease and is now fixed: it is a fixed, centred,
  non-wrapping pill, so its width is just the sum of its buttons. Seven tabs at a
  62px minimum came to 444px and hung 27px off each edge of a 390px phone. Below
  500px the buttons now share the space rather than demanding it, labels
  ellipsise, and `max-width: calc(100vw - 16px)` with a scroll is the backstop.
  **If you add an eighth tab, measure it** — the harness in §8 does this in a
  minute.
- No test suite beyond `npm test` (`test:receipt` + `test:tripscan`). The `rapid.ts` tests
  were throwaway; these were not.

---

## 8. Working practices that paid off

- **`npm run build` typechecks**, so run it before committing — it catches what a dev
  server won't.
- **The static-harness trick works, and now has a script.** The catalogue table was checked
  before shipping by copying the built `dist/assets/index-*.css` beside a hand-written HTML
  page of real markup and screenshotting it in Chromium at 1180×820 and 390×844 —
  asserting `body.scrollWidth <= innerWidth` and reading back which `<th>`s survived each
  breakpoint. `npm i --no-save playwright`, and the browser is already at
  `/opt/pw-browsers/chromium`. Far quicker than a React harness and it catches the thing
  that actually goes wrong, which is layout.
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
