-- Fresh Source extension of ONE existing identity. Reservation metadata only;
-- no transfer/provider/signing/funder authority or legacy context issuer.
SET ROLE keryx_owner;
DO $onramp_source$
DECLARE original_body text;extended_body text;definition text;anchor text;function_oid oid;
BEGIN
 IF (SELECT mode FROM keryx_storage.control WHERE singleton) IS DISTINCT FROM 'held'
  OR EXISTS(SELECT 1 FROM keryx_storage.identity) OR EXISTS(SELECT 1 FROM public.sync_state)
 THEN RAISE EXCEPTION 'native onramp requires fresh empty Source';END IF;
 function_oid:='public.storage_application_operational_write(jsonb,text,text,jsonb)'::regprocedure::oid;
 SELECT prosrc INTO STRICT original_body FROM pg_proc WHERE oid=function_oid;
 anchor:=E'\n BEGIN\n';
 IF (length(original_body)-length(replace(original_body,anchor,'')))/length(anchor)<>1
  OR strpos(original_body,'Native Source onramp protocol v1')>0
 THEN RAISE EXCEPTION 'native onramp constructor refused';END IF;
 extended_body:=replace(original_body,anchor,$onramp_body$
 opr_capture jsonb;opr_effect jsonb;opr_frame jsonb;opr_address jsonb;opr_day jsonb;opr_row record;
 opr_address_hex text;opr_day_hex text;opr_wire text;opr_sha text;opr_action text;opr_kind text;opr_field text;
 opr_claimed boolean;opr_has_day boolean;opr_clock text;
 BEGIN
 -- Native Source onramp protocol v1
 IF op IN('onramp_frame','onramp_apply') THEN
  IF session_user<>'keryx_app' OR payload IS NULL OR jsonb_typeof(payload) IS DISTINCT FROM 'object'
   OR octet_length(payload::text)>65536
   OR (op='onramp_frame' AND current_setting('transaction_read_only')<>'on')
   OR (op='onramp_apply' AND current_setting('transaction_read_only')<>'off')
  THEN RAISE EXCEPTION 'native onramp request refused';END IF;
  IF op='onramp_frame' AND payload-'capture'<>'{}'::jsonb
   OR op='onramp_apply' AND payload-'capture'-'frameSha256'-'effect'<>'{}'::jsonb
  THEN RAISE EXCEPTION 'native onramp request fields refused';END IF;
  opr_capture:=payload->'capture';opr_action:=opr_capture->>'action';
  IF jsonb_typeof(opr_capture) IS DISTINCT FROM 'object'
   OR opr_capture-'action'-'addressKeyWire'-'dayKeyWire'-'amount'-'dailyCap'-'now'<>'{}'::jsonb
   OR (SELECT count(*) FROM jsonb_object_keys(opr_capture))<>6 OR opr_action IS NULL OR opr_action NOT IN('reserve','release')
   OR jsonb_typeof(opr_capture->'addressKeyWire') IS DISTINCT FROM 'string'
   OR jsonb_typeof(opr_capture->'dayKeyWire') IS DISTINCT FROM 'string'
   OR octet_length(opr_capture->>'addressKeyWire')>16384 OR octet_length(opr_capture->>'dayKeyWire')>16384
   OR jsonb_typeof(opr_capture->'amount') IS DISTINCT FROM 'string'
   OR (opr_action='reserve' AND(jsonb_typeof(opr_capture->'dailyCap') IS DISTINCT FROM 'string' OR jsonb_typeof(opr_capture->'now') IS DISTINCT FROM 'string'))
   OR (opr_action='release' AND(opr_capture->'dailyCap' IS DISTINCT FROM 'null'::jsonb OR opr_capture->'now' IS DISTINCT FROM 'null'::jsonb))
  THEN RAISE EXCEPTION 'native onramp capture refused';END IF;
  FOREACH opr_field IN ARRAY CASE WHEN opr_action='reserve' THEN ARRAY['amount','dailyCap','now'] ELSE ARRAY['amount'] END LOOP
   IF octet_length(opr_capture->>opr_field)>32 OR opr_capture->>opr_field !~ '^(NaN|-?Infinity|-?([0-9]+(\.[0-9]+)?|\.[0-9]+)(e[+-]?[0-9]+)?)$'
   THEN RAISE EXCEPTION 'native onramp numeric capture refused';END IF;
  END LOOP;
  PERFORM keryx_storage.require_operation(expected,digest,CASE WHEN op='onramp_frame' THEN 'source_onramp_frame' ELSE 'source_onramp_apply' END);
  -- Raw caller JSON string tokens are decoded by the existing scalar lexer.
  -- Source scalar binding replaces lone UTF-16 and retains NUL/BOM exactly.
  opr_address_hex:=keryx_storage.source_scalar_text(opr_capture->>'addressKeyWire','scalar')->>'sourceHex';
  opr_day_hex:=keryx_storage.source_scalar_text(opr_capture->>'dayKeyWire','scalar')->>'sourceHex';
  SELECT EXISTS(SELECT 1 FROM public.sync_state WHERE encode(convert_to(key,'UTF8'),'hex')=opr_address_hex) INTO opr_claimed;
  opr_address:=NULL;opr_day:=NULL;
  -- Source reserve's claimed-address branch reads neither the day value nor
  -- Date(now). Do not turn an unrelated retained value into an early failure.
  IF opr_action='release' OR NOT opr_claimed THEN
   SELECT jsonb_build_object('value',value,'updatedAt',updated_at) INTO opr_day FROM public.sync_state WHERE encode(convert_to(key,'UTF8'),'hex')=opr_day_hex;
   IF opr_action='release' THEN
    SELECT jsonb_build_object('value',value,'updatedAt',updated_at) INTO opr_address FROM public.sync_state WHERE encode(convert_to(key,'UTF8'),'hex')=opr_address_hex;
   END IF;
  END IF;
  opr_frame:=jsonb_build_object('format','source-onramp-frame-v1','identityDigest',keryx_storage.identity_digest(expected),'capture',opr_capture,
   'addressHex',opr_address_hex,'dayHex',opr_day_hex,'claimed',opr_claimed,'address',opr_address,'day',opr_day);
  opr_wire:=opr_frame::text;
  IF octet_length(opr_wire)>4190208 THEN RAISE EXCEPTION 'native onramp frame bound';END IF;
  opr_sha:=encode(sha256(convert_to(opr_wire,'UTF8')),'hex');
  IF op='onramp_frame' THEN
   opr_effect:=jsonb_build_object('wire',opr_wire,'sha256',opr_sha);
   IF octet_length(opr_effect::text)>4194304 THEN RAISE EXCEPTION 'native onramp encoded frame bound';END IF;
   RETURN opr_effect;
  END IF;
  -- Re-observe exact identity, keys, presence and raw TEXT under the exclusive
  -- data lock. A changed result ACKs NO business writes and permits bounded
  -- recomputation. Lost/unknown write acknowledgements must never retry.
  IF payload->>'frameSha256' IS DISTINCT FROM opr_sha THEN
   PERFORM keryx_storage.leave_operation();RETURN '{"status":"changed"}'::jsonb;
  END IF;
  opr_effect:=payload->'effect';
  IF jsonb_typeof(opr_effect) IS DISTINCT FROM 'object' OR opr_effect->>'action' IS DISTINCT FROM opr_action
   OR jsonb_typeof(opr_effect->'dayValue') IS DISTINCT FROM 'string' OR octet_length(opr_effect->>'dayValue')>32
   OR opr_effect->>'dayValue' !~ '^(NaN|-?Infinity|-?([0-9]+(\.[0-9]+)?|\.[0-9]+)(e[+-]?[0-9]+)?)$'
  THEN RAISE EXCEPTION 'native onramp effect refused';END IF;
  -- Number.parseFloat, IEEE754 arithmetic, comparison tolerance and String()
  -- are the reviewed immutable Node Source producer's work. This fixed writer
  -- binds that effect to its exact current frame; hashes are not funding proof.
  IF opr_action='reserve' THEN
   IF opr_claimed OR opr_effect-'action'-'addressValue'-'dayValue'-'updatedAt'<>'{}'::jsonb
    OR jsonb_typeof(opr_effect->'addressValue') IS DISTINCT FROM 'string'
    OR opr_effect->>'addressValue' IS DISTINCT FROM (CASE WHEN opr_capture->>'now'='-0' THEN '0' ELSE opr_capture->>'now' END)
    OR opr_capture->>'now' IN('NaN','Infinity','-Infinity') OR abs((opr_capture->>'now')::double precision)>8640000000000000
    OR jsonb_typeof(opr_effect->'updatedAt') IS DISTINCT FROM 'string' OR octet_length(opr_effect->>'updatedAt')>32
    OR opr_effect->>'updatedAt' !~ '^([0-9]{4}|[+-][0-9]{6})-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
   THEN RAISE EXCEPTION 'native onramp reserve effect refused';END IF;
   IF position(decode('00','hex') IN decode(opr_address_hex,'hex'))>0 OR position(decode('00','hex') IN decode(opr_day_hex,'hex'))>0
   THEN RAISE EXCEPTION 'native onramp key cannot be stored losslessly';END IF;
   INSERT INTO public.sync_state(key,value,updated_at) VALUES(convert_from(decode(opr_address_hex,'hex'),'UTF8'),opr_effect->>'addressValue',opr_effect->>'updatedAt');
   INSERT INTO public.sync_state(key,value,updated_at) VALUES(convert_from(decode(opr_day_hex,'hex'),'UTF8'),opr_effect->>'dayValue',opr_effect->>'updatedAt')
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
  ELSE
   IF opr_effect-'action'-'dayValue'-'dayExistsAfterDelete'<>'{}'::jsonb OR jsonb_typeof(opr_effect->'dayExistsAfterDelete') IS DISTINCT FROM 'boolean'
   THEN RAISE EXCEPTION 'native onramp release effect refused';END IF;
   DELETE FROM public.sync_state WHERE encode(convert_to(key,'UTF8'),'hex')=opr_address_hex;
   -- Match Source's read AFTER its DELETE, including normalized key aliases.
   SELECT EXISTS(SELECT 1 FROM public.sync_state WHERE encode(convert_to(key,'UTF8'),'hex')=opr_day_hex) INTO opr_has_day;
   IF (opr_effect->>'dayExistsAfterDelete')::boolean IS DISTINCT FROM opr_has_day THEN RAISE EXCEPTION 'native onramp release presence changed';END IF;
   opr_clock:=to_char(date_trunc('milliseconds',clock_timestamp()) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
   UPDATE public.sync_state SET value=opr_effect->>'dayValue',updated_at=opr_clock WHERE encode(convert_to(key,'UTF8'),'hex')=opr_day_hex;
  END IF;
  PERFORM keryx_storage.leave_operation();RETURN '{"status":"applied"}'::jsonb;
 END IF;
$onramp_body$);
 definition:=pg_get_functiondef(function_oid);
 IF (length(definition)-length(replace(definition,original_body,'')))/length(original_body)<>1 THEN RAISE EXCEPTION 'native onramp definition refused';END IF;
 definition:=replace(definition,original_body,extended_body);
 IF octet_length(definition)>32768 THEN RAISE EXCEPTION 'native onramp complete group bound';END IF;
 EXECUTE definition;
 IF 'public.storage_application_operational_write(jsonb,text,text,jsonb)'::regprocedure::oid IS DISTINCT FROM function_oid
  OR (SELECT prosrc FROM pg_proc WHERE oid=function_oid) IS DISTINCT FROM extended_body
 THEN RAISE EXCEPTION 'native onramp Source preservation refused';END IF;
 INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
  ('source_onramp_frame',ARRAY['sync_state'],true,true),('source_onramp_apply',ARRAY['sync_state'],true,false);
END;$onramp_source$;
RESET ROLE;
