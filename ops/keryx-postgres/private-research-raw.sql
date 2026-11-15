-- Fixed private SOURCE paths only. No original is converted wholesale to
-- JSONB; arbitrary strings remain canonical JSON STRING tokens inside metadata.
SET ROLE keryx_owner;
CREATE FUNCTION keryx_storage.private_research_fields(wire text,kind text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE raw bytea;scan bytea;size integer;pos integer;start_at integer;depth integer;code integer;scan_size integer;quote_at integer;slashes integer;
 key_wire text;token text;field text;child text;tag text;units text;canonical text;first_unit integer;last_unit integer;unit text;
 allowed text[];required text[];lasts jsonb:='{}';firsts jsonb:='{}';result jsonb:='{}';value jsonb;number_value double precision;
 numeric_bytes bytea;numeric_text text;prefix text;budget_token text;budget_value numeric;budget_micros bigint;
BEGIN
 IF kind IN('first-submission','first-request') AND(wire IS NULL OR json_typeof(wire::json) IS DISTINCT FROM 'object') THEN RETURN jsonb_build_object('micros',NULL);END IF;
 IF wire IS NULL OR kind IS NULL OR octet_length(wire)>16777216 OR json_typeof(wire::json) IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'private Source raw object unavailable';END IF;
 allowed:=CASE kind
 WHEN 'intent' THEN ARRAY['id','submission','requirement','merchants']
 WHEN 'intent-submission' THEN ARRAY['request','salt','payment']
 WHEN 'first-submission' THEN ARRAY['request','salt','payment']
 WHEN 'payment' THEN ARRAY['authorization','signature']
 WHEN 'authorization' THEN ARRAY['from','to','value','validAfter','validBefore','nonce']
 WHEN 'request' THEN ARRAY['question','budget','researchMode','packageVersion','responseMode','access','model','reasoning']
 WHEN 'first-request' THEN ARRAY['question','budget','researchMode','packageVersion','responseMode','access','model','reasoning']
 WHEN 'reasoning' THEN ARRAY['modelId','provider','wireModel','endpoint','fallback','redirects']
 WHEN 'requirement' THEN ARRAY['scheme','network','asset','amount','payTo','maxTimeoutSeconds','extra']
 WHEN 'extra' THEN ARRAY['name','version','verifyingContract']
 WHEN 'merchants' THEN ARRAY['privatePayee','publicResearchPayee']
 WHEN 'creator' THEN ARRAY['kind','sourceId','itemId','submission']
 WHEN 'creator-submission' THEN ARRAY['authorizationId','authorizationExpiresAt','payer','payee','amountMicros','network','asset']
 WHEN 'confirmation' THEN ARRAY['source','transferStatus','transaction','submission','network','payer','payee','amountMicros','authorizationId']
 WHEN 'result-envelope' THEN ARRAY['serializedRun','identity']
 WHEN 'identity' THEN ARRAY['id','runSha256','intentSha256','owner','questionSha256','budgetMicros','researchMode','workerId','executionStartedAt','paymentStartedAt','paymentSettledAt','paymentConfirmationSha256','sourceSavedAt']
 WHEN 'run' THEN ARRAY['id','question','budget','researchMode','answer'] END;
 IF allowed IS NULL THEN RAISE EXCEPTION 'private Source raw context refused';END IF;
 raw:=convert_to(wire,'UTF8');size:=octet_length(raw);pos:=0;
 WHILE pos<size AND get_byte(raw,pos) IN(9,10,13,32) LOOP pos:=pos+1;END LOOP;pos:=pos+1;
 LOOP
  WHILE pos<size AND get_byte(raw,pos) IN(9,10,13,32) LOOP pos:=pos+1;END LOOP;
  EXIT WHEN pos<size AND get_byte(raw,pos)=125;
  IF pos>=size OR get_byte(raw,pos)<>34 THEN RAISE EXCEPTION 'private Source raw key refused';END IF;
  start_at:=pos;pos:=pos+1;
  WHILE pos<size LOOP
   scan:=substring(raw FROM pos+1 FOR 4096);scan_size:=octet_length(scan);quote_at:=position(decode('22','hex') IN scan);
   IF quote_at>0 THEN scan:=substring(scan FROM 1 FOR quote_at-1);END IF;
   slashes:=CASE WHEN octet_length(scan)=0 THEN 0 WHEN get_byte(scan,octet_length(scan)-1)=92 THEN (octet_length(scan)*2-length(regexp_replace(encode(scan,'hex'),'(5c)+$','')))/2 ELSE 0 END;
   IF quote_at>0 AND slashes%2=0 THEN pos:=pos+quote_at-1;EXIT;ELSIF quote_at>0 THEN pos:=pos+quote_at;
   ELSE pos:=pos+scan_size-slashes%2;IF scan_size=1 AND slashes%2=1 THEN pos:=pos+2;END IF;END IF;
  END LOOP;
  IF pos>=size THEN RAISE EXCEPTION 'private Source raw key refused';END IF;
  key_wire:=convert_from(substring(raw FROM start_at+1 FOR pos-start_at+1),'UTF8');pos:=pos+1;
  WHILE pos<size AND get_byte(raw,pos) IN(9,10,13,32) LOOP pos:=pos+1;END LOOP;pos:=pos+1;
  WHILE pos<size AND get_byte(raw,pos) IN(9,10,13,32) LOOP pos:=pos+1;END LOOP;start_at:=pos;depth:=0;
  WHILE pos<size LOOP
   code:=get_byte(raw,pos);
   IF code=34 THEN
    pos:=pos+1;
    WHILE pos<size LOOP
     scan:=substring(raw FROM pos+1 FOR 4096);scan_size:=octet_length(scan);quote_at:=position(decode('22','hex') IN scan);
     IF quote_at>0 THEN scan:=substring(scan FROM 1 FOR quote_at-1);END IF;
     slashes:=CASE WHEN octet_length(scan)=0 THEN 0 WHEN get_byte(scan,octet_length(scan)-1)=92 THEN (octet_length(scan)*2-length(regexp_replace(encode(scan,'hex'),'(5c)+$','')))/2 ELSE 0 END;
     IF quote_at>0 AND slashes%2=0 THEN pos:=pos+quote_at-1;EXIT;ELSIF quote_at>0 THEN pos:=pos+quote_at;
     ELSE pos:=pos+scan_size-slashes%2;IF scan_size=1 AND slashes%2=1 THEN pos:=pos+2;END IF;END IF;
    END LOOP;
    IF pos>=size THEN RAISE EXCEPTION 'private Source raw value refused';END IF;
   ELSIF code IN(123,91) THEN depth:=depth+1;
   ELSIF code IN(125,93) THEN IF depth=0 THEN EXIT;END IF;depth:=depth-1;
   ELSIF code=44 AND depth=0 THEN EXIT;END IF;pos:=pos+1;
  END LOOP;
  IF pos>=size THEN RAISE EXCEPTION 'private Source raw member refused';END IF;
  field:=NULL;
  -- Run extensions are unrestricted SOURCE data. Large unrelated key tokens
  -- are skipped, not decoded or normalized; all selected key spellings fit.
  IF kind IN('first-submission','first-request') OR octet_length(key_wire)<=512 THEN
   value:=keryx_storage.source_scalar_text(key_wire,'js-string');canonical:=value->>'wire';
   IF kind IN('first-submission','first-request') THEN
    units:=value->>'utf16Hex';token:='"';
    FOR first_unit IN 1..length(units)/4 LOOP unit:=substring(units FROM first_unit*4-3 FOR 4);EXIT WHEN unit='0000';token:=token||E'\\u'||unit;END LOOP;
    canonical:=keryx_storage.source_scalar_text(token||'"','js-string')->>'wire';
   END IF;
   SELECT a INTO field FROM unnest(allowed) a WHERE to_json(a)::text=canonical;
  END IF;
  IF field IS NULL AND kind NOT IN('run','first-submission','first-request') THEN RAISE EXCEPTION 'private Source raw key refused';END IF;
  IF field IS NOT NULL THEN
   token:=btrim(convert_from(substring(raw FROM start_at+1 FOR pos-start_at),'UTF8'),E' \t\r\n');
   IF NOT firsts?field THEN firsts:=firsts||jsonb_build_object(field,token);END IF;
   lasts:=lasts||jsonb_build_object(field,token);
  END IF;
  IF get_byte(raw,pos)=125 THEN EXIT;END IF;pos:=pos+1;
 END LOOP;
 IF kind='first-submission' THEN RETURN keryx_storage.private_research_fields(firsts->>'request','first-request');END IF;
 IF kind='first-request' THEN
  budget_token:=firsts->>'budget';IF budget_token IS NULL OR json_typeof(budget_token::json)='null' THEN RETURN jsonb_build_object('micros',NULL);END IF;
  numeric_bytes:=decode(keryx_storage.source_scalar_text(budget_token,'json1-value')->>'hex','hex');numeric_text:='';
  -- SQLite arithmetic uses a numeric prefix for TEXT, zero for other text,
  -- and CAST(round(real) AS INTEGER) saturates signed int64 on overflow.
  FOR pos IN 0..octet_length(numeric_bytes)-1 LOOP code:=get_byte(numeric_bytes,pos);EXIT WHEN code NOT IN(9,10,11,12,13,32,43,45,46,69,101) AND code NOT BETWEEN 48 AND 57;numeric_text:=numeric_text||chr(code);END LOOP;
  prefix:=substring(numeric_text FROM '^[[:space:]]*[+-]?(?:[0-9]+(?:[.][0-9]*)?|[.][0-9]+)(?:[eE][+-]?[0-9]+)?');
  IF prefix IS NULL THEN budget_value:=CASE WHEN json_typeof(budget_token::json)='number' AND encode(numeric_bytes,'hex') IN('496e66','496e66696e697479') THEN 9223372036854775807 WHEN json_typeof(budget_token::json)='number' AND encode(numeric_bytes,'hex') IN('2d496e66','2d496e66696e697479') THEN -9223372036854775808 ELSE 0 END;
  ELSE
   BEGIN
    number_value:=prefix::double precision*1000000;
    budget_value:=CASE WHEN number_value>=9223372036854775807::double precision THEN 9223372036854775807 WHEN number_value<=-9223372036854775808::double precision THEN -9223372036854775808 WHEN number_value<0 THEN ceil(number_value-0.5) ELSE floor(number_value+0.5) END;
   EXCEPTION WHEN numeric_value_out_of_range THEN budget_value:=CASE WHEN prefix ~ '[eE]-' THEN 0 WHEN left(ltrim(prefix),1)='-' THEN -9223372036854775808 ELSE 9223372036854775807 END;END;
  END IF;
  budget_micros:=greatest(-9223372036854775808::numeric,least(9223372036854775807::numeric,budget_value))::bigint;
  RETURN jsonb_build_object('micros',budget_micros::text);
 END IF;
 required:=CASE WHEN kind='request' THEN array_remove(allowed,'reasoning') WHEN kind='confirmation' THEN ARRAY['source','transaction'] ELSE allowed END;
 IF EXISTS(SELECT 1 FROM unnest(required) a WHERE NOT lasts?a) THEN RAISE EXCEPTION 'private Source raw field unavailable';END IF;
 FOREACH field IN ARRAY allowed LOOP
  IF NOT lasts?field THEN CONTINUE;END IF;token:=lasts->>field;tag:=json_typeof(token::json);
  child:=CASE
   WHEN kind='intent' AND field IN('submission','requirement','merchants') THEN CASE field WHEN 'submission' THEN 'intent-submission' ELSE field END
   WHEN kind='intent-submission' AND field IN('request','payment') THEN field
   WHEN kind='payment' AND field='authorization' THEN 'authorization'
   WHEN kind='request' AND field='reasoning' THEN 'reasoning'
   WHEN kind='requirement' AND field='extra' THEN 'extra'
   WHEN kind IN('creator','confirmation') AND field='submission' THEN 'creator-submission'
   WHEN kind='result-envelope' AND field='identity' THEN 'identity' END;
  IF child IS NOT NULL THEN value:=keryx_storage.private_research_fields(token,child);
  ELSIF field IN('budget','maxTimeoutSeconds') THEN
   IF tag<>'number' THEN RAISE EXCEPTION 'private Source number refused';END IF;
   number_value:=token::double precision;IF number_value::text IN('NaN','Infinity','-Infinity') OR field='budget' AND(number_value<=0 OR number_value>0.5 OR abs(number_value*1000000-floor(number_value*1000000+0.5))>=0.00000001) THEN RAISE EXCEPTION 'private Source number refused';END IF;value:=to_jsonb(number_value);
  ELSIF kind='run' AND field='answer' THEN
   IF tag<>'string' THEN RAISE EXCEPTION 'private Source answer refused';END IF;value:='true';
  ELSIF field='serializedRun' THEN
   -- Decode this ONE string token, never its contained JSON/body. Genuine
   -- Source snapshotRun produces JSON TEXT (NUL/lones occur as backslash
   -- escapes within that TEXT), including valid >4MiB UTF8 private snapshots.
   IF tag<>'string' THEN RAISE EXCEPTION 'private Source run wire refused';END IF;value:=to_jsonb(token::json#>>'{}');
  ELSE
   IF tag='null' AND field IN('model','itemId','sourceSavedAt') THEN value:=CASE WHEN field='itemId' THEN to_jsonb('null'::text) ELSE 'null'::jsonb END;
   ELSE
    IF tag<>'string' THEN RAISE EXCEPTION 'private Source string refused';END IF;
    value:=keryx_storage.source_scalar_text(token,'js-string');canonical:=value->>'wire';units:=value->>'utf16Hex';
    IF field='question' AND kind='request' THEN
     first_unit:=1;last_unit:=length(units)/4;
     WHILE first_unit<=last_unit AND substring(units FROM first_unit*4-3 FOR 4)=ANY(ARRAY['0009','000a','000b','000c','000d','0020','00a0','1680','2000','2001','2002','2003','2004','2005','2006','2007','2008','2009','200a','2028','2029','202f','205f','3000','feff']) LOOP first_unit:=first_unit+1;END LOOP;
     WHILE last_unit>=first_unit AND substring(units FROM last_unit*4-3 FOR 4)=ANY(ARRAY['0009','000a','000b','000c','000d','0020','00a0','1680','2000','2001','2002','2003','2004','2005','2006','2007','2008','2009','200a','2028','2029','202f','205f','3000','feff']) LOOP last_unit:=last_unit-1;END LOOP;
     token:='"';FOR pos IN first_unit..last_unit LOOP token:=token||E'\\u'||substring(units FROM pos*4-3 FOR 4);END LOOP;
     canonical:=keryx_storage.source_scalar_text(token||'"','js-string')->>'wire';
    END IF;
    IF field IN('question','sourceId','itemId') THEN
     IF field IN('sourceId','itemId') AND(length(units)<4 OR length(units)>1024) OR field='question' AND kind='request' AND last_unit-first_unit+1 NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'private Source string length refused';END IF;
     value:=to_jsonb(canonical);
    ELSE
     IF units !~ '^(00(0[1-9a-f]|[1-6][0-9a-f]|7[0-f]))*$' THEN RAISE EXCEPTION 'private Source ASCII scalar refused';END IF;
     value:=canonical::jsonb;
     IF field IN('from','to','asset','payTo','verifyingContract','privatePayee','publicResearchPayee','payer','payee','authorizationId') THEN value:=to_jsonb(lower(value#>>'{}'));END IF;
    END IF;
   END IF;
  END IF;
  result:=result||jsonb_build_object(field,value);
 END LOOP;
 IF kind='intent' THEN result:=result||jsonb_build_object('_budgetSql',keryx_storage.private_research_fields(firsts->>'submission','first-submission')->'micros');END IF;
 IF kind='confirmation' THEN
  value:='{}';FOREACH field IN ARRAY ARRAY['source','transferStatus','transaction','submission'] LOOP
   value:=value||jsonb_build_object(field,CASE WHEN firsts?field THEN keryx_storage.source_scalar_text(firsts->>field,'json1-value')->'hex' ELSE 'null'::jsonb END);
  END LOOP;result:=result||jsonb_build_object('_sql1',value);
 END IF;
 RETURN result;
END;$$;
REVOKE ALL ON FUNCTION keryx_storage.private_research_fields(text,text) FROM PUBLIC,anon,authenticated,service_role,keryx_app,keryx_reader;
RESET ROLE;
