-- Durable provider/step circuit state.
--
-- Keryx dispatches from both the Next server and short-lived volume workers. Process memory loses
-- the failure streak when a worker exits and cannot coordinate a half-open probe across processes.
-- These rows contain health counters/timestamps only: never prompts, responses, credentials, or
-- payment state.

create table if not exists public.reasoning_circuits (
  key         text primary key,
  failures    integer not null,
  open_until  bigint not null,
  probe_until bigint not null,
  updated_at  bigint not null
);

alter table public.reasoning_circuits enable row level security;

-- Closed circuits with no row admit calls. An expired open circuit admits exactly one probe and
-- leases it long enough for the provider's complete retry budget; concurrent callers keep using
-- the next provider until that probe succeeds, fails, or its worker dies and the lease expires.
create or replace function public.acquire_reasoning_circuit(
  p_key text,
  p_now bigint,
  p_probe_ms bigint
)
returns table (allowed boolean, retry_after_ms bigint)
language plpgsql
as $$
declare
  v_open_until bigint;
  v_probe_until bigint;
begin
  select open_until, probe_until
    into v_open_until, v_probe_until
    from public.reasoning_circuits
   where key = p_key
   for update;

  if not found or (v_open_until = 0 and v_probe_until <= p_now) then
    return query select true, 0::bigint;
    return;
  end if;

  if v_open_until > p_now or v_probe_until > p_now then
    return query
      select false, greatest(0::bigint, greatest(v_open_until, v_probe_until) - p_now);
    return;
  end if;

  update public.reasoning_circuits
     set probe_until = p_now + p_probe_ms,
         updated_at = p_now
   where key = p_key;
  return query select true, 0::bigint;
end;
$$;

-- A cooldown expiring does not make an unhealthy provider healthy. The next failed probe retains
-- and increments the streak, doubling the delay up to a configured ceiling. A successful real
-- response deletes the row from the application path.
create or replace function public.record_reasoning_circuit_failure(
  p_key text,
  p_transient boolean,
  p_now bigint,
  p_threshold integer,
  p_base_cooldown_ms bigint,
  p_max_cooldown_ms bigint
)
returns table (failures integer, open_until bigint)
language plpgsql
as $$
declare
  v_previous integer;
  v_failures integer;
  v_exponent integer;
  v_cooldown bigint;
  v_open_until bigint;
begin
  insert into public.reasoning_circuits
    (key, failures, open_until, probe_until, updated_at)
  values (p_key, 0, 0, 0, p_now)
  on conflict (key) do nothing;

  select rc.failures
    into v_previous
    from public.reasoning_circuits rc
   where rc.key = p_key
   for update;

  if p_transient then
    v_failures := v_previous + 1;
  else
    v_failures := greatest(v_previous + 1, p_threshold);
  end if;
  v_exponent := greatest(0, least(20, v_failures - p_threshold));
  v_cooldown := least(
    greatest(p_base_cooldown_ms, p_max_cooldown_ms),
    p_base_cooldown_ms * (1::bigint << v_exponent)
  );
  v_open_until := case
    when v_failures >= p_threshold then p_now + v_cooldown
    else 0
  end;

  update public.reasoning_circuits
     set failures = v_failures,
         open_until = v_open_until,
         probe_until = 0,
         updated_at = p_now
   where key = p_key;

  return query select v_failures, v_open_until;
end;
$$;

revoke all on function public.acquire_reasoning_circuit(text, bigint, bigint)
  from public, anon, authenticated;
revoke all on function public.record_reasoning_circuit_failure(
  text, boolean, bigint, integer, bigint, bigint
) from public, anon, authenticated;
grant execute on function public.acquire_reasoning_circuit(text, bigint, bigint)
  to service_role;
grant execute on function public.record_reasoning_circuit_failure(
  text, boolean, bigint, integer, bigint, bigint
) to service_role;

