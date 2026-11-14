-- Fresh native SOURCE only. Preserve postpaid JSON escape bytes; no existing
-- namespace adoption, identity change, settlement or job execution is implied.
SET ROLE keryx_owner;
ALTER TABLE public.a2a_orders ALTER COLUMN response_data TYPE json USING response_data::json;
ALTER TABLE public.a2a_orders ALTER COLUMN resolution_data TYPE json USING resolution_data::json;
UPDATE keryx_storage.operations SET relations=array_append(relations,'acceptance_original_projection')
 WHERE operation IN('current_job_snapshot','public_health_snapshot');
CREATE OR REPLACE FUNCTION keryx_storage.health_job_rows(expected jsonb,since_text text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r record;item jsonb;items jsonb:='[]'::jsonb;counted integer:=0;bytes bigint:=2;
BEGIN
 PERFORM keryx_storage.read_operation(expected,'a2a_operations_snapshot');
 IF since_text IS NULL OR length(since_text)>32 THEN RAISE EXCEPTION 'native health window refused';END IF;
 -- A completed row's Source cohort is bound at intake/commit. The existing
 -- original-update trigger invalidates that projection. Never scan paid answer
 -- bodies or decode their unsupported Unicode to publish operational counters.
 FOR r IN SELECT a.status,a.created_at,a.updated_at,a.started_at,
  octet_length(a.package_data::text) package_bytes,octet_length(a.resolution_data::text) resolution_bytes,p.health_meta
  FROM public.a2a_orders a LEFT JOIN keryx_storage.acceptance_original_projection p ON p.order_id=a.id
  WHERE a.status='running' OR to_char(a.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') COLLATE "C">=since_text COLLATE "C"
  ORDER BY a.id COLLATE "C" LIMIT 1001 LOOP
  counted:=counted+1;
  IF counted>1000 OR coalesce(r.package_bytes,0)>65536 OR coalesce(r.resolution_bytes,0)>32768
   OR coalesce((r.health_meta->>'serviceReceiptBytes')::integer,0)>16384 THEN RAISE EXCEPTION 'native complete health jobs bound';END IF;
  IF r.status='completed' AND r.health_meta IS NULL THEN RAISE EXCEPTION 'native completion metadata unavailable';END IF;
  item:=jsonb_build_object('status',r.status,'createdAt',to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'updatedAt',to_char(r.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'startedAt',to_char(r.started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'completionCohort',CASE WHEN r.status='completed' THEN r.health_meta->>'cohort' ELSE 'unknown' END);
  bytes:=bytes+octet_length(item::text)+2;IF bytes>4194304 THEN RAISE EXCEPTION 'native complete health jobs bytes';END IF;
  items:=items||jsonb_build_array(item);
 END LOOP;
 RETURN items;
END;$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
RESET ROLE;
