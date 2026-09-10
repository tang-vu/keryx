create or replace function public.confirm_private_research_payment(p_id text,p_payer text,p_confirmation jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare original jsonb;
begin
  select data into original from public.private_research_intents where id=p_id and payer=lower(p_payer);
  if not found then return; end if;
  if jsonb_typeof(p_confirmation) is distinct from 'object'
    or coalesce(p_confirmation->>'source','') not in ('circle-facilitator-success','circle-transfer-search')
    or ((p_confirmation->>'source') = 'circle-transfer-search' and coalesce(p_confirmation->>'transferStatus','') not in ('confirmed','completed'))
    or ((p_confirmation->>'source') = 'circle-facilitator-success' and p_confirmation ? 'transferStatus')
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
revoke all on function public.confirm_private_research_payment(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.confirm_private_research_payment(text,text,jsonb) to service_role;
