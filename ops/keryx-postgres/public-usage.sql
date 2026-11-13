SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('public_usage_window',ARRAY['query_runs','payment_events','usage_projection']::text[],false,true),
 ('public_usage_select',ARRAY['query_runs','run_privacy','usage_projection','run_privacy_projection']::text[],false,true),
 ('public_usage_finish',ARRAY['query_runs','run_privacy','usage_projection','run_privacy_projection']::text[],false,true);
CREATE FUNCTION public.storage_public_usage_window(expected jsonb,digest text,selected_window jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r record;item jsonb;runs jsonb:='[]'::jsonb;payments jsonb:='[]'::jsonb;bytes bigint:=1024;counted integer;since_text text;until_text text;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'usage read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'public_usage_window');
 IF selected_window IS NULL OR jsonb_typeof(selected_window)<>'object' OR selected_window-'network'-'since'-'until'-'period'<>'{}'::jsonb
  OR jsonb_typeof(selected_window->'network') IS DISTINCT FROM 'string' OR jsonb_typeof(selected_window->'period') IS DISTINCT FROM 'string'
  OR selected_window->>'network' NOT IN('eip155:5042','eip155:5042002') OR selected_window->>'period' NOT IN('all','7d','30d','custom')
  OR jsonb_typeof(selected_window->'since') IS DISTINCT FROM 'string' OR jsonb_typeof(selected_window->'until') IS DISTINCT FROM 'string'
  OR length(selected_window->>'since')>32 OR length(selected_window->>'until')>32 OR (selected_window->>'since') COLLATE "C">=(selected_window->>'until') COLLATE "C"
 THEN RAISE EXCEPTION 'usage window refused';END IF;
 since_text:=selected_window->>'since';until_text:=selected_window->>'until';
 SELECT count(*) INTO counted FROM(SELECT 1 FROM public.query_runs q WHERE to_char(q.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') COLLATE "C">=since_text COLLATE "C"
  AND to_char(q.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') COLLATE "C"<until_text COLLATE "C" LIMIT 10001)c;
 IF counted>10000 THEN RAISE EXCEPTION 'complete usage run bound';END IF;
 SELECT count(*) INTO counted FROM(SELECT 1 FROM public.payment_events p JOIN public.query_runs q ON q.id=p.query_id
  WHERE to_char(q.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') COLLATE "C">=since_text COLLATE "C"
  AND to_char(q.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') COLLATE "C"<until_text COLLATE "C" LIMIT 50001)c;
 IF counted>50000 THEN RAISE EXCEPTION 'complete usage payment bound';END IF;
 -- Financial population deliberately includes every visibility and erasure state.
 FOR r IN SELECT q.id,q.created_at,q.asker,q.data,u.original_sha256,u.usage_wire,u.provenance_wire
  FROM public.query_runs q LEFT JOIN keryx_storage.usage_projection u ON u.run_id=q.id
  WHERE to_char(q.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') COLLATE "C">=since_text COLLATE "C"
   AND to_char(q.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') COLLATE "C"<until_text COLLATE "C" ORDER BY q.id COLLATE "C" LOOP
  IF r.original_sha256 IS NULL OR octet_length(r.data::text)>4000000 OR r.original_sha256<>keryx_storage.run_original_sha256(r.data) THEN RAISE EXCEPTION 'usage original derivative unavailable';END IF;
  item:=jsonb_build_object('id',r.id,'createdAt',to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'originalSha256',r.original_sha256,
   'usageHex',encode(convert_to(r.usage_wire,'UTF8'),'hex'),'provenanceHex',encode(convert_to(r.provenance_wire,'UTF8'),'hex'),
   'actorId',CASE WHEN r.asker ~ '^0x[a-fA-F0-9]{40}$' THEN r.asker END);
  bytes:=bytes+octet_length(item::text)+2;IF bytes>20971520 THEN RAISE EXCEPTION 'complete usage wire bound';END IF;runs:=runs||jsonb_build_array(item);
 END LOOP;
 FOR r IN SELECT p.id,p.query_id,p.network,p.kind,p.amount_usdc,p.settled,p.settlement_status,p.tx_hash,p.payee
  FROM public.payment_events p JOIN public.query_runs q ON q.id=p.query_id
  WHERE to_char(q.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') COLLATE "C">=since_text COLLATE "C"
   AND to_char(q.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') COLLATE "C"<until_text COLLATE "C" ORDER BY p.id COLLATE "C" LOOP
  item:=jsonb_build_object('id',r.id,'queryId',r.query_id,'network',r.network,'kind',r.kind,'amountUsdc',coalesce(r.amount_usdc::double precision,0),
   'settled',coalesce(r.settled,false),'settlementStatus',r.settlement_status,'txHash',r.tx_hash,'payee',r.payee);
  bytes:=bytes+octet_length(item::text)+2;IF bytes>20971520 THEN RAISE EXCEPTION 'complete usage wire bound';END IF;payments:=payments||jsonb_build_array(item);
 END LOOP;
 RETURN jsonb_build_object('format','keryx-native-usage-window-v1','window',selected_window,'runs',runs,'payments',payments);
END;$$;
CREATE FUNCTION keryx_storage.usage_selection_valid(selection jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE item jsonb;BEGIN
 IF selection IS NULL OR jsonb_typeof(selection)<>'array' OR jsonb_array_length(selection)>10000 OR octet_length(selection::text)>8388608 THEN RAISE EXCEPTION 'usage selection refused';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(selection) LOOP
  IF jsonb_typeof(item)<>'object' OR item-'id'-'createdAt'-'usage'-'originalSha256'<>'{}'::jsonb OR jsonb_typeof(item->'id') IS DISTINCT FROM 'string' OR item->>'id' !~ '^[A-Za-z0-9_-]{1,128}$'
   OR jsonb_typeof(item->'originalSha256') IS DISTINCT FROM 'string' OR item->>'originalSha256' !~ '^[a-f0-9]{64}$'
   OR jsonb_typeof(item->'createdAt') IS DISTINCT FROM 'string' OR length(item->>'createdAt')>32 OR NOT(item?'usage')
   OR jsonb_typeof(item->'usage') NOT IN('object','null') THEN RAISE EXCEPTION 'usage selection refused';END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(selection)i GROUP BY i->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'usage selection duplicates';END IF;
END;$$;
CREATE FUNCTION public.storage_public_usage_select(expected jsonb,digest text,selection jsonb,take integer,published boolean,privacy_active boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r record;candidates jsonb:='[]'::jsonb;fingerprint text;counted integer:=0;stamp text;
BEGIN
 IF current_setting('transaction_read_only')<>'on' OR take IS NULL OR take NOT BETWEEN 1 AND 100 OR published IS NULL OR privacy_active IS NULL OR published AND NOT privacy_active THEN RAISE EXCEPTION 'usage read refused';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'public_usage_select');PERFORM keryx_storage.usage_selection_valid(selection);
 IF NOT privacy_active AND jsonb_array_length(selection)>take THEN RAISE EXCEPTION 'usage inactive selection refused';END IF;
 FOR r IN SELECT q.id,q.created_at,q.data,u.original_sha256,u.parsed_usage,u.body_identity_valid,pv.original_valid,pv.original_sha256 privacy_sha,
  s.value expected,s.ord FROM jsonb_array_elements(selection) WITH ORDINALITY s(value,ord) JOIN public.query_runs q ON q.id=s.value->>'id'
  LEFT JOIN keryx_storage.usage_projection u ON u.run_id=q.id LEFT JOIN keryx_storage.run_privacy_projection pv ON pv.run_id=q.id
  LEFT JOIN public.run_privacy p ON p.run_id=q.id WHERE NOT privacy_active OR p.visibility='public' AND p.erased=0
  ORDER BY CASE WHEN published OR NOT privacy_active THEN s.ord END,CASE WHEN NOT published AND privacy_active THEN q.created_at END DESC,q.id COLLATE "C" DESC
  LIMIT CASE WHEN published THEN 10001 ELSE take END LOOP
  counted:=counted+1;stamp:=to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  IF counted>10000 OR octet_length(r.data::text)>4000000 OR r.original_sha256 IS NULL THEN RAISE EXCEPTION 'usage original unavailable';END IF;
  fingerprint:=keryx_storage.run_original_sha256(r.data);
  IF r.original_sha256<>fingerprint OR NOT r.body_identity_valid OR stamp IS DISTINCT FROM r.expected->>'createdAt'
   OR privacy_active AND coalesce(r.parsed_usage,'null'::jsonb) IS DISTINCT FROM r.expected->'usage'
   OR NOT privacy_active AND fingerprint IS DISTINCT FROM r.expected->>'originalSha256'
   OR privacy_active AND(NOT coalesce(r.original_valid,false) OR r.privacy_sha IS DISTINCT FROM fingerprint) THEN RAISE EXCEPTION 'usage original changed';END IF;
  candidates:=candidates||jsonb_build_array(jsonb_build_object('id',r.id,'createdAt',stamp,'originalSha256',fingerprint,'usage',r.expected->'usage'));
  IF octet_length(candidates::text)>8388608 THEN RAISE EXCEPTION 'complete usage selection wire bound';END IF;
 END LOOP;
 IF NOT privacy_active AND counted<>least(jsonb_array_length(selection),take) THEN RAISE EXCEPTION 'usage original missing';END IF;
 RETURN jsonb_build_object('format','keryx-native-usage-selection-v1','candidates',candidates);
END;$$;
CREATE FUNCTION public.storage_public_usage_finish(expected jsonb,digest text,selection jsonb,take integer,published boolean,privacy_active boolean) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r record;allowed jsonb:='[]'::jsonb;stamp text;fingerprint text;wire text:='';bytes bigint:=256;sample_count integer:=0;
BEGIN
 IF current_setting('transaction_read_only')<>'on' OR privacy_active IS NULL OR take IS NULL OR take NOT BETWEEN 1 AND 100 OR published IS NULL OR published AND NOT privacy_active THEN RAISE EXCEPTION 'usage finish refused';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'public_usage_finish');PERFORM keryx_storage.usage_selection_valid(selection);
 IF NOT published AND jsonb_array_length(selection)>take THEN RAISE EXCEPTION 'usage finish selection refused';END IF;
 FOR r IN SELECT s.value expected,q.id,q.data,q.created_at,u.original_sha256,u.parsed_usage,u.body_identity_valid,pv.original_valid,pv.original_sha256 privacy_sha
  FROM jsonb_array_elements(selection) WITH ORDINALITY s(value,ord) JOIN public.query_runs q ON q.id=s.value->>'id'
  LEFT JOIN keryx_storage.usage_projection u ON u.run_id=q.id LEFT JOIN public.run_privacy p ON p.run_id=q.id
  LEFT JOIN keryx_storage.run_privacy_projection pv ON pv.run_id=q.id
  WHERE NOT privacy_active OR p.visibility='public' AND p.erased=0 ORDER BY s.ord LOOP
  stamp:=to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  IF octet_length(r.data::text)>4000000 THEN RAISE EXCEPTION 'usage public original bound';END IF;fingerprint:=keryx_storage.run_original_sha256(r.data);
  IF NOT coalesce(r.body_identity_valid,false) OR r.original_sha256 IS DISTINCT FROM fingerprint
   OR stamp IS DISTINCT FROM r.expected->>'createdAt' OR privacy_active AND coalesce(r.parsed_usage,'null'::jsonb) IS DISTINCT FROM r.expected->'usage'
   OR NOT privacy_active AND fingerprint IS DISTINCT FROM r.expected->>'originalSha256'
   OR privacy_active AND(NOT coalesce(r.original_valid,false) OR r.privacy_sha IS DISTINCT FROM fingerprint) THEN RAISE EXCEPTION 'usage public original changed';END IF;
  allowed:=allowed||jsonb_build_array(r.id);
  IF sample_count<take THEN
   bytes:=bytes+octet_length(r.data::text)+2;IF bytes>33554432 THEN RAISE EXCEPTION 'complete usage history body bound';END IF;
   IF wire<>'' THEN wire:=wire||',';END IF;wire:=wire||r.data::text;sample_count:=sample_count+1;
  END IF;
 END LOOP;
 IF NOT privacy_active AND jsonb_array_length(allowed)<>jsonb_array_length(selection) THEN RAISE EXCEPTION 'usage original missing';END IF;
 IF octet_length(allowed::text)+bytes>41943040 THEN RAISE EXCEPTION 'complete usage history wire bound';END IF;
 RETURN ('{"format":"keryx-native-usage-final-v1","allowed":'||allowed::text||',"runs":['||wire||']}')::json;
END;$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_public_usage_window(jsonb,text,jsonb),public.storage_public_usage_select(jsonb,text,jsonb,integer,boolean,boolean),public.storage_public_usage_finish(jsonb,text,jsonb,integer,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_public_usage_window(jsonb,text,jsonb),public.storage_public_usage_select(jsonb,text,jsonb,integer,boolean,boolean),public.storage_public_usage_finish(jsonb,text,jsonb,integer,boolean,boolean) TO keryx_app,keryx_reader;
RESET ROLE;
