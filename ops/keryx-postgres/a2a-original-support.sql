-- Current exact-original proof, not a new purchase, funding or vendor claim.
SET ROLE keryx_owner;
CREATE FUNCTION keryx_storage.a2a_original_profile() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT __A2A_ORIGINAL_PROFILE__::jsonb;
$$;
CREATE FUNCTION keryx_storage.a2a_original_packages() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT __A2A_ORIGINAL_PACKAGES__::jsonb;
$$;
CREATE FUNCTION keryx_storage.a2a_utf16_length(value text) RETURNS integer LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $$
 SELECT char_length(value)+(SELECT count(*)::integer FROM regexp_matches(value,U&'[\+010000-\+10FFFF]','g'));
$$;
CREATE FUNCTION keryx_storage.a2a_trim(value text) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $$
 SELECT btrim(value,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;
-- Reproduce exactA2aMicros' binary Number round-trip, not a tolerance rule.
CREATE FUNCTION keryx_storage.a2a_exact_micros(amount numeric) RETURNS bigint LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $$
DECLARE value double precision;scaled double precision;rounded double precision;
BEGIN
 value:=amount::double precision;
 IF value IN('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision) THEN RETURN NULL;END IF;
 scaled:=value*1000000::double precision;rounded:=floor(scaled);
 IF scaled-rounded>=0.5::double precision THEN rounded:=rounded+1;END IF;
 IF rounded<0 OR rounded>9007199254740991::double precision OR value<>rounded/1000000::double precision THEN RETURN NULL;END IF;
 RETURN rounded::bigint;
EXCEPTION WHEN OTHERS THEN RETURN NULL;END;$$;
CREATE FUNCTION keryx_storage.a2a_original_binding_valid(b jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE key text;profile jsonb:=keryx_storage.a2a_original_profile();
BEGIN
 IF b IS NULL OR jsonb_typeof(b)<>'object' OR octet_length(b::text)>8192
  OR b-'id'-'queryId'-'requestHash'-'payer'-'payee'-'authorizationId'-'amountMicroUsdc'-'creatorBudgetMicroUsdc'-'serviceFeeMicroUsdc'-'packageFingerprint'-'network'-'asset'-'gatewayContract'<>'{}'::jsonb THEN RETURN false;END IF;
 FOREACH key IN ARRAY ARRAY['id','queryId','requestHash','payer','payee','authorizationId','amountMicroUsdc','creatorBudgetMicroUsdc','serviceFeeMicroUsdc','packageFingerprint','network','asset','gatewayContract'] LOOP
  IF jsonb_typeof(b->key) IS DISTINCT FROM 'string' THEN RETURN false;END IF;
 END LOOP;
 IF b->>'id' !~ '^a2a_[a-f0-9]{64}$' OR b->>'id'<>b->>'queryId' OR b->>'requestHash' !~ '^[a-f0-9]{64}$'
  OR b->>'packageFingerprint' !~ '^[a-f0-9]{64}$' OR b->>'payer' !~ '^0x[a-f0-9]{40}$' OR b->>'payee' !~ '^0x[a-f0-9]{40}$'
  OR b->>'authorizationId' !~ '^0x[a-f0-9]{64}$' OR b->>'network'<>profile->>'network' OR b->>'asset'<>profile->>'asset' OR b->>'gatewayContract'<>profile->>'gatewayContract' THEN RETURN false;END IF;
 FOREACH key IN ARRAY ARRAY['amountMicroUsdc','creatorBudgetMicroUsdc','serviceFeeMicroUsdc'] LOOP
  IF b->>key !~ '^[1-9][0-9]{0,15}$' OR (b->>key)::numeric>9007199254740991 THEN RETURN false;END IF;
 END LOOP;
 RETURN (b->>'amountMicroUsdc')::bigint=(b->>'creatorBudgetMicroUsdc')::bigint+(b->>'serviceFeeMicroUsdc')::bigint
  AND b->>'id'='a2a_'||encode(sha256(convert_to('keryx-a2a-v2|'||(b->>'network')||'|'||(b->>'payer')||'|'||(b->>'payee')||'|'||(b->>'authorizationId'),'UTF8')),'hex');
EXCEPTION WHEN OTHERS THEN RETURN false;END;$$;
CREATE FUNCTION keryx_storage.a2a_original_matches(o public.a2a_orders,b jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE request jsonb:=o.request_data;package jsonb;mode text:=CASE WHEN o.research_mode='quick' THEN 'quick' ELSE 'deep' END;preimage text;
BEGIN
 IF NOT keryx_storage.a2a_original_binding_valid(b) OR o.id IS DISTINCT FROM b->>'id' OR o.query_id IS DISTINCT FROM b->>'queryId'
  OR o.request_hash IS DISTINCT FROM b->>'requestHash' OR lower(o.payer) IS DISTINCT FROM b->>'payer' OR lower(o.payee) IS DISTINCT FROM b->>'payee'
  OR lower(o.authorization_id) IS DISTINCT FROM b->>'authorizationId' OR o.transaction_id IS NULL OR keryx_storage.a2a_trim(o.transaction_id)=''
  OR keryx_storage.a2a_utf16_length(o.transaction_id)>512 OR request IS NULL OR jsonb_typeof(request)<>'object' OR request ? 'monthlyId'
  OR request->>'network' IS DISTINCT FROM b->>'network' OR request->>'origin' IS NULL OR request->>'origin' NOT IN('a2a','engine')
  OR jsonb_typeof(request->'question') IS DISTINCT FROM 'string' OR keryx_storage.a2a_trim(request->>'question')='' OR keryx_storage.a2a_utf16_length(request->>'question')>10000
  OR request ? 'model' AND(jsonb_typeof(request->'model') IS DISTINCT FROM 'string' OR keryx_storage.a2a_trim(request->>'model')='' OR keryx_storage.a2a_utf16_length(request->>'model')>256)
  OR keryx_storage.a2a_exact_micros(o.amount_usdc) IS DISTINCT FROM (b->>'amountMicroUsdc')::bigint
  OR keryx_storage.a2a_exact_micros(o.creator_budget_usdc) IS DISTINCT FROM (b->>'creatorBudgetMicroUsdc')::bigint
  OR keryx_storage.a2a_exact_micros(o.service_fee_usdc) IS DISTINCT FROM (b->>'serviceFeeMicroUsdc')::bigint THEN RETURN false;END IF;
 SELECT value INTO package FROM jsonb_array_elements(keryx_storage.a2a_original_packages()) WHERE value->'wire'=o.package_data AND value->'wire'->>'researchMode'=mode;
 IF package IS NULL OR package->>'fingerprint' IS DISTINCT FROM b->>'packageFingerprint' THEN RETURN false;END IF;
 preimage:='{"question":'||to_json(request->>'question')::text||',"creatorBudgetUsdc6":'||(b->>'creatorBudgetMicroUsdc')||',"serviceFeeUsdc6":'||(b->>'serviceFeeMicroUsdc')||',"researchMode":'||to_json(mode)::text||',"researchPackageFingerprint":'||to_json(package->>'fingerprint')::text||',"model":'||coalesce(to_json(request->>'model')::text,'null')||'}';
 RETURN encode(sha256(convert_to(preimage,'UTF8')),'hex')=b->>'requestHash';
EXCEPTION WHEN OTHERS THEN RETURN false;END;$$;
CREATE FUNCTION keryx_storage.a2a_original_settled(o public.a2a_orders,b jsonb) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.research_purchase_authorizations c JOIN public.payment_events p
  ON p.id='inbound_'||(b->>'id') AND p.kind='inbound' AND p.source_id='a2a' AND p.query_id=c.purchase_id
  AND lower(p.payer)=c.payer AND lower(p.payee)=c.payee AND lower(p.authorization_id)=c.authorization_id AND p.network=c.network
  AND p.settled=true AND p.settlement_status='settled' AND p.tx_hash=o.transaction_id
  AND p.amount_usdc::double precision=(b->>'amountMicroUsdc')::double precision/1000000::double precision
  WHERE c.network=b->>'network' AND c.asset=b->>'asset' AND c.payer=b->>'payer' AND c.payee=b->>'payee' AND c.authorization_id=b->>'authorizationId'
  AND c.product='a2a' AND c.purchase_id=b->>'id' AND c.request_hash=b->>'requestHash' AND c.amount_micros=(b->>'amountMicroUsdc')::numeric
  AND NOT EXISTS(SELECT 1 FROM public.research_monthly_redemptions WHERE order_id=c.purchase_id));
$$;
CREATE FUNCTION keryx_storage.a2a_original_row(o public.a2a_orders) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb:=to_jsonb(o);field text;
BEGIN
 FOREACH field IN ARRAY ARRAY['created_at','updated_at','started_at','payment_started_at','result_saving_at'] LOOP
  IF jsonb_typeof(result->field)='string' THEN result:=jsonb_set(result,ARRAY[field],to_jsonb(to_char((result->>field)::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));END IF;
 END LOOP;
 IF octet_length(result::text)>4000000 THEN RAISE EXCEPTION 'native original row bound';END IF;RETURN result;
END;$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
RESET ROLE;
