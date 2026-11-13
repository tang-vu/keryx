/** Held full-original compatibility census. No text, wallets or run IDs leave it. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { sqliteLedgerProjection } from './ledger-projection.mts';
export function auditLedger(db:DatabaseSync,deadline:number){
 assert(db.isTransaction);const digest=createHash('sha256'),visible=new Set(db.prepare("SELECT q.id FROM query_runs q JOIN run_privacy p ON p.run_id=q.id WHERE p.visibility='public' AND p.erased=0 ORDER BY q.created_at DESC,q.id DESC LIMIT 251").all().map(row=>row.id));
 let rows=0,invalidOriginals=0,capturedSnapshots=0,metadataBytes=0,largestSnapshotBytes=0,currentPublicScanBytes=0,currentPublicInvalidOriginals=0,currentPublicCapturedSnapshots=0;
 for(const row of db.prepare('SELECT id FROM query_runs ORDER BY id COLLATE BINARY').iterate()){
  assert(typeof row.id==='string'&&performance.now()<deadline&&rows<100000);const p=sqliteLedgerProjection(db,row.id),bytes=Buffer.byteLength(p.snapshotWire??'');rows++;digest.update(JSON.stringify([row.id,p])).update('\n');
  if(!p.valid)invalidOriginals++;if(p.snapshotWire!==null)capturedSnapshots++;metadataBytes+=bytes;largestSnapshotBytes=Math.max(largestSnapshotBytes,bytes);
  if(visible.has(row.id)){currentPublicScanBytes+=bytes;if(!p.valid)currentPublicInvalidOriginals++;if(p.snapshotWire!==null)currentPublicCapturedSnapshots++;}
 }
 return {format:'keryx-public-ledger-real-data-audit-v1',rows,invalidOriginals,capturedSnapshots,metadataBytes,largestSnapshotBytes,currentPublicScanRows:visible.size,currentPublicCapturedSnapshots,currentPublicInvalidOriginals,currentPublicScanBytes,exceedsCurrentCompleteMetadataBound:currentPublicScanBytes>16777216,projectionDigest:digest.digest('hex'),privateBodiesDisclosed:false,originalsModified:false,applicationMaterialized:false,enrollmentAuthorized:false};
}
