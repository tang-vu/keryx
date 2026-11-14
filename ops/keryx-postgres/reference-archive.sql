-- Source public archive protocols; immutable raw TEXT snapshots and literal
-- Node-tokenized term rows. No PostgreSQL FTS, private/paid catalog or issuer.
SET ROLE keryx_owner;
CREATE TRIGGER native_public_reference_versions_immutable BEFORE UPDATE OR DELETE ON public.public_reference_article_versions FOR EACH ROW EXECUTE FUNCTION keryx_storage.immutable();
CREATE TRIGGER native_public_reference_versions_retained BEFORE TRUNCATE ON public.public_reference_article_versions FOR EACH STATEMENT EXECUTE FUNCTION keryx_storage.immutable();
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('reference_archive_read',ARRAY['public_references','public_reference_articles','public_reference_article_versions','public_reference_article_terms'],true,true),
 ('reference_archive_write',ARRAY['public_references','public_reference_articles','public_reference_article_versions','public_reference_article_terms'],true,false);
CREATE FUNCTION public.storage_reference_archive(expected jsonb,digest text,action text,packet_wire text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE packet jsonb;selector jsonb;frame jsonb;result jsonb;wire text;frame_sha text;publisher public.public_references;has_publisher boolean;
 source_relations text[]:=ARRAY['a2a_failed_original_fulfillments','a2a_fulfillment_completions','a2a_orders','account267_accounts','account267_challenges','account267_credentials','account267_events','account267_members','account267_sessions','activation_events','anonymous_run_claims','answer_feedback','api_key_usage','api_keys','article_offers','auth_challenges','browser_authorization_intents','browser_journal_bindings','browser_journal_control','browser_journal_writer','browser_retained_grants','browser_signer_capacity','browser_signing_namespaces','browser_signing_originals','browser_signing_queries','browser_signing_v2_barrier','browser_signing_v2_control','browser_signing_v2_writer','browser_signing_v3_writer','cache_items','chat263_links','chat263_tokens','creator_owner_withdrawal_completions','creator_withdrawal_attestations','creator_withdrawal_requests','creator_withdrawal_transfer_attempts','decision_review_records','decision_review_verdicts','deliverable_acceptance_entries','deliverable_acceptance_store','gap_intents','gateway_funding_authorizations','gateway_funding_broadcast_claims','gateway_funding_crypto_claims','gateway_funding_namespaces','gateway_funding_observations','gateway_funding_operations','gateway_funding_policies','gateway_funding_prepared','gateway_funding_reservations','hosted_treasury_authorizations','hosted_treasury_policies','owner269_associations','owner269_operations','payment_events','pending_job_owners','private_bibliographies','private_creator_confirmations','private_creator_submissions','private_profiles','private_research_executions','private_research_intents','private_research_interruptions','private_research_payment_attempts','private_research_results','private_treasury_pools','private_treasury_releases','private_treasury_reservations','profile_identity_challenges','profile_verified_identities','public_reference_article_terms','public_reference_article_versions','public_reference_articles','public_references','public_researcher_profiles','query_memories','query_runs','rate_limit_counters','reasoning_circuits','research_monthly','research_monthly_redemptions','research_purchase_authorizations','run_privacy','run_privacy_audit','run_privacy_defaults','session_grant_consents','session_grants','session_withdrawal_cancellations','session_withdrawal_completions','session_withdrawal_exposures','session_withdrawal_preparations','session_withdrawal_publication_aborts','source_items','source_meta','source_notify','source_notify_email','sources','sync_state','topic_watches','users','web_sessions','withdrawals'];
 selected_ids text[];terms text[];field text;relation_name text;namespace_name text;columns text;maximums text;dynamic_sql text;
 measured_rows bigint;measured_bytes numeric;measured_field numeric;source_rows bigint:=0;logical_bytes numeric:=0;allocated_bytes numeric;frame_bytes numeric;
 private_bytes numeric:=0;max_field numeric:=0;valid boolean;deadline_at numeric;entry jsonb;article public.public_reference_articles;version public.public_reference_article_versions;
 original json;snapshot json;snapshot_tokens jsonb;transcript text;content_hash text;ref_id text;query_limit integer;query_sort text;query_match text;has_query boolean;cursor jsonb;read_only boolean;
BEGIN
 IF action IS NULL OR action NOT IN('frame','apply','list','get','query','stats') THEN RAISE EXCEPTION 'native public archive action refused';END IF;
 read_only:=action<>'apply';IF read_only AND current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native public archive readonly transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,CASE WHEN read_only THEN 'reference_archive_read' ELSE 'reference_archive_write' END);
 IF packet_wire IS NULL OR octet_length(packet_wire)>134217728 THEN RAISE EXCEPTION 'native public archive packet bound';END IF;packet:=packet_wire::jsonb;
 IF jsonb_typeof(packet) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'native public archive packet refused';END IF;
 IF action IN('frame','apply') THEN
  selector:=CASE WHEN action='frame' THEN packet ELSE packet->'selector' END;ref_id:=selector->>'referenceId';
  IF (selector-'referenceId'-'itemIds'='{}'::jsonb AND ref_id ~ '^public:[a-z0-9-]{1,80}$' AND jsonb_typeof(selector->'itemIds')='array' AND jsonb_array_length(selector->'itemIds')<=2000) IS NOT TRUE THEN RAISE EXCEPTION 'native public archive selector refused';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(selector->'itemIds') x WHERE jsonb_typeof(x)<>'string' OR x#>>'{}' !~ '^public-item:[a-f0-9]{64}$') OR (SELECT count(*) FROM jsonb_array_elements(selector->'itemIds'))<>(SELECT count(DISTINCT x) FROM jsonb_array_elements(selector->'itemIds') x) THEN RAISE EXCEPTION 'native public archive item selector refused';END IF;
  SELECT * INTO publisher FROM public.public_references WHERE id=ref_id;has_publisher:=FOUND;
  IF has_publisher AND octet_length(publisher.snapshot)>2097152 THEN RAISE EXCEPTION 'native public publisher frame field bound';END IF;
  SELECT array_agg(value ORDER BY value COLLATE "C") INTO selected_ids FROM jsonb_array_elements_text(selector->'itemIds') ids(value);
  IF coalesce(cardinality(selected_ids),0)>2000 THEN RAISE EXCEPTION 'native public archive combined selector bound';END IF;
  SELECT coalesce(sum(octet_length(to_jsonb(a)::text)+coalesce(octet_length(v.snapshot),0)*2+128),0) INTO frame_bytes FROM public.public_reference_articles a LEFT JOIN public.public_reference_article_versions v ON v.reference_id=a.reference_id AND v.item_id=a.item_id AND v.revision=a.current_revision WHERE a.reference_id=ref_id AND a.item_id=ANY(selected_ids);
  IF frame_bytes+coalesce(octet_length(publisher.snapshot)*2,0)>67108864 THEN RAISE EXCEPTION 'native public archive frame bound';END IF;
  SELECT jsonb_build_object('selector',selector,'publisher',CASE WHEN has_publisher THEN to_jsonb(publisher) END,'articles',coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.item_id COLLATE "C"),'[]'::jsonb)) INTO frame FROM(
   SELECT a.*,v.snapshot,v.collection_kind FROM public.public_reference_articles a LEFT JOIN public.public_reference_article_versions v ON v.reference_id=a.reference_id AND v.item_id=a.item_id AND v.revision=a.current_revision WHERE a.reference_id=ref_id AND a.item_id=ANY(selected_ids))x;
  wire:=frame::text;IF octet_length(wire)>67108864 THEN RAISE EXCEPTION 'native public archive encoded frame bound';END IF;frame_sha:=encode(sha256(convert_to(wire,'UTF8')),'hex');
  IF action='frame' THEN RETURN jsonb_build_object('wire',wire,'sha256',frame_sha);END IF;
  IF packet-'selector'-'snapshotSha256'-'publisher'-'articles'-'versions'-'indexItemIds'-'terms'-'result'-'deadlineAt'<>'{}'::jsonb OR packet->>'snapshotSha256' IS DISTINCT FROM frame_sha THEN RAISE EXCEPTION 'native public archive current frame changed';END IF;
  deadline_at:=(packet->>'deadlineAt')::numeric;IF deadline_at IS NULL OR deadline_at<extract(epoch FROM clock_timestamp())*1000 OR deadline_at>extract(epoch FROM clock_timestamp())*1000+15000 THEN RAISE EXCEPTION 'native public archive whole operation deadline';END IF;
  SELECT coalesce(sum(pg_total_relation_size(c.oid)),0) INTO allocated_bytes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','keryx_storage') AND c.relkind IN('r','m','p') AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='keryx_owner');
  IF allocated_bytes>268435456 THEN RAISE EXCEPTION 'native public archive allocated relation budget';END IF;
  IF (jsonb_typeof(packet->'articles')='array' AND jsonb_array_length(packet->'articles')<=2000 AND jsonb_typeof(packet->'versions')='array' AND jsonb_array_length(packet->'versions')<=2000 AND jsonb_typeof(packet->'indexItemIds')='array' AND jsonb_array_length(packet->'indexItemIds')<=2000 AND jsonb_typeof(packet->'terms')='array') IS NOT TRUE THEN RAISE EXCEPTION 'native public archive mutation inventory';END IF;
  -- Existing private raw-token lexer only; ordinary JSON getters reject NUL
  -- and lone UTF-16 even when extracting unrelated safe fields.
  -- Validate transcript hashes without converting raw snapshot JSON to JSONB
  -- or scalar TEXT: escaped NUL/lone UTF-16 originals must remain exact.
  FOR entry IN SELECT value FROM jsonb_array_elements(packet->'versions') LOOP
   SELECT * INTO version FROM jsonb_populate_record(NULL::public.public_reference_article_versions,entry);snapshot_tokens:=keryx_storage.source_scalar_text(version.snapshot,'tokens');original:=version.original_snapshot::json;
   IF version.reference_id IS DISTINCT FROM ref_id OR (version.item_id=ANY(selected_ids)) IS NOT TRUE OR version.revision !~ '^[a-f0-9]{64}$' OR version.collection_kind NOT IN('feed','article') OR octet_length(version.snapshot)>2097152 OR octet_length(version.original_snapshot)>2097152 OR snapshot_tokens->>'id' IS DISTINCT FROM to_json(version.item_id)::text THEN RAISE EXCEPTION 'native public archive version capture refused';END IF;
   FOREACH field IN ARRAY ARRAY['id','title','summary','content','link','deliveryKind'] LOOP IF json_typeof((snapshot_tokens->>field)::json) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'native public article snapshot shape';END IF;END LOOP;
   transcript:='{"item":'||version.snapshot||',"kind":'||to_json(version.collection_kind)::text||',"original":'||to_json(version.original_snapshot)::text||'}';
   IF version.revision IS DISTINCT FROM encode(sha256(convert_to(transcript,'UTF8')),'hex') THEN RAISE EXCEPTION 'native public archive revision digest differs';END IF;
   transcript:='['||(snapshot_tokens->>'id')||','||to_json(ref_id)::text||','||(snapshot_tokens->>'title')||','||(snapshot_tokens->>'link')||','||coalesce((snapshot_tokens->>'publishedAt'),'""')||','||(snapshot_tokens->>'summary')||','||(snapshot_tokens->>'content')||']';
   IF version.content_version IS DISTINCT FROM 'sha256:'||encode(sha256(convert_to(transcript,'UTF8')),'hex') THEN RAISE EXCEPTION 'native public archive content digest differs';END IF;
   INSERT INTO public.public_reference_article_versions SELECT(version).* ON CONFLICT(reference_id,item_id,revision) DO NOTHING;
  END LOOP;
  FOR entry IN SELECT value FROM jsonb_array_elements(packet->'articles') LOOP
   SELECT * INTO article FROM jsonb_populate_record(NULL::public.public_reference_articles,entry);
   IF article.reference_id IS DISTINCT FROM ref_id OR (article.item_id=ANY(selected_ids)) IS NOT TRUE OR NOT EXISTS(SELECT 1 FROM public.public_reference_article_versions v WHERE v.reference_id=ref_id AND v.item_id=article.item_id AND v.revision=article.current_revision) THEN RAISE EXCEPTION 'native public archive current revision unavailable';END IF;
   INSERT INTO public.public_reference_articles SELECT(article).* ON CONFLICT(reference_id,item_id) DO UPDATE SET current_revision=excluded.current_revision,first_collected_at=excluded.first_collected_at,last_collected_at=excluded.last_collected_at,published_at=excluded.published_at,sort_at=excluded.sort_at;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(packet->'indexItemIds')id WHERE (id=ANY(selected_ids)) IS NOT TRUE) THEN RAISE EXCEPTION 'native public archive index selector refused';END IF;
  DELETE FROM public.public_reference_article_terms WHERE reference_id=ref_id AND item_id IN(SELECT jsonb_array_elements_text(packet->'indexItemIds'));
  FOR entry IN SELECT value FROM jsonb_array_elements(packet->'terms') LOOP
   IF (entry->>'reference_id'=ref_id AND entry->>'item_id' IN(SELECT jsonb_array_elements_text(packet->'indexItemIds')) AND jsonb_typeof(entry->'term')='string' AND octet_length(entry->>'term') BETWEEN 2 AND 400 AND (entry->>'weight')::integer BETWEEN 1 AND 9) IS NOT TRUE THEN RAISE EXCEPTION 'native public archive literal term refused';END IF;
   INSERT INTO public.public_reference_article_terms(term,reference_id,item_id,weight) VALUES(entry->>'term',ref_id,entry->>'item_id',(entry->>'weight')::integer);
  END LOOP;
  IF packet->'publisher' IS DISTINCT FROM 'null'::jsonb THEN
   SELECT * INTO publisher FROM jsonb_populate_record(NULL::public.public_references,packet->'publisher');
   IF publisher.id IS DISTINCT FROM ref_id OR publisher.active NOT IN(0,1) OR octet_length(publisher.snapshot)>2097152 THEN RAISE EXCEPTION 'native public publisher capture refused';END IF;
   INSERT INTO public.public_references SELECT(publisher).* ON CONFLICT(id) DO UPDATE SET active=excluded.active,rss_url=excluded.rss_url,snapshot=excluded.snapshot;
  ELSIF NOT has_publisher OR publisher.active<>1 THEN RAISE EXCEPTION 'active public publisher required';END IF;
  -- SEPARATE NATIVE BUDGET, not SQLite allocation/framing equivalence. These
  -- fixed Source relation scans never expose financial/private values. Raw
  -- private companion columns are measured as TEXT, never decoded as JSONB.
  FOREACH relation_name IN ARRAY source_relations LOOP
   SELECT string_agg('coalesce(octet_length('||quote_ident(a.attname)||'::text),0)','+' ORDER BY a.attnum),string_agg('coalesce(octet_length('||quote_ident(a.attname)||'::text),0)',',' ORDER BY a.attnum) INTO columns,maximums FROM pg_attribute a WHERE a.attrelid=to_regclass(format('public.%I',relation_name)) AND a.attnum>0 AND NOT a.attisdropped;
   IF columns IS NULL THEN RAISE EXCEPTION 'native archive Source relation unavailable';END IF;
   EXECUTE format('SELECT count(*),coalesce(sum(%s),0),coalesce(max(greatest(%s)),0) FROM public.%I',columns,maximums,relation_name) INTO measured_rows,measured_bytes,measured_field;source_rows:=source_rows+measured_rows;logical_bytes:=logical_bytes+measured_bytes;max_field:=greatest(max_field,measured_field);
   IF source_rows>500000 OR logical_bytes>201326592 OR max_field>2097152 THEN RAISE EXCEPTION 'native public archive Source relation logical budget';END IF;
  END LOOP;
  FOR relation_name IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='keryx_storage' AND c.relkind IN('r','m') AND c.relname NOT IN('identity','control','source_contract','operations','writer') ORDER BY c.relname LOOP
   SELECT string_agg('coalesce(octet_length('||quote_ident(a.attname)||'::text),0)','+' ORDER BY a.attnum),string_agg('coalesce(octet_length('||quote_ident(a.attname)||'::text),0)',',' ORDER BY a.attnum) INTO columns,maximums FROM pg_attribute a WHERE a.attrelid=to_regclass(format('keryx_storage.%I',relation_name)) AND a.attnum>0 AND NOT a.attisdropped;
   EXECUTE format('SELECT count(*),coalesce(sum(%s),0),coalesce(max(greatest(%s)),0) FROM keryx_storage.%I',columns,maximums,relation_name) INTO measured_rows,measured_bytes,measured_field;private_bytes:=private_bytes+measured_bytes;max_field:=greatest(max_field,measured_field);
   IF logical_bytes+private_bytes>201326592 OR max_field>2097152 THEN RAISE EXCEPTION 'native public archive retained original logical budget';END IF;
  END LOOP;
  SELECT coalesce(sum(pg_total_relation_size(c.oid)),0) INTO allocated_bytes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','keryx_storage') AND c.relkind IN('r','m','p') AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='keryx_owner');
  IF allocated_bytes>268435456 THEN RAISE EXCEPTION 'native public archive allocated relation budget';END IF;
  IF extract(epoch FROM clock_timestamp())*1000>deadline_at THEN RAISE EXCEPTION 'native public archive whole operation deadline';END IF;
  result:=packet->'result';IF (jsonb_typeof(result)='object' AND result-'added'-'updated'='{}'::jsonb AND (result->>'added')::integer BETWEEN 0 AND 1000 AND (result->>'updated')::integer BETWEEN 0 AND 1000) IS NOT TRUE THEN RAISE EXCEPTION 'native public archive result capture refused';END IF;
  PERFORM keryx_storage.leave_operation();RETURN result;
 END IF;
 IF action IN('list','get') THEN
  IF action='list' AND packet<>'{}'::jsonb OR action='get' AND(packet-'id'<>'{}'::jsonb OR jsonb_typeof(packet->'id') IS DISTINCT FROM 'string' OR octet_length(packet->>'id')>1024) THEN RAISE EXCEPTION 'native public publisher read refused';END IF;
  SELECT coalesce(sum(octet_length(to_jsonb(p)::text)+2048),0) INTO frame_bytes FROM public.public_references p WHERE CASE WHEN action='list' THEN p.active=1 ELSE p.id=packet->>'id' END;
  IF frame_bytes>67108864 THEN RAISE EXCEPTION 'native public publisher read frame bound';END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id COLLATE "C"),'[]'::jsonb) INTO result FROM(SELECT p.*,(SELECT count(*) FROM public.public_reference_articles a WHERE a.reference_id=p.id) archived_item_count FROM public.public_references p WHERE CASE WHEN action='list' THEN p.active=1 ELSE p.id=packet->>'id' END)x;
  IF octet_length(result::text)>67108864 THEN RAISE EXCEPTION 'native public publisher encoded frame bound';END IF;RETURN CASE WHEN action='get' THEN result->0 ELSE result END;
 ELSIF action='stats' THEN
  IF packet<>'{}'::jsonb THEN RAISE EXCEPTION 'native public archive stats selector refused';END IF;
  SELECT jsonb_strip_nulls(jsonb_build_object('articles',count(*),'publishers',count(DISTINCT a.reference_id),'oldestPublishedAt',nullif(min(a.published_at COLLATE "C"),''),'newestPublishedAt',nullif(max(a.published_at COLLATE "C"),''))) INTO result FROM public.public_reference_articles a JOIN public.public_references p ON p.id=a.reference_id WHERE p.active=1;RETURN result;
 END IF;
 IF packet-'referenceId'-'terms'-'hasQuery'-'match'-'sort'-'limit'-'cursor'<>'{}'::jsonb OR jsonb_typeof(packet->'terms') IS DISTINCT FROM 'array' OR jsonb_array_length(packet->'terms')>32 THEN RAISE EXCEPTION 'native public archive query refused';END IF;
 SELECT coalesce(array_agg(value),'{}') INTO terms FROM jsonb_array_elements_text(packet->'terms');ref_id:=packet->>'referenceId';query_limit:=(packet->>'limit')::integer;query_sort:=packet->>'sort';query_match:=packet->>'match';has_query:=(packet->>'hasQuery')::boolean;cursor:=nullif(packet->'cursor','null'::jsonb);
 IF query_limit NOT BETWEEN 1 AND 100 OR query_sort NOT IN('recent','oldest','relevance') OR query_match NOT IN('all','any') OR has_query IS NULL OR ref_id IS NOT NULL AND ref_id !~ '^public:[a-z0-9-]{1,80}$' THEN RAISE EXCEPTION 'native public archive query shape';END IF;
 -- Current writers produce 1..9, but retained integer indexes may be larger.
 -- Preserve those exact sums; fractional/unsafe imports need separate SQLite
 -- floating-point qualification and remain an explicit hold.
 IF EXISTS(SELECT 1 FROM public.public_reference_article_terms WHERE term=ANY(terms) AND(weight<>trunc(weight) OR weight NOT BETWEEN 1 AND 9007199254740991)) THEN RAISE EXCEPTION 'native public archive imported term weights unsupported';END IF;
 WITH hits AS(SELECT reference_id,item_id,sum(weight) score,count(*) matched FROM public.public_reference_article_terms WHERE term=ANY(terms) GROUP BY reference_id,item_id),
 candidate AS MATERIALIZED(SELECT a.*,(a.published_at IS NOT NULL) has_published,coalesce(h.score,0) score FROM public.public_reference_articles a JOIN public.public_references p ON p.id=a.reference_id LEFT JOIN hits h ON h.reference_id=a.reference_id AND h.item_id=a.item_id WHERE p.active=1 AND(ref_id IS NULL OR a.reference_id=ref_id) AND NOT(has_query AND cardinality(terms)=0) AND(cardinality(terms)=0 OR h.matched>=CASE WHEN query_match='all' THEN cardinality(terms) ELSE 1 END)),
 page AS MATERIALIZED(SELECT a.*,v.snapshot item_snapshot,v.original_snapshot,v.content_version,v.collection_kind FROM candidate a JOIN public.public_reference_article_versions v ON v.reference_id=a.reference_id AND v.item_id=a.item_id AND v.revision=a.current_revision
 WHERE cursor IS NULL OR(query_sort='relevance' AND a.score<(cursor->>'score')::numeric) OR (query_sort<>'relevance' OR a.score=(cursor->>'score')::numeric) AND(a.has_published::integer<(cursor->>'hasPublished')::boolean::integer OR a.has_published=(cursor->>'hasPublished')::boolean AND((query_sort='oldest' AND a.sort_at COLLATE "C">cursor->>'date') OR(query_sort<>'oldest' AND a.sort_at COLLATE "C"<cursor->>'date') OR a.sort_at=cursor->>'date' AND(a.reference_id COLLATE "C">cursor->>'referenceId' OR a.reference_id=cursor->>'referenceId' AND a.item_id COLLATE "C">cursor->>'itemId')))
 ORDER BY CASE WHEN query_sort='relevance' THEN a.score END DESC,a.has_published DESC,CASE WHEN query_sort='oldest' THEN a.sort_at END COLLATE "C" ASC,CASE WHEN query_sort<>'oldest' THEN a.sort_at END COLLATE "C" DESC,a.reference_id COLLATE "C",a.item_id COLLATE "C" LIMIT query_limit+1),
 numbered AS MATERIALIZED(SELECT p.*,row_number() OVER(ORDER BY CASE WHEN query_sort='relevance' THEN p.score END DESC,p.has_published DESC,CASE WHEN query_sort='oldest' THEN p.sort_at END COLLATE "C" ASC,CASE WHEN query_sort<>'oldest' THEN p.sort_at END COLLATE "C" DESC,p.reference_id COLLATE "C",p.item_id COLLATE "C") ordinal FROM page p),budget AS(SELECT coalesce(bool_and(p.score BETWEEN 0 AND 9007199254740991 AND trunc(p.score)=p.score),true) AND coalesce(sum(octet_length(to_jsonb(p)::text)),0)+coalesce((SELECT sum(octet_length(to_jsonb(pub)::text)) FROM public.public_references pub WHERE pub.id IN(SELECT reference_id FROM numbered WHERE ordinal<=query_limit)),0)<=67108864 valid FROM numbered p),bounded AS(SELECT * FROM numbered WHERE(SELECT valid FROM budget)),publishers AS(SELECT DISTINCT p.id,p.active,p.rss_url,p.snapshot FROM bounded b JOIN public.public_references p ON p.id=b.reference_id WHERE b.ordinal<=query_limit)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM candidate),'rows',coalesce((SELECT jsonb_agg(to_jsonb(b)-'ordinal' ORDER BY b.ordinal) FROM bounded b),'[]'::jsonb),'publishers',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id COLLATE "C") FROM publishers p),'[]'::jsonb)),(SELECT valid FROM budget) INTO result,valid;
 IF valid IS DISTINCT FROM true OR octet_length(result::text)>67108864 THEN RAISE EXCEPTION 'native public archive query frame bound';END IF;RETURN result;
END;$$;
REVOKE ALL ON FUNCTION public.storage_reference_archive(jsonb,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_reference_archive(jsonb,text,text,text) TO keryx_app,keryx_reader;
RESET ROLE;
