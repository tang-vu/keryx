SET ROLE keryx_owner;
CREATE FUNCTION keryx_storage.creator_owner_totals(owner_addr text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE session jsonb;hosted jsonb;r record;p jsonb;amount numeric;held numeric:=0;completed numeric:=0;payment_held numeric;payment_confirmed numeric;seen integer:=0;
BEGIN
 session:=keryx_storage.session_funding_totals(owner_addr,NULL);hosted:=keryx_storage.hosted_totals(owner_addr,NULL);
 FOR r IN SELECT w.data,c.request_id AS completed FROM public.session_withdrawal_preparations w LEFT JOIN public.session_withdrawal_completions c USING(request_id)
  WHERE w.signer=owner_addr AND NOT EXISTS(SELECT 1 FROM public.session_withdrawal_publication_aborts a WHERE a.request_id=w.request_id)
   AND NOT EXISTS(SELECT 1 FROM public.session_withdrawal_cancellations x WHERE x.request_id=w.request_id) LIMIT 10001 LOOP
  seen:=seen+1;IF seen>10000 THEN RAISE EXCEPTION 'owner withdrawal inspection limit';END IF;p:=r.data::jsonb;
  IF p->>'format' IS DISTINCT FROM 'keryx-session-withdrawal-preparation-v1' OR p->>'network' IS DISTINCT FROM 'eip155:5042'
   OR p#>>'{burnIntent,spec,value}' IS NULL OR p#>>'{burnIntent,spec,value}' !~ '^[1-9][0-9]{0,77}$'
   OR p#>>'{burnIntent,maxFee}' IS NULL OR p#>>'{burnIntent,maxFee}' !~ '^(0|[1-9][0-9]{0,77})$' THEN RAISE EXCEPTION 'session withdrawal original unavailable';END IF;
  amount:=(p#>>'{burnIntent,spec,value}')::numeric+(p#>>'{burnIntent,maxFee}')::numeric;
  IF r.completed IS NULL THEN held:=held+amount;ELSE completed:=completed+amount;END IF;
 END LOOP;
 seen:=0;
 FOR r IN SELECT w.data,c.data AS completion FROM public.creator_withdrawal_requests w LEFT JOIN public.creator_owner_withdrawal_completions c ON c.request_id=w.id
  WHERE w.owner=owner_addr AND NOT EXISTS(SELECT 1 FROM public.session_withdrawal_preparations p WHERE p.request_id=w.id) LIMIT 10001 LOOP
  seen:=seen+1;IF seen>10000 THEN RAISE EXCEPTION 'owner withdrawal inspection limit';END IF;p:=r.data::jsonb;
  IF p->>'network' IS DISTINCT FROM 'eip155:5042' OR p->>'owner' IS DISTINCT FROM owner_addr OR p#>>'{policy,recipient}' IS DISTINCT FROM owner_addr
   OR p#>>'{request,burnIntent,spec,value}' IS NULL OR p#>>'{request,burnIntent,spec,value}' !~ '^[1-9][0-9]{0,77}$'
   OR p#>>'{request,burnIntent,maxFee}' IS NULL OR p#>>'{request,burnIntent,maxFee}' !~ '^(0|[1-9][0-9]{0,77})$' THEN RAISE EXCEPTION 'original owner withdrawal rail unavailable';END IF;
  amount:=(p#>>'{request,burnIntent,spec,value}')::numeric+(p#>>'{request,burnIntent,maxFee}')::numeric;
  IF r.completion IS NULL THEN held:=held+amount;ELSE completed:=completed+amount;END IF;
 END LOOP;
 payment_held:=(session->>'retainedSpentMicroUsdc')::numeric-(session->>'confirmedSpentMicroUsdc')::numeric+(hosted->>'retainedMicroUsdc')::numeric-(hosted->>'confirmedMicroUsdc')::numeric;
 payment_confirmed:=(session->>'confirmedSpentMicroUsdc')::numeric+(hosted->>'confirmedMicroUsdc')::numeric;
 IF least(payment_held,payment_confirmed,held,completed)<0 OR greatest(payment_held,payment_confirmed,held,completed)>9007199254740991 THEN RAISE EXCEPTION 'owner withdrawal accounting unavailable';END IF;
 RETURN jsonb_build_object('heldPaymentMicroUsdc',payment_held::text,'heldWithdrawalMicroUsdc',held::text,'confirmedPaymentMicroUsdc',payment_confirmed::text,'confirmedWithdrawalMicroUsdc',completed::text);
END; $$;
INSERT INTO keryx_storage.operations VALUES
 ('creator_owner_accounting',ARRAY['creator_withdrawal_requests','creator_owner_withdrawal_completions'],true,true),
 ('creator_owner_completion',ARRAY['creator_owner_withdrawal_completions'],true,true),
 ('creator_owner_admit',ARRAY['creator_withdrawal_requests','session_grants'],true,false),
 ('creator_owner_complete',ARRAY['creator_owner_withdrawal_completions'],true,false);
CREATE FUNCTION public.storage_creator_owner_accounting(expected jsonb,digest text,owner_addr text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN PERFORM keryx_storage.require_operation(expected,digest,'creator_owner_accounting');RETURN keryx_storage.creator_owner_totals(owner_addr);END; $$;
CREATE FUNCTION public.storage_creator_owner_completion(expected jsonb,digest text,id text,owner_addr text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN PERFORM keryx_storage.require_operation(expected,digest,'creator_owner_completion');
 IF id IS NULL OR id !~ '^0x[0-9a-f]{64}$' OR owner_addr IS NULL OR owner_addr !~ '^0x[0-9a-f]{40}$' THEN RAISE EXCEPTION 'owner withdrawal selector refused';END IF;
 SELECT jsonb_build_object('record',r.data::jsonb,'completion',c.data::jsonb) INTO result FROM public.creator_withdrawal_requests r
  LEFT JOIN public.creator_owner_withdrawal_completions c ON c.request_id=r.id WHERE r.id=storage_creator_owner_completion.id AND r.owner=owner_addr;RETURN result;
END; $$;
CREATE FUNCTION public.storage_creator_owner_admit(expected jsonb,digest text,wire text,baseline jsonb,available text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;saved text;totals jsonb;
BEGIN PERFORM keryx_storage.require_operation(expected,digest,'creator_owner_admit');
 IF wire IS NULL OR octet_length(wire)>8192 OR available IS NULL OR available !~ '^(0|[1-9][0-9]{0,15})$' THEN RAISE EXCEPTION 'owner withdrawal original bound';END IF;r:=wire::jsonb;
 IF r->>'format' IS DISTINCT FROM 'creator-withdrawal-request-v2' OR r->>'network' IS DISTINCT FROM 'eip155:5042' OR r->>'owner' IS NULL OR r->>'owner' !~ '^0x[0-9a-f]{40}$'
  OR r->>'id' IS NULL OR r->>'id' !~ '^0x[0-9a-f]{64}$' OR r#>>'{policy,recipient}' IS DISTINCT FROM r->>'owner'
  OR r#>>'{request,burnIntent,spec,value}' IS NULL OR r#>>'{request,burnIntent,spec,value}' !~ '^[1-9][0-9]{0,77}$'
  OR r#>>'{request,burnIntent,maxFee}' IS NULL OR r#>>'{request,burnIntent,maxFee}' !~ '^(0|[1-9][0-9]{0,77})$' THEN RAISE EXCEPTION 'owner withdrawal authority unavailable';END IF;
 SELECT data INTO saved FROM public.creator_withdrawal_requests WHERE id=r->>'id';
 IF FOUND THEN IF saved::jsonb IS DISTINCT FROM r THEN RAISE EXCEPTION 'original owner withdrawal conflict';END IF;
 ELSE
  totals:=keryx_storage.creator_owner_totals(r->>'owner');IF totals IS DISTINCT FROM baseline THEN RAISE EXCEPTION 'owner withdrawal accounting changed';END IF;
  IF(totals->>'heldPaymentMicroUsdc')::numeric+(totals->>'heldWithdrawalMicroUsdc')::numeric+(r#>>'{request,burnIntent,spec,value}')::numeric+(r#>>'{request,burnIntent,maxFee}')::numeric>available::numeric
   THEN RAISE EXCEPTION 'owner withdrawal capacity refused';END IF;
  INSERT INTO public.creator_withdrawal_requests(id,owner,data) VALUES(r->>'id',r->>'owner',wire);
  UPDATE public.session_grants SET expiry=0 WHERE lower(sess_addr)=r->>'owner';
 END IF;PERFORM keryx_storage.leave_operation();RETURN NULL;
END; $$;
CREATE FUNCTION public.storage_creator_owner_complete(expected jsonb,digest text,wire text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c jsonb;saved text;
BEGIN PERFORM keryx_storage.require_operation(expected,digest,'creator_owner_complete');
 IF wire IS NULL OR octet_length(wire)>16384 THEN RAISE EXCEPTION 'owner completion bound';END IF;c:=wire::jsonb;
 IF NOT EXISTS(SELECT 1 FROM public.creator_withdrawal_requests r WHERE r.id=c->>'requestId' AND r.owner=c->>'ownerAddr' AND r.data::jsonb=c->'record')
  OR NOT EXISTS(SELECT 1 FROM public.creator_withdrawal_attestations a WHERE a.id=c->>'requestId' AND a.data::jsonb=c->'attestation') THEN RAISE EXCEPTION 'original owner completion unavailable';END IF;
 SELECT data INTO saved FROM public.creator_owner_withdrawal_completions WHERE request_id=c->>'requestId';
 IF FOUND THEN IF saved IS DISTINCT FROM wire THEN RAISE EXCEPTION 'original owner completion conflict';END IF;
 ELSE INSERT INTO public.creator_owner_withdrawal_completions VALUES(c->>'requestId',wire);END IF;
 PERFORM keryx_storage.leave_operation();RETURN NULL;
END; $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_creator_owner_accounting(jsonb,text,text),public.storage_creator_owner_completion(jsonb,text,text,text),
 public.storage_creator_owner_admit(jsonb,text,text,jsonb,text),public.storage_creator_owner_complete(jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_creator_owner_accounting(jsonb,text,text),public.storage_creator_owner_completion(jsonb,text,text,text) TO keryx_app,keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_creator_owner_admit(jsonb,text,text,jsonb,text),public.storage_creator_owner_complete(jsonb,text,text) TO keryx_app;
RESET ROLE;
