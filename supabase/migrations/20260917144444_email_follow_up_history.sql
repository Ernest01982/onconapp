-- Manual user confirmations only; this does not send mail.
alter table public.customers
  add column if not exists email_follow_ups jsonb not null default '[]'::jsonb;

alter table public.customers
  add constraint customers_email_follow_ups_check check (
    jsonb_typeof(email_follow_ups) = 'array'
    and jsonb_array_length(email_follow_ups) <= 1000
    and octet_length(email_follow_ups::text) <= 2097152
  );

comment on column public.customers.email_follow_ups is
  'User-confirmed email history. emailMarkedSent is not delivery verification. Existing customer RLS applies.';
