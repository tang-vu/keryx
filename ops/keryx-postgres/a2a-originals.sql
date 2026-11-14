SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('a2a_original_snapshot',ARRAY['a2a_orders','deliverable_acceptance_store','acceptance_original_projection'],true,true),
 ('a2a_complete',ARRAY['a2a_orders','deliverable_acceptance_store','acceptance_original_projection'],true,false),
 ('a2a_original_settled',ARRAY['a2a_orders','research_purchase_authorizations','payment_events','research_monthly_redemptions'],true,true),
 ('a2a_original_unfinished',ARRAY['a2a_orders'],true,true),
 ('a2a_payment_start',ARRAY['a2a_orders','acceptance_original_projection'],true,false),
 ('a2a_result_saving',ARRAY['a2a_orders','acceptance_original_projection'],true,false),
 ('a2a_fail',ARRAY['a2a_orders','acceptance_original_projection'],true,false),
 ('a2a_original_claim',ARRAY['a2a_orders','research_purchase_authorizations','payment_events','research_monthly_redemptions','query_runs','acceptance_original_projection'],true,false);
CREATE FUNCTION public.storage_a2a_original_observe(expected jsonb,digest text,observation text,selector text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b jsonb;o public.a2a_orders;wire text;store text;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native original readonly transaction required';END IF;
 IF observation IS NULL OR observation NOT IN('settled','snapshot') THEN RAISE EXCEPTION 'native original observation refused';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'a2a_original_'||observation);
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
CREATE FUNCTION public.storage_a2a_original_unfinished(expected jsonb,digest text,take integer) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE o public.a2a_orders;rows json:='[]'::json;item json;bytes bigint:=64;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native original readonly transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'a2a_original_unfinished');
 IF take IS NULL OR take NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'native unfinished bound refused';END IF;
 FOR o IN SELECT * FROM public.a2a_orders WHERE status IN('running','failed') ORDER BY created_at,id COLLATE "C" LIMIT take+1 LOOP
  item:=keryx_storage.a2a_original_row(o);bytes:=bytes+octet_length(item::text)+2;IF bytes>4194304 THEN RAISE EXCEPTION 'native unfinished response bound';END IF;
 END LOOP;
 -- Check the complete response before aggregation. A second fixed read under
 -- the same shared data lock avoids quadratic concatenation of private bodies.
 WITH selected AS MATERIALIZED(SELECT a AS original FROM public.a2a_orders a WHERE status IN('running','failed') ORDER BY created_at,id COLLATE "C" LIMIT take+1)
 SELECT coalesce(json_agg(keryx_storage.a2a_original_row(original) ORDER BY (original).created_at,(original).id COLLATE "C"),'[]'::json) INTO rows FROM selected;
 RETURN json_build_object('rows',rows);
END;$$;
CREATE FUNCTION public.storage_a2a_original_execution(expected jsonb,digest text,execution text,selector text,detail text,started text) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b jsonb;o public.a2a_orders;result json;operation text;changed bigint;packet jsonb;p jsonb;store text;
BEGIN
 operation:=CASE execution WHEN 'claim' THEN 'a2a_original_claim' WHEN 'payment-start' THEN 'a2a_payment_start' WHEN 'result-saving' THEN 'a2a_result_saving' WHEN 'fail' THEN 'a2a_fail' WHEN 'complete' THEN 'a2a_complete' END;
 IF operation IS NULL THEN RAISE EXCEPTION 'native original execution refused';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,operation);
 IF started IS NULL OR started !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  OR to_char(started::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>started THEN RAISE EXCEPTION 'native original execution date refused';END IF;
 IF execution='complete' THEN
  IF selector IS NULL OR keryx_storage.a2a_utf16_length(selector) NOT BETWEEN 1 AND 256 OR octet_length(selector)>1024
   OR detail IS NULL OR octet_length(detail)>16777216 THEN RAISE EXCEPTION 'native completion packet bound';END IF;
  packet:=detail::jsonb;p:=packet->'projection';
  IF (jsonb_typeof(packet)='object' AND packet-'beforeWire'-'responseWire'-'projection'='{}'::jsonb
   AND jsonb_typeof(packet->'beforeWire')='string' AND jsonb_typeof(packet->'responseWire')='string'
   AND jsonb_typeof(p)='object' AND p-'orderId'-'storeId'-'orderWire'-'orderSha256'-'deliveryToken'-'owner'-'network'-'binding'-'health'='{}'::jsonb
   AND p->>'orderId'=selector AND octet_length(packet->>'beforeWire')<=4000000 AND octet_length(packet->>'responseWire')<=4000000) IS NOT TRUE
  THEN RAISE EXCEPTION 'native completion packet refused';END IF;
  SELECT * INTO o FROM public.a2a_orders WHERE id=selector FOR UPDATE;
  IF NOT FOUND OR o.status<>'running' OR NOT keryx_storage.acceptance_original_matches(packet->>'beforeWire',o) THEN
   PERFORM keryx_storage.leave_operation();RETURN 'false'::json;
  END IF;
  IF (SELECT count(*) FROM public.deliverable_acceptance_store)<>1 THEN RAISE EXCEPTION 'native acceptance store unavailable';END IF;
  SELECT id INTO store FROM public.deliverable_acceptance_store;
  IF p->>'storeId' IS DISTINCT FROM store THEN RAISE EXCEPTION 'native acceptance store mismatch';END IF;
  UPDATE public.a2a_orders SET status='completed',response_data=(packet->>'responseWire')::json,error_code=NULL,updated_at=started::timestamptz WHERE id=selector;
  -- The update invalidates any predecessor projection. Rebuild it in this same
  -- transaction; the private fence compares every physical original field.
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
REVOKE ALL ON FUNCTION public.storage_a2a_original_observe(jsonb,text,text,text),public.storage_a2a_original_unfinished(jsonb,text,integer),public.storage_a2a_original_execution(jsonb,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_a2a_original_observe(jsonb,text,text,text),public.storage_a2a_original_unfinished(jsonb,text,integer) TO keryx_app,keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_a2a_original_execution(jsonb,text,text,text,text,text) TO keryx_app;
RESET ROLE;
