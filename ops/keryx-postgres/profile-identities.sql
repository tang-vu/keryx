SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('profile_identity_list',ARRAY['profile_verified_identities']::text[],true,true),
 ('profile_identity_begin',ARRAY['profile_verified_identities','profile_identity_challenges']::text[],true,false),
 ('profile_identity_consume',ARRAY['profile_verified_identities','profile_identity_challenges']::text[],true,false),
 ('profile_identity_complete',ARRAY['profile_verified_identities','profile_identity_challenges']::text[],true,false),
 ('profile_identity_unlink',ARRAY['profile_verified_identities','profile_identity_challenges']::text[],true,false);
CREATE FUNCTION keryx_storage.profile_identity_context(wallet text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF wallet IS NULL OR wallet !~ '^0x[0-9a-f]{40}$' OR session_user NOT IN('keryx_app','keryx_reader')
  OR (SELECT mode FROM keryx_storage.control WHERE singleton) IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'native identity context refused';END IF;
 IF current_setting('transaction_read_only')<>'on' AND NOT EXISTS(
  SELECT 1 FROM keryx_storage.writer w JOIN keryx_storage.identity i ON i.identity_digest=w.identity_digest
  WHERE w.transaction_id=txid_current() AND w.operation IN('profile_identity_begin','profile_identity_consume','profile_identity_complete','profile_identity_unlink'))
 THEN RAISE EXCEPTION 'native identity writer refused';END IF;
END;$$;
{{IDENTITY_HELPERS}}
CREATE FUNCTION public.storage_profile_identity_list(expected jsonb,digest text,wallet text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native identity read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'profile_identity_list');
 -- At most two providers. Bound individual TEXT before constructing JSON.
 IF EXISTS(SELECT 1 FROM public.profile_verified_identities p WHERE p.wallet=storage_profile_identity_list.wallet
  AND(octet_length(p.label)>640 OR octet_length(p.external_id)>128 OR octet_length(p.verified_at)>64)) THEN RAISE EXCEPTION 'native identity record bound';END IF;
 RETURN keryx_storage.profile_identities_list_v1(wallet);
END;$$;
-- Four closed write actions. Errors are returned only after a subtransaction has
-- rolled back every provisional change; admission errors are outside that block.
CREATE FUNCTION keryx_storage.profile_identity_write(action text,wallet text,provider text,state_hash text,session_hash text,expires_at text,identity jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;conflict_name text;failure text;
BEGIN
 BEGIN
  CASE action
   WHEN 'begin' THEN result:=keryx_storage.profile_identity_begin_v1(wallet,provider,state_hash,session_hash,expires_at::timestamptz);
   WHEN 'consume' THEN result:=keryx_storage.profile_identity_consume_v1(wallet,provider,state_hash,session_hash,expires_at::timestamptz);
   WHEN 'complete' THEN result:=jsonb_build_object('completed',keryx_storage.profile_identity_complete_v1(wallet,provider,state_hash,session_hash,expires_at::timestamptz,identity));
   WHEN 'unlink' THEN result:=keryx_storage.profile_identity_unlink_v1(wallet,provider);
   ELSE RAISE EXCEPTION 'native identity action refused';
  END CASE;
 EXCEPTION
  WHEN unique_violation THEN
   GET STACKED DIAGNOSTICS conflict_name=CONSTRAINT_NAME;
   IF conflict_name<>'profile_verified_identities_provider_external_id_key' THEN RAISE;END IF;
   result:=jsonb_build_object('error','identity_conflict');
  WHEN raise_exception THEN
   GET STACKED DIAGNOSTICS failure=MESSAGE_TEXT;
   IF failure NOT IN('identity_expired','profile_required') THEN RAISE;END IF;
   result:=jsonb_build_object('error',failure);
 END;
 PERFORM keryx_storage.leave_operation();RETURN result;
END;$$;
CREATE FUNCTION public.storage_profile_identity_begin(expected jsonb,digest text,wallet text,provider text,state_hash text,session_hash text,expires_at text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN PERFORM keryx_storage.require_operation(expected,digest,'profile_identity_begin');RETURN keryx_storage.profile_identity_write('begin',wallet,provider,state_hash,session_hash,expires_at,NULL);END;$$;
CREATE FUNCTION public.storage_profile_identity_consume(expected jsonb,digest text,wallet text,provider text,state_hash text,session_hash text,expires_at text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN PERFORM keryx_storage.require_operation(expected,digest,'profile_identity_consume');RETURN keryx_storage.profile_identity_write('consume',wallet,provider,state_hash,session_hash,expires_at,NULL);END;$$;
CREATE FUNCTION public.storage_profile_identity_complete(expected jsonb,digest text,wallet text,provider text,state_hash text,session_hash text,expires_at text,identity jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM keryx_storage.require_operation(expected,digest,'profile_identity_complete');
 IF identity IS NULL OR octet_length(identity::text)>4096 THEN RAISE EXCEPTION 'native identity input bound';END IF;
 RETURN keryx_storage.profile_identity_write('complete',wallet,provider,state_hash,session_hash,expires_at,identity);
END;$$;
CREATE FUNCTION public.storage_profile_identity_unlink(expected jsonb,digest text,wallet text,provider text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN PERFORM keryx_storage.require_operation(expected,digest,'profile_identity_unlink');RETURN keryx_storage.profile_identity_write('unlink',wallet,provider,NULL,NULL,NULL,NULL);END;$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_profile_identity_list(jsonb,text,text),public.storage_profile_identity_begin(jsonb,text,text,text,text,text,text),
 public.storage_profile_identity_consume(jsonb,text,text,text,text,text,text),public.storage_profile_identity_complete(jsonb,text,text,text,text,text,text,jsonb),
 public.storage_profile_identity_unlink(jsonb,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_profile_identity_list(jsonb,text,text) TO keryx_app,keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_profile_identity_begin(jsonb,text,text,text,text,text,text),public.storage_profile_identity_consume(jsonb,text,text,text,text,text,text),
 public.storage_profile_identity_complete(jsonb,text,text,text,text,text,text,jsonb),public.storage_profile_identity_unlink(jsonb,text,text,text) TO keryx_app;
RESET ROLE;
