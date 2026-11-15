-- Fresh Source only. Extend the existing exact trigger identity; no private
-- schema wildcard, caller callback, writer token or new helper is introduced.
SET ROLE keryx_owner;
DO $private_result_source$
DECLARE original_body text;extended_body text;definition text;at integer;
BEGIN
 IF (SELECT mode FROM keryx_storage.control WHERE singleton) IS DISTINCT FROM 'held'
  OR EXISTS(SELECT 1 FROM keryx_storage.identity)
  OR EXISTS(SELECT 1 FROM public.private_research_results)
  OR EXISTS(SELECT 1 FROM keryx_storage.private_research_result_identity)
 THEN RAISE EXCEPTION 'private result original requires fresh Source';END IF;
 SELECT prosrc INTO STRICT original_body FROM pg_proc WHERE oid='keryx_storage.write_fence()'::regprocedure;
 at:=strpos(original_body,E'\nBEGIN\n');
 IF at=0 OR strpos(original_body,'Private result Source identity fence v1')>0 THEN RAISE EXCEPTION 'private result fence constructor refused';END IF;
 extended_body:=overlay(original_body placing E'\nBEGIN\n'||$guard$
 -- Private result Source identity fence v1
 IF TG_TABLE_SCHEMA='keryx_storage' AND TG_TABLE_NAME='private_research_result_identity' THEN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'private result identity retained';END IF;
  IF NOT EXISTS(SELECT 1 FROM keryx_storage.identity i WHERE i.singleton AND i.identity_digest=NEW.identity_digest
    AND i.identity_digest=keryx_storage.identity_digest(i.identity))
   OR NOT EXISTS(SELECT 1 FROM public.private_research_results r
    JOIN public.private_research_intents i ON i.id=r.id
    JOIN public.private_research_executions e ON e.id=r.id
    JOIN public.private_research_payment_attempts p ON p.id=r.id
    CROSS JOIN LATERAL(SELECT keryx_storage.private_research_fields(i.data,'intent') data) source_intent
    WHERE r.id=NEW.id AND NEW.run_sha256=encode(sha256(convert_to(r.serialized_run,'UTF8')),'hex')
     AND NEW.intent_sha256=encode(sha256(convert_to(i.data,'UTF8')),'hex') AND NEW.owner=i.payer
     AND NEW.question_sha256=encode(sha256(convert_to(source_intent.data#>>'{submission,request,question}','UTF8')),'hex')
     AND NEW.creator_budget_micros=floor((source_intent.data#>>'{submission,request,budget}')::double precision*1000000+0.5)::bigint
     AND NEW.research_mode=source_intent.data#>>'{submission,request,researchMode}'
     AND NEW.saved_at=r.saved_at AND NEW.worker_id=e.worker_id AND NEW.execution_started_at=e.started_at
     AND NEW.payment_started_at=p.started_at AND NEW.payment_settled_at=p.settled_at
     AND NEW.payment_confirmation_sha256=encode(sha256(convert_to(p.confirmation,'UTF8')),'hex'))
  THEN RAISE EXCEPTION 'private result identity binding unavailable';END IF;
  -- Only Source-derived first inserts enter the held import lane. Every
  -- existing identity row remains immutable, including for the held owner.
  IF session_user='postgres' AND (SELECT mode FROM keryx_storage.control WHERE singleton)='held' THEN RETURN NEW;END IF;
  IF session_user<>'keryx_app' OR NOT EXISTS(SELECT 1 FROM keryx_storage.writer w
    JOIN keryx_storage.operations o ON o.operation=w.operation
    JOIN keryx_storage.identity i ON i.identity_digest=w.identity_digest
    WHERE w.transaction_id=txid_current() AND w.identity_digest=NEW.identity_digest
     AND w.operation='private_research_save_result' AND NOT o.read_only
     AND 'private_research_results'=ANY(o.relations) AND 'private_research_result_identity'=ANY(o.relations))
  THEN RAISE EXCEPTION 'private result fixed writer required';END IF;
  RETURN NEW;
 END IF;
$guard$ from at for 7);
 definition:=pg_get_functiondef('keryx_storage.write_fence()'::regprocedure);
 IF (length(definition)-length(replace(definition,original_body,'')))/length(original_body)<>1 THEN RAISE EXCEPTION 'private result fence definition refused';END IF;
 IF octet_length(replace(definition,original_body,extended_body))>32768
  OR octet_length(to_jsonb(replace(definition,original_body,extended_body))::text)>32768
 THEN RAISE EXCEPTION 'private result complete fence definition bound';END IF;
 EXECUTE replace(definition,original_body,extended_body);
 IF (SELECT prosrc FROM pg_proc WHERE oid='keryx_storage.write_fence()'::regprocedure) IS DISTINCT FROM extended_body
 THEN RAISE EXCEPTION 'private result fence preservation refused';END IF;
END;$private_result_source$;
RESET ROLE;
