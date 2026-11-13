/** Genuine selected SQLite producer for the compiled native read fixture only. */
import assert from 'node:assert/strict';
import { closeSync,existsSync,openSync,unlinkSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../../lib/canonical-json';
import { validateStorageIdentity,type StorageIdentity } from '../../lib/db/storage-identity';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { insertStorageIdentity,installStorageFences } from '../../lib/db/storage-identity-sqlite';
import { openVerifiedSqliteStorage } from '../../lib/db/storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../../lib/db/enrolled-sqlite-schema-profile';
import { inspectStorageDeploymentManifest } from '../../lib/db/runtime-storage-config';
import { createEnrolledSqliteAccountMembership } from '../../lib/accounts/sqlite-store';
import { createAccountMembershipService } from '../../lib/accounts/service';
export const nativeAccountFixtureTables=Object.freeze(['account267_accounts','account267_members','account267_credentials','account267_sessions','account267_challenges','account267_events']);
export const nativeAccountFixturePaths=(folder:string)=>{const file=join(folder,'accounts.sqlite');return [file,file+'-wal',file+'-shm',file+'-journal',join(folder,'accounts-storage.json')];};
export async function nativeAccountFixture(folder:string,rawIdentity:StorageIdentity,session:{hash:string;wallet:string;issuedAt:number;expiresAt:number}){
 const identity=validateStorageIdentity(rawIdentity),paths=nativeAccountFixturePaths(folder),file=paths[0],manifestPath=paths[4];assert(paths.every(path=>!existsSync(path)));
 const manifest=canonicalJson({format:'keryx-storage-deployment-v1',identity,backend:{kind:'sqlite',databasePath:file}}),binding={origin:'https://keryx.cc',network:'eip155:5042' as const};
 const login={sessionHash:session.hash,wallet:session.wallet,issuedAt:session.issuedAt,expiresAt:session.expiresAt};
 try{
  closeSync(openSync(file,'wx',0o600));const db=new DatabaseSync(file);
  try{db.exec('PRAGMA foreign_keys=ON;BEGIN IMMEDIATE');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);db.prepare('INSERT INTO web_sessions(hash,wallet,issued_at,expires_at) VALUES(?,?,?,?)').run(session.hash,session.wallet,session.issuedAt,session.expiresAt);insertStorageIdentity(db,identity);installStorageFences(db,identity);db.exec('COMMIT');}finally{db.close();}
  writeFileSync(manifestPath,manifest,{mode:0o600,flag:'wx'});
  const selected=openVerifiedSqliteStorage(file,identity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>assert.equal(canonicalJson(inspectStorageDeploymentManifest({KERYX_STORAGE_MANIFEST:manifestPath})),manifest)});
  try{
   const port=createEnrolledSqliteAccountMembership(selected.db);assert(port);const service=createAccountMembershipService(port,binding),consent={version:1 as const,privateAccount:true as const,shareOwnedHistory:true as const},issued=await service.prepareCreate(login,consent),snapshot=await service.completeCreate(login,issued.nonce,consent);await port.assertCurrent(snapshot);const offer=await port.offer(login,binding);assert(offer);
   const q=(v:string)=>"'"+v.replaceAll("'","''")+"'";let sql='';
   for(const table of nativeAccountFixtureTables)for(const row of selected.db.prepare('SELECT * FROM '+table).all()){
    const keys=Object.keys(row);assert(keys.every(key=>/^[a-z][a-z0-9_]*$/.test(key)));
    sql+=`INSERT INTO public.${table}(${keys.join(',')}) VALUES(${keys.map(key=>{const value=row[key];if(value===null)return 'NULL';if(typeof value==='number'||typeof value==='bigint')return String(value);assert(typeof value==='string');return q(value);}).join(',')});`;
   }
   return {sql,observation:{session:login,binding,snapshot,offer},accountId:snapshot.membership.accountId};
  }finally{selected.close();}
 }catch(error){for(const path of paths)if(existsSync(path))unlinkSync(path);throw error;}
}
