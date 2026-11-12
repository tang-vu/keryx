-- Native owner-consent ledger and its withdrawal/hosted admission dependencies.
-- No signing, funding, vendor call or complete application admission lives here.
SET ROLE keryx_owner;
CREATE TABLE public.browser_journal_control(id integer PRIMARY KEY CHECK(id=1),active boolean NOT NULL);
INSERT INTO public.browser_journal_control VALUES(1,false);
CREATE TABLE public.session_grant_consents(grant_epoch text PRIMARY KEY,owner_addr text NOT NULL,sess_addr text NOT NULL,
 consent text NOT NULL CHECK(octet_length(consent)<=8192 AND jsonb_typeof(consent::jsonb)='object'),issued_at bigint NOT NULL,challenge_expires_at bigint NOT NULL,
 consumed_at bigint,owner_signature text,session_signature text,
 CHECK((consumed_at IS NULL AND owner_signature IS NULL AND session_signature IS NULL)
  OR(consumed_at IS NOT NULL AND owner_signature IS NOT NULL AND session_signature IS NOT NULL
   AND owner_signature ~* '^0x[0-9a-f]{130}$' AND session_signature ~* '^0x[0-9a-f]{130}$')));
CREATE TABLE public.browser_signer_capacity(signer text PRIMARY KEY,spent_micro bigint NOT NULL CHECK(spent_micro BETWEEN 0 AND 9007199254740991));
CREATE TABLE public.browser_retained_grants(grant_epoch text PRIMARY KEY,session_id text NOT NULL,signer text NOT NULL,
 spent_micro bigint NOT NULL CHECK(spent_micro BETWEEN 0 AND 9007199254740991));
CREATE TABLE public.session_grants(session_id text PRIMARY KEY,sess_addr text NOT NULL,owner_addr text NOT NULL,
 cap numeric(22,6) NOT NULL CHECK(cap>=0 AND cap*1000000<=9007199254740991),spent numeric(22,6) NOT NULL CHECK(spent>=0 AND spent*1000000<=9007199254740991),
 expiry bigint NOT NULL,tx_hash text NOT NULL,grant_epoch text NOT NULL REFERENCES public.browser_retained_grants(grant_epoch));
CREATE TABLE public.hosted_treasury_policies(digest text PRIMARY KEY,signer text NOT NULL,role text NOT NULL CHECK(role IN('public','private')),
 data text NOT NULL CHECK(octet_length(data)<=4096 AND jsonb_typeof(data::jsonb)='object'));
CREATE TABLE public.creator_withdrawal_requests(id text PRIMARY KEY,owner text NOT NULL,data text NOT NULL CHECK(octet_length(data)<=16384 AND jsonb_typeof(data::jsonb)='object'));
CREATE TABLE public.creator_owner_withdrawal_completions(request_id text PRIMARY KEY REFERENCES public.creator_withdrawal_requests(id),
 data text NOT NULL CHECK(octet_length(data)<=16384 AND jsonb_typeof(data::jsonb)='object'));
CREATE TABLE public.session_withdrawal_preparations(request_id text PRIMARY KEY,recovery_owner text NOT NULL,signer text NOT NULL,
 grant_epoch text NOT NULL REFERENCES public.session_grant_consents(grant_epoch),data text NOT NULL CHECK(octet_length(data)<=16384 AND jsonb_typeof(data::jsonb)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.session_withdrawal_completions(request_id text PRIMARY KEY REFERENCES public.session_withdrawal_preparations(request_id),
 data text NOT NULL CHECK(octet_length(data)<=16384 AND jsonb_typeof(data::jsonb)='object'));
CREATE TABLE public.session_withdrawal_cancellations(request_id text PRIMARY KEY REFERENCES public.session_withdrawal_preparations(request_id));

CREATE FUNCTION keryx_storage.consent_immutable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF OLD.consumed_at IS NOT NULL OR NEW.grant_epoch IS DISTINCT FROM OLD.grant_epoch OR NEW.owner_addr IS DISTINCT FROM OLD.owner_addr
  OR NEW.sess_addr IS DISTINCT FROM OLD.sess_addr OR NEW.consent IS DISTINCT FROM OLD.consent OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
  OR NEW.challenge_expires_at IS DISTINCT FROM OLD.challenge_expires_at OR NEW.consumed_at IS NULL OR NEW.owner_signature IS NULL OR NEW.session_signature IS NULL
 THEN RAISE EXCEPTION 'session owner consent immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER consent_immutable BEFORE UPDATE ON public.session_grant_consents FOR EACH ROW EXECUTE FUNCTION keryx_storage.consent_immutable();
CREATE TRIGGER consent_retained BEFORE DELETE OR TRUNCATE ON public.session_grant_consents FOR EACH STATEMENT EXECUTE FUNCTION keryx_storage.immutable();
CREATE FUNCTION keryx_storage.grant_barriers() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.hosted_treasury_policies WHERE signer=NEW.sess_addr) THEN RAISE EXCEPTION 'dedicated hosted signer cannot become browser authority'; END IF;
 IF NEW.expiry>0 AND (
  EXISTS(SELECT 1 FROM public.session_withdrawal_preparations w LEFT JOIN public.session_withdrawal_completions c USING(request_id)
   WHERE w.signer=NEW.sess_addr AND c.request_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.session_withdrawal_cancellations x WHERE x.request_id=w.request_id))
  OR EXISTS(SELECT 1 FROM public.creator_withdrawal_requests r WHERE r.owner=NEW.sess_addr
   AND NOT EXISTS(SELECT 1 FROM public.session_withdrawal_preparations p WHERE p.request_id=r.id)
   AND NOT EXISTS(SELECT 1 FROM public.creator_owner_withdrawal_completions c WHERE c.request_id=r.id)))
 THEN RAISE EXCEPTION 'original withdrawal admission barrier'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER grant_barriers BEFORE INSERT OR UPDATE ON public.session_grants FOR EACH ROW EXECUTE FUNCTION keryx_storage.grant_barriers();
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['browser_journal_control','session_grant_consents','browser_signer_capacity','browser_retained_grants','session_grants',
  'hosted_treasury_policies','creator_withdrawal_requests','creator_owner_withdrawal_completions','session_withdrawal_preparations',
  'session_withdrawal_completions','session_withdrawal_cancellations'] LOOP
  EXECUTE format('CREATE TRIGGER native_writer BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence()',name);
  EXECUTE format('CREATE TRIGGER native_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION keryx_storage.immutable()',name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,keryx_app,keryx_reader',name);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['hosted_treasury_policies','creator_withdrawal_requests','creator_owner_withdrawal_completions',
  'session_withdrawal_preparations','session_withdrawal_completions','session_withdrawal_cancellations'] LOOP
  EXECUTE format('CREATE TRIGGER native_original_retained BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION keryx_storage.immutable()',name);
 END LOOP;
 CREATE TRIGGER retained_grant_no_delete BEFORE DELETE ON public.browser_retained_grants FOR EACH ROW EXECUTE FUNCTION keryx_storage.immutable();
END; $$;

CREATE FUNCTION keryx_storage.parse_consent(wire text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE value jsonb; keys text[]; k text; canonical text; v2 boolean;
BEGIN
 IF wire IS NULL OR octet_length(wire)>8192 THEN RAISE EXCEPTION 'session consent refused'; END IF;
 value:=wire::jsonb; v2:=value->>'format'='keryx-session-grant-consent-v2';
 IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR value->>'format' NOT IN('keryx-session-grant-consent-v1','keryx-session-grant-consent-v2')
 THEN RAISE EXCEPTION 'session consent refused'; END IF;
 SELECT array_agg(key ORDER BY key) INTO keys FROM jsonb_object_keys(value) AS key;
 IF keys IS DISTINCT FROM (CASE WHEN v2 THEN ARRAY['capMicroUsdc','durationSeconds','expirySeconds','format','grantEpoch','network','origin','ownerAddr','questionCapMicroUsdc','sessAddr']::text[]
  ELSE ARRAY['capMicroUsdc','expirySeconds','format','grantEpoch','network','origin','ownerAddr','sessAddr']::text[] END) THEN RAISE EXCEPTION 'session consent refused'; END IF;
 FOREACH k IN ARRAY keys LOOP
  IF k<>'durationSeconds' AND jsonb_typeof(value->k) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'session consent refused'; END IF;
 END LOOP;
 IF value->>'network'<>'eip155:5042' OR value->>'origin' IS DISTINCT FROM (SELECT origin FROM keryx_storage.control WHERE singleton)
  OR value->>'ownerAddr' !~ '^0x[0-9a-f]{40}$' OR value->>'sessAddr' !~ '^0x[0-9a-f]{40}$'
  OR value->>'ownerAddr'='0x0000000000000000000000000000000000000000' OR value->>'sessAddr'='0x0000000000000000000000000000000000000000'
  OR value->>'ownerAddr'=value->>'sessAddr'
  OR value->>'grantEpoch' !~ '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$'
  OR value->>'capMicroUsdc' !~ '^[1-9][0-9]{0,15}$' OR (value->>'capMicroUsdc')::numeric>9007199254740991
  OR value->>'expirySeconds' !~ '^[1-9][0-9]{0,15}$' OR (value->>'expirySeconds')::numeric>253402300799
 THEN RAISE EXCEPTION 'session consent refused'; END IF;
 IF v2 AND (jsonb_typeof(value->'durationSeconds') IS DISTINCT FROM 'number' OR value->>'durationSeconds' NOT IN('3600','86400','604800')
  OR value->>'questionCapMicroUsdc' !~ '^[1-9][0-9]{0,15}$' OR (value->>'questionCapMicroUsdc')::numeric>(value->>'capMicroUsdc')::numeric)
 THEN RAISE EXCEPTION 'session consent refused'; END IF;
 SELECT '{'||string_agg(to_json(f.key)::text||':'||f.field::text,',' ORDER BY f.key COLLATE "C")||'}' INTO canonical FROM jsonb_each(value) AS f(key,field);
 IF canonical IS DISTINCT FROM wire THEN RAISE EXCEPTION 'canonical session consent required'; END IF;
 RETURN value;
END; $$;

INSERT INTO keryx_storage.operations VALUES
 ('issue_session_grant_consent',ARRAY['session_grant_consents'],true,false),
 ('consume_session_grant_consent',ARRAY['session_grant_consents','browser_signer_capacity','browser_retained_grants','session_grants'],true,false),
 ('get_session_grant_consent',ARRAY['session_grant_consents'],true,true);
CREATE FUNCTION public.storage_issue_session_grant_consent(expected jsonb,digest text,wire text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE parsed jsonb; now_ms bigint;
BEGIN
 PERFORM keryx_storage.require_operation(expected,digest,'issue_session_grant_consent');
 parsed:=keryx_storage.parse_consent(wire); now_ms:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF (SELECT active FROM public.browser_journal_control WHERE id=1) IS DISTINCT FROM true OR (parsed->>'expirySeconds')::bigint*1000<=now_ms
 THEN RAISE EXCEPTION 'session consent unavailable'; END IF;
 INSERT INTO public.session_grant_consents VALUES(parsed->>'grantEpoch',parsed->>'ownerAddr',parsed->>'sessAddr',wire,now_ms,now_ms+90000,NULL,NULL,NULL);
 PERFORM keryx_storage.leave_operation(); RETURN NULL;
END; $$;
CREATE FUNCTION public.storage_consume_session_grant_consent(expected jsonb,digest text,wire text,owner_sig text,session_sig text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE parsed jsonb; now_ms bigint; spent bigint; cap_micro bigint; changed integer;
BEGIN
 PERFORM keryx_storage.require_operation(expected,digest,'consume_session_grant_consent');
 parsed:=keryx_storage.parse_consent(wire); now_ms:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint; cap_micro:=(parsed->>'capMicroUsdc')::bigint;
 IF (SELECT active FROM public.browser_journal_control WHERE id=1) IS DISTINCT FROM true OR (parsed->>'expirySeconds')::bigint*1000<=now_ms
  OR owner_sig IS NULL OR session_sig IS NULL OR owner_sig !~* '^0x[0-9a-f]{130}$' OR session_sig !~* '^0x[0-9a-f]{130}$'
 THEN RAISE EXCEPTION 'session consent unavailable'; END IF;
 UPDATE public.session_grant_consents c SET consumed_at=now_ms,owner_signature=owner_sig,session_signature=session_sig
  WHERE c.grant_epoch=parsed->>'grantEpoch' AND c.owner_addr=parsed->>'ownerAddr' AND c.sess_addr=parsed->>'sessAddr'
   AND c.consent=wire AND c.consumed_at IS NULL AND c.challenge_expires_at>now_ms;
 GET DIAGNOSTICS changed=ROW_COUNT; IF changed<>1 THEN RAISE EXCEPTION 'session consent already consumed or unavailable'; END IF;
 SELECT spent_micro INTO spent FROM public.browser_signer_capacity WHERE signer=parsed->>'sessAddr'; spent:=coalesce(spent,0);
 IF spent>cap_micro THEN RAISE EXCEPTION 'retained signer capacity refused'; END IF;
 INSERT INTO public.browser_signer_capacity VALUES(parsed->>'sessAddr',0) ON CONFLICT DO NOTHING;
 INSERT INTO public.browser_retained_grants VALUES(parsed->>'grantEpoch',parsed->>'ownerAddr',parsed->>'sessAddr',0);
 INSERT INTO public.session_grants VALUES(parsed->>'ownerAddr',parsed->>'sessAddr',parsed->>'ownerAddr',cap_micro::numeric/1000000,
  spent::numeric/1000000,(parsed->>'expirySeconds')::bigint*1000,'owner-signed-consent',parsed->>'grantEpoch')
 ON CONFLICT(session_id) DO UPDATE SET sess_addr=excluded.sess_addr,owner_addr=excluded.owner_addr,cap=excluded.cap,
  spent=excluded.spent,expiry=excluded.expiry,tx_hash=excluded.tx_hash,grant_epoch=excluded.grant_epoch;
 PERFORM keryx_storage.leave_operation(); RETURN NULL;
END; $$;
CREATE FUNCTION public.storage_get_session_grant_consent(expected jsonb,digest text,owner_addr text,epoch text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM keryx_storage.require_operation(expected,digest,'get_session_grant_consent');
 SELECT jsonb_build_object('consent',c.consent::jsonb,'ownerSignature',c.owner_signature,'sessionSignature',c.session_signature) INTO result
  FROM public.session_grant_consents c WHERE c.owner_addr=storage_get_session_grant_consent.owner_addr AND c.grant_epoch=epoch AND c.consumed_at IS NOT NULL;
 RETURN result;
END; $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_issue_session_grant_consent(jsonb,text,text),public.storage_consume_session_grant_consent(jsonb,text,text,text,text),
 public.storage_get_session_grant_consent(jsonb,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_issue_session_grant_consent(jsonb,text,text),public.storage_consume_session_grant_consent(jsonb,text,text,text,text) TO keryx_app;
GRANT EXECUTE ON FUNCTION public.storage_get_session_grant_consent(jsonb,text,text,text) TO keryx_app,keryx_reader;
RESET ROLE;
