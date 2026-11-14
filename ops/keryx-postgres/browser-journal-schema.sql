-- FRESH independently built SOURCE only. Never apply to a retained target.
-- Permanent browser rows use the actual SQLite column/key/raw TEXT model.
-- Transaction-local native writer capabilities intentionally remain distinct
-- from SQLite's ephemeral id=1 rows. Nonempty committed Source writers refuse.
SET ROLE keryx_owner;
DO $$ DECLARE relation text;n bigint;BEGIN
 IF EXISTS(SELECT 1 FROM keryx_storage.identity) OR (SELECT mode FROM keryx_storage.control WHERE singleton) IS DISTINCT FROM 'held' THEN RAISE EXCEPTION 'browser Source schema requires a fresh held target';END IF;
 FOREACH relation IN ARRAY ARRAY['browser_authorization_intents','browser_journal_bindings','browser_signing_namespaces','browser_signing_queries','browser_signing_originals','browser_signing_policies','browser_signing_v2_barrier','browser_journal_writer','browser_signing_v2_writer','browser_signing_v3_writer'] LOOP
  EXECUTE format('SELECT count(*) FROM public.%I',relation) INTO n;
  IF n<>0 THEN RAISE EXCEPTION 'browser Source schema refuses retained rows';END IF;
 END LOOP;
END;$$;
ALTER TABLE public.browser_journal_bindings ALTER COLUMN requirements TYPE text USING requirements::text,
 ALTER COLUMN payment_metadata TYPE text USING payment_metadata::text;
ALTER TABLE public.browser_authorization_intents ALTER COLUMN created_at TYPE text USING to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
ALTER TABLE public.browser_signing_namespaces DROP COLUMN ceiling_proof;
ALTER TABLE public.browser_signing_namespaces DROP CONSTRAINT browser_signing_namespaces_network_check;
-- This is retained historical proof identity, not mainnet payment authority.
ALTER TABLE public.browser_signing_namespaces ADD CONSTRAINT browser_source_namespace_network CHECK(network='eip155:5042002');
ALTER TABLE public.browser_signing_originals DROP CONSTRAINT browser_signing_originals_namespace_query_id_fkey;
ALTER TABLE public.browser_signing_queries DROP CONSTRAINT browser_signing_queries_namespace_policy_id_fkey;
ALTER TABLE public.browser_signing_queries DROP CONSTRAINT browser_signing_queries_pkey;
ALTER TABLE public.browser_signing_queries ADD PRIMARY KEY(query_id),ADD UNIQUE(namespace,policy_id);
ALTER TABLE public.browser_signing_originals DROP COLUMN namespace,DROP COLUMN journal,DROP COLUMN session_id,DROP COLUMN request_id,
 ALTER COLUMN original TYPE text USING original::text,ALTER COLUMN input TYPE text USING input::text;
ALTER TABLE public.browser_signing_originals ADD FOREIGN KEY(query_id) REFERENCES public.browser_signing_queries(query_id);
-- Source always retains a one-row barrier even while inactive. Its presence
-- alone never means active, and inactive Source controls may be read as such.
INSERT INTO public.browser_signing_v2_barrier(id,ever_active,min_original_version) VALUES(1,0,2);

-- Reuse existing trigger-function identities: no extra helper-function budget.
-- Legacy browser business RPCs remain ungranted/unrouted until the parent maps
-- their consumers to the fixed Source protocol. They cannot be a JSONB fallback.
CREATE OR REPLACE FUNCTION public.browser_signing_retention_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'browser signing history is retained';END IF;
 IF TG_TABLE_NAME='browser_signing_queries' THEN
  IF (to_jsonb(NEW)-'spent_micro') IS DISTINCT FROM (to_jsonb(OLD)-'spent_micro') OR NEW.spent_micro<OLD.spent_micro THEN RAISE EXCEPTION 'browser signing query is immutable';END IF;
 ELSIF TG_TABLE_NAME='browser_signing_namespaces' THEN
  IF ROW(NEW.namespace,NEW.owner,NEW.signer,NEW.service,NEW.network) IS DISTINCT FROM ROW(OLD.namespace,OLD.owner,OLD.signer,OLD.service,OLD.network) OR NEW.allocated_micro<OLD.allocated_micro OR NEW.jobs<OLD.jobs THEN RAISE EXCEPTION 'browser signing namespace history is retained';END IF;
 ELSIF TG_TABLE_NAME='browser_signing_v2_barrier' THEN
  IF NEW.id<>OLD.id OR NEW.min_original_version<OLD.min_original_version OR NEW.ever_active<OLD.ever_active THEN RAISE EXCEPTION 'browser signing barrier is retained';END IF;
 ELSE RAISE EXCEPTION 'browser signing original is immutable';END IF;
 RETURN NEW;
END;$$;
CREATE OR REPLACE FUNCTION public.browser_signing_control_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE retained integer;BEGIN
 IF TG_OP='DELETE' THEN IF OLD.min_original_version=3 THEN RAISE EXCEPTION 'browser source floor is retained';END IF;RETURN OLD;END IF;
 SELECT min_original_version INTO retained FROM public.browser_signing_v2_barrier WHERE id=1;
 IF NEW.min_original_version<coalesce(retained,2) OR TG_OP='UPDATE' AND NEW.min_original_version<OLD.min_original_version THEN RAISE EXCEPTION 'browser source floor is retained';END IF;
 UPDATE public.browser_signing_v2_barrier SET ever_active=CASE WHEN NEW.active THEN 1 ELSE ever_active END,min_original_version=greatest(min_original_version,NEW.min_original_version) WHERE id=1;
 RETURN NEW;
END;$$;
CREATE OR REPLACE FUNCTION public.browser_signing_fresh_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF ((SELECT active FROM public.browser_signing_v2_control WHERE id=1) IS TRUE OR (SELECT ever_active FROM public.browser_signing_v2_barrier WHERE id=1)=1)
  AND NOT EXISTS(SELECT 1 FROM public.browser_signing_v2_writer WHERE transaction_id=txid_current()) THEN RAISE EXCEPTION 'browser signing v2 writer required';END IF;
 IF (SELECT min_original_version FROM public.browser_signing_v2_barrier WHERE id=1)=3 AND NOT EXISTS(SELECT 1 FROM public.browser_signing_v3_writer WHERE transaction_id=txid_current()) THEN RAISE EXCEPTION 'browser source writer required';END IF;
 RETURN NEW;
END;$$;
CREATE OR REPLACE FUNCTION public.browser_signing_validity_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE original jsonb;authorization_tokens jsonb;BEGIN
 SELECT keryx_storage.source_scalar_text(o.original,'tokens') INTO original FROM public.browser_signing_originals o WHERE o.nonce=NEW.nonce;
 IF original IS NULL THEN RETURN NEW;END IF;authorization_tokens:=keryx_storage.source_scalar_text(original->>'authorization','tokens');
 IF original IS NOT NULL AND NEW.header_hash IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.browser_signing_v2_writer WHERE transaction_id=txid_current()) THEN RAISE EXCEPTION 'browser signing canonical callback required';END IF;
 IF original IS NOT NULL AND(NEW.valid_after IS NOT NULL AND (keryx_storage.source_scalar_text(authorization_tokens->>'validAfter','scalar')->>'jsonHex') IS DISTINCT FROM encode(convert_to(NEW.valid_after,'UTF8'),'hex') OR NEW.valid_before IS NOT NULL AND (keryx_storage.source_scalar_text(authorization_tokens->>'validBefore','scalar')->>'jsonHex') IS DISTINCT FROM encode(convert_to(NEW.valid_before,'UTF8'),'hex')) THEN RAISE EXCEPTION 'browser signing original validity differs';END IF;
 RETURN NEW;
END;$$;
CREATE OR REPLACE FUNCTION public.browser_signing_source_original_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE original jsonb:=keryx_storage.source_scalar_text(NEW.original,'tokens');context_tokens jsonb;protocol text;context_version text;BEGIN
 protocol:=keryx_storage.source_scalar_text(original->>'protocol','scalar')->>'shadow';
 IF original->>'sourceContext' IS NOT NULL THEN context_tokens:=keryx_storage.source_scalar_text(original->>'sourceContext','tokens');IF context_tokens->>'version' IS NOT NULL THEN context_version:=keryx_storage.source_scalar_text(context_tokens->>'version','scalar')->>'shadow';END IF;END IF;
 IF (SELECT min_original_version FROM public.browser_signing_v2_barrier WHERE id=1)=3 AND(NOT EXISTS(SELECT 1 FROM public.browser_signing_v3_writer WHERE transaction_id=txid_current()) OR protocol IS DISTINCT FROM 'durable-v3' OR context_version IS DISTINCT FROM 'source-context-v1' OR json_typeof((original->>'sourceContextDigest')::json) IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'browser source original required';END IF;
 IF protocol='durable-v3' AND((SELECT active FROM public.browser_journal_control WHERE id=1) IS DISTINCT FROM true OR (SELECT active FROM public.browser_signing_v2_control WHERE id=1) IS DISTINCT FROM true OR (SELECT min_original_version FROM public.browser_signing_v2_control WHERE id=1) IS DISTINCT FROM 3 OR NOT EXISTS(SELECT 1 FROM public.browser_signing_v3_writer WHERE transaction_id=txid_current())) THEN RAISE EXCEPTION 'browser source writer required';END IF;
 RETURN NEW;
END;$$;
CREATE OR REPLACE FUNCTION public.browser_signing_source_exposure_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v3 boolean;BEGIN
 IF OLD.authorization_phase='prepared' THEN
  SELECT EXISTS(SELECT 1 FROM public.browser_signing_originals o WHERE o.nonce=OLD.authorization_id AND (keryx_storage.source_scalar_text(keryx_storage.source_scalar_text(o.original,'tokens')->>'protocol','scalar')->>'shadow')='durable-v3') INTO v3;
  IF NEW.authorization_phase IN('exposed','signed','submission_attempted','settled','failed') AND (SELECT min_original_version FROM public.browser_signing_v2_barrier WHERE id=1)=3 AND NOT v3 THEN RAISE EXCEPTION 'browser source context required before exposure';END IF;
  IF NEW.authorization_phase='exposed' AND v3 AND((SELECT active FROM public.browser_journal_control WHERE id=1) IS DISTINCT FROM true OR (SELECT active FROM public.browser_signing_v2_control WHERE id=1) IS DISTINCT FROM true OR (SELECT min_original_version FROM public.browser_signing_v2_control WHERE id=1) IS DISTINCT FROM 3) THEN RAISE EXCEPTION 'browser source exposure inactive';END IF;
 END IF;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION public.browser_signing_retention_guard(),public.browser_signing_control_guard(),public.browser_signing_fresh_gate(),public.browser_signing_validity_gate(),public.browser_signing_source_original_gate(),public.browser_signing_source_exposure_gate() FROM PUBLIC,anon,authenticated,service_role,keryx_app,keryx_reader;
RESET ROLE;
