-- Migration 0014: durable rate-limit counters.
--
-- The limiters lived in process memory, so every deploy reset them. Keryx deploys per change, and
-- the throttled paths are the treasury-funded ones (anonymous /api/ask, the chat front doors, the
-- unkeyed A2A endpoint) — a caller who kept looping only had to wait for the next restart to get a
-- fresh allowance. Counters also could not be shared: the web process and the traction daemon each
-- kept their own. Persisting the window fixes both.
--
-- Fixed window, not a sliding one: a single row per bucket, no per-request history to sweep.

create table if not exists public.rate_limit_counters (
  bucket   text primary key,       -- "<tier>:<key>", e.g. "treasuryAsk:1.2.3.4"
  count    integer not null,       -- points spent in the current window
  reset_at bigint  not null        -- unix ms the window closes
);

create index if not exists rate_limit_counters_reset on public.rate_limit_counters (reset_at);

-- Atomic consume. A read-modify-write from the application would admit both of two concurrent
-- requests on an already-exhausted bucket, which is exactly the case the limit exists to stop.
create or replace function public.consume_rate_limit(
  p_bucket text,
  p_points integer,
  p_window_ms bigint,
  p_now bigint
)
returns table (allowed boolean, ms_before_next bigint)
language plpgsql
as $$
declare
  v_count    integer;
  v_reset_at bigint;
begin
  insert into public.rate_limit_counters (bucket, count, reset_at)
       values (p_bucket, 1, p_now + p_window_ms)
  on conflict (bucket) do update
       set count    = case when public.rate_limit_counters.reset_at <= p_now then 1
                           else public.rate_limit_counters.count + 1 end,
           reset_at = case when public.rate_limit_counters.reset_at <= p_now
                           then p_now + p_window_ms
                           else public.rate_limit_counters.reset_at end
    returning count, reset_at into v_count, v_reset_at;

  return query select v_count <= p_points, greatest(0, v_reset_at - p_now);
end;
$$;
