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
 SELECT coalesce(jsonb_agg(keryx_storage.bibliography_metadata(b) ORDER BY b.created_at COLLATE "C",b.id COLLATE "C"),'[]'::jsonb) INTO items
 FROM(SELECT * FROM public.private_bibliographies p WHERE p.wallet=storage_bibliography_list.wallet ORDER BY p.created_at COLLATE "C",p.id COLLATE "C" LIMIT 21)b;
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
DECLARE packet jsonb;selected_id text;previous public.private_bibliographies%rowtype;result public.private_bibliographies%rowtype;changed integer;revision bigint;
BEGIN
 IF wallet IS NULL OR wallet !~ '^0x[a-f0-9]{40}$' OR input_wire IS NULL OR octet_length(input_wire)>2097152 THEN RAISE EXCEPTION 'bibliography_unavailable';END IF;
 packet:=input_wire::jsonb;selected_id:=packet->>'id';
 IF jsonb_typeof(packet)<>'object' OR selected_id IS NULL OR selected_id !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'bibliography_unavailable';END IF;
 IF selected_action='create' THEN
  IF packet-'id'-'tokenHash'-'title'-'content'-'count'-'now'<>'{}'::jsonb OR packet->>'tokenHash' IS NULL OR packet->>'tokenHash' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'bibliography_unavailable';END IF;
  IF(SELECT count(*) FROM public.private_bibliographies p WHERE p.wallet=bibliography_mutate.wallet)>=20 THEN RAISE EXCEPTION 'bibliography_limit';END IF;
 ELSE
  IF packet-'id'-'revision'-'title'-'content'-'count'-'now'<>'{}'::jsonb OR jsonb_typeof(packet->'revision') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'bibliography_unavailable';END IF;
  revision:=(packet->>'revision')::bigint;
  SELECT * INTO previous FROM public.private_bibliographies p WHERE p.wallet=bibliography_mutate.wallet AND p.id=selected_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'bibliography_not_found';END IF;IF previous.revision IS DISTINCT FROM revision THEN RAISE EXCEPTION 'bibliography_conflict';END IF;
  IF selected_action='revoke' THEN
   IF packet-'id'-'revision'<>'{}'::jsonb THEN RAISE EXCEPTION 'bibliography_unavailable';END IF;
   DELETE FROM public.private_bibliographies p WHERE p.wallet=bibliography_mutate.wallet AND p.id=selected_id AND p.revision=revision;
   GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>1 THEN RAISE EXCEPTION 'bibliography_conflict';END IF;RETURN jsonb_build_object('revoked',true);
  END IF;
  IF revision=2147483647 THEN RAISE EXCEPTION 'bibliography_limit';END IF;
 END IF;
 IF jsonb_typeof(packet->'title') IS DISTINCT FROM 'string' OR jsonb_typeof(packet->'content') IS DISTINCT FROM 'string' OR jsonb_typeof(packet->'count') IS DISTINCT FROM 'number'
  OR jsonb_typeof(packet->'now') IS DISTINCT FROM 'string' OR octet_length(packet->>'content')>524288 THEN RAISE EXCEPTION 'bibliography_unavailable';END IF;
 IF selected_action='create' THEN
  INSERT INTO public.private_bibliographies(id,wallet,token_hash,title,content,reference_count,revision,created_at,updated_at)
   VALUES(selected_id,wallet,packet->>'tokenHash',packet->>'title',packet->>'content',(packet->>'count')::integer,1,packet->>'now',packet->>'now') RETURNING * INTO result;
 ELSE
  UPDATE public.private_bibliographies p SET title=packet->>'title',content=packet->>'content',reference_count=(packet->>'count')::integer,revision=p.revision+1,updated_at=packet->>'now'
   WHERE p.wallet=bibliography_mutate.wallet AND p.id=selected_id AND p.revision=revision RETURNING * INTO result;
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
RESET ROLE;
