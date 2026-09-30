begin;
-- Whole application/project snapshot: native PostgreSQL record bytes, including
-- NULL/type/bytea/numeric representation, never JavaScript or lossy row JSON.
-- Owner-only full scan fails rather than producing a partial digest. Public API
-- cannot invoke this routine or choose table names/SQL/provenance exemptions.
create function keryx_storage.snapshot_digest() returns text
language plpgsql security definer set search_path=pg_catalog,pg_temp
set lock_timeout='5s'
set datestyle='ISO, YMD' set timezone='UTC' set extra_float_digits=3 set bytea_output='hex' as $$
declare snapshot_table record; count_rows bigint; total_rows bigint := 0; total_bytes numeric := 0; row_bytes numeric; max_row_bytes integer; deadline timestamptz := clock_timestamp()+interval '30 seconds'; rows_digest text; manifest text := ''; catalog_digest text;
begin
  if current_setting('statement_timeout')::interval<=interval '0' or current_setting('statement_timeout')::interval>interval '30 seconds' then
    raise exception 'bounded owner statement deadline required';
  end if;
  perform pg_advisory_xact_lock(634781904177021::bigint);
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('f','m')
    and n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema') then
    raise exception 'unsupported foreign/materialized provenance requires separate inspection';
  end if;
  for snapshot_table in select n.nspname,c.relname,c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
      and not (n.nspname='keryx_storage' and c.relname='identity') order by n.nspname,c.relname loop
    execute format('lock table %I.%I in share row exclusive mode',snapshot_table.nspname,snapshot_table.relname);
  end loop;
  for snapshot_table in select n.nspname,c.relname,c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
      and not (n.nspname='keryx_storage' and c.relname='identity') order by n.nspname,c.relname loop
    execute format('select count(*) from %I.%I',snapshot_table.nspname,snapshot_table.relname) into count_rows;
    if clock_timestamp()>deadline then raise exception 'complete provenance deadline exceeded'; end if;
    total_rows := total_rows + count_rows;
    execute format('select coalesce(sum(octet_length(record_send(r))),0),coalesce(max(octet_length(record_send(r))),0) from %I.%I r',snapshot_table.nspname,snapshot_table.relname) into row_bytes,max_row_bytes;
    total_bytes := total_bytes+row_bytes;
    if max_row_bytes>1048576 or total_bytes>67108864 then raise exception 'complete provenance native bytes exceed approved bounds'; end if;
    if total_rows>200000 then raise exception 'complete provenance snapshot exceeds approved bounds'; end if;
    execute format($query$select encode(sha256(convert_to(coalesce(string_agg(h,'' order by h),''),'UTF8')),'hex')
      from (select encode(sha256(record_send(r)),'hex') h from %I.%I r) rows$query$,snapshot_table.nspname,snapshot_table.relname) into rows_digest;
    manifest := manifest || quote_ident(snapshot_table.nspname)||'.'||quote_ident(snapshot_table.relname)||':'||count_rows||':'||rows_digest||E'\n';
  end loop;
  for snapshot_table in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='S' and n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema' order by n.nspname,c.relname loop
    execute format('select encode(sha256(record_send(r)),''hex'') from %I.%I r',snapshot_table.nspname,snapshot_table.relname) into rows_digest;
    manifest := manifest || 'sequence:'||quote_ident(snapshot_table.nspname)||'.'||quote_ident(snapshot_table.relname)||':'||rows_digest||E'\n';
  end loop;
  -- Full schema/ACL/ownership/collation/role membership is part of the same CAS.
  -- Catalog record text uses PostgreSQL native escaped field representation;
  -- some catalog pseudo-types have no binary send function. Secrets in
  -- pg_authid/passwords are deliberately not read.
  select encode(sha256(convert_to(coalesce(string_agg(piece,E'\n' order by piece),''),'UTF8')),'hex') into catalog_digest from (
    select 'namespace:'||encode(sha256(convert_to(n::text,'UTF8')),'hex') piece from pg_namespace n where n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
    union all select 'relation:'||encode(sha256(convert_to(c::text,'UTF8')),'hex') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
    union all select 'column:'||encode(sha256(convert_to(a::text,'UTF8')),'hex') from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
    union all select 'constraint:'||encode(sha256(convert_to(c::text,'UTF8')),'hex') from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
    union all select 'trigger:'||encode(sha256(convert_to(t::text,'UTF8')),'hex') from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
    union all select 'function:'||pg_get_functiondef(p.oid)||':'||coalesce(p.proacl::text,'')||':'||p.proowner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind='f' and n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
    union all select 'policy:'||encode(sha256(convert_to(p::text,'UTF8')),'hex') from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
    union all select 'type:'||encode(sha256(convert_to(t::text,'UTF8')),'hex') from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
    union all select 'collation:'||encode(sha256(convert_to(c::text,'UTF8')),'hex') from pg_collation c
    union all select 'index:'||encode(sha256(convert_to(i::text,'UTF8')),'hex') from pg_index i join pg_class c on c.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
    union all select 'default:'||encode(sha256(convert_to(d::text,'UTF8')),'hex') from pg_attrdef d join pg_class c on c.oid=d.adrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
    union all select 'rule:'||encode(sha256(convert_to(r::text,'UTF8')),'hex') from pg_rewrite r join pg_class c on c.oid=r.ev_class join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
    union all select 'sequence-definition:'||encode(sha256(convert_to(s::text,'UTF8')),'hex') from pg_sequence s join pg_class c on c.oid=s.seqrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
    union all select 'extension:'||encode(sha256(convert_to(e::text,'UTF8')),'hex') from pg_extension e
    union all select 'grant-default:'||encode(sha256(convert_to(d::text,'UTF8')),'hex') from pg_default_acl d
    union all select 'role:'||encode(sha256(convert_to(r::text,'UTF8')),'hex') from pg_roles r
    union all select 'membership:'||encode(sha256(convert_to(m::text,'UTF8')),'hex') from pg_auth_members m
  ) pieces;
  return encode(sha256(convert_to('keryx-postgres-provenance-v1'||E'\n'||manifest||catalog_digest,'UTF8')),'hex');
end; $$;

create function keryx_storage.verify_fences() returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare t record;
begin
  if exists(select 1 from keryx_storage.writer) or exists(select 1 from public.browser_journal_writer) then raise exception 'in-flight writer capability refused'; end if;
  for t in select c.oid,c.relname from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p') loop
    if (select count(*) from pg_trigger where tgrelid=t.oid and tgenabled='O' and tgfoid='keryx_storage.write_fence()'::regprocedure
      and tgnargs=0 and tgqual is null and not tgisinternal
      and ((tgname='storage_authority_writer' and tgtype=31) or (tgname='storage_authority_no_truncate' and tgtype=34)))<>2 then raise exception 'authority fence incomplete'; end if;
    if has_table_privilege('service_role',t.oid,'select,insert,update,delete,truncate,references,trigger')
      or has_any_column_privilege('service_role',t.oid,'select,insert,update,references') then raise exception 'raw service authority privilege refused'; end if;
  end loop;
  if (select count(*) from pg_trigger where tgrelid='keryx_storage.identity'::regclass
    and tgenabled='O' and tgfoid='keryx_storage.identity_immutable()'::regprocedure and tgnargs=0 and tgqual is null and not tgisinternal
    and ((tgname='identity_immutable' and tgtype=27) or (tgname='identity_no_truncate' and tgtype=34)))<>2 then
    raise exception 'identity immutability fence incomplete';
  end if;
  if exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and has_function_privilege('service_role',p.oid,'execute')
    and p.proname<>'read_storage_identity' and p.proname not like 'storage\_%' escape '\') then raise exception 'unchecked RPC privilege refused'; end if;
end; $$;

create function keryx_storage.enroll(p_identity jsonb,p_reviewed_snapshot_digest text) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare original keryx_storage.identity%rowtype; selected_digest text; legacy_table record; has_legacy_rows boolean;
begin
  if current_setting('statement_timeout')::interval<=interval '0' or current_setting('statement_timeout')::interval>interval '30 seconds' then
    raise exception 'bounded owner statement deadline required';
  end if;
  perform keryx_storage.validate_identity(p_identity);
  if p_reviewed_snapshot_digest is null or p_reviewed_snapshot_digest !~ '^[0-9a-f]{64}$' then raise exception 'reviewed provenance required'; end if;
  perform pg_advisory_xact_lock(634781904177021::bigint);
  perform keryx_storage.verify_fences();
  select * into original from keryx_storage.identity where singleton for update;
  if found then
    if original.identity is distinct from p_identity or original.enrolled_snapshot_digest is distinct from p_reviewed_snapshot_digest then
      raise exception 'conflicting enrollment refused';
    end if;
    return;
  end if;
  selected_digest := keryx_storage.snapshot_digest();
  if selected_digest <> p_reviewed_snapshot_digest then raise exception 'provenance changed after inspection'; end if;
  -- Unlabelled funded/auth authority cannot become spendable by owner attestation.
  -- This first supported enrollment deliberately refuses such populated stores;
  -- recovery/quarantine is separate work, never a reset/delete during enrollment.
  if exists(select 1 from public.session_grants) or exists(select 1 from public.browser_authorization_intents)
    or exists(select 1 from public.browser_retained_grants) or exists(select 1 from public.browser_signer_capacity)
    or exists(select 1 from public.web_sessions) or exists(select 1 from public.auth_challenges)
    or exists(select 1 from public.api_keys) or exists(select 1 from public.private_research_intents)
    or exists(select 1 from public.creator_withdrawal_requests) or exists(select 1 from public.a2a_orders) then
    raise exception 'legacy authority requires separate quarantine/recovery';
  end if;
  for legacy_table in select c.relname from pg_class c where c.relnamespace='public'::regnamespace
    and c.relkind in ('r','p') and c.relname like 'private\_%' escape '\' loop
    execute format('select exists(select 1 from public.%I)',legacy_table.relname) into has_legacy_rows;
    if has_legacy_rows then raise exception 'legacy authority requires separate quarantine/recovery'; end if;
  end loop;
  if exists(select 1 from public.withdrawals)
    or exists(select 1 from public.payment_events where settled or settlement_status is distinct from 'simulated'
      or authorization_id is not null or authorization_phase is not null or grant_epoch is not null
      or amount_usdc<0 or amount_usdc::text in ('NaN','Infinity','-Infinity')
      or amount_usdc*1000000<>trunc(amount_usdc*1000000)) then
    raise exception 'legacy financial authority requires separate quarantine/recovery';
  end if;
  if exists(select 1 from public.payment_events where network is distinct from 'eip155:5042002')
    or exists(select 1 from public.withdrawals where network is distinct from 'eip155:5042002') then raise exception 'foreign financial provenance refused'; end if;
  if p_identity->>'authorityMode'='testnet-offline' and
    (exists(select 1 from public.payment_events where settled or settlement_status is distinct from 'simulated') or exists(select 1 from public.withdrawals)) then
    raise exception 'offline store real financial provenance refused';
  end if;
  insert into keryx_storage.identity(singleton,identity,identity_digest,enrolled_snapshot_digest)
    values(true,p_identity,keryx_storage.identity_digest(p_identity),selected_digest);
end; $$;
revoke all on all functions in schema keryx_storage from public,anon,authenticated,service_role;
commit;
