SET ROLE keryx_owner;
CREATE TABLE keryx_storage.run_ownership_projection(
 run_id text PRIMARY KEY REFERENCES public.query_runs(id) ON DELETE CASCADE,
 original_sha256 text NOT NULL CHECK(original_sha256 ~ '^[a-f0-9]{64}$'),
 question_search bytea CHECK(octet_length(question_search)<=4000000),
 history_eligible boolean NOT NULL,recorded_valid boolean NOT NULL,claimed_valid boolean NOT NULL,
 summary jsonb CHECK(summary IS NULL OR jsonb_typeof(summary)='object' AND octet_length(summary::text)<=65536)
);
CREATE FUNCTION keryx_storage.ownership_projection_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT(session_user='postgres' AND (SELECT mode FROM keryx_storage.control WHERE singleton)='held')
  AND NOT EXISTS(SELECT 1 FROM keryx_storage.writer w JOIN keryx_storage.operations o ON o.operation=w.operation
   JOIN keryx_storage.identity i ON i.identity_digest=w.identity_digest WHERE w.transaction_id=txid_current() AND NOT o.read_only
   AND 'query_runs'=ANY(o.relations) AND 'run_ownership_projection'=ANY(o.relations)) THEN RAISE EXCEPTION 'native ownership derivative writer required';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 IF NEW.original_sha256 IS DISTINCT FROM (SELECT keryx_storage.run_original_sha256(data) FROM public.query_runs WHERE id=NEW.run_id)
 THEN RAISE EXCEPTION 'native ownership derivative binding refused';END IF;RETURN NEW;
END;$$;
CREATE TRIGGER ownership_projection_writer BEFORE INSERT OR UPDATE OR DELETE ON keryx_storage.run_ownership_projection FOR EACH ROW EXECUTE FUNCTION keryx_storage.ownership_projection_fence();
CREATE FUNCTION keryx_storage.ownership_projection_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.data::text IS DISTINCT FROM OLD.data::text OR NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.asker IS DISTINCT FROM OLD.asker
 THEN DELETE FROM keryx_storage.run_ownership_projection WHERE run_id=OLD.id;END IF;RETURN NEW;
END;$$;
CREATE TRIGGER native_ownership_projection_invalidate AFTER UPDATE OF data,id,created_at,asker ON public.query_runs FOR EACH ROW EXECUTE FUNCTION keryx_storage.ownership_projection_invalidate();
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('ownership_history_list',ARRAY['query_runs','anonymous_run_claims','a2a_orders']::text[],true,true),
 ('ownership_history_read',ARRAY['query_runs','anonymous_run_claims','a2a_orders']::text[],true,true);
CREATE FUNCTION keryx_storage.ownership_context(wallet text,network text,origin text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM keryx_storage.personal_history_context(wallet);
 IF network IS DISTINCT FROM 'eip155:5042' OR NOT coalesce(keryx_storage.claim_origin_valid(origin),false) THEN RAISE EXCEPTION 'native ownership binding refused';END IF;
END;$$;
{{OWNERSHIP_QUERY_VALIDATOR}}
-- One candidate join; a recorded association wins. Ticket expiry does not revoke
-- a consumed association. Changed originals, completion times or A2A membership do.
CREATE FUNCTION keryx_storage.ownership_candidates(wallet text,network text,origin text,selected_id text DEFAULT NULL)
 RETURNS TABLE(run_id text,created_at timestamptz,claimed_at bigint,question_search bytea,history_eligible boolean,recorded_valid boolean,claimed_valid boolean,summary jsonb,provenance jsonb,funded boolean)
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT q.id,q.created_at,CASE WHEN q.asker IS NOT NULL THEN NULL::bigint ELSE c.claimed_at END,
  p.question_search,p.history_eligible,p.recorded_valid,p.claimed_valid,p.summary,h.provenance,h.funded
 FROM public.query_runs q LEFT JOIN public.anonymous_run_claims c ON c.run_id=q.id AND c.network=ownership_candidates.network AND c.origin=ownership_candidates.origin
 LEFT JOIN keryx_storage.run_ownership_projection p ON p.run_id=q.id LEFT JOIN keryx_storage.run_history_projection h ON h.run_id=q.id
 WHERE (selected_id IS NULL OR q.id=selected_id) AND(q.asker=wallet OR(q.asker IS NULL AND c.claimed_wallet=wallet AND c.claimed_at IS NOT NULL
  AND q.created_at=c.completed_at::timestamptz AND octet_length(q.data::text)<=4000000
  AND CASE WHEN octet_length(q.data::text)<=4000000 THEN keryx_storage.run_original_sha256(q.data)=c.original_sha256 ELSE false END
  AND NOT EXISTS(SELECT 1 FROM public.a2a_orders o WHERE o.query_id=q.id)));
$$;
CREATE FUNCTION public.storage_ownership_history_list(expected jsonb,digest text,wallet text,network text,origin text,filters jsonb,take integer,upper_position jsonb,before_position jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r record;result jsonb:='[]'::jsonb;item jsonb;bytes bigint:=2;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native ownership read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'ownership_history_list');PERFORM keryx_storage.ownership_context(wallet,network,origin);
 PERFORM keryx_storage.ownership_query_valid(wallet,filters,take,upper_position,before_position);
 IF EXISTS(SELECT 1 FROM keryx_storage.ownership_candidates(wallet,network,origin) c WHERE c.history_eligible IS NULL OR c.funded IS NULL)
 THEN RAISE EXCEPTION 'native ownership derivative unavailable';END IF;
 FOR r IN SELECT c.* FROM keryx_storage.ownership_candidates(wallet,network,origin) c WHERE(c.claimed_at IS NULL OR c.history_eligible)
  AND(upper_position IS NULL OR c.created_at<(upper_position->>'createdAt')::timestamptz OR(c.created_at=(upper_position->>'createdAt')::timestamptz AND c.run_id COLLATE "C" <=(upper_position->>'id') COLLATE "C"))
  AND(before_position IS NULL OR c.created_at<(before_position->>'createdAt')::timestamptz OR(c.created_at=(before_position->>'createdAt')::timestamptz AND c.run_id COLLATE "C" <(before_position->>'id') COLLATE "C"))
  AND(NOT(filters?'from') OR c.created_at>=(filters->>'from')::timestamptz) AND(NOT(filters?'to') OR c.created_at<=(filters->>'to')::timestamptz)
  AND(NOT(filters?'search') OR position(convert_to(filters->>'search','UTF8') IN c.question_search)>0)
  AND(NOT(filters?'surface') OR coalesce(c.provenance->>'surface','unknown')=filters->>'surface')
  AND(NOT(filters?'funding') OR CASE WHEN c.funded THEN 'browser-recorded' ELSE 'other-or-unknown' END=filters->>'funding')
  ORDER BY c.created_at DESC,c.run_id COLLATE "C" DESC LIMIT take LOOP
  IF r.summary IS NULL OR NOT(CASE WHEN r.claimed_at IS NULL THEN r.recorded_valid ELSE r.claimed_valid END) THEN RAISE EXCEPTION 'native ownership original unavailable';END IF;
  item:=r.summary||jsonb_build_object('ownership',jsonb_build_object('method',CASE WHEN r.claimed_at IS NULL THEN 'recorded' ELSE 'claimed' END,
   'claimedAt',CASE WHEN r.claimed_at IS NULL THEN NULL ELSE to_char(to_timestamp(r.claimed_at/1000.0) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END));
  bytes:=bytes+octet_length(item::text)+1;IF bytes>4194304 THEN RAISE EXCEPTION 'native ownership result bound';END IF;result:=result||jsonb_build_array(item);
 END LOOP;
 RETURN jsonb_build_object('wallet',wallet,'binding',jsonb_build_object('network',network,'origin',origin),'rows',result);
END;$$;
CREATE FUNCTION public.storage_ownership_history_read(expected jsonb,digest text,wallet text,network text,origin text,selected_id text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r record;item jsonb:=NULL;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native ownership read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'ownership_history_read');PERFORM keryx_storage.ownership_context(wallet,network,origin);
 IF selected_id IS NULL OR selected_id !~ '^[a-zA-Z0-9_-]{1,128}$' THEN RAISE EXCEPTION 'native ownership ID refused';END IF;
 SELECT c.*,q.data AS original INTO r FROM keryx_storage.ownership_candidates(wallet,network,origin,selected_id) c JOIN public.query_runs q ON q.id=c.run_id;
 IF FOUND THEN
  IF r.history_eligible IS NULL THEN RAISE EXCEPTION 'native ownership derivative unavailable';END IF;
  IF r.claimed_at IS NULL OR r.history_eligible THEN
   IF NOT(CASE WHEN r.claimed_at IS NULL THEN r.recorded_valid ELSE r.claimed_valid END) OR octet_length(r.original::text)>4000000 THEN RAISE EXCEPTION 'native ownership original unavailable';END IF;
   item:=jsonb_build_object('id',r.run_id,'createdAt',to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'originalHex',encode(convert_to(r.original::text,'UTF8'),'hex'),'ownership',jsonb_build_object('method',CASE WHEN r.claimed_at IS NULL THEN 'recorded' ELSE 'claimed' END,
    'claimedAt',CASE WHEN r.claimed_at IS NULL THEN NULL ELSE to_char(to_timestamp(r.claimed_at/1000.0) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END));
  END IF;
 END IF;
 RETURN jsonb_build_object('wallet',wallet,'binding',jsonb_build_object('network',network,'origin',origin),'item',item);
END;$$;
REVOKE ALL ON TABLE keryx_storage.run_ownership_projection FROM PUBLIC,anon,authenticated,service_role,keryx_app,keryx_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_ownership_history_list(jsonb,text,text,text,text,jsonb,integer,jsonb,jsonb),public.storage_ownership_history_read(jsonb,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_ownership_history_list(jsonb,text,text,text,text,jsonb,integer,jsonb,jsonb),public.storage_ownership_history_read(jsonb,text,text,text,text,text) TO keryx_app,keryx_reader;
RESET ROLE;
