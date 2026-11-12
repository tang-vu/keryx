SET ROLE keryx_owner;
CREATE FUNCTION keryx_storage.run_original_sha256(original json) RETURNS text
 LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF octet_length(original::text)>4000000 THEN RAISE EXCEPTION 'original run byte bound';END IF;
 RETURN encode(sha256(convert_to(original::text,'UTF8')),'hex');
END;$$;
-- A derivative, never a replacement for the retained original. The import
-- producer uses SQLite's actual projection; new writers capture one JS packet.
CREATE TABLE keryx_storage.run_history_projection(
 run_id text PRIMARY KEY REFERENCES public.query_runs(id) ON DELETE CASCADE,
 original_sha256 text NOT NULL CHECK(original_sha256 ~ '^[a-f0-9]{64}$'),
 recorded_owner text CHECK(recorded_owner IS NULL OR recorded_owner ~ '^0x[0-9a-f]{40}$'),
 owner_invalid boolean NOT NULL,funded boolean NOT NULL,
 provenance jsonb CHECK(provenance IS NULL OR
  jsonb_typeof(provenance)='object' AND octet_length(provenance::text)<=512
  AND provenance ?& ARRAY['version','surface','ownershipMethod'] AND
  provenance-'version'-'surface'-'ownershipMethod'='{}'::jsonb AND provenance->'version'='1'::jsonb
  AND provenance->>'surface'=ANY(ARRAY['web','remote-mcp','stdio-mcp','api','agent-to-agent','telegram','discord','slack','extension','desktop','cli','unknown'])
  AND provenance->>'ownershipMethod'=ANY(ARRAY['session','api-key','verified-payer','unknown']))
);
CREATE FUNCTION keryx_storage.run_projection_write_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT(session_user='postgres' AND (SELECT mode FROM keryx_storage.control WHERE singleton)='held')
  AND NOT EXISTS(SELECT 1 FROM keryx_storage.writer w JOIN keryx_storage.operations o ON o.operation=w.operation
   JOIN keryx_storage.identity i ON i.identity_digest=w.identity_digest WHERE w.transaction_id=txid_current() AND NOT o.read_only
    AND 'query_runs'=ANY(o.relations) AND 'run_history_projection'=ANY(o.relations))
 THEN RAISE EXCEPTION 'native original projection writer required';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 IF NEW.original_sha256 IS DISTINCT FROM (SELECT keryx_storage.run_original_sha256(data) FROM public.query_runs WHERE id=NEW.run_id)
 THEN RAISE EXCEPTION 'native original projection binding refused';END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER projection_writer BEFORE INSERT OR UPDATE OR DELETE ON keryx_storage.run_history_projection FOR EACH ROW EXECUTE FUNCTION keryx_storage.run_projection_write_fence();
CREATE FUNCTION keryx_storage.run_projection_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.data::text IS DISTINCT FROM OLD.data::text THEN DELETE FROM keryx_storage.run_history_projection WHERE run_id=OLD.id;END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER native_original_projection_invalidate AFTER UPDATE OF data ON public.query_runs FOR EACH ROW EXECUTE FUNCTION keryx_storage.run_projection_invalidate();
REVOKE ALL ON TABLE keryx_storage.run_history_projection FROM PUBLIC,anon,authenticated,service_role,keryx_app,keryx_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
RESET ROLE;
