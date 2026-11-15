-- Fixed Source corpus validation, invoked by the parent group under its data lock.
-- No app/reader grant, caller SQL, table selector, RPC or custody capability.
SET ROLE keryx_owner;
CREATE FUNCTION keryx_storage.registration_sponsor_corpus(meta jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE policy_rows integer;entry_rows integer;item jsonb;record_key text;raw text;stored jsonb;part jsonb;root jsonb;other_root jsonb;field text;current_key text;
 policies jsonb:='{}'::jsonb;entries jsonb:='{}'::jsonb;p jsonb;original_root jsonb;current_root jsonb;active_count integer:=0;txs text[]:=ARRAY[]::text[];nonces text[]:=ARRAY[]::text[];nonce_key text;claims jsonb:='{}'::jsonb;source_claim jsonb;proof_root jsonb;
 kind text;allowed text[];cell jsonb;params_root jsonb;authors_wire text;params_wire text;source_wire text;content_wire text;tags_wire text;amount numeric;points integer;points_total integer;wallet text;
BEGIN
 -- Only the public router chooses a fixed kind. Its untrusted metadata is
 -- nested under kind=corpus, so a caller cannot select a parser-only bypass.
 kind:=meta->>'kind';
 IF jsonb_typeof(meta) IS DISTINCT FROM 'object' OR kind IS NULL OR kind NOT IN('corpus','journal','row') THEN RAISE EXCEPTION 'corpus kind refused';END IF;
 IF kind IN('journal','row') THEN
  IF meta-'kind'-'wire'<>'{}'::jsonb OR jsonb_typeof(meta->'wire') IS DISTINCT FROM 'string' OR octet_length(meta->>'wire')>4000000 THEN RAISE EXCEPTION 'parser wire refused';END IF;
  part:=keryx_storage.source_scalar_text(meta->>'wire','tokens');
  IF kind='journal' THEN
   IF NOT(part?'original' AND part?'current') OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(part->'_rootKeys') k WHERE k NOT IN('6f726967696e616c','63757272656e74','657865637574696f6e')) THEN RAISE EXCEPTION 'journal root refused';END IF;
   RETURN part-'_rootKeys';
  END IF;
  allowed:=ARRAY['id','policyDigest','creator','canonicalUrl','rssUrl','replacesRequestId','claimId','claimRevision','sourceId','onchainId','registryAddress','registryCodeHash','relayer','chainId','params','nonce','deadline','createdAt','updatedAt','reservedWei','state','transactionHash','transactionNonce','actualGasWei','expiredResolution'];
  IF NOT(part?&ARRAY['id','policyDigest','creator','canonicalUrl','rssUrl','claimId','claimRevision','sourceId','onchainId','registryAddress','registryCodeHash','relayer','chainId','params','nonce','deadline','createdAt','updatedAt','reservedWei','state']) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(part->'_rootKeys') k WHERE NOT EXISTS(SELECT 1 FROM unnest(allowed) a WHERE encode(convert_to(a,'UTF8'),'hex')=k)) THEN RAISE EXCEPTION 'row root refused';END IF;
  root:='{}'::jsonb;
  FOREACH field IN ARRAY allowed LOOP
   CONTINUE WHEN field IN('params','sourceId') OR NOT(part?field);
   -- These fixed scalar fields contain no Source-valid NUL/lone surrogate.
   -- Unsafe params/sourceId never enter a JSONB cast or a PG JSON getter.
   cell:=(part->>field)::jsonb;
   IF field IN('claimRevision','chainId','deadline','createdAt','updatedAt','transactionNonce') THEN
    IF jsonb_typeof(cell) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'row numeric refused';END IF;
    amount:=(cell#>>'{}')::numeric;
    IF trunc(amount)<>amount OR amount<(CASE WHEN field='transactionNonce' THEN 0 ELSE 1 END) OR amount>9007199254740991 OR field IN('createdAt','updatedAt') AND amount>8640000000000000 OR field='deadline' AND amount>9007199254740 OR field='chainId' AND amount NOT IN(5042,5042002) THEN RAISE EXCEPTION 'row numeric range refused';END IF;
   ELSIF field='expiredResolution' THEN
    IF cell IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'row resolution refused';END IF;
   ELSE
    IF jsonb_typeof(cell) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'row string refused';END IF;
    raw:=cell#>>'{}';
    IF field IN('id','policyDigest','onchainId','registryCodeHash','transactionHash','replacesRequestId') THEN
     IF raw !~ '^0x[0-9a-fA-F]{64}$' THEN RAISE EXCEPTION 'row hash refused';END IF;cell:=to_jsonb(lower(raw));
    ELSIF field IN('creator','registryAddress','relayer') THEN
     IF raw !~ '^0x[0-9a-fA-F]{40}$' OR raw ~ '^0x0{40}$' THEN RAISE EXCEPTION 'row address refused';END IF;cell:=to_jsonb(lower(raw));
    ELSIF field='claimId' AND raw !~ '^[0-9a-f]{64}$' OR field='state' AND raw NOT IN('prepared','signing','submitted','confirmed','reverted','expired') THEN RAISE EXCEPTION 'row identity refused';
    ELSIF field IN('nonce','reservedWei','actualGasWei') THEN
     IF raw !~ '^(0|[1-9][0-9]{0,77})$' OR raw::numeric>=power(2::numeric,256) OR field='reservedWei' AND raw::numeric=0 THEN RAISE EXCEPTION 'row uint refused';END IF;
    END IF;
   END IF;
   root:=root||jsonb_build_object(field,cell);
  END LOOP;
  cell:=keryx_storage.source_scalar_text(part->>'sourceId','js-string');
  IF cell->'utf16Hex'='null'::jsonb OR length(cell->>'utf16Hex') NOT BETWEEN 4 AND 1024 THEN RAISE EXCEPTION 'Source sourceId refused';END IF;source_wire:=cell->>'wire';
  -- Validate the distinct Source scalar-binding derivative too. The journal
  -- stores sourceId inside JSON, so identity remains exact UTF-16 and must not
  -- use replacement-normalized SQLite scalar bytes.
  PERFORM keryx_storage.source_scalar_text(part->>'sourceId','scalar');
  part:=keryx_storage.source_scalar_text(part->>'params','tokens');
  allowed:=ARRAY['urlHash','payoutWallet','authors','fetchPriceUsdc6','contentCid','tags'];
  IF NOT(part?&allowed) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(part->'_rootKeys') k WHERE NOT EXISTS(SELECT 1 FROM unnest(allowed) a WHERE encode(convert_to(a,'UTF8'),'hex')=k)) THEN RAISE EXCEPTION 'params root refused';END IF;
  params_root:=jsonb_build_object('urlHash',(part->>'urlHash')::jsonb,'payoutWallet',(part->>'payoutWallet')::jsonb,'fetchPriceUsdc6',(part->>'fetchPriceUsdc6')::jsonb);
  IF jsonb_typeof(params_root->'urlHash') IS DISTINCT FROM 'string' OR params_root->>'urlHash' !~ '^0x[0-9a-fA-F]{64}$' OR jsonb_typeof(params_root->'payoutWallet') IS DISTINCT FROM 'string' OR params_root->>'payoutWallet' !~ '^0x[0-9a-fA-F]{40}$' OR params_root->>'payoutWallet' ~ '^0x0{40}$' OR jsonb_typeof(params_root->'fetchPriceUsdc6') IS DISTINCT FROM 'string' OR params_root->>'fetchPriceUsdc6' !~ '^(0|[1-9][0-9]{0,19})$' OR(params_root->>'fetchPriceUsdc6')::numeric>=18446744073709551616 THEN RAISE EXCEPTION 'params scalar refused';END IF;
  cell:=(part->>'authors')::jsonb;
  IF jsonb_typeof(cell) IS DISTINCT FROM 'array' OR jsonb_array_length(cell) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'authors refused';END IF;
  authors_wire:='';points_total:=0;
  FOR item IN SELECT value FROM jsonb_array_elements(cell) LOOP
   IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item-'wallet'-'basisPoints'<>'{}'::jsonb OR jsonb_typeof(item->'wallet') IS DISTINCT FROM 'string' OR item->>'wallet' !~ '^0x[0-9a-fA-F]{40}$' OR item->>'wallet' ~ '^0x0{40}$' OR jsonb_typeof(item->'basisPoints') IS DISTINCT FROM 'number' OR(item->>'basisPoints')::numeric<>trunc((item->>'basisPoints')::numeric) OR(item->>'basisPoints')::numeric NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'author refused';END IF;
   points:=(item->>'basisPoints')::integer;points_total:=points_total+points;wallet:=lower(item->>'wallet');authors_wire:=authors_wire||CASE WHEN authors_wire='' THEN '' ELSE ',' END||'{"basisPoints":'||points::text||',"wallet":'||to_json(wallet)::text||'}';
  END LOOP;
  IF points_total<>10000 THEN RAISE EXCEPTION 'author split refused';END IF;
  cell:=keryx_storage.source_scalar_text(part->>'contentCid','js-string');content_wire:=cell->>'wire';
  IF cell->'utf16Hex'='null'::jsonb OR length(keryx_storage.source_scalar_text(part->>'contentCid','scalar')->>'sourceHex')>256 THEN RAISE EXCEPTION 'contentCid refused';END IF;
  cell:=keryx_storage.source_scalar_text(part->>'tags','js-string');tags_wire:=cell->>'wire';
  IF cell->'utf16Hex'='null'::jsonb OR length(keryx_storage.source_scalar_text(part->>'tags','scalar')->>'sourceHex')>512 THEN RAISE EXCEPTION 'tags refused';END IF;
  params_wire:='{"authors":['||authors_wire||'],"contentCid":'||content_wire||',"fetchPriceUsdc6":'||to_json(params_root->>'fetchPriceUsdc6')::text||',"payoutWallet":'||to_json(lower(params_root->>'payoutWallet'))::text||',"tags":'||tags_wire||',"urlHash":'||to_json(lower(params_root->>'urlHash'))::text||'}';
  RETURN root||jsonb_build_object('sourceIdWire',source_wire,'paramsWire',params_wire);
 END IF;
 IF meta-'kind'-'metadata'<>'{}'::jsonb OR jsonb_typeof(meta->'metadata') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'corpus envelope refused';END IF;meta:=meta->'metadata';
 IF meta-'policies'-'entries'-'claims'-'requested'-'signedTransactionHash'<>'{}'::jsonb OR jsonb_typeof(meta->'policies') IS DISTINCT FROM 'array' OR jsonb_typeof(meta->'entries') IS DISTINCT FROM 'array' OR jsonb_typeof(meta->'claims') IS DISTINCT FROM 'array' OR jsonb_array_length(meta->'claims')>1 THEN RAISE EXCEPTION 'parser metadata refused';END IF;
 policy_rows:=jsonb_array_length(meta->'policies');entry_rows:=jsonb_array_length(meta->'entries');
 IF policy_rows>1000 OR entry_rows>1000 OR policy_rows<>(SELECT count(*) FROM public.sync_state WHERE sync_state.key LIKE 'keryx:registration-sponsor:v1:policy:%') OR entry_rows<>(SELECT count(*) FROM public.sync_state WHERE sync_state.key LIKE 'keryx:registration-sponsor:v1:row:%') THEN RAISE EXCEPTION 'incomplete corpus';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(meta->'policies') LOOP
  record_key:=item->>'key';SELECT value INTO raw FROM public.sync_state WHERE sync_state.key=record_key;
  IF record_key IS NULL OR record_key<>'keryx:registration-sponsor:v1:policy:'||(item->>'cohortDigest') OR raw IS NULL OR item->>'rawSha256' IS DISTINCT FROM encode(sha256(convert_to(raw,'UTF8')),'hex') OR policies?(item->>'policyDigest') THEN RAISE EXCEPTION 'policy metadata changed';END IF;
  stored:=keryx_storage.source_scalar_text(raw,'tokens');
  IF NOT(stored?&ARRAY['policy','cohortDigest','policyDigest']) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(stored->'_rootKeys') k WHERE k NOT IN('706f6c696379','636f686f7274446967657374','706f6c696379446967657374')) THEN RAISE EXCEPTION 'policy root refused';END IF;
  p:=(stored->>'policy')::jsonb;root:=(item->>'policyWire')::jsonb;
  p:=p||jsonb_build_object('registryAddress',lower(p->>'registryAddress'),'registryCodeHash',lower(p->>'registryCodeHash'),'sponsorAddress',lower(p->>'sponsorAddress'));
  IF p?'allowlistedCreators' THEN p:=jsonb_set(p,'{allowlistedCreators}',coalesce((SELECT jsonb_agg(lower(value)) FROM jsonb_array_elements_text(p->'allowlistedCreators')),'[]'::jsonb));END IF;
  IF p IS DISTINCT FROM root OR lower((stored->>'cohortDigest')::jsonb#>>'{}') IS DISTINCT FROM item->>'cohortDigest' OR lower((stored->>'policyDigest')::jsonb#>>'{}') IS DISTINCT FROM item->>'policyDigest' THEN RAISE EXCEPTION 'policy parser differs';END IF;
  policies:=policies||jsonb_build_object(item->>'policyDigest',item);
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(meta->'entries') LOOP
  record_key:=item->>'key';SELECT value INTO raw FROM public.sync_state WHERE sync_state.key=record_key;stored:=keryx_storage.registration_sponsor_corpus(jsonb_build_object('kind','journal','wire',raw));
  IF record_key IS NULL OR record_key<>'keryx:registration-sponsor:v1:row:'||(item#>>'{originalRoot,id}') OR raw IS NULL OR item->>'rawSha256' IS DISTINCT FROM encode(sha256(convert_to(raw,'UTF8')),'hex') OR entries?record_key OR item->>'originalWire' IS DISTINCT FROM stored->>'original' THEN RAISE EXCEPTION 'original metadata changed';END IF;
  FOREACH field IN ARRAY ARRAY['original','current'] LOOP
   root:=keryx_storage.registration_sponsor_corpus(jsonb_build_object('kind','row','wire',stored->>field));
   other_root:=item->(field||'Root');IF root IS DISTINCT FROM other_root THEN RAISE EXCEPTION 'root parser differs';END IF;
  END LOOP;
  original_root:=item->'originalRoot';current_root:=item->'currentRoot';p:=(policies->(original_root->>'policyDigest')->>'policyWire')::jsonb;
  IF p IS NULL OR item->>'computedIntentId' IS DISTINCT FROM original_root->>'id' OR item->>'computedOnchainId' IS DISTINCT FROM original_root->>'onchainId'
   OR original_root->>'state' IS DISTINCT FROM 'prepared' OR original_root->'createdAt' IS DISTINCT FROM original_root->'updatedAt'
   OR original_root-ARRAY['state','updatedAt','transactionHash','transactionNonce','actualGasWei','expiredResolution'] IS DISTINCT FROM current_root-ARRAY['state','updatedAt','transactionHash','transactionNonce','actualGasWei','expiredResolution']
   OR(current_root->>'updatedAt')::numeric<(original_root->>'updatedAt')::numeric
   OR keryx_storage.registration_sponsor_corpus(jsonb_build_object('kind','row','wire',item->>'currentWire')) IS DISTINCT FROM current_root OR current_root->>'reservedWei' IS DISTINCT FROM p->>'maxTransactionWei'
   OR current_root->>'registryAddress' IS DISTINCT FROM p->>'registryAddress' OR current_root->>'registryCodeHash' IS DISTINCT FROM p->>'registryCodeHash' OR current_root->>'relayer' IS DISTINCT FROM p->>'sponsorAddress'
   OR'eip155:'||(current_root->>'chainId') IS DISTINCT FROM p->>'network' THEN RAISE EXCEPTION 'immutable or policy binding differs';END IF;
  IF current_root->>'state' IS NULL OR current_root->>'state' NOT IN('prepared','signing','submitted','confirmed','reverted','expired')
   OR(current_root->>'createdAt')::numeric<=0 OR(current_root->>'createdAt')::numeric>=(current_root->>'deadline')::numeric*1000
   OR current_root->>'state' IN('prepared','expired') AND(current_root?'transactionNonce' OR current_root?'transactionHash' OR current_root?'actualGasWei')
   OR current_root->>'state'='signing' AND(NOT(current_root?'transactionNonce') OR current_root?'transactionHash' OR current_root?'actualGasWei')
   OR current_root->>'state'='submitted' AND(NOT(current_root?'transactionNonce' AND current_root?'transactionHash') OR current_root?'actualGasWei')
   OR current_root->>'state' IN('confirmed','reverted') AND(NOT(current_root?'transactionNonce' AND current_root?'transactionHash' AND current_root?'actualGasWei') OR(current_root->>'actualGasWei')::numeric>(current_root->>'reservedWei')::numeric)
   OR current_root->>'state'='expired' AND(current_root->>'updatedAt')::numeric<=(current_root->>'deadline')::numeric*1000
   OR current_root?'expiredResolution' AND current_root->>'state' NOT IN('signing','submitted','confirmed','reverted') THEN RAISE EXCEPTION 'original transaction state invalid';END IF;
  IF p->>'protocol' NOT IN('keryx-registration-sponsor-v1','keryx-registration-sponsor-v2')
   OR p->>'protocol'='keryx-registration-sponsor-v1' AND((current_root->>'deadline')::numeric*1000>(p->>'expiresAt')::numeric OR NOT(p->'allowlistedCreators'?(current_root->>'creator') OR p->'allowlistedPublisherOrigins'?(item->>'publisherOrigin')))
   OR p->>'protocol'='keryx-registration-sponsor-v2' AND(current_root->>'deadline')::numeric*1000>(current_root->>'createdAt')::numeric+600000 THEN RAISE EXCEPTION 'original policy eligibility invalid';END IF;
  IF current_root->>'state' IN('signing','submitted') THEN active_count:=active_count+1;END IF;
  IF current_root?'transactionHash' THEN IF current_root->>'transactionHash'=ANY(txs) THEN RAISE EXCEPTION 'duplicate transaction';END IF;txs:=array_append(txs,current_root->>'transactionHash');END IF;
  IF current_root?'transactionNonce' THEN nonce_key:=current_root->>'chainId'||':'||(current_root->>'relayer')||':'||(current_root->>'transactionNonce');IF nonce_key=ANY(nonces) THEN RAISE EXCEPTION 'duplicate nonce';END IF;nonces:=array_append(nonces,nonce_key);END IF;
  IF item->'executionWire'<>'null'::jsonb THEN
   root:=(item->>'executionWire')::jsonb;IF root IS DISTINCT FROM(stored->>'execution')::jsonb OR root-'creatorSignature'-'signedTransaction'<>'{}'::jsonb OR current_root->>'state' IN('prepared','expired') OR current_root->>'state'='signing' AND root?'signedTransaction' OR current_root->>'state' IN('submitted','confirmed','reverted') AND(item->>'computedSignedTransactionHash' IS DISTINCT FROM current_root->>'transactionHash') THEN RAISE EXCEPTION 'execution differs';END IF;
  ELSIF stored->'execution' IS NOT NULL THEN RAISE EXCEPTION 'omitted execution';END IF;
  entries:=entries||jsonb_build_object(record_key,item);
 END LOOP;
 IF active_count>1 THEN RAISE EXCEPTION 'concurrent originals';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(meta->'claims') LOOP
  record_key:=item->>'key';SELECT value INTO raw FROM public.sync_state WHERE sync_state.key=record_key;
  IF record_key IS NULL OR record_key !~ '^keryx:source-claims:v1:claim:[a-f0-9]{64}$' OR raw IS NULL OR item->>'rawSha256' IS DISTINCT FROM encode(sha256(convert_to(raw,'UTF8')),'hex') OR claims?record_key THEN RAISE EXCEPTION 'claim metadata changed';END IF;
  IF item->'claimWire'='null'::jsonb THEN claims:=claims||jsonb_build_object(record_key,jsonb_build_object('root',NULL,'sourceIdWire',NULL));
  ELSE
   source_claim:=keryx_storage.source_scalar_text(raw,'tokens');part:=keryx_storage.source_scalar_text(item->>'claimWire','tokens');proof_root:='{}'::jsonb;
   allowed:=ARRAY['id','canonicalUrl','rssUrl','publicReferenceId','ownerWallet','deploymentOrigin','network','verifiedAt','revision','effectiveAt','mode','linkedSourceId','onchainId','registryAddress','distributionPermission','proofMethod'];
   IF NOT(source_claim?&ARRAY['id','canonicalUrl','ownerWallet','deploymentOrigin','network','verifiedAt','revision','effectiveAt','mode','distributionPermission']) OR NOT(part?&ARRAY['id','canonicalUrl','ownerWallet','deploymentOrigin','network','verifiedAt','revision','effectiveAt','mode','distributionPermission']) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(source_claim->'_rootKeys') k WHERE NOT EXISTS(SELECT 1 FROM unnest(allowed) a WHERE encode(convert_to(a,'UTF8'),'hex')=k)) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(part->'_rootKeys') k WHERE NOT EXISTS(SELECT 1 FROM unnest(allowed) a WHERE encode(convert_to(a,'UTF8'),'hex')=k)) THEN RAISE EXCEPTION 'proof root refused';END IF;
   FOREACH field IN ARRAY allowed LOOP
    IF field IN('linkedSourceId','publicReferenceId') THEN
     IF (source_claim?field) IS DISTINCT FROM (part?field) OR source_claim?field AND keryx_storage.source_scalar_text(source_claim->>field,'js-string') IS DISTINCT FROM keryx_storage.source_scalar_text(part->>field,'js-string') THEN RAISE EXCEPTION 'proof Source string differs';END IF;
     CONTINUE;
    END IF;
    root:=(source_claim->>field)::jsonb;other_root:=(part->>field)::jsonb;IF field IN('ownerWallet','registryAddress') AND root IS NOT NULL THEN root:=to_jsonb(lower(root#>>'{}'));END IF;IF root IS DISTINCT FROM other_root THEN RAISE EXCEPTION 'proof parser differs';END IF;
    IF field IN('id','ownerWallet','revision','canonicalUrl','rssUrl','onchainId','registryAddress','network','deploymentOrigin','verifiedAt','proofMethod') AND part?field THEN proof_root:=proof_root||jsonb_build_object(field,other_root);END IF;
   END LOOP;
   claims:=claims||jsonb_build_object(record_key,jsonb_build_object('root',proof_root,'sourceIdWire',CASE WHEN part?'linkedSourceId' THEN keryx_storage.source_scalar_text(part->>'linkedSourceId','js-string')->>'wire' END));
  END IF;
 END LOOP;
 RETURN jsonb_build_object('policies',policies,'entries',entries,'claims',claims,'policyCount',policy_rows,'entryCount',entry_rows,'activeCount',active_count,'transactions',txs,'nonces',nonces);
END;$$;
REVOKE ALL ON FUNCTION keryx_storage.registration_sponsor_corpus(jsonb) FROM PUBLIC,anon,authenticated,service_role,keryx_app,keryx_reader;
RESET ROLE;
