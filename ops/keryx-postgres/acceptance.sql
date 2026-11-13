SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('acceptance_read',ARRAY['a2a_orders','payment_events','research_purchase_authorizations','research_monthly_redemptions','deliverable_acceptance_store','deliverable_acceptance_entries','acceptance_original_projection']::text[],false,true),
 ('acceptance_public',ARRAY['a2a_orders','payment_events','research_purchase_authorizations','research_monthly_redemptions','deliverable_acceptance_store','deliverable_acceptance_entries','acceptance_original_projection']::text[],false,true),
 ('acceptance_metrics',ARRAY['a2a_orders','payment_events','research_purchase_authorizations','research_monthly_redemptions','deliverable_acceptance_store','deliverable_acceptance_entries','acceptance_original_projection']::text[],false,true),
 ('acceptance_submit',ARRAY['a2a_orders','payment_events','research_purchase_authorizations','research_monthly_redemptions','deliverable_acceptance_store','deliverable_acceptance_entries','acceptance_original_projection','web_sessions','api_keys']::text[],true,false);
CREATE FUNCTION keryx_storage.acceptance_bundle(p_owner text,p_network text,p_id text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.a2a_orders%rowtype;p keryx_storage.acceptance_original_projection%rowtype;store_id text;retained text;latest jsonb;
BEGIN
 IF p_owner IS NULL OR p_owner !~ '^0x[a-f0-9]{40}$' OR p_network IS NULL OR p_network NOT IN('eip155:5042','eip155:5042002') OR p_id IS NULL OR p_id !~ '^a2a_[a-f0-9]{64}$' THEN RAISE EXCEPTION 'acceptance_unavailable';END IF;
 SELECT * INTO a FROM public.a2a_orders WHERE id=p_id AND lower(payer)=p_owner;
 IF NOT FOUND OR a.status<>'completed' OR a.response_data IS NULL THEN RAISE EXCEPTION 'acceptance_unavailable';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.research_purchase_authorizations c JOIN public.payment_events e
  ON e.id='inbound_'||p_id AND e.kind='inbound' AND e.source_id='a2a' AND e.query_id=c.purchase_id AND lower(e.payer)=c.payer
   AND lower(e.payee)=c.payee AND lower(e.authorization_id)=c.authorization_id AND e.network=c.network
   AND e.settled=true AND e.settlement_status='settled' AND e.tx_hash=a.transaction_id AND e.amount_usdc=a.amount_usdc
  WHERE c.network=p_network AND c.payer=p_owner AND c.payee=lower(a.payee) AND c.authorization_id=lower(a.authorization_id)
   AND c.product='a2a' AND c.purchase_id=p_id AND c.request_hash=a.request_hash AND c.amount_micros=a.amount_usdc*1000000
   AND NOT EXISTS(SELECT 1 FROM public.research_monthly_redemptions WHERE order_id=c.purchase_id)) THEN RAISE EXCEPTION 'acceptance_unavailable';END IF;
 IF (SELECT count(*) FROM public.deliverable_acceptance_store)<>1 THEN RAISE EXCEPTION 'acceptance_unavailable';END IF;
 SELECT id INTO store_id FROM public.deliverable_acceptance_store;
 SELECT * INTO p FROM keryx_storage.acceptance_original_projection WHERE order_id=p_id;
 IF NOT FOUND OR p.binding IS NULL OR p.store_id IS DISTINCT FROM store_id OR p.owner IS DISTINCT FROM p_owner OR p.network IS DISTINCT FROM p_network
  OR p.source_order_sha256<>encode(sha256(convert_to(p.source_order_wire,'UTF8')),'hex') OR NOT keryx_storage.acceptance_original_matches(p.source_order_wire,a)
 THEN RAISE EXCEPTION 'acceptance_unavailable';END IF;
 retained:='{"order":'||p.source_order_wire||',"deliveryText":'||p.delivery_token||',"settled":true,"network":"'||p_network||'"}';
 IF octet_length(retained)>4194304 OR p.binding->>'originalTextSha256' IS DISTINCT FROM encode(sha256(convert_to(retained,'UTF8')),'hex')
  OR p.binding->>'originalFingerprint' IS DISTINCT FROM encode(sha256(convert_to('keryx-acceptance-original-v1|'||store_id||'|'||p_network||'|'||p_owner||'|'||p_id||'|'||encode(sha256(convert_to(retained,'UTF8')),'hex'),'UTF8')),'hex')
 THEN RAISE EXCEPTION 'acceptance_unavailable';END IF;
 SELECT data::jsonb INTO latest FROM public.deliverable_acceptance_entries WHERE owner=p_owner AND network=p_network AND original_id=p_id ORDER BY revision DESC LIMIT 1;
 RETURN jsonb_build_object('storeId',store_id,'originalText',retained,'latest',latest,'pendingPaymentLegs',EXISTS(SELECT 1 FROM public.payment_events WHERE query_id=p_id AND kind IS DISTINCT FROM 'inbound' AND(settlement_status='pending' OR settlement_status IS NULL)));
END;$$;
CREATE FUNCTION keryx_storage.acceptance_entry_valid(entry jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT keryx_storage.acceptance_input_valid(entry-'revision'-'submittedAt') OR jsonb_typeof(entry->'revision') IS DISTINCT FROM 'number'
  OR entry->>'revision' !~ '^([1-9][0-9]?|100)$' OR jsonb_typeof(entry->'submittedAt') IS DISTINCT FROM 'string'
  OR entry->>'submittedAt' !~ '^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?Z$' THEN RETURN false;END IF;
 PERFORM (entry->>'submittedAt')::timestamptz;RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;$$;
CREATE FUNCTION keryx_storage.acceptance_public_business(p_network text,p_id text) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE owner text;b jsonb;e jsonb;fingerprint text;delivery text;
BEGIN
 SELECT lower(payer) INTO owner FROM public.a2a_orders WHERE id=p_id;
 IF FOUND THEN
  BEGIN
   b:=keryx_storage.acceptance_bundle(owner,p_network,p_id);e:=b->'latest';
   fingerprint:=encode(sha256(convert_to('keryx-acceptance-original-v1|'||(b->>'storeId')||'|'||p_network||'|'||owner||'|'||p_id||'|'||encode(sha256(convert_to(b->>'originalText','UTF8')),'hex'),'UTF8')),'hex');
   delivery:=encode(sha256(convert_to((b->>'originalText')::jsonb->>'deliveryText','UTF8')),'hex');
   IF keryx_storage.acceptance_entry_valid(e) AND e->'publishState'='true'::jsonb AND e->>'originalFingerprint'=fingerprint AND e->>'deliveredDigest'=delivery THEN
    RETURN jsonb_build_object('format','keryx-public-deliverable-state-v1','state',CASE e->>'choice' WHEN 'accept' THEN 'accepted' WHEN 'revise' THEN 'revision_requested' ELSE 'rejected' END,'submittedAt',e->'submittedAt');
   END IF;
  EXCEPTION WHEN OTHERS THEN NULL;END;
 END IF;
 RETURN jsonb_build_object('format','keryx-public-deliverable-state-v1','state','not_shared','submittedAt',null);
END;$$;
CREATE FUNCTION public.storage_acceptance_observe(expected jsonb,digest text,selected_action text,args jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r record;states jsonb:='[]'::jsonb;counted integer:=0;p_network text;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'acceptance read-only required';END IF;
 IF selected_action IS NULL OR selected_action NOT IN('read','public','metrics') THEN RAISE EXCEPTION 'acceptance_unavailable';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'acceptance_'||selected_action);
 IF args IS NULL OR jsonb_typeof(args) IS DISTINCT FROM 'object' OR jsonb_typeof(args->'network') IS DISTINCT FROM 'string'
  OR args->>'network' NOT IN('eip155:5042','eip155:5042002') OR octet_length(args::text)>8192 THEN RAISE EXCEPTION 'acceptance_unavailable';END IF;
 p_network:=args->>'network';
 IF selected_action IN('read','public') THEN
  IF jsonb_typeof(args->'id') IS DISTINCT FROM 'string' OR args->>'id' !~ '^a2a_[a-f0-9]{64}$' THEN RAISE EXCEPTION 'acceptance_unavailable';END IF;
  IF selected_action='read' THEN
   IF args-'owner'-'network'-'id'<>'{}'::jsonb OR jsonb_typeof(args->'owner') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'acceptance_unavailable';END IF;
   RETURN keryx_storage.acceptance_bundle(args->>'owner',p_network,args->>'id');
  END IF;
  IF args-'network'-'id'<>'{}'::jsonb THEN RAISE EXCEPTION 'acceptance_unavailable';END IF;
  RETURN keryx_storage.acceptance_public_business(p_network,args->>'id');
 END IF;
 IF args-'network'<>'{}'::jsonb THEN RAISE EXCEPTION 'acceptance_unavailable';END IF;
 FOR r IN WITH selected AS(SELECT DISTINCT ON(owner,original_id) owner,original_id,data::jsonb data FROM public.deliverable_acceptance_entries WHERE network=p_network ORDER BY owner,original_id,revision DESC)
  SELECT DISTINCT original_id FROM selected WHERE data->'publishState' IN('true'::jsonb,'1'::jsonb) ORDER BY original_id LIMIT 1001 LOOP
  counted:=counted+1;IF counted>1000 THEN RAISE EXCEPTION 'acceptance_unavailable';END IF;
  states:=states||jsonb_build_array(keryx_storage.acceptance_public_business(p_network,r.original_id));
 END LOOP;RETURN states;
END;$$;
CREATE FUNCTION public.storage_acceptance_submit(expected jsonb,digest text,p_owner text,p_network text,p_id text,p_input jsonb,p_authority jsonb,p_original_sha256 text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM keryx_storage.require_operation(expected,digest,'acceptance_submit');
 BEGIN result:=keryx_storage.acceptance_submit_business(p_owner,p_network,p_id,p_input,p_authority,p_original_sha256);
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM IN('acceptance_conflict','acceptance_unauthenticated','acceptance_unavailable') THEN result:=jsonb_build_object('error',SQLERRM);ELSE RAISE;END IF;
 END;
 PERFORM keryx_storage.leave_operation();RETURN result;
END;$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_acceptance_observe(jsonb,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_acceptance_observe(jsonb,text,text,jsonb) TO keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_acceptance_submit(jsonb,text,text,text,text,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated,service_role,keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_acceptance_submit(jsonb,text,text,text,text,jsonb,jsonb,text) TO keryx_app;
RESET ROLE;
