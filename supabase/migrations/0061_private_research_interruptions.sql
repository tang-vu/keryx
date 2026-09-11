-- Operator-recorded execution interruption. A spend fence, not payment failure/refund.
create table if not exists public.private_research_interruptions (
  id text primary key references public.private_research_executions(id),
  worker_id uuid not null,
  reason text not null check(reason='worker-interrupted'),
  recorded_at timestamptz not null default now()
);
alter table public.private_research_interruptions enable row level security;
revoke all on public.private_research_interruptions from public,anon,authenticated,service_role;
grant select on public.private_research_interruptions to service_role;

create or replace function public.interrupt_private_research(p_id text,p_payer text,p_worker_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Same serialization point as creator admission and result saving.
  perform e.id from public.private_research_executions e join public.private_research_intents i on i.id=e.id
    where e.id=p_id and e.worker_id=p_worker_id and i.payer=lower(p_payer) for update of e;
  if not found then return; end if;
  if exists(select 1 from public.private_research_results where id=p_id) then return; end if;
  insert into public.private_research_interruptions(id,worker_id,reason)
    values(p_id,p_worker_id,'worker-interrupted') on conflict(id) do nothing;
end $$;
revoke all on function public.interrupt_private_research(text,text,uuid) from public,anon,authenticated;
grant execute on function public.interrupt_private_research(text,text,uuid) to service_role;

create or replace function public.admit_private_creator_submission(p_id text,p_payer text,p_worker_id uuid,p_leg_id text,p_authorization_id text,p_amount_micros integer,p_data jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare budget numeric; used numeric; n integer;
begin
  -- Serialize every leg against the same immutable worker and signed creator budget.
  select round((i.data#>>'{submission,request,budget}')::numeric*1000000) into budget
  from public.private_research_executions e join public.private_research_intents i on i.id=e.id
  where e.id=p_id and e.worker_id=p_worker_id and i.payer=lower(p_payer) for update of e;
  if not found then return false; end if;
  if budget is null or budget <= 0 or budget > 1000000 then raise exception 'invalid creator budget'; end if;
  if p_amount_micros is null or p_amount_micros <= 0 or p_amount_micros > 1000000
    or p_leg_id is null or p_leg_id !~ '^[a-f0-9]{64}$'
    or p_authorization_id is null or p_authorization_id !~ '^0x[a-f0-9]{64}$'
    or (p_data#>>'{submission,authorizationId}') is distinct from p_authorization_id
    or (p_data#>>'{submission,amountMicros}') is distinct from p_amount_micros::text
  then raise exception 'invalid creator submission'; end if;
  if exists(select 1 from public.private_research_results where id=p_id)
    or exists(select 1 from public.private_research_interruptions where id=p_id) then return false; end if;
  select coalesce(sum(amount_micros),0) into used from public.private_creator_submissions where job_id=p_id;
  if used+p_amount_micros > budget then return false; end if;
  insert into public.private_creator_submissions(job_id,leg_id,worker_id,authorization_id,amount_micros,data)
  values(p_id,p_leg_id,p_worker_id,p_authorization_id,p_amount_micros,p_data) on conflict do nothing;
  get diagnostics n = row_count;
  return n=1;
end;
$$;
revoke all on function public.admit_private_creator_submission(text,text,uuid,text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.admit_private_creator_submission(text,text,uuid,text,text,integer,jsonb) to service_role;


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
  if not exists(select 1 from public.private_research_results where id=p_id)
    and not exists(select 1 from public.private_research_interruptions where id=p_id) then return false; end if;
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
