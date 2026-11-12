-- Retained hosted policy and original-bound observation/submission/confirmation.
-- New authorization admission and private execution protocols are separate.
SET ROLE keryx_owner;
CREATE TABLE public.hosted_treasury_authorizations(nonce text PRIMARY KEY,policy_digest text NOT NULL REFERENCES public.hosted_treasury_policies(digest),
 signer text NOT NULL,query_id text NOT NULL,amount_micro bigint NOT NULL CHECK(amount_micro BETWEEN 1 AND 9007199254740991),
 original text NOT NULL CHECK(octet_length(original)<=8192 AND jsonb_typeof(original::jsonb)='object'),header_hash text,
 submitted smallint NOT NULL DEFAULT 0 CHECK(submitted IN(0,1)));
CREATE INDEX hosted_authorization_signer_query ON public.hosted_treasury_authorizations(signer,query_id);
CREATE TABLE public.private_research_intents(id text PRIMARY KEY,payer text NOT NULL,data text NOT NULL,
 created_at text NOT NULL DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
CREATE TABLE public.private_research_payment_attempts(id text PRIMARY KEY REFERENCES public.private_research_intents(id),
 started_at text NOT NULL DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),confirmation text,settled_at text,
 CHECK((confirmation IS NULL)=(settled_at IS NULL)));
CREATE TABLE public.private_research_executions(id text PRIMARY KEY REFERENCES public.private_research_payment_attempts(id),worker_id text NOT NULL,
 started_at text NOT NULL DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
CREATE TABLE public.private_research_results(id text PRIMARY KEY REFERENCES public.private_research_executions(id),serialized_run text NOT NULL,
 saved_at text NOT NULL DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
CREATE TABLE public.private_research_interruptions(id text PRIMARY KEY REFERENCES public.private_research_executions(id),worker_id text NOT NULL,
 reason text NOT NULL CHECK(reason='worker-interrupted'),recorded_at text NOT NULL DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
CREATE TABLE public.private_creator_submissions(job_id text NOT NULL REFERENCES public.private_research_executions(id),leg_id text NOT NULL,worker_id text NOT NULL,
 authorization_id text NOT NULL UNIQUE,amount_micros bigint NOT NULL CHECK(amount_micros BETWEEN 1 AND 1000000),data text NOT NULL,
 started_at text NOT NULL DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),PRIMARY KEY(job_id,leg_id));
CREATE TABLE public.private_creator_confirmations(authorization_id text PRIMARY KEY REFERENCES public.private_creator_submissions(authorization_id),data text NOT NULL,
 settled_at text NOT NULL DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['hosted_treasury_authorizations','private_research_intents','private_research_payment_attempts','private_research_executions',
  'private_research_results','private_research_interruptions','private_creator_submissions','private_creator_confirmations'] LOOP
  EXECUTE format('CREATE TRIGGER native_writer BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence()',name);
  EXECUTE format('CREATE TRIGGER native_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION keryx_storage.immutable()',name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,keryx_app,keryx_reader',name);
 END LOOP;
END; $$;
CREATE FUNCTION keryx_storage.hosted_original_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'hosted original retained'; END IF;
 IF TG_OP='INSERT' THEN
  IF keryx_storage.creator_owner_withdrawal_pending(NEW.signer) THEN RAISE EXCEPTION 'owner withdrawal hosted admission paused'; END IF;
 ELSIF NEW.nonce IS DISTINCT FROM OLD.nonce OR NEW.policy_digest IS DISTINCT FROM OLD.policy_digest OR NEW.signer IS DISTINCT FROM OLD.signer
  OR NEW.query_id IS DISTINCT FROM OLD.query_id OR NEW.amount_micro IS DISTINCT FROM OLD.amount_micro OR NEW.original IS DISTINCT FROM OLD.original
  OR NEW.submitted<OLD.submitted OR(OLD.header_hash IS NOT NULL AND NEW.header_hash IS DISTINCT FROM OLD.header_hash)
 THEN RAISE EXCEPTION 'hosted original immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER hosted_original_fence BEFORE INSERT OR UPDATE OR DELETE ON public.hosted_treasury_authorizations FOR EACH ROW EXECUTE FUNCTION keryx_storage.hosted_original_fence();
CREATE FUNCTION keryx_storage.hosted_payment_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.hosted_treasury_authorizations a WHERE 'x402:'||a.nonce=OLD.id) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'hosted payment retained'; END IF;
  IF ROW(NEW.id,NEW.payer,NEW.payee,NEW.amount_usdc,NEW.network,NEW.authorization_id,NEW.authorization_expires_at,NEW.kind,NEW.query_id,NEW.source_id)
   IS DISTINCT FROM ROW(OLD.id,OLD.payer,OLD.payee,OLD.amount_usdc,OLD.network,OLD.authorization_id,OLD.authorization_expires_at,OLD.kind,OLD.query_id,OLD.source_id)
  THEN RAISE EXCEPTION 'hosted payment immutable'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
CREATE TRIGGER hosted_payment_fence BEFORE UPDATE OR DELETE ON public.payment_events FOR EACH ROW EXECUTE FUNCTION keryx_storage.hosted_payment_fence();
CREATE FUNCTION keryx_storage.hosted_totals(signer text,role_name text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r record; o jsonb; m jsonb; submission record; proof jsonb; confirmation jsonb; retained numeric:=0; confirmed numeric:=0; inspected integer:=0;
BEGIN
 IF signer IS NULL OR signer !~ '^0x[0-9a-f]{40}$' OR(role_name IS NOT NULL AND(role_name NOT IN('public','private') OR
   EXISTS(SELECT 1 FROM public.hosted_treasury_policies p WHERE p.signer=hosted_totals.signer AND p.role<>role_name))) THEN RAISE EXCEPTION 'historical hosted custody role unavailable'; END IF;
 FOR r IN SELECT a.nonce,a.original,a.amount_micro,a.submitted,p.* FROM public.hosted_treasury_authorizations a
  LEFT JOIN public.payment_events p ON p.id='x402:'||a.nonce WHERE a.signer=hosted_totals.signer LIMIT 10001 LOOP
  inspected:=inspected+1; IF inspected>10000 THEN RAISE EXCEPTION 'hosted accounting inspection limit exceeded'; END IF;
  o:=r.original::jsonb; m:=o#>'{payload,message}';
  IF jsonb_typeof(o->'context') IS DISTINCT FROM 'object' OR jsonb_typeof(m) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'hosted original unavailable'; END IF;
  IF o#>'{context,privateJob}' IS NOT NULL AND o#>'{context,privateJob}'<>'null'::jsonb THEN
   SELECT * INTO submission FROM public.private_creator_submissions s WHERE s.authorization_id=r.nonce;
   proof:=CASE WHEN FOUND THEN submission.data::jsonb->'submission' ELSE NULL END;
   IF r.submitted=1 AND(proof IS NULL OR proof->>'authorizationId' IS DISTINCT FROM r.nonce OR proof->>'payer' IS DISTINCT FROM signer
    OR proof->>'payee' IS DISTINCT FROM lower(m->>'to') OR proof->>'amountMicros' IS DISTINCT FROM r.amount_micro::text
    OR proof->>'network' IS DISTINCT FROM 'eip155:5042' OR proof->>'asset' IS DISTINCT FROM '{{USDC_ADDRESS}}'
    OR proof->>'authorizationExpiresAt' IS DISTINCT FROM to_char(to_timestamp((m->>'validBefore')::double precision) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    OR submission.job_id IS DISTINCT FROM o#>>'{context,privateJob,id}' OR submission.worker_id IS DISTINCT FROM o#>>'{context,privateJob,workerId}'
    OR submission.data::jsonb->>'kind' IS DISTINCT FROM o#>>'{context,kind}' OR submission.data::jsonb->>'sourceId' IS DISTINCT FROM o#>>'{context,sourceId}'
    OR submission.data::jsonb->>'itemId' IS DISTINCT FROM o#>>'{context,itemId}') THEN RAISE EXCEPTION 'original private hosted submission unavailable'; END IF;
   SELECT data::jsonb INTO confirmation FROM public.private_creator_confirmations WHERE authorization_id=r.nonce;
   IF FOUND THEN
    IF proof IS NULL OR confirmation->'submission' IS DISTINCT FROM proof OR jsonb_typeof(confirmation->'transaction') IS DISTINCT FROM 'string'
     OR coalesce(confirmation->>'transaction','')='' THEN RAISE EXCEPTION 'original private hosted settlement unavailable'; END IF;
    confirmed:=confirmed+r.amount_micro;
   END IF;
   IF r.id IS NOT NULL THEN RAISE EXCEPTION 'private hosted payment cannot become public'; END IF;
  ELSE
   IF r.id IS DISTINCT FROM 'x402:'||r.nonce OR r.authorization_id IS DISTINCT FROM r.nonce OR r.network IS DISTINCT FROM 'eip155:5042'
    OR r.payer IS DISTINCT FROM signer OR r.payee IS DISTINCT FROM lower(m->>'to') OR r.amount_usdc IS NULL
    OR r.amount_usdc::double precision IS DISTINCT FROM r.amount_micro::double precision/1000000
    OR m->>'value' IS DISTINCT FROM r.amount_micro::text OR r.settlement_status NOT IN('pending','settled','failed')
    OR (r.settlement_status='settled') IS DISTINCT FROM (r.settled IS NOT DISTINCT FROM 1) OR(r.settled=1 AND coalesce(r.tx_hash,'')='')
   THEN RAISE EXCEPTION 'original hosted payment accounting unavailable'; END IF;
   IF r.settled=1 THEN confirmed:=confirmed+r.amount_micro; END IF;
  END IF;
  retained:=retained+r.amount_micro;
  IF retained>9007199254740991 OR confirmed>9007199254740991 THEN RAISE EXCEPTION 'hosted accounting limit'; END IF;
 END LOOP;
 RETURN jsonb_build_object('retainedMicroUsdc',retained::text,'confirmedMicroUsdc',confirmed::text);
END; $$;
INSERT INTO keryx_storage.operations VALUES
 ('hosted_accounting',ARRAY['hosted_treasury_authorizations','payment_events','private_creator_submissions','private_creator_confirmations'],true,true),
 ('hosted_admit_policy',ARRAY['hosted_treasury_policies'],true,false),
 ('hosted_submit',ARRAY['hosted_treasury_authorizations','payment_events'],true,false),
 ('hosted_confirm',ARRAY['payment_events'],true,false);
CREATE FUNCTION public.storage_hosted_accounting(expected jsonb,digest text,signer text,role_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN PERFORM keryx_storage.require_operation(expected,digest,'hosted_accounting');RETURN keryx_storage.hosted_totals(signer,role_name);END; $$;
CREATE FUNCTION public.storage_hosted_admit_policy(expected jsonb,digest text,wire text,policy_digest text,role_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p jsonb;saved text;
BEGIN PERFORM keryx_storage.require_operation(expected,digest,'hosted_admit_policy');
 IF wire IS NULL OR octet_length(wire)>4096 OR role_name IS NULL OR role_name NOT IN('public','private')
  OR policy_digest IS DISTINCT FROM encode(sha256(convert_to(wire,'UTF8')),'hex') THEN RAISE EXCEPTION 'hosted policy refused'; END IF;p:=wire::jsonb;
 IF p->>'format' IS DISTINCT FROM 'keryx-hosted-treasury-policy-v1' OR p->>'network' IS DISTINCT FROM 'eip155:5042'
  OR p->>'storageIdentityDigest' IS DISTINCT FROM keryx_storage.identity_digest(expected)
  OR p->>'origin' IS DISTINCT FROM (SELECT origin FROM keryx_storage.control WHERE singleton) OR p->>'signer' IS NULL OR p->>'signer' !~ '^0x[0-9a-f]{40}$'
  OR p->>'signer'='0x0000000000000000000000000000000000000000' OR p->>'lifetimeCapMicroUsdc' IS NULL OR p->>'lifetimeCapMicroUsdc' !~ '^[1-9][0-9]{0,15}$'
  OR p->>'queryCapMicroUsdc' IS NULL OR p->>'queryCapMicroUsdc' !~ '^[1-9][0-9]{0,15}$'
  OR(p->>'queryCapMicroUsdc')::numeric>(p->>'lifetimeCapMicroUsdc')::numeric OR(p->>'lifetimeCapMicroUsdc')::numeric>9007199254740991
  OR jsonb_typeof(p->'expiresAtSeconds') IS DISTINCT FROM 'number' OR(p->>'expiresAtSeconds')::numeric<=extract(epoch FROM clock_timestamp())
  OR(p->>'expiresAtSeconds')::numeric>9007199254740991 OR trunc((p->>'expiresAtSeconds')::numeric)<>(p->>'expiresAtSeconds')::numeric
  OR EXISTS(SELECT 1 FROM public.browser_signer_capacity c WHERE c.signer=p->>'signer') OR EXISTS(SELECT 1 FROM public.session_grants g WHERE lower(g.sess_addr)=p->>'signer')
  OR EXISTS(SELECT 1 FROM public.hosted_treasury_policies h WHERE h.signer=p->>'signer' AND h.role<>role_name)
 THEN RAISE EXCEPTION 'hosted policy identity or role unavailable'; END IF;
 SELECT data INTO saved FROM public.hosted_treasury_policies h WHERE h.digest=policy_digest;
 IF FOUND THEN IF saved IS DISTINCT FROM wire THEN RAISE EXCEPTION 'hosted policy conflict'; END IF;
 ELSE INSERT INTO public.hosted_treasury_policies VALUES(policy_digest,p->>'signer',role_name,wire); END IF;
 PERFORM keryx_storage.leave_operation();RETURN NULL;
END; $$;
CREATE FUNCTION public.storage_hosted_submit(expected jsonb,digest text,signer text,wire text,header_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s jsonb;r record;m jsonb;
BEGIN PERFORM keryx_storage.require_operation(expected,digest,'hosted_submit');
 IF signer IS NULL OR signer !~ '^0x[0-9a-f]{40}$' OR wire IS NULL OR octet_length(wire)>2048 OR header_hash IS NULL OR header_hash !~ '^0x[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'hosted submission refused';END IF;s:=wire::jsonb;
 SELECT * INTO r FROM public.hosted_treasury_authorizations a WHERE a.nonce=s->>'authorizationId' AND a.signer=storage_hosted_submit.signer;
 IF NOT FOUND OR r.submitted<>0 OR r.header_hash IS NOT NULL THEN RAISE EXCEPTION 'recover original hosted submission';END IF;m:=r.original::jsonb#>'{payload,message}';
 IF s->>'authorizationId' !~ '^0x[0-9a-f]{64}$' OR s->>'payer' IS DISTINCT FROM signer OR s->>'network' IS DISTINCT FROM 'eip155:5042'
  OR s->>'asset' IS DISTINCT FROM '{{USDC_ADDRESS}}' OR s->>'payee' IS DISTINCT FROM lower(m->>'to') OR s->>'amountMicros' IS DISTINCT FROM m->>'value'
  OR s->>'authorizationExpiresAt' IS DISTINCT FROM to_char(to_timestamp((m->>'validBefore')::double precision) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 THEN RAISE EXCEPTION 'original hosted signed tuple conflict';END IF;
 UPDATE public.hosted_treasury_authorizations SET header_hash=storage_hosted_submit.header_hash,submitted=1 WHERE nonce=r.nonce;
 UPDATE public.payment_events SET authorization_phase='submission_attempted' WHERE id='x402:'||r.nonce AND authorization_phase='prepared';
 PERFORM keryx_storage.leave_operation();RETURN NULL;
END; $$;
CREATE FUNCTION public.storage_hosted_confirm(expected jsonb,digest text,signer text,nonce text,transaction_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r record;saved record;
BEGIN PERFORM keryx_storage.require_operation(expected,digest,'hosted_confirm');
 IF signer IS NULL OR signer !~ '^0x[0-9a-f]{40}$' OR nonce IS NULL OR nonce !~ '^0x[0-9a-f]{64}$' OR transaction_hash IS NULL OR octet_length(transaction_hash) NOT BETWEEN 1 AND 256
 THEN RAISE EXCEPTION 'hosted settlement evidence refused';END IF;
 SELECT * INTO r FROM public.hosted_treasury_authorizations a WHERE a.nonce=storage_hosted_confirm.nonce AND a.signer=storage_hosted_confirm.signer;
 IF NOT FOUND OR r.submitted<>1 THEN RAISE EXCEPTION 'original hosted submission unavailable';END IF;
 IF r.original::jsonb#>'{context,privateJob}' IS NOT NULL AND r.original::jsonb#>'{context,privateJob}'<>'null'::jsonb THEN
  IF NOT EXISTS(SELECT 1 FROM public.private_creator_confirmations c WHERE c.authorization_id=nonce AND c.data::jsonb->>'transaction'=transaction_hash)
  THEN RAISE EXCEPTION 'original private confirmation unavailable';END IF;
 ELSE
  UPDATE public.payment_events SET settled=1,settlement_status='settled',authorization_phase='settled',tx_hash=transaction_hash WHERE id='x402:'||nonce AND settlement_status='pending';
  SELECT settled,tx_hash INTO saved FROM public.payment_events WHERE id='x402:'||nonce;
  IF NOT FOUND OR saved.settled IS DISTINCT FROM 1 OR saved.tx_hash IS DISTINCT FROM transaction_hash THEN RAISE EXCEPTION 'original settlement conflict';END IF;
 END IF;
 PERFORM keryx_storage.leave_operation();RETURN NULL;
END; $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_hosted_accounting(jsonb,text,text,text),public.storage_hosted_admit_policy(jsonb,text,text,text,text),
 public.storage_hosted_submit(jsonb,text,text,text,text),public.storage_hosted_confirm(jsonb,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_hosted_accounting(jsonb,text,text,text) TO keryx_app,keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_hosted_admit_policy(jsonb,text,text,text,text),public.storage_hosted_submit(jsonb,text,text,text,text),public.storage_hosted_confirm(jsonb,text,text,text,text) TO keryx_app;
RESET ROLE;
