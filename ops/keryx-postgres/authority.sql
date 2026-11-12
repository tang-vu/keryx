-- Fresh source-reference/domain installation only. This is not a complete
-- application schema, production enrollment or a backend cutover command.
CREATE SCHEMA keryx_storage AUTHORIZATION keryx_owner;
REVOKE ALL ON SCHEMA keryx_storage FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE keryx_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
SET ROLE keryx_owner;
CREATE TABLE keryx_storage.identity(singleton boolean PRIMARY KEY CHECK(singleton),identity jsonb NOT NULL,
 identity_digest text NOT NULL CHECK(identity_digest ~ '^[0-9a-f]{64}$'));
CREATE TABLE keryx_storage.source_contract(singleton boolean PRIMARY KEY CHECK(singleton),expected_metadata jsonb NOT NULL,
 source_digest text NOT NULL CHECK(source_digest ~ '^[0-9a-f]{64}$'));
CREATE TABLE keryx_storage.control(singleton boolean PRIMARY KEY CHECK(singleton),mode text NOT NULL CHECK(mode IN('held','active','retired')),
 origin text NOT NULL DEFAULT 'https://keryx.cc');
INSERT INTO keryx_storage.control(singleton,mode) VALUES(true,'held');
CREATE TABLE keryx_storage.operations(operation text PRIMARY KEY,relations text[] NOT NULL,real_only boolean NOT NULL,read_only boolean NOT NULL);
CREATE TABLE keryx_storage.writer(transaction_id bigint PRIMARY KEY,identity_digest text NOT NULL,operation text NOT NULL);
REVOKE ALL ON ALL TABLES IN SCHEMA keryx_storage FROM PUBLIC;

CREATE FUNCTION keryx_storage.immutable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN RAISE EXCEPTION 'retained storage original'; END; $$;
CREATE TRIGGER identity_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON keryx_storage.identity FOR EACH STATEMENT EXECUTE FUNCTION keryx_storage.immutable();
CREATE TRIGGER contract_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON keryx_storage.source_contract FOR EACH STATEMENT EXECUTE FUNCTION keryx_storage.immutable();

CREATE FUNCTION keryx_storage.validate_identity(value jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE keys text[]; k text;
BEGIN
 IF value IS NULL OR jsonb_typeof(value) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid storage identity'; END IF;
 SELECT array_agg(key ORDER BY key) INTO keys FROM jsonb_object_keys(value) AS key;
 IF keys IS DISTINCT FROM ARRAY['authorityMode','deploymentId','enrolledAt','enrollmentId','format','network','profileDigest','provenanceDigest','storageId']::text[]
 THEN RAISE EXCEPTION 'invalid storage identity'; END IF;
 FOREACH k IN ARRAY keys LOOP
  IF jsonb_typeof(value->k) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'invalid storage identity'; END IF;
 END LOOP;
 IF value->>'format'<>'keryx-mainnet-storage-identity-v1' OR value->>'network'<>'eip155:5042' OR value->>'authorityMode'<>'mainnet-real'
  OR value->>'profileDigest'<>'{{MAINNET_PROFILE_DIGEST}}' OR value->>'provenanceDigest' !~ '^[0-9a-f]{64}$'
  OR value->>'enrolledAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
 THEN RAISE EXCEPTION 'invalid storage identity'; END IF;
 FOREACH k IN ARRAY ARRAY['deploymentId','storageId','enrollmentId'] LOOP
  IF value->>k !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'invalid storage identity'; END IF;
 END LOOP;
 IF to_char((value->>'enrolledAt')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>value->>'enrolledAt'
 THEN RAISE EXCEPTION 'invalid storage identity'; END IF;
END; $$;
CREATE FUNCTION keryx_storage.identity_digest(value jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE wire text:='{'; separator text:=''; k text;
BEGIN
 PERFORM keryx_storage.validate_identity(value);
 FOREACH k IN ARRAY ARRAY['format','deploymentId','storageId','network','authorityMode','profileDigest','enrollmentId','enrolledAt','provenanceDigest'] LOOP
  wire:=wire||separator||to_json(k)::text||':'||to_json(value->>k)::text; separator:=',';
 END LOOP;
 RETURN encode(sha256(convert_to(wire||'}','UTF8')),'hex');
END; $$;

CREATE FUNCTION keryx_storage.catalog_contract() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $catalog$
{{CATALOG_BODY}}
$catalog$;
CREATE FUNCTION keryx_storage.control_transition() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(634781904177021::bigint);
 IF OLD.mode='retired' OR NEW.singleton IS DISTINCT FROM OLD.singleton OR NEW.origin IS DISTINCT FROM OLD.origin THEN RAISE EXCEPTION 'retired storage control'; END IF;
 IF NEW.mode='active' AND (NOT EXISTS(SELECT 1 FROM keryx_storage.identity) OR NOT EXISTS(SELECT 1 FROM keryx_storage.source_contract))
 THEN RAISE EXCEPTION 'storage admission incomplete'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER control_transition BEFORE UPDATE ON keryx_storage.control FOR EACH ROW EXECUTE FUNCTION keryx_storage.control_transition();
CREATE TRIGGER control_retained BEFORE DELETE OR TRUNCATE ON keryx_storage.control FOR EACH STATEMENT EXECUTE FUNCTION keryx_storage.immutable();

CREATE FUNCTION keryx_storage.require_operation(expected jsonb,digest text,selected text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE stored keryx_storage.identity%rowtype; contract keryx_storage.source_contract%rowtype; policy keryx_storage.operations%rowtype;
BEGIN
 IF current_setting('server_version_num')::integer/10000<>17 OR current_setting('transaction_isolation')<>'read committed'
  OR current_setting('synchronous_commit')<>'on' OR current_setting('fsync')<>'on' OR current_setting('full_page_writes')<>'on'
  OR current_setting('client_encoding')<>'UTF8' OR current_setting('server_encoding')<>'UTF8' OR current_setting('TimeZone')<>'UTC'
  OR current_setting('statement_timeout')::interval<=interval '0' OR current_setting('statement_timeout')::interval>interval '5 seconds'
  OR current_setting('lock_timeout')::interval<=interval '0' OR current_setting('lock_timeout')::interval>interval '1 second'
  OR session_user NOT IN('keryx_app','keryx_reader') THEN RAISE EXCEPTION 'native storage connection refused'; END IF;
 PERFORM keryx_storage.validate_identity(expected);
 PERFORM pg_advisory_xact_lock_shared(634781904177021::bigint);
 SELECT * INTO stored FROM keryx_storage.identity WHERE singleton;
 IF NOT FOUND OR stored.identity IS DISTINCT FROM expected OR stored.identity_digest IS DISTINCT FROM keryx_storage.identity_digest(expected)
  OR (SELECT mode FROM keryx_storage.control WHERE singleton) IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'storage identity unavailable'; END IF;
 SELECT * INTO policy FROM keryx_storage.operations WHERE operation=selected;
 IF NOT FOUND OR (NOT policy.read_only AND session_user<>'keryx_app') THEN RAISE EXCEPTION 'storage operation refused'; END IF;
 -- One coherent financial observation, or one serialized financial mutation.
 IF policy.read_only THEN PERFORM pg_advisory_xact_lock_shared(634781904177022::bigint);
 ELSE PERFORM pg_advisory_xact_lock(634781904177022::bigint); END IF;
 SELECT * INTO contract FROM keryx_storage.source_contract WHERE singleton;
 IF NOT FOUND OR digest IS DISTINCT FROM contract.source_digest OR contract.expected_metadata IS DISTINCT FROM keryx_storage.catalog_contract()
 THEN RAISE EXCEPTION 'native storage source contract unavailable'; END IF;
 IF NOT policy.read_only THEN INSERT INTO keryx_storage.writer VALUES(txid_current(),stored.identity_digest,selected); END IF;
END; $$;
CREATE FUNCTION keryx_storage.leave_operation() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 DELETE FROM keryx_storage.writer WHERE transaction_id=txid_current();
$$;
CREATE FUNCTION keryx_storage.write_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 -- Owner-only import into a held, fresh target. Application roles cannot enter
 -- this lane or turn an imported row into enrollment/financial authority.
 IF session_user='postgres' AND (SELECT mode FROM keryx_storage.control WHERE singleton)='held' THEN
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM keryx_storage.writer w JOIN keryx_storage.operations o ON o.operation=w.operation
   JOIN keryx_storage.identity i ON i.identity_digest=w.identity_digest
   WHERE w.transaction_id=txid_current() AND TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME=ANY(o.relations) AND NOT o.read_only)
 THEN RAISE EXCEPTION 'native storage writer required'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
RESET ROLE;
