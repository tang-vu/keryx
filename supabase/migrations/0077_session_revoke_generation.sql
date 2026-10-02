-- Generation-aware session revocation. Refresh the dormant source contract only
-- from a separately generated empty PG17 reference, never from a runtime target.
begin;
do $$ begin
  if exists(select 1 from keryx_storage.identity) or exists(select 1 from keryx_storage.enrolled_schema) then
    raise exception 'enrolled storage requires reviewed generation migration';
  end if;
end; $$;

create function public.revoke_session_grant(p_session_id text,p_grant_epoch text,p_sess_addr text)
returns boolean language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare journal_active boolean; changed bigint;
begin
  -- Same first lock as activation: mode cannot change between admission and CAS.
  select active into journal_active from public.browser_journal_control where id=1 for update;
  if journal_active is null then raise exception 'browser journal control unavailable'; end if;
  if journal_active then
    insert into public.browser_journal_writer values(txid_current());
    update public.session_grants set expiry=0
      where session_id=p_session_id and grant_epoch=p_grant_epoch and lower(sess_addr)=lower(p_sess_addr);
    get diagnostics changed=row_count;
    delete from public.browser_journal_writer where transaction_id=txid_current();
  else
    delete from public.session_grants
      where session_id=p_session_id and grant_epoch=p_grant_epoch and lower(sess_addr)=lower(p_sess_addr);
    get diagnostics changed=row_count;
  end if;
  return changed=1;
end; $$;
revoke all on function public.revoke_session_grant(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.revoke_session_grant(text,text,text) to service_role;

insert into keryx_storage.operations(operation,relations,real_only,read_only)
values('revoke_session_grant',array['browser_journal_control','browser_journal_writer','session_grants']::text[],true,false);
create function public.storage_revoke_session_grant(p_expected_identity jsonb,p_session_id text,p_grant_epoch text,p_sess_addr text)
returns boolean language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result boolean;
begin
  perform keryx_storage.enter_operation(p_expected_identity,'revoke_session_grant');
  result := public.revoke_session_grant(p_session_id,p_grant_epoch,p_sess_addr);
  perform keryx_storage.leave_operation();
  return result;
end; $$;
revoke all on function public.storage_revoke_session_grant(jsonb,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.storage_revoke_session_grant(jsonb,text,text,text) to service_role;

-- Independently frozen source rows are appended here after native PG17 export.
commit;
