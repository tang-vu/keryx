SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('private_profile_get',ARRAY['private_profiles','users','query_runs','query_memories','payment_events']::text[],true,true),
 ('private_profile_update',ARRAY['private_profiles']::text[],true,false),
 ('private_profile_delete',ARRAY['private_profiles','profile_verified_identities','profile_identity_challenges','public_researcher_profiles']::text[],true,false);
CREATE FUNCTION keryx_storage.private_profile_context(wallet text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF wallet IS NULL OR wallet !~ '^0x[0-9a-f]{40}$' OR session_user NOT IN('keryx_app','keryx_reader')
  OR(SELECT mode FROM keryx_storage.control WHERE singleton) IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'native profile context refused';END IF;
 IF current_setting('transaction_read_only')<>'on' AND NOT EXISTS(
  SELECT 1 FROM keryx_storage.writer w JOIN keryx_storage.identity i ON i.identity_digest=w.identity_digest
  WHERE w.transaction_id=txid_current() AND w.operation IN('private_profile_update','private_profile_delete'))
 THEN RAISE EXCEPTION 'native profile writer refused';END IF;
END;$$;
CREATE FUNCTION keryx_storage.private_profile_record(p_wallet text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM keryx_storage.private_profile_context(p_wallet);
 IF EXISTS(SELECT 1 FROM public.private_profiles WHERE wallet=p_wallet AND(octet_length(links)>8192 OR octet_length(created_at)>64 OR octet_length(updated_at)>64)) THEN RAISE EXCEPTION 'native profile record bound';END IF;
 SELECT jsonb_build_object('wallet',wallet,'displayName',display_name,'handle',coalesce(handle,''),'bio',bio,'purpose',purpose,
  'links',links::jsonb,'createdAt',created_at,'updatedAt',updated_at) INTO result FROM public.private_profiles WHERE wallet=p_wallet;
 RETURN result;
END;$$;
{{VALIDATED_PROFILE_UPDATE}}
CREATE FUNCTION public.storage_private_profile_get(expected jsonb,digest text,wallet text,network text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE first_seen text;questions bigint;surfaces jsonb;topics jsonb;creators bigint;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native profile read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'private_profile_get');PERFORM keryx_storage.private_profile_context(wallet);
 IF network IS DISTINCT FROM expected->>'network' THEN RAISE EXCEPTION 'native profile network refused';END IF;
 IF EXISTS(SELECT 1 FROM public.users u WHERE u.wallet_address=wallet AND octet_length(u.first_seen_at)>64)
  OR EXISTS(SELECT 1 FROM public.query_runs r WHERE lower(r.asker)=wallet AND octet_length(r.origin)>32)
  OR EXISTS(SELECT 1 FROM public.query_memories m JOIN public.query_runs r ON r.id=m.id WHERE lower(r.asker)=wallet
    AND(jsonb_typeof(m.topics) IS DISTINCT FROM 'array' OR octet_length(m.topics::text)>65536))
 THEN RAISE EXCEPTION 'native profile activity bound';END IF;
 IF EXISTS(SELECT 1 FROM public.query_memories m JOIN public.query_runs r ON r.id=m.id,
  LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(m.topics)='array' THEN m.topics ELSE '[]'::jsonb END) t
  WHERE lower(r.asker)=wallet AND(jsonb_typeof(t.value)<>'string' OR char_length(t.value#>>'{}') NOT BETWEEN 1 AND 80))
 THEN RAISE EXCEPTION 'native profile topic shape';END IF;
 SELECT u.first_seen_at INTO first_seen FROM public.users u WHERE u.wallet_address=wallet;
 SELECT count(*) INTO questions FROM public.query_runs r WHERE lower(r.asker)=wallet;
 SELECT coalesce(jsonb_agg(s.origin ORDER BY s.origin COLLATE "C"),'[]'::jsonb) INTO surfaces FROM
  (SELECT DISTINCT r.origin COLLATE "C" AS origin FROM public.query_runs r WHERE lower(r.asker)=wallet AND r.origin IS NOT NULL ORDER BY 1 LIMIT 17) s;
 SELECT coalesce(jsonb_agg(t.topic ORDER BY t.n DESC,t.topic COLLATE "C"),'[]'::jsonb) INTO topics FROM
  (SELECT (e.value#>>'{}') COLLATE "C" AS topic,count(*) AS n FROM public.query_memories m JOIN public.query_runs r ON r.id=m.id,
   LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(m.topics)='array' THEN m.topics ELSE '[]'::jsonb END) e
   WHERE lower(r.asker)=wallet AND jsonb_typeof(e.value)='string' AND char_length(e.value#>>'{}') BETWEEN 1 AND 80
   GROUP BY 1 ORDER BY 2 DESC,1 LIMIT 12) t;
 SELECT count(DISTINCT lower(p.payee)) INTO creators FROM public.payment_events p JOIN public.query_runs r ON r.id=p.query_id
  WHERE lower(r.asker)=wallet AND p.network=storage_private_profile_get.network AND p.kind IN('fetch','citation') AND p.settled AND p.settlement_status='settled'
   AND p.amount_usdc>0 AND p.tx_hash IS NOT NULL AND length(btrim(p.tx_hash))>0 AND octet_length(p.payee)=42 AND lower(p.payee)~'^0x[0-9a-f]{40}$';
 RETURN jsonb_build_object('profile',keryx_storage.private_profile_record(wallet),'activity',jsonb_build_object(
  'firstSeenAt',first_seen,'questions',questions,'surfacesUsed',surfaces,'topics',topics,'creatorsPaid',creators,'scope','attributed-current-store','network',network));
END;$$;
CREATE FUNCTION public.storage_private_profile_update(expected jsonb,digest text,wallet text,input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;conflict_name text;
BEGIN
 PERFORM keryx_storage.require_operation(expected,digest,'private_profile_update');
 IF input IS NULL OR octet_length(input::text)>8192 THEN RAISE EXCEPTION 'native profile input bound';END IF;
 BEGIN
  result:=keryx_storage.private_profile_update(wallet,input);
 EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS conflict_name=CONSTRAINT_NAME;
  IF conflict_name<>'private_profiles_handle_key' THEN RAISE;END IF;
  PERFORM keryx_storage.leave_operation();RETURN jsonb_build_object('status','handle_conflict');
 END;
 PERFORM keryx_storage.leave_operation();RETURN jsonb_build_object('status','updated','profile',result);
END;$$;
CREATE FUNCTION public.storage_private_profile_delete(expected jsonb,digest text,wallet text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM keryx_storage.require_operation(expected,digest,'private_profile_delete');PERFORM keryx_storage.private_profile_context(wallet);
 DELETE FROM public.private_profiles p WHERE p.wallet=storage_private_profile_delete.wallet;
 PERFORM keryx_storage.leave_operation();RETURN jsonb_build_object('deleted',true);
END;$$;
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['private_profiles','profile_verified_identities','profile_identity_challenges','public_researcher_profiles'] LOOP
 EXECUTE format('CREATE TRIGGER native_profile_writer BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence()',t);
END LOOP;END;$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_private_profile_get(jsonb,text,text,text),public.storage_private_profile_update(jsonb,text,text,jsonb),public.storage_private_profile_delete(jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_private_profile_get(jsonb,text,text,text) TO keryx_app,keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_private_profile_update(jsonb,text,text,jsonb),public.storage_private_profile_delete(jsonb,text,text) TO keryx_app;
RESET ROLE;
