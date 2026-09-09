create table if not exists public.private_research_results (
  id text primary key references public.private_research_executions(id),
  serialized_run text not null check (length(serialized_run) between 2 and 4194304),
  saved_at timestamptz not null default now()
);
alter table public.private_research_results enable row level security;
revoke all on table public.private_research_results from public,anon,authenticated,service_role;
grant select on table public.private_research_results to service_role;

-- Application code validates signed request identity before this insertion.
-- Keep the exact first serialization; retries cannot replace an accepted answer.
create or replace function public.save_private_research_result(p_id text,p_payer text,p_worker_id uuid,p_serialized_run text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.private_research_results(id,serialized_run)
  select e.id,p_serialized_run from public.private_research_executions e
  join public.private_research_intents i on i.id=e.id
  where e.id=p_id and e.worker_id=p_worker_id and i.payer=lower(p_payer)
  on conflict(id) do nothing;
end;
$$;
revoke all on function public.save_private_research_result(text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.save_private_research_result(text,text,uuid,text) to service_role;
