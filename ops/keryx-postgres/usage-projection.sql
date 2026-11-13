SET ROLE keryx_owner;
CREATE TABLE keryx_storage.usage_projection(
 run_id text PRIMARY KEY REFERENCES public.query_runs(id) ON DELETE CASCADE,
 original_sha256 text NOT NULL CHECK(original_sha256 ~ '^[a-f0-9]{64}$'),
 usage_wire text CHECK(octet_length(usage_wire)<=2048),provenance_wire text CHECK(octet_length(provenance_wire)<=1024),
 parsed_usage jsonb CHECK(parsed_usage IS NULL OR parsed_usage='null'::jsonb OR jsonb_typeof(parsed_usage)='object' AND octet_length(parsed_usage::text)<=2048),
 body_identity_valid boolean NOT NULL
);
CREATE FUNCTION keryx_storage.usage_projection_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT(session_user='postgres' AND (SELECT mode FROM keryx_storage.control WHERE singleton)='held') AND NOT EXISTS(
  SELECT 1 FROM keryx_storage.writer w JOIN keryx_storage.operations o ON o.operation=w.operation JOIN keryx_storage.identity i ON i.identity_digest=w.identity_digest
  WHERE w.transaction_id=txid_current() AND NOT o.read_only AND 'query_runs'=ANY(o.relations) AND 'usage_projection'=ANY(o.relations))
 THEN RAISE EXCEPTION 'native usage derivative writer required';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.query_runs q WHERE q.id=NEW.run_id AND NEW.original_sha256=keryx_storage.run_original_sha256(q.data))
 THEN RAISE EXCEPTION 'native usage derivative binding refused';END IF;RETURN NEW;
END;$$;
CREATE TRIGGER usage_projection_writer BEFORE INSERT OR UPDATE OR DELETE ON keryx_storage.usage_projection FOR EACH ROW EXECUTE FUNCTION keryx_storage.usage_projection_fence();
CREATE FUNCTION keryx_storage.usage_projection_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.data::text IS DISTINCT FROM OLD.data::text OR NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.asker IS DISTINCT FROM OLD.asker
 THEN DELETE FROM keryx_storage.usage_projection WHERE run_id=OLD.id;END IF;RETURN NEW;
END;$$;
CREATE TRIGGER native_usage_projection_invalidate AFTER UPDATE OF data,id,created_at,asker ON public.query_runs FOR EACH ROW EXECUTE FUNCTION keryx_storage.usage_projection_invalidate();
CREATE FUNCTION keryx_storage.install_usage_projection(selected_id text,packet jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF packet IS NULL OR jsonb_typeof(packet) IS DISTINCT FROM 'object' OR packet-'sha256'-'usageWire'-'provenanceWire'-'parsedUsage'-'bodyIdentityValid'<>'{}'::jsonb
  OR jsonb_typeof(packet->'bodyIdentityValid') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'native usage derivative refused';END IF;
 INSERT INTO keryx_storage.usage_projection(run_id,original_sha256,usage_wire,provenance_wire,parsed_usage,body_identity_valid)
 VALUES(selected_id,packet->>'sha256',packet->>'usageWire',packet->>'provenanceWire',packet->'parsedUsage',(packet->>'bodyIdentityValid')::boolean);
END;$$;
REVOKE ALL ON keryx_storage.usage_projection FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION keryx_storage.usage_projection_fence(),keryx_storage.usage_projection_invalidate(),keryx_storage.install_usage_projection(text,jsonb) FROM PUBLIC,keryx_app,keryx_reader;
RESET ROLE;
