-- Original-bound session recovery. Pure TS validators verify the complete signed
-- protocol; these native commands recheck retained facts and every mutation/CAS.
SET ROLE keryx_owner;
CREATE TABLE public.session_withdrawal_exposures(request_id text PRIMARY KEY REFERENCES public.session_withdrawal_preparations(request_id));
CREATE TABLE public.session_withdrawal_publication_aborts(request_id text PRIMARY KEY REFERENCES public.session_withdrawal_preparations(request_id),
 data text NOT NULL CHECK(octet_length(data)<=2048 AND jsonb_typeof(data::jsonb)='object'));
ALTER TABLE public.creator_withdrawal_requests ADD COLUMN created_at text NOT NULL DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
CREATE TABLE public.creator_withdrawal_transfer_attempts(id text PRIMARY KEY REFERENCES public.creator_withdrawal_requests(id),
 claim_id text NOT NULL,started_at text NOT NULL DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
CREATE TABLE public.creator_withdrawal_attestations(id text PRIMARY KEY REFERENCES public.creator_withdrawal_transfer_attempts(id),
 claim_id text NOT NULL,transfer_id text NOT NULL UNIQUE,data text NOT NULL CHECK(octet_length(data)<=8192 AND jsonb_typeof(data::jsonb)='object'),
 saved_at text NOT NULL DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['session_withdrawal_exposures','session_withdrawal_publication_aborts','creator_withdrawal_transfer_attempts','creator_withdrawal_attestations'] LOOP
  EXECUTE format('CREATE TRIGGER native_writer BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence()',name);
  EXECUTE format('CREATE TRIGGER native_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION keryx_storage.immutable()',name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,keryx_app,keryx_reader',name);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['session_withdrawal_preparations','session_withdrawal_completions','session_withdrawal_cancellations',
  'session_withdrawal_exposures','session_withdrawal_publication_aborts','creator_withdrawal_transfer_attempts','creator_withdrawal_attestations'] LOOP
  EXECUTE format('CREATE TRIGGER withdrawal_retained BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION keryx_storage.immutable()',name);
 END LOOP;
END; $$;

CREATE FUNCTION keryx_storage.session_withdrawal_pending(signer text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.session_withdrawal_preparations p WHERE p.signer=$1
  AND NOT EXISTS(SELECT 1 FROM public.session_withdrawal_completions c WHERE c.request_id=p.request_id)
  AND NOT EXISTS(SELECT 1 FROM public.session_withdrawal_cancellations c WHERE c.request_id=p.request_id)
  AND NOT EXISTS(SELECT 1 FROM public.session_withdrawal_publication_aborts a WHERE a.request_id=p.request_id));
$$;
CREATE FUNCTION keryx_storage.creator_owner_withdrawal_pending(signer text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.creator_withdrawal_requests r WHERE r.owner=$1
  AND NOT EXISTS(SELECT 1 FROM public.session_withdrawal_preparations p WHERE p.request_id=r.id)
  AND NOT EXISTS(SELECT 1 FROM public.creator_owner_withdrawal_completions c WHERE c.request_id=r.id));
$$;
CREATE OR REPLACE FUNCTION keryx_storage.grant_barriers() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.hosted_treasury_policies WHERE signer=NEW.sess_addr) THEN RAISE EXCEPTION 'dedicated hosted signer cannot become browser authority'; END IF;
 IF (TG_OP='INSERT' OR NEW.expiry>0) AND (keryx_storage.session_withdrawal_pending(lower(NEW.sess_addr))
  OR keryx_storage.creator_owner_withdrawal_pending(lower(NEW.sess_addr)))
 THEN RAISE EXCEPTION 'original withdrawal admission barrier'; END IF;
 RETURN NEW;
END; $$;
CREATE FUNCTION keryx_storage.session_withdrawal_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE original_id text; p jsonb;
BEGIN
 IF TG_TABLE_NAME='browser_authorization_intents' THEN
  IF keryx_storage.session_withdrawal_pending(lower(NEW.signer)) OR keryx_storage.creator_owner_withdrawal_pending(lower(NEW.signer))
  THEN RAISE EXCEPTION 'withdrawal payment admission paused'; END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='creator_withdrawal_requests' THEN original_id:=NEW.id; ELSE original_id:=NEW.request_id; END IF;
 IF TG_TABLE_NAME<>'session_withdrawal_publication_aborts' AND EXISTS(SELECT 1 FROM public.session_withdrawal_publication_aborts a WHERE a.request_id=original_id)
 THEN RAISE EXCEPTION 'original publication permanently aborted'; END IF;
 IF TG_TABLE_NAME='session_withdrawal_preparations' THEN
  p:=NEW.data::jsonb;
  IF p->>'format' IS DISTINCT FROM 'keryx-session-withdrawal-preparation-v1' OR p->>'network' IS DISTINCT FROM 'eip155:5042'
   OR p->>'requestId' IS DISTINCT FROM NEW.request_id OR p->>'ownerAddr' IS DISTINCT FROM NEW.recovery_owner
   OR p->>'sessAddr' IS DISTINCT FROM NEW.signer OR p->>'grantEpoch' IS DISTINCT FROM NEW.grant_epoch
   OR keryx_storage.session_withdrawal_pending(NEW.signer) THEN RAISE EXCEPTION 'original session withdrawal admission refused'; END IF;
 ELSIF TG_TABLE_NAME='session_withdrawal_exposures' THEN
  IF EXISTS(SELECT 1 FROM public.session_withdrawal_cancellations c WHERE c.request_id=original_id) THEN RAISE EXCEPTION 'cancelled withdrawal cannot expose'; END IF;
 ELSIF TG_TABLE_NAME='session_withdrawal_cancellations' THEN
  IF EXISTS(SELECT 1 FROM public.session_withdrawal_exposures e WHERE e.request_id=original_id)
   OR EXISTS(SELECT 1 FROM public.creator_withdrawal_requests r WHERE r.id=original_id)
   OR EXISTS(SELECT 1 FROM public.creator_withdrawal_transfer_attempts a WHERE a.id=original_id)
  THEN RAISE EXCEPTION 'exposed withdrawal cannot cancel'; END IF;
 ELSIF TG_TABLE_NAME='creator_withdrawal_requests' THEN
  IF EXISTS(SELECT 1 FROM public.session_withdrawal_preparations p WHERE p.request_id=original_id)
   AND (NOT EXISTS(SELECT 1 FROM public.session_withdrawal_exposures e WHERE e.request_id=original_id)
    OR EXISTS(SELECT 1 FROM public.session_withdrawal_cancellations c WHERE c.request_id=original_id))
  THEN RAISE EXCEPTION 'original withdrawal signing not authorized'; END IF;
 ELSIF TG_TABLE_NAME='session_withdrawal_publication_aborts' THEN
  p:=NEW.data::jsonb;
  IF NOT EXISTS(SELECT 1 FROM public.session_withdrawal_preparations w WHERE w.request_id=original_id AND p->>'requestId'=w.request_id
    AND p->>'ownerAddr'=w.recovery_owner AND p->>'sessAddr'=w.signer AND p->>'grantEpoch'=w.grant_epoch
    AND p->>'network'='eip155:5042' AND p->>'format'='keryx-session-withdrawal-publication-abort-v1')
   OR EXISTS(SELECT 1 FROM public.creator_withdrawal_requests r WHERE r.id=original_id)
   OR EXISTS(SELECT 1 FROM public.creator_withdrawal_transfer_attempts a WHERE a.id=original_id)
   OR EXISTS(SELECT 1 FROM public.creator_withdrawal_attestations a WHERE a.id=original_id)
   OR EXISTS(SELECT 1 FROM public.session_withdrawal_completions c WHERE c.request_id=original_id)
  THEN RAISE EXCEPTION 'original publication abort refused'; END IF;
 END IF;
 RETURN NEW;
END; $$;
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['browser_authorization_intents','creator_withdrawal_requests','session_withdrawal_preparations',
  'session_withdrawal_completions','session_withdrawal_exposures','session_withdrawal_cancellations','session_withdrawal_publication_aborts'] LOOP
  EXECUTE format('CREATE TRIGGER session_withdrawal_fence BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION keryx_storage.session_withdrawal_fence()',name);
 END LOOP;
END; $$;

CREATE FUNCTION keryx_storage.session_withdrawal_phase(id text) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM public.session_withdrawal_publication_aborts WHERE request_id=$1) THEN 'aborted_before_publication'
  WHEN EXISTS(SELECT 1 FROM public.session_withdrawal_cancellations WHERE request_id=$1) THEN 'cancelled_unexposed'
  WHEN EXISTS(SELECT 1 FROM public.session_withdrawal_completions WHERE request_id=$1) THEN 'completed'
  WHEN EXISTS(SELECT 1 FROM public.session_withdrawal_exposures WHERE request_id=$1) THEN 'exposed' ELSE 'prepared' END;
$$;
CREATE FUNCTION keryx_storage.session_withdrawal_totals(signer text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE funding jsonb; r record; p jsonb; held numeric:=0; value numeric;
BEGIN
 IF (SELECT active FROM public.browser_journal_control WHERE id=1) IS DISTINCT FROM true THEN RAISE EXCEPTION 'withdrawal accounting unavailable'; END IF;
 funding:=keryx_storage.session_funding_totals(signer,NULL);
 FOR r IN SELECT w.data FROM public.session_withdrawal_preparations w WHERE w.signer=session_withdrawal_totals.signer
  AND NOT EXISTS(SELECT 1 FROM public.session_withdrawal_completions c WHERE c.request_id=w.request_id)
  AND NOT EXISTS(SELECT 1 FROM public.session_withdrawal_cancellations c WHERE c.request_id=w.request_id)
  AND NOT EXISTS(SELECT 1 FROM public.session_withdrawal_publication_aborts a WHERE a.request_id=w.request_id) LOOP
  p:=r.data::jsonb;
  IF p->>'format' IS DISTINCT FROM 'keryx-session-withdrawal-preparation-v1' OR p->>'network' IS DISTINCT FROM 'eip155:5042'
   OR p#>>'{burnIntent,spec,value}' IS NULL OR p#>>'{burnIntent,spec,value}' !~ '^[1-9][0-9]{0,15}$'
   OR p#>>'{burnIntent,maxFee}' IS NULL OR p#>>'{burnIntent,maxFee}' !~ '^(0|[1-9][0-9]{0,15})$'
  THEN RAISE EXCEPTION 'original withdrawal accounting unavailable'; END IF;
  value:=(p#>>'{burnIntent,spec,value}')::numeric+(p#>>'{burnIntent,maxFee}')::numeric;
  held:=held+value;
  IF held>9007199254740991 THEN RAISE EXCEPTION 'withdrawal accounting limit'; END IF;
 END LOOP;
 RETURN jsonb_build_object('heldPaymentMicroUsdc',((funding->>'retainedSpentMicroUsdc')::numeric-(funding->>'confirmedSpentMicroUsdc')::numeric)::text,
  'heldWithdrawalMicroUsdc',held::text,'confirmedSpentMicroUsdc',funding->>'confirmedSpentMicroUsdc');
END; $$;
INSERT INTO keryx_storage.operations VALUES
 ('session_withdrawal_accounting',ARRAY['session_withdrawal_preparations'],true,true),
 ('read_session_withdrawal',ARRAY['session_withdrawal_preparations'],true,true),
 ('pending_session_withdrawal',ARRAY['session_withdrawal_preparations'],true,true),
 ('reserve_session_withdrawal',ARRAY['session_withdrawal_preparations','session_grants'],true,false),
 ('expose_session_withdrawal',ARRAY['session_withdrawal_exposures'],true,false),
 ('cancel_session_withdrawal',ARRAY['session_withdrawal_cancellations'],true,false),
 ('abort_session_withdrawal',ARRAY['session_withdrawal_publication_aborts'],true,false),
 ('complete_session_withdrawal',ARRAY['session_withdrawal_completions'],true,false);
CREATE FUNCTION public.storage_session_withdrawal_accounting(expected jsonb,digest text,signer text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE originals jsonb;
BEGIN PERFORM keryx_storage.require_operation(expected,digest,'session_withdrawal_accounting');
 SELECT coalesce(jsonb_agg(w.data::jsonb),'[]'::jsonb) INTO originals FROM public.session_withdrawal_preparations w
  WHERE w.signer=storage_session_withdrawal_accounting.signer AND keryx_storage.session_withdrawal_phase(w.request_id) IN('prepared','exposed');
 IF jsonb_array_length(originals)>1 OR octet_length(originals::text)>32768 THEN RAISE EXCEPTION 'original withdrawal pending inventory unavailable'; END IF;
 RETURN jsonb_build_object('totals',keryx_storage.session_withdrawal_totals(signer),'preparations',originals); END; $$;
CREATE FUNCTION keryx_storage.session_withdrawal_record(id text,owner_addr text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('preparation',w.data::jsonb,'phase',keryx_storage.session_withdrawal_phase(w.request_id),
  'completion',c.data::jsonb,'abort',a.data::jsonb) FROM public.session_withdrawal_preparations w
 LEFT JOIN public.session_withdrawal_completions c USING(request_id) LEFT JOIN public.session_withdrawal_publication_aborts a USING(request_id)
 WHERE w.request_id=$1 AND w.recovery_owner=$2;
$$;
CREATE FUNCTION public.storage_read_session_withdrawal(expected jsonb,digest text,id text,owner_addr text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN PERFORM keryx_storage.require_operation(expected,digest,'read_session_withdrawal');
 IF id IS NULL OR id !~ '^0x[0-9a-f]{64}$' OR owner_addr IS NULL OR owner_addr !~ '^0x[0-9a-f]{40}$' THEN RAISE EXCEPTION 'withdrawal selector refused'; END IF;
 RETURN keryx_storage.session_withdrawal_record(id,owner_addr); END; $$;
CREATE FUNCTION public.storage_pending_session_withdrawal(expected jsonb,digest text,owner_addr text,signer text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE id text;
BEGIN PERFORM keryx_storage.require_operation(expected,digest,'pending_session_withdrawal');
 IF owner_addr IS NULL OR owner_addr !~ '^0x[0-9a-f]{40}$' OR signer IS NULL OR signer !~ '^0x[0-9a-f]{40}$' THEN RAISE EXCEPTION 'withdrawal selector refused'; END IF;
 SELECT w.request_id INTO id FROM public.session_withdrawal_preparations w WHERE w.recovery_owner=owner_addr AND w.signer=storage_pending_session_withdrawal.signer
  AND keryx_storage.session_withdrawal_phase(w.request_id) IN('prepared','exposed');
 RETURN keryx_storage.session_withdrawal_record(id,owner_addr); END; $$;
CREATE FUNCTION public.storage_reserve_session_withdrawal(expected jsonb,digest text,wire text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p jsonb; saved text; proof jsonb; totals jsonb;
BEGIN PERFORM keryx_storage.require_operation(expected,digest,'reserve_session_withdrawal');
 IF wire IS NULL OR octet_length(wire)>16384 THEN RAISE EXCEPTION 'withdrawal original bound'; END IF; p:=wire::jsonb;
 IF p->>'requestId' IS NULL OR p->>'requestId' !~ '^0x[0-9a-f]{64}$' OR p->>'ownerAddr' IS NULL OR p->>'ownerAddr' !~ '^0x[0-9a-f]{40}$'
  OR p->>'sessAddr' IS NULL OR p->>'sessAddr' !~ '^0x[0-9a-f]{40}$' THEN RAISE EXCEPTION 'withdrawal original refused'; END IF;
 SELECT jsonb_build_object('consent',c.consent::jsonb,'ownerSignature',c.owner_signature,'sessionSignature',c.session_signature) INTO proof
  FROM public.session_grant_consents c WHERE c.owner_addr=p->>'ownerAddr' AND c.sess_addr=p->>'sessAddr' AND c.grant_epoch=p->>'grantEpoch' AND c.consumed_at IS NOT NULL;
 IF proof IS DISTINCT FROM p->'authorization' THEN RAISE EXCEPTION 'retained recovery proof unavailable'; END IF;
 SELECT data INTO saved FROM public.session_withdrawal_preparations WHERE request_id=p->>'requestId';
 IF FOUND THEN
  IF saved IS DISTINCT FROM wire OR keryx_storage.session_withdrawal_phase(p->>'requestId') IN('cancelled_unexposed','aborted_before_publication') THEN RAISE EXCEPTION 'original withdrawal conflict'; END IF;
 ELSE
  totals:=keryx_storage.session_withdrawal_totals(p->>'sessAddr');
  IF totals->>'heldPaymentMicroUsdc' IS DISTINCT FROM p#>>'{balance,heldPaymentMicroUsdc}'
   OR totals->>'heldWithdrawalMicroUsdc' IS DISTINCT FROM p#>>'{balance,heldWithdrawalMicroUsdc}'
   OR totals->>'confirmedSpentMicroUsdc' IS DISTINCT FROM p#>>'{balance,confirmedSpentMicroUsdc}' THEN RAISE EXCEPTION 'withdrawal accounting changed'; END IF;
  INSERT INTO public.session_withdrawal_preparations(request_id,recovery_owner,signer,grant_epoch,data) VALUES(p->>'requestId',p->>'ownerAddr',p->>'sessAddr',p->>'grantEpoch',wire);
  UPDATE public.session_grants SET expiry=0 WHERE lower(sess_addr)=p->>'sessAddr';
 END IF;
 PERFORM keryx_storage.leave_operation(); RETURN NULL;
END; $$;
CREATE FUNCTION keryx_storage.transition_session_withdrawal(id text,owner_addr text,original text,action text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE saved text; phase text;
BEGIN
 SELECT data INTO saved FROM public.session_withdrawal_preparations WHERE request_id=id AND recovery_owner=owner_addr;
 IF NOT FOUND OR saved IS DISTINCT FROM original THEN RAISE EXCEPTION 'original session withdrawal changed'; END IF;
 phase:=keryx_storage.session_withdrawal_phase(id);
 IF action='expose' AND phase IN('prepared','exposed') THEN INSERT INTO public.session_withdrawal_exposures VALUES(id) ON CONFLICT DO NOTHING;
 ELSIF action='cancel' AND phase IN('prepared','cancelled_unexposed') THEN INSERT INTO public.session_withdrawal_cancellations VALUES(id) ON CONFLICT DO NOTHING;
 ELSE RAISE EXCEPTION 'original withdrawal transition refused'; END IF;
END; $$;
CREATE FUNCTION public.storage_expose_session_withdrawal(expected jsonb,digest text,id text,owner_addr text,original text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN PERFORM keryx_storage.require_operation(expected,digest,'expose_session_withdrawal');
 PERFORM keryx_storage.transition_session_withdrawal(id,owner_addr,original,'expose'); PERFORM keryx_storage.leave_operation(); RETURN NULL; END; $$;
CREATE FUNCTION public.storage_cancel_session_withdrawal(expected jsonb,digest text,id text,owner_addr text,original text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN PERFORM keryx_storage.require_operation(expected,digest,'cancel_session_withdrawal');
 PERFORM keryx_storage.transition_session_withdrawal(id,owner_addr,original,'cancel'); PERFORM keryx_storage.leave_operation(); RETURN NULL; END; $$;
CREATE FUNCTION public.storage_abort_session_withdrawal(expected jsonb,digest text,id text,owner_addr text,original text,wire text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE saved text;
BEGIN PERFORM keryx_storage.require_operation(expected,digest,'abort_session_withdrawal');
 IF wire IS NULL OR octet_length(wire)>2048 OR NOT EXISTS(SELECT 1 FROM public.session_withdrawal_preparations w WHERE w.request_id=id AND w.recovery_owner=owner_addr AND w.data=original)
 THEN RAISE EXCEPTION 'original withdrawal abort unavailable'; END IF;
 SELECT data INTO saved FROM public.session_withdrawal_publication_aborts WHERE request_id=id;
 IF FOUND THEN IF saved IS DISTINCT FROM wire THEN RAISE EXCEPTION 'original abort conflict'; END IF;
 ELSE INSERT INTO public.session_withdrawal_publication_aborts VALUES(id,wire); END IF;
 PERFORM keryx_storage.leave_operation(); RETURN NULL;
END; $$;
CREATE FUNCTION public.storage_complete_session_withdrawal(expected jsonb,digest text,id text,owner_addr text,original text,wire text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p jsonb; c jsonb; saved text;
BEGIN PERFORM keryx_storage.require_operation(expected,digest,'complete_session_withdrawal');
 IF wire IS NULL OR octet_length(wire)>16384 THEN RAISE EXCEPTION 'withdrawal completion bound'; END IF; c:=wire::jsonb;
 SELECT data::jsonb INTO p FROM public.session_withdrawal_preparations w WHERE w.request_id=id AND w.recovery_owner=owner_addr AND w.data=original;
 IF NOT FOUND OR c->>'requestId' IS DISTINCT FROM id OR c->>'ownerAddr' IS DISTINCT FROM owner_addr OR c->>'sessAddr' IS DISTINCT FROM p->>'sessAddr'
  OR NOT EXISTS(SELECT 1 FROM public.creator_withdrawal_requests r WHERE r.id=storage_complete_session_withdrawal.id AND r.owner=p->>'sessAddr' AND r.data::jsonb=c->'record')
  OR NOT EXISTS(SELECT 1 FROM public.creator_withdrawal_attestations a WHERE a.id=storage_complete_session_withdrawal.id AND a.data::jsonb=c->'attestation') THEN RAISE EXCEPTION 'original mint authority unavailable'; END IF;
 SELECT data INTO saved FROM public.session_withdrawal_completions WHERE request_id=id;
 IF FOUND THEN IF saved IS DISTINCT FROM wire THEN RAISE EXCEPTION 'original mint completion conflict'; END IF;
 ELSE INSERT INTO public.session_withdrawal_completions VALUES(id,wire); END IF;
 PERFORM keryx_storage.leave_operation(); RETURN NULL;
END; $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_session_withdrawal_accounting(jsonb,text,text),public.storage_read_session_withdrawal(jsonb,text,text,text),
 public.storage_pending_session_withdrawal(jsonb,text,text,text),public.storage_reserve_session_withdrawal(jsonb,text,text),
 public.storage_expose_session_withdrawal(jsonb,text,text,text,text),public.storage_cancel_session_withdrawal(jsonb,text,text,text,text),
 public.storage_abort_session_withdrawal(jsonb,text,text,text,text,text),public.storage_complete_session_withdrawal(jsonb,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_session_withdrawal_accounting(jsonb,text,text),public.storage_read_session_withdrawal(jsonb,text,text,text),
 public.storage_pending_session_withdrawal(jsonb,text,text,text) TO keryx_app,keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_reserve_session_withdrawal(jsonb,text,text),public.storage_expose_session_withdrawal(jsonb,text,text,text,text),
 public.storage_cancel_session_withdrawal(jsonb,text,text,text,text),public.storage_abort_session_withdrawal(jsonb,text,text,text,text,text),
 public.storage_complete_session_withdrawal(jsonb,text,text,text,text,text) TO keryx_app;
RESET ROLE;
