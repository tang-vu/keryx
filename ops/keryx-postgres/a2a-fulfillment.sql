-- Separate failed-original metadata protocol. This cannot execute a provider,
-- pay, renew a supplier window, recover a capability or retry an unknown write.
SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('a2a_fulfillment_get',ARRAY['a2a_failed_original_fulfillments','a2a_fulfillment_completions'],true,true),
 ('a2a_fulfillment_snapshot',ARRAY['a2a_orders','a2a_original_time_projection','a2a_failed_original_fulfillments','a2a_fulfillment_completions','query_runs','payment_events','research_purchase_authorizations','research_monthly_redemptions','deliverable_acceptance_store'],true,true),
 ('a2a_fulfillment_verify',ARRAY['a2a_orders','a2a_original_time_projection','a2a_failed_original_fulfillments','a2a_fulfillment_completions','query_runs','payment_events','research_purchase_authorizations','research_monthly_redemptions'],true,true),
 ('a2a_fulfillment_claim',ARRAY['a2a_orders','a2a_original_time_projection','a2a_failed_original_fulfillments','a2a_fulfillment_completions','query_runs','payment_events','research_purchase_authorizations','research_monthly_redemptions'],true,false),
 ('a2a_fulfillment_complete',ARRAY['a2a_orders','a2a_original_time_projection','a2a_failed_original_fulfillments','a2a_fulfillment_completions','query_runs','payment_events','research_purchase_authorizations','research_monthly_redemptions','deliverable_acceptance_store','acceptance_original_projection','run_privacy','run_privacy_defaults','run_history_projection','run_ownership_projection','run_privacy_projection','usage_projection','public_ledger_projection'],true,false);
CREATE TRIGGER native_a2a_fulfillment_writer BEFORE INSERT OR UPDATE OR DELETE ON public.a2a_failed_original_fulfillments FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence();
CREATE TRIGGER native_a2a_completion_writer BEFORE INSERT OR UPDATE OR DELETE ON public.a2a_fulfillment_completions FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence();
CREATE TRIGGER native_a2a_fulfillment_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON public.a2a_failed_original_fulfillments FOR EACH STATEMENT EXECUTE FUNCTION keryx_storage.immutable();
CREATE TRIGGER native_a2a_completion_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON public.a2a_fulfillment_completions FOR EACH STATEMENT EXECUTE FUNCTION keryx_storage.immutable();
CREATE FUNCTION public.storage_a2a_fulfillment(expected jsonb,digest text,action text,selector text,packet_wire text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE packet jsonb;a jsonb;b jsonb;f jsonb;i jsonb;c jsonb;p jsonb;r jsonb;original json;metadata json;
 o public.a2a_orders;claim public.a2a_failed_original_fulfillments;completion public.a2a_fulfillment_completions;
 claim_wire text;completion_wire text;order_wire text;run_wire text;store text;stamp bigint;field text;operation text;
 paid boolean:=false;no_attempts boolean:=false;changed bigint;result json;resolution jsonb;run_digest text;published jsonb;
BEGIN
 IF action IS NULL OR action NOT IN('get','snapshot','verify','claim','complete') OR selector IS NULL OR selector !~ '^a2a_[a-f0-9]{64}$'
 THEN RAISE EXCEPTION 'native fulfillment action refused';END IF;
 IF action IN('get','snapshot','verify') AND current_setting('transaction_read_only')<>'on'
  OR action IN('claim','complete') AND(current_setting('transaction_read_only')<>'off' OR session_user<>'keryx_app')
 THEN RAISE EXCEPTION 'native fulfillment transaction refused';END IF;
 operation:='a2a_fulfillment_'||action;PERFORM keryx_storage.require_operation(expected,digest,operation);
 IF action IN('get','snapshot') AND packet_wire IS NOT NULL THEN RAISE EXCEPTION 'native fulfillment read arguments refused';END IF;
 SELECT * INTO claim FROM public.a2a_failed_original_fulfillments WHERE original_id=selector;
 IF FOUND THEN claim_wire:=row_to_json(claim)::text;END IF;
 SELECT * INTO completion FROM public.a2a_fulfillment_completions WHERE original_id=selector;
 IF FOUND THEN completion_wire:=row_to_json(completion)::text;END IF;
 IF octet_length(claim_wire)>16777216 OR octet_length(completion_wire)>2048 THEN RAISE EXCEPTION 'native fulfillment retained bound';END IF;
 IF action='get' THEN RETURN json_build_object('claimRowWire',claim_wire,'completionRowWire',completion_wire);END IF;
 SELECT * INTO o FROM public.a2a_orders WHERE id=selector;
 IF FOUND THEN order_wire:=keryx_storage.a2a_original_row(o,true)::text;END IF;
 SELECT data::text INTO run_wire FROM public.query_runs WHERE id=selector;
 IF octet_length(run_wire)>4000000 THEN RAISE EXCEPTION 'native fulfillment run bound';END IF;
 IF claim_wire IS NOT NULL THEN a:=claim.authority_data::jsonb;b:=a->'original';END IF;
 IF b IS NOT NULL THEN
  paid:=keryx_storage.a2a_original_binding_valid(b) AND keryx_storage.a2a_original_matches(o,b) AND keryx_storage.a2a_original_settled(o,b);
 END IF;
 no_attempts:=NOT EXISTS(SELECT 1 FROM public.payment_events WHERE query_id=selector AND kind IS DISTINCT FROM 'inbound');
 IF action='snapshot' THEN
  IF (SELECT count(*) FROM public.deliverable_acceptance_store)=1 THEN SELECT id INTO store FROM public.deliverable_acceptance_store;END IF;
  result:=json_build_object('claimRowWire',claim_wire,'completionRowWire',completion_wire,'orderWire',order_wire,'runWire',run_wire,'storeId',store,'settled',paid,'noCreatorAttempts',no_attempts);
  IF octet_length(result::text)>67108864 THEN RAISE EXCEPTION 'native fulfillment snapshot bound';END IF;RETURN result;
 END IF;
 IF packet_wire IS NULL OR octet_length(packet_wire)>(CASE action WHEN 'complete' THEN 67108864 WHEN 'claim' THEN 33554432 ELSE 2048 END) THEN RAISE EXCEPTION 'native fulfillment packet bound';END IF;
 packet:=packet_wire::jsonb;
 IF action='verify' THEN
  IF (jsonb_typeof(packet)='object' AND packet-'claimSha256'-'completionSha256'-'orderSha256'-'runSha256'='{}'::jsonb) IS NOT TRUE THEN RAISE EXCEPTION 'native fulfillment verify packet refused';END IF;
  FOREACH field IN ARRAY ARRAY['claimSha256','completionSha256','orderSha256','runSha256'] LOOP
   IF jsonb_typeof(packet->field) IS DISTINCT FROM 'string' OR packet->>field !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'native fulfillment digest refused';END IF;
  END LOOP;
  RETURN to_json(claim_wire IS NOT NULL AND completion_wire IS NOT NULL AND order_wire IS NOT NULL AND run_wire IS NOT NULL AND paid AND no_attempts
   AND o.status='completed' AND o.error_code IS NULL AND o.execution_journal_version=1 AND o.payment_started_at IS NULL
   AND o.result_saving_at=completion.completed_at::timestamptz AND o.updated_at=completion.completed_at::timestamptz
   AND completion.claim_id=claim.claim_id
   AND packet->>'claimSha256'=encode(sha256(convert_to(claim_wire,'UTF8')),'hex')
   AND packet->>'completionSha256'=encode(sha256(convert_to(completion_wire,'UTF8')),'hex')
   AND packet->>'orderSha256'=encode(sha256(convert_to(order_wire,'UTF8')),'hex')
   AND packet->>'runSha256'=encode(sha256(convert_to(run_wire,'UTF8')),'hex'));
 END IF;
 stamp:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF action='claim' THEN
  i:=packet->'input';a:=i->'authority';b:=a->'original';f:=(packet->>'failedOrderWire')::jsonb;
  IF (jsonb_typeof(packet)='object' AND packet-'input'-'authorityWire'-'failedOrderWire'-'beforeWire'='{}'::jsonb
   AND jsonb_typeof(i)='object' AND i-'authority'-'claimId'-'claimedAt'='{}'::jsonb
   AND jsonb_typeof(packet->'authorityWire')='string' AND octet_length(packet->>'authorityWire')<=524288 AND (packet->>'authorityWire')::jsonb=a
   AND jsonb_typeof(packet->'failedOrderWire')='string' AND octet_length(packet->>'failedOrderWire')<=4000000
   AND jsonb_typeof(packet->'beforeWire')='string' AND octet_length(packet->>'beforeWire')<=4000000
   AND jsonb_typeof(a)='object' AND a-'format'-'original'-'question'-'input'-'authorizationSha256'-'policySha256'-'failedClosureSha256'-'originalEvidenceSha256'-'originalProviderLedgerSha256'-'executorCommit'-'expiresAt'-'supplierWindow'='{}'::jsonb
   AND a->>'format' IN('keryx-a2a-failed-original-fulfillment-authority-v1','keryx-a2a-failed-original-fulfillment-authority-v2')
   AND jsonb_typeof(i->'claimId')='string' AND i->>'claimId' ~ '^[a-f0-9]{64}$' AND keryx_storage.a2a_original_binding_valid(b) AND b->>'id'=selector
   AND jsonb_typeof(a->'question')='string' AND keryx_storage.a2a_utf16_length(a->>'question') BETWEEN 1 AND 10000
   AND jsonb_typeof(a->'input')='object' AND a->'input'->>'format'='keryx-canary-original-fulfillment-input-v1'
   AND a->'input'->>'scopeBasis'='reviewed-original-question-reconstruction'
   AND a->'input'->>'questionSha256'=encode(sha256(convert_to(a->>'question','UTF8')),'hex')
   AND a->>'executorCommit' ~ '^[a-f0-9]{40}$'
   AND a->>'originalEvidenceSha256'=encode(sha256(convert_to('{"creatorAttempts":0,"nativeExactOriginalSettled":true,"order":'||(packet->>'failedOrderWire')||',"queryRunFound":false}','UTF8')),'hex')) IS NOT TRUE
  THEN RAISE EXCEPTION 'native fulfillment claim packet refused';END IF;
  r:=a->'input';
  IF (r-'format'-'questionSha256'-'scopeBasis'-'targets'-'constraints'-'sourceManifestSha256'-'selectedDocumentIds'='{}'::jsonb
   AND jsonb_typeof(r->'targets')='array' AND jsonb_array_length(r->'targets') BETWEEN 1 AND 8
   AND jsonb_typeof(r->'constraints')='array' AND jsonb_array_length(r->'constraints')<=16
   AND jsonb_typeof(r->'selectedDocumentIds')='array' AND jsonb_array_length(r->'selectedDocumentIds') BETWEEN 1 AND 2
   AND r->>'sourceManifestSha256' ~ '^[a-f0-9]{64}$') IS NOT TRUE THEN RAISE EXCEPTION 'native fulfillment input scope refused';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->'targets') t WHERE jsonb_typeof(t)<>'string' OR keryx_storage.a2a_trim(t#>>'{}') IS DISTINCT FROM t#>>'{}' OR keryx_storage.a2a_utf16_length(t#>>'{}') NOT BETWEEN 1 AND 2000)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(r->'constraints') t WHERE jsonb_typeof(t)<>'string' OR keryx_storage.a2a_trim(t#>>'{}') IS DISTINCT FROM t#>>'{}' OR keryx_storage.a2a_utf16_length(t#>>'{}') NOT BETWEEN 1 AND 2000)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(r->'selectedDocumentIds') t WHERE jsonb_typeof(t)<>'string' OR t#>>'{}' !~ '^[a-z0-9-]{1,80}$')
   OR (SELECT count(DISTINCT t) FROM jsonb_array_elements(r->'targets') t)<>jsonb_array_length(r->'targets')
   OR (SELECT count(DISTINCT t) FROM jsonb_array_elements(r->'selectedDocumentIds') t)<>jsonb_array_length(r->'selectedDocumentIds')
  THEN RAISE EXCEPTION 'native fulfillment input values refused';END IF;
  FOREACH field IN ARRAY ARRAY['authorizationSha256','policySha256','failedClosureSha256','originalEvidenceSha256','originalProviderLedgerSha256'] LOOP
   IF jsonb_typeof(a->field) IS DISTINCT FROM 'string' OR a->>field !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'native fulfillment authority digest refused';END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['claimedAt','expiresAt'] LOOP
   store:=CASE field WHEN 'claimedAt' THEN i->>field ELSE a->>field END;
   IF store IS NULL OR store !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' OR to_char(store::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>store THEN RAISE EXCEPTION 'native fulfillment claim clock refused';END IF;
  END LOOP;
  IF extract(epoch FROM (i->>'claimedAt')::timestamptz)*1000>stamp OR stamp-extract(epoch FROM (i->>'claimedAt')::timestamptz)*1000>60000
   OR extract(epoch FROM (a->>'expiresAt')::timestamptz)*1000<=stamp THEN RAISE EXCEPTION 'native fulfillment supplier window refused';END IF;
  IF a->>'format'='keryx-a2a-failed-original-fulfillment-authority-v1' THEN
   IF a?'supplierWindow' OR a->>'expiresAt'<>'2026-10-07T00:00:00.000Z' THEN RAISE EXCEPTION 'native fulfillment historical window refused';END IF;
  ELSE
   r:=a->'supplierWindow';
   IF (jsonb_typeof(r)='object' AND r-'approvalReceivedAt'-'expiresAt'-'maximumDurationMs'='{}'::jsonb
    AND r->'maximumDurationMs'='5400000'::jsonb AND r->>'expiresAt'=a->>'expiresAt'
    AND r->>'approvalReceivedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
    AND to_char((r->>'approvalReceivedAt')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=r->>'approvalReceivedAt'
    AND (r->>'approvalReceivedAt')::timestamptz<=(i->>'claimedAt')::timestamptz AND (i->>'claimedAt')::timestamptz<(a->>'expiresAt')::timestamptz
    AND (a->>'expiresAt')::timestamptz>(r->>'approvalReceivedAt')::timestamptz AND (a->>'expiresAt')::timestamptz-(r->>'approvalReceivedAt')::timestamptz<=interval '90 minutes') IS NOT TRUE
   THEN RAISE EXCEPTION 'native fulfillment explicit window refused';END IF;
  END IF;
  IF order_wire IS NULL OR claim_wire IS NOT NULL OR completion_wire IS NOT NULL OR run_wire IS NOT NULL OR NOT no_attempts
   OR EXISTS(SELECT 1 FROM public.a2a_failed_original_fulfillments WHERE claim_id=i->>'claimId')
   OR NOT keryx_storage.a2a_original_matches(o,b) OR NOT keryx_storage.a2a_original_settled(o,b)
   OR NOT keryx_storage.acceptance_original_matches(packet->>'beforeWire',o)
   OR o.status<>'failed' OR o.error_code IS DISTINCT FROM 'research_failed' OR o.execution_journal_version IS DISTINCT FROM 1
   OR o.started_at IS NULL OR o.worker_id IS NULL OR keryx_storage.a2a_trim(o.worker_id)='' OR keryx_storage.a2a_utf16_length(o.worker_id)>200
   OR o.payment_started_at IS NOT NULL OR o.result_saving_at IS NOT NULL OR o.response_data IS NOT NULL OR o.resolution_data IS NOT NULL
   OR o.created_at>o.started_at OR o.started_at>o.updated_at OR o.updated_at>(i->>'claimedAt')::timestamptz
   OR o.request_data->>'origin' IS DISTINCT FROM 'a2a' OR o.request_data->>'question' IS DISTINCT FROM a->>'question'
  THEN PERFORM keryx_storage.leave_operation();RETURN NULL;END IF;
  -- Bind the Source camel-case failure snapshot to the current raw native row.
  IF (f-'id'-'queryId'-'authorizationId'-'requestHash'-'payer'-'payee'-'amountUsdc'-'creatorBudgetUsdc'-'serviceFeeUsdc'-'researchMode'-'researchPackage'-'status'-'transaction'-'request'-'startedAt'-'workerId'-'executionJournalVersion'-'paymentStartedAt'-'resultSavingAt'-'response'-'errorCode'-'resolution'-'createdAt'-'updatedAt'='{}'::jsonb
   AND f->>'id'=selector AND f->>'queryId'=o.query_id AND f->>'authorizationId'=o.authorization_id AND f->>'requestHash'=o.request_hash
   AND f->>'payer'=o.payer AND f->>'payee'=o.payee AND (f->>'amountUsdc')::numeric=o.amount_usdc AND (f->>'creatorBudgetUsdc')::numeric=o.creator_budget_usdc
   AND (f->>'serviceFeeUsdc')::numeric=o.service_fee_usdc AND f->>'researchMode'=o.research_mode AND f->'researchPackage'=o.package_data
   AND f->>'status'='failed' AND f->>'transaction'=o.transaction_id AND f->'request'=o.request_data AND f->>'workerId'=o.worker_id
   AND f->'executionJournalVersion'='1'::jsonb AND f->'paymentStartedAt'='null'::jsonb AND f->'resultSavingAt'='null'::jsonb
   AND f->'response'='null'::jsonb AND f->>'errorCode'='research_failed' AND f->'resolution'='null'::jsonb) IS NOT TRUE
  THEN RAISE EXCEPTION 'native fulfillment failure snapshot refused';END IF;
  FOREACH field IN ARRAY ARRAY['createdAt','updatedAt','startedAt'] LOOP
   store:=f->>field;
   IF store IS NULL OR store !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' OR to_char(store::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>store
    OR store IS DISTINCT FROM (order_wire::json->>CASE field WHEN 'createdAt' THEN 'created_at' WHEN 'updatedAt' THEN 'updated_at' ELSE 'started_at' END)
   THEN RAISE EXCEPTION 'native fulfillment failure time refused';END IF;
  END LOOP;
  INSERT INTO public.a2a_failed_original_fulfillments(original_id,claim_id,authority_data,failed_order_data,claimed_at)
   VALUES(selector,i->>'claimId',packet->>'authorityWire',packet->>'failedOrderWire',i->>'claimedAt');
  stamp:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
  IF extract(epoch FROM (a->>'expiresAt')::timestamptz)*1000<=stamp OR stamp-extract(epoch FROM (i->>'claimedAt')::timestamptz)*1000>60000 THEN RAISE EXCEPTION 'native fulfillment supplier window expired';END IF;
  SELECT row_to_json(saved)::text INTO claim_wire FROM public.a2a_failed_original_fulfillments saved WHERE original_id=selector;
  PERFORM keryx_storage.leave_operation();RETURN json_build_object('claimRowWire',claim_wire,'completionRowWire',NULL);
 END IF;
 -- Completion never requires a renewed/live supplier window. It commits only
 -- already prepared, exact result metadata, including historical after-expiry.
 c:=packet->'completion';p:=packet->'projection';r:=(packet->>'afterWire')::jsonb;
 IF (jsonb_typeof(packet)='object' AND packet-'completion'-'claimSha256'-'beforeWire'-'afterWire'-'publication'-'projection'='{}'::jsonb
  AND jsonb_typeof(c)='object' AND c-'claimId'-'originalId'-'runSha256'-'providerLedgerSha256'-'completedAt'='{}'::jsonb
  AND c->>'originalId'=selector AND c->>'claimId' ~ '^[a-f0-9]{64}$' AND c->>'runSha256' ~ '^[a-f0-9]{64}$' AND c->>'providerLedgerSha256' ~ '^[a-f0-9]{64}$'
  AND packet->>'claimSha256' ~ '^[a-f0-9]{64}$' AND jsonb_typeof(packet->'beforeWire')='string' AND octet_length(packet->>'beforeWire')<=4000000
  AND jsonb_typeof(packet->'afterWire')='string' AND octet_length(packet->>'afterWire')<=4000000
  AND c->>'completedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
  AND to_char((c->>'completedAt')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=c->>'completedAt'
  AND extract(epoch FROM (c->>'completedAt')::timestamptz)*1000<=stamp) IS NOT TRUE THEN RAISE EXCEPTION 'native fulfillment completion packet refused';END IF;
 IF claim_wire IS NULL OR completion_wire IS NOT NULL OR order_wire IS NULL OR run_wire IS NOT NULL OR NOT paid OR NOT no_attempts
  OR claim.claim_id IS DISTINCT FROM c->>'claimId' OR packet->>'claimSha256'<>encode(sha256(convert_to(claim_wire,'UTF8')),'hex')
  OR (packet->>'beforeWire')::jsonb IS DISTINCT FROM order_wire::jsonb
  OR o.status<>'failed' OR o.error_code IS DISTINCT FROM 'research_failed' OR o.execution_journal_version IS DISTINCT FROM 1 OR o.started_at IS NULL
  OR o.payment_started_at IS NOT NULL OR o.result_saving_at IS NOT NULL OR o.response_data IS NOT NULL OR o.resolution_data IS NOT NULL
 THEN PERFORM keryx_storage.leave_operation();RETURN 'false'::json;END IF;
 f:=claim.failed_order_data::jsonb;
 IF f->>'transaction' IS DISTINCT FROM o.transaction_id OR f->>'workerId' IS DISTINCT FROM o.worker_id OR f->'request' IS DISTINCT FROM o.request_data
  OR f->>'createdAt' IS DISTINCT FROM (order_wire::json->>'created_at') OR f->>'startedAt' IS DISTINCT FROM (order_wire::json->>'started_at')
  OR f->>'updatedAt' IS DISTINCT FROM (order_wire::json->>'updated_at') OR f->>'payer' IS DISTINCT FROM o.payer OR f->>'payee' IS DISTINCT FROM o.payee
 THEN PERFORM keryx_storage.leave_operation();RETURN 'false'::json;END IF;
 IF (r-'status'-'response_data'-'error_code'-'result_saving_at'-'resolution_data'-'updated_at') IS DISTINCT FROM
  (order_wire::jsonb-'status'-'response_data'-'error_code'-'result_saving_at'-'resolution_data'-'updated_at')
  OR r->>'status' IS DISTINCT FROM 'completed' OR r->'error_code' IS DISTINCT FROM 'null'::jsonb
  OR r->>'updated_at' IS DISTINCT FROM c->>'completedAt' OR r->>'result_saving_at' IS DISTINCT FROM c->>'completedAt'
  OR jsonb_typeof(r->'response_data') IS DISTINCT FROM 'string' OR jsonb_typeof(r->'resolution_data') IS DISTINCT FROM 'string'
 THEN RAISE EXCEPTION 'native fulfillment original CAS refused';END IF;
 resolution:=jsonb_build_object('action','fulfill_failed_original','actor','operator-cli','reason','verified_failed_original_fulfilled','resolvedAt',c->>'completedAt',
  'evidence',jsonb_build_object('executionJournalVersion',1,'paymentBoundaryCrossed',false,'resultSaveBoundaryCrossed',true,'creatorAttempts',0,'settledCreatorMicros',0,'pendingCreatorMicros',0,'failedCreatorMicros',0,'simulatedCreatorMicros',0,'queryRunFound',true),
  'fulfillment',jsonb_build_object('claimId',claim.claim_id,'originalFailureSha256',a->>'originalEvidenceSha256','authoritySha256',encode(sha256(convert_to(claim.authority_data,'UTF8')),'hex'),'providerLedgerSha256',c->>'providerLedgerSha256','runSha256',c->>'runSha256'));
 IF (r->>'resolution_data')::jsonb IS DISTINCT FROM resolution THEN RAISE EXCEPTION 'native fulfillment resolution refused';END IF;
 IF jsonb_typeof(packet->'publication') IS DISTINCT FROM 'object' OR packet->'publication'?'publication' THEN RAISE EXCEPTION 'native fulfillment publication refused';END IF;
 run_wire:=convert_from(decode(packet->'publication'->>'originalHex','hex'),'UTF8');original:=run_wire::json;metadata:=original->'originalFulfillment';
 IF octet_length(run_wire)>4000000 OR encode(sha256(convert_to(run_wire,'UTF8')),'hex') IS DISTINCT FROM c->>'runSha256'
  OR original->>'id' IS DISTINCT FROM selector OR original->>'question' IS DISTINCT FROM a->>'question'
  OR original->>'budget' IS DISTINCT FROM '0.01' OR original->>'engine' IS DISTINCT FROM 'llm:deepseek:deepseek-v4-flash'
  OR original->>'researchMode' IS DISTINCT FROM 'quick' OR original->>'origin' IS DISTINCT FROM 'a2a' OR original->>'paymentMode' IS DISTINCT FROM 'real'
  OR original->'parentId' IS NOT NULL OR original->'retryOf' IS NOT NULL OR json_typeof(original->'answer') IS DISTINCT FROM 'string'
  OR keryx_storage.a2a_trim(original->>'answer')='' OR original->>'createdAt' IS NULL
  OR original->>'createdAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
  OR to_char((original->>'createdAt')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') IS DISTINCT FROM original->>'createdAt'
  OR (original->>'createdAt')::timestamptz<claim.claimed_at::timestamptz OR (original->>'createdAt')::timestamptz>(c->>'completedAt')::timestamptz
  OR metadata->>'format' IS NULL OR metadata->>'format' NOT IN('keryx-a2a-original-fulfillment-result-v1','keryx-a2a-original-fulfillment-result-v2')
  OR metadata->>'claimId' IS DISTINCT FROM claim.claim_id OR metadata->>'originalFailureSha256' IS DISTINCT FROM a->>'originalEvidenceSha256'
  OR metadata->>'authoritySha256' IS DISTINCT FROM encode(sha256(convert_to(claim.authority_data,'UTF8')),'hex')
  OR metadata->>'providerLedgerSha256' IS DISTINCT FROM c->>'providerLedgerSha256' OR metadata->>'noNewInboundPayment' IS DISTINCT FROM 'true'
  OR metadata->>'inputSha256' IS DISTINCT FROM encode(sha256(convert_to((claim.authority_data::json->'input')::text,'UTF8')),'hex')
  OR original->'subClaims' IS NULL OR (original->'subClaims')::jsonb IS DISTINCT FROM a->'input'->'targets'
  OR metadata->>'originalProviderBilling' IS DISTINCT FROM 'unknown'
 THEN RAISE EXCEPTION 'native fulfillment prepared run refused';END IF;
 IF original->'durationMs' IS NOT NULL AND (json_typeof(original->'durationMs') IS DISTINCT FROM 'number'
  OR (original->>'durationMs')::numeric IS DISTINCT FROM extract(epoch FROM ((original->>'createdAt')::timestamptz-o.started_at))*1000)
 THEN RAISE EXCEPTION 'native fulfillment prepared duration refused';END IF;
 FOREACH field IN ARRAY ARRAY['totalSpent','totalToCreators','pendingSpendUsdc','paymentAttempts','settledPayments','pendingPayments'] LOOP
  IF json_typeof(original->field) IS DISTINCT FROM 'number' OR (original->>field)::numeric<>0 THEN RAISE EXCEPTION 'native fulfillment zero new payment required';END IF;
 END LOOP;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p->>'orderId' IS DISTINCT FROM selector OR p->>'orderWire' IS DISTINCT FROM packet->>'afterWire'
  OR (SELECT count(*) FROM public.deliverable_acceptance_store)<>1 THEN RAISE EXCEPTION 'native fulfillment projection refused';END IF;
 SELECT id INTO store FROM public.deliverable_acceptance_store;IF p->>'storeId' IS DISTINCT FROM store THEN RAISE EXCEPTION 'native fulfillment store refused';END IF;
 -- No application writer can insert between absence and this call: the same
 -- exclusive native data lock spans the insert-only check and all projections.
 -- Recovery uses Source's three-argument insert-only writer. It retains the
 -- legacy trigger policy instead of ordinary saveQueryRun's public default.
 -- This choice is derived here, never a caller publication permission. The
 -- helper still preserves any orphan retained sidecar (fresh=false).
 published:=packet->'publication';
 published:=jsonb_set(published,'{publication}',jsonb_build_object('visibility',CASE
  WHEN published->'row'->>'asker' ~ '^0x[0-9a-f]{40}$' THEN coalesce((SELECT visibility FROM public.run_privacy_defaults WHERE wallet=published->'row'->>'asker'),'private')
  ELSE 'unlisted' END));
 published:=keryx_storage.publication_save(published::text);
 IF published->>'id' IS DISTINCT FROM selector OR published->>'originalSha256' IS DISTINCT FROM c->>'runSha256' THEN RAISE EXCEPTION 'native fulfillment run readback refused';END IF;
 UPDATE public.a2a_orders SET status='completed',response_data=(r->>'response_data')::json,error_code=NULL,
  result_saving_at=(c->>'completedAt')::timestamptz,resolution_data=(r->>'resolution_data')::json,updated_at=(c->>'completedAt')::timestamptz
  WHERE id=selector AND status='failed' AND error_code='research_failed' AND payment_started_at IS NULL AND result_saving_at IS NULL;
 GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>1 THEN RAISE EXCEPTION 'native fulfillment completion CAS refused';END IF;
 UPDATE keryx_storage.a2a_original_time_projection SET updated_at=c->>'completedAt',result_saving_at=c->>'completedAt' WHERE order_id=selector;
 GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>1 THEN RAISE EXCEPTION 'native fulfillment Source time unavailable';END IF;
 INSERT INTO keryx_storage.acceptance_original_projection(order_id,store_id,source_order_wire,source_order_sha256,delivery_token,owner,network,binding,health_meta)
  VALUES(selector,store,p->>'orderWire',p->>'orderSha256',p->>'deliveryToken',p->>'owner',p->>'network',nullif(p->'binding','null'::jsonb),p->'health');
 INSERT INTO public.a2a_fulfillment_completions(original_id,claim_id,run_sha256,provider_ledger_sha256,completed_at)
  VALUES(selector,claim.claim_id,c->>'runSha256',c->>'providerLedgerSha256',c->>'completedAt');
 SELECT * INTO o FROM public.a2a_orders WHERE id=selector;
 IF NOT keryx_storage.acceptance_original_matches(packet->>'afterWire',o) OR NOT keryx_storage.a2a_original_settled(o,b)
  OR EXISTS(SELECT 1 FROM public.payment_events WHERE query_id=selector AND kind IS DISTINCT FROM 'inbound')
  OR (SELECT data::text FROM public.query_runs WHERE id=selector) IS DISTINCT FROM run_wire
 THEN RAISE EXCEPTION 'native fulfillment completion readback refused';END IF;
 PERFORM keryx_storage.leave_operation();RETURN 'true'::json;
END;$$;
REVOKE ALL ON FUNCTION public.storage_a2a_fulfillment(jsonb,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_a2a_fulfillment(jsonb,text,text,text,text) TO keryx_app,keryx_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
RESET ROLE;
