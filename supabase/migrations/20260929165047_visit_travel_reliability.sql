-- Additive only: no historical visit times, notes or travel records are changed.
alter table public.visits
  add column time_corrections jsonb not null default '[]'::jsonb,
  add column location_capture jsonb not null default '{}'::jsonb,
  add constraint visits_time_corrections_size check (jsonb_typeof(time_corrections)='array' and jsonb_array_length(time_corrections)<=100 and octet_length(time_corrections::text)<=262144),
  add constraint visits_location_capture_size check (jsonb_typeof(location_capture)='object' and octet_length(location_capture::text)<=4096);
alter table public.travel_trips
  add column recording_flags jsonb not null default '[]'::jsonb,
  add constraint travel_recording_flags_size check (jsonb_typeof(recording_flags)='array' and jsonb_array_length(recording_flags)<=20 and octet_length(recording_flags::text)<=4096);
