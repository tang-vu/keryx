SET ROLE keryx_owner;
ALTER TABLE keryx_storage.run_history_projection ADD COLUMN anonymous_claim_eligible boolean NOT NULL DEFAULT false;
{{CLAIM_ORIGIN_VALIDATOR}}
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('run_claims_ready',ARRAY[]::text[],true,true),
 ('run_claim_issue',ARRAY['anonymous_run_claims']::text[],true,false),
 ('run_claim_consume',ARRAY['anonymous_run_claims']::text[],true,false);
CREATE OR REPLACE FUNCTION keryx_storage.run_projection_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.data::text IS DISTINCT FROM OLD.data::text OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.id IS DISTINCT FROM OLD.id
 THEN DELETE FROM keryx_storage.run_history_projection WHERE run_id=OLD.id;END IF;RETURN NEW;
END;$$;
DROP TRIGGER native_original_projection_invalidate ON public.query_runs;
CREATE TRIGGER native_original_projection_invalidate AFTER UPDATE OF data,created_at,id ON public.query_runs FOR EACH ROW EXECUTE FUNCTION keryx_storage.run_projection_invalidate();
CREATE FUNCTION keryx_storage.claim_original(run_id text,completed_at text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r record;fingerprint text;
BEGIN
 SELECT q.asker,q.created_at,q.data,p.anonymous_claim_eligible,p.original_sha256,p.original_created_at INTO r FROM public.query_runs q
  JOIN keryx_storage.run_history_projection p ON p.run_id=q.id WHERE q.id=claim_original.run_id FOR SHARE OF q;
 IF NOT FOUND OR r.asker IS NOT NULL OR NOT r.anonymous_claim_eligible OR r.original_created_at IS DISTINCT FROM completed_at
  OR r.created_at IS DISTINCT FROM completed_at::timestamptz
  OR EXISTS(SELECT 1 FROM public.a2a_orders WHERE query_id=claim_original.run_id) THEN RAISE EXCEPTION 'claim_unavailable';END IF;
 fingerprint:=keryx_storage.run_original_sha256(r.data);
 IF fingerprint IS DISTINCT FROM r.original_sha256 THEN RAISE EXCEPTION 'claim_unavailable';END IF;
 RETURN fingerprint;
END;$$;
CREATE FUNCTION keryx_storage.claim_immutable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF session_user='postgres' AND (SELECT mode FROM keryx_storage.control WHERE singleton)='held' THEN
  IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
 END IF;
 IF TG_OP='DELETE' OR TG_OP='INSERT' AND(NEW.claimed_wallet IS NOT NULL OR NEW.claimed_at IS NOT NULL)
  OR TG_OP='UPDATE' AND(OLD.claimed_wallet IS NOT NULL OR NEW.claimed_wallet IS NULL OR NEW.claimed_at IS NULL
   OR to_jsonb(NEW)-'claimed_wallet'-'claimed_at' IS DISTINCT FROM to_jsonb(OLD)-'claimed_wallet'-'claimed_at')
 THEN RAISE EXCEPTION 'claim_unavailable';END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER native_claim_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.anonymous_run_claims FOR EACH ROW EXECUTE FUNCTION keryx_storage.claim_immutable();
CREATE TRIGGER native_claim_writer BEFORE INSERT OR UPDATE OR DELETE ON public.anonymous_run_claims FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence();
CREATE FUNCTION public.storage_run_claims_ready(expected jsonb,digest text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native claim read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'run_claims_ready');RETURN jsonb_build_object('domain','anonymous-run-claims-v1');
END;$$;
CREATE FUNCTION public.storage_run_claim_issue(expected jsonb,digest text,run_id text,token_hash text,completed_at text,network text,origin text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE stamp bigint;fingerprint text;result jsonb;
BEGIN
 PERFORM keryx_storage.require_operation(expected,digest,'run_claim_issue');
 BEGIN
  IF run_id IS NULL OR run_id !~ '^[A-Za-z0-9_-]{1,128}$' OR left(run_id,4)='prv_' OR left(run_id,4)='a2a_'
   OR token_hash IS NULL OR token_hash !~ '^[a-f0-9]{64}$' OR network IS DISTINCT FROM expected->>'network'
   OR NOT coalesce(keryx_storage.claim_origin_valid(origin),false) OR completed_at IS NULL
   OR completed_at !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
   OR to_char(completed_at::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>completed_at
   THEN RAISE EXCEPTION 'claim_unavailable';END IF;
  fingerprint:=keryx_storage.claim_original(run_id,completed_at);
  stamp:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
  IF stamp NOT BETWEEN 0 AND 8639999913600000 OR completed_at::timestamptz>clock_timestamp()
   OR EXISTS(SELECT 1 FROM public.anonymous_run_claims c WHERE c.run_id=storage_run_claim_issue.run_id OR c.token_hash=storage_run_claim_issue.token_hash)
   THEN RAISE EXCEPTION 'claim_unavailable';END IF;
  INSERT INTO public.anonymous_run_claims(run_id,network,origin,token_hash,original_sha256,completed_at,issued_at,expires_at)
   VALUES(run_id,network,origin,token_hash,fingerprint,completed_at,stamp,stamp+86400000);
  result:=jsonb_build_object('version',1,'runId',run_id,'binding',jsonb_build_object('network',network,'origin',origin),
   'issuedAt',to_char(to_timestamp(stamp/1000.0) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'expiresAt',to_char(to_timestamp((stamp+86400000)/1000.0) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'claim_unavailable' THEN RAISE;END IF;
  PERFORM keryx_storage.leave_operation();RETURN jsonb_build_object('error','claim_unavailable');
 END;
 PERFORM keryx_storage.leave_operation();RETURN jsonb_build_object('issued',result);
END;$$;
CREATE FUNCTION public.storage_run_claim_consume(expected jsonb,digest text,token_hash text,wallet text,session_hash text,network text,origin text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE stamp bigint;s public.web_sessions%rowtype;c public.anonymous_run_claims%rowtype;fingerprint text;result jsonb;
BEGIN
 PERFORM keryx_storage.require_operation(expected,digest,'run_claim_consume');
 BEGIN
  IF wallet IS NULL OR wallet !~ '^0x[0-9a-f]{40}$' OR session_hash IS NULL OR session_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'claim_unauthenticated';END IF;
  SELECT * INTO s FROM public.web_sessions WHERE hash=session_hash AND web_sessions.wallet=storage_run_claim_consume.wallet FOR SHARE;
  stamp:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
  IF NOT FOUND OR s.issued_at>stamp OR s.expires_at<=stamp THEN RAISE EXCEPTION 'claim_unauthenticated';END IF;
  IF token_hash IS NULL OR token_hash !~ '^[a-f0-9]{64}$' OR network IS DISTINCT FROM expected->>'network'
   OR NOT coalesce(keryx_storage.claim_origin_valid(origin),false) THEN RAISE EXCEPTION 'claim_unavailable';END IF;
  SELECT * INTO c FROM public.anonymous_run_claims a WHERE a.token_hash=storage_run_claim_consume.token_hash
   AND a.network=storage_run_claim_consume.network AND a.origin=storage_run_claim_consume.origin FOR UPDATE;
  IF NOT FOUND OR c.claimed_wallet IS NOT NULL THEN RAISE EXCEPTION 'claim_unavailable';END IF;
  fingerprint:=keryx_storage.claim_original(c.run_id,c.completed_at);
  stamp:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
  IF s.issued_at>stamp OR s.expires_at<=stamp THEN RAISE EXCEPTION 'claim_unauthenticated';END IF;
  IF c.issued_at>stamp OR c.expires_at<=stamp OR c.original_sha256 IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'claim_unavailable';END IF;
  UPDATE public.anonymous_run_claims a SET claimed_wallet=wallet,claimed_at=stamp WHERE a.run_id=c.run_id AND a.claimed_wallet IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim_unavailable';END IF;
  result:=jsonb_build_object('version',1,'runId',c.run_id,'wallet',wallet,'binding',jsonb_build_object('network',network,'origin',origin),
   'claimedAt',to_char(to_timestamp(stamp/1000.0) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT IN('claim_unavailable','claim_unauthenticated') THEN RAISE;END IF;
  PERFORM keryx_storage.leave_operation();RETURN jsonb_build_object('error',SQLERRM);
 END;
 PERFORM keryx_storage.leave_operation();RETURN jsonb_build_object('claimed',result);
END;$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_run_claims_ready(jsonb,text),public.storage_run_claim_issue(jsonb,text,text,text,text,text,text),public.storage_run_claim_consume(jsonb,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_run_claims_ready(jsonb,text) TO keryx_app,keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_run_claim_issue(jsonb,text,text,text,text,text,text),public.storage_run_claim_consume(jsonb,text,text,text,text,text,text) TO keryx_app;
RESET ROLE;
