/** Body-less retained Source compatibility only; no identity adoption or writer. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../../lib/canonical-json';
import { captureA2aSourceTimeCells } from '../../lib/db/postgres/a2a-time-metadata';
export function auditA2aTimes(db:DatabaseSync,deadline:number){
 assert(db.isTransaction);let rows=0;const digest=createHash('sha256');
 for(const raw of db.prepare('SELECT id,query_id,request_hash,created_at,updated_at,started_at,payment_started_at,result_saving_at FROM a2a_orders ORDER BY id COLLATE BINARY').iterate()){
  assert(performance.now()<deadline&&rows<10000);const selected=captureA2aSourceTimeCells(raw);digest.update(canonicalJson(selected)).update('\n');rows++;
 }
 return {rows,sourceClockCellsValidated:true,exactSourceTextSha256:digest.digest('hex'),paidBodiesRead:false,identityAccepted:false,originalsModified:false};
}
