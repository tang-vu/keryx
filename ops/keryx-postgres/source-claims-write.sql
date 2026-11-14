-- One closed Source producer group. No network, proof fetch, signing or scheduler.
SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('source_producer_snapshot',ARRAY['sync_state','sources','public_references'],true,true),
 ('source_producer_write',ARRAY['sync_state'],true,false);
CREATE FUNCTION public.storage_source_producer(expected jsonb,digest text,phase text,request_wire text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE request jsonb;selection jsonb;op text;i jsonb;retained jsonb;source_row jsonb;candidates jsonb;wire text;snapshot_sha text;
 row_count bigint;wire_bytes bigint;n numeric;at text;hour numeric;count_value numeric;raw text;current_claim jsonb;challenge jsonb;
 original_history jsonb;latest_history jsonb;proof jsonb;original_claim jsonb;latest_claim jsonb;proof_challenge jsonb;claim_id text;
 next_claim jsonb;history_action text;evidence jsonb:='{}'::jsonb;next_challenge jsonb;rate_key text;rate_limit integer;rate_row jsonb;
 binding jsonb;marker jsonb;source_id text;existing_link boolean:=false;expected_changes jsonb:='[]'::jsonb;expected_result jsonb;
 state jsonb;next_state jsonb;slot numeric;cursor_value text;ids jsonb;field text;change jsonb;wanted jsonb;position integer;history_key text;
BEGIN
 IF phase IS NULL OR phase NOT IN('snapshot','write') OR request_wire IS NULL OR octet_length(request_wire)>(CASE WHEN phase='snapshot' THEN 32768 ELSE 524288 END)
  OR session_user<>'keryx_app' THEN RAISE EXCEPTION 'source producer request refused';END IF;
 request:=request_wire::jsonb;
 IF phase='snapshot' THEN
  IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'source producer read-only snapshot required';END IF;
  PERFORM keryx_storage.require_operation(expected,digest,'source_producer_snapshot');selection:=request;
 ELSE
  IF jsonb_typeof(request) IS DISTINCT FROM 'object' OR request-'selector'-'snapshotSha256'-'sourceParser'-'changes'-'result'<>'{}'::jsonb
   OR NOT(request?'result' AND request?'sourceParser') OR jsonb_typeof(request->'selector') IS DISTINCT FROM 'string'
   OR request->>'snapshotSha256' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(request->'changes') IS DISTINCT FROM 'array'
   OR jsonb_array_length(request->'changes')>4 THEN RAISE EXCEPTION 'source producer packet refused';END IF;
  PERFORM keryx_storage.require_operation(expected,digest,'source_producer_write');selection:=(request->>'selector')::jsonb;
 END IF;
 op:=selection->>'operation';i:=selection->'input';
 IF jsonb_typeof(selection) IS DISTINCT FROM 'object' OR selection-'operation'-'input'<>'{}'::jsonb
  OR op IS NULL OR op NOT IN('issue','reserve','verify','bind','policy','upkeep-claim','upkeep-finish')
  OR jsonb_typeof(i) IS DISTINCT FROM 'object' OR jsonb_typeof(i->'now') IS DISTINCT FROM 'number'
  OR octet_length(selection::text)>32768 THEN RAISE EXCEPTION 'source producer selector refused';END IF;
 n:=(i->>'now')::numeric;
 IF op='issue' THEN
  IF i-'now'-'challenge'<>'{}'::jsonb OR jsonb_typeof(i->'challenge') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'source challenge input refused';END IF;
 ELSIF op IN('reserve','verify') THEN
  IF i-'now'-'challengeId'-'wallet'-(CASE WHEN op='verify' THEN 'proofDigest' ELSE 'challengeId' END)<>'{}'::jsonb
   OR jsonb_typeof(i->'challengeId') IS DISTINCT FROM 'string' OR i->>'challengeId' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(i->'wallet') IS DISTINCT FROM 'string'
   OR op='verify' AND(jsonb_typeof(i->'proofDigest') IS DISTINCT FROM 'string' OR i->>'proofDigest' !~ '^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'source verification input refused';END IF;
 ELSIF op IN('bind','policy') THEN
  IF i-'now'-'claimId'-'wallet'-'expectedRevision'-(CASE WHEN op='bind' THEN 'sourceId' ELSE 'mode' END)
   -(CASE WHEN op='bind' THEN 'onchainId' ELSE 'distributionPermission' END)-(CASE WHEN op='bind' THEN 'registryAddress' ELSE 'now' END)<>'{}'::jsonb
   OR jsonb_typeof(i->'claimId') IS DISTINCT FROM 'string' OR i->>'claimId' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(i->'wallet') IS DISTINCT FROM 'string'
   OR jsonb_typeof(i->'expectedRevision') IS DISTINCT FROM 'number' OR (i->>'expectedRevision')::numeric NOT BETWEEN 1 AND 9007199254740991
   OR trunc((i->>'expectedRevision')::numeric)<>(i->>'expectedRevision')::numeric THEN RAISE EXCEPTION 'source owner input refused';END IF;
  IF op='bind' AND(jsonb_typeof(i->'sourceId') IS DISTINCT FROM 'string' OR keryx_storage.a2a_utf16_length(i->>'sourceId') NOT BETWEEN 1 AND 256
   OR jsonb_typeof(i->'onchainId') IS DISTINCT FROM 'string' OR jsonb_typeof(i->'registryAddress') IS DISTINCT FROM 'string')
   OR op='policy' AND(i->>'mode' IS NULL OR i->>'mode' NOT IN('free','paid','citation-only') OR jsonb_typeof(i->'distributionPermission') IS DISTINCT FROM 'boolean') THEN RAISE EXCEPTION 'source owner tuple refused';END IF;
 ELSIF op='upkeep-claim' THEN
  IF i-'now'<>'{}'::jsonb OR n<0 OR n>9007199254740991 OR trunc(n)<>n THEN RAISE EXCEPTION 'invalid upkeep clock';END IF;
 ELSE
  IF i-'now'-'claim'-'summary'<>'{}'::jsonb OR NOT(i?'summary') OR jsonb_typeof(i->'claim') IS DISTINCT FROM 'object'
   OR (i->'claim')-'slot'-'sourceIds'<>'{}'::jsonb OR jsonb_typeof(i#>'{claim,slot}') IS DISTINCT FROM 'number'
   OR jsonb_typeof(i#>'{claim,sourceIds}') IS DISTINCT FROM 'array' OR jsonb_array_length(i#>'{claim,sourceIds}')>1000 THEN RAISE EXCEPTION 'upkeep completion input refused';END IF;
 END IF;
 -- Raw history is carried as TEXT, never normalized through JSONB aggregation.
 SELECT count(*),coalesce(sum(octet_length(key)+octet_length(value)),0) INTO row_count,wire_bytes FROM public.sync_state
  WHERE CASE WHEN op IN('upkeep-claim','upkeep-finish') THEN key='sourceUpkeep' ELSE key LIKE 'keryx:source-claims:v1:%' END;
 IF row_count>10000 OR wire_bytes>7000000 THEN RAISE EXCEPTION 'source producer retained bound';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('key',key,'value',value) ORDER BY key COLLATE "C"),'[]'::jsonb) INTO retained FROM public.sync_state
  WHERE CASE WHEN op IN('upkeep-claim','upkeep-finish') THEN key='sourceUpkeep' ELSE key LIKE 'keryx:source-claims:v1:%' END;
 IF op='bind' THEN SELECT jsonb_build_object('id',s.id,'url',s.url,'onchain_id',s.onchain_id,'rss_url',s.rss_url) INTO source_row FROM public.sources s WHERE s.id=i->>'sourceId';END IF;
 candidates:='[]'::jsonb;
 IF op='upkeep-claim' THEN
  SELECT count(*),coalesce(sum(octet_length(id)),0) INTO row_count,wire_bytes FROM(
   SELECT id FROM public.sources WHERE active AND verified AND translate(left(id,7),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')<>'public:' AND length(btrim(coalesce(rss_url,'')))>0
   UNION ALL SELECT id FROM public.public_references WHERE active=1 AND length(btrim(rss_url))>0) eligible;
  IF row_count>10000 OR wire_bytes>1000000 THEN RAISE EXCEPTION 'complete upkeep eligibility bound';END IF;
  SELECT coalesce(jsonb_agg(id ORDER BY id COLLATE "C"),'[]'::jsonb) INTO candidates FROM(
   SELECT id FROM public.sources WHERE active AND verified AND translate(left(id,7),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')<>'public:' AND length(btrim(coalesce(rss_url,'')))>0
   UNION ALL SELECT id FROM public.public_references WHERE active=1 AND length(btrim(rss_url))>0) eligible;
 END IF;
 wire:=jsonb_build_object('selector',selection,'rows',retained,'source',source_row,'candidates',candidates)::text;
 IF octet_length(wire)>8388608 THEN RAISE EXCEPTION 'source producer complete snapshot bound';END IF;
 snapshot_sha:=encode(sha256(convert_to(wire,'UTF8')),'hex');
 IF phase='snapshot' THEN RETURN jsonb_build_object('wire',wire,'sha256',snapshot_sha);END IF;
 IF request->>'snapshotSha256' IS DISTINCT FROM snapshot_sha THEN RAISE EXCEPTION 'source producer current predecessor changed';END IF;
 -- WHATWG URL parsing is the protected Node Source parser boundary. The public
 -- methods accept no parser metadata; the plan derives it from this exact raw
 -- URL. Its SHA and the complete raw snapshot are compared under this lock.
 -- Canonical text is local parsing metadata, never external ownership proof.
 IF op='bind' AND source_row IS NOT NULL THEN
  IF jsonb_typeof(request->'sourceParser') IS DISTINCT FROM 'object' OR(request->'sourceParser')-'rawUrlSha256'-'canonicalUrl'<>'{}'::jsonb
   OR request#>>'{sourceParser,rawUrlSha256}' IS DISTINCT FROM encode(sha256(convert_to(source_row->>'url','UTF8')),'hex')
   OR jsonb_typeof(request#>'{sourceParser,canonicalUrl}') IS DISTINCT FROM 'string' OR request#>>'{sourceParser,canonicalUrl}' !~ '^https://'
   OR octet_length(request#>>'{sourceParser,canonicalUrl}')>8192 THEN RAISE EXCEPTION 'source parser metadata differs';END IF;
 ELSIF request->'sourceParser'<>'null'::jsonb THEN RAISE EXCEPTION 'unexpected source parser metadata';END IF;
 -- Direct RPC callers must satisfy the same root metadata and economic tuple;
 -- a matching digest or caller-supplied result is never a proof flag.
 IF op='issue' THEN challenge:=i->'challenge';claim_id:=challenge->>'claimId';
 ELSIF op IN('reserve','verify') THEN
  SELECT value INTO raw FROM public.sync_state WHERE key='keryx:source-claims:v1:challenge:'||(i->>'challengeId');challenge:=raw::jsonb;claim_id:=challenge->>'claimId';
 ELSE claim_id:=i->>'claimId';END IF;
 IF op NOT IN('upkeep-claim','upkeep-finish') THEN
  IF op IN('issue','reserve','verify') THEN
   IF challenge IS NULL OR jsonb_typeof(challenge) IS DISTINCT FROM 'object'
    OR challenge-ARRAY['id','claimId','wallet','canonicalUrl','rssUrl','publicReferenceId','deploymentOrigin','network','nonce','createdAt','expiresAt','consumedAt','proofMethod']<>'{}'::jsonb
    OR challenge->>'id' IS NULL OR challenge->>'id' !~ '^[a-f0-9]{64}$' OR claim_id IS NULL OR claim_id !~ '^[a-f0-9]{64}$'
    OR challenge->>'nonce' IS NULL OR challenge->>'nonce' !~ '^[a-f0-9]{64}$' OR challenge->>'wallet' IS NULL OR challenge->>'wallet' !~ '^0x[0-9a-fA-F]{40}$'
    OR jsonb_typeof(challenge->'canonicalUrl') IS DISTINCT FROM 'string' OR jsonb_typeof(challenge->'deploymentOrigin') IS DISTINCT FROM 'string'
    OR jsonb_typeof(challenge->'network') IS DISTINCT FROM 'string' OR challenge->>'network' !~ '^eip155:[0-9]+$'
    OR jsonb_typeof(challenge->'createdAt') IS DISTINCT FROM 'string' OR jsonb_typeof(challenge->'expiresAt') IS DISTINCT FROM 'string'
    OR challenge?'proofMethod' AND(jsonb_typeof(challenge->'proofMethod')<>'string' OR challenge->>'proofMethod' NOT IN('website-file','rss-channel'))
    OR challenge?'rssUrl' AND jsonb_typeof(challenge->'rssUrl')<>'string'
    OR challenge?'publicReferenceId' AND(jsonb_typeof(challenge->'publicReferenceId')<>'string' OR left(challenge->>'publicReferenceId',7)<>'public:')
    THEN RAISE EXCEPTION 'source challenge metadata refused';END IF;
   challenge:=challenge||jsonb_build_object('wallet',lower(challenge->>'wallet'));
   IF op='issue' THEN
    IF challenge?'consumedAt' OR challenge->>'canonicalUrl' !~ '^https://' OR char_length(challenge->>'canonicalUrl')>2048
     OR claim_id IS DISTINCT FROM encode(sha256(convert_to('{"canonicalUrl":'||to_json(challenge->>'canonicalUrl')::text||',"deploymentOrigin":'||to_json(challenge->>'deploymentOrigin')::text||',"network":'||to_json(challenge->>'network')::text||'}','UTF8')),'hex')
     OR extract(epoch FROM (challenge->>'createdAt')::timestamptz)*1000<>trunc(n)
     OR extract(epoch FROM (challenge->>'expiresAt')::timestamptz)*1000<>trunc(n+900000)
     OR EXISTS(SELECT 1 FROM public.sync_state WHERE key='keryx:source-claims:v1:challenge:'||(challenge->>'id')) THEN RAISE EXCEPTION 'source challenge identity or clock refused';END IF;
   ELSE
    IF challenge->>'id' IS DISTINCT FROM i->>'challengeId' OR challenge->>'wallet' IS DISTINCT FROM lower(i->>'wallet')
     OR challenge?'consumedAt' OR n<extract(epoch FROM (challenge->>'createdAt')::timestamptz)*1000 OR n>=extract(epoch FROM (challenge->>'expiresAt')::timestamptz)*1000 THEN RAISE EXCEPTION 'source challenge expired or unavailable';END IF;
   END IF;
  END IF;
  IF op<>'reserve' THEN
  SELECT value INTO raw FROM public.sync_state WHERE key='keryx:source-claims:v1:claim:'||claim_id;current_claim:=raw::jsonb;
  IF raw IS NOT NULL THEN
   IF jsonb_typeof(current_claim) IS DISTINCT FROM 'object' OR current_claim->>'id' IS DISTINCT FROM claim_id
    OR current_claim-ARRAY['id','canonicalUrl','rssUrl','publicReferenceId','ownerWallet','deploymentOrigin','network','verifiedAt','revision','effectiveAt','mode','linkedSourceId','onchainId','registryAddress','distributionPermission','proofMethod']<>'{}'::jsonb
    OR current_claim->>'ownerWallet' IS NULL OR current_claim->>'ownerWallet' !~ '^0x[0-9a-fA-F]{40}$'
    OR current_claim->>'mode' IS NULL OR current_claim->>'mode' NOT IN('free','paid','citation-only')
    OR jsonb_typeof(current_claim->'distributionPermission') IS DISTINCT FROM 'boolean' OR jsonb_typeof(current_claim->'revision') IS DISTINCT FROM 'number'
    OR (current_claim->>'revision')::numeric NOT BETWEEN 1 AND 9007199254740991 OR trunc((current_claim->>'revision')::numeric)<>(current_claim->>'revision')::numeric
    THEN RAISE EXCEPTION 'source current claim metadata refused';END IF;
   FOREACH field IN ARRAY ARRAY['id','canonicalUrl','ownerWallet','deploymentOrigin','network','verifiedAt','effectiveAt'] LOOP
    IF jsonb_typeof(current_claim->field) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'source claim root metadata unavailable';END IF;
   END LOOP;
   FOREACH field IN ARRAY ARRAY['rssUrl','publicReferenceId','linkedSourceId','onchainId','registryAddress','proofMethod'] LOOP
    IF current_claim?field AND jsonb_typeof(current_claim->field)<>'string' THEN RAISE EXCEPTION 'source optional metadata unavailable';END IF;
   END LOOP;
   IF current_claim->>'canonicalUrl' !~ '^https://' OR current_claim->>'network' !~ '^eip155:[0-9]+$'
    OR current_claim?'onchainId' AND current_claim->>'onchainId' !~ '^0x[0-9a-fA-F]{64}$'
    OR current_claim?'registryAddress' AND current_claim->>'registryAddress' !~ '^0x[0-9a-fA-F]{40}$'
    OR current_claim?'proofMethod' AND current_claim->>'proofMethod' NOT IN('website-file','rss-channel')
    OR current_claim?'linkedSourceId' AND(keryx_storage.a2a_utf16_length(current_claim->>'linkedSourceId') NOT BETWEEN 1 AND 256 OR left(current_claim->>'linkedSourceId',7)='public:' OR NOT(current_claim?'onchainId' AND current_claim?'registryAddress'))
    OR NOT isfinite((current_claim->>'verifiedAt')::timestamptz) OR NOT isfinite((current_claim->>'effectiveAt')::timestamptz) THEN RAISE EXCEPTION 'source claim tuple unavailable';END IF;
   current_claim:=current_claim||jsonb_build_object('ownerWallet',lower(current_claim->>'ownerWallet'),'revision',((current_claim->>'revision')::numeric)::bigint);
   IF current_claim?'registryAddress' THEN current_claim:=current_claim||jsonb_build_object('registryAddress',lower(current_claim->>'registryAddress'));END IF;
   SELECT keryx_storage.source_scalar_text(value,'tokens') INTO original_history FROM public.sync_state WHERE key='keryx:source-claims:v1:history:'||claim_id||':0000000000000001';
   SELECT keryx_storage.source_scalar_text(value,'tokens') INTO latest_history FROM public.sync_state WHERE key='keryx:source-claims:v1:history:'||claim_id||':'||lpad(current_claim->>'revision',16,'0');
   original_claim:=(original_history->>'claim')::jsonb;latest_claim:=(latest_history->>'claim')::jsonb;
   original_claim:=original_claim||jsonb_build_object('ownerWallet',lower(original_claim->>'ownerWallet'));latest_claim:=latest_claim||jsonb_build_object('ownerWallet',lower(latest_claim->>'ownerWallet'));
   IF original_claim?'registryAddress' THEN original_claim:=original_claim||jsonb_build_object('registryAddress',lower(original_claim->>'registryAddress'));END IF;
   IF latest_claim?'registryAddress' THEN latest_claim:=latest_claim||jsonb_build_object('registryAddress',lower(latest_claim->>'registryAddress'));END IF;
   IF original_history IS NULL OR latest_history IS NULL OR ((original_history->>'action')::jsonb#>>'{}') IS DISTINCT FROM 'verified'
    OR original_claim->>'revision' IS DISTINCT FROM '1' OR original_claim->>'mode' IS DISTINCT FROM 'free'
    OR original_claim->'ownerWallet' IS DISTINCT FROM current_claim->'ownerWallet' OR original_claim->'canonicalUrl' IS DISTINCT FROM current_claim->'canonicalUrl'
    OR original_claim->'network' IS DISTINCT FROM current_claim->'network' OR original_claim->'deploymentOrigin' IS DISTINCT FROM current_claim->'deploymentOrigin'
    OR latest_claim IS DISTINCT FROM current_claim OR ((latest_history->>'action')::jsonb#>>'{}') NOT IN('verified','linked-free','policy')
    OR jsonb_typeof(original_history) IS DISTINCT FROM 'object' OR jsonb_typeof(latest_history) IS DISTINCT FROM 'object'
    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(original_history->'_rootKeys') k(value) WHERE value NOT IN('636c61696d','616374696f6e','6174','65766964656e6365'))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(latest_history->'_rootKeys') k(value) WHERE value NOT IN('636c61696d','616374696f6e','6174','65766964656e6365'))
    OR ((original_history->>'at')::jsonb#>>'{}') IS NULL OR ((latest_history->>'at')::jsonb#>>'{}') IS NULL OR NOT isfinite((((original_history->>'at')::jsonb#>>'{}'))::timestamptz) OR NOT isfinite((((latest_history->>'at')::jsonb#>>'{}'))::timestamptz) THEN RAISE EXCEPTION 'source claim history unavailable';END IF;
   proof:=(original_history->>'evidence')::jsonb;
   IF jsonb_typeof(proof) IS DISTINCT FROM 'object' OR proof-'challengeId'-'proofDigest'<>'{}'::jsonb OR proof->>'challengeId' IS NULL
    OR proof->>'challengeId' !~ '^[a-f0-9]{64}$' OR proof->>'proofDigest' IS NULL OR proof->>'proofDigest' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'source original proof unavailable';END IF;
   SELECT value::jsonb INTO proof_challenge FROM public.sync_state WHERE key='keryx:source-claims:v1:challenge:'||(proof->>'challengeId');
   IF proof_challenge->>'consumedAt' IS NULL OR proof_challenge->>'claimId' IS DISTINCT FROM claim_id OR lower(proof_challenge->>'wallet') IS DISTINCT FROM current_claim->>'ownerWallet'
    OR proof_challenge->>'id' IS DISTINCT FROM proof->>'challengeId' OR proof_challenge->>'nonce' IS NULL OR proof_challenge->>'nonce' !~ '^[a-f0-9]{64}$'
    OR NOT isfinite((proof_challenge->>'consumedAt')::timestamptz) THEN RAISE EXCEPTION 'source original challenge unavailable';END IF;
  ELSIF EXISTS(SELECT 1 FROM public.sync_state WHERE key LIKE 'keryx:source-claims:v1:history:'||claim_id||':%') THEN RAISE EXCEPTION 'source current claim missing';END IF;
  END IF;
 END IF;
 IF op IN('issue','reserve') THEN
  IF op='issue' THEN
   IF current_claim IS NOT NULL AND(current_claim->>'ownerWallet' IS DISTINCT FROM challenge->>'wallet' OR current_claim->'rssUrl' IS DISTINCT FROM challenge->'rssUrl' OR current_claim->'publicReferenceId' IS DISTINCT FROM challenge->'publicReferenceId') THEN RAISE EXCEPTION 'source retained owner or feed changed';END IF;
   rate_key:='keryx:source-claims:v1:rate:'||(challenge->>'wallet');rate_limit:=5;
  ELSE rate_key:='keryx:source-claims:v1:verify-rate:'||(challenge->>'wallet');rate_limit:=10;END IF;
  SELECT value::jsonb INTO rate_row FROM public.sync_state WHERE key=rate_key;hour:=floor(n/3600000);count_value:=0;
  IF rate_row IS NOT NULL AND rate_row NOT IN('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb) THEN
   IF jsonb_typeof(rate_row) IS DISTINCT FROM 'object' OR rate_row-'hour'-'count'<>'{}'::jsonb
    OR jsonb_typeof(rate_row->'hour') IS DISTINCT FROM 'number' OR (rate_row->>'hour')::numeric<0 OR trunc((rate_row->>'hour')::numeric)<>(rate_row->>'hour')::numeric
    OR jsonb_typeof(rate_row->'count') IS DISTINCT FROM 'number' OR (rate_row->>'count')::numeric NOT BETWEEN 0 AND 10 OR trunc((rate_row->>'count')::numeric)<>(rate_row->>'count')::numeric THEN RAISE EXCEPTION 'source rate journal unavailable';END IF;
   IF (rate_row->>'hour')::numeric=hour THEN count_value:=(rate_row->>'count')::numeric;END IF;
  END IF;
  IF count_value>=rate_limit THEN RAISE EXCEPTION 'source rate limit reached';END IF;
  at:=to_char(to_timestamp(trunc(n)::double precision/1000) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  expected_changes:=jsonb_build_array(jsonb_build_object('key',rate_key,'value',jsonb_build_object('hour',hour,'count',count_value+1),'updatedAt',at,'insertOnly',false));expected_result:=challenge;
  IF op='issue' THEN expected_changes:=expected_changes||jsonb_build_array(jsonb_build_object('key','keryx:source-claims:v1:challenge:'||(challenge->>'id'),'value',challenge,'updatedAt',at,'insertOnly',true));END IF;
 ELSIF op='verify' THEN
  IF current_claim IS NOT NULL AND(current_claim->>'ownerWallet' IS DISTINCT FROM challenge->>'wallet' OR current_claim->'rssUrl' IS DISTINCT FROM challenge->'rssUrl' OR current_claim->'publicReferenceId' IS DISTINCT FROM challenge->'publicReferenceId') THEN RAISE EXCEPTION 'source owner or feed changed during verification';END IF;
  at:=to_char(to_timestamp(trunc(n)::double precision/1000) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  IF current_claim IS NULL THEN next_claim:=jsonb_strip_nulls(jsonb_build_object('id',claim_id,'canonicalUrl',challenge->'canonicalUrl','rssUrl',challenge->'rssUrl','publicReferenceId',challenge->'publicReferenceId','ownerWallet',challenge->'wallet','deploymentOrigin',challenge->'deploymentOrigin','network',challenge->'network','verifiedAt',at,'revision',1,'effectiveAt',at,'mode','free','distributionPermission',false,'proofMethod',challenge->'proofMethod'));
  ELSE next_claim:=(current_claim-'proofMethod')||jsonb_strip_nulls(jsonb_build_object('verifiedAt',at,'revision',(current_claim->>'revision')::numeric+1,'proofMethod',challenge->'proofMethod'));END IF;
  history_action:='verified';evidence:=jsonb_build_object('challengeId',challenge->'id','proofDigest',i->'proofDigest');next_challenge:=challenge||jsonb_build_object('consumedAt',at);
 ELSIF op IN('bind','policy') THEN
  IF current_claim IS NULL OR current_claim->>'ownerWallet' IS DISTINCT FROM lower(i->>'wallet') OR current_claim->'revision' IS DISTINCT FROM i->'expectedRevision' THEN RAISE EXCEPTION 'source owner or revision changed';END IF;
  at:=to_char(to_timestamp(trunc(n)::double precision/1000) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  IF op='bind' THEN
   source_id:=i->>'sourceId';
   IF left(source_id,7)='public:' OR i->>'onchainId' !~ '^0x[0-9a-fA-F]{64}$' OR i->>'registryAddress' !~ '^0x[0-9a-fA-F]{40}$'
    OR source_row IS NOT NULL AND(request#>>'{sourceParser,canonicalUrl}' IS DISTINCT FROM current_claim->>'canonicalUrl' OR lower(source_row->>'onchain_id') IS DISTINCT FROM lower(i->>'onchainId') OR current_claim?'rssUrl' AND source_row->'rss_url' IS DISTINCT FROM current_claim->'rssUrl') THEN RAISE EXCEPTION 'source indexed binding tuple changed';END IF;
   IF current_claim?'linkedSourceId' AND(current_claim->>'linkedSourceId' IS DISTINCT FROM source_id OR lower(current_claim->>'onchainId') IS DISTINCT FROM lower(i->>'onchainId') OR current_claim->>'registryAddress' IS DISTINCT FROM lower(i->>'registryAddress')) THEN RAISE EXCEPTION 'source already linked elsewhere';END IF;
   SELECT value::jsonb INTO binding FROM public.sync_state WHERE key='keryx:source-claims:v1:source:'||encode(sha256(convert_to(source_id,'UTF8')),'hex');
   SELECT value::jsonb INTO marker FROM public.sync_state WHERE key='keryx:source-claims:v1:marker:'||encode(sha256(convert_to(source_id,'UTF8')),'hex');
   IF binding IS NOT NULL THEN
    IF binding IS DISTINCT FROM jsonb_build_object('sourceId',source_id,'claimId',claim_id) OR coalesce(marker,binding) IS DISTINCT FROM binding OR NOT(current_claim?'linkedSourceId') OR current_claim->>'linkedSourceId' IS DISTINCT FROM source_id THEN RAISE EXCEPTION 'source retained binding unavailable';END IF;
   ELSIF marker IS NOT NULL OR EXISTS(SELECT 1 FROM public.sync_state WHERE(key LIKE 'keryx:source-claims:v1:claim:%' OR key LIKE 'keryx:source-claims:v1:history:%') AND coalesce(value::json->>'linkedSourceId',value::json#>>'{claim,linkedSourceId}')=source_id) THEN RAISE EXCEPTION 'source retained binding missing';END IF;
   existing_link:=current_claim?'linkedSourceId';
   IF existing_link THEN expected_result:=current_claim;
   ELSE next_claim:=current_claim||jsonb_build_object('linkedSourceId',source_id,'onchainId',i->'onchainId','registryAddress',lower(i->>'registryAddress'),'mode','free','distributionPermission',false,'effectiveAt',at,'revision',(current_claim->>'revision')::numeric+1);history_action:='linked-free';END IF;
  ELSE
   IF i->>'mode'<>'free' AND(NOT(current_claim?'linkedSourceId') OR i->'distributionPermission'<>'true'::jsonb OR n<extract(epoch FROM (current_claim->>'verifiedAt')::timestamptz)*1000 OR n-extract(epoch FROM (current_claim->>'verifiedAt')::timestamptz)*1000>86400000) THEN RAISE EXCEPTION 'source policy permission or proof refresh required';END IF;
   next_claim:=current_claim||jsonb_build_object('mode',i->'mode','distributionPermission',i->>'mode'<>'free' AND(i->>'distributionPermission')::boolean,'effectiveAt',at,'revision',(current_claim->>'revision')::numeric+1);history_action:='policy';
  END IF;
 ELSE
  SELECT value::jsonb INTO state FROM public.sync_state WHERE key='sourceUpkeep';
  IF state IS NOT NULL THEN
   IF jsonb_typeof(state) IS DISTINCT FROM 'object' OR jsonb_typeof(state->'cursor') IS DISTINCT FROM 'string' OR keryx_storage.a2a_utf16_length(state->>'cursor')>512 THEN RAISE EXCEPTION 'invalid upkeep journal';END IF;
   FOREACH field IN ARRAY ARRAY['slot','leaseUntil'] LOOP
    IF jsonb_typeof(state->field) IS DISTINCT FROM 'number' OR(state->>field)::numeric NOT BETWEEN 0 AND 9007199254740991 OR trunc((state->>field)::numeric)<>(state->>field)::numeric THEN RAISE EXCEPTION 'invalid upkeep journal';END IF;
   END LOOP;
   IF state?'completedAt' AND(jsonb_typeof(state->'completedAt')<>'string' OR NOT isfinite((state->>'completedAt')::timestamptz)) THEN RAISE EXCEPTION 'invalid upkeep journal';END IF;
   IF state?'summary' THEN
    FOREACH field IN ARRAY ARRAY['attempted','added','failed','skipped'] LOOP
     IF jsonb_typeof(state#>ARRAY['summary',field]) IS DISTINCT FROM 'number' OR(state#>>ARRAY['summary',field])::numeric NOT BETWEEN 0 AND (CASE WHEN field='added' THEN 2000 ELSE 2 END) OR trunc((state#>>ARRAY['summary',field])::numeric)<>(state#>>ARRAY['summary',field])::numeric THEN RAISE EXCEPTION 'invalid upkeep journal';END IF;
    END LOOP;
   END IF;
  END IF;
  expected_result:='null'::jsonb;
  IF op='upkeep-claim' THEN
   slot:=floor(n/3600000);
   IF state IS NULL OR slot>(state->>'slot')::numeric AND n>=(state->>'leaseUntil')::numeric THEN
    cursor_value:=coalesce(state->>'cursor','');SELECT coalesce(jsonb_agg(id ORDER BY section,id COLLATE "C"),'[]'::jsonb) INTO ids FROM(SELECT value AS id,CASE WHEN value COLLATE "C">cursor_value COLLATE "C" THEN 0 ELSE 1 END AS section FROM jsonb_array_elements_text(candidates) ORDER BY section,value COLLATE "C" LIMIT 2) chosen;
    next_state:=jsonb_build_object('slot',slot,'cursor',coalesce(ids->>-1,cursor_value),'leaseUntil',n+120000);expected_result:=jsonb_build_object('slot',slot,'sourceIds',ids);
   END IF;
  ELSIF state IS NOT NULL AND state->'slot'=i#>'{claim,slot}' THEN
   FOREACH field IN ARRAY ARRAY['attempted','added','failed','skipped'] LOOP
    IF jsonb_typeof(i#>ARRAY['summary',field]) IS DISTINCT FROM 'number' OR(i#>>ARRAY['summary',field])::numeric NOT BETWEEN 0 AND (CASE WHEN field='added' THEN 2000 ELSE 2 END) OR trunc((i#>>ARRAY['summary',field])::numeric)<>(i#>>ARRAY['summary',field])::numeric THEN RAISE EXCEPTION 'invalid upkeep summary';END IF;
   END LOOP;
   at:=to_char(to_timestamp(trunc(n)::double precision/1000) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');next_state:=state||jsonb_build_object('leaseUntil',0,'completedAt',at,'summary',i->'summary');
  END IF;
  IF next_state IS NOT NULL THEN
   at:=to_char(to_timestamp(trunc(n)::double precision/1000) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');expected_changes:=jsonb_build_array(jsonb_build_object('key','sourceUpkeep','value',next_state,'updatedAt',at,'insertOnly',false));
  END IF;
 END IF;
 IF next_claim IS NOT NULL THEN
  IF (next_claim->>'revision')::numeric>9007199254740991 THEN RAISE EXCEPTION 'source revision exhausted';END IF;
  history_key:='keryx:source-claims:v1:history:'||claim_id||':'||lpad(next_claim->>'revision',16,'0');
  IF EXISTS(SELECT 1 FROM public.sync_state WHERE key=history_key) THEN RAISE EXCEPTION 'source history is append only';END IF;
  expected_result:=next_claim;
  expected_changes:=jsonb_build_array(jsonb_build_object('key',history_key,'value',jsonb_build_object('claim',next_claim,'action',history_action,'at',at,'evidence',evidence),'updatedAt',at,'insertOnly',true),jsonb_build_object('key','keryx:source-claims:v1:claim:'||claim_id,'value',next_claim,'updatedAt',at,'insertOnly',false));
  IF next_challenge IS NOT NULL THEN expected_changes:=expected_changes||jsonb_build_array(jsonb_build_object('key','keryx:source-claims:v1:challenge:'||(challenge->>'id'),'value',next_challenge,'updatedAt',at,'insertOnly',false));END IF;
 END IF;
 IF op='bind' THEN
  IF NOT existing_link THEN expected_changes:=expected_changes||jsonb_build_array(jsonb_build_object('key','keryx:source-claims:v1:source:'||encode(sha256(convert_to(source_id,'UTF8')),'hex'),'value',jsonb_build_object('sourceId',source_id,'claimId',claim_id),'updatedAt',at,'insertOnly',false));END IF;
  expected_changes:=expected_changes||jsonb_build_array(jsonb_build_object('key','keryx:source-claims:v1:marker:'||encode(sha256(convert_to(source_id,'UTF8')),'hex'),'value',jsonb_build_object('sourceId',source_id,'claimId',claim_id),'updatedAt',at,'insertOnly',false));
 END IF;
 IF request->'result' IS DISTINCT FROM expected_result OR jsonb_array_length(request->'changes')<>jsonb_array_length(expected_changes) THEN RAISE EXCEPTION 'source producer transition result differs';END IF;
 position:=0;
 FOR change IN SELECT value FROM jsonb_array_elements(request->'changes') LOOP
  wanted:=expected_changes->position;position:=position+1;
  IF jsonb_typeof(change) IS DISTINCT FROM 'object' OR change-'key'-'value'-'updatedAt'-'insertOnly'<>'{}'::jsonb OR jsonb_typeof(change->'value') IS DISTINCT FROM 'string'
   OR octet_length(change->>'value')>65536 OR change->'key' IS DISTINCT FROM wanted->'key' OR change->'updatedAt' IS DISTINCT FROM wanted->'updatedAt'
   OR change->'insertOnly' IS DISTINCT FROM wanted->'insertOnly' OR(change->>'value')::jsonb IS DISTINCT FROM wanted->'value' THEN RAISE EXCEPTION 'source producer exact mutation differs';END IF;
  IF(change->>'insertOnly')::boolean THEN INSERT INTO public.sync_state(key,value,updated_at) VALUES(change->>'key',change->>'value',change->>'updatedAt');
  ELSE INSERT INTO public.sync_state(key,value,updated_at) VALUES(change->>'key',change->>'value',change->>'updatedAt') ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;END IF;
 END LOOP;
 PERFORM keryx_storage.leave_operation();RETURN CASE WHEN expected_result='null'::jsonb THEN NULL ELSE expected_result END;
END;$$;
REVOKE ALL ON FUNCTION public.storage_source_producer(jsonb,text,text,text) FROM PUBLIC,anon,authenticated,service_role,keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_source_producer(jsonb,text,text,text) TO keryx_app;
RESET ROLE;
