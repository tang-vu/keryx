SET ROLE keryx_owner;
CREATE TABLE keryx_storage.acceptance_original_projection(
 order_id text PRIMARY KEY REFERENCES public.a2a_orders(id) ON DELETE CASCADE,
 store_id text NOT NULL CHECK(store_id ~* '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'),
 source_order_wire text NOT NULL CHECK(octet_length(source_order_wire)<=4000000),
 source_order_sha256 text NOT NULL CHECK(source_order_sha256 ~ '^[a-f0-9]{64}$'),
 delivery_token text NOT NULL CHECK(octet_length(delivery_token)<=4000000),
 owner text CHECK(owner ~ '^0x[a-f0-9]{40}$'),network text CHECK(network IN('eip155:5042','eip155:5042002')),
 binding jsonb CHECK(binding IS NULL OR jsonb_typeof(binding)='object' AND octet_length(binding::text)<=4096)
);
CREATE FUNCTION keryx_storage.acceptance_original_matches(wire text,live public.a2a_orders) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE expected jsonb;actual jsonb;field text;
BEGIN
 expected:=wire::jsonb;actual:=to_jsonb(live);
 IF jsonb_typeof(expected)<>'object' THEN RETURN false;END IF;
 FOREACH field IN ARRAY ARRAY['request_data','response_data','resolution_data','package_data'] LOOP
  IF jsonb_typeof(expected->field)='string' THEN expected:=jsonb_set(expected,ARRAY[field],(expected->>field)::jsonb);END IF;
 END LOOP;
 FOREACH field IN ARRAY ARRAY['created_at','updated_at','started_at','payment_started_at','result_saving_at'] LOOP
  IF jsonb_typeof(expected->field)='string' THEN expected:=jsonb_set(expected,ARRAY[field],to_jsonb(to_char((expected->>field)::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));END IF;
  IF jsonb_typeof(actual->field)='string' THEN actual:=jsonb_set(actual,ARRAY[field],to_jsonb(to_char((actual->>field)::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));END IF;
 END LOOP;
 RETURN expected=actual;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;$$;
CREATE FUNCTION keryx_storage.acceptance_projection_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT(session_user='postgres' AND (SELECT mode FROM keryx_storage.control WHERE singleton)='held') AND NOT EXISTS(
  SELECT 1 FROM keryx_storage.writer w JOIN keryx_storage.operations o ON o.operation=w.operation JOIN keryx_storage.identity i ON i.identity_digest=w.identity_digest
  WHERE w.transaction_id=txid_current() AND NOT o.read_only AND 'a2a_orders'=ANY(o.relations) AND 'acceptance_original_projection'=ANY(o.relations))
 THEN RAISE EXCEPTION 'native acceptance original writer required';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 IF NEW.source_order_sha256<>encode(sha256(convert_to(NEW.source_order_wire,'UTF8')),'hex') OR NOT EXISTS(
  SELECT 1 FROM public.a2a_orders a WHERE a.id=NEW.order_id AND keryx_storage.acceptance_original_matches(NEW.source_order_wire,a))
 THEN RAISE EXCEPTION 'native acceptance original binding refused';END IF;
 IF (NEW.source_order_wire::jsonb->'response_data') IS DISTINCT FROM NEW.delivery_token::jsonb THEN RAISE EXCEPTION 'native acceptance delivery token refused';END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER acceptance_original_projection_writer BEFORE INSERT OR UPDATE OR DELETE ON keryx_storage.acceptance_original_projection FOR EACH ROW EXECUTE FUNCTION keryx_storage.acceptance_projection_fence();
CREATE FUNCTION keryx_storage.acceptance_projection_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN DELETE FROM keryx_storage.acceptance_original_projection WHERE order_id=OLD.id;RETURN NEW;END;$$;
CREATE TRIGGER native_acceptance_projection_invalidate AFTER UPDATE ON public.a2a_orders FOR EACH ROW EXECUTE FUNCTION keryx_storage.acceptance_projection_invalidate();
UPDATE keryx_storage.operations SET relations=array_append(relations,'acceptance_original_projection') WHERE NOT read_only AND 'a2a_orders'=ANY(relations);
REVOKE ALL ON keryx_storage.acceptance_original_projection FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION keryx_storage.acceptance_original_matches(text,public.a2a_orders),keryx_storage.acceptance_projection_fence(),keryx_storage.acceptance_projection_invalidate() FROM PUBLIC,keryx_app,keryx_reader;
RESET ROLE;
