-- Request-matched response persistence. This is not signature or settlement proof.
create table if not exists public.creator_withdrawal_attestations (
  id text primary key references public.creator_withdrawal_transfer_attempts(id),
  claim_id uuid not null,
  transfer_id uuid not null unique,
  data jsonb not null check(octet_length(data::text)<=8192),
  saved_at timestamptz not null default now()
);
alter table public.creator_withdrawal_attestations enable row level security;
revoke all on public.creator_withdrawal_attestations from public,anon,authenticated,service_role;
grant select on public.creator_withdrawal_attestations to service_role;

create or replace function public.save_creator_withdrawal_attestation(p_id text,p_owner text,p_claim_id uuid,p_transfer_id uuid,p_data jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_id is null or p_transfer_id is null or p_data is null
    or (p_data->>'requestId') is distinct from p_id
    or (p_data->>'transferId') is distinct from p_transfer_id::text
    or (p_data->>'format') is distinct from 'creator-withdrawal-attestation-v1'
    or (p_data->>'authority') is distinct from 'request-matched-only'
  then raise exception 'invalid withdrawal attestation'; end if;
  insert into public.creator_withdrawal_attestations(id,claim_id,transfer_id,data)
    select a.id,a.claim_id,p_transfer_id,p_data from public.creator_withdrawal_transfer_attempts a
    join public.creator_withdrawal_requests r on r.id=a.id
    where a.id=p_id and a.claim_id=p_claim_id and r.owner=lower(p_owner)
    on conflict(id) do nothing;
end $$;
revoke all on function public.save_creator_withdrawal_attestation(text,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_creator_withdrawal_attestation(text,text,uuid,uuid,jsonb) to service_role;
