/** Metadata-only real-data compatibility audit inside the offline operator child. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { sqliteOriginalHistoryProjection } from './run-history-projection.mts';
import { sqliteOwnershipHistoryProjection } from './ownership-history-projection.mts';
export function auditRunDomains(db:DatabaseSync,deadline:number){
 assert(db.isTransaction);let rows=0,summaryInvalid=0,recordedValid=0,claimedValid=0,sqliteHistoryEligible=0,nodeClaimEligible=0,eligibilityDifferences=0;const digest=createHash('sha256');
 for(const row of db.prepare('SELECT id FROM query_runs ORDER BY id COLLATE BINARY').iterate()){
  assert(typeof row.id==='string');assert(performance.now()<deadline&&rows<100000);
  const history=sqliteOriginalHistoryProjection(db,row.id),ownership=sqliteOwnershipHistoryProjection(db,row.id);assert.equal(history.sha256,ownership.sha256);
  digest.update(JSON.stringify([row.id,history,ownership])).update('\n');rows++;if(ownership.summary===null)summaryInvalid++;if(ownership.recordedValid)recordedValid++;if(ownership.claimedValid)claimedValid++;if(ownership.historyEligible)sqliteHistoryEligible++;if(history.anonymousClaimEligible)nodeClaimEligible++;if(history.anonymousClaimEligible!==ownership.historyEligible)eligibilityDifferences++;
 }
 const amounts=db.prepare('SELECT count(*) rows,sum(CASE WHEN amount_usdc<=0 THEN 1 ELSE 0 END) nonpositive FROM a2a_orders').get()!;
 const cache=db.prepare("SELECT count(*) rows,coalesce(sum(length(CAST(text AS BLOB))),0) bytes,coalesce(sum(CASE WHEN substr(text,1,7)='enc:v3:' THEN 1 ELSE 0 END),0) bound_envelopes FROM cache_items").get()!;
 const privacy=db.prepare("SELECT coalesce(p.visibility,'unlisted') visibility,coalesce(p.erased,0) erased,count(*) rows,coalesce(sum(length(CAST(q.data AS BLOB))),0) original_bytes FROM query_runs q LEFT JOIN run_privacy p ON p.run_id=q.id GROUP BY 1,2 ORDER BY 1,2").all();
 return {format:'keryx-run-domain-real-data-audit-v1',originalsProjected:rows,projectionDigest:digest.digest('hex'),summaryInvalid,recordedValid,claimedValid,sqliteHistoryEligible,nodeClaimEligible,eligibilityDifferences,a2aRows:Number(amounts.rows),a2aNonpositiveAmounts:Number(amounts.nonpositive??0),cacheRows:Number(cache.rows),cacheEnvelopeBytes:Number(cache.bytes),cacheBoundEnvelopeCount:Number(cache.bound_envelopes),privacyByteInventory:privacy,cacheDecrypted:false,originalsModified:false,applicationMaterialized:false};
}
