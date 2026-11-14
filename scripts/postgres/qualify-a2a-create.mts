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
import { insertStorageIdentity,installStorageFences,registerStorageCapability } from '../../lib/db/storage-identity-sqlite';
import { openVerifiedSqliteStorage,assertVerifiedSqliteConnection } from '../../lib/db/storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../../lib/db/enrolled-sqlite-schema-profile';
import { SqliteAdapter } from '../../lib/db/sqlite-adapter';
import { validateStorageIdentity,type StorageIdentity } from '../../lib/db/storage-identity';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import { createPostgresDomainChannel,PostgresDomainWriteOutcomeUnknown } from '../../lib/db/postgres/domain-channel';
import { composePostgresA2aOriginals } from '../../lib/db/postgres/a2a-originals-transport';
import { captureNativeA2aCreate } from '../../lib/db/postgres/a2a-create-packet';
import { acceptanceOriginalMetadata } from '../../lib/db/postgres/acceptance-metadata';
import { assertPendingOwnerSessionRow } from '../../lib/db/pending-job-owners-sqlite';
import type { A2aOrder } from '../../lib/a2a/order';
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
  const owned=await qualifyOwnedCreateProtocol({...input,source,core,file,storeId,channel,copy});
  assert.equal(financial(),beforeFinancial);assert.equal(input.ownerSql('SELECT count(*) FROM keryx_storage.writer;'),'0');
  return {vectors,owned,actualVerifiedSqliteCore:true,validCreationAndReplayMatchSource:true,existingLocalPurchaseAndInboundRequired:true,oneConcurrentCreator:true,atomicProjectionRollback:true,actualLostCommitAck:true,readerAndHeldRefused:true,actualWriterContention:true,financialProofsUnchanged:true,productionOwnershipAssociationGranted:false,fullWriterQualified:false,productionData:false,paymentActions:0,jobExecutions:0};
 }finally{try{await loss?.close();await proxy?.close();await channel.close();source?.close();const selected=ids.map(q).join(',');pg(`DELETE FROM public.a2a_orders WHERE id IN(${selected});DELETE FROM public.payment_events WHERE query_id IN(${selected});DELETE FROM public.research_purchase_authorizations WHERE purchase_id IN(${selected});`+(storeId?`DELETE FROM public.deliverable_acceptance_store WHERE id=${q(storeId)};`:''));}finally{for(const path of [file,file+'-wal',file+'-shm',file+'-journal',manifestPath])if(existsSync(path))unlinkSync(path);rmdirSync(folder);}}
}

/** Native SQL packets below are explicit synthetic protocol inputs. The Source
 * side uses the genuine verified original core and actual durable-session
 * helper in one transaction, matching Source's insertion/replay algorithm.
 * Neither side counterfeits an opaque proof or installed native writer. */
async function qualifyOwnedCreateProtocol(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;contentionClient:Client;ownerSql:(sql:string)=>string;
 source:ReturnType<typeof openVerifiedSqliteStorage>;core:ReturnType<typeof SqliteAdapter.assembleConnectionCore>;file:string;storeId:string;channel:ReturnType<typeof createPostgresDomainChannel>;copy:(table:string,row:Record<string,unknown>)=>string}){
 const q=(value:string)=>"'"+value.replaceAll("'","''")+"'",pg=(sql:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+sql+"UPDATE keryx_storage.control SET mode='active';COMMIT;"),stamp=Date.now();
 const sessions=[{hash:'c1'.repeat(32),wallet:'0x'+'c2'.repeat(20),issuedAt:stamp-10000,expiresAt:stamp+600000},{hash:'c3'.repeat(32),wallet:'0x'+'c4'.repeat(20),issuedAt:stamp-10000,expiresAt:stamp+600000}];
 const labels=['valid','rollback','race','lost ack','invalid packet','expiry wait','revoked'],fixtures=labels.map((_,i)=>{const f=syntheticA2aOriginal(2100+i,ARC_MAINNET_PROFILE);f.order.createdAt=new Date(stamp-1000).toISOString();f.order.updatedAt=f.order.createdAt;return f;});
 const ids=fixtures.map(f=>f.order.id),owner=(work:(db:DatabaseSync)=>void)=>{const db=new DatabaseSync(input.file);try{registerStorageCapability(db,input.identity,()=>true);db.exec('BEGIN IMMEDIATE');work(db);db.exec('COMMIT');}finally{db.close();}};
 let proxy:Awaited<ReturnType<typeof startCommitAckLossProxy>>|undefined,loss:ReturnType<typeof createPostgresDomainChannel>|undefined,vectors=0,seeded=false;
 const packet=(original:A2aOrder,session=sessions[0],deadline=Date.now()+120000)=>{
  const captured=captureNativeA2aCreate(original),projection=acceptanceOriginalMetadata(captured.row,input.storeId);
  return {binding:captured.binding,rowWire:captured.rowWire,projection,owner:{identity:{...input.identity},session:{...session},proofExpiresAt:deadline,
   binding:{id:original.id,requestHash:original.requestHash},original:{id:original.id,queryId:original.queryId,requestHash:original.requestHash,network:input.identity.network,createdAt:original.createdAt}}};
 };
 const args=(original:A2aOrder,value:unknown)=>[original.id,JSON.stringify(value),original.createdAt] as const;
 const raw=async(original:A2aOrder,value:unknown)=>{const result=await input.channel.call('a2aCreate',args(original,value));assert(result&&typeof result==='object'&&!Array.isArray(result)&&typeof Reflect.get(result,'created')==='boolean');return result as {created:boolean;order:Record<string,unknown>};};
 const sourceOwned=async(original:A2aOrder,session=sessions[0],deadline=Date.now()+120000)=>{
  input.source.db.exec('BEGIN IMMEDIATE');try{
   assertVerifiedSqliteConnection(input.source.db);assertPendingOwnerSessionRow(input.source.db,{...session,proofExpiresAt:deadline});
   const result=await input.core.createA2aOrder(original);
   if(result.created)input.source.db.prepare('INSERT INTO pending_job_owners(job_id,query_id,request_hash,network,wallet,session_hash,issued_at,expires_at,admitted_at) VALUES(?,?,?,?,?,?,?,?,?)').run(original.id,original.queryId,original.requestHash,input.identity.network,session.wallet,session.hash,session.issuedAt,session.expiresAt,original.createdAt);
   assertPendingOwnerSessionRow(input.source.db,{...session,proofExpiresAt:deadline});assertVerifiedSqliteConnection(input.source.db);input.source.db.exec('COMMIT');return result;
  }catch(error){if(input.source.db.isTransaction)input.source.db.exec('ROLLBACK');throw error;}
 };
 const association=(id:string)=>{const text=input.ownerSql(`SELECT coalesce((SELECT to_jsonb(p)::text FROM public.pending_job_owners p WHERE job_id=${q(id)}),'null');`);return JSON.parse(text) as Record<string,unknown>|null;};
 const compareAssociation=(id:string)=>{const expected=input.source.db.prepare('SELECT * FROM pending_job_owners WHERE job_id=?').get(id)??null;assert.deepEqual(association(id),expected===null?null:JSON.parse(JSON.stringify(expected)));};
 const compareOriginal=async(id:string)=>assert.deepEqual(await composePostgresA2aOriginals(input.channel,false).getA2aOrder(id),await input.core.getA2aOrder(id));
 const native=composePostgresA2aOriginals(input.channel,false),timeAt=(delta:number)=>new Date(stamp+delta).toISOString();
 const compareOwnedMetadata=async(id:string)=>{
  const retained=association(id);assert(retained);const session=sessions.find(s=>s.wallet===retained.wallet);assert(session);
  const value=await input.channel.call('pendingOwnerList',[JSON.stringify({identity:input.identity,session,proofExpiresAt:Date.now()+120000,binding:null}),null,id]);
  assert(value&&typeof value==='object');const rows=Reflect.get(value,'rows');assert(Array.isArray(rows));
  input.source.db.exec('BEGIN');try{
   assertVerifiedSqliteConnection(input.source.db);assertPendingOwnerSessionRow(input.source.db,session);
   const expected=input.source.db.prepare(`SELECT o.id,o.status,o.created_at,o.updated_at,o.started_at,o.payment_started_at,o.result_saving_at
    FROM pending_job_owners p JOIN a2a_orders o ON o.id=p.job_id AND o.query_id=p.query_id AND o.request_hash=p.request_hash AND o.created_at=p.admitted_at
    WHERE o.id=? AND p.wallet=? AND p.network=?`).all(id,session.wallet,input.identity.network);
   const fields=['id','status','created_at','updated_at','started_at','payment_started_at','result_saving_at'];
   assert.deepEqual(rows.map(row=>Object.fromEntries(fields.map(field=>[field,Reflect.get(row,field)]))),JSON.parse(JSON.stringify(expected)));
   assert(!JSON.stringify(value).includes('Synthetic original'));assertPendingOwnerSessionRow(input.source.db,session);
  }finally{input.source.db.exec('ROLLBACK');}
  await compareOriginal(id);compareAssociation(id);vectors++;
 };
 const absent=async(id:string)=>{assert.equal(await composePostgresA2aOriginals(input.channel,false).getA2aOrder(id),null);assert.equal(association(id),null);assert.equal(input.ownerSql(`SELECT count(*) FROM keryx_storage.acceptance_original_projection WHERE order_id=${q(id)};`),'0');};
 const blocked=async(outcome:{settled:boolean},proofExpiresAt:number)=>{
  // Fresh catalog admission precedes the data lock. Observe that real lock,
  // rather than assuming admission finishes inside a 300ms polling sweep.
  const deadline=Date.now()+4000;
  while(Date.now()<deadline){
   const r=await input.contentionClient.query('SELECT count(*) n FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND pg_backend_pid()=ANY(pg_blocking_pids(pid))');
   if(Number(r.rows[0].n)>0){assert(Date.now()<proofExpiresAt,'Owned proof expired before actual data lock was observed');assert(!outcome.settled,'Owned create settled before actual data lock observation');return;}
   assert(!outcome.settled,'Owned create terminated before reaching actual data lock');
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.fail('Owned create did not reach actual data lock before native statement deadline');
 };
 try{
  owner(db=>{
   for(const s of sessions)db.prepare('INSERT INTO web_sessions VALUES(?,?,?,?)').run(s.hash,s.wallet,s.issuedAt,s.expiresAt);
   for(const {order:o,binding:b} of fixtures){db.prepare("INSERT INTO research_purchase_authorizations(network,asset,payer,payee,authorization_id,product,purchase_id,request_hash,amount_micros) VALUES(?,?,?,?,?,'a2a',?,?,?)").run(b.network,b.asset,b.payer,b.payee,b.authorizationId,b.id,b.requestHash,Number(b.amountMicroUsdc));db.prepare("INSERT INTO payment_events(id,query_id,kind,source_id,payer,payee,amount_usdc,network,tx_hash,settled,settlement_status,authorization_id,created_at) VALUES(?,?,'inbound','a2a',?,?,?,?,?,1,'settled',?,?)").run('inbound_'+o.id,o.id,o.payer,o.payee,o.amountUsdc,b.network,o.transaction,o.authorizationId,o.createdAt);}
  });
  let sql=sessions.map(s=>`INSERT INTO public.web_sessions VALUES(${q(s.hash)},${q(s.wallet)},${s.issuedAt},${s.expiresAt});`).join('');
  for(const table of ['research_purchase_authorizations','payment_events'])for(const row of input.source.db.prepare(`SELECT * FROM ${table} WHERE ${table==='payment_events'?'query_id':'purchase_id'} IN(${ids.map(()=>'?').join(',')})`).all(...ids))sql+=input.copy(table,row);pg(sql);seeded=true;
  const valid=fixtures[0].order,result=await raw(valid,packet(valid));assert(result.created);assert((await sourceOwned(valid)).created);await compareOriginal(valid.id);compareAssociation(valid.id);assert.equal(association(valid.id)!.wallet,sessions[0].wallet);assert.notEqual(association(valid.id)!.wallet,valid.payer);vectors++;
  await compareOwnedMetadata(valid.id);
  assert.deepEqual(await native.claimA2aOriginal(fixtures[0].binding,'synthetic-owned-worker',timeAt(-900)),await input.core.claimNextA2aOrder('synthetic-owned-worker',timeAt(-900),fixtures[0].binding));await compareOwnedMetadata(valid.id);
  for(const delta of [-800,-700]){assert.equal(await native.markA2aOrderPaymentStarted(valid.id,timeAt(delta)),await input.core.markA2aOrderPaymentStarted(valid.id,timeAt(delta)));await compareOwnedMetadata(valid.id);}
  for(const delta of [-600,-500]){assert.equal(await native.markA2aOrderResultSaving(valid.id,timeAt(delta)),await input.core.markA2aOrderResultSaving(valid.id,timeAt(delta)));await compareOwnedMetadata(valid.id);}
  assert.equal(await native.failA2aOrder(valid.id,'synthetic_owned_failure',timeAt(-400)),await input.core.failA2aOrder(valid.id,'synthetic_owned_failure',timeAt(-400)));await compareOwnedMetadata(valid.id);
  assert.equal(input.ownerSql(`SELECT count(*) FROM keryx_storage.acceptance_original_projection WHERE order_id=${q(valid.id)};`),'0');
  const replay={...valid,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};replay.updatedAt=replay.createdAt;
  assert.equal((await raw(replay,packet(replay,sessions[1]))).created,false);assert.equal((await sourceOwned(replay,sessions[1])).created,false);await compareOriginal(valid.id);compareAssociation(valid.id);vectors++;
  const standalone=syntheticA2aOriginal(1100,ARC_MAINNET_PROFILE).order,proposed={...standalone,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};proposed.updatedAt=proposed.createdAt;
  assert.equal((await raw(proposed,packet(proposed,sessions[1]))).created,false);assert.equal((await sourceOwned(proposed,sessions[1])).created,false);assert.equal(association(proposed.id),null);vectors++;
  const invalid=fixtures[4].order;
  const refuse=async(change:(value:ReturnType<typeof packet>)=>void)=>{const value=packet(invalid);change(value);await assert.rejects(raw(invalid,value),error=>error instanceof PostgresDomainWriteOutcomeUnknown);await absent(invalid.id);vectors++;};
  for(const field of Object.keys(input.identity) as (keyof StorageIdentity)[])await refuse(value=>{Reflect.set(value.owner.identity,field,'changed');});
  for(const field of ['hash','wallet','issuedAt','expiresAt'] as const)await refuse(value=>{Reflect.set(value.owner.session,field,field==='hash'?'ff'.repeat(32):field==='wallet'?'0x'+'ff'.repeat(20):value.owner.session[field]+1);});
  await refuse(value=>{value.owner.proofExpiresAt=Date.now()-1;});await refuse(value=>{value.owner.proofExpiresAt=Date.now()+600001;});
  await refuse(value=>{value.owner.binding.requestHash='ff'.repeat(32);});await refuse(value=>{value.owner.original.id=fixtures[0].order.id;});await refuse(value=>{value.owner.original.network='eip155:5042002';});await refuse(value=>{value.owner.original.createdAt=new Date(stamp-10001).toISOString();});
  await refuse(value=>{Reflect.set(value.owner,'payer',invalid.payer);});await refuse(value=>{Reflect.set(value,'owner',null);});
  const rollback=fixtures[1].order,bad=packet(rollback);bad.projection={...bad.projection,orderSha256:'00'.repeat(32)};
  await assert.rejects(raw(rollback,bad),error=>error instanceof PostgresDomainWriteOutcomeUnknown);await absent(rollback.id);vectors++;
  const race=fixtures[2].order,raced=await Promise.all([raw(race,packet(race,sessions[0])),raw(race,packet(race,sessions[1]))]);assert.equal(raced.filter(r=>r.created).length,1);const winner=raced[0].created?0:1;assert((await sourceOwned(race,sessions[winner])).created);await compareOriginal(race.id);compareAssociation(race.id);vectors++;
  assert.deepEqual(await native.claimA2aOriginal(fixtures[2].binding,'synthetic-owned-completion',timeAt(-300)),await input.core.claimNextA2aOrder('synthetic-owned-completion',timeAt(-300),fixtures[2].binding));await compareOwnedMetadata(race.id);
  const paidResponse={answer:'owned postpaid body\0\ud800'};assert.equal(await native.completeA2aOrder(race.id,paidResponse,timeAt(-200)),await input.core.completeA2aOrder(race.id,paidResponse,timeAt(-200)));await compareOwnedMetadata(race.id);
  assert(input.options.endpoint.kind==='loopback');proxy=await startCommitAckLossProxy(input.options.endpoint.port);loss=createPostgresDomainChannel({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest);const lost=fixtures[3].order;proxy.arm();await assert.rejects(loss.call('a2aCreate',args(lost,packet(lost))),error=>error instanceof PostgresDomainWriteOutcomeUnknown);assert.deepEqual(proxy.observation(),{dropped:true,commands:1});assert((await sourceOwned(lost)).created);await compareOriginal(lost.id);compareAssociation(lost.id);vectors++;
  const waiting=fixtures[5].order;await input.contentionClient.query('BEGIN');try{
   await input.contentionClient.query('SELECT pg_advisory_xact_lock_shared(634781904177021::bigint),pg_advisory_xact_lock(634781904177022::bigint)');
   const value=packet(waiting,sessions[0],Date.now()+700),outcome={settled:false};
   const pending=raw(waiting,value).then(v=>{outcome.settled=true;return {v};},error=>{outcome.settled=true;return {error};});
   await blocked(outcome,value.owner.proofExpiresAt);
   await new Promise(resolve=>setTimeout(resolve,Math.max(0,value.owner.proofExpiresAt-Date.now()+10)));
   assert(Date.now()>=value.owner.proofExpiresAt,'Owned proof must expire before lock release');
   assert(!outcome.settled,'Owned create timed out or failed while data lock remained held');
   await input.contentionClient.query('COMMIT');assert('error'in await pending);
   await assert.rejects(sourceOwned(waiting,sessions[0],value.owner.proofExpiresAt));await absent(waiting.id);vectors++;
  }finally{await input.contentionClient.query('ROLLBACK');}
  const revoked=fixtures[6].order;owner(db=>db.prepare('DELETE FROM web_sessions WHERE hash=?').run(sessions[0].hash));pg(`DELETE FROM public.web_sessions WHERE hash=${q(sessions[0].hash)};`);await assert.rejects(raw(revoked,packet(revoked)));await assert.rejects(sourceOwned(revoked));await absent(revoked.id);await assert.rejects(raw(replay,packet(replay)));compareAssociation(valid.id);vectors++;
  return {vectors,rawNativeOwnedPacketsSynthetic:true,genuineVerifiedSqliteCoreAndSessionHelper:true,sourceInsertionAlgorithmCompared:true,ownedListAfterCreateClaimCheckpointsFailureAndCompletion:true,sourceTimeWiresSurviveBodyProjectionInvalidation:true,opaqueNativeProofMinted:false,installedNativeOwnedProducerQualified:false,firstInsertOnlyAssociation:true,foreignSessionReplayNeverReassociates:true,standaloneReplayNeverBackfills:true,ownerNeverInferredFromPayer:true,atomicOriginalProjectionOwnerRollback:true,oneConcurrentOwner:true,lostAckObservedWithoutRetry:true,currentExpiryAfterDataLock:true,revokedSessionBlocksNewAndReplay:true,productionData:false,paymentActions:0,jobExecutions:0};
 }finally{
  await loss?.close();await proxy?.close();if(seeded)pg(`ALTER TABLE public.pending_job_owners DISABLE TRIGGER native_pending_owner_retained;DELETE FROM public.pending_job_owners WHERE job_id IN(${ids.map(q).join(',')});ALTER TABLE public.pending_job_owners ENABLE TRIGGER native_pending_owner_retained;DELETE FROM public.a2a_orders WHERE id IN(${ids.map(q).join(',')});DELETE FROM public.payment_events WHERE query_id IN(${ids.map(q).join(',')});DELETE FROM public.research_purchase_authorizations WHERE purchase_id IN(${ids.map(q).join(',')});DELETE FROM public.web_sessions WHERE hash IN(${sessions.map(s=>q(s.hash)).join(',')});`);
 }
}
