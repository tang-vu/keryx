-- One bounded server-only journal group. No RPC, key, funding or broadcast.
-- Node owns Source/WHATWG/viem parsing; all derivatives bind exact raw TEXT SHA.
SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('registration_sponsor_snapshot',ARRAY['sync_state'],true,true),
 ('registration_sponsor_read',ARRAY['sync_state'],true,true),
 ('registration_sponsor_write',ARRAY['sync_state'],true,false);
CREATE FUNCTION public.storage_registration_sponsor(expected jsonb,digest text,phase text,request_wire text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE request jsonb;s jsonb;i jsonb;op text;selection_wire text;retained jsonb;wire text;sha text;claim_id text;raw text;
 count_rows bigint;wire_bytes bigint;n numeric;wall_now numeric:=floor(extract(epoch FROM clock_timestamp())*1000);meta jsonb;corpus jsonb;item jsonb;stored jsonb;root jsonb;other_root jsonb;field text;record_key text;
 policies jsonb:='{}'::jsonb;entries jsonb:='{}'::jsonb;p jsonb;cohort text;policy_digest text;requested jsonb;change_request jsonb;target jsonb;latest jsonb;current_root jsonb;original_root jsonb;
 wanted jsonb:='{}'::jsonb;new_policy jsonb;new_policy_key text;expected_result text;change jsonb;planned jsonb;next_root jsonb;next_execution text;requires_claim boolean:=false;requires_funds boolean:=false;
 creator text;id text;policy_rows integer;entry_rows integer;active_count integer:=0;txs text[]:=ARRAY[]::text[];nonces text[]:=ARRAY[]::text[];nonce_key text;held numeric:=0;balance numeric;spendable numeric;observation jsonb;observation_wire text;funding_identity jsonb;new_hold boolean:=false;
 total_count integer;daily_count integer;wallet_count integer;origin_count integer;total_wei numeric;daily_wei numeric;day_value text;amount numeric;current_key text;source_claim json;proof_meta jsonb;proof_root jsonb;seen text[]:=ARRAY[]::text[];
BEGIN
 IF phase IS NULL OR phase NOT IN('snapshot','read','commit') OR session_user<>'keryx_app' OR request_wire IS NULL
  OR octet_length(request_wire)>CASE WHEN phase='snapshot' THEN 262144 ELSE 16777216 END THEN RAISE EXCEPTION 'request refused';END IF;
 request:=request_wire::jsonb;
 IF phase='snapshot' THEN s:=request;selection_wire:=request_wire;
 ELSE
  IF jsonb_typeof(request) IS DISTINCT FROM 'object' OR request-'selector'-'snapshotSha256'-'metadata'-'changes'-'resultWire'-'observationIdentity'<>'{}'::jsonb
   OR jsonb_typeof(request->'selector') IS DISTINCT FROM 'string' OR jsonb_typeof(request->'metadata') IS DISTINCT FROM 'object'
   OR jsonb_typeof(request->'changes') IS DISTINCT FROM 'array' OR jsonb_array_length(request->'changes')>1002
   OR jsonb_typeof(request->'resultWire') IS DISTINCT FROM 'string' OR octet_length(request->>'resultWire')>131072
   OR NOT(request?'observationIdentity') THEN RAISE EXCEPTION 'packet refused';END IF;
  selection_wire:=request->>'selector';s:=selection_wire::jsonb;
 END IF;
 IF phase IN('snapshot','read') THEN
  IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'read-only transaction required';END IF;
  PERFORM keryx_storage.require_operation(expected,digest,CASE WHEN phase='snapshot' THEN 'registration_sponsor_snapshot' ELSE 'registration_sponsor_read' END);
 ELSE PERFORM keryx_storage.require_operation(expected,digest,'registration_sponsor_write');END IF;
 op:=s->>'operation';i:=s->'input';
 IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR s-'operation'-'input'<>'{}'::jsonb OR jsonb_typeof(i) IS DISTINCT FROM 'object'
  OR op IS NULL OR op NOT IN('admit','get','execution','funding','transition') OR octet_length(selection_wire)>262144
  OR phase='read' AND op NOT IN('get','execution','funding') OR phase='commit' AND op NOT IN('admit','transition') THEN RAISE EXCEPTION 'selector refused';END IF;
 IF op='admit' THEN
  IF i-'policyWire'-'rowWire'-'now'-'observationWire'<>'{}'::jsonb OR jsonb_typeof(i->'policyWire') IS DISTINCT FROM 'string' OR jsonb_typeof(i->'rowWire') IS DISTINCT FROM 'string'
   OR NOT(i?'observationWire') OR i->'observationWire'<>'null'::jsonb AND jsonb_typeof(i->'observationWire')<>'string' THEN RAISE EXCEPTION 'admit tuple refused';END IF;
  claim_id:=keryx_storage.registration_sponsor_corpus(jsonb_build_object('kind','row','wire',i->>'rowWire'))->>'claimId';
 ELSIF op='transition' THEN
  IF i-'changeWire'-'now'<>'{}'::jsonb OR jsonb_typeof(i->'changeWire') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'transition tuple refused';END IF;
  change_request:=(i->>'changeWire')::jsonb;IF change_request-'wallet'-'id'-'expectedState'-'nextState'-'transactionNonce'-'transactionHash'-'actualGasWei'-'creatorSignature'-'signedTransaction'-'expiredResolution'-'fundingObservation'-'now'<>'{}'::jsonb OR change_request->'now' IS DISTINCT FROM i->'now' OR change_request->>'wallet' IS NULL OR change_request->>'wallet' !~ '^0x[0-9a-f]{40}$' OR change_request->>'id' IS NULL OR change_request->>'id' !~ '^0x[0-9a-f]{64}$' THEN RAISE EXCEPTION 'transition shape or clock differs';END IF;
  SELECT value INTO raw FROM public.sync_state WHERE sync_state.key='keryx:registration-sponsor:v1:row:'||(change_request->>'id');
  IF raw IS NOT NULL THEN stored:=keryx_storage.registration_sponsor_corpus(jsonb_build_object('kind','journal','wire',raw));claim_id:=keryx_storage.registration_sponsor_corpus(jsonb_build_object('kind','row','wire',stored->>'current'))->>'claimId';END IF;
 ELSIF op='funding' THEN
  IF i-'policyWire'-'observationWire'-'now'<>'{}'::jsonb OR jsonb_typeof(i->'policyWire') IS DISTINCT FROM 'string' OR jsonb_typeof(i->'observationWire') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'funding tuple refused';END IF;
 ELSE
  IF i-'lookup'<>'{}'::jsonb OR jsonb_typeof(i->'lookup') IS DISTINCT FROM 'object' OR(i->'lookup')-'wallet'-'id'-'canonicalUrl'<>'{}'::jsonb
   OR jsonb_typeof(i#>'{lookup,wallet}') IS DISTINCT FROM 'string' OR i#>>'{lookup,wallet}' !~ '^0x[0-9a-f]{40}$'
   OR NOT(i->'lookup'?'id' OR i->'lookup'?'canonicalUrl') THEN RAISE EXCEPTION 'lookup refused';END IF;
 END IF;
 IF op IN('admit','funding','transition') THEN
  IF jsonb_typeof(i->'now') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'clock refused';END IF;n:=(i->>'now')::numeric;
  IF n NOT BETWEEN 1 AND 8640000000000000 OR trunc(n)<>n THEN RAISE EXCEPTION 'clock refused';END IF;
 END IF;
 IF claim_id IS NOT NULL AND claim_id !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'claim identity refused';END IF;
 SELECT count(*),coalesce(sum(octet_length(sync_state.key)+octet_length(value)),0) INTO count_rows,wire_bytes FROM public.sync_state
  WHERE sync_state.key LIKE 'keryx:registration-sponsor:v1:policy:%' OR sync_state.key LIKE 'keryx:registration-sponsor:v1:row:%' OR sync_state.key='keryx:source-claims:v1:claim:'||claim_id;
 IF count_rows>2001 OR wire_bytes>14000000 THEN RAISE EXCEPTION 'complete corpus bound';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('key',sync_state.key,'value',value) ORDER BY sync_state.key COLLATE "C"),'[]'::jsonb) INTO retained FROM public.sync_state
  WHERE sync_state.key LIKE 'keryx:registration-sponsor:v1:policy:%' OR sync_state.key LIKE 'keryx:registration-sponsor:v1:row:%' OR sync_state.key='keryx:source-claims:v1:claim:'||claim_id;
 wire:=jsonb_build_object('selector',s,'rows',retained)::text;IF octet_length(wire)>16777216 THEN RAISE EXCEPTION 'snapshot wire bound';END IF;
 sha:=encode(sha256(convert_to(wire,'UTF8')),'hex');IF phase='snapshot' THEN RETURN jsonb_build_object('wire',wire,'sha256',sha);END IF;
 IF request->>'snapshotSha256' IS DISTINCT FROM sha THEN RAISE EXCEPTION 'current corpus changed';END IF;
 meta:=request->'metadata';corpus:=keryx_storage.registration_sponsor_corpus(jsonb_build_object('kind','corpus','metadata',meta));policies:=corpus->'policies';entries:=corpus->'entries';policy_rows:=(corpus->>'policyCount')::integer;entry_rows:=(corpus->>'entryCount')::integer;active_count:=(corpus->>'activeCount')::integer;
 SELECT coalesce(array_agg(value),ARRAY[]::text[]) INTO txs FROM jsonb_array_elements_text(corpus->'transactions');SELECT coalesce(array_agg(value),ARRAY[]::text[]) INTO nonces FROM jsonb_array_elements_text(corpus->'nonces');
 expected_result:='null';
 IF op IN('get','execution') THEN
  IF jsonb_array_length(request->'changes')<>0 THEN RAISE EXCEPTION 'read mutation refused';END IF;
  SELECT value INTO target FROM jsonb_each(entries) e WHERE e.value#>>'{currentRoot,creator}'=i#>>'{lookup,wallet}'
   AND(NOT(i->'lookup'?'id') OR e.value#>>'{currentRoot,id}'=i#>>'{lookup,id}') AND(NOT(i->'lookup'?'canonicalUrl') OR e.value#>>'{currentRoot,canonicalUrl}'=i#>>'{lookup,canonicalUrl}') ORDER BY(e.value#>>'{originalRoot,createdAt}')::numeric DESC,e.key COLLATE "C" LIMIT 1;
  IF target IS NOT NULL THEN expected_result:=CASE WHEN op='get' THEN target->>'currentWire' ELSE coalesce(target->>'executionWire','null') END;END IF;
 ELSE
  IF op='admit' THEN
   requested:=meta->'requested';p:=(i->>'policyWire')::jsonb;current_root:=requested->'root';policy_digest:=requested->>'policyDigest';cohort:=requested->>'cohortDigest';creator:=current_root->>'creator';id:=current_root->>'id';
   root:=keryx_storage.registration_sponsor_corpus(jsonb_build_object('kind','row','wire',i->>'rowWire'));
   IF root IS DISTINCT FROM current_root THEN RAISE EXCEPTION 'requested root differs';END IF;
   IF requested->>'policyWire' IS DISTINCT FROM i->>'policyWire' OR requested->>'computedIntentId' IS DISTINCT FROM id OR requested->>'computedOnchainId' IS DISTINCT FROM current_root->>'onchainId' OR current_root->>'policyDigest' IS DISTINCT FROM policy_digest OR current_root->>'state' IS DISTINCT FROM 'prepared' OR current_root->>'reservedWei' IS DISTINCT FROM p->>'maxTransactionWei' THEN RAISE EXCEPTION 'requested parser differs';END IF;
   IF current_root->>'registryAddress' IS DISTINCT FROM p->>'registryAddress' OR current_root->>'registryCodeHash' IS DISTINCT FROM p->>'registryCodeHash' OR current_root->>'relayer' IS DISTINCT FROM p->>'sponsorAddress' OR'eip155:'||(current_root->>'chainId') IS DISTINCT FROM p->>'network' OR(current_root->>'deadline')::numeric*1000<=((current_root->>'createdAt')::numeric) OR p->>'protocol'='keryx-registration-sponsor-v1' AND(current_root->>'deadline')::numeric*1000>(p->>'expiresAt')::numeric OR p->>'protocol'='keryx-registration-sponsor-v2' AND(current_root->>'deadline')::numeric*1000>(current_root->>'createdAt')::numeric+600000 THEN RAISE EXCEPTION 'requested policy tuple differs';END IF;
   SELECT value INTO target FROM jsonb_each(policies) e WHERE e.value->>'cohortDigest'=cohort LIMIT 1;IF target IS NOT NULL AND target->>'policyDigest'<>policy_digest THEN RAISE EXCEPTION 'original policy cannot change';END IF;
   target:=entries->('keryx:registration-sponsor:v1:row:'||id);SELECT value INTO latest FROM jsonb_each(entries) e WHERE e.value#>>'{currentRoot,canonicalUrl}'=current_root->>'canonicalUrl' ORDER BY(e.value#>>'{originalRoot,createdAt}')::numeric DESC,e.key COLLATE "C" LIMIT 1;
   IF target IS NULL AND NOT(current_root?'replacesRequestId') THEN target:=latest;END IF;
   IF target IS NOT NULL THEN
    root:=jsonb_set(current_root,'{createdAt}',target#>'{originalRoot,createdAt}');IF root-ARRAY['state','updatedAt','transactionHash','transactionNonce','actualGasWei','expiredResolution'] IS DISTINCT FROM(target->'originalRoot')-ARRAY['state','updatedAt','transactionHash','transactionNonce','actualGasWei','expiredResolution'] THEN RAISE EXCEPTION 'original request conflict';END IF;
    current_root:=target->'currentRoot';expected_result:=target->>'currentWire';IF current_root->>'state'='prepared' AND n>(current_root->>'deadline')::numeric*1000 THEN next_root:=current_root||jsonb_build_object('state','expired','updatedAt',greatest(n,(current_root->>'updatedAt')::numeric));wanted:=wanted||jsonb_build_object(target->>'key',jsonb_build_object('root',next_root,'originalWire',target->>'originalWire','executionWire',target->'executionWire'));current_root:=next_root;expected_result:=NULL;END IF;
   ELSE
    new_hold:=true;requires_claim:=p->>'protocol'='keryx-registration-sponsor-v2';requires_funds:=requires_claim;
    IF p->>'network' IS DISTINCT FROM expected->>'network' OR entry_rows>=1000 OR NOT(policies?policy_digest) AND policy_rows>=1000 OR(current_root->>'deadline')::numeric*1000<=greatest(n,wall_now) OR p->>'protocol'='keryx-registration-sponsor-v1' AND greatest(n,wall_now)>=(p->>'expiresAt')::numeric OR p->>'protocol'='keryx-registration-sponsor-v2' AND(current_root->>'deadline')::numeric*1000>n+600000 THEN RAISE EXCEPTION 'admission authority expired or bounded';END IF;
    FOR item IN SELECT value FROM jsonb_each(entries) LOOP
     root:=item->'currentRoot';IF root->>'state'='prepared' AND n>(root->>'deadline')::numeric*1000 THEN wanted:=wanted||jsonb_build_object(item->>'key',jsonb_build_object('root',root||jsonb_build_object('state','expired','updatedAt',greatest(n,(root->>'updatedAt')::numeric)),'originalWire',item->>'originalWire','executionWire',item->'executionWire'));END IF;
     IF root->>'creator'=creator AND(root->>'state' IN('signing','submitted') OR root->>'state'='prepared' AND n<=(root->>'deadline')::numeric*1000) THEN RAISE EXCEPTION 'creator already busy';END IF;
    END LOOP;
    IF current_root?'replacesRequestId' THEN
     root:=latest->'currentRoot';IF latest IS NULL OR current_root->>'replacesRequestId' IS DISTINCT FROM root->>'id' OR root->>'id'=id OR root->>'creator' IS DISTINCT FROM creator OR root->>'canonicalUrl' IS DISTINCT FROM current_root->>'canonicalUrl' OR root->>'claimId' IS DISTINCT FROM current_root->>'claimId' OR root->>'sourceIdWire' IS DISTINCT FROM current_root->>'sourceIdWire'
      OR n<=(latest#>>'{originalRoot,createdAt}')::numeric OR(root->>'updatedAt')::numeric>n OR NOT(root->>'state'='reverted' AND root?'transactionHash' AND root?'actualGasWei' OR(root->>'state'='expired' OR root->>'state'='prepared' AND n>(root->>'deadline')::numeric*1000) AND NOT(root?'transactionNonce' OR root?'transactionHash' OR root?'actualGasWei') AND n>=((root->>'deadline')::numeric+1)*1000) THEN RAISE EXCEPTION 'renewal lineage refused';END IF;
     IF root->>'policyDigest'<>policy_digest THEN other_root:=(policies->(root->>'policyDigest')->>'policyWire')::jsonb;IF other_root->>'protocol'<>'keryx-registration-sponsor-v1' OR p->>'protocol'<>'keryx-registration-sponsor-v2' OR other_root->>'deploymentOrigin' IS DISTINCT FROM p->>'deploymentOrigin' OR root->'chainId' IS DISTINCT FROM current_root->'chainId' OR root->'relayer' IS DISTINCT FROM current_root->'relayer' OR root->'registryAddress' IS DISTINCT FROM current_root->'registryAddress' OR root->'registryCodeHash' IS DISTINCT FROM current_root->'registryCodeHash' OR root->'rssUrl' IS DISTINCT FROM current_root->'rssUrl' THEN RAISE EXCEPTION 'policy lineage refused';END IF;END IF;
    ELSIF latest IS NOT NULL THEN RAISE EXCEPTION 'unnamed replacement refused';END IF;
    IF p->>'protocol'='keryx-registration-sponsor-v1' THEN
     IF NOT(p->'allowlistedCreators'?creator OR p->'allowlistedPublisherOrigins'?(requested->>'publisherOrigin')) THEN RAISE EXCEPTION 'creator ineligible';END IF;
     total_count:=0;daily_count:=0;wallet_count:=0;origin_count:=0;total_wei:=0;daily_wei:=0;day_value:=to_char(to_timestamp(n::double precision/1000) AT TIME ZONE 'UTC','YYYY-MM-DD');
     FOR item IN SELECT value FROM jsonb_each(entries) LOOP
      root:=item->'currentRoot';IF root->>'policyDigest'=policy_digest THEN amount:=CASE WHEN root->>'state'='expired' OR root->>'state'='prepared' AND n>(root->>'deadline')::numeric*1000 THEN 0 ELSE coalesce(root->>'actualGasWei',root->>'reservedWei')::numeric END;total_count:=total_count+1;total_wei:=total_wei+amount;IF root->>'creator'=creator THEN wallet_count:=wallet_count+1;END IF;IF item->>'publisherOrigin'=requested->>'publisherOrigin' THEN origin_count:=origin_count+1;END IF;IF to_char(to_timestamp((root->>'createdAt')::double precision/1000) AT TIME ZONE 'UTC','YYYY-MM-DD')=day_value THEN daily_count:=daily_count+1;daily_wei:=daily_wei+amount;END IF;END IF;
     END LOOP;
     IF total_count>=(p->>'maxRegistrationsTotal')::integer OR daily_count>=(p->>'maxRegistrationsPerDay')::integer OR wallet_count>=(p->>'maxRegistrationsPerWallet')::integer OR p?'maxRegistrationsPerOrigin' AND origin_count>=(p->>'maxRegistrationsPerOrigin')::integer OR total_wei+(p->>'maxTransactionWei')::numeric>(p->>'maxLifetimeWei')::numeric OR daily_wei+(p->>'maxTransactionWei')::numeric>(p->>'maxDailyWei')::numeric THEN RAISE EXCEPTION 'cumulative cap reached';END IF;
    END IF;
    IF NOT(policies?policy_digest) THEN new_policy_key:='keryx:registration-sponsor:v1:policy:'||cohort;new_policy:=jsonb_build_object('cohortDigest',cohort,'policyDigest',policy_digest,'policy',p);END IF;
    next_root:=current_root||jsonb_build_object('createdAt',n,'updatedAt',n);wanted:=wanted||jsonb_build_object('keryx:registration-sponsor:v1:row:'||id,jsonb_build_object('root',next_root,'originalWire',NULL,'executionWire',NULL));current_root:=next_root;expected_result:=NULL;
   END IF;
  ELSIF op='transition' THEN
   id:=change_request->>'id';creator:=change_request->>'wallet';target:=entries->('keryx:registration-sponsor:v1:row:'||id);current_root:=target->'currentRoot';original_root:=target->'originalRoot';
   IF target IS NULL OR current_root->>'creator' IS DISTINCT FROM creator OR current_root->>'state' IS DISTINCT FROM change_request->>'expectedState' OR n<(current_root->>'updatedAt')::numeric THEN RAISE EXCEPTION 'original state changed';END IF;
   p:=(policies->(current_root->>'policyDigest')->>'policyWire')::jsonb;policy_digest:=current_root->>'policyDigest';cohort:=policies->policy_digest->>'cohortDigest';
   IF change_request?'creatorSignature' AND NOT(current_root->>'state'='prepared' AND change_request->>'nextState'='signing') OR change_request?'signedTransaction' AND NOT(current_root->>'state'='signing' AND change_request->>'nextState'='submitted') OR change_request?'expiredResolution' AND NOT(current_root->>'state'=change_request->>'nextState' AND current_root->>'state' IN('signing','submitted')) THEN RAISE EXCEPTION 'execution mutation refused';END IF;
   next_execution:=target->>'executionWire';
   IF current_root->>'state'='prepared' AND change_request->>'nextState'='expired' THEN
    IF n<=(current_root->>'deadline')::numeric*1000 OR change_request?'transactionNonce' OR change_request?'transactionHash' OR change_request?'actualGasWei' THEN RAISE EXCEPTION 'unsigned expiry refused';END IF;
   ELSIF current_root->>'state'='prepared' AND change_request->>'nextState'='signing' THEN
    requires_claim:=true;requires_funds:=p->>'protocol'='keryx-registration-sponsor-v2';IF greatest(n,wall_now)>(current_root->>'deadline')::numeric*1000 OR p->>'protocol'='keryx-registration-sponsor-v1' AND greatest(n,wall_now)>=(p->>'expiresAt')::numeric OR NOT(change_request?'transactionNonce') OR change_request?'transactionHash' OR change_request?'actualGasWei' OR active_count>0 THEN RAISE EXCEPTION 'signing authority refused';END IF;
    nonce_key:=current_root->>'chainId'||':'||(current_root->>'relayer')||':'||(change_request->>'transactionNonce');IF nonce_key=ANY(nonces) THEN RAISE EXCEPTION 'nonce already retained';END IF;
   ELSIF current_root->>'state'='signing' AND change_request->>'nextState'='submitted' THEN
    IF NOT(change_request?'transactionHash') OR change_request?'actualGasWei' OR change_request?'transactionNonce' AND change_request->'transactionNonce' IS DISTINCT FROM current_root->'transactionNonce' OR change_request->>'transactionHash'=ANY(txs)
     OR next_execution IS NOT NULL AND(NOT(change_request?'signedTransaction') OR meta->>'signedTransactionHash' IS DISTINCT FROM change_request->>'transactionHash') THEN RAISE EXCEPTION 'signed original differs';END IF;
   ELSIF current_root->>'state'=change_request->>'nextState' AND current_root->>'state' IN('signing','submitted') THEN
    requires_claim:=NOT(change_request?'expiredResolution');requires_funds:=p->>'protocol'='keryx-registration-sponsor-v2';IF next_execution IS NULL OR change_request?'actualGasWei' OR change_request?'transactionNonce' AND change_request->'transactionNonce' IS DISTINCT FROM current_root->'transactionNonce' OR change_request?'transactionHash' AND change_request->'transactionHash' IS DISTINCT FROM current_root->'transactionHash'
     OR p->>'protocol'='keryx-registration-sponsor-v1' AND greatest(n,wall_now)>=(p->>'expiresAt')::numeric OR CASE WHEN change_request?'expiredResolution' THEN n<=(current_root->>'deadline')::numeric*1000 ELSE greatest(n,wall_now)>(current_root->>'deadline')::numeric*1000 OR current_root?'expiredResolution' END THEN RAISE EXCEPTION 'resume authority refused';END IF;
   ELSIF current_root->>'state'='submitted' AND change_request->>'nextState' IN('confirmed','reverted') THEN
    IF NOT(change_request?'actualGasWei') OR(change_request->>'actualGasWei')::numeric>(current_root->>'reservedWei')::numeric OR change_request?'transactionNonce' AND change_request->'transactionNonce' IS DISTINCT FROM current_root->'transactionNonce' OR change_request?'transactionHash' AND change_request->'transactionHash' IS DISTINCT FROM current_root->'transactionHash' THEN RAISE EXCEPTION 'finality tuple differs';END IF;
   ELSE RAISE EXCEPTION 'transition refused';END IF;
   next_root:=current_root||jsonb_build_object('state',change_request->'nextState','updatedAt',n)||((change_request-'wallet'-'id'-'expectedState'-'nextState'-'creatorSignature'-'signedTransaction'-'fundingObservation'-'now'));
   IF change_request?'creatorSignature' THEN next_execution:=jsonb_build_object('creatorSignature',change_request->'creatorSignature')::text;END IF;
   IF change_request?'signedTransaction' THEN IF next_execution IS NULL THEN RAISE EXCEPTION 'creator execution missing';END IF;next_execution:=(next_execution::jsonb||jsonb_build_object('signedTransaction',change_request->'signedTransaction'))::text;END IF;
   wanted:=jsonb_build_object(target->>'key',jsonb_build_object('root',next_root,'originalWire',target->>'originalWire','executionWire',next_execution));current_root:=next_root;expected_result:=NULL;
  ELSE p:=(i->>'policyWire')::jsonb;requires_funds:=true;IF meta#>>'{requested,policyWire}' IS DISTINCT FROM i->>'policyWire' THEN RAISE EXCEPTION 'inspection policy differs';END IF;policy_digest:=meta#>>'{requested,policyDigest}';cohort:=meta#>>'{requested,cohortDigest}';END IF;
  IF requires_claim THEN
   IF p->>'network' IS DISTINCT FROM expected->>'network' THEN RAISE EXCEPTION 'exposure network differs';END IF;
   proof_meta:=corpus->'claims'->('keryx:source-claims:v1:claim:'||(current_root->>'claimId'));proof_root:=proof_meta->'root';
   IF proof_root IS NULL OR proof_root='null'::jsonb THEN RAISE EXCEPTION 'current proof missing';END IF;
   IF proof_root->>'id' IS DISTINCT FROM current_root->>'claimId' OR proof_root->>'ownerWallet' IS DISTINCT FROM current_root->>'creator' OR proof_root->'revision' IS DISTINCT FROM current_root->'claimRevision' OR proof_root->'canonicalUrl' IS DISTINCT FROM current_root->'canonicalUrl' OR proof_root->'rssUrl' IS DISTINCT FROM current_root->'rssUrl'
    OR proof_meta->>'sourceIdWire' IS DISTINCT FROM current_root->>'sourceIdWire' OR lower(proof_root->>'onchainId') IS DISTINCT FROM current_root->>'onchainId' OR proof_root->>'registryAddress' IS DISTINCT FROM current_root->>'registryAddress' OR proof_root->>'network' IS DISTINCT FROM p->>'network' OR proof_root->>'deploymentOrigin' IS DISTINCT FROM p->>'deploymentOrigin'
    OR proof_root->>'proofMethod' IS NULL OR proof_root->>'proofMethod' NOT IN('website-file','rss-channel') OR extract(epoch FROM(proof_root->>'verifiedAt')::timestamptz)*1000>greatest(n,wall_now) OR greatest(n,wall_now)-extract(epoch FROM(proof_root->>'verifiedAt')::timestamptz)*1000>86400000 THEN RAISE EXCEPTION 'current proof changed';END IF;
  END IF;
  IF requires_funds THEN
   observation_wire:=CASE WHEN op='transition' THEN keryx_storage.source_scalar_text(i->>'changeWire','tokens')->>'fundingObservation' ELSE i->>'observationWire' END;observation:=observation_wire::jsonb;funding_identity:=request->'observationIdentity';
   IF p->>'network' IS DISTINCT FROM expected->>'network' OR jsonb_typeof(observation->'observedAt') IS DISTINCT FROM 'number' OR jsonb_typeof(observation->'blockTimestamp') IS DISTINCT FROM 'number' OR jsonb_typeof(observation->'latestTransactionNonce') IS DISTINCT FROM 'number' OR observation->>'blockHash' IS NULL OR observation->>'blockHash' !~ '^0x[0-9a-f]{64}$' OR observation->>'blockNumber' IS NULL OR observation->>'blockNumber' !~ '^(0|[1-9][0-9]{0,77})$' OR observation->>'nativeBalanceWei' IS NULL OR observation->>'nativeBalanceWei' !~ '^(0|[1-9][0-9]{0,77})$' THEN RAISE EXCEPTION 'funding observation shape differs';END IF;
   IF jsonb_typeof(observation) IS DISTINCT FROM 'object' OR observation-'network'-'sponsorAddress'-'blockNumber'-'blockHash'-'blockTimestamp'-'observedAt'-'nativeBalanceWei'-'latestTransactionNonce'<>'{}'::jsonb OR observation->>'network' IS DISTINCT FROM p->>'network' OR observation->>'sponsorAddress' IS DISTINCT FROM p->>'sponsorAddress'
    OR(observation->>'observedAt')::numeric>least(n,wall_now) OR greatest(n,wall_now)-(observation->>'observedAt')::numeric>5000 OR(observation->>'blockTimestamp')::numeric*1000>least(n,wall_now)+5000 OR(observation->>'blockTimestamp')::numeric*1000<greatest(n,wall_now)-60000 THEN RAISE EXCEPTION 'fresh funding unavailable';END IF;
   FOREACH field IN ARRAY ARRAY['observedAt','blockTimestamp','latestTransactionNonce'] LOOP
    IF(observation->>field)::numeric NOT BETWEEN 0 AND 9007199254740991 OR trunc((observation->>field)::numeric)<>(observation->>field)::numeric THEN RAISE EXCEPTION 'funding integer invalid';END IF;
   END LOOP;
   IF jsonb_typeof(observation->'blockNumber') IS DISTINCT FROM 'string' OR jsonb_typeof(observation->'nativeBalanceWei') IS DISTINCT FROM 'string' OR(observation->>'nativeBalanceWei')::numeric>=115792089237316195423570985008687907853269984665640564039457584007913129639936 OR(observation->>'blockNumber')::numeric>=115792089237316195423570985008687907853269984665640564039457584007913129639936 THEN RAISE EXCEPTION 'funding uint invalid';END IF;
   IF jsonb_typeof(funding_identity) IS DISTINCT FROM 'object' OR funding_identity->'identity' IS DISTINCT FROM expected OR funding_identity->'observation' IS DISTINCT FROM observation OR funding_identity->>'dtoDigest' IS DISTINCT FROM encode(sha256(convert_to(observation_wire,'UTF8')),'hex')
    OR jsonb_typeof(funding_identity->'manifestDigest') IS DISTINCT FROM 'string' OR funding_identity->>'manifestDigest' !~ '^[a-f0-9]{64}$' OR funding_identity->>'policyDigest' IS DISTINCT FROM policy_digest OR cohort IS NOT NULL AND funding_identity->>'cohortDigest' IS DISTINCT FROM cohort
    OR op<>'funding' AND(funding_identity->>'purpose' IS DISTINCT FROM 'new-exposure' OR funding_identity->>'role' IS DISTINCT FROM 'registration-sponsor-write') OR op='funding' AND funding_identity->>'role' NOT IN('registration-sponsor-read','registration-sponsor-write') THEN RAISE EXCEPTION 'observation identity differs';END IF;
   IF funding_identity-'identity'-'observation'-'dtoDigest'-'manifestDigest'-'policyDigest'-'cohortDigest'-'purpose'-'role'<>'{}'::jsonb OR funding_identity->>'purpose' IS NULL OR funding_identity->>'purpose' NOT IN('read','new-exposure') OR funding_identity->>'role' IS NULL OR(funding_identity->>'role'='registration-sponsor-write') IS DISTINCT FROM(funding_identity->>'purpose'='new-exposure') THEN RAISE EXCEPTION 'observation role differs';END IF;
   held:=0;FOR item IN SELECT value FROM jsonb_each(entries) LOOP
    root:=item->'currentRoot';IF'eip155:'||(root->>'chainId')=p->>'network' AND root->>'relayer'=p->>'sponsorAddress' THEN
     IF root->>'state' IN('confirmed','reverted') AND(root->>'transactionNonce')::numeric>=(observation->>'latestTransactionNonce')::numeric THEN RAISE EXCEPTION 'stale pre-debit balance';END IF;
     IF root->>'state' IN('signing','submitted') OR root->>'state'='prepared' AND n<=(root->>'deadline')::numeric*1000 THEN held:=held+(root->>'reservedWei')::numeric;END IF;
    END IF;
   END LOOP;
   balance:=(observation->>'nativeBalanceWei')::numeric;spendable:=greatest(balance-held,0);
   IF op='funding' THEN expected_result:=NULL;IF(request->>'resultWire')::jsonb IS DISTINCT FROM jsonb_build_object('available',balance>=held AND spendable>=(p->>'maxTransactionWei')::numeric,'reservedGasCovered',held>0 AND balance>=held,'heldWei',held::text,'spendableWei',spendable::text) THEN RAISE EXCEPTION 'funding result differs';END IF;
   ELSIF new_hold AND(balance<held OR spendable<(p->>'maxTransactionWei')::numeric) OR NOT new_hold AND balance<held OR op='transition' AND(current_root->>'transactionNonce')::numeric<>(observation->>'latestTransactionNonce')::numeric THEN RAISE EXCEPTION 'full hold or nonce unavailable';END IF;
  END IF;
 END IF;
 IF expected_result IS NOT NULL AND request->>'resultWire' IS DISTINCT FROM expected_result THEN RAISE EXCEPTION 'result differs';END IF;
 IF op='funding' AND jsonb_array_length(request->'changes')<>0 THEN RAISE EXCEPTION 'funding read mutation';END IF;
 IF jsonb_array_length(request->'changes')<>(SELECT count(*) FROM jsonb_object_keys(wanted))+(CASE WHEN new_policy_key IS NULL THEN 0 ELSE 1 END) THEN RAISE EXCEPTION 'incomplete mutation';END IF;
 FOR change IN SELECT value FROM jsonb_array_elements(request->'changes') LOOP
  record_key:=change->>'key';IF record_key=ANY(seen) OR change-'key'-'value'-'updatedAt'<>'{}'::jsonb OR jsonb_typeof(change->'value') IS DISTINCT FROM 'string' OR octet_length(change->>'value')>262144 OR extract(epoch FROM(change->>'updatedAt')::timestamptz)*1000<>n THEN RAISE EXCEPTION 'mutation shape differs';END IF;seen:=array_append(seen,record_key);
  IF record_key=new_policy_key THEN IF(change->>'value')::jsonb IS DISTINCT FROM new_policy OR EXISTS(SELECT 1 FROM public.sync_state WHERE sync_state.key=record_key) THEN RAISE EXCEPTION 'policy replacement refused';END IF;
  ELSE
   planned:=wanted->record_key;stored:=keryx_storage.registration_sponsor_corpus(jsonb_build_object('kind','journal','wire',change->>'value'));root:=keryx_storage.registration_sponsor_corpus(jsonb_build_object('kind','row','wire',stored->>'current'));
   IF planned IS NULL OR root IS DISTINCT FROM planned->'root' OR planned->'originalWire'<>'null'::jsonb AND stored->>'original' IS DISTINCT FROM planned->>'originalWire' OR(stored->>'execution')::jsonb IS DISTINCT FROM(planned->>'executionWire')::jsonb THEN RAISE EXCEPTION 'exact original mutation differs';END IF;
   IF planned->'originalWire'='null'::jsonb THEN IF stored->>'original' IS DISTINCT FROM stored->>'current' THEN RAISE EXCEPTION 'initial original differs';END IF;END IF;
   IF expected_result IS NULL AND op IN('admit','transition') AND root->>'id'=current_root->>'id' AND request->>'resultWire' IS DISTINCT FROM stored->>'current' THEN RAISE EXCEPTION 'mutation result differs';END IF;
  END IF;
  INSERT INTO public.sync_state(key,value,updated_at) VALUES(record_key,change->>'value',change->>'updatedAt') ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
 END LOOP;
 IF phase='commit' THEN PERFORM keryx_storage.leave_operation();END IF;RETURN jsonb_build_object('resultWire',request->>'resultWire');
END;$$;
REVOKE ALL ON FUNCTION public.storage_registration_sponsor(jsonb,text,text,text) FROM PUBLIC,anon,authenticated,service_role,keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_registration_sponsor(jsonb,text,text,text) TO keryx_app;
RESET ROLE;
