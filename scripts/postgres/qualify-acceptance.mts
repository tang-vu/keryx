/** Genuine selected SQLite/current native choice journal, synthetic facts only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,writeFileSync,unlinkSync,rmdirSync,existsSync,realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname,resolve } from 'node:path';
import { ARC_MAINNET_PROFILE } from '../../lib/arc-network-profile';
import { canonicalJson } from '../../lib/canonical-json';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { insertStorageIdentity,installStorageFences,registerStorageCapability } from '../../lib/db/storage-identity-sqlite';
import { validateStorageIdentity,type StorageIdentity } from '../../lib/db/storage-identity';
import { openVerifiedSqliteStorage } from '../../lib/db/storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../../lib/db/enrolled-sqlite-schema-profile';
import { inspectStorageDeploymentManifest } from '../../lib/db/runtime-storage-config';
import { syntheticA2aOriginal } from '../../lib/db/a2a-original-fixture';
import { createEnrolledSqliteDeliverableAcceptance } from '../../lib/db/deliverable-acceptance-sqlite';
import { createPostgresDomainChannel,PostgresDomainWriteOutcomeUnknown } from '../../lib/db/postgres/domain-channel';
import { composePostgresAcceptance } from '../../lib/db/postgres/acceptance-transport';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import type { AcceptanceInput } from '../../lib/deliverable-acceptance/contracts';
import { sqliteAcceptanceProjection,heldAcceptanceProjectionSql } from './acceptance-projection.mts';
import { startCommitAckLossProxy } from './commit-ack-loss.mts';
export async function qualifyAcceptance(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;ownerSql:(sql:string)=>string}){
 const folder=mkdtempSync(join(tmpdir(),'keryx-native-acceptance-')),file=join(folder,'oracle.sqlite'),manifestPath=join(folder,'storage.json');
 const identity=validateStorageIdentity({...input.identity,deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),provenanceDigest:'d7'.repeat(32)}),manifest=canonicalJson({format:'keryx-storage-deployment-v1',identity,backend:{kind:'sqlite',databasePath:file}});
 const fixture=syntheticA2aOriginal(731,ARC_MAINNET_PROFILE),{order,binding}=fixture,session='e8'.repeat(32),key=randomUUID(),now=Date.now(),q=(s:string)=>"'"+s.replaceAll("'","''")+"'";
 const channel=createPostgresDomainChannel(input.options,input.identity,input.digest),native=composePostgresAcceptance(channel,false);let vectors=0,storeId:string|undefined;
 let lossProxy:Awaited<ReturnType<typeof startCommitAckLossProxy>>|undefined,lossChannel:ReturnType<typeof createPostgresDomainChannel>|undefined;
 const pg=(s:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+s+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 const owner=(action:(db:DatabaseSync)=>void)=>{const db=new DatabaseSync(file);try{registerStorageCapability(db,identity,()=>true);db.exec('BEGIN IMMEDIATE');action(db);db.exec('COMMIT');}finally{db.close();}};
 const oracle=async<T,>(work:(port:NonNullable<ReturnType<typeof createEnrolledSqliteDeliverableAcceptance>>)=>Promise<T>,readOnly=false)=>{const c=openVerifiedSqliteStorage(file,identity,{readOnly,applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>assert.equal(canonicalJson(inspectStorageDeploymentManifest({KERYX_STORAGE_MANIFEST:manifestPath})),manifest)});try{const port=createEnrolledSqliteDeliverableAcceptance(c.db);assert(port);return await work(port);}finally{c.close();}};
 const copy=(table:string,row:Record<string,unknown>)=>{assert(['a2a_orders','payment_events','research_purchase_authorizations','web_sessions','api_keys'].includes(table));const keys=Object.keys(row);assert(keys.every(k=>/^[a-z][a-z0-9_]*$/.test(k)));return `INSERT INTO public.${table}(${keys.join(',')}) VALUES(${keys.map(k=>{const v=row[k];if(v===null)return 'NULL';if(k==='settled')return v===1?'true':'false';if(typeof v==='number'||typeof v==='bigint')return String(v);assert(typeof v==='string');return q(v)+(table==='a2a_orders'&&['request_data','response_data','package_data','resolution_data'].includes(k)?'::jsonb':'');}).join(',')}) ON CONFLICT DO NOTHING;`;};
 const originalCounts=()=>input.ownerSql(`SELECT encode(sha256(convert_to(jsonb_build_array((SELECT to_jsonb(a) FROM public.a2a_orders a WHERE id=${q(order.id)}),(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.payment_events p WHERE query_id=${q(order.id)}),(SELECT jsonb_agg(to_jsonb(c) ORDER BY network,asset,payer,authorization_id) FROM public.research_purchase_authorizations c WHERE purchase_id=${q(order.id)}))::text,'UTF8')),'hex');`);
 const refreshProjection=()=>{let sql='';owner(d=>{sql=heldAcceptanceProjectionSql(sqliteAcceptanceProjection(d,order.id));});pg(`DELETE FROM keryx_storage.acceptance_original_projection WHERE order_id=${q(order.id)};`+sql);};
 const stable=<T extends {submittedAt:string|null}>(value:T)=>({...value,submittedAt:null});
 try{
  assert.equal(input.ownerSql('SELECT count(*) FROM public.deliverable_acceptance_store;'),'0');
  const db=new DatabaseSync(file);try{
   db.exec('BEGIN IMMEDIATE');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);
   db.prepare(`INSERT INTO a2a_orders(id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,service_fee_usdc,research_mode,package_data,status,transaction_id,request_data,response_data,execution_journal_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(order.id,order.id,order.authorizationId,order.requestHash,order.payer,order.payee,order.amountUsdc,order.creatorBudgetUsdc,order.serviceFeeUsdc,order.researchMode,JSON.stringify(order.researchPackage),'completed',order.transaction,JSON.stringify(order.request),JSON.stringify({status:'completed',queryId:order.id,answer:'Synthetic original delivery 🌍',researchPackage:order.researchPackage}),1,order.createdAt,order.updatedAt);
   db.prepare("INSERT INTO payment_events(id,query_id,kind,source_id,source_name,payer,payee,amount_usdc,network,tx_hash,settled,settlement_status,authorization_id,created_at) VALUES(?,?,'inbound','a2a','Synthetic only',?,?,?,?,?,1,'settled',?,?)").run('inbound_'+order.id,order.id,order.payer,order.payee,order.amountUsdc,binding.network,order.transaction,order.authorizationId,order.createdAt);
   db.prepare('INSERT INTO web_sessions(hash,wallet,issued_at,expires_at) VALUES(?,?,?,?)').run(session,order.payer,now-1000,now+600000);
   db.prepare('INSERT INTO api_keys(id,prefix,key_hash,wallet,created_at,scopes) VALUES(?,?,?,?,?,?)').run(key,'syn731','ea'.repeat(32),order.payer,order.createdAt,'\u00a0deliverable:write\t');
   insertStorageIdentity(db,identity);installStorageFences(db,identity);db.exec('COMMIT');
   const p=sqliteAcceptanceProjection(db,order.id);assert(p.binding);storeId=p.storeId;let sql=`INSERT INTO public.deliverable_acceptance_store(singleton,id) VALUES(1,${q(storeId)});`;
   for(const table of ['a2a_orders','payment_events','research_purchase_authorizations','web_sessions','api_keys'])for(const row of db.prepare('SELECT * FROM '+table).all())sql+=copy(table,row);
   pg(sql+heldAcceptanceProjectionSql(p));
  }finally{db.close();}writeFileSync(manifestPath,manifest,{mode:0o600});
  const args=[order.payer,binding.network,order.id] as const,initial=await native.read(...args),before=originalCounts();assert.deepEqual(initial,await oracle(p=>p.read(...args)));assert.equal(initial.state,'no_response');vectors++;
  assert.deepEqual(await native.publicState(binding.network,order.id),await oracle(p=>p.publicState(binding.network,order.id)));assert.deepEqual(await native.metrics(binding.network),await oracle(p=>p.metrics(binding.network)));vectors++;
  const request:AcceptanceInput={originalFingerprint:initial.originalFingerprint,deliveredDigest:initial.deliveredDigest,expectedRevision:0,idempotencyKey:'synthetic-native-acceptance-731',choice:'accept',reason:'Private reason 🌍',publishState:true},authority={kind:'api-key' as const,id:key};
  const saved=await native.submit(...args,request,authority),reference=await oracle(p=>p.submit(...args,request,authority));assert.deepEqual(stable(saved),stable(reference));assert(Number.isFinite(Date.parse(saved.submittedAt!)));vectors++;
  assert.deepEqual(await native.submit(...args,request,authority),saved);assert.deepEqual(await oracle(p=>p.submit(...args,request,authority)),reference);vectors++;
  assert.deepEqual(await native.publicState(binding.network,order.id),{format:'keryx-public-deliverable-state-v1',state:'accepted',submittedAt:saved.submittedAt});assert.deepEqual(await native.metrics(binding.network),await oracle(p=>p.metrics(binding.network)));assert.equal(originalCounts(),before);vectors++;
  owner(d=>{d.prepare("UPDATE a2a_orders SET error_code='synthetic changed original' WHERE id=?").run(order.id);});pg(`UPDATE public.a2a_orders SET error_code='synthetic changed original' WHERE id=${q(order.id)};`);await assert.rejects(native.read(...args));refreshProjection();
  await assert.rejects(native.read(...args),/acceptance_conflict/);await assert.rejects(oracle(p=>p.read(...args)),/acceptance_conflict/);assert.equal((await native.publicState(binding.network,order.id)).state,'not_shared');vectors++;
  owner(d=>{d.prepare('UPDATE a2a_orders SET error_code=NULL WHERE id=?').run(order.id);});pg(`UPDATE public.a2a_orders SET error_code=NULL WHERE id=${q(order.id)};`);refreshProjection();assert.equal((await native.publicState(binding.network,order.id)).state,'accepted');assert.equal(originalCounts(),before);vectors++;
  await assert.rejects(native.submit(...args,{...request,choice:'reject'},authority),/acceptance_conflict/);await assert.rejects(oracle(p=>p.submit(...args,{...request,choice:'reject'},authority)),/acceptance_conflict/);vectors++;
  const revision={...request,expectedRevision:1,idempotencyKey:'synthetic-native-acceptance-732',choice:'revise' as const,publishState:false},sessionAuthority={kind:'session' as const,id:session};
  assert.deepEqual(stable(await native.submit(...args,revision,sessionAuthority)),stable(await oracle(p=>p.submit(...args,revision,sessionAuthority))));assert.equal((await native.publicState(binding.network,order.id)).state,'not_shared');vectors++;
  const third={...revision,expectedRevision:2,idempotencyKey:'synthetic-native-acceptance-733'};
  owner(d=>{d.prepare('UPDATE web_sessions SET wallet=? WHERE hash=?').run('0x'+'f3'.repeat(20),session);});pg(`UPDATE public.web_sessions SET wallet=${q('0x'+'f3'.repeat(20))} WHERE hash=${q(session)};`);await assert.rejects(native.submit(...args,third,sessionAuthority),/acceptance_unauthenticated/);await assert.rejects(oracle(p=>p.submit(...args,third,sessionAuthority)),/acceptance_unauthenticated/);vectors++;
  owner(d=>{d.prepare('UPDATE web_sessions SET wallet=?,expires_at=? WHERE hash=?').run(order.payer,Date.now()-1,session);});pg(`UPDATE public.web_sessions SET wallet=${q(order.payer)},expires_at=${Date.now()-1} WHERE hash=${q(session)};`);await assert.rejects(native.submit(...args,third,sessionAuthority),/acceptance_unauthenticated/);await assert.rejects(oracle(p=>p.submit(...args,third,sessionAuthority)),/acceptance_unauthenticated/);vectors++;
  owner(d=>{d.prepare('DELETE FROM web_sessions WHERE hash=?').run(session);});pg(`DELETE FROM public.web_sessions WHERE hash=${q(session)};`);
  await assert.rejects(native.submit(...args,third,sessionAuthority),/acceptance_unauthenticated/);await assert.rejects(oracle(p=>p.submit(...args,third,sessionAuthority)),/acceptance_unauthenticated/);vectors++;
  owner(d=>{d.prepare("UPDATE api_keys SET scopes='deliverable:read' WHERE id=?").run(key);});pg(`UPDATE public.api_keys SET scopes='deliverable:read' WHERE id=${q(key)};`);await assert.rejects(native.submit(...args,third,authority),/acceptance_unauthenticated/);vectors++;
  owner(d=>{d.prepare("UPDATE api_keys SET scopes='deliverable:write',revoked_at=? WHERE id=?").run(order.createdAt,key);});pg(`UPDATE public.api_keys SET scopes='deliverable:write',revoked_at=${q(order.createdAt)} WHERE id=${q(key)};`);await assert.rejects(native.submit(...args,third,authority),/acceptance_unauthenticated/);await assert.rejects(oracle(p=>p.submit(...args,third,authority)),/acceptance_unauthenticated/);vectors++;
  owner(d=>{d.prepare('UPDATE api_keys SET revoked_at=NULL WHERE id=?').run(key);});pg(`UPDATE public.api_keys SET revoked_at=NULL WHERE id=${q(key)};`);
  const competing=[{...third,idempotencyKey:'synthetic-native-compete-001',choice:'accept' as const},{...third,idempotencyKey:'synthetic-native-compete-002',choice:'reject' as const}];
  for(const results of [await Promise.allSettled(competing.map(value=>native.submit(...args,value,authority))),await Promise.allSettled(competing.map(value=>oracle(p=>p.submit(...args,value,authority))))]){assert.equal(results.filter(value=>value.status==='fulfilled').length,1);const failed=results.find(value=>value.status==='rejected');assert(failed&&String(failed.reason).includes('acceptance_conflict'));}vectors++;
  const fourth={...request,expectedRevision:3,idempotencyKey:'synthetic-native-acceptance-734',publishState:false};assert.deepEqual(stable(await native.submit(...args,fourth,authority)),stable(await oracle(p=>p.submit(...args,fourth,authority))));vectors++;
  assert(input.options.endpoint.kind==='loopback');lossProxy=await startCommitAckLossProxy(input.options.endpoint.port);lossChannel=createPostgresDomainChannel({...input.options,endpoint:{kind:'loopback',port:lossProxy.port}},input.identity,input.digest);const lossy=composePostgresAcceptance(lossChannel,false),fifth={...fourth,expectedRevision:4,idempotencyKey:'synthetic-native-acceptance-735'};lossProxy.arm(1);
  await assert.rejects(lossy.submit(...args,fifth,authority),error=>error instanceof PostgresDomainWriteOutcomeUnknown);assert.equal(lossProxy.observation().dropped,true);const recovered=await native.submit(...args,fifth,authority);assert.equal(recovered.revision,5);assert.deepEqual(stable(recovered),stable(await oracle(p=>p.submit(...args,fifth,authority))));assert.equal(input.ownerSql(`SELECT count(*) FROM public.deliverable_acceptance_entries WHERE original_id=${q(order.id)};`),'5');vectors++;
  await lossChannel.close();await lossProxy.close();lossChannel=undefined;lossProxy=undefined;
  let parsed=0;await assert.rejects(composePostgresAcceptance(channel,true).submit(...args,{get choice(){parsed++;return 'accept';}} as never,authority));assert.equal(parsed,0);vectors++;
  input.ownerSql("UPDATE keryx_storage.control SET mode='held';");try{await assert.rejects(native.read(...args));await assert.rejects(native.publicState(binding.network,order.id));vectors++;}finally{input.ownerSql("UPDATE keryx_storage.control SET mode='active';");}
  const reader=createPostgresDomainChannel({...input.options,role:'keryx_reader'},input.identity,input.digest);try{assert.deepEqual(stable(await composePostgresAcceptance(reader,true).read(...args)),stable(await oracle(p=>p.read(...args),true)));vectors++;}finally{await reader.close();}
  assert.equal(originalCounts(),before);await channel.close();await assert.rejects(native.read(...args));vectors++;
  return {vectors,actualPostgres:true,genuineSelectedSqliteOracle:true,originalFingerprintPreserved:true,deliveryFingerprintPreserved:true,changedOriginalRefused:true,unicodeTrimmedKeyScope:true,explicitConsentOnly:true,privateReasonNotPublic:true,exactReplay:true,staleExpiredAndForeignSessionRefused:true,revokedKeyRefused:true,concurrentCasExactlyOnce:true,actualLostCommitAckReconciled:true,automaticWriteRetry:false,originalAndPaymentDigestsUnchanged:true,noOriginalOrPaymentWrite:true,readonlyRole:true,terminalClose:true,refundOrRevisionExecuted:false,productionData:false,paidOperations:0,fullWriterQualified:false};
 }finally{
  try{await lossChannel?.close();await lossProxy?.close();await channel.close();pg(`DELETE FROM public.deliverable_acceptance_entries WHERE original_id=${q(order.id)};DELETE FROM public.payment_events WHERE query_id=${q(order.id)};DELETE FROM public.research_purchase_authorizations WHERE purchase_id=${q(order.id)};DELETE FROM public.a2a_orders WHERE id=${q(order.id)};DELETE FROM public.api_keys WHERE id=${q(key)};DELETE FROM public.web_sessions WHERE hash=${q(session)};`+(storeId?`DELETE FROM public.deliverable_acceptance_store WHERE id=${q(storeId)};`:''));}
  finally{assert.equal(realpathSync(folder).toLowerCase(),resolve(folder).toLowerCase());assert.equal(dirname(folder).toLowerCase(),resolve(tmpdir()).toLowerCase());for(const path of [file,file+'-wal',file+'-shm',file+'-journal',manifestPath])if(existsSync(path))unlinkSync(path);rmdirSync(folder);}
 }
}
