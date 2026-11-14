-- Session and exact-original metadata observations. Ownership is inserted only
-- by the atomic fresh-original producer; no standalone owner writer exists.
SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('pending_owner_admission',ARRAY['web_sessions'],true,true),
 ('pending_owner_list',ARRAY['web_sessions','pending_job_owners','a2a_orders','sync_state','a2a_original_time_projection'],true,true);
CREATE TRIGGER native_pending_owner_writer BEFORE INSERT OR UPDATE OR DELETE ON public.pending_job_owners
 FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence();
CREATE TRIGGER native_pending_owner_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON public.pending_job_owners
 FOR EACH STATEMENT EXECUTE FUNCTION keryx_storage.immutable();
CREATE FUNCTION public.storage_pending_owner_observe(expected jsonb,digest text,observation text,wire text,cursor_wire text,selected_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE packet jsonb;s jsonb;b jsonb;cursor_value jsonb;stamp bigint;rows jsonb;recovery text;
BEGIN
 IF current_setting('transaction_read_only')<>'on' OR observation IS NULL OR observation NOT IN('admission','list')
 THEN RAISE EXCEPTION 'native pending owner observation refused';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'pending_owner_'||observation);
 IF wire IS NULL OR octet_length(wire)>8192 THEN RAISE EXCEPTION 'native pending owner packet bound';END IF;
 packet:=wire::jsonb;s:=packet->'session';b:=packet->'binding';stamp:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF (jsonb_typeof(packet)='object' AND packet-'identity'-'session'-'proofExpiresAt'-'binding'='{}'::jsonb
  AND packet->'identity'=expected AND expected->>'authorityMode'='mainnet-real' AND expected->>'network'='eip155:5042'
  AND jsonb_typeof(s)='object' AND s-'hash'-'wallet'-'issuedAt'-'expiresAt'='{}'::jsonb
  AND s->>'hash' ~ '^[a-f0-9]{64}$' AND s->>'wallet' ~ '^0x[a-f0-9]{40}$'
  AND jsonb_typeof(s->'issuedAt')='number' AND s->>'issuedAt' ~ '^(0|[1-9][0-9]{0,15})$'
  AND jsonb_typeof(s->'expiresAt')='number' AND s->>'expiresAt' ~ '^[1-9][0-9]{0,15}$'
  AND (s->>'issuedAt')::numeric<=stamp AND (s->>'expiresAt')::numeric>stamp AND (s->>'expiresAt')::numeric<=9007199254740991
  AND jsonb_typeof(packet->'proofExpiresAt')='number' AND packet->>'proofExpiresAt' ~ '^[1-9][0-9]{0,15}$'
  AND (packet->>'proofExpiresAt')::numeric>stamp AND (packet->>'proofExpiresAt')::numeric<=stamp+300000
  AND (packet->>'proofExpiresAt')::numeric<=(s->>'expiresAt')::numeric) IS NOT TRUE
 THEN RAISE EXCEPTION 'native pending owner session refused';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.web_sessions w WHERE w.hash=s->>'hash' AND w.wallet=s->>'wallet'
  AND w.issued_at=(s->>'issuedAt')::numeric AND w.expires_at=(s->>'expiresAt')::numeric)
 THEN RAISE EXCEPTION 'native pending owner session refused';END IF;
 IF observation='admission' THEN
  IF (cursor_wire IS NULL AND selected_id IS NULL AND jsonb_typeof(b)='object' AND b-'id'-'requestHash'='{}'::jsonb
   AND b->>'id' ~ '^a2a_[a-f0-9]{64}$' AND b->>'requestHash' ~ '^[a-f0-9]{64}$') IS NOT TRUE
  THEN RAISE EXCEPTION 'native pending owner admission refused';END IF;
  stamp:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
  IF (packet->>'proofExpiresAt')::numeric<=stamp OR (s->>'expiresAt')::numeric<=stamp THEN RAISE EXCEPTION 'native pending owner session expired';END IF;
  RETURN 'true'::jsonb;
 END IF;
 IF EXISTS(SELECT 1 FROM public.pending_job_owners p JOIN public.a2a_orders o ON o.id=p.job_id AND o.query_id=p.query_id AND o.request_hash=p.request_hash
  LEFT JOIN keryx_storage.a2a_original_time_projection a ON a.order_id=o.id
  WHERE p.wallet=s->>'wallet' AND p.network=expected->>'network' AND o.status IN('running','failed','completed')
   AND (selected_id IS NULL OR o.id=selected_id) AND (a.order_id IS NULL
    OR a.identity_digest<>keryx_storage.identity_digest(expected) OR a.query_id<>o.query_id OR a.request_hash<>o.request_hash
    OR a.created_at::timestamptz IS DISTINCT FROM o.created_at OR a.updated_at::timestamptz IS DISTINCT FROM o.updated_at
    OR a.started_at::timestamptz IS DISTINCT FROM o.started_at OR a.payment_started_at::timestamptz IS DISTINCT FROM o.payment_started_at
    OR a.result_saving_at::timestamptz IS DISTINCT FROM o.result_saving_at))
 THEN RAISE EXCEPTION 'native pending owner original metadata unavailable';END IF;
 IF b IS DISTINCT FROM 'null'::jsonb OR selected_id IS NOT NULL AND selected_id !~ '^a2a_[a-f0-9]{64}$'
 THEN RAISE EXCEPTION 'native pending owner selector refused';END IF;
 IF cursor_wire IS NOT NULL THEN
  IF octet_length(cursor_wire)>512 THEN RAISE EXCEPTION 'native pending owner cursor bound';END IF;cursor_value:=cursor_wire::jsonb;
  IF (jsonb_typeof(cursor_value)='object' AND cursor_value-'createdAt'-'id'='{}'::jsonb
   AND cursor_value->>'id' ~ '^a2a_[a-f0-9]{64}$' AND jsonb_typeof(cursor_value->'createdAt')='string'
   AND octet_length(cursor_value->>'createdAt')<=64 AND cursor_value->>'createdAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
   AND (cursor_value->>'createdAt')::timestamptz IS NOT NULL) IS NOT TRUE THEN RAISE EXCEPTION 'native pending owner cursor refused';END IF;
 END IF;
 -- The immutable exact-original join is the only owner source. No payer,
 -- authorization, request/response body or worker input is selected.
 WITH selected AS MATERIALIZED(SELECT o.id,o.query_id,o.status,p.admitted_at created_at,
  a.updated_at,a.started_at,
  o.amount_usdc,o.creator_budget_usdc,o.service_fee_usdc,o.research_mode,
  CASE WHEN octet_length(o.package_data::text)<=8192 THEN o.package_data::text ELSE NULL END package_data,
  CASE WHEN octet_length(o.transaction_id)<=256 THEN o.transaction_id ELSE '' END transaction_id,o.execution_journal_version,
  a.payment_started_at,a.result_saving_at,
  CASE WHEN octet_length(o.error_code)<=512 THEN o.error_code ELSE NULL END error_code,
  CASE WHEN octet_length(o.worker_id)<=256 THEN o.worker_id ELSE NULL END worker_id,
  CASE WHEN octet_length(o.payee)=42 THEN o.payee ELSE NULL END payee
  FROM public.pending_job_owners p JOIN public.a2a_orders o ON o.id=p.job_id AND o.query_id=p.query_id AND o.request_hash=p.request_hash
   JOIN keryx_storage.a2a_original_time_projection a ON a.order_id=o.id AND p.admitted_at=a.created_at
    AND a.created_at::timestamptz=o.created_at
  WHERE p.wallet=s->>'wallet' AND p.network=expected->>'network' AND o.status IN('running','failed','completed')
   AND (selected_id IS NULL OR o.id=selected_id)
   AND (cursor_wire IS NULL OR p.admitted_at COLLATE "C"<(cursor_value->>'createdAt') COLLATE "C"
    OR p.admitted_at=cursor_value->>'createdAt' AND o.id COLLATE "C"<(cursor_value->>'id') COLLATE "C")
  ORDER BY p.admitted_at COLLATE "C" DESC,o.id COLLATE "C" DESC LIMIT 26)
 SELECT coalesce(jsonb_agg(to_jsonb(selected) ORDER BY created_at COLLATE "C" DESC,id COLLATE "C" DESC),'[]'::jsonb) INTO rows FROM selected;
 IF octet_length(rows::text)>393216 THEN RAISE EXCEPTION 'native pending owner response bound';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(rows) r WHERE r->>'status'='running' AND r->>'worker_id' IS NOT NULL AND r->>'started_at' IS NOT NULL) THEN
  SELECT CASE WHEN octet_length(value)<=2048 THEN value ELSE NULL END INTO recovery FROM public.sync_state WHERE key='a2aWorker' LIMIT 1;
 END IF;
 stamp:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF (packet->>'proofExpiresAt')::numeric<=stamp OR (s->>'expiresAt')::numeric<=stamp THEN RAISE EXCEPTION 'native pending owner session expired';END IF;
 RETURN jsonb_build_object('rows',rows,'recovery',recovery,'observedAtMs',stamp);
END;$$;
REVOKE ALL ON FUNCTION public.storage_pending_owner_observe(jsonb,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_pending_owner_observe(jsonb,text,text,text,text,text) TO keryx_app,keryx_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
RESET ROLE;
