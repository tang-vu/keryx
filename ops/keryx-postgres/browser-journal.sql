-- Fixed actual SQLite Source browser protocols. No installed-factory, signer,
-- provider, funding, activation-floor issuer or automatic retry is supplied.
SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('browser_source_read',ARRAY['browser_authorization_intents','browser_journal_bindings','payment_events','payment_event_originals','browser_signing_originals','browser_signing_queries','browser_signing_namespaces','browser_signing_v2_control','browser_signing_v2_barrier','browser_journal_control','session_grants','browser_signer_capacity','browser_retained_grants'],true,true),
 ('browser_source_activate',ARRAY['browser_journal_control','browser_journal_writer','session_grants','payment_events','payment_event_originals','browser_retained_grants','browser_signer_capacity'],true,false),
 ('browser_source_grant',ARRAY['session_grants','browser_journal_control','browser_journal_writer','browser_retained_grants','browser_signer_capacity'],true,false),
 ('browser_source_intent',ARRAY['browser_authorization_intents','session_grants','browser_journal_control'],true,false),
 ('browser_source_admit',ARRAY['browser_authorization_intents','browser_journal_bindings','payment_events','payment_event_originals','session_grants','browser_journal_control','browser_journal_writer','browser_signer_capacity','browser_retained_grants','sources','sync_state'],true,false),
 ('browser_source_transition',ARRAY['browser_authorization_intents','browser_journal_bindings','payment_events','payment_event_originals','browser_signing_originals','browser_signing_queries','browser_signing_namespaces','browser_signing_v2_control','browser_signing_v2_barrier','browser_signing_v2_writer','browser_journal_control','browser_journal_writer','session_grants','browser_signer_capacity','browser_retained_grants'],true,false),
 ('browser_source_query',ARRAY['browser_signing_namespaces','browser_signing_queries','browser_journal_control','browser_signing_v2_control','session_grants'],true,false);
CREATE FUNCTION public.storage_browser_journal_evidence(expected jsonb,digest text,action text,packet_wire text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
<<source_browser>>
DECLARE operation text;packet jsonb;selected jsonb;snapshot jsonb;controls jsonb;wire text;wire_sha text;
 i public.browser_authorization_intents;b public.browser_journal_bindings;e public.payment_events;after_e public.payment_events;
 original public.browser_signing_originals;q public.browser_signing_queries;n public.browser_signing_namespaces;g public.session_grants;
 raw_payment keryx_storage.payment_event_originals;before_wire text;current_json json;updated_json json;current_projection jsonb;
 intent jsonb;payload jsonb;projection jsonb;raw_json json;requirements json;metadata json;context json;source_policy jsonb;
 metadata_raw json;escaped text;normalized text;high_surrogate integer;code_point integer;raw_input json;stored_input json;incoming_input json;hint jsonb;verified jsonb;p jsonb;rows_json jsonb;
 active boolean;signing_active boolean;has_intent boolean;has_binding boolean;has_payment boolean;has_original boolean;canonical boolean;
 spent bigint;retained bigint;amount bigint;cap bigint;allocated bigint;jobs bigint;changed bigint;counted bigint;distinct_keys bigint;
 current_epoch text;signer text;field text;kind text;target_phase text;status text;raw_scalar text;input_proof text;
 fields text[]:=ARRAY['id','created_at','kind','query_id','source_id','source_name','payer','payee','amount_usdc','weight','rationale','tx_hash','network','settled','settlement_status','authorization_id','authorization_expires_at','grant_epoch','origin','item_id','item_title','item_url','content_version','item_published_at','offer_id','list_price_usdc','authorization_phase'];
 unprojected text[];scaled double precision;rounded double precision;before_number double precision;milliseconds bigint;stamp text;
 day_number bigint;era bigint;doe bigint;yoe bigint;year_number bigint;doy bigint;mp bigint;month_number bigint;day_month bigint;day_ms bigint;
 base integer;digit integer;position integer;digits text;number_text text;release_capacity boolean:=false;update_expiry boolean:=false;projection_expiry timestamptz;
BEGIN
 IF action NOT IN('control','state','finish','v2','v3','v3-finish','query') OR action<>'query' AND current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native browser readonly action refused';END IF;
 IF action IN('v2','v3','v3-finish') AND session_user<>'keryx_app' THEN RAISE EXCEPTION 'native browser replay writer role required';END IF;
 operation:=CASE WHEN action='query' THEN 'browser_source_query' ELSE 'browser_source_read' END;
 PERFORM keryx_storage.require_operation(expected,digest,operation);
 IF packet_wire IS NULL OR octet_length(packet_wire)>8388608 THEN RAISE EXCEPTION 'native browser packet bound';END IF;packet:=packet_wire::jsonb;
 IF jsonb_typeof(packet) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'native browser packet refused';END IF;
 SELECT coalesce((SELECT active FROM public.browser_journal_control WHERE id=1),false),coalesce((SELECT active FROM public.browser_signing_v2_control WHERE id=1),false) INTO active,signing_active;
 IF action='control' THEN RETURN to_json(active);END IF;
 controls:=jsonb_build_object('journalActive',active,'signingActive',signing_active,'floor',coalesce((SELECT min_original_version FROM public.browser_signing_v2_control WHERE id=1),2),'ever',coalesce((SELECT ever_active FROM public.browser_signing_v2_barrier WHERE id=1),0));
 IF action='v2' AND NOT(active AND signing_active) THEN RETURN '{"status":"inactive"}'::json;END IF;

 IF action='query' THEN
  verified:=packet->'verified';p:=verified->'policy';input_proof:=packet->>'proofWire';
  IF (packet-'sessionId'-'verified'-'proofWire'='{}'::jsonb AND jsonb_typeof(p)='object' AND jsonb_typeof(packet->'sessionId')='string' AND octet_length(packet->>'sessionId') BETWEEN 1 AND 1024 AND input_proof IS NOT NULL AND octet_length(input_proof)<=8192 AND input_proof::jsonb=jsonb_build_object('policy',p,'signature',verified->'signature')
   AND p->>'protocol'='durable-v2' AND p->>'service'='https://keryx.cc' AND verified->>'namespace' ~ '^0x[0-9a-f]{64}$' AND verified->>'proofDigest' ~ '^0x[0-9a-f]{64}$' AND verified->>'signature' ~ '^0x[0-9a-f]{130}$') IS NOT TRUE THEN RAISE EXCEPTION 'native browser verified query capture refused';END IF;
  IF NOT(active AND signing_active) THEN PERFORM keryx_storage.leave_operation();RETURN '{"status":"inactive"}'::json;END IF;
  FOR field IN SELECT unnest(ARRAY['owner','signer']) LOOP IF p->>field !~ '^0x[0-9a-f]{40}$' THEN RAISE EXCEPTION 'native browser query identity refused';END IF;END LOOP;
  FOR field IN SELECT unnest(ARRAY['policyId','requestNonce','questionDigest']) LOOP IF p->>field !~ '^0x[0-9a-f]{64}$' THEN RAISE EXCEPTION 'native browser query digest refused';END IF;END LOOP;
  FOR field IN SELECT unnest(ARRAY['queryCeilingMicros','lifetimeCeilingMicros','jobLimit','expiresAt']) LOOP IF coalesce(p->>field,'') !~ '^[1-9][0-9]{0,15}$' OR (p->>field)::numeric>9007199254740991 THEN RAISE EXCEPTION 'native browser query number refused';END IF;END LOOP;
  PERFORM (p->>'queryId')::uuid;PERFORM (p->>'grantEpoch')::uuid;
  SELECT * INTO q FROM public.browser_signing_queries WHERE query_id=p->>'queryId' OR namespace=verified->>'namespace' AND(request_nonce=p->>'requestNonce' OR policy_id=p->>'policyId') LIMIT 1;
  IF FOUND THEN
   PERFORM keryx_storage.leave_operation();IF q.query_id=p->>'queryId' AND q.namespace=verified->>'namespace' AND q.session_id=packet->>'sessionId' AND q.proof_digest=verified->>'proofDigest' THEN RETURN json_build_object('status','admitted','namespace',q.namespace,'queryId',q.query_id);END IF;RETURN '{"status":"refused"}'::json;
  END IF;
  SELECT * INTO g FROM public.session_grants WHERE session_id=packet->>'sessionId';
  scaled:=g.cap::double precision*1000000;rounded:=floor(scaled);IF scaled-rounded>=0.5 THEN rounded:=rounded+1;END IF;
  IF g.session_id IS NULL OR lower(g.owner_addr) IS DISTINCT FROM p->>'owner' OR lower(g.sess_addr) IS DISTINCT FROM p->>'signer' OR g.grant_epoch IS DISTINCT FROM p->>'grantEpoch' OR g.expiry<=floor(extract(epoch FROM clock_timestamp())*1000) OR (p->>'expiresAt')::bigint<=floor(extract(epoch FROM clock_timestamp())*1000) OR (p->>'expiresAt')::bigint>g.expiry THEN PERFORM keryx_storage.leave_operation();RETURN '{"status":"refused"}'::json;END IF;
  IF rounded<0 OR rounded>9007199254740991 OR abs(scaled-rounded)>=0.000001 THEN RAISE EXCEPTION 'invalid browser signing capacity';END IF;
  IF (p->>'lifetimeCeilingMicros')::bigint>rounded::bigint THEN PERFORM keryx_storage.leave_operation();RETURN '{"status":"refused"}'::json;END IF;
  SELECT * INTO n FROM public.browser_signing_namespaces WHERE namespace=verified->>'namespace';allocated:=coalesce(n.allocated_micro,0);jobs:=coalesce(n.jobs,0);amount:=(p->>'queryCeilingMicros')::bigint;
  IF amount>(p->>'lifetimeCeilingMicros')::bigint OR allocated+amount>9007199254740991 OR allocated+amount>(p->>'lifetimeCeilingMicros')::bigint OR jobs+1>9007199254740991 OR jobs+1>(p->>'jobLimit')::bigint THEN PERFORM keryx_storage.leave_operation();RETURN '{"status":"refused"}'::json;END IF;
  IF n.namespace IS NOT NULL AND ROW(n.owner,n.signer,n.service,n.network) IS DISTINCT FROM ROW(p->>'owner',p->>'signer',p->>'service','eip155:5042002') THEN RAISE EXCEPTION 'browser signing namespace mismatch';END IF;
  INSERT INTO public.browser_signing_namespaces(namespace,owner,signer,service,network,ceiling_micro,job_limit,allocated_micro,jobs,proof) VALUES(verified->>'namespace',p->>'owner',p->>'signer',p->>'service','eip155:5042002',(p->>'lifetimeCeilingMicros')::bigint,(p->>'jobLimit')::bigint,allocated+amount,jobs+1,input_proof)
   ON CONFLICT(namespace) DO UPDATE SET ceiling_micro=excluded.ceiling_micro,job_limit=excluded.job_limit,allocated_micro=excluded.allocated_micro,jobs=excluded.jobs,proof=excluded.proof;
  INSERT INTO public.browser_signing_queries(query_id,namespace,policy_id,request_nonce,session_id,grant_epoch,proof,proof_digest,ceiling_micro,spent_micro) VALUES(p->>'queryId',verified->>'namespace',p->>'policyId',p->>'requestNonce',packet->>'sessionId',p->>'grantEpoch',input_proof,verified->>'proofDigest',amount,0);
  PERFORM keryx_storage.leave_operation();RETURN json_build_object('status','admitted','namespace',verified->>'namespace','queryId',p->>'queryId');
 END IF;

 IF action IN('state','finish','v2','v3','v3-finish') THEN
  selected:=CASE WHEN action='state' THEN packet ELSE packet->'selector' END;
  IF (jsonb_typeof(selected)='object' AND selected-'sessionId'-'requestId'-'sourceSessionWire'-'sourceRequestWire'='{}'::jsonb AND jsonb_typeof(selected->'sessionId')='string' AND jsonb_typeof(selected->'requestId')='string' AND octet_length(selected->>'sessionId') BETWEEN 1 AND 1024 AND octet_length(selected->>'requestId') BETWEEN 1 AND 1024
   AND jsonb_typeof(selected->'sourceSessionWire')='string' AND jsonb_typeof(selected->'sourceRequestWire')='string' AND octet_length(selected->>'sourceSessionWire')<=8192 AND octet_length(selected->>'sourceRequestWire')<=8192) IS NOT TRUE THEN RAISE EXCEPTION 'native browser selector refused';END IF;
  SELECT * INTO i FROM public.browser_authorization_intents WHERE session_id=selected->>'sessionId' AND request_id=selected->>'requestId';has_intent:=FOUND;
  IF has_intent THEN
   SELECT * INTO b FROM public.browser_journal_bindings WHERE nonce=i.nonce;has_binding:=FOUND;
   SELECT * INTO e FROM public.payment_events WHERE id='x402:'||i.nonce;has_payment:=FOUND;
   SELECT * INTO original FROM public.browser_signing_originals WHERE nonce=i.nonce;has_original:=FOUND;
   IF has_payment AND has_binding THEN
    SELECT * INTO raw_payment FROM keryx_storage.payment_event_originals WHERE payment_id=e.id;
    IF NOT FOUND OR raw_payment.native_projection IS DISTINCT FROM to_jsonb(e) THEN RAISE EXCEPTION 'native browser payment original unavailable or changed';END IF;
    before_wire:=raw_payment.current_wire::text;
    IF octet_length(before_wire)>1048576 THEN RAISE EXCEPTION 'native browser payment original bound';END IF;
   END IF;
   IF has_original THEN SELECT * INTO q FROM public.browser_signing_queries WHERE query_id=original.query_id;IF FOUND THEN SELECT * INTO n FROM public.browser_signing_namespaces WHERE namespace=q.namespace;END IF;END IF;
   SELECT spent_micro INTO spent FROM public.browser_signer_capacity WHERE browser_signer_capacity.signer=lower(i.signer);
   SELECT spent_micro INTO retained FROM public.browser_retained_grants WHERE grant_epoch=i.grant_epoch AND browser_retained_grants.signer=lower(i.signer);
  END IF;
  SELECT * INTO g FROM public.session_grants WHERE session_id=selected->>'sessionId';
  IF coalesce(octet_length(to_jsonb(i)::text),0)+coalesce(octet_length(to_jsonb(b)::text),0)+coalesce(octet_length(to_jsonb(original)::text),0)+coalesce(octet_length(to_jsonb(q)::text),0)+coalesce(octet_length(to_jsonb(n)::text),0)+coalesce(octet_length(before_wire),0)>2097152 THEN RAISE EXCEPTION 'native browser complete snapshot bound';END IF;
  snapshot:=jsonb_build_object('selector',selected,'intent',CASE WHEN has_intent THEN to_jsonb(i) END,'binding',CASE WHEN has_binding THEN to_jsonb(b) END,'paymentWire',before_wire,'original',CASE WHEN has_original THEN to_jsonb(original) END,'query',CASE WHEN q.query_id IS NOT NULL THEN to_jsonb(q) END,'namespace',CASE WHEN n.namespace IS NOT NULL THEN to_jsonb(n) END,'grant',CASE WHEN g.session_id IS NOT NULL THEN to_jsonb(g) END,'signerSpent',spent::text,'epochSpent',retained::text,'controls',controls);
  wire:=snapshot::text;wire_sha:=encode(sha256(convert_to(wire,'UTF8')),'hex');
  IF octet_length(wire)>4194304 THEN RAISE EXCEPTION 'native browser encoded snapshot bound';END IF;
  IF action IN('state','finish') THEN
   IF action='finish' AND(packet-'selector'-'snapshotSha256'<>'{}'::jsonb OR packet->>'snapshotSha256' IS DISTINCT FROM wire_sha) THEN RAISE EXCEPTION 'native browser scope changed during validation';END IF;
   RETURN json_build_object('wire',wire,'sha256',wire_sha);
  END IF;
  IF action IN('v2','v3','v3-finish') THEN
   IF jsonb_typeof(packet->'inputWire') IS DISTINCT FROM 'string' OR octet_length(packet->>'inputWire')>1048576 THEN RAISE EXCEPTION 'native browser replay original bound';END IF;raw_input:=(packet->>'inputWire')::json;
   IF action='v2' AND NOT(active AND signing_active) THEN RETURN '{"status":"inactive"}'::json;END IF;
   IF has_intent AND has_binding AND has_payment THEN
    IF NOT has_original THEN RETURN '{"status":"refused"}'::json;END IF;
    IF action='v2' THEN
     IF original.input IS DISTINCT FROM packet->>'inputWire' THEN RETURN '{"status":"refused"}'::json;END IF;
    ELSE
     -- Source v3 blind replay omits only the stored sourceContext. Do not
     -- apply a later registry, policy, grant expiry or activation verdict.
     IF action='v3-finish' AND(packet->>'originalSha256' IS DISTINCT FROM encode(sha256(convert_to(original.original,'UTF8')),'hex') OR packet->>'inputSha256' IS DISTINCT FROM encode(sha256(convert_to(original.input,'UTF8')),'hex')) THEN RAISE EXCEPTION 'native browser immutable original changed';END IF;
    END IF;
    RETURN json_build_object('status','admitted','snapshot',json_build_object('wire',wire,'sha256',wire_sha));
   END IF;
   IF action<>'v2' THEN RETURN json_build_object('status',CASE WHEN raw_input->>'protocol' IS DISTINCT FROM 'durable-v3' OR raw_input#>>'{journal,kind}' IS DISTINCT FROM 'fetch' THEN 'refused' WHEN NOT(active AND signing_active) THEN 'inactive' WHEN controls->>'floor'<>'3' THEN 'refused' ELSE 'missing' END);END IF;
   IF controls->>'floor'='3' THEN RETURN '{"status":"refused"}'::json;END IF;
   hint:=packet->'hint';SELECT * INTO q FROM public.browser_signing_queries WHERE query_id=hint->>'queryId' AND namespace=hint->>'namespace';
   IF NOT FOUND OR q.session_id IS DISTINCT FROM selected->>'sessionId' OR q.grant_epoch IS DISTINCT FROM hint->>'grantEpoch' OR raw_input#>>'{journal,queryId}' IS DISTINCT FROM hint->>'queryId' THEN RETURN '{"status":"refused"}'::json;END IF;
   p:=q.proof::jsonb->'policy';
   IF g.session_id IS NULL OR lower(g.owner_addr) IS DISTINCT FROM p->>'owner' OR lower(g.sess_addr) IS DISTINCT FROM p->>'signer' OR lower(hint->>'signer') IS DISTINCT FROM p->>'signer' OR g.grant_epoch IS DISTINCT FROM p->>'grantEpoch' OR g.expiry<=floor(extract(epoch FROM clock_timestamp())*1000) OR (p->>'expiresAt')::bigint<=floor(extract(epoch FROM clock_timestamp())*1000) OR q.spent_micro+(hint->>'amountMicroUsdc')::bigint>q.ceiling_micro THEN RETURN '{"status":"refused"}'::json;END IF;
   -- The actual Source preparer is historical 5042002. A fresh new original
   -- reaches the selected mainnet intent fence and rolls back; never relabel it.
   RAISE EXCEPTION 'storage authority profile mismatch';
  END IF;
 END IF;

 RAISE EXCEPTION 'native browser readonly action refused';
END;$$;
REVOKE ALL ON FUNCTION public.storage_browser_journal_evidence(jsonb,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_browser_journal_evidence(jsonb,text,text,text) TO keryx_app,keryx_reader;
CREATE FUNCTION public.storage_browser_journal(expected jsonb,digest text,action text,packet_wire text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
<<source_browser>>
DECLARE operation text;packet jsonb;selected jsonb;snapshot jsonb;controls jsonb;wire text;wire_sha text;
 i public.browser_authorization_intents;b public.browser_journal_bindings;e public.payment_events;after_e public.payment_events;
 original public.browser_signing_originals;q public.browser_signing_queries;n public.browser_signing_namespaces;g public.session_grants;
 raw_payment keryx_storage.payment_event_originals;before_wire text;current_json json;updated_json json;current_projection jsonb;
 intent jsonb;payload jsonb;projection jsonb;raw_json json;requirements json;metadata json;context json;source_policy jsonb;
 metadata_raw json;escaped text;normalized text;high_surrogate integer;code_point integer;raw_input json;stored_input json;incoming_input json;hint jsonb;verified jsonb;p jsonb;rows_json jsonb;
 active boolean;signing_active boolean;has_intent boolean;has_binding boolean;has_payment boolean;has_original boolean;canonical boolean;
 spent bigint;retained bigint;amount bigint;cap bigint;allocated bigint;jobs bigint;changed bigint;counted bigint;distinct_keys bigint;
 current_epoch text;signer text;field text;kind text;target_phase text;status text;raw_scalar text;input_proof text;
 fields text[]:=ARRAY['id','created_at','kind','query_id','source_id','source_name','payer','payee','amount_usdc','weight','rationale','tx_hash','network','settled','settlement_status','authorization_id','authorization_expires_at','grant_epoch','origin','item_id','item_title','item_url','content_version','item_published_at','offer_id','list_price_usdc','authorization_phase'];
 unprojected text[];scaled double precision;rounded double precision;before_number double precision;milliseconds bigint;stamp text;
 day_number bigint;era bigint;doe bigint;yoe bigint;year_number bigint;doy bigint;mp bigint;month_number bigint;day_month bigint;day_ms bigint;
 base integer;digit integer;position integer;digits text;number_text text;release_capacity boolean:=false;update_expiry boolean:=false;projection_expiry timestamptz;
BEGIN
 IF action='query' THEN RETURN public.storage_browser_journal_evidence(expected,digest,action,packet_wire);END IF;
 operation:=CASE action WHEN 'activate' THEN 'browser_source_activate' WHEN 'grant' THEN 'browser_source_grant' WHEN 'intent' THEN 'browser_source_intent' WHEN 'admit' THEN 'browser_source_admit' WHEN 'query' THEN 'browser_source_query' WHEN 'expose' THEN 'browser_source_transition' WHEN 'submit' THEN 'browser_source_transition' WHEN 'cancel' THEN 'browser_source_transition' WHEN 'sign' THEN 'browser_source_transition' END;
 IF operation IS NULL THEN RAISE EXCEPTION 'native browser action refused';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,operation);
 IF packet_wire IS NULL OR octet_length(packet_wire)>8388608 THEN RAISE EXCEPTION 'native browser packet bound';END IF;packet:=packet_wire::jsonb;
 IF jsonb_typeof(packet) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'native browser packet refused';END IF;
 SELECT coalesce((SELECT active FROM public.browser_journal_control WHERE id=1),false),coalesce((SELECT active FROM public.browser_signing_v2_control WHERE id=1),false) INTO active,signing_active;
 IF action IN('expose','submit','cancel','sign') THEN
  selected:=CASE WHEN action='state' THEN packet ELSE packet->'selector' END;
  IF (jsonb_typeof(selected)='object' AND selected-'sessionId'-'requestId'-'sourceSessionWire'-'sourceRequestWire'='{}'::jsonb AND jsonb_typeof(selected->'sessionId')='string' AND jsonb_typeof(selected->'requestId')='string' AND octet_length(selected->>'sessionId') BETWEEN 1 AND 1024 AND octet_length(selected->>'requestId') BETWEEN 1 AND 1024
   AND jsonb_typeof(selected->'sourceSessionWire')='string' AND jsonb_typeof(selected->'sourceRequestWire')='string' AND octet_length(selected->>'sourceSessionWire')<=8192 AND octet_length(selected->>'sourceRequestWire')<=8192) IS NOT TRUE THEN RAISE EXCEPTION 'native browser selector refused';END IF;
  SELECT * INTO i FROM public.browser_authorization_intents WHERE session_id=selected->>'sessionId' AND request_id=selected->>'requestId';has_intent:=FOUND;
  IF has_intent THEN
   SELECT * INTO b FROM public.browser_journal_bindings WHERE nonce=i.nonce;has_binding:=FOUND;
   SELECT * INTO e FROM public.payment_events WHERE id='x402:'||i.nonce;has_payment:=FOUND;
   SELECT * INTO original FROM public.browser_signing_originals WHERE nonce=i.nonce;has_original:=FOUND;
   IF has_payment AND has_binding THEN
    SELECT * INTO raw_payment FROM keryx_storage.payment_event_originals WHERE payment_id=e.id;
    IF NOT FOUND OR raw_payment.native_projection IS DISTINCT FROM to_jsonb(e) THEN RAISE EXCEPTION 'native browser payment original unavailable or changed';END IF;
    before_wire:=raw_payment.current_wire::text;
    IF octet_length(before_wire)>1048576 THEN RAISE EXCEPTION 'native browser payment original bound';END IF;
   END IF;
   IF has_original THEN SELECT * INTO q FROM public.browser_signing_queries WHERE query_id=original.query_id;IF FOUND THEN SELECT * INTO n FROM public.browser_signing_namespaces WHERE namespace=q.namespace;END IF;END IF;
   SELECT spent_micro INTO spent FROM public.browser_signer_capacity WHERE browser_signer_capacity.signer=lower(i.signer);
   SELECT spent_micro INTO retained FROM public.browser_retained_grants WHERE grant_epoch=i.grant_epoch AND browser_retained_grants.signer=lower(i.signer);
  END IF;
  SELECT * INTO g FROM public.session_grants WHERE session_id=selected->>'sessionId';
 END IF;

 IF action='intent' THEN
  intent:=packet->'intent';IF jsonb_typeof(intent) IS DISTINCT FROM 'object' OR intent->>'network' IS DISTINCT FROM 'eip155:5042' OR lower(intent->>'token') IS DISTINCT FROM keryx_storage.a2a_original_profile()->>'asset' OR lower(intent->>'gatewayContract') IS DISTINCT FROM keryx_storage.a2a_original_profile()->>'gatewayContract' THEN RAISE EXCEPTION 'native browser intent profile refused';END IF;
  amount:=(intent->>'amountMicroUsdc')::bigint;IF amount<1 OR amount>9007199254740991 OR intent->>'nonce' !~ '^0x[0-9a-f]{64}$' THEN RAISE EXCEPTION 'native browser intent refused';END IF;
  -- Deliberately no journal writer capability: Source legacy admission fails
  -- closed against an already active journal rather than bypassing its fence.
  UPDATE public.session_grants AS sg SET spent=(round(sg.spent*1000000)+amount)::double precision/1000000 WHERE session_id=intent->>'sessionId' AND grant_epoch=intent->>'grantEpoch' AND lower(sess_addr)=lower(intent->>'signer') AND expiry>floor(extract(epoch FROM clock_timestamp())*1000)
   AND abs(sg.cap::double precision*1000000-round(sg.cap::double precision*1000000))<0.000001 AND abs(sg.spent::double precision*1000000-round(sg.spent::double precision*1000000))<0.000001 AND round(sg.spent*1000000)+amount<=round(sg.cap*1000000);GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed=0 THEN PERFORM keryx_storage.leave_operation();RETURN '"grant_or_cap_refused"'::json;END IF;
  INSERT INTO public.browser_authorization_intents(nonce,session_id,request_id,query_id,grant_epoch,signer,network,token,gateway_contract,source_id,offer_id,kind,payee,amount_micro_usdc,phase,created_at) VALUES(intent->>'nonce',intent->>'sessionId',intent->>'requestId',intent->>'queryId',intent->>'grantEpoch',intent->>'signer',intent->>'network',intent->>'token',intent->>'gatewayContract',intent->>'sourceId',intent->>'offerId',intent->>'kind',intent->>'payee',amount,'prepared',intent->>'createdAt');
  PERFORM keryx_storage.leave_operation();RETURN '"admitted"'::json;
 END IF;

 INSERT INTO public.browser_journal_writer VALUES(txid_current()) ON CONFLICT DO NOTHING;
 IF action='grant' THEN
  p:=packet->'grant';signer:=lower(p->>'sessAddr');cap:=(packet->>'capMicros')::bigint;
  IF cap<0 OR cap>9007199254740991 OR p->>'sessAddr' !~* '^0x[0-9a-f]{40}$' OR (p->>'cap')::double precision*1000000-cap>=0.000001 OR abs((p->>'cap')::double precision*1000000-cap)>=0.000001 THEN RAISE EXCEPTION 'native browser grant capacity refused';END IF;
  IF active THEN
   SELECT coalesce((SELECT spent_micro FROM public.browser_signer_capacity WHERE browser_signer_capacity.signer=source_browser.signer),0) INTO spent;
   IF spent>cap THEN RAISE EXCEPTION 'retained browser capacity cannot reset';END IF;
   INSERT INTO public.browser_signer_capacity VALUES(source_browser.signer,0) ON CONFLICT DO NOTHING;
   INSERT INTO public.browser_retained_grants(grant_epoch,session_id,signer,spent_micro) VALUES(p->>'grantEpoch',p->>'sessionId',source_browser.signer,0);
  ELSE spent:=0;END IF;
  INSERT INTO public.session_grants(session_id,sess_addr,owner_addr,cap,spent,expiry,tx_hash,grant_epoch) VALUES(p->>'sessionId',p->>'sessAddr',p->>'ownerAddr',(p->>'cap')::double precision,spent::double precision/1000000,(p->>'expiry')::bigint,p->>'txHash',p->>'grantEpoch')
   ON CONFLICT(session_id) DO UPDATE SET sess_addr=excluded.sess_addr,owner_addr=excluded.owner_addr,cap=excluded.cap,spent=excluded.spent,expiry=excluded.expiry,tx_hash=excluded.tx_hash,grant_epoch=excluded.grant_epoch;
  PERFORM keryx_storage.leave_operation();RETURN 'true'::json;
 END IF;
 IF action='activate' THEN
  IF active THEN PERFORM keryx_storage.leave_operation();RETURN 'true'::json;END IF;
  IF (SELECT count(*) FROM public.session_grants)>1000 OR (SELECT count(*) FROM public.payment_events WHERE grant_epoch IS NOT NULL AND settlement_status IN('pending','settled'))>10000 THEN RAISE EXCEPTION 'native browser activation complete input bound';END IF;
  IF EXISTS(SELECT 1 FROM public.session_grants GROUP BY grant_epoch HAVING count(*)>1) THEN RAISE EXCEPTION 'native browser activation requires Source legacy epoch order qualification';END IF;
  rows_json:='{}'::jsonb;
  FOR g IN SELECT * FROM public.session_grants LOOP
   FOREACH field IN ARRAY ARRAY['cap','spent'] LOOP scaled:=(to_jsonb(g)->>field)::double precision*1000000;rounded:=floor(scaled);IF scaled-rounded>=0.5 THEN rounded:=rounded+1;END IF;IF rounded<0 OR rounded>9007199254740991 OR abs(scaled-rounded)>=0.000001 THEN RAISE EXCEPTION 'legacy browser grant capacity unavailable';END IF;IF field='spent' THEN spent:=rounded::bigint;END IF;END LOOP;
   rows_json:=jsonb_set(rows_json,ARRAY[g.grant_epoch],jsonb_build_object('sessionId',g.session_id,'signer',lower(g.sess_addr),'grantSpent',spent,'paymentSpent',0));
  END LOOP;
  FOR e IN SELECT * FROM public.payment_events WHERE grant_epoch IS NOT NULL AND settlement_status IN('pending','settled') LOOP
   IF e.network IS DISTINCT FROM 'eip155:5042' OR e.payer !~* '^0x[0-9a-f]{40}$' THEN RAISE EXCEPTION 'legacy browser payment identity unavailable';END IF;
   scaled:=e.amount_usdc::double precision*1000000;rounded:=floor(scaled);IF scaled-rounded>=0.5 THEN rounded:=rounded+1;END IF;IF rounded<0 OR rounded>9007199254740991 OR abs(scaled-rounded)>=0.000001 THEN RAISE EXCEPTION 'legacy browser payment amount unavailable';END IF;
   p:=coalesce(rows_json->e.grant_epoch,jsonb_build_object('sessionId','legacy:'||e.grant_epoch,'signer',lower(e.payer),'grantSpent',0,'paymentSpent',0));
   IF p->>'signer' IS DISTINCT FROM lower(e.payer) OR (p->>'paymentSpent')::bigint+rounded::bigint>9007199254740991 THEN RAISE EXCEPTION 'legacy browser epoch unavailable';END IF;
   rows_json:=jsonb_set(rows_json,ARRAY[e.grant_epoch],jsonb_set(p,'{paymentSpent}',to_jsonb((p->>'paymentSpent')::bigint+rounded::bigint)));
  END LOOP;
  FOR current_epoch,p IN SELECT key,value FROM jsonb_each(rows_json) LOOP
   spent:=greatest((p->>'grantSpent')::bigint,(p->>'paymentSpent')::bigint);signer:=p->>'signer';INSERT INTO public.browser_retained_grants VALUES(current_epoch,p->>'sessionId',source_browser.signer,source_browser.spent);
   INSERT INTO public.browser_signer_capacity VALUES(source_browser.signer,source_browser.spent) ON CONFLICT ON CONSTRAINT browser_signer_capacity_pkey DO UPDATE SET spent_micro=browser_signer_capacity.spent_micro+excluded.spent_micro;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.browser_signer_capacity WHERE spent_micro>9007199254740991) THEN RAISE EXCEPTION 'legacy browser signer capacity unavailable';END IF;
  UPDATE public.session_grants SET spent=(SELECT spent_micro::double precision/1000000 FROM public.browser_signer_capacity WHERE browser_signer_capacity.signer=lower(session_grants.sess_addr));UPDATE public.browser_journal_control SET active=true WHERE id=1;
  PERFORM keryx_storage.leave_operation();RETURN 'true'::json;
 END IF;

 IF action='admit' THEN
  IF NOT active THEN PERFORM keryx_storage.leave_operation();RETURN '"inactive"'::json;END IF;
  intent:=packet->'intent';payload:=packet->'payment';source_policy:=packet->'sourcePolicy';requirements:=(packet->>'requirementsWire')::json;metadata:=(packet->>'paymentMetadataWire')::json;context:=(packet->>'paymentContextWire')::json;
  IF packet-'intent'-'requirementsWire'-'paymentMetadataWire'-'paymentContextWire'-'payment'-'sourcePolicy'<>'{}'::jsonb OR jsonb_typeof(intent) IS DISTINCT FROM 'object' OR octet_length(packet->>'requirementsWire')>1048576 OR octet_length(packet->>'paymentMetadataWire')>1048576 OR octet_length(packet->>'paymentContextWire')>1048576 THEN RAISE EXCEPTION 'native browser original capture refused';END IF;
  IF intent->>'network' IS DISTINCT FROM 'eip155:5042' OR lower(intent->>'token') IS DISTINCT FROM keryx_storage.a2a_original_profile()->>'asset' OR lower(intent->>'gateway_contract') IS DISTINCT FROM keryx_storage.a2a_original_profile()->>'gatewayContract'
   OR requirements->>'network' IS DISTINCT FROM intent->>'network' OR lower(requirements->>'asset') IS DISTINCT FROM lower(intent->>'token') OR requirements#>>'{extra,name}' IS DISTINCT FROM 'GatewayWalletBatched' OR requirements#>>'{extra,version}' IS DISTINCT FROM '1' OR lower(requirements#>>'{extra,verifyingContract}') IS DISTINCT FROM lower(intent->>'gateway_contract') OR metadata->>'network' IS DISTINCT FROM intent->>'network' THEN RAISE EXCEPTION 'storage serialized authority profile mismatch';END IF;
  amount:=(intent->>'amount_micro_usdc')::bigint;signer:=lower(intent->>'signer');
  IF intent->>'phase' IS DISTINCT FROM 'prepared' OR metadata->>'id' IS DISTINCT FROM 'x402:'||(intent->>'nonce') OR metadata->>'authorizationId' IS DISTINCT FROM intent->>'nonce' OR metadata->>'createdAt' IS DISTINCT FROM intent->>'created_at' OR metadata->>'authorizationPhase' IS DISTINCT FROM 'prepared' OR metadata->>'settlementStatus' IS DISTINCT FROM 'pending' OR (metadata->'settled')::text IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'browser original producer binding mismatch';END IF;
  IF amount<1 OR amount>9007199254740991 OR intent->>'nonce' !~ '^0x[0-9a-f]{64}$' OR intent->>'kind' NOT IN('fetch','citation') OR requirements->>'scheme' IS DISTINCT FROM 'exact' OR lower(requirements->>'payTo') IS DISTINCT FROM lower(intent->>'payee') OR requirements->>'amount' IS DISTINCT FROM amount::text OR (requirements->>'maxTimeoutSeconds')::integer NOT BETWEEN 604900 AND 691200
   OR metadata->>'kind' IS DISTINCT FROM intent->>'kind' OR metadata->>'queryId' IS DISTINCT FROM intent->>'query_id' OR metadata->>'sourceId' IS DISTINCT FROM intent->>'source_id' OR coalesce(metadata->>'offerId','') IS DISTINCT FROM coalesce(intent->>'offer_id','') OR lower(metadata->>'payer') IS DISTINCT FROM signer OR lower(metadata->>'payee') IS DISTINCT FROM lower(intent->>'payee') OR metadata->>'grantEpoch' IS DISTINCT FROM intent->>'grant_epoch' OR abs((metadata->>'amountUsdc')::double precision*1000000-amount)>0.000001 THEN RAISE EXCEPTION 'browser journal economic tuple differs from challenge';END IF;
  IF (source_policy->>'selector')::jsonb IS DISTINCT FROM jsonb_build_object('sourceId',intent->>'source_id','identity',NULL) OR source_policy->'policySnapshot' IS DISTINCT FROM jsonb_build_object('sourceId',intent->>'source_id','receipt',coalesce(coalesce(context->'sourceClaim',context#>'{item,sourceClaim}')::text::jsonb,'null'::jsonb),'kind',intent->>'kind') OR coalesce(metadata->'sourceClaim','null'::json)::text::jsonb IS DISTINCT FROM coalesce(coalesce(context->'sourceClaim',context#>'{item,sourceClaim}),'null'::json)::text::jsonb THEN RAISE EXCEPTION 'browser journal source claim differs from original context';END IF;
  IF context->'sourceClaim' IS NOT NULL AND context#>'{item,sourceClaim}' IS NOT NULL AND(context->'sourceClaim')::text::jsonb IS DISTINCT FROM(context#>'{item,sourceClaim}')::text::jsonb THEN RAISE EXCEPTION 'browser journal source claim differs from item context';END IF;
  PERFORM keryx_storage.source_claim_purchase_policy('assert',source_policy->>'selector',source_policy);
  SELECT * INTO g FROM public.session_grants WHERE session_id=intent->>'session_id' AND grant_epoch=intent->>'grant_epoch' AND lower(sess_addr)=source_browser.signer AND expiry>floor(extract(epoch FROM clock_timestamp())*1000);
  IF NOT FOUND THEN PERFORM keryx_storage.leave_operation();RETURN '"grant_or_cap_refused"'::json;END IF;
  SELECT spent_micro INTO spent FROM public.browser_signer_capacity WHERE browser_signer_capacity.signer=source_browser.signer;
  scaled:=g.cap::double precision*1000000;rounded:=floor(scaled);IF scaled-rounded>=0.5 THEN rounded:=rounded+1;END IF;IF rounded<0 OR rounded>9007199254740991 OR abs(scaled-rounded)>=0.000001 THEN RAISE EXCEPTION 'browser grant exact capacity unavailable';END IF;
  IF spent IS NULL OR spent+amount>rounded::bigint THEN PERFORM keryx_storage.leave_operation();RETURN '"grant_or_cap_refused"'::json;END IF;
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR payload-'rowWire'-'sha256'-'projection'-'unprojectedFields'<>'{}'::jsonb OR octet_length(payload->>'rowWire')>1048576 OR payload->>'sha256' IS DISTINCT FROM encode(sha256(convert_to(payload->>'rowWire','UTF8')),'hex') THEN RAISE EXCEPTION 'browser payment original capture refused';END IF;
  raw_json:=(payload->>'rowWire')::json;projection:=payload->'projection';SELECT count(*),count(DISTINCT key) INTO counted,distinct_keys FROM json_each(raw_json);IF counted<>27 OR distinct_keys<>27 OR (SELECT count(*) FROM jsonb_object_keys(projection))<>27 THEN RAISE EXCEPTION 'browser payment original field inventory';END IF;
  SELECT coalesce(array_agg(value ORDER BY value),'{}') INTO unprojected FROM jsonb_array_elements_text(payload->'unprojectedFields');
  IF cardinality(unprojected)<>(SELECT count(DISTINCT value) FROM unnest(unprojected)value) OR NOT unprojected<@ARRAY['created_at','source_name','rationale','tx_hash','authorization_expires_at','origin','item_id','item_title','item_url','content_version','item_published_at','offer_id'] THEN RAISE EXCEPTION 'browser payment projection fields refused';END IF;
 FOREACH field IN ARRAY fields LOOP
    IF field=ANY(ARRAY['amount_usdc','weight','list_price_usdc']) THEN
     IF (before_json->>field)::double precision IS DISTINCT FROM (after_json->>field)::double precision THEN RAISE EXCEPTION 'native payment immutable amount changed';END IF;
    ELSIF field<>ALL(ARRAY['settled','settlement_status','authorization_phase','tx_hash']) AND (before_json->field)::text IS DISTINCT FROM (after_json->field)::text THEN RAISE EXCEPTION 'native payment immutable original changed';END IF;
   END LOOP;
  IF cardinality(unprojected)>0 AND strpos(pg_get_functiondef('keryx_storage.require_operation(jsonb,text,text)'::regprocedure),'Native payment raw observation guard v1')=0 THEN RAISE EXCEPTION 'native payment raw observation guard unavailable';END IF;
  IF projection->>'id' IS DISTINCT FROM 'x402:'||(intent->>'nonce') OR projection->>'authorization_id' IS DISTINCT FROM intent->>'nonce' OR projection->>'authorization_phase' IS DISTINCT FROM 'prepared' OR projection->>'settlement_status' IS DISTINCT FROM 'pending' OR projection->'settled' IS DISTINCT FROM '0'::jsonb OR projection->>'grant_epoch' IS DISTINCT FROM intent->>'grant_epoch' OR projection->>'network' IS DISTINCT FROM intent->>'network' OR lower(projection->>'payer') IS DISTINCT FROM signer OR lower(projection->>'payee') IS DISTINCT FROM lower(intent->>'payee') OR projection->>'source_id' IS DISTINCT FROM intent->>'source_id' OR projection->>'query_id' IS DISTINCT FROM intent->>'query_id' OR projection->>'kind' IS DISTINCT FROM intent->>'kind' OR (projection->>'amount_usdc')::double precision IS DISTINCT FROM(metadata->>'amountUsdc')::double precision OR projection->'tx_hash' IS DISTINCT FROM 'null'::jsonb OR projection->'authorization_expires_at' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'browser payment original tuple mismatch';END IF;
  projection:=jsonb_set(projection,'{settled}','false'::jsonb);SELECT * INTO after_e FROM jsonb_populate_record(NULL::public.payment_events,projection);
  INSERT INTO public.browser_authorization_intents SELECT * FROM jsonb_populate_record(NULL::public.browser_authorization_intents,intent);
  INSERT INTO public.browser_journal_bindings(nonce,requirements,payment_metadata) VALUES(intent->>'nonce',packet->>'requirementsWire',packet->>'paymentMetadataWire');
  INSERT INTO public.payment_events SELECT(after_e).*;
  IF packet->>'paymentContextWire' IS NOT NULL THEN UPDATE public.browser_journal_bindings SET payment_context=packet->>'paymentContextWire' WHERE nonce=intent->>'nonce';END IF;
  INSERT INTO keryx_storage.payment_event_originals(payment_id,original_wire,original_sha256,current_wire,current_sha256,native_projection,unprojected_fields) VALUES(after_e.id,raw_json,payload->>'sha256',raw_json,payload->>'sha256',to_jsonb(after_e),unprojected);
  UPDATE public.browser_signer_capacity SET spent_micro=spent_micro+amount WHERE browser_signer_capacity.signer=source_browser.signer;UPDATE public.browser_retained_grants SET spent_micro=spent_micro+amount WHERE grant_epoch=intent->>'grant_epoch';
  IF (SELECT count(*) FROM public.session_grants WHERE lower(sess_addr)=source_browser.signer)>1000 THEN RAISE EXCEPTION 'browser signer alias bound';END IF;UPDATE public.session_grants SET spent=(source_browser.spent+amount)::double precision/1000000 WHERE lower(sess_addr)=source_browser.signer;
  PERFORM keryx_storage.leave_operation();RETURN '"admitted"'::json;
 END IF;

 IF NOT(has_intent AND has_binding AND has_payment) THEN PERFORM keryx_storage.leave_operation();RETURN 'false'::json;END IF;
 current_json:=before_wire::json;unprojected:=raw_payment.unprojected_fields;target_phase:=e.authorization_phase;status:=e.settlement_status;
 IF action IN('expose','submit') THEN
  IF e.authorization_phase IS DISTINCT FROM CASE action WHEN 'expose' THEN 'prepared' ELSE 'signed' END OR e.settlement_status IS DISTINCT FROM 'pending' THEN PERFORM keryx_storage.leave_operation();RETURN 'false'::json;END IF;
  target_phase:=CASE action WHEN 'expose' THEN 'exposed' ELSE 'submission_attempted' END;
 ELSIF action='cancel' THEN
  IF e.authorization_phase IS DISTINCT FROM 'prepared' OR e.settlement_status IS DISTINCT FROM 'pending' THEN PERFORM keryx_storage.leave_operation();RETURN 'false'::json;END IF;
  target_phase:='cancelled_unexposed';status:='failed';release_capacity:=true;
 ELSIF action='sign' THEN
  IF e.authorization_phase IS NULL OR e.authorization_phase NOT IN('exposed','signed','submission_attempted','settled','failed') THEN PERFORM keryx_storage.leave_operation();RETURN 'false'::json;END IF;
  metadata_raw:=(packet->>'metadataWire')::json;canonical:=(packet->>'canonical')::boolean;
  IF has_original AND NOT canonical THEN PERFORM keryx_storage.leave_operation();RETURN 'false'::json;END IF;
  IF canonical AND(NOT has_original OR packet->>'originalSha256' IS DISTINCT FROM encode(sha256(convert_to(original.original,'UTF8')),'hex')) THEN RAISE EXCEPTION 'browser immutable signing original changed';END IF;
  IF coalesce(b.header_hash,'')<>'' THEN PERFORM keryx_storage.leave_operation();RETURN to_json(to_json(b.header_hash)::text=(metadata_raw->'headerHash')::text AND to_json(b.valid_after)::text=(metadata_raw->'validAfter')::text AND to_json(b.valid_before)::text=(metadata_raw->'validBefore')::text);END IF;
  IF e.authorization_phase<>'exposed' THEN PERFORM keryx_storage.leave_operation();RETURN 'false'::json;END IF;
  IF has_original AND((metadata_raw->'validAfter')::text IS DISTINCT FROM(original.original::json#>'{authorization,validAfter}')::text OR (metadata_raw->'validBefore')::text IS DISTINCT FROM(original.original::json#>'{authorization,validBefore}')::text) THEN PERFORM keryx_storage.leave_operation();RETURN 'false'::json;END IF;
  FOR field IN SELECT unnest(ARRAY['validAfter','validBefore','headerHash']) LOOP IF json_typeof(metadata_raw->field) IS DISTINCT FROM 'string' OR octet_length((metadata_raw->field)::text)>8192 THEN RAISE EXCEPTION 'native browser signed metadata refused';END IF;END LOOP;
  -- Source TEXT binding replaces lone UTF-16, while replay above compares the
  -- original caller strings. Tokenization distinguishes literal backslashes.
  normalized:='';high_surrogate:=NULL;
  FOR escaped IN SELECT token[1] FROM regexp_matches(packet->>'metadataWire',$source_token$(\\(?:u[0-9a-fA-F]{4}|["\\/bfnrt])|[^\\]+)$source_token$,'g') tokens(token) LOOP
   code_point:=CASE WHEN length(escaped)=6 AND substr(escaped,1,2)=chr(92)||'u' THEN ('x'||substr(escaped,3,4))::bit(16)::integer END;
   IF high_surrogate IS NOT NULL THEN
    IF code_point BETWEEN 56320 AND 57343 THEN normalized:=normalized||chr(65536+(high_surrogate-55296)*1024+code_point-56320);high_surrogate:=NULL;CONTINUE;END IF;
    normalized:=normalized||chr(92)||'ufffd';high_surrogate:=NULL;
   END IF;
   IF code_point BETWEEN 55296 AND 56319 THEN high_surrogate:=code_point;
   ELSIF code_point BETWEEN 56320 AND 57343 THEN normalized:=normalized||chr(92)||'ufffd';
   ELSE normalized:=normalized||escaped;END IF;
  END LOOP;
  IF high_surrogate IS NOT NULL THEN normalized:=normalized||chr(92)||'ufffd';END IF;
  metadata:=normalized::json;
  -- NUL in a Source scalar is unrepresentable here and must refuse, never be
  -- erased or replaced by relational NULL. Serialized originals remain raw.
  PERFORM metadata->>'validAfter',metadata->>'validBefore',metadata->>'headerHash';
  -- JS Number(string) and TimeClip for decimal and explicit radix forms. Dates
  -- are rendered with integer civil arithmetic, retaining expanded years too.
  number_text:=keryx_storage.a2a_trim(metadata->>'validBefore');base:=0;
  IF number_text='' THEN before_number:=0;
  ELSIF number_text ~ '^0[xX][0-9a-fA-F]+$' THEN base:=16;digits:=substr(number_text,3);
  ELSIF number_text ~ '^0[bB][01]+$' THEN base:=2;digits:=substr(number_text,3);
  ELSIF number_text ~ '^0[oO][0-7]+$' THEN base:=8;digits:=substr(number_text,3);
  ELSIF number_text ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' THEN before_number:=number_text::double precision;
  ELSE RAISE EXCEPTION 'native browser Source signed expiry unavailable';END IF;
  IF base<>0 THEN before_number:=0;IF length(digits)>64 THEN RAISE EXCEPTION 'native browser Source signed expiry unavailable';END IF;FOR position IN 1..length(digits) LOOP digit:=strpos('0123456789abcdef',lower(substr(digits,position,1)))-1;before_number:=before_number*base+digit;END LOOP;END IF;
  scaled:=before_number*1000;IF scaled='NaN'::double precision OR abs(scaled)>8640000000000000 THEN RAISE EXCEPTION 'native browser Source signed expiry unavailable';END IF;milliseconds:=trunc(scaled)::bigint;
  day_number:=floor(milliseconds::numeric/86400000)+719468;era:=floor(day_number::numeric/146097);doe:=day_number-era*146097;yoe:=floor((doe-floor(doe::numeric/1460)+floor(doe::numeric/36524)-floor(doe::numeric/146096))/365);year_number:=yoe+era*400;doy:=doe-(365*yoe+floor(yoe::numeric/4)-floor(yoe::numeric/100));mp:=floor((5*doy+2)::numeric/153);day_month:=doy-floor((153*mp+2)::numeric/5)+1;month_number:=mp+CASE WHEN mp<10 THEN 3 ELSE -9 END;year_number:=year_number+CASE WHEN month_number<=2 THEN 1 ELSE 0 END;day_ms:=milliseconds-floor(milliseconds::numeric/86400000)*86400000;
  stamp:=CASE WHEN year_number BETWEEN 0 AND 9999 THEN lpad(year_number::text,4,'0') ELSE CASE WHEN year_number<0 THEN '-' ELSE '+' END||lpad(abs(year_number)::text,6,'0') END||'-'||lpad(month_number::text,2,'0')||'-'||lpad(day_month::text,2,'0')||'T'||lpad(floor(day_ms::numeric/3600000)::text,2,'0')||':'||lpad((floor(day_ms::numeric/60000)::bigint%60)::text,2,'0')||':'||lpad((floor(day_ms::numeric/1000)::bigint%60)::text,2,'0')||'.'||lpad((day_ms%1000)::text,3,'0')||'Z';
  IF year_number BETWEEN 1 AND 9999 THEN projection_expiry:=stamp::timestamptz;unprojected:=array_remove(unprojected,'authorization_expires_at');ELSE projection_expiry:=NULL;IF NOT 'authorization_expires_at'=ANY(unprojected) THEN unprojected:=array_append(unprojected,'authorization_expires_at');END IF;END IF;
  IF canonical THEN INSERT INTO public.browser_signing_v2_writer VALUES(txid_current()) ON CONFLICT DO NOTHING;END IF;
  UPDATE public.browser_journal_bindings SET valid_after=metadata->>'validAfter',valid_before=metadata->>'validBefore',header_hash=metadata->>'headerHash' WHERE nonce=i.nonce AND header_hash IS NULL;
  target_phase:='signed';update_expiry:=true;
 END IF;
 IF cardinality(unprojected)>0 AND strpos(pg_get_functiondef('keryx_storage.require_operation(jsonb,text,text)'::regprocedure),'Native payment raw observation guard v1')=0 THEN RAISE EXCEPTION 'native payment raw observation guard unavailable';END IF;
 UPDATE public.payment_events SET authorization_phase=target_phase,settlement_status=status,authorization_expires_at=CASE WHEN update_expiry THEN projection_expiry ELSE authorization_expires_at END WHERE id=e.id AND authorization_phase=e.authorization_phase AND settlement_status='pending';GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN DELETE FROM public.browser_signing_v2_writer WHERE transaction_id=txid_current();PERFORM keryx_storage.leave_operation();RETURN 'false'::json;END IF;
 IF release_capacity THEN
  metadata:=b.payment_metadata::json;scaled:=(metadata->>'amountUsdc')::double precision*1000000;rounded:=floor(scaled);IF scaled-rounded>=0.5 THEN rounded:=rounded+1;END IF;
  IF rounded<0 OR rounded>9007199254740991 OR abs(scaled-rounded)>=0.000001 THEN RAISE EXCEPTION 'retained browser original amount unavailable';END IF;
  UPDATE public.browser_retained_grants SET spent_micro=spent_micro-rounded::bigint WHERE grant_epoch=i.grant_epoch AND browser_retained_grants.signer=lower(i.signer) AND spent_micro>=rounded::bigint;GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>1 THEN RAISE EXCEPTION 'retained browser epoch capacity mismatch';END IF;
  UPDATE public.browser_signer_capacity SET spent_micro=spent_micro-rounded::bigint WHERE browser_signer_capacity.signer=lower(i.signer) AND spent_micro>=rounded::bigint RETURNING spent_micro INTO retained;GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>1 THEN RAISE EXCEPTION 'retained browser signer capacity mismatch';END IF;
  IF (SELECT count(*) FROM public.session_grants WHERE lower(sess_addr)=lower(i.signer))>1000 THEN RAISE EXCEPTION 'browser signer alias bound';END IF;UPDATE public.session_grants SET spent=retained::double precision/1000000 WHERE lower(sess_addr)=lower(i.signer);
 END IF;
 SELECT json_object_agg(key,CASE key WHEN 'authorization_phase' THEN to_json(target_phase) WHEN 'settlement_status' THEN to_json(status) WHEN 'authorization_expires_at' THEN CASE WHEN update_expiry THEN to_json(stamp) ELSE value END ELSE value END) INTO updated_json FROM json_each(current_json);
 SELECT * INTO after_e FROM public.payment_events WHERE id=e.id;
 UPDATE keryx_storage.payment_event_originals SET current_wire=updated_json,current_sha256=encode(sha256(convert_to(updated_json::text,'UTF8')),'hex'),native_projection=to_jsonb(after_e),unprojected_fields=unprojected WHERE payment_id=e.id;
 DELETE FROM public.browser_signing_v2_writer WHERE transaction_id=txid_current();PERFORM keryx_storage.leave_operation();RETURN 'true'::json;
END;$$;
REVOKE ALL ON FUNCTION public.storage_browser_journal(jsonb,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_browser_journal(jsonb,text,text,text) TO keryx_app,keryx_reader;
RESET ROLE;
