/** Synthetic retained rows for protocol comparison. The genuine SQLite core
 * inserts originals; fixture-owner import supplies associations. This cannot
 * mint either backend's opaque route proof or qualify the native writer. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARC_MAINNET_PROFILE } from '../../lib/arc-network-profile';
import { canonicalJson } from '../../lib/canonical-json';
import { syntheticA2aOriginal } from '../../lib/db/a2a-original-fixture';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { insertStorageIdentity,installStorageFences,registerStorageCapability } from '../../lib/db/storage-identity-sqlite';
import { openVerifiedSqliteStorage,assertVerifiedSqliteConnection } from '../../lib/db/storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../../lib/db/enrolled-sqlite-schema-profile';
import { assertPendingOwnerSessionRow } from '../../lib/db/pending-job-owners-sqlite';
import { SqliteAdapter } from '../../lib/db/sqlite-adapter';
import { validateStorageIdentity,type StorageIdentity } from '../../lib/db/storage-identity';
import type { PostgresPendingOwnerSessionPacket } from '../../lib/a2a/pending-owner-association';
import { acceptanceOriginalMetadata } from '../../lib/db/postgres/acceptance-metadata';

export const nativePendingOwnerFixturePaths=(folder:string)=>{const file=join(folder,'pending-owner.sqlite');return [file,file+'-wal',file+'-shm',file+'-journal',join(folder,'pending-owner-storage.json')];};
export async function nativePendingOwnerFixture(folder:string,rawIdentity:StorageIdentity){
 const identity=validateStorageIdentity(rawIdentity),paths=nativePendingOwnerFixturePaths(folder),stamp=Date.now(),session={hash:'e1'.repeat(32),wallet:'0x'+'e2'.repeat(20),issuedAt:stamp-2000,expiresAt:stamp+600000};
 const manifest=canonicalJson({format:'keryx-storage-deployment-v1',identity,backend:{kind:'sqlite',databasePath:paths[0]}});
 const db=new DatabaseSync(paths[0]);try{db.exec('BEGIN IMMEDIATE');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);db.prepare('INSERT INTO web_sessions VALUES(?,?,?,?)').run(session.hash,session.wallet,session.issuedAt,session.expiresAt);insertStorageIdentity(db,identity);installStorageFences(db,identity);db.exec('COMMIT');}finally{db.close();}
 writeFileSync(paths[4],manifest,{mode:0o600,flag:'wx'});
 const selected=openVerifiedSqliteStorage(paths[0],identity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>assert.equal(readFileSync(paths[4],'utf8'),manifest)});
 try{
  const core=SqliteAdapter.assembleConnectionCore(selected.db,identity,()=>assert.equal(canonicalJson(assertVerifiedSqliteConnection(selected.db)),canonicalJson(identity)));
  const orders=Array.from({length:31},(_,i)=>{const f=syntheticA2aOriginal(1700+i,ARC_MAINNET_PROFILE),at=new Date(stamp-1000+Math.floor(i/2)).toISOString(),created=i===26?at.replace('Z','+00:00'):i===27?new Date(stamp-1000+Math.floor(i/2)+7*3600000).toISOString().replace('Z','+07:00'):at;return {...f.order,createdAt:created,updatedAt:at,...(i===0?{status:'running' as const,startedAt:at,workerId:'synthetic-pending-worker'}:i%2?{status:'failed' as const,errorCode:'research_failed'}:{status:'completed' as const}),...(i===26?{response:{answer:'retained\\u0000 literal and actual \0\ud800'}}:{})};});
  for(const order of orders)assert((await core.createA2aOrder(order)).created);
  // This is an owner-imported original prefix, not a producer-issued proof or
  // admission result. Corrupt/foreign rows test exact immutable join exclusion.
  const owner=(work:(writer:DatabaseSync)=>void)=>{const writer=new DatabaseSync(paths[0]);try{registerStorageCapability(writer,identity,()=>true);writer.exec('BEGIN IMMEDIATE');work(writer);writer.exec('COMMIT');}finally{writer.close();}};
  const recovery=JSON.stringify({workerId:orders[0].workerId,status:'recovery_pending',orderId:orders[0].id,updatedAt:new Date(stamp).toISOString()});
  owner(writer=>{
   const insert=writer.prepare('INSERT INTO pending_job_owners(job_id,query_id,request_hash,network,wallet,session_hash,issued_at,expires_at,admitted_at) VALUES(?,?,?,?,?,?,?,?,?)');
   for(let i=0;i<orders.length;i++){const o=orders[i];insert.run(o.id,o.queryId,i===28?'ff'.repeat(32):o.requestHash,identity.network,i===29?'0x'+'ef'.repeat(20):session.wallet,session.hash,session.issuedAt,session.expiresAt,i===30?new Date(stamp-5000).toISOString():o.createdAt);}
   writer.prepare("INSERT INTO sync_state(key,value) VALUES('a2aWorker',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(recovery);
  });
  const q=(value:string)=>"'"+value.replaceAll("'","''")+"'";
  const storeId=String(selected.db.prepare('SELECT id FROM deliverable_acceptance_store').get()!.id);
  const tables=['deliverable_acceptance_store','web_sessions','a2a_orders','pending_job_owners','sync_state'] as const;
  let sql='';for(const table of tables)for(const row of selected.db.prepare('SELECT * FROM '+table).all()){
   const keys=Object.keys(row);assert(keys.every(key=>/^[a-z][a-z0-9_]*$/.test(key)));
   sql+=`INSERT INTO public.${table}(${keys.join(',')}) VALUES(${keys.map(key=>{const value=row[key];return value===null?'NULL':typeof value==='number'||typeof value==='bigint'?String(value):q(String(value));}).join(',')})${table==='sync_state'?' ON CONFLICT(key) DO UPDATE SET value=excluded.value':''};`;
  }
  for(const row of selected.db.prepare('SELECT * FROM a2a_orders').all()){
   const p=acceptanceOriginalMetadata(row,storeId);
   sql+=`INSERT INTO keryx_storage.acceptance_original_projection(order_id,store_id,source_order_wire,source_order_sha256,delivery_token,owner,network,binding,health_meta) VALUES(${[p.orderId,p.storeId,p.orderWire,p.orderSha256,p.deliveryToken,p.owner,p.network].map(v=>v===null?'NULL':q(v)).join(',')},${p.binding===null?'NULL':q(JSON.stringify(p.binding))+'::jsonb'},${q(JSON.stringify(p.health))}::jsonb);`;
  }
  const packet=(admit=false):PostgresPendingOwnerSessionPacket=>({identity,session:{...session},proofExpiresAt:Date.now()+120000,binding:admit?{id:orders[0].id,requestHash:orders[0].requestHash}:null});
  const current=(value:PostgresPendingOwnerSessionPacket)=>{selected.db.exec('BEGIN');try{assertVerifiedSqliteConnection(selected.db);assertPendingOwnerSessionRow(selected.db,{...value.session,proofExpiresAt:value.proofExpiresAt});assertVerifiedSqliteConnection(selected.db);}finally{selected.db.exec('ROLLBACK');}};
  const rows=(before?:{createdAt:string;id:string},id?:string)=>{
   selected.db.exec('BEGIN');try{
    assertVerifiedSqliteConnection(selected.db);assertPendingOwnerSessionRow(selected.db,{...session,proofExpiresAt:Date.now()+120000});
    const result=selected.db.prepare(`SELECT o.id,o.query_id,o.status,o.created_at,o.updated_at,o.started_at,o.amount_usdc,o.creator_budget_usdc,o.service_fee_usdc,o.research_mode,
     CASE WHEN length(CAST(o.package_data AS BLOB))<=8192 THEN o.package_data ELSE NULL END package_data,
     CASE WHEN length(CAST(o.transaction_id AS BLOB))<=256 THEN o.transaction_id ELSE '' END transaction_id,o.execution_journal_version,o.payment_started_at,o.result_saving_at,o.error_code,
     CASE WHEN length(CAST(o.worker_id AS BLOB))<=256 THEN o.worker_id ELSE NULL END worker_id,CASE WHEN length(CAST(o.payee AS BLOB))=42 THEN o.payee ELSE NULL END payee
     FROM pending_job_owners p JOIN a2a_orders o ON o.id=p.job_id AND o.query_id=p.query_id AND o.request_hash=p.request_hash AND o.created_at=p.admitted_at
     WHERE p.wallet=? AND p.network=? AND o.status IN('running','failed','completed') ${id?'AND o.id=?':''} ${before?'AND (o.created_at<? OR (o.created_at=? AND o.id<?))':''}
     ORDER BY o.created_at DESC,o.id DESC LIMIT 26`).all(session.wallet,identity.network,...(id?[id]:[]),...(before?[before.createdAt,before.createdAt,before.id]:[]));
    assertPendingOwnerSessionRow(selected.db,session);return JSON.parse(JSON.stringify(result)) as Record<string,unknown>[];
   }finally{selected.db.exec('ROLLBACK');}
  };
  return {selected,core,orders,session,recovery,paths,sql,packet,current,rows,owner,storeId};
 }catch(error){selected.close();throw error;}
}
