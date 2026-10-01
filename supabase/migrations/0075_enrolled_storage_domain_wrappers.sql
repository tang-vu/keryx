-- Fixed wrappers preserve current domain locks, retained proofs and v3 deadlines.
-- Dormant until owner cutover/enrollment; existing RPC ACLs are not modified.
begin;
do $$
declare original record; arg record; signature text; arguments text; result_type text; body text;
  readonly_names text[] := array['get_browser_journal','browser_signer_confirmed_spend_micro',
    'list_a2a_orders_for_payer','list_private_reconciliation_candidates','list_private_worker_candidates',
    'private_treasury_summary','browser_signing_header_original','browser_signing_snapshot',
    'browser_signing_exposed_snapshot_for_signer','browser_signing_replay_source_original'];
  names text[] := array['acquire_reasoning_circuit','activate_browser_journal','admit_browser_authorization','admit_browser_journal',
    'admit_private_creator_submission','browser_signer_confirmed_spend_micro','claim_creator_withdrawal_transfer',
    'claim_a2a_order','claim_gap_intent','claim_private_research_execution','claim_private_research_payment','confirm_private_creator_submission',
    'confirm_private_research_payment','consume_auth_challenge','consume_rate_limit','create_auth_challenge','create_gap_intent',
    'create_web_session','disable_browser_journal_grant','fail_gap_intent','fail_pending_payment','get_browser_journal',
    'increment_activation_event','interrupt_private_research','list_a2a_orders_for_payer','mark_a2a_payment_started','mark_a2a_result_saving','resolve_a2a_order',
    'list_private_reconciliation_candidates','list_private_worker_candidates',
    'private_treasury_summary','record_reasoning_circuit_failure','release_onramp','release_private_treasury','release_session_grant_spend',
    'reserve_creator_withdrawal','reserve_onramp','reserve_private_treasury','reserve_session_grant_spend',
    'save_creator_withdrawal_attestation','save_private_research_result','sign_browser_journal','terminal_browser_journal',
    'transition_browser_journal','upsert_api_key_usage','upsert_browser_journal_grant',
    'browser_signing_admit_query','browser_signing_admit_original','browser_signing_replay_source_original',
    'browser_signing_admit_source_original','browser_signing_header_original','browser_signing_record_signature',
    'browser_signing_snapshot','browser_signing_exposed_snapshot_for_signer'];
begin
  if (select count(distinct proname) from pg_proc where pronamespace='public'::regnamespace and proname=any(names)) <> cardinality(names) then
    raise exception 'storage domain RPC inventory incomplete';
  end if;
  for original in select * from pg_proc where pronamespace='public'::regnamespace and proname=any(names) order by proname,oid loop
    signature := 'p_expected_identity jsonb'; arguments := '';
    for arg in select ord,type_oid from unnest(coalesce(original.proallargtypes,original.proargtypes::oid[])) with ordinality as a(type_oid,ord) loop
      if original.proargmodes is not null and original.proargmodes[arg.ord] not in ('i','b','v') then continue; end if;
      if original.proargnames[arg.ord] is null then raise exception 'unnamed domain RPC argument'; end if;
      signature := signature || format(',%I %s',original.proargnames[arg.ord],format_type(arg.type_oid,null));
      arguments := arguments || case when arguments='' then '' else ',' end || quote_ident(original.proargnames[arg.ord]);
    end loop;
    result_type := pg_get_function_result(original.oid);
    if original.proretset then
      body := format('return query select * from public.%I(%s);',original.proname,arguments);
    elsif original.prorettype='void'::regtype then
      body := format('perform public.%I(%s);',original.proname,arguments);
    else
      body := format('select public.%I(%s) into result;',original.proname,arguments);
    end if;
    execute format($wrapper$create function public.%I(%s) returns %s
      language plpgsql security definer set search_path=pg_catalog,pg_temp as $entry$
      %s begin
        perform keryx_storage.%I(p_expected_identity,%L);
        %s
        %s
        %s
      end; $entry$;$wrapper$,
      'storage_'||original.proname,signature,result_type,
      case when original.proretset or original.prorettype='void'::regtype then '' else 'declare result '||result_type||';' end,
      case when original.proname=any(readonly_names) then 'read_operation' else 'enter_operation' end,
      original.proname,body,
      case when original.proname=any(readonly_names) then '' else 'perform keryx_storage.leave_operation();' end,
      case when original.proretset or original.prorettype='void'::regtype then 'return;' else 'return result;' end);
  end loop;
end; $$;


-- Only the protected startup path receives bounded encrypted cache rows.
-- Aggregate metadata is checked before loading; TS authenticates every envelope.
create function public.storage_inspect_runtime_readiness(p_expected_identity jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare row_count bigint; wire_bytes bigint; rows jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'inspect_runtime_readiness');
  perform keryx_storage.verify_fences();
  select count(*),coalesce(sum(octet_length(text)),0) into row_count,wire_bytes
    from public.cache_items where text is not null;
  if row_count>512 or wire_bytes>8388608 or exists(
    select 1 from public.cache_items where text is not null and
      (char_length(source_id) not between 1 and 256 or octet_length(source_id)>512
       or (select sum(case when ascii(substr(source_id,i,1))>65535 then 2 else 1 end)
         from generate_series(1,char_length(source_id)) i)>256
       or octet_length(text)>2097152)) then
    raise exception 'storage cache readiness refused';
  end if;
  perform keryx_storage.verify_cache_quota(row_count,wire_bytes);
  select coalesce(jsonb_agg(jsonb_build_object('sourceId',source_id,'text',text) order by source_id),'[]'::jsonb)
    into rows from public.cache_items where text is not null;
  return jsonb_build_object('format','keryx-enrolled-runtime-readiness-v1','ready',true,
    'sourceContractDigest',(select contract_digest from keryx_storage.enrolled_schema where singleton),
    'cacheRows',rows,'cacheRowCount',row_count,'cacheWireBytes',wire_bytes);
end; $$;

create function public.storage_verify_runtime_authority(p_expected_identity jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
  perform keryx_storage.read_operation(p_expected_identity,'verify_runtime_authority');
  return jsonb_build_object('format','keryx-enrolled-runtime-authority-v1','ready',true,
    'sourceContractDigest',(select contract_digest from keryx_storage.enrolled_schema where singleton));
end; $$;

-- Restrict only new entrypoints. The owner cutover separately fences old names.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p
    where p.pronamespace='public'::regnamespace and p.proname like 'storage\_%' escape '\' loop
    execute 'revoke all on function '||f.signature||' from public,anon,authenticated,service_role';
    execute 'grant execute on function '||f.signature||' to service_role';
  end loop;
end; $$;
commit;
