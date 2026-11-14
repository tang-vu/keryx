-- Native Arc original claims and prepaid allocations only. No settlement,
-- signing, provider execution, funding or installed-writer authority is granted.
SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('research_purchase_claim',ARRAY['research_purchase_authorizations','sync_state'],true,false),
 ('research_monthly_create',ARRAY['research_purchase_authorizations','research_monthly','sync_state'],true,false),
 ('research_monthly_get',ARRAY['research_monthly','research_monthly_redemptions','acceptance_original_projection'],true,true),
 ('research_monthly_redeem',ARRAY['research_monthly','research_monthly_redemptions','a2a_orders','deliverable_acceptance_store','acceptance_original_projection'],true,false);
CREATE FUNCTION public.storage_research_purchases(expected jsonb,digest text,action text,packet_wire text,accepted_at text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE packet jsonb;proposed jsonb;p jsonb;r jsonb;req jsonb;projection jsonb;redemptions jsonb;result json;
 c public.research_purchase_authorizations;retained public.research_purchase_authorizations;o public.a2a_orders;saved public.a2a_orders;redemption public.research_monthly_redemptions;
 profile jsonb:=keryx_storage.a2a_original_profile();operation text;field text;chosen_id text;store text;order_wire text;package jsonb;preimage text;required boolean;existed boolean;used integer;challenge jsonb;now_seconds bigint:=floor(extract(epoch FROM clock_timestamp()));
BEGIN
 operation:=CASE action WHEN 'claim' THEN 'research_purchase_claim' WHEN 'create' THEN 'research_monthly_create' WHEN 'get' THEN 'research_monthly_get' WHEN 'redeem' THEN 'research_monthly_redeem' END;
 IF operation IS NULL THEN RAISE EXCEPTION 'native research operation refused';END IF;
 IF action='get' AND current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native monthly readonly transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,operation);
 IF packet_wire IS NULL OR octet_length(packet_wire)>262144 OR action<>'redeem' AND accepted_at IS NOT NULL THEN RAISE EXCEPTION 'native research packet bound';END IF;
 packet:=packet_wire::jsonb;IF jsonb_typeof(packet) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'native research packet refused';END IF;
 IF action='claim' THEN
  r:=packet->'row';required:=(packet->>'required')::boolean;
  IF (packet-'row'-'required'-'sourcePolicyCapture'='{}'::jsonb AND jsonb_typeof(packet->'required')='boolean' AND jsonb_typeof(r)='object'
   AND r-'network'-'asset'-'payer'-'payee'-'authorization_id'-'product'-'purchase_id'-'request_hash'-'amount_micros'-'issued_data'='{}'::jsonb) IS NOT TRUE THEN RAISE EXCEPTION 'native claim packet refused';END IF;
  FOREACH field IN ARRAY ARRAY['network','asset','payer','payee','authorization_id','product','purchase_id','request_hash'] LOOP
   IF jsonb_typeof(r->field) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'native claim field refused';END IF;
  END LOOP;
  IF (r->>'network'=profile->>'network' AND r->>'asset'=profile->>'asset' AND r->>'payer' ~ '^0x[a-f0-9]{40}$' AND r->>'payee' ~ '^0x[a-f0-9]{40}$'
   AND keryx_storage.a2a_utf16_length(r->>'authorization_id') BETWEEN 1 AND 256 AND lower(r->>'authorization_id')=r->>'authorization_id'
   AND r->>'product' IN('a2a','monthly','resource') AND r->>'request_hash' ~ '^[a-f0-9]{64}$' AND jsonb_typeof(r->'amount_micros')='number'
   AND r->>'amount_micros' ~ '^[1-9][0-9]{0,15}$' AND (r->>'amount_micros')::numeric<=9007199254740991
   AND r->>'purchase_id'=CASE r->>'product' WHEN 'monthly' THEN 'monthly_' ELSE 'a2a_' END||encode(sha256(convert_to('keryx-a2a-v2|'||(r->>'network')||'|'||(r->>'payer')||'|'||(r->>'payee')||'|'||(r->>'authorization_id'),'UTF8')),'hex')
   AND r ? 'issued_data') IS NOT TRUE THEN RAISE EXCEPTION 'native claim contract refused';END IF;
  challenge:=nullif(r->'issued_data','null'::jsonb);
  IF required AND(challenge IS NULL OR r->>'product'<>'monthly') THEN RAISE EXCEPTION 'issued Monthly authorization required';END IF;
  IF challenge IS NOT NULL THEN
   IF (r->>'product'='monthly' AND jsonb_typeof(challenge)='object' AND challenge-'validAfter'-'validBefore'-'expiresAt'='{}'::jsonb) IS NOT TRUE THEN RAISE EXCEPTION 'issued Monthly window refused';END IF;
   FOREACH field IN ARRAY ARRAY['validAfter','validBefore','expiresAt'] LOOP
    IF (jsonb_typeof(challenge->field)='string' AND challenge->>field ~ '^(0|[1-9][0-9]{0,15})$') IS NOT TRUE THEN RAISE EXCEPTION 'issued Monthly epoch refused';END IF;
   END LOOP;
   IF (challenge->>'validBefore')::numeric-(challenge->>'validAfter')::numeric NOT BETWEEN 604800 AND 2592000
    OR (challenge->>'expiresAt')::numeric<=(challenge->>'validAfter')::numeric OR (challenge->>'expiresAt')::numeric>=(challenge->>'validBefore')::numeric
    OR NOT required AND((challenge->>'validAfter')::numeric<now_seconds-660 OR now_seconds<=(challenge->>'validAfter')::numeric OR (challenge->>'validBefore')::numeric<now_seconds+604800 OR (challenge->>'expiresAt')::numeric<=now_seconds OR (challenge->>'expiresAt')::numeric>now_seconds+660)
   THEN RAISE EXCEPTION 'issued Monthly authorization expired or invalid';END IF;
  END IF;
  SELECT * INTO retained FROM public.research_purchase_authorizations WHERE network=r->>'network' AND asset=r->>'asset' AND payer=r->>'payer' AND authorization_id=r->>'authorization_id' FOR UPDATE;existed:=FOUND;
  projection:=packet->'sourcePolicyCapture';
  IF ((projection->>'selector')::jsonb->'identity'=jsonb_build_object('network',r->>'network','payer',r->>'payer','authorizationId',r->>'authorization_id')) IS NOT TRUE THEN RAISE EXCEPTION 'source policy claim identity mismatch';END IF;
  -- The shared helper recomputes its complete retained Source snapshot under
  -- this writer lock before publishing immutable policy beside this claim.
  PERFORM keryx_storage.source_claim_purchase_policy('purchase',projection->>'selector',projection);
  IF NOT existed AND NOT required THEN
   INSERT INTO public.research_purchase_authorizations(network,asset,payer,payee,authorization_id,product,purchase_id,request_hash,amount_micros,issued_data)
    VALUES(r->>'network',r->>'asset',r->>'payer',r->>'payee',r->>'authorization_id',r->>'product',r->>'purchase_id',r->>'request_hash',(r->>'amount_micros')::bigint,CASE WHEN challenge IS NULL THEN NULL ELSE challenge||'{"submitted":false}'::jsonb END);
   SELECT * INTO retained FROM public.research_purchase_authorizations WHERE network=r->>'network' AND asset=r->>'asset' AND payer=r->>'payer' AND authorization_id=r->>'authorization_id';existed:=FOUND;
  END IF;
  IF NOT existed OR to_jsonb(retained)-'issued_data' IS DISTINCT FROM r-'issued_data' THEN RAISE EXCEPTION 'research authorization claim conflict';END IF;
  p:=retained.issued_data;
  IF p IS NOT NULL THEN
   IF (jsonb_typeof(p)='object' AND p-'validAfter'-'validBefore'-'expiresAt'-'submitted'='{}'::jsonb AND jsonb_typeof(p->'submitted')='boolean') IS NOT TRUE THEN RAISE EXCEPTION 'invalid stored issued challenge';END IF;
   FOREACH field IN ARRAY ARRAY['validAfter','validBefore','expiresAt'] LOOP
    IF (jsonb_typeof(p->field)='string' AND p->>field ~ '^(0|[1-9][0-9]{0,15})$') IS NOT TRUE THEN RAISE EXCEPTION 'invalid stored issued epoch';END IF;
   END LOOP;
   IF (p->>'validBefore')::numeric-(p->>'validAfter')::numeric NOT BETWEEN 604800 AND 2592000 OR (p->>'expiresAt')::numeric<=(p->>'validAfter')::numeric OR (p->>'expiresAt')::numeric>=(p->>'validBefore')::numeric THEN RAISE EXCEPTION 'invalid stored issued period';END IF;
  END IF;
  IF required AND p IS NULL OR challenge IS NOT NULL AND (p IS NULL OR p-'submitted' IS DISTINCT FROM challenge) THEN RAISE EXCEPTION 'issued Monthly authorization mismatch';END IF;
  IF required AND p->'submitted'='false'::jsonb THEN
   IF now_seconds<=(p->>'validAfter')::numeric OR now_seconds>=(p->>'validBefore')::numeric OR now_seconds>=(p->>'expiresAt')::numeric THEN RAISE EXCEPTION 'issued Monthly authorization expired';END IF;
   UPDATE public.research_purchase_authorizations SET issued_data=jsonb_set(issued_data,'{submitted}','true'::jsonb) WHERE network=retained.network AND asset=retained.asset AND payer=retained.payer AND authorization_id=retained.authorization_id;
  END IF;
  PERFORM keryx_storage.leave_operation();RETURN 'true'::json;
 END IF;
 IF action='create' THEN
  IF packet-'purchase'-'sourcePolicyCapture'<>'{}'::jsonb THEN RAISE EXCEPTION 'monthly create packet refused';END IF;proposed:=packet->'purchase';chosen_id:=proposed->>'id';
 ELSE
  chosen_id:=packet->>CASE action WHEN 'get' THEN 'id' ELSE 'monthlyId' END;
  IF action='get' AND packet-'id'<>'{}'::jsonb THEN RAISE EXCEPTION 'monthly selector refused';END IF;
 END IF;
 IF chosen_id IS NULL OR chosen_id !~ '^monthly_[a-f0-9]{64}$' THEN RAISE EXCEPTION 'monthly identity refused';END IF;
 SELECT data INTO p FROM public.research_monthly WHERE id=chosen_id;existed:=FOUND;
 IF NOT existed THEN
  IF action='get' THEN RETURN NULL;END IF;
  IF action<>'create' THEN RAISE EXCEPTION 'Monthly purchase unavailable';END IF;p:=proposed;
 END IF;
 -- Revalidate retained contracts and contiguous slots before replay or creation.
 IF (jsonb_typeof(p)='object' AND p-'format'-'network'-'asset'-'gatewayContract'-'id'-'payer'-'payee'-'authorizationId'-'transaction'-'quoteId'-'createdAt'-'expiresAt'-'creatorBudgetMicros'-'serviceFeeMicros'-'totalMicros'-'researchPackage'='{}'::jsonb
  AND p->>'format'='keryx-research-monthly-purchase-v2' AND p->>'network'=profile->>'network' AND p->>'asset'=profile->>'asset' AND p->>'gatewayContract'=profile->>'gatewayContract' AND p->>'id'=chosen_id) IS NOT TRUE THEN RAISE EXCEPTION 'invalid Monthly purchase rail';END IF;
 FOREACH field IN ARRAY ARRAY['payer','payee','authorizationId','transaction','quoteId','createdAt','expiresAt'] LOOP
  IF jsonb_typeof(p->field) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'invalid Monthly purchase field';END IF;
 END LOOP;
 FOREACH field IN ARRAY ARRAY['creatorBudgetMicros','serviceFeeMicros','totalMicros'] LOOP
  IF (jsonb_typeof(p->field)='number' AND p->>field ~ '^[1-9][0-9]{0,15}$' AND (p->>field)::numeric<=9007199254740991) IS NOT TRUE THEN RAISE EXCEPTION 'invalid Monthly purchase amount';END IF;
 END LOOP;
 IF (p->>'payer' ~ '^0x[0-9a-fA-F]{40}$' AND p->>'payee' ~ '^0x[0-9a-fA-F]{40}$' AND keryx_storage.a2a_utf16_length(p->>'authorizationId') BETWEEN 1 AND 256
  AND keryx_storage.a2a_utf16_length(p->>'transaction') BETWEEN 1 AND 512 AND p->>'quoteId' ~ '^[a-f0-9]{64}$'
  AND p->>'id'='monthly_'||encode(sha256(convert_to('keryx-a2a-v2|'||(profile->>'network')||'|'||lower(p->>'payer')||'|'||lower(p->>'payee')||'|'||lower(p->>'authorizationId'),'UTF8')),'hex')
  AND (p->>'totalMicros')::numeric=4*(p->>'creatorBudgetMicros')::numeric+(p->>'serviceFeeMicros')::numeric AND mod((p->>'serviceFeeMicros')::numeric,4)=0
  AND p->>'createdAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:?[0-9]{2})$'
  AND p->>'expiresAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:?[0-9]{2})$'
  AND extract(epoch FROM(date_trunc('milliseconds',(p->>'expiresAt')::timestamptz)-date_trunc('milliseconds',(p->>'createdAt')::timestamptz)))=2592000
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(keryx_storage.a2a_original_packages()) value WHERE value->'wire'=p->'researchPackage')
  AND (NOT existed OR EXISTS(SELECT 1 FROM public.research_monthly WHERE id=chosen_id AND payer=lower(p->>'payer')))) IS NOT TRUE THEN RAISE EXCEPTION 'invalid Monthly purchase contract';END IF;
 SELECT count(*) INTO used FROM public.research_monthly_redemptions WHERE monthly_id=chosen_id;
 IF used>4 OR EXISTS(SELECT 1 FROM(SELECT *,row_number() OVER(ORDER BY slot)-1 expected_slot FROM public.research_monthly_redemptions WHERE monthly_id=chosen_id) x
  WHERE slot<>expected_slot OR request_id !~ '^[A-Za-z0-9_-]{1,128}$' OR request_hash !~ '^[a-f0-9]{64}$'
   OR order_id<>'a2a_'||encode(sha256(convert_to('["keryx-monthly-redemption-v1",'||to_json(chosen_id)::text||','||to_json(request_id)::text||']','UTF8')),'hex')
   OR date_trunc('milliseconds',created_at)<date_trunc('milliseconds',(p->>'createdAt')::timestamptz) OR date_trunc('milliseconds',created_at)>=date_trunc('milliseconds',(p->>'expiresAt')::timestamptz)) THEN RAISE EXCEPTION 'invalid stored Monthly redemptions';END IF;
 IF action='get' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('requestId',d.request_id,'orderId',d.order_id,'requestHash',d.request_hash,'createdAt',coalesce(a.source_order_wire::jsonb->>'created_at',to_char(d.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),'slot',d.slot) ORDER BY d.slot),'[]'::jsonb) INTO redemptions
   FROM public.research_monthly_redemptions d LEFT JOIN keryx_storage.acceptance_original_projection a ON a.order_id=d.order_id WHERE d.monthly_id=chosen_id;
  RETURN json_build_object('purchase',p,'redemptions',redemptions);
 END IF;
 IF action='create' THEN
  IF existed THEN
   IF p-'payer'-'payee'-'authorizationId' IS DISTINCT FROM proposed-'payer'-'payee'-'authorizationId' OR lower(p->>'payer') IS DISTINCT FROM lower(proposed->>'payer') OR lower(p->>'payee') IS DISTINCT FROM lower(proposed->>'payee') OR lower(p->>'authorizationId') IS DISTINCT FROM lower(proposed->>'authorizationId') THEN RAISE EXCEPTION 'Monthly purchase replay conflict';END IF;
  ELSE
   SELECT * INTO c FROM public.research_purchase_authorizations WHERE network=profile->>'network' AND asset=profile->>'asset' AND payer=lower(p->>'payer') AND authorization_id=lower(p->>'authorizationId');
   IF NOT FOUND OR c.product<>'monthly' OR c.purchase_id<>chosen_id OR c.payee<>lower(p->>'payee') OR c.request_hash<>p->>'quoteId' OR c.amount_micros<>(p->>'totalMicros')::numeric OR c.issued_data->'submitted' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'submitted original Monthly challenge required';END IF;
   challenge:=c.issued_data;
   IF (jsonb_typeof(challenge)='object' AND challenge-'validAfter'-'validBefore'-'expiresAt'-'submitted'='{}'::jsonb) IS NOT TRUE THEN RAISE EXCEPTION 'invalid submitted Monthly original';END IF;
   FOREACH field IN ARRAY ARRAY['validAfter','validBefore','expiresAt'] LOOP
    IF (jsonb_typeof(challenge->field)='string' AND challenge->>field ~ '^(0|[1-9][0-9]{0,15})$') IS NOT TRUE THEN RAISE EXCEPTION 'invalid submitted Monthly epoch';END IF;
   END LOOP;
   IF (challenge->>'validBefore')::numeric-(challenge->>'validAfter')::numeric NOT BETWEEN 604800 AND 2592000 OR (challenge->>'expiresAt')::numeric<=(challenge->>'validAfter')::numeric OR (challenge->>'expiresAt')::numeric>=(challenge->>'validBefore')::numeric THEN RAISE EXCEPTION 'invalid submitted Monthly period';END IF;
   projection:=packet->'sourcePolicyCapture';
   IF ((projection->>'selector')::jsonb->'identity'=jsonb_build_object('network',p->>'network','payer',lower(p->>'payer'),'authorizationId',lower(p->>'authorizationId'))
    AND (projection->>'selector')::jsonb->'sourceId'='null'::jsonb AND projection->'existing'='true'::jsonb) IS NOT TRUE THEN RAISE EXCEPTION 'Monthly source policy identity mismatch';END IF;
   PERFORM keryx_storage.source_claim_purchase_policy('purchase',projection->>'selector',projection);
   INSERT INTO public.research_monthly(id,payer,data) VALUES(chosen_id,lower(p->>'payer'),p);
  END IF;
  result:=json_build_object('created',NOT existed,'purchase',p);PERFORM keryx_storage.leave_operation();RETURN result;
 END IF;
 IF (packet-'monthlyId'-'payer'-'requestId'-'rowWire'-'projection'='{}'::jsonb AND jsonb_typeof(packet->'payer')='string' AND lower(packet->>'payer')=lower(p->>'payer') AND packet->>'requestId' ~ '^[A-Za-z0-9_-]{1,128}$'
  AND jsonb_typeof(packet->'rowWire')='string' AND octet_length(packet->>'rowWire')<=65536 AND accepted_at IS NOT NULL) IS NOT TRUE THEN RAISE EXCEPTION 'Monthly redemption packet refused';END IF;
 r:=(packet->>'rowWire')::jsonb;projection:=packet->'projection';
 IF (jsonb_typeof(r)='object' AND jsonb_typeof(r->'request_data')='string' AND jsonb_typeof(r->'package_data')='string' AND r->>'created_at'=r->>'updated_at') IS NOT TRUE THEN RAISE EXCEPTION 'Monthly order body refused';END IF;
 r:=jsonb_set(jsonb_set(r,'{request_data}',(r->>'request_data')::jsonb),'{package_data}',(r->>'package_data')::jsonb);SELECT * INTO o FROM jsonb_populate_record(NULL::public.a2a_orders,r);req:=o.request_data;
 SELECT value INTO package FROM jsonb_array_elements(keryx_storage.a2a_original_packages()) value WHERE value->'wire'=o.package_data AND value->'wire'->>'researchMode'=o.research_mode;
 IF (o.id='a2a_'||encode(sha256(convert_to('["keryx-monthly-redemption-v1",'||to_json(chosen_id)::text||','||to_json(packet->>'requestId')::text||']','UTF8')),'hex') AND o.query_id=o.id
  AND o.authorization_id=(p->>'authorizationId')||':monthly:'||(packet->>'requestId') AND lower(o.payer)=lower(p->>'payer') AND lower(o.payee)=lower(p->>'payee') AND o.transaction_id=p->>'transaction'
  AND o.creator_budget_usdc::double precision=(p->>'creatorBudgetMicros')::double precision/1000000 AND o.service_fee_usdc::double precision=(p->>'serviceFeeMicros')::double precision/4/1000000 AND o.amount_usdc::double precision=(p->>'totalMicros')::double precision/4/1000000
  AND package IS NOT NULL AND o.package_data=p->'researchPackage' AND req->>'origin'='a2a' AND req->>'network'=profile->>'network' AND req->>'monthlyId'=chosen_id
  AND jsonb_typeof(req->'question')='string' AND keryx_storage.a2a_trim(req->>'question')<>'' AND keryx_storage.a2a_utf16_length(req->>'question')<=10000
  AND (NOT req?'model' OR jsonb_typeof(req->'model')='string' AND keryx_storage.a2a_utf16_length(req->>'model')<=256)
  AND o.status='running' AND o.started_at IS NULL AND o.worker_id IS NULL AND o.execution_journal_version=1 AND o.payment_started_at IS NULL AND o.result_saving_at IS NULL AND o.response_data IS NULL AND o.error_code IS NULL AND o.resolution_data IS NULL AND o.created_at=o.updated_at) IS NOT TRUE THEN RAISE EXCEPTION 'Monthly redemption contract mismatch';END IF;
 preimage:='{"question":'||to_json(req->>'question')::text||',"creatorBudgetUsdc6":'||(p->>'creatorBudgetMicros')||',"serviceFeeUsdc6":'||((p->>'serviceFeeMicros')::bigint/4)::text||',"researchMode":'||to_json(o.research_mode)::text||',"researchPackageFingerprint":'||to_json(package->>'fingerprint')::text||',"model":'||coalesce(to_json(req->>'model')::text,'null')||'}';
 IF o.request_hash IS DISTINCT FROM encode(sha256(convert_to(preimage,'UTF8')),'hex') THEN RAISE EXCEPTION 'Monthly request hash mismatch';END IF;
 SELECT * INTO redemption FROM public.research_monthly_redemptions WHERE monthly_id=chosen_id AND request_id=packet->>'requestId';existed:=FOUND;
 IF existed THEN
  -- sameA2aOrder retains Source's pre-package replay lane. This may return an
  -- old original but never creates or makes that legacy row worker-safe.
  preimage:='{"question":'||to_json(req->>'question')::text||',"creatorBudgetUsdc6":'||(p->>'creatorBudgetMicros')||',"serviceFeeUsdc6":'||((p->>'serviceFeeMicros')::bigint/4)::text||',"researchMode":'||to_json(o.research_mode)::text||',"model":'||coalesce(to_json(req->>'model')::text,'null')||'}';
  SELECT * INTO saved FROM public.a2a_orders WHERE id=redemption.order_id;
  IF NOT FOUND OR saved.id IS DISTINCT FROM o.id OR saved.query_id IS DISTINCT FROM o.query_id OR lower(saved.authorization_id) IS DISTINCT FROM lower(o.authorization_id) OR lower(saved.payer) IS DISTINCT FROM lower(o.payer) OR lower(saved.payee) IS DISTINCT FROM lower(o.payee)
   OR round(saved.amount_usdc*1000000) IS DISTINCT FROM round(o.amount_usdc*1000000) OR round(saved.creator_budget_usdc*1000000) IS DISTINCT FROM round(o.creator_budget_usdc*1000000) OR round(saved.service_fee_usdc*1000000) IS DISTINCT FROM round(o.service_fee_usdc*1000000)
   OR saved.research_mode IS DISTINCT FROM o.research_mode OR (saved.package_data IS NOT DISTINCT FROM o.package_data AND saved.request_hash IS NOT DISTINCT FROM o.request_hash OR (saved.package_data IS NULL OR saved.package_data='null'::jsonb) AND saved.request_hash=encode(sha256(convert_to(preimage,'UTF8')),'hex')) IS NOT TRUE OR saved.transaction_id IS DISTINCT FROM o.transaction_id
   OR saved.request_data->>'network' IS DISTINCT FROM req->>'network' OR saved.request_data->>'question' IS DISTINCT FROM req->>'question' OR saved.request_data->>'model' IS DISTINCT FROM req->>'model' OR saved.request_data->>'origin' IS DISTINCT FROM 'a2a' OR saved.request_data->>'monthlyId' IS DISTINCT FROM req->>'monthlyId' OR redemption.request_hash IS DISTINCT FROM saved.request_hash THEN RAISE EXCEPTION 'Monthly request replay conflict';END IF;
  SELECT source_order_wire INTO order_wire FROM keryx_storage.acceptance_original_projection WHERE order_id=saved.id;IF order_wire IS NULL THEN order_wire:=keryx_storage.a2a_original_row(saved,true)::text;END IF;
  IF NOT keryx_storage.acceptance_original_matches(order_wire,saved) THEN RAISE EXCEPTION 'Monthly retained order projection mismatch';END IF;
 ELSE
  IF date_trunc('milliseconds',accepted_at::timestamptz)<date_trunc('milliseconds',(p->>'createdAt')::timestamptz) OR date_trunc('milliseconds',accepted_at::timestamptz)>=date_trunc('milliseconds',(p->>'expiresAt')::timestamptz) THEN RAISE EXCEPTION 'Monthly term expired';END IF;
  IF used>=4 THEN RAISE EXCEPTION 'Monthly request limit reached';END IF;
  IF (packet->>'rowWire')::jsonb->>'created_at' IS DISTINCT FROM accepted_at THEN RAISE EXCEPTION 'Monthly acceptance time mismatch';END IF;
  IF (jsonb_typeof(projection)='object' AND projection-'orderId'-'storeId'-'orderWire'-'orderSha256'-'deliveryToken'-'owner'-'network'-'binding'-'health'='{}'::jsonb AND projection->>'orderId'=o.id AND projection->>'orderWire'=packet->>'rowWire') IS NOT TRUE THEN RAISE EXCEPTION 'Monthly acceptance projection refused';END IF;
  IF (SELECT count(*) FROM public.deliverable_acceptance_store)<>1 THEN RAISE EXCEPTION 'Monthly acceptance store unavailable';END IF;SELECT id INTO store FROM public.deliverable_acceptance_store;
  IF projection->>'storeId' IS DISTINCT FROM store THEN RAISE EXCEPTION 'Monthly acceptance store mismatch';END IF;
  INSERT INTO public.research_monthly_redemptions(monthly_id,request_id,order_id,request_hash,created_at,slot) VALUES(chosen_id,packet->>'requestId',o.id,o.request_hash,accepted_at::timestamptz,used);
  INSERT INTO public.a2a_orders SELECT (o).*;
  INSERT INTO keryx_storage.acceptance_original_projection(order_id,store_id,source_order_wire,source_order_sha256,delivery_token,owner,network,binding,health_meta) VALUES(o.id,store,projection->>'orderWire',projection->>'orderSha256',projection->>'deliveryToken',projection->>'owner',projection->>'network',nullif(projection->'binding','null'::jsonb),projection->'health');order_wire:=packet->>'rowWire';
 END IF;
 result:=json_build_object('created',NOT existed,'orderWire',order_wire);PERFORM keryx_storage.leave_operation();RETURN result;
END;$$;
REVOKE ALL ON FUNCTION public.storage_research_purchases(jsonb,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_research_purchases(jsonb,text,text,text,text) TO keryx_app,keryx_reader;
RESET ROLE;
