-- Larder: the kitchen, in Postgres.
--
-- Mirrors the IndexedDB schema the app grew up on, with two deliberate
-- differences:
--
--   * Keys are bigint identity rather than uuid. The app has referenced items,
--     photos and plans by number since the first version; uuids would mean
--     rewriting every id in twenty-five files to buy nothing here.
--   * Every row carries household_id. That is the only thing row-level security
--     checks, so a household can never see another's kitchen even though the
--     anon key is public in a static site.
--
-- Column names stay snake_case; the client maps them to the camelCase the
-- domain types already use.

-- ---------------------------------------------------------------------------
-- Households
-- ---------------------------------------------------------------------------

create table households (
  id bigint generated always as identity primary key,
  name text not null default 'Our kitchen',
  created_at timestamptz not null default now()
);

-- A join table rather than a household_id on the user, so adding a second
-- device or a per-person login later is a row rather than a migration.
create table household_members (
  household_id bigint not null references households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index household_members_user_idx on household_members (user_id);

/**
 * The households the caller belongs to.
 *
 * Wrapped in a function marked stable and security definer so the policies
 * below don't each re-query the join table, and so a member can't be hidden
 * from themselves by a policy on that table.
 */
create or replace function auth_household_ids()
returns setof bigint
language sql
stable
security definer
set search_path = public
as $$
  select household_id from household_members where user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Reference data: places, categories, people
-- ---------------------------------------------------------------------------

create table places (
  id bigint generated always as identity primary key,
  household_id bigint not null references households (id) on delete cascade,
  key text not null,
  label text not null,
  emoji text not null default '📦',
  photo_id bigint,
  blurb text not null default '',
  kind text not null check (kind in ('chilled', 'frozen', 'pantry', 'counter')),
  "order" int not null default 0,
  unique (household_id, key)
);

create table categories (
  id bigint generated always as identity primary key,
  household_id bigint not null references households (id) on delete cascade,
  key text not null,
  label text not null,
  emoji text not null default '📦',
  photo_id bigint,
  hue text not null default 'other',
  aisle int not null default 0,
  home_kind text not null check (home_kind in ('chilled', 'frozen', 'pantry', 'counter')),
  -- Days per storage kind. Sparse by nature: plenty of things never go in a
  -- freezer, and a missing key means "no idea" rather than zero.
  shelf_life jsonb not null default '{}'::jsonb,
  unique (household_id, key)
);

create table people (
  id bigint generated always as identity primary key,
  household_id bigint not null references households (id) on delete cascade,
  key text not null,
  name text not null,
  emoji text not null default '🙂',
  hue text not null default 'other',
  "order" int not null default 0,
  unique (household_id, key)
);

-- ---------------------------------------------------------------------------
-- Photos
-- ---------------------------------------------------------------------------

-- The bytes live in Storage; this row is the handle plus what display needs to
-- know. `cutout` matters: a background-removed image has to be letterboxed
-- rather than cropped, or it looks like a rendering fault.
create table photos (
  id bigint generated always as identity primary key,
  household_id bigint not null references households (id) on delete cascade,
  full_path text,
  thumb_path text,
  remote_url text,
  source text not null check (source in ('camera', 'library', 'openfoodfacts')),
  cutout boolean not null default false,
  attribution text,
  created_at date not null default current_date
);

-- ---------------------------------------------------------------------------
-- Stock
-- ---------------------------------------------------------------------------

create table items (
  id bigint generated always as identity primary key,
  household_id bigint not null references households (id) on delete cascade,
  name text not null,
  category text not null,
  location text not null,
  photo_id bigint references photos (id) on delete set null,
  barcode text,
  nutrition jsonb,
  qty numeric not null default 0,
  qty_initial numeric not null default 0,
  unit text not null default 'ea',
  size numeric,
  size_unit text,
  price numeric,
  purchased_at date not null default current_date,
  expires_at date,
  opened_at date,
  meal text check (meal in ('breakfast', 'lunch', 'dinner', 'snack')),
  is_main boolean,
  is_staple boolean not null default false,
  par_qty numeric,
  brand text,
  notes text,
  trip_id bigint,
  archived boolean not null default false
);

create index items_household_idx on items (household_id);
create index items_category_idx on items (household_id, category);
create index items_location_idx on items (household_id, location);

-- A hold on part of an item. Deleting the item takes its holds with it —
-- a claim on something that no longer exists is not worth keeping.
create table reservations (
  id bigint generated always as identity primary key,
  household_id bigint not null references households (id) on delete cascade,
  item_id bigint not null references items (id) on delete cascade,
  qty numeric not null,
  plan_id bigint,
  person_key text,
  label text not null default '',
  created_at date not null default current_date
);

create index reservations_item_idx on reservations (item_id);
create index reservations_person_idx on reservations (household_id, person_key);

-- ---------------------------------------------------------------------------
-- Recipes, plans, combinations
-- ---------------------------------------------------------------------------

create table recipes (
  id bigint generated always as identity primary key,
  household_id bigint not null references households (id) on delete cascade,
  title text not null,
  emoji text not null default '🍽️',
  description text,
  servings int not null default 2,
  prep_min int not null default 0,
  cook_min int not null default 0,
  tags jsonb not null default '[]'::jsonb,
  ingredients jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  favorite boolean not null default false,
  source text not null default 'custom' check (source in ('custom', 'ai')),
  created_at date not null default current_date,
  last_cooked_at date,
  times_cooked int not null default 0
);

create table plan_entries (
  id bigint generated always as identity primary key,
  household_id bigint not null references households (id) on delete cascade,
  date date not null,
  slot text not null check (slot in ('breakfast', 'lunch', 'dinner', 'snack')),
  recipe_id bigint references recipes (id) on delete set null,
  title text not null,
  servings int not null default 2,
  status text not null default 'planned' check (status in ('planned', 'cooked', 'skipped'))
);

create index plan_entries_date_idx on plan_entries (household_id, date);

-- What actually got eaten. Unique on the day and slot: a day has one dinner,
-- so logging a second replaces the first rather than stacking.
create table meal_days (
  id bigint generated always as identity primary key,
  household_id bigint not null references households (id) on delete cascade,
  date date not null,
  slot text not null check (slot in ('breakfast', 'lunch', 'dinner', 'snack')),
  item_id bigint references items (id) on delete set null,
  label text not null,
  created_at date not null default current_date,
  unique (household_id, date, slot)
);

create table combos (
  id bigint generated always as identity primary key,
  household_id bigint not null references households (id) on delete cascade,
  name text not null,
  emoji text not null default '🍽️',
  photo_id bigint references photos (id) on delete set null,
  -- Parts inline rather than a join table: a combination is only ever read
  -- whole, and there is nothing to query a single part by.
  parts jsonb not null default '[]'::jsonb,
  meal text check (meal in ('breakfast', 'lunch', 'dinner', 'snack')),
  notes text,
  created_at date not null default current_date,
  times_used int not null default 0,
  last_used_at date,
  source text not null default 'custom' check (source in ('custom', 'suggested'))
);

-- ---------------------------------------------------------------------------
-- Shopping and history
-- ---------------------------------------------------------------------------

create table shop_items (
  id bigint generated always as identity primary key,
  household_id bigint not null references households (id) on delete cascade,
  name text not null,
  qty numeric not null default 1,
  unit text not null default 'ea',
  category text not null default 'other',
  checked boolean not null default false,
  source text not null default 'manual' check (source in ('manual', 'staple', 'plan')),
  reason text,
  est_price numeric,
  item_id bigint references items (id) on delete set null
);

create table trips (
  id bigint generated always as identity primary key,
  household_id bigint not null references households (id) on delete cascade,
  date date not null default current_date,
  store text not null default '',
  total numeric not null default 0,
  item_count int not null default 0
);

-- Append-only. Every figure on the Insights screen is derived from this, which
-- is why nothing here is ever updated or deleted.
create table ledger_events (
  id bigint generated always as identity primary key,
  household_id bigint not null references households (id) on delete cascade,
  type text not null check (type in ('purchase', 'consume', 'waste', 'adjust')),
  item_id bigint,
  name text not null,
  category text not null,
  qty numeric not null,
  unit text not null,
  value numeric not null default 0,
  date date not null default current_date,
  reason text
);

create index ledger_events_date_idx on ledger_events (household_id, date);

create table settings (
  household_id bigint not null references households (id) on delete cascade,
  key text not null,
  value text not null default '',
  primary key (household_id, key)
);

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- Every table is closed by default and opened only to members of the owning
-- household. The anon key is published in a static site, so these policies are
-- the only thing standing between a kitchen and the internet.
-- ---------------------------------------------------------------------------

alter table households enable row level security;
alter table household_members enable row level security;
alter table places enable row level security;
alter table categories enable row level security;
alter table people enable row level security;
alter table photos enable row level security;
alter table items enable row level security;
alter table reservations enable row level security;
alter table recipes enable row level security;
alter table plan_entries enable row level security;
alter table meal_days enable row level security;
alter table combos enable row level security;
alter table shop_items enable row level security;
alter table trips enable row level security;
alter table ledger_events enable row level security;
alter table settings enable row level security;

create policy households_read on households
  for select to authenticated using (id in (select auth_household_ids()));

create policy household_members_read on household_members
  for select to authenticated using (user_id = auth.uid());

do $$
declare
  t text;
begin
  foreach t in array array[
    'places', 'categories', 'people', 'photos', 'items', 'reservations',
    'recipes', 'plan_entries', 'meal_days', 'combos', 'shop_items', 'trips',
    'ledger_events', 'settings'
  ]
  loop
    execute format(
      'create policy %1$s_rw on %1$I for all to authenticated
         using (household_id in (select auth_household_ids()))
         with check (household_id in (select auth_household_ids()))', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Signing up creates the household
--
-- Done in a trigger rather than in the client: a client that created its own
-- household could be interrupted between the two writes and leave an account
-- that can see nothing, with no way to recover from inside the app.
-- ---------------------------------------------------------------------------

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_household bigint;
begin
  insert into households (name) values ('Our kitchen') returning id into new_household;
  insert into household_members (household_id, user_id) values (new_household, new.id);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Photo storage
--
-- Private, not public: a public bucket would serve every photo to anyone with
-- a URL, which quietly undoes the row-level security above. Objects are keyed
-- by household id so a policy can check the first path segment.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

create policy photos_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] in (
      select household_id::text from household_members where user_id = auth.uid()
    )
  );

create policy photos_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] in (
      select household_id::text from household_members where user_id = auth.uid()
    )
  );

create policy photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] in (
      select household_id::text from household_members where user_id = auth.uid()
    )
  );
