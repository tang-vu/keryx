SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('a2a_original_settled',ARRAY['a2a_orders','research_purchase_authorizations','payment_events','research_monthly_redemptions'],true,true),
 ('a2a_original_unfinished',ARRAY['a2a_orders'],true,true),
 ('a2a_original_claim',ARRAY['a2a_orders','research_purchase_authorizations','payment_events','research_monthly_redemptions','query_runs','acceptance_original_projection'],true,false);
CREATE FUNCTION public.storage_a2a_original_settled(expected jsonb,digest text,binding_wire text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b jsonb;o public.a2a_orders;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native original readonly transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'a2a_original_settled');
 IF binding_wire IS NULL OR octet_length(binding_wire)>8192 THEN RAISE EXCEPTION 'native original binding refused';END IF;b:=binding_wire::jsonb;
 IF NOT keryx_storage.a2a_original_binding_valid(b) THEN RAISE EXCEPTION 'native original binding refused';END IF;
 SELECT * INTO o FROM public.a2a_orders WHERE id=b->>'id';
 RETURN to_jsonb(FOUND AND keryx_storage.a2a_original_matches(o,b) AND keryx_storage.a2a_original_settled(o,b));
END;$$;
CREATE FUNCTION public.storage_a2a_original_unfinished(expected jsonb,digest text,take integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE o public.a2a_orders;rows jsonb:='[]'::jsonb;item jsonb;bytes bigint:=64;
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
 SELECT coalesce(jsonb_agg(keryx_storage.a2a_original_row(original) ORDER BY (original).created_at,(original).id COLLATE "C"),'[]'::jsonb) INTO rows FROM selected;
 RETURN jsonb_build_object('rows',rows);
END;$$;
CREATE FUNCTION public.storage_a2a_original_claim(expected jsonb,digest text,binding_wire text,worker text,started text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b jsonb;o public.a2a_orders;result jsonb;
BEGIN
 PERFORM keryx_storage.require_operation(expected,digest,'a2a_original_claim');
 IF binding_wire IS NULL OR octet_length(binding_wire)>8192 OR worker IS NULL OR keryx_storage.a2a_trim(worker)='' OR keryx_storage.a2a_utf16_length(worker)>200
  OR started IS NULL OR started !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  OR to_char(started::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>started THEN RAISE EXCEPTION 'native original claim selector refused';END IF;
 b:=binding_wire::jsonb;IF NOT keryx_storage.a2a_original_binding_valid(b) THEN RAISE EXCEPTION 'native original binding refused';END IF;
 SELECT * INTO o FROM public.a2a_orders WHERE id=b->>'id' FOR UPDATE;
 IF FOUND AND keryx_storage.a2a_original_matches(o,b) AND keryx_storage.a2a_original_settled(o,b)
  AND o.status='running' AND o.started_at IS NULL AND o.worker_id IS NULL AND o.execution_journal_version=1 AND o.payment_started_at IS NULL
  AND o.result_saving_at IS NULL AND (o.response_data IS NULL OR o.response_data='null'::jsonb) AND o.error_code IS NULL
  AND (o.resolution_data IS NULL OR o.resolution_data='null'::jsonb)
  AND NOT EXISTS(SELECT 1 FROM public.query_runs WHERE id=b->>'queryId')
  AND NOT EXISTS(SELECT 1 FROM public.payment_events WHERE query_id=b->>'queryId' AND kind IS DISTINCT FROM 'inbound') THEN
  UPDATE public.a2a_orders SET started_at=started::timestamptz,worker_id=worker,updated_at=started::timestamptz
   WHERE id=b->>'id' AND status='running' AND started_at IS NULL AND worker_id IS NULL RETURNING * INTO o;
  IF FOUND THEN result:=keryx_storage.a2a_original_row(o);END IF;
 END IF;
 PERFORM keryx_storage.leave_operation();RETURN result;
END;$$;
REVOKE ALL ON FUNCTION public.storage_a2a_original_settled(jsonb,text,text),public.storage_a2a_original_unfinished(jsonb,text,integer),public.storage_a2a_original_claim(jsonb,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_a2a_original_settled(jsonb,text,text),public.storage_a2a_original_unfinished(jsonb,text,integer) TO keryx_app,keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_a2a_original_claim(jsonb,text,text,text,text) TO keryx_app;
RESET ROLE;
