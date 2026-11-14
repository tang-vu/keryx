import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { expect,it } from 'vitest';
import { canonicalJson } from '../../lib/canonical-json';
import { auditA2aTimes } from './audit-a2a-time.mts';
it('audits exact retained Source clock bytes without selecting paid bodies or accepting identity',()=>{
 const db=new DatabaseSync(':memory:');try{
  const row={id:'synthetic-order',query_id:'synthetic-query',request_hash:'a'.repeat(64),created_at:'2026-11-14T07:00:00+07:00',updated_at:'2026-11-14T00:00:00.123456789+00:00',started_at:null,payment_started_at:'2026-11-14T00:00:00.12345Z',result_saving_at:null},q=(s:string)=>"'"+s.replaceAll("'","''")+"'";
  db.function('paid_body_trap',()=>{throw Error('paid body hydrated');});db.exec('CREATE VIEW a2a_orders AS SELECT '+Object.entries(row).map(([key,value])=>(value===null?'NULL':q(value))+' AS '+key).join(',')+',paid_body_trap() AS response_data');db.exec('BEGIN');
  expect(auditA2aTimes(db,performance.now()+10000)).toEqual({rows:1,sourceClockCellsValidated:true,exactSourceTextSha256:createHash('sha256').update(canonicalJson(row)).update('\n').digest('hex'),paidBodiesRead:false,identityAccepted:false,originalsModified:false});
  expect(()=>auditA2aTimes(db,performance.now()-1)).toThrow();expect(()=>db.prepare('SELECT * FROM a2a_orders').get()).toThrow('paid body hydrated');db.exec('ROLLBACK');expect(()=>auditA2aTimes(db,performance.now()+10000)).toThrow();
 }finally{db.close();}
});
it('refuses malformed clocks rather than fabricating an instant',()=>{
 const db=new DatabaseSync(':memory:');try{db.exec("CREATE TABLE a2a_orders(id,query_id,request_hash,created_at,updated_at,started_at,payment_started_at,result_saving_at);INSERT INTO a2a_orders VALUES('id','query','hash','not a date','2026-11-14T00:00:00.000Z',NULL,NULL,NULL);BEGIN");expect(()=>auditA2aTimes(db,performance.now()+10000)).toThrow();}finally{db.close();}
});
