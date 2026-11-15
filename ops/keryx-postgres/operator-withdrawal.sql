-- Fresh Source extension of existing fixed routers/trigger identities only.
-- Withdrawal reports are not transfer attestations or spending authority.
SET ROLE keryx_owner;
DO $$BEGIN
 IF (SELECT mode FROM keryx_storage.control WHERE singleton) IS DISTINCT FROM 'held'
  OR EXISTS(SELECT 1 FROM keryx_storage.identity) OR EXISTS(SELECT 1 FROM public.withdrawals)
 THEN RAISE EXCEPTION 'operator withdrawal requires fresh Source';END IF;
END;$$;
-- Actual Source stores clocks as scalar TEXT. No retained conversion/backfill.
ALTER TABLE public.withdrawals ALTER COLUMN created_at DROP DEFAULT;
ALTER TABLE public.withdrawals ALTER COLUMN created_at TYPE text USING NULL::text;
ALTER TABLE public.withdrawals ALTER COLUMN created_at DROP NOT NULL;
CREATE TABLE keryx_storage.withdrawal_source_originals(
 tx_hash text PRIMARY KEY REFERENCES public.withdrawals(tx_hash) DEFERRABLE INITIALLY DEFERRED,
 identity_digest text NOT NULL CHECK(identity_digest ~ '^[a-f0-9]{64}$'),
 original text NOT NULL CHECK(octet_length(original)<=30000),
 original_sha256 text NOT NULL CHECK(original_sha256=encode(sha256(convert_to(original,'UTF8')),'hex')),
 cells jsonb NOT NULL CHECK(jsonb_typeof(cells)='object' AND cells=original::jsonb),
 native_projection jsonb NOT NULL CHECK(jsonb_typeof(native_projection)='object'),
 unprojected_fields text[] NOT NULL CHECK(cardinality(unprojected_fields)<=4)
);
REVOKE ALL ON keryx_storage.withdrawal_source_originals FROM PUBLIC,keryx_app,keryx_reader;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('record_withdrawal',ARRAY['withdrawals','withdrawal_source_originals'],true,false),
 ('operator_source_inventory',ARRAY['a2a_orders','a2a_original_time_projection','a2a_original_cell_projection','research_monthly','research_monthly_redemptions'],true,true),
 ('operator_source_public',ARRAY['a2a_orders','a2a_original_time_projection','acceptance_original_projection','sources'],false,true);
DO $build$
DECLARE body text;definition text;extended text;anchor text;insert_at integer;
BEGIN
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='keryx_storage.write_fence()'::regprocedure;
 insert_at:=strpos(body,E'\nBEGIN\n');
 IF insert_at=0 OR strpos(body,'Source withdrawal original fence v1')>0 THEN RAISE EXCEPTION 'withdrawal fence constructor refused';END IF;
 extended:=overlay(body placing E'\nBEGIN\n'||$fence$
 -- Source withdrawal original fence v1
 IF TG_WHEN='AFTER' AND TG_NAME='native_withdrawal_coherence' THEN
  IF NOT(session_user='postgres' AND (SELECT mode FROM keryx_storage.control WHERE singleton)='held') AND(
   EXISTS(SELECT 1 FROM public.withdrawals w LEFT JOIN keryx_storage.withdrawal_source_originals r ON r.tx_hash=w.tx_hash
    WHERE r.tx_hash IS NULL OR r.identity_digest IS DISTINCT FROM (SELECT identity_digest FROM keryx_storage.identity WHERE singleton)
     OR r.native_projection IS DISTINCT FROM to_jsonb(w))
   OR EXISTS(SELECT 1 FROM keryx_storage.withdrawal_source_originals r LEFT JOIN public.withdrawals w ON w.tx_hash=r.tx_hash WHERE w.tx_hash IS NULL))
  THEN RAISE EXCEPTION 'withdrawal Source report not committed atomically';END IF;
  IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
 END IF;
 IF TG_TABLE_SCHEMA='keryx_storage' AND TG_TABLE_NAME='withdrawal_source_originals' THEN
  IF TG_OP='DELETE' THEN
   IF session_user='postgres' AND (SELECT mode FROM keryx_storage.control WHERE singleton)='held'
    AND NOT EXISTS(SELECT 1 FROM public.withdrawals WHERE tx_hash=OLD.tx_hash) THEN RETURN OLD;END IF;
   RAISE EXCEPTION 'withdrawal Source original retained';
  END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'withdrawal Source original immutable';END IF;
  IF NOT EXISTS(SELECT 1 FROM keryx_storage.identity WHERE singleton AND identity_digest=NEW.identity_digest)
   OR NEW.cells IS DISTINCT FROM NEW.original::jsonb OR NEW.cells->>'tx_hash' IS DISTINCT FROM NEW.tx_hash
   OR NEW.original_sha256 IS DISTINCT FROM encode(sha256(convert_to(NEW.original,'UTF8')),'hex')
   OR NOT EXISTS(SELECT 1 FROM public.withdrawals w WHERE w.tx_hash=NEW.tx_hash AND to_jsonb(w)=NEW.native_projection)
  THEN RAISE EXCEPTION 'withdrawal Source original identity or projection refused';END IF;
  -- The raw cells must independently match the observed physical row, also at
  -- held intake. A correct SHA/projection supplied alongside unrelated cells
  -- is not original authority. NULL and unprojected non-NULL remain distinct.
  IF NEW.cells-'tx_hash'-'created_at'-'label'-'source_name'-'wallet'-'recipient'-'amount_usdc'-'network'<>'{}'::jsonb
   OR (jsonb_typeof(NEW.cells->'tx_hash')='string' AND NEW.cells->>'tx_hash' ~ '^0x[a-fA-F0-9]{64}$'
    AND jsonb_typeof(NEW.cells->'wallet')='string' AND NEW.cells->>'wallet' ~ '^0x[a-fA-F0-9]{40}$'
    AND jsonb_typeof(NEW.cells->'recipient')='string' AND NEW.cells->>'recipient' ~ '^0x[a-fA-F0-9]{40}$'
    AND jsonb_typeof(NEW.cells->'amount_usdc')='number' AND (NEW.cells->>'amount_usdc')::double precision>0
    AND (NEW.cells->>'amount_usdc')::double precision<'Infinity'::double precision) IS NOT TRUE
   OR NEW.cells->>'wallet' IS DISTINCT FROM NEW.native_projection->>'wallet'
   OR NEW.cells->>'recipient' IS DISTINCT FROM NEW.native_projection->>'recipient'
   OR ((NEW.cells->>'amount_usdc')::double precision=(NEW.native_projection->>'amount_usdc')::double precision) IS NOT TRUE
   OR NEW.cells->>'network' IS DISTINCT FROM encode(convert_to((SELECT identity->>'network' FROM keryx_storage.identity WHERE singleton),'UTF8'),'hex')
   OR cardinality(NEW.unprojected_fields)<>(SELECT count(DISTINCT f) FROM unnest(NEW.unprojected_fields) f)
   OR EXISTS(SELECT 1 FROM unnest(NEW.unprojected_fields) f WHERE f NOT IN('created_at','label','source_name','network'))
   OR EXISTS(SELECT 1 FROM unnest(ARRAY['created_at','label','source_name','network']) f WHERE
    CASE WHEN NOT NEW.cells?f THEN true
     WHEN NEW.cells->f='null'::jsonb THEN NEW.native_projection->f IS DISTINCT FROM 'null'::jsonb OR f=ANY(NEW.unprojected_fields)
     WHEN jsonb_typeof(NEW.cells->f)<>'string' OR (NEW.cells->>f) !~ '^([a-f0-9]{2})*$' THEN true
     WHEN position(decode('00','hex') IN decode(NEW.cells->>f,'hex'))>0 THEN
      NEW.native_projection->f IS DISTINCT FROM 'null'::jsonb OR NOT f=ANY(NEW.unprojected_fields)
     ELSE encode(convert_to(NEW.native_projection->>f,'UTF8'),'hex') IS DISTINCT FROM NEW.cells->>f OR f=ANY(NEW.unprojected_fields) END)
  THEN RAISE EXCEPTION 'withdrawal Source raw scalar binding refused';END IF;
  -- Held intake uses observed Source cells, never a shadow-derived invention.
  IF session_user='postgres' AND (SELECT mode FROM keryx_storage.control WHERE singleton)='held' THEN RETURN NEW;END IF;
  IF session_user<>'keryx_app' OR NOT EXISTS(SELECT 1 FROM keryx_storage.writer w JOIN keryx_storage.operations o USING(operation)
   WHERE w.transaction_id=txid_current() AND w.identity_digest=NEW.identity_digest AND NOT o.read_only
    AND 'withdrawals'=ANY(o.relations) AND 'withdrawal_source_originals'=ANY(o.relations))
  THEN RAISE EXCEPTION 'withdrawal Source writer required';END IF;
  RETURN NEW;
 END IF;
$fence$ from insert_at for 7);
 definition:=pg_get_functiondef('keryx_storage.write_fence()'::regprocedure);
 IF octet_length(replace(definition,body,extended))>32768 OR octet_length(to_jsonb(replace(definition,body,extended))::text)>32768 THEN RAISE EXCEPTION 'withdrawal fence definition bound';END IF;
 EXECUTE replace(definition,body,extended);

 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='keryx_storage.require_operation(jsonb,text,text)'::regprocedure;
 anchor:=E' IF policy.read_only THEN PERFORM pg_advisory_xact_lock_shared(634781904177022::bigint);\n ELSE PERFORM pg_advisory_xact_lock(634781904177022::bigint); END IF;';
 IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'withdrawal observation constructor refused';END IF;
 extended:=replace(body,anchor,anchor||$guard$
 -- Source withdrawal observation guard v1; after data lock, before writer.
 IF selected IN('record_withdrawal','list_withdrawals','record_supabase_withdrawal_2','settlement_ledger_2','native_runtime_authority') THEN
  IF EXISTS(SELECT 1 FROM public.withdrawals w LEFT JOIN keryx_storage.withdrawal_source_originals r ON r.tx_hash=w.tx_hash
    WHERE r.tx_hash IS NULL OR r.identity_digest IS DISTINCT FROM stored.identity_digest OR r.native_projection IS DISTINCT FROM to_jsonb(w))
   OR EXISTS(SELECT 1 FROM keryx_storage.withdrawal_source_originals r LEFT JOIN public.withdrawals w ON w.tx_hash=r.tx_hash WHERE w.tx_hash IS NULL)
  THEN RAISE EXCEPTION 'withdrawal Source original coverage unavailable';END IF;
  IF selected IN('list_withdrawals','record_supabase_withdrawal_2','settlement_ledger_2')
   AND EXISTS(SELECT 1 FROM keryx_storage.withdrawal_source_originals WHERE cardinality(unprojected_fields)>0)
  THEN RAISE EXCEPTION 'withdrawal Source original unavailable to legacy observer';END IF;
 END IF;
$guard$);
 definition:=pg_get_functiondef('keryx_storage.require_operation(jsonb,text,text)'::regprocedure);
 IF octet_length(replace(definition,body,extended))>32768 OR octet_length(to_jsonb(replace(definition,body,extended))::text)>32768 THEN RAISE EXCEPTION 'withdrawal observation definition bound';END IF;
 EXECUTE replace(definition,body,extended);

 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='public.storage_application_operational_write(jsonb,text,text,jsonb)'::regprocedure;
 IF (length(body)-length(replace(body,'CASE op','')))/length('CASE op')<>1 THEN RAISE EXCEPTION 'withdrawal write router constructor refused';END IF;
 extended:=replace(body,'CASE op',$write$
 CASE op WHEN 'record_withdrawal' THEN
  PERFORM keryx_storage.require_operation(expected,digest,'record_withdrawal');
  DECLARE c jsonb;original_wire text;field text;encoded text;decoded bytea;shadow text;part_start integer;i integer;network_scalar jsonb;readback boolean:=true;
   shadows jsonb:='{}'::jsonb;unprojected text[]:=ARRAY[]::text[];saved public.withdrawals;retained keryx_storage.withdrawal_source_originals;
  BEGIN
   IF (payload-'cells'-'original'-'sha256'-'networkToken'='{}'::jsonb AND jsonb_typeof(payload->'cells')='object'
    AND jsonb_typeof(payload->'original')='string' AND jsonb_typeof(payload->'sha256')='string' AND jsonb_typeof(payload->'networkToken')='string') IS NOT TRUE
   THEN RAISE EXCEPTION 'withdrawal Source packet refused';END IF;
   c:=payload->'cells';original_wire:=payload->>'original';
   IF octet_length(original_wire)>30000 OR original_wire::jsonb IS DISTINCT FROM c
    OR payload->>'sha256' IS DISTINCT FROM encode(sha256(convert_to(original_wire,'UTF8')),'hex')
    OR (c-'tx_hash'-'created_at'-'label'-'source_name'-'wallet'-'recipient'-'amount_usdc'-'network'<>'{}'::jsonb)
    OR c->>'network' IS DISTINCT FROM encode(convert_to(expected->>'network','UTF8'),'hex')
    OR (c->>'tx_hash' ~ '^0x[a-fA-F0-9]{64}$' AND c->>'wallet' ~ '^0x[a-fA-F0-9]{40}$' AND c->>'recipient' ~ '^0x[a-fA-F0-9]{40}$'
     AND jsonb_typeof(c->'amount_usdc')='number' AND (c->>'amount_usdc')::numeric>0 AND (c->>'amount_usdc')::double precision<'Infinity'::double precision) IS NOT TRUE
   THEN RAISE EXCEPTION 'withdrawal Source identity refused';END IF;
   network_scalar:=keryx_storage.source_scalar_text(payload->>'networkToken','scalar');
   IF network_scalar->>'sourceHex' IS DISTINCT FROM c->>'network' THEN RAISE EXCEPTION 'withdrawal original network binding refused';END IF;
   readback:=(network_scalar->>'jsonHex') IS NOT DISTINCT FROM (network_scalar->>'sourceHex');
   FOREACH field IN ARRAY ARRAY['created_at','label','source_name','network'] LOOP
    IF NOT c?field OR (field<>'source_name' AND jsonb_typeof(c->field)<>'string')
     OR (field='source_name' AND jsonb_typeof(c->field) NOT IN('string','null')) THEN RAISE EXCEPTION 'withdrawal Source scalar kind refused';END IF;
    IF c->field='null'::jsonb THEN shadow:=NULL;
    ELSE
     encoded:=c->>field;IF length(encoded)%2<>0 OR encoded !~ '^([a-f0-9]{2})*$' THEN RAISE EXCEPTION 'withdrawal Source scalar encoding refused';END IF;
     decoded:=decode(encoded,'hex');part_start:=0;
     IF length(decoded)>0 THEN FOR i IN 0..length(decoded)-1 LOOP IF get_byte(decoded,i)=0 THEN
      PERFORM convert_from(substring(decoded FROM part_start+1 FOR i-part_start),'UTF8');part_start:=i+1;
     END IF;END LOOP;END IF;
     PERFORM convert_from(substring(decoded FROM part_start+1),'UTF8');
     IF position(decode('00','hex') IN decoded)>0 THEN shadow:=NULL;unprojected:=array_append(unprojected,field);
     ELSE shadow:=convert_from(decoded,'UTF8');END IF;
    END IF;
    shadows:=shadows||jsonb_build_object(field,shadow);
   END LOOP;
   IF c->>'network'='' OR shadows->>'created_at' IS NULL OR shadows->>'created_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
   THEN RAISE EXCEPTION 'withdrawal Source clock representation refused';END IF;
   PERFORM (shadows->>'created_at')::timestamptz;
   SELECT * INTO saved FROM public.withdrawals WHERE tx_hash=c->>'tx_hash';
   IF FOUND THEN
    SELECT * INTO STRICT retained FROM keryx_storage.withdrawal_source_originals WHERE tx_hash=saved.tx_hash;
    IF translate(saved.wallet,'ABCDEF','abcdef') IS DISTINCT FROM translate(c->>'wallet','ABCDEF','abcdef')
     OR translate(saved.recipient,'ABCDEF','abcdef') IS DISTINCT FROM translate(c->>'recipient','ABCDEF','abcdef')
     OR saved.amount_usdc::double precision IS DISTINCT FROM (c->>'amount_usdc')::double precision
     OR retained.cells->>'network' IS DISTINCT FROM c->>'network'
    THEN readback:=false;END IF;
   ELSE
    INSERT INTO public.withdrawals(tx_hash,created_at,label,source_name,wallet,recipient,amount_usdc,network)
     VALUES(c->>'tx_hash',shadows->>'created_at',shadows->>'label',shadows->>'source_name',c->>'wallet',c->>'recipient',(c->>'amount_usdc')::double precision,shadows->>'network') RETURNING * INTO saved;
    INSERT INTO keryx_storage.withdrawal_source_originals VALUES(saved.tx_hash,keryx_storage.identity_digest(expected),original_wire,payload->>'sha256',c,to_jsonb(saved),unprojected);
   END IF;
   PERFORM keryx_storage.leave_operation();RETURN to_jsonb(readback);
  END;
$write$);
 definition:=pg_get_functiondef('public.storage_application_operational_write(jsonb,text,text,jsonb)'::regprocedure);
 IF octet_length(replace(definition,body,extended))>32768 OR octet_length(to_jsonb(replace(definition,body,extended))::text)>32768 THEN RAISE EXCEPTION 'withdrawal router expanded definition bound';END IF;
 EXECUTE replace(definition,body,extended);

 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='public.storage_application_read_group_8(jsonb,text,text,jsonb)'::regprocedure;
 IF (length(body)-length(replace(body,'CASE selected_action','')))/length('CASE selected_action')<>1 THEN RAISE EXCEPTION 'operator read router constructor refused';END IF;
 extended:=replace(body,'CASE selected_action',$read$
 CASE selected_action WHEN 'operator_source_inventory' THEN
  IF arguments<>'{}'::jsonb THEN RAISE EXCEPTION 'operator inventory arguments refused';END IF;
  PERFORM keryx_storage.require_operation(expected,digest,'operator_source_inventory');
  DECLARE orders jsonb[]:=ARRAY[]::jsonb[];monthly jsonb[]:=ARRAY[]::jsonb[];r record;item jsonb;counted integer:=0;bytes bigint:=100;
  BEGIN
   IF (SELECT count(*) FROM public.a2a_orders WHERE status='running')+(SELECT count(*) FROM public.research_monthly)>1000
   THEN RAISE EXCEPTION 'operator complete inventory rows';END IF;
   -- Exact observed scalar headers and immutable raw request only. Response,
   -- package and delivery originals are not selected/hydrated for inventory.
   FOR r IN SELECT a.id,a.query_id,a.request_hash,a.payee,a.creator_budget_usdc,a.transaction_id,a.request_data,a.started_at,
    t.identity_digest time_identity,t.query_id time_query,t.request_hash time_hash,t.started_at source_started,
    c.identity_digest cell_identity,c.query_id cell_query,c.request_hash cell_hash,c.request_data_wire FROM public.a2a_orders a
    LEFT JOIN keryx_storage.a2a_original_time_projection t ON t.order_id=a.id
    LEFT JOIN keryx_storage.a2a_original_cell_projection c ON c.order_id=a.id
    WHERE a.status='running' ORDER BY a.id COLLATE "C" LIMIT 1001 LOOP
    counted:=counted+1;
    IF counted>1000 OR r.time_identity IS DISTINCT FROM keryx_storage.identity_digest(expected)
     OR r.cell_identity IS DISTINCT FROM r.time_identity OR r.time_query IS DISTINCT FROM r.query_id OR r.cell_query IS DISTINCT FROM r.query_id
     OR r.time_hash IS DISTINCT FROM r.request_hash OR r.cell_hash IS DISTINCT FROM r.request_hash
     OR r.source_started::timestamptz IS DISTINCT FROM r.started_at OR r.request_data_wire::jsonb IS DISTINCT FROM r.request_data::jsonb
    THEN RAISE EXCEPTION 'operator complete Source order snapshot unavailable';END IF;
    item:=jsonb_build_object('payee',r.payee,'budget',r.creator_budget_usdc,'started',r.source_started,'transaction',r.transaction_id,'request',r.request_data_wire);
    bytes:=bytes+octet_length(item::text)+2;IF bytes>4194000 THEN RAISE EXCEPTION 'operator complete inventory bytes';END IF;orders:=array_append(orders,item);
   END LOOP;
   FOR r IN SELECT m.data,(SELECT count(*) FROM public.research_monthly_redemptions d WHERE d.monthly_id=m.id) used FROM public.research_monthly m ORDER BY m.id COLLATE "C" LIMIT 1001 LOOP
    counted:=counted+1;IF counted>1000 THEN RAISE EXCEPTION 'operator complete inventory rows';END IF;
    item:=jsonb_build_object('wire',r.data,'used',r.used);bytes:=bytes+octet_length(item::text)+2;
    IF bytes>4194000 THEN RAISE EXCEPTION 'operator complete inventory bytes';END IF;monthly:=array_append(monthly,item);
   END LOOP;
   result:=jsonb_build_object('format','keryx-source-operator-inventory-v1','orders',orders,'monthly',monthly);
   IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION 'operator complete result bytes';END IF;RETURN result;
  END;
 WHEN 'operator_source_public' THEN
  IF arguments-'since'<>'{}'::jsonb OR jsonb_typeof(arguments->'since') IS DISTINCT FROM 'string'
   OR length(arguments->>'since')>32 OR arguments->>'since' !~ '^([0-9]{4}|[+-][0-9]{6})-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  THEN RAISE EXCEPTION 'operator public arguments refused';END IF;
  PERFORM keryx_storage.require_operation(expected,digest,'operator_source_public');
  DECLARE rows jsonb[]:=ARRAY[]::jsonb[];r record;item jsonb;counted integer:=0;bytes bigint:=100;
  BEGIN
   -- Missing time metadata cannot decide that a row is outside the Source TEXT
   -- window. Validate coverage/binding before applying that exact predicate.
   IF EXISTS(SELECT 1 FROM public.a2a_orders a LEFT JOIN keryx_storage.a2a_original_time_projection t ON t.order_id=a.id
    WHERE t.order_id IS NULL OR t.identity_digest IS DISTINCT FROM keryx_storage.identity_digest(expected)
     OR t.query_id IS DISTINCT FROM a.query_id OR t.request_hash IS DISTINCT FROM a.request_hash
     OR t.created_at::timestamptz IS DISTINCT FROM a.created_at OR t.updated_at::timestamptz IS DISTINCT FROM a.updated_at
     OR t.started_at::timestamptz IS DISTINCT FROM a.started_at)
   THEN RAISE EXCEPTION 'operator public Source time unavailable';END IF;
   FOR r IN SELECT a.status,t.created_at,t.updated_at,t.started_at,p.health_meta,octet_length(a.package_data::text) package_bytes
    FROM public.a2a_orders a JOIN keryx_storage.a2a_original_time_projection t ON t.order_id=a.id
    LEFT JOIN keryx_storage.acceptance_original_projection p ON p.order_id=a.id
    WHERE a.status='running' OR t.updated_at COLLATE "C">=(arguments->>'since') COLLATE "C" ORDER BY a.id COLLATE "C" LIMIT 1001 LOOP
    counted:=counted+1;
    IF counted>1000 OR coalesce(r.package_bytes,0)>65536 OR coalesce((r.health_meta->>'serviceReceiptBytes')::bigint,0)>16384
     OR coalesce((r.health_meta->>'resolutionBytes')::bigint,0)>32768 OR (r.status='completed' AND r.health_meta IS NULL)
    THEN RAISE EXCEPTION 'operator public complete Source markers bound';END IF;
    item:=jsonb_build_object('status',r.status,'createdAt',r.created_at,'updatedAt',r.updated_at,'startedAt',r.started_at,
     'completionCohort',CASE WHEN r.status='completed' THEN r.health_meta->>'cohort' ELSE 'unknown' END);
    bytes:=bytes+octet_length(item::text)+2;IF bytes>4194000 THEN RAISE EXCEPTION 'operator public complete result bytes';END IF;rows:=array_append(rows,item);
   END LOOP;
   result:=jsonb_build_object('format','keryx-source-operator-public-v1','rows',rows,'registered',(SELECT count(*) FROM public.sources WHERE active=true));
   IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION 'operator public complete result bytes';END IF;RETURN result;
  END;
$read$);
 definition:=pg_get_functiondef('public.storage_application_read_group_8(jsonb,text,text,jsonb)'::regprocedure);
 IF octet_length(replace(definition,body,extended))>32768 OR octet_length(to_jsonb(replace(definition,body,extended))::text)>32768 THEN RAISE EXCEPTION 'operator expanded definition bound';END IF;
 EXECUTE replace(definition,body,extended);
END;$build$;
CREATE TRIGGER native_withdrawal_source_writer BEFORE INSERT OR UPDATE OR DELETE ON keryx_storage.withdrawal_source_originals FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence();
CREATE TRIGGER native_withdrawal_source_retained BEFORE TRUNCATE ON keryx_storage.withdrawal_source_originals FOR EACH STATEMENT EXECUTE FUNCTION keryx_storage.immutable();
CREATE CONSTRAINT TRIGGER native_withdrawal_coherence AFTER INSERT OR UPDATE OR DELETE ON keryx_storage.withdrawal_source_originals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence();
CREATE CONSTRAINT TRIGGER native_withdrawal_coherence AFTER INSERT OR UPDATE OR DELETE ON public.withdrawals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence();
RESET ROLE;
