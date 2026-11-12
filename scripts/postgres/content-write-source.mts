import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { nativeWorkspacesSource } from './workspaces-source.mts';
import { nativeApplicationJsonEntrySource } from './source-json-entries.mts';
import { BASE_APPLICATION_WRITE_OPERATIONS } from '../../lib/db/postgres/application-domain-transport';
import { CONTENT_WRITE_OPERATIONS,CONTENT_WRITE_INPUT_BYTES } from '../../lib/db/postgres/content-write-calls';
export function nativeContentWriteSource(){
 const base=nativeWorkspacesSource(),names=Object.keys(CONTENT_WRITE_OPERATIONS),allowed=[...Object.keys(BASE_APPLICATION_WRITE_OPERATIONS),...names];if(names.length!==17||allowed.length!==34)throw new Error('Native content SOURCE inventory changed');
 const entries=names.map(name=>nativeApplicationJsonEntrySource([name],true,Object.hasOwn(CONTENT_WRITE_INPUT_BYTES,name)?CONTENT_WRITE_INPUT_BYTES[name as keyof typeof CONTENT_WRITE_INPUT_BYTES]:65536)).join('\n');
 const content=readFileSync(new URL('../../ops/keryx-postgres/content-writes.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
 if(Buffer.byteLength(content)>32768)throw new Error('Content write SOURCE bound');
 const gapFunctions=[['0031_exact_gap_article_responses.sql',['create_gap_intent','claim_gap_intent']],['0025_gap_intents.sql',['fail_gap_intent']]] as const;
 const currentGapFunctions=gapFunctions.flatMap(([file,names])=>{
  const input=readFileSync(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');
  return [...input.matchAll(/create or replace function public\.(create_gap_intent|claim_gap_intent|fail_gap_intent)\([\s\S]*?\n\$\$;/g)].filter(m=>(names as readonly string[]).includes(m[1]));
 });
 if(currentGapFunctions.length!==3||new Set(currentGapFunctions.map(m=>m[1])).size!==3)throw new Error('Current gap SOURCE inventory changed');
 const gaps=currentGapFunctions.map(m=>m[0].replaceAll('now()',()=>`to_char(${m[1]==='claim_gap_intent'?'to_timestamp(p_now::numeric/1000)':'transaction_timestamp()'} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`)).join('\n');
 const sql=base.sql+`\nSET ROLE keryx_owner;
CREATE OR REPLACE FUNCTION keryx_storage.enter_operation(expected jsonb,selected text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF session_user<>'keryx_app' OR current_setting('transaction_read_only')<>'off' OR selected<>ALL(ARRAY[${allowed.map(n=>"'"+n+"'").join(',')}])
  OR expected IS DISTINCT FROM(SELECT identity FROM keryx_storage.identity WHERE singleton)
  OR(SELECT mode FROM keryx_storage.control WHERE singleton) IS DISTINCT FROM 'active'
  OR NOT EXISTS(SELECT 1 FROM keryx_storage.writer WHERE transaction_id=txid_current() AND operation=selected AND identity_digest=keryx_storage.identity_digest(expected))
 THEN RAISE EXCEPTION 'native content writer context refused';END IF;
END;$$;
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['sources','source_items','source_meta','source_notify','source_notify_email','cache_items','sync_state','query_memories','gap_intents'] LOOP
 EXECUTE format('CREATE TRIGGER native_content_writer BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence()',t);
END LOOP;END;$$;
${content}
${gaps}
-- Retain the same finite encrypted-cache admission as the current native SQLite
-- writer, so a successful update cannot make the next cold factory unreadable.
CREATE OR REPLACE FUNCTION public.storage_set_cached(p_expected_identity jsonb,p_row jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE selected_id text;other_rows bigint;other_bytes bigint;
BEGIN
 PERFORM keryx_storage.enter_operation(p_expected_identity,'set_cached');
 IF p_row IS NULL OR jsonb_typeof(p_row)<>'object' OR p_row-'source_id'-'text'-'updated_at'<>'{}'::jsonb OR jsonb_typeof(p_row->'source_id') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_row->'text') IS DISTINCT FROM 'string' OR jsonb_typeof(p_row->'updated_at') IS DISTINCT FROM 'string'
  OR length(p_row->>'source_id') NOT BETWEEN 1 AND 256 OR octet_length(p_row->>'source_id')>512 OR octet_length(p_row->>'text')>2097152 OR left(p_row->>'text',7)<>'enc:v3:'
  OR(SELECT sum(CASE WHEN ascii(substr(p_row->>'source_id',i,1))>65535 THEN 2 ELSE 1 END) FROM generate_series(1,length(p_row->>'source_id')) i)>256
 THEN RAISE EXCEPTION 'Enrolled content cache unavailable';END IF;
 selected_id:=p_row->>'source_id';
 SELECT count(*),coalesce(sum(octet_length(text)),0) INTO other_rows,other_bytes FROM public.cache_items WHERE source_id IS DISTINCT FROM selected_id AND text IS NOT NULL;
 IF other_rows+1>512 OR other_bytes+octet_length(p_row->>'text')>8388608 THEN RAISE EXCEPTION 'Enrolled cache inspection limit exceeded';END IF;
 INSERT INTO public.cache_items(source_id,text,updated_at) VALUES(selected_id,p_row->>'text',p_row->>'updated_at')
  ON CONFLICT(source_id) DO UPDATE SET text=excluded.text,updated_at=excluded.updated_at;
 PERFORM keryx_storage.leave_operation();RETURN NULL;
END;$$;
${entries}
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_set_cached(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role,keryx_app,keryx_reader;
RESET ROLE;
`;
 return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Fixed content write protocol SOURCE only; remaining authority/domain/full-writer/data/load and production gates remain closed.'});
}
