create table if not exists public.private_research_executions (
  id text primary key references public.private_research_payment_attempts(id),
  worker_id uuid not null,
  started_at timestamptz not null default now()
);
alter table public.private_research_executions enable row level security;
revoke all on table public.private_research_executions from public,anon,authenticated,service_role;
grant select on table public.private_research_executions to service_role;

-- Service code validates the original signature and complete confirmation tuple first.
-- A claim is permanent; elapsed time must not authorize a second paid execution.
create or replace function public.claim_private_research_execution(p_id text,p_payer text,p_worker_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.private_research_executions(id,worker_id)
  select p.id,p_worker_id from public.private_research_payment_attempts p
  join public.private_research_intents i on i.id=p.id
  where p.id=p_id and i.payer=lower(p_payer)
    and p.confirmation is not null and p.settled_at is not null
  on conflict(id) do nothing;
  get diagnostics n = row_count;
  return n=1;
end;
$$;
revoke all on function public.claim_private_research_execution(text,text,uuid) from public,anon,authenticated;
grant execute on function public.claim_private_research_execution(text,text,uuid) to service_role;
