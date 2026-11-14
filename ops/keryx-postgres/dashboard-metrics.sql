-- Constant-size dashboard observations. No answers, originals or wallet rows
-- cross the runtime transport, and all groups share one protected observation.
SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only)
 VALUES('dashboard_metrics',ARRAY['payment_events','query_runs','answer_feedback','gap_intents','users']::text[],false,true);
CREATE FUNCTION public.storage_dashboard_metrics(expected jsonb,digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE payments jsonb;runs jsonb;feedback jsonb;gaps jsonb;channels jsonb;accounts bigint;channel_row record;channel_count integer:=0;channel_bytes bigint:=2;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'dashboard read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'dashboard_metrics');
 IF EXISTS(SELECT 1 FROM public.query_runs q LEFT JOIN keryx_storage.run_privacy_projection s ON s.run_id=q.id WHERE s.run_id IS NULL OR s.scalar_identity_sha256 IS DISTINCT FROM (SELECT identity_digest FROM keryx_storage.identity WHERE singleton)) THEN RAISE EXCEPTION 'dashboard Source scalars unavailable';END IF;
 WITH classified AS MATERIALIZED(SELECT amount_usdc,source_id,query_id,kind,settled,settlement_status,settled AND
  ((kind='operating-fee' AND settlement_status='settled' AND tx_hash IS NOT NULL
    AND btrim(tx_hash,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')<>'')
   OR(kind<>'operating-fee' AND(settlement_status IS NULL OR settlement_status='settled'))) AS eligible FROM public.payment_events)
 SELECT jsonb_build_object(
  'count',count(*) FILTER(WHERE eligible),'volume',coalesce(sum(amount_usdc) FILTER(WHERE eligible),0)::text,
  'creatorVolume',coalesce(sum(amount_usdc) FILTER(WHERE eligible AND kind IN('fetch','citation')),0)::text,
  'operatingVolume',coalesce(sum(amount_usdc) FILTER(WHERE eligible AND kind='operating-fee'),0)::text,
  'operatingCount',count(*) FILTER(WHERE eligible AND kind='operating-fee'),
  'creators',count(DISTINCT coalesce(source_id,'')) FILTER(WHERE eligible AND kind IN('fetch','citation')),
  'payingQueries',count(DISTINCT coalesce(query_id,'')) FILTER(WHERE eligible AND kind IN('fetch','citation')),
  'pendingCount',count(*) FILTER(WHERE NOT settled AND settlement_status='pending'),
  'pendingVolume',coalesce(sum(amount_usdc) FILTER(WHERE NOT settled AND settlement_status='pending'),0)::text,
  'failedCount',count(*) FILTER(WHERE NOT settled AND settlement_status='failed'),
  'failedVolume',coalesce(sum(amount_usdc) FILTER(WHERE NOT settled AND settlement_status='failed'),0)::text)
 INTO payments FROM classified;
 SELECT jsonb_build_object('count',count(*),'guests',count(*) FILTER(WHERE s.scalar_cells->'origin'->>'boundHex'='776562' AND(s.scalar_cells->'asker'->>'boundHex' IS NULL OR s.scalar_cells->'asker'->>'boundHex'='')),
  'evidenceRuns',count(*) FILTER(WHERE evidence_claim_count IS NOT NULL),
  'evidenceClaims',coalesce(sum(evidence_claim_count) FILTER(WHERE evidence_claim_count IS NOT NULL),0),
  'withheld',count(*) FILTER(WHERE evidence_claim_count>0 AND rewarded_citation_count=0)) INTO runs FROM public.query_runs q JOIN keryx_storage.run_privacy_projection s ON s.run_id=q.id;
 SELECT jsonb_build_object('count',count(*),'up',count(*) FILTER(WHERE rating='up')) INTO feedback FROM public.answer_feedback;
 SELECT jsonb_build_object('count',count(*),'filled',count(*) FILTER(WHERE status='filled'),
  'pending',count(*) FILTER(WHERE status IN('pending','running'))) INTO gaps FROM public.gap_intents;
 -- Source groups every non-null scalar client exactly, including NUL and
 -- replacement characters. Null alone maps to the literal unknown group.
 channels:='[]'::jsonb;
 FOR channel_row IN WITH paying AS MATERIALIZED(SELECT DISTINCT coalesce(query_id,'') AS id FROM public.payment_events
   WHERE settled AND kind IN('fetch','citation') AND(settlement_status IS NULL OR settlement_status='settled'))
  SELECT coalesce(s.scalar_cells->'mcp_client'->>'boundHex','756e6b6e6f776e') AS "clientHex",count(*) AS queries,
   count(*) FILTER(WHERE p.id IS NOT NULL) AS "payingQueries" FROM public.query_runs r
   JOIN keryx_storage.run_privacy_projection s ON s.run_id=r.id LEFT JOIN paying p ON p.id=r.id
   WHERE s.scalar_cells->'origin'->>'boundHex'='6d6370' GROUP BY 1 LOOP
  channel_count:=channel_count+1;channel_bytes:=channel_bytes+octet_length(to_jsonb(channel_row)::text)+1;
  IF channel_count>1000 OR channel_bytes>4194304 THEN RAISE EXCEPTION 'dashboard complete channel bound';END IF;
  channels:=channels||jsonb_build_array(to_jsonb(channel_row));
 END LOOP;
 SELECT count(DISTINCT lower(wallet_address)) INTO accounts FROM public.users
  WHERE octet_length(wallet_address)=42 AND wallet_address ~ '^0[xX][0-9a-fA-F]{40}$';
 RETURN jsonb_build_object('format','keryx-native-dashboard-aggregate-v2','payments',payments,'runs',runs,
  'feedback',feedback,'gaps',gaps,'channels',channels,'accounts',CASE WHEN accounts<=9007199254740991 THEN accounts ELSE NULL END);
END;$$;
REVOKE ALL ON FUNCTION public.storage_dashboard_metrics(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_dashboard_metrics(jsonb,text) TO keryx_app,keryx_reader;
RESET ROLE;
