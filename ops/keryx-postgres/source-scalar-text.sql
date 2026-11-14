-- Fresh SOURCE only. One private byte/token validator; no JSON getters touch
-- an original that can contain escaped NUL or unpaired UTF-16 surrogates.
SET ROLE keryx_owner;
CREATE FUNCTION keryx_storage.source_scalar_text(wire text,mode text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE raw bytea;size integer;pos integer;start_at integer;end_at integer;key_wire text;value_wire text;
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
    code:=get_byte(raw,pos);IF code=92 THEN pos:=pos+2;ELSIF code=34 THEN EXIT;ELSE pos:=pos+1;END IF;
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
     WHILE pos<size LOOP code:=get_byte(raw,pos);IF code=92 THEN pos:=pos+2;ELSIF code=34 THEN EXIT;ELSE pos:=pos+1;END IF;END LOOP;
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
    WHEN '6964' THEN 'id' WHEN '637265617465644174' THEN 'createdAt' WHEN '7175657374696f6e' THEN 'question' WHEN '616e73776572' THEN 'answer'
    WHEN '656e67696e65' THEN 'engine' WHEN '706172656e744964' THEN 'parentId' WHEN '61736b6572' THEN 'asker' WHEN '6f726967696e' THEN 'origin'
    WHEN '6d6370436c69656e74' THEN 'mcpClient' WHEN '7061796d656e744d6f6465' THEN 'paymentMode' WHEN '636f6e666964656e6365' THEN 'confidence'
    WHEN '6c6576656c' THEN 'level' WHEN '636c61696d' THEN 'claim' WHEN '616374696f6e' THEN 'action' WHEN '6174' THEN 'at' WHEN '65766964656e6365' THEN 'evidence' END;
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
