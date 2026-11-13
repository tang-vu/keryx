/** Authenticate retained ciphertext under its original identity and existing
 * key. Only counts/digests leave the contained read-only snapshot. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { storageIdentityDigest,validateStorageIdentity } from '../../lib/db/storage-identity';
import { openEnrolledCacheText } from '../../lib/sources/enrolled-content-cache';
export function auditCache(db:DatabaseSync,deadline:number){
 assert(db.isTransaction);const key=process.env.CONTENT_MASTER_KEY;assert(typeof key==='string'&&/^[a-fA-F0-9]{64}$/.test(key));
 const keyFingerprint=createHash('sha256').update(Buffer.from(key,'hex')).digest('hex');
 const identities=db.prepare("SELECT id,CASE WHEN typeof(identity)='text' AND length(CAST(identity AS BLOB))<=8192 THEN identity END identity FROM keryx_storage_identity LIMIT 2").all();assert(identities.length===1&&identities[0].id===1&&typeof identities[0].identity==='string');
 const identity=validateStorageIdentity(JSON.parse(identities[0].identity));assert(identity.authorityMode==='mainnet-real'&&identity.network==='eip155:5042');const identityDigest=storageIdentityDigest(identity);
 let rows=0,authenticatedRows=0,nullRows=0,envelopeBytes=0,plaintextBytes=0;const digest=createHash('sha256');
 const statement=db.prepare("SELECT source_id,CASE WHEN text IS NULL THEN NULL WHEN typeof(text)='text' AND length(CAST(text AS BLOB))<=2097152 THEN text END text,CASE WHEN text IS NOT NULL AND (typeof(text)<>'text' OR length(CAST(text AS BLOB))>2097152) THEN 1 ELSE 0 END refused FROM cache_items ORDER BY source_id COLLATE BINARY LIMIT 513");
 for(const row of statement.iterate()){
  assert(performance.now()<deadline&&rows<512);rows++;assert(row.refused===0&&typeof row.source_id==='string');
  assert(process.env.CONTENT_MASTER_KEY===key);const current=db.prepare('SELECT identity FROM keryx_storage_identity WHERE id=1').get();assert(current&&typeof current.identity==='string'&&storageIdentityDigest(validateStorageIdentity(JSON.parse(current.identity)))===identityDigest);
  if(row.text===null){nullRows++;digest.update(JSON.stringify([row.source_id,null])).update('\n');continue;}
  assert(typeof row.text==='string');envelopeBytes+=Buffer.byteLength(row.text);assert(envelopeBytes<=8388608);
  const plaintext=openEnrolledCacheText(row.text,row.source_id,identity);assert(typeof plaintext==='string');authenticatedRows++;plaintextBytes+=Buffer.byteLength(plaintext);
  digest.update(JSON.stringify([row.source_id,createHash('sha256').update(row.text).digest('hex'),createHash('sha256').update(plaintext).digest('hex')])).update('\n');
 }
 return {format:'keryx-cache-authentication-real-data-audit-v1',rows,authenticatedRows,nullRows,envelopeBytes,plaintextBytes,sourceIdentityDigest:identityDigest,keyFingerprint,projectionDigest:digest.digest('hex'),plaintextDisclosed:false,rawKeyDisclosed:false,originalsModified:false,applicationMaterialized:false,targetIdentityRebound:false,enrollmentAuthorized:false};
}
