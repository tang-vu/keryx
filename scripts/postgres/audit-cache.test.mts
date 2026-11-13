import { afterEach,expect,it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity } from '../../lib/db/storage-identity';
import { sealEnrolledCacheText } from '../../lib/sources/enrolled-content-cache';
import { auditCache } from './audit-cache.mts';
const opened:DatabaseSync[]=[],previous=process.env.CONTENT_MASTER_KEY;afterEach(()=>{for(const db of opened.splice(0))db.close();if(previous===undefined)delete process.env.CONTENT_MASTER_KEY;else process.env.CONTENT_MASTER_KEY=previous;});
function fixture(){
 process.env.CONTENT_MASTER_KEY='17'.repeat(32);const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',authorityMode:'mainnet-real',network:'eip155:5042',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:'2026-10-09T10:00:00.000Z',provenanceDigest:'18'.repeat(32)};
 const db=new DatabaseSync(':memory:');opened.push(db);db.exec('CREATE TABLE keryx_storage_identity(id,identity);CREATE TABLE cache_items(source_id,text);');db.prepare('INSERT INTO keryx_storage_identity VALUES(1,?)').run(JSON.stringify(identity));const wire=sealEnrolledCacheText('Private paid body 🌍','source-one',identity);db.prepare('INSERT INTO cache_items VALUES(?,?)').run('source-one',wire);db.exec('BEGIN');return {db,identity,audit:()=>auditCache(db,performance.now()+10000)};
}
it('authenticates originals without disclosing plaintext, key or claiming target enrollment',()=>{
 const {db,audit}=fixture(),r=audit();expect(r).toMatchObject({rows:1,authenticatedRows:1,nullRows:0,plaintextBytes:Buffer.byteLength('Private paid body 🌍'),plaintextDisclosed:false,rawKeyDisclosed:false,originalsModified:false,applicationMaterialized:false,targetIdentityRebound:false,enrollmentAuthorized:false});expect(audit().projectionDigest).toBe(r.projectionDigest);expect(JSON.stringify(r)).not.toMatch(/Private paid body|17171717/);expect(db.prepare('SELECT count(*) n FROM cache_items').get()?.n).toBe(1);
});
it('refuses wrong keys, wrong source/identity, tampering and plaintext rows',()=>{
 const {db,identity,audit}=fixture();process.env.CONTENT_MASTER_KEY='19'.repeat(32);expect(audit).toThrow();process.env.CONTENT_MASTER_KEY='17'.repeat(32);
 db.exec("UPDATE cache_items SET source_id='other-source'");expect(audit).toThrow();db.exec("UPDATE cache_items SET source_id='source-one'");db.prepare('UPDATE keryx_storage_identity SET identity=?').run(JSON.stringify({...identity,storageId:randomUUID()}));expect(audit).toThrow();db.prepare('UPDATE keryx_storage_identity SET identity=?').run(JSON.stringify(identity));db.exec("UPDATE cache_items SET text='enc:v3:broken'");expect(audit).toThrow();db.exec("UPDATE cache_items SET text='Private paid body'");expect(audit).toThrow();
});
it('retains null originals but refuses complete-read count, bytes and elapsed bounds',()=>{
 const {db,audit}=fixture();db.exec("INSERT INTO cache_items VALUES('null-source',NULL)");expect(audit()).toMatchObject({rows:2,authenticatedRows:1,nullRows:1});expect(()=>auditCache(db,performance.now()-1)).toThrow();db.prepare('UPDATE cache_items SET text=? WHERE source_id=?').run('x'.repeat(2097153),'source-one');expect(audit).toThrow();db.exec('DELETE FROM cache_items');for(let i=0;i<513;i++)db.prepare('INSERT INTO cache_items VALUES(?,NULL)').run('source-'+i);expect(audit).toThrow();
});
it('requires one held mainnet identity and a valid existing key',()=>{
 const {db,audit}=fixture();delete process.env.CONTENT_MASTER_KEY;expect(audit).toThrow();process.env.CONTENT_MASTER_KEY='17'.repeat(32);db.exec('INSERT INTO keryx_storage_identity SELECT * FROM keryx_storage_identity');expect(audit).toThrow();db.exec('ROLLBACK');expect(audit).toThrow();
});
