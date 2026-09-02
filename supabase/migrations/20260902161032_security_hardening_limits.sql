-- Bound direct Data API writes for the invitation-only FieldFlow pilot.
-- RLS controls ownership; these constraints and triggers control resource use.

alter table public.profiles
  add constraint profiles_text_size_check check (
    octet_length(display_name) <= 512 and
    octet_length(initials) <= 32 and
    octet_length(territory) <= 512
  ),
  add constraint profiles_rate_upper_check check (rate_per_km <= 1000);

alter table public.customers
  add constraint customers_text_size_check check (
    octet_length(id) <= 128 and
    octet_length(name) between 1 and 512 and
    octet_length(area) <= 512 and
    octet_length(customer_type) <= 128 and
    octet_length(address) <= 2048 and
    octet_length(contact_name) <= 512 and
    octet_length(contact_role) <= 256 and
    octet_length(email) <= 512 and
    octet_length(phone) <= 128 and
    octet_length(opportunity) <= 4096
  ),
  add constraint customers_value_upper_check check (opportunity_value <= 1000000000000);

alter table public.visits
  add constraint visits_text_size_check check (
    octet_length(id) <= 128 and
    octet_length(customer_id) <= 128 and
    octet_length(summary) <= 16384 and
    octet_length(outcome) <= 4096 and
    octet_length(next_action) <= 8192 and
    octet_length(source) <= 64
  ),
  add constraint visits_products_size_check check (
    cardinality(products) <= 100 and
    octet_length(array_to_string(products, '')) <= 32768
  ),
  add constraint visits_time_order_check check (ended_at >= started_at);

alter table public.tasks
  add constraint tasks_text_size_check check (
    octet_length(id) <= 128 and
    octet_length(customer_id) <= 128 and
    octet_length(title) between 1 and 4096 and
    octet_length(priority) <= 64
  );

alter table public.products
  add constraint products_text_size_check check (
    octet_length(id) <= 128 and
    octet_length(sku) <= 256 and
    octet_length(name) between 1 and 1024 and
    octet_length(brand) <= 512 and
    octet_length(product_range) <= 512 and
    octet_length(size) <= 256 and
    octet_length(pack) <= 512 and
    octet_length(price_indicator) <= 128 and
    octet_length(case_barcode) <= 256 and
    octet_length(unit_barcode) <= 256 and
    octet_length(pack_barcode) <= 256 and
    octet_length(availability) <= 512
  ),
  add constraint products_pack_count_check check (pack_count is null or pack_count between 0 and 100000),
  add constraint products_prices_check check (
    (ex_case is null or ex_case between 0 and 1000000000) and
    (ex_unit is null or ex_unit between 0 and 1000000000) and
    (case_price is null or case_price between 0 and 1000000000) and
    (unit_price is null or unit_price between 0 and 1000000000)
  );

alter table public.travel_trips
  add constraint travel_trips_text_size_check check (
    octet_length(id) <= 128 and
    (from_customer_id is null or octet_length(from_customer_id) <= 128) and
    (to_customer_id is null or octet_length(to_customer_id) <= 128) and
    octet_length(from_label) <= 2048 and
    octet_length(to_label) <= 2048
  ),
  add constraint travel_trips_points_size_check check (
    jsonb_typeof(points) = 'array' and
    jsonb_array_length(points) <= 20000 and
    octet_length(points::text) <= 4194304
  ),
  add constraint travel_trips_amount_upper_check check (
    distance_km <= 100000 and rate_per_km <= 1000 and reimbursement <= 1000000000
  ),
  add constraint travel_trips_time_order_check check (ended_at >= started_at);

alter table public.app_state
  add constraint app_state_active_visit_size_check check (
    active_visit is null or (
      jsonb_typeof(active_visit) = 'object' and octet_length(active_visit::text) <= 131072
    )
  ),
  add constraint app_state_active_trip_size_check check (
    active_trip is null or (
      jsonb_typeof(active_trip) = 'object' and octet_length(active_trip::text) <= 4194304
    )
  ),
  add constraint app_state_last_position_size_check check (
    last_position is null or (
      jsonb_typeof(last_position) = 'object' and octet_length(last_position::text) <= 32768
    )
  ),
  add constraint app_state_chat_size_check check (
    jsonb_typeof(chat) = 'array' and
    jsonb_array_length(chat) <= 500 and
    octet_length(chat::text) <= 1048576
  );

create table public.fieldflow_user_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  approximate_bytes bigint not null default 0 check (approximate_bytes between 0 and 209715200),
  updated_at timestamptz not null default now()
);

alter table public.fieldflow_user_usage enable row level security;
revoke all on table public.fieldflow_user_usage from public, anon, authenticated;

insert into public.fieldflow_user_usage (user_id, approximate_bytes)
select user_id, sum(row_bytes)::bigint
from (
  select user_id, pg_column_size(p.*)::bigint as row_bytes from public.profiles p
  union all select user_id, pg_column_size(c.*)::bigint from public.customers c
  union all select user_id, pg_column_size(v.*)::bigint from public.visits v
  union all select user_id, pg_column_size(t.*)::bigint from public.tasks t
  union all select user_id, pg_column_size(p.*)::bigint from public.products p
  union all select user_id, pg_column_size(t.*)::bigint from public.travel_trips t
  union all select user_id, pg_column_size(a.*)::bigint from public.app_state a
) rows
group by user_id
on conflict (user_id) do update
set approximate_bytes = excluded.approximate_bytes,
    updated_at = now();

create or replace function public.enforce_fieldflow_storage_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  delta_bytes bigint;
  accepted_bytes bigint;
  owner_id uuid;
begin
  if tg_op = 'INSERT' then
    owner_id := new.user_id;
    delta_bytes := pg_catalog.pg_column_size(new)::bigint;
  elsif tg_op = 'UPDATE' then
    if old.user_id <> new.user_id then
      raise exception using errcode = '23514', message = 'FieldFlow row ownership cannot be changed';
    end if;
    owner_id := new.user_id;
    delta_bytes := pg_catalog.pg_column_size(new)::bigint - pg_catalog.pg_column_size(old)::bigint;
  else
    owner_id := old.user_id;
    delta_bytes := -pg_catalog.pg_column_size(old)::bigint;
  end if;

  insert into public.fieldflow_user_usage as usage (user_id, approximate_bytes)
  values (owner_id, greatest(delta_bytes, 0))
  on conflict (user_id) do update
    set approximate_bytes = greatest(0, usage.approximate_bytes + delta_bytes),
        updated_at = now()
    where usage.approximate_bytes + delta_bytes <= 209715200
  returning approximate_bytes into accepted_bytes;

  if accepted_bytes is null then
    raise exception using
      errcode = '23514',
      message = 'FieldFlow account storage limit reached';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.enforce_fieldflow_storage_quota() from public, anon, authenticated;

create or replace function public.enforce_fieldflow_row_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_limit bigint;
  current_count bigint;
begin
  row_limit := case tg_table_name
    when 'customers' then 5000
    when 'visits' then 25000
    when 'tasks' then 25000
    when 'products' then 5000
    when 'travel_trips' then 5000
    else null
  end;
  if row_limit is null then
    raise exception using errcode = '23514', message = 'FieldFlow row quota is not configured for this table';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text || ':' || tg_table_name, 0)
  );
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

create trigger customers_10_row_quota before insert on public.customers for each row execute function public.enforce_fieldflow_row_quota();
create trigger customers_20_storage_quota before insert or update or delete on public.customers for each row execute function public.enforce_fieldflow_storage_quota();
create trigger visits_10_row_quota before insert on public.visits for each row execute function public.enforce_fieldflow_row_quota();
create trigger visits_20_storage_quota before insert or update or delete on public.visits for each row execute function public.enforce_fieldflow_storage_quota();
create trigger tasks_10_row_quota before insert on public.tasks for each row execute function public.enforce_fieldflow_row_quota();
create trigger tasks_20_storage_quota before insert or update or delete on public.tasks for each row execute function public.enforce_fieldflow_storage_quota();
create trigger products_10_row_quota before insert on public.products for each row execute function public.enforce_fieldflow_row_quota();
create trigger products_20_storage_quota before insert or update or delete on public.products for each row execute function public.enforce_fieldflow_storage_quota();
create trigger travel_trips_10_row_quota before insert on public.travel_trips for each row execute function public.enforce_fieldflow_row_quota();
create trigger travel_trips_20_storage_quota before insert or update or delete on public.travel_trips for each row execute function public.enforce_fieldflow_storage_quota();
create trigger profiles_20_storage_quota before insert or update or delete on public.profiles for each row execute function public.enforce_fieldflow_storage_quota();
create trigger app_state_20_storage_quota before insert or update or delete on public.app_state for each row execute function public.enforce_fieldflow_storage_quota();
