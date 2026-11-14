-- New originals, never custody, funding, signing, vendor execution or a retry.
-- Managed source claims intentionally remain closed for separate qualification.
SET ROLE keryx_owner;
CREATE FUNCTION keryx_storage.hosted_retained_link(value text,source_id text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $$
DECLARE original json;linked json;
BEGIN
 -- JSON retains escape bytes that JSONB cannot represent. An unrelated escaped
 -- NUL/surrogate must never hide a retained linked-source marker. Only malformed
 -- JSON is ignored, as in Source's json_valid predicate; decoding ambiguity holds.
 BEGIN original:=value::json;EXCEPTION WHEN invalid_text_representation THEN RETURN false;END;
 linked:=original->'linkedSourceId';
 IF linked IS NULL OR json_typeof(linked)='null' THEN linked:=original->'claim'->'linkedSourceId';END IF;
 IF linked IS NULL THEN RETURN false;END IF;
 IF json_typeof(linked)='string' THEN RETURN (linked#>>'{}')=source_id;END IF;
 IF json_typeof(linked) IN('array','object') THEN RAISE EXCEPTION 'retained managed marker unavailable';END IF;
 RETURN false;
END;$$;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('hosted_admit_authorization',ARRAY['hosted_treasury_policies','hosted_treasury_authorizations','payment_events','sync_state','sources','private_research_executions','private_research_intents','private_research_results','private_research_interruptions','browser_journal_writer'],true,false);
CREATE FUNCTION public.storage_hosted_admit_authorization(expected jsonb,digest text,policy_wire text,policy_digest text,original_wire text,accounting_wire text,available_wire text,fee_wire text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p jsonb;c jsonb;payload jsonb;m jsonb;types jsonb;domain jsonb;totals jsonb;supplied jsonb;fee jsonb;fee_context jsonb;admitted record;job record;
 chosen_nonce text;amount numeric;query_amount numeric;first_budget text;before numeric;after numeric;now_seconds bigint:=floor(extract(epoch FROM clock_timestamp()));
 field text;integer_value numeric;parsed_uint numeric[]:=ARRAY[]::numeric[];url text;claim_id text;fee_key text;retained_fee text;role_name text;
BEGIN
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
  IF fee_wire IS NOT NULL OR c?'sourceClaim' OR c?'operatingFee'
   OR EXISTS(SELECT 1 FROM public.sync_state WHERE key IN(
    'keryx:source-claims:v1:marker:'||encode(sha256(convert_to(c->>'sourceId','UTF8')),'hex'),
    'keryx:source-claims:v1:source:'||encode(sha256(convert_to(c->>'sourceId','UTF8')),'hex')))
   OR EXISTS(SELECT 1 FROM public.sync_state WHERE (key LIKE 'keryx:source-claims:v1:claim:%' OR key LIKE 'keryx:source-claims:v1:history:%') AND keryx_storage.hosted_retained_link(value,c->>'sourceId'))
   OR EXISTS(SELECT 1 FROM public.sources s WHERE s.id=c->>'sourceId' AND coalesce(to_jsonb(s)->>'source_claim_id','')<>'')
  THEN RAISE EXCEPTION 'native managed source admission unavailable';END IF;
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
GRANT EXECUTE ON FUNCTION public.storage_hosted_admit_authorization(jsonb,text,text,text,text,text,text,text) TO keryx_app;
RESET ROLE;
