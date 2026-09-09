-- Additive FieldFlow upgrade for wine placements and auditable business travel.
-- Existing customers, visits, tasks and trips remain valid and unchanged.

alter table public.visits
  add column wine_outcomes jsonb not null default '[]'::jsonb;

alter table public.visits
  add constraint visits_wine_outcomes_size_check check (
    jsonb_typeof(wine_outcomes) = 'array' and
    jsonb_array_length(wine_outcomes) <= 100 and
    octet_length(wine_outcomes::text) <= 65536
  );

alter table public.tasks
  add column wine_id text,
  add column visit_id text,
  add column completed_at timestamptz;

alter table public.tasks
  add constraint tasks_wine_visit_size_check check (
    (wine_id is null or octet_length(wine_id) <= 128) and
    (visit_id is null or octet_length(visit_id) <= 128)
  ),
  add constraint tasks_wine_fkey foreign key (user_id, wine_id)
    references public.products(user_id, id) on delete restrict;

alter table public.travel_trips
  add column customer_id text,
  add column purpose text not null default '',
  add column start_odometer numeric(12, 1),
  add column end_odometer numeric(12, 1),
  add column notes text not null default '',
  add column distance_source text not null default 'gps';

update public.travel_trips
set customer_id = coalesce(to_customer_id, from_customer_id),
    purpose = case when coalesce(to_customer_id, from_customer_id) is not null then 'Customer visit' else 'Business travel' end
where customer_id is null;

alter table public.travel_trips
  add constraint travel_trips_business_fields_check check (
    (customer_id is null or octet_length(customer_id) <= 128) and
    octet_length(purpose) between 1 and 1024 and
    octet_length(notes) <= 8192 and
    distance_source in ('gps', 'odometer', 'manual') and
    (start_odometer is null or start_odometer between 0 and 10000000) and
    (end_odometer is null or end_odometer between 0 and 10000000) and
    ((start_odometer is null and end_odometer is null) or
      (start_odometer is not null and end_odometer is not null and end_odometer >= start_odometer))
  );

create table public.customer_wines (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  customer_id text not null,
  wine_id text not null,
  status text not null default 'Discussed',
  interest_started_at timestamptz,
  sampled_at timestamptz,
  listing_date timestamptz,
  delisting_date timestamptz,
  allocation text not null default '',
  notes text not null default '',
  follow_up_at timestamptz,
  status_history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, customer_id, wine_id),
  foreign key (user_id, customer_id) references public.customers(user_id, id) on delete cascade,
  foreign key (user_id, wine_id) references public.products(user_id, id) on delete cascade,
  constraint customer_wines_status_check check (status in (
    'Discussed', 'Interested', 'Sampled', 'Considering', 'Listed', 'Delisted', 'Not Interested'
  )),
  constraint customer_wines_size_check check (
    octet_length(id) <= 128 and
    octet_length(customer_id) <= 128 and
    octet_length(wine_id) <= 128 and
    octet_length(allocation) <= 512 and
    octet_length(notes) <= 8192 and
    jsonb_typeof(status_history) = 'array' and
    jsonb_array_length(status_history) <= 200 and
    octet_length(status_history::text) <= 131072
  )
);

create index customer_wines_user_customer_status_idx on public.customer_wines(user_id, customer_id, status);
create index customer_wines_user_wine_status_idx on public.customer_wines(user_id, wine_id, status);
create index customer_wines_user_follow_up_idx on public.customer_wines(user_id, follow_up_at)
  where follow_up_at is not null;
create index tasks_user_wine_idx on public.tasks(user_id, wine_id) where wine_id is not null;
create index travel_trips_user_customer_started_idx on public.travel_trips(user_id, customer_id, started_at desc)
  where customer_id is not null;

drop trigger if exists customer_wines_set_updated_at on public.customer_wines;
create trigger customer_wines_set_updated_at
before update on public.customer_wines
for each row execute function public.set_updated_at();

alter table public.customer_wines enable row level security;

create policy customer_wines_select_own on public.customer_wines
  for select to authenticated using ((select auth.uid()) = user_id);
create policy customer_wines_insert_own on public.customer_wines
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy customer_wines_update_own on public.customer_wines
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy customer_wines_delete_own on public.customer_wines
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.customer_wines from public, anon;
grant select, insert, update, delete on table public.customer_wines to authenticated;

create or replace function public.enforce_fieldflow_row_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_limit bigint;
  current_count bigint;
  row_exists boolean;
begin
  row_limit := case tg_table_name
    when 'customers' then 5000
    when 'visits' then 25000
    when 'tasks' then 25000
    when 'products' then 5000
    when 'travel_trips' then 5000
    when 'customer_wines' then 25000
    else null
  end;
  if row_limit is null then
    raise exception using errcode = '23514', message = 'FieldFlow row quota is not configured for this table';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text || ':' || tg_table_name, 0)
  );
  execute pg_catalog.format(
    'select exists(select 1 from %I.%I where user_id = $1 and id = $2)', tg_table_schema, tg_table_name
  ) into row_exists using new.user_id, new.id;
  if row_exists then return new; end if;

  execute pg_catalog.format(
    'select count(*) from %I.%I where user_id = $1', tg_table_schema, tg_table_name
  ) into current_count using new.user_id;
  if current_count >= row_limit then
    raise exception using errcode = '23514', message = 'FieldFlow account row limit reached';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_fieldflow_row_quota() from public, anon, authenticated;

create trigger customer_wines_10_row_quota
before insert on public.customer_wines
for each row execute function public.enforce_fieldflow_row_quota();
create trigger customer_wines_20_storage_quota
before insert or update or delete on public.customer_wines
for each row execute function public.enforce_fieldflow_storage_quota();

insert into public.fieldflow_user_usage (user_id, approximate_bytes)
select user_id, least(sum(row_bytes)::bigint, 209715200)
from (
  select user_id, pg_column_size(p.*)::bigint as row_bytes from public.profiles p
  union all select user_id, pg_column_size(c.*)::bigint from public.customers c
  union all select user_id, pg_column_size(v.*)::bigint from public.visits v
  union all select user_id, pg_column_size(t.*)::bigint from public.tasks t
  union all select user_id, pg_column_size(p.*)::bigint from public.products p
  union all select user_id, pg_column_size(t.*)::bigint from public.travel_trips t
  union all select user_id, pg_column_size(a.*)::bigint from public.app_state a
  union all select user_id, pg_column_size(cw.*)::bigint from public.customer_wines cw
) rows
group by user_id
on conflict (user_id) do update
set approximate_bytes = excluded.approximate_bytes,
    updated_at = now();
