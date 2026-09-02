-- Make the quota ledger's deny-by-default intent explicit to RLS tooling.
create policy fieldflow_user_usage_deny_all
on public.fieldflow_user_usage
for all
to authenticated
using (false)
with check (false);
