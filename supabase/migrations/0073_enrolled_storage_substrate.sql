-- Dormant enrolled-storage substrate. Installation does not fence legacy callers.
-- Only the separately reviewed owner cutover may publish an enrolled identity.
begin;
-- NULL retains the legacy full-preview default; no row backfill or activation.
alter table public.sources add column if not exists preview_depth text;
alter table public.sources add constraint sources_preview_depth_check
  check (preview_depth is null or preview_depth in ('full','excerpt','locked'));
create schema keryx_storage;
revoke all on schema keryx_storage from public,anon,authenticated,service_role;

alter default privileges in schema keryx_storage revoke execute on functions from public;


create table keryx_storage.identity (
  singleton boolean primary key default true check(singleton),
  identity jsonb not null,
  identity_digest text not null check(identity_digest ~ '^[0-9a-f]{64}$'),
  enrolled_snapshot_digest text not null check(enrolled_snapshot_digest ~ '^[0-9a-f]{64}$')
);
create table keryx_storage.operations (operation text primary key, relations text[] not null, real_only boolean not null, read_only boolean not null);
revoke all on keryx_storage.operations from public,anon,authenticated,service_role;
create table keryx_storage.writer (
  transaction_id bigint primary key,
  identity_digest text not null,
  operation text not null
);
revoke all on keryx_storage.identity,keryx_storage.writer from public,anon,authenticated,service_role;

create function keryx_storage.validate_identity(p_identity jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare k text; keys text[];
begin
  if p_identity is null or jsonb_typeof(p_identity) is distinct from 'object' then
    raise exception 'storage identity refused: invalid_identity';
  end if;
  select array_agg(key order by key) into keys from jsonb_object_keys(p_identity) as key;
  if keys is distinct from array['authorityMode','deploymentId','enrolledAt','enrollmentId','format','network','profileDigest','provenanceDigest','storageId']::text[] then
    raise exception 'storage identity refused: invalid_identity';
  end if;
  foreach k in array keys loop
    if jsonb_typeof(p_identity->k) is distinct from 'string' then raise exception 'storage identity refused: invalid_identity'; end if;
  end loop;
  if p_identity->>'format' <> 'keryx-storage-identity-v1'
    or p_identity->>'network' <> 'eip155:5042002'
    or p_identity->>'authorityMode' not in ('testnet-real','testnet-offline')
    or p_identity->>'profileDigest' <> '1e6fc06a6668d1626af05d70e88a5df59eebdc67680aca58164cfc9f9c778d9c'
    or p_identity->>'provenanceDigest' !~ '^[0-9a-f]{64}$'
    or p_identity->>'enrolledAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' then
    raise exception 'storage identity refused: invalid_identity';
  end if;
  foreach k in array array['deploymentId','storageId','enrollmentId'] loop
    if p_identity->>k !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'storage identity refused: invalid_identity';
    end if;
  end loop;
  begin
    if to_char((p_identity->>'enrolledAt')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> p_identity->>'enrolledAt' then
      raise exception 'invalid enrollment time';
    end if;
  exception when others then raise exception 'storage identity refused: invalid_identity'; end;
end;
$$;

-- Match the shared helper's canonical JSON.stringify order, not jsonb::text.
create function keryx_storage.identity_digest(p_identity jsonb) returns text
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result text := '{'; k text; separator text := '';
begin
  perform keryx_storage.validate_identity(p_identity);
  foreach k in array array['format','deploymentId','storageId','network','authorityMode','profileDigest','enrollmentId','enrolledAt','provenanceDigest'] loop
    result := result || separator || to_json(k)::text || ':' || to_json(p_identity->>k)::text;
    separator := ',';
  end loop;
  return encode(sha256(convert_to(result || '}','UTF8')),'hex');
end;
$$;

create function keryx_storage.require_identity(p_expected_identity jsonb) returns text
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare record keryx_storage.identity%rowtype;
begin
  -- This inspects the actual outer statement setting before any catalog/lock work.
  if current_setting('statement_timeout')::interval<=interval '0'
    or current_setting('statement_timeout')::interval>interval '30 seconds' then
    raise exception 'bounded storage statement deadline required';
  end if;
  perform keryx_storage.validate_identity(p_expected_identity);
  select * into record from keryx_storage.identity where singleton;
  if not found then raise exception 'storage identity refused: enrollment_required'; end if;
  if record.identity is distinct from p_expected_identity
    or record.identity_digest is distinct from keryx_storage.identity_digest(p_expected_identity) then
    raise exception 'storage identity refused: identity_mismatch';
  end if;
  perform pg_advisory_xact_lock_shared(634781904177021::bigint);
  select * into record from keryx_storage.identity where singleton for share;
  if not found then raise exception 'storage identity refused: enrollment_required'; end if;
  if record.identity is distinct from p_expected_identity
     or record.identity_digest is distinct from keryx_storage.identity_digest(p_expected_identity) then
    raise exception 'storage identity refused: identity_mismatch';
  end if;
  perform keryx_storage.verify_fences();
  return record.identity_digest;
end;
$$;

create function keryx_storage.enter_operation(p_expected_identity jsonb,p_operation text) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare selected text; policy record;
begin
  selected := keryx_storage.require_identity(p_expected_identity);
  if p_operation is null or p_operation = '' then raise exception 'storage operation refused'; end if;
  select * into policy from keryx_storage.operations where operation=p_operation;
  if not found or policy.read_only or (policy.real_only and p_expected_identity->>'authorityMode'<>'testnet-real') then
    raise exception 'storage authority mode refused';
  end if;
  if exists(select 1 from keryx_storage.writer where transaction_id=txid_current()) then raise exception 'nested storage operation refused'; end if;
  insert into keryx_storage.writer values(txid_current(),selected,p_operation);
end;
$$;
-- SELECT-only operations never allocate a writer, acquire an authority row
-- lock, or mutate an advisory-lock capability. Normal roles cannot alter the
-- immutable marker; DB-owner/DDL trust and drained owner maintenance remain.
create function keryx_storage.require_identity_read(p_expected_identity jsonb) returns text
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare stored keryx_storage.identity%rowtype;
begin
  if current_setting('statement_timeout')::interval<=interval '0'
    or current_setting('statement_timeout')::interval>interval '30 seconds' then
    raise exception 'bounded storage statement deadline required';
  end if;
  perform keryx_storage.validate_identity(p_expected_identity);
  select * into stored from keryx_storage.identity where singleton;
  if not found then raise exception 'storage identity refused: enrollment_required'; end if;
  if stored.identity is distinct from p_expected_identity
    or stored.identity_digest is distinct from keryx_storage.identity_digest(p_expected_identity) then
    raise exception 'storage identity refused: identity_mismatch';
  end if;
  perform keryx_storage.verify_fences();
  return stored.identity_digest;
end; $$;

create function keryx_storage.read_operation(p_expected_identity jsonb,p_operation text) returns void
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare policy keryx_storage.operations%rowtype;
begin
  perform keryx_storage.require_identity_read(p_expected_identity);
  select * into policy from keryx_storage.operations where operation=p_operation;
  if not found or not policy.read_only or (policy.real_only and p_expected_identity->>'authorityMode'<>'testnet-real') then
    raise exception 'storage readonly operation refused';
  end if;
end; $$;
create function keryx_storage.leave_operation() returns void
language sql security definer set search_path=pg_catalog,pg_temp as $$
  delete from keryx_storage.writer where transaction_id=txid_current();
$$;

create function keryx_storage.identity_immutable() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin raise exception 'storage identity is immutable'; end;
$$;
create trigger identity_immutable before update or delete on keryx_storage.identity
  for each row execute function keryx_storage.identity_immutable();
create trigger identity_no_truncate before truncate on keryx_storage.identity
  for each statement execute function keryx_storage.identity_immutable();

create function public.read_storage_identity() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if current_setting('statement_timeout')::interval<=interval '0'
    or current_setting('statement_timeout')::interval>interval '30 seconds' then
    raise exception 'bounded storage statement deadline required';
  end if;
  select identity into result from keryx_storage.identity where singleton;
  return result;
end;
$$;
revoke all on function public.read_storage_identity() from public,anon,authenticated;
grant execute on function public.read_storage_identity() to service_role;
revoke all on all functions in schema keryx_storage from public,anon,authenticated,service_role;
commit;
