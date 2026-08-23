-- An unnamed scan should not lose the shop it came from.
--
-- The rapid scanner parks anything Open Food Facts can't name in the inbox, and
-- naming it can happen days later. Without this the item would arrive in the
-- kitchen with no trip, so "what did this shop bring home?" would answer with
-- whatever happened to be recognised at the till and quietly omit the rest.
alter table public.inbox_items
  add column if not exists trip_id bigint references public.trips (id) on delete set null;
