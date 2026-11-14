-- Current SQLite SOURCE private producers. No provider, signer, spool, public
-- publication, funding, lease renewal or installed writer proof is created.
SET ROLE keryx_owner;
CREATE TABLE keryx_storage.private_research_result_identity(
 id text PRIMARY KEY REFERENCES public.private_research_results(id) ON DELETE CASCADE,
 identity_digest text NOT NULL CHECK(identity_digest ~ '^[a-f0-9]{64}$'),
 intent_sha256 text NOT NULL CHECK(intent_sha256 ~ '^[a-f0-9]{64}$'),run_sha256 text NOT NULL CHECK(run_sha256 ~ '^[a-f0-9]{64}$'),
 owner text NOT NULL CHECK(owner ~ '^0x[a-f0-9]{40}$'),question_sha256 text NOT NULL CHECK(question_sha256 ~ '^[a-f0-9]{64}$'),
 creator_budget_micros bigint NOT NULL CHECK(creator_budget_micros BETWEEN 1 AND 500000),research_mode text NOT NULL CHECK(research_mode IN('quick','deep')),
 worker_id text NOT NULL,execution_started_at text NOT NULL,payment_started_at text NOT NULL,payment_settled_at text NOT NULL,
 payment_confirmation_sha256 text NOT NULL CHECK(payment_confirmation_sha256 ~ '^[a-f0-9]{64}$'),saved_at text NOT NULL
);
REVOKE ALL ON keryx_storage.private_research_result_identity FROM PUBLIC,anon,authenticated,service_role,keryx_app,keryx_reader;
CREATE TRIGGER native_private_result_identity_writer BEFORE INSERT OR UPDATE OR DELETE ON keryx_storage.private_research_result_identity FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence();
CREATE TRIGGER native_private_result_identity_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON keryx_storage.private_research_result_identity FOR EACH STATEMENT EXECUTE FUNCTION keryx_storage.immutable();
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only)
 SELECT 'private_research_'||selected.operation,ARRAY['private_research_intents','private_research_payment_attempts','private_research_executions','private_research_results','private_research_interruptions','private_creator_submissions','private_creator_confirmations','private_treasury_pools','private_treasury_reservations','private_treasury_releases','private_research_result_identity'],true,selected.operation='snapshot'
 FROM unnest(ARRAY['snapshot','reserve_intent','reserve_treasury','claim_payment','confirm_payment','claim_execution','admit_creator','confirm_creator','save_result','interrupt','release']) AS selected(operation);
DO $$DECLARE name text;BEGIN
 FOREACH name IN ARRAY ARRAY['private_research_intents','private_research_executions','private_research_results','private_research_interruptions','private_creator_submissions','private_treasury_pools','private_treasury_reservations','private_treasury_releases'] LOOP
  EXECUTE format('CREATE TRIGGER native_private_research_retained BEFORE UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION keryx_storage.immutable()',name);
 END LOOP;
END;$$;
CREATE FUNCTION public.storage_private_research(expected jsonb,digest text,action text,selector text,packet_wire text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE packet jsonb;proof jsonb;value_json json;value_wire text;run_json json;run_wire text;confirmation jsonb;attempt jsonb;capture jsonb;
 payer text;worker text;signer text;capacity bigint;budget bigint;used bigint;reserved bigint;released bigint;changed bigint;created boolean:=false;phase integer;
 stamp text;field text;code text;key text;leg text;wire text;intent_wire text;payment_wire text;execution_wire text;result_wire text;interruption_wire text;reservation_wire text;release_wire text;
 submissions_wire text;confirmations_wire text;intent_data json;payment public.private_research_payment_attempts;execution public.private_research_executions;reservation public.private_treasury_reservations;
 result json;existing record;current_hash text;wanted_hash text;
BEGIN
 IF action IS NULL OR action NOT IN('snapshot','reserve-intent','reserve-treasury','claim-payment','confirm-payment','claim-execution','admit-creator','confirm-creator','save-result','interrupt','release')
  OR selector IS NULL OR selector !~ '^prv_[a-f0-9]{64}$' OR packet_wire IS NULL
  OR octet_length(packet_wire)>CASE WHEN action='snapshot' THEN 256 ELSE 67108864 END
 THEN RAISE EXCEPTION 'native private research action refused';END IF;
 IF action='snapshot' AND current_setting('transaction_read_only')<>'on'
  OR action<>'snapshot' AND(current_setting('transaction_read_only')<>'off' OR session_user<>'keryx_app')
 THEN RAISE EXCEPTION 'native private research transaction refused';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'private_research_'||replace(action,'-','_'));
 packet:=packet_wire::jsonb;payer:=packet->>'payer';
 IF jsonb_typeof(packet) IS DISTINCT FROM 'object' OR payer IS NULL OR payer !~ '^0x[a-f0-9]{40}$' OR payer='0x0000000000000000000000000000000000000000'
 THEN RAISE EXCEPTION 'native private research payer refused';END IF;
 IF action='snapshot' THEN
  IF packet-'payer'<>'{}'::jsonb THEN RAISE EXCEPTION 'native private research selector refused';END IF;
 ELSE
  proof:=packet->'expected';worker:=packet->>'workerId';
  IF (packet-'payer'-'expected'-'valueWire'-'workerId'='{}'::jsonb AND jsonb_typeof(proof)='object' AND proof-'intent'-'payment'-'execution'='{}'::jsonb
   AND jsonb_typeof(packet->'valueWire')='string' AND octet_length(packet->>'valueWire')<=33554432
   AND (jsonb_typeof(packet->'workerId')='null' OR jsonb_typeof(packet->'workerId')='string' AND worker ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')) IS NOT TRUE
  THEN RAISE EXCEPTION 'native private research packet refused';END IF;
  FOREACH field IN ARRAY ARRAY['intent','payment','execution'] LOOP
   IF (jsonb_typeof(proof->field)='null' OR jsonb_typeof(proof->field)='string' AND proof->>field ~ '^[a-f0-9]{64}$') IS NOT TRUE THEN RAISE EXCEPTION 'native private research expected digest refused';END IF;
  END LOOP;
  value_wire:=packet->>'valueWire';value_json:=value_wire::json;
  IF action IN('admit-creator','confirm-creator','save-result','interrupt') THEN
   IF worker IS NULL THEN RAISE EXCEPTION 'native private worker required';END IF;
  ELSIF worker IS NOT NULL THEN RAISE EXCEPTION 'native private worker argument refused';END IF;
 END IF;
 FOR phase IN 1..2 LOOP
  intent_wire:=NULL;intent_data:=NULL;payment_wire:=NULL;execution_wire:=NULL;result_wire:=NULL;interruption_wire:=NULL;reservation_wire:=NULL;release_wire:=NULL;
  submissions_wire:='[]';confirmations_wire:='[]';
  SELECT row_to_json(i)::text,i.data::json INTO intent_wire,intent_data FROM public.private_research_intents i WHERE i.id=selector AND i.payer=storage_private_research.payer;
  IF intent_wire IS NOT NULL THEN
   SELECT row_to_json(p)::text INTO payment_wire FROM public.private_research_payment_attempts p WHERE p.id=selector;
   SELECT row_to_json(e)::text INTO execution_wire FROM public.private_research_executions e WHERE e.id=selector;
   SELECT row_to_json(r)::text INTO result_wire FROM public.private_research_results r WHERE r.id=selector;
   SELECT row_to_json(x)::text INTO interruption_wire FROM public.private_research_interruptions x WHERE x.id=selector;
   SELECT row_to_json(r)::text INTO reservation_wire FROM public.private_treasury_reservations r WHERE r.job_id=selector;
   SELECT row_to_json(r)::text INTO release_wire FROM public.private_treasury_releases r WHERE r.job_id=selector;
   -- Check native allocation before aggregating private ledger/body strings.
   IF (SELECT coalesce(sum(octet_length(data)+512),0) FROM public.private_creator_submissions WHERE job_id=selector)>16777216
    OR (SELECT coalesce(sum(octet_length(c.data)+256),0) FROM public.private_creator_confirmations c JOIN public.private_creator_submissions s ON s.authorization_id=c.authorization_id WHERE s.job_id=selector)>16777216
   THEN RAISE EXCEPTION 'native private ledger snapshot bound';END IF;
   SELECT coalesce(json_agg(row_to_json(s) ORDER BY s.started_at COLLATE "C",s.leg_id COLLATE "C")::text,'[]') INTO submissions_wire FROM public.private_creator_submissions s WHERE s.job_id=selector;
   SELECT coalesce(json_agg(row_to_json(c) ORDER BY c.authorization_id COLLATE "C")::text,'[]') INTO confirmations_wire FROM public.private_creator_confirmations c JOIN public.private_creator_submissions s ON s.authorization_id=c.authorization_id WHERE s.job_id=selector;
  END IF;
  IF octet_length(intent_wire)>2097152 OR octet_length(payment_wire)>32768 OR octet_length(execution_wire)>2048 OR octet_length(result_wire)>33554432
   OR octet_length(interruption_wire)>2048 OR octet_length(reservation_wire)>2048 OR octet_length(release_wire)>2048
   OR octet_length(submissions_wire)>33554432 OR octet_length(confirmations_wire)>33554432 THEN RAISE EXCEPTION 'native private snapshot bound';END IF;
  IF result_wire IS NOT NULL AND NOT EXISTS(SELECT 1 FROM keryx_storage.private_research_result_identity m JOIN public.private_research_results r ON r.id=m.id
   JOIN public.private_research_executions e ON e.id=m.id JOIN public.private_research_payment_attempts p ON p.id=m.id
   WHERE m.id=selector AND m.identity_digest=keryx_storage.identity_digest(expected) AND m.owner=payer
    AND m.run_sha256=encode(sha256(convert_to(r.serialized_run,'UTF8')),'hex')
    AND m.intent_sha256=encode(sha256(convert_to((SELECT data FROM public.private_research_intents WHERE id=selector),'UTF8')),'hex')
    AND m.question_sha256=encode(sha256(convert_to((intent_data#>'{submission,request,question}')::text,'UTF8')),'hex')
    AND m.creator_budget_micros=floor((intent_data#>>'{submission,request,budget}')::double precision*1000000+0.5)::bigint
    AND m.research_mode=intent_data#>>'{submission,request,researchMode}' AND m.worker_id=e.worker_id AND m.execution_started_at=e.started_at
    AND m.payment_started_at=p.started_at AND m.payment_settled_at=p.settled_at AND m.payment_confirmation_sha256=encode(sha256(convert_to(p.confirmation,'UTF8')),'hex') AND m.saved_at=r.saved_at)
  THEN RAISE EXCEPTION 'native private result SOURCE identity unavailable';END IF;
  IF phase=2 OR action='snapshot' THEN
   result:=json_build_object('intentRowWire',intent_wire,'paymentRowWire',payment_wire,'executionRowWire',execution_wire,'resultRowWire',result_wire,'interruptionRowWire',interruption_wire,
    'reservationRowWire',reservation_wire,'releaseRowWire',release_wire,'submissionsWire',submissions_wire,'confirmationsWire',confirmations_wire);
   IF action<>'snapshot' THEN result:=json_build_object('created',created,'snapshot',result);PERFORM keryx_storage.leave_operation();END IF;
   IF octet_length(result::text)>134217728 THEN RAISE EXCEPTION 'native private response bound';END IF;RETURN result;
  END IF;
  IF action<>'reserve-intent' THEN
   IF intent_wire IS NULL OR proof->>'intent' IS DISTINCT FROM encode(sha256(convert_to(intent_wire,'UTF8')),'hex') THEN RAISE EXCEPTION 'native private current intent refused';END IF;
   IF intent_data->>'id' IS DISTINCT FROM selector OR intent_data#>>'{submission,payment,authorization,from}' IS DISTINCT FROM payer
    OR intent_data#>>'{requirement,network}' IS DISTINCT FROM expected->>'network' THEN RAISE EXCEPTION 'native private original owner refused';END IF;
  END IF;
  IF action IN('claim-execution','admit-creator','confirm-creator','save-result','interrupt','release') THEN
   IF payment_wire IS NULL OR proof->>'payment' IS DISTINCT FROM encode(sha256(convert_to(payment_wire,'UTF8')),'hex') THEN RAISE EXCEPTION 'native private current payment refused';END IF;
   SELECT * INTO payment FROM public.private_research_payment_attempts WHERE id=selector;
   IF payment.confirmation IS NULL OR payment.settled_at IS NULL THEN RAISE EXCEPTION 'native settled private payment required';END IF;
   confirmation:=payment.confirmation::jsonb;
   IF (confirmation->>'source' IN('circle-facilitator-success','circle-transfer-search') AND(confirmation->>'source'<>'circle-transfer-search' OR confirmation->>'transferStatus' IN('confirmed','completed'))
    AND confirmation->>'network'=expected->>'network' AND confirmation->>'payer'=payer
    AND confirmation->>'payee'=intent_data#>>'{submission,payment,authorization,to}' AND confirmation->>'amountMicros'=intent_data#>>'{submission,payment,authorization,value}'
    AND confirmation->>'authorizationId'=intent_data#>>'{submission,payment,authorization,nonce}' AND confirmation->>'transaction' ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$') IS NOT TRUE
   THEN RAISE EXCEPTION 'native private payment binding refused';END IF;
  END IF;
  IF action IN('admit-creator','confirm-creator','save-result','interrupt','release') THEN
   IF execution_wire IS NULL OR proof->>'execution' IS DISTINCT FROM encode(sha256(convert_to(execution_wire,'UTF8')),'hex') THEN RAISE EXCEPTION 'native private current execution refused';END IF;
   SELECT * INTO execution FROM public.private_research_executions WHERE id=selector;
   IF action<>'release' AND execution.worker_id IS DISTINCT FROM worker THEN RAISE EXCEPTION 'native private worker refused';END IF;
  END IF;
  stamp:=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  CASE action
  WHEN 'reserve-intent' THEN
   IF (json_typeof(value_json)='object' AND octet_length(value_wire)<=524288 AND value_json->>'id'=selector
    AND value_json#>>'{submission,payment,authorization,from}'=payer AND value_json#>>'{requirement,network}'=expected->>'network'
    AND value_json#>>'{submission,payment,authorization,nonce}' ~ '^0x[a-f0-9]{64}$' AND value_json#>>'{submission,payment,signature}' ~ '^0x[a-fA-F0-9]{130}$'
    AND value_json#>>'{submission,salt}' ~ '^0x[a-f0-9]{64}$'
    AND selector='prv_'||encode(sha256(convert_to('keryx-private-order-v1|'||(expected->>'network')||'|'||payer||'|'||(value_json#>>'{submission,payment,authorization,to}')||'|'||(value_json#>>'{submission,payment,authorization,nonce}'),'UTF8')),'hex')) IS NOT TRUE
   THEN RAISE EXCEPTION 'native private intent packet refused';END IF;
   IF EXISTS(SELECT 1 FROM public.private_research_intents WHERE id=selector AND payer<>storage_private_research.payer) THEN RAISE EXCEPTION 'native private original owner conflict';END IF;
   IF intent_data IS NOT NULL AND json_build_array(intent_data->'id',intent_data#>'{submission,request}',intent_data#>'{submission,salt}',intent_data#>'{submission,payment,authorization}',intent_data->'requirement',intent_data->'merchants')::text
    IS DISTINCT FROM json_build_array(value_json->'id',value_json#>'{submission,request}',value_json#>'{submission,salt}',value_json#>'{submission,payment,authorization}',value_json->'requirement',value_json->'merchants')::text
   THEN RAISE EXCEPTION 'native private intent reservation conflict';END IF;
   INSERT INTO public.private_research_intents(id,payer,data,created_at) VALUES(selector,payer,value_wire,stamp) ON CONFLICT(id) DO NOTHING;GET DIAGNOSTICS changed=ROW_COUNT;created:=changed=1;
  WHEN 'reserve-treasury' THEN
   IF json_typeof(value_json) IS DISTINCT FROM 'object' OR ARRAY(SELECT json_object_keys(value_json) ORDER BY 1) IS DISTINCT FROM ARRAY['capacityMicros','signer'] THEN RAISE EXCEPTION 'native private capacity packet refused';END IF;
   signer:=value_json->>'signer';capacity:=(value_json->>'capacityMicros')::bigint;
   IF signer IS NULL OR signer !~ '^0x[a-f0-9]{40}$' OR signer='0x0000000000000000000000000000000000000000' OR value_json->>'capacityMicros' !~ '^[1-9][0-9]{0,11}$'
    OR capacity NOT BETWEEN 1 AND 999999999999 THEN RAISE EXCEPTION 'native private capacity policy refused';END IF;
   budget:=floor((intent_data#>>'{submission,request,budget}')::double precision*1000000+0.5)::bigint;
   IF budget NOT BETWEEN 1 AND 500000 THEN RAISE EXCEPTION 'native private creator budget refused';END IF;
   INSERT INTO public.private_treasury_pools(signer,capacity_micros) VALUES(signer,capacity) ON CONFLICT DO NOTHING;
   IF (SELECT capacity_micros FROM public.private_treasury_pools p WHERE p.signer=storage_private_research.signer) IS DISTINCT FROM capacity THEN RAISE EXCEPTION 'native private capacity policy conflict';END IF;
   SELECT * INTO reservation FROM public.private_treasury_reservations WHERE job_id=selector;
   IF FOUND AND(reservation.signer IS DISTINCT FROM signer OR reservation.amount_micros IS DISTINCT FROM budget) THEN
    -- Exactly Source's documented autocommit pool insert preceding a known
    -- reservation conflict. No generic SQL fault is caught or committed.
    PERFORM keryx_storage.leave_operation();RETURN json_build_object('refusal','treasury-reservation-conflict');
   END IF;
   SELECT coalesce(sum(r.amount_micros-coalesce(x.amount_micros,0)),0) INTO used FROM public.private_treasury_reservations r LEFT JOIN public.private_treasury_releases x ON x.job_id=r.job_id WHERE r.signer=storage_private_research.signer;
   INSERT INTO public.private_treasury_reservations(job_id,signer,amount_micros) SELECT selector,signer,budget WHERE budget<=capacity-used ON CONFLICT DO NOTHING;
   created:=EXISTS(SELECT 1 FROM public.private_treasury_reservations r WHERE r.job_id=selector AND r.signer=storage_private_research.signer AND r.amount_micros=budget);
  WHEN 'claim-payment' THEN
   IF value_wire<>'null' OR worker IS NOT NULL THEN RAISE EXCEPTION 'native private payment claim packet refused';END IF;
   INSERT INTO public.private_research_payment_attempts(id,started_at) VALUES(selector,stamp) ON CONFLICT DO NOTHING;GET DIAGNOSTICS changed=ROW_COUNT;created:=changed=1;
  WHEN 'confirm-payment' THEN
   confirmation:=value_wire::jsonb;
   IF (confirmation->>'source' IN('circle-facilitator-success','circle-transfer-search') AND(confirmation->>'source'<>'circle-transfer-search' OR confirmation->>'transferStatus' IN('confirmed','completed'))
    AND confirmation->>'network'=expected->>'network' AND confirmation->>'payer'=payer AND confirmation->>'payee'=intent_data#>>'{submission,payment,authorization,to}'
    AND confirmation->>'amountMicros'=intent_data#>>'{submission,payment,authorization,value}' AND confirmation->>'authorizationId'=intent_data#>>'{submission,payment,authorization,nonce}'
    AND confirmation->>'transaction' ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$') IS NOT TRUE THEN RAISE EXCEPTION 'native private incoming confirmation refused';END IF;
   UPDATE public.private_research_payment_attempts SET confirmation=value_wire,settled_at=stamp WHERE id=selector AND confirmation IS NULL;
   GET DIAGNOSTICS changed=ROW_COUNT;created:=changed=1;
   IF (SELECT p.confirmation::jsonb FROM public.private_research_payment_attempts p WHERE p.id=selector) IS DISTINCT FROM confirmation THEN RAISE EXCEPTION 'native private incoming confirmation conflict';END IF;
  WHEN 'claim-execution' THEN
   key:=value_json#>>'{}';IF key IS NULL OR key !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' OR worker IS NOT NULL THEN RAISE EXCEPTION 'native private execution packet refused';END IF;
   INSERT INTO public.private_research_executions(id,worker_id,started_at) VALUES(selector,key,stamp) ON CONFLICT DO NOTHING;GET DIAGNOSTICS changed=ROW_COUNT;created:=changed=1;
  WHEN 'admit-creator' THEN
   IF json_typeof(value_json) IS DISTINCT FROM 'object' OR ARRAY(SELECT json_object_keys(value_json) ORDER BY 1) IS DISTINCT FROM ARRAY['itemId','kind','sourceId','submission']
    OR json_typeof(value_json->'submission') IS DISTINCT FROM 'object' OR ARRAY(SELECT json_object_keys(value_json->'submission') ORDER BY 1) IS DISTINCT FROM ARRAY['amountMicros','asset','authorizationExpiresAt','authorizationId','network','payee','payer']
   THEN RAISE EXCEPTION 'native private creator shape refused';END IF;
   attempt:=(value_json->'submission')::text::jsonb;
   IF (value_json->>'kind' IN('fetch','citation') AND json_typeof(value_json->'sourceId')='string' AND (value_json->'sourceId')::text<>'""' AND octet_length((value_json->'sourceId')::text)<=2048
    AND(json_typeof(value_json->'itemId')='null' OR json_typeof(value_json->'itemId')='string' AND(value_json->'itemId')::text<>'""' AND octet_length((value_json->'itemId')::text)<=2048)
    AND attempt->>'authorizationId' ~ '^0x[a-f0-9]{64}$' AND attempt->>'payer' ~ '^0x[a-f0-9]{40}$' AND attempt->>'payee' ~ '^0x[a-f0-9]{40}$'
    AND attempt->>'payer'<>'0x0000000000000000000000000000000000000000' AND attempt->>'payee'<>'0x0000000000000000000000000000000000000000'
    AND attempt->>'amountMicros' ~ '^[1-9][0-9]{0,6}$' AND (attempt->>'amountMicros')::bigint<=1000000
    AND attempt->>'network'=expected->>'network' AND attempt->>'asset'='{{USDC_ADDRESS}}' AND attempt->>'authorizationExpiresAt' IS NOT NULL) IS NOT TRUE
   THEN RAISE EXCEPTION 'native private creator packet refused';END IF;
   -- Retain original expired authorization metadata; expiry is not settlement
   -- failure, authority to replace a nonce, or permission to sign again.
   leg:=encode(sha256(convert_to('['||to_json(value_json->>'kind')::text||','||(value_json->'sourceId')::text||','||(value_json->'itemId')::text||','||to_json(attempt->>'payee')::text||']','UTF8')),'hex');
   budget:=floor((intent_data#>>'{submission,request,budget}')::double precision*1000000+0.5)::bigint;
   SELECT coalesce(sum(amount_micros),0) INTO used FROM public.private_creator_submissions WHERE job_id=selector;
   IF result_wire IS NULL AND interruption_wire IS NULL AND used+(attempt->>'amountMicros')::bigint<=budget THEN
    INSERT INTO public.private_creator_submissions(job_id,leg_id,worker_id,authorization_id,amount_micros,data,started_at)
     VALUES(selector,leg,worker,attempt->>'authorizationId',(attempt->>'amountMicros')::bigint,value_wire,stamp) ON CONFLICT DO NOTHING;GET DIAGNOSTICS changed=ROW_COUNT;created:=changed=1;
   END IF;
  WHEN 'confirm-creator' THEN
   confirmation:=value_wire::jsonb;key:=confirmation#>>'{submission,authorizationId}';
   SELECT s.data::json->'submission' INTO value_json FROM public.private_creator_submissions s WHERE s.job_id=selector AND s.worker_id=worker AND s.authorization_id=key;
   IF NOT FOUND OR(confirmation->'submission') IS DISTINCT FROM value_json::text::jsonb OR confirmation->>'transaction' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'
    OR confirmation->>'source' NOT IN('circle-facilitator-success','circle-transfer-search') OR confirmation->>'source' IS NULL
    OR confirmation->>'source'='circle-transfer-search' AND(confirmation->>'transferStatus' IS NULL OR confirmation->>'transferStatus' NOT IN('received','batched','confirmed','completed'))
   THEN RAISE EXCEPTION 'native private creator confirmation mismatch';END IF;
   INSERT INTO public.private_creator_confirmations(authorization_id,data,settled_at) VALUES(key,value_wire,stamp)
    ON CONFLICT(authorization_id) DO UPDATE SET data=excluded.data
    WHERE (private_creator_confirmations.data::json->>'source')='circle-transfer-search' AND confirmation->>'source'='circle-transfer-search'
     AND(private_creator_confirmations.data::json->>'transferStatus') IN('received','batched') AND confirmation->>'transferStatus' IN('confirmed','completed')
     AND(private_creator_confirmations.data::json->>'transaction')=confirmation->>'transaction'
     AND(private_creator_confirmations.data::json->'submission')::text::jsonb=confirmation->'submission';
   GET DIAGNOSTICS changed=ROW_COUNT;created:=changed=1;
   IF (SELECT c.data::jsonb FROM public.private_creator_confirmations c WHERE c.authorization_id=key) IS DISTINCT FROM confirmation THEN RAISE EXCEPTION 'native private creator confirmation conflict';END IF;
  WHEN 'save-result' THEN
   IF json_typeof(value_json) IS DISTINCT FROM 'object' OR ARRAY(SELECT json_object_keys(value_json) ORDER BY 1) IS DISTINCT FROM ARRAY['identity','serializedRun']
    OR json_typeof(value_json->'serializedRun') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'native private result packet refused';END IF;
   run_wire:=value_json->>'serializedRun';run_json:=run_wire::json;capture:=(value_json->'identity')::text::jsonb;
   -- Actual Source checkedSnapshot captures identity before admission. Keep the
   -- raw original TEXT untouched: PG getters unescape unsupported answer/trace
   -- scalars even when selecting an unrelated field. No masking/normalization.
   IF octet_length(run_wire)>16777216 OR json_typeof(run_json) IS DISTINCT FROM 'object'
    OR (jsonb_typeof(capture)='object' AND capture-'id'-'runSha256'-'intentSha256'-'owner'-'questionSha256'-'budgetMicros'-'researchMode'-'workerId'-'executionStartedAt'-'paymentStartedAt'-'paymentSettledAt'-'paymentConfirmationSha256'-'sourceSavedAt'='{}'::jsonb AND capture->>'id'=selector
     AND capture->>'runSha256'=encode(sha256(convert_to(run_wire,'UTF8')),'hex')
     AND capture->>'intentSha256'=encode(sha256(convert_to((SELECT data FROM public.private_research_intents WHERE id=selector),'UTF8')),'hex')
     AND capture->>'owner'=payer AND capture->>'questionSha256'=encode(sha256(convert_to((intent_data#>'{submission,request,question}')::text,'UTF8')),'hex')
     AND capture->>'budgetMicros'=floor((intent_data#>>'{submission,request,budget}')::double precision*1000000+0.5)::bigint::text
     AND capture->>'researchMode'=intent_data#>>'{submission,request,researchMode}' AND capture->>'workerId'=execution.worker_id AND capture->>'executionStartedAt'=execution.started_at
     AND capture->>'paymentStartedAt'=payment.started_at AND capture->>'paymentSettledAt'=payment.settled_at
     AND capture->>'paymentConfirmationSha256'=encode(sha256(convert_to(payment.confirmation,'UTF8')),'hex')
     AND(CASE WHEN result_wire IS NULL THEN capture->'sourceSavedAt'='null'::jsonb ELSE capture->>'sourceSavedAt'=(SELECT saved_at FROM public.private_research_results WHERE id=selector) END)) IS NOT TRUE
   THEN RAISE EXCEPTION 'native private research result identity mismatch';END IF;
   INSERT INTO public.private_research_results(id,serialized_run,saved_at) VALUES(selector,run_wire,stamp) ON CONFLICT DO NOTHING;GET DIAGNOSTICS changed=ROW_COUNT;created:=changed=1;
   IF (SELECT serialized_run FROM public.private_research_results WHERE id=selector) IS DISTINCT FROM run_wire THEN RAISE EXCEPTION 'native private research result conflict';END IF;
   IF created THEN INSERT INTO keryx_storage.private_research_result_identity(id,identity_digest,intent_sha256,run_sha256,owner,question_sha256,creator_budget_micros,research_mode,worker_id,execution_started_at,payment_started_at,payment_settled_at,payment_confirmation_sha256,saved_at)
    VALUES(selector,keryx_storage.identity_digest(expected),capture->>'intentSha256',capture->>'runSha256',payer,capture->>'questionSha256',(capture->>'budgetMicros')::bigint,capture->>'researchMode',execution.worker_id,execution.started_at,payment.started_at,payment.settled_at,capture->>'paymentConfirmationSha256',stamp);END IF;
  WHEN 'interrupt' THEN
   IF value_wire<>'null' THEN RAISE EXCEPTION 'native private interruption packet refused';END IF;
   IF result_wire IS NULL THEN INSERT INTO public.private_research_interruptions(id,worker_id,reason,recorded_at) VALUES(selector,worker,'worker-interrupted',stamp) ON CONFLICT DO NOTHING;GET DIAGNOSTICS changed=ROW_COUNT;created:=changed=1;END IF;
  WHEN 'release' THEN
   signer:=value_json#>>'{}';SELECT * INTO reservation FROM public.private_treasury_reservations WHERE job_id=selector;
   IF NOT FOUND OR reservation.signer IS DISTINCT FROM signer OR(result_wire IS NULL AND interruption_wire IS NULL) THEN RAISE EXCEPTION 'native private release authority refused';END IF;
   IF EXISTS(SELECT 1 FROM public.private_creator_submissions s WHERE s.job_id=selector AND(s.data::json#>>'{submission,payer}' IS DISTINCT FROM signer OR s.data::json#>>'{submission,amountMicros}' IS DISTINCT FROM s.amount_micros::text)) THEN RAISE EXCEPTION 'native private release accounting mismatch';END IF;
   SELECT coalesce(sum(amount_micros),0) INTO used FROM public.private_creator_submissions WHERE job_id=selector;
   released:=reservation.amount_micros-used;IF released NOT BETWEEN 0 AND 500000 THEN RAISE EXCEPTION 'native private release accounting mismatch';END IF;
   INSERT INTO public.private_treasury_releases(job_id,amount_micros,released_at) VALUES(selector,released,stamp) ON CONFLICT DO NOTHING;GET DIAGNOSTICS changed=ROW_COUNT;created:=changed=1;
   IF (SELECT amount_micros FROM public.private_treasury_releases WHERE job_id=selector) IS DISTINCT FROM released THEN RAISE EXCEPTION 'native private release accounting mismatch';END IF;
  ELSE RAISE EXCEPTION 'native private research operation refused';
  END CASE;
 END LOOP;
 RAISE EXCEPTION 'native private research outcome absent';
END;$$;
REVOKE ALL ON FUNCTION public.storage_private_research(jsonb,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_private_research(jsonb,text,text,text,text) TO keryx_app,keryx_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
RESET ROLE;
