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
CREATE OR REPLACE FUNCTION public.storage_get_items(p_expected_identity jsonb,p_source_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE bound_row record;total_bytes bigint:=2;total_rows integer:=0;result jsonb;BEGIN
 PERFORM keryx_storage.read_operation(p_expected_identity,'get_items');
 FOR bound_row IN SELECT * FROM public.source_items WHERE source_id=p_source_id ORDER BY published_at DESC NULLS LAST LIMIT 1001 LOOP
  total_rows:=total_rows+1;total_bytes:=total_bytes+octet_length(to_jsonb(bound_row)::text)+2;
  IF total_rows>1000 OR total_bytes>4194304 THEN RAISE EXCEPTION 'native complete item result bound';END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO result FROM (SELECT * FROM public.source_items WHERE source_id=p_source_id ORDER BY published_at DESC NULLS LAST LIMIT 1001) r;
 RETURN result;
END;$$;
CREATE OR REPLACE FUNCTION public.storage_count_items_published_between(p_expected_identity jsonb,p_source_id text[],p_published_at text,p_published_at_2 text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;bound_row record;total_bytes bigint:=2;total_rows integer:=0;BEGIN
 PERFORM keryx_storage.read_operation(p_expected_identity,'count_items_published_between');
 IF p_source_id IS NULL OR cardinality(p_source_id)>1000 THEN RAISE EXCEPTION 'invalid bounded source selection';END IF;
 FOR bound_row IN SELECT source_id FROM public.source_items WHERE source_id=ANY(p_source_id) AND published_at LIKE '____-__-__%' AND published_at>p_published_at AND published_at<=p_published_at_2 LIMIT 1001 LOOP
  total_rows:=total_rows+1;total_bytes:=total_bytes+octet_length(to_jsonb(bound_row)::text)+2;
  IF total_rows>1000 OR total_bytes>4194304 THEN RAISE EXCEPTION 'native complete recency result bound';END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO result FROM(SELECT source_id FROM public.source_items WHERE source_id=ANY(p_source_id)
  AND published_at LIKE '____-__-__%' AND published_at>p_published_at AND published_at<=p_published_at_2 LIMIT 1001) r;
 IF jsonb_array_length(result)>1000 OR octet_length(result::text)>4194304 THEN RAISE EXCEPTION 'native complete recency result bound';END IF;RETURN result;
END;$$;
CREATE OR REPLACE FUNCTION public.storage_newest_item_dates(p_expected_identity jsonb,p_source_id text[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;bound_row record;total_bytes bigint:=2;BEGIN
 PERFORM keryx_storage.read_operation(p_expected_identity,'newest_item_dates');
 IF p_source_id IS NULL OR cardinality(p_source_id)>1000 THEN RAISE EXCEPTION 'invalid bounded source selection';END IF;
 FOR bound_row IN SELECT source_id,max(published_at) published_at FROM public.source_items WHERE source_id=ANY(p_source_id) AND published_at LIKE '____-__-__%' GROUP BY source_id ORDER BY source_id COLLATE "C" LOOP
  total_bytes:=total_bytes+octet_length(to_jsonb(bound_row)::text)+2;
  IF total_bytes>4194304 THEN RAISE EXCEPTION 'native complete newest result bound';END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO result FROM(SELECT source_id,max(published_at) published_at FROM public.source_items
  WHERE source_id=ANY(p_source_id) AND published_at LIKE '____-__-__%' GROUP BY source_id ORDER BY source_id COLLATE "C") r;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION 'native complete newest result bound';END IF;RETURN result;
END;$$;
CREATE OR REPLACE FUNCTION public.storage_upsert_source(p_expected_identity jsonb,p_row jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r public.sources;BEGIN
 PERFORM keryx_storage.enter_operation(p_expected_identity,'upsert_source');
 IF p_row IS NULL OR jsonb_typeof(p_row)<>'object' OR p_row-ARRAY['id','name','url','description','rss_url','wallet_address','fetch_price','tags','authors','created_at','ipfs_cid','active','verified','preview_depth','evidence_provenance','onchain_id','register_tx']<>'{}'::jsonb THEN RAISE EXCEPTION 'native source row refused';END IF;
 SELECT * INTO r FROM jsonb_populate_record(NULL::public.sources,p_row);
 IF left(r.id,7)='public:' OR EXISTS(SELECT 1 FROM public.sync_state WHERE key LIKE 'keryx:source-claims:v1:%')
  OR EXISTS(SELECT 1 FROM public.sources s JOIN public.sync_state v ON v.key='keryx:source-registry-origin:v1:'||lower(s.onchain_id) WHERE s.id=r.id)
 THEN RAISE EXCEPTION 'managed source protocol not yet qualified';END IF;
 INSERT INTO public.sources(id,name,url,description,rss_url,wallet_address,fetch_price,tags,authors,created_at,ipfs_cid,active,verified,preview_depth,evidence_provenance,onchain_id,register_tx)
 VALUES(r.id,r.name,r.url,r.description,r.rss_url,r.wallet_address,r.fetch_price,r.tags,r.authors,r.created_at,r.ipfs_cid,r.active,r.verified,r.preview_depth,r.evidence_provenance,r.onchain_id,r.register_tx)
 ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,description=excluded.description,rss_url=excluded.rss_url,wallet_address=excluded.wallet_address,
  fetch_price=excluded.fetch_price,tags=excluded.tags,authors=excluded.authors,ipfs_cid=excluded.ipfs_cid,active=excluded.active,verified=excluded.verified,
  onchain_id=coalesce(excluded.onchain_id,public.sources.onchain_id),register_tx=coalesce(excluded.register_tx,public.sources.register_tx),
  preview_depth=coalesce(excluded.preview_depth,public.sources.preview_depth),evidence_provenance=coalesce(public.sources.evidence_provenance,excluded.evidence_provenance);
 PERFORM keryx_storage.leave_operation();RETURN NULL;
END;$$;
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
