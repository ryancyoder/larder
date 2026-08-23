-- Whether Open Food Facts actually knows a product.
--
-- The catalogue needs to answer this plainly, and until now it could only be
-- inferred from whether `nutrition` came back — which is wrong in both
-- directions. A product can be in Open Food Facts and declare nothing worth
-- storing (`readNutrition` returns undefined for those), and a product can
-- carry nutrition typed in by hand.
--
-- Three states, so null means something:
--   null      — never looked up, because nobody has scanned a barcode yet
--   'found'   — Open Food Facts returned a product
--   'missing' — asked, and it does not know this barcode
--
-- That distinction is the useful one for an ALDI household: almost everything
-- is own-brand, so 'missing' is the expected answer and needs to read as a
-- settled fact rather than as work still outstanding.
alter table public.products
  add column if not exists off_status text
  check (off_status in ('found', 'missing'));

comment on column public.products.off_status is
  'Open Food Facts lookup result. Null means never asked.';
