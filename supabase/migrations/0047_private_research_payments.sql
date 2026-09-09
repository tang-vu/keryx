create table if not exists public.private_research_payment_attempts (
  id text primary key references public.private_research_intents(id),
  started_at timestamptz not null default now(),
  confirmation jsonb,
  settled_at timestamptz,
  check ((confirmation is null) = (settled_at is null))
);
alter table public.private_research_payment_attempts enable row level security;
revoke all on table public.private_research_payment_attempts from public, anon, authenticated, service_role;
grant select on table public.private_research_payment_attempts to service_role;

-- Only these owner-scoped transitions can mutate application state. No expiry/requeue path.
create or replace function public.claim_private_research_payment(p_id text,p_payer text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.private_research_payment_attempts(id)
  select id from public.private_research_intents where id=p_id and payer=lower(p_payer)
  on conflict(id) do nothing;
  get diagnostics n = row_count;
  return n=1;
end;
$$;
create or replace function public.confirm_private_research_payment(p_id text,p_payer text,p_confirmation jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare original jsonb;
begin
  select data into original from public.private_research_intents where id=p_id and payer=lower(p_payer);
  if not found then return; end if;
  if jsonb_typeof(p_confirmation) is distinct from 'object'
    or (p_confirmation->>'source') is distinct from 'circle-facilitator-success'
    or (p_confirmation->>'network') is distinct from (original->'requirement'->>'network')
    or lower(p_confirmation->>'payer') is distinct from (original->'submission'->'payment'->'authorization'->>'from')
    or lower(p_confirmation->>'payee') is distinct from (original->'submission'->'payment'->'authorization'->>'to')
    or (p_confirmation->>'amountMicros') is distinct from (original->'submission'->'payment'->'authorization'->>'value')
    or (p_confirmation->>'authorizationId') is distinct from (original->'submission'->'payment'->'authorization'->>'nonce')
    or coalesce(p_confirmation->>'transaction','') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'
  then raise exception 'confirmation mismatch'; end if;
  update public.private_research_payment_attempts p set confirmation=p_confirmation,settled_at=now()
  where p.id=p_id and p.confirmation is null and exists (
    select 1 from public.private_research_intents i where i.id=p.id and i.payer=lower(p_payer)
  );
end;
$$;
revoke all on function public.claim_private_research_payment(text,text) from public,anon,authenticated;
revoke all on function public.confirm_private_research_payment(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_private_research_payment(text,text) to service_role;
grant execute on function public.confirm_private_research_payment(text,text,jsonb) to service_role;
