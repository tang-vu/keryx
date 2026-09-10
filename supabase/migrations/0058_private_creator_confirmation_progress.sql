-- Only advance processing evidence for the same transfer and admitted economic tuple.
create or replace function public.confirm_private_creator_submission(p_id text,p_payer text,p_worker_id uuid,p_confirmation jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare original jsonb; nonce text;
begin
  nonce := p_confirmation#>>'{submission,authorizationId}';
  select s.data into original from public.private_creator_submissions s
  join public.private_research_intents i on i.id=s.job_id
  where s.job_id=p_id and s.worker_id=p_worker_id and i.payer=lower(p_payer) and s.authorization_id=nonce;
  if not found then return; end if;
  if coalesce(p_confirmation->>'source','') not in ('circle-facilitator-success','circle-transfer-search')
    or ((p_confirmation->>'source')='circle-transfer-search' and coalesce(p_confirmation->>'transferStatus','') not in ('received','batched','confirmed','completed'))
    or (p_confirmation->'submission') is distinct from (original->'submission')
    or coalesce(p_confirmation->>'transaction','') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'
  then raise exception 'creator confirmation mismatch'; end if;
  insert into public.private_creator_confirmations(authorization_id,data) values(nonce,p_confirmation)
  on conflict(authorization_id) do update set data=excluded.data
  where public.private_creator_confirmations.data->>'source'='circle-transfer-search'
    and excluded.data->>'source'='circle-transfer-search'
    and public.private_creator_confirmations.data->>'transferStatus' in ('received','batched')
    and excluded.data->>'transferStatus' in ('confirmed','completed')
    and public.private_creator_confirmations.data->>'transaction'=excluded.data->>'transaction'
    and public.private_creator_confirmations.data->'submission'=excluded.data->'submission';
end;
$$;
revoke all on function public.confirm_private_creator_submission(text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.confirm_private_creator_submission(text,text,uuid,jsonb) to service_role;
