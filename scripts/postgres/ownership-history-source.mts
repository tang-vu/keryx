import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { nativeRunClaimsSource } from './run-claims-source.mts';
export function nativeOwnershipHistorySource(){
 const base=nativeRunClaimsSource(),read=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8').replaceAll('\r\n','\n');
 let addition=read('../../ops/keryx-postgres/ownership-history.sql');
 const ordinary=read('../../supabase/migrations/0084_personal_history_read.sql'),start=ordinary.indexOf('  if p_wallet is null'),end=ordinary.indexOf('  -- No SELECT * or raw run JSON:');
 if(start<0||end<=start||end-start>8192||addition.split('{{OWNERSHIP_QUERY_VALIDATOR}}').length!==2)throw new Error('Ownership query validator SOURCE unavailable');
 const validator=`CREATE FUNCTION keryx_storage.ownership_query_valid(p_wallet text,p_filters jsonb,p_take integer,p_upper jsonb,p_before jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$\nDECLARE r record;BEGIN\n${ordinary.slice(start,end)}END;$$;`;
 addition=addition.replace('{{OWNERSHIP_QUERY_VALIDATOR}}',()=>validator);
 if(Buffer.byteLength(addition)>32768)throw new Error('Ownership SOURCE bound');
 const sql=base.sql+'\n'+addition;return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Native private ownership history only; privacy/publication, complete writer and full application materialization/cutover retain their independent gates.'});
}
