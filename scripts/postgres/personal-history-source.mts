/** Closed native history SOURCE. Ordinary guard/transport never admits a target. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { nativeProfileIdentitiesSource } from './profile-identities-source.mts';
const once=(source:string,before:string,after:string)=>{if(source.split(before).length!==2)throw new Error('History SOURCE changed; review required');return source.replace(before,()=>after);};
export function nativePersonalHistorySource(){
 const base=nativeProfileIdentitiesSource(),source=readFileSync(new URL('../../supabase/migrations/0084_personal_history_read.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
 const start=source.indexOf('create function public.personal_history_read_v1('),end=source.indexOf('revoke all on function public.personal_history_read_v1(');
 if(start<0||end<=start||end-start>16384)throw new Error('History SOURCE unavailable');
 let helper=source.slice(start,end).trim();
 helper=once(helper,'create function public.personal_history_read_v1(','CREATE FUNCTION keryx_storage.personal_history_read(');
 helper=once(helper,'set search_path=pg_catalog,public','SET search_path=pg_catalog,pg_temp');
 helper=once(helper,'declare enrolled boolean; result jsonb; r record;','DECLARE result jsonb;r record;native_row record;native_bytes bigint:=2;');
 const guard=`  if to_regclass('keryx_storage.identity') is not null then
    execute 'select exists(select 1 from keryx_storage.identity)' into enrolled;
    if enrolled then raise exception 'Personal history unavailable in enrolled storage'; end if;
  end if;`;
 helper=once(helper,guard,'PERFORM keryx_storage.personal_history_context(p_wallet);');
 helper=once(helper,'total_spent,total_to_creators,payment_mode,parent_id,','total_spent,total_to_creators,payment_mode,(parent_id IS NOT NULL) AS native_is_followup,');
 helper=once(helper,"'isFollowUp',parent_id is not null","'isFollowUp',native_is_followup");
 const at=helper.indexOf('  with selected as ('),aggregate=helper.indexOf(") select jsonb_build_object('wallet',p_wallet,'rows',");
 if(at<0||aggregate<=at)throw new Error('History SOURCE page shape changed');
 const cte=helper.slice(at,aggregate+1);
 const bound=`FOR native_row IN ${cte} SELECT * FROM page LOOP
 IF octet_length(native_row.id)>128 OR NOT isfinite(native_row.created_at) OR octet_length(native_row.question)>32768
  OR octet_length(native_row.asker)>42 OR octet_length(native_row.payment_mode)>32
  OR octet_length(native_row.recorded_owner::text)>256 OR octet_length(native_row.provenance::text)>1024
 THEN RAISE EXCEPTION 'native history row bound';END IF;
 native_bytes:=native_bytes+octet_length(to_jsonb(native_row)::text)+1024;
 IF native_bytes>4194304 THEN RAISE EXCEPTION 'native history preaggregation bound';END IF;
END LOOP;
`;
 helper=helper.slice(0,at)+bound+helper.slice(at);
 const template=readFileSync(new URL('../../ops/keryx-postgres/personal-history.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
 const sql=base.sql+'\n'+once(template,'{{HISTORY_READ_HELPER}}',helper);
 return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Native owner-attributed history and bounded receipt projection only; privacy/claim/membership ports and complete runtime/cutover remain unqualified.'});
}
