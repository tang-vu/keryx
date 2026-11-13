/** Held whole-corpus compatibility; no original bodies or actor data leave it. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { sqliteUsageProjection } from './usage-projection.mts';
import { publicationUsageMetadata } from '../../lib/db/postgres/usage-metadata';
import { parseRunUsage } from '../../lib/research/usage-provenance';
import { parseRunProvenance } from '../../lib/research/run-provenance';
export function auditUsage(db:DatabaseSync,deadline:number){
 assert(db.isTransaction);let rows=0,classified=0,provenance=0,bodyIdentityMismatches=0,noncanonicalCreatedAt=0,usageFirstLastDifferences=0,provenanceFirstLastDifferences=0,metadataBytes=0;const digest=createHash('sha256');
 const semantic=(wire:string|null)=>wire===null?'null':JSON.stringify(JSON.parse(wire));
 for(const row of db.prepare('SELECT id,created_at FROM query_runs ORDER BY id COLLATE BINARY').iterate()){
  assert(performance.now()<deadline&&rows<100000&&typeof row.id==='string');const p=sqliteUsageProjection(db,row.id);rows++;
  const original=db.prepare("SELECT CASE WHEN typeof(data)='text' AND length(CAST(data AS BLOB))<=4000000 THEN data END data FROM query_runs WHERE id=?").get(row.id);assert(original&&typeof original.data==='string');
  let raw:unknown=null;try{raw=JSON.parse(original.data);}catch{}const node=raw&&typeof raw==='object'&&!Array.isArray(raw)?publicationUsageMetadata(raw as Record<string,unknown>):{usageWire:null,provenanceWire:null};
  if(semantic(p.usageWire)!==semantic(node.usageWire))usageFirstLastDifferences++;if(semantic(p.provenanceWire)!==semantic(node.provenanceWire))provenanceFirstLastDifferences++;
  if(parseRunUsage(p.usageWire===null?null:JSON.parse(p.usageWire)))classified++;if(parseRunProvenance(p.provenanceWire===null?null:JSON.parse(p.provenanceWire)))provenance++;
  if(!p.bodyIdentityValid)bodyIdentityMismatches++;try{if(typeof row.created_at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(row.created_at)||new Date(row.created_at).toISOString()!==row.created_at)noncanonicalCreatedAt++;}catch{noncanonicalCreatedAt++;}
  metadataBytes+=Buffer.byteLength(p.usageWire??'')+Buffer.byteLength(p.provenanceWire??'');digest.update(JSON.stringify([row.id,p])).update('\n');
 }
 const paymentRows=Number(db.prepare('SELECT count(*) n FROM payment_events p JOIN query_runs q ON q.id=p.query_id').get()!.n);
 return {format:'keryx-usage-real-data-audit-v1',rows,classified,provenance,bodyIdentityMismatches,noncanonicalCreatedAt,usageFirstLastDifferences,provenanceFirstLastDifferences,metadataBytes,joinedLifetimePaymentRows:paymentRows,exceedsCurrentLifetimePaymentLimit:paymentRows>50000,projectionDigest:digest.digest('hex'),privateBodiesDisclosed:false,originalsModified:false,applicationMaterialized:false,enrollmentAuthorized:false};
}
