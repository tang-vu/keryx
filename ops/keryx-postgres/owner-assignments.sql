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
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
RESET ROLE;
