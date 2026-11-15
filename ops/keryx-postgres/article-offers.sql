-- Fresh SOURCE alignment only. Retained signed originals require separate exact
-- SQLite ten-cell + rowid intake; never translate timestamps or infer an order.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.article_offers) THEN RAISE EXCEPTION 'article offer fresh schema requires empty originals';END IF;
END;$$;
ALTER TABLE public.article_offers DROP CONSTRAINT article_offers_source_id_fkey;
ALTER TABLE public.article_offers DROP CONSTRAINT article_offers_item_id_fkey;
ALTER TABLE public.article_offers DROP CONSTRAINT article_offers_price_usdc6_check;
ALTER TABLE public.article_offers ALTER COLUMN created_at DROP DEFAULT;
ALTER TABLE public.article_offers ALTER COLUMN created_at TYPE text COLLATE "C" USING NULL::text;
ALTER TABLE public.article_offers ADD COLUMN source_order bigint NOT NULL UNIQUE;
DO $$ BEGIN
 IF (SELECT count(*) FROM keryx_storage.operations WHERE operation IN('set_article_offer','delete_article_offer'))<>2
  OR EXISTS(SELECT 1 FROM keryx_storage.operations WHERE operation IN('set_article_offer','delete_article_offer')
   AND(relations IS DISTINCT FROM ARRAY['article_offers']::text[] OR real_only OR read_only))
 THEN RAISE EXCEPTION 'article offer Source operation inventory changed';END IF;
END;$$;
CREATE TRIGGER native_article_offer_writer BEFORE INSERT OR UPDATE OR DELETE ON public.article_offers FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence();

-- Replace existing private readers in place: no extra catalog functions. The
-- Source-only ordinal is deliberately absent from every returned ten-cell row.
CREATE OR REPLACE FUNCTION public.storage_get_article_offer(p_expected_identity jsonb,p_source_id text,p_item_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;BEGIN
 PERFORM keryx_storage.read_operation(p_expected_identity,'get_article_offer');
 SELECT to_jsonb(r) INTO result FROM(SELECT source_id,item_id,id,content_version,price_usdc6,expires_at,signer,nonce,signature,created_at FROM public.article_offers WHERE source_id=p_source_id AND item_id=p_item_id LIMIT 1) r;
 RETURN result;
END;$$;
CREATE OR REPLACE FUNCTION public.storage_list_article_offers(p_expected_identity jsonb,p_source_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;BEGIN
 PERFORM keryx_storage.read_operation(p_expected_identity,'list_article_offers');
 SELECT coalesce(jsonb_agg(to_jsonb(r)-'source_order'),'[]'::jsonb) INTO result FROM
  (SELECT source_id,item_id,id,content_version,price_usdc6,expires_at,signer,nonce,signature,created_at,source_order FROM public.article_offers
   WHERE p_source_id IS NULL OR p_source_id='' OR source_id=p_source_id
   ORDER BY created_at COLLATE "C" DESC,CASE WHEN p_source_id IS NULL OR p_source_id='' THEN source_order END ASC,CASE WHEN p_source_id IS NOT NULL AND p_source_id<>'' THEN item_id END COLLATE "C" ASC LIMIT 1001) r;
 IF jsonb_array_length(result)>1000 OR octet_length(result::text)>4194304 THEN RAISE EXCEPTION 'complete domain result exceeds approved bounds';END IF;
 RETURN result;
END;$$;
