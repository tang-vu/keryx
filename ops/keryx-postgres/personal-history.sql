SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('personal_history_list',ARRAY['query_runs']::text[],true,true),
 ('personal_history_receipts',ARRAY['payment_events']::text[],true,true);
CREATE FUNCTION keryx_storage.personal_history_context(wallet text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF wallet IS NULL OR wallet !~ '^0x[0-9a-f]{40}$' OR session_user NOT IN('keryx_app','keryx_reader') OR current_setting('transaction_read_only')<>'on'
  OR (SELECT mode FROM keryx_storage.control WHERE singleton) IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'native history context refused';END IF;
END;$$;
{{HISTORY_READ_HELPER}}
CREATE FUNCTION public.storage_personal_history_list(expected jsonb,digest text,wallet text,filters jsonb,take integer,upper_position jsonb,before_position jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native history read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'personal_history_list');
 RETURN keryx_storage.personal_history_read(wallet,filters,take,upper_position,before_position);
END;$$;
-- Internal financial allowlist, with the existing caller obligation to prove
-- current research ownership through privacy.owner before requesting receipts.
CREATE FUNCTION public.storage_personal_history_receipts(expected jsonb,digest text,query_id text,take integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE item record;result jsonb;bytes bigint:=2;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native history read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'personal_history_receipts');
 IF query_id IS NULL OR query_id !~ '^[a-zA-Z0-9_-]{1,128}$' OR take IS NULL OR take NOT BETWEEN 1 AND 201 THEN RAISE EXCEPTION 'native receipt query refused';END IF;
 FOR item IN SELECT p.id,p.query_id,p.kind,p.source_id,p.source_name,p.payer,p.payee,p.amount_usdc,p.network,p.tx_hash,p.settled,p.settlement_status,p.created_at
  FROM public.payment_events p WHERE p.query_id=storage_personal_history_receipts.query_id
   AND(p.authorization_phase IS NULL OR p.authorization_phase NOT IN('prepared','cancelled_unexposed')) ORDER BY p.created_at,p.id COLLATE "C" LIMIT take LOOP
  IF octet_length(item.id)>512 OR octet_length(item.source_id)>1024 OR octet_length(item.source_name)>2048 OR octet_length(item.payer)>512 OR octet_length(item.payee)>512
   OR octet_length(item.network)>512 OR octet_length(item.tx_hash)>1024 OR octet_length(item.settlement_status)>256 OR NOT isfinite(item.created_at)
   OR extract(microseconds FROM item.created_at)::bigint%1000<>0 OR octet_length(item.kind)>64
  THEN RAISE EXCEPTION 'native receipt row bound';END IF;
  bytes:=bytes+octet_length(to_jsonb(item)::text)+1024;IF bytes>4194304 THEN RAISE EXCEPTION 'native receipt preaggregation bound';END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'queryId',r.query_id,'kind',r.kind,'sourceId',r.source_id,'sourceName',r.source_name,'payer',r.payer,'payee',r.payee,
  'amountUsdc',r.amount_usdc,'network',r.network,'txHash',r.tx_hash,'settled',r.settled,'settlementStatus',r.settlement_status,'createdAt',to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY r.created_at,r.id COLLATE "C"),'[]'::jsonb) INTO result FROM
  (SELECT p.id,p.query_id,p.kind,p.source_id,p.source_name,p.payer,p.payee,p.amount_usdc,p.network,p.tx_hash,p.settled,p.settlement_status,p.created_at FROM public.payment_events p
   WHERE p.query_id=storage_personal_history_receipts.query_id AND(p.authorization_phase IS NULL OR p.authorization_phase NOT IN('prepared','cancelled_unexposed')) ORDER BY p.created_at,p.id COLLATE "C" LIMIT take) r;
 RETURN result;
END;$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_personal_history_list(jsonb,text,text,jsonb,integer,jsonb,jsonb),public.storage_personal_history_receipts(jsonb,text,text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_personal_history_list(jsonb,text,text,jsonb,integer,jsonb,jsonb),public.storage_personal_history_receipts(jsonb,text,text,integer) TO keryx_app,keryx_reader;
RESET ROLE;
