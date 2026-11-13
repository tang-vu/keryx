import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { reviewIdSchema,reviewOwner,reviewVerdictSchema } from '../../lib/research/decision-review-types';
import { reviewOriginalMetadata } from '../../lib/db/postgres/review-packet';
import { decodeNativeReviewRow } from '../../lib/db/postgres/reviews-transport';
/** Bounded read-only compatibility on an operator-held snapshot. Counts and
 * digests leave the contained child; original/reason/wallet bytes do not. */
export function auditReviews(db:DatabaseSync,deadline:number){
 assert(db.isTransaction);let rows=0,verdicts=0,invalidRows=0,invalidVerdicts=0,nulSourceNames=0;const digest=createHash('sha256');
 for(const row of db.prepare("SELECT id,wallet,run_id,network,created_at,expires_at,state,code_action,code_rule,CASE WHEN typeof(input_json)='text' AND length(CAST(input_json AS BLOB))<=8192 THEN input_json END input_json,CASE WHEN typeof(input_json)='text' AND length(CAST(input_json AS BLOB))<=8192 THEN lower(hex(CAST(input_json AS BLOB))) END input_hex,CASE WHEN verdict_json IS NULL THEN NULL WHEN typeof(verdict_json)='text' AND length(CAST(verdict_json AS BLOB))<=8192 THEN lower(hex(CAST(verdict_json AS BLOB))) ELSE 'invalid' END verdict_hex FROM decision_review_records ORDER BY id COLLATE BINARY").iterate()){
  assert(performance.now()<deadline&&rows<100000);rows++;
  try{
   assert(typeof row.input_json==='string'&&Buffer.from(row.input_json).toString('hex')===row.input_hex);assert.equal(reviewOwner(String(row.wallet)),row.wallet);
   const record=decodeNativeReviewRow({id:row.id,inputHex:row.input_hex,createdAt:row.created_at,expiresAt:row.expires_at,state:row.state,action:row.code_action,rule:row.code_rule,verdictHex:row.verdict_hex}),metadata=reviewOriginalMetadata(row.input_json);
   assert.equal(record.runId,row.run_id);assert.equal(record.terms.network,row.network);if(record.sourceName.includes('\0'))nulSourceNames++;
   digest.update(JSON.stringify(['record',row.id,row.wallet,createHash('sha256').update(row.input_json).digest('hex'),metadata])).update('\n');
  }catch{invalidRows++;digest.update('invalid-record\n');}
 }
 for(const row of db.prepare("SELECT wallet,key,decision_id,CASE WHEN typeof(input_json)='text' AND length(CAST(input_json AS BLOB))<=8192 THEN input_json END input_json FROM decision_review_verdicts ORDER BY wallet COLLATE BINARY,key COLLATE BINARY").iterate()){
  assert(performance.now()<deadline&&verdicts<100000);verdicts++;
  try{assert(typeof row.input_json==='string');assert.equal(reviewOwner(String(row.wallet)),row.wallet);reviewIdSchema.parse(row.key);reviewIdSchema.parse(row.decision_id);const input=reviewVerdictSchema.parse(JSON.parse(row.input_json));assert.equal(input.id,row.decision_id);assert.equal(input.key,row.key);digest.update(JSON.stringify(['verdict',row.wallet,row.key,row.decision_id,createHash('sha256').update(row.input_json).digest('hex')])).update('\n');}catch{invalidVerdicts++;digest.update('invalid-verdict\n');}
 }
 return {format:'keryx-review-real-data-audit-v1',reviewRows:rows,verdictRows:verdicts,invalidRows,invalidVerdicts,nulSourceNames,projectionDigest:digest.digest('hex'),originalsModified:false,applicationMaterialized:false};
}
