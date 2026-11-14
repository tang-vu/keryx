-- Closed Source-aware ledger metadata only. These originals never authenticate
-- Circle/provider evidence or admit a complete application writer.
SET ROLE keryx_owner;
-- SQLite accepts arbitrary TEXT timestamps. An unprojected date is NULL in the
-- native projection and its exact raw original holds every dependent operation.
ALTER TABLE public.payment_events ALTER COLUMN created_at DROP NOT NULL;
CREATE TABLE keryx_storage.payment_event_originals(
 payment_id text PRIMARY KEY REFERENCES public.payment_events(id) ON DELETE CASCADE,
 original_wire json NOT NULL,original_sha256 text NOT NULL,
 current_wire json NOT NULL,current_sha256 text NOT NULL,native_projection jsonb NOT NULL,
 unprojected_fields text[] NOT NULL CHECK(cardinality(unprojected_fields)<=15),
 CHECK(original_sha256=encode(sha256(convert_to(original_wire::text,'UTF8')),'hex')),
 CHECK(current_sha256=encode(sha256(convert_to(current_wire::text,'UTF8')),'hex')),
 CHECK(jsonb_typeof(native_projection)='object' AND native_projection->>'id'=payment_id)
);
CREATE INDEX payment_event_unprojected ON keryx_storage.payment_event_originals((true)) WHERE cardinality(unprojected_fields)>0;
REVOKE ALL ON keryx_storage.payment_event_originals FROM PUBLIC,keryx_app,keryx_reader;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('payment_event_record',ARRAY['payment_events','payment_event_originals'],true,false),
 ('payment_event_record_once',ARRAY['payment_events','payment_event_originals'],true,false),
 ('payment_event_snapshot',ARRAY['payment_events','payment_event_originals','hosted_treasury_authorizations','browser_authorization_intents','browser_journal_bindings','browser_journal_control'],true,true),
 ('payment_event_terminal',ARRAY['payment_events','payment_event_originals','hosted_treasury_authorizations','browser_authorization_intents','browser_journal_bindings','browser_journal_control','browser_journal_writer','browser_retained_grants','browser_signer_capacity','session_grants'],true,false);
CREATE FUNCTION public.storage_payment_events(expected jsonb,digest text,action text,packet_wire text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE packet jsonb;selected jsonb;snapshot jsonb;captured jsonb;payload jsonb;projection jsonb;before_json json;after_json json;original_json json;private_job json;before_tokens jsonb;after_tokens jsonb;original_tokens jsonb;context_tokens jsonb;scalar jsonb;raw_token text;
 current_row public.payment_events;after_row public.payment_events;raw_row keryx_storage.payment_event_originals;
 has_payment boolean;active boolean;failed boolean;is_private boolean;hosted jsonb;browser jsonb;operation text;dispatch text;
 before_wire text;wire text;wire_sha text;field text;fields text[]:=ARRAY['id','created_at','kind','query_id','source_id','source_name','payer','payee','amount_usdc','weight','rationale','tx_hash','network','settled','settlement_status','authorization_id','authorization_expires_at','grant_epoch','origin','item_id','item_title','item_url','content_version','item_published_at','offer_id','list_price_usdc','authorization_phase'];
 unprojected text[];key_count integer;distinct_count integer;changed bigint;resolved boolean:=false;released boolean:=false;release_kind text;release_signer text;release_epoch text;amount double precision;scaled double precision;rounded double precision;retained bigint;transaction_value text;transaction_raw json;
BEGIN
 operation:=CASE action WHEN 'record' THEN 'payment_event_record' WHEN 'record-once' THEN 'payment_event_record_once' WHEN 'snapshot' THEN 'payment_event_snapshot' WHEN 'terminal' THEN 'payment_event_terminal' END;
 IF operation IS NULL THEN RAISE EXCEPTION 'native payment action refused';END IF;
 IF action='snapshot' AND current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION 'native payment snapshot readonly transaction required';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,operation);
 IF packet_wire IS NULL OR octet_length(packet_wire)>8388608 THEN RAISE EXCEPTION 'native payment packet bound';END IF;packet:=packet_wire::jsonb;
 IF jsonb_typeof(packet) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'native payment packet refused';END IF;
 IF action IN('snapshot','terminal') THEN
  IF action='snapshot' THEN selected:=packet;
  ELSE
   IF (packet-'snapshotWire'-'snapshotSha256'-'failed'-'transactionWire'-'dispatch'-'after'-'release'='{}'::jsonb AND jsonb_typeof(packet->'snapshotWire')='string' AND octet_length(packet->>'snapshotWire')<=3145728 AND packet->>'snapshotSha256'=encode(sha256(convert_to(packet->>'snapshotWire','UTF8')),'hex') AND jsonb_typeof(packet->'failed')='boolean' AND jsonb_typeof(packet->'transactionWire')='string') IS NOT TRUE THEN RAISE EXCEPTION 'native payment terminal capture refused';END IF;
   captured:=(packet->>'snapshotWire')::jsonb;selected:=captured->'selector';failed:=(packet->>'failed')::boolean;transaction_raw:=(packet->>'transactionWire')::json;
   IF json_typeof(transaction_raw) IS DISTINCT FROM 'string' OR octet_length(transaction_raw::text)>1048576 THEN RAISE EXCEPTION 'native payment receipt bound';END IF;
  END IF;
  IF (jsonb_typeof(selected)='object' AND selected-'id'-'authorizationId'='{}'::jsonb AND jsonb_typeof(selected->'id')='string' AND jsonb_typeof(selected->'authorizationId')='string' AND octet_length(selected->>'id')<=1024 AND octet_length(selected->>'authorizationId')<=1024) IS NOT TRUE THEN RAISE EXCEPTION 'native payment selector refused';END IF;
  SELECT * INTO current_row FROM public.payment_events WHERE id=selected->>'id';has_payment:=FOUND;
  IF has_payment THEN
   SELECT * INTO raw_row FROM keryx_storage.payment_event_originals WHERE payment_id=current_row.id;
   IF NOT FOUND OR raw_row.native_projection IS DISTINCT FROM to_jsonb(current_row) THEN RAISE EXCEPTION 'native payment raw original unavailable or projection changed';END IF;
   before_wire:=raw_row.current_wire::text;
   IF octet_length(before_wire)>1048576 THEN RAISE EXCEPTION 'native payment original bound';END IF;
  END IF;
  SELECT jsonb_build_object('signer',signer,'submitted',submitted,'original',original) INTO hosted FROM public.hosted_treasury_authorizations WHERE nonce=selected->>'authorizationId';
  SELECT c.active INTO active FROM public.browser_journal_control c WHERE id=1;active:=coalesce(active,false);
  SELECT jsonb_build_object('signer',i.signer,'grantEpoch',i.grant_epoch,'paymentMetadata',b.payment_metadata::text) INTO browser FROM public.browser_authorization_intents i JOIN public.browser_journal_bindings b USING(nonce) WHERE i.nonce=selected->>'authorizationId' AND 'x402:'||i.nonce=selected->>'id';
  snapshot:=jsonb_build_object('selector',selected,'beforeWire',before_wire,'hosted',hosted,'browserActive',active,'browser',browser);wire:=snapshot::text;
  IF octet_length(wire)>3145728 THEN RAISE EXCEPTION 'native payment snapshot bound';END IF;
  IF action='snapshot' THEN RETURN json_build_object('wire',wire,'sha256',encode(sha256(convert_to(wire,'UTF8')),'hex'));END IF;
  IF snapshot-'beforeWire' IS DISTINCT FROM captured-'beforeWire' THEN RAISE EXCEPTION 'native payment dispatch original changed';END IF;
  IF (before_wire IS NULL) IS DISTINCT FROM (captured->>'beforeWire' IS NULL) THEN RAISE EXCEPTION 'native payment original presence changed';END IF;
  IF before_wire IS NOT NULL THEN
   before_json:=(captured->>'beforeWire')::json;after_json:=before_wire::json;before_tokens:=keryx_storage.source_scalar_text(captured->>'beforeWire','tokens');after_tokens:=keryx_storage.source_scalar_text(before_wire,'tokens');
   FOREACH field IN ARRAY fields LOOP
    IF field=ANY(ARRAY['amount_usdc','weight','list_price_usdc']) THEN
     IF (CASE WHEN before_tokens->>field='null' THEN NULL ELSE (before_tokens->>field)::double precision END) IS DISTINCT FROM (CASE WHEN after_tokens->>field='null' THEN NULL ELSE (after_tokens->>field)::double precision END) THEN RAISE EXCEPTION 'native payment immutable amount changed';END IF;
    ELSIF field<>ALL(ARRAY['settled','settlement_status','authorization_phase','tx_hash']) AND before_tokens->>field IS DISTINCT FROM after_tokens->>field THEN RAISE EXCEPTION 'native payment immutable original changed';END IF;
   END LOOP;
  END IF;
  is_private:=false;
  IF hosted IS NOT NULL AND selected->>'id'='x402:'||(selected->>'authorizationId') THEN
   original_tokens:=keryx_storage.source_scalar_text(hosted->>'original','tokens');IF json_typeof((original_tokens->>'context')::json) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'native hosted context unavailable';END IF;
   context_tokens:=keryx_storage.source_scalar_text(original_tokens->>'context','tokens');raw_token:=context_tokens->>'privateJob';
   is_private:=CASE json_typeof(raw_token::json) WHEN 'object' THEN true WHEN 'array' THEN true WHEN 'boolean' THEN raw_token='true' WHEN 'string' THEN (keryx_storage.source_scalar_text(raw_token,'scalar')->>'jsonHex')<>'' WHEN 'number' THEN raw_token::numeric<>0 ELSE false END;
   IF NOT is_private THEN dispatch:='hosted';END IF;
  END IF;
  IF dispatch IS NULL THEN dispatch:=CASE WHEN active AND browser IS NOT NULL THEN 'browser' WHEN active THEN 'journal-legacy' ELSE 'legacy' END;END IF;
  IF dispatch IS DISTINCT FROM packet->>'dispatch' THEN RAISE EXCEPTION 'native payment dispatch changed';END IF;
  IF dispatch='hosted' THEN
   IF hosted->>'submitted'<>'1' THEN PERFORM keryx_storage.leave_operation();RETURN '{"resolved":false,"reservationReleased":false}'::json;END IF;
   IF failed THEN
    resolved:=true;
    IF NOT has_payment OR current_row.settlement_status IS DISTINCT FROM 'pending' THEN PERFORM keryx_storage.leave_operation();RETURN '{"resolved":true,"reservationReleased":false}'::json;END IF;
   ELSE
    -- Each JSON escape represents one UTF-16 code unit; raw supplementary
    -- characters count twice. This validates Source's exact 256-unit bound
    -- without decoding retained NUL receipt bytes into native TEXT.
    transaction_value:=regexp_replace(transaction_raw::text,chr(92)||chr(92)||'(u[0-9a-fA-F]{4}|["'||chr(92)||chr(92)||'/bfnrt])','x','g');
    IF hosted->>'signer' !~ '^0x[a-f0-9]{40}$' OR selected->>'authorizationId' !~ '^0x[a-f0-9]{64}$' OR transaction_raw::text='""' OR keryx_storage.a2a_utf16_length(transaction_value)-2>256 THEN RAISE EXCEPTION 'native hosted settlement input refused';END IF;
    IF NOT has_payment OR current_row.settlement_status IS DISTINCT FROM 'pending' THEN
     IF has_payment AND current_row.settled AND after_tokens->>'tx_hash'=transaction_raw::text THEN PERFORM keryx_storage.leave_operation();RETURN '{"resolved":true,"reservationReleased":false}'::json;END IF;
     RAISE EXCEPTION 'native original hosted settlement conflict';
    END IF;resolved:=true;
   END IF;
  ELSIF dispatch='browser' THEN
   IF NOT has_payment OR current_row.authorization_phase IS NULL OR current_row.authorization_phase NOT IN('exposed','signed','submission_attempted') OR current_row.settlement_status IS DISTINCT FROM 'pending' THEN PERFORM keryx_storage.leave_operation();RETURN '{"resolved":false,"reservationReleased":false}'::json;END IF;
   resolved:=true;IF failed THEN release_kind:='retained';release_signer:=lower(browser->>'signer');release_epoch:=browser->>'grantEpoch';original_tokens:=keryx_storage.source_scalar_text(browser->>'paymentMetadata','tokens');IF json_typeof((original_tokens->>'amountUsdc')::json) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'native browser amount unavailable';END IF;amount:=(original_tokens->>'amountUsdc')::double precision;END IF;
  ELSIF dispatch='journal-legacy' THEN
   IF NOT has_payment OR current_row.authorization_id IS DISTINCT FROM selected->>'authorizationId' OR current_row.authorization_phase IS NOT NULL OR current_row.settlement_status IS DISTINCT FROM 'pending' THEN PERFORM keryx_storage.leave_operation();RETURN '{"resolved":false,"reservationReleased":false}'::json;END IF;
   resolved:=true;IF failed AND coalesce(current_row.grant_epoch,'')<>'' THEN release_kind:='retained';release_signer:=lower(current_row.payer);release_epoch:=current_row.grant_epoch;amount:=current_row.amount_usdc::double precision;END IF;
  ELSE
   IF NOT has_payment OR current_row.authorization_id IS DISTINCT FROM selected->>'authorizationId' OR current_row.settled OR current_row.settlement_status IS DISTINCT FROM 'pending' THEN PERFORM keryx_storage.leave_operation();RETURN '{"resolved":false,"reservationReleased":false}'::json;END IF;
   resolved:=true;IF failed AND coalesce(current_row.grant_epoch,'')<>'' THEN release_kind:='legacy';release_signer:=current_row.payer;release_epoch:=current_row.grant_epoch;END IF;
  END IF;
  payload:=packet->'after';IF payload IS NULL OR payload='null'::jsonb THEN RAISE EXCEPTION 'native payment source state advanced';END IF;
 ELSE payload:=packet;
 END IF;
 -- Existing private source_scalar_text tokens only: raw JSON getters reject
 -- NUL/unpaired Unicode even when selecting an unrelated safe field.
 -- Validate only safe projections as JSONB. Never cast the raw original to
 -- JSONB: retained scalar NUL bytes must remain JSON escape text. Lone UTF-16
 -- already became U+FFFD at Source scalar binding; serialized JSON is separate.
 IF (jsonb_typeof(payload)='object' AND payload-'rowWire'-'sha256'-'projection'-'unprojectedFields'='{}'::jsonb AND jsonb_typeof(payload->'rowWire')='string' AND octet_length(payload->>'rowWire')<=1048576 AND payload->>'sha256'=encode(sha256(convert_to(payload->>'rowWire','UTF8')),'hex') AND jsonb_typeof(payload->'projection')='object' AND jsonb_typeof(payload->'unprojectedFields')='array' AND jsonb_array_length(payload->'unprojectedFields')<=15) IS NOT TRUE THEN RAISE EXCEPTION 'native payment original capture refused';END IF;
 original_json:=(payload->>'rowWire')::json;original_tokens:=keryx_storage.source_scalar_text(payload->>'rowWire','tokens');projection:=payload->'projection';SELECT count(*),count(DISTINCT value) INTO key_count,distinct_count FROM jsonb_array_elements_text(original_tokens->'_rootKeys');
 IF key_count<>27 OR distinct_count<>27 OR (SELECT count(*) FROM jsonb_object_keys(projection))<>27 THEN RAISE EXCEPTION 'native payment original field inventory';END IF;
 SELECT coalesce(array_agg(value ORDER BY value),'{}'::text[]) INTO unprojected FROM jsonb_array_elements_text(payload->'unprojectedFields');
 IF cardinality(unprojected)<>(SELECT count(DISTINCT value) FROM unnest(unprojected) value) OR NOT unprojected<@ARRAY['created_at','source_name','rationale','tx_hash','authorization_expires_at','origin','item_id','item_title','item_url','content_version','item_published_at','offer_id'] THEN RAISE EXCEPTION 'native payment projection fields refused';END IF;
 FOREACH field IN ARRAY fields LOOP
  raw_token:=original_tokens->>field;IF NOT projection?field OR raw_token IS NULL THEN RAISE EXCEPTION 'native payment original missing field';END IF;
  IF json_typeof(raw_token::json)='string' THEN scalar:=keryx_storage.source_scalar_text(raw_token,'scalar');IF scalar->>'sourceHex' IS DISTINCT FROM scalar->>'jsonHex' THEN RAISE EXCEPTION 'native payment scalar Source binding mismatch';END IF;END IF;
  IF field=ANY(unprojected) THEN
   IF projection->field IS DISTINCT FROM 'null'::jsonb OR json_typeof(raw_token::json) NOT IN('string','null') THEN RAISE EXCEPTION 'native payment unprojected field refused';END IF;
  ELSIF field=ANY(ARRAY['amount_usdc','weight','list_price_usdc','settled']) THEN
   IF raw_token='null' THEN IF projection->field IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'native payment numeric null mismatch';END IF;
   ELSIF json_typeof(raw_token::json)<>'number' OR raw_token::numeric IS DISTINCT FROM (projection->>field)::numeric OR abs((projection->>field)::numeric)>9007199254740991 THEN RAISE EXCEPTION 'native payment numeric mismatch';END IF;
  ELSE
   IF raw_token='null' THEN IF projection->field IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'native payment text null mismatch';END IF;
   ELSIF json_typeof(raw_token::json)<>'string' OR scalar->>'sourceHex' IS DISTINCT FROM encode(convert_to(projection->>field,'UTF8'),'hex') THEN RAISE EXCEPTION 'native payment scalar projection mismatch';END IF;
  END IF;
 END LOOP;
 IF (projection->'settled' IN('0'::jsonb,'1'::jsonb) AND (projection->>'settled'='1')=(projection->>'settlement_status'='settled') AND jsonb_typeof(projection->'id')='string' AND octet_length(projection->>'id')<=1024) IS NOT TRUE THEN RAISE EXCEPTION 'native payment settled flag mismatch';END IF;
 -- Match the selected mainnet Source BEFORE INSERT/UPDATE triggers, including
 -- duplicate INSERT OR IGNORE attempts. A conflict never bypasses authority.
 IF projection->>'network' IS DISTINCT FROM 'eip155:5042' OR projection->>'settlement_status' IS NULL OR projection->>'settlement_status'='simulated' THEN RAISE EXCEPTION 'native payment Source authority profile mismatch';END IF;
 IF cardinality(unprojected)>0 AND strpos(pg_get_functiondef('keryx_storage.require_operation(jsonb,text,text)'::regprocedure),'Native payment raw observation guard v1')=0 THEN RAISE EXCEPTION 'native payment raw observation guard unavailable';END IF;
 projection:=jsonb_set(projection,'{settled}',to_jsonb(projection->>'settled'='1'));SELECT * INTO after_row FROM jsonb_populate_record(NULL::public.payment_events,projection);
 IF action IN('record','record-once') THEN
  IF after_row.authorization_phase IS NOT NULL THEN RAISE EXCEPTION 'generic payment cannot create journal phase';END IF;
  IF action='record-once' THEN
   BEGIN INSERT INTO public.payment_events SELECT (after_row).* ON CONFLICT DO NOTHING;GET DIAGNOSTICS changed=ROW_COUNT;
   EXCEPTION WHEN not_null_violation OR check_violation THEN changed:=0;END;
  ELSE INSERT INTO public.payment_events SELECT (after_row).*;changed:=1;END IF;
  IF changed=1 THEN
   INSERT INTO keryx_storage.payment_event_originals(payment_id,original_wire,original_sha256,current_wire,current_sha256,native_projection,unprojected_fields) VALUES(after_row.id,original_json,payload->>'sha256',original_json,payload->>'sha256',to_jsonb(after_row),unprojected);
  END IF;
  PERFORM keryx_storage.leave_operation();RETURN to_json(changed=1);
 END IF;
 before_json:=before_wire::json;before_tokens:=keryx_storage.source_scalar_text(before_wire,'tokens');
 FOREACH field IN ARRAY fields LOOP
  IF field=ANY(ARRAY['amount_usdc','weight','list_price_usdc']) THEN
   IF (CASE WHEN before_tokens->>field='null' THEN NULL ELSE (before_tokens->>field)::double precision END) IS DISTINCT FROM (CASE WHEN original_tokens->>field='null' THEN NULL ELSE (original_tokens->>field)::double precision END) THEN RAISE EXCEPTION 'native payment immutable numeric capture changed';END IF;
  ELSIF field<>ALL(ARRAY['settled','settlement_status','authorization_phase','tx_hash']) AND before_tokens->>field IS DISTINCT FROM original_tokens->>field THEN RAISE EXCEPTION 'native payment immutable capture changed';END IF;
 END LOOP;
 IF original_tokens->>'tx_hash' IS DISTINCT FROM transaction_raw::text OR after_row.settlement_status IS DISTINCT FROM CASE WHEN failed THEN 'failed' ELSE 'settled' END OR after_row.settled IS DISTINCT FROM (NOT failed)
  OR after_row.authorization_phase IS DISTINCT FROM CASE WHEN dispatch IN('hosted','browser') THEN CASE WHEN failed THEN 'failed' ELSE 'settled' END ELSE current_row.authorization_phase END THEN RAISE EXCEPTION 'native payment terminal capture mismatch';END IF;
 INSERT INTO public.browser_journal_writer VALUES(txid_current()) ON CONFLICT DO NOTHING;
 UPDATE public.payment_events SET settled=after_row.settled,settlement_status=after_row.settlement_status,tx_hash=after_row.tx_hash,authorization_phase=after_row.authorization_phase WHERE id=current_row.id;
 IF release_kind='retained' THEN
  scaled:=amount*1000000::double precision;rounded:=floor(scaled);IF scaled-rounded>=0.5::double precision THEN rounded:=rounded+1;END IF;
  IF rounded<0 OR rounded>9007199254740991 OR abs(scaled-rounded)>=0.000001 OR packet#>>'{release,mode}' IS DISTINCT FROM 'retained' OR packet#>>'{release,signer}' IS DISTINCT FROM release_signer OR packet#>>'{release,grantEpoch}' IS DISTINCT FROM release_epoch OR packet#>>'{release,amountMicros}' IS DISTINCT FROM rounded::bigint::text THEN RAISE EXCEPTION 'native retained browser release mismatch';END IF;
  UPDATE public.browser_retained_grants SET spent_micro=spent_micro-rounded::bigint WHERE grant_epoch=release_epoch AND signer=release_signer AND spent_micro>=rounded::bigint;GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>1 THEN RAISE EXCEPTION 'native retained epoch capacity mismatch';END IF;
  UPDATE public.browser_signer_capacity SET spent_micro=spent_micro-rounded::bigint WHERE signer=release_signer AND spent_micro>=rounded::bigint RETURNING spent_micro INTO retained;GET DIAGNOSTICS changed=ROW_COUNT;IF changed<>1 THEN RAISE EXCEPTION 'native retained signer capacity mismatch';END IF;
  IF (SELECT count(*) FROM public.session_grants WHERE lower(sess_addr)=release_signer)>1000 THEN RAISE EXCEPTION 'native signer alias bound';END IF;
  UPDATE public.session_grants SET spent=retained::double precision/1000000 WHERE lower(sess_addr)=release_signer;released:=true;
 ELSIF release_kind='legacy' THEN
  IF current_row.amount_usdc IS NULL OR (SELECT count(*) FROM public.session_grants WHERE grant_epoch=release_epoch AND lower(sess_addr)=lower(release_signer))>1000 THEN RAISE EXCEPTION 'native legacy grant release unavailable';END IF;
  UPDATE public.session_grants SET spent=greatest(0,round((spent::double precision-current_row.amount_usdc::double precision)::numeric,6)) WHERE grant_epoch=release_epoch AND lower(sess_addr)=lower(release_signer);GET DIAGNOSTICS changed=ROW_COUNT;released:=changed=1;
 END IF;
 SELECT * INTO after_row FROM public.payment_events WHERE id=current_row.id;
 INSERT INTO keryx_storage.payment_event_originals(payment_id,original_wire,original_sha256,current_wire,current_sha256,native_projection,unprojected_fields)
  VALUES(current_row.id,before_json,encode(sha256(convert_to(before_wire,'UTF8')),'hex'),original_json,payload->>'sha256',to_jsonb(after_row),unprojected)
  ON CONFLICT(payment_id) DO UPDATE SET current_wire=excluded.current_wire,current_sha256=excluded.current_sha256,native_projection=excluded.native_projection,unprojected_fields=excluded.unprojected_fields;
 PERFORM keryx_storage.leave_operation();RETURN json_build_object('resolved',resolved,'reservationReleased',released);
END;$$;
REVOKE ALL ON FUNCTION public.storage_payment_events(jsonb,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_payment_events(jsonb,text,text,text) TO keryx_app,keryx_reader;
RESET ROLE;
