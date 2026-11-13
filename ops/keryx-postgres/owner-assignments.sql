SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('owner_assignment_act',ARRAY['owner269_operations','owner269_associations']::text[],true,false),
 ('owner_assignment_reply',ARRAY['owner269_operations','owner269_associations','query_runs','run_privacy','anonymous_run_claims','a2a_orders','payment_events','account267_accounts','account267_members','account267_credentials','account267_sessions','web_sessions']::text[],true,true);
CREATE TRIGGER native_owner269_operations_writer BEFORE INSERT OR UPDATE OR DELETE ON public.owner269_operations FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence();
CREATE TRIGGER native_owner269_associations_writer BEFORE INSERT OR UPDATE OR DELETE ON public.owner269_associations FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence();
CREATE FUNCTION keryx_storage.owner269_retention() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF session_user='postgres' AND(SELECT mode FROM keryx_storage.control WHERE singleton)='held' THEN IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;END IF;
 IF TG_TABLE_NAME='owner269_operations' OR TG_OP='DELETE' THEN RAISE EXCEPTION 'assignment_audit_retained';END IF;
 IF OLD.status IN('rejected','revoked') OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id OR NEW.run_id IS DISTINCT FROM OLD.run_id
  OR NEW.recipient_account IS DISTINCT FROM OLD.recipient_account OR NEW.recipient_generation IS DISTINCT FROM OLD.recipient_generation
  OR NEW.apply_id IS DISTINCT FROM OLD.apply_id OR NEW.revision<>OLD.revision+1 OR NEW.last_operation_id IS NOT DISTINCT FROM OLD.last_operation_id
 THEN RAISE EXCEPTION 'assignment_conflict';END IF;RETURN NEW;
END;$$;
CREATE TRIGGER native_owner269_operations_retained BEFORE UPDATE OR DELETE ON public.owner269_operations FOR EACH ROW EXECUTE FUNCTION keryx_storage.owner269_retention();
CREATE TRIGGER native_owner269_associations_retained BEFORE UPDATE OR DELETE ON public.owner269_associations FOR EACH ROW EXECUTE FUNCTION keryx_storage.owner269_retention();
-- Joint #262/original/A2A arbitration. Suppression and expiry do not free a
-- nonterminal reservation. Inspect scalar IDs only, never to_jsonb(NEW.data).
CREATE FUNCTION keryx_storage.owner269_occupancy() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE ids text[]:=ARRAY[]::text[];
BEGIN
 IF session_user='postgres' AND(SELECT mode FROM keryx_storage.control WHERE singleton)='held' THEN IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;END IF;
 CASE TG_TABLE_NAME
  WHEN 'query_runs' THEN IF TG_OP<>'INSERT' THEN ids:=array_append(ids,OLD.id);END IF;IF TG_OP<>'DELETE' THEN ids:=array_append(ids,NEW.id);END IF;
  WHEN 'anonymous_run_claims' THEN ids:=array_append(ids,NEW.run_id);
  WHEN 'a2a_orders' THEN IF TG_OP='UPDATE' THEN ids:=array_append(ids,OLD.query_id);END IF;ids:=array_append(ids,NEW.query_id);
  ELSE RAISE EXCEPTION 'assignment_unavailable';
 END CASE;
 IF EXISTS(SELECT 1 FROM public.owner269_associations WHERE run_id=ANY(ids) AND status IN('assigned-by-owner','claimed')) THEN
  IF TG_TABLE_NAME='anonymous_run_claims' THEN RAISE EXCEPTION 'claim_unavailable';END IF;RAISE EXCEPTION 'assignment_original_occupied';
 END IF;IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END;$$;
CREATE TRIGGER native_owner269_ticket_occupancy BEFORE INSERT ON public.anonymous_run_claims FOR EACH ROW EXECUTE FUNCTION keryx_storage.owner269_occupancy();
CREATE TRIGGER native_owner269_original_occupancy BEFORE INSERT OR UPDATE OR DELETE ON public.query_runs FOR EACH ROW EXECUTE FUNCTION keryx_storage.owner269_occupancy();
CREATE TRIGGER native_owner269_a2a_occupancy BEFORE INSERT OR UPDATE ON public.a2a_orders FOR EACH ROW EXECUTE FUNCTION keryx_storage.owner269_occupancy();
CREATE FUNCTION keryx_storage.owner269_bound(manifest jsonb) RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF manifest->'binding'->>'storageDigest' IS DISTINCT FROM(SELECT identity_digest FROM keryx_storage.identity WHERE singleton)
  OR manifest->'binding'->>'network' IS DISTINCT FROM(SELECT identity->>'network' FROM keryx_storage.identity WHERE singleton)
 THEN RAISE EXCEPTION 'assignment_ineligible';END IF;
END;$$;
CREATE FUNCTION keryx_storage.owner269_known(target jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE membership jsonb;credential record;
BEGIN
 PERFORM keryx_storage.owner269_valid('recipient',target);
 IF NOT EXISTS(SELECT 1 FROM public.account267_accounts WHERE account_id=target->>'accountId' AND to_jsonb(created_at)=target->'accountCreatedAt') THEN RAISE EXCEPTION 'assignment_unauthenticated';END IF;
 BEGIN membership:=keryx_storage.account_membership(target->>'accountId');
 EXCEPTION WHEN raise_exception THEN RAISE EXCEPTION 'assignment_unavailable';END;
 IF membership->'createdAt' IS DISTINCT FROM target->'accountCreatedAt' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(membership->'members')m WHERE m->>'wallet'=target->>'wallet' AND m->>'generation'=target->>'memberGeneration') THEN RAISE EXCEPTION 'assignment_unauthenticated';END IF;
 SELECT generation,login_after INTO credential FROM public.account267_credentials WHERE account_id=target->>'accountId' AND wallet=target->>'wallet' AND member_generation=target->>'memberGeneration' AND active=1;
 IF NOT FOUND THEN RAISE EXCEPTION 'assignment_unauthenticated';END IF;
 PERFORM keryx_storage.owner269_valid('digest',to_jsonb(credential.generation));PERFORM keryx_storage.owner269_valid('time',to_jsonb(credential.login_after));
 RETURN jsonb_build_object('generation',credential.generation,'loginAfter',credential.login_after);
END;$$;
CREATE FUNCTION keryx_storage.owner269_actor(s jsonb,origin text,stamp bigint) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE snapshot jsonb;recipient jsonb;credential jsonb;
BEGIN
 IF origin IS NULL OR origin IS DISTINCT FROM(SELECT c.origin FROM keryx_storage.control c WHERE singleton) THEN RAISE EXCEPTION 'assignment_conflict';END IF;
 BEGIN snapshot:=keryx_storage.account_resolve(s,jsonb_build_object('origin',origin,'network',(SELECT identity->>'network' FROM keryx_storage.identity WHERE singleton)),stamp);
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='account_unauthenticated' THEN RAISE EXCEPTION 'assignment_unauthenticated';END IF;RAISE EXCEPTION 'assignment_unavailable';
 END;
 IF snapshot IS NULL THEN RAISE EXCEPTION 'assignment_unauthenticated';END IF;
 recipient:=jsonb_build_object('accountId',snapshot->'membership'->'accountId','accountCreatedAt',snapshot->'membership'->'createdAt','wallet',s->'wallet','memberGeneration',snapshot->'memberGeneration');
 credential:=keryx_storage.owner269_known(recipient);
 IF credential->>'generation' IS DISTINCT FROM snapshot->>'credentialGeneration' OR(s->>'issuedAt')::numeric<(credential->>'loginAfter')::numeric THEN RAISE EXCEPTION 'assignment_unauthenticated';END IF;
 RETURN jsonb_build_object('recipient',recipient,'credentialGeneration',credential->'generation','origin',origin);
END;$$;
CREATE FUNCTION keryx_storage.owner269_event(selected_id text) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE raw public.owner269_operations%rowtype;value jsonb;
BEGIN
 SELECT * INTO raw FROM public.owner269_operations WHERE request_id=selected_id;IF NOT FOUND THEN RETURN NULL;END IF;
 IF octet_length(raw.event)>65536 THEN RAISE EXCEPTION 'assignment_unavailable';END IF;value:=raw.event::jsonb;PERFORM keryx_storage.owner269_valid('event',value);
 IF value->'receipt'->>'requestId' IS DISTINCT FROM selected_id OR value->'input'->>'requestId' IS DISTINCT FROM selected_id
  OR value->>'inputDigest' IS DISTINCT FROM raw.input_digest OR value->'receipt'->>'inputDigest' IS DISTINCT FROM raw.input_digest
  OR value->'input'->>'action' IS DISTINCT FROM value->'receipt'->>'action'
  OR value->>'inputDigest' IS DISTINCT FROM keryx_storage.owner269_digest('operation',jsonb_build_object('input',value->'input','actor',value->'actor')) THEN RAISE EXCEPTION 'assignment_unavailable';END IF;
 PERFORM keryx_storage.owner269_bound(value->'manifest');RETURN value;
END;$$;
CREATE FUNCTION keryx_storage.owner269_association(selected_id text) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE raw public.owner269_associations%rowtype;value jsonb;
BEGIN
 SELECT * INTO raw FROM public.owner269_associations WHERE assignment_id=selected_id;IF NOT FOUND THEN RAISE EXCEPTION 'assignment_conflict';END IF;
 IF octet_length(raw.state)>32768 THEN RAISE EXCEPTION 'assignment_unavailable';END IF;value:=raw.state::jsonb;PERFORM keryx_storage.owner269_valid('association',value);
 IF value->'member'->>'assignmentId' IS DISTINCT FROM raw.assignment_id OR value->'member'->>'runId' IS DISTINCT FROM raw.run_id
  OR(value->>'revision')::numeric IS DISTINCT FROM raw.revision OR value->>'status' IS DISTINCT FROM raw.status
  OR value->>'applyId' IS DISTINCT FROM raw.apply_id OR value->>'lastOperationId' IS DISTINCT FROM raw.last_operation_id
  OR value->'manifest'->'recipient'->>'accountId' IS DISTINCT FROM raw.recipient_account OR value->'manifest'->'recipient'->>'memberGeneration' IS DISTINCT FROM raw.recipient_generation
  OR value->'member' IS DISTINCT FROM value->'manifest'->'members'->((value->>'ordinal')::integer) THEN RAISE EXCEPTION 'assignment_unavailable';END IF;
 PERFORM keryx_storage.owner269_bound(value->'manifest');RETURN value;
END;$$;
CREATE FUNCTION keryx_storage.owner269_original(manifest jsonb,member jsonb,stamp bigint) RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE original record;rails jsonb;
BEGIN
 PERFORM keryx_storage.owner269_bound(manifest);
 SELECT q.asker,q.created_at,octet_length(q.data::text) bytes,CASE WHEN octet_length(q.data::text)<=4000000 THEN keryx_storage.run_original_sha256(q.data) END hash,
  h.original_sha256,h.original_created_at,h.anonymous_claim_eligible,v.visibility,v.erased INTO original FROM public.query_runs q
  LEFT JOIN keryx_storage.run_history_projection h ON h.run_id=q.id LEFT JOIN public.run_privacy v ON v.run_id=q.id WHERE q.id=member->>'runId';
 IF NOT FOUND OR original.asker IS NOT NULL OR original.bytes>4000000 OR original.created_at IS DISTINCT FROM(member->>'completedAt')::timestamptz
  OR extract(epoch FROM(member->>'completedAt')::timestamptz)*1000>stamp OR original.hash IS DISTINCT FROM member->>'originalSha256'
  OR EXISTS(SELECT 1 FROM public.a2a_orders WHERE query_id=member->>'runId') OR EXISTS(SELECT 1 FROM public.anonymous_run_claims WHERE run_id=member->>'runId')
  OR original.visibility IS NOT NULL AND(original.erased<>0 OR original.visibility NOT IN('public','unlisted')) THEN RAISE EXCEPTION 'assignment_ineligible';END IF;
 IF original.original_sha256 IS NULL OR original.anonymous_claim_eligible IS NULL THEN RAISE EXCEPTION 'assignment_unavailable';END IF;
 IF original.original_sha256 IS DISTINCT FROM original.hash OR original.original_created_at IS DISTINCT FROM member->>'completedAt' OR NOT original.anonymous_claim_eligible THEN RAISE EXCEPTION 'assignment_ineligible';END IF;
 SELECT coalesce(jsonb_agg(network),'[]') INTO rails FROM(SELECT DISTINCT network FROM public.payment_events WHERE query_id=member->>'runId' LIMIT 3)x;
 IF jsonb_array_length(rails)<>1 OR rails->>0 IS DISTINCT FROM manifest->'binding'->>'network' THEN RAISE EXCEPTION 'assignment_ineligible';END IF;
END;$$;
CREATE FUNCTION keryx_storage.owner269_consent(manifest jsonb,consent_id text,stamp bigint,pending boolean) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE proof jsonb;credential jsonb;
BEGIN
 proof:=keryx_storage.owner269_event(consent_id);
 IF proof IS NULL OR proof->'receipt'->>'action' IS DISTINCT FROM 'consent' OR proof->'manifest' IS DISTINCT FROM manifest OR proof->'actor' IS DISTINCT FROM manifest->'recipient'
  OR proof->'consentAt'='null'::jsonb OR(proof->>'consentAt')::numeric>stamp
  OR pending AND((manifest->>'admissionExpiresAt')::numeric<=stamp OR(manifest->>'admissionExpiresAt')::numeric>(proof->>'consentAt')::numeric+86400000) THEN RAISE EXCEPTION 'assignment_consent_required';END IF;
 credential:=keryx_storage.owner269_known(manifest->'recipient');
 IF credential->>'generation' IS DISTINCT FROM proof->>'credentialGeneration' OR EXISTS(SELECT 1 FROM public.owner269_operations WHERE event::jsonb->'receipt'->>'action'='withdraw-consent' AND event::jsonb->>'consentId'=consent_id) THEN RAISE EXCEPTION 'assignment_consent_required';END IF;
 RETURN proof;
END;$$;
CREATE FUNCTION keryx_storage.owner269_save(value jsonb,previous jsonb) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE affected integer;encoded text;
BEGIN
 PERFORM keryx_storage.owner269_valid('association',value);encoded:=keryx_storage.owner269_json(value);
 -- Recipient operations only update a retained association. Genesis remains an
 -- independently admitted local Operator operation, never an app capability.
 IF previous IS NULL THEN RAISE EXCEPTION 'assignment_owner_required';END IF;
 UPDATE public.owner269_associations SET revision=(value->>'revision')::bigint,status=value->>'status',last_operation_id=value->>'lastOperationId',state=encoded
 WHERE assignment_id=value->'member'->>'assignmentId' AND revision=(previous->>'revision')::bigint AND status=previous->>'status';
 GET DIAGNOSTICS affected=ROW_COUNT;IF affected<>1 THEN RAISE EXCEPTION 'assignment_conflict';END IF;
END;$$;
CREATE FUNCTION keryx_storage.owner269_append(value jsonb) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;row_value jsonb;n integer:=0;encoded text;
BEGIN
 PERFORM keryx_storage.owner269_valid('event',value);encoded:=keryx_storage.owner269_json(value);
 IF octet_length(encoded)>65536 OR jsonb_array_length(value->'receipt'->'results')<>jsonb_array_length(value->'priorMembers')
  OR(SELECT count(DISTINCT r->>'assignmentId') FROM jsonb_array_elements(value->'receipt'->'results')r)<>jsonb_array_length(value->'receipt'->'results') THEN RAISE EXCEPTION 'assignment_unavailable';END IF;
 INSERT INTO public.owner269_operations(request_id,input_digest,event) VALUES(value->'receipt'->>'requestId',value->>'inputDigest',encoded);
 FOR result IN SELECT jsonb_array_elements(value->'receipt'->'results') LOOP
  IF result->'assignmentId' IS DISTINCT FROM value->'priorMembers'->n->'assignmentId' THEN RAISE EXCEPTION 'assignment_unavailable';END IF;
  row_value:=keryx_storage.owner269_association(result->>'assignmentId');
  IF row_value->'lastOperationId' IS DISTINCT FROM value->'receipt'->'requestId' OR row_value->'revision' IS DISTINCT FROM result->'revision' OR row_value->'status' IS DISTINCT FROM result->'status' THEN RAISE EXCEPTION 'assignment_unavailable';END IF;n:=n+1;
 END LOOP;
END;$$;
CREATE FUNCTION keryx_storage.owner269_act(s jsonb,expected jsonb,input jsonb,origin text,stamp bigint) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE current_actor jsonb;digest text;historical jsonb;manifest jsonb;proof jsonb;consent_id text;consent_at jsonb:='null';prior_operation jsonb:='null';
 rows jsonb:='[]';priors jsonb:='[]';retained jsonb:='[]';expectations jsonb:='[]';member jsonb;previous jsonb;next_row jsonb;result jsonb;action text;
BEGIN
 PERFORM keryx_storage.owner269_valid('recipient',expected);PERFORM keryx_storage.owner269_valid('input',input);action:=input->>'action';
 IF action NOT IN('consent','confirm','reject','withdraw','withdraw-consent') THEN RAISE EXCEPTION 'assignment_owner_required';END IF;
 current_actor:=keryx_storage.owner269_actor(s,origin,stamp);
 IF current_actor->'recipient' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'assignment_conflict';END IF;
 digest:=keryx_storage.owner269_digest('operation',jsonb_build_object('input',input,'actor',current_actor->'recipient'));
 -- Current durable actor precedes replay. The historical receipt is never a
 -- substitute for present consent, publication or financial authority.
 historical:=keryx_storage.owner269_event(input->>'requestId');
 IF historical IS NOT NULL THEN
  IF historical->>'inputDigest' IS DISTINCT FROM digest OR historical->'actor' IS DISTINCT FROM current_actor->'recipient' THEN RAISE EXCEPTION 'assignment_conflict';END IF;
  RETURN historical->'receipt';
 END IF;
 CASE action
 WHEN 'consent' THEN
  manifest:=input->'manifest';PERFORM keryx_storage.owner269_bound(manifest);
  IF manifest->'recipient' IS DISTINCT FROM current_actor->'recipient' OR manifest->'binding'->>'origin' IS DISTINCT FROM origin
   OR(manifest->>'admissionExpiresAt')::numeric<=stamp OR(manifest->>'admissionExpiresAt')::numeric>stamp+86400000 THEN RAISE EXCEPTION 'assignment_consent_required';END IF;
  FOR member IN SELECT jsonb_array_elements(manifest->'members') LOOP PERFORM keryx_storage.owner269_original(manifest,member,stamp);END LOOP;
  consent_id:=input->>'requestId';consent_at:=to_jsonb(stamp);
 WHEN 'withdraw-consent' THEN
  proof:=keryx_storage.owner269_event(input->>'consentId');
  IF proof IS NULL OR proof->'receipt'->>'action' IS DISTINCT FROM 'consent' OR proof->'actor' IS DISTINCT FROM current_actor->'recipient' THEN RAISE EXCEPTION 'assignment_conflict';END IF;
  manifest:=proof->'manifest';consent_id:=input->>'consentId';consent_at:=proof->'consentAt';prior_operation:=input->'consentId';
  IF EXISTS(SELECT 1 FROM public.owner269_operations WHERE event::jsonb->'receipt'->>'action'='withdraw-consent' AND event::jsonb->>'consentId'=consent_id) THEN RAISE EXCEPTION 'assignment_conflict';END IF;
  FOR member IN SELECT jsonb_array_elements(manifest->'members') LOOP
   IF EXISTS(SELECT 1 FROM public.owner269_associations WHERE assignment_id=member->>'assignmentId') THEN
    previous:=keryx_storage.owner269_association(member->>'assignmentId');
    IF previous->>'consentId'=consent_id AND previous->>'status' IN('assigned-by-owner','claimed') THEN
     retained:=retained||jsonb_build_array(previous);expectations:=expectations||jsonb_build_array(jsonb_build_object('assignmentId',member->'assignmentId','revision',previous->'revision'));
    END IF;
   END IF;
  END LOOP;
  IF input->'expected' IS DISTINCT FROM expectations THEN RAISE EXCEPTION 'assignment_conflict';END IF;
 ELSE
  previous:=keryx_storage.owner269_association(input->'expected'->>'assignmentId');manifest:=previous->'manifest';
  IF manifest->'recipient' IS DISTINCT FROM current_actor->'recipient' OR manifest->'binding'->>'origin' IS DISTINCT FROM origin
   OR previous->>'status' NOT IN('assigned-by-owner','claimed') OR previous->'revision' IS DISTINCT FROM input->'expected'->'revision' THEN RAISE EXCEPTION 'assignment_conflict';END IF;
  consent_id:=previous->>'consentId';proof:=keryx_storage.owner269_event(consent_id);consent_at:=coalesce(proof->'consentAt','null');prior_operation:=previous->'lastOperationId';
  IF action='confirm' THEN
   IF previous->>'status'<>'assigned-by-owner' THEN RAISE EXCEPTION 'assignment_conflict';END IF;
   PERFORM keryx_storage.owner269_consent(manifest,consent_id,stamp,true);PERFORM keryx_storage.owner269_original(manifest,previous->'member',stamp);
  ELSIF action='reject' AND previous->>'status'<>'assigned-by-owner' THEN RAISE EXCEPTION 'assignment_conflict';END IF;
  retained:=jsonb_build_array(previous);
 END CASE;
 -- Negative decisions deliberately require neither positive consent nor the
 -- original content. The current actor still belongs to the original generation.
 FOR previous IN SELECT jsonb_array_elements(retained) LOOP
  next_row:=previous||jsonb_build_object('revision',(previous->>'revision')::bigint+1,'lastOperationId',input->'requestId','decidedAt',stamp,
   'status',CASE action WHEN 'confirm' THEN 'claimed' WHEN 'reject' THEN 'rejected' ELSE 'revoked' END,
   'confirmedAt',CASE WHEN action='confirm' THEN to_jsonb(stamp) ELSE previous->'confirmedAt' END);
  priors:=priors||jsonb_build_array(jsonb_build_object('assignmentId',previous->'member'->'assignmentId','revision',previous->'revision','status',previous->'status','priorOperationId',previous->'lastOperationId'));
  PERFORM keryx_storage.owner269_save(next_row,previous);rows:=rows||jsonb_build_array(jsonb_build_object('assignmentId',next_row->'member'->'assignmentId','revision',next_row->'revision','status',next_row->'status'));
 END LOOP;
 result:=jsonb_build_object('version',1,'requestId',input->'requestId','inputDigest',digest,'action',action,'committedAt',stamp,'results',rows,'meaning','historical-committed-result-not-current-authority');
 PERFORM keryx_storage.owner269_append(jsonb_build_object('version',1,'actor',current_actor->'recipient','input',input,'priorMembers',priors,
  'credentialGeneration',current_actor->'credentialGeneration','inputDigest',digest,'manifest',manifest,'consentId',consent_id,'consentAt',consent_at,'priorOperationId',prior_operation,'receipt',result));
 RETURN result;
END;$$;
CREATE FUNCTION public.storage_owner_assignment_act(expected_identity jsonb,digest text,s jsonb,expected_recipient jsonb,input jsonb,origin text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE value jsonb;failure text;stamp bigint;
BEGIN
 PERFORM keryx_storage.require_operation(expected_identity,digest,'owner_assignment_act');stamp:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 BEGIN value:=keryx_storage.owner269_act(s,expected_recipient,input,origin,stamp);
 EXCEPTION WHEN raise_exception THEN
  failure:=SQLERRM;IF failure NOT IN('assignment_unavailable','assignment_unauthenticated','assignment_conflict','assignment_ineligible','assignment_consent_required','assignment_arbitration_unavailable','assignment_owner_required') THEN RAISE;END IF;
  PERFORM keryx_storage.leave_operation();RETURN jsonb_build_object('ok',false,'error',failure);
 END;
 PERFORM keryx_storage.leave_operation();RETURN jsonb_build_object('ok',true,'value',value);
END;$$;
-- Every read used to form the private response shares this final statement's
-- snapshot. No original text, session proof or owner capability leaves SQL.
CREATE FUNCTION keryx_storage.owner269_reply(s jsonb,wallet text,origin text,expected jsonb,receipt jsonb,stamp bigint) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE current_actor jsonb;prior jsonb;selected record;row_value jsonb;effective boolean;history jsonb:='[]';failure text;n integer:=0;
BEGIN
 current_actor:=keryx_storage.owner269_actor(s,origin,stamp);
 IF current_actor->'recipient'->>'wallet' IS DISTINCT FROM wallet OR expected IS NOT NULL AND expected<>'null'::jsonb AND expected IS DISTINCT FROM current_actor->'recipient' THEN RAISE EXCEPTION 'assignment_conflict';END IF;
 IF expected IS NOT NULL AND expected<>'null'::jsonb THEN PERFORM keryx_storage.owner269_valid('recipient',expected);END IF;
 IF receipt IS NOT NULL AND receipt<>'null'::jsonb THEN
  PERFORM keryx_storage.owner269_valid('receipt',receipt);prior:=keryx_storage.owner269_event(receipt->>'requestId');
  IF prior IS NULL OR prior->'actor' IS DISTINCT FROM current_actor->'recipient' OR prior->'receipt' IS DISTINCT FROM receipt THEN RAISE EXCEPTION 'assignment_unauthenticated';END IF;
 END IF;
 FOR selected IN SELECT assignment_id FROM public.owner269_associations WHERE recipient_account=current_actor->'recipient'->>'accountId'
  AND recipient_generation=current_actor->'recipient'->>'memberGeneration' AND status IN('assigned-by-owner','claimed') ORDER BY assignment_id COLLATE "C" LIMIT 26 LOOP
  n:=n+1;IF n>25 THEN RAISE EXCEPTION 'assignment_unavailable';END IF;row_value:=keryx_storage.owner269_association(selected.assignment_id);
  IF row_value->'manifest'->'recipient' IS DISTINCT FROM current_actor->'recipient' OR row_value->'manifest'->'binding'->>'origin' IS DISTINCT FROM origin THEN RAISE EXCEPTION 'assignment_unavailable';END IF;
  effective:=true;
  BEGIN
   PERFORM keryx_storage.owner269_consent(row_value->'manifest',row_value->>'consentId',stamp,row_value->>'status'='assigned-by-owner');
   PERFORM keryx_storage.owner269_original(row_value->'manifest',row_value->'member',stamp);
  EXCEPTION WHEN raise_exception THEN
   failure:=SQLERRM;IF failure NOT IN('assignment_consent_required','assignment_unauthenticated','assignment_ineligible') THEN RAISE;END IF;effective:=false;
  END;
  history:=history||jsonb_build_array(jsonb_build_object('row',row_value,'effective',effective));
 END LOOP;
 RETURN jsonb_build_object('recipient',current_actor->'recipient','history',history,'receipt',coalesce(receipt,'null'));
END;$$;
CREATE FUNCTION public.storage_owner_assignment_reply(expected_identity jsonb,digest text,s jsonb,wallet text,origin text,expected_recipient jsonb,receipt jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE value jsonb;failure text;stamp bigint;
BEGIN
 IF current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native assignment read-only transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected_identity,digest,'owner_assignment_reply');stamp:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 BEGIN value:=keryx_storage.owner269_reply(s,wallet,origin,expected_recipient,receipt,stamp);
 EXCEPTION WHEN raise_exception THEN
  failure:=SQLERRM;IF failure NOT IN('assignment_unavailable','assignment_unauthenticated','assignment_conflict','assignment_ineligible','assignment_consent_required') THEN RAISE;END IF;
  RETURN jsonb_build_object('ok',false,'error',failure);
 END;
 RETURN jsonb_build_object('ok',true,'value',value);
END;$$;
REVOKE ALL ON FUNCTION public.storage_owner_assignment_act(jsonb,text,jsonb,jsonb,jsonb,text),public.storage_owner_assignment_reply(jsonb,text,jsonb,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.storage_owner_assignment_act(jsonb,text,jsonb,jsonb,jsonb,text) FROM keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_owner_assignment_act(jsonb,text,jsonb,jsonb,jsonb,text) TO keryx_app;
GRANT EXECUTE ON FUNCTION public.storage_owner_assignment_reply(jsonb,text,jsonb,text,text,jsonb,jsonb) TO keryx_app,keryx_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
RESET ROLE;
