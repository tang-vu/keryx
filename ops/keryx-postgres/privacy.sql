SET ROLE keryx_owner;
CREATE TABLE keryx_storage.run_privacy_projection(
 run_id text PRIMARY KEY REFERENCES public.query_runs(id) ON DELETE CASCADE,
 original_sha256 text NOT NULL CHECK(original_sha256 ~ '^[a-f0-9]{64}$'),
 data_bytes integer NOT NULL CHECK(data_bytes BETWEEN 0 AND 4000000),original_valid boolean NOT NULL,
 erase_wire text CHECK(octet_length(erase_wire)<=4000000),original_fulfillment boolean NOT NULL,
 question_fields text CHECK(octet_length(question_fields)<=8000000),
 history_fields text CHECK(octet_length(history_fields)<=8000000),
 history_references jsonb NOT NULL CHECK(jsonb_typeof(history_references)='array' AND jsonb_array_length(history_references)<=10000 AND octet_length(history_references::text)<=4194304),
 learning_fields text CHECK(octet_length(learning_fields)<=8000000),
 archive_wire text CHECK(octet_length(archive_wire)<=2097152),
 erase_projection jsonb CHECK(erase_projection IS NULL OR octet_length(erase_projection::text)<=16777216)
);
CREATE FUNCTION keryx_storage.privacy_projection_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT(session_user='postgres' AND (SELECT mode FROM keryx_storage.control WHERE singleton)='held')
  AND NOT EXISTS(SELECT 1 FROM keryx_storage.writer w JOIN keryx_storage.operations o ON o.operation=w.operation
   JOIN keryx_storage.identity i ON i.identity_digest=w.identity_digest WHERE w.transaction_id=txid_current() AND NOT o.read_only
   AND 'query_runs'=ANY(o.relations) AND 'run_privacy_projection'=ANY(o.relations)) THEN RAISE EXCEPTION 'native privacy derivative writer required';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.query_runs q WHERE q.id=NEW.run_id AND NEW.original_sha256=keryx_storage.run_original_sha256(q.data) AND NEW.data_bytes=octet_length(q.data::text))
 THEN RAISE EXCEPTION 'native privacy derivative binding refused';END IF;RETURN NEW;
END;$$;
CREATE TRIGGER privacy_projection_writer BEFORE INSERT OR UPDATE OR DELETE ON keryx_storage.run_privacy_projection FOR EACH ROW EXECUTE FUNCTION keryx_storage.privacy_projection_fence();
CREATE FUNCTION keryx_storage.privacy_projection_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.data::text IS DISTINCT FROM OLD.data::text OR NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.asker IS DISTINCT FROM OLD.asker
 THEN DELETE FROM keryx_storage.run_privacy_projection WHERE run_id=OLD.id;END IF;RETURN NEW;
END;$$;
CREATE TRIGGER native_privacy_projection_invalidate AFTER UPDATE OF data,id,created_at,asker ON public.query_runs FOR EACH ROW EXECUTE FUNCTION keryx_storage.privacy_projection_invalidate();
CREATE FUNCTION keryx_storage.privacy_retained() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='run_privacy' AND TG_OP='UPDATE' AND OLD.erased=0 THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'native privacy retained';
END;$$;
CREATE TRIGGER native_privacy_tombstone BEFORE UPDATE OR DELETE ON public.run_privacy FOR EACH ROW EXECUTE FUNCTION keryx_storage.privacy_retained();
CREATE TRIGGER native_privacy_audit_retained BEFORE UPDATE OR DELETE ON public.run_privacy_audit FOR EACH ROW EXECUTE FUNCTION keryx_storage.privacy_retained();
CREATE FUNCTION keryx_storage.privacy_run_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF session_user='postgres' AND (SELECT mode FROM keryx_storage.control WHERE singleton)='held' THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM public.run_privacy WHERE run_id=NEW.id AND erased=1) OR(TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM public.run_privacy WHERE run_id=OLD.id AND erased=1)) THEN RAISE EXCEPTION 'privacy_erased';END IF;
 IF TG_OP='INSERT' THEN
  INSERT INTO public.run_privacy(run_id,visibility,updated_at)
   SELECT NEW.id,CASE WHEN EXISTS(SELECT 1 FROM public.query_runs q WHERE q.id=NEW.id) THEN 'unlisted' WHEN NEW.asker ~ '^0x[0-9a-f]{40}$' THEN coalesce((SELECT visibility FROM public.run_privacy_defaults WHERE wallet=NEW.asker),'private') ELSE 'unlisted' END,
    to_char(NEW.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
   WHERE NOT EXISTS(SELECT 1 FROM public.run_privacy WHERE run_id=NEW.id);
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER native_privacy_run_fence BEFORE INSERT OR UPDATE ON public.query_runs FOR EACH ROW EXECUTE FUNCTION keryx_storage.privacy_run_fence();
CREATE FUNCTION keryx_storage.privacy_memory_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF session_user='postgres' AND (SELECT mode FROM keryx_storage.control WHERE singleton)='held' THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM public.run_privacy WHERE run_id=NEW.id AND erased=1) THEN RAISE EXCEPTION 'privacy_erased';END IF;RETURN NEW;
END;$$;
CREATE TRIGGER native_privacy_memory_fence BEFORE INSERT OR UPDATE ON public.query_memories FOR EACH ROW EXECUTE FUNCTION keryx_storage.privacy_memory_fence();
CREATE TRIGGER native_privacy_row_writer BEFORE INSERT OR UPDATE OR DELETE ON public.run_privacy FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence();
CREATE TRIGGER native_privacy_default_writer BEFORE INSERT OR UPDATE OR DELETE ON public.run_privacy_defaults FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence();
CREATE TRIGGER native_privacy_audit_writer BEFORE INSERT OR UPDATE OR DELETE ON public.run_privacy_audit FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence();
CREATE FUNCTION keryx_storage.privacy_actor(actor jsonb,writable boolean) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor_wallet text;stamp bigint;
BEGIN
 IF actor IS NULL THEN IF writable THEN RAISE EXCEPTION 'unauthenticated';END IF;RETURN NULL;END IF;
 IF jsonb_typeof(actor)<>'object' OR actor-'wallet'-'binding'-'sessionHash'<>'{}'::jsonb OR jsonb_typeof(actor->'wallet') IS DISTINCT FROM 'string'
  OR jsonb_typeof(actor->'binding') IS DISTINCT FROM 'object' OR (actor->'binding')-'network'-'origin'<>'{}'::jsonb
  OR actor->'binding'->>'network' IS DISTINCT FROM 'eip155:5042' OR NOT coalesce(keryx_storage.claim_origin_valid(actor->'binding'->>'origin'),false)
 THEN RAISE EXCEPTION 'unauthenticated';END IF;
 actor_wallet:=actor->>'wallet';IF actor_wallet !~ '^0x[a-f0-9]{40}$' THEN RAISE EXCEPTION 'unauthenticated';END IF;
 IF writable THEN
  stamp:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
  IF actor->>'sessionHash' IS NULL OR actor->>'sessionHash' !~ '^[a-f0-9]{64}$' OR NOT EXISTS(SELECT 1 FROM public.web_sessions s WHERE s.hash=actor->>'sessionHash' AND s.wallet=actor_wallet AND s.issued_at<=stamp AND s.expires_at>stamp)
  THEN RAISE EXCEPTION 'unauthenticated';END IF;
 END IF;RETURN actor_wallet;
END;$$;
CREATE FUNCTION keryx_storage.privacy_binding_wire(binding jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT '{"network":'||to_json(binding->>'network')::text||',"origin":'||to_json(binding->>'origin')::text||'}';
$$;
CREATE FUNCTION keryx_storage.privacy_proof(selected_id text,actor jsonb,claims boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE wallet text;r record;
BEGIN
 wallet:=keryx_storage.privacy_actor(actor,false);IF wallet IS NULL THEN RETURN false;END IF;
 SELECT q.asker,p.erased,p.retained_owner,p.retained_digest,p.retained_binding INTO r FROM public.query_runs q LEFT JOIN public.run_privacy p ON p.run_id=q.id WHERE q.id=selected_id;
 IF NOT FOUND THEN RETURN false;END IF;
 IF r.asker=wallet THEN RETURN true;END IF;
 IF r.erased=1 AND r.retained_owner=wallet AND r.retained_binding=keryx_storage.privacy_binding_wire(actor->'binding') AND EXISTS(
  SELECT 1 FROM public.query_runs q WHERE q.id=selected_id AND octet_length(q.data::text)<=4000000 AND keryx_storage.run_original_sha256(q.data)=r.retained_digest)
 THEN RETURN true;END IF;
 IF r.asker IS NOT NULL OR NOT claims THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM keryx_storage.ownership_candidates(wallet,actor->'binding'->>'network',actor->'binding'->>'origin',selected_id) c WHERE c.history_eligible IS NULL) THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
 RETURN EXISTS(SELECT 1 FROM keryx_storage.ownership_candidates(wallet,actor->'binding'->>'network',actor->'binding'->>'origin',selected_id) c WHERE c.claimed_at IS NOT NULL AND c.history_eligible AND c.claimed_valid);
END;$$;
CREATE FUNCTION keryx_storage.privacy_state(selected_id text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce((SELECT jsonb_build_object('visibility',p.visibility,'revision',p.revision,'erased',p.erased=1) FROM public.run_privacy p WHERE p.run_id=selected_id),jsonb_build_object('visibility','unlisted','revision',0,'erased',false));
$$;
CREATE FUNCTION keryx_storage.privacy_item(selected_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE wire text;
BEGIN
 SELECT CASE WHEN octet_length(q.data::text)<=4000000 THEN encode(convert_to(q.data::text,'UTF8'),'hex') END INTO wire FROM public.query_runs q WHERE q.id=selected_id;
 IF NOT FOUND THEN RETURN NULL;END IF;IF wire IS NULL THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
 RETURN jsonb_build_object('id',selected_id,'originalHex',wire,'state',keryx_storage.privacy_state(selected_id));
END;$$;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('privacy_read',ARRAY['query_runs','run_privacy','anonymous_run_claims','a2a_orders']::text[],true,true),
 ('privacy_owner',ARRAY['query_runs','run_privacy','anonymous_run_claims','a2a_orders']::text[],true,true),
 ('privacy_defaults',ARRAY['run_privacy_defaults']::text[],true,true),
 ('privacy_settlement',ARRAY['query_runs']::text[],true,true),
 ('privacy_pending',ARRAY['a2a_orders','query_runs']::text[],true,true);
CREATE FUNCTION public.storage_privacy_read(expected jsonb,digest text,selected_id text,actor jsonb,claims boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE exists_run boolean;visible boolean;item jsonb:=NULL;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native privacy read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'privacy_read');IF selected_id IS NULL OR selected_id !~ '^[A-Za-z0-9_-]{1,128}$' OR claims IS NULL THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
 SELECT true,coalesce(p.visibility,'unlisted') IN('public','unlisted') AND coalesce(p.erased,0)=0 INTO exists_run,visible FROM public.query_runs q LEFT JOIN public.run_privacy p ON p.run_id=q.id WHERE q.id=selected_id;
 IF coalesce(exists_run,false) THEN
  IF visible THEN item:=keryx_storage.privacy_item(selected_id);
  ELSIF actor IS NOT NULL AND keryx_storage.privacy_proof(selected_id,actor,claims) AND (keryx_storage.privacy_state(selected_id)->>'erased')='false' THEN item:=keryx_storage.privacy_item(selected_id);END IF;
 END IF;RETURN jsonb_build_object('exists',coalesce(exists_run,false),'item',item);
END;$$;
CREATE FUNCTION public.storage_privacy_owner(expected jsonb,digest text,selected_id text,actor jsonb,claims boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native privacy read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'privacy_owner');IF selected_id IS NULL OR selected_id !~ '^[A-Za-z0-9_-]{1,128}$' OR claims IS NULL THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
 IF keryx_storage.privacy_proof(selected_id,actor,claims) THEN RETURN jsonb_build_object('item',keryx_storage.privacy_item(selected_id));END IF;RETURN jsonb_build_object('item',NULL);
END;$$;
CREATE FUNCTION public.storage_privacy_defaults(expected jsonb,digest text,actor jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor_wallet text;visibility text;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native privacy read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'privacy_defaults');actor_wallet:=keryx_storage.privacy_actor(actor,false);IF actor_wallet IS NULL THEN RAISE EXCEPTION 'unauthenticated';END IF;
 SELECT p.visibility INTO visibility FROM public.run_privacy_defaults p WHERE p.wallet=actor_wallet;
 RETURN jsonb_build_object('visibility',coalesce(visibility,'public'));
END;$$;
CREATE FUNCTION public.storage_privacy_settlement(expected jsonb,digest text,selected_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE item jsonb;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native privacy read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'privacy_settlement');IF selected_id IS NULL OR selected_id !~ '^[A-Za-z0-9_-]{1,128}$' THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
 SELECT jsonb_build_object('id',q.id,'createdAt',to_char(q.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'budget',q.budget,'engine',q.engine,'totalSpent',q.total_spent,'totalToCreators',q.total_to_creators,'question','','answer','','subClaims','[]'::jsonb,'decisions','[]'::jsonb,'citations','[]'::jsonb,'trace','[]'::jsonb) INTO item FROM public.query_runs q WHERE q.id=selected_id AND octet_length(q.engine)<=16384;
 IF item IS NULL AND EXISTS(SELECT 1 FROM public.query_runs WHERE id=selected_id) THEN RAISE EXCEPTION 'privacy_unavailable';END IF;RETURN jsonb_build_object('item',item);
END;$$;
CREATE FUNCTION public.storage_privacy_pending(expected jsonb,digest text,selected_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE item jsonb;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native privacy read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'privacy_pending');IF selected_id IS NULL OR selected_id !~ '^[A-Za-z0-9_-]{1,128}$' THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
 SELECT jsonb_build_object('queryId',o.query_id,'status',o.status,'createdAt',to_char(o.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'startedAt',to_char(o.started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'amountUsdc',o.amount_usdc,'creatorBudgetUsdc',o.creator_budget_usdc,'serviceFeeUsdc',o.service_fee_usdc,'transaction',o.transaction_id) INTO item FROM public.a2a_orders o WHERE o.query_id=selected_id AND o.status='running' AND NOT EXISTS(SELECT 1 FROM public.query_runs q WHERE q.id=o.query_id);
 RETURN jsonb_build_object('item',item);
END;$$;
CREATE FUNCTION keryx_storage.privacy_audit(wallet text,selected_id text,selected_action text,request_id text,input_wire text,result_wire text DEFAULT NULL,original_digest text DEFAULT NULL)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE prior public.run_privacy_audit%rowtype;
BEGIN
 IF request_id IS NULL OR request_id !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'conflict';END IF;
 PERFORM request_id::uuid;
 SELECT * INTO prior FROM public.run_privacy_audit a WHERE a.request_id=privacy_audit.request_id;
 IF FOUND THEN
  IF prior.wallet IS DISTINCT FROM wallet OR prior.run_id IS DISTINCT FROM selected_id OR prior.action IS DISTINCT FROM selected_action OR prior.input IS DISTINCT FROM input_wire THEN RAISE EXCEPTION 'conflict';END IF;
  IF octet_length(prior.result)>8192 THEN RAISE EXCEPTION 'privacy_unavailable';END IF;RETURN prior.result;
 END IF;
 IF result_wire IS NOT NULL THEN INSERT INTO public.run_privacy_audit(request_id,wallet,run_id,action,input,result,original_digest,created_at)
  VALUES(request_id,wallet,selected_id,selected_action,input_wire,result_wire,original_digest,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));END IF;
 RETURN NULL;
END;$$;
CREATE FUNCTION keryx_storage.install_run_projection(selected_id text,packet jsonb,include_erasure boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE h jsonb;o jsonb;p jsonb;
BEGIN
 IF packet IS NULL OR jsonb_typeof(packet)<>'object' OR octet_length(packet::text)>16777216 THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
 h:=packet->'history';o:=packet->'ownership';p:=packet->'privacy';
 PERFORM keryx_storage.install_usage_projection(selected_id,p->'usage');
 INSERT INTO keryx_storage.run_history_projection(run_id,original_sha256,recorded_owner,owner_invalid,funded,provenance,anonymous_claim_eligible)
  VALUES(selected_id,h->>'sha256',h->>'recordedOwner',(h->>'ownerInvalid')::boolean,(h->>'funded')::boolean,nullif(h->'provenance','null'::jsonb),(h->>'anonymousClaimEligible')::boolean);
 INSERT INTO keryx_storage.run_ownership_projection(run_id,original_sha256,question_search,history_eligible,recorded_valid,claimed_valid,summary)
  VALUES(selected_id,o->>'sha256',decode(o->>'questionHex','hex'),(o->>'historyEligible')::boolean,(o->>'recordedValid')::boolean,(o->>'claimedValid')::boolean,nullif(o->'summary','null'::jsonb));
 INSERT INTO keryx_storage.run_privacy_projection(run_id,original_sha256,data_bytes,original_valid,erase_wire,original_fulfillment,question_fields,history_fields,history_references,learning_fields,archive_wire,erase_projection)
  VALUES(selected_id,p->>'sha256',(p->>'dataBytes')::integer,(p->>'valid')::boolean,CASE WHEN include_erasure THEN p->>'eraseWire' END,(p->>'originalFulfillment')::boolean,p->>'questionFields',p->>'historyFields',p->'historyReferences',p->>'learningFields',p->>'archiveWire',CASE WHEN include_erasure THEN nullif(p->'eraseProjection','null'::jsonb) END);
END;$$;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('privacy_default',ARRAY['run_privacy_defaults','run_privacy_audit']::text[],true,false),
 ('privacy_visibility',ARRAY['run_privacy','run_privacy_audit']::text[],true,false),
 ('privacy_erase',ARRAY['query_runs','run_privacy','run_privacy_audit','query_memories','gap_intents','run_history_projection','run_ownership_projection','run_privacy_projection','usage_projection']::text[],true,false),
 ('privacy_export',ARRAY['run_privacy_audit']::text[],true,false);
CREATE FUNCTION keryx_storage.privacy_mutate(selected_action text,selected_id text,actor jsonb,input_wire text,claims boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE wallet text;input jsonb;prior text;current_state jsonb;result jsonb;original_digest text;projection keryx_storage.run_privacy_projection%rowtype;request_id text;requested text;
BEGIN
 IF selected_action NOT IN('default','visibility','erase','export') OR input_wire IS NULL OR octet_length(input_wire)>8192 OR claims IS NULL THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
 wallet:=keryx_storage.privacy_actor(actor,selected_action<>'export');IF wallet IS NULL THEN RAISE EXCEPTION 'unauthenticated';END IF;
 input:=input_wire::jsonb;IF jsonb_typeof(input)<>'object' THEN RAISE EXCEPTION 'conflict';END IF;request_id:=input->>'requestId';
 IF selected_action='default' THEN
  requested:=input->>'visibility';IF requested IS NULL OR requested NOT IN('private','unlisted','public') OR input-'requestId'-'visibility'<>'{}'::jsonb THEN RAISE EXCEPTION 'conflict';END IF;
  input_wire:='{"visibility":'||to_json(requested)::text||'}';
  prior:=keryx_storage.privacy_audit(wallet,'','default',request_id,input_wire);
  IF prior IS NOT NULL THEN RETURN jsonb_build_object('visibility',prior::jsonb);END IF;
  INSERT INTO public.run_privacy_defaults VALUES(wallet,requested) ON CONFLICT ON CONSTRAINT run_privacy_defaults_pkey DO UPDATE SET visibility=excluded.visibility;
  PERFORM keryx_storage.privacy_audit(wallet,'','default',request_id,input_wire,to_json(requested)::text);RETURN jsonb_build_object('visibility',requested);
 END IF;
 IF selected_id IS NULL OR selected_id !~ '^[A-Za-z0-9_-]{1,128}$' THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
 IF NOT keryx_storage.privacy_proof(selected_id,actor,claims) THEN RAISE EXCEPTION 'not_found';END IF;
 SELECT * INTO projection FROM keryx_storage.run_privacy_projection WHERE run_id=selected_id;
 IF NOT FOUND OR NOT projection.original_valid THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
 current_state:=keryx_storage.privacy_state(selected_id);original_digest:=projection.original_sha256;
 IF selected_action='export' THEN
  IF input-'requestId'<>'{}'::jsonb THEN RAISE EXCEPTION 'conflict';END IF;
  PERFORM keryx_storage.privacy_audit(wallet,selected_id,'export',request_id,'{}',current_state::text,original_digest);
  RETURN jsonb_build_object('item',keryx_storage.privacy_item(selected_id));
 END IF;
 prior:=keryx_storage.privacy_audit(wallet,selected_id,selected_action,request_id,input_wire);IF prior IS NOT NULL THEN RETURN jsonb_build_object('state',prior::jsonb);END IF;
 IF input-'requestId'-'revision'-'visibility'<>'{}'::jsonb OR jsonb_typeof(input->'revision') IS DISTINCT FROM 'number' OR (input->>'revision')::numeric<>trunc((input->>'revision')::numeric) OR (input->>'revision')::numeric<0 THEN RAISE EXCEPTION 'conflict';END IF;
 IF current_state->>'erased'='true' THEN
  IF selected_action<>'erase' THEN RAISE EXCEPTION 'conflict';END IF;
  PERFORM keryx_storage.privacy_audit(wallet,selected_id,selected_action,request_id,input_wire,current_state::text);RETURN jsonb_build_object('state',current_state);
 END IF;
 IF (input->>'revision')::numeric IS DISTINCT FROM (current_state->>'revision')::numeric THEN RAISE EXCEPTION 'conflict';END IF;
 requested:=input->>'visibility';IF selected_action='visibility' AND(requested IS NULL OR requested NOT IN('private','unlisted','public')) THEN RAISE EXCEPTION 'conflict';END IF;
 IF selected_action='erase' THEN
  IF projection.original_fulfillment OR EXISTS(SELECT 1 FROM public.a2a_orders WHERE query_id=selected_id) OR EXISTS(SELECT 1 FROM public.gap_intents WHERE failed_query_id=selected_id AND status NOT IN('filled','missed','unpaid','failed','stale')) THEN RAISE EXCEPTION 'retention_hold';END IF;
  IF projection.erase_wire IS NULL OR projection.erase_projection IS NULL THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
  UPDATE public.query_runs SET question='',answer='',data=projection.erase_wire::json WHERE id=selected_id;
  DELETE FROM public.query_memories WHERE id=selected_id;
  UPDATE public.gap_intents SET question='',claim='',last_error=NULL WHERE failed_query_id=selected_id;
  PERFORM keryx_storage.install_run_projection(selected_id,projection.erase_projection,false);
 END IF;
 result:=jsonb_build_object('visibility',CASE WHEN selected_action='erase' THEN 'private' ELSE requested END,'revision',(current_state->>'revision')::numeric+1,'erased',selected_action='erase');
 INSERT INTO public.run_privacy(run_id,visibility,revision,erased,retained_owner,retained_digest,retained_binding,updated_at)
  VALUES(selected_id,result->>'visibility',(result->>'revision')::numeric,CASE WHEN selected_action='erase' THEN 1 ELSE 0 END,CASE WHEN selected_action='erase' THEN wallet END,
   CASE WHEN selected_action='erase' THEN encode(sha256(convert_to(projection.erase_wire,'UTF8')),'hex') END,CASE WHEN selected_action='erase' THEN keryx_storage.privacy_binding_wire(actor->'binding') END,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  ON CONFLICT(run_id) DO UPDATE SET visibility=excluded.visibility,revision=excluded.revision,erased=excluded.erased,retained_owner=excluded.retained_owner,retained_digest=excluded.retained_digest,retained_binding=excluded.retained_binding,updated_at=excluded.updated_at;
 PERFORM keryx_storage.privacy_audit(wallet,selected_id,selected_action,request_id,input_wire,result::text,original_digest);RETURN jsonb_build_object('state',result);
END;$$;
CREATE FUNCTION public.storage_privacy_mutation(expected jsonb,digest text,selected_action text,selected_id text,actor jsonb,input_wire text,claims boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF selected_action IS NULL OR selected_action NOT IN('default','visibility','erase','export') THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'privacy_'||selected_action);
 BEGIN
  result:=keryx_storage.privacy_mutate(selected_action,selected_id,actor,input_wire,claims);
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM=ANY(ARRAY['privacy_unavailable','not_found','conflict','unauthenticated','retention_hold']) THEN result:=jsonb_build_object('error',SQLERRM);ELSE RAISE;END IF;
 END;
 PERFORM keryx_storage.leave_operation();RETURN result;
END;$$;
CREATE FUNCTION keryx_storage.privacy_list_valid(options jsonb,maximum integer) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE item jsonb;
BEGIN
 IF options IS NULL OR jsonb_typeof(options)<>'object' OR options-'take'-'before'-'parentId'-'ids'<>'{}'::jsonb OR octet_length(options::text)>2097152
  OR jsonb_typeof(options->'take') IS DISTINCT FROM 'number' OR (options->>'take')::numeric<>trunc((options->>'take')::numeric) OR (options->>'take')::numeric NOT BETWEEN 1 AND maximum THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
 IF options?'parentId' AND(jsonb_typeof(options->'parentId')<>'string' OR options->>'parentId' !~ '^[A-Za-z0-9_-]{1,128}$') THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
 IF options?'before' THEN
  item:=options->'before';IF jsonb_typeof(item)<>'object' OR item-'createdAt'-'id'<>'{}'::jsonb OR jsonb_typeof(item->'createdAt') IS DISTINCT FROM 'string' OR octet_length(item->>'createdAt')>256 OR jsonb_typeof(item->'id') IS DISTINCT FROM 'string' OR item->>'id' !~ '^[A-Za-z0-9_-]{1,128}$' THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
 END IF;
 IF options?'ids' THEN
  IF jsonb_typeof(options->'ids')<>'array' OR jsonb_array_length(options->'ids')>10000 THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(options->'ids') LOOP IF jsonb_typeof(item)<>'string' OR item#>>'{}' !~ '^[A-Za-z0-9_-]{1,128}$' THEN RAISE EXCEPTION 'privacy_unavailable';END IF;END LOOP;
 END IF;
END;$$;
CREATE FUNCTION keryx_storage.privacy_visible(options jsonb) RETURNS TABLE(run_id text,created_at timestamptz,revision numeric) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT q.id,q.created_at,p.revision FROM public.query_runs q JOIN public.run_privacy p ON p.run_id=q.id
 WHERE p.visibility='public' AND p.erased=0 AND(NOT(options?'parentId') OR q.parent_id=options->>'parentId')
  AND(NOT(options?'ids') OR q.id IN(SELECT jsonb_array_elements_text(options->'ids')))
  AND(NOT(options?'before') OR to_char(q.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') COLLATE "C" <(options->'before'->>'createdAt') COLLATE "C"
   OR(to_char(q.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=options->'before'->>'createdAt' AND q.id COLLATE "C" <(options->'before'->>'id') COLLATE "C"))
 ORDER BY q.created_at DESC,q.id COLLATE "C" DESC LIMIT (options->>'take')::integer;
$$;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('privacy_list',ARRAY['query_runs','run_privacy']::text[],true,true),
 ('privacy_memories',ARRAY['query_memories','run_privacy']::text[],true,true),
 ('privacy_offers',ARRAY['gap_intents','run_privacy']::text[],true,true);
-- A raw JSON result preserves escaped NUL/surrogate fields without asking PG's
-- JSONB decoder to reinterpret the retained original. Bound the chosen complete
-- collection before concatenation; an oversized request refuses, never truncates.
CREATE FUNCTION public.storage_privacy_list(expected jsonb,digest text,options jsonb) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r record;bytes bigint:=64;items text;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native privacy read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'privacy_list');PERFORM keryx_storage.privacy_list_valid(options,2500);
 FOR r IN WITH chosen AS MATERIALIZED(SELECT * FROM keryx_storage.privacy_visible(options)) SELECT q.id,octet_length(q.data::text) original_bytes FROM chosen c JOIN public.query_runs q ON q.id=c.run_id LOOP
  IF r.original_bytes>4000000 OR octet_length(r.id)>128 THEN RAISE EXCEPTION 'privacy_unavailable';END IF;bytes:=bytes+r.original_bytes+512;IF bytes>33554432 THEN RAISE EXCEPTION 'native privacy complete-collection bound';END IF;
 END LOOP;
 WITH chosen AS MATERIALIZED(SELECT * FROM keryx_storage.privacy_visible(options))
 SELECT coalesce(string_agg('{"id":'||to_json(q.id)::text||',"run":'||q.data::text||',"state":'||jsonb_build_object('visibility','public','revision',c.revision,'erased',false)::text||'}',',' ORDER BY c.created_at DESC,c.run_id COLLATE "C" DESC),'') INTO items FROM chosen c JOIN public.query_runs q ON q.id=c.run_id;
 RETURN ('{"items":['||items||']}')::json;
END;$$;
CREATE FUNCTION public.storage_privacy_memories(expected jsonb,digest text,take integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r record;item jsonb;items jsonb:='[]'::jsonb;bytes bigint:=2;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native privacy read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'privacy_memories');IF take IS NULL OR take NOT BETWEEN 1 AND 2500 THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
 FOR r IN SELECT m.* FROM public.query_memories m JOIN public.run_privacy p ON p.run_id=m.id WHERE p.visibility='public' AND p.erased=0 ORDER BY m.created_at DESC,m.id COLLATE "C" DESC LIMIT take LOOP
  IF octet_length(r.source_scores::text)>1048576 OR octet_length(r.topics::text)>1048576 OR octet_length(r.sources_read::text)>1048576 OR octet_length(r.id)>128 THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
  item:=jsonb_build_object('id',r.id,'createdAt',to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'sourceScores',r.source_scores,'topics',r.topics)||CASE WHEN r.sources_read IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('sourcesRead',r.sources_read) END;
  bytes:=bytes+octet_length(item::text)+1;IF bytes>4194304 THEN RAISE EXCEPTION 'native privacy metadata bound';END IF;items:=items||jsonb_build_array(item);
 END LOOP;RETURN jsonb_build_object('items',items);
END;$$;
CREATE FUNCTION public.storage_privacy_offers(expected jsonb,digest text,take integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r record;item jsonb;items jsonb:='[]'::jsonb;bytes bigint:=2;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native privacy read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'privacy_offers');IF take IS NULL OR take NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
 FOR r IN SELECT g.id,g.gap_id,g.source_id,g.source_item_link,g.item_id,g.content_version,g.article_offer_id,g.owner_wallet,g.status,g.attempts,g.retry_run_id,g.coverage,g.reward_usdc,g.created_at,g.updated_at FROM public.gap_intents g JOIN public.run_privacy p ON p.run_id=g.failed_query_id WHERE p.visibility='public' AND p.erased=0
  AND(g.retry_run_id IS NULL OR EXISTS(SELECT 1 FROM public.run_privacy p2 WHERE p2.run_id=g.retry_run_id AND p2.visibility='public' AND p2.erased=0)) ORDER BY g.created_at DESC,g.id COLLATE "C" DESC LIMIT take LOOP
  IF octet_length(to_jsonb(r)::text)>65536 THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
  item:=jsonb_strip_nulls(jsonb_build_object('id',r.id,'gapId',r.gap_id,'sourceId',r.source_id,'sourceItemLink',r.source_item_link,'itemId',r.item_id,'contentVersion',r.content_version,'articleOfferId',r.article_offer_id,'ownerWallet',r.owner_wallet,'status',r.status,'attempts',r.attempts,'retryRunId',r.retry_run_id,'coverage',r.coverage,'rewardUsdc',r.reward_usdc,'createdAt',to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',to_char(r.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  bytes:=bytes+octet_length(item::text)+1;IF bytes>4194304 THEN RAISE EXCEPTION 'native privacy metadata bound';END IF;items:=items||jsonb_build_array(item);
 END LOOP;RETURN jsonb_build_object('items',items);
END;$$;
CREATE FUNCTION keryx_storage.privacy_reference_text(value text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE bytes bytea;
BEGIN
 IF value IS NULL THEN RETURN NULL;END IF;
 IF length(value)>2048 OR value !~ '^([a-f0-9]{2})*$' THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
 bytes:=decode(value,'hex');IF position(decode('00','hex') IN bytes)>0 THEN RETURN NULL;END IF;RETURN convert_from(bytes,'UTF8');
END;$$;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('privacy_questions',ARRAY['query_runs','run_privacy']::text[],true,true),
 ('privacy_source_history',ARRAY['query_runs','run_privacy','sources','source_items']::text[],true,true),
 ('privacy_learning_page',ARRAY['query_runs','run_privacy']::text[],true,true),
 ('privacy_archive_page',ARRAY['query_runs','run_privacy']::text[],true,true);
CREATE FUNCTION public.storage_privacy_slim(expected jsonb,digest text,selected_kind text,options jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r record;selected_fields text;item jsonb;rows jsonb:='[]'::jsonb;flags jsonb:='[]'::jsonb;bytes bigint:=512;flag_row record;flag_bytes bigint:=2;maximum integer;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native privacy read-only transaction required';END IF;
 IF selected_kind IS NULL OR selected_kind NOT IN('questions','source_history','learning_page','archive_page') THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'privacy_'||selected_kind);
 maximum:=CASE WHEN selected_kind='source_history' THEN 50 ELSE 32 END;PERFORM keryx_storage.privacy_list_valid(options,maximum);
 FOR r IN WITH chosen AS MATERIALIZED(SELECT * FROM keryx_storage.privacy_visible(options))
  SELECT c.run_id,c.created_at,c.revision,p.data_bytes,p.question_fields,p.history_fields,p.history_references,p.learning_fields,p.archive_wire FROM chosen c LEFT JOIN keryx_storage.run_privacy_projection p ON p.run_id=c.run_id ORDER BY c.created_at DESC,c.run_id COLLATE "C" DESC LOOP
  IF r.data_bytes IS NULL OR r.data_bytes>4000000 THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
  IF selected_kind='archive_page' THEN
   IF r.archive_wire IS NULL THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
   item:=jsonb_build_object('id',r.run_id,'createdAt',to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'entryHex',encode(convert_to(r.archive_wire,'UTF8'),'hex'));
  ELSE
   selected_fields:=CASE selected_kind WHEN 'questions' THEN r.question_fields WHEN 'source_history' THEN r.history_fields ELSE r.learning_fields END;
   IF selected_fields IS NULL OR octet_length(selected_fields)>8000000 THEN RAISE EXCEPTION 'privacy_unavailable';END IF;
   bytes:=bytes+octet_length(selected_fields)*2+512;
   IF selected_kind='source_history' THEN bytes:=bytes+octet_length(r.history_references::text);END IF;
   IF bytes>8388608 THEN RAISE EXCEPTION 'native slim privacy metadata bound';END IF;
   item:=jsonb_build_object('id',r.run_id,'data_bytes',r.data_bytes,'fieldsHex',encode(convert_to(selected_fields,'UTF8'),'hex'));
   IF selected_kind='learning_page' THEN item:=item||jsonb_build_object('created_at',to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'privacy_revision',r.revision);END IF;
  END IF;
  IF selected_kind='archive_page' THEN bytes:=bytes+octet_length(item::text)+1;IF bytes>8388608 THEN RAISE EXCEPTION 'native archive privacy metadata bound';END IF;END IF;
  rows:=rows||jsonb_build_array(item);
 END LOOP;
 IF selected_kind='source_history' THEN
  FOR flag_row IN WITH chosen AS MATERIALIZED(SELECT * FROM keryx_storage.privacy_visible(options)),refs AS MATERIALIZED(
   SELECT DISTINCT keryx_storage.privacy_reference_text(ref->>'sourceHex') source_id,keryx_storage.privacy_reference_text(ref->>'itemHex') item_id FROM chosen c JOIN keryx_storage.run_privacy_projection p ON p.run_id=c.run_id CROSS JOIN LATERAL jsonb_array_elements(p.history_references) ref),matches AS(
    SELECT 'source:'||s.id flag FROM refs ref_row JOIN public.sources s ON s.id=ref_row.source_id WHERE s.evidence_provenance='synthetic-demo'
    UNION SELECT 'item:'||i.source_id||':'||i.id flag FROM refs ref_row JOIN public.source_items i ON i.id=ref_row.item_id WHERE i.evidence_provenance='synthetic-demo') SELECT flag FROM matches ORDER BY flag COLLATE "C" LOOP
   flag_bytes:=flag_bytes+octet_length(to_jsonb(flag_row.flag)::text)+1;IF flag_bytes>4194304 THEN RAISE EXCEPTION 'native provenance metadata bound';END IF;flags:=flags||jsonb_build_array(flag_row.flag);
  END LOOP;
 END IF;
 RETURN jsonb_build_object('rows',rows,'flags',flags);
END;$$;
REVOKE ALL ON TABLE keryx_storage.run_privacy_projection FROM PUBLIC,anon,authenticated,service_role,keryx_app,keryx_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_privacy_read(jsonb,text,text,jsonb,boolean),public.storage_privacy_owner(jsonb,text,text,jsonb,boolean),public.storage_privacy_defaults(jsonb,text,jsonb),public.storage_privacy_settlement(jsonb,text,text),public.storage_privacy_pending(jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_privacy_read(jsonb,text,text,jsonb,boolean),public.storage_privacy_owner(jsonb,text,text,jsonb,boolean),public.storage_privacy_defaults(jsonb,text,jsonb),public.storage_privacy_settlement(jsonb,text,text),public.storage_privacy_pending(jsonb,text,text) TO keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_privacy_mutation(jsonb,text,text,text,jsonb,text,boolean) FROM PUBLIC,anon,authenticated,service_role,keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_privacy_mutation(jsonb,text,text,text,jsonb,text,boolean) TO keryx_app;
REVOKE ALL ON FUNCTION public.storage_privacy_list(jsonb,text,jsonb),public.storage_privacy_memories(jsonb,text,integer),public.storage_privacy_offers(jsonb,text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_privacy_list(jsonb,text,jsonb),public.storage_privacy_memories(jsonb,text,integer),public.storage_privacy_offers(jsonb,text,integer) TO keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_privacy_slim(jsonb,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_privacy_slim(jsonb,text,text,jsonb) TO keryx_app,keryx_reader;
RESET ROLE;
