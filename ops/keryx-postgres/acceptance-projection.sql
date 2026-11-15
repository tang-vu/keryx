SET ROLE keryx_owner;
-- Permanent private Source cells. The disposable full-row derivative cannot
-- be the only copy of immutable JSON TEXT representation and key order.
CREATE TABLE keryx_storage.a2a_original_cell_projection(
 order_id text PRIMARY KEY REFERENCES public.a2a_orders(id) ON DELETE CASCADE,
 identity_digest text NOT NULL CHECK(identity_digest ~ '^[a-f0-9]{64}$'),
 query_id text NOT NULL,request_hash text NOT NULL,
 package_data_wire text CHECK(package_data_wire IS NULL OR octet_length(package_data_wire)<=4000000 AND package_data_wire IS JSON),
 request_data_wire text CHECK(request_data_wire IS NULL OR octet_length(request_data_wire)<=4000000 AND request_data_wire IS JSON)
);
-- Body-less Source time wires survive disposable full-original derivatives.
-- Native timestamptz columns retain instants; these TEXT cells retain exact
-- offsets and fractional precision for the unchanged Source predicates.
CREATE TABLE keryx_storage.a2a_original_time_projection(
 order_id text PRIMARY KEY REFERENCES public.a2a_orders(id) ON DELETE CASCADE,
 identity_digest text NOT NULL CHECK(identity_digest ~ '^[a-f0-9]{64}$'),
 query_id text NOT NULL,request_hash text NOT NULL,
 created_at text NOT NULL CHECK(octet_length(created_at) BETWEEN 1 AND 64),
 updated_at text NOT NULL CHECK(octet_length(updated_at) BETWEEN 1 AND 64),
 started_at text CHECK(octet_length(started_at) BETWEEN 1 AND 64),
 payment_started_at text CHECK(octet_length(payment_started_at) BETWEEN 1 AND 64),
 result_saving_at text CHECK(octet_length(result_saving_at) BETWEEN 1 AND 64)
);
CREATE TABLE keryx_storage.acceptance_original_projection(
 order_id text PRIMARY KEY REFERENCES public.a2a_orders(id) ON DELETE CASCADE,
 store_id text NOT NULL CHECK(store_id ~* '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'),
 source_order_wire text NOT NULL CHECK(octet_length(source_order_wire)<=4000000),
 source_order_sha256 text NOT NULL CHECK(source_order_sha256 ~ '^[a-f0-9]{64}$'),
 delivery_token text NOT NULL CHECK(octet_length(delivery_token)<=4000000),
 owner text CHECK(owner ~ '^0x[a-f0-9]{40}$'),network text CHECK(network IN('eip155:5042','eip155:5042002')),
  binding jsonb CHECK(binding IS NULL OR jsonb_typeof(binding)='object' AND octet_length(binding::text)<=4096),
  health_meta jsonb NOT NULL CHECK((jsonb_typeof(health_meta)='object' AND octet_length(health_meta::text)<=4096
   AND health_meta-'cohort'-'serviceReceiptBytes'-'resolutionBytes'='{}'::jsonb AND health_meta->>'cohort' IN('ordinary','recovered','unknown')
   AND jsonb_typeof(health_meta->'serviceReceiptBytes')='number' AND (health_meta->>'serviceReceiptBytes')::numeric BETWEEN 0 AND 4000000
   AND (health_meta->>'serviceReceiptBytes')::numeric=trunc((health_meta->>'serviceReceiptBytes')::numeric)
   AND jsonb_typeof(health_meta->'resolutionBytes')='number' AND (health_meta->>'resolutionBytes')::numeric BETWEEN 0 AND 4000000 AND (health_meta->>'resolutionBytes')::numeric=trunc((health_meta->>'resolutionBytes')::numeric)) IS TRUE)
);
CREATE FUNCTION keryx_storage.acceptance_original_matches(wire text,live public.a2a_orders) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE expected jsonb;actual jsonb;field text;e jsonb;a jsonb;
BEGIN
 expected:=wire::jsonb;
 -- Cast JSON cells to wire TEXT before building JSONB. PostgreSQL json can keep
 -- NUL/unpaired-surrogate escape bytes that its JSONB decoder cannot represent.
 SELECT to_jsonb(r) INTO actual FROM(SELECT live.id,live.query_id,live.authorization_id,live.request_hash,live.payer,live.payee,live.amount_usdc,live.creator_budget_usdc,live.service_fee_usdc,live.research_mode,live.package_data::text package_data,live.status,live.transaction_id,live.request_data::text request_data,live.started_at,live.worker_id,live.execution_journal_version,live.payment_started_at,live.result_saving_at,live.response_data::text response_data,live.error_code,live.resolution_data::text resolution_data,live.created_at,live.updated_at)r;
 IF jsonb_typeof(expected)<>'object' THEN RETURN false;END IF;
 FOREACH field IN ARRAY ARRAY['request_data','response_data','resolution_data','package_data'] LOOP
  BEGIN
   e:=CASE WHEN jsonb_typeof(expected->field)='string' THEN (expected->>field)::jsonb ELSE expected->field END;
   a:=CASE WHEN jsonb_typeof(actual->field)='string' THEN (actual->>field)::jsonb ELSE actual->field END;
   expected:=jsonb_set(expected,ARRAY[field],e);actual:=jsonb_set(actual,ARRAY[field],a);
  EXCEPTION WHEN OTHERS THEN NULL; -- Keep exact raw strings; never normalize unsupported Unicode.
  END;
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
  WHERE w.transaction_id=txid_current() AND NOT o.read_only AND 'a2a_orders'=ANY(o.relations) AND TG_TABLE_NAME=ANY(o.relations))
 THEN RAISE EXCEPTION 'native acceptance original writer required';END IF;
 IF TG_TABLE_NAME='a2a_original_cell_projection' THEN
  IF TG_OP='DELETE' THEN
   IF NOT(session_user='postgres' AND (SELECT mode FROM keryx_storage.control WHERE singleton)='held')
    AND EXISTS(SELECT 1 FROM public.a2a_orders WHERE id=OLD.order_id) THEN RAISE EXCEPTION 'native original cells retained';END IF;
   RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'native original cells retained';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.a2a_orders a JOIN keryx_storage.identity i ON i.singleton AND i.identity_digest=NEW.identity_digest
   WHERE a.id=NEW.order_id AND a.query_id=NEW.query_id AND a.request_hash=NEW.request_hash
    AND a.package_data IS NOT DISTINCT FROM NEW.package_data_wire::jsonb AND a.request_data IS NOT DISTINCT FROM NEW.request_data_wire::jsonb)
  THEN RAISE EXCEPTION 'native original cell binding refused';END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='a2a_original_time_projection' THEN
  IF TG_OP='DELETE' THEN
   IF NOT(session_user='postgres' AND (SELECT mode FROM keryx_storage.control WHERE singleton)='held')
    AND EXISTS(SELECT 1 FROM public.a2a_orders WHERE id=OLD.order_id) THEN RAISE EXCEPTION 'native original creation retained';END IF;
   RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND (NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.identity_digest IS DISTINCT FROM OLD.identity_digest
   OR NEW.query_id IS DISTINCT FROM OLD.query_id OR NEW.request_hash IS DISTINCT FROM OLD.request_hash OR NEW.created_at IS DISTINCT FROM OLD.created_at)
  THEN RAISE EXCEPTION 'native original creation retained';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.a2a_orders a JOIN keryx_storage.identity i ON i.singleton AND i.identity_digest=NEW.identity_digest
   WHERE a.id=NEW.order_id AND a.query_id=NEW.query_id AND a.request_hash=NEW.request_hash
    AND a.created_at IS NOT DISTINCT FROM NEW.created_at::timestamptz AND a.updated_at IS NOT DISTINCT FROM NEW.updated_at::timestamptz
    AND a.started_at IS NOT DISTINCT FROM NEW.started_at::timestamptz
    AND a.payment_started_at IS NOT DISTINCT FROM NEW.payment_started_at::timestamptz
    AND a.result_saving_at IS NOT DISTINCT FROM NEW.result_saving_at::timestamptz)
  THEN RAISE EXCEPTION 'native original time binding refused';END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 IF NEW.source_order_sha256<>encode(sha256(convert_to(NEW.source_order_wire,'UTF8')),'hex') OR NOT EXISTS(
  SELECT 1 FROM public.a2a_orders a WHERE a.id=NEW.order_id AND keryx_storage.acceptance_original_matches(NEW.source_order_wire,a))
 THEN RAISE EXCEPTION 'native acceptance original binding refused';END IF;
 IF (NEW.source_order_wire::jsonb->'response_data') IS DISTINCT FROM NEW.delivery_token::jsonb THEN RAISE EXCEPTION 'native acceptance delivery token refused';END IF;
 IF NOT EXISTS(SELECT 1 FROM keryx_storage.a2a_original_cell_projection c WHERE c.order_id=NEW.order_id
  AND c.package_data_wire IS NOT DISTINCT FROM (NEW.source_order_wire::json->>'package_data')
  AND c.request_data_wire IS NOT DISTINCT FROM (NEW.source_order_wire::json->>'request_data'))
 THEN RAISE EXCEPTION 'native acceptance exact Source cells required';END IF;
 IF EXISTS(SELECT 1 FROM keryx_storage.a2a_original_time_projection t WHERE t.order_id=NEW.order_id AND
  (t.created_at IS DISTINCT FROM (NEW.source_order_wire::json->>'created_at') OR t.updated_at IS DISTINCT FROM (NEW.source_order_wire::json->>'updated_at')
   OR t.started_at IS DISTINCT FROM (NEW.source_order_wire::json->>'started_at')
   OR t.payment_started_at IS DISTINCT FROM (NEW.source_order_wire::json->>'payment_started_at')
   OR t.result_saving_at IS DISTINCT FROM (NEW.source_order_wire::json->>'result_saving_at')))
 THEN RAISE EXCEPTION 'native acceptance exact Source time required';END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER a2a_original_cell_writer BEFORE INSERT OR UPDATE OR DELETE ON keryx_storage.a2a_original_cell_projection FOR EACH ROW EXECUTE FUNCTION keryx_storage.acceptance_projection_fence();
CREATE TRIGGER a2a_original_cell_no_truncate BEFORE TRUNCATE ON keryx_storage.a2a_original_cell_projection FOR EACH STATEMENT EXECUTE FUNCTION keryx_storage.immutable();
CREATE TRIGGER a2a_original_time_writer BEFORE INSERT OR UPDATE OR DELETE ON keryx_storage.a2a_original_time_projection FOR EACH ROW EXECUTE FUNCTION keryx_storage.acceptance_projection_fence();
CREATE TRIGGER a2a_original_time_no_truncate BEFORE TRUNCATE ON keryx_storage.a2a_original_time_projection FOR EACH STATEMENT EXECUTE FUNCTION keryx_storage.immutable();
CREATE TRIGGER acceptance_original_projection_writer BEFORE INSERT OR UPDATE OR DELETE ON keryx_storage.acceptance_original_projection FOR EACH ROW EXECUTE FUNCTION keryx_storage.acceptance_projection_fence();
CREATE FUNCTION keryx_storage.acceptance_projection_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN DELETE FROM keryx_storage.acceptance_original_projection WHERE order_id=OLD.id;RETURN NEW;END;$$;
CREATE TRIGGER native_acceptance_projection_invalidate AFTER UPDATE ON public.a2a_orders FOR EACH ROW EXECUTE FUNCTION keryx_storage.acceptance_projection_invalidate();
UPDATE keryx_storage.operations SET relations=array_append(array_append(array_append(relations,'acceptance_original_projection'),'a2a_original_time_projection'),'a2a_original_cell_projection') WHERE NOT read_only AND 'a2a_orders'=ANY(relations);
REVOKE ALL ON keryx_storage.acceptance_original_projection,keryx_storage.a2a_original_time_projection,keryx_storage.a2a_original_cell_projection FROM PUBLIC,anon,authenticated,service_role,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION keryx_storage.acceptance_original_matches(text,public.a2a_orders),keryx_storage.acceptance_projection_fence(),keryx_storage.acceptance_projection_invalidate() FROM PUBLIC,keryx_app,keryx_reader;
RESET ROLE;
