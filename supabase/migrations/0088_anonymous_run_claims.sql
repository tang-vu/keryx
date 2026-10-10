begin;
-- SOURCE ONLY. Explicit ordinary migration; no target DDL, activation or native enrollment.
create function public.anonymous_run_claims_ordinary_v1() returns void
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if to_regclass('keryx_storage.identity') is not null or to_regclass('public.keryx_storage_identity') is not null then
    raise exception 'claims_unavailable';
  end if;
end; $$;
select public.anonymous_run_claims_ordinary_v1();
-- Identical supported subset to runClaimBindingSchema; no general URL parser or
-- silently broader SQL admission. All values are canonical ASCII origins.
create function public.anonymous_run_claim_origin_valid_v1(value text) returns boolean
language plpgsql immutable strict security invoker set search_path=pg_catalog,public as $$
declare parts text[]; host text; label text; labels text[];
begin
  if octet_length(value)>2048 or value ~ '[[:space:][:cntrl:]]' then return false; end if;
  parts:=regexp_match(value,'^(https?)://(\[::1\]|[a-z0-9.-]+)(:([1-9][0-9]{0,4}))?$');
  if parts is null then return false; end if;
  if parts[4] is not null and (parts[4]::integer>65535 or (parts[1]='https' and parts[4]='443') or (parts[1]='http' and parts[4]='80')) then return false; end if;
  host:=parts[2];
  if host in ('localhost','127.0.0.1','[::1]') then return true; end if;
  if parts[1]<>'https' or length(host)>253 then return false; end if;
  labels:=string_to_array(host,'.');
  if labels[array_length(labels,1)] !~ '[a-z]' then return false; end if;
  foreach label in array labels loop
    if label !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' or label like 'xn--%' then return false; end if;
  end loop;
  return true;
end; $$;
create table public.anonymous_run_claims (
  run_id text primary key check(run_id ~ '^[A-Za-z0-9_-]{1,128}$' and run_id not like 'prv\_%' escape '\' and run_id not like 'a2a\_%' escape '\'),
  network text not null check(network in ('eip155:5042','eip155:5042002')),
  origin text not null check(public.anonymous_run_claim_origin_valid_v1(origin)),
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  original_sha256 text not null check(original_sha256 ~ '^[a-f0-9]{64}$'),
  completed_at text not null,
  issued_at bigint not null check(issued_at between 0 and 8639999913600000),
  expires_at bigint not null check(expires_at=issued_at+86400000),
  claimed_wallet text check(claimed_wallet is null or claimed_wallet ~ '^0x[a-f0-9]{40}$'),
  claimed_at bigint check(claimed_at is null or (claimed_at>=issued_at and claimed_at<expires_at)),
  check((claimed_wallet is null)=(claimed_at is null))
);
create index anonymous_run_claims_owner on public.anonymous_run_claims(claimed_wallet,run_id);
create function public.anonymous_run_claims_immutable_v1() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if TG_OP='INSERT' then
    if new.claimed_wallet is not null or new.claimed_at is not null then raise exception 'claim_unavailable'; end if;
    return new;
  elsif TG_OP='DELETE' then raise exception 'claim_unavailable';
  elsif old.claimed_wallet is not null or new.claimed_wallet is null or new.claimed_at is null
    or to_jsonb(new)-'claimed_wallet'-'claimed_at'<>to_jsonb(old)-'claimed_wallet'-'claimed_at' then
    raise exception 'claim_unavailable';
  end if;
  return new;
end; $$;
create trigger anonymous_run_claims_immutable before insert or update or delete on public.anonymous_run_claims
  for each row execute function public.anonymous_run_claims_immutable_v1();
alter table public.anonymous_run_claims enable row level security;
revoke all on public.anonymous_run_claims from public,anon,authenticated;
grant select,insert on public.anonymous_run_claims to service_role;
grant update(claimed_wallet,claimed_at) on public.anonymous_run_claims to service_role;
create policy anonymous_run_claims_service_read on public.anonymous_run_claims for select to service_role using(true);
create policy anonymous_run_claims_service_insert on public.anonymous_run_claims for insert to service_role with check(claimed_wallet is null and claimed_at is null);
create policy anonymous_run_claims_service_consume on public.anonymous_run_claims for update to service_role
  using(claimed_wallet is null) with check(claimed_wallet is not null and claimed_at is not null);

-- One source-created catalog seal, never a runtime-observed/adopted baseline.
-- The service can read it only; the snapshot is frozen after all new objects and
-- explicit prerequisites have been validated below. No native inventory changes.
create table public.anonymous_run_claims_catalog_seal (
  singleton boolean primary key check(singleton),
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=131072)
);
create function public.anonymous_run_claims_seal_immutable_v1() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin raise exception 'claims_unavailable'; end; $$;
create trigger anonymous_run_claims_seal_immutable before update or delete on public.anonymous_run_claims_catalog_seal
  for each row execute function public.anonymous_run_claims_seal_immutable_v1();
alter table public.anonymous_run_claims_catalog_seal enable row level security;
revoke all on public.anonymous_run_claims_catalog_seal from public,anon,authenticated;
grant select on public.anonymous_run_claims_catalog_seal to service_role;
create policy anonymous_run_claims_seal_read on public.anonymous_run_claims_catalog_seal for select to service_role using(true);

create function public.anonymous_run_claims_catalog_v1() returns jsonb
language sql stable security invoker set search_path=pg_catalog,public as $$
  select jsonb_build_object(
    'relations',(select jsonb_agg(jsonb_build_object('oid',c.oid,'name',c.relname,'kind',c.relkind,'persistence',c.relpersistence,
      'owner',c.relowner,'acl',(select jsonb_agg(jsonb_build_array(x.grantor,x.grantee,x.privilege_type,x.is_grantable)
        order by x.grantor,x.grantee,x.privilege_type,x.is_grantable) from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x),
      'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
      'columns',(select jsonb_agg(jsonb_build_object('position',a.attnum,'name',a.attname,'type',a.atttypid,'modifier',a.atttypmod,
        'notNull',a.attnotnull,'collation',a.attcollation,'identity',a.attidentity,'generated',a.attgenerated,
        'acl',(select jsonb_agg(jsonb_build_array(x.grantor,x.grantee,x.privilege_type,x.is_grantable)
          order by x.grantor,x.grantee,x.privilege_type,x.is_grantable) from aclexplode(coalesce(a.attacl,'{}'::aclitem[])) x),
        'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
        from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
        where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped and
          (c.relname in ('anonymous_run_claims','anonymous_run_claims_catalog_seal','web_sessions')
            or c.relname='query_runs' and a.attname in ('id','created_at','data','asker') or c.relname='a2a_orders' and a.attname='query_id')),
      'constraints',(select jsonb_agg(jsonb_build_object('name',k.conname,'kind',k.contype,'validated',k.convalidated,
        'deferrable',k.condeferrable,'deferred',k.condeferred,'definition',pg_get_constraintdef(k.oid)) order by k.conname)
        from pg_constraint k where k.conrelid=c.oid and
          (c.relname in ('anonymous_run_claims','anonymous_run_claims_catalog_seal','web_sessions')
            or c.relname='query_runs' and k.contype='p' or c.relname='a2a_orders' and k.contype='u'
              and pg_get_constraintdef(k.oid)='UNIQUE (query_id)')),
      'indexes',(select jsonb_agg(jsonb_build_object('name',ic.relname,'definition',pg_get_indexdef(i.indexrelid),
        'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive,'unique',i.indisunique,'immediate',i.indimmediate) order by ic.relname)
        from pg_index i join pg_class ic on ic.oid=i.indexrelid where i.indrelid=c.oid and
          (c.relname in ('anonymous_run_claims','anonymous_run_claims_catalog_seal','web_sessions')
            or c.relname='query_runs' and i.indisprimary or c.relname='a2a_orders' and i.indisunique and i.indpred is null
              and i.indexprs is null and i.indnatts=1 and i.indkey[0]=(select attnum from pg_attribute where attrelid=c.oid and attname='query_id'))),
      'triggers',(select jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'function',t.tgfoid,
        'definition',pg_get_triggerdef(t.oid)) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal
          and c.relname in ('anonymous_run_claims','anonymous_run_claims_catalog_seal','web_sessions')),
      'policies',(select jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,
        'roles',p.polroles,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname)
        from pg_policy p where p.polrelid=c.oid)) order by c.relname)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
        and c.relname in ('anonymous_run_claims','anonymous_run_claims_catalog_seal','web_sessions','query_runs','a2a_orders')),
    'functions',(select jsonb_agg(jsonb_build_object('oid',p.oid,'signature',p.oid::regprocedure::text,'owner',p.proowner,
      'acl',(select jsonb_agg(jsonb_build_array(x.grantor,x.grantee,x.privilege_type,x.is_grantable)
        order by x.grantor,x.grantee,x.privilege_type,x.is_grantable) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x),
      'definition',pg_get_functiondef(p.oid)) order by p.oid::regprocedure::text)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and left(p.proname,19)='anonymous_run_claim'))
  )
$$;
create function public.anonymous_run_claims_guard_v1() returns void
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare relation oid; role_name text; routine oid; expected jsonb;
begin
  perform public.anonymous_run_claims_ordinary_v1();
  -- Keep table/trigger DDL from changing the validated shape before this
  -- transaction's issue/consume; these are read locks, never lifecycle writes.
  lock table public.anonymous_run_claims,public.anonymous_run_claims_catalog_seal,public.web_sessions,public.query_runs,public.a2a_orders in access share mode;
  foreach relation in array array[to_regclass('public.anonymous_run_claims')::oid,to_regclass('public.anonymous_run_claims_catalog_seal')::oid,to_regclass('public.web_sessions')::oid] loop
    if relation is null then raise exception 'claims_unavailable'; end if;
    foreach role_name in array array['public','anon','authenticated'] loop
      if has_table_privilege(role_name,relation,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        or has_any_column_privilege(role_name,relation,'SELECT,INSERT,UPDATE,REFERENCES') then raise exception 'claims_unavailable'; end if;
    end loop;
  end loop;
  relation:=to_regclass('public.anonymous_run_claims_catalog_seal')::oid;
  if has_table_privilege('service_role',relation,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
    or has_any_column_privilege('service_role',relation,'INSERT,UPDATE,REFERENCES') then raise exception 'claims_unavailable'; end if;
  for routine in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and left(p.proname,19)='anonymous_run_claim' loop
    if has_function_privilege('public',routine,'EXECUTE') or has_function_privilege('anon',routine,'EXECUTE')
      or has_function_privilege('authenticated',routine,'EXECUTE') then raise exception 'claims_unavailable'; end if;
  end loop;
  select snapshot into expected from public.anonymous_run_claims_catalog_seal where singleton;
  if not found or expected is distinct from public.anonymous_run_claims_catalog_v1() then raise exception 'claims_unavailable'; end if;
end; $$;

create function public.anonymous_run_claims_ready_v1() returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  perform public.anonymous_run_claims_guard_v1();
  return '{"version":1,"ready":true}'::jsonb;
end; $$;
create function public.anonymous_run_claim_original_v1(p_run_id text,p_completed_at text) returns text
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare q public.query_runs%rowtype;
begin
  perform public.anonymous_run_claims_guard_v1();
  select * into q from public.query_runs where id=p_run_id for share;
  if not found or q.asker is not null or jsonb_typeof(q.data) is distinct from 'object'
    or q.data->>'id' is distinct from p_run_id or q.data->>'createdAt' is distinct from p_completed_at
    or q.data ? 'asker' or q.data ? 'originalFulfillment' or q.data->'askerFunded'='true'::jsonb
    or q.data->>'fundingOwner'='browser' or q.created_at is distinct from p_completed_at::timestamptz
    or octet_length(q.data::text)>4000000
    or exists(select 1 from public.a2a_orders where query_id=p_run_id) then raise exception 'claim_unavailable'; end if;
  return encode(sha256(convert_to(q.data::text,'UTF8')),'hex');
end; $$;
create function public.anonymous_run_claim_issue_v1(p_run_id text,p_token_hash text,p_completed_at text,p_network text,p_origin text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare stamp bigint; fingerprint text;
begin
  perform public.anonymous_run_claims_guard_v1();
  if p_run_id is null or p_run_id !~ '^[A-Za-z0-9_-]{1,128}$' or p_run_id like 'prv\_%' escape '\' or p_run_id like 'a2a\_%' escape '\'
    or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
    or p_network is null or p_network not in ('eip155:5042','eip155:5042002')
    or not coalesce(public.anonymous_run_claim_origin_valid_v1(p_origin),false)
    or p_completed_at is null or p_completed_at !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
    then raise exception 'claim_unavailable'; end if;
  fingerprint:=public.anonymous_run_claim_original_v1(p_run_id,p_completed_at);
  stamp:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  if stamp<0 or stamp>8639999913600000 or p_completed_at::timestamptz>clock_timestamp()
    or exists(select 1 from public.anonymous_run_claims where run_id=p_run_id or token_hash=p_token_hash)
    then raise exception 'claim_unavailable'; end if;
  begin
    insert into public.anonymous_run_claims(run_id,network,origin,token_hash,original_sha256,completed_at,issued_at,expires_at)
      values(p_run_id,p_network,p_origin,p_token_hash,fingerprint,p_completed_at,stamp,stamp+86400000);
  exception when unique_violation then raise exception 'claim_unavailable'; end;
  return jsonb_build_object('version',1,'runId',p_run_id,'binding',jsonb_build_object('network',p_network,'origin',p_origin),
    'issuedAt',to_char(to_timestamp(stamp/1000.0) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt',to_char(to_timestamp((stamp+86400000)/1000.0) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end; $$;
create function public.anonymous_run_claim_consume_v1(p_token_hash text,p_wallet text,p_session_hash text,p_network text,p_origin text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare session_issued bigint; session_expires bigint; stamp bigint; c public.anonymous_run_claims%rowtype; fingerprint text;
begin
  perform public.anonymous_run_claims_guard_v1();
  if p_wallet is null or p_wallet !~ '^0x[a-f0-9]{40}$' or p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$'
    then raise exception 'claim_unauthenticated'; end if;
  -- Share lock prevents revocation/owner replacement until this transaction commits.
  select issued_at,expires_at into session_issued,session_expires from public.web_sessions
    where hash=p_session_hash and wallet=p_wallet for share;
  if not found then raise exception 'claim_unauthenticated'; end if;
  stamp:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  if session_issued>stamp or session_expires<=stamp then raise exception 'claim_unauthenticated'; end if;
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_network is null or p_network not in ('eip155:5042','eip155:5042002')
    or not coalesce(public.anonymous_run_claim_origin_valid_v1(p_origin),false) then raise exception 'claim_unavailable'; end if;
  select * into c from public.anonymous_run_claims where token_hash=p_token_hash and network=p_network and origin=p_origin for update;
  if not found or c.claimed_wallet is not null then raise exception 'claim_unavailable'; end if;
  fingerprint:=public.anonymous_run_claim_original_v1(c.run_id,c.completed_at);
  -- Refresh time after either claim/original lock wait, rather than accepting an old clock.
  stamp:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  if session_issued>stamp or session_expires<=stamp then raise exception 'claim_unauthenticated'; end if;
  if c.issued_at>stamp or c.expires_at<=stamp or c.original_sha256 is distinct from fingerprint then raise exception 'claim_unavailable'; end if;
  update public.anonymous_run_claims set claimed_wallet=p_wallet,claimed_at=stamp where run_id=c.run_id and claimed_wallet is null;
  if not found then raise exception 'claim_unavailable'; end if;
  return jsonb_build_object('version',1,'runId',c.run_id,'wallet',p_wallet,'binding',jsonb_build_object('network',p_network,'origin',p_origin),
    'claimedAt',to_char(to_timestamp(stamp/1000.0) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end; $$;
revoke all on function public.anonymous_run_claims_ordinary_v1(),public.anonymous_run_claim_origin_valid_v1(text),public.anonymous_run_claims_immutable_v1(),
  public.anonymous_run_claims_seal_immutable_v1(),public.anonymous_run_claims_catalog_v1(),public.anonymous_run_claims_guard_v1(),public.anonymous_run_claims_ready_v1(),
  public.anonymous_run_claim_original_v1(text,text),public.anonymous_run_claim_issue_v1(text,text,text,text,text),
  public.anonymous_run_claim_consume_v1(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.anonymous_run_claims_ordinary_v1(),public.anonymous_run_claim_origin_valid_v1(text),public.anonymous_run_claims_catalog_v1(),
  public.anonymous_run_claims_guard_v1(),public.anonymous_run_claims_ready_v1(),public.anonymous_run_claim_original_v1(text,text),
  public.anonymous_run_claim_issue_v1(text,text,text,text,text),public.anonymous_run_claim_consume_v1(text,text,text,text,text) to service_role;
-- Validate existing ordinary prerequisites against only this domain's required
-- shapes. Public query_runs SELECT/RLS policies stay intact and are not revoked.
do $$
declare expected jsonb; actual jsonb; relation oid;
begin
  create temporary table keryx_claim_session_reference (
    hash text primary key check(hash ~ '^[a-f0-9]{64}$'), wallet text not null check(wallet ~ '^0x[a-f0-9]{40}$'),
    issued_at bigint not null check(issued_at>=0), expires_at bigint not null check(expires_at>issued_at and expires_at<=issued_at+604800000)
  ) on commit drop;
  relation:=to_regclass('public.web_sessions')::oid;
  select jsonb_agg(jsonb_build_array(attname,atttypid,atttypmod,attnotnull,attidentity,attgenerated) order by attnum)
    into expected from pg_attribute where attrelid='pg_temp.keryx_claim_session_reference'::regclass and attnum>0 and not attisdropped;
  select jsonb_agg(jsonb_build_array(attname,atttypid,atttypmod,attnotnull,attidentity,attgenerated) order by attnum)
    into actual from pg_attribute where attrelid=relation and attnum>0 and not attisdropped;
  if actual is distinct from expected then raise exception 'claims_unavailable'; end if;
  select jsonb_agg(jsonb_build_array(contype,convalidated,condeferrable,condeferred,pg_get_constraintdef(oid)) order by contype,pg_get_constraintdef(oid))
    into expected from pg_constraint where conrelid='pg_temp.keryx_claim_session_reference'::regclass;
  select jsonb_agg(jsonb_build_array(contype,convalidated,condeferrable,condeferred,pg_get_constraintdef(oid)) order by contype,pg_get_constraintdef(oid))
    into actual from pg_constraint where conrelid=relation;
  if actual is distinct from expected then raise exception 'claims_unavailable'; end if;
  if not exists(select 1 from pg_constraint k join pg_index i on i.indexrelid=k.conindid where k.conrelid=relation
    and k.contype='p' and pg_get_constraintdef(k.oid)='PRIMARY KEY (hash)' and not k.condeferrable and k.convalidated
    and i.indisvalid and i.indisready and i.indislive and i.indimmediate) then raise exception 'claims_unavailable'; end if;
  -- Originals are read-only here: stable unique keys, real types and required
  -- not-null fields; unrelated research/financial columns are outside this seal.
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
      and c.relname in ('query_runs','a2a_orders','web_sessions') and c.relkind='r' and c.relpersistence='p')<>3
    or not (select relrowsecurity from pg_class where oid='public.query_runs'::regclass)
    or exists(select 1 from pg_policy p cross join lateral unnest(p.polroles) r(role_id)
      where p.polrelid='public.query_runs'::regclass and p.polcmd in ('*','a','w','d') and
        case when r.role_id=0 then true else pg_has_role('anon',r.role_id,'USAGE') or pg_has_role('authenticated',r.role_id,'USAGE') end)
    or (select count(*) from pg_attribute where attrelid='public.query_runs'::regclass and not attisdropped and attidentity='' and attgenerated='' and atttypmod=-1
      and ((attname='id' and atttypid='text'::regtype and attnotnull) or (attname='created_at' and atttypid='timestamptz'::regtype and attnotnull)
        or (attname='data' and atttypid='jsonb'::regtype and attnotnull) or (attname='asker' and atttypid='text'::regtype and not attnotnull)))<>4
    or not exists(select 1 from pg_constraint k join pg_index i on i.indexrelid=k.conindid where k.conrelid='public.query_runs'::regclass
      and k.contype='p' and pg_get_constraintdef(k.oid)='PRIMARY KEY (id)' and not k.condeferrable and k.convalidated and i.indisvalid and i.indisready and i.indislive and i.indimmediate)
    or not exists(select 1 from pg_attribute where attrelid='public.a2a_orders'::regclass and attname='query_id' and not attisdropped
      and atttypid='text'::regtype and attnotnull and attidentity='' and attgenerated='' and atttypmod=-1)
    or not exists(select 1 from pg_constraint k join pg_index i on i.indexrelid=k.conindid where k.conrelid='public.a2a_orders'::regclass
      and k.contype='u' and pg_get_constraintdef(k.oid)='UNIQUE (query_id)' and not k.condeferrable and k.convalidated and i.indisvalid and i.indisready and i.indislive and i.indimmediate)
    or (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and left(p.proname,19)='anonymous_run_claim')<>10
    then raise exception 'claims_unavailable'; end if;
  insert into public.anonymous_run_claims_catalog_seal values(true,public.anonymous_run_claims_catalog_v1());
  perform public.anonymous_run_claims_guard_v1();
end $$;
commit;
