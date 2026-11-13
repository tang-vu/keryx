/** Genuine selected SQLite opt-in publication for the compiled read fixture. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { nativeAccountFixturePaths } from './native-account-fixture.mts';
import type { StorageIdentity } from '../../lib/db/storage-identity';
import { registerStorageCapability } from '../../lib/db/storage-identity-sqlite';
import { openVerifiedSqliteStorage } from '../../lib/db/storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../../lib/db/enrolled-sqlite-schema-profile';
import { createEnrolledSqlitePublicProfiles } from '../../lib/db/public-profiles-sqlite';
export async function nativePublicProfileFixture(folder:string,identity:StorageIdentity,session:{wallet:string;hash:string}){
 const paths=nativeAccountFixturePaths(folder),manifest=readFileSync(paths[4],'utf8'),handle='runtime_researcher',date='2026-11-13T00:00:00.000Z',binding={network:'eip155:5042' as const,origin:'https://keryx.cc'},actor={wallet:session.wallet,sessionHash:session.hash,binding};
 const source=new DatabaseSync(paths[0]);try{registerStorageCapability(source,identity,()=>true);source.exec('BEGIN IMMEDIATE');source.prepare('INSERT INTO private_profiles VALUES(?,?,?,?,?,?,?,?)').run(session.wallet,handle,'Synthetic researcher','Private profile bio','Private purpose','[]',date,date);source.exec('COMMIT');}finally{source.close();}
 const selected=openVerifiedSqliteStorage(paths[0],identity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>assert.equal(readFileSync(paths[4],'utf8'),manifest)});
 try{
  const port=createEnrolledSqlitePublicProfiles(selected.db);assert(port);await port.update(actor,{published:true,fields:['displayName','about','verifiedLinks','ledgers'],runIds:[],revision:0});
  const snapshot=await port.read(handle),settings=await port.settings(actor),sitemap=await port.sitemap(10);assert(snapshot);
  const q=(s:string)=>"'"+s.replaceAll("'","''")+"'";let sql='';
  for(const table of ['private_profiles','public_researcher_profiles'])for(const row of selected.db.prepare('SELECT * FROM '+table+' WHERE wallet=?').all(session.wallet)){
   const keys=Object.keys(row);assert(keys.every(k=>/^[a-z][a-z0-9_]*$/.test(k)));sql+=`INSERT INTO public.${table}(${keys.join(',')}) VALUES(${keys.map(k=>{const v=row[k];if(v===null)return 'NULL';if(typeof v==='number'||typeof v==='bigint')return String(v);assert(typeof v==='string');return q(v);}).join(',')});`;
  }
  return {sql,observation:{actor,handle,snapshot,settings,sitemap}};
 }finally{selected.close();}
}
