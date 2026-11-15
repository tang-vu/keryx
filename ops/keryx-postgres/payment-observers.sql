-- Fresh Source extension only: one existing read router, no new function,
-- table, helper, grant, scalar mode, lifetime row cap or writer capability.
SET ROLE keryx_owner;
DO $payment_observers$
DECLARE body text;definition text;extended text;anchor text;function_oid oid;
BEGIN
 IF (SELECT mode FROM keryx_storage.control WHERE singleton) IS DISTINCT FROM 'held'
  OR EXISTS(SELECT 1 FROM keryx_storage.identity) OR EXISTS(SELECT 1 FROM public.payment_events)
  OR EXISTS(SELECT 1 FROM keryx_storage.payment_event_originals)
 THEN RAISE EXCEPTION 'native payment observers require fresh Source';END IF;
 function_oid:='public.storage_application_read_group_8(jsonb,text,text,jsonb)'::regprocedure::oid;
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid=function_oid;
 anchor:=E'  CASE selected_action\n';
 IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 OR strpos(body,'Native raw payment observers v1')>0
 THEN RAISE EXCEPTION 'payment observer router constructor refused';END IF;
 extended:=replace(body,anchor,$read$
 -- Native raw payment observers v1
 IF selected_action='source_payment_observe' THEN
  PERFORM keryx_storage.require_operation(expected,digest,'payment_observer_read');
  DECLARE mode text;key_hex text;wanted bigint;start_at integer;r record;item jsonb;items jsonb[]:=ARRAY[]::jsonb[];counted integer:=0;bytes bigint:=512;identity_sha text;
  BEGIN
   IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(arguments) k) IS DISTINCT FROM ARRAY['keyWire','limit','mode','offset']::text[]
    OR jsonb_typeof(arguments->'mode') IS DISTINCT FROM 'string' OR arguments->>'mode' NOT IN('list','pending','query','creator','source','scan')
    OR jsonb_typeof(arguments->'offset') IS DISTINCT FROM 'number' OR arguments->>'offset' !~ '^[0-9]+$' OR (arguments->>'offset')::numeric>200000
   THEN RAISE EXCEPTION 'payment observer selector refused';END IF;
   mode:=arguments->>'mode';start_at:=(arguments->>'offset')::integer;identity_sha:=keryx_storage.identity_digest(expected);
   IF mode IN('query','creator','source') THEN
    IF jsonb_typeof(arguments->'keyWire') IS DISTINCT FROM 'string' OR octet_length(arguments->>'keyWire')>16384
     OR arguments->'limit' IS DISTINCT FROM 'null'::jsonb OR start_at<>0 THEN RAISE EXCEPTION 'payment observer key refused';END IF;
    key_hex:=keryx_storage.source_scalar_text(arguments->>'keyWire','scalar')->>'sourceHex';wanted:=1001;
   ELSE
    IF arguments->'keyWire' IS DISTINCT FROM 'null'::jsonb OR jsonb_typeof(arguments->'limit') IS DISTINCT FROM 'number'
     OR arguments->>'limit' !~ '^[0-9]+$' OR (arguments->>'limit')::numeric>9007199254740991 OR (mode<>'scan' AND start_at<>0)
    THEN RAISE EXCEPTION 'native payment LIMIT surface unsupported';END IF;
    wanted:=(arguments->>'limit')::bigint;
    IF mode='scan' AND(wanted<1 OR wanted>1000) THEN RAISE EXCEPTION 'payment raw scan bound';END IF;
    wanted:=least(wanted,1001);
   END IF;
   FOR r IN WITH candidates AS (
    SELECT p AS native_row,p.id AS selected_id,o.identity_digest,o.original_wire,o.original_sha256,o.current_wire,o.current_sha256,o.native_projection,
     CASE WHEN mode='scan' THEN NULL::bytea
      WHEN keryx_storage.source_scalar_text(o.current_wire::text,'tokens')->>'created_at'='null' THEN NULL::bytea
      ELSE decode(keryx_storage.source_scalar_text(keryx_storage.source_scalar_text(o.current_wire::text,'tokens')->>'created_at','scalar')->>'sourceHex','hex') END AS date_bytes
    FROM public.payment_events p LEFT JOIN keryx_storage.payment_event_originals o ON o.payment_id=p.id
    WHERE (mode='scan' OR p.authorization_phase IS NULL OR p.authorization_phase NOT IN('prepared','cancelled_unexposed'))
     AND CASE mode WHEN 'pending' THEN p.settlement_status='pending' AND p.settled=false AND p.authorization_id IS NOT NULL
      WHEN 'query' THEN encode(convert_to(p.query_id,'UTF8'),'hex')=key_hex AND p.kind='citation'
      WHEN 'creator' THEN encode(convert_to(p.query_id,'UTF8'),'hex')=key_hex AND p.kind<>'inbound'
      WHEN 'source' THEN encode(convert_to(p.source_id,'UTF8'),'hex')=key_hex AND p.kind<>'inbound'
      ELSE true END
   ) SELECT * FROM candidates c
    ORDER BY CASE WHEN mode IN('pending','query','creator') THEN c.date_bytes END ASC NULLS FIRST,
     CASE WHEN mode IN('list','source') THEN c.date_bytes END DESC NULLS LAST,convert_to(c.selected_id,'UTF8') ASC
    LIMIT wanted OFFSET start_at
   LOOP
    -- Source SQL specifies no equal-date tie order. id is a documented native
    -- refinement, never an adopted SQLite rowid or Article JS stable-sort claim.
    IF r.identity_digest IS DISTINCT FROM identity_sha OR r.original_wire IS NULL OR r.current_wire IS NULL
     OR r.original_sha256 IS DISTINCT FROM encode(sha256(convert_to(r.original_wire::text,'UTF8')),'hex')
     OR r.current_sha256 IS DISTINCT FROM encode(sha256(convert_to(r.current_wire::text,'UTF8')),'hex')
     OR r.native_projection IS DISTINCT FROM to_jsonb(r.native_row) OR octet_length(r.current_wire::text)>1048576
    THEN RAISE EXCEPTION 'payment observer Original or current projection unavailable';END IF;
    counted:=counted+1;IF counted>1000 THEN RAISE EXCEPTION 'payment complete collection row bound';END IF;
    item:=jsonb_build_object('id',r.selected_id,'identityDigest',r.identity_digest,'originalSha256',r.original_sha256,'currentSha256',r.current_sha256,'currentWire',r.current_wire::text);
    bytes:=bytes+octet_length(item::text)+2;IF bytes>4194000 THEN RAISE EXCEPTION 'payment complete collection byte bound';END IF;
    items:=array_append(items,item);
   END LOOP;
   result:=jsonb_build_object('format','keryx-payment-observations-v1','selector',arguments,'identityDigest',identity_sha,'rows',items);
   IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION 'payment complete collection byte bound';END IF;RETURN result;
  END;
 END IF;
$read$||anchor);
 definition:=pg_get_functiondef(function_oid);
 IF (length(definition)-length(replace(definition,body,'')))/length(body)<>1 THEN RAISE EXCEPTION 'payment observer definition refused';END IF;
 definition:=replace(definition,body,extended);
 IF octet_length(definition)>32768 OR octet_length(to_jsonb(definition)::text)>32768 THEN RAISE EXCEPTION 'payment observer complete quoted group bound';END IF;
 EXECUTE definition;
 IF 'public.storage_application_read_group_8(jsonb,text,text,jsonb)'::regprocedure::oid IS DISTINCT FROM function_oid OR (SELECT prosrc FROM pg_proc WHERE oid=function_oid) IS DISTINCT FROM extended
 THEN RAISE EXCEPTION 'payment observer existing router preservation refused';END IF;
 INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES('payment_observer_read',ARRAY['payment_events','payment_event_originals'],true,true);
END;$payment_observers$;
RESET ROLE;
