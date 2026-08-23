-- A master catalogue of the products this household buys.
--
-- Two problems, one table.
--
-- The first is the receipt one. An ALDI receipt carries a six-digit item number
-- rather than a UPC, so nothing on it resolves against Open Food Facts. That
-- number is stable, though — the same tub of hummus is 343825 every week — so
-- once someone scans the real barcode off the packet a single time, every
-- future receipt carrying 343825 can be resolved without asking again.
--
-- The second is older and worse. `addItem` creates a new row per purchase, so
-- buying carrots monthly leaves twelve rows called "Carrots", eleven of them at
-- zero. Stock rows are per-purchase on purpose — two cartons of milk bought a
-- fortnight apart expire on different days — but the *identity* of the thing
-- being bought was never recorded anywhere. This is where it goes.
--
-- Stock still gets a row per purchase. It now points at what it is.

create table if not exists products (
  id bigint generated always as identity primary key,
  household_id bigint not null references households (id) on delete cascade,

  name text not null,
  brand text,

  -- The real product barcode, once known. Null until someone scans one, which
  -- is the whole point: an unlearned product is one that still needs a look.
  barcode text,

  -- The till's own item number, and the chain it belongs to. Meaningless
  -- without each other — ALDI's 514025 is not Target's 514025.
  store text,
  sku text,

  category text not null default 'other',
  food_key text,

  unit text not null default 'ea',
  size numeric,
  size_unit text,
  nutrition jsonb,
  photo_id bigint references photos (id) on delete set null,

  -- Cheap history, so the catalogue can be sorted by what actually gets bought.
  times_bought int not null default 0,
  last_bought_at date,
  last_price numeric,

  created_at timestamptz not null default now()
);

-- One product per till code, and per barcode. Partial, because most rows will
-- have one identifier or the other rather than both — which is exactly the gap
-- the scan closes.
create unique index if not exists products_household_store_sku_idx
  on products (household_id, store, sku) where sku is not null;
create unique index if not exists products_household_barcode_idx
  on products (household_id, barcode) where barcode is not null;
create index if not exists products_household_name_idx
  on products (household_id, lower(name));

-- `set null` everywhere: losing the catalogue entry must never take the food
-- off the shelf, or the photo with it.
alter table public.items
  add column if not exists product_id bigint references products (id) on delete set null;
create index if not exists items_household_product_idx
  on public.items (household_id, product_id);

-- The inbox is where an unrecognised receipt line waits for its one-time scan,
-- so it has to carry enough of that line to become stock afterwards.
alter table public.inbox_items
  add column if not exists product_id bigint references products (id) on delete set null;
alter table public.inbox_items add column if not exists sku text;
alter table public.inbox_items add column if not exists store text;
alter table public.inbox_items add column if not exists price numeric;

alter table products enable row level security;

create policy products_rw on products for all to authenticated
  using (household_id in (select private.auth_household_ids()))
  with check (household_id in (select private.auth_household_ids()));

-- New tables are not added to the realtime publication automatically, and a
-- channel that is subscribed but never delivers looks exactly like one that
-- works until you check.
alter publication supabase_realtime add table products;
