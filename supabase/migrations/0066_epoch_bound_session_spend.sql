-- A browser authorization may reserve or release only the exact grant it captured.
-- Drop the older session-id-only RPCs so no caller can bypass the generation fence.
drop function if exists public.add_session_grant_spend(text, numeric);
drop function if exists public.reserve_session_grant_spend(text, numeric, bigint);
drop function if exists public.release_session_grant_spend(text, numeric);

create function public.reserve_session_grant_spend(
  p_session_id text,
  p_grant_epoch text,
  p_sess_addr text,
  p_amount numeric,
  p_now bigint
)
returns boolean
language plpgsql
security invoker
as $$
declare
  updated integer;
begin
  update public.session_grants
     set spent = round(spent + p_amount, 6)
   where session_id = p_session_id
     and grant_epoch = p_grant_epoch
     and lower(sess_addr) = lower(p_sess_addr)
     and expiry > p_now
     and round(spent + p_amount, 6) <= cap;
  get diagnostics updated = row_count;
  return updated > 0;
end;
$$;

create function public.release_session_grant_spend(
  p_session_id text,
  p_grant_epoch text,
  p_sess_addr text,
  p_amount numeric
)
returns void
language sql
security invoker
as $$
  update public.session_grants
     set spent = greatest(0, round(spent - p_amount, 6))
   where session_id = p_session_id
     and grant_epoch = p_grant_epoch
     and lower(sess_addr) = lower(p_sess_addr);
$$;

revoke all on function public.reserve_session_grant_spend(text, text, text, numeric, bigint)
  from public, anon, authenticated;
revoke all on function public.release_session_grant_spend(text, text, text, numeric)
  from public, anon, authenticated;
grant execute on function public.reserve_session_grant_spend(text, text, text, numeric, bigint)
  to service_role;
grant execute on function public.release_session_grant_spend(text, text, text, numeric)
  to service_role;
