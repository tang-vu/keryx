-- Atomic RPC/ACL cutover. Existing runtime credentials stop working until explicit
-- owner enrollment and checked callers are ready; no automatic marker adoption.
begin;
create table keryx_storage.operations(operation text primary key,relations text[] not null,real_only boolean not null);
revoke all on keryx_storage.operations from public,anon,authenticated,service_role;

-- Preserve existing domain transactions/return types. Installation-time SQL is
-- derived only from this fixed allowlist and trusted catalog definitions, never a
-- runtime caller's SQL, identifier, query builder or chosen function signature.
do $$
declare original record; arg record; signature text; arguments text; result_type text; body text;
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
    'transition_browser_journal','upsert_api_key_usage','upsert_browser_journal_grant'];
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
        perform keryx_storage.enter_operation(p_expected_identity,%L);
        %s
        perform keryx_storage.leave_operation();
        %s
      end; $entry$;$wrapper$,
      'storage_'||original.proname,signature,result_type,
      case when original.proretset or original.prorettype='void'::regtype then '' else 'declare result '||result_type||';' end,
      original.proname,body,case when original.proretset or original.prorettype='void'::regtype then 'return;' else 'return result;' end);
  end loop;
end; $$;

-- Legacy invoker bodies run as the wrapper owner. Legacy definer bodies keep
-- domain authorization while excluding writable/temp schemas from name lookup.
-- No unchecked public function is callable by application roles afterwards.
do $$ declare f record; relation_names text[]; definitions text; begin
  for f in select p.oid,p.proname,p.oid::regprocedure as signature,pg_get_functiondef(p.oid) as definition
    from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f' loop
    execute 'revoke all on function '||f.signature||' from public,anon,authenticated,service_role';
    execute 'alter function '||f.signature||' set search_path to pg_catalog,public,pg_temp';
    if f.proname like 'storage\_%' escape '\' then
      execute 'alter function '||f.signature||' set search_path to pg_catalog,pg_temp';
      execute 'grant execute on function '||f.signature||' to service_role';
      -- Installation-only dependency closure of fixed function bodies. A lexical
      -- reference may conservatively add a table, but callers cannot add SQL,
      -- function names, table names or capability scopes at runtime.
      with recursive dependencies(oid) as (
        select f.oid
        union
        select p.oid from dependencies d join pg_proc p on p.pronamespace='public'::regnamespace and p.prokind='f'
          and pg_get_functiondef(d.oid) ~ ('\m'||p.proname||'\s*\(')
      ) select string_agg(pg_get_functiondef(oid),E'\n') into definitions from dependencies;
      select coalesce(array_agg(c.relname order by c.relname),'{}'::text[]) into relation_names from pg_class c
        where c.relnamespace='public'::regnamespace and c.relkind in ('r','p')
          and definitions ~ ('\m'||c.relname||'\M');
      insert into keryx_storage.operations values(substr(f.proname,9),relation_names,
        f.proname ~ '(browser|session_grant|private_|creator_withdrawal|supabase_withdrawal|onramp|a2a)')
        on conflict(operation) do nothing;
    elsif f.proname='read_storage_identity' then
      execute 'alter function '||f.signature||' set search_path to pg_catalog,pg_temp';
      execute 'grant execute on function '||f.signature||' to service_role';
    end if;
  end loop;
end; $$;

create function keryx_storage.write_fence() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare active_identity jsonb; scope record; row jsonb;
begin
  select i.identity,o.real_only,o.relations into scope from keryx_storage.writer w
    join keryx_storage.identity i on i.identity_digest=w.identity_digest
    join keryx_storage.operations o on o.operation=w.operation
    where w.transaction_id=txid_current();
  if not found or not tg_table_name=any(scope.relations) then raise exception 'storage authority writer required'; end if;
  active_identity := scope.identity;
  if active_identity->>'authorityMode'='testnet-offline' and scope.real_only then raise exception 'storage authority mode refused'; end if;
  if tg_op='TRUNCATE' then raise exception 'storage authority truncate refused'; end if;
  if tg_op='DELETE' then return old; end if;
  row := to_jsonb(new);
  if row ? 'network' and row->>'network' is distinct from 'eip155:5042002' then raise exception 'storage row network refused'; end if;
  if tg_table_name='payment_events' then
    if active_identity->>'authorityMode'='testnet-offline' and (row->>'settlement_status' is distinct from 'simulated' or (row->>'settled')::boolean) then
      raise exception 'offline financial evidence refused';
    end if;
    if active_identity->>'authorityMode'='testnet-real' and row->>'settlement_status'='simulated' then raise exception 'real store simulated writer refused'; end if;
  elsif tg_table_name='browser_authorization_intents' then
    if lower(row->>'token') is distinct from '0x3600000000000000000000000000000000000000'
      or lower(row->>'gateway_contract') is distinct from '0x0077777d7eba4688bdef3e311b846f25870a19b9' then raise exception 'storage row contract profile refused'; end if;
  elsif tg_table_name='browser_journal_bindings' then
    if row#>>'{requirements,network}' is distinct from 'eip155:5042002'
      or lower(row#>>'{requirements,asset}') is distinct from '0x3600000000000000000000000000000000000000'
      or row#>>'{requirements,extra,name}' is distinct from 'GatewayWalletBatched'
      or row#>>'{requirements,extra,version}' is distinct from '1'
      or lower(row#>>'{requirements,extra,verifyingContract}') is distinct from '0x0077777d7eba4688bdef3e311b846f25870a19b9'
      or row#>>'{payment_metadata,network}' is distinct from 'eip155:5042002' then raise exception 'storage browser binding profile refused'; end if;
  elsif tg_table_name in ('private_creator_submissions','private_creator_confirmations') then
    if row#>>'{data,submission,network}' is distinct from 'eip155:5042002'
      or lower(row#>>'{data,submission,asset}') is distinct from '0x3600000000000000000000000000000000000000' then raise exception 'storage private creator profile refused'; end if;
  elsif tg_table_name='private_research_intents' then
    if row#>>'{data,requirement,network}' is distinct from 'eip155:5042002'
      or lower(row#>>'{data,requirement,asset}') is distinct from '0x3600000000000000000000000000000000000000'
      or row#>>'{data,requirement,extra,name}' is distinct from 'GatewayWalletBatched'
      or row#>>'{data,requirement,extra,version}' is distinct from '1'
      or lower(row#>>'{data,requirement,extra,verifyingContract}') is distinct from '0x0077777d7eba4688bdef3e311b846f25870a19b9' then raise exception 'storage private requirement profile refused'; end if;
  elsif tg_table_name='creator_withdrawal_requests' then
    if row#>>'{data,network}' is distinct from 'eip155:5042002'
      or row#>>'{data,policy,domain}' is distinct from '26'
      or lower(row#>>'{data,policy,asset}') is distinct from '0x3600000000000000000000000000000000000000'
      or lower(row#>>'{data,policy,gatewayWallet}') is distinct from '0x0077777d7eba4688bdef3e311b846f25870a19b9'
      or lower(row#>>'{data,policy,gatewayMinter}') is distinct from '0x0022222abe238cc2c7bb1f21003f0a260052475b' then raise exception 'storage withdrawal profile refused'; end if;
    if row#>>'{data,request,burnIntent,spec,sourceDomain}' is distinct from '26'
      or row#>>'{data,request,burnIntent,spec,destinationDomain}' is distinct from '26'
      or lower(row#>>'{data,request,burnIntent,spec,sourceContract}') is distinct from ('0x'||repeat('0',24)||'0077777d7eba4688bdef3e311b846f25870a19b9')
      or lower(row#>>'{data,request,burnIntent,spec,destinationContract}') is distinct from ('0x'||repeat('0',24)||'0022222abe238cc2c7bb1f21003f0a260052475b')
      or lower(row#>>'{data,request,burnIntent,spec,sourceToken}') is distinct from ('0x'||repeat('0',24)||'3600000000000000000000000000000000000000')
      or lower(row#>>'{data,request,burnIntent,spec,destinationToken}') is distinct from ('0x'||repeat('0',24)||'3600000000000000000000000000000000000000') then raise exception 'storage withdrawal burn profile refused'; end if;
  end if;
  return new;
end; $$;

do $$ declare t record; grant_row record; begin
  for t in select c.oid,c.relname from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v','m','f') loop
    execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t.relname);
    -- Explicit column grants are independent of relation grants.
    for grant_row in select attname from pg_attribute where attrelid=t.oid and attnum>0 and not attisdropped loop
      execute format('revoke all(%I) on table public.%I from public,anon,authenticated,service_role',grant_row.attname,t.relname);
    end loop;
    if (select relkind from pg_class where oid=t.oid) in ('r','p') then
      execute format('create trigger storage_authority_writer before insert or update or delete on public.%I for each row execute function keryx_storage.write_fence()',t.relname);
      execute format('create trigger storage_authority_no_truncate before truncate on public.%I for each statement execute function keryx_storage.write_fence()',t.relname);
    end if;
  end loop;
end; $$;
revoke all on all sequences in schema public from public,anon,authenticated,service_role;
alter default privileges in schema public revoke all on tables from public,anon,authenticated,service_role;
alter default privileges in schema public revoke all on sequences from public,anon,authenticated,service_role;
alter default privileges in schema public revoke execute on functions from public,anon,authenticated,service_role;
revoke all on all functions in schema keryx_storage from public,anon,authenticated,service_role;
commit;
