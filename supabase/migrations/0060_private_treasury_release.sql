-- Append-only release of never-committed budget after durable result sealing.
-- Every admitted leg stays allocated regardless of settlement status or expiry.
create table if not exists public.private_treasury_releases (
  job_id text primary key references public.private_treasury_reservations(job_id),
  amount_micros bigint not null check(amount_micros >= 0 and amount_micros <= 500000),
  released_at timestamptz not null default now()
);
alter table public.private_treasury_releases enable row level security;
revoke all on public.private_treasury_releases from public,anon,authenticated,service_role;
grant select on public.private_treasury_releases to service_role;

create or replace function public.release_private_treasury(p_id text,p_payer text,p_signer text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare budget bigint; used bigint; original bigint; n integer;
begin
  -- Share the pool lock with new reservations. Result sealing and creator admission
  -- already share the execution lock; use it here too to serialize the final snapshot.
  perform signer from public.private_treasury_pools where signer=p_signer for update;
  if not found then return false; end if;
  select r.amount_micros into budget from public.private_treasury_reservations r
    join public.private_research_intents i on i.id=r.job_id
    join public.private_research_executions e on e.id=i.id
    where r.job_id=p_id and r.signer=p_signer and i.payer=lower(p_payer) for update of e;
  if not found then return false; end if;
  if not exists(select 1 from public.private_research_results where id=p_id) then return false; end if;
  if exists(select 1 from public.private_creator_submissions where job_id=p_id and (
    (data#>>'{submission,payer}') is distinct from p_signer or
    (data#>>'{submission,amountMicros}') is distinct from amount_micros::text
  )) then raise exception 'private treasury release accounting mismatch'; end if;
  select coalesce(sum(amount_micros),0) into used from public.private_creator_submissions where job_id=p_id;
  if used > budget then raise exception 'private treasury release accounting mismatch'; end if;
  insert into public.private_treasury_releases(job_id,amount_micros) values(p_id,budget-used) on conflict(job_id) do nothing;
  get diagnostics n = row_count;
  select amount_micros into original from public.private_treasury_releases where job_id=p_id;
  if original <> budget-used then raise exception 'private treasury release accounting mismatch'; end if;
  return n=1;
end $$;
revoke all on function public.release_private_treasury(text,text,text) from public,anon,authenticated;
grant execute on function public.release_private_treasury(text,text,text) to service_role;

create or replace function public.reserve_private_treasury(p_id text,p_payer text,p_signer text,p_capacity bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare amount bigint; ceiling bigint; used bigint; original record;
begin
  if p_signer is null or p_signer !~ '^0x[a-f0-9]{40}$' or p_signer = '0x0000000000000000000000000000000000000000'
    or p_capacity is null or p_capacity < 1 or p_capacity > 999999999999 then raise exception 'invalid capacity policy'; end if;
  select round((data->'submission'->'request'->>'budget')::numeric * 1000000)::bigint into amount
    from public.private_research_intents where id=p_id and payer=lower(p_payer);
  if not found then raise exception 'private intent unavailable'; end if;
  insert into public.private_treasury_pools values(p_signer,p_capacity) on conflict(signer) do nothing;
  select capacity_micros into ceiling from public.private_treasury_pools where signer=p_signer for update;
  if ceiling <> p_capacity then raise exception 'capacity policy conflict'; end if;
  select * into original from public.private_treasury_reservations where job_id=p_id;
  if found then
    if original.signer <> p_signer or original.amount_micros <> amount then raise exception 'reservation conflict'; end if;
    return true;
  end if;
  select coalesce(sum(r.amount_micros-coalesce(x.amount_micros,0)),0) into used
    from public.private_treasury_reservations r left join public.private_treasury_releases x on x.job_id=r.job_id where r.signer=p_signer;
  if amount > ceiling-used then return false; end if;
  insert into public.private_treasury_reservations values(p_id,p_signer,amount) on conflict(job_id) do nothing;
  select * into original from public.private_treasury_reservations where job_id=p_id;
  if original.signer <> p_signer or original.amount_micros <> amount then raise exception 'reservation conflict'; end if;
  return true;
end $$;
revoke all on function public.reserve_private_treasury(text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.reserve_private_treasury(text,text,text,bigint) to service_role;

-- Read-only operator accounting. Never a balance, capacity release or payment authority.
CREATE OR REPLACE FUNCTION public.private_treasury_summary(p_signer text)
RETURNS TABLE(capacity text, allocated text, committed text, confirmed text, invalid text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF p_signer IS NULL OR p_signer !~ '^0x[0-9a-f]{40}$'
    OR p_signer = '0x0000000000000000000000000000000000000000' THEN
    RAISE EXCEPTION 'Invalid private treasury selection';
  END IF;
  RETURN QUERY WITH legs AS (
    SELECT s.amount_micros,
      CASE WHEN
        (s.data#>>'{submission,amountMicros}') IS DISTINCT FROM s.amount_micros::text OR
        (s.data#>>'{submission,payer}') IS DISTINCT FROM r.signer OR
        (c.authorization_id IS NOT NULL AND (
        (c.data->'submission') IS DISTINCT FROM (s.data->'submission') OR
        NOT (COALESCE(c.data->>'source','')='circle-facilitator-success' OR
          (COALESCE(c.data->>'source','')='circle-transfer-search' AND
           COALESCE(c.data->>'transferStatus','') IN ('received','batched','confirmed','completed')))
      )) THEN 1 ELSE 0 END AS bad,
      CASE WHEN c.data->>'source'='circle-facilitator-success' OR
        (c.data->>'source'='circle-transfer-search' AND c.data->>'transferStatus' IN ('confirmed','completed'))
      THEN s.amount_micros ELSE 0 END AS settled
    FROM public.private_treasury_reservations r JOIN public.private_creator_submissions s ON s.job_id=r.job_id
    LEFT JOIN public.private_creator_confirmations c ON c.authorization_id=s.authorization_id WHERE r.signer=p_signer
  ) SELECT p.capacity_micros::text,
    COALESCE((SELECT SUM(r.amount_micros-COALESCE(x.amount_micros,0)) FROM public.private_treasury_reservations r
      LEFT JOIN public.private_treasury_releases x ON x.job_id=r.job_id WHERE r.signer=p.signer),0)::text,
    COALESCE((SELECT SUM(l.amount_micros) FROM legs l),0)::text,
    COALESCE((SELECT SUM(l.settled) FROM legs l),0)::text,
    COALESCE((SELECT SUM(l.bad) FROM legs l),0)::text
    FROM public.private_treasury_pools p WHERE p.signer=p_signer;
END;
$$;
REVOKE ALL ON FUNCTION public.private_treasury_summary(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.private_treasury_summary(text) TO service_role;
