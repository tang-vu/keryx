-- Retained signed requests and single-use initial transfer claims. Stored
-- attestation is request-matched evidence only, never a claim of finality.
SET ROLE keryx_owner;
CREATE INDEX creator_withdrawal_owner ON public.creator_withdrawal_requests(owner,created_at DESC,id DESC);
CREATE UNIQUE INDEX creator_withdrawal_spec_once ON public.creator_withdrawal_requests((data::jsonb #> '{request,burnIntent,spec}'));
INSERT INTO keryx_storage.operations VALUES
 ('creator_withdrawal_read',ARRAY['creator_withdrawal_requests','creator_withdrawal_transfer_attempts','creator_withdrawal_attestations'],true,true),
 ('creator_withdrawal_history',ARRAY['creator_withdrawal_requests'],true,true),
 ('creator_withdrawal_reserve',ARRAY['creator_withdrawal_requests'],true,false),
 ('creator_withdrawal_claim',ARRAY['creator_withdrawal_transfer_attempts'],true,false),
 ('creator_withdrawal_attestation',ARRAY['creator_withdrawal_attestations'],true,false);
CREATE FUNCTION keryx_storage.creator_withdrawal_snapshot(id text,owner_addr text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('record',r.data::jsonb,'createdAt',r.created_at,
  'claim',CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('claimId',c.claim_id,'startedAt',c.started_at) END,
  'attestation',CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object('claim_id',a.claim_id,'transfer_id',a.transfer_id,'data',a.data::jsonb,'saved_at',a.saved_at) END)
 FROM public.creator_withdrawal_requests r LEFT JOIN public.creator_withdrawal_transfer_attempts c USING(id)
 LEFT JOIN public.creator_withdrawal_attestations a USING(id) WHERE r.id=$1 AND r.owner=$2;
$$;
CREATE FUNCTION public.storage_creator_withdrawal_read(expected jsonb,digest text,id text,owner_addr text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN PERFORM keryx_storage.require_operation(expected,digest,'creator_withdrawal_read');
 IF id IS NULL OR id !~ '^0x[0-9a-f]{64}$' OR owner_addr IS NULL OR owner_addr !~ '^0x[0-9a-f]{40}$' THEN RAISE EXCEPTION 'withdrawal selector refused'; END IF;
 RETURN keryx_storage.creator_withdrawal_snapshot(id,owner_addr); END; $$;
CREATE FUNCTION public.storage_creator_withdrawal_history(expected jsonb,digest text,owner_addr text,before_time text,before_id text,page_limit text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb; bound integer;
BEGIN PERFORM keryx_storage.require_operation(expected,digest,'creator_withdrawal_history');
 IF owner_addr IS NULL OR owner_addr !~ '^0x[0-9a-f]{40}$' OR page_limit IS NULL OR page_limit !~ '^[0-9]{1,2}$' THEN RAISE EXCEPTION 'withdrawal history selector refused'; END IF;
 bound:=page_limit::integer;
 IF bound<1 OR bound>25 OR (before_time IS NULL)<>(before_id IS NULL) OR before_id !~ '^0x[0-9a-f]{64}$' OR octet_length(before_time)>40
 THEN RAISE EXCEPTION 'withdrawal history selector refused'; END IF;
 IF before_time IS NOT NULL THEN PERFORM before_time::timestamptz; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO result FROM (
  SELECT id,owner,created_at,data FROM public.creator_withdrawal_requests w WHERE w.owner=owner_addr
   AND (before_time IS NULL OR w.created_at<before_time OR(w.created_at=before_time AND w.id<before_id)) ORDER BY w.created_at DESC,w.id DESC LIMIT bound+1) r;
 RETURN result;
END; $$;
CREATE FUNCTION public.storage_creator_withdrawal_reserve(expected jsonb,digest text,wire text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb; saved text;
BEGIN PERFORM keryx_storage.require_operation(expected,digest,'creator_withdrawal_reserve');
 IF wire IS NULL OR octet_length(wire)>8192 THEN RAISE EXCEPTION 'withdrawal original bound'; END IF; r:=wire::jsonb;
 IF r->>'format' IS DISTINCT FROM 'creator-withdrawal-request-v2' OR r->>'network' IS DISTINCT FROM 'eip155:5042'
  OR r->>'id' IS NULL OR r->>'id' !~ '^0x[0-9a-f]{64}$' OR r->>'owner' IS NULL OR r->>'owner' !~ '^0x[0-9a-f]{40}$'
  OR jsonb_typeof(r#>'{request,burnIntent,spec}') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'withdrawal original refused'; END IF;
 SELECT data INTO saved FROM public.creator_withdrawal_requests WHERE id=r->>'id';
 IF FOUND THEN IF saved::jsonb IS DISTINCT FROM r THEN RAISE EXCEPTION 'withdrawal original conflict'; END IF;
 ELSE INSERT INTO public.creator_withdrawal_requests(id,owner,data) VALUES(r->>'id',r->>'owner',wire); END IF;
 PERFORM keryx_storage.leave_operation(); RETURN NULL;
END; $$;
CREATE FUNCTION public.storage_creator_withdrawal_claim(expected jsonb,digest text,id text,owner_addr text,original text,claim_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN PERFORM keryx_storage.require_operation(expected,digest,'creator_withdrawal_claim');
 IF claim_id IS NULL OR claim_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  OR NOT EXISTS(SELECT 1 FROM public.creator_withdrawal_requests r WHERE r.id=storage_creator_withdrawal_claim.id AND r.owner=owner_addr AND r.data::jsonb=original::jsonb)
  OR EXISTS(SELECT 1 FROM public.session_withdrawal_publication_aborts a WHERE a.request_id=id) THEN RAISE EXCEPTION 'original transfer authority unavailable'; END IF;
 INSERT INTO public.creator_withdrawal_transfer_attempts(id,claim_id) VALUES(id,claim_id) ON CONFLICT ON CONSTRAINT creator_withdrawal_transfer_attempts_pkey DO NOTHING
  RETURNING jsonb_build_object('claimId',public.creator_withdrawal_transfer_attempts.claim_id,'startedAt',started_at) INTO result;
 PERFORM keryx_storage.leave_operation(); RETURN result;
END; $$;
CREATE FUNCTION public.storage_creator_withdrawal_attestation(expected jsonb,digest text,id text,owner_addr text,original text,claim_id text,wire text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a jsonb; saved text; result jsonb;
BEGIN PERFORM keryx_storage.require_operation(expected,digest,'creator_withdrawal_attestation');
 IF wire IS NULL OR octet_length(wire)>8192 THEN RAISE EXCEPTION 'attestation original bound'; END IF; a:=wire::jsonb;
 IF a->>'format' IS DISTINCT FROM 'creator-withdrawal-attestation-v1' OR a->>'authority' IS DISTINCT FROM 'request-matched-only'
  OR a->>'requestId' IS DISTINCT FROM id OR a->>'transferId' IS NULL OR a->>'transferId' !~ '^[0-9a-f-]{36}$'
  OR NOT EXISTS(SELECT 1 FROM public.creator_withdrawal_requests r JOIN public.creator_withdrawal_transfer_attempts c USING(id)
   WHERE r.id=storage_creator_withdrawal_attestation.id AND r.owner=owner_addr AND r.data::jsonb=original::jsonb AND c.claim_id=storage_creator_withdrawal_attestation.claim_id)
  OR EXISTS(SELECT 1 FROM public.session_withdrawal_publication_aborts x WHERE x.request_id=id) THEN RAISE EXCEPTION 'original attestation authority unavailable'; END IF;
 SELECT data INTO saved FROM public.creator_withdrawal_attestations s WHERE s.id=storage_creator_withdrawal_attestation.id;
 IF FOUND THEN IF saved::jsonb IS DISTINCT FROM a THEN RAISE EXCEPTION 'original attestation conflict'; END IF;
 ELSE INSERT INTO public.creator_withdrawal_attestations(id,claim_id,transfer_id,data) VALUES(id,claim_id,a->>'transferId',wire); END IF;
 SELECT jsonb_build_object('claim_id',s.claim_id,'transfer_id',s.transfer_id,'data',s.data::jsonb,'saved_at',s.saved_at) INTO result
  FROM public.creator_withdrawal_attestations s WHERE s.id=storage_creator_withdrawal_attestation.id;
 PERFORM keryx_storage.leave_operation(); RETURN result;
END; $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_creator_withdrawal_read(jsonb,text,text,text),public.storage_creator_withdrawal_history(jsonb,text,text,text,text,text),
 public.storage_creator_withdrawal_reserve(jsonb,text,text),public.storage_creator_withdrawal_claim(jsonb,text,text,text,text,text),
 public.storage_creator_withdrawal_attestation(jsonb,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_creator_withdrawal_read(jsonb,text,text,text),public.storage_creator_withdrawal_history(jsonb,text,text,text,text,text) TO keryx_app,keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_creator_withdrawal_reserve(jsonb,text,text),public.storage_creator_withdrawal_claim(jsonb,text,text,text,text,text),
 public.storage_creator_withdrawal_attestation(jsonb,text,text,text,text,text,text) TO keryx_app;
RESET ROLE;
