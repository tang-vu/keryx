-- Fixed Source corpus validation, invoked by the parent group under its data lock.
-- No app/reader grant, caller SQL, table selector, RPC or custody capability.
SET ROLE keryx_owner;
CREATE FUNCTION keryx_storage.registration_sponsor_corpus(meta jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE policy_rows integer;entry_rows integer;item jsonb;record_key text;raw text;stored json;part json;root jsonb;other_root jsonb;field text;current_key text;
 policies jsonb:='{}'::jsonb;entries jsonb:='{}'::jsonb;p jsonb;original_root jsonb;current_root jsonb;active_count integer:=0;txs text[]:=ARRAY[]::text[];nonces text[]:=ARRAY[]::text[];nonce_key text;claims jsonb:='{}'::jsonb;source_claim json;proof_root jsonb;
BEGIN
 IF meta-'policies'-'entries'-'claims'-'requested'-'signedTransactionHash'<>'{}'::jsonb OR jsonb_typeof(meta->'policies') IS DISTINCT FROM 'array' OR jsonb_typeof(meta->'entries') IS DISTINCT FROM 'array' OR jsonb_typeof(meta->'claims') IS DISTINCT FROM 'array' OR jsonb_array_length(meta->'claims')>1 THEN RAISE EXCEPTION 'parser metadata refused';END IF;
 policy_rows:=jsonb_array_length(meta->'policies');entry_rows:=jsonb_array_length(meta->'entries');
 IF policy_rows>1000 OR entry_rows>1000 OR policy_rows<>(SELECT count(*) FROM public.sync_state WHERE sync_state.key LIKE 'keryx:registration-sponsor:v1:policy:%') OR entry_rows<>(SELECT count(*) FROM public.sync_state WHERE sync_state.key LIKE 'keryx:registration-sponsor:v1:row:%') THEN RAISE EXCEPTION 'incomplete corpus';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(meta->'policies') LOOP
  record_key:=item->>'key';SELECT value INTO raw FROM public.sync_state WHERE sync_state.key=record_key;
  IF record_key IS NULL OR record_key<>'keryx:registration-sponsor:v1:policy:'||(item->>'cohortDigest') OR raw IS NULL OR item->>'rawSha256' IS DISTINCT FROM encode(sha256(convert_to(raw,'UTF8')),'hex') OR policies?(item->>'policyDigest') THEN RAISE EXCEPTION 'policy metadata changed';END IF;
  p:=(raw::json->'policy')::jsonb;root:=(item->>'policyWire')::jsonb;
  p:=p||jsonb_build_object('registryAddress',lower(p->>'registryAddress'),'registryCodeHash',lower(p->>'registryCodeHash'),'sponsorAddress',lower(p->>'sponsorAddress'));
  IF p?'allowlistedCreators' THEN p:=jsonb_set(p,'{allowlistedCreators}',coalesce((SELECT jsonb_agg(lower(value)) FROM jsonb_array_elements_text(p->'allowlistedCreators')),'[]'::jsonb));END IF;
  IF p IS DISTINCT FROM root OR lower(raw::json->>'cohortDigest') IS DISTINCT FROM item->>'cohortDigest' OR lower(raw::json->>'policyDigest') IS DISTINCT FROM item->>'policyDigest' THEN RAISE EXCEPTION 'policy parser differs';END IF;
  policies:=policies||jsonb_build_object(item->>'policyDigest',item);
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(meta->'entries') LOOP
  record_key:=item->>'key';SELECT value INTO raw FROM public.sync_state WHERE sync_state.key=record_key;stored:=raw::json;
  IF record_key IS NULL OR record_key<>'keryx:registration-sponsor:v1:row:'||(item#>>'{originalRoot,id}') OR raw IS NULL OR item->>'rawSha256' IS DISTINCT FROM encode(sha256(convert_to(raw,'UTF8')),'hex') OR entries?record_key OR item->>'originalWire' IS DISTINCT FROM(stored->'original')::text THEN RAISE EXCEPTION 'original metadata changed';END IF;
  FOREACH field IN ARRAY ARRAY['original','current'] LOOP
   part:=stored->field;SELECT coalesce(jsonb_object_agg(j.key,j.value::jsonb),'{}'::jsonb) INTO root FROM json_each(part) j WHERE j.key NOT IN('params','sourceId');
   FOREACH current_key IN ARRAY ARRAY['id','policyDigest','creator','onchainId','registryAddress','registryCodeHash','relayer','transactionHash'] LOOP
    IF root?current_key THEN root:=jsonb_set(root,ARRAY[current_key],to_jsonb(lower(root->>current_key)));END IF;
   END LOOP;
   other_root:=item->(field||'Root');IF root IS DISTINCT FROM other_root-'paramsWire'-'sourceIdWire' THEN RAISE EXCEPTION 'root parser differs';END IF;
  END LOOP;
  original_root:=item->'originalRoot';current_root:=item->'currentRoot';p:=(policies->(original_root->>'policyDigest')->>'policyWire')::jsonb;
  IF p IS NULL OR item->>'computedIntentId' IS DISTINCT FROM original_root->>'id' OR item->>'computedOnchainId' IS DISTINCT FROM original_root->>'onchainId'
   OR original_root->>'state' IS DISTINCT FROM 'prepared' OR original_root->'createdAt' IS DISTINCT FROM original_root->'updatedAt'
   OR original_root-ARRAY['state','updatedAt','transactionHash','transactionNonce','actualGasWei','expiredResolution'] IS DISTINCT FROM current_root-ARRAY['state','updatedAt','transactionHash','transactionNonce','actualGasWei','expiredResolution']
   OR(current_root->>'updatedAt')::numeric<(original_root->>'updatedAt')::numeric OR(item->>'currentWire')::json->'params' IS NULL
   OR((item->>'currentWire')::json->'params')::text IS DISTINCT FROM current_root->>'paramsWire' OR((item->>'currentWire')::json->'sourceId')::text IS DISTINCT FROM current_root->>'sourceIdWire'
   OR((item->>'currentWire')::json->>'id') IS DISTINCT FROM current_root->>'id' OR current_root->>'reservedWei' IS DISTINCT FROM p->>'maxTransactionWei'
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
   root:=(item->>'executionWire')::jsonb;IF root IS DISTINCT FROM(stored->'execution')::jsonb OR root-'creatorSignature'-'signedTransaction'<>'{}'::jsonb OR current_root->>'state' IN('prepared','expired') OR current_root->>'state'='signing' AND root?'signedTransaction' OR current_root->>'state' IN('submitted','confirmed','reverted') AND(item->>'computedSignedTransactionHash' IS DISTINCT FROM current_root->>'transactionHash') THEN RAISE EXCEPTION 'execution differs';END IF;
  ELSIF stored->'execution' IS NOT NULL THEN RAISE EXCEPTION 'omitted execution';END IF;
  entries:=entries||jsonb_build_object(record_key,item);
 END LOOP;
 IF active_count>1 THEN RAISE EXCEPTION 'concurrent originals';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(meta->'claims') LOOP
  record_key:=item->>'key';SELECT value INTO raw FROM public.sync_state WHERE sync_state.key=record_key;
  IF record_key IS NULL OR record_key !~ '^keryx:source-claims:v1:claim:[a-f0-9]{64}$' OR raw IS NULL OR item->>'rawSha256' IS DISTINCT FROM encode(sha256(convert_to(raw,'UTF8')),'hex') OR claims?record_key THEN RAISE EXCEPTION 'claim metadata changed';END IF;
  IF item->'claimWire'='null'::jsonb THEN claims:=claims||jsonb_build_object(record_key,jsonb_build_object('root',NULL,'sourceIdWire',NULL));
  ELSE
   source_claim:=raw::json;part:=(item->>'claimWire')::json;SELECT jsonb_object_agg(j.key,j.value::jsonb) INTO proof_root FROM json_each(part) j WHERE j.key IN('id','ownerWallet','revision','canonicalUrl','rssUrl','onchainId','registryAddress','network','deploymentOrigin','verifiedAt','proofMethod');
   FOREACH field IN ARRAY ARRAY['id','ownerWallet','revision','canonicalUrl','rssUrl','onchainId','registryAddress','network','deploymentOrigin','verifiedAt','proofMethod'] LOOP
    root:=(source_claim->field)::jsonb;IF field IN('ownerWallet','registryAddress') AND root IS NOT NULL THEN root:=to_jsonb(lower(source_claim->>field));END IF;IF root IS DISTINCT FROM proof_root->field THEN RAISE EXCEPTION 'proof parser differs';END IF;
   END LOOP;
   claims:=claims||jsonb_build_object(record_key,jsonb_build_object('root',proof_root,'sourceIdWire',(part->'linkedSourceId')::text));
  END IF;
 END LOOP;
 RETURN jsonb_build_object('policies',policies,'entries',entries,'claims',claims,'policyCount',policy_rows,'entryCount',entry_rows,'activeCount',active_count,'transactions',txs,'nonces',nonces);
END;$$;
REVOKE ALL ON FUNCTION keryx_storage.registration_sponsor_corpus(jsonb) FROM PUBLIC,anon,authenticated,service_role,keryx_app,keryx_reader;
RESET ROLE;
