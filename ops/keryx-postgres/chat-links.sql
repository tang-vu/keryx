SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only)
SELECT 'chat_'||action,CASE WHEN reading THEN ARRAY['chat263_links','chat263_tokens','web_sessions','account267_accounts','account267_members','account267_credentials','account267_sessions']
 WHEN action='issue' THEN ARRAY['chat263_tokens'] ELSE ARRAY['chat263_tokens','chat263_links'] END::text[],true,reading
FROM(VALUES('preview',true),('lookup',true),('list',true),('issue',false),('complete',false),('unlink',false),('unlink_account',false))v(action,reading);
CREATE TRIGGER native_chat_link_writer BEFORE INSERT OR UPDATE OR DELETE ON public.chat263_links FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence();
CREATE TRIGGER native_chat_token_writer BEFORE INSERT OR UPDATE OR DELETE ON public.chat263_tokens FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence();
CREATE FUNCTION keryx_storage.chat_recipient_valid(r jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 RETURN coalesce(r IS NOT NULL AND jsonb_typeof(r)='object' AND r-'platform'-'scope'-'userId'-'channel'='{}'::jsonb
  AND jsonb_typeof(r->'platform')='string' AND jsonb_typeof(r->'scope')='string' AND jsonb_typeof(r->'userId')='string' AND jsonb_typeof(r->'channel')='string'
  AND CASE r->>'platform'
   WHEN 'telegram' THEN r->>'scope'='telegram' AND r->>'userId' ~ '^[1-9][0-9]{0,15}$' AND r->>'channel' ~ '^-?[1-9][0-9]{0,15}$'
   WHEN 'slack' THEN r->>'scope' ~ '^T[A-Z0-9]{1,63}$' AND r->>'userId' ~ '^U[A-Z0-9]{1,63}$' AND r->>'channel' ~ '^[CDG][A-Z0-9]{1,63}$'
   WHEN 'discord' THEN r->>'scope' ~ '^[1-9][0-9]{0,19}$' AND r->>'userId' ~ '^[1-9][0-9]{0,19}$' AND r->>'channel' ~ '^[1-9][0-9]{0,19}$'
   ELSE false END,false);
END;$$;
CREATE FUNCTION keryx_storage.chat_pending_valid(p jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 RETURN coalesce(p IS NOT NULL AND jsonb_typeof(p)='object' AND p-'purpose'-'tokenHash'-'recipient'-'binding'-'issuedAt'-'expiresAt'='{}'::jsonb
  AND p->>'purpose'='chat-account-link-v1' AND jsonb_typeof(p->'tokenHash')='string' AND p->>'tokenHash' ~ '^[a-f0-9]{64}$'
  AND keryx_storage.chat_recipient_valid(p->'recipient') AND keryx_storage.account_binding_valid(p->'binding')
  AND CASE p->'recipient'->>'platform' WHEN 'telegram' THEN p->'recipient'->>'channel'=p->'recipient'->>'userId' WHEN 'slack' THEN left(p->'recipient'->>'channel',1)='D' ELSE true END
  AND jsonb_typeof(p->'issuedAt')='number' AND jsonb_typeof(p->'expiresAt')='number'
  AND(p->>'issuedAt')::numeric=trunc((p->>'issuedAt')::numeric) AND(p->>'expiresAt')::numeric=trunc((p->>'expiresAt')::numeric)
  AND(p->>'issuedAt')::numeric BETWEEN 0 AND 8639999999700000 AND(p->>'expiresAt')::numeric BETWEEN 0 AND 8639999999700000
  AND(p->>'expiresAt')::numeric=(p->>'issuedAt')::numeric+300000,false);
EXCEPTION WHEN OTHERS THEN RETURN false;END;$$;
CREATE FUNCTION keryx_storage.chat_link_value(r public.chat263_links) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('platform',(r).platform,'scope',(r).scope,'userId',(r).user_id,'channel',(r).channel,'accountId',(r).account_id,'wallet',(r).wallet,
  'memberGeneration',(r).member_generation,'linkedAt',(r).linked_at,'binding',jsonb_build_object('origin',(r).origin,'network',(r).network));
$$;
CREATE FUNCTION keryx_storage.chat_pending(hash text,b jsonb,stamp bigint) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE r public.chat263_tokens%rowtype;p jsonb;
BEGIN
 IF hash IS NULL OR hash !~ '^[a-f0-9]{64}$' OR NOT keryx_storage.account_binding_valid(b) THEN RAISE EXCEPTION 'chat_unavailable';END IF;
 SELECT * INTO r FROM public.chat263_tokens WHERE token_hash=hash AND origin=b->>'origin' AND network=b->>'network' AND consumed_at IS NULL;
 IF NOT FOUND OR r.issued_at>stamp OR r.expires_at<=stamp THEN RAISE EXCEPTION 'chat_token_invalid';END IF;
 p:=jsonb_build_object('purpose',r.purpose,'tokenHash',r.token_hash,'recipient',jsonb_build_object('platform',r.platform,'scope',r.scope,'userId',r.user_id,'channel',r.channel),
  'binding',jsonb_build_object('origin',r.origin,'network',r.network),'issuedAt',r.issued_at,'expiresAt',r.expires_at);
 IF NOT keryx_storage.chat_pending_valid(p) THEN RAISE EXCEPTION 'chat_unavailable';END IF;RETURN p;
END;$$;
CREATE FUNCTION keryx_storage.chat_current(recipient jsonb,b jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE r public.chat263_links%rowtype;
BEGIN
 IF NOT keryx_storage.chat_recipient_valid(recipient) OR NOT keryx_storage.account_binding_valid(b) THEN RAISE EXCEPTION 'chat_unavailable';END IF;
 SELECT * INTO r FROM public.chat263_links WHERE platform=recipient->>'platform' AND scope=recipient->>'scope' AND user_id=recipient->>'userId' AND origin=b->>'origin' AND network=b->>'network';
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.account267_members m JOIN public.account267_credentials c ON c.wallet=m.wallet
  JOIN public.account267_accounts a ON a.account_id=m.account_id WHERE m.wallet=r.wallet AND m.account_id=r.account_id AND m.generation=r.member_generation
  AND c.account_id=m.account_id AND c.member_generation=m.generation AND c.active=1) THEN RAISE EXCEPTION 'chat_account_changed';END IF;
 RETURN keryx_storage.chat_link_value(r);
END;$$;
CREATE FUNCTION keryx_storage.chat_observe(action text,args jsonb,stamp bigint) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE a jsonb;links jsonb;
BEGIN
 IF args IS NULL OR jsonb_typeof(args)<>'object' OR octet_length(args::text)>32768 THEN RAISE EXCEPTION 'chat_unavailable';END IF;
 CASE action
 WHEN 'preview' THEN
  IF args-'hash'-'binding'<>'{}'::jsonb OR jsonb_typeof(args->'hash') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'chat_unavailable';END IF;
  RETURN keryx_storage.chat_pending(args->>'hash',args->'binding',stamp);
 WHEN 'lookup' THEN
  IF args-'recipient'-'binding'<>'{}'::jsonb THEN RAISE EXCEPTION 'chat_unavailable';END IF;
  RETURN keryx_storage.chat_current(args->'recipient',args->'binding');
 WHEN 'list' THEN
  IF args-'snapshot'<>'{}'::jsonb THEN RAISE EXCEPTION 'chat_unavailable';END IF;a:=keryx_storage.account_current(args->'snapshot',stamp);
  SELECT coalesce(jsonb_agg(keryx_storage.chat_link_value(r.item) ORDER BY r.platform COLLATE "C",r.scope COLLATE "C",r.user_id COLLATE "C"),'[]'::jsonb) INTO links
  FROM(SELECT l AS item,l.platform,l.scope,l.user_id FROM public.chat263_links l WHERE l.account_id=a->'membership'->>'accountId' AND l.origin=a->'binding'->>'origin' AND l.network=a->'binding'->>'network'
   ORDER BY l.platform COLLATE "C",l.scope COLLATE "C",l.user_id COLLATE "C" LIMIT 33)r;
  IF jsonb_array_length(links)>32 THEN RAISE EXCEPTION 'chat_unavailable';END IF;RETURN links;
 ELSE RAISE EXCEPTION 'chat_unavailable';END CASE;
END;$$;
CREATE FUNCTION public.storage_chat_observe(expected jsonb,digest text,selected_action text,args jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE value jsonb;failure text;stamp bigint;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native chat read-only transaction required';END IF;
 IF selected_action IS NULL OR selected_action NOT IN('preview','lookup','list') THEN RAISE EXCEPTION 'chat_unavailable';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'chat_'||selected_action);stamp:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 BEGIN value:=keryx_storage.chat_observe(selected_action,args,stamp);
 EXCEPTION WHEN raise_exception THEN
  failure:=SQLERRM;IF failure IN('account_unauthenticated','account_changed') THEN failure:='chat_account_changed';ELSIF failure='account_unavailable' THEN failure:='chat_unavailable';END IF;
  IF failure NOT IN('chat_unavailable','chat_token_invalid','chat_takeover_refused','chat_account_changed') THEN RAISE;END IF;
  RETURN jsonb_build_object('ok',false,'error',failure);
 END;
 RETURN jsonb_build_object('ok',true,'value',value);
END;$$;
CREATE FUNCTION keryx_storage.chat_remove(r jsonb,b jsonb,stamp bigint) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 DELETE FROM public.chat263_links WHERE platform=r->>'platform' AND scope=r->>'scope' AND user_id=r->>'userId' AND origin=b->>'origin' AND network=b->>'network';
 UPDATE public.chat263_tokens SET consumed_at=stamp WHERE platform=r->>'platform' AND scope=r->>'scope' AND user_id=r->>'userId' AND origin=b->>'origin' AND network=b->>'network' AND consumed_at IS NULL;
END;$$;
CREATE FUNCTION keryx_storage.chat_mutate(action text,args jsonb,stamp bigint) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE a jsonb;p jsonb;r jsonb;b jsonb;hash text;affected integer;link public.chat263_links%rowtype;
BEGIN
 IF args IS NULL OR jsonb_typeof(args)<>'object' OR octet_length(args::text)>32768 THEN RAISE EXCEPTION 'chat_unavailable';END IF;
 CASE action
 WHEN 'issue' THEN
  IF args-'pending'<>'{}'::jsonb OR NOT keryx_storage.chat_pending_valid(args->'pending') THEN RAISE EXCEPTION 'chat_unavailable';END IF;
  p:=args->'pending';r:=p->'recipient';b:=p->'binding';
  IF(p->>'issuedAt')::bigint>stamp OR(p->>'issuedAt')::bigint<stamp-30000 OR(p->>'expiresAt')::bigint<=stamp THEN RAISE EXCEPTION 'chat_token_invalid';END IF;
  IF EXISTS(SELECT 1 FROM public.chat263_links WHERE platform=r->>'platform' AND scope=r->>'scope' AND user_id=r->>'userId' AND origin=b->>'origin' AND network=b->>'network') THEN RAISE EXCEPTION 'chat_takeover_refused';END IF;
  UPDATE public.chat263_tokens SET consumed_at=stamp WHERE platform=r->>'platform' AND scope=r->>'scope' AND user_id=r->>'userId' AND origin=b->>'origin' AND network=b->>'network' AND consumed_at IS NULL;
  DELETE FROM public.chat263_tokens WHERE platform=r->>'platform' AND scope=r->>'scope' AND user_id=r->>'userId' AND origin=b->>'origin' AND network=b->>'network' AND expires_at<=stamp;
  INSERT INTO public.chat263_tokens(token_hash,purpose,platform,scope,user_id,channel,origin,network,issued_at,expires_at)
  VALUES(p->>'tokenHash',p->>'purpose',r->>'platform',r->>'scope',r->>'userId',r->>'channel',b->>'origin',b->>'network',(p->>'issuedAt')::bigint,(p->>'expiresAt')::bigint);RETURN NULL;
 WHEN 'complete' THEN
  IF args-'hash'-'snapshot'<>'{}'::jsonb OR jsonb_typeof(args->'hash') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'chat_unavailable';END IF;
  a:=keryx_storage.account_current(args->'snapshot',stamp);hash:=args->>'hash';p:=keryx_storage.chat_pending(hash,a->'binding',stamp);r:=p->'recipient';b:=p->'binding';
  UPDATE public.chat263_tokens SET consumed_at=stamp WHERE token_hash=hash AND consumed_at IS NULL AND expires_at>stamp;GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'chat_token_invalid';END IF;
  IF EXISTS(SELECT 1 FROM public.chat263_links WHERE platform=r->>'platform' AND scope=r->>'scope' AND user_id=r->>'userId' AND origin=b->>'origin' AND network=b->>'network') THEN RETURN NULL;END IF;
  IF(SELECT count(*) FROM(SELECT 1 FROM public.chat263_links WHERE account_id=a->'membership'->>'accountId' AND origin=b->>'origin' AND network=b->>'network' LIMIT 32)q)>=32 THEN RAISE EXCEPTION 'chat_unavailable';END IF;
  INSERT INTO public.chat263_links(platform,scope,user_id,channel,origin,network,account_id,wallet,member_generation,linked_at)
  VALUES(r->>'platform',r->>'scope',r->>'userId',r->>'channel',b->>'origin',b->>'network',a->'membership'->>'accountId',a->'session'->>'wallet',a->>'memberGeneration',stamp) RETURNING * INTO link;
  RETURN keryx_storage.chat_link_value(link);
 WHEN 'unlink' THEN
  IF args-'recipient'-'binding'<>'{}'::jsonb OR NOT keryx_storage.chat_recipient_valid(args->'recipient') OR NOT keryx_storage.account_binding_valid(args->'binding') THEN RAISE EXCEPTION 'chat_unavailable';END IF;
  PERFORM keryx_storage.chat_remove(args->'recipient',args->'binding',stamp);RETURN NULL;
 WHEN 'unlink_account' THEN
  IF args-'recipient'-'snapshot'<>'{}'::jsonb OR NOT keryx_storage.chat_recipient_valid(args->'recipient') THEN RAISE EXCEPTION 'chat_unavailable';END IF;
  a:=keryx_storage.account_current(args->'snapshot',stamp);r:=args->'recipient';b:=a->'binding';
  IF EXISTS(SELECT 1 FROM public.chat263_links WHERE platform=r->>'platform' AND scope=r->>'scope' AND user_id=r->>'userId' AND origin=b->>'origin' AND network=b->>'network' AND account_id<>a->'membership'->>'accountId') THEN RAISE EXCEPTION 'chat_takeover_refused';END IF;
  PERFORM keryx_storage.chat_remove(r,b,stamp);RETURN NULL;
 ELSE RAISE EXCEPTION 'chat_unavailable';END CASE;
END;$$;
CREATE FUNCTION public.storage_chat_write(expected jsonb,digest text,selected_action text,args jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE value jsonb;failure text;stamp bigint;
BEGIN
 IF selected_action IS NULL OR selected_action NOT IN('issue','complete','unlink','unlink_account') THEN RAISE EXCEPTION 'chat_unavailable';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'chat_'||selected_action);stamp:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 BEGIN value:=keryx_storage.chat_mutate(selected_action,args,stamp);
 EXCEPTION WHEN raise_exception THEN
  failure:=SQLERRM;IF failure IN('account_unauthenticated','account_changed') THEN failure:='chat_account_changed';ELSIF failure='account_unavailable' THEN failure:='chat_unavailable';END IF;
  IF failure NOT IN('chat_unavailable','chat_token_invalid','chat_takeover_refused','chat_account_changed') THEN RAISE;END IF;
  PERFORM keryx_storage.leave_operation();RETURN jsonb_build_object('ok',false,'error',failure);
 END;
 PERFORM keryx_storage.leave_operation();
 IF selected_action='complete' AND value IS NULL THEN RETURN jsonb_build_object('ok',false,'error','chat_takeover_refused');END IF;
 RETURN jsonb_build_object('ok',true,'value',value);
END;$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_chat_observe(jsonb,text,text,jsonb),public.storage_chat_write(jsonb,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.storage_chat_write(jsonb,text,text,jsonb) FROM keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_chat_observe(jsonb,text,text,jsonb) TO keryx_app,keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_chat_write(jsonb,text,text,jsonb) TO keryx_app;
RESET ROLE;
