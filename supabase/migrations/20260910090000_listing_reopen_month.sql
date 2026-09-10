-- Allow a rep to record a listing-reopen month when the exact day is unknown.

alter table public.customers
  add column if not exists listings_reopen_month text not null default '';

alter table public.visits
  add column if not exists listings_reopen_month text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'customers_listing_reopen_month_check'
      and conrelid = 'public.customers'::regclass
  ) then
    alter table public.customers add constraint customers_listing_reopen_month_check check (
      listings_reopen_month = '' or listings_reopen_month ~ '^\d{4}-(0[1-9]|1[0-2])$'
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'visits_listing_reopen_month_check'
      and conrelid = 'public.visits'::regclass
  ) then
    alter table public.visits add constraint visits_listing_reopen_month_check check (
      listings_reopen_month = '' or listings_reopen_month ~ '^\d{4}-(0[1-9]|1[0-2])$'
    );
  end if;
end $$;
