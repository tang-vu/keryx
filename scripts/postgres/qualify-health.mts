/** Current SQLite health oracle versus fixed native reads. Synthetic recorded
 * rows only; no job execution, settlement, provider IO or production data. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import type { Client } from 'pg';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { readSqlitePublicHealthSnapshot } from '../../lib/db/health-read-rows';
import { publicHealthSyncKeys } from '../../lib/db/public-health-snapshot';
import { createPostgresDomainChannel } from '../../lib/db/postgres/domain-channel';
import { composePostgresHealth } from '../../lib/db/postgres/health-transport';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import type { StorageIdentity } from '../../lib/db/storage-identity';

export async function qualifyHealth(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;contentionClient:Client;ownerSql:(sql:string)=>string}){
 const db=new DatabaseSync(':memory:'),channel=createPostgresDomainChannel(input.options,input.identity,input.digest),native=composePostgresHealth(channel);
 const now=Date.parse('2026-10-09T12:00:00.000Z'),stamp=(ms:number)=>new Date(ms).toISOString(),q=(s:string)=>"'"+s.replaceAll("'","''")+"'",wallet='0x'+'d8'.repeat(20);let vectors=0;
 const pg=(s:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+s+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 const compare=async()=>{for(const registry of [false,true])assert.deepEqual(await native.readPublicHealthSnapshot(now,registry),await readSqlitePublicHealthSnapshot(db,now,registry));assert.deepEqual(await native.currentA2aOperationsSnapshot(now),(await readSqlitePublicHealthSnapshot(db,now,false)).jobs);vectors++;};
 const job=(id:string,status:string,created:number,updated:number,started:number|null,markers:{version?:number;pkg?:unknown;receipt?:unknown;resolution?:unknown}={})=>{
  const columns='id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,service_fee_usdc,research_mode,status,transaction_id,created_at,updated_at,started_at,execution_journal_version,package_data,response_data,resolution_data,request_data';
  const json=(v:unknown)=>v===undefined?'NULL':q(JSON.stringify(v));
  const values=[q(id),q(id+'-query'),q(id+'-authorization'),q('ab'.repeat(32)),q(wallet),q(wallet),'0.01','0.005','0.005',q('quick'),q(status),q('synthetic-health-transaction'),q(stamp(created)),q(stamp(updated)),started===null?'NULL':q(stamp(started)),String(markers.version??'NULL'),json(markers.pkg),json(markers.receipt===undefined?undefined:{serviceReceipt:markers.receipt}),json(markers.resolution),json({network:'eip155:5042'})].join(',');
  db.exec(`INSERT INTO a2a_orders(${columns}) VALUES(${values});`);pg(`INSERT INTO public.a2a_orders(${columns}) VALUES(${values});`);
 };
 try{
  db.exec('BEGIN');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);db.exec('COMMIT');await compare();
  for(const key of [...publicHealthSyncKeys(true),'synthetic-health-🌍','\ufeffsynthetic-health']){const value='\ufeffSynthetic health 🌍 '+key;db.prepare('INSERT INTO sync_state(key,value) VALUES(?,?)').run(key,value);pg(`INSERT INTO public.sync_state(key,value) VALUES(${q(key)},${q(value)});`);}
  const keys=['synthetic-health-🌍','missing','synthetic-health-🌍','nul\0','\ufeffsynthetic-health'];assert.deepEqual([...(await native.getSyncStates(keys))],Array.from(new Set(keys),key=>[key,(db.prepare('SELECT value FROM sync_state WHERE key=?').get(key)?.value as string|undefined)??null]));vectors++;
  assert.deepEqual([...(await native.getSyncStates([]))],[]);vectors++;await compare();
  const metric="INSERT INTO query_runs(id,created_at,question,budget,data,origin) VALUES('synthetic-health-run','2026-10-09T10:00:00.000Z','Synthetic',0,'{}','web');";db.exec(metric);pg(metric);await compare();
  job('synthetic-health-queued','running',now-600000,now-600000,null);await compare();
  job('synthetic-health-processing','running',now-10000,now-1000,now-5000);await compare();
  job('synthetic-health-review','running',now-7200000,now-3600000,now-7200000);await compare();
  const created=now-60000,started=now-50000,finished=now-10000,updated=now-5000,pkg={schema:'urn:keryx:a2a-research-package:1',version:'1.0.0',id:'keryx-quick'},receipt={packageId:pkg.id,packageVersion:pkg.version,outcome:'completed',objectiveKind:'provisional_slo',remedy:'none',acceptedAt:stamp(created),startedAt:stamp(started),finishedAt:stamp(finished)};
  job('synthetic-health-ordinary','completed',created,updated,started,{version:1,pkg,receipt});await compare();
  job('synthetic-health-recovered','completed',created,updated,started,{resolution:{actor:'automatic-poll',resolvedAt:stamp(updated),evidence:{queryRunFound:true},action:'repair_completed',reason:'saved_real_query_run'}});await compare();
  job('synthetic-health-unknown','completed',created,updated,started,{version:1,pkg,receipt:{...receipt,acceptedAt:stamp(created+1)}});await compare();
  job('synthetic-health-failed','failed',created,updated,started);job('synthetic-health-old','completed',now-172800000,now-86400001,null);job('synthetic-health-boundary','completed',now-172800000,now-86400000,null);job('synthetic-health-future','completed',now+1000,now+2000,null);await compare();
  const observed=(await native.readPublicHealthSnapshot(now,true)).jobs;assert.equal(observed.completionLatencyCohorts?.ordinary.completed,1);assert.equal(observed.completionLatencyCohorts?.recovered.completed,1);assert.equal(observed.completionLatencyCohorts?.unknown.completed,2);assert.equal(observed.reviewRequired,1);assert.equal(observed.degraded,true);vectors++;
  for(const clock of [0,8640000000000000,-8640000000000000+86400000]){assert.deepEqual(await native.currentA2aOperationsSnapshot(clock),(await readSqlitePublicHealthSnapshot(db,clock,false)).jobs);}vectors++;
  for(const bad of [NaN,Infinity,1.5,-8640000000000000])await assert.rejects(native.currentA2aOperationsSnapshot(bad));await assert.rejects(native.readPublicHealthSnapshot(now,1 as never));vectors++;
  const readerChannel=createPostgresDomainChannel({...input.options,role:'keryx_reader'},input.identity,input.digest);try{assert.deepEqual(await composePostgresHealth(readerChannel).readPublicHealthSnapshot(now,true),await readSqlitePublicHealthSnapshot(db,now,true));vectors++;}finally{await readerChannel.close();}
  // A real writer's exclusive data lock prevents a partial multi-input view.
  await input.contentionClient.query('BEGIN');
  try{
   await input.contentionClient.query('SELECT pg_advisory_xact_lock_shared(634781904177021::bigint),pg_advisory_xact_lock(634781904177022::bigint)');
   let settled=false;const startedAt=performance.now(),request=native.readPublicHealthSnapshot(now,true),outcome=request.then(value=>{settled=true;return {value};},error=>{settled=true;return {error};});await delay(200);assert.equal(settled,false);assert(performance.now()-startedAt>=180);await input.contentionClient.query('COMMIT');const result=await outcome;if('error' in result)throw result.error;assert.deepEqual(result.value,await readSqlitePublicHealthSnapshot(db,now,true));vectors++;
  }finally{await input.contentionClient.query('ROLLBACK');}
  // Bounds refuse the whole observation rather than publishing truncated health.
  pg("UPDATE public.a2a_orders SET package_data=jsonb_build_object('oversize',repeat('x',65536)) WHERE id='synthetic-health-ordinary';");await assert.rejects(native.readPublicHealthSnapshot(now,true));await assert.rejects(native.currentA2aOperationsSnapshot(now));vectors++;
  pg("UPDATE public.a2a_orders SET package_data=NULL WHERE id='synthetic-health-ordinary';INSERT INTO public.sync_state(key,value) VALUES('synthetic-health-large',repeat('x',4194305));");await assert.rejects(native.getSyncStates(['synthetic-health-large']));vectors++;
  pg("DELETE FROM public.sync_state WHERE key='synthetic-health-large';INSERT INTO public.a2a_orders(id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,service_fee_usdc,research_mode,status,transaction_id,created_at,updated_at) SELECT 'synthetic-health-bulk-'||g,'synthetic-health-bulk-'||g,'synthetic','synthetic',"+q(wallet)+','+q(wallet)+",.01,.005,.005,'quick','running','synthetic','2026-10-09T10:00:00.000Z','2026-10-09T10:00:00.000Z' FROM generate_series(1,1001)g;");await assert.rejects(native.currentA2aOperationsSnapshot(now));vectors++;
  pg("DELETE FROM public.a2a_orders WHERE id LIKE 'synthetic-health-bulk-%';");
  input.ownerSql("UPDATE keryx_storage.control SET mode='held';");try{await assert.rejects(native.getSyncStates([]));await assert.rejects(native.readPublicHealthSnapshot(now,true));vectors++;}finally{input.ownerSql("UPDATE keryx_storage.control SET mode='active';");}
  await channel.close();await assert.rejects(native.getSyncStates([]));await assert.rejects(native.currentA2aOperationsSnapshot(now));vectors++;
  return {vectors,actualPostgres:true,currentSqliteSnapshotParity:true,registrySelection:true,completeCompletionMarkers:true,ordinaryRecoveredUnknownCohorts:true,singleProtectedObservation:true,actualWriterContention:true,eventLoopResponsiveWhileWaiting:true,completeReadBoundsRefuse:true,readonlyRole:true,freshHeldAuthorityRefused:true,terminalDisposal:true,productionData:false,paidOperations:0,fullWriterQualified:false};
 }finally{try{pg("DELETE FROM public.a2a_orders WHERE id LIKE 'synthetic-health-%';DELETE FROM public.query_runs WHERE id='synthetic-health-run';DELETE FROM public.sync_state WHERE key IN ('lastSyncedBlock','registryParity','dispatchHealth','settlementParity','pendingPaymentReconciliation','a2aWorker','synthetic-health-🌍','synthetic-health-large',"+q('\ufeffsynthetic-health')+");");}finally{await channel.close();db.close();}}
}
