SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('account_history',ARRAY['web_sessions','account267_accounts','account267_members','account267_credentials','account267_sessions','query_runs','run_privacy','anonymous_run_claims','a2a_orders']::text[],true,true);
-- One fresh snapshot after the outer authority/writer wait. The fingerprint
-- retains absent rows, raw original hashes and every privacy/claim field used by
-- the existing SQLite final fence. Full bodies are needed only during preparation.
CREATE FUNCTION keryx_storage.account_history_capture(snapshot jsonb,ids jsonb,originals boolean,deadline bigint,stamp bigint)
 RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE r record;metadata jsonb:='[]'::jsonb;rows jsonb:='[]'::jsonb;total bigint;bounded boolean;seen integer:=0;account jsonb;original_hex text;
BEGIN
 account:=keryx_storage.account_current(snapshot,stamp);
 IF deadline IS NULL OR deadline<=stamp OR deadline>stamp+25000 OR originals IS NULL OR ids IS NULL OR jsonb_typeof(ids)<>'array'
  OR jsonb_array_length(ids)>1000 OR octet_length(ids::text)>140000 THEN RAISE EXCEPTION 'account_unavailable';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(ids) v WHERE jsonb_typeof(v)<>'string' OR v#>>'{}' !~ '^[A-Za-z0-9_-]{1,128}$')
  OR(SELECT count(DISTINCT v) FROM jsonb_array_elements_text(ids) v)<>jsonb_array_length(ids) THEN RAISE EXCEPTION 'account_unavailable';END IF;
 SELECT coalesce(sum(octet_length(q.data::text)),0),coalesce(bool_and(q.id IS NOT NULL AND octet_length(q.data::text)<=4000000),true)
 INTO total,bounded FROM jsonb_array_elements_text(ids) wanted LEFT JOIN public.query_runs q ON q.id=wanted;
 IF NOT bounded OR total>16000000 THEN RAISE EXCEPTION 'account_unavailable';END IF;
 FOR r IN SELECT q.id,q.asker,q.created_at AS created_instant,to_char(q.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
  keryx_storage.run_original_sha256(q.data) AS original_hash,h.original_created_at,h.original_sha256 AS history_original_sha256,
  p.run_id AS p_id,p.visibility,p.revision,p.erased,p.retained_owner,p.retained_digest,p.retained_binding,p.updated_at,
  c.run_id AS c_id,c.network AS c_network,c.origin AS c_origin,c.claimed_wallet,c.claimed_at,c.completed_at,c.original_sha256,
  CASE WHEN EXISTS(SELECT 1 FROM public.a2a_orders o WHERE o.query_id=q.id) THEN 1 ELSE 0 END AS a2a
  FROM jsonb_array_elements_text(ids) WITH ORDINALITY wanted(id,position) LEFT JOIN public.query_runs q ON q.id=wanted.id
  LEFT JOIN public.run_privacy p ON p.run_id=q.id
  LEFT JOIN keryx_storage.run_history_projection h ON h.run_id=q.id
  LEFT JOIN public.anonymous_run_claims c ON c.run_id=q.id AND c.network=snapshot->'binding'->>'network' AND c.origin=snapshot->'binding'->>'origin'
  ORDER BY wanted.position LOOP
  IF r.id IS DISTINCT FROM ids->>seen OR r.original_hash IS NULL
   OR octet_length(coalesce(r.retained_binding,''))>4096 OR octet_length(coalesce(r.updated_at,''))>128
   OR octet_length(coalesce(r.completed_at,''))>128 THEN RAISE EXCEPTION 'account_unavailable';END IF;
  -- Refuse foreign/erased originals inside SQL before producing any body. The
  -- later typed comparison also binds each expected owner, full semantic object
  -- and optional attribution; caller-supplied IDs alone grant no account scope.
  IF r.erased=1 THEN RAISE EXCEPTION 'account_unavailable';END IF;
  IF r.asker IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(account->'membership'->'members') m WHERE m->>'wallet'=r.asker) THEN RAISE EXCEPTION 'account_unavailable';END IF;
  ELSIF r.claimed_at IS NULL OR r.completed_at IS DISTINCT FROM r.original_created_at OR r.created_instant IS DISTINCT FROM r.completed_at::timestamptz
   OR r.original_sha256 IS DISTINCT FROM r.history_original_sha256 OR r.original_sha256 IS DISTINCT FROM r.original_hash OR r.a2a<>0
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(account->'membership'->'members') m WHERE m->>'wallet'=r.claimed_wallet)
  THEN RAISE EXCEPTION 'account_unavailable';END IF;
  metadata:=metadata||jsonb_build_array(jsonb_build_array(r.id,r.asker,r.created_at,r.original_hash,
   r.p_id,r.visibility,r.revision,r.erased,r.retained_owner,r.retained_digest,r.retained_binding,r.updated_at,
   r.c_id,r.c_network,r.c_origin,r.claimed_wallet,r.claimed_at,r.completed_at,r.original_sha256,r.a2a));
  IF originals THEN
   SELECT encode(convert_to(q.data::text,'UTF8'),'hex') INTO original_hex FROM public.query_runs q WHERE q.id=r.id;
   rows:=rows||jsonb_build_array(to_jsonb(r)||jsonb_build_object('original_hex',original_hex));
  END IF;seen:=seen+1;
 END LOOP;
 IF seen<>jsonb_array_length(ids) OR floor(extract(epoch FROM clock_timestamp())*1000)>=deadline OR octet_length(rows::text)>40000000 THEN RAISE EXCEPTION 'account_unavailable';END IF;
 RETURN jsonb_build_object('format','keryx-native-account-history-v1','fingerprint',encode(sha256(convert_to(metadata::text,'UTF8')),'hex'),'rows',rows);
END;$$;
CREATE FUNCTION public.storage_account_history(expected jsonb,digest text,snapshot jsonb,ids jsonb,originals boolean,deadline bigint)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE value jsonb;stamp bigint;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native account history read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'account_history');
 stamp:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 BEGIN value:=keryx_storage.account_history_capture(snapshot,ids,originals,deadline,stamp);
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT IN('account_unavailable','account_unauthenticated','account_changed') THEN RAISE;END IF;
  RETURN jsonb_build_object('ok',false,'error',SQLERRM);
 END;
 RETURN jsonb_build_object('ok',true,'value',value);
END;$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_account_history(jsonb,text,jsonb,jsonb,boolean,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_account_history(jsonb,text,jsonb,jsonb,boolean,bigint) TO keryx_app,keryx_reader;
RESET ROLE;
