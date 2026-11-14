SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('a2a_original_snapshot',ARRAY['a2a_orders','deliverable_acceptance_store','acceptance_original_projection'],true,true),
 ('a2a_create',ARRAY['a2a_orders','research_purchase_authorizations','payment_events','research_monthly_redemptions','acceptance_original_projection','deliverable_acceptance_store','owner269_associations'],true,false),
 ('a2a_resolve_completed',ARRAY['a2a_orders','deliverable_acceptance_store','acceptance_original_projection','query_runs','payment_events'],true,false),
 ('a2a_resolve_failed',ARRAY['a2a_orders','deliverable_acceptance_store','acceptance_original_projection','query_runs','payment_events'],true,false),
 ('a2a_complete',ARRAY['a2a_orders','deliverable_acceptance_store','acceptance_original_projection'],true,false),
 ('a2a_original_settled',ARRAY['a2a_orders','research_purchase_authorizations','payment_events','research_monthly_redemptions'],true,true),
 ('a2a_original_unfinished',ARRAY['a2a_orders'],true,true),
 ('a2a_payment_start',ARRAY['a2a_orders','acceptance_original_projection'],true,false),
 ('a2a_result_saving',ARRAY['a2a_orders','acceptance_original_projection'],true,false),
 ('a2a_fail',ARRAY['a2a_orders','acceptance_original_projection'],true,false),
 ('a2a_original_claim',ARRAY['a2a_orders','research_purchase_authorizations','payment_events','research_monthly_redemptions','query_runs','acceptance_original_projection'],true,false);
CREATE FUNCTION public.storage_a2a_original_observe(expected jsonb,digest text,observation text,selector text) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b jsonb;o public.a2a_orders;wire text;store text;take integer;rows json:='[]'::json;item json;bytes bigint:=64;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native original readonly transaction required';END IF;
 IF observation IS NULL OR observation NOT IN('settled','snapshot','store','queue') THEN RAISE EXCEPTION 'native original observation refused';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'a2a_original_'||CASE observation WHEN 'store' THEN 'snapshot' WHEN 'queue' THEN 'unfinished' ELSE observation END);
 IF observation='queue' THEN
  IF selector IS NULL OR selector !~ '^[1-9][0-9]{0,2}$' THEN RAISE EXCEPTION 'native unfinished bound refused';END IF;take:=selector::integer;
  IF take NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'native unfinished bound refused';END IF;
 FOR o IN SELECT * FROM public.a2a_orders WHERE status IN('running','failed') ORDER BY created_at,id COLLATE "C" LIMIT take+1 LOOP
  item:=keryx_storage.a2a_original_row(o);bytes:=bytes+octet_length(item::text)+2;IF bytes>4194304 THEN RAISE EXCEPTION 'native unfinished response bound';END IF;
 END LOOP;
 -- Check the complete response before aggregation. A second fixed read under
 -- the same shared data lock avoids quadratic concatenation of private bodies.
 WITH selected AS MATERIALIZED(SELECT a AS original FROM public.a2a_orders a WHERE status IN('running','failed') ORDER BY created_at,id COLLATE "C" LIMIT take+1)
 SELECT coalesce(json_agg(keryx_storage.a2a_original_row(original) ORDER BY (original).created_at,(original).id COLLATE "C"),'[]'::json) INTO rows FROM selected;
 RETURN json_build_object('rows',rows);
 END IF;
 IF observation='store' THEN
  IF selector IS NOT NULL OR (SELECT count(*) FROM public.deliverable_acceptance_store)<>1 THEN RAISE EXCEPTION 'native acceptance store unavailable';END IF;
  SELECT id INTO store FROM public.deliverable_acceptance_store;RETURN jsonb_build_object('storeId',store);
 END IF;
 IF observation='snapshot' THEN
  IF selector IS NULL OR keryx_storage.a2a_utf16_length(selector) NOT BETWEEN 1 AND 256 OR octet_length(selector)>1024 THEN RAISE EXCEPTION 'native original selector refused';END IF;
  SELECT * INTO o FROM public.a2a_orders WHERE id=selector;IF NOT FOUND THEN RETURN NULL;END IF;
  IF (SELECT count(*) FROM public.deliverable_acceptance_store)<>1 THEN RAISE EXCEPTION 'native acceptance store unavailable';END IF;
  SELECT id INTO store FROM public.deliverable_acceptance_store;
  SELECT source_order_wire INTO wire FROM keryx_storage.acceptance_original_projection WHERE order_id=selector;
  IF wire IS NULL THEN wire:=keryx_storage.a2a_original_row(o,true)::text;END IF;
  IF NOT keryx_storage.acceptance_original_matches(wire,o) THEN RAISE EXCEPTION 'native original snapshot mismatch';END IF;
  RETURN jsonb_build_object('orderWire',wire,'storeId',store);
 END IF;
 IF selector IS NULL OR octet_length(selector)>8192 THEN RAISE EXCEPTION 'native original binding refused';END IF;b:=selector::jsonb;
 IF NOT keryx_storage.a2a_original_binding_valid(b) THEN RAISE EXCEPTION 'native original binding refused';END IF;
 SELECT * INTO o FROM public.a2a_orders WHERE id=b->>'id';
 RETURN to_jsonb(FOUND AND keryx_storage.a2a_original_matches(o,b) AND keryx_storage.a2a_original_settled(o,b));
END;$$;
CREATE FUNCTION public.storage_a2a_original_execution(expected jsonb,digest text,execution text,selector text,detail text,started text) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b jsonb;o public.a2a_orders;result json;operation text;changed bigint;packet jsonb;p jsonb;store text;resolution jsonb;e jsonb;field text;actual record;budget_micros double precision;r jsonb;
BEGIN
 operation:=CASE execution WHEN 'claim' THEN 'a2a_original_claim' WHEN 'payment-start' THEN 'a2a_payment_start' WHEN 'result-saving' THEN 'a2a_result_saving' WHEN 'fail' THEN 'a2a_fail' WHEN 'complete' THEN 'a2a_complete' WHEN 'repair' THEN 'a2a_resolve_completed' WHEN 'close' THEN 'a2a_resolve_failed' WHEN 'create' THEN 'a2a_create' END;
 IF operation IS NULL THEN RAISE EXCEPTION 'native original execution refused';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,operation);
 IF started IS NULL OR started !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  OR to_char(started::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>started THEN RAISE EXCEPTION 'native original execution date refused';END IF;
 IF execution='create' THEN
  IF selector IS NULL OR selector !~ '^a2a_[a-f0-9]{64}$' OR detail IS NULL OR octet_length(detail)>262144 THEN RAISE EXCEPTION 'native create packet bound';END IF;
  packet:=detail::jsonb;b:=packet->'binding';p:=packet->'projection';
  IF (jsonb_typeof(packet)='object' AND packet-'binding'-'rowWire'-'projection'='{}'::jsonb AND jsonb_typeof(packet->'rowWire')='string'
   AND octet_length(packet->>'rowWire')<=65536 AND keryx_storage.a2a_original_binding_valid(b) AND b->>'id'=selector
   AND jsonb_typeof(p)='object' AND p-'orderId'-'storeId'-'orderWire'-'orderSha256'-'deliveryToken'-'owner'-'network'-'binding'-'health'='{}'::jsonb
   AND p->>'orderId'=selector AND p->>'orderWire'=packet->>'rowWire') IS NOT TRUE THEN RAISE EXCEPTION 'native create packet refused';END IF;
  r:=(packet->>'rowWire')::jsonb;
  IF (jsonb_typeof(r)='object' AND jsonb_typeof(r->'request_data')='string' AND jsonb_typeof(r->'package_data')='string') IS NOT TRUE THEN RAISE EXCEPTION 'native create body refused';END IF;
  r:=jsonb_set(jsonb_set(r,'{request_data}',(r->>'request_data')::jsonb),'{package_data}',(r->>'package_data')::jsonb);
  SELECT * INTO o FROM jsonb_populate_record(NULL::public.a2a_orders,r);
  IF (keryx_storage.a2a_original_matches(o,b) AND o.status='running' AND o.started_at IS NULL AND o.worker_id IS NULL AND o.execution_journal_version=1
   AND o.payment_started_at IS NULL AND o.result_saving_at IS NULL AND o.response_data IS NULL AND o.error_code IS NULL AND o.resolution_data IS NULL
   AND o.created_at=started::timestamptz AND o.updated_at=o.created_at) IS NOT TRUE THEN RAISE EXCEPTION 'native fresh original refused';END IF;
  -- Conflict returns the retained original; caller replay checks still compare
  -- its complete economic tuple. No retained bytes or acceptance are replaced.
  IF EXISTS(SELECT 1 FROM public.a2a_orders WHERE id=selector) THEN
   SELECT * INTO o FROM public.a2a_orders WHERE id=selector;
   result:=json_build_object('created',false,'order',keryx_storage.a2a_original_row(o));PERFORM keryx_storage.leave_operation();RETURN result;
  END IF;
  -- This prototype consumes already retained local facts. It cannot manufacture
  -- a purchase claim, inbound record, provider settlement or ownership proof.
  IF NOT keryx_storage.a2a_original_settled(o,b) THEN RAISE EXCEPTION 'native settled original required';END IF;
  IF (SELECT count(*) FROM public.deliverable_acceptance_store)<>1 THEN RAISE EXCEPTION 'native acceptance store unavailable';END IF;
  SELECT id INTO store FROM public.deliverable_acceptance_store;IF p->>'storeId' IS DISTINCT FROM store THEN RAISE EXCEPTION 'native acceptance store mismatch';END IF;
  INSERT INTO public.a2a_orders SELECT (o).* ON CONFLICT DO NOTHING;GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'native original conflict could not be read';END IF;
  INSERT INTO keryx_storage.acceptance_original_projection(order_id,store_id,source_order_wire,source_order_sha256,delivery_token,owner,network,binding,health_meta)
   VALUES(selector,store,p->>'orderWire',p->>'orderSha256',p->>'deliveryToken',p->>'owner',p->>'network',nullif(p->'binding','null'::jsonb),p->'health');
  result:=json_build_object('created',true,'order',keryx_storage.a2a_original_row(o));PERFORM keryx_storage.leave_operation();RETURN result;
 END IF;
 IF execution IN('complete','repair','close') THEN
  IF selector IS NULL OR keryx_storage.a2a_utf16_length(selector) NOT BETWEEN 1 AND 256 OR octet_length(selector)>1024
   OR detail IS NULL OR octet_length(detail)>16777216 THEN RAISE EXCEPTION 'native completion packet bound';END IF;
  packet:=detail::jsonb;p:=packet->'projection';
  IF (jsonb_typeof(packet)='object' AND jsonb_typeof(packet->'beforeWire')='string'
   AND jsonb_typeof(p)='object' AND p-'orderId'-'storeId'-'orderWire'-'orderSha256'-'deliveryToken'-'owner'-'network'-'binding'-'health'='{}'::jsonb
   AND p->>'orderId'=selector AND octet_length(packet->>'beforeWire')<=4000000
   AND CASE execution WHEN 'complete' THEN packet-'beforeWire'-'responseWire'-'projection'='{}'::jsonb
    WHEN 'repair' THEN packet-'beforeWire'-'responseWire'-'projection'-'resolutionWire'='{}'::jsonb
    ELSE packet-'beforeWire'-'projection'-'resolutionWire'-'errorCode'-'startedBefore'='{}'::jsonb END
   AND (execution='close' OR jsonb_typeof(packet->'responseWire')='string' AND octet_length(packet->>'responseWire')<=4000000)) IS NOT TRUE
  THEN RAISE EXCEPTION 'native completion packet refused';END IF;
  SELECT * INTO o FROM public.a2a_orders WHERE id=selector FOR UPDATE;
  IF NOT FOUND OR o.status<>'running' OR NOT keryx_storage.acceptance_original_matches(packet->>'beforeWire',o) THEN
   PERFORM keryx_storage.leave_operation();RETURN 'false'::json;
  END IF;
  IF execution IN('repair','close') THEN
   IF (jsonb_typeof(packet->'resolutionWire')='string' AND octet_length(packet->>'resolutionWire')<=32768) IS NOT TRUE THEN RAISE EXCEPTION 'native recovery resolution bound';END IF;
   resolution:=(packet->>'resolutionWire')::jsonb;e:=resolution->'evidence';
   IF (jsonb_typeof(resolution)='object' AND resolution-'action'-'actor'-'reason'-'evidence'-'resolvedAt'-'fulfillment'='{}'::jsonb
    AND resolution->>'action'=CASE execution WHEN 'repair' THEN 'repair_completed' ELSE 'close_failed' END
    AND resolution->>'actor' IN('automatic-poll','operator-cli')
    AND resolution->>'reason' IN('saved_real_query_run','verified_failed_original_fulfilled','no_saved_run_before_execution_boundaries')
    AND resolution->>'resolvedAt'=started AND jsonb_typeof(e)='object'
    AND e-'executionJournalVersion'-'paymentBoundaryCrossed'-'resultSaveBoundaryCrossed'-'creatorAttempts'-'settledCreatorMicros'-'pendingCreatorMicros'-'failedCreatorMicros'-'simulatedCreatorMicros'-'queryRunFound'='{}'::jsonb
    AND e->'executionJournalVersion' IN('1'::jsonb,'null'::jsonb)
    AND jsonb_typeof(e->'paymentBoundaryCrossed')='boolean' AND jsonb_typeof(e->'resultSaveBoundaryCrossed')='boolean' AND jsonb_typeof(e->'queryRunFound')='boolean') IS NOT TRUE
   THEN RAISE EXCEPTION 'native recovery evidence refused';END IF;
   FOREACH field IN ARRAY ARRAY['creatorAttempts','settledCreatorMicros','pendingCreatorMicros','failedCreatorMicros','simulatedCreatorMicros'] LOOP
    IF (jsonb_typeof(e->field)='number' AND e->>field ~ '^(0|[1-9][0-9]{0,15})$' AND (e->>field)::numeric<=9007199254740991) IS NOT TRUE THEN RAISE EXCEPTION 'native recovery amount refused';END IF;
   END LOOP;
   IF o.started_at IS NULL OR execution='repair' AND(e->'queryRunFound'<>'true'::jsonb OR e->>'simulatedCreatorMicros'<>'0'
    OR NOT EXISTS(SELECT 1 FROM public.query_runs WHERE id=o.query_id AND payment_mode='real'))
    OR execution='close' AND(e->'queryRunFound'<>'false'::jsonb OR e->'executionJournalVersion'<>'1'::jsonb
     OR e->'paymentBoundaryCrossed'<>'false'::jsonb OR e->'resultSaveBoundaryCrossed'<>'false'::jsonb OR e->>'creatorAttempts'<>'0'
     OR o.execution_journal_version IS DISTINCT FROM 1 OR o.payment_started_at IS NOT NULL OR o.result_saving_at IS NOT NULL
     OR EXISTS(SELECT 1 FROM public.query_runs WHERE id=o.query_id)) THEN
    PERFORM keryx_storage.leave_operation();RETURN 'false'::json;
   END IF;
   IF execution='close' THEN
    IF (packet->>'errorCode'='operator_reviewed_no_result' AND jsonb_typeof(packet->'startedBefore')='string'
     AND packet->>'startedBefore' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
     AND to_char((packet->>'startedBefore')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=packet->>'startedBefore') IS NOT TRUE THEN RAISE EXCEPTION 'native recovery close selector refused';END IF;
    IF ((packet->>'beforeWire')::jsonb->>'started_at') COLLATE "C">(packet->>'startedBefore') COLLATE "C" THEN PERFORM keryx_storage.leave_operation();RETURN 'false'::json;END IF;
   END IF;
   -- Recompute current Source evidence while holding the same writer lock as
   -- checkpoints/payments. Unknown statuses contribute attempts without credit.
   IF (SELECT count(*) FROM public.payment_events WHERE query_id=o.query_id AND kind<>'inbound')>10000
    OR EXISTS(SELECT 1 FROM public.payment_events WHERE query_id=o.query_id AND kind<>'inbound' AND abs(amount_usdc::double precision*1000000::double precision)>9007199254740991)
   THEN RAISE EXCEPTION 'native recovery payment bound';END IF;
   WITH normalized AS(SELECT coalesce(settlement_status,CASE WHEN settled THEN 'settled' ELSE 'simulated' END) state,amount_usdc::double precision*1000000::double precision micros
    FROM public.payment_events WHERE query_id=o.query_id AND kind<>'inbound'),
   rounded AS(SELECT state,CASE WHEN micros>=0 THEN floor(micros+0.5) ELSE ceil(micros-0.5) END micros FROM normalized)
   SELECT count(*) attempts,coalesce(sum(CASE WHEN state='settled' THEN micros ELSE 0 END),0) settled,
    coalesce(sum(CASE WHEN state='pending' THEN micros ELSE 0 END),0) pending,coalesce(sum(CASE WHEN state='failed' THEN micros ELSE 0 END),0) failed,
    coalesce(sum(CASE WHEN state='simulated' THEN micros ELSE 0 END),0) simulated INTO actual FROM rounded;
   IF greatest(abs(actual.settled),abs(actual.pending),abs(actual.failed),abs(actual.simulated))>9007199254740991 THEN RAISE EXCEPTION 'native recovery total bound';END IF;
   budget_micros:=o.creator_budget_usdc::double precision*1000000::double precision;
   budget_micros:=CASE WHEN budget_micros>=0 THEN floor(budget_micros+0.5) ELSE ceil(budget_micros-0.5) END;
   IF actual.attempts IS DISTINCT FROM (e->>'creatorAttempts')::bigint OR actual.settled IS DISTINCT FROM (e->>'settledCreatorMicros')::double precision
    OR actual.pending IS DISTINCT FROM (e->>'pendingCreatorMicros')::double precision OR actual.failed IS DISTINCT FROM (e->>'failedCreatorMicros')::double precision
    OR actual.simulated IS DISTINCT FROM (e->>'simulatedCreatorMicros')::double precision OR actual.settled+actual.pending>budget_micros
    OR execution='repair' AND(actual.simulated<>0 OR coalesce(o.execution_journal_version,0)<>coalesce((e->>'executionJournalVersion')::integer,0)
     OR (o.payment_started_at IS NOT NULL)<>(e->>'paymentBoundaryCrossed')::boolean OR (o.result_saving_at IS NOT NULL)<>(e->>'resultSaveBoundaryCrossed')::boolean)
    OR execution='close' AND actual.attempts<>0 THEN PERFORM keryx_storage.leave_operation();RETURN 'false'::json;END IF;
  END IF;
  IF (SELECT count(*) FROM public.deliverable_acceptance_store)<>1 THEN RAISE EXCEPTION 'native acceptance store unavailable';END IF;
  SELECT id INTO store FROM public.deliverable_acceptance_store;
  IF p->>'storeId' IS DISTINCT FROM store THEN RAISE EXCEPTION 'native acceptance store mismatch';END IF;
  UPDATE public.a2a_orders SET status=CASE execution WHEN 'close' THEN 'failed' ELSE 'completed' END,
   response_data=CASE execution WHEN 'close' THEN NULL ELSE (packet->>'responseWire')::json END,
   error_code=CASE execution WHEN 'close' THEN packet->>'errorCode' ELSE NULL END,
   resolution_data=CASE execution WHEN 'complete' THEN o.resolution_data::json ELSE (packet->>'resolutionWire')::json END,updated_at=started::timestamptz WHERE id=selector;
  INSERT INTO keryx_storage.acceptance_original_projection(order_id,store_id,source_order_wire,source_order_sha256,delivery_token,owner,network,binding,health_meta)
   VALUES(selector,store,p->>'orderWire',p->>'orderSha256',p->>'deliveryToken',p->>'owner',p->>'network',nullif(p->'binding','null'::jsonb),p->'health');
  PERFORM keryx_storage.leave_operation();RETURN 'true'::json;
 END IF;
 IF execution<>'claim' THEN
  IF selector IS NULL OR keryx_storage.a2a_utf16_length(selector) NOT BETWEEN 1 AND 256 OR octet_length(selector)>1024
   OR execution='fail' AND(detail IS NULL OR keryx_storage.a2a_utf16_length(detail)>512 OR octet_length(detail)>2048)
   OR execution<>'fail' AND detail IS NOT NULL THEN RAISE EXCEPTION 'native original checkpoint selector refused';END IF;
  IF execution='payment-start' THEN
   UPDATE public.a2a_orders SET payment_started_at=coalesce(payment_started_at,started::timestamptz),updated_at=started::timestamptz
    WHERE id=selector AND status='running' AND started_at IS NOT NULL AND execution_journal_version=1;
  ELSIF execution='result-saving' THEN
   UPDATE public.a2a_orders SET result_saving_at=coalesce(result_saving_at,started::timestamptz),updated_at=started::timestamptz
    WHERE id=selector AND status='running' AND started_at IS NOT NULL AND execution_journal_version=1;
  ELSE
   UPDATE public.a2a_orders SET status='failed',error_code=detail,updated_at=started::timestamptz WHERE id=selector AND status='running';
  END IF;
  GET DIAGNOSTICS changed=ROW_COUNT;PERFORM keryx_storage.leave_operation();RETURN to_json(changed=1);
 END IF;
 IF selector IS NULL OR octet_length(selector)>8192 OR detail IS NULL OR keryx_storage.a2a_trim(detail)='' OR keryx_storage.a2a_utf16_length(detail)>200 THEN RAISE EXCEPTION 'native original claim selector refused';END IF;
 b:=selector::jsonb;IF NOT keryx_storage.a2a_original_binding_valid(b) THEN RAISE EXCEPTION 'native original binding refused';END IF;
 SELECT * INTO o FROM public.a2a_orders WHERE id=b->>'id' FOR UPDATE;
 IF FOUND AND keryx_storage.a2a_original_matches(o,b) AND keryx_storage.a2a_original_settled(o,b)
  AND o.status='running' AND o.started_at IS NULL AND o.worker_id IS NULL AND o.execution_journal_version=1 AND o.payment_started_at IS NULL
  AND o.result_saving_at IS NULL AND (o.response_data IS NULL OR json_typeof(o.response_data::json)='null') AND o.error_code IS NULL
  AND (o.resolution_data IS NULL OR json_typeof(o.resolution_data::json)='null')
  AND NOT EXISTS(SELECT 1 FROM public.query_runs WHERE id=b->>'queryId')
  AND NOT EXISTS(SELECT 1 FROM public.payment_events WHERE query_id=b->>'queryId' AND kind IS DISTINCT FROM 'inbound') THEN
  UPDATE public.a2a_orders SET started_at=started::timestamptz,worker_id=detail,updated_at=started::timestamptz
   WHERE id=b->>'id' AND status='running' AND started_at IS NULL AND worker_id IS NULL RETURNING * INTO o;
  IF FOUND THEN result:=keryx_storage.a2a_original_row(o);END IF;
 END IF;
 PERFORM keryx_storage.leave_operation();RETURN result;
END;$$;
REVOKE ALL ON FUNCTION public.storage_a2a_original_observe(jsonb,text,text,text),public.storage_a2a_original_execution(jsonb,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_a2a_original_observe(jsonb,text,text,text) TO keryx_app,keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_a2a_original_execution(jsonb,text,text,text,text,text) TO keryx_app;
RESET ROLE;
