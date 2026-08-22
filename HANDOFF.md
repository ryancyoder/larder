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

### ⚠️ Suspected stale import

`src/components/ItemSheet.tsx` still imports `useLiveQuery` from **`dexie-react-hooks`**,
while everything else uses the app's own `src/app/live.ts`. Dexie's version depends on
Dexie's observability, which no longer exists here, so that sheet may not refresh on
changes. **I noticed this while writing these notes and did not test or fix it** — worth
verifying before trusting live updates in the item sheet.

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

- **`ItemSheet.tsx`'s Dexie import** (§2) — suspected stale, untested.
- **Camera behaviour is untested by me.** Continuous scanning, the 1.8s cooldown, the beep,
  and vibration all need a real phone and real packets. On iOS, Safari may require a user
  gesture before audio plays; opening the sheet is a tap, which *should* satisfy it, but if
  the beep is silent the audio unlock needs moving to the button press.
- **Kitchen header buttons overflow** off the right edge on a narrow phone
  (Unpack / Tiles / Select / Settings). Pre-existing; noticed, not fixed.
- No test suite. The `rapid.ts` tests were throwaway.

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
