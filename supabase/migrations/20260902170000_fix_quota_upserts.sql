-- ON CONFLICT runs both INSERT and UPDATE triggers. Charge/count only a truly new row.
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
  record_id text;
  row_exists boolean;
begin
  owner_id := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(owner_id::text || ':' || tg_table_name, 0)
  );

  if tg_op = 'INSERT' then
    record_id := pg_catalog.to_jsonb(new)->>'id';
    if record_id is null then
      execute pg_catalog.format(
        'select exists(select 1 from %I.%I where user_id = $1)', tg_table_schema, tg_table_name
      ) into row_exists using owner_id;
    else
      execute pg_catalog.format(
        'select exists(select 1 from %I.%I where user_id = $1 and id = $2)', tg_table_schema, tg_table_name
      ) into row_exists using owner_id, record_id;
    end if;
    if row_exists then return new; end if;
    delta_bytes := pg_catalog.pg_column_size(new)::bigint;
  elsif tg_op = 'UPDATE' then
    if old.user_id <> new.user_id then
      raise exception using errcode = '23514', message = 'FieldFlow row ownership cannot be changed';
    end if;
    delta_bytes := pg_catalog.pg_column_size(new)::bigint - pg_catalog.pg_column_size(old)::bigint;
  else
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
    raise exception using errcode = '23514', message = 'FieldFlow account storage limit reached';
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
  row_exists boolean;
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
