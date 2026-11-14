-- New originals, never custody, funding, signing, vendor execution or a retry.
SET ROLE keryx_owner;
-- Raw SOURCE JSON remains TEXT in this closed projection. In particular,
-- history evidence with escaped NUL/surrogates is never decoded by JSONB.
-- The digest is only local compare-and-swap authority, never settlement proof.
CREATE FUNCTION keryx_storage.source_claim_purchase_policy(operation text,selector text,packet jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE selection jsonb;source_row jsonb;retained jsonb;browser_row jsonb;hosted_row jsonb;purchase_row jsonb;wire text;sha text;policy_key text;
 row_count bigint;wire_bytes bigint;policy_wire text;replay boolean:=false;before_rows jsonb;before_wire text;source_hash text;fee_policy_key text;
 read_kind text;catalog jsonb;meta_row jsonb;catalog_count bigint;catalog_bytes bigint;
BEGIN
 IF operation='read' THEN
  IF selector IS NULL OR octet_length(selector)>2048 THEN RAISE EXCEPTION 'source read selector refused';END IF;
  selection:=selector::jsonb;read_kind:=selection->>'operation';
  IF jsonb_typeof(selection) IS DISTINCT FROM 'object' OR selection-'operation'-'selector'<>'{}'::jsonb OR NOT(selection?'selector')
   OR read_kind IS NULL OR read_kind NOT IN('claim','for-source','challenge','claims','source','onchain','sources','all-sources','source-meta')
   OR selection->'selector'<>'null'::jsonb AND jsonb_typeof(selection->'selector')<>'string'
   OR read_kind IN('claim','challenge') AND coalesce(selection->>'selector','') !~ '^[a-f0-9]{64}$'
   OR read_kind IN('for-source','source','onchain','source-meta') AND(selection->>'selector' IS NULL OR keryx_storage.a2a_utf16_length(selection->>'selector') NOT BETWEEN 1 AND 256)
   OR read_kind IN('sources','all-sources') AND selection->'selector'<>'null'::jsonb THEN RAISE EXCEPTION 'source read selector refused';END IF;
  SELECT count(*),coalesce(sum(octet_length(to_jsonb(s)::text)),0) INTO catalog_count,catalog_bytes FROM public.sources s WHERE
   read_kind IN('source','for-source') AND s.id=selection->>'selector' OR read_kind='onchain' AND translate(s.onchain_id,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=translate(selection->>'selector','ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')
   OR read_kind='sources' AND s.active OR read_kind='all-sources';
  IF catalog_count>1000 OR catalog_bytes>4194304 OR read_kind='onchain' AND catalog_count>1 THEN RAISE EXCEPTION 'source catalog complete result bound or ambiguous origin';END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('active',CASE WHEN s.active IS NULL THEN NULL WHEN s.active THEN 1 ELSE 0 END,'verified',CASE WHEN s.verified IS NULL THEN NULL WHEN s.verified THEN 1 ELSE 0 END) ORDER BY s.created_at COLLATE "C",s.id COLLATE "C"),'[]'::jsonb) INTO catalog FROM public.sources s WHERE
   read_kind IN('source','for-source') AND s.id=selection->>'selector' OR read_kind='onchain' AND translate(s.onchain_id,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=translate(selection->>'selector','ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')
   OR read_kind='sources' AND s.active OR read_kind='all-sources';
  IF read_kind='source-meta' THEN SELECT to_jsonb(m) INTO meta_row FROM public.source_meta m WHERE m.id=selection->>'selector';IF octet_length(meta_row::text)>4194304 THEN RAISE EXCEPTION 'source metadata complete result bound';END IF;END IF;
  SELECT count(*),coalesce(sum(octet_length(key)+octet_length(value)),0) INTO row_count,wire_bytes FROM public.sync_state WHERE
   key LIKE 'keryx:source-claims:v1:claim:%' OR key LIKE 'keryx:source-claims:v1:history:%' OR key LIKE 'keryx:source-claims:v1:challenge:%'
   OR key LIKE 'keryx:source-claims:v1:marker:%' OR key LIKE 'keryx:source-claims:v1:source:%' OR key LIKE 'keryx:source-registry-origin:v1:%';
  IF row_count>10000 OR wire_bytes>7000000 THEN RAISE EXCEPTION 'source read retained snapshot bound';END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('key',key,'value',value) ORDER BY key COLLATE "C"),'[]'::jsonb) INTO retained FROM public.sync_state WHERE
   key LIKE 'keryx:source-claims:v1:claim:%' OR key LIKE 'keryx:source-claims:v1:history:%' OR key LIKE 'keryx:source-claims:v1:challenge:%'
   OR key LIKE 'keryx:source-claims:v1:marker:%' OR key LIKE 'keryx:source-claims:v1:source:%' OR key LIKE 'keryx:source-registry-origin:v1:%';
  wire:=jsonb_build_object('selector',selection,'sources',catalog,'rows',retained,'meta',meta_row)::text;
  IF octet_length(wire)>8388608 THEN RAISE EXCEPTION 'source read complete encoded bound';END IF;
  RETURN jsonb_build_object('wire',wire,'sha256',encode(sha256(convert_to(wire,'UTF8')),'hex'));
 END IF;
 IF operation NOT IN('snapshot','assert','purchase') OR selector IS NULL OR octet_length(selector)>2048 THEN RAISE EXCEPTION 'source policy selector refused';END IF;
 selection:=selector::jsonb;
 IF jsonb_typeof(selection) IS DISTINCT FROM 'object' OR selection-'sourceId'-'identity'<>'{}'::jsonb OR NOT(selection?'sourceId' AND selection?'identity')
  OR selection->'sourceId'<>'null'::jsonb AND(jsonb_typeof(selection->'sourceId')<>'string' OR keryx_storage.a2a_utf16_length(selection->>'sourceId') NOT BETWEEN 1 AND 256)
  OR selection->'identity'<>'null'::jsonb AND(jsonb_typeof(selection->'identity')<>'object' OR (selection->'identity')-'network'-'payer'-'authorizationId'<>'{}'::jsonb
   OR jsonb_typeof(selection#>'{identity,network}') IS DISTINCT FROM 'string' OR jsonb_typeof(selection#>'{identity,payer}') IS DISTINCT FROM 'string'
   OR jsonb_typeof(selection#>'{identity,authorizationId}') IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'source policy selector refused';END IF;
 -- These two baseline PostgreSQL columns are booleans; Source observes SQLite
 -- INTEGER 0/1. Capture that exact business representation before JS checks.
 SELECT to_jsonb(s)||jsonb_build_object('active',CASE WHEN s.active THEN 1 ELSE 0 END,'verified',CASE WHEN s.verified THEN 1 ELSE 0 END)
  INTO source_row FROM public.sources s WHERE s.id=selection->>'sourceId';
 source_hash:=encode(sha256(convert_to(selection->>'sourceId','UTF8')),'hex');
 IF selection->'identity'<>'null'::jsonb THEN
  policy_key:='keryx:source-claims:v1:purchase-policy:'||encode(sha256(convert_to('{"authorizationId":'||to_json(selection#>>'{identity,authorizationId}')::text||',"network":'||to_json(selection#>>'{identity,network}')::text||',"payer":'||to_json(selection#>>'{identity,payer}')::text||'}','UTF8')),'hex');
  -- Native browser binding columns are JSONB; the Source business helper reads
  -- JSON TEXT. Project those cells as text without changing retained columns.
  SELECT jsonb_build_object('intent',to_jsonb(i),'binding',CASE WHEN b.nonce IS NULL THEN NULL ELSE to_jsonb(b)||jsonb_build_object('payment_metadata',b.payment_metadata::text,'requirements',b.requirements::text) END) INTO browser_row FROM public.browser_authorization_intents i
   LEFT JOIN public.browser_journal_bindings b USING(nonce) WHERE i.nonce=selection#>>'{identity,authorizationId}';
  SELECT jsonb_build_object('authorization',to_jsonb(a),'policy',to_jsonb(p)) INTO hosted_row FROM public.hosted_treasury_authorizations a
   LEFT JOIN public.hosted_treasury_policies p ON p.digest=a.policy_digest WHERE a.nonce=selection#>>'{identity,authorizationId}';
  SELECT to_jsonb(p)-'issued_data' INTO purchase_row FROM public.research_purchase_authorizations p WHERE p.network=selection#>>'{identity,network}'
   AND p.payer=selection#>>'{identity,payer}' AND p.authorization_id=selection#>>'{identity,authorizationId}' AND p.asset=keryx_storage.a2a_original_profile()->>'asset';
  fee_policy_key:='keryx:operating-fee:v1:policy:'||((hosted_row#>>'{authorization,original}')::jsonb#>>'{context,operatingFee,policyDigest}');
 END IF;
 -- An unrelated purchase's policy sidecar is not consumed by Source. Excluding
 -- it permits independent concurrent seller claims without stale-CAS failures.
 SELECT count(*),coalesce(sum(octet_length(key)+octet_length(value)),0) INTO row_count,wire_bytes FROM public.sync_state
  WHERE selection->'sourceId'<>'null'::jsonb AND(key LIKE 'keryx:source-claims:v1:claim:%' OR key LIKE 'keryx:source-claims:v1:history:%'
   OR key LIKE 'keryx:source-claims:v1:challenge:%' OR key='keryx:source-claims:v1:marker:'||source_hash OR key='keryx:source-claims:v1:source:'||source_hash)
   OR key=policy_key OR key=fee_policy_key OR key='keryx:source-registry-origin:v1:'||lower(source_row->>'onchain_id');
 IF row_count>10000 OR wire_bytes>7000000 THEN RAISE EXCEPTION 'source policy snapshot bound';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('key',key,'value',value) ORDER BY key COLLATE "C"),'[]'::jsonb) INTO retained FROM public.sync_state
  WHERE selection->'sourceId'<>'null'::jsonb AND(key LIKE 'keryx:source-claims:v1:claim:%' OR key LIKE 'keryx:source-claims:v1:history:%'
   OR key LIKE 'keryx:source-claims:v1:challenge:%' OR key='keryx:source-claims:v1:marker:'||source_hash OR key='keryx:source-claims:v1:source:'||source_hash)
   OR key=policy_key OR key=fee_policy_key OR key='keryx:source-registry-origin:v1:'||lower(source_row->>'onchain_id');
 wire:=jsonb_build_object('selector',selection,'source',source_row,'rows',retained,'browser',browser_row,'hosted',hosted_row,'purchase',purchase_row)::text;
 IF octet_length(wire)>8388608 THEN RAISE EXCEPTION 'source policy encoded snapshot bound';END IF;
 sha:=encode(sha256(convert_to(wire,'UTF8')),'hex');
 IF operation='snapshot' THEN RETURN jsonb_build_object('wire',wire,'sha256',sha);END IF;
 IF packet IS NULL OR jsonb_typeof(packet)<>'object' OR packet-'selector'-'snapshotSha256'-'policySnapshot'-'policyWire'-'existing'-'purchaseRow'<>'{}'::jsonb
  OR packet->>'selector' IS DISTINCT FROM selector
  OR jsonb_typeof(packet->'existing') IS DISTINCT FROM 'boolean'
  OR NOT(packet?'policySnapshot' AND packet?'policyWire') THEN RAISE EXCEPTION 'source policy snapshot changed';END IF;
 IF packet->'policySnapshot'<>'null'::jsonb THEN
  policy_wire:=packet->>'policyWire';
  IF policy_wire IS NULL OR octet_length(policy_wire)>2048 OR policy_wire::jsonb IS DISTINCT FROM packet->'policySnapshot'
   OR packet#>>'{policySnapshot,sourceId}' IS DISTINCT FROM selection->>'sourceId'
   OR (packet->'policySnapshot')-'sourceId'-'receipt'-'kind'<>'{}'::jsonb OR packet#>>'{policySnapshot,kind}' NOT IN('fetch','citation','operating-fee')
   THEN RAISE EXCEPTION 'source policy capture refused';END IF;
 ELSE IF packet->'policyWire'<>'null'::jsonb OR selection->'sourceId'<>'null'::jsonb THEN RAISE EXCEPTION 'source policy capture refused';END IF;END IF;
 IF operation='purchase' AND selection->'identity'<>'null'::jsonb AND NOT(packet->>'existing')::boolean AND purchase_row IS NOT NULL
  AND jsonb_typeof(packet->'purchaseRow')='object' AND purchase_row IS NOT DISTINCT FROM (packet->'purchaseRow')-'issued_data' THEN
  -- Two identical Source BEGIN IMMEDIATE claims both succeed: the later one is
  -- an exact replay. Reconstruct only the first writer's known changes. Never
  -- absorb another source/history/signing-original change into this exception.
  policy_key:='keryx:source-claims:v1:purchase-policy:'||encode(sha256(convert_to('{"authorizationId":'||to_json(selection#>>'{identity,authorizationId}')::text||',"network":'||to_json(selection#>>'{identity,network}')::text||',"payer":'||to_json(selection#>>'{identity,payer}')::text||'}','UTF8')),'hex');
  IF policy_wire IS NULL OR EXISTS(SELECT 1 FROM public.sync_state WHERE key=policy_key AND value=policy_wire) THEN
   SELECT coalesce(jsonb_agg(value ORDER BY value->>'key' COLLATE "C"),'[]'::jsonb) INTO before_rows FROM jsonb_array_elements(retained) WHERE policy_wire IS NULL OR value->>'key'<>policy_key;
   before_wire:=jsonb_set(jsonb_set(wire::jsonb,'{purchase}','null'::jsonb),'{rows}',before_rows)::text;
   replay:=packet->>'snapshotSha256'=encode(sha256(convert_to(before_wire,'UTF8')),'hex');
  END IF;
 END IF;
 IF packet->>'snapshotSha256' IS DISTINCT FROM sha AND NOT replay OR (packet->>'existing')::boolean IS DISTINCT FROM (purchase_row IS NOT NULL) AND NOT replay
 THEN RAISE EXCEPTION 'source policy snapshot changed';END IF;
 IF NOT(packet->>'existing')::boolean AND NOT replay AND packet#>'{policySnapshot,receipt}'<>'null'::jsonb THEN
  IF packet#>>'{policySnapshot,receipt,mode}' NOT IN('paid','citation-only')
   OR packet#>>'{policySnapshot,kind}'='fetch' AND packet#>>'{policySnapshot,receipt,mode}'<>'paid'
   OR (packet#>>'{policySnapshot,receipt,verifiedAt}')::timestamptz>clock_timestamp()
   OR (packet#>>'{policySnapshot,receipt,verifiedAt}')::timestamptz<clock_timestamp()-interval '24 hours'
   OR (packet#>>'{policySnapshot,receipt,effectiveAt}')::timestamptz>clock_timestamp()
  THEN RAISE EXCEPTION 'source policy window expired';END IF;
 END IF;
 IF operation='purchase' THEN
  IF selection->'identity'='null'::jsonb THEN RAISE EXCEPTION 'source purchase identity required';END IF;
  IF NOT(packet->>'existing')::boolean AND NOT replay AND policy_wire IS NOT NULL THEN
   policy_key:='keryx:source-claims:v1:purchase-policy:'||encode(sha256(convert_to('{"authorizationId":'||to_json(selection#>>'{identity,authorizationId}')::text||',"network":'||to_json(selection#>>'{identity,network}')::text||',"payer":'||to_json(selection#>>'{identity,payer}')::text||'}','UTF8')),'hex');
   INSERT INTO public.sync_state(key,value,updated_at) VALUES(policy_key,policy_wire,clock_timestamp()) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
  END IF;
 END IF;
 RETURN NULL;
END;$$;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('source_claims_read',ARRAY['sources','sync_state','source_meta'],true,true),
 ('source_policy_snapshot',ARRAY['sync_state','sources','browser_authorization_intents','browser_journal_bindings','hosted_treasury_authorizations','hosted_treasury_policies','research_purchase_authorizations'],true,true),
 ('hosted_admit_authorization',ARRAY['hosted_treasury_policies','hosted_treasury_authorizations','payment_events','sync_state','sources','private_research_executions','private_research_intents','private_research_results','private_research_interruptions','browser_journal_writer','browser_authorization_intents','browser_journal_bindings','research_purchase_authorizations'],true,false);
CREATE FUNCTION public.storage_hosted_admit_authorization(expected jsonb,digest text,policy_wire text,policy_digest text,original_wire text,accounting_wire text,available_wire text,fee_wire text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p jsonb;c jsonb;payload jsonb;m jsonb;types jsonb;domain jsonb;totals jsonb;supplied jsonb;fee jsonb;fee_context jsonb;admitted record;job record;
 chosen_nonce text;amount numeric;query_amount numeric;first_budget text;before numeric;after numeric;now_seconds bigint:=floor(extract(epoch FROM clock_timestamp()));
 field text;integer_value numeric;parsed_uint numeric[]:=ARRAY[]::numeric[];url text;claim_id text;fee_key text;retained_fee text;role_name text;
BEGIN
 IF policy_wire='source-claims-read' THEN
  IF current_setting('transaction_read_only')<>'on' OR policy_digest IS NOT NULL OR accounting_wire IS NOT NULL OR available_wire IS NOT NULL OR fee_wire IS NOT NULL THEN RAISE EXCEPTION 'source claims read-only snapshot required';END IF;
  PERFORM keryx_storage.require_operation(expected,digest,'source_claims_read');
  RETURN keryx_storage.source_claim_purchase_policy('read',original_wire,NULL);
 END IF;
 IF policy_wire='source-policy-snapshot' THEN
  IF session_user<>'keryx_app' OR current_setting('transaction_read_only')<>'on' OR policy_digest IS NOT NULL OR accounting_wire IS NOT NULL OR available_wire IS NOT NULL OR fee_wire IS NOT NULL THEN RAISE EXCEPTION 'source policy read-only snapshot required';END IF;
  PERFORM keryx_storage.require_operation(expected,digest,'source_policy_snapshot');
  RETURN keryx_storage.source_claim_purchase_policy('snapshot',original_wire,NULL);
 END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'hosted_admit_authorization');
 -- The retained payment fence requires this transaction-local capability. Only
 -- this closed native writer can create it; leave_operation removes it and a
 -- refusal rolls it back. It never creates a browser grant/reservation.
 INSERT INTO public.browser_journal_writer VALUES(txid_current()) ON CONFLICT DO NOTHING;
 IF policy_wire IS NULL OR octet_length(policy_wire)>4096 OR original_wire IS NULL OR octet_length(original_wire)>8192
  OR accounting_wire IS NULL OR octet_length(accounting_wire)>256 OR available_wire IS NULL OR available_wire !~ '^(0|[1-9][0-9]{0,15})$'
  OR available_wire::numeric>9007199254740991 OR policy_digest IS DISTINCT FROM encode(sha256(convert_to(policy_wire,'UTF8')),'hex') THEN RAISE EXCEPTION 'hosted admission refused';END IF;
 p:=policy_wire::jsonb;c:=original_wire::jsonb->'context';payload:=original_wire::jsonb->'payload';m:=payload->'message';types:=payload->'types';domain:=payload->'domain';
 IF p->>'format' IS DISTINCT FROM 'keryx-hosted-treasury-policy-v1' OR p->>'network' IS DISTINCT FROM 'eip155:5042'
  OR p->>'storageIdentityDigest' IS DISTINCT FROM keryx_storage.identity_digest(expected) OR p->>'origin' IS DISTINCT FROM (SELECT origin FROM keryx_storage.control WHERE singleton)
  OR (p->>'expiresAtSeconds')::numeric<=now_seconds OR jsonb_typeof(c) IS DISTINCT FROM 'object'
  OR c->>'kind' IS NULL OR c->>'kind' NOT IN('fetch','citation','operating-fee') OR jsonb_typeof(c->'queryId') IS DISTINCT FROM 'string'
  OR keryx_storage.a2a_utf16_length(c->>'queryId') NOT BETWEEN 1 AND 256 OR jsonb_typeof(c->'sourceId') IS DISTINCT FROM 'string'
  OR keryx_storage.a2a_utf16_length(c->>'sourceId') NOT BETWEEN 1 AND 256 OR c->>'queryBudgetMicroUsdc' IS NULL
  OR c->>'queryBudgetMicroUsdc' !~ '^[1-9][0-9]{0,15}$' OR (c->>'queryBudgetMicroUsdc')::numeric>9007199254740991
  OR (c->>'queryBudgetMicroUsdc')::numeric>(p->>'queryCapMicroUsdc')::numeric
  OR NOT(c?'privateJob') OR c->'privateJob'<>'null'::jsonb AND jsonb_typeof(c->'privateJob')<>'object'
  OR NOT(c?'itemId') OR c->'itemId'<>'null'::jsonb AND(jsonb_typeof(c->'itemId')<>'string' OR keryx_storage.a2a_utf16_length(c->>'itemId') NOT BETWEEN 1 AND 256)
  OR c-'queryId'-'queryBudgetMicroUsdc'-'kind'-'sourceId'-'itemId'-'privateJob'-'sourceClaim'-'operatingFee'<>'{}'::jsonb THEN RAISE EXCEPTION 'hosted context refused';END IF;
 role_name:=CASE WHEN c->'privateJob'='null'::jsonb THEN 'public' ELSE 'private' END;
 SELECT data,role INTO admitted FROM public.hosted_treasury_policies h WHERE h.digest=policy_digest;
 IF NOT FOUND OR admitted.data IS DISTINCT FROM policy_wire OR admitted.role<>role_name THEN RAISE EXCEPTION 'hosted policy role unavailable';END IF;
 IF payload->>'primaryType' IS DISTINCT FROM 'TransferWithAuthorization' OR domain IS DISTINCT FROM jsonb_build_object('name','GatewayWalletBatched','version','1','chainId',5042,'verifyingContract',domain->'verifyingContract')
  OR lower(domain->>'verifyingContract') IS DISTINCT FROM keryx_storage.a2a_original_profile()->>'gatewayContract'
  OR types-'EIP712Domain' IS DISTINCT FROM __HOSTED_PAYMENT_TYPES__::jsonb
  OR types?'EIP712Domain' AND types->'EIP712Domain' IS DISTINCT FROM __HOSTED_DOMAIN_FIELDS__::jsonb
  OR jsonb_typeof(m) IS DISTINCT FROM 'object' OR m-'from'-'to'-'value'-'validAfter'-'validBefore'-'nonce'<>'{}'::jsonb
  OR jsonb_typeof(m->'from') IS DISTINCT FROM 'string' OR lower(m->>'from') IS DISTINCT FROM p->>'signer'
  OR jsonb_typeof(m->'to') IS DISTINCT FROM 'string' OR m->>'to' !~ '^0x[0-9a-fA-F]{40}$' OR m->>'to'~'^0x0{40}$'
  OR jsonb_typeof(m->'nonce') IS DISTINCT FROM 'string' OR m->>'nonce' !~ '^0x[0-9a-fA-F]{64}$' THEN RAISE EXCEPTION 'hosted payment payload refused';END IF;
 FOREACH field IN ARRAY ARRAY['value','validBefore','validAfter'] LOOP
  IF m->field IS NULL OR jsonb_typeof(m->field) NOT IN('string','number') OR m->>field !~ '^(0|[1-9][0-9]{0,77})$' THEN RAISE EXCEPTION 'hosted integer refused';END IF;
  integer_value:=(m->>field)::numeric;
  IF integer_value>115792089237316195423570985008687907853269984665640564039457584007913129639935 OR jsonb_typeof(m->field)='number' AND integer_value>9007199254740991 THEN RAISE EXCEPTION 'hosted integer refused';END IF;
  parsed_uint:=array_append(parsed_uint,integer_value);
 END LOOP;
 amount:=parsed_uint[1];before:=parsed_uint[2];after:=parsed_uint[3];chosen_nonce:=lower(m->>'nonce');
 IF amount NOT BETWEEN 1 AND 9007199254740991 OR after>now_seconds OR after<now_seconds-3600 OR before<now_seconds+604800 OR before>now_seconds+691500 OR before<=after THEN RAISE EXCEPTION 'hosted payment lifetime or amount refused';END IF;
 IF c->>'kind'='operating-fee' THEN
  IF c->>'sourceId'<>'keryx:operating-fee' OR c->'itemId'<>'null'::jsonb OR role_name<>'public' OR c?'sourceClaim'
   OR fee_wire IS NULL OR octet_length(fee_wire)>4096 THEN RAISE EXCEPTION 'hosted operating fee context refused';END IF;
  fee:=fee_wire::jsonb;fee_context:=c->'operatingFee';
  IF fee->>'format' IS DISTINCT FROM 'keryx-operating-fee-policy-v1' OR fee->>'network' IS DISTINCT FROM 'eip155:5042'
   OR fee->>'origin' IS DISTINCT FROM p->>'origin' OR fee->>'storageIdentityDigest' IS DISTINCT FROM p->>'storageIdentityDigest'
   OR fee->>'beneficiary' IS DISTINCT FROM lower(m->>'to') OR fee->>'beneficiary'=p->>'signer' OR (fee->>'expiresAtSeconds')::numeric<=now_seconds
   OR fee_context->>'policyDigest' IS DISTINCT FROM encode(sha256(convert_to(fee_wire,'UTF8')),'hex')
   OR fee_context->>'allocationDigest' IS NULL OR fee_context->>'allocationDigest' !~ '^[0-9a-f]{64}$'
   OR fee_context->>'amountMicroUsdc' IS DISTINCT FROM amount::text OR amount>floor((c->>'queryBudgetMicroUsdc')::numeric/2)
   OR jsonb_typeof(fee_context->'sourceUrls') IS DISTINCT FROM 'array' OR jsonb_array_length(fee_context->'sourceUrls') NOT BETWEEN 1 AND 32
   OR octet_length((fee_context->'sourceUrls')::text)>4160 THEN RAISE EXCEPTION 'hosted operating fee terms refused';END IF;
  FOR url IN SELECT jsonb_array_elements_text(fee_context->'sourceUrls') LOOP
   -- Canonical URL validation also runs in the protected Node policy parser.
   IF url !~ '^https://' OR char_length(url)>2048 THEN RAISE EXCEPTION 'operating fee source refused';END IF;
   claim_id:=encode(sha256(convert_to('{"canonicalUrl":'||to_json(url)::text||',"deploymentOrigin":'||to_json(p->>'origin')::text||',"network":"eip155:5042"}','UTF8')),'hex');
   IF EXISTS(SELECT 1 FROM public.sync_state WHERE key='keryx:source-claims:v1:claim:'||claim_id OR key LIKE 'keryx:source-claims:v1:history:'||claim_id||':%') THEN RAISE EXCEPTION 'operating fee retained owner claim';END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.hosted_treasury_authorizations a WHERE a.query_id=c->>'queryId' AND a.original::jsonb#>>'{context,kind}'='operating-fee') THEN RAISE EXCEPTION 'operating fee original already admitted';END IF;
  fee_key:='keryx:operating-fee:v1:policy:'||(fee_context->>'policyDigest');
  INSERT INTO public.sync_state(key,value,updated_at) VALUES(fee_key,fee_wire,clock_timestamp()) ON CONFLICT DO NOTHING;
  SELECT value INTO retained_fee FROM public.sync_state WHERE key=fee_key;IF retained_fee IS DISTINCT FROM fee_wire THEN RAISE EXCEPTION 'retained operating fee policy conflict';END IF;
 ELSE
  IF c?'operatingFee' OR fee_wire IS NULL OR octet_length(fee_wire)>8192 THEN RAISE EXCEPTION 'source policy capture unavailable';END IF;
  fee:=fee_wire::jsonb;
  IF fee-'sourcePolicy'<>'{}'::jsonb OR jsonb_typeof(fee->'sourcePolicy') IS DISTINCT FROM 'object'
   OR (fee#>>'{sourcePolicy,selector}')::jsonb IS DISTINCT FROM jsonb_build_object('sourceId',c->>'sourceId','identity',NULL)
   OR fee#>'{sourcePolicy,policySnapshot}' IS DISTINCT FROM jsonb_build_object('sourceId',c->>'sourceId','receipt',coalesce(c->'sourceClaim','null'::jsonb),'kind',c->>'kind')
  THEN RAISE EXCEPTION 'hosted source policy context differs';END IF;
  PERFORM keryx_storage.source_claim_purchase_policy('assert',fee#>>'{sourcePolicy,selector}',fee->'sourcePolicy');
 END IF;
 IF EXISTS(SELECT 1 FROM public.hosted_treasury_authorizations a WHERE a.nonce=chosen_nonce) OR EXISTS(SELECT 1 FROM public.payment_events e WHERE e.authorization_id=chosen_nonce) THEN RAISE EXCEPTION 'hosted nonce already admitted';END IF;
 totals:=keryx_storage.hosted_totals(p->>'signer',NULL);supplied:=accounting_wire::jsonb;
 IF supplied IS DISTINCT FROM totals THEN RAISE EXCEPTION 'hosted accounting changed';END IF;
 SELECT coalesce(sum(amount_micro),0) INTO query_amount FROM public.hosted_treasury_authorizations a WHERE a.signer=p->>'signer' AND a.query_id=c->>'queryId';
 SELECT a.original::jsonb#>>'{context,queryBudgetMicroUsdc}' INTO first_budget FROM public.hosted_treasury_authorizations a WHERE a.signer=p->>'signer' AND a.query_id=c->>'queryId' LIMIT 1;
 IF FOUND AND first_budget IS DISTINCT FROM c->>'queryBudgetMicroUsdc' THEN RAISE EXCEPTION 'original query budget changed';END IF;
 IF role_name='private' THEN
  SELECT e.worker_id,i.payer,i.data INTO job FROM public.private_research_executions e JOIN public.private_research_intents i ON i.id=e.id WHERE e.id=c#>>'{privateJob,id}'
   AND NOT EXISTS(SELECT 1 FROM public.private_research_results r WHERE r.id=e.id) AND NOT EXISTS(SELECT 1 FROM public.private_research_interruptions x WHERE x.id=e.id);
  IF NOT FOUND OR c->>'queryId' IS DISTINCT FROM c#>>'{privateJob,id}' OR job.worker_id IS DISTINCT FROM c#>>'{privateJob,workerId}' OR job.payer IS DISTINCT FROM c#>>'{privateJob,owner}'
   OR (job.data::jsonb#>>'{submission,request,budget}')::double precision<(c->>'queryBudgetMicroUsdc')::double precision/1000000 THEN RAISE EXCEPTION 'private original execution unavailable';END IF;
 END IF;
 IF (totals->>'retainedMicroUsdc')::numeric+amount>(p->>'lifetimeCapMicroUsdc')::numeric OR query_amount+amount>(c->>'queryBudgetMicroUsdc')::numeric
  OR (totals->>'retainedMicroUsdc')::numeric-(totals->>'confirmedMicroUsdc')::numeric+amount>available_wire::numeric THEN RAISE EXCEPTION 'hosted capacity refused';END IF;
 INSERT INTO public.hosted_treasury_authorizations(nonce,policy_digest,signer,query_id,amount_micro,original) VALUES(chosen_nonce,storage_hosted_admit_authorization.policy_digest,p->>'signer',c->>'queryId',amount,original_wire);
 IF role_name='public' THEN
  INSERT INTO public.payment_events(id,created_at,kind,query_id,source_id,source_name,payer,payee,amount_usdc,network,settled,settlement_status,authorization_id,authorization_expires_at,item_id,origin,authorization_phase)
   VALUES('x402:'||chosen_nonce,clock_timestamp(),c->>'kind',c->>'queryId',c->>'sourceId',CASE WHEN c->>'kind'='operating-fee' THEN 'Keryx operating fee' ELSE c->>'sourceId' END,p->>'signer',lower(m->>'to'),amount::double precision/1000000,'eip155:5042',false,'pending',chosen_nonce,to_timestamp(before::double precision),c->>'itemId','engine','prepared');
 END IF;
 PERFORM keryx_storage.leave_operation();RETURN to_jsonb(chosen_nonce);
END;$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_hosted_admit_authorization(jsonb,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role,keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_hosted_admit_authorization(jsonb,text,text,text,text,text,text,text) TO keryx_app,keryx_reader;
RESET ROLE;
