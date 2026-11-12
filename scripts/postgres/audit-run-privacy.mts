/** Private SOURCE compatibility only; emits counts/digests, never original text. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { sqlitePrivacyProjection } from './privacy-projection.mts';
export function auditRunPrivacy(db:DatabaseSync,deadline:number){
 assert(db.isTransaction);const digest=createHash('sha256');let rows=0,invalidOriginals=0,missingQuestions=0,missingHistory=0,missingLearning=0,missingArchive=0,missingErasure=0,originalBytes=0,derivativeBytes=0;
 for(const row of db.prepare('SELECT id FROM query_runs ORDER BY id COLLATE BINARY').iterate()){
  assert(typeof row.id==='string'&&performance.now()<deadline&&rows<100000);
  const p=sqlitePrivacyProjection(db,row.id),wire=JSON.stringify(p);digest.update(JSON.stringify(row.id)).update('\n').update(wire).update('\n');rows++;
  if(!p.valid)invalidOriginals++;if(p.questionFields===null)missingQuestions++;if(p.historyFields===null)missingHistory++;if(p.learningFields===null)missingLearning++;if(p.archiveWire===null)missingArchive++;if(p.eraseProjection===null)missingErasure++;
  originalBytes+=p.dataBytes;derivativeBytes+=Buffer.byteLength(wire);
 }
 return {format:'keryx-run-privacy-real-data-audit-v1',originalsProjected:rows,projectionDigest:digest.digest('hex'),invalidOriginals,missingQuestions,missingHistory,missingLearning,missingArchive,missingErasure,originalBytes,derivativeBytes,originalsModified:false,applicationMaterialized:false};
}
