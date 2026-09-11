-- Private creator cash-out admission journal; no completed withdrawal or settlement claim.
create table if not exists public.creator_withdrawal_requests (
  id text primary key check(id ~ '^0x[a-f0-9]{64}$'),
  owner text not null check(owner ~ '^0x[a-f0-9]{40}$'),
  data jsonb not null check(octet_length(data::text)<=8192),
  created_at timestamptz not null default now()
);
create index if not exists creator_withdrawal_owner on public.creator_withdrawal_requests(owner,created_at desc,id desc);
create table if not exists public.creator_withdrawal_transfer_attempts (
  id text primary key references public.creator_withdrawal_requests(id),
  claim_id uuid not null,
  started_at timestamptz not null default now()
);
alter table public.creator_withdrawal_requests enable row level security;
alter table public.creator_withdrawal_transfer_attempts enable row level security;
revoke all on public.creator_withdrawal_requests,public.creator_withdrawal_transfer_attempts from public,anon,authenticated,service_role;
grant select on public.creator_withdrawal_requests,public.creator_withdrawal_transfer_attempts to service_role;

create or replace function public.reserve_creator_withdrawal(p_id text,p_owner text,p_data jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_id is null or p_owner is null or p_data is null
    or (p_data->>'id') is distinct from p_id or (p_data->>'owner') is distinct from lower(p_owner)
    or (p_data->>'network') is distinct from 'eip155:5042002'
    or (p_data->>'format') is distinct from 'creator-withdrawal-request-v1'
  then raise exception 'invalid withdrawal request'; end if;
  insert into public.creator_withdrawal_requests(id,owner,data) values(p_id,lower(p_owner),p_data)
    on conflict(id) do nothing;
end $$;
revoke all on function public.reserve_creator_withdrawal(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_creator_withdrawal(text,text,jsonb) to service_role;

create or replace function public.claim_creator_withdrawal_transfer(p_id text,p_owner text,p_claim_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  insert into public.creator_withdrawal_transfer_attempts(id,claim_id)
    select id,p_claim_id from public.creator_withdrawal_requests where id=p_id and owner=lower(p_owner)
    on conflict(id) do nothing;
  get diagnostics n=row_count;
  return n=1;
end $$;
revoke all on function public.claim_creator_withdrawal_transfer(text,text,uuid) from public,anon,authenticated;
grant execute on function public.claim_creator_withdrawal_transfer(text,text,uuid) to service_role;
