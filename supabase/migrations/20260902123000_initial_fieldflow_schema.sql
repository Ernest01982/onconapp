-- FieldFlow / OnconApp initial single-user CRM schema.
-- Every API-facing row is owned by auth.uid() and protected by RLS.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  initials text not null default '',
  territory text not null default '',
  rate_per_km numeric(10, 2) not null default 4.90 check (rate_per_km >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  name text not null,
  area text not null default '',
  customer_type text not null default 'Other',
  address text not null default '',
  contact_name text not null default '',
  contact_role text not null default '',
  email text not null default '',
  phone text not null default '',
  last_visit timestamptz,
  opportunity text not null default '',
  opportunity_value numeric(14, 2) not null default 0 check (opportunity_value >= 0),
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint customers_latitude_check check (latitude is null or latitude between -90 and 90),
  constraint customers_longitude_check check (longitude is null or longitude between -180 and 180)
);

create table if not exists public.visits (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  customer_id text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  latitude double precision,
  longitude double precision,
  summary text not null default '',
  products text[] not null default '{}',
  outcome text not null default '',
  next_action text not null default '',
  follow_up_at timestamptz,
  source text not null default 'typed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, customer_id) references public.customers(user_id, id) on delete cascade
);

create table if not exists public.tasks (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  customer_id text not null,
  title text not null,
  due_at timestamptz not null,
  completed boolean not null default false,
  priority text not null default 'Next',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, customer_id) references public.customers(user_id, id) on delete cascade
);

create table if not exists public.products (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  sku text not null default '',
  name text not null,
  brand text not null default '',
  product_range text not null default '',
  pack_count integer,
  size text not null default '',
  pack text not null default '',
  ex_case numeric(14, 2),
  ex_unit numeric(14, 2),
  case_price numeric(14, 2),
  unit_price numeric(14, 2),
  price_indicator text not null default '',
  case_barcode text not null default '',
  unit_barcode text not null default '',
  pack_barcode text not null default '',
  availability text not null default '',
  vat boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.travel_trips (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  points jsonb not null default '[]'::jsonb,
  from_customer_id text,
  to_customer_id text,
  from_label text not null default '',
  to_label text not null default '',
  distance_km numeric(12, 3) not null default 0 check (distance_km >= 0),
  rate_per_km numeric(10, 2) not null default 4.90 check (rate_per_km >= 0),
  reimbursement numeric(14, 2) not null default 0 check (reimbursement >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_visit jsonb,
  active_trip jsonb,
  last_position jsonb,
  chat jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists visits_user_started_idx on public.visits(user_id, started_at desc);
create index if not exists visits_user_customer_idx on public.visits(user_id, customer_id, started_at desc);
create index if not exists tasks_user_due_idx on public.tasks(user_id, completed, due_at);
create index if not exists travel_trips_user_started_idx on public.travel_trips(user_id, started_at desc);
create index if not exists customers_user_last_visit_idx on public.customers(user_id, last_visit nulls first);
create index if not exists products_user_name_idx on public.products(user_id, name);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at before update on public.customers for each row execute function public.set_updated_at();
drop trigger if exists visits_set_updated_at on public.visits;
create trigger visits_set_updated_at before update on public.visits for each row execute function public.set_updated_at();
drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at before update on public.tasks for each row execute function public.set_updated_at();
drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at before update on public.products for each row execute function public.set_updated_at();
drop trigger if exists travel_trips_set_updated_at on public.travel_trips;
create trigger travel_trips_set_updated_at before update on public.travel_trips for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.visits enable row level security;
alter table public.tasks enable row level security;
alter table public.products enable row level security;
alter table public.travel_trips enable row level security;
alter table public.app_state enable row level security;

create policy profiles_select_own on public.profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy profiles_insert_own on public.profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy profiles_update_own on public.profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy profiles_delete_own on public.profiles for delete to authenticated using ((select auth.uid()) = user_id);

create policy customers_select_own on public.customers for select to authenticated using ((select auth.uid()) = user_id);
create policy customers_insert_own on public.customers for insert to authenticated with check ((select auth.uid()) = user_id);
create policy customers_update_own on public.customers for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy customers_delete_own on public.customers for delete to authenticated using ((select auth.uid()) = user_id);

create policy visits_select_own on public.visits for select to authenticated using ((select auth.uid()) = user_id);
create policy visits_insert_own on public.visits for insert to authenticated with check ((select auth.uid()) = user_id);
create policy visits_update_own on public.visits for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy visits_delete_own on public.visits for delete to authenticated using ((select auth.uid()) = user_id);

create policy tasks_select_own on public.tasks for select to authenticated using ((select auth.uid()) = user_id);
create policy tasks_insert_own on public.tasks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy tasks_update_own on public.tasks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy tasks_delete_own on public.tasks for delete to authenticated using ((select auth.uid()) = user_id);

create policy products_select_own on public.products for select to authenticated using ((select auth.uid()) = user_id);
create policy products_insert_own on public.products for insert to authenticated with check ((select auth.uid()) = user_id);
create policy products_update_own on public.products for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy products_delete_own on public.products for delete to authenticated using ((select auth.uid()) = user_id);

create policy travel_trips_select_own on public.travel_trips for select to authenticated using ((select auth.uid()) = user_id);
create policy travel_trips_insert_own on public.travel_trips for insert to authenticated with check ((select auth.uid()) = user_id);
create policy travel_trips_update_own on public.travel_trips for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy travel_trips_delete_own on public.travel_trips for delete to authenticated using ((select auth.uid()) = user_id);

create policy app_state_select_own on public.app_state for select to authenticated using ((select auth.uid()) = user_id);
create policy app_state_insert_own on public.app_state for insert to authenticated with check ((select auth.uid()) = user_id);
create policy app_state_update_own on public.app_state for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy app_state_delete_own on public.app_state for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.profiles, public.customers, public.visits, public.tasks, public.products, public.travel_trips, public.app_state from anon;
grant select, insert, update, delete on table public.profiles, public.customers, public.visits, public.tasks, public.products, public.travel_trips, public.app_state to authenticated;
