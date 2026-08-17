-- The basic food an item is an instance of.
--
-- Text rather than a foreign key: the food library is reference data that ships
-- in the app, not a table a household owns. A key that stops existing should
-- leave the item intact and merely unfiled, which is what a plain column does
-- and what a constraint would not.
alter table public.items add column if not exists food_key text;

-- The one query this exists for — "what have I got of this food?" — always
-- lands inside a household.
create index if not exists items_household_food_idx
  on public.items (household_id, food_key);
