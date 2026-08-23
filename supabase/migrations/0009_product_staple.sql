-- Staple-ness belongs to the product, not to the jar.
--
-- "We always keep milk in" is a fact about milk. It was recorded per item, so
-- it had to be re-decided on every carton, and two cartons of the same thing
-- could disagree — one starred, one not, with the shopping list following
-- whichever it happened to read.
--
-- The par level moves with it for the same reason: "keep two in" is one number
-- about one product, not a number per purchase.
--
-- `items.is_staple` and `items.par_qty` stay. They are the fallback for stock
-- with no catalogue entry — a one-off from a market stall — and they are what
-- older rows already carry.
alter table public.products
  add column if not exists is_staple boolean not null default false;
alter table public.products
  add column if not exists par_qty numeric;

-- The shopping list asks "which of my staples are low?" on every build.
create index if not exists products_household_staple_idx
  on public.products (household_id) where is_staple;

-- Carry across whatever was already marked on stock, so nothing is lost.
update public.products p
   set is_staple = true,
       par_qty = coalesce(p.par_qty, sub.par_qty)
  from (
    select product_id, max(par_qty) as par_qty
    from public.items
    where product_id is not null and is_staple
    group by product_id
  ) sub
 where p.id = sub.product_id and p.is_staple = false;
