-- Reserve browser-session spend atomically. The old flow checked the cap in one query and
-- incremented after settlement, allowing two concurrent asks to both pass the same check.

create or replace function public.reserve_session_grant_spend(
  p_session_id text,
  p_amount numeric,
  p_now bigint
)
returns boolean
language plpgsql
as $$
declare
  updated int;
begin
  update public.session_grants
     set spent = round(spent + p_amount, 6)
   where session_id = p_session_id
     and expiry > p_now
     and round(spent + p_amount, 6) <= cap;
  get diagnostics updated = row_count;
  return updated > 0;
end;
$$;

create or replace function public.release_session_grant_spend(
  p_session_id text,
  p_amount numeric
)
returns void
language sql
as $$
  update public.session_grants
     set spent = greatest(0, round(spent - p_amount, 6))
   where session_id = p_session_id;
$$;

revoke all on function public.reserve_session_grant_spend(text, numeric, bigint)
  from public, anon, authenticated;
revoke all on function public.release_session_grant_spend(text, numeric)
  from public, anon, authenticated;
grant execute on function public.reserve_session_grant_spend(text, numeric, bigint)
  to service_role;
grant execute on function public.release_session_grant_spend(text, numeric)
  to service_role;
