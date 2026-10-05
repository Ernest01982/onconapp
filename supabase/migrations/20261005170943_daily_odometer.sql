-- Additive; existing trip records, claims and permissions remain unchanged.
alter table public.travel_trips
  add column daily_log jsonb not null default '{}'::jsonb,
  add constraint travel_daily_log_shape check (
    jsonb_typeof(daily_log) = 'object' and octet_length(daily_log::text) <= 4096
  );
