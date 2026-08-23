-- Finishing the shopping-trip model.
--
-- `trips` and `items.trip_id` have existed since 0001 but only the shopping-list
-- checkout ever wrote them, and nothing ever read them back — no screen could
-- show you what was in a trip. Receipt import makes the trip the unit of entry,
-- so the link has to be trustworthy.

-- `trip_id` was the one id column on `items` with no foreign key behind it, so a
-- deleted trip left items pointing at nothing. `set null` rather than `cascade`:
-- losing the receipt must never take the food off the shelf with it.
alter table public.items
  drop constraint if exists items_trip_id_fkey;

update public.items i
  set trip_id = null
  where trip_id is not null
    and not exists (select 1 from public.trips t where t.id = i.trip_id);

alter table public.items
  add constraint items_trip_id_fkey
  foreign key (trip_id) references public.trips (id) on delete set null;

-- The query the trip screen is built on: "what came home from this trip?"
create index if not exists items_household_trip_idx
  on public.items (household_id, trip_id);

-- How the trip was recorded. Worth keeping because the three routes carry
-- different confidence: a receipt is what the till actually charged, a scan is
-- what someone pointed a camera at, and a checkout is what they meant to buy.
alter table public.trips
  add column if not exists source text not null default 'checkout'
  check (source in ('checkout', 'receipt', 'scan'));

-- The receipt's own printed total, kept beside the computed one. They disagree
-- when a line was skipped or mis-read, and that disagreement is the only
-- evidence the import was imperfect — recomputing `total` would erase it.
alter table public.trips
  add column if not exists printed_total numeric;

-- Free-text note: which receipt this was, or why the totals differ.
alter table public.trips
  add column if not exists note text;
