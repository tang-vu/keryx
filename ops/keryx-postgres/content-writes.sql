-- Fresh SOURCE: retain the original text wire of feed dates and app timestamps.
-- Native scalar text cannot admit NUL/unpaired UTF-16; no original is rewritten.
DO $$ DECLARE entry text;relation_name text;column_name text;BEGIN
 FOREACH entry IN ARRAY ARRAY['sources.created_at','source_items.published_at','source_items.manifest_created_at','cache_items.updated_at',
  'source_meta.updated_at','source_notify.updated_at','source_notify_email.updated_at','source_notify_email.last_sent_at',
  'query_memories.created_at','sync_state.updated_at','gap_intents.created_at','gap_intents.updated_at'] LOOP
  relation_name:=split_part(entry,'.',1);column_name:=split_part(entry,'.',2);
  EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP DEFAULT',relation_name,column_name);
  EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE text USING %I::text',relation_name,column_name,column_name);
  IF column_name IN('created_at','updated_at') THEN
   EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET DEFAULT to_char(clock_timestamp() AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'')',relation_name,column_name);
  END IF;
 END LOOP;
END;$$;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES('source_item_by_link',ARRAY['source_items'],false,true);
CREATE FUNCTION public.storage_source_item_by_link(expected jsonb,digest text,selected_source text,selected_link text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE item record;items jsonb:='[]'::jsonb;bytes bigint:=2;matching integer;selection jsonb;candidate_origin text;source_snapshot jsonb;source_wire text;source_data jsonb;BEGIN
 IF selected_source IS NULL THEN
  IF current_setting('transaction_read_only')<>'on' OR selected_link IS NULL OR octet_length(selected_link)>2048 THEN RAISE EXCEPTION 'source upsert snapshot unavailable';END IF;
  selection:=selected_link::jsonb;
  IF jsonb_typeof(selection) IS DISTINCT FROM 'object' OR selection-'sourceId'-'onchainId'-'bindOrigin'<>'{}'::jsonb
   OR jsonb_typeof(selection->'sourceId') IS DISTINCT FROM 'string' OR keryx_storage.a2a_utf16_length(selection->>'sourceId') NOT BETWEEN 1 AND 256
   OR NOT(selection?'onchainId') OR selection->'onchainId'<>'null'::jsonb AND jsonb_typeof(selection->'onchainId')<>'string'
   OR jsonb_typeof(selection->'bindOrigin') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'source upsert snapshot selector refused';END IF;
  PERFORM keryx_storage.require_operation(expected,digest,'source_policy_snapshot');
  source_snapshot:=keryx_storage.source_claim_purchase_policy('snapshot',jsonb_build_object('sourceId',selection->>'sourceId','identity',NULL)::text,NULL);
  source_data:=(source_snapshot->>'wire')::jsonb;
  -- upsertSource consumes only the prior on-chain identity from the catalog
  -- row. Routine concurrent metadata refreshes may overwrite each other just
  -- as Source does; they cannot change the retained claim/origin inputs.
  source_wire:=jsonb_set(source_data,'{source}',CASE WHEN source_data->'source'='null'::jsonb THEN 'null'::jsonb ELSE jsonb_build_object('onchain_id',source_data#>'{source,onchain_id}') END)::text;
  source_snapshot:=jsonb_build_object('wire',source_wire,'sha256',encode(sha256(convert_to(source_wire,'UTF8')),'hex'));
  IF (selection->>'bindOrigin')::boolean THEN
   IF selection->>'onchainId' IS NULL OR selection->>'onchainId' !~ '^0x[0-9a-fA-F]{64}$' THEN RAISE EXCEPTION 'source registry candidate refused';END IF;
   SELECT value INTO candidate_origin FROM public.sync_state WHERE key='keryx:source-registry-origin:v1:'||lower(selection->>'onchainId');
   IF octet_length(candidate_origin)>8192 THEN RAISE EXCEPTION 'source registry candidate bound';END IF;
  END IF;
  RETURN jsonb_build_object('source',source_snapshot,'candidateOrigin',candidate_origin);
 END IF;
 IF current_setting('transaction_read_only')<>'on' OR selected_source IS NULL OR selected_link IS NULL OR octet_length(selected_source)+octet_length(selected_link)>65536 THEN RAISE EXCEPTION 'native item identity unavailable';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'source_item_by_link');
 SELECT count(*) INTO matching FROM(SELECT 1 FROM public.source_items i WHERE i.source_id=selected_source AND i.link=selected_link LIMIT 2) candidates;
 IF matching>1 THEN RETURN jsonb_build_object('items','[]'::jsonb,'ambiguous',true);END IF;
 FOR item IN SELECT i.* FROM public.source_items i WHERE i.source_id=selected_source AND i.link=selected_link ORDER BY i.id COLLATE "C" LIMIT 2 LOOP
  bytes:=bytes+octet_length(to_jsonb(item)::text)+2;IF bytes>4194304 THEN RAISE EXCEPTION 'native complete item identity bound';END IF;
  items:=items||jsonb_build_array(to_jsonb(item));
 END LOOP;RETURN jsonb_build_object('items',items,'ambiguous',false);
END;$$;
REVOKE ALL ON FUNCTION public.storage_source_item_by_link(jsonb,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_source_item_by_link(jsonb,text,text,text) TO keryx_app,keryx_reader;
CREATE OR REPLACE FUNCTION public.storage_get_items(p_expected_identity jsonb,p_source_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE native_bound_row record;native_bound_bytes bigint:=2;native_bound_count integer:=0;result jsonb;BEGIN
 PERFORM keryx_storage.read_operation(p_expected_identity,'get_items');
 FOR native_bound_row IN SELECT * FROM public.source_items WHERE source_id=p_source_id ORDER BY published_at DESC NULLS LAST LIMIT 1001 LOOP
  native_bound_count:=native_bound_count+1;native_bound_bytes:=native_bound_bytes+octet_length(to_jsonb(native_bound_row)::text)+2;
  IF native_bound_count>1000 OR native_bound_bytes>4194304 THEN RAISE EXCEPTION 'native complete item result bound';END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO result FROM (SELECT * FROM public.source_items WHERE source_id=p_source_id ORDER BY published_at DESC NULLS LAST LIMIT 1001) r;
 RETURN result;
END;$$;
CREATE OR REPLACE FUNCTION public.storage_count_items_published_between(p_expected_identity jsonb,p_source_id text[],p_published_at text,p_published_at_2 text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;native_bound_row record;native_bound_bytes bigint:=2;native_bound_count integer:=0;BEGIN
 PERFORM keryx_storage.read_operation(p_expected_identity,'count_items_published_between');
 IF p_source_id IS NULL OR cardinality(p_source_id)>1000 THEN RAISE EXCEPTION 'invalid bounded source selection';END IF;
 FOR native_bound_row IN SELECT source_id FROM public.source_items WHERE source_id=ANY(p_source_id) AND published_at LIKE '____-__-__%' AND published_at>p_published_at AND published_at<=p_published_at_2 LIMIT 1001 LOOP
  native_bound_count:=native_bound_count+1;native_bound_bytes:=native_bound_bytes+octet_length(to_jsonb(native_bound_row)::text)+2;
  IF native_bound_count>1000 OR native_bound_bytes>4194304 THEN RAISE EXCEPTION 'native complete recency result bound';END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO result FROM(SELECT source_id FROM public.source_items WHERE source_id=ANY(p_source_id)
  AND published_at LIKE '____-__-__%' AND published_at>p_published_at AND published_at<=p_published_at_2 LIMIT 1001) r;
 IF jsonb_array_length(result)>1000 OR octet_length(result::text)>4194304 THEN RAISE EXCEPTION 'native complete recency result bound';END IF;RETURN result;
END;$$;
CREATE OR REPLACE FUNCTION public.storage_newest_item_dates(p_expected_identity jsonb,p_source_id text[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;native_bound_row record;native_bound_bytes bigint:=2;BEGIN
 PERFORM keryx_storage.read_operation(p_expected_identity,'newest_item_dates');
 IF p_source_id IS NULL OR cardinality(p_source_id)>1000 THEN RAISE EXCEPTION 'invalid bounded source selection';END IF;
 FOR native_bound_row IN SELECT source_id,max(published_at) published_at FROM public.source_items WHERE source_id=ANY(p_source_id) AND published_at LIKE '____-__-__%' GROUP BY source_id ORDER BY source_id COLLATE "C" LOOP
  native_bound_bytes:=native_bound_bytes+octet_length(to_jsonb(native_bound_row)::text)+2;
  IF native_bound_bytes>4194304 THEN RAISE EXCEPTION 'native complete newest result bound';END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO result FROM(SELECT source_id,max(published_at) published_at FROM public.source_items
  WHERE source_id=ANY(p_source_id) AND published_at LIKE '____-__-__%' GROUP BY source_id ORDER BY source_id COLLATE "C") r;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION 'native complete newest result bound';END IF;RETURN result;
END;$$;
CREATE OR REPLACE FUNCTION public.storage_upsert_source(p_expected_identity jsonb,p_row jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r public.sources;row_wire text;row_data jsonb;capture jsonb;source_snapshot jsonb;source_data jsonb;source_wire text;candidate_origin text;origin_key text;binding jsonb;BEGIN
 PERFORM keryx_storage.enter_operation(p_expected_identity,'upsert_source');
 IF p_row IS NULL OR jsonb_typeof(p_row)<>'object' OR p_row-'rowWire'-'sourceUpsertCapture'<>'{}'::jsonb
  OR jsonb_typeof(p_row->'rowWire') IS DISTINCT FROM 'string' OR jsonb_typeof(p_row->'sourceUpsertCapture') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'native source capture required';END IF;
 row_wire:=p_row->>'rowWire';row_data:=row_wire::jsonb;capture:=p_row->'sourceUpsertCapture';
 IF octet_length(row_wire)>262144 OR jsonb_typeof(row_data) IS DISTINCT FROM 'object'
  OR row_data-ARRAY['id','name','url','description','rss_url','wallet_address','fetch_price','tags','authors','created_at','ipfs_cid','active','verified','preview_depth','evidence_provenance','onchain_id','register_tx']<>'{}'::jsonb
  OR capture-'sourceSelector'-'sourceSnapshotSha256'-'candidateOriginWire'-'bindOrigin'-'registryBinding'-'rowSha256'<>'{}'::jsonb
  OR capture->>'rowSha256' IS DISTINCT FROM encode(sha256(convert_to(row_wire,'UTF8')),'hex')
  OR jsonb_typeof(capture->'bindOrigin') IS DISTINCT FROM 'boolean' OR NOT(capture?'registryBinding' AND capture?'candidateOriginWire')
  THEN RAISE EXCEPTION 'native source row refused';END IF;
 SELECT * INTO r FROM jsonb_populate_record(NULL::public.sources,row_data);
 IF r.id IS NULL OR keryx_storage.a2a_utf16_length(r.id) NOT BETWEEN 1 AND 256 OR left(r.id,7)='public:'
  OR (capture->>'sourceSelector')::jsonb IS DISTINCT FROM jsonb_build_object('sourceId',r.id,'identity',NULL) THEN RAISE EXCEPTION 'native source identity refused';END IF;
 -- The complete retained SOURCE projection is compared after require_operation
 -- acquired the writer lock. Free/stale claims remain valid metadata identities;
 -- paid-policy freshness is deliberately checked only by payment admission.
 source_snapshot:=keryx_storage.source_claim_purchase_policy('snapshot',capture->>'sourceSelector',NULL);
 source_data:=(source_snapshot->>'wire')::jsonb;
 source_wire:=jsonb_set(source_data,'{source}',CASE WHEN source_data->'source'='null'::jsonb THEN 'null'::jsonb ELSE jsonb_build_object('onchain_id',source_data#>'{source,onchain_id}') END)::text;
 IF encode(sha256(convert_to(source_wire,'UTF8')),'hex') IS DISTINCT FROM capture->>'sourceSnapshotSha256' THEN RAISE EXCEPTION 'source metadata predecessor changed';END IF;
 IF (capture->>'bindOrigin')::boolean THEN
  IF r.onchain_id IS NULL OR r.onchain_id !~ '^0x[0-9a-fA-F]{64}$' THEN RAISE EXCEPTION 'source registry candidate refused';END IF;
  origin_key:='keryx:source-registry-origin:v1:'||lower(r.onchain_id);
  SELECT value INTO candidate_origin FROM public.sync_state WHERE key=origin_key;
 ELSE IF capture->'registryBinding'<>'null'::jsonb THEN RAISE EXCEPTION 'source registry binding unavailable';END IF;END IF;
 IF candidate_origin IS DISTINCT FROM capture->>'candidateOriginWire' THEN RAISE EXCEPTION 'source registry candidate changed';END IF;
 IF capture->'registryBinding'<>'null'::jsonb THEN
  binding:=capture->'registryBinding';
  IF jsonb_typeof(binding) IS DISTINCT FROM 'object' OR binding-'key'-'value'<>'{}'::jsonb OR binding->>'key' IS DISTINCT FROM origin_key
   OR candidate_origin IS NOT NULL OR jsonb_typeof(binding->'value') IS DISTINCT FROM 'string' OR octet_length(binding->>'value')>8192
   OR (binding->>'value')::jsonb->>'format' IS DISTINCT FROM 'keryx-source-registry-origin-v1'
   OR (binding->>'value')::jsonb->>'onchainId' IS DISTINCT FROM lower(r.onchain_id) THEN RAISE EXCEPTION 'source registry binding refused';END IF;
  INSERT INTO public.sync_state(key,value,updated_at) VALUES(origin_key,binding->>'value',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 END IF;
 INSERT INTO public.sources(id,name,url,description,rss_url,wallet_address,fetch_price,tags,authors,created_at,ipfs_cid,active,verified,preview_depth,evidence_provenance,onchain_id,register_tx)
 VALUES(r.id,r.name,r.url,r.description,r.rss_url,r.wallet_address,r.fetch_price,r.tags,r.authors,r.created_at,r.ipfs_cid,r.active,r.verified,r.preview_depth,r.evidence_provenance,r.onchain_id,r.register_tx)
 ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,description=excluded.description,rss_url=excluded.rss_url,wallet_address=excluded.wallet_address,
  fetch_price=excluded.fetch_price,tags=excluded.tags,authors=excluded.authors,ipfs_cid=excluded.ipfs_cid,active=excluded.active,verified=excluded.verified,
  onchain_id=coalesce(excluded.onchain_id,public.sources.onchain_id),register_tx=coalesce(excluded.register_tx,public.sources.register_tx),
  preview_depth=coalesce(excluded.preview_depth,public.sources.preview_depth),evidence_provenance=coalesce(public.sources.evidence_provenance,excluded.evidence_provenance);
 PERFORM keryx_storage.leave_operation();RETURN NULL;
END;$$;
-- The only added write is the validated immutable registry-origin sidecar above.
UPDATE keryx_storage.operations SET relations=ARRAY['sources','sync_state'] WHERE operation='upsert_source';
CREATE OR REPLACE FUNCTION public.storage_add_items(p_expected_identity jsonb,p_row jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE item jsonb;r public.source_items;prior_provenance text;BEGIN
 PERFORM keryx_storage.enter_operation(p_expected_identity,'add_items');
 IF p_row IS NULL OR jsonb_typeof(p_row)<>'array' OR jsonb_array_length(p_row)>1000 THEN RAISE EXCEPTION 'native item batch refused';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_row) LOOP
  IF jsonb_typeof(item)<>'object' OR item-ARRAY['id','source_id','title','summary','content','link','published_at','ipfs_cid','item_key_enc','item_iv','item_auth_tag','item_wrap_iv','delivery_kind','storage_mode','plaintext_bytes','body_hash','manifest_id','manifest_signer','manifest_nonce','manifest_signature','manifest_created_at','evidence_provenance']<>'{}'::jsonb THEN RAISE EXCEPTION 'native item row refused';END IF;
  SELECT * INTO r FROM jsonb_populate_record(NULL::public.source_items,item);
  SELECT evidence_provenance INTO prior_provenance FROM public.source_items WHERE id=r.id;
  r.evidence_provenance:=coalesce(prior_provenance,r.evidence_provenance,(SELECT evidence_provenance FROM public.sources WHERE id=r.source_id));
  INSERT INTO public.source_items(id,source_id,title,summary,content,link,published_at,ipfs_cid,item_key_enc,item_iv,item_auth_tag,item_wrap_iv,delivery_kind,storage_mode,plaintext_bytes,body_hash,manifest_id,manifest_signer,manifest_nonce,manifest_signature,manifest_created_at,evidence_provenance)
  VALUES(r.id,r.source_id,r.title,r.summary,r.content,r.link,r.published_at,r.ipfs_cid,r.item_key_enc,r.item_iv,r.item_auth_tag,r.item_wrap_iv,r.delivery_kind,r.storage_mode,r.plaintext_bytes,r.body_hash,r.manifest_id,r.manifest_signer,r.manifest_nonce,r.manifest_signature,r.manifest_created_at,r.evidence_provenance)
  ON CONFLICT(id) DO UPDATE SET source_id=excluded.source_id,title=excluded.title,summary=excluded.summary,content=excluded.content,link=excluded.link,published_at=excluded.published_at,
   ipfs_cid=excluded.ipfs_cid,item_key_enc=excluded.item_key_enc,item_iv=excluded.item_iv,item_auth_tag=excluded.item_auth_tag,item_wrap_iv=excluded.item_wrap_iv,
   delivery_kind=excluded.delivery_kind,storage_mode=excluded.storage_mode,plaintext_bytes=excluded.plaintext_bytes,body_hash=excluded.body_hash,
   manifest_id=excluded.manifest_id,manifest_signer=excluded.manifest_signer,manifest_nonce=excluded.manifest_nonce,manifest_signature=excluded.manifest_signature,manifest_created_at=excluded.manifest_created_at,evidence_provenance=excluded.evidence_provenance;
 END LOOP;
 PERFORM keryx_storage.leave_operation();RETURN NULL;
END;$$;
