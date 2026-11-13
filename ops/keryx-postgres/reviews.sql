SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only)
 SELECT 'review_'||action,ARRAY['decision_review_records','decision_review_verdicts','review_projection']::text[],true,action IN('ready','read','list','metrics')
 FROM unnest(ARRAY['ready','read','list','metrics','capture','begin','verdict','consume','cancel','expire','observe']) action;
CREATE TRIGGER native_reviews_writer BEFORE INSERT OR UPDATE OR DELETE ON public.decision_review_records FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence();
CREATE TRIGGER native_reviews_writer BEFORE INSERT OR UPDATE OR DELETE ON public.decision_review_verdicts FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence();
CREATE TABLE keryx_storage.review_projection(
 id text PRIMARY KEY REFERENCES public.decision_review_records(id) ON DELETE CASCADE,
 original_sha256 text NOT NULL CHECK(original_sha256 ~ '^[a-f0-9]{64}$'),
 metadata jsonb NOT NULL CHECK(jsonb_typeof(metadata)='object' AND octet_length(metadata::text)<=8192)
);
CREATE FUNCTION keryx_storage.review_projection_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT(session_user='postgres' AND(SELECT mode FROM keryx_storage.control WHERE singleton)='held')
  AND NOT EXISTS(SELECT 1 FROM keryx_storage.writer w JOIN keryx_storage.operations o ON o.operation=w.operation JOIN keryx_storage.identity i ON i.identity_digest=w.identity_digest
   WHERE w.transaction_id=txid_current() AND NOT o.read_only AND 'decision_review_records'=ANY(o.relations) AND 'review_projection'=ANY(o.relations)) THEN RAISE EXCEPTION 'native review derivative writer required';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.decision_review_records r WHERE r.id=NEW.id AND NEW.original_sha256=encode(sha256(convert_to(r.input_json,'UTF8')),'hex')
  AND NEW.metadata->>'runId'=r.run_id AND NEW.metadata->'terms'->>'network'=r.network)
  OR NEW.metadata ? 'sourceName' THEN RAISE EXCEPTION 'native review derivative binding refused';END IF;RETURN NEW;
END;$$;
CREATE TRIGGER native_review_projection_writer BEFORE INSERT OR UPDATE OR DELETE ON keryx_storage.review_projection FOR EACH ROW EXECUTE FUNCTION keryx_storage.review_projection_fence();
CREATE FUNCTION keryx_storage.review_projection_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN DELETE FROM keryx_storage.review_projection WHERE id=OLD.id;RETURN NEW;END;$$;
CREATE TRIGGER native_review_projection_invalidate AFTER UPDATE OF input_json,run_id,network ON public.decision_review_records FOR EACH ROW
 WHEN(OLD.input_json IS DISTINCT FROM NEW.input_json OR OLD.run_id IS DISTINCT FROM NEW.run_id OR OLD.network IS DISTINCT FROM NEW.network) EXECUTE FUNCTION keryx_storage.review_projection_invalidate();
CREATE FUNCTION keryx_storage.review_metadata(r public.decision_review_records) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;BEGIN
 SELECT metadata INTO result FROM keryx_storage.review_projection p WHERE p.id=r.id AND p.original_sha256=encode(sha256(convert_to(r.input_json,'UTF8')),'hex')
  AND p.metadata->>'runId'=r.run_id AND p.metadata->'terms'->>'network'=r.network;
 IF result IS NULL THEN RAISE EXCEPTION 'review_unavailable';END IF;RETURN result;
END;$$;
-- Raw original JSON text is encoded without casting its free text to jsonb.
-- Escaped NUL in a valid source name must retain its exact original bytes.
CREATE FUNCTION keryx_storage.review_row(r public.decision_review_records) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF r.id IS NULL OR octet_length(r.input_json)>8192 OR coalesce(octet_length(r.verdict_json),0)>8192 THEN RAISE EXCEPTION 'review_unavailable';END IF;
 PERFORM keryx_storage.review_metadata(r);
 RETURN jsonb_build_object('id',r.id,'inputHex',encode(convert_to(r.input_json,'UTF8'),'hex'),'createdAt',r.created_at,'expiresAt',r.expires_at,'state',r.state,'action',r.code_action,'rule',r.code_rule,'verdictHex',encode(convert_to(r.verdict_json,'UTF8'),'hex'));
END;$$;
CREATE FUNCTION public.storage_review_read(expected jsonb,digest text,selected_action text,wallet text,packet_wire text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE packet jsonb;r public.decision_review_records;result jsonb;items jsonb:='[]'::jsonb;item jsonb;bytes bigint:=2;counted integer:=0;g record;BEGIN
 IF selected_action IS NULL OR selected_action NOT IN('ready','read','list','metrics') OR current_setting('transaction_read_only')<>'on'
  OR packet_wire IS NULL OR octet_length(packet_wire)>32768 THEN RAISE EXCEPTION 'review_unavailable';END IF;
 packet:=packet_wire::jsonb;IF jsonb_typeof(packet)<>'object' THEN RAISE EXCEPTION 'review_unavailable';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'review_'||selected_action);
 IF selected_action IN('read','list') AND(wallet IS NULL OR wallet !~ '^0x[a-f0-9]{40}$') THEN RAISE EXCEPTION 'review_unavailable';END IF;
 IF selected_action='ready' THEN
  IF wallet IS NOT NULL OR packet<>'{}'::jsonb THEN RAISE EXCEPTION 'review_unavailable';END IF;RETURN '{"ready":true}'::jsonb;
 ELSIF selected_action='read' THEN
  IF packet-'id'<>'{}'::jsonb OR jsonb_typeof(packet->'id') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'review_unavailable';END IF;
  SELECT * INTO r FROM public.decision_review_records d WHERE d.wallet=storage_review_read.wallet AND d.id=packet->>'id';
  RETURN jsonb_build_object('row',CASE WHEN r.id IS NULL THEN NULL ELSE keryx_storage.review_row(r) END);
 ELSIF selected_action='list' THEN
  IF packet-'runId'<>'{}'::jsonb OR jsonb_typeof(packet->'runId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'review_unavailable';END IF;
  FOR r IN SELECT * FROM public.decision_review_records d WHERE d.wallet=storage_review_read.wallet AND d.run_id=packet->>'runId' ORDER BY d.created_at COLLATE "C",d.id COLLATE "C" LIMIT 301 LOOP
   counted:=counted+1;item:=keryx_storage.review_row(r);bytes:=bytes+octet_length(item::text)+2;
   IF counted>300 OR bytes>6291456 THEN RAISE EXCEPTION 'review_unavailable';END IF;items:=items||jsonb_build_array(item);
  END LOOP;RETURN jsonb_build_object('rows',items);
 ELSE
  IF wallet IS NOT NULL OR packet-ARRAY['network','since','until']<>'{}'::jsonb OR packet->>'network' NOT IN('eip155:5042','eip155:5042002')
   OR packet->>'since' IS NULL OR packet->>'until' IS NULL OR packet->>'since'>=packet->>'until'
   OR (packet->>'until')::timestamptz-(packet->>'since')::timestamptz>interval '366 days' THEN RAISE EXCEPTION 'review_unavailable';END IF;
  FOR g IN SELECT keryx_storage.review_metadata(d)->>'cohort' cohort,keryx_storage.review_metadata(d)->>'modelAction' model,d.code_action action,d.code_rule rule,d.verdict_json::json->>'value' verdict,count(*) n
   FROM public.decision_review_records d WHERE d.network=packet->>'network' AND d.created_at>=packet->>'since' AND d.created_at<packet->>'until' GROUP BY 1,2,3,4,5 ORDER BY 1,2,3,4,5 LOOP
   counted:=counted+1;item:=to_jsonb(g);bytes:=bytes+octet_length(item::text)+2;
   IF counted>2880 OR bytes>1048576 THEN RAISE EXCEPTION 'review_unavailable';END IF;items:=items||jsonb_build_array(item);
  END LOOP;RETURN jsonb_build_object('groups',items);
 END IF;
END;$$;
CREATE FUNCTION keryx_storage.review_mutate(selected_action text,wallet text,packet_wire text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE packet jsonb;input json;input_wire text;metadata jsonb;selected_id text;r public.decision_review_records;prior text;at_time text;verdict jsonb;BEGIN
 IF wallet IS NULL OR wallet !~ '^0x[a-f0-9]{40}$' OR packet_wire IS NULL OR octet_length(packet_wire)>32768 THEN RAISE EXCEPTION 'review_unavailable';END IF;
 packet:=packet_wire::jsonb;IF jsonb_typeof(packet)<>'object' THEN RAISE EXCEPTION 'review_unavailable';END IF;
 IF selected_action IN('capture','begin','verdict','consume','expire') THEN
  at_time:=packet->>'at';IF at_time IS NULL OR length(at_time)>32 THEN RAISE EXCEPTION 'review_unavailable';END IF;PERFORM at_time::timestamptz;
 END IF;
 IF selected_action='capture' THEN
  IF packet-ARRAY['id','inputWire','metadata','at']<>'{}'::jsonb OR jsonb_typeof(packet->'inputWire') IS DISTINCT FROM 'string' OR jsonb_typeof(packet->'metadata') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'review_unavailable';END IF;
  input_wire:=packet->>'inputWire';metadata:=packet->'metadata';IF octet_length(input_wire)>8192 THEN RAISE EXCEPTION 'review_unavailable';END IF;PERFORM input_wire::json;selected_id:=packet->>'id';
  IF selected_id IS NULL OR metadata->>'runId' IS NULL OR metadata->'terms'->>'network' IS NULL THEN RAISE EXCEPTION 'review_unavailable';END IF;
  IF(SELECT count(*) FROM public.decision_review_records d WHERE d.wallet=review_mutate.wallet AND d.run_id=metadata->>'runId')>=300 THEN RAISE EXCEPTION 'review_unavailable';END IF;
  INSERT INTO public.decision_review_records(id,wallet,run_id,network,created_at,input_json,state,expires_at,code_action,code_rule,verdict_json)
   VALUES(selected_id,wallet,metadata->>'runId',metadata->'terms'->>'network',at_time,input_wire,'observed',NULL,metadata->>'codeAction',metadata->>'codeRule',NULL) RETURNING * INTO r;
  INSERT INTO keryx_storage.review_projection(id,original_sha256,metadata) VALUES(selected_id,encode(sha256(convert_to(input_wire,'UTF8')),'hex'),metadata);
  RETURN jsonb_build_object('row',keryx_storage.review_row(r));
 ELSIF selected_action='cancel' THEN
  IF packet-'runId'<>'{}'::jsonb OR jsonb_typeof(packet->'runId') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'review_unavailable';END IF;
  UPDATE public.decision_review_records d SET state='cancelled' WHERE d.wallet=review_mutate.wallet AND d.run_id=packet->>'runId'
   AND(d.state IN('held','approved') OR(d.state='observed' AND keryx_storage.review_metadata(d)->>'reviewFirst'='true' AND keryx_storage.review_metadata(d)->'terms'->>'owned'='true' AND d.code_action<>'SKIP'));
  RETURN '{"done":true}'::jsonb;
 ELSIF selected_action='verdict' THEN
  IF packet-ARRAY['inputWire','at']<>'{}'::jsonb OR jsonb_typeof(packet->'inputWire') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'review_unavailable';END IF;
  input_wire:=packet->>'inputWire';IF octet_length(input_wire)>8192 THEN RAISE EXCEPTION 'review_unavailable';END IF;input:=input_wire::json;selected_id:=input->>'id';
  IF input->>'key' IS NULL THEN RAISE EXCEPTION 'review_unavailable';END IF;
  SELECT p.input_json INTO prior FROM public.decision_review_verdicts p WHERE p.wallet=review_mutate.wallet AND p.key=input->>'key';
  IF FOUND THEN
   IF prior IS DISTINCT FROM input_wire THEN RAISE EXCEPTION 'review_conflict';END IF;
   SELECT * INTO r FROM public.decision_review_records d WHERE d.wallet=review_mutate.wallet AND d.id=selected_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'review_not_found';END IF;RETURN jsonb_build_object('row',keryx_storage.review_row(r));
  END IF;
 ELSE selected_id:=packet->>'id';
 END IF;
 IF selected_id IS NULL THEN RAISE EXCEPTION 'review_unavailable';END IF;
 SELECT * INTO r FROM public.decision_review_records d WHERE d.wallet=review_mutate.wallet AND d.id=selected_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'review_not_found';END IF;
 metadata:=keryx_storage.review_metadata(r);
 IF selected_action='begin' THEN
  IF packet-ARRAY['id','at']<>'{}'::jsonb THEN RAISE EXCEPTION 'review_unavailable';END IF;
  IF r.state<>'observed' OR r.expires_at IS NOT NULL OR metadata->>'reviewFirst' IS DISTINCT FROM 'true' OR metadata->'terms'->>'owned' IS DISTINCT FROM 'true' OR r.code_action='SKIP' OR r.verdict_json IS NOT NULL THEN RAISE EXCEPTION 'review_conflict';END IF;
  UPDATE public.decision_review_records d SET state='held',expires_at=to_char((at_time::timestamptz+interval '60 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE d.id=selected_id AND d.wallet=review_mutate.wallet RETURNING * INTO r;
 ELSIF selected_action='verdict' THEN
  IF input->>'context'='gate' THEN
   IF r.state<>'held' THEN RAISE EXCEPTION 'review_conflict';END IF;
   IF r.expires_at IS NULL OR r.expires_at::timestamptz<=at_time::timestamptz THEN RAISE EXCEPTION 'review_expired';END IF;
   r.state:=CASE WHEN input->>'value'='agree' THEN 'approved' ELSE 'declined' END;
  ELSIF input->>'context'='opinion' THEN
   IF r.state IN('held','approved') OR input->'expectedCode'->>'action' IS DISTINCT FROM r.code_action OR input->'expectedCode'->>'rule' IS DISTINCT FROM r.code_rule THEN RAISE EXCEPTION 'review_conflict';END IF;
  ELSE RAISE EXCEPTION 'review_unavailable';END IF;
  IF input->>'value' IS NULL OR input->>'value' NOT IN('agree','disagree') THEN RAISE EXCEPTION 'review_unavailable';END IF;
  verdict:=jsonb_build_object('value',input->>'value','context',input->>'context','codeAction',CASE WHEN input->>'context'='gate' THEN metadata->>'codeAction' ELSE r.code_action END,'codeRule',CASE WHEN input->>'context'='gate' THEN metadata->>'codeRule' ELSE r.code_rule END,'createdAt',at_time);
  IF input->>'reason' IS NOT NULL THEN verdict:=verdict||jsonb_build_object('reason',input->>'reason');END IF;
  UPDATE public.decision_review_records d SET state=r.state,verdict_json=verdict::text WHERE d.id=selected_id AND d.wallet=review_mutate.wallet RETURNING * INTO r;
  INSERT INTO public.decision_review_verdicts(wallet,key,decision_id,input_json) VALUES(wallet,input->>'key',selected_id,input_wire);
 ELSIF selected_action='consume' THEN
  IF packet-ARRAY['id','terms','at']<>'{}'::jsonb THEN RAISE EXCEPTION 'review_unavailable';END IF;
  IF r.state<>'approved' THEN RAISE EXCEPTION 'review_conflict';END IF;
  IF r.expires_at IS NULL OR r.expires_at::timestamptz<=at_time::timestamptz THEN RAISE EXCEPTION 'review_expired';END IF;
  IF metadata->'terms' IS DISTINCT FROM packet->'terms' THEN RAISE EXCEPTION 'review_conflict';END IF;
  UPDATE public.decision_review_records d SET state='consumed' WHERE d.id=selected_id AND d.wallet=review_mutate.wallet RETURNING * INTO r;
 ELSIF selected_action='expire' THEN
  IF packet-ARRAY['id','at']<>'{}'::jsonb THEN RAISE EXCEPTION 'review_unavailable';END IF;
  IF r.expires_at IS NOT NULL AND r.expires_at::timestamptz<=at_time::timestamptz AND r.state IN('held','approved') THEN UPDATE public.decision_review_records d SET state='expired' WHERE d.id=selected_id AND d.wallet=review_mutate.wallet;END IF;RETURN '{"done":true}'::jsonb;
 ELSIF selected_action='observe' THEN
  IF packet-ARRAY['id','action','rule']<>'{}'::jsonb OR jsonb_typeof(packet->'action') IS DISTINCT FROM 'string' OR jsonb_typeof(packet->'rule') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'review_unavailable';END IF;
  UPDATE public.decision_review_records d SET code_action=packet->>'action',code_rule=packet->>'rule',state=CASE WHEN packet->>'action'='SKIP' AND d.state IN('observed','held','approved') AND metadata->>'reviewFirst'='true' AND metadata->'terms'->>'owned'='true' THEN 'cancelled' ELSE d.state END WHERE d.id=selected_id AND d.wallet=review_mutate.wallet;
  RETURN '{"done":true}'::jsonb;
 ELSE RAISE EXCEPTION 'review_unavailable';END IF;
 RETURN jsonb_build_object('row',keryx_storage.review_row(r));
END;$$;
CREATE FUNCTION public.storage_review_mutation(expected jsonb,digest text,selected_action text,wallet text,packet_wire text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;BEGIN
 IF selected_action IS NULL OR selected_action NOT IN('capture','begin','verdict','consume','cancel','expire','observe') THEN RAISE EXCEPTION 'review_unavailable';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'review_'||selected_action);
 BEGIN result:=keryx_storage.review_mutate(selected_action,wallet,packet_wire);
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM IN('review_unavailable','review_not_found','review_conflict','review_expired') THEN result:=jsonb_build_object('error',SQLERRM);ELSE RAISE;END IF;
 END;
 PERFORM keryx_storage.leave_operation();RETURN result;
END;$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON TABLE keryx_storage.review_projection FROM PUBLIC,anon,authenticated,service_role,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_review_read(jsonb,text,text,text,text),public.storage_review_mutation(jsonb,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role,keryx_app,keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_review_read(jsonb,text,text,text,text) TO keryx_app,keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_review_mutation(jsonb,text,text,text,text) TO keryx_app;
RESET ROLE;
