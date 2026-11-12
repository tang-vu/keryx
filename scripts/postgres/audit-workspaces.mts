import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { bibliographyMetadataSchema,bibliographyOwner,bibliographyTokenSchema } from '../../lib/bibliographies/private-bibliography';
import { sqliteWatchProjection } from './watch-projection.mts';
/** Read-only SOURCE compatibility. No account/token/body values leave the child. */
export function auditWorkspaces(db:DatabaseSync,deadline:number){
 assert(db.isTransaction);const digest=createHash('sha256');let bibliographies=0,watches=0,bibliographyBytes=0,invalidBibliographies=0,invalidWatches=0;
 for(const row of db.prepare("SELECT id,wallet,token_hash,title,reference_count,revision,created_at,updated_at,length(CAST(content AS BLOB)) bytes,CASE WHEN length(CAST(content AS BLOB))<=524288 THEN content END content,CASE WHEN length(CAST(content AS BLOB))<=524288 THEN lower(hex(CAST(content AS BLOB))) END content_hex FROM private_bibliographies ORDER BY id COLLATE BINARY").iterate()){
  assert(performance.now()<deadline&&bibliographies<100000);bibliographies++;bibliographyBytes+=Number(row.bytes);digest.update(JSON.stringify(row)).update('\n');
  try{assert.equal(bibliographyOwner(String(row.wallet)),row.wallet);bibliographyTokenSchema.parse(row.token_hash);bibliographyMetadataSchema.parse({id:row.id,title:row.title,count:row.reference_count,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at});assert(typeof row.content==='string'&&!row.content.includes('\0')&&Buffer.from(row.content).toString('hex')===row.content_hex);}catch{invalidBibliographies++;}
 }
 for(const row of db.prepare('SELECT wallet,id FROM topic_watches ORDER BY wallet COLLATE BINARY,id COLLATE BINARY').iterate()){
  assert(performance.now()<deadline&&watches<100000);watches++;
  try{const p=sqliteWatchProjection(db,String(row.wallet),String(row.id));digest.update(JSON.stringify(p)).update('\n');}catch{invalidWatches++;digest.update('invalid-watch\n');}
 }
 return {format:'keryx-workspace-real-data-audit-v1',bibliographyRows:bibliographies,bibliographyContentBytes:bibliographyBytes,watchRows:watches,invalidBibliographies,invalidWatches,projectionDigest:digest.digest('hex'),originalsModified:false,applicationMaterialized:false};
}
