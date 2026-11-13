SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('publication_ready',ARRAY[]::text[],true,true),
 ('publication_save',ARRAY['query_runs','run_privacy','run_history_projection','run_ownership_projection','run_privacy_projection','usage_projection','public_ledger_projection']::text[],true,false);
CREATE FUNCTION public.storage_publication_ready(expected jsonb,digest text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native publication read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'publication_ready');RETURN jsonb_build_object('domain','run-publication-v1');
END;$$;
CREATE FUNCTION keryx_storage.publication_save(packet_wire text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE packet jsonb;r jsonb;original_wire text;original json;selected_id text;fresh boolean;chosen_visibility text;fingerprint text;
BEGIN
 IF packet_wire IS NULL OR octet_length(packet_wire)>33554432 THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
 packet:=packet_wire::jsonb;r:=packet->'row';selected_id:=r->>'id';
 IF jsonb_typeof(packet)<>'object' OR packet-'row'-'originalHex'-'history'-'ownership'-'privacy'-'publication'<>'{}'::jsonb
  OR jsonb_typeof(r)<>'object' OR selected_id IS NULL OR selected_id !~ '^[A-Za-z0-9_-]{1,128}$' OR left(selected_id,4)='prv_'
  OR jsonb_typeof(packet->'originalHex') IS DISTINCT FROM 'string' OR length(packet->>'originalHex')>8000000 OR (packet->>'originalHex') !~ '^([a-f0-9]{2})+$'
 THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
 original_wire:=convert_from(decode(packet->>'originalHex','hex'),'UTF8');original:=original_wire::json;fingerprint:=encode(sha256(convert_to(original_wire,'UTF8')),'hex');
 IF json_typeof(original) IS DISTINCT FROM 'object' OR original->>'id' IS DISTINCT FROM selected_id OR original->>'createdAt' IS DISTINCT FROM r->>'created_at'
  OR r->>'created_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
  OR to_char((r->>'created_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>r->>'created_at'
  OR original->>'question' IS DISTINCT FROM r->>'question' OR original->>'answer' IS DISTINCT FROM r->>'answer'
  OR packet->'history'->>'sha256' IS DISTINCT FROM fingerprint OR packet->'ownership'->>'sha256' IS DISTINCT FROM fingerprint
  OR packet->'privacy'->>'sha256' IS DISTINCT FROM fingerprint OR packet->'privacy'->>'valid' IS DISTINCT FROM 'true'
  OR packet->'privacy'->'usage'->>'sha256' IS DISTINCT FROM fingerprint OR packet->'privacy'->'usage'->>'bodyIdentityValid' IS DISTINCT FROM 'true'
  OR packet->'privacy'->'ledger'->>'sha256' IS DISTINCT FROM fingerprint
 THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
 IF EXISTS(SELECT 1 FROM public.run_privacy WHERE run_id=selected_id AND erased=1) THEN RAISE EXCEPTION 'privacy_erased';END IF;
 fresh:=NOT EXISTS(SELECT 1 FROM public.query_runs WHERE id=selected_id) AND NOT EXISTS(SELECT 1 FROM public.run_privacy WHERE run_id=selected_id);
 IF packet?'publication' THEN
  IF jsonb_typeof(packet->'publication')<>'object' OR (packet->'publication')-'visibility'<>'{}'::jsonb OR packet->'publication'->>'visibility' IS NULL OR packet->'publication'->>'visibility' NOT IN('public','private','unlisted') THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
 END IF;
 IF fresh THEN chosen_visibility:=coalesce(packet->'publication'->>'visibility',(SELECT d.visibility FROM public.run_privacy_defaults d WHERE d.wallet=r->>'asker'),'public');END IF;
 INSERT INTO public.query_runs(id,created_at,question,budget,engine,total_spent,total_to_creators,answer,data,parent_id,asker,origin,duration_ms,payment_mode,payment_attempts,settled_payments,confidence_level,mcp_client,evidence_claim_count,grounded_claim_count,rewarded_citation_count,economics_data)
 VALUES(selected_id,(r->>'created_at')::timestamptz,r->>'question',(r->>'budget')::numeric,r->>'engine',(r->>'total_spent')::numeric,(r->>'total_to_creators')::numeric,r->>'answer',original,
  r->>'parent_id',r->>'asker',r->>'origin',(r->>'duration_ms')::bigint,r->>'payment_mode',(r->>'payment_attempts')::integer,(r->>'settled_payments')::integer,r->>'confidence_level',r->>'mcp_client',(r->>'evidence_claim_count')::integer,(r->>'grounded_claim_count')::integer,(r->>'rewarded_citation_count')::integer,nullif(r->'economics_data','null'::jsonb))
 ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at,question=excluded.question,budget=excluded.budget,engine=excluded.engine,total_spent=excluded.total_spent,total_to_creators=excluded.total_to_creators,answer=excluded.answer,data=excluded.data,
  parent_id=excluded.parent_id,asker=excluded.asker,origin=excluded.origin,duration_ms=excluded.duration_ms,payment_mode=excluded.payment_mode,payment_attempts=excluded.payment_attempts,settled_payments=excluded.settled_payments,confidence_level=excluded.confidence_level,mcp_client=excluded.mcp_client,evidence_claim_count=excluded.evidence_claim_count,grounded_claim_count=excluded.grounded_claim_count,rewarded_citation_count=excluded.rewarded_citation_count,economics_data=excluded.economics_data;
 IF fresh THEN UPDATE public.run_privacy p SET visibility=chosen_visibility WHERE p.run_id=selected_id AND revision=0 AND erased=0;IF NOT FOUND THEN RAISE EXCEPTION 'privacy_unavailable';END IF;END IF;
 DELETE FROM keryx_storage.run_history_projection WHERE run_id=selected_id;
 DELETE FROM keryx_storage.run_ownership_projection WHERE run_id=selected_id;
 DELETE FROM keryx_storage.run_privacy_projection WHERE run_id=selected_id;
 DELETE FROM keryx_storage.usage_projection WHERE run_id=selected_id;
 DELETE FROM keryx_storage.public_ledger_projection WHERE run_id=selected_id;
 PERFORM keryx_storage.install_run_projection(selected_id,packet,true);
 RETURN jsonb_build_object('id',selected_id,'originalSha256',fingerprint);
END;$$;
CREATE FUNCTION public.storage_publication_save(expected jsonb,digest text,packet_wire text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM keryx_storage.require_operation(expected,digest,'publication_save');
 BEGIN result:=keryx_storage.publication_save(packet_wire);
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM IN('privacy_unavailable','privacy_erased') THEN result:=jsonb_build_object('error','privacy_unavailable');ELSE RAISE;END IF;
 END;
 PERFORM keryx_storage.leave_operation();RETURN result;
END;$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_publication_ready(jsonb,text),public.storage_publication_save(jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role,keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_publication_ready(jsonb,text),public.storage_publication_save(jsonb,text,text) TO keryx_app;
RESET ROLE;
