-- Fresh SOURCE only. Retained originals are copied separately; no backfill,
-- owner-consent admission, optional-port initialization or backend selection.
SET ROLE keryx_owner;
ALTER TABLE public.browser_journal_bindings ADD COLUMN payment_context text CHECK(payment_context IS NULL OR payment_context IS JSON);
ALTER TABLE public.browser_signing_namespaces ADD COLUMN proof text NOT NULL CHECK(proof IS JSON);
ALTER TABLE public.browser_signing_queries ADD COLUMN grant_epoch text NOT NULL;
ALTER TABLE public.browser_signing_queries ADD COLUMN proof text NOT NULL CHECK(proof IS JSON);
ALTER TABLE public.browser_signing_queries ADD COLUMN proof_digest text NOT NULL;
ALTER TABLE public.browser_signing_v2_barrier ADD COLUMN ever_active keryx_storage.sqlite_number NOT NULL DEFAULT 0 CHECK(ever_active IN(0,1));
ALTER TABLE public.source_items ADD COLUMN evidence_provenance text;
ALTER TABLE public.sources ADD COLUMN preview_depth text;
ALTER TABLE public.sources ADD COLUMN evidence_provenance text;

CREATE FUNCTION keryx_storage.mainnet_binding_retention() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.nonce IS DISTINCT FROM OLD.nonce OR NEW.requirements IS DISTINCT FROM OLD.requirements
  OR NEW.payment_metadata IS DISTINCT FROM OLD.payment_metadata
  OR (OLD.payment_context IS NOT NULL AND NEW.payment_context IS DISTINCT FROM OLD.payment_context)
  OR (NEW.payment_context IS DISTINCT FROM OLD.payment_context AND NOT EXISTS(SELECT 1 FROM public.payment_events WHERE id='x402:'||OLD.nonce AND authorization_phase='prepared'))
 THEN RAISE EXCEPTION 'original mainnet challenge immutable';END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER mainnet_binding_retention BEFORE UPDATE ON public.browser_journal_bindings FOR EACH ROW EXECUTE FUNCTION keryx_storage.mainnet_binding_retention();
REVOKE ALL ON FUNCTION keryx_storage.mainnet_binding_retention() FROM PUBLIC,keryx_app,keryx_reader;
RESET ROLE;
