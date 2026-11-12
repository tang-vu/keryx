-- Original-bound lifetime accounting. No row-count expiry or credit for pending
-- or merely labelled settled events. Mutating browser protocols are separate.
SET ROLE keryx_owner;
CREATE TABLE public.browser_authorization_intents(nonce text PRIMARY KEY,session_id text NOT NULL,request_id text NOT NULL,
 query_id text NOT NULL,grant_epoch text NOT NULL,signer text NOT NULL,network text NOT NULL,token text NOT NULL,
 gateway_contract text NOT NULL,source_id text NOT NULL,offer_id text,kind text NOT NULL,payee text NOT NULL,
 amount_micro_usdc bigint NOT NULL CHECK(amount_micro_usdc>0 AND amount_micro_usdc<=9007199254740991),
 phase text NOT NULL DEFAULT 'prepared' CHECK(phase='prepared'),created_at text NOT NULL,UNIQUE(session_id,request_id));
CREATE INDEX browser_intent_signer ON public.browser_authorization_intents(lower(signer));
CREATE TABLE public.browser_journal_bindings(nonce text PRIMARY KEY REFERENCES public.browser_authorization_intents(nonce),
 requirements text NOT NULL CHECK(jsonb_typeof(requirements::jsonb) IS NOT NULL),
 payment_metadata text NOT NULL CHECK(jsonb_typeof(payment_metadata::jsonb)='object'),valid_after text,valid_before text,header_hash text,
 payment_context text CHECK(payment_context IS NULL OR jsonb_typeof(payment_context::jsonb) IS NOT NULL));
CREATE TABLE public.payment_events(id text PRIMARY KEY,created_at text,kind text,query_id text,source_id text,source_name text,
 payer text,payee text,amount_usdc numeric,weight double precision,rationale text,tx_hash text,network text,settled smallint CHECK(settled IN(0,1)),
 settlement_status text NOT NULL DEFAULT 'simulated',authorization_id text,authorization_expires_at text,grant_epoch text,
 item_id text,item_title text,item_url text,content_version text,item_published_at text,offer_id text,list_price_usdc numeric,
 origin text,authorization_phase text);
CREATE INDEX funding_payment_signer ON public.payment_events(lower(payer)) WHERE grant_epoch IS NOT NULL;
CREATE UNIQUE INDEX browser_journal_payment_nonce ON public.payment_events(network,lower(payer),authorization_id) WHERE authorization_phase IS NOT NULL;
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['browser_authorization_intents','browser_journal_bindings','payment_events'] LOOP
  EXECUTE format('CREATE TRIGGER native_writer BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence()',name);
  EXECUTE format('CREATE TRIGGER native_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION keryx_storage.immutable()',name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,keryx_app,keryx_reader',name);
 END LOOP;
END; $$;
CREATE TRIGGER browser_intent_original BEFORE UPDATE OR DELETE ON public.browser_authorization_intents FOR EACH ROW EXECUTE FUNCTION keryx_storage.immutable();

CREATE FUNCTION keryx_storage.session_funding_totals(signer text,after_time text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE history boolean; retained bigint; confirmed numeric:=0; baseline_debit numeric:=0; baseline timestamptz; r record;
BEGIN
 IF signer IS NULL OR signer !~ '^0x[0-9a-f]{40}$' THEN RAISE EXCEPTION 'funding selector refused'; END IF;
 IF after_time IS NOT NULL THEN
  IF after_time !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN RAISE EXCEPTION 'funding baseline refused'; END IF;
  baseline:=after_time::timestamptz;
  IF to_char(baseline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>after_time THEN RAISE EXCEPTION 'funding baseline refused'; END IF;
 END IF;
 SELECT spent_micro INTO retained FROM public.browser_signer_capacity WHERE public.browser_signer_capacity.signer=session_funding_totals.signer;
 history:=FOUND OR EXISTS(SELECT 1 FROM public.browser_authorization_intents i WHERE lower(i.signer)=session_funding_totals.signer)
  OR EXISTS(SELECT 1 FROM public.session_grants g WHERE lower(g.sess_addr)=session_funding_totals.signer)
  OR EXISTS(SELECT 1 FROM public.session_grant_consents c WHERE lower(c.sess_addr)=session_funding_totals.signer AND c.consumed_at IS NOT NULL);
 IF history AND ((SELECT active FROM public.browser_journal_control WHERE id=1) IS DISTINCT FROM true OR retained IS NULL)
 THEN RAISE EXCEPTION 'retained funding evidence unavailable'; END IF;
 retained:=coalesce(retained,0);
 IF EXISTS(SELECT 1 FROM public.payment_events p LEFT JOIN public.browser_authorization_intents i
   ON i.nonce=substr(p.id,6) AND p.id='x402:'||i.nonce WHERE lower(p.payer)=session_funding_totals.signer AND p.grant_epoch IS NOT NULL AND i.nonce IS NULL)
 THEN RAISE EXCEPTION 'original funding debit unavailable'; END IF;
 FOR r IN SELECT i.*,b.nonce AS binding_nonce,p.id AS payment_id,p.network AS payment_network,p.authorization_id,
   p.grant_epoch AS payment_epoch,p.payer AS payment_payer,p.payee AS payment_payee,p.amount_usdc,p.settled,p.settlement_status,
   p.authorization_phase,p.tx_hash FROM public.browser_authorization_intents i
   LEFT JOIN public.browser_journal_bindings b USING(nonce) LEFT JOIN public.payment_events p ON p.id='x402:'||i.nonce
   WHERE lower(i.signer)=session_funding_totals.signer LOOP
  IF r.binding_nonce IS NULL OR r.payment_id IS NULL OR r.network IS DISTINCT FROM 'eip155:5042' OR r.payment_network IS DISTINCT FROM r.network
   OR lower(r.token) IS DISTINCT FROM '{{USDC_ADDRESS}}' OR lower(r.gateway_contract) IS DISTINCT FROM '{{GATEWAY_ADDRESS}}'
   OR r.authorization_id IS DISTINCT FROM r.nonce OR r.payment_epoch IS DISTINCT FROM r.grant_epoch
   OR lower(r.payment_payer) IS DISTINCT FROM signer OR lower(r.payment_payee) IS DISTINCT FROM lower(r.payee)
   OR r.amount_usdc IS NULL OR abs(r.amount_usdc::double precision*1000000-r.amount_micro_usdc::double precision)>=0.000001
  THEN RAISE EXCEPTION 'original funding tuple unavailable'; END IF;
  PERFORM r.created_at::timestamptz;
  IF (r.settled=1 OR r.settlement_status='settled') AND r.authorization_phase IS DISTINCT FROM 'settled'
  THEN RAISE EXCEPTION 'original settled debit unavailable'; END IF;
  IF r.authorization_phase='settled' THEN
   IF r.settled IS DISTINCT FROM 1 OR r.settlement_status IS DISTINCT FROM 'settled' OR coalesce(btrim(r.tx_hash),'')=''
   THEN RAISE EXCEPTION 'original settled debit unavailable'; END IF;
   confirmed:=confirmed+r.amount_micro_usdc;
   IF baseline IS NOT NULL AND r.created_at::timestamptz>baseline THEN baseline_debit:=baseline_debit+r.amount_micro_usdc; END IF;
  END IF;
 END LOOP;
 IF confirmed>9007199254740991 OR baseline_debit>9007199254740991 OR confirmed>retained THEN RAISE EXCEPTION 'retained funding totals unavailable'; END IF;
 RETURN jsonb_build_object('hasAuthorityHistory',history,'confirmedSpentMicroUsdc',confirmed::text,
  'retainedSpentMicroUsdc',retained::text,'postBaselineConfirmedDebitMicroUsdc',baseline_debit::text);
END; $$;
INSERT INTO keryx_storage.operations VALUES
 ('session_funding_accounting',ARRAY['browser_authorization_intents','browser_journal_bindings','payment_events','browser_signer_capacity','session_grants','session_grant_consents'],true,true),
 ('browser_signer_retained_spend',ARRAY['browser_signer_capacity','browser_journal_control'],true,true);
CREATE FUNCTION public.storage_session_funding_accounting(expected jsonb,digest text,signer text,after_time text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN PERFORM keryx_storage.require_operation(expected,digest,'session_funding_accounting');
 RETURN keryx_storage.session_funding_totals(signer,after_time); END; $$;
CREATE FUNCTION public.storage_browser_signer_retained_spend(expected jsonb,digest text,signer text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE value bigint;
BEGIN
 PERFORM keryx_storage.require_operation(expected,digest,'browser_signer_retained_spend');
 IF signer IS NULL OR signer !~* '^0x[0-9a-f]{40}$' OR (SELECT active FROM public.browser_journal_control WHERE id=1) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'retained signer capacity unavailable'; END IF;
 SELECT spent_micro INTO value FROM public.browser_signer_capacity c WHERE c.signer=lower(storage_browser_signer_retained_spend.signer);
 RETURN to_jsonb(coalesce(value,0));
END; $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_session_funding_accounting(jsonb,text,text,text),public.storage_browser_signer_retained_spend(jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_session_funding_accounting(jsonb,text,text,text),public.storage_browser_signer_retained_spend(jsonb,text,text) TO keryx_app,keryx_reader;
RESET ROLE;
