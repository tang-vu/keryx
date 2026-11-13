SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('sync_state_batch',ARRAY['sync_state']::text[],false,true),
 ('current_job_snapshot',ARRAY['a2a_orders']::text[],false,true),
 ('public_health_snapshot',ARRAY['payment_events','query_runs','answer_feedback','gap_intents','users','a2a_orders','sync_state']::text[],false,true);
CREATE FUNCTION keryx_storage.health_states(keys jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE entry jsonb;selected text;decoded bytea;key_text text;value_text text;entries jsonb:='[]'::jsonb;bytes bigint:=0;
BEGIN
 IF keys IS NULL OR jsonb_typeof(keys)<>'array' OR jsonb_array_length(keys)>32 THEN RAISE EXCEPTION 'native state keys refused';END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(keys) LOOP
  IF jsonb_typeof(entry)<>'string' THEN RAISE EXCEPTION 'native state key encoding refused';END IF;selected:=entry#>>'{}';
  IF selected IS NULL OR length(selected) NOT BETWEEN 2 AND 2048 OR selected !~ '^([a-f0-9]{2})+$' THEN RAISE EXCEPTION 'native state key encoding refused';END IF;
  decoded:=decode(selected,'hex');value_text:=NULL;
  -- A requested NUL key is valid UTF-8, but cannot occur in a native text column.
  -- Retain that key in the caller's Map with null, without normalizing it.
  IF position(decode('00','hex') IN decoded)=0 THEN
   key_text:=convert_from(decoded,'UTF8');
   SELECT s.value INTO value_text FROM public.sync_state s WHERE s.key=key_text;
  END IF;
  bytes:=bytes+coalesce(octet_length(value_text),0);IF bytes>4194304 THEN RAISE EXCEPTION 'native complete state batch bound';END IF;
  entries:=entries||jsonb_build_array(jsonb_build_object('keyHex',selected,'valueHex',encode(convert_to(value_text,'UTF8'),'hex')));
 END LOOP;RETURN jsonb_build_object('entries',entries);
END;$$;
CREATE FUNCTION keryx_storage.health_job_rows(expected jsonb,since_text text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r record;item jsonb;items jsonb:='[]'::jsonb;counted integer:=0;bytes bigint:=2;BEGIN
 PERFORM keryx_storage.read_operation(expected,'a2a_operations_snapshot');
 IF since_text IS NULL OR length(since_text)>32 THEN RAISE EXCEPTION 'native health window refused';END IF;
 FOR r IN SELECT status,created_at,updated_at,started_at,execution_journal_version,package_data,
  CASE WHEN jsonb_typeof(response_data->'serviceReceipt')='object' THEN response_data->'serviceReceipt' END service_receipt,
  resolution_data FROM public.a2a_orders WHERE status='running'
   OR to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') COLLATE "C">=since_text COLLATE "C"
  ORDER BY id COLLATE "C" LIMIT 1001 LOOP
  counted:=counted+1;
  IF counted>1000 OR coalesce(octet_length(r.package_data::text),0)>65536 OR coalesce(octet_length(r.service_receipt::text),0)>16384
   OR coalesce(octet_length(r.resolution_data::text),0)>32768 THEN RAISE EXCEPTION 'native complete health jobs bound';END IF;
  item:=jsonb_build_object('status',r.status,'createdAt',to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'updatedAt',to_char(r.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'startedAt',to_char(r.started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'executionJournalVersion',r.execution_journal_version,'researchPackage',r.package_data,'serviceReceipt',r.service_receipt,'resolution',r.resolution_data);
  bytes:=bytes+octet_length(item::text)+2;IF bytes>4194304 THEN RAISE EXCEPTION 'native complete health jobs bytes';END IF;items:=items||jsonb_build_array(item);
 END LOOP;RETURN items;
END;$$;
CREATE FUNCTION public.storage_sync_state_batch(expected jsonb,digest text,keys jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native health read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'sync_state_batch');RETURN keryx_storage.health_states(keys);
END;$$;
CREATE FUNCTION public.storage_current_job_snapshot(expected jsonb,digest text,since_text text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native health read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'current_job_snapshot');RETURN jsonb_build_object('rows',keryx_storage.health_job_rows(expected,since_text));
END;$$;
CREATE FUNCTION public.storage_public_health_snapshot(expected jsonb,digest text,since_text text,include_registry boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE keys jsonb;metrics jsonb;jobs jsonb;BEGIN
 IF current_setting('transaction_read_only')<>'on' OR include_registry IS NULL THEN RAISE EXCEPTION 'native health read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'public_health_snapshot');
 keys:=CASE WHEN include_registry THEN '["lastSyncedBlock","registryParity","dispatchHealth","settlementParity","pendingPaymentReconciliation","a2aWorker"]'::jsonb
  ELSE '["dispatchHealth","settlementParity","pendingPaymentReconciliation","a2aWorker"]'::jsonb END;
 SELECT jsonb_agg(to_jsonb(encode(convert_to(value,'UTF8'),'hex')) ORDER BY ord) INTO keys FROM jsonb_array_elements_text(keys) WITH ORDINALITY k(value,ord);
 metrics:=keryx_storage.health_metrics(expected);jobs:=keryx_storage.health_job_rows(expected,since_text);
 RETURN jsonb_build_object('format','keryx-native-public-health-v1','metrics',metrics,'jobs',jobs,'sync',keryx_storage.health_states(keys));
END;$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_sync_state_batch(jsonb,text,jsonb),public.storage_current_job_snapshot(jsonb,text,text),public.storage_public_health_snapshot(jsonb,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_sync_state_batch(jsonb,text,jsonb),public.storage_current_job_snapshot(jsonb,text,text),public.storage_public_health_snapshot(jsonb,text,text,boolean) TO keryx_app,keryx_reader;
RESET ROLE;
