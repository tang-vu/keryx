-- Serialize same-request saves before checking either unique index. PostgreSQL can
-- otherwise report a concurrent transfer_id violation despite ON CONFLICT(id).
create or replace function public.save_creator_withdrawal_attestation(p_id text,p_owner text,p_claim_id uuid,p_transfer_id uuid,p_data jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_id is null or p_transfer_id is null or p_data is null
    or (p_data->>'requestId') is distinct from p_id
    or (p_data->>'transferId') is distinct from p_transfer_id::text
    or (p_data->>'format') is distinct from 'creator-withdrawal-attestation-v1'
    or (p_data->>'authority') is distinct from 'request-matched-only'
  then raise exception 'invalid withdrawal attestation'; end if;
  perform r.id from public.creator_withdrawal_requests r
    join public.creator_withdrawal_transfer_attempts a on a.id=r.id
    where r.id=p_id and r.owner=lower(p_owner) and a.claim_id=p_claim_id
    for no key update of r;
  if not found then return; end if;
  insert into public.creator_withdrawal_attestations(id,claim_id,transfer_id,data)
    select a.id,a.claim_id,p_transfer_id,p_data from public.creator_withdrawal_transfer_attempts a
    join public.creator_withdrawal_requests r on r.id=a.id
    where a.id=p_id and a.claim_id=p_claim_id and r.owner=lower(p_owner)
    on conflict(id) do nothing;
end $$;
revoke all on function public.save_creator_withdrawal_attestation(text,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_creator_withdrawal_attestation(text,text,uuid,uuid,jsonb) to service_role;

-- Request insertion has two unique identities too (request ID and underlying spec).
-- There is no existing row to lock on first admission. Handle a unique-index race
-- only when the original ID now exists; adapter readback must still match its data.
create or replace function public.reserve_creator_withdrawal(p_id text,p_owner text,p_data jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_id is null or p_owner is null or p_data is null
    or (p_data->>'id') is distinct from p_id or (p_data->>'owner') is distinct from lower(p_owner)
    or (p_data->>'network') is distinct from 'eip155:5042002'
    or (p_data->>'format') is distinct from 'creator-withdrawal-request-v1'
  then raise exception 'invalid withdrawal request'; end if;
  begin
    insert into public.creator_withdrawal_requests(id,owner,data) values(p_id,lower(p_owner),p_data)
      on conflict(id) do nothing;
  exception when unique_violation then
    if not exists(select 1 from public.creator_withdrawal_requests where id=p_id)
    then raise; end if;
  end;
end $$;
revoke all on function public.reserve_creator_withdrawal(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_creator_withdrawal(text,text,jsonb) to service_role;
