/** Fresh SOURCE representation for byte-bound retained run originals. Never an
 * ALTER/normalizer of an existing target or permission to enroll a writer. */
import { createHash } from 'node:crypto';
import { nativePersonalHistorySource } from './personal-history-source.mts';
const once=(sql:string,before:string,after:string)=>{if(sql.split(before).length!==2)throw new Error('Original JSON SOURCE changed; review required');return sql.replace(before,()=>after);};
export function nativeOriginalJsonSource(){
 const base=nativePersonalHistorySource();
 let sql=once(base.sql,'  answer text,\n  data jsonb not null\n);\ncreate index if not exists query_runs_created_idx',
  '  answer text,\n  data json not null\n);\ncreate index if not exists query_runs_created_idx');
 // Only the bounded owner summary consumes these three projected subtrees.
 // Converting the whole original to JSONB would normalize bytes and reject an
 // otherwise valid escaped NUL/surrogate in an unprojected private answer.
 const start=sql.indexOf('CREATE FUNCTION keryx_storage.personal_history_read('),end=sql.indexOf('CREATE FUNCTION public.storage_personal_history_list(');
 if(start<0||end<=start)throw new Error('Original JSON history projection unavailable');
 let history=sql.slice(start,end);
 for(const [field,count] of [['asker',2],['askerFunded',2],['provenance',12]] as const){
  const token=`data->'${field}'`;if(history.split(token).length!==count+1)throw new Error('Original JSON projection SOURCE count changed');
  history=history.replaceAll(token,`(data->'${field}')::jsonb`);
 }
 sql=sql.slice(0,start)+history+sql.slice(end)+`
SET ROLE keryx_owner;
-- Same exact UTF-8 wire SHA used by current SQLite claims and retained privacy.
-- This private helper grants no original read, ownership or payment authority.
CREATE FUNCTION keryx_storage.run_original_sha256(original json) RETURNS text
 LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF octet_length(original::text)>4000000 THEN RAISE EXCEPTION 'original run byte bound';END IF;
 RETURN encode(sha256(convert_to(original::text,'UTF8')),'hex');
END;$$;
REVOKE ALL ON FUNCTION keryx_storage.run_original_sha256(json) FROM PUBLIC,keryx_app,keryx_reader;
RESET ROLE;
`;
 return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Lossless original JSON SOURCE only. Claim/privacy/publication protocols, materialization and full writer runtime still require independent behavioral qualification.'});
}
