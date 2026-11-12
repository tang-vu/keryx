/** SOURCE intake derivative. The original packet is never normalized/replaced. */
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ownershipHistoryOriginal,summarizeOwnershipOriginal } from '../../lib/run-claims/history';
import type { QueryRun } from '../../lib/types';
export function sqliteOwnershipHistoryProjection(db:DatabaseSync,id:string){
 const row=db.prepare(`SELECT id,created_at,asker,CASE WHEN length(CAST(data AS BLOB))<=4000000 THEN data END original,
  CASE WHEN length(CAST(data AS BLOB))<=4000000 THEN lower(hex(CAST(data AS BLOB))) END original_hex,
  CASE WHEN json_extract(data,'$.question') IS NULL THEN NULL ELSE lower(hex(CAST(json_extract(data,'$.question') AS BLOB))) END question_hex,
  (json_type(data)='object' AND json_extract(data,'$.id')=id AND json_extract(data,'$.createdAt')=created_at
   AND json_type(data,'$.asker') IS NULL AND json_type(data,'$.originalFulfillment') IS NULL
   AND json_type(data,'$.askerFunded') IS NOT 'true' AND json_extract(data,'$.fundingOwner') IS NOT 'browser') history_eligible
  FROM query_runs WHERE id=?`).get(id);
 if(!row||typeof row.original!=='string'||Buffer.from(row.original).toString('hex')!==row.original_hex)throw new Error('Ownership SOURCE original unavailable');
 const raw:unknown=JSON.parse(row.original),valid=(method:'recorded'|'claimed')=>{try{
  if(method==='recorded'&&(typeof row.asker!=='string'||!/^0x[0-9a-f]{40}$/.test(row.asker)))return false;
  ownershipHistoryOriginal(raw,method==='recorded'?String(row.asker):'0x'+'00'.repeat(20),String(row.id),String(row.created_at),method==='recorded'?{method,claimedAt:null}:{method,claimedAt:'2026-01-01T00:00:00.000Z'});return true;
 }catch{return false;}};
 let summary:ReturnType<typeof summarizeOwnershipOriginal>|null=null;try{summary=summarizeOwnershipOriginal(raw as QueryRun);}catch{}
 return Object.freeze({sha256:createHash('sha256').update(row.original).digest('hex'),questionHex:row.question_hex===null?null:String(row.question_hex),historyEligible:row.history_eligible===1,recordedValid:valid('recorded'),claimedValid:valid('claimed'),summary});
}
/** Held owner only. Parameterized application writers do not acquire this API. */
export function heldOwnershipHistoryProjectionSql(id:string,p:ReturnType<typeof sqliteOwnershipHistoryProjection>){
 if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id)||!/^[a-f0-9]{64}$/.test(p.sha256)||p.questionHex!==null&&(p.questionHex.length>8000000||/[^a-f0-9]/.test(p.questionHex)||p.questionHex.length%2))throw new Error('Ownership SOURCE derivative refused');
 const q=(s:string)=>"'"+s.replaceAll("'","''")+"'";
 return `INSERT INTO keryx_storage.run_ownership_projection(run_id,original_sha256,question_search,history_eligible,recorded_valid,claimed_valid,summary) VALUES(${q(id)},${q(p.sha256)},${p.questionHex===null?'NULL':`decode(${q(p.questionHex)},'hex')`},${p.historyEligible},${p.recordedValid},${p.claimedValid},${p.summary===null?'NULL':q(JSON.stringify(p.summary))+'::jsonb'});`;
}
