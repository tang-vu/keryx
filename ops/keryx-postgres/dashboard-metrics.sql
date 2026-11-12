-- Constant-size dashboard observations. No answers, originals or wallet rows
-- cross the runtime transport, and all groups share one protected observation.
SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only)
 VALUES('dashboard_metrics',ARRAY['payment_events','query_runs','answer_feedback','gap_intents','users']::text[],false,true);
CREATE FUNCTION public.storage_dashboard_metrics(expected jsonb,digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE payments jsonb;runs jsonb;feedback jsonb;gaps jsonb;channels jsonb;accounts bigint;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'dashboard read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'dashboard_metrics');
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
 SELECT jsonb_build_object('count',count(*),'guests',count(*) FILTER(WHERE origin='web' AND(asker IS NULL OR asker='')),
  'evidenceRuns',count(*) FILTER(WHERE evidence_claim_count IS NOT NULL),
  'evidenceClaims',coalesce(sum(evidence_claim_count) FILTER(WHERE evidence_claim_count IS NOT NULL),0),
  'withheld',count(*) FILTER(WHERE evidence_claim_count>0 AND rewarded_citation_count=0)) INTO runs FROM public.query_runs;
 SELECT jsonb_build_object('count',count(*),'up',count(*) FILTER(WHERE rating='up')) INTO feedback FROM public.answer_feedback;
 SELECT jsonb_build_object('count',count(*),'filled',count(*) FILTER(WHERE status='filled'),
  'pending',count(*) FILTER(WHERE status IN('pending','running'))) INTO gaps FROM public.gap_intents;
 -- The source schema admits five setup channels plus historical NULL.
 IF EXISTS(SELECT 1 FROM public.query_runs WHERE origin='mcp' AND mcp_client IS NOT NULL
  AND mcp_client NOT IN('codex','claude','cursor','direct','other')) THEN RAISE EXCEPTION 'dashboard channel unavailable';END IF;
 WITH paying AS MATERIALIZED(SELECT DISTINCT coalesce(query_id,'') AS id FROM public.payment_events
  WHERE settled AND kind IN('fetch','citation') AND(settlement_status IS NULL OR settlement_status='settled')),
 groups AS(SELECT coalesce(r.mcp_client,'unknown') AS client,count(*) AS queries,
  count(*) FILTER(WHERE p.id IS NOT NULL) AS "payingQueries" FROM public.query_runs r LEFT JOIN paying p ON p.id=r.id
  WHERE r.origin='mcp' GROUP BY coalesce(r.mcp_client,'unknown'))
 SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) INTO channels FROM groups g;
 SELECT count(DISTINCT lower(wallet_address)) INTO accounts FROM public.users
  WHERE octet_length(wallet_address)=42 AND wallet_address ~ '^0[xX][0-9a-fA-F]{40}$';
 RETURN jsonb_build_object('format','keryx-native-dashboard-aggregate-v1','payments',payments,'runs',runs,
  'feedback',feedback,'gaps',gaps,'channels',channels,'accounts',CASE WHEN accounts<=9007199254740991 THEN accounts ELSE NULL END);
END;$$;
REVOKE ALL ON FUNCTION public.storage_dashboard_metrics(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_dashboard_metrics(jsonb,text) TO keryx_app,keryx_reader;
RESET ROLE;
