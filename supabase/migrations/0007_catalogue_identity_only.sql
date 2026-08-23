-- The catalogue holds identity, not quantity.
--
-- `products` had grown three counters — times_bought, last_bought_at,
-- last_price — which are facts about *purchases*, not about what a product is.
-- Every one of them duplicates something `items` already records per purchase,
-- with the usual consequence of a denormalised copy: it drifts. `times_bought`
-- was incremented by the line quantity rather than by one, so a product bought
-- twice in twos read "4×" while claiming to count shops.
--
-- Nothing is lost. Every item carries product_id, price and purchased_at, so
-- "how often" and "what did it cost" are a query away and answer from the
-- record that was always authoritative.
--
-- Size and unit stay. They describe what the product *is* — an 8 oz block is a
-- different product from a 16 oz one, and gets its own item number — and do not
-- change when you buy more of it.
alter table public.products drop column if exists times_bought;
alter table public.products drop column if exists last_bought_at;
alter table public.products drop column if exists last_price;
