SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('native_runtime_authority',ARRAY[]::text[],true,true),
 ('native_runtime_cold_read',ARRAY['cache_items']::text[],true,true);
CREATE FUNCTION public.storage_native_runtime_authority(expected jsonb,digest text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native authority read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'native_runtime_authority');
 RETURN jsonb_build_object('identity',expected,'sourceDigest',digest);
END;$$;
-- Cold construction must authenticate every encrypted envelope in Node before
-- publishing a facade. SQL bounds individual values and the complete encoded
-- result first. This does not assert that all application domains are ready.
CREATE FUNCTION public.storage_native_runtime_cold_read(expected jsonb,digest text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE row_count bigint;wire_bytes bigint;encoded_bytes bigint:=1024;item record;rows jsonb;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native cold read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'native_runtime_cold_read');
 SELECT count(*),coalesce(sum(octet_length(text)),0) INTO row_count,wire_bytes FROM public.cache_items WHERE text IS NOT NULL;
 IF row_count>512 OR wire_bytes>8388608 OR EXISTS(SELECT 1 FROM public.cache_items WHERE text IS NOT NULL AND
  (char_length(source_id) NOT BETWEEN 1 AND 256 OR octet_length(source_id)>512 OR octet_length(text)>2097152
   OR char_length(source_id)+(SELECT count(*) FROM regexp_matches(source_id,U&'[\+010000-\+10FFFF]','g'))>256))
 THEN RAISE EXCEPTION 'native cold cache bound';END IF;
 FOR item IN SELECT source_id,text FROM public.cache_items WHERE text IS NOT NULL LOOP
  encoded_bytes:=encoded_bytes+octet_length(jsonb_build_object('sourceId',item.source_id,'text',item.text)::text)+2;
  IF encoded_bytes>12582912 THEN RAISE EXCEPTION 'native cold encoded cache bound';END IF;
 END LOOP;
 SELECT coalesce(jsonb_agg(jsonb_build_object('sourceId',source_id,'text',text) ORDER BY source_id COLLATE "C"),'[]'::jsonb) INTO rows FROM public.cache_items WHERE text IS NOT NULL;
 RETURN jsonb_build_object('format','keryx-native-storage-cold-read-v1','identity',expected,'sourceDigest',digest,
  'cacheRows',rows,'cacheRowCount',row_count,'cacheWireBytes',wire_bytes);
END;$$;
REVOKE ALL ON FUNCTION public.storage_native_runtime_authority(jsonb,text),public.storage_native_runtime_cold_read(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_native_runtime_authority(jsonb,text),public.storage_native_runtime_cold_read(jsonb,text) TO keryx_app,keryx_reader;
RESET ROLE;
