-- A friendly name, beside the catalogue one.
--
-- `products.name` is what the source called it: Open Food Facts writes the full
-- label — brand, variant, pack size, all of it — and a till writes 22 characters
-- of consonants. Both are the right thing to keep, because they are what the
-- record actually said and they are how the product is found again.
--
-- Neither is what anyone wants to read on a shelf. `display_name` is the short
-- one: derived from those sources rather than typed, and overridable when the
-- derivation gets it wrong.
--
-- Null means "nobody has derived one yet", and callers fall back to `name` —
-- so an empty column is a missing convenience, never a missing product.
alter table public.products
  add column if not exists display_name text;

comment on column public.products.display_name is
  'Short human-readable name. Falls back to name when null.';
