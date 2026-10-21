-- Additive photo storage; existing CRM rows are not modified.
create table public.wine_list_photos (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  customer_id text not null,
  visit_id text,
  slot smallint not null check (slot between 1 and 30),
  filename text not null check (char_length(filename) between 1 and 180),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  bytes integer not null check (bytes between 1 and 2097152),
  captured_at timestamptz not null,
  primary key (user_id,id),
  unique (user_id,customer_id,slot),
  foreign key (user_id,customer_id) references public.customers(user_id,id)
);
alter table public.wine_list_photos enable row level security;
revoke all on public.wine_list_photos from public, anon, authenticated;
grant select,insert,delete on public.wine_list_photos to authenticated;
create policy photo_owner_read on public.wine_list_photos for select to authenticated using ((select auth.uid())=user_id);
create policy photo_owner_insert on public.wine_list_photos for insert to authenticated with check ((select auth.uid())=user_id);
create policy photo_owner_delete on public.wine_list_photos for delete to authenticated using ((select auth.uid())=user_id);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('fieldflow-wine-lists','fieldflow-wine-lists',false,2097152,array['image/jpeg']);
create policy wine_photo_read on storage.objects for select to authenticated
using (bucket_id='fieldflow-wine-lists' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy wine_photo_insert on storage.objects for insert to authenticated
with check (bucket_id='fieldflow-wine-lists' and (storage.foldername(name))[1]=(select auth.uid())::text and name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}[.]jpg$');
create policy wine_photo_delete on storage.objects for delete to authenticated
using (bucket_id='fieldflow-wine-lists' and (storage.foldername(name))[1]=(select auth.uid())::text);
