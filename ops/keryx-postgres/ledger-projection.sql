SET ROLE keryx_owner;
CREATE TABLE keryx_storage.public_ledger_projection(
 run_id text PRIMARY KEY REFERENCES public.query_runs(id) ON DELETE CASCADE,
 original_sha256 text NOT NULL CHECK(original_sha256 ~ '^[a-f0-9]{64}$'),original_valid boolean NOT NULL,
 snapshot_wire text CHECK(octet_length(snapshot_wire)<=2097152),
 reference_ids jsonb NOT NULL CHECK(jsonb_typeof(reference_ids)='array' AND jsonb_array_length(reference_ids)<=2000 AND octet_length(reference_ids::text)<=2097152)
);
CREATE FUNCTION keryx_storage.ledger_projection_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT(session_user='postgres' AND (SELECT mode FROM keryx_storage.control WHERE singleton)='held') AND NOT EXISTS(
  SELECT 1 FROM keryx_storage.writer w JOIN keryx_storage.operations o ON o.operation=w.operation JOIN keryx_storage.identity i ON i.identity_digest=w.identity_digest
  WHERE w.transaction_id=txid_current() AND NOT o.read_only AND 'query_runs'=ANY(o.relations) AND 'public_ledger_projection'=ANY(o.relations))
 THEN RAISE EXCEPTION 'native ledger derivative writer required';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.query_runs q WHERE q.id=NEW.run_id AND NEW.original_sha256=keryx_storage.run_original_sha256(q.data))
 THEN RAISE EXCEPTION 'native ledger derivative binding refused';END IF;RETURN NEW;
END;$$;
CREATE TRIGGER public_ledger_projection_writer BEFORE INSERT OR UPDATE OR DELETE ON keryx_storage.public_ledger_projection FOR EACH ROW EXECUTE FUNCTION keryx_storage.ledger_projection_fence();
CREATE FUNCTION keryx_storage.ledger_projection_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.data::text IS DISTINCT FROM OLD.data::text OR NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.asker IS DISTINCT FROM OLD.asker
 THEN DELETE FROM keryx_storage.public_ledger_projection WHERE run_id=OLD.id;END IF;RETURN NEW;
END;$$;
CREATE TRIGGER native_ledger_projection_invalidate AFTER UPDATE OF data,id,created_at,asker ON public.query_runs FOR EACH ROW EXECUTE FUNCTION keryx_storage.ledger_projection_invalidate();
CREATE FUNCTION keryx_storage.install_ledger_projection(selected_id text,packet jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF packet IS NULL OR jsonb_typeof(packet) IS DISTINCT FROM 'object' OR packet-'sha256'-'valid'-'snapshotWire'-'references'<>'{}'::jsonb
  OR jsonb_typeof(packet->'valid') IS DISTINCT FROM 'boolean' OR jsonb_typeof(packet->'references') IS DISTINCT FROM 'array'
  OR jsonb_typeof(packet->'snapshotWire') NOT IN('string','null') THEN RAISE EXCEPTION 'native ledger derivative refused';END IF;
 INSERT INTO keryx_storage.public_ledger_projection(run_id,original_sha256,original_valid,snapshot_wire,reference_ids)
 VALUES(selected_id,packet->>'sha256',(packet->>'valid')::boolean,packet->>'snapshotWire',packet->'references');
END;$$;
REVOKE ALL ON keryx_storage.public_ledger_projection FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION keryx_storage.ledger_projection_fence(),keryx_storage.ledger_projection_invalidate(),keryx_storage.install_ledger_projection(text,jsonb) FROM PUBLIC,keryx_app,keryx_reader;
RESET ROLE;
