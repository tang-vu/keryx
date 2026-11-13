SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only)
SELECT 'account_'||action,CASE action
 WHEN 'resume' THEN ARRAY['account267_sessions'] WHEN 'issue' THEN ARRAY['account267_challenges'] WHEN 'take' THEN ARRAY['account267_challenges'] WHEN 'revoke' THEN ARRAY['account267_sessions']
 WHEN 'complete' THEN ARRAY['account267_accounts','account267_members','account267_credentials','account267_sessions','account267_challenges','account267_events']
 WHEN 'unlink' THEN ARRAY['account267_accounts','account267_members','account267_credentials','account267_sessions','account267_challenges','account267_events']
 ELSE ARRAY['web_sessions','account267_accounts','account267_members','account267_credentials','account267_sessions'] END::text[],true,reading
FROM(VALUES('offer',true),('resolve',true),('current',true),('resume',false),('issue',false),('take',false),('complete',false),('unlink',false),('revoke',false))v(action,reading);
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['account267_accounts','account267_members','account267_credentials','account267_sessions','account267_challenges','account267_events'] LOOP
 EXECUTE format('CREATE TRIGGER native_account_writer BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence()',t);
END LOOP;END;$$;
CREATE FUNCTION keryx_storage.account_retention() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='account267_accounts' THEN
  IF NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.revision IS DISTINCT FROM OLD.revision+1 THEN RAISE EXCEPTION 'account_unavailable';END IF;
 ELSIF TG_TABLE_NAME='account267_challenges' THEN
  IF NEW.nonce_hash IS DISTINCT FROM OLD.nonce_hash OR NEW.session_hash IS DISTINCT FROM OLD.session_hash OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
   OR(OLD.consumed_at IS NOT NULL AND(NEW.consumed_at IS DISTINCT FROM OLD.consumed_at OR NEW.lease_hash IS DISTINCT FROM OLD.lease_hash))
   OR(OLD.completed_at IS NOT NULL AND NEW.completed_at IS DISTINCT FROM OLD.completed_at) THEN RAISE EXCEPTION 'account_unavailable';END IF;
 ELSE
  IF NEW.session_hash IS DISTINCT FROM OLD.session_hash OR NEW.wallet IS DISTINCT FROM OLD.wallet OR NEW.account_id IS DISTINCT FROM OLD.account_id
   OR NEW.member_generation IS DISTINCT FROM OLD.member_generation OR NEW.credential_generation IS DISTINCT FROM OLD.credential_generation
   OR NEW.issued_at IS DISTINCT FROM OLD.issued_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.origin IS DISTINCT FROM OLD.origin
   OR NEW.network IS DISTINCT FROM OLD.network OR NEW.history_consent IS DISTINCT FROM OLD.history_consent
   OR(OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN RAISE EXCEPTION 'account_unavailable';END IF;
 END IF;RETURN NEW;
END;$$;
CREATE TRIGGER native_account_revision_retention BEFORE UPDATE ON public.account267_accounts FOR EACH ROW EXECUTE FUNCTION keryx_storage.account_retention();
CREATE TRIGGER native_account_challenge_retention BEFORE UPDATE ON public.account267_challenges FOR EACH ROW EXECUTE FUNCTION keryx_storage.account_retention();
CREATE TRIGGER native_account_session_retention BEFORE UPDATE ON public.account267_sessions FOR EACH ROW EXECUTE FUNCTION keryx_storage.account_retention();
CREATE FUNCTION keryx_storage.account_session_valid(s jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 RETURN s IS NOT NULL AND jsonb_typeof(s)='object' AND s-'sessionHash'-'wallet'-'issuedAt'-'expiresAt'='{}'::jsonb
  AND jsonb_typeof(s->'sessionHash')='string' AND s->>'sessionHash' ~ '^[a-f0-9]{64}$'
  AND jsonb_typeof(s->'wallet')='string' AND s->>'wallet' ~ '^0x[a-f0-9]{40}$' AND s->>'wallet'<>'0x0000000000000000000000000000000000000000'
  AND jsonb_typeof(s->'issuedAt')='number' AND jsonb_typeof(s->'expiresAt')='number'
  AND (s->>'issuedAt')::numeric=trunc((s->>'issuedAt')::numeric) AND (s->>'expiresAt')::numeric=trunc((s->>'expiresAt')::numeric)
  AND (s->>'issuedAt')::numeric BETWEEN 0 AND 8639999999700000 AND (s->>'expiresAt')::numeric BETWEEN 0 AND 8639999999700000
  AND (s->>'expiresAt')::numeric>(s->>'issuedAt')::numeric AND (s->>'expiresAt')::numeric<=(s->>'issuedAt')::numeric+604800000;
EXCEPTION WHEN OTHERS THEN RETURN false;END;$$;
CREATE FUNCTION keryx_storage.account_binding_valid(b jsonb) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce(b IS NOT NULL AND jsonb_typeof(b)='object' AND b-'origin'-'network'='{}'::jsonb
  AND jsonb_typeof(b->'origin')='string' AND jsonb_typeof(b->'network')='string'
  AND b->>'origin'=(SELECT origin FROM keryx_storage.control WHERE singleton)
  AND b->>'network'=(SELECT identity->>'network' FROM keryx_storage.identity WHERE singleton),false);
$$;
CREATE FUNCTION keryx_storage.account_live(s jsonb,stamp bigint) RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT coalesce(keryx_storage.account_session_valid(s),false) THEN RAISE EXCEPTION 'account_unauthenticated';END IF;
 IF (s->>'issuedAt')::bigint>stamp OR (s->>'expiresAt')::bigint<=stamp OR NOT EXISTS(
  SELECT 1 FROM public.web_sessions WHERE hash=s->>'sessionHash' AND wallet=s->>'wallet'
   AND issued_at=(s->>'issuedAt')::bigint AND expires_at=(s->>'expiresAt')::bigint)
 THEN RAISE EXCEPTION 'account_unauthenticated';END IF;
END;$$;
CREATE FUNCTION keryx_storage.account_membership(selected_id text) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.account267_accounts%rowtype;m record;ms jsonb:='[]'::jsonb;cs jsonb;counted integer:=0;active_count integer:=0;generations text[]:=ARRAY[]::text[];
BEGIN
 SELECT * INTO a FROM public.account267_accounts WHERE account_id=selected_id;IF NOT FOUND THEN RAISE EXCEPTION 'account_unavailable';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.wallet COLLATE "C"),'[]'::jsonb) INTO cs FROM(
  SELECT wallet,account_id,member_generation,generation,login_after,active FROM public.account267_credentials WHERE account_id=selected_id ORDER BY wallet COLLATE "C" LIMIT 9)c;
 FOR m IN SELECT wallet,generation,linked_at FROM public.account267_members WHERE account_id=selected_id ORDER BY wallet COLLATE "C" LIMIT 9 LOOP
  IF m.wallet !~ '^0x[a-f0-9]{40}$' OR m.wallet='0x0000000000000000000000000000000000000000' OR m.generation !~ '^[a-f0-9]{64}$'
   OR cs->counted->>'wallet' IS DISTINCT FROM m.wallet OR cs->counted->>'member_generation' IS DISTINCT FROM m.generation
   OR cs->counted->>'generation' IS NULL OR cs->counted->>'generation' !~ '^[a-f0-9]{64}$'
   OR (cs->counted->>'generation')=ANY(generations) OR cs->counted->'active' NOT IN('0'::jsonb,'1'::jsonb)
  THEN RAISE EXCEPTION 'account_unavailable';END IF;
  generations:=array_append(generations,cs->counted->>'generation');IF cs->counted->'active'='1'::jsonb THEN active_count:=active_count+1;END IF;
  ms:=ms||jsonb_build_array(jsonb_build_object('wallet',m.wallet,'generation',m.generation,'linkedAt',m.linked_at));counted:=counted+1;
 END LOOP;
 IF counted NOT BETWEEN 1 AND 8 OR jsonb_array_length(cs)<>counted OR active_count=0 THEN RAISE EXCEPTION 'account_unavailable';END IF;
 RETURN jsonb_build_object('version',1,'accountId',a.account_id,'revision',a.revision,'createdAt',a.created_at,'members',ms);
END;$$;
CREATE FUNCTION keryx_storage.account_resolve(s jsonb,b jsonb,stamp bigint) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.account267_sessions%rowtype;m public.account267_members%rowtype;c public.account267_credentials%rowtype;
BEGIN
 PERFORM keryx_storage.account_live(s,stamp);IF NOT keryx_storage.account_binding_valid(b) THEN RAISE EXCEPTION 'account_unavailable';END IF;
 SELECT * INTO a FROM public.account267_sessions WHERE session_hash=s->>'sessionHash';IF NOT FOUND THEN RETURN NULL;END IF;
 IF a.revoked_at IS NOT NULL OR a.wallet IS DISTINCT FROM s->>'wallet' OR a.issued_at<>(s->>'issuedAt')::bigint OR a.expires_at<>(s->>'expiresAt')::bigint
  OR a.origin IS DISTINCT FROM b->>'origin' OR a.network IS DISTINCT FROM b->>'network' OR a.history_consent<>1 THEN RAISE EXCEPTION 'account_unauthenticated';END IF;
 SELECT * INTO m FROM public.account267_members WHERE wallet=s->>'wallet';IF NOT FOUND THEN RAISE EXCEPTION 'account_unauthenticated';END IF;
 SELECT * INTO c FROM public.account267_credentials WHERE wallet=s->>'wallet';IF NOT FOUND THEN RAISE EXCEPTION 'account_unauthenticated';END IF;
 IF c.active<>1 OR m.account_id IS DISTINCT FROM a.account_id OR c.account_id IS DISTINCT FROM a.account_id OR m.generation IS DISTINCT FROM a.member_generation
  OR c.member_generation IS DISTINCT FROM a.member_generation OR c.generation IS DISTINCT FROM a.credential_generation THEN RAISE EXCEPTION 'account_unauthenticated';END IF;
 RETURN jsonb_build_object('membership',keryx_storage.account_membership(a.account_id),'session',s,'memberGeneration',m.generation,'credentialGeneration',c.generation,'binding',b);
END;$$;
CREATE FUNCTION keryx_storage.account_offer(s jsonb,b jsonb,stamp bigint) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE current jsonb;m public.account267_members%rowtype;c public.account267_credentials%rowtype;membership jsonb;
BEGIN
 current:=keryx_storage.account_resolve(s,b,stamp);
 IF current IS NOT NULL THEN RETURN jsonb_build_object('accountId',current->'membership'->'accountId','revision',current->'membership'->'revision');END IF;
 SELECT * INTO m FROM public.account267_members WHERE wallet=s->>'wallet';IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO c FROM public.account267_credentials WHERE wallet=s->>'wallet';
 IF NOT FOUND OR c.active<>1 OR c.account_id IS DISTINCT FROM m.account_id OR c.member_generation IS DISTINCT FROM m.generation OR (s->>'issuedAt')::bigint<c.login_after THEN RAISE EXCEPTION 'account_unauthenticated';END IF;
 membership:=keryx_storage.account_membership(m.account_id);RETURN jsonb_build_object('accountId',membership->'accountId','revision',membership->'revision');
END;$$;
CREATE FUNCTION keryx_storage.account_current(snapshot jsonb,stamp bigint) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE current jsonb;
BEGIN
 current:=keryx_storage.account_resolve(snapshot->'session',snapshot->'binding',stamp);
 IF current IS NULL OR current IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'account_changed';END IF;RETURN current;
END;$$;
CREATE FUNCTION public.storage_account_observe(expected jsonb,digest text,selected_action text,args jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE value jsonb;stamp bigint;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'account read-only transaction required';END IF;
 IF selected_action IS NULL OR selected_action NOT IN('offer','resolve','current') THEN RAISE EXCEPTION 'account_unavailable';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'account_'||selected_action);
 BEGIN
  IF args IS NULL OR jsonb_typeof(args)<>'object' OR octet_length(args::text)>32768 THEN RAISE EXCEPTION 'account_unavailable';END IF;
  stamp:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
  IF selected_action='current' THEN
   IF args-'snapshot'<>'{}'::jsonb OR NOT args?'snapshot' THEN RAISE EXCEPTION 'account_unavailable';END IF;
   PERFORM keryx_storage.account_current(args->'snapshot',stamp);value:=NULL;
  ELSE
   IF args-'session'-'binding'<>'{}'::jsonb OR NOT(args?&ARRAY['session','binding']) THEN RAISE EXCEPTION 'account_unavailable';END IF;
   IF selected_action='offer' THEN value:=keryx_storage.account_offer(args->'session',args->'binding',stamp);ELSE value:=keryx_storage.account_resolve(args->'session',args->'binding',stamp);END IF;
  END IF;
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT IN('account_unavailable','account_unauthenticated','account_changed') THEN RAISE;END IF;
  RETURN jsonb_build_object('ok',false,'error',SQLERRM);
 END;
 RETURN jsonb_build_object('ok',true,'value',value);
END;$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_account_observe(jsonb,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_account_observe(jsonb,text,text,jsonb) TO keryx_app,keryx_reader;
RESET ROLE;
