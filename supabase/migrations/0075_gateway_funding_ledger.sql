-- Staged ledger, not a live funding controller or verified finality oracle.
-- Policy installation is owner-only and accepts reviewed isolated-empty key
-- namespaces only. Application observations never confer terminal/next-nonce
-- authority. Original claims, nonces and cumulative exposure cannot be reset.
begin;

create table public.gateway_funding_namespaces (
  sender text primary key check(sender ~ '^0x[0-9a-f]{40}$' and sender <> '0x0000000000000000000000000000000000000000'),
  chain_id integer not null default 5042002 check(chain_id=5042002),
  identity_digest text not null check(identity_digest ~ '^[0-9a-f]{64}$'),
  backend_binding_digest text not null check(backend_binding_digest ~ '^[0-9a-f]{64}$'),
  finality_policy_digest text not null check(finality_policy_digest ~ '^[0-9a-f]{64}$'),
  role text not null check(role in ('funder','spend')),
  funder text not null, spend text not null,
  limits jsonb not null, policy_limits jsonb not null, max_transaction_gas numeric(78,0) not null, max_fee_per_gas numeric(78,0) not null,
  used_native numeric(78,0) not null default 0 check(used_native>=0),
  used_usdc numeric(78,0) not null default 0 check(used_usdc>=0),
  used_deposit numeric(78,0) not null default 0 check(used_deposit>=0),
  used_gas numeric(78,0) not null default 0 check(used_gas>=0),
  next_nonce bigint not null default 0 check(next_nonce between 0 and 9007199254740992),
  next_crypto_nonce bigint not null default 0 check(next_crypto_nonce between 0 and 9007199254740992 and next_crypto_nonce<=next_nonce),
  history_document_digest text not null check(history_document_digest ~ '^[0-9a-f]{64}$'),
  reviewed_snapshot_digest text not null check(reviewed_snapshot_digest ~ '^[0-9a-f]{64}$')
);
create table public.gateway_funding_policies (
  policy_id uuid primary key, identity_digest text not null,
  policy jsonb not null, installation jsonb not null, policy_digest text not null,
  funder text not null references public.gateway_funding_namespaces(sender),
  spend text not null references public.gateway_funding_namespaces(sender)
);
create table public.gateway_funding_authorizations (
  operation_id uuid primary key, policy_id uuid not null references public.gateway_funding_policies(policy_id),
  owner_authorization_id uuid not null unique, authorization_digest text not null,
  operation jsonb not null, operation_digest text not null, identity_digest text not null
);
create table public.gateway_funding_operations (
  operation_id uuid primary key references public.gateway_funding_authorizations(operation_id),
  operation_digest text not null, identity_digest text not null,
  admitted_at timestamptz not null default clock_timestamp()
);
create table public.gateway_funding_reservations (
  reservation_id text primary key, operation_id uuid not null references public.gateway_funding_operations(operation_id),
  step text not null check(step in ('nativeTransfer','usdcTransfer','approval','deposit')),
  sender text not null references public.gateway_funding_namespaces(sender),
  nonce bigint not null check(nonce between 0 and 9007199254740991),
  terms jsonb not null, terms_digest text not null, identity_digest text not null,
  unique(operation_id,step), unique(sender,nonce), check(reservation_id=operation_id::text||':'||step)
);
create table public.gateway_funding_crypto_claims (
  reservation_id text primary key references public.gateway_funding_reservations(reservation_id),
  claim_id uuid not null unique, identity_digest text not null,
  claimed_at timestamptz not null default clock_timestamp()
);
create table public.gateway_funding_prepared (
  reservation_id text primary key references public.gateway_funding_crypto_claims(reservation_id),
  crypto_claim_id uuid not null, raw_transaction text not null,
  transaction_hash text not null unique, identity_digest text not null,
  check(raw_transaction ~ '^0x02([0-9a-f]{2})+$' and octet_length(raw_transaction)<=4098),
  check(transaction_hash ~ '^0x[0-9a-f]{64}$')
);
create table public.gateway_funding_broadcast_claims (
  reservation_id text primary key references public.gateway_funding_prepared(reservation_id),
  claim_id uuid not null unique, transaction_hash text not null,
  identity_digest text not null, claimed_at timestamptz not null default clock_timestamp()
);
create table public.gateway_funding_observations (
  observation_id uuid primary key, reservation_id text not null references public.gateway_funding_reservations(reservation_id),
  kind text not null check(kind in ('unknown','seen','finalized-success','finalized-reverted')), observation jsonb not null,
  identity_digest text not null, recorded_at timestamptz not null default clock_timestamp(),
  check(octet_length(observation::text)<=8192)
);

create function keryx_storage.funding_refuse() returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin raise exception 'Gateway funding ledger refused'; end; $$;
-- Requires the installation owner to possess PostgreSQL native control-system
-- visibility. Unsupported managed platforms refuse; URL hashes are not a
-- fallback. An ordinary logical copy changes the cluster/database identity.
-- A full physical cluster image can preserve both and is NOT globally fenced.
create function keryx_storage.funding_backend_binding() returns text
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare system_identifier text; database_oid oid;
begin
  select c.system_identifier::text into system_identifier from pg_catalog.pg_control_system() c;
  select d.oid into database_oid from pg_catalog.pg_database d where d.datname=current_database();
  if system_identifier is null or database_oid is null then perform keryx_storage.funding_refuse(); end if;
  return encode(sha256(convert_to('keryx-pg-funding-binding-v1:'||system_identifier||':'||database_oid::text,'UTF8')),'hex');
exception when others then raise exception 'PostgreSQL native funding binding unavailable';
end; $$;

-- This must inspect an already active outer statement deadline. A function SET
-- statement_timeout (or set_config inside this statement) cannot start PostgreSQL's
-- statement timer. Login/session configuration is an independent deployment gate.
create function keryx_storage.funding_require_outer_deadline() returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare deadline interval := current_setting('statement_timeout')::interval;
begin
  if deadline<=interval '0 milliseconds' or deadline>interval '30 seconds' then
    raise exception 'Gateway funding outer statement deadline required';
  end if;
end; $$;

create function keryx_storage.funding_enter(p_expected_identity jsonb,p_operation text) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  perform keryx_storage.funding_require_outer_deadline();
  perform keryx_storage.require_identity(p_expected_identity);
  perform keryx_storage.verify_fences();
  perform keryx_storage.enter_operation(p_expected_identity,p_operation);
end; $$;
create function keryx_storage.funding_keys(p_value jsonb,p_keys text[]) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare observed text[]; expected text[];
begin
  if p_value is null or jsonb_typeof(p_value) is distinct from 'object' or octet_length(p_value::text)>32768 then perform keryx_storage.funding_refuse(); end if;
  select array_agg(k order by k collate "C") into observed from jsonb_object_keys(p_value) k;
  select array_agg(k order by k collate "C") into expected from unnest(p_keys) k;
  if observed is distinct from expected then perform keryx_storage.funding_refuse(); end if;
end; $$;
create function keryx_storage.funding_uint(p_value jsonb,p_positive boolean default false) returns numeric
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare value numeric;
begin
  if p_value is null or jsonb_typeof(p_value) is distinct from 'string' or p_value#>>'{}' !~ '^(0|[1-9][0-9]{0,77})$' then
    perform keryx_storage.funding_refuse();
  end if;
  value := (p_value#>>'{}')::numeric;
  if value>115792089237316195423570985008687907853269984665640564039457584007913129639935 or (p_positive and value=0) then
    perform keryx_storage.funding_refuse();
  end if;
  return value;
end; $$;
create function keryx_storage.funding_uuid(p_value jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if p_value is null or jsonb_typeof(p_value) is distinct from 'string'
    or p_value#>>'{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    perform keryx_storage.funding_refuse();
  end if;
  return (p_value#>>'{}')::uuid;
end; $$;
create function keryx_storage.funding_address(p_value jsonb) returns text
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if p_value is null or jsonb_typeof(p_value) is distinct from 'string' or p_value#>>'{}' !~ '^0x[0-9a-f]{40}$'
    or p_value#>>'{}'='0x0000000000000000000000000000000000000000' then perform keryx_storage.funding_refuse(); end if;
  return p_value#>>'{}';
end; $$;
-- Only canonical fixed-domain JSON is hashed. UInt authority remains strings;
-- this is never a lossy JSONB replacement for the native full-store snapshot.
create function keryx_storage.funding_canonical(p_value jsonb) returns text
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result text; k text; v jsonb;
begin
  if jsonb_typeof(p_value)='object' then
    result := '{';
    for k,v in select key,value from jsonb_each(p_value) order by key collate "C" loop
      if result<>'{' then result:=result||','; end if;
      result:=result||to_json(k)::text||':'||keryx_storage.funding_canonical(v);
    end loop;
    return result||'}';
  elsif jsonb_typeof(p_value)='array' then perform keryx_storage.funding_refuse();
  end if;
  return p_value::text;
end; $$;
create function keryx_storage.funding_digest(p_value jsonb) returns text
language sql security definer set search_path=pg_catalog,pg_temp as $$
  select encode(sha256(convert_to(keryx_storage.funding_canonical(p_value),'UTF8')),'hex');
$$;

create function keryx_storage.validate_funding_policy(p_identity jsonb,p_policy jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare k text;
begin
  perform keryx_storage.funding_keys(p_policy,array['format','identity','policyId','funder','spend','lifetimeLimits','maxTransactionGas','maxFeePerGasWei']);
  perform keryx_storage.validate_identity(p_policy->'identity');
  if p_policy->'format' is distinct from '"gateway-funding-policy-v1"'::jsonb or p_policy->'identity' is distinct from p_identity
    or p_identity->>'authorityMode'<>'testnet-real' then perform keryx_storage.funding_refuse(); end if;
  perform keryx_storage.funding_uuid(p_policy->'policyId');
  perform keryx_storage.funding_address(p_policy->'funder'); perform keryx_storage.funding_address(p_policy->'spend');
  if p_policy->'funder'=p_policy->'spend' then perform keryx_storage.funding_refuse(); end if;
  perform keryx_storage.funding_keys(p_policy->'lifetimeLimits',array['nativeWei','usdcMicros','depositMicros','gasWei']);
  foreach k in array array['nativeWei','usdcMicros','depositMicros','gasWei'] loop
    perform keryx_storage.funding_uint(p_policy#>array['lifetimeLimits',k]);
  end loop;
  perform keryx_storage.funding_uint(p_policy->'maxTransactionGas',true);
  perform keryx_storage.funding_uint(p_policy->'maxFeePerGasWei',true);
end; $$;

create function keryx_storage.validate_funding_operation(p_identity jsonb,p_operation jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare k text; gas numeric:=0; fee numeric; selected numeric;
begin
  perform keryx_storage.funding_keys(p_operation,array['format','policy','operationId','ownerAuthorizationId','ownerAuthorizationDigest',
    'minimumAvailableMicros','initialAvailableMicros','nativeTransferWei','usdcTransferMicros','approvalMicros','depositMicros','gasLimits',
    'maxFeePerGasWei','maxPriorityFeePerGasWei']);
  if p_operation->'format' is distinct from '"gateway-funding-operation-v1"'::jsonb then perform keryx_storage.funding_refuse(); end if;
  perform keryx_storage.validate_funding_policy(p_identity,p_operation->'policy');
  perform keryx_storage.funding_uuid(p_operation->'operationId'); perform keryx_storage.funding_uuid(p_operation->'ownerAuthorizationId');
  if jsonb_typeof(p_operation->'ownerAuthorizationDigest') is distinct from 'string'
    or p_operation->>'ownerAuthorizationDigest' !~ '^[0-9a-f]{64}$' then perform keryx_storage.funding_refuse(); end if;
  foreach k in array array['minimumAvailableMicros','approvalMicros','depositMicros','maxFeePerGasWei'] loop
    perform keryx_storage.funding_uint(p_operation->k,true);
  end loop;
  foreach k in array array['initialAvailableMicros','nativeTransferWei','usdcTransferMicros','maxPriorityFeePerGasWei'] loop
    perform keryx_storage.funding_uint(p_operation->k);
  end loop;
  fee:=keryx_storage.funding_uint(p_operation->'maxFeePerGasWei',true);
  perform keryx_storage.funding_keys(p_operation->'gasLimits',array['nativeTransfer','usdcTransfer','approval','deposit']);
  foreach k in array array['nativeTransfer','usdcTransfer','approval','deposit'] loop
    selected:=keryx_storage.funding_uint(p_operation#>array['gasLimits',k],true);
    if selected>keryx_storage.funding_uint(p_operation#>'{policy,maxTransactionGas}',true) then perform keryx_storage.funding_refuse(); end if;
    gas:=gas+selected;
  end loop;
  if p_operation->'approvalMicros' is distinct from p_operation->'depositMicros'
    or keryx_storage.funding_uint(p_operation->'usdcTransferMicros')>keryx_storage.funding_uint(p_operation->'depositMicros')
    or keryx_storage.funding_uint(p_operation->'initialAvailableMicros')+keryx_storage.funding_uint(p_operation->'depositMicros')<keryx_storage.funding_uint(p_operation->'minimumAvailableMicros')
    or keryx_storage.funding_uint(p_operation->'initialAvailableMicros')+keryx_storage.funding_uint(p_operation->'depositMicros')>115792089237316195423570985008687907853269984665640564039457584007913129639935
    or keryx_storage.funding_uint(p_operation->'maxPriorityFeePerGasWei')>fee
    or fee>keryx_storage.funding_uint(p_operation#>'{policy,maxFeePerGasWei}',true)
    or gas*fee>keryx_storage.funding_uint(p_operation#>'{policy,lifetimeLimits,gasWei}')
    or keryx_storage.funding_uint(p_operation->'nativeTransferWei')>keryx_storage.funding_uint(p_operation#>'{policy,lifetimeLimits,nativeWei}')
    or keryx_storage.funding_uint(p_operation->'usdcTransferMicros')>keryx_storage.funding_uint(p_operation#>'{policy,lifetimeLimits,usdcMicros}')
    or keryx_storage.funding_uint(p_operation->'depositMicros')>keryx_storage.funding_uint(p_operation#>'{policy,lifetimeLimits,depositMicros}') then
    perform keryx_storage.funding_refuse();
  end if;
end; $$;

create function keryx_storage.funding_immutable() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare active_operation text; selected_digest text;
begin
  select w.operation,w.identity_digest into active_operation,selected_digest from keryx_storage.writer w
    join keryx_storage.identity i on i.identity_digest=w.identity_digest
    where w.transaction_id=txid_current() and i.identity->>'authorityMode'='testnet-real';
  if not found or tg_op in ('DELETE','TRUNCATE') then perform keryx_storage.funding_refuse(); end if;
  if new.identity_digest is distinct from selected_digest then perform keryx_storage.funding_refuse(); end if;
  if tg_table_name='gateway_funding_observations' then
    if (new.kind in ('finalized-success','finalized-reverted') and active_operation<>'funding_finalize')
      or (new.kind in ('unknown','seen') and active_operation<>'funding_append_observation') then
      perform keryx_storage.funding_refuse();
    end if;
  end if;
  if tg_op='UPDATE' then
    if tg_table_name<>'gateway_funding_namespaces' then perform keryx_storage.funding_refuse(); end if;
    if (to_jsonb(new)-array['used_native','used_usdc','used_deposit','used_gas','next_nonce','next_crypto_nonce'])
      is distinct from (to_jsonb(old)-array['used_native','used_usdc','used_deposit','used_gas','next_nonce','next_crypto_nonce'])
      or new.used_native<old.used_native or new.used_usdc<old.used_usdc or new.used_deposit<old.used_deposit or new.used_gas<old.used_gas then
      perform keryx_storage.funding_refuse();
    end if;
    if active_operation='funding_admit' then
      if new.next_nonce<>old.next_nonce or new.next_crypto_nonce<>old.next_crypto_nonce then perform keryx_storage.funding_refuse(); end if;
    elsif active_operation='funding_reserve' then
      if new.next_nonce<>old.next_nonce+1 or new.next_crypto_nonce<>old.next_crypto_nonce or new.used_native<>old.used_native or new.used_usdc<>old.used_usdc
        or new.used_deposit<>old.used_deposit or new.used_gas<>old.used_gas then perform keryx_storage.funding_refuse(); end if;
    elsif active_operation='funding_finalize' then
      if new.next_crypto_nonce<>old.next_crypto_nonce+1 or new.next_nonce<>old.next_nonce
        or new.used_native<>old.used_native or new.used_usdc<>old.used_usdc or new.used_deposit<>old.used_deposit or new.used_gas<>old.used_gas
      then perform keryx_storage.funding_refuse(); end if;
    else perform keryx_storage.funding_refuse();
    end if;
  end if;
  return new;
end; $$;

insert into keryx_storage.operations values
 ('funding_install_policy',array['gateway_funding_namespaces','gateway_funding_policies'],true),
 ('funding_install_authorization',array['gateway_funding_authorizations'],true),
 ('funding_admit',array['gateway_funding_namespaces','gateway_funding_operations'],true),
 ('funding_reserve',array['gateway_funding_namespaces','gateway_funding_reservations'],true),
 ('funding_claim_crypto',array['gateway_funding_crypto_claims'],true),
 ('funding_save_prepared',array['gateway_funding_prepared'],true),
 ('funding_claim_broadcast',array['gateway_funding_broadcast_claims'],true),
 ('funding_append_observation',array['gateway_funding_observations'],true),
 ('funding_inspect','{}',true),
 ('funding_finalize',array['gateway_funding_namespaces','gateway_funding_observations'],true);

do $$ declare t text; begin
  foreach t in array array['gateway_funding_namespaces','gateway_funding_policies','gateway_funding_authorizations',
    'gateway_funding_operations','gateway_funding_reservations','gateway_funding_crypto_claims','gateway_funding_prepared',
    'gateway_funding_broadcast_claims','gateway_funding_observations'] loop
    execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
    execute format('create trigger storage_authority_writer before insert or update or delete on public.%I for each row execute function keryx_storage.write_fence()',t);
    execute format('create trigger storage_authority_no_truncate before truncate on public.%I for each statement execute function keryx_storage.write_fence()',t);
    execute format('create trigger funding_immutable before insert or update or delete on public.%I for each row execute function keryx_storage.funding_immutable()',t);
    execute format('create trigger funding_no_truncate before truncate on public.%I for each statement execute function keryx_storage.funding_immutable()',t);
  end loop;
end; $$;

create function keryx_storage.install_funding_policy(p_expected_identity jsonb,p_installation jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare selected text; selected_sender text; selected_role text; original public.gateway_funding_namespaces%rowtype; stored jsonb;
  p_policy jsonb:=p_installation->'policy'; partition_limits jsonb; funder_gas numeric; spend_gas numeric;
  p_history_document_digest text:=p_installation#>>'{history,documentDigest}';
  p_reviewed_snapshot_digest text:=p_installation->>'reviewedSnapshotDigest';
begin
  perform keryx_storage.funding_require_outer_deadline();
  -- Owner CAS excludes every admitted application transaction until the
  -- installation commits; a shared identity lock alone would allow writers.
  perform pg_advisory_xact_lock(634781904177021::bigint);
  selected:=keryx_storage.require_identity(p_expected_identity);
  perform keryx_storage.funding_keys(p_installation,array['format','policy','funderGasBudgetWei','spendGasBudgetWei','reviewedSnapshotDigest',
    'reviewedTargetDigest','finalityPolicyDigest','history']);
  perform keryx_storage.funding_keys(p_installation->'history',array['format','documentDigest','funderInitialNonce','spendInitialNonce']);
  if p_installation->'format' is distinct from '"gateway-funding-owner-installation-v1"'::jsonb
    or p_installation#>'{history,format}' is distinct from '"gateway-funding-empty-isolated-history-v1"'::jsonb
    or p_installation#>'{history,funderInitialNonce}' is distinct from '"0"'::jsonb
    or p_installation#>'{history,spendInitialNonce}' is distinct from '"0"'::jsonb then perform keryx_storage.funding_refuse(); end if;
  perform keryx_storage.validate_funding_policy(p_expected_identity,p_policy);
  if jsonb_typeof(p_installation->'reviewedTargetDigest') is distinct from 'string'
    or p_installation->>'reviewedTargetDigest' is distinct from keryx_storage.funding_backend_binding()
    or jsonb_typeof(p_installation->'finalityPolicyDigest') is distinct from 'string'
    or p_installation->>'finalityPolicyDigest' !~ '^[0-9a-f]{64}$' then perform keryx_storage.funding_refuse(); end if;
  funder_gas:=keryx_storage.funding_uint(p_installation->'funderGasBudgetWei');
  spend_gas:=keryx_storage.funding_uint(p_installation->'spendGasBudgetWei');
  if funder_gas+spend_gas>keryx_storage.funding_uint(p_policy#>'{lifetimeLimits,gasWei}')
    or funder_gas+keryx_storage.funding_uint(p_policy#>'{lifetimeLimits,nativeWei}')
      +keryx_storage.funding_uint(p_policy#>'{lifetimeLimits,usdcMicros}')*1000000000000>115792089237316195423570985008687907853269984665640564039457584007913129639935
    or spend_gas+keryx_storage.funding_uint(p_policy#>'{lifetimeLimits,depositMicros}')*1000000000000>115792089237316195423570985008687907853269984665640564039457584007913129639935 then
    perform keryx_storage.funding_refuse();
  end if;
  select installation into stored from public.gateway_funding_policies where policy_id=(p_policy->>'policyId')::uuid;
  if found then
    if stored is distinct from p_installation then perform keryx_storage.funding_refuse(); end if;
    return;
  end if;
  if p_history_document_digest is null or p_history_document_digest !~ '^[0-9a-f]{64}$'
    or p_reviewed_snapshot_digest is null or p_reviewed_snapshot_digest !~ '^[0-9a-f]{64}$'
    or keryx_storage.snapshot_digest()<>p_reviewed_snapshot_digest then perform keryx_storage.funding_refuse(); end if;
  perform keryx_storage.verify_fences();
  perform keryx_storage.funding_enter(p_expected_identity,'funding_install_policy');
  foreach selected_role in array array['funder','spend'] loop
    selected_sender:=p_policy->>selected_role;
    partition_limits:=jsonb_build_object('nativeWei',case when selected_role='funder' then p_policy#>>'{lifetimeLimits,nativeWei}' else '0' end,
      'usdcMicros',case when selected_role='funder' then p_policy#>>'{lifetimeLimits,usdcMicros}' else '0' end,
      'depositMicros',case when selected_role='spend' then p_policy#>>'{lifetimeLimits,depositMicros}' else '0' end,
      'gasWei',case when selected_role='funder' then funder_gas::text else spend_gas::text end);
    select * into original from public.gateway_funding_namespaces n where n.sender=selected_sender for update;
    if found then
      if original.identity_digest<>selected or original.role<>selected_role or original.funder<>p_policy->>'funder'
        or original.spend<>p_policy->>'spend' or original.limits is distinct from partition_limits
        or original.policy_limits is distinct from p_policy->'lifetimeLimits'
        or original.backend_binding_digest is distinct from p_installation->>'reviewedTargetDigest'
        or original.finality_policy_digest is distinct from p_installation->>'finalityPolicyDigest'
        or original.history_document_digest is distinct from p_history_document_digest
        or original.max_transaction_gas<>keryx_storage.funding_uint(p_policy->'maxTransactionGas',true)
        or original.max_fee_per_gas<>keryx_storage.funding_uint(p_policy->'maxFeePerGasWei',true) then perform keryx_storage.funding_refuse(); end if;
    else
      if exists(select 1 from public.payment_events where lower(payer)=selected_sender)
        or exists(select 1 from public.withdrawals where lower(wallet)=selected_sender)
        or exists(select 1 from public.session_grants where lower(sess_addr)=selected_sender)
        or exists(select 1 from public.browser_signer_capacity where lower(signer)=selected_sender)
        or exists(select 1 from public.private_treasury_pools where lower(signer)=selected_sender) then
        perform keryx_storage.funding_refuse();
      end if;
      -- Initial nonce is deliberately zero. A reviewed document is an owner-plane
      -- reference; this SQL cannot prove that the external key was never used.
      insert into public.gateway_funding_namespaces(sender,identity_digest,backend_binding_digest,finality_policy_digest,
        role,funder,spend,limits,policy_limits,max_transaction_gas,max_fee_per_gas,
        history_document_digest,reviewed_snapshot_digest)
      values(selected_sender,selected,p_installation->>'reviewedTargetDigest',p_installation->>'finalityPolicyDigest',
        selected_role,p_policy->>'funder',p_policy->>'spend',partition_limits,p_policy->'lifetimeLimits',
        keryx_storage.funding_uint(p_policy->'maxTransactionGas',true),keryx_storage.funding_uint(p_policy->'maxFeePerGasWei',true),
        p_history_document_digest,p_reviewed_snapshot_digest);
    end if;
  end loop;
  insert into public.gateway_funding_policies values((p_policy->>'policyId')::uuid,selected,p_policy,p_installation,
    keryx_storage.funding_digest(p_policy),p_policy->>'funder',p_policy->>'spend');
  perform keryx_storage.leave_operation();
end; $$;

create function keryx_storage.install_funding_authorization(p_expected_identity jsonb,p_operation jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare selected text; original jsonb; stored_policy jsonb;
begin
  perform keryx_storage.funding_require_outer_deadline();
  selected:=keryx_storage.require_identity(p_expected_identity);
  perform keryx_storage.validate_funding_operation(p_expected_identity,p_operation);
  select policy into stored_policy from public.gateway_funding_policies where policy_id=(p_operation#>>'{policy,policyId}')::uuid for share;
  if not found or stored_policy is distinct from p_operation->'policy' then perform keryx_storage.funding_refuse(); end if;
  if exists(select 1 from public.gateway_funding_namespaces where sender in(p_operation#>>'{policy,funder}',p_operation#>>'{policy,spend}')
    and backend_binding_digest is distinct from keryx_storage.funding_backend_binding()) then perform keryx_storage.funding_refuse(); end if;
  select operation into original from public.gateway_funding_authorizations where operation_id=(p_operation->>'operationId')::uuid;
  if found then
    if original is distinct from p_operation then perform keryx_storage.funding_refuse(); end if;
    return;
  end if;
  perform keryx_storage.funding_enter(p_expected_identity,'funding_install_authorization');
  insert into public.gateway_funding_authorizations values((p_operation->>'operationId')::uuid,(p_operation#>>'{policy,policyId}')::uuid,
    (p_operation->>'ownerAuthorizationId')::uuid,p_operation->>'ownerAuthorizationDigest',p_operation,
    keryx_storage.funding_digest(p_operation),selected);
  perform keryx_storage.leave_operation();
end; $$;

create function keryx_storage.funding_bound_operation(p_expected_identity jsonb,p_operation_id text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare selected text; original public.gateway_funding_authorizations%rowtype; binding text; n record;
begin
  perform keryx_storage.funding_require_outer_deadline();
  selected:=keryx_storage.require_identity(p_expected_identity);
  perform keryx_storage.funding_uuid(to_jsonb(p_operation_id));
  select * into original from public.gateway_funding_authorizations where operation_id=p_operation_id::uuid;
  if not found or original.identity_digest<>selected then perform keryx_storage.funding_refuse(); end if;
  perform keryx_storage.validate_funding_operation(p_expected_identity,original.operation);
  if original.operation_digest<>keryx_storage.funding_digest(original.operation) then perform keryx_storage.funding_refuse(); end if;
  binding:=keryx_storage.funding_backend_binding();
  for n in select * from public.gateway_funding_namespaces where sender in
    (original.operation#>>'{policy,funder}',original.operation#>>'{policy,spend}') loop
    if n.identity_digest<>selected or n.backend_binding_digest<>binding then perform keryx_storage.funding_refuse(); end if;
  end loop;
  if (select count(*) from public.gateway_funding_namespaces where sender in
    (original.operation#>>'{policy,funder}',original.operation#>>'{policy,spend}'))<>2 then perform keryx_storage.funding_refuse(); end if;
  return original.operation;
end; $$;

create function public.storage_funding_inspect_namespace(p_expected_identity jsonb,p_sender text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare n public.gateway_funding_namespaces%rowtype; result jsonb;
begin
  perform keryx_storage.funding_enter(p_expected_identity,'funding_inspect');
  perform keryx_storage.funding_address(to_jsonb(p_sender));
  select * into n from public.gateway_funding_namespaces where sender=p_sender;
  if not found or n.identity_digest<>keryx_storage.identity_digest(p_expected_identity) then perform keryx_storage.funding_refuse(); end if;
  result:=jsonb_build_object('identityDigest',n.identity_digest,'backendBindingDigest',n.backend_binding_digest,
    'finalityPolicyDigest',n.finality_policy_digest,'chainId','5042002','sender',n.sender,
    'peer',case when n.role='funder' then n.spend else n.funder end,'role',n.role,'historyDocumentDigest',n.history_document_digest,
    'initialNonce','0','nextNonce',n.next_nonce::text,'nextCryptoNonce',n.next_crypto_nonce::text,'limits',n.limits,
    'used',jsonb_build_object('nativeWei',n.used_native::text,'usdcMicros',n.used_usdc::text,'depositMicros',n.used_deposit::text,'gasWei',n.used_gas::text),
    'nativeAggregateLimitWei',(keryx_storage.funding_uint(n.limits->'nativeWei')
      +(keryx_storage.funding_uint(n.limits->'usdcMicros')+keryx_storage.funding_uint(n.limits->'depositMicros'))*1000000000000
      +keryx_storage.funding_uint(n.limits->'gasWei'))::text,
    'nativeAggregateUsedWei',(n.used_native+(n.used_usdc+n.used_deposit)*1000000000000+n.used_gas)::text);
  perform keryx_storage.leave_operation(); return result;
end; $$;

create function public.storage_funding_inspect_operation(p_expected_identity jsonb,p_operation_id text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.funding_enter(p_expected_identity,'funding_inspect');
  perform keryx_storage.funding_uuid(to_jsonb(p_operation_id));
  select a.operation into result from public.gateway_funding_authorizations a join public.gateway_funding_operations o using(operation_id)
    where a.operation_id=p_operation_id::uuid and a.identity_digest=keryx_storage.identity_digest(p_expected_identity);
  perform keryx_storage.leave_operation(); return result;
end; $$;

create function public.storage_funding_admit(p_expected_identity jsonb,p_operation_id text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare operation jsonb; funder_gas numeric; spend_gas numeric; n public.gateway_funding_namespaces%rowtype;
  native numeric; usdc numeric; deposit numeric; gas numeric; selected text;
begin
  operation:=keryx_storage.funding_bound_operation(p_expected_identity,p_operation_id);
  perform keryx_storage.funding_enter(p_expected_identity,'funding_admit');
  -- A fixed, sorted two-key lock order prevents cross-process oversubscription.
  perform 1 from public.gateway_funding_namespaces where sender in(operation#>>'{policy,funder}',operation#>>'{policy,spend}') order by sender for update;
  if exists(select 1 from public.gateway_funding_operations where operation_id=p_operation_id::uuid) then
    perform keryx_storage.leave_operation(); return operation;
  end if;
  funder_gas:=(keryx_storage.funding_uint(operation#>'{gasLimits,nativeTransfer}')+keryx_storage.funding_uint(operation#>'{gasLimits,usdcTransfer}'))
    *keryx_storage.funding_uint(operation->'maxFeePerGasWei');
  spend_gas:=(keryx_storage.funding_uint(operation#>'{gasLimits,approval}')+keryx_storage.funding_uint(operation#>'{gasLimits,deposit}'))
    *keryx_storage.funding_uint(operation->'maxFeePerGasWei');
  if (select sum(used_gas) from public.gateway_funding_namespaces where sender in(operation#>>'{policy,funder}',operation#>>'{policy,spend}'))
    +funder_gas+spend_gas>keryx_storage.funding_uint(operation#>'{policy,lifetimeLimits,gasWei}') then perform keryx_storage.funding_refuse(); end if;
  for n in select * from public.gateway_funding_namespaces where sender in(operation#>>'{policy,funder}',operation#>>'{policy,spend}') order by sender loop
    native:=case when n.role='funder' then keryx_storage.funding_uint(operation->'nativeTransferWei') else 0 end;
    usdc:=case when n.role='funder' then keryx_storage.funding_uint(operation->'usdcTransferMicros') else 0 end;
    deposit:=case when n.role='spend' then keryx_storage.funding_uint(operation->'depositMicros') else 0 end;
    gas:=case when n.role='funder' then funder_gas else spend_gas end;
    if n.used_native+native>keryx_storage.funding_uint(n.limits->'nativeWei')
      or n.used_usdc+usdc>keryx_storage.funding_uint(n.limits->'usdcMicros')
      or n.used_deposit+deposit>keryx_storage.funding_uint(n.limits->'depositMicros')
      or n.used_gas+gas>keryx_storage.funding_uint(n.limits->'gasWei') then perform keryx_storage.funding_refuse(); end if;
    update public.gateway_funding_namespaces set used_native=used_native+native,used_usdc=used_usdc+usdc,
      used_deposit=used_deposit+deposit,used_gas=used_gas+gas where sender=n.sender;
  end loop;
  selected:=keryx_storage.identity_digest(p_expected_identity);
  insert into public.gateway_funding_operations(operation_id,operation_digest,identity_digest)
    values(p_operation_id::uuid,keryx_storage.funding_digest(operation),selected);
  perform keryx_storage.leave_operation(); return operation;
end; $$;

create function keryx_storage.funding_word(p_value numeric) returns text
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result text:=''; value numeric:=p_value;
begin
  if value<0 or value<>trunc(value) or value>115792089237316195423570985008687907853269984665640564039457584007913129639935 then perform keryx_storage.funding_refuse(); end if;
  while value>0 loop result:=substr('0123456789abcdef',mod(value,16)::integer+1,1)||result; value:=trunc(value/16); end loop;
  return lpad(result,64,'0');
end; $$;
-- Structural fixed-domain validation is additional to the actual viem
-- serializer/ECDSA/Keccak validator in the controller. SQL does not prove that
-- serializedUnsigned or a later signed RLP/hash contains these claimed terms.
create function keryx_storage.validate_funding_transaction(p_operation jsonb,p_step text,p_nonce bigint,p_terms jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare sender text; destination text; data text:='0x'; value text:='0'; k text;
  token text:='0x3600000000000000000000000000000000000000'; wallet text:='0x0077777d7eba4688bdef3e311b846f25870a19b9';
begin
  if p_step is null or p_step not in ('nativeTransfer','usdcTransfer','approval','deposit') or p_nonce is null
    or p_nonce<0 or p_nonce>9007199254740991 then perform keryx_storage.funding_refuse(); end if;
  perform keryx_storage.funding_keys(p_terms,array['format','operationDigest','step','chainId','sender','nonce','to','data','valueWei','gas',
    'maxFeePerGasWei','maxPriorityFeePerGasWei','worstCaseGasWei','serializedUnsigned']);
  for k in select jsonb_object_keys(p_terms) loop
    if jsonb_typeof(p_terms->k) is distinct from 'string' or octet_length(p_terms->>k)>2048 then perform keryx_storage.funding_refuse(); end if;
  end loop;
  sender:=p_operation#>>'{policy,funder}'; destination:=p_operation#>>'{policy,spend}';
  if p_step='nativeTransfer' then value:=p_operation->>'nativeTransferWei'; if value='0' then perform keryx_storage.funding_refuse(); end if;
  elsif p_step='usdcTransfer' then
    if p_operation->>'usdcTransferMicros'='0' then perform keryx_storage.funding_refuse(); end if;
    data:='0xa9059cbb'||lpad(substr(destination,3),64,'0')||keryx_storage.funding_word(keryx_storage.funding_uint(p_operation->'usdcTransferMicros')); destination:=token;
  elsif p_step='approval' then
    sender:=destination; destination:=token;
    data:='0x095ea7b3'||lpad(substr(wallet,3),64,'0')||keryx_storage.funding_word(keryx_storage.funding_uint(p_operation->'approvalMicros'));
  else
    sender:=destination; destination:=wallet;
    data:='0x47e7ef24'||lpad(substr(token,3),64,'0')||keryx_storage.funding_word(keryx_storage.funding_uint(p_operation->'depositMicros'));
  end if;
  if p_terms->>'format'<>'gateway-funding-transaction-v1' or p_terms->>'operationDigest'<>keryx_storage.funding_digest(p_operation)
    or p_terms->>'step'<>p_step or p_terms->>'chainId'<>'5042002' or p_terms->>'sender'<>sender
    or p_terms->>'nonce'<>p_nonce::text or p_terms->>'to'<>destination or p_terms->>'data'<>data or p_terms->>'valueWei'<>value
    or p_terms->'gas' is distinct from p_operation#>array['gasLimits',p_step]
    or p_terms->'maxFeePerGasWei' is distinct from p_operation->'maxFeePerGasWei'
    or p_terms->'maxPriorityFeePerGasWei' is distinct from p_operation->'maxPriorityFeePerGasWei'
    or p_terms->>'worstCaseGasWei'<>(keryx_storage.funding_uint(p_operation#>array['gasLimits',p_step])*keryx_storage.funding_uint(p_operation->'maxFeePerGasWei'))::text
    or p_terms->>'serializedUnsigned' !~ '^0x02([0-9a-f]{2})+$' then perform keryx_storage.funding_refuse(); end if;
end; $$;

create function keryx_storage.funding_reservation_snapshot(p_key text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare r public.gateway_funding_reservations%rowtype; original jsonb; crypto uuid; broadcast uuid;
  prepared public.gateway_funding_prepared%rowtype; prepared_found boolean; observed text; terminal jsonb; state text:='reserved'; result jsonb;
begin
  select * into r from public.gateway_funding_reservations where reservation_id=p_key;
  if not found then return null; end if;
  select operation into original from public.gateway_funding_authorizations where operation_id=r.operation_id;
  select claim_id into crypto from public.gateway_funding_crypto_claims where reservation_id=p_key;
  if found then state:='crypto-claimed'; end if;
  select * into prepared from public.gateway_funding_prepared where reservation_id=p_key; prepared_found:=found;
  if prepared_found then state:='prepared'; end if;
  select claim_id into broadcast from public.gateway_funding_broadcast_claims where reservation_id=p_key;
  if found then state:='broadcast-claimed'; end if;
  select kind into observed from public.gateway_funding_observations where reservation_id=p_key
    order by (kind in ('finalized-success','finalized-reverted')) desc,recorded_at desc,observation_id desc limit 1;
  if found then state:=case observed when 'unknown' then 'unresolved' when 'seen' then 'pending' else observed end; end if;
  result:=jsonb_build_object('operation',original,'transaction',r.terms,'state',state);
  if crypto is not null then result:=result||jsonb_build_object('cryptoClaimId',crypto::text); end if;
  if prepared_found then result:=result||jsonb_build_object('prepared',jsonb_build_object('format','gateway-funding-signed-transaction-v1',
    'transaction',r.terms,'rawTransaction',prepared.raw_transaction,'transactionHash',prepared.transaction_hash)); end if;
  if broadcast is not null then result:=result||jsonb_build_object('broadcastClaimId',broadcast::text); end if;
  select observation into terminal from public.gateway_funding_observations where reservation_id=p_key and kind in ('finalized-success','finalized-reverted');
  if found then result:=result||jsonb_build_object('terminal',terminal); end if;
  return result;
end; $$;

create function public.storage_funding_reserve(p_expected_identity jsonb,p_operation_id text,p_step text,p_terms jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare operation jsonb; original public.gateway_funding_reservations%rowtype; nonce_value numeric; next_value bigint; result jsonb;
  key text:=p_operation_id||':'||p_step; selected_sender text;
begin
  operation:=keryx_storage.funding_bound_operation(p_expected_identity,p_operation_id);
  perform keryx_storage.funding_enter(p_expected_identity,'funding_reserve');
  if not exists(select 1 from public.gateway_funding_operations where operation_id=p_operation_id::uuid) then perform keryx_storage.funding_refuse(); end if;
  nonce_value:=keryx_storage.funding_uint(p_terms->'nonce');
  if nonce_value>9007199254740991 then perform keryx_storage.funding_refuse(); end if;
  perform keryx_storage.validate_funding_transaction(operation,p_step,nonce_value::bigint,p_terms);
  selected_sender:=p_terms->>'sender';
  select next_nonce into next_value from public.gateway_funding_namespaces where gateway_funding_namespaces.sender=selected_sender for update;
  select * into original from public.gateway_funding_reservations where reservation_id=key;
  if found then
    if original.terms is distinct from p_terms or original.identity_digest<>keryx_storage.identity_digest(p_expected_identity)
      or original.terms_digest<>keryx_storage.funding_digest(p_terms) then perform keryx_storage.funding_refuse(); end if;
  else
    if nonce_value<>next_value then perform keryx_storage.funding_refuse(); end if;
    insert into public.gateway_funding_reservations values(key,p_operation_id::uuid,p_step,selected_sender,nonce_value::bigint,p_terms,
      keryx_storage.funding_digest(p_terms),keryx_storage.identity_digest(p_expected_identity));
    update public.gateway_funding_namespaces set next_nonce=next_nonce+1 where gateway_funding_namespaces.sender=selected_sender;
  end if;
  result:=keryx_storage.funding_reservation_snapshot(key);
  perform keryx_storage.leave_operation(); return result;
end; $$;

create function public.storage_funding_inspect_reservation(p_expected_identity jsonb,p_operation_id text,p_step text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.funding_enter(p_expected_identity,'funding_inspect');
  perform keryx_storage.funding_uuid(to_jsonb(p_operation_id));
  if p_step is null or p_step not in ('nativeTransfer','usdcTransfer','approval','deposit') then perform keryx_storage.funding_refuse(); end if;
  result:=keryx_storage.funding_reservation_snapshot(p_operation_id||':'||p_step);
  if result is not null and result#>'{operation,policy,identity}' is distinct from p_expected_identity then perform keryx_storage.funding_refuse(); end if;
  perform keryx_storage.leave_operation(); return result;
end; $$;

create function keryx_storage.funding_claim(p_expected_identity jsonb,p_operation_id text,p_step text,p_claim_id text,p_broadcast boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare operation jsonb; key text:=p_operation_id||':'||p_step; reservation public.gateway_funding_reservations%rowtype;
  original uuid; fresh boolean:=false; signed_hash text; selected_sender text; barrier bigint;
begin
  operation:=keryx_storage.funding_bound_operation(p_expected_identity,p_operation_id);
  perform keryx_storage.funding_uuid(to_jsonb(p_claim_id));
  perform keryx_storage.funding_enter(p_expected_identity,case when p_broadcast then 'funding_claim_broadcast' else 'funding_claim_crypto' end);
  select sender into selected_sender from public.gateway_funding_reservations where reservation_id=key;
  if not found then perform keryx_storage.funding_refuse(); end if;
  -- Namespace then reservation is the common lock order for claim/finalization.
  select next_crypto_nonce into barrier from public.gateway_funding_namespaces where sender=selected_sender for update;
  select * into reservation from public.gateway_funding_reservations where reservation_id=key for update;
  if not found then perform keryx_storage.funding_refuse(); end if;
  if p_broadcast then
    select claim_id into original from public.gateway_funding_broadcast_claims where reservation_id=key;
  else
    select claim_id into original from public.gateway_funding_crypto_claims where reservation_id=key;
  end if;
  if original is not null then
    if original::text is distinct from p_claim_id then perform keryx_storage.funding_refuse(); end if;
  else
    -- Constant-work progression: only protected terminal insertion increments
    -- this monotonic barrier. Gaps/candidate observations never skip a nonce.
    if barrier is null or reservation.nonce<>barrier then perform keryx_storage.funding_refuse(); end if;
    if p_broadcast then
      select transaction_hash into signed_hash from public.gateway_funding_prepared where reservation_id=key;
      if signed_hash is null then perform keryx_storage.funding_refuse(); end if;
      insert into public.gateway_funding_broadcast_claims(reservation_id,claim_id,transaction_hash,identity_digest)
      values(key,p_claim_id::uuid,signed_hash,keryx_storage.identity_digest(p_expected_identity));
    else
      insert into public.gateway_funding_crypto_claims(reservation_id,claim_id,identity_digest)
      values(key,p_claim_id::uuid,keryx_storage.identity_digest(p_expected_identity));
    end if;
    fresh:=true;
  end if;
  perform keryx_storage.leave_operation();
  return jsonb_build_object('fresh',fresh,'claimId',p_claim_id,'reservation',keryx_storage.funding_reservation_snapshot(key));
end; $$;

create function public.storage_funding_claim_crypto(p_expected_identity jsonb,p_operation_id text,p_step text,p_claim_id text) returns jsonb
language sql security definer set search_path=pg_catalog,pg_temp as $$select keryx_storage.funding_claim(p_expected_identity,p_operation_id,p_step,p_claim_id,false)$$;
create function public.storage_funding_claim_broadcast(p_expected_identity jsonb,p_operation_id text,p_step text,p_claim_id text) returns jsonb
language sql security definer set search_path=pg_catalog,pg_temp as $$select keryx_storage.funding_claim(p_expected_identity,p_operation_id,p_step,p_claim_id,true)$$;

create function public.storage_funding_save_prepared(p_expected_identity jsonb,p_operation_id text,p_step text,p_crypto_claim_id text,p_raw_transaction text,p_transaction_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare operation jsonb; key text:=p_operation_id||':'||p_step; original public.gateway_funding_prepared%rowtype; claim uuid; result jsonb;
begin
  operation:=keryx_storage.funding_bound_operation(p_expected_identity,p_operation_id);
  perform keryx_storage.funding_enter(p_expected_identity,'funding_save_prepared');
  perform keryx_storage.funding_uuid(to_jsonb(p_crypto_claim_id));
  perform 1 from public.gateway_funding_reservations where reservation_id=key for update;
  if not found then perform keryx_storage.funding_refuse(); end if;
  select claim_id into claim from public.gateway_funding_crypto_claims where reservation_id=key;
  if claim::text is distinct from p_crypto_claim_id or p_raw_transaction is null or length(p_raw_transaction)>4098
    or p_raw_transaction !~ '^0x02[0-9a-f]+$' or length(p_raw_transaction)%2<>0
    or p_transaction_hash is null or p_transaction_hash !~ '^0x[0-9a-f]{64}$' then perform keryx_storage.funding_refuse(); end if;
  select * into original from public.gateway_funding_prepared where reservation_id=key;
  if found then
    if original.raw_transaction is distinct from p_raw_transaction or original.transaction_hash is distinct from p_transaction_hash
      or original.crypto_claim_id is distinct from claim then perform keryx_storage.funding_refuse(); end if;
  else
    insert into public.gateway_funding_prepared(reservation_id,crypto_claim_id,raw_transaction,transaction_hash,identity_digest)
    values(key,claim,p_raw_transaction,p_transaction_hash,keryx_storage.identity_digest(p_expected_identity));
  end if;
  result:=keryx_storage.funding_reservation_snapshot(key);
  perform keryx_storage.leave_operation(); return result;
end; $$;

create function public.storage_funding_append_observation(p_expected_identity jsonb,p_observation jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare operation jsonb; key text; identifier uuid; original jsonb; signed_hash text;
begin
  perform keryx_storage.funding_keys(p_observation,array['format','observationId','operationId','step','transactionHash','status','observedAt','evidenceDigest']);
  identifier:=keryx_storage.funding_uuid(p_observation->'observationId');
  operation:=keryx_storage.funding_bound_operation(p_expected_identity,p_observation->>'operationId');
  key:=(p_observation->>'operationId')||':'||(p_observation->>'step');
  perform keryx_storage.funding_enter(p_expected_identity,'funding_append_observation');
  perform 1 from public.gateway_funding_reservations where reservation_id=key for update;
  if not found then perform keryx_storage.funding_refuse(); end if;
  select transaction_hash into signed_hash from public.gateway_funding_broadcast_claims where reservation_id=key;
  if signed_hash is null or p_observation->>'format' is distinct from 'gateway-funding-candidate-observation-v1'
    or p_observation->>'status' is null or p_observation->>'status' not in ('unknown','seen')
    or p_observation->>'transactionHash' is distinct from signed_hash
    or jsonb_typeof(p_observation->'observedAt') is distinct from 'string'
    or (p_observation->>'observedAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
    or jsonb_typeof(p_observation->'evidenceDigest') is distinct from 'string'
    or (p_observation->>'evidenceDigest') !~ '^[0-9a-f]{64}$'
    or exists(select 1 from jsonb_each(p_observation) e where jsonb_typeof(e.value)<>'string')
  then perform keryx_storage.funding_refuse(); end if;
  select observation into original from public.gateway_funding_observations where observation_id=identifier;
  if found then
    if original is distinct from p_observation then perform keryx_storage.funding_refuse(); end if;
  else
    if (select count(*) from public.gateway_funding_observations where reservation_id=key)>=64 then perform keryx_storage.funding_refuse(); end if;
    insert into public.gateway_funding_observations(observation_id,reservation_id,kind,observation,identity_digest)
    values(identifier,key,p_observation->>'status',p_observation,keryx_storage.identity_digest(p_expected_identity));
  end if;
  perform keryx_storage.leave_operation(); return p_observation;
end; $$;

-- This capability is installed by the database owner and deliberately never
-- granted to service_role. Receipt/provider verification belongs to the
-- controlled observer issuer; SQL checks structural binding to originals.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='keryx_gateway_funding_observer') then
    create role keryx_gateway_funding_observer nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
  if exists(select 1 from pg_roles where rolname='keryx_gateway_funding_observer'
    and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls))
    or pg_has_role('service_role','keryx_gateway_funding_observer','MEMBER')
    or pg_has_role('anon','keryx_gateway_funding_observer','MEMBER')
    or pg_has_role('authenticated','keryx_gateway_funding_observer','MEMBER') then
    raise exception 'Gateway funding observer role refused';
  end if;
end $$;

create unique index gateway_funding_terminal_once on public.gateway_funding_observations(reservation_id)
where kind in ('finalized-success','finalized-reverted');
-- Bound ordinary readback/count work to this original's at-most-64 candidate
-- observations plus one terminal slot, rather than lifetime observation rows.
create index gateway_funding_observations_original on public.gateway_funding_observations
  (reservation_id,(kind in ('finalized-success','finalized-reverted')) desc,recorded_at desc,observation_id desc);

create function public.storage_funding_finalize(p_expected_identity jsonb,p_evidence jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare operation jsonb; snapshot jsonb; key text; original jsonb; n public.gateway_funding_namespaces%rowtype; selected_kind text; selected_sender text;
begin
  perform keryx_storage.funding_keys(p_evidence,array['format','identity','identityDigest','operationDigest','operationId','step','transactionHash',
    'cryptoClaimId','broadcastClaimId','prepared','sender','nonce','chainId','receiptStatus','blockNumber','blockHash','gasUsed','effectiveGasPriceWei',
    'observedAt','finalityPolicyDigest','finalizedBlockNumber','finalizedBlockHash','providerEvidenceDigest']);
  operation:=keryx_storage.funding_bound_operation(p_expected_identity,p_evidence->>'operationId');
  perform keryx_storage.funding_enter(p_expected_identity,'funding_finalize');
  key:=(p_evidence->>'operationId')||':'||(p_evidence->>'step');
  select sender into selected_sender from public.gateway_funding_reservations where reservation_id=key;
  if not found then perform keryx_storage.funding_refuse(); end if;
  select * into n from public.gateway_funding_namespaces where sender=selected_sender for update;
  perform 1 from public.gateway_funding_reservations where reservation_id=key for update;
  if not found then perform keryx_storage.funding_refuse(); end if;
  snapshot:=keryx_storage.funding_reservation_snapshot(key);
  if p_evidence->>'format' is distinct from 'gateway-funding-terminal-evidence-v1'
    or p_evidence->'identity' is distinct from p_expected_identity
    or p_evidence->>'identityDigest' is distinct from keryx_storage.identity_digest(p_expected_identity)
    or p_evidence->>'operationDigest' is distinct from keryx_storage.funding_digest(operation)
    or p_evidence->'prepared' is distinct from snapshot->'prepared'
    or snapshot->'prepared' is null or snapshot->'broadcastClaimId' is null
    or p_evidence->>'cryptoClaimId' is distinct from snapshot->>'cryptoClaimId'
    or p_evidence->>'broadcastClaimId' is distinct from snapshot->>'broadcastClaimId'
    or p_evidence->>'transactionHash' is distinct from snapshot#>>'{prepared,transactionHash}'
    or p_evidence->>'sender' is distinct from snapshot#>>'{transaction,sender}'
    or p_evidence->>'nonce' is distinct from snapshot#>>'{transaction,nonce}'
    or p_evidence->>'chainId' is distinct from '5042002'
    or p_evidence->>'finalityPolicyDigest' is distinct from n.finality_policy_digest
    or p_evidence->>'receiptStatus' is null or p_evidence->>'receiptStatus' not in ('success','reverted')
    or keryx_storage.funding_uint(p_evidence->'gasUsed')>keryx_storage.funding_uint(snapshot#>'{transaction,gas}')
    or keryx_storage.funding_uint(p_evidence->'effectiveGasPriceWei')>keryx_storage.funding_uint(snapshot#>'{transaction,maxFeePerGasWei}')
    or keryx_storage.funding_uint(p_evidence->'finalizedBlockNumber')<keryx_storage.funding_uint(p_evidence->'blockNumber')
    or jsonb_typeof(p_evidence->'blockHash') is distinct from 'string' or p_evidence->>'blockHash' !~ '^0x[0-9a-f]{64}$'
    or jsonb_typeof(p_evidence->'finalizedBlockHash') is distinct from 'string' or p_evidence->>'finalizedBlockHash' !~ '^0x[0-9a-f]{64}$'
    or jsonb_typeof(p_evidence->'providerEvidenceDigest') is distinct from 'string' or p_evidence->>'providerEvidenceDigest' !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_evidence->'observedAt') is distinct from 'string'
    or p_evidence->>'observedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
    or exists(select 1 from jsonb_each(p_evidence) e where e.key not in ('identity','prepared') and jsonb_typeof(e.value)<>'string')
  then perform keryx_storage.funding_refuse(); end if;
  select observation into original from public.gateway_funding_observations where reservation_id=key and kind in ('finalized-success','finalized-reverted');
  if found then
    if original is distinct from p_evidence then perform keryx_storage.funding_refuse(); end if;
  else
    if n.next_crypto_nonce::text is distinct from snapshot#>>'{transaction,nonce}' then perform keryx_storage.funding_refuse(); end if;
    selected_kind:=case when p_evidence->>'receiptStatus'='success' then 'finalized-success' else 'finalized-reverted' end;
    insert into public.gateway_funding_observations(observation_id,reservation_id,kind,observation,identity_digest)
    values(md5(key||':terminal')::uuid,key,selected_kind,p_evidence,keryx_storage.identity_digest(p_expected_identity));
    update public.gateway_funding_namespaces set next_crypto_nonce=next_crypto_nonce+1 where sender=selected_sender;
  end if;
  perform keryx_storage.leave_operation();
end; $$;

-- Retain the historical functions under owner-only names. Their dependent
-- function OIDs continue to resolve; no unchecked public alias is created.
alter function keryx_storage.verify_fences() rename to verify_fences_pre_funding;
create function keryx_storage.verify_fences() returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare t text; r text; observer_oid oid;
begin
  perform keryx_storage.verify_fences_pre_funding();
  foreach t in array array['gateway_funding_namespaces','gateway_funding_policies','gateway_funding_authorizations','gateway_funding_operations',
    'gateway_funding_reservations','gateway_funding_crypto_claims','gateway_funding_prepared','gateway_funding_broadcast_claims','gateway_funding_observations'] loop
    if (select count(*) from pg_trigger where tgrelid=('public.'||t)::regclass and not tgisinternal and tgenabled='O'
      and tgfoid='keryx_storage.funding_immutable()'::regprocedure and tgqual is null and tgnargs=0 and tgattr=''::int2vector
      and ((tgname='funding_immutable' and tgtype=31) or (tgname='funding_no_truncate' and tgtype=34)))<>2 then
      perform keryx_storage.funding_refuse();
    end if;
    foreach r in array array['PUBLIC','anon','authenticated','service_role','keryx_gateway_funding_observer'] loop
      if r<>'PUBLIC' and (has_table_privilege(r,('public.'||t)::regclass,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_any_column_privilege(r,('public.'||t)::regclass,'SELECT,INSERT,UPDATE,REFERENCES')) then perform keryx_storage.funding_refuse(); end if;
    end loop;
  end loop;
  foreach r in array array['anon','authenticated','service_role'] loop
    -- has_function_privilege includes PUBLIC and inherited role grants.
    if has_function_privilege(r,'public.storage_funding_finalize(jsonb,jsonb)','EXECUTE')
      or pg_has_role(r,'keryx_gateway_funding_observer','MEMBER') then perform keryx_storage.funding_refuse(); end if;
  end loop;
  select oid into observer_oid from pg_roles where rolname='keryx_gateway_funding_observer'
    and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole and not rolinherit and not rolreplication and not rolbypassrls;
  if observer_oid is null or exists(select 1 from pg_auth_members where member=observer_oid or (roleid=observer_oid and admin_option))
    or has_schema_privilege('keryx_gateway_funding_observer','keryx_storage','USAGE,CREATE')
    or has_schema_privilege('keryx_gateway_funding_observer','public','CREATE') then perform keryx_storage.funding_refuse(); end if;
  if not has_function_privilege('keryx_gateway_funding_observer','public.read_storage_identity()','EXECUTE')
    or not has_function_privilege('keryx_gateway_funding_observer','public.storage_funding_finalize(jsonb,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.read_storage_identity()','EXECUTE')
    or has_function_privilege('authenticated','public.read_storage_identity()','EXECUTE') then perform keryx_storage.funding_refuse(); end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','keryx_storage') and has_function_privilege('keryx_gateway_funding_observer',p.oid,'EXECUTE')
      and p.oid not in ('public.read_storage_identity()'::regprocedure,'public.storage_funding_finalize(jsonb,jsonb)'::regprocedure)) then
    perform keryx_storage.funding_refuse(); end if;
  if exists(select 1 from pg_proc p where p.pronamespace='keryx_storage'::regnamespace
    and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')
      or has_function_privilege('service_role',p.oid,'EXECUTE'))) then perform keryx_storage.funding_refuse(); end if;
  if exists(select 1 from pg_class c where c.relnamespace in ('public'::regnamespace,'keryx_storage'::regnamespace)
      and case when c.relkind in ('r','p','v','m','f') then (has_table_privilege('keryx_gateway_funding_observer',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_any_column_privilege('keryx_gateway_funding_observer',c.oid,'SELECT,INSERT,UPDATE,REFERENCES')) else false end)
    or exists(select 1 from pg_class c where c.relnamespace in ('public'::regnamespace,'keryx_storage'::regnamespace)
      and case when c.relkind='S' then has_sequence_privilege('keryx_gateway_funding_observer',c.oid,'USAGE,SELECT,UPDATE') else false end) then perform keryx_storage.funding_refuse(); end if;
end; $$;

alter function keryx_storage.enroll(jsonb,text) rename to enroll_pre_funding;
create function keryx_storage.enroll(p_identity jsonb,p_reviewed_snapshot_digest text) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare t text; populated boolean;
begin
  if not exists(select 1 from keryx_storage.identity) then
    foreach t in array array['gateway_funding_namespaces','gateway_funding_policies','gateway_funding_authorizations','gateway_funding_operations',
      'gateway_funding_reservations','gateway_funding_crypto_claims','gateway_funding_prepared','gateway_funding_broadcast_claims','gateway_funding_observations'] loop
      execute format('select exists(select 1 from public.%I)',t) into populated;
      if populated then perform keryx_storage.funding_refuse(); end if;
    end loop;
  end if;
  perform keryx_storage.enroll_pre_funding(p_identity,p_reviewed_snapshot_digest);
end; $$;

do $$ declare t text; f record; begin
  foreach t in array array['gateway_funding_namespaces','gateway_funding_policies','gateway_funding_authorizations','gateway_funding_operations',
    'gateway_funding_reservations','gateway_funding_crypto_claims','gateway_funding_prepared','gateway_funding_broadcast_claims','gateway_funding_observations'] loop
    execute format('revoke all on public.%I from public,anon,authenticated,service_role,keryx_gateway_funding_observer',t);
  end loop;
  for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'storage_funding_%' loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role,keryx_gateway_funding_observer',f.signature);
    execute format('grant execute on function %s to %I',f.signature,case when f.proname='storage_funding_finalize' then 'keryx_gateway_funding_observer' else 'service_role' end);
  end loop;
end $$;
revoke all on all functions in schema keryx_storage from public,anon,authenticated,service_role,keryx_gateway_funding_observer;
revoke all on schema keryx_storage from keryx_gateway_funding_observer;
grant usage on schema public to keryx_gateway_funding_observer;
grant execute on function public.read_storage_identity() to keryx_gateway_funding_observer;

commit;
