-- Additive optional account details. Version matches the applied cloud migration.
-- Existing IDs, rows, permissions and RLS
-- remain unchanged. Empty defaults also keep older FieldFlow clients compatible.
set local lock_timeout = '5s';

alter table public.customers
  add column if not exists preferred_supplier text not null default ''
    check (char_length(preferred_supplier) <= 200),
  add column if not exists additional_contact text not null default ''
    check (char_length(additional_contact) <= 120),
  add column if not exists additional_phone text not null default ''
    check (char_length(additional_phone) <= 40),
  add column if not exists additional_email text not null default ''
    check (char_length(additional_email) <= 254);

comment on column public.customers.preferred_supplier is 'Optional preferred supplier or distributor for this venue.';
comment on column public.customers.additional_contact is 'Optional second contact; does not replace the primary contact.';
comment on column public.customers.additional_phone is 'Optional second contact phone; never a silent fallback recipient.';
comment on column public.customers.additional_email is 'Optional second contact email; never a silent fallback recipient.';
