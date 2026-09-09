create table if not exists public.private_creator_confirmations (
  authorization_id text primary key references public.private_creator_submissions(authorization_id),
  data jsonb not null, settled_at timestamptz not null default now()
);
alter table public.private_creator_confirmations enable row level security;
revoke all on table public.private_creator_confirmations from public,anon,authenticated,service_role;
grant select on table public.private_creator_confirmations to service_role;

create or replace function public.confirm_private_creator_submission(p_id text,p_payer text,p_worker_id uuid,p_confirmation jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare original jsonb; nonce text;
begin
  nonce := p_confirmation#>>'{submission,authorizationId}';
  select s.data into original from public.private_creator_submissions s
  join public.private_research_intents i on i.id=s.job_id
  where s.job_id=p_id and s.worker_id=p_worker_id and i.payer=lower(p_payer) and s.authorization_id=nonce;
  if not found then return; end if;
  if (p_confirmation->>'source') is distinct from 'circle-facilitator-success'
    or (p_confirmation->'submission') is distinct from (original->'submission')
    or coalesce(p_confirmation->>'transaction','') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'
  then raise exception 'creator confirmation mismatch'; end if;
  insert into public.private_creator_confirmations(authorization_id,data) values(nonce,p_confirmation)
  on conflict(authorization_id) do nothing;
end;
$$;
revoke all on function public.confirm_private_creator_submission(text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.confirm_private_creator_submission(text,text,uuid,jsonb) to service_role;
