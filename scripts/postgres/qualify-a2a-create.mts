/** Fresh standalone producer only. Synthetic retained local facts, never a
 * provider/chain settlement or installed application-writer qualification. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,writeFileSync,readFileSync,existsSync,unlinkSync,rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ARC_MAINNET_PROFILE } from '../../lib/arc-network-profile';
import { canonicalJson } from '../../lib/canonical-json';
import { syntheticA2aOriginal } from '../../lib/db/a2a-original-fixture';
import { a2aRequestHash } from '../../lib/a2a/order';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { insertStorageIdentity,installStorageFences } from '../../lib/db/storage-identity-sqlite';
import { openVerifiedSqliteStorage,assertVerifiedSqliteConnection } from '../../lib/db/storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../../lib/db/enrolled-sqlite-schema-profile';
import { SqliteAdapter } from '../../lib/db/sqlite-adapter';
import { validateStorageIdentity,type StorageIdentity } from '../../lib/db/storage-identity';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import { createPostgresDomainChannel,PostgresDomainWriteOutcomeUnknown } from '../../lib/db/postgres/domain-channel';
import { composePostgresA2aOriginals } from '../../lib/db/postgres/a2a-originals-transport';
import { captureNativeA2aCreate } from '../../lib/db/postgres/a2a-create-packet';
import { acceptanceOriginalMetadata } from '../../lib/db/postgres/acceptance-metadata';
import { startCommitAckLossProxy } from './commit-ack-loss.mts';
import type { Client } from 'pg';
export async function qualifyA2aCreate(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;contentionClient:Client;ownerSql:(sql:string)=>string}){
 input={...input,identity:validateStorageIdentity(input.identity)};
 const folder=mkdtempSync(join(tmpdir(),'keryx-native-a2a-create-')),file=join(folder,'source.sqlite'),manifestPath=join(folder,'storage.json'),manifest=canonicalJson({format:'keryx-storage-deployment-v1',identity:input.identity,backend:{kind:'sqlite',databasePath:file}});
 const q=(s:string)=>"'"+s.replaceAll("'","''")+"'",pg=(sql:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+sql+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 const channel=createPostgresDomainChannel(input.options,input.identity,input.digest),native=composePostgresA2aOriginals(channel,false),labels=['valid','Unicode','missing purchase','wrong purchase','missing inbound','pending inbound','wrong inbound','rollback','race','lost ack','held','reader','contention'],fixtures=labels.map((label,i)=>{
  const f=syntheticA2aOriginal(1100+i,ARC_MAINNET_PROFILE);if(label==='Unicode')f.order.request!.question='T\u00e0i li\u1ec7u \ud83d\udd12 and e\u0301';f.order.requestHash=a2aRequestHash({...f.order,...f.order.request!});f.binding.requestHash=f.order.requestHash;return f;
 });
 const ids=fixtures.map(f=>f.order.id);let vectors=0,source:ReturnType<typeof openVerifiedSqliteStorage>|undefined,loss:ReturnType<typeof createPostgresDomainChannel>|undefined,proxy:Awaited<ReturnType<typeof startCommitAckLossProxy>>|undefined,storeId='';
 const copy=(table:string,row:Record<string,unknown>)=>{const keys=Object.keys(row);assert(['research_purchase_authorizations','payment_events'].includes(table)&&keys.every(k=>/^[a-z][a-z0-9_]*$/.test(k)));return `INSERT INTO public.${table}(${keys.join(',')}) VALUES(${keys.map(key=>{const v=row[key];if(v===null)return 'NULL';if(key==='settled')return v===1?'true':'false';if(typeof v==='number'||typeof v==='bigint')return String(v);assert(typeof v==='string');return q(v);}).join(',')});`;};
 try{
  assert.equal(input.ownerSql('SELECT count(*) FROM public.a2a_orders;'),'0');assert.equal(input.ownerSql('SELECT count(*) FROM public.deliverable_acceptance_store;'),'0');
  const db=new DatabaseSync(file);try{
   db.exec('BEGIN IMMEDIATE');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);storeId=String(db.prepare('SELECT id FROM deliverable_acceptance_store').get()!.id);
   for(let i=0;i<fixtures.length;i++){
    const {order:o,binding:b}=fixtures[i],label=labels[i];
    if(label!=='missing purchase')db.prepare("INSERT INTO research_purchase_authorizations(network,asset,payer,payee,authorization_id,product,purchase_id,request_hash,amount_micros) VALUES(?,?,?,?,?,'a2a',?,?,?)").run(b.network,b.asset,b.payer,b.payee,b.authorizationId,b.id,label==='wrong purchase'?'ab'.repeat(32):b.requestHash,Number(b.amountMicroUsdc));
    if(label!=='missing inbound')db.prepare("INSERT INTO payment_events(id,query_id,kind,source_id,payer,payee,amount_usdc,network,tx_hash,settled,settlement_status,authorization_id,created_at) VALUES(?,?,'inbound','a2a',?,?,?,?,?,?,?,?,?)").run('inbound_'+o.id,o.id,o.payer,label==='wrong inbound'?'0x'+'33'.repeat(20):o.payee,o.amountUsdc,b.network,o.transaction,label==='pending inbound'?0:1,label==='pending inbound'?'pending':'settled',o.authorizationId,o.createdAt);
   }
   insertStorageIdentity(db,input.identity);installStorageFences(db,input.identity);db.exec('COMMIT');let sql=`INSERT INTO public.deliverable_acceptance_store(singleton,id) VALUES(1,${q(storeId)});`;for(const table of ['research_purchase_authorizations','payment_events'])for(const row of db.prepare('SELECT * FROM '+table).all())sql+=copy(table,row);pg(sql);
  }finally{db.close();}
  writeFileSync(manifestPath,manifest,{mode:0o600});source=openVerifiedSqliteStorage(file,input.identity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>assert.equal(readFileSync(manifestPath,'utf8'),manifest)});
  const core=SqliteAdapter.assembleConnectionCore(source.db,input.identity,()=>{assert.equal(canonicalJson(assertVerifiedSqliteConnection(source!.db)),canonicalJson(input.identity));});
  const financial=()=>input.ownerSql("SELECT encode(sha256(convert_to(jsonb_build_array((SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.payment_events p),(SELECT jsonb_agg(to_jsonb(c) ORDER BY purchase_id) FROM public.research_purchase_authorizations c))::text,'UTF8')),'hex');"),beforeFinancial=financial();
  for(const label of ['valid','Unicode']){const f=fixtures[labels.indexOf(label)],expected=await core.createA2aOrder(f.order);assert.deepEqual(await native.createA2aOrder(f.order),expected);assert(expected.created);vectors++;
   const replay={...f.order,createdAt:'2026-11-14T00:00:00.000Z',updatedAt:'2026-11-14T00:00:00.000Z',request:{...f.order.request!,question:'Changed replay body'}};replay.requestHash=a2aRequestHash({...replay,...replay.request});assert.deepEqual(await native.createA2aOrder(replay),await core.createA2aOrder(replay));vectors++;
  }
  // These are explicit native post-settlement preconditions, beyond Source's
  // bare INSERT primitive: the real caller records both facts before creation.
  for(const label of ['missing purchase','wrong purchase','missing inbound','pending inbound','wrong inbound']){const f=fixtures[labels.indexOf(label)];await assert.rejects(native.createA2aOrder(f.order),e=>e instanceof PostgresDomainWriteOutcomeUnknown);assert.equal(await native.getA2aOrder(f.order.id),null);vectors++;}
  const rollback=fixtures[labels.indexOf('rollback')],captured=captureNativeA2aCreate(rollback.order),projection=acceptanceOriginalMetadata(captured.row,storeId);await assert.rejects(channel.call('a2aCreate',[rollback.order.id,JSON.stringify({binding:captured.binding,rowWire:captured.rowWire,projection:{...projection,orderSha256:'00'.repeat(32)}}),rollback.order.createdAt]),e=>e instanceof PostgresDomainWriteOutcomeUnknown);assert.equal(await native.getA2aOrder(rollback.order.id),null);assert.equal(await core.getA2aOrder(rollback.order.id),null);vectors++;
  assert.deepEqual(await native.createA2aOrder(rollback.order),await core.createA2aOrder(rollback.order));vectors++;
  const raced=fixtures[labels.indexOf('race')],results=await Promise.all([native.createA2aOrder(raced.order),native.createA2aOrder(raced.order)]);assert.equal(results.filter(r=>r.created).length,1);const oracle=await core.createA2aOrder(raced.order);assert(oracle.created);for(const r of results)assert.deepEqual(r.order,oracle.order);vectors++;
  assert(input.options.endpoint.kind==='loopback');proxy=await startCommitAckLossProxy(input.options.endpoint.port);loss=createPostgresDomainChannel({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest);const lost=fixtures[labels.indexOf('lost ack')],lossy=composePostgresA2aOriginals({get closed(){return loss!.closed;},close:()=>loss!.close(),call:(operation,args)=>{if(operation==='a2aCreate')proxy!.arm();return loss!.call(operation,args);}},false);await assert.rejects(lossy.createA2aOrder(lost.order),e=>e instanceof PostgresDomainWriteOutcomeUnknown);assert(proxy.observation().dropped);assert((await core.createA2aOrder(lost.order)).created);assert.equal((await native.createA2aOrder(lost.order)).created,false);assert.deepEqual(await native.getA2aOrder(lost.order.id),await core.getA2aOrder(lost.order.id));vectors++;
  const held=fixtures[labels.indexOf('held')];input.ownerSql("UPDATE keryx_storage.control SET mode='held';");try{await assert.rejects(native.createA2aOrder(held.order));vectors++;}finally{input.ownerSql("UPDATE keryx_storage.control SET mode='active';");}assert.equal(await native.getA2aOrder(held.order.id),null);
  const reader=createPostgresDomainChannel({...input.options,role:'keryx_reader'},input.identity,input.digest);try{await assert.rejects(composePostgresA2aOriginals(reader,true).createA2aOrder(fixtures[labels.indexOf('reader')].order));await assert.rejects(reader.call('a2aCreate',[held.order.id,'{}',held.order.createdAt]));vectors++;}finally{await reader.close();}
  const waiting=fixtures[labels.indexOf('contention')];await input.contentionClient.query('BEGIN');try{await input.contentionClient.query('SELECT pg_advisory_xact_lock(634781904177022::bigint)');await assert.rejects(native.createA2aOrder(waiting.order));vectors++;}finally{await input.contentionClient.query('ROLLBACK');}assert.equal(await native.getA2aOrder(waiting.order.id),null);
  assert.equal(financial(),beforeFinancial);assert.equal(input.ownerSql('SELECT count(*) FROM keryx_storage.writer;'),'0');
  return {vectors,actualVerifiedSqliteCore:true,validCreationAndReplayMatchSource:true,existingLocalPurchaseAndInboundRequired:true,oneConcurrentCreator:true,atomicProjectionRollback:true,actualLostCommitAck:true,readerAndHeldRefused:true,actualWriterContention:true,financialProofsUnchanged:true,ownershipAssociationGranted:false,fullWriterQualified:false,productionData:false,paymentActions:0,jobExecutions:0};
 }finally{try{await loss?.close();await proxy?.close();await channel.close();source?.close();const selected=ids.map(q).join(',');pg(`DELETE FROM public.a2a_orders WHERE id IN(${selected});DELETE FROM public.payment_events WHERE query_id IN(${selected});DELETE FROM public.research_purchase_authorizations WHERE purchase_id IN(${selected});`+(storeId?`DELETE FROM public.deliverable_acceptance_store WHERE id=${q(storeId)};`:''));}finally{for(const path of [file,file+'-wal',file+'-shm',file+'-journal',manifestPath])if(existsSync(path))unlinkSync(path);rmdirSync(folder);}}
}
