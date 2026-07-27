-- Atomically reserve anonymous onramp claims. A transaction-scoped advisory lock serializes the
-- low-volume daily bucket, covering both the per-address uniqueness check and cap increment.

create or replace function public.reserve_onramp(
  p_address_key text,
  p_day_key text,
  p_amount numeric,
  p_daily_cap numeric,
  p_now bigint
)
returns text
language plpgsql
as $$
declare
  v_total numeric;
begin
  perform pg_advisory_xact_lock(hashtext(p_day_key));
  if exists (select 1 from public.sync_state where key = p_address_key) then
    return 'already-funded';
  end if;
  select coalesce(value::numeric, 0) into v_total
    from public.sync_state where key = p_day_key;
  v_total := coalesce(v_total, 0);
  if v_total + p_amount > p_daily_cap then
    return 'daily-cap';
  end if;
  insert into public.sync_state (key, value, updated_at)
    values (p_address_key, p_now::text, now());
  insert into public.sync_state (key, value, updated_at)
    values (p_day_key, (v_total + p_amount)::text, now())
    on conflict (key) do update
      set value = excluded.value, updated_at = excluded.updated_at;
  return 'reserved';
end;
$$;

create or replace function public.release_onramp(
  p_address_key text,
  p_day_key text,
  p_amount numeric
)
returns void
language plpgsql
as $$
declare
  v_total numeric;
begin
  perform pg_advisory_xact_lock(hashtext(p_day_key));
  delete from public.sync_state where key = p_address_key;
  select coalesce(value::numeric, 0) into v_total
    from public.sync_state where key = p_day_key;
  update public.sync_state
     set value = greatest(0, coalesce(v_total, 0) - p_amount)::text,
         updated_at = now()
   where key = p_day_key;
end;
$$;

revoke all on function public.reserve_onramp(text, text, numeric, numeric, bigint)
  from public, anon, authenticated;
revoke all on function public.release_onramp(text, text, numeric)
  from public, anon, authenticated;
grant execute on function public.reserve_onramp(text, text, numeric, numeric, bigint)
  to service_role;
grant execute on function public.release_onramp(text, text, numeric)
  to service_role;
