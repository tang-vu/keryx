SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('public_ledger_read',ARRAY['query_runs','run_privacy','public_ledger_projection','sources','source_items']::text[],false,true);
CREATE FUNCTION public.storage_public_ledger_read(expected jsonb,digest text,take integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r record;rows jsonb:='[]'::jsonb;item jsonb;positions jsonb;bytes bigint:=0;
BEGIN
 IF current_setting('transaction_read_only')<>'on' OR take IS NULL OR take NOT BETWEEN 1 AND 251 THEN RAISE EXCEPTION 'public ledger read refused';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'public_ledger_read');
 FOR r IN SELECT q.id,q.created_at,q.data,l.original_sha256,l.original_valid,l.snapshot_wire,l.reference_ids
  FROM public.query_runs q JOIN public.run_privacy p ON p.run_id=q.id LEFT JOIN keryx_storage.public_ledger_projection l ON l.run_id=q.id
  WHERE p.visibility='public' AND p.erased=0 ORDER BY q.created_at DESC,q.id COLLATE "C" DESC LIMIT take LOOP
  IF NOT coalesce(r.original_valid,false) OR octet_length(r.data::text)>4000000 OR r.original_sha256 IS DISTINCT FROM keryx_storage.run_original_sha256(r.data)
  THEN RAISE EXCEPTION 'public ledger original unavailable';END IF;
  IF r.snapshot_wire IS NULL THEN item:='null'::jsonb;
  ELSE
   bytes:=bytes+octet_length(r.snapshot_wire);IF bytes>16777216 THEN RAISE EXCEPTION 'complete public ledger metadata bound';END IF;
   SELECT coalesce(jsonb_agg((ref.ord-1)::integer ORDER BY ref.ord),'[]'::jsonb) INTO positions
    FROM jsonb_array_elements(r.reference_ids) WITH ORDINALITY ref(value,ord)
    WHERE EXISTS(SELECT 1 FROM public.sources s WHERE s.id=ref.value->>'sourceId' AND s.evidence_provenance='synthetic-demo')
     OR EXISTS(SELECT 1 FROM public.source_items i WHERE i.id=ref.value->>'itemId' AND i.source_id=ref.value->>'sourceId' AND i.evidence_provenance='synthetic-demo');
   item:=jsonb_build_object('id',r.id,'createdAt',to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'snapshotHex',encode(convert_to(r.snapshot_wire,'UTF8'),'hex'),'syntheticPositions',positions);
  END IF;
  rows:=rows||jsonb_build_array(item);
 END LOOP;
 RETURN jsonb_build_object('format','keryx-native-public-ledger-v1','rows',rows);
END;$$;
REVOKE ALL ON FUNCTION public.storage_public_ledger_read(jsonb,text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_public_ledger_read(jsonb,text,integer) TO keryx_app,keryx_reader;
RESET ROLE;
