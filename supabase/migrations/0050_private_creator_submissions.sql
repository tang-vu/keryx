create table if not exists public.private_creator_submissions (
  job_id text not null references public.private_research_executions(id),
  leg_id text not null, worker_id uuid not null,
  authorization_id text not null unique,
  amount_micros integer not null check(amount_micros > 0 and amount_micros <= 1000000),
  data jsonb not null, started_at timestamptz not null default now(),
  primary key(job_id,leg_id)
);
alter table public.private_creator_submissions enable row level security;
revoke all on table public.private_creator_submissions from public,anon,authenticated,service_role;
grant select on table public.private_creator_submissions to service_role;

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
  if exists(select 1 from public.private_research_results where id=p_id) then return false; end if;
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

-- Result sealing and creator admission take the same row lock.
create or replace function public.save_private_research_result(p_id text,p_payer text,p_worker_id uuid,p_serialized_run text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform e.id from public.private_research_executions e join public.private_research_intents i on i.id=e.id
  where e.id=p_id and e.worker_id=p_worker_id and i.payer=lower(p_payer) for update of e;
  if not found then return; end if;
  insert into public.private_research_results(id,serialized_run) values(p_id,p_serialized_run) on conflict(id) do nothing;
end;
$$;
revoke all on function public.save_private_research_result(text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.save_private_research_result(text,text,uuid,text) to service_role;
