/** Owner-only synthetic intake. Observe Source columns and raw JSON before
 * preparing a held fixture; never infer a missing scalar from its original. */
import assert from 'node:assert/strict';
import type {DatabaseSync} from 'node:sqlite';
import {sqlitePublicationScalarProjection,heldPublicationScalarProjectionSql} from './privacy-projection.mts';
const columns=['id','created_at','question','budget','engine','total_spent','total_to_creators','answer','data','parent_id','asker','origin','duration_ms','payment_mode','payment_attempts','settled_payments','confidence_level','mcp_client','evidence_claim_count','grounded_claim_count','rewarded_citation_count','economics_data'] as const;
const quote=(s:string)=>"'"+s.replaceAll("'","''")+"'";
export function heldQueryRunFixture(db:DatabaseSync,id:string,write:'insert'|'replace'='insert'){
 assert(write==='insert'||write==='replace');
 const row=db.prepare('SELECT * FROM query_runs WHERE id=?').get(id);assert(row);
 assert.deepEqual(Object.keys(row).sort(),[...columns].sort(),'Observe the actual complete Source QueryRun table');
 const scalar=sqlitePublicationScalarProjection(db,id);
 const values=columns.map(key=>{
  const value=row[key];if(value===null)return 'NULL';
  if(typeof value==='number'){assert(Number.isFinite(value));return String(value);}
  if(typeof value==='bigint')return String(value);
  assert.equal(typeof value,'string');
  const shadow=key==='answer'?scalar.answerShadow:Object.hasOwn(scalar.shadows,key)?scalar.shadows[key]:value;
  assert.equal(typeof shadow,'string');
  return quote(shadow as string)+(['data','economics_data'].includes(key)?'::json':'');
 });
 const conflict=write==='replace'?' ON CONFLICT(id) DO UPDATE SET '+columns.filter(k=>k!=='id').map(k=>k+'=excluded.'+k).join(','):'';
 return Object.freeze({physicalSql:`INSERT INTO public.query_runs(${columns.join(',')}) VALUES(${values.join(',')})${conflict};`,scalarSql:heldPublicationScalarProjectionSql(id,scalar)});
}
