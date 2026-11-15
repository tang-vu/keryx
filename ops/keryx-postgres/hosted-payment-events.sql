-- Fresh selected-Source constructor. No new function, signature, grant or cap.
-- Preserve the near-full hosted policy part and every read-only sentinel branch.
SET ROLE keryx_owner;
DO $hosted_payment_source$
DECLARE signature text;original_body text;extended_body text;definition text;anchor text;replacement text;function_oid oid;
BEGIN
 IF (SELECT mode FROM keryx_storage.control WHERE singleton) IS DISTINCT FROM 'held'
  OR EXISTS(SELECT 1 FROM keryx_storage.identity) OR EXISTS(SELECT 1 FROM public.payment_events)
  OR EXISTS(SELECT 1 FROM keryx_storage.payment_event_originals)
  OR (SELECT atttypid FROM pg_attribute WHERE attrelid='public.payment_events'::regclass AND attname='settled' AND NOT attisdropped) IS DISTINCT FROM 'boolean'::regtype::oid
 THEN RAISE EXCEPTION 'native hosted payment Source requires fresh selected target';END IF;
 FOREACH signature IN ARRAY ARRAY[
  'public.storage_hosted_admit_authorization(jsonb,text,text,text,text,text,text,text)',
  'public.storage_hosted_submit(jsonb,text,text,text,text)',
  'public.storage_hosted_confirm(jsonb,text,text,text,text)',
  'keryx_storage.hosted_totals(text,text)'] LOOP
  function_oid:=signature::regprocedure::oid;
  SELECT prosrc INTO STRICT original_body FROM pg_proc WHERE oid=function_oid;
  IF strpos(original_body,'Native hosted payment Source producer v1')>0 OR strpos(original_body,'Native hosted retained payment v1')>0
  THEN RAISE EXCEPTION 'native hosted payment Source already installed';END IF;
  extended_body:=original_body;
 anchor:=$decla$
BEGIN$decla$;replacement:=$declb$
 -- Native hosted retained payment v1

 hp_envelope jsonb;hp_template text;hp_tokens jsonb;hp_wire text;hp_before text;hp_created text;hp_projection jsonb;
 hp_row public.payment_events%ROWTYPE;hp_original keryx_storage.payment_event_originals%ROWTYPE;
 hp_field text;hp_parts text[];hp_fields text[]:=ARRAY['id','created_at','kind','query_id','source_id','source_name','payer','payee','amount_usdc','weight','rationale','tx_hash','network','settled','settlement_status','authorization_id','authorization_expires_at','grant_epoch','origin','item_id','item_title','item_url','content_version','item_published_at','offer_id','list_price_usdc','authorization_phase'];hp_unprojected text[];
 hp_receipt jsonb;hp_receipt_bytes bytea;hp_units integer;hp_offset integer;hp_lead integer;hp_receipt_text text;
 hp_proof text;hp_proof_tokens jsonb;hp_has_payment boolean;hp_changed integer;hp_nonempty_receipt boolean;

BEGIN$declb$;
 IF (length(extended_body)-length(replace(extended_body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'native hosted constructor anchor refused';END IF;
 extended_body:=replace(extended_body,anchor,replacement);

  IF signature LIKE 'public.storage_hosted_admit_authorization(%' THEN
 anchor:=$unwrapa$ PERFORM keryx_storage.require_operation(expected,digest,'hosted_admit_authorization');$unwrapa$;replacement:=$unwrapb$ PERFORM keryx_storage.require_operation(expected,digest,'hosted_admit_authorization');
 -- Native hosted payment Source producer v1. Sentinel read branches above keep
 -- their original contracts; only ordinary authorization admission is wrapped.
 IF original_wire IS NULL OR octet_length(original_wire)>32768 THEN RAISE EXCEPTION 'native hosted capture unavailable';END IF;
 hp_envelope:=original_wire::jsonb;
 IF jsonb_typeof(hp_envelope) IS DISTINCT FROM 'object' OR hp_envelope-'originalWire'-'paymentTemplateWire'<>'{}'::jsonb
  OR jsonb_typeof(hp_envelope->'originalWire') IS DISTINCT FROM 'string' OR NOT(hp_envelope?'paymentTemplateWire')
 THEN RAISE EXCEPTION 'native hosted capture envelope refused';END IF;
 original_wire:=hp_envelope->>'originalWire';hp_template:=hp_envelope->>'paymentTemplateWire';
$unwrapb$;
 IF (length(extended_body)-length(replace(extended_body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'native hosted constructor anchor refused';END IF;
 extended_body:=replace(extended_body,anchor,replacement);
 anchor:=$creationa$ IF role_name='public' THEN
  INSERT INTO public.payment_events(id,created_at,kind,query_id,source_id,source_name,payer,payee,amount_usdc,network,settled,settlement_status,authorization_id,authorization_expires_at,item_id,origin,authorization_phase)
   VALUES('x402:'||chosen_nonce,clock_timestamp(),c->>'kind',c->>'queryId',c->>'sourceId',CASE WHEN c->>'kind'='operating-fee' THEN 'Keryx operating fee' ELSE c->>'sourceId' END,p->>'signer',lower(m->>'to'),amount::double precision/1000000,'eip155:5042',false,'pending',chosen_nonce,to_timestamp(before::double precision),c->>'itemId','engine','prepared');
 END IF;$creationa$;replacement:=$creationb$ IF role_name='public' THEN
  IF hp_template IS NULL OR octet_length(hp_template)>16384 THEN RAISE EXCEPTION 'native hosted creation template unavailable';END IF;
  hp_tokens:=keryx_storage.source_scalar_text(hp_template,'tokens');
  IF jsonb_array_length(hp_tokens->'_rootKeys')<>27 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(hp_tokens->'_rootKeys'))<>27
  THEN RAISE EXCEPTION 'native hosted creation cell inventory';END IF;
  -- The actual fixed Source INSERT inputs, never a native-row export.
  hp_projection:=jsonb_build_object('id','x402:'||chosen_nonce,'created_at',NULL,'kind',c->>'kind','query_id',c->>'queryId',
   'source_id',c->>'sourceId','source_name',CASE WHEN c->>'kind'='operating-fee' THEN 'Keryx operating fee' ELSE c->>'sourceId' END,
   'payer',p->>'signer','payee',lower(m->>'to'),'amount_usdc',amount::double precision/1000000,'weight',NULL,'rationale',NULL,'tx_hash',NULL,
   'network','eip155:5042','settled',0,'settlement_status','pending','authorization_id',chosen_nonce,
   'authorization_expires_at',to_char(to_timestamp(before::double precision) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'grant_epoch',NULL,'origin','engine','item_id',c->>'itemId','item_title',NULL,'item_url',NULL,'content_version',NULL,
   'item_published_at',NULL,'offer_id',NULL,'list_price_usdc',NULL,'authorization_phase','prepared');
  FOREACH hp_field IN ARRAY hp_fields LOOP
   IF hp_tokens->>hp_field IS NULL THEN RAISE EXCEPTION 'native hosted creation cell missing';END IF;
   IF hp_field='amount_usdc' THEN
    IF json_typeof((hp_tokens->>hp_field)::json) IS DISTINCT FROM 'number'
     OR (hp_tokens->>hp_field)::double precision IS DISTINCT FROM amount::double precision/1000000
    THEN RAISE EXCEPTION 'native hosted Source amount mismatch';END IF;
   ELSIF (hp_tokens->>hp_field)::jsonb IS DISTINCT FROM hp_projection->hp_field THEN RAISE EXCEPTION 'native hosted Source input mismatch';END IF;
  END LOOP;
  -- Source new Date().toISOString() is evaluated HERE, after the authorization
  -- INSERT and current-policy/capacity checks. Never accept a caller clock.
  hp_created:=to_char(date_trunc('milliseconds',clock_timestamp()) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  hp_tokens:=jsonb_set(hp_tokens,'{created_at}',to_jsonb(to_json(hp_created)::text));

 hp_parts:=ARRAY[]::text[];
 FOREACH hp_field IN ARRAY hp_fields LOOP
  IF hp_tokens->>hp_field IS NULL THEN RAISE EXCEPTION 'native hosted payment cell unavailable';END IF;
  hp_parts:=array_append(hp_parts,to_json(hp_field)::text||':'||(hp_tokens->>hp_field));
 END LOOP;
 hp_wire:='{'||array_to_string(hp_parts,',')||'}';
 IF octet_length(hp_wire)>1048576 THEN RAISE EXCEPTION 'native hosted payment original bound';END IF;

  hp_projection:=jsonb_set(jsonb_set(hp_projection,'{created_at}',to_jsonb(hp_created)),'{settled}','false'::jsonb);
  SELECT * INTO hp_row FROM jsonb_populate_record(NULL::public.payment_events,hp_projection);
  INSERT INTO public.payment_events SELECT (hp_row).* RETURNING * INTO hp_row;
  INSERT INTO keryx_storage.payment_event_originals(payment_id,identity_digest,original_wire,original_sha256,current_wire,current_sha256,native_projection,unprojected_fields)
   VALUES(hp_row.id,keryx_storage.identity_digest(expected),hp_wire::json,encode(sha256(convert_to(hp_wire,'UTF8')),'hex'),hp_wire::json,
    encode(sha256(convert_to(hp_wire,'UTF8')),'hex'),to_jsonb(hp_row),ARRAY[]::text[]);
 ELSE
  IF hp_template IS NOT NULL THEN RAISE EXCEPTION 'private hosted capture cannot create a public payment';END IF;
 END IF;$creationb$;
 IF (length(extended_body)-length(replace(extended_body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'native hosted constructor anchor refused';END IF;
 extended_body:=replace(extended_body,anchor,replacement);

  ELSIF signature LIKE 'public.storage_hosted_submit(%' THEN
 anchor:=$submitversiona$BEGIN PERFORM keryx_storage.require_operation(expected,digest,'hosted_submit');$submitversiona$;replacement:=$submitversionb$BEGIN PERFORM keryx_storage.require_operation(expected,digest,'hosted_submit');
 IF wire IS NULL OR octet_length(wire)>2048 THEN RAISE EXCEPTION 'hosted payment protocol mismatch';END IF;
 hp_envelope:=wire::jsonb;
 IF hp_envelope->>'format' IS DISTINCT FROM 'source-payment-originals-v1' OR hp_envelope-'format'-'submissionWire'<>'{}'::jsonb OR jsonb_typeof(hp_envelope->'submissionWire') IS DISTINCT FROM 'string'
 THEN RAISE EXCEPTION 'hosted payment protocol mismatch';END IF;
 wire:=hp_envelope->>'submissionWire';
$submitversionb$;
 IF (length(extended_body)-length(replace(extended_body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'native hosted constructor anchor refused';END IF;
 extended_body:=replace(extended_body,anchor,replacement);
 anchor:=$submitchecka$ UPDATE public.hosted_treasury_authorizations SET header_hash=storage_hosted_submit.header_hash,submitted=1 WHERE nonce=r.nonce;$submitchecka$;replacement:=$submitcheckb$
 SELECT * INTO hp_row FROM public.payment_events WHERE id='x402:'||r.nonce;hp_has_payment:=FOUND;
 IF hp_has_payment THEN
  SELECT * INTO hp_original FROM keryx_storage.payment_event_originals WHERE payment_id=hp_row.id;
  IF NOT FOUND OR hp_original.identity_digest IS DISTINCT FROM keryx_storage.identity_digest(expected)
   OR hp_original.original_sha256 IS DISTINCT FROM encode(sha256(convert_to(hp_original.original_wire::text,'UTF8')),'hex')
   OR hp_original.current_sha256 IS DISTINCT FROM encode(sha256(convert_to(hp_original.current_wire::text,'UTF8')),'hex')
   OR hp_original.native_projection IS DISTINCT FROM to_jsonb(hp_row)
  THEN RAISE EXCEPTION 'native hosted payment original unavailable or changed';END IF;
  hp_before:=hp_original.current_wire::text;hp_tokens:=keryx_storage.source_scalar_text(hp_before,'tokens');
 END IF;
 UPDATE public.hosted_treasury_authorizations SET header_hash=storage_hosted_submit.header_hash,submitted=1 WHERE nonce=r.nonce;$submitcheckb$;
 IF (length(extended_body)-length(replace(extended_body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'native hosted constructor anchor refused';END IF;
 extended_body:=replace(extended_body,anchor,replacement);
 anchor:=$submita$ UPDATE public.payment_events SET authorization_phase='submission_attempted' WHERE id='x402:'||r.nonce AND authorization_phase='prepared';$submita$;replacement:=$submitb$ IF hp_has_payment AND hp_row.authorization_phase='prepared' THEN
  UPDATE public.payment_events SET authorization_phase='submission_attempted' WHERE id=hp_row.id AND authorization_phase='prepared' RETURNING * INTO hp_row;
  GET DIAGNOSTICS hp_changed=ROW_COUNT;IF hp_changed<>1 THEN RAISE EXCEPTION 'native hosted submission changed';END IF;
  hp_tokens:=jsonb_set(hp_tokens,'{authorization_phase}',to_jsonb('"submission_attempted"'::text));hp_unprojected:=hp_original.unprojected_fields;

 hp_parts:=ARRAY[]::text[];
 FOREACH hp_field IN ARRAY hp_fields LOOP
  IF hp_tokens->>hp_field IS NULL THEN RAISE EXCEPTION 'native hosted payment cell unavailable';END IF;
  hp_parts:=array_append(hp_parts,to_json(hp_field)::text||':'||(hp_tokens->>hp_field));
 END LOOP;
 hp_wire:='{'||array_to_string(hp_parts,',')||'}';
 IF octet_length(hp_wire)>1048576 THEN RAISE EXCEPTION 'native hosted payment original bound';END IF;

 UPDATE keryx_storage.payment_event_originals SET current_wire=hp_wire::json,current_sha256=encode(sha256(convert_to(hp_wire,'UTF8')),'hex'),
  native_projection=to_jsonb(hp_row),unprojected_fields=hp_unprojected
 WHERE payment_id=hp_row.id AND identity_digest=keryx_storage.identity_digest(expected)
  AND current_sha256=hp_original.current_sha256 AND current_wire::text=hp_before;
 GET DIAGNOSTICS hp_changed=ROW_COUNT;IF hp_changed<>1 THEN RAISE EXCEPTION 'native hosted payment original changed';END IF;

 END IF;
 -- Source permits a zero-row public UPDATE. Never backfill a public original.
$submitb$;
 IF (length(extended_body)-length(replace(extended_body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'native hosted constructor anchor refused';END IF;
 extended_body:=replace(extended_body,anchor,replacement);

  ELSIF signature LIKE 'public.storage_hosted_confirm(%' THEN
 anchor:=$receipta$ IF signer IS NULL OR signer !~ '^0x[0-9a-f]{40}$' OR nonce IS NULL OR nonce !~ '^0x[0-9a-f]{64}$' OR transaction_hash IS NULL OR octet_length(transaction_hash) NOT BETWEEN 1 AND 256
 THEN RAISE EXCEPTION 'hosted settlement evidence refused';END IF;$receipta$;replacement:=$receiptb$ IF signer IS NULL OR signer !~ '^0x[0-9a-f]{40}$' OR nonce IS NULL OR nonce !~ '^0x[0-9a-f]{64}$' THEN RAISE EXCEPTION 'hosted settlement evidence refused';END IF;
 IF transaction_hash IS NULL OR octet_length(transaction_hash)>2305
  OR left(transaction_hash,257) IS DISTINCT FROM 'source-payment-originals-v1::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::'
 THEN RAISE EXCEPTION 'hosted payment protocol mismatch';END IF;
 transaction_hash:=substring(transaction_hash FROM 258);
 IF transaction_hash IS NULL OR octet_length(transaction_hash)>2048 OR json_typeof(transaction_hash::json) IS DISTINCT FROM 'string'
 THEN RAISE EXCEPTION 'hosted settlement evidence refused';END IF;
 hp_receipt:=keryx_storage.source_scalar_text(transaction_hash,'scalar');hp_receipt_bytes:=decode(hp_receipt->>'sourceHex','hex');hp_units:=0;
 IF octet_length(hp_receipt_bytes)>0 THEN
  FOR hp_offset IN 0..octet_length(hp_receipt_bytes)-1 LOOP
   hp_lead:=get_byte(hp_receipt_bytes,hp_offset);
   hp_units:=hp_units+CASE WHEN hp_lead<128 OR hp_lead BETWEEN 194 AND 239 THEN 1 WHEN hp_lead BETWEEN 240 AND 244 THEN 2 ELSE 0 END;
  END LOOP;
 END IF;
 IF hp_units NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'hosted settlement evidence refused';END IF;
$receiptb$;
 IF (length(extended_body)-length(replace(extended_body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'native hosted constructor anchor refused';END IF;
 extended_body:=replace(extended_body,anchor,replacement);
 anchor:=$privatebrancha$ IF r.original::jsonb#>'{context,privateJob}' IS NOT NULL AND r.original::jsonb#>'{context,privateJob}'<>'null'::jsonb THEN$privatebrancha$;replacement:=$privatebranchb$
 SELECT * INTO hp_row FROM public.payment_events WHERE id='x402:'||r.nonce;hp_has_payment:=FOUND;
 IF hp_has_payment THEN
  SELECT * INTO hp_original FROM keryx_storage.payment_event_originals WHERE payment_id=hp_row.id;
  IF NOT FOUND OR hp_original.identity_digest IS DISTINCT FROM keryx_storage.identity_digest(expected)
   OR hp_original.original_sha256 IS DISTINCT FROM encode(sha256(convert_to(hp_original.original_wire::text,'UTF8')),'hex')
   OR hp_original.current_sha256 IS DISTINCT FROM encode(sha256(convert_to(hp_original.current_wire::text,'UTF8')),'hex')
   OR hp_original.native_projection IS DISTINCT FROM to_jsonb(hp_row)
  THEN RAISE EXCEPTION 'native hosted payment original unavailable or changed';END IF;
  hp_before:=hp_original.current_wire::text;hp_tokens:=keryx_storage.source_scalar_text(hp_before,'tokens');
 END IF;
 IF (CASE jsonb_typeof(r.original::jsonb#>'{context,privateJob}') WHEN 'null' THEN false WHEN 'boolean' THEN r.original::jsonb#>'{context,privateJob}'='true'::jsonb WHEN 'number' THEN r.original::jsonb#>'{context,privateJob}'<>'0'::jsonb WHEN 'string' THEN r.original::jsonb#>'{context,privateJob}'<>'""'::jsonb WHEN 'object' THEN true WHEN 'array' THEN true ELSE false END) THEN$privatebranchb$;
 IF (length(extended_body)-length(replace(extended_body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'native hosted constructor anchor refused';END IF;
 extended_body:=replace(extended_body,anchor,replacement);
 anchor:=$privateconfirma$  IF NOT EXISTS(SELECT 1 FROM public.private_creator_confirmations c WHERE c.authorization_id=nonce AND c.data::jsonb->>'transaction'=transaction_hash)
  THEN RAISE EXCEPTION 'original private confirmation unavailable';END IF;$privateconfirma$;replacement:=$privateconfirmb$  SELECT data INTO hp_proof FROM public.private_creator_confirmations c WHERE c.authorization_id=nonce;
  IF NOT FOUND THEN RAISE EXCEPTION 'original private confirmation unavailable';END IF;
  hp_proof_tokens:=keryx_storage.source_scalar_text(hp_proof,'tokens');
  IF hp_proof_tokens->>'transaction' IS NULL OR json_typeof((hp_proof_tokens->>'transaction')::json) IS DISTINCT FROM 'string'
   OR (keryx_storage.source_scalar_text(hp_proof_tokens->>'transaction','scalar')->>'jsonHex') IS DISTINCT FROM hp_receipt->>'jsonHex'
  THEN RAISE EXCEPTION 'original private confirmation unavailable';END IF;$privateconfirmb$;
 IF (length(extended_body)-length(replace(extended_body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'native hosted constructor anchor refused';END IF;
 extended_body:=replace(extended_body,anchor,replacement);
 anchor:=$publicconfirma$  UPDATE public.payment_events SET settled=true,settlement_status='settled',authorization_phase='settled',tx_hash=transaction_hash WHERE id='x402:'||nonce AND settlement_status='pending';
  SELECT settled,tx_hash INTO saved FROM public.payment_events WHERE id='x402:'||nonce;
  IF NOT FOUND OR saved.settled IS DISTINCT FROM true OR saved.tx_hash IS DISTINCT FROM transaction_hash THEN RAISE EXCEPTION 'original settlement conflict';END IF;$publicconfirma$;replacement:=$publicconfirmb$  IF NOT hp_has_payment THEN RAISE EXCEPTION 'original settlement conflict';END IF;
  -- Source scalar binding replaces lone UTF-16, then strict caller readback
  -- rolls it back. NUL itself survives. Private serialized proofs are separate.
  IF hp_receipt->>'sourceHex' IS DISTINCT FROM hp_receipt->>'jsonHex' THEN RAISE EXCEPTION 'original settlement conflict';END IF;
  IF hp_row.settlement_status='pending' THEN
   hp_receipt_text:=CASE WHEN position(decode('00','hex') IN hp_receipt_bytes)>0 THEN NULL ELSE convert_from(hp_receipt_bytes,'UTF8') END;
   UPDATE public.payment_events SET settled=true,settlement_status='settled',authorization_phase='settled',tx_hash=hp_receipt_text
    WHERE id=hp_row.id AND settlement_status='pending' RETURNING * INTO hp_row;
   GET DIAGNOSTICS hp_changed=ROW_COUNT;IF hp_changed<>1 THEN RAISE EXCEPTION 'native hosted settlement changed';END IF;
   hp_tokens:=hp_tokens||jsonb_build_object('settled','1','settlement_status','"settled"','authorization_phase','"settled"','tx_hash',transaction_hash);
   hp_unprojected:=array_remove(hp_original.unprojected_fields,'tx_hash');
   IF hp_receipt_text IS NULL THEN hp_unprojected:=array_append(hp_unprojected,'tx_hash');END IF;

 hp_parts:=ARRAY[]::text[];
 FOREACH hp_field IN ARRAY hp_fields LOOP
  IF hp_tokens->>hp_field IS NULL THEN RAISE EXCEPTION 'native hosted payment cell unavailable';END IF;
  hp_parts:=array_append(hp_parts,to_json(hp_field)::text||':'||(hp_tokens->>hp_field));
 END LOOP;
 hp_wire:='{'||array_to_string(hp_parts,',')||'}';
 IF octet_length(hp_wire)>1048576 THEN RAISE EXCEPTION 'native hosted payment original bound';END IF;

 UPDATE keryx_storage.payment_event_originals SET current_wire=hp_wire::json,current_sha256=encode(sha256(convert_to(hp_wire,'UTF8')),'hex'),
  native_projection=to_jsonb(hp_row),unprojected_fields=hp_unprojected
 WHERE payment_id=hp_row.id AND identity_digest=keryx_storage.identity_digest(expected)
  AND current_sha256=hp_original.current_sha256 AND current_wire::text=hp_before;
 GET DIAGNOSTICS hp_changed=ROW_COUNT;IF hp_changed<>1 THEN RAISE EXCEPTION 'native hosted payment original changed';END IF;

  ELSIF NOT hp_row.settled OR hp_tokens->>'tx_hash' IS NULL OR json_typeof((hp_tokens->>'tx_hash')::json) IS DISTINCT FROM 'string'
   OR (keryx_storage.source_scalar_text(hp_tokens->>'tx_hash','scalar')->>'jsonHex') IS DISTINCT FROM hp_receipt->>'jsonHex'
  THEN RAISE EXCEPTION 'original settlement conflict';END IF;
$publicconfirmb$;
 IF (length(extended_body)-length(replace(extended_body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'native hosted constructor anchor refused';END IF;
 extended_body:=replace(extended_body,anchor,replacement);

  ELSE
 anchor:=$totalschecka$  o:=r.original::jsonb; m:=o#>'{payload,message}';$totalschecka$;replacement:=$totalscheckb$
 SELECT * INTO hp_row FROM public.payment_events WHERE id=r.id;hp_has_payment:=FOUND;
 IF hp_has_payment THEN
  SELECT * INTO hp_original FROM keryx_storage.payment_event_originals WHERE payment_id=hp_row.id;
  IF NOT FOUND OR hp_original.identity_digest IS DISTINCT FROM (SELECT identity_digest FROM keryx_storage.identity WHERE singleton)
   OR hp_original.original_sha256 IS DISTINCT FROM encode(sha256(convert_to(hp_original.original_wire::text,'UTF8')),'hex')
   OR hp_original.current_sha256 IS DISTINCT FROM encode(sha256(convert_to(hp_original.current_wire::text,'UTF8')),'hex')
   OR hp_original.native_projection IS DISTINCT FROM to_jsonb(hp_row)
  THEN RAISE EXCEPTION 'native hosted payment original unavailable or changed';END IF;
  hp_before:=hp_original.current_wire::text;hp_tokens:=keryx_storage.source_scalar_text(hp_before,'tokens');
 END IF;

 hp_nonempty_receipt:=false;
 IF hp_has_payment AND hp_tokens->>'tx_hash' IS NOT NULL AND json_typeof((hp_tokens->>'tx_hash')::json)='string' THEN
  hp_nonempty_receipt:=coalesce(keryx_storage.source_scalar_text(hp_tokens->>'tx_hash','scalar')->>'jsonHex','')<>'';
 END IF;
  o:=r.original::jsonb; m:=o#>'{payload,message}';$totalscheckb$;
 IF (length(extended_body)-length(replace(extended_body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'native hosted constructor anchor refused';END IF;
 extended_body:=replace(extended_body,anchor,replacement);
 anchor:=$totalsreceipta$coalesce(r.tx_hash,'')=''$totalsreceipta$;replacement:=$totalsreceiptb$NOT hp_nonempty_receipt$totalsreceiptb$;
 IF (length(extended_body)-length(replace(extended_body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'native hosted constructor anchor refused';END IF;
 extended_body:=replace(extended_body,anchor,replacement);
 anchor:=$totalsconfirmationa$   SELECT data::jsonb INTO confirmation FROM public.private_creator_confirmations WHERE authorization_id=r.nonce;
   IF FOUND THEN
    IF proof IS NULL OR confirmation->'submission' IS DISTINCT FROM proof OR jsonb_typeof(confirmation->'transaction') IS DISTINCT FROM 'string'
     OR coalesce(confirmation->>'transaction','')='' THEN RAISE EXCEPTION 'original private hosted settlement unavailable'; END IF;
    confirmed:=confirmed+r.amount_micro;
   END IF;$totalsconfirmationa$;replacement:=$totalsconfirmationb$   SELECT data INTO hp_proof FROM public.private_creator_confirmations WHERE authorization_id=r.nonce;
   IF FOUND THEN
    hp_proof_tokens:=keryx_storage.source_scalar_text(hp_proof,'tokens');
    IF proof IS NULL OR hp_proof_tokens->>'submission' IS NULL OR (hp_proof_tokens->>'submission')::jsonb IS DISTINCT FROM proof
     OR hp_proof_tokens->>'transaction' IS NULL OR json_typeof((hp_proof_tokens->>'transaction')::json) IS DISTINCT FROM 'string'
     OR coalesce(keryx_storage.source_scalar_text(hp_proof_tokens->>'transaction','scalar')->>'jsonHex','')=''
    THEN RAISE EXCEPTION 'original private hosted settlement unavailable';END IF;
    confirmed:=confirmed+r.amount_micro;
   END IF;$totalsconfirmationb$;
 IF (length(extended_body)-length(replace(extended_body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'native hosted constructor anchor refused';END IF;
 extended_body:=replace(extended_body,anchor,replacement);
 anchor:=$totalstruthya$  IF o#>'{context,privateJob}' IS NOT NULL AND o#>'{context,privateJob}'<>'null'::jsonb THEN$totalstruthya$;replacement:=$totalstruthyb$  IF (CASE jsonb_typeof(o#>'{context,privateJob}') WHEN 'null' THEN false WHEN 'boolean' THEN o#>'{context,privateJob}'='true'::jsonb WHEN 'number' THEN o#>'{context,privateJob}'<>'0'::jsonb WHEN 'string' THEN o#>'{context,privateJob}'<>'""'::jsonb WHEN 'object' THEN true WHEN 'array' THEN true ELSE false END) THEN$totalstruthyb$;
 IF (length(extended_body)-length(replace(extended_body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'native hosted constructor anchor refused';END IF;
 extended_body:=replace(extended_body,anchor,replacement);

  END IF;
  IF signature NOT LIKE 'keryx_storage.hosted_totals(%' THEN
 anchor:=$cleanupa$ PERFORM keryx_storage.leave_operation();$cleanupa$;replacement:=$cleanupb$ DELETE FROM public.browser_journal_writer WHERE transaction_id=txid_current();PERFORM keryx_storage.leave_operation();$cleanupb$;
 IF (length(extended_body)-length(replace(extended_body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'native hosted constructor anchor refused';END IF;
 extended_body:=replace(extended_body,anchor,replacement);

  END IF;
  definition:=pg_get_functiondef(function_oid);
  IF (length(definition)-length(replace(definition,original_body,'')))/length(original_body)<>1 THEN RAISE EXCEPTION 'native hosted definition refused';END IF;
  definition:=replace(definition,original_body,extended_body);
  IF octet_length(definition)>32768 THEN RAISE EXCEPTION 'native hosted complete function bound';END IF;
  EXECUTE definition;
  IF signature::regprocedure::oid IS DISTINCT FROM function_oid OR (SELECT prosrc FROM pg_proc WHERE oid=function_oid) IS DISTINCT FROM extended_body
  THEN RAISE EXCEPTION 'native hosted Source preservation refused';END IF;
 END LOOP;
 UPDATE keryx_storage.operations SET relations=(SELECT array_agg(DISTINCT relation ORDER BY relation) FROM unnest(relations||ARRAY['payment_event_originals','private_creator_submissions','private_creator_confirmations']) relation) WHERE operation='hosted_admit_authorization';
 UPDATE keryx_storage.operations SET relations=(SELECT array_agg(DISTINCT relation ORDER BY relation) FROM unnest(relations||ARRAY['payment_event_originals','browser_journal_writer']) relation) WHERE operation='hosted_submit';
 UPDATE keryx_storage.operations SET relations=(SELECT array_agg(DISTINCT relation ORDER BY relation) FROM unnest(relations||ARRAY['payment_event_originals','browser_journal_writer','hosted_treasury_authorizations','private_creator_confirmations']) relation) WHERE operation='hosted_confirm';
 UPDATE keryx_storage.operations SET relations=(SELECT array_agg(DISTINCT relation ORDER BY relation) FROM unnest(relations||ARRAY['payment_event_originals','hosted_treasury_policies']) relation) WHERE operation='hosted_accounting';
END;$hosted_payment_source$;
RESET ROLE;
