-- Ordinary testnet only; no enrolled/mainnet purchase authority is activated.
-- Shared pure row validation is private; public APIs return a boolean or the one claimed row.
CREATE OR REPLACE FUNCTION public.a2a_original_binding_matches_v1(original public.a2a_orders,p_expected jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE total_micro bigint; creator_micro bigint; fee_micro bigint;
  package_wire text; fingerprint text; request_wire text;
BEGIN
  IF jsonb_typeof(p_expected) IS DISTINCT FROM 'object' OR octet_length(p_expected::text)>8192
    OR NOT p_expected ?& ARRAY['id','queryId','requestHash','payer','payee','authorizationId',
      'amountMicroUsdc','creatorBudgetMicroUsdc','serviceFeeMicroUsdc','packageFingerprint','network','asset','gatewayContract']
    OR (SELECT count(*) FROM jsonb_object_keys(p_expected))!=13
    OR EXISTS(SELECT 1 FROM jsonb_each(p_expected) WHERE jsonb_typeof(value) IS DISTINCT FROM 'string')
    OR p_expected->>'id' !~ '^a2a_[a-f0-9]{64}$' OR p_expected->>'queryId' IS DISTINCT FROM p_expected->>'id'
    OR p_expected->>'requestHash' !~ '^[a-f0-9]{64}$' OR p_expected->>'packageFingerprint' !~ '^[a-f0-9]{64}$'
    OR p_expected->>'payer' !~ '^0x[a-f0-9]{40}$' OR p_expected->>'payee' !~ '^0x[a-f0-9]{40}$'
    OR p_expected->>'authorizationId' !~ '^0x[a-f0-9]{64}$'
    OR p_expected->>'network' IS DISTINCT FROM 'eip155:5042002'
    OR p_expected->>'asset' IS DISTINCT FROM '0x3600000000000000000000000000000000000000'
    OR p_expected->>'gatewayContract' IS DISTINCT FROM '0x0077777d7eba4688bdef3e311b846f25870a19b9'
    OR p_expected->>'amountMicroUsdc' !~ '^[1-9][0-9]{0,15}$'
    OR p_expected->>'creatorBudgetMicroUsdc' !~ '^[1-9][0-9]{0,15}$'
    OR p_expected->>'serviceFeeMicroUsdc' !~ '^[1-9][0-9]{0,15}$' THEN
    RAISE EXCEPTION 'Exact original claim binding refused';
  END IF;
  total_micro:=(p_expected->>'amountMicroUsdc')::bigint;
  creator_micro:=(p_expected->>'creatorBudgetMicroUsdc')::bigint;
  fee_micro:=(p_expected->>'serviceFeeMicroUsdc')::bigint;
  IF greatest(total_micro,creator_micro,fee_micro)>9007199254740991 OR total_micro!=creator_micro+fee_micro
    OR p_expected->>'id' IS DISTINCT FROM 'a2a_'||encode(sha256(convert_to(
      'keryx-a2a-v2|'||(p_expected->>'network')||'|'||(p_expected->>'payer')||'|'||(p_expected->>'payee')||'|'||(p_expected->>'authorizationId'),'UTF8')),'hex')
    THEN RAISE EXCEPTION 'Exact original claim identity refused'; END IF;
  IF original.id IS DISTINCT FROM p_expected->>'id' OR original.query_id IS DISTINCT FROM p_expected->>'queryId'
    OR original.request_hash IS DISTINCT FROM p_expected->>'requestHash'
    OR lower(original.payer) IS DISTINCT FROM p_expected->>'payer' OR lower(original.payee) IS DISTINCT FROM p_expected->>'payee'
    OR lower(original.authorization_id) IS DISTINCT FROM p_expected->>'authorizationId'
    OR original.amount_usdc IS DISTINCT FROM total_micro::numeric/1000000
    OR original.creator_budget_usdc IS DISTINCT FROM creator_micro::numeric/1000000
    OR original.service_fee_usdc IS DISTINCT FROM fee_micro::numeric/1000000
    OR original.transaction_id IS NULL
    OR length(original.transaction_id)+(SELECT count(*) FROM regexp_split_to_table(original.transaction_id,'') ch WHERE ascii(ch)>65535)>512
    OR original.transaction_id ~ U&'^[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]*$'
    OR jsonb_typeof(original.request_data) IS DISTINCT FROM 'object' OR original.request_data ? 'monthlyId'
    OR original.request_data->>'network' IS DISTINCT FROM p_expected->>'network'
    OR original.request_data->>'origin' NOT IN ('a2a','engine') OR original.request_data->>'origin' IS NULL
    OR jsonb_typeof(original.request_data->'question') IS DISTINCT FROM 'string'
    OR original.request_data->>'question' ~ U&'^[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]*$'
    OR length(original.request_data->>'question')+(SELECT count(*) FROM regexp_split_to_table(original.request_data->>'question','') ch WHERE ascii(ch)>65535)>10000
    OR (original.request_data ? 'model' AND (jsonb_typeof(original.request_data->'model') IS DISTINCT FROM 'string'
      OR original.request_data->>'model' ~ U&'^[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]*$'
      OR length(original.request_data->>'model')+(SELECT count(*) FROM regexp_split_to_table(original.request_data->>'model','') ch WHERE ascii(ch)>65535)>256)) THEN RETURN false; END IF;
  -- Accepted package snapshots are exact. No unknown package acquires execution authority.
  package_wire:=CASE original.research_mode
    WHEN 'quick' THEN '{"execution":{"attentionLimit":2,"reevaluateRounds":0},"id":"keryx-quick","quality":{"commitment":"best_effort","groundingThreshold":0.4,"measurement":"evidence-ledger-v1"},"researchMode":"quick","schema":"urn:keryx:a2a-research-package:1","serviceLevel":{"kind":"provisional_slo","remedy":"none","startsAt":"accepted_at","targetCompletionMs":180000},"version":"1.0.0"}'
    WHEN 'deep' THEN '{"execution":{"attentionLimit":4,"reevaluateRounds":1},"id":"keryx-deep","quality":{"commitment":"best_effort","groundingThreshold":0.4,"measurement":"evidence-ledger-v1"},"researchMode":"deep","schema":"urn:keryx:a2a-research-package:1","serviceLevel":{"kind":"provisional_slo","remedy":"none","startsAt":"accepted_at","targetCompletionMs":300000},"version":"1.0.0"}' END;
  IF package_wire IS NULL OR original.package_data IS DISTINCT FROM package_wire::jsonb THEN RETURN false; END IF;
  fingerprint:=encode(sha256(convert_to(package_wire,'UTF8')),'hex');
  IF fingerprint IS DISTINCT FROM p_expected->>'packageFingerprint' THEN RETURN false; END IF;
  -- This is the existing JS request-hash preimage, including null model and integer micro-USDC.
  request_wire:='{"question":'||(original.request_data->'question')::text||
    ',"creatorBudgetUsdc6":'||creator_micro::text||',"serviceFeeUsdc6":'||fee_micro::text||
    ',"researchMode":'||to_jsonb(original.research_mode)::text||
    ',"researchPackageFingerprint":'||to_jsonb(fingerprint)::text||
    ',"model":'||coalesce((original.request_data->'model')::text,'null')||'}';
  IF encode(sha256(convert_to(request_wire,'UTF8')),'hex') IS DISTINCT FROM original.request_hash THEN RETURN false; END IF;

  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.a2a_original_binding_matches_v1(public.a2a_orders,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.has_original_a2a_settlement_v1(p_expected jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  WITH authority AS MATERIALIZED (SELECT public.assert_ordinary_research_storage())
  SELECT EXISTS(SELECT 1 FROM public.a2a_orders original
  JOIN public.research_purchase_authorizations c ON c.purchase_id=original.id
    JOIN public.payment_events p ON p.id='inbound_'||original.id AND p.kind='inbound' AND p.source_id='a2a'
      AND p.query_id=c.purchase_id AND lower(p.payer)=c.payer AND lower(p.payee)=c.payee
      AND lower(p.authorization_id)=c.authorization_id AND p.network=c.network
      AND p.settled IS TRUE AND p.settlement_status='settled'
      AND p.tx_hash=original.transaction_id AND p.amount_usdc=original.amount_usdc
    WHERE original.id=p_expected->>'id' AND public.a2a_original_binding_matches_v1(original,p_expected)
      AND NOT EXISTS(SELECT 1 FROM public.research_monthly_redemptions WHERE order_id=original.id)
      AND c.network=p_expected->>'network' AND c.asset=p_expected->>'asset'
      AND c.payer=p_expected->>'payer' AND c.payee=p_expected->>'payee'
      AND c.authorization_id=p_expected->>'authorizationId' AND c.product='a2a'
      AND c.purchase_id=original.id AND c.request_hash=original.request_hash AND c.amount_micros=(p_expected->>'amountMicroUsdc')::bigint

) FROM authority;
$$;
REVOKE ALL ON FUNCTION public.has_original_a2a_settlement_v1(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.has_original_a2a_settlement_v1(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_original_a2a_order_v1(p_expected jsonb,p_worker_id text,p_started_at timestamptz)
RETURNS SETOF public.a2a_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE original public.a2a_orders; total_micro bigint; proof_id text;
BEGIN
  PERFORM public.assert_ordinary_research_storage();
  IF p_worker_id IS NULL OR p_worker_id ~ U&'^[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]*$'
    OR length(p_worker_id)+(SELECT count(*) FROM regexp_split_to_table(p_worker_id,'') ch WHERE ascii(ch)>65535)>200
    OR p_started_at IS NULL OR NOT isfinite(p_started_at) THEN RAISE EXCEPTION 'Exact original claim worker refused'; END IF;
  SELECT * INTO original FROM public.a2a_orders WHERE id=p_expected->>'id' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT public.a2a_original_binding_matches_v1(original,p_expected)
    OR original.status IS DISTINCT FROM 'running' OR original.started_at IS NOT NULL OR original.worker_id IS NOT NULL
    OR original.execution_journal_version IS DISTINCT FROM 1 OR original.payment_started_at IS NOT NULL
    OR original.result_saving_at IS NOT NULL OR original.response_data IS NOT NULL
    OR original.error_code IS NOT NULL OR original.resolution_data IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.research_monthly_redemptions WHERE order_id=original.id)
    OR EXISTS(SELECT 1 FROM public.query_runs WHERE id=original.query_id)
    OR EXISTS(SELECT 1 FROM public.payment_events WHERE query_id=original.query_id AND kind IS DISTINCT FROM 'inbound') THEN RETURN; END IF;
  total_micro:=(p_expected->>'amountMicroUsdc')::bigint;
  -- Keep both proof rows locked through UPDATE/commit; no select-after-claim fallback.
  SELECT p.id INTO proof_id FROM public.research_purchase_authorizations c
    JOIN public.payment_events p ON p.id='inbound_'||original.id AND p.kind='inbound' AND p.source_id='a2a'
      AND p.query_id=c.purchase_id AND lower(p.payer)=c.payer AND lower(p.payee)=c.payee
      AND lower(p.authorization_id)=c.authorization_id AND p.network=c.network
      AND p.settled IS TRUE AND p.settlement_status='settled'
      AND p.tx_hash=original.transaction_id AND p.amount_usdc=original.amount_usdc
    WHERE c.network=p_expected->>'network' AND c.asset=p_expected->>'asset'
      AND c.payer=p_expected->>'payer' AND c.payee=p_expected->>'payee'
      AND c.authorization_id=p_expected->>'authorizationId' AND c.product='a2a'
      AND c.purchase_id=original.id AND c.request_hash=original.request_hash AND c.amount_micros=total_micro
    FOR SHARE OF p,c;

  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY UPDATE public.a2a_orders SET started_at=p_started_at,worker_id=p_worker_id,updated_at=p_started_at
    WHERE id=original.id AND status='running' AND started_at IS NULL AND worker_id IS NULL RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_original_a2a_order_v1(jsonb,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_original_a2a_order_v1(jsonb,text,timestamptz) TO service_role;
