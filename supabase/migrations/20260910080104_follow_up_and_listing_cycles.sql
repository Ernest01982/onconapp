-- Additive visit follow-up and menu/listing-cycle fields.
-- Existing records remain valid; defaults preserve the current app behaviour.

alter table public.customers
  add column if not exists menu_change_date date,
  add column if not exists menu_change_month text not null default '',
  add column if not exists listings_reopen_at timestamptz,
  add column if not exists listing_reminder_days smallint not null default 60,
  add column if not exists listing_cycle_notes text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'customers_listing_cycle_check'
      and conrelid = 'public.customers'::regclass
  ) then
    alter table public.customers add constraint customers_listing_cycle_check check (
      (menu_change_month = '' or menu_change_month ~ '^\d{4}-(0[1-9]|1[0-2])$') and
      listing_reminder_days in (30, 60, 90) and
      octet_length(listing_cycle_notes) <= 8192
    );
  end if;
end $$;

alter table public.visits
  add column if not exists contact_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists feedback_outcome text not null default '',
  add column if not exists current_wine_ids text[] not null default '{}'::text[],
  add column if not exists samples_left_wine_ids text[] not null default '{}'::text[],
  add column if not exists follow_up_required boolean not null default false,
  add column if not exists follow_up_reason text not null default '',
  add column if not exists follow_up_contact text not null default '',
  add column if not exists follow_up_task_id text,
  add column if not exists follow_up_completed boolean not null default false,
  add column if not exists menu_change_date date,
  add column if not exists menu_change_month text not null default '',
  add column if not exists listings_reopen_at timestamptz,
  add column if not exists listing_reminder_days smallint not null default 60;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'visits_sales_snapshot_check'
      and conrelid = 'public.visits'::regclass
  ) then
    alter table public.visits add constraint visits_sales_snapshot_check check (
      jsonb_typeof(contact_snapshot) = 'object' and
      octet_length(contact_snapshot::text) <= 16384 and
      octet_length(feedback_outcome) <= 1024 and
      cardinality(current_wine_ids) <= 100 and
      cardinality(samples_left_wine_ids) <= 100 and
      octet_length(array_to_string(current_wine_ids, ',')) <= 16384 and
      octet_length(array_to_string(samples_left_wine_ids, ',')) <= 16384 and
      octet_length(follow_up_reason) <= 4096 and
      octet_length(follow_up_contact) <= 512 and
      (follow_up_task_id is null or octet_length(follow_up_task_id) <= 128) and
      (menu_change_month = '' or menu_change_month ~ '^\d{4}-(0[1-9]|1[0-2])$') and
      listing_reminder_days in (30, 60, 90) and
      (not follow_up_required or follow_up_at is not null)
    );
  end if;
end $$;

alter table public.tasks
  add column if not exists reminder_type text not null default 'followup',
  add column if not exists reason text not null default '',
  add column if not exists contact_person text not null default '',
  add column if not exists reschedule_history jsonb not null default '[]'::jsonb;

update public.tasks set reason = title where reason = '';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tasks_follow_up_details_check'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks add constraint tasks_follow_up_details_check check (
      reminder_type = 'followup' and
      octet_length(reason) <= 4096 and
      octet_length(contact_person) <= 512 and
      jsonb_typeof(reschedule_history) = 'array' and
      jsonb_array_length(reschedule_history) <= 50 and
      octet_length(reschedule_history::text) <= 65536
    );
  end if;
end $$;

create index if not exists customers_user_listings_reopen_idx
  on public.customers(user_id, listings_reopen_at)
  where listings_reopen_at is not null;

create index if not exists customers_user_menu_change_idx
  on public.customers(user_id, menu_change_date)
  where menu_change_date is not null;

-- Existing table-level authenticated grants include the new columns. Anonymous
-- access remains revoked and the existing per-user RLS policies still apply.

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
