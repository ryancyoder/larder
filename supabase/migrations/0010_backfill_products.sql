-- Every item gets a catalogue entry.
--
-- The catalogue arrived after the stock did, and three write paths never
-- learned about it — a manual add, a shopping-list checkout, and the rapid
-- scanner. Between them they left 24 of 67 items pointing at nothing, which is
-- how a kitchen ends up holding food the catalogue has never heard of.
--
-- `addItem` now upserts a product for any caller that does not supply one, so
-- this cannot recur. This migration deals with what was already there.
--
-- One product per distinct name, carrying whatever the item already knew.
-- Barcodes come along, so a later scan of the same packet resolves against this
-- row instead of creating a second one.
with groups as (
  select lower(trim(name)) as key,
         (array_agg(name order by id))[1] as name,
         (array_agg(brand order by id) filter (where brand is not null))[1] as brand,
         (array_agg(barcode order by id) filter (where barcode is not null))[1] as barcode,
         (array_agg(category order by id))[1] as category,
         (array_agg(food_key order by id) filter (where food_key is not null))[1] as food_key,
         (array_agg(unit order by id))[1] as unit,
         (array_agg(size order by id) filter (where size is not null))[1] as size,
         (array_agg(size_unit order by id) filter (where size_unit is not null))[1] as size_unit,
         (array_agg(nutrition order by id) filter (where nutrition is not null))[1] as nutrition,
         (array_agg(photo_id order by id) filter (where photo_id is not null))[1] as photo_id,
         bool_or(is_staple) as is_staple,
         max(par_qty) as par_qty,
         (array_agg(household_id order by id))[1] as household_id
  from items
  where product_id is null
  group by lower(trim(name))
),
made as (
  insert into products (household_id, name, brand, barcode, category, food_key,
                        unit, size, size_unit, nutrition, photo_id,
                        is_staple, par_qty, created_at)
  select household_id, name, brand, barcode, category, food_key,
         unit, size, size_unit, nutrition, photo_id,
         is_staple, par_qty, now()
  from groups
  returning id, lower(trim(name)) as key
)
update items i
   set product_id = made.id
  from made
 where i.product_id is null and lower(trim(i.name)) = made.key;
