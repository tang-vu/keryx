-- Fresh SOURCE only. One private byte/token validator; no JSON getters touch
-- an original that can contain escaped NUL or unpaired UTF-16 surrogates.
SET ROLE keryx_owner;
CREATE FUNCTION keryx_storage.source_scalar_text(wire text,mode text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE raw bytea;scan bytea;scan_size integer;quote_at integer;slashes integer;interior text;size integer;pos integer;start_at integer;end_at integer;key_wire text;value_wire text;
 key_hex text;root_key_parts text[]:=ARRAY[]::text[];root_key_chunk text:='';root_key_count integer:=0;
 depth integer;code integer;unit integer;next_unit integer;source_unit integer;json_unit integer;escape_code integer;
 result jsonb:='{}'::jsonb;source_bytes bytea:=''::bytea;json_bytes bytea:=''::bytea;
 source_chunk bytea:=''::bytea;json_chunk bytea:=''::bytea;source_parts bytea[]:=ARRAY[]::bytea[];json_parts bytea[]:=ARRAY[]::bytea[];
 wire_parts text[]:=ARRAY[]::text[];wire_chunk text:='';encoded bytea;source_encoded bytea;json_encoded bytea;scalar_wire text;
BEGIN
 IF wire IS NULL OR mode IS NULL OR mode NOT IN('tokens','scalar') OR octet_length(wire)>4000000
 THEN RAISE EXCEPTION 'Source scalar token unavailable';END IF;
 raw:=convert_to(wire,'UTF8');size:=octet_length(raw);
 IF mode='tokens' THEN
  -- Casting validates JSON syntax without decoding any of its string values.
  IF json_typeof(wire::json) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Source scalar root unavailable';END IF;
  pos:=0;WHILE pos<size AND get_byte(raw,pos) IN(9,10,13,32) LOOP pos:=pos+1;END LOOP;
  IF pos>=size OR get_byte(raw,pos)<>123 THEN RAISE EXCEPTION 'Source scalar root unavailable';END IF;pos:=pos+1;
  LOOP
   WHILE pos<size AND get_byte(raw,pos) IN(9,10,13,32) LOOP pos:=pos+1;END LOOP;
   EXIT WHEN pos<size AND get_byte(raw,pos)=125;
   IF pos>=size OR get_byte(raw,pos)<>34 THEN RAISE EXCEPTION 'Source scalar key unavailable';END IF;
   start_at:=pos;pos:=pos+1;
   WHILE pos<size LOOP
    scan:=substring(raw FROM pos+1 FOR 4096);scan_size:=octet_length(scan);quote_at:=position(decode('22','hex') IN scan);
    IF quote_at>0 THEN scan:=substring(scan FROM 1 FOR quote_at-1);END IF;
    slashes:=CASE WHEN octet_length(scan)=0 THEN 0 WHEN get_byte(scan,octet_length(scan)-1)=92 THEN (octet_length(scan)*2-length(regexp_replace(encode(scan,'hex'),'(5c)+$','')))/2 ELSE 0 END;
    IF quote_at>0 AND slashes%2=0 THEN pos:=pos+quote_at-1;EXIT;
    ELSIF quote_at>0 THEN pos:=pos+quote_at;
    ELSE pos:=pos+scan_size-slashes%2;IF scan_size=1 AND slashes%2=1 THEN pos:=pos+2;END IF;END IF;
   END LOOP;
   IF pos>=size THEN RAISE EXCEPTION 'Source scalar key unavailable';END IF;
   key_wire:=convert_from(substring(raw FROM start_at+1 FOR pos-start_at+1),'UTF8');pos:=pos+1;
   WHILE pos<size AND get_byte(raw,pos) IN(9,10,13,32) LOOP pos:=pos+1;END LOOP;
   IF pos>=size OR get_byte(raw,pos)<>58 THEN RAISE EXCEPTION 'Source scalar member unavailable';END IF;pos:=pos+1;
   WHILE pos<size AND get_byte(raw,pos) IN(9,10,13,32) LOOP pos:=pos+1;END LOOP;
   start_at:=pos;depth:=0;
   WHILE pos<size LOOP
    code:=get_byte(raw,pos);
    IF code=34 THEN
     pos:=pos+1;
     WHILE pos<size LOOP
      scan:=substring(raw FROM pos+1 FOR 4096);scan_size:=octet_length(scan);quote_at:=position(decode('22','hex') IN scan);
      IF quote_at>0 THEN scan:=substring(scan FROM 1 FOR quote_at-1);END IF;
      slashes:=CASE WHEN octet_length(scan)=0 THEN 0 WHEN get_byte(scan,octet_length(scan)-1)=92 THEN (octet_length(scan)*2-length(regexp_replace(encode(scan,'hex'),'(5c)+$','')))/2 ELSE 0 END;
      IF quote_at>0 AND slashes%2=0 THEN pos:=pos+quote_at-1;EXIT;
      ELSIF quote_at>0 THEN pos:=pos+quote_at;
      ELSE pos:=pos+scan_size-slashes%2;IF scan_size=1 AND slashes%2=1 THEN pos:=pos+2;END IF;END IF;
     END LOOP;
     IF pos>=size THEN RAISE EXCEPTION 'Source scalar value unavailable';END IF;
    ELSIF code IN(123,91) THEN depth:=depth+1;
    ELSIF code IN(125,93) THEN IF depth=0 THEN EXIT;END IF;depth:=depth-1;
    ELSIF code=44 AND depth=0 THEN EXIT;
    END IF;
    pos:=pos+1;
   END LOOP;
   IF pos>=size THEN RAISE EXCEPTION 'Source scalar member unavailable';END IF;
   -- Decode keys through this same scalar byte parser. Unknown malformed
   -- Unicode keys remain opaque hex; no PG getter or UTF-8 conversion touches
   -- them. Known escaped ASCII keys select exactly the same raw value token.
   key_hex:=keryx_storage.source_scalar_text(key_wire,'scalar')->>'jsonHex';
   root_key_chunk:=root_key_chunk||CASE WHEN root_key_count=0 THEN '' ELSE ',' END||to_json(key_hex)::text;root_key_count:=root_key_count+1;
   IF octet_length(root_key_chunk)>=4096 THEN root_key_parts:=array_append(root_key_parts,root_key_chunk);root_key_chunk:='';END IF;
   key_wire:=CASE key_hex
    WHEN '6964' THEN 'id'
    WHEN '637265617465644174' THEN 'createdAt'
    WHEN '7175657374696f6e' THEN 'question'
    WHEN '616e73776572' THEN 'answer'
    WHEN '656e67696e65' THEN 'engine'
    WHEN '706172656e744964' THEN 'parentId'
    WHEN '61736b6572' THEN 'asker'
    WHEN '6f726967696e' THEN 'origin'
    WHEN '6d6370436c69656e74' THEN 'mcpClient'
    WHEN '7061796d656e744d6f6465' THEN 'paymentMode'
    WHEN '636f6e666964656e6365' THEN 'confidence'
    WHEN '6c6576656c' THEN 'level'
    WHEN '636c61696d' THEN 'claim'
    WHEN '616374696f6e' THEN 'action'
    WHEN '6174' THEN 'at'
    WHEN '65766964656e6365' THEN 'evidence'
    WHEN '636f6e74656e74' THEN 'content'
    WHEN '64656c69766572794b696e64' THEN 'deliveryKind'
    WHEN '6c696e6b' THEN 'link'
    WHEN '7075626c69736865644174' THEN 'publishedAt'
    WHEN '73756d6d617279' THEN 'summary'
    WHEN '7469746c65' THEN 'title'
    WHEN '6e6f6e6365' THEN 'nonce'
    WHEN '73657373696f6e4964' THEN 'sessionId'
    WHEN '726571756573744964' THEN 'requestId'
    WHEN '71756572794964' THEN 'queryId'
    WHEN '6772616e7445706f6368' THEN 'grantEpoch'
    WHEN '7369676e6572' THEN 'signer'
    WHEN '6e6574776f726b' THEN 'network'
    WHEN '746f6b656e' THEN 'token'
    WHEN '67617465776179436f6e7472616374' THEN 'gatewayContract'
    WHEN '736f757263654964' THEN 'sourceId'
    WHEN '6f666665724964' THEN 'offerId'
    WHEN '6b696e64' THEN 'kind'
    WHEN '7061796565' THEN 'payee'
    WHEN '7061796572' THEN 'payer'
    WHEN '616d6f756e7455736463' THEN 'amountUsdc'
    WHEN '617574686f72697a6174696f6e4964' THEN 'authorizationId'
    WHEN '617574686f72697a6174696f6e5068617365' THEN 'authorizationPhase'
    WHEN '617574686f72697a6174696f6e457870697265734174' THEN 'authorizationExpiresAt'
    WHEN '736574746c656d656e74537461747573' THEN 'settlementStatus'
    WHEN '736574746c6564' THEN 'settled'
    WHEN '747848617368' THEN 'txHash'
    WHEN '736f75726365436c61696d' THEN 'sourceClaim'
    WHEN '6974656d' THEN 'item'
    WHEN '6a6f75726e616c' THEN 'journal'
    WHEN '70726f746f636f6c' THEN 'protocol'
    WHEN '736f75726365436f6e74657874' THEN 'sourceContext'
    WHEN '736f75726365436f6e74657874446967657374' THEN 'sourceContextDigest'
    WHEN '617574686f72697a6174696f6e' THEN 'authorization'
    WHEN '76616c69644166746572' THEN 'validAfter'
    WHEN '76616c69644265666f7265' THEN 'validBefore'
    WHEN '68656164657248617368' THEN 'headerHash'
    WHEN '736368656d65' THEN 'scheme'
    WHEN '6173736574' THEN 'asset'
    WHEN '706179546f' THEN 'payTo'
    WHEN '616d6f756e74' THEN 'amount'
    WHEN '6d617854696d656f75745365636f6e6473' THEN 'maxTimeoutSeconds'
    WHEN '6578747261' THEN 'extra'
    WHEN '6e616d65' THEN 'name'
    WHEN '76657273696f6e' THEN 'version'
    WHEN '766572696679696e67436f6e7472616374' THEN 'verifyingContract'
    WHEN '637265617465645f6174' THEN 'created_at'
    WHEN '706172656e745f6964' THEN 'parent_id'
    WHEN '6d63705f636c69656e74' THEN 'mcp_client'
    WHEN '7061796d656e745f6d6f6465' THEN 'payment_mode'
    WHEN '64656c69766572795f6b696e64' THEN 'delivery_kind'
    WHEN '7075626c69736865645f6174' THEN 'published_at'
    WHEN '73657373696f6e5f6964' THEN 'session_id'
    WHEN '726571756573745f6964' THEN 'request_id'
    WHEN '71756572795f6964' THEN 'query_id'
    WHEN '6772616e745f65706f6368' THEN 'grant_epoch'
    WHEN '676174657761795f636f6e7472616374' THEN 'gateway_contract'
    WHEN '736f757263655f6964' THEN 'source_id'
    WHEN '6f666665725f6964' THEN 'offer_id'
    WHEN '616d6f756e745f75736463' THEN 'amount_usdc'
    WHEN '617574686f72697a6174696f6e5f6964' THEN 'authorization_id'
    WHEN '617574686f72697a6174696f6e5f7068617365' THEN 'authorization_phase'
    WHEN '617574686f72697a6174696f6e5f657870697265735f6174' THEN 'authorization_expires_at'
    WHEN '736574746c656d656e745f737461747573' THEN 'settlement_status'
    WHEN '74785f68617368' THEN 'tx_hash'
    WHEN '736f757263655f636c61696d' THEN 'source_claim'
    WHEN '736f757263655f636f6e74657874' THEN 'source_context'
    WHEN '736f757263655f636f6e746578745f646967657374' THEN 'source_context_digest'
    WHEN '76616c69645f6166746572' THEN 'valid_after'
    WHEN '76616c69645f6265666f7265' THEN 'valid_before'
    WHEN '6865616465725f68617368' THEN 'header_hash'
    WHEN '7061795f746f' THEN 'pay_to'
    WHEN '6d61785f74696d656f75745f7365636f6e6473' THEN 'max_timeout_seconds'
    WHEN '766572696679696e675f636f6e7472616374' THEN 'verifying_contract'
    WHEN '736f757263655f6e616d65' THEN 'source_name'
    WHEN '776569676874' THEN 'weight'
    WHEN '726174696f6e616c65' THEN 'rationale'
    WHEN '6974656d5f6964' THEN 'item_id'
    WHEN '6974656d5f7469746c65' THEN 'item_title'
    WHEN '6974656d5f75726c' THEN 'item_url'
    WHEN '636f6e74656e745f76657273696f6e' THEN 'content_version'
    WHEN '6974656d5f7075626c69736865645f6174' THEN 'item_published_at'
    WHEN '6c6973745f70726963655f75736463' THEN 'list_price_usdc'
    WHEN '7061796d656e74436f6e74657874' THEN 'paymentContext'
    WHEN '726571756972656d656e7473' THEN 'requirements'
    WHEN '7061796d656e74' THEN 'payment'
    WHEN '71756572794e616d657370616365' THEN 'queryNamespace'
    WHEN '7061796d656e745f636f6e74657874' THEN 'payment_context'
    WHEN '71756572795f6e616d657370616365' THEN 'query_namespace'
    WHEN '636f6e74657874' THEN 'context'
    WHEN '707269766174654a6f62' THEN 'privateJob'
    WHEN '707269766174655f6a6f62' THEN 'private_job'
    WHEN '7472616e73616374696f6e' THEN 'transaction'
    WHEN '7375626d697373696f6e' THEN 'submission'
    WHEN '6c696e6b6564536f757263654964' THEN 'linkedSourceId'
    WHEN '6c696e6b65645f736f757263655f6964' THEN 'linked_source_id'
    WHEN '6f726967696e616c46756c66696c6c6d656e74' THEN 'originalFulfillment'
    WHEN '737562436c61696d73' THEN 'subClaims'
    WHEN '746f74616c5370656e74' THEN 'totalSpent'
    WHEN '746f74616c546f43726561746f7273' THEN 'totalToCreators'
    WHEN '70656e64696e675370656e6455736463' THEN 'pendingSpendUsdc'
    WHEN '7061796d656e74417474656d707473' THEN 'paymentAttempts'
    WHEN '736574746c65645061796d656e7473' THEN 'settledPayments'
    WHEN '70656e64696e675061796d656e7473' THEN 'pendingPayments'
    WHEN '72657472794f66' THEN 'retryOf'
    WHEN '6475726174696f6e4d73' THEN 'durationMs'
    WHEN '72657365617263684d6f6465' THEN 'researchMode'
    WHEN '627564676574' THEN 'budget'
    WHEN '666f726d6174' THEN 'format'
    WHEN '636c61696d4964' THEN 'claimId'
    WHEN '6f726967696e616c4661696c757265536861323536' THEN 'originalFailureSha256'
    WHEN '617574686f72697479536861323536' THEN 'authoritySha256'
    WHEN '70726f76696465724c6564676572536861323536' THEN 'providerLedgerSha256'
    WHEN '6e6f4e6577496e626f756e645061796d656e74' THEN 'noNewInboundPayment'
    WHEN '696e707574536861323536' THEN 'inputSha256'
    WHEN '6f726967696e616c50726f766964657242696c6c696e67' THEN 'originalProviderBilling'
   END;
   IF key_wire IS NOT NULL THEN
    value_wire:=btrim(convert_from(substring(raw FROM start_at+1 FOR pos-start_at),'UTF8'),E' \t\r\n');
    -- JSON.parse's last matching root member wins. _rootKeys still retains
    -- every decoded key in source order for callers with a strict allowlist.
    result:=result||jsonb_build_object(key_wire,value_wire);
   END IF;
   IF get_byte(raw,pos)=125 THEN EXIT;END IF;
   IF get_byte(raw,pos)<>44 THEN RAISE EXCEPTION 'Source scalar member unavailable';END IF;pos:=pos+1;
  END LOOP;
  root_key_parts:=array_append(root_key_parts,root_key_chunk);
  RETURN result||jsonb_build_object('_rootKeys',('['||array_to_string(root_key_parts,'')||']')::jsonb);
 END IF;
 IF json_typeof(wire::json) IS DISTINCT FROM 'string' OR size<2 OR get_byte(raw,0)<>34 OR get_byte(raw,size-1)<>34
 THEN RAISE EXCEPTION 'Source scalar string unavailable';END IF;
 -- Literal and NUL-only strings use bounded C byte operations rather than
 -- one PL/pgSQL iteration per character. The prior JSON syntax check forbids
 -- raw NUL/control bytes; decode escape introduces only validated zero bytes.
 interior:=convert_from(substring(raw FROM 2 FOR size-2),'UTF8');
 IF position(decode('5c','hex') IN raw)=0 THEN
  source_bytes:=convert_to(interior,'UTF8');RETURN jsonb_build_object('sourceHex',encode(source_bytes,'hex'),'jsonHex',encode(source_bytes,'hex'),'shadow',interior);
 ELSIF position(decode('5c','hex') IN convert_to(replace(interior,$nul$\u0000$nul$,''),'UTF8'))=0 THEN
  source_bytes:=decode(replace(interior,$nul$\u0000$nul$,$zero$\000$zero$),'escape');
  RETURN jsonb_build_object('sourceHex',encode(source_bytes,'hex'),'jsonHex',encode(source_bytes,'hex'),'shadow',wire);
 END IF;
 pos:=1;start_at:=pos;
 WHILE pos<size-1 LOOP
  code:=get_byte(raw,pos);
  IF code<>92 THEN pos:=pos+1;CONTINUE;END IF;
  -- Append whole literal UTF-8 runs. Chunking bounds allocation even for a
  -- maximally escaped permitted original; no per-character unbounded array.
  IF pos>start_at THEN
   encoded:=substring(raw FROM start_at+1 FOR pos-start_at);
   source_chunk:=source_chunk||encoded;json_chunk:=json_chunk||encoded;wire_chunk:=wire_chunk||convert_from(encoded,'UTF8');
  END IF;
  end_at:=pos+2;escape_code:=get_byte(raw,pos+1);unit:=NULL;json_unit:=NULL;
  IF escape_code=117 THEN
   IF pos+5>=size-1 THEN RAISE EXCEPTION 'Source scalar escape unavailable';END IF;
   encoded:=decode(convert_from(substring(raw FROM pos+3 FOR 4),'UTF8'),'hex');unit:=get_byte(encoded,0)*256+get_byte(encoded,1);end_at:=pos+6;
   IF unit BETWEEN 55296 AND 56319 AND end_at+5<size-1 AND get_byte(raw,end_at)=92 AND get_byte(raw,end_at+1)=117 THEN
    encoded:=decode(convert_from(substring(raw FROM end_at+3 FOR 4),'UTF8'),'hex');next_unit:=get_byte(encoded,0)*256+get_byte(encoded,1);
    IF next_unit BETWEEN 56320 AND 57343 THEN unit:=65536+(unit-55296)*1024+next_unit-56320;end_at:=end_at+6;END IF;
   END IF;
   json_unit:=unit;source_unit:=CASE WHEN unit BETWEEN 55296 AND 57343 THEN 65533 ELSE unit END;
  ELSE
   unit:=CASE escape_code WHEN 34 THEN 34 WHEN 47 THEN 47 WHEN 92 THEN 92 WHEN 98 THEN 8 WHEN 102 THEN 12 WHEN 110 THEN 10 WHEN 114 THEN 13 WHEN 116 THEN 9 END;
   IF unit IS NULL THEN RAISE EXCEPTION 'Source scalar escape unavailable';END IF;source_unit:=unit;json_unit:=unit;
  END IF;
  -- chr(0) and chr(surrogate) are deliberately never called.
  IF source_unit=0 THEN source_encoded:=decode('00','hex');ELSE source_encoded:=convert_to(chr(source_unit),'UTF8');END IF;
  IF json_unit BETWEEN 55296 AND 57343 THEN
   json_encoded:=decode(lpad(to_hex(224|(json_unit>>12)),2,'0')||lpad(to_hex(128|((json_unit>>6)&63)),2,'0')||lpad(to_hex(128|(json_unit&63)),2,'0'),'hex');
  ELSIF json_unit=0 THEN json_encoded:=decode('00','hex');ELSE json_encoded:=convert_to(chr(json_unit),'UTF8');END IF;
  source_chunk:=source_chunk||source_encoded;json_chunk:=json_chunk||json_encoded;
  wire_chunk:=wire_chunk||CASE WHEN unit BETWEEN 55296 AND 57343 THEN chr(65533) ELSE convert_from(substring(raw FROM pos+1 FOR end_at-pos),'UTF8') END;
  IF octet_length(source_chunk)>=4096 OR octet_length(json_chunk)>=4096 OR octet_length(wire_chunk)>=4096 THEN
   source_parts:=array_append(source_parts,source_chunk);json_parts:=array_append(json_parts,json_chunk);wire_parts:=array_append(wire_parts,wire_chunk);
   source_chunk:=''::bytea;json_chunk:=''::bytea;wire_chunk:='';
  END IF;
  pos:=end_at;start_at:=pos;
 END LOOP;
 IF pos>start_at THEN encoded:=substring(raw FROM start_at+1 FOR pos-start_at);source_chunk:=source_chunk||encoded;json_chunk:=json_chunk||encoded;wire_chunk:=wire_chunk||convert_from(encoded,'UTF8');END IF;
 source_parts:=array_append(source_parts,source_chunk);json_parts:=array_append(json_parts,json_chunk);wire_parts:=array_append(wire_parts,wire_chunk);
 SELECT decode(coalesce(string_agg(encode(part,'hex'),''),''),'hex') INTO source_bytes FROM unnest(source_parts) part;
 SELECT decode(coalesce(string_agg(encode(part,'hex'),''),''),'hex') INTO json_bytes FROM unnest(json_parts) part;
 scalar_wire:='"'||array_to_string(wire_parts,'')||'"';
 RETURN jsonb_build_object('sourceHex',encode(source_bytes,'hex'),'jsonHex',encode(json_bytes,'hex'),
  'shadow',CASE WHEN position(decode('00','hex') IN source_bytes)>0 THEN scalar_wire ELSE convert_from(source_bytes,'UTF8') END);
END;$$;
REVOKE ALL ON FUNCTION keryx_storage.source_scalar_text(text,text) FROM PUBLIC,anon,authenticated,service_role,keryx_app,keryx_reader;
RESET ROLE;
