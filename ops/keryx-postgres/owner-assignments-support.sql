SET ROLE keryx_owner;
-- Closed metadata only. No original, question, answer or provider proof enters
-- this canonicalizer. All numeric fields are safe JS integers, never money.
CREATE FUNCTION keryx_storage.owner269_json(v jsonb,depth integer DEFAULT 0) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE result text;n numeric;
BEGIN
 IF v IS NULL OR depth>16 OR octet_length(v::text)>65536 THEN RAISE EXCEPTION 'assignment_unavailable';END IF;
 CASE jsonb_typeof(v)
  WHEN 'null' THEN RETURN 'null';
  WHEN 'boolean','string' THEN RETURN v::text;
  WHEN 'number' THEN n:=(v::text)::numeric;IF n<>trunc(n) OR abs(n)>9007199254740991 THEN RAISE EXCEPTION 'assignment_unavailable';END IF;RETURN trunc(n)::text;
  WHEN 'array' THEN SELECT '['||coalesce(string_agg(keryx_storage.owner269_json(x,depth+1),',' ORDER BY ordinal),'')||']' INTO result FROM jsonb_array_elements(v) WITH ORDINALITY a(x,ordinal);
  WHEN 'object' THEN SELECT '{'||coalesce(string_agg(to_json(k)::text||':'||keryx_storage.owner269_json(x,depth+1),',' ORDER BY k COLLATE "C"),'')||'}' INTO result FROM jsonb_each(v)a(k,x);
  ELSE RAISE EXCEPTION 'assignment_unavailable';
 END CASE;RETURN result;
END;$$;
CREATE FUNCTION keryx_storage.owner269_keys(v jsonb,required text[],optional text[] DEFAULT ARRAY[]::text[]) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce(v IS NOT NULL AND jsonb_typeof(v)='object' AND v?&required AND v-required-optional='{}'::jsonb,false);
$$;
CREATE FUNCTION keryx_storage.owner269_digest(domain text,v jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF domain IS NULL OR domain NOT IN('manifest','operation','owner-operation') THEN RAISE EXCEPTION 'assignment_unavailable';END IF;
 RETURN encode(sha256(convert_to('keryx-owner269-'||domain||'-v1','UTF8')||decode('00','hex')||convert_to(keryx_storage.owner269_json(v),'UTF8')),'hex');
END;$$;
CREATE FUNCTION keryx_storage.owner269_valid(kind text,v jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE x jsonb;previous text:='';action text;stamp timestamptz;n numeric;key text;fields text[];
BEGIN
 IF v IS NULL OR octet_length(v::text)>65536 THEN RAISE EXCEPTION 'assignment_unavailable';END IF;
 CASE kind
 WHEN 'uuid' THEN
  IF jsonb_typeof(v)<>'string' OR v#>>'{}' !~ '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$' THEN RAISE EXCEPTION 'assignment_unavailable';END IF;
 WHEN 'digest' THEN
  IF jsonb_typeof(v)<>'string' OR v#>>'{}' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'assignment_unavailable';END IF;
 WHEN 'time','revision','ordinal' THEN
  IF jsonb_typeof(v)<>'number' THEN RAISE EXCEPTION 'assignment_unavailable';END IF;n:=(v::text)::numeric;
  IF n<>trunc(n) OR kind='time' AND n NOT BETWEEN 0 AND 8639999999700000 OR kind='revision' AND n NOT BETWEEN 1 AND 9007199254740990 OR kind='ordinal' AND n NOT BETWEEN 0 AND 24 THEN RAISE EXCEPTION 'assignment_unavailable';END IF;
 WHEN 'status' THEN
  IF jsonb_typeof(v)<>'string' OR v#>>'{}' NOT IN('assigned-by-owner','claimed','rejected','revoked') THEN RAISE EXCEPTION 'assignment_unavailable';END IF;
 WHEN 'recipient' THEN
  IF NOT keryx_storage.owner269_keys(v,ARRAY['accountId','accountCreatedAt','wallet','memberGeneration'])
   OR jsonb_typeof(v->'accountId') IS DISTINCT FROM 'string' OR v->>'accountId' !~ '^acct_[a-f0-9]{64}$'
   OR jsonb_typeof(v->'wallet') IS DISTINCT FROM 'string' OR v->>'wallet' !~ '^0x[a-f0-9]{40}$' OR v->>'wallet'='0x0000000000000000000000000000000000000000'
  THEN RAISE EXCEPTION 'assignment_unavailable';END IF;
  PERFORM keryx_storage.owner269_valid('time',v->'accountCreatedAt');PERFORM keryx_storage.owner269_valid('digest',v->'memberGeneration');
 WHEN 'member' THEN
  IF NOT keryx_storage.owner269_keys(v,ARRAY['assignmentId','runId','originalSha256','completedAt'])
   OR jsonb_typeof(v->'runId') IS DISTINCT FROM 'string' OR v->>'runId' !~ '^[A-Za-z0-9_-]{1,128}$' OR v->>'runId' ~ '^(prv_|a2a_)'
   OR jsonb_typeof(v->'completedAt') IS DISTINCT FROM 'string' OR v->>'completedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  THEN RAISE EXCEPTION 'assignment_unavailable';END IF;
  PERFORM keryx_storage.owner269_valid('uuid',v->'assignmentId');PERFORM keryx_storage.owner269_valid('digest',v->'originalSha256');
  stamp:=(v->>'completedAt')::timestamptz;IF stamp<'1970-01-01'::timestamptz OR to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>v->>'completedAt' THEN RAISE EXCEPTION 'assignment_unavailable';END IF;
 WHEN 'manifest' THEN
  IF NOT keryx_storage.owner269_keys(v,ARRAY['version','binding','recipient','basis','scope','admissionExpiresAt','members']) OR v->'version' IS DISTINCT FROM '1'::jsonb
   OR v->>'scope' IS DISTINCT FROM 'association-history-and-confirmation' OR octet_length(keryx_storage.owner269_json(v))>16384
   OR NOT keryx_storage.owner269_keys(v->'binding',ARRAY['network','origin','storageDigest'])
   OR v->'binding'->>'network' NOT IN('eip155:5042','eip155:5042002') OR NOT coalesce(keryx_storage.claim_origin_valid(v->'binding'->>'origin'),false)
   OR NOT keryx_storage.owner269_keys(v->'basis',ARRAY['code','reference']) OR v->'basis'->>'code' NOT IN('early-run-recovery','documented-recipient-request')
   OR jsonb_typeof(v->'basis'->'reference') IS DISTINCT FROM 'string' OR v->'basis'->>'reference' !~ '^[A-Za-z0-9_:/.-]{1,128}$'
   OR jsonb_typeof(v->'members') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'assignment_unavailable';END IF;
  IF jsonb_array_length(v->'members') NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'assignment_unavailable';END IF;
  PERFORM keryx_storage.owner269_valid('recipient',v->'recipient');PERFORM keryx_storage.owner269_valid('digest',v->'binding'->'storageDigest');PERFORM keryx_storage.owner269_valid('time',v->'admissionExpiresAt');
  FOR x IN SELECT jsonb_array_elements(v->'members') LOOP PERFORM keryx_storage.owner269_valid('member',x);IF previous COLLATE "C">= (x->>'runId') COLLATE "C" THEN RAISE EXCEPTION 'assignment_unavailable';END IF;previous:=x->>'runId';END LOOP;
  IF(SELECT count(DISTINCT x->>'assignmentId') FROM jsonb_array_elements(v->'members')x)<>jsonb_array_length(v->'members') THEN RAISE EXCEPTION 'assignment_unavailable';END IF;
 WHEN 'expected' THEN
  IF NOT keryx_storage.owner269_keys(v,ARRAY['assignmentId','revision']) THEN RAISE EXCEPTION 'assignment_unavailable';END IF;PERFORM keryx_storage.owner269_valid('uuid',v->'assignmentId');PERFORM keryx_storage.owner269_valid('revision',v->'revision');
 WHEN 'input' THEN
  action:=v->>'action';
  CASE action
   WHEN 'consent' THEN
    fields:=ARRAY['action','requestId','manifest','acknowledgeAssignedLabel','noFinancialAuthority'];
    IF v->'acknowledgeAssignedLabel' IS DISTINCT FROM 'true'::jsonb OR v->'noFinancialAuthority' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'assignment_unavailable';END IF;PERFORM keryx_storage.owner269_valid('manifest',v->'manifest');
   WHEN 'apply' THEN fields:=ARRAY['action','requestId','manifest','consentId'];PERFORM keryx_storage.owner269_valid('manifest',v->'manifest');PERFORM keryx_storage.owner269_valid('uuid',v->'consentId');
   WHEN 'confirm','reject','withdraw' THEN fields:=ARRAY['action','requestId','expected'];PERFORM keryx_storage.owner269_valid('expected',v->'expected');
   WHEN 'withdraw-consent','undo','cleanup' THEN
    fields:=CASE WHEN action='withdraw-consent' THEN ARRAY['action','requestId','consentId','expected'] ELSE ARRAY['action','requestId','applyId','expected'] END;
    PERFORM keryx_storage.owner269_valid('uuid',v->CASE WHEN action='withdraw-consent' THEN 'consentId' ELSE 'applyId' END);
    IF jsonb_typeof(v->'expected') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'assignment_unavailable';END IF;
    IF jsonb_array_length(v->'expected')>25 OR action<>'withdraw-consent' AND jsonb_array_length(v->'expected')<1 THEN RAISE EXCEPTION 'assignment_unavailable';END IF;
    FOR x IN SELECT jsonb_array_elements(v->'expected') LOOP PERFORM keryx_storage.owner269_valid('expected',x);END LOOP;
   ELSE RAISE EXCEPTION 'assignment_unavailable';
  END CASE;
  IF NOT keryx_storage.owner269_keys(v,fields) THEN RAISE EXCEPTION 'assignment_unavailable';END IF;PERFORM keryx_storage.owner269_valid('uuid',v->'requestId');
 WHEN 'receipt' THEN
  IF NOT keryx_storage.owner269_keys(v,ARRAY['version','requestId','inputDigest','action','committedAt','results','meaning']) OR v->'version' IS DISTINCT FROM '1'::jsonb
   OR v->>'meaning' IS DISTINCT FROM 'historical-committed-result-not-current-authority' OR v->>'action' NOT IN('consent','apply','confirm','reject','withdraw','withdraw-consent','undo','cleanup')
   OR jsonb_typeof(v->'results') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'assignment_unavailable';END IF;
  IF jsonb_array_length(v->'results')>25 THEN RAISE EXCEPTION 'assignment_unavailable';END IF;
  PERFORM keryx_storage.owner269_valid('uuid',v->'requestId');PERFORM keryx_storage.owner269_valid('digest',v->'inputDigest');PERFORM keryx_storage.owner269_valid('time',v->'committedAt');
  FOR x IN SELECT jsonb_array_elements(v->'results') LOOP
   IF NOT keryx_storage.owner269_keys(x,ARRAY['assignmentId','revision','status']) THEN RAISE EXCEPTION 'assignment_unavailable';END IF;PERFORM keryx_storage.owner269_valid('uuid',x->'assignmentId');PERFORM keryx_storage.owner269_valid('revision',x->'revision');PERFORM keryx_storage.owner269_valid('status',x->'status');
  END LOOP;
 WHEN 'association' THEN
  IF NOT keryx_storage.owner269_keys(v,ARRAY['version','manifest','member','consentId','applyId','lastOperationId','ordinal','status','revision','assignedAt','confirmedAt','decidedAt']) OR v->'version' IS DISTINCT FROM '1'::jsonb OR octet_length(keryx_storage.owner269_json(v))>32768 THEN RAISE EXCEPTION 'assignment_unavailable';END IF;
  PERFORM keryx_storage.owner269_valid('manifest',v->'manifest');PERFORM keryx_storage.owner269_valid('member',v->'member');PERFORM keryx_storage.owner269_valid('ordinal',v->'ordinal');
  FOREACH key IN ARRAY ARRAY['consentId','applyId','lastOperationId'] LOOP PERFORM keryx_storage.owner269_valid('uuid',v->key);END LOOP;
  PERFORM keryx_storage.owner269_valid('status',v->'status');PERFORM keryx_storage.owner269_valid('revision',v->'revision');PERFORM keryx_storage.owner269_valid('time',v->'assignedAt');
  FOREACH key IN ARRAY ARRAY['confirmedAt','decidedAt'] LOOP IF v->key<>'null'::jsonb THEN PERFORM keryx_storage.owner269_valid('time',v->key);END IF;END LOOP;
 WHEN 'event' THEN
  IF NOT keryx_storage.owner269_keys(v,ARRAY['version','actor','input','priorMembers','credentialGeneration','inputDigest','manifest','consentId','consentAt','priorOperationId','receipt']) OR v->'version' IS DISTINCT FROM '1'::jsonb
   OR jsonb_typeof(v->'priorMembers') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'assignment_unavailable';END IF;
  IF jsonb_array_length(v->'priorMembers')>25 THEN RAISE EXCEPTION 'assignment_unavailable';END IF;
  IF v->'actor'?'ownerId' THEN
   IF NOT keryx_storage.owner269_keys(v->'actor',ARRAY['ownerId','ownerAuthorization']) OR v->'actor'->>'ownerId' IS DISTINCT FROM 'posix-uid:0' THEN RAISE EXCEPTION 'assignment_unavailable';END IF;PERFORM keryx_storage.owner269_valid('digest',v->'actor'->'ownerAuthorization');
  ELSE PERFORM keryx_storage.owner269_valid('recipient',v->'actor');END IF;
  PERFORM keryx_storage.owner269_valid('input',v->'input');PERFORM keryx_storage.owner269_valid('digest',v->'inputDigest');PERFORM keryx_storage.owner269_valid('manifest',v->'manifest');PERFORM keryx_storage.owner269_valid('receipt',v->'receipt');
  FOREACH key IN ARRAY ARRAY['consentId','priorOperationId'] LOOP IF v->key<>'null'::jsonb THEN PERFORM keryx_storage.owner269_valid('uuid',v->key);END IF;END LOOP;
  IF v->'credentialGeneration'<>'null'::jsonb THEN PERFORM keryx_storage.owner269_valid('digest',v->'credentialGeneration');END IF;IF v->'consentAt'<>'null'::jsonb THEN PERFORM keryx_storage.owner269_valid('time',v->'consentAt');END IF;
  FOR x IN SELECT jsonb_array_elements(v->'priorMembers') LOOP
   IF NOT keryx_storage.owner269_keys(x,ARRAY['assignmentId','revision','status','priorOperationId']) THEN RAISE EXCEPTION 'assignment_unavailable';END IF;PERFORM keryx_storage.owner269_valid('uuid',x->'assignmentId');
   IF x->'revision'<>'null'::jsonb THEN PERFORM keryx_storage.owner269_valid('revision',x->'revision');END IF;IF x->'status'<>'null'::jsonb THEN PERFORM keryx_storage.owner269_valid('status',x->'status');END IF;IF x->'priorOperationId'<>'null'::jsonb THEN PERFORM keryx_storage.owner269_valid('uuid',x->'priorOperationId');END IF;
  END LOOP;
 ELSE RAISE EXCEPTION 'assignment_unavailable';
 END CASE;
END;$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
RESET ROLE;
