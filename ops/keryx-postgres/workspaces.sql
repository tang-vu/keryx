SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('bibliography_list',ARRAY['private_bibliographies']::text[],true,true),
 ('bibliography_read',ARRAY['private_bibliographies']::text[],true,true),
 ('bibliography_create',ARRAY['private_bibliographies']::text[],true,false),
 ('bibliography_replace',ARRAY['private_bibliographies']::text[],true,false),
 ('bibliography_revoke',ARRAY['private_bibliographies']::text[],true,false);
CREATE TRIGGER native_bibliography_writer BEFORE INSERT OR UPDATE OR DELETE ON public.private_bibliographies FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence();
CREATE FUNCTION keryx_storage.bibliography_metadata(selected public.private_bibliographies) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',selected.id,'title',selected.title,'count',selected.reference_count,'revision',selected.revision,'createdAt',selected.created_at,'updatedAt',selected.updated_at);
$$;
CREATE FUNCTION public.storage_bibliography_list(expected jsonb,digest text,wallet text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE items jsonb;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native bibliography read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'bibliography_list');
 IF wallet IS NULL OR wallet !~ '^0x[a-f0-9]{40}$' THEN RAISE EXCEPTION 'bibliography_unavailable';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.id,'title',b.title,'count',b.reference_count,'revision',b.revision,'createdAt',b.created_at,'updatedAt',b.updated_at) ORDER BY b.created_at COLLATE "C",b.id COLLATE "C"),'[]'::jsonb) INTO items
 FROM(SELECT id,title,reference_count,revision,created_at,updated_at FROM public.private_bibliographies p WHERE p.wallet=storage_bibliography_list.wallet ORDER BY p.created_at COLLATE "C",p.id COLLATE "C" LIMIT 21)b;
 IF jsonb_array_length(items)>20 OR octet_length(items::text)>64512 THEN RAISE EXCEPTION 'bibliography_unavailable';END IF;
 RETURN jsonb_build_object('items',items);
END;$$;
CREATE FUNCTION public.storage_bibliography_read(expected jsonb,digest text,token_digest text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE original text;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native bibliography read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'bibliography_read');IF token_digest IS NULL OR token_digest !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'bibliography_unavailable';END IF;
 SELECT CASE WHEN octet_length(content)<=524288 THEN encode(convert_to(content,'UTF8'),'hex') END INTO original FROM public.private_bibliographies WHERE token_hash=token_digest;
 IF NOT FOUND THEN RETURN jsonb_build_object('item',NULL);END IF;IF original IS NULL THEN RAISE EXCEPTION 'bibliography_unavailable';END IF;
 RETURN jsonb_build_object('item',jsonb_build_object('contentHex',original));
END;$$;
CREATE FUNCTION keryx_storage.bibliography_mutate(selected_action text,wallet text,input_wire text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE packet jsonb;selected_id text;previous public.private_bibliographies%rowtype;result public.private_bibliographies%rowtype;changed integer;expected_revision bigint;
BEGIN
 IF wallet IS NULL OR wallet !~ '^0x[a-f0-9]{40}$' OR input_wire IS NULL OR octet_length(input_wire)>2097152 THEN RAISE EXCEPTION 'bibliography_unavailable';END IF;
 packet:=input_wire::jsonb;selected_id:=packet->>'id';
 IF jsonb_typeof(packet)<>'object' OR selected_id IS NULL OR selected_id !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'bibliography_unavailable';END IF;
 IF selected_action='create' THEN
  IF packet-'id'-'tokenHash'-'title'-'content'-'count'-'now'<>'{}'::jsonb OR packet->>'tokenHash' IS NULL OR packet->>'tokenHash' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'bibliography_unavailable';END IF;
  IF(SELECT count(*) FROM public.private_bibliographies p WHERE p.wallet=bibliography_mutate.wallet)>=20 THEN RAISE EXCEPTION 'bibliography_limit';END IF;
 ELSE
  IF packet-'id'-'revision'-'title'-'content'-'count'-'now'<>'{}'::jsonb OR jsonb_typeof(packet->'revision') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'bibliography_unavailable';END IF;
  expected_revision:=(packet->>'revision')::bigint;
  SELECT p.id,p.revision INTO previous.id,previous.revision FROM public.private_bibliographies p WHERE p.wallet=bibliography_mutate.wallet AND p.id=selected_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'bibliography_not_found';END IF;IF previous.revision IS DISTINCT FROM expected_revision THEN RAISE EXCEPTION 'bibliography_conflict';END IF;
  IF selected_action='revoke' THEN
   IF packet-'id'-'revision'<>'{}'::jsonb THEN RAISE EXCEPTION 'bibliography_unavailable';END IF;
   DELETE FROM public.private_bibliographies p WHERE p.wallet=bibliography_mutate.wallet AND p.id=selected_id AND p.revision=expected_revision;
   GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>1 THEN RAISE EXCEPTION 'bibliography_conflict';END IF;RETURN jsonb_build_object('revoked',true);
  END IF;
  IF expected_revision=2147483647 THEN RAISE EXCEPTION 'bibliography_limit';END IF;
 END IF;
 IF jsonb_typeof(packet->'title') IS DISTINCT FROM 'string' OR jsonb_typeof(packet->'content') IS DISTINCT FROM 'string' OR jsonb_typeof(packet->'count') IS DISTINCT FROM 'number'
  OR jsonb_typeof(packet->'now') IS DISTINCT FROM 'string' OR octet_length(packet->>'content')>524288 THEN RAISE EXCEPTION 'bibliography_unavailable';END IF;
 IF selected_action='create' THEN
  INSERT INTO public.private_bibliographies(id,wallet,token_hash,title,content,reference_count,revision,created_at,updated_at)
   VALUES(selected_id,wallet,packet->>'tokenHash',packet->>'title',packet->>'content',(packet->>'count')::integer,1,packet->>'now',packet->>'now') RETURNING * INTO result;
 ELSE
  UPDATE public.private_bibliographies p SET title=packet->>'title',content=packet->>'content',reference_count=(packet->>'count')::integer,revision=p.revision+1,updated_at=packet->>'now'
   WHERE p.wallet=bibliography_mutate.wallet AND p.id=selected_id AND p.revision=expected_revision RETURNING * INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'bibliography_conflict';END IF;
 END IF;
 RETURN jsonb_build_object('bibliography',keryx_storage.bibliography_metadata(result));
END;$$;
CREATE FUNCTION public.storage_bibliography_mutation(expected jsonb,digest text,selected_action text,wallet text,input_wire text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF selected_action IS NULL OR selected_action NOT IN('create','replace','revoke') THEN RAISE EXCEPTION 'bibliography_unavailable';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'bibliography_'||selected_action);
 BEGIN result:=keryx_storage.bibliography_mutate(selected_action,wallet,input_wire);
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM=ANY(ARRAY['bibliography_unavailable','bibliography_not_found','bibliography_conflict','bibliography_limit']) THEN result:=jsonb_build_object('error',SQLERRM);ELSE RAISE;END IF;
 END;
 PERFORM keryx_storage.leave_operation();RETURN result;
END;$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_bibliography_list(jsonb,text,text),public.storage_bibliography_read(jsonb,text,text),public.storage_bibliography_mutation(jsonb,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role,keryx_app,keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_bibliography_list(jsonb,text,text),public.storage_bibliography_read(jsonb,text,text) TO keryx_app,keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_bibliography_mutation(jsonb,text,text,text,text) TO keryx_app;
CREATE TABLE keryx_storage.topic_watch_projection(
 wallet text NOT NULL,id text NOT NULL,original_sha256 text NOT NULL CHECK(original_sha256 ~ '^[a-f0-9]{64}$'),
 metadata jsonb NOT NULL CHECK(jsonb_typeof(metadata)='object' AND octet_length(metadata::text)<=65536),
 PRIMARY KEY(wallet,id),FOREIGN KEY(wallet,id) REFERENCES public.topic_watches(wallet,id) ON DELETE CASCADE
);
CREATE FUNCTION keryx_storage.watch_projection_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT(session_user='postgres' AND(SELECT mode FROM keryx_storage.control WHERE singleton)='held')
  AND NOT EXISTS(SELECT 1 FROM keryx_storage.writer w JOIN keryx_storage.operations o ON o.operation=w.operation JOIN keryx_storage.identity i ON i.identity_digest=w.identity_digest
   WHERE w.transaction_id=txid_current() AND NOT o.read_only AND 'topic_watches'=ANY(o.relations) AND 'topic_watch_projection'=ANY(o.relations)) THEN RAISE EXCEPTION 'native watch derivative writer required';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.topic_watches t WHERE t.wallet=NEW.wallet AND t.id=NEW.id AND NEW.original_sha256=encode(sha256(convert_to(t.state,'UTF8')),'hex')
  AND NEW.metadata->>'originalSha256'=NEW.original_sha256 AND NEW.metadata->>'owner'=t.wallet AND NEW.metadata->>'id'=t.id AND(NEW.metadata->>'revision')::numeric=t.revision)
  OR jsonb_typeof(NEW.metadata->'history') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.metadata->'history')>128
  OR jsonb_typeof(NEW.metadata->'watermark') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.metadata->'watermark')>256 THEN RAISE EXCEPTION 'native watch derivative binding refused';END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER native_watch_projection_writer BEFORE INSERT OR UPDATE OR DELETE ON keryx_storage.topic_watch_projection FOR EACH ROW EXECUTE FUNCTION keryx_storage.watch_projection_fence();
CREATE FUNCTION keryx_storage.watch_projection_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.state IS DISTINCT FROM OLD.state OR NEW.wallet IS DISTINCT FROM OLD.wallet OR NEW.id IS DISTINCT FROM OLD.id OR NEW.revision IS DISTINCT FROM OLD.revision
 THEN DELETE FROM keryx_storage.topic_watch_projection WHERE wallet=OLD.wallet AND id=OLD.id;END IF;RETURN NEW;
END;$$;
CREATE TRIGGER native_watch_invalidate AFTER UPDATE OF wallet,id,revision,state ON public.topic_watches FOR EACH ROW EXECUTE FUNCTION keryx_storage.watch_projection_invalidate();
CREATE TRIGGER native_watch_writer BEFORE INSERT OR UPDATE OR DELETE ON public.topic_watches FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence();
CREATE FUNCTION keryx_storage.workspace_session(selected jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE stamp bigint;selected_wallet text;
BEGIN
 IF selected IS NULL OR jsonb_typeof(selected)<>'object' OR selected-'hash'-'wallet'-'issuedAt'-'expiresAt'<>'{}'::jsonb
  OR jsonb_typeof(selected->'wallet') IS DISTINCT FROM 'string' OR jsonb_typeof(selected->'hash') IS DISTINCT FROM 'string'
  OR selected->>'wallet' !~ '^0x[a-f0-9]{40}$' OR selected->>'hash' !~ '^[a-f0-9]{64}$'
  OR jsonb_typeof(selected->'issuedAt') IS DISTINCT FROM 'number' OR jsonb_typeof(selected->'expiresAt') IS DISTINCT FROM 'number'
 THEN RAISE EXCEPTION 'watch_session_changed';END IF;
 stamp:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;selected_wallet:=selected->>'wallet';
 IF NOT EXISTS(SELECT 1 FROM public.web_sessions s WHERE s.hash=selected->>'hash' AND s.wallet=selected_wallet AND s.issued_at=(selected->>'issuedAt')::numeric
  AND s.expires_at=(selected->>'expiresAt')::numeric AND s.issued_at<=stamp AND s.expires_at>stamp) THEN RAISE EXCEPTION 'watch_session_changed';END IF;
 RETURN selected_wallet;
END;$$;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('watch_list',ARRAY['topic_watches','web_sessions']::text[],true,true),
 ('watch_read',ARRAY['topic_watches','web_sessions']::text[],true,true),
 ('watch_compare_swap',ARRAY['topic_watches','topic_watch_projection']::text[],true,false);
CREATE FUNCTION public.storage_watch_read(expected jsonb,digest text,selected_kind text,session_input jsonb,selected_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE selected_wallet text;rows jsonb:='[]'::jsonb;r record;result jsonb;bytes bigint:=2;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native watch read-only transaction required';END IF;
 IF selected_kind IS NULL OR selected_kind NOT IN('list','read') THEN RAISE EXCEPTION 'watch_unavailable';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'watch_'||selected_kind);
 BEGIN
  selected_wallet:=keryx_storage.workspace_session(session_input);
  IF selected_kind='read' AND(selected_id IS NULL OR selected_id !~ '^[a-z0-9][a-z0-9-]{0,63}$') THEN RAISE EXCEPTION 'watch_unavailable';END IF;
  FOR r IN SELECT t.id,t.revision,CASE WHEN p.original_sha256 IS NOT NULL AND octet_length(t.state)<=262144 THEN encode(convert_to(t.state,'UTF8'),'hex') END original_hex
   FROM public.topic_watches t LEFT JOIN keryx_storage.topic_watch_projection p ON p.wallet=t.wallet AND p.id=t.id
   WHERE t.wallet=selected_wallet AND(selected_kind='list' OR t.id=selected_id) ORDER BY t.id COLLATE "C" LIMIT 33 LOOP
   IF r.original_hex IS NULL OR jsonb_array_length(rows)>=32 THEN RAISE EXCEPTION 'watch_unavailable';END IF;
   bytes:=bytes+length(r.original_hex)+256;IF bytes>16785408 THEN RAISE EXCEPTION 'watch_unavailable';END IF;
   rows:=rows||jsonb_build_array(jsonb_build_object('id',r.id,'revision',r.revision,'originalHex',r.original_hex));
  END LOOP;
  PERFORM keryx_storage.workspace_session(session_input);
  result:=CASE WHEN selected_kind='list' THEN jsonb_build_object('items',rows) ELSE jsonb_build_object('item',rows->0) END;
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM IN('watch_unavailable','watch_session_changed') THEN result:=jsonb_build_object('error',SQLERRM);ELSE RAISE;END IF;
 END;RETURN result;
END;$$;
CREATE FUNCTION keryx_storage.watch_compare_swap(session_input jsonb,packet_wire text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE selected_wallet text;packet jsonb;next_meta jsonb;previous_meta jsonb;expected_revision numeric;selected_id text;original text;now_ms numeric;entry jsonb;history_index integer;old_revision numeric;
BEGIN
 selected_wallet:=keryx_storage.workspace_session(session_input);IF packet_wire IS NULL OR octet_length(packet_wire)>1048576 THEN RAISE EXCEPTION 'watch_unavailable';END IF;
 packet:=packet_wire::jsonb;next_meta:=packet->'projection';selected_id:=packet->>'id';expected_revision:=nullif(packet->>'expectedRevision','')::numeric;
 IF jsonb_typeof(packet)<>'object' OR packet-'id'-'expectedRevision'-'notAfterMs'-'originalHex'-'projection'<>'{}'::jsonb OR jsonb_typeof(next_meta) IS DISTINCT FROM 'object'
  OR selected_id IS NULL OR selected_id !~ '^[a-z0-9][a-z0-9-]{0,63}$' OR next_meta->>'owner' IS DISTINCT FROM selected_wallet OR next_meta->>'id' IS DISTINCT FROM selected_id
  OR jsonb_typeof(packet->'originalHex') IS DISTINCT FROM 'string' OR length(packet->>'originalHex')>524288 OR packet->>'originalHex' !~ '^([a-f0-9]{2})+$'
  OR(next_meta->>'revision')::numeric IS DISTINCT FROM coalesce(expected_revision,0)+1 OR jsonb_typeof(packet->'notAfterMs') IS DISTINCT FROM 'number'
 THEN RAISE EXCEPTION 'watch_unavailable';END IF;
 SELECT t.revision,p.metadata INTO old_revision,previous_meta FROM public.topic_watches t LEFT JOIN keryx_storage.topic_watch_projection p ON p.wallet=t.wallet AND p.id=t.id WHERE t.wallet=selected_wallet AND t.id=selected_id;
 IF expected_revision IS NULL THEN
  IF FOUND THEN RETURN false;END IF;
  IF(SELECT count(*) FROM public.topic_watches t WHERE t.wallet=selected_wallet)>=32 THEN RAISE EXCEPTION 'watch_limit';END IF;
 ELSE
  IF NOT FOUND OR old_revision IS DISTINCT FROM expected_revision THEN RETURN false;END IF;
  IF previous_meta IS NULL THEN RAISE EXCEPTION 'watch_unavailable';END IF;
  IF previous_meta->>'status'='cancelled' OR next_meta->'createdAtMs' IS DISTINCT FROM previous_meta->'createdAtMs'
   OR(next_meta->>'nextSlot')::numeric<(previous_meta->>'nextSlot')::numeric THEN RETURN false;END IF;
  IF(previous_meta->>'nextSlot')::numeric>0 AND(next_meta->>'specDigest' IS DISTINCT FROM previous_meta->>'specDigest' OR next_meta->>'incarnation' IS DISTINCT FROM previous_meta->>'incarnation') THEN RETURN false;END IF;
  history_index:=0;
  FOR entry IN SELECT value FROM jsonb_array_elements(previous_meta->'history') LOOP
   IF entry->>'pending'='true' THEN
    IF entry->>'checkKey' IS DISTINCT FROM next_meta->'history'->history_index->>'checkKey' THEN RETURN false;END IF;
   ELSIF entry->>'digest' IS DISTINCT FROM next_meta->'history'->history_index->>'digest' THEN RETURN false;
   END IF;history_index:=history_index+1;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(previous_meta->'watermark') AS marks(value) WHERE NOT((next_meta->'watermark')?marks.value)) THEN RETURN false;END IF;
 END IF;
 now_ms:=floor(extract(epoch FROM clock_timestamp())*1000);IF now_ms>=(packet->>'notAfterMs')::numeric THEN RETURN false;END IF;
 original:=convert_from(decode(packet->>'originalHex','hex'),'UTF8');IF encode(sha256(convert_to(original,'UTF8')),'hex') IS DISTINCT FROM next_meta->>'originalSha256' THEN RAISE EXCEPTION 'watch_unavailable';END IF;
 IF expected_revision IS NULL THEN INSERT INTO public.topic_watches(wallet,id,revision,state) VALUES(selected_wallet,selected_id,(next_meta->>'revision')::numeric,original);
 ELSE UPDATE public.topic_watches t SET revision=(next_meta->>'revision')::numeric,state=original WHERE t.wallet=selected_wallet AND t.id=selected_id AND t.revision=expected_revision;END IF;
 INSERT INTO keryx_storage.topic_watch_projection(wallet,id,original_sha256,metadata) VALUES(selected_wallet,selected_id,next_meta->>'originalSha256',next_meta)
  ON CONFLICT(wallet,id) DO UPDATE SET original_sha256=excluded.original_sha256,metadata=excluded.metadata;
 PERFORM keryx_storage.workspace_session(session_input);RETURN true;
END;$$;
CREATE FUNCTION public.storage_watch_compare_swap(expected jsonb,digest text,session_input jsonb,packet_wire text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM keryx_storage.require_operation(expected,digest,'watch_compare_swap');
 BEGIN result:=jsonb_build_object('changed',keryx_storage.watch_compare_swap(session_input,packet_wire));
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM IN('watch_unavailable','watch_session_changed','watch_limit') THEN result:=jsonb_build_object('error',SQLERRM);ELSE RAISE;END IF;
 END;
 PERFORM keryx_storage.leave_operation();RETURN result;
END;$$;
REVOKE ALL ON TABLE keryx_storage.topic_watch_projection FROM PUBLIC,anon,authenticated,service_role,keryx_app,keryx_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_watch_read(jsonb,text,text,jsonb,text),public.storage_watch_compare_swap(jsonb,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role,keryx_app,keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_watch_read(jsonb,text,text,jsonb,text) TO keryx_app,keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_watch_compare_swap(jsonb,text,jsonb,text) TO keryx_app;
RESET ROLE;
