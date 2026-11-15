-- Fresh Source construction only; keep the existing two function identities.
-- Originals have their separate immutable/selected-identity BEFORE fence.
SET ROLE keryx_owner;
DO $payment_observation$
DECLARE original_body text;extended_body text;definition text;anchor text;
BEGIN
 IF (SELECT mode FROM keryx_storage.control WHERE singleton) IS DISTINCT FROM 'held'
  OR EXISTS(SELECT 1 FROM keryx_storage.identity) OR EXISTS(SELECT 1 FROM public.payment_events)
  OR EXISTS(SELECT 1 FROM keryx_storage.payment_event_originals)
 THEN RAISE EXCEPTION 'native payment observation requires fresh Source';END IF;
 SELECT prosrc INTO STRICT original_body FROM pg_proc WHERE oid='keryx_storage.require_operation(jsonb,text,text)'::regprocedure;
 anchor:=E' IF policy.read_only THEN PERFORM pg_advisory_xact_lock_shared(634781904177022::bigint);\n ELSE PERFORM pg_advisory_xact_lock(634781904177022::bigint); END IF;';
 IF (length(original_body)-length(replace(original_body,anchor,'')))/length(anchor)<>1
  OR strpos(original_body,'Native payment raw observation guard v1')>0
 THEN RAISE EXCEPTION 'native payment observation constructor refused';END IF;
 extended_body:=replace(original_body,anchor,anchor||$observation$
 -- Native payment raw observation guard v1
 -- Fresh observation AFTER the shared/exclusive data lock, before any writer
 -- capability. The fixed runtime authority probe also checks actual coverage.
 IF selected=ANY(ARRAY[{{LEGACY_PAYMENT_OPERATIONS}}]::text[])
  OR selected=ANY(ARRAY[{{SOURCE_PAYMENT_OPERATIONS}}]::text[]) OR selected='native_runtime_authority' THEN
  IF EXISTS(SELECT 1 FROM public.payment_events p LEFT JOIN keryx_storage.payment_event_originals r ON r.payment_id=p.id
    WHERE r.payment_id IS NULL OR r.identity_digest IS DISTINCT FROM stored.identity_digest
     OR r.native_projection IS DISTINCT FROM to_jsonb(p))
   OR EXISTS(SELECT 1 FROM keryx_storage.payment_event_originals r LEFT JOIN public.payment_events p ON p.id=r.payment_id WHERE p.id IS NULL)
  THEN RAISE EXCEPTION 'native payment raw original coverage or projection unavailable';END IF;
  IF selected=ANY(ARRAY[{{LEGACY_PAYMENT_OPERATIONS}}]::text[])
   AND EXISTS(SELECT 1 FROM keryx_storage.payment_event_originals WHERE cardinality(unprojected_fields)>0)
  THEN RAISE EXCEPTION 'native payment raw observation unavailable to legacy observer';END IF;
 END IF;
$observation$);
 -- The second occurrence above is intentionally one identical literal list;
 -- the TypeScript constructor must expand both from the same closed inventory.
 definition:=pg_get_functiondef('keryx_storage.require_operation(jsonb,text,text)'::regprocedure);
 IF (length(definition)-length(replace(definition,original_body,'')))/length(original_body)<>1
 THEN RAISE EXCEPTION 'native payment observation definition refused';END IF;
 EXECUTE replace(definition,original_body,extended_body);
 IF (SELECT prosrc FROM pg_proc WHERE oid='keryx_storage.require_operation(jsonb,text,text)'::regprocedure) IS DISTINCT FROM extended_body
 THEN RAISE EXCEPTION 'native payment observation preservation refused';END IF;

 SELECT prosrc INTO STRICT original_body FROM pg_proc WHERE oid='keryx_storage.write_fence()'::regprocedure;
 IF left(original_body,7) IS DISTINCT FROM E'\nBEGIN\n' OR strpos(original_body,'Native payment deferred coherence v1')>0
  OR strpos(original_body,'Native payment Source original fence v1')=0
 THEN RAISE EXCEPTION 'native payment coherence constructor refused';END IF;
 extended_body:=E'\nDECLARE payment_coherence_id text;\nBEGIN\n'||$coherence$
 -- Native payment deferred coherence v1
 IF TG_WHEN='AFTER' AND TG_NAME='native_payment_current_coherence' THEN
  -- Trusted held intake streams public rows and immutable Source originals in
  -- bounded stages. Every application mutation is checked at final COMMIT,
  -- after both rows changed and after transient writer tokens were cleared.
  IF TG_TABLE_SCHEMA='public' THEN
   IF TG_OP='DELETE' THEN payment_coherence_id:=OLD.id;ELSE payment_coherence_id:=NEW.id;END IF;
  ELSE
   IF TG_OP='DELETE' THEN payment_coherence_id:=OLD.payment_id;ELSE payment_coherence_id:=NEW.payment_id;END IF;
  END IF;
  IF NOT(session_user='postgres' AND (SELECT mode FROM keryx_storage.control WHERE singleton)='held') AND(
   EXISTS(SELECT 1 FROM public.payment_events p LEFT JOIN keryx_storage.payment_event_originals r ON r.payment_id=p.id
    WHERE p.id=payment_coherence_id
    AND(r.payment_id IS NULL OR r.identity_digest IS DISTINCT FROM (SELECT identity_digest FROM keryx_storage.identity WHERE singleton)
     OR r.native_projection IS DISTINCT FROM to_jsonb(p)))
   OR EXISTS(SELECT 1 FROM keryx_storage.payment_event_originals r LEFT JOIN public.payment_events p ON p.id=r.payment_id WHERE p.id IS NULL))
  THEN RAISE EXCEPTION 'native payment current projection not committed atomically';END IF;
  IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
 END IF;
$coherence$||substring(original_body FROM 8);
 definition:=pg_get_functiondef('keryx_storage.write_fence()'::regprocedure);
 IF (length(definition)-length(replace(definition,original_body,'')))/length(original_body)<>1
 THEN RAISE EXCEPTION 'native payment coherence definition refused';END IF;
 EXECUTE replace(definition,original_body,extended_body);
 IF (SELECT prosrc FROM pg_proc WHERE oid='keryx_storage.write_fence()'::regprocedure) IS DISTINCT FROM extended_body
 THEN RAISE EXCEPTION 'native payment coherence preservation refused';END IF;
END;$payment_observation$;
CREATE CONSTRAINT TRIGGER native_payment_current_coherence AFTER INSERT OR UPDATE OR DELETE ON public.payment_events
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence();
CREATE CONSTRAINT TRIGGER native_payment_current_coherence AFTER INSERT OR UPDATE OR DELETE ON keryx_storage.payment_event_originals
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence();
RESET ROLE;
