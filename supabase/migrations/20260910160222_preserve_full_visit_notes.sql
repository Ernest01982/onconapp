-- Additive: old summaries remain unchanged; missing original notes cannot be recovered.
alter table public.visits add column if not exists raw_note text;
alter table public.visits add constraint visits_raw_note_length check (char_length(raw_note) <= 4000);
drop trigger if exists app_state_set_updated_at on public.app_state;
create trigger app_state_set_updated_at before update on public.app_state
for each row execute function public.set_updated_at();
