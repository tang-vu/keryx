/** Fresh native SOURCE; no ordinary guard, target adoption or runtime install. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { nativeOriginalJsonSource } from './original-json-source.mts';
export function nativeRunClaimsSource(){
 const base=nativeOriginalJsonSource(),read=(p:string)=>readFileSync(new URL(p,import.meta.url),'utf8').replaceAll('\r\n','\n');
 const ordinary=read('../../supabase/migrations/0088_anonymous_run_claims.sql'),start=ordinary.indexOf('create function public.anonymous_run_claim_origin_valid_v1('),end=ordinary.indexOf('create table public.anonymous_run_claims (');
 if(start<0||end<=start||end-start>8192)throw new Error('Native claim origin SOURCE unavailable');
 const helper=ordinary.slice(start,end).trim().replace('public.anonymous_run_claim_origin_valid_v1(','keryx_storage.claim_origin_valid(').replace('set search_path=pg_catalog,public','set search_path=pg_catalog,pg_temp');
 const template=read('../../ops/keryx-postgres/run-claims.sql');if(template.split('{{CLAIM_ORIGIN_VALIDATOR}}').length!==2)throw new Error('Native claim SOURCE template changed');
 const sql=base.sql+'\n'+template.replace('{{CLAIM_ORIGIN_VALIDATOR}}',()=>helper);
 return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Native anonymous claim protocols only; ownership-history/privacy/publication/full writer and data/cutover remain separate qualification requirements.'});
}
