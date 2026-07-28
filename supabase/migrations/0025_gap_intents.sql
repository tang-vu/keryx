-- Creator offers against measured demand-board gaps.
--
-- This table is coordination state only. It does not authorize payout: the worker still resolves
-- payTo from an active, verified SourceRegistry-backed source, and marks an offer filled only after
-- evidence-qualified citation plus a genuinely settled payment event.

create table if not exists public.gap_intents (
  id text primary key,
  gap_id text not null,
  claim text not null,
  question text not null,
  failed_query_id text not null,
  -- A first-time on-chain registration queues before the indexer materializes its source row.
  -- The worker's lease query requires the row to exist, be active/verified, and match this wallet.
  source_id text not null,
  source_item_link text not null default '',
  owner_wallet text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  lease_expires_at bigint,
  retry_run_id text,
  coverage double precision,
  reward_usdc numeric,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gap_intents_status_check
    check (status in ('pending', 'running', 'filled', 'missed', 'unpaid', 'stale', 'failed')),
  constraint gap_intents_attempts_nonnegative_check check (attempts >= 0),
  constraint gap_intents_offer_unique unique (gap_id, source_id, source_item_link)
);

create index if not exists gap_intents_queue
  on public.gap_intents(status, created_at);

alter table public.gap_intents enable row level security;

drop policy if exists "public read gap_intents" on public.gap_intents;
create policy "public read gap_intents"
  on public.gap_intents for select using (true);

drop policy if exists "service write gap_intents" on public.gap_intents;
create policy "service write gap_intents"
  on public.gap_intents for all to service_role using (true) with check (true);

create or replace function public.claim_gap_intent(
  p_now bigint,
  p_lease_ms bigint
)
returns setof public.gap_intents
language plpgsql
security invoker
as $$
declare
  v_id text;
begin
  update public.gap_intents
     set status = 'failed',
         last_error = coalesce(last_error, 'retry lease expired'),
         lease_expires_at = null,
         updated_at = now()
   where status = 'running'
     and lease_expires_at <= p_now
     and attempts >= 3;

  select gi.id into v_id
    from public.gap_intents gi
    join public.sources s on s.id = gi.source_id
   where (
     gi.status = 'pending'
     or (gi.status = 'running' and gi.lease_expires_at <= p_now)
   )
     and gi.attempts < 3
     and s.active = true
     and s.verified = true
     and lower(s.wallet_address) = lower(gi.owner_wallet)
   order by gi.created_at asc
   for update of gi skip locked
   limit 1;

  if v_id is null then
    return;
  end if;

  return query
  update public.gap_intents
     set status = 'running',
         attempts = attempts + 1,
         lease_expires_at = p_now + greatest(1000, p_lease_ms),
         last_error = null,
         updated_at = now()
   where id = v_id
   returning *;
end;
$$;

create or replace function public.fail_gap_intent(
  p_id text,
  p_error text,
  p_max_attempts integer
)
returns void
language sql
security invoker
as $$
  update public.gap_intents
     set status = case
           when attempts >= greatest(1, p_max_attempts) then 'failed'
           else 'pending'
         end,
         last_error = left(p_error, 500),
         lease_expires_at = null,
         updated_at = now()
   where id = p_id
     and status = 'running';
$$;

revoke all on function public.claim_gap_intent(bigint, bigint)
  from public, anon, authenticated;
revoke all on function public.fail_gap_intent(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_gap_intent(bigint, bigint)
  to service_role;
grant execute on function public.fail_gap_intent(text, text, integer)
  to service_role;
