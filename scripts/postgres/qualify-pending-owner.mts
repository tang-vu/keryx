/** Actual fixed native observer against genuine verified SQLite session/core
 * and Source metadata joins. Native packets/association imports are synthetic;
 * no installed native proof, owned producer, payment or execution is qualified. */
import assert from 'node:assert/strict';
import { mkdtempSync,existsSync,unlinkSync,rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { canonicalJson } from '../../lib/canonical-json';
import { validateStorageIdentity,type StorageIdentity } from '../../lib/db/storage-identity';
import { createPostgresDomainChannel } from '../../lib/db/postgres/domain-channel';
import { composePostgresPendingJobOwners } from '../../lib/db/postgres/pending-owner-transport';
import { composePostgresA2aOriginals } from '../../lib/db/postgres/a2a-originals-transport';
import { retainedRecoveryMatches } from '../../lib/a2a/overdue-escalation-queue';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import type { PostgresPendingOwnerSessionPacket } from '../../lib/a2a/pending-owner-association';
import { nativePendingOwnerFixture,nativePendingOwnerFixturePaths } from './native-pending-owner-fixture.mts';

export async function qualifyPendingOwner(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;contentionClient:Client;ownerSql:(sql:string)=>string}){
 input={...input,identity:validateStorageIdentity(input.identity)};
 const folder=mkdtempSync(join(tmpdir(),'keryx-native-pending-owner-')),paths=nativePendingOwnerFixturePaths(folder),q=(s:string)=>"'"+s.replaceAll("'","''")+"'";
 const pg=(sql:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+sql+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 const channel=createPostgresDomainChannel(input.options,input.identity,input.digest);
 let source:Awaited<ReturnType<typeof nativePendingOwnerFixture>>|undefined,reader:ReturnType<typeof createPostgresDomainChannel>|undefined,wrong:ReturnType<typeof createPostgresDomainChannel>|undefined,admin:Client|undefined,vectors=0,imported=false;
 let originalWorker:{value:string;updated_at:string}|null=null;
 const normalize=(rows:Record<string,unknown>[])=>rows.map(row=>({...row,package_data:typeof row.package_data==='string'?JSON.parse(row.package_data):row.package_data}));
 const admission=(packet:PostgresPendingOwnerSessionPacket)=>channel.call('pendingOwnerAdmission',[JSON.stringify(packet)]);
 const list=async(packet:PostgresPendingOwnerSessionPacket,before?:{createdAt:string;id:string},id?:string)=>{
  const raw=await channel.call('pendingOwnerList',[JSON.stringify(packet),before?JSON.stringify(before):null,id??null]);
  assert(raw&&typeof raw==='object'&&!Array.isArray(raw));const value=raw as {rows:Record<string,unknown>[];recovery:string|null;observedAtMs:number};
  assert.deepEqual(Object.keys(value).sort(),['observedAtMs','recovery','rows']);assert(Array.isArray(value.rows)&&value.rows.length<=26);assert(Number.isSafeInteger(value.observedAtMs));
  assert(source);assert.deepEqual(normalize(value.rows),normalize(source.rows(before,id)));
  assert(!JSON.stringify(value).includes('Synthetic original'));assert(value.rows.every(row=>!Object.hasOwn(row,'payer')&&!Object.hasOwn(row,'request_data')&&!Object.hasOwn(row,'response_data')));vectors++;return value;
 };
 // pg_stat_activity freezes its session list inside this held transaction.
 // Refresh it so a reconnect after a deliberate SQL refusal is observable.
 // https://www.postgresql.org/docs/17/monitoring-stats.html
 const blocked=async(outcome:{settled:boolean},proofExpiresAt?:number)=>{const deadline=Date.now()+4000;while(Date.now()<deadline){await input.contentionClient.query('SELECT pg_stat_clear_snapshot()');const r=await input.contentionClient.query('SELECT count(*) n FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND pg_backend_pid()=ANY(pg_blocking_pids(pid))');if(Number(r.rows[0].n)>0){assert(!outcome.settled);if(proofExpiresAt!==undefined)assert(Date.now()<proofExpiresAt,'Pending proof expired before actual data lock');return;}assert(!outcome.settled,'Pending observer terminated before actual data lock');await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Pending owner observer did not reach native data lock');};
 try{
  const oldWorker=input.ownerSql("SELECT row_to_json(r)::text FROM(SELECT value,updated_at FROM public.sync_state WHERE key='a2aWorker')r;");originalWorker=oldWorker?JSON.parse(oldWorker) as typeof originalWorker:null;
  assert.equal(input.ownerSql('SELECT count(*) FROM public.pending_job_owners;'),'0');
  source=await nativePendingOwnerFixture(folder,input.identity);
  // Fixture owner imports a synthetic retained prefix. This never exercises or
  // substitutes the closed native owned-original producer/proof path.
  assert.equal(input.ownerSql('SELECT count(*) FROM public.deliverable_acceptance_store;'),'0');pg(source.sql);imported=true;
  source.current(source.packet(true));assert.equal(await admission(source.packet(true)),true);vectors++;
  const first=await list(source.packet());assert.equal(first.rows.length,26);
  const edge=first.rows[24],cursor={createdAt:String(edge.created_at),id:String(edge.id)};
  const next=await list(source.packet(),cursor);assert.equal(next.rows.length,3);assert.equal(new Set([...first.rows.slice(0,25),...next.rows].map(row=>row.id)).size,28);
  for(const i of [0,28,29,30]){const selected=await list(source.packet(),undefined,source.orders[i].id);assert.equal(selected.rows.length,i===0?1:0);if(i===0)assert.equal(selected.recovery,source.recovery);}
  for(const i of [26,27]){const selected=await list(source.packet(),undefined,source.orders[i].id);assert.equal(selected.rows.length,1);assert.equal(selected.rows[0].created_at,source.orders[i].createdAt);vectors++;}
  // Retained Source clocks must survive a disposable body-projection deletion.
  // PostgreSQL timestamptz stores the instant, not the original offset/precision.
  const clockId=source.orders[0].id,started=new Date(Date.parse(source.orders[0].createdAt)+100).toISOString().replace(/\.[0-9]{3}/,value=>value+'4').replace('Z','+00:00');
  const updated=new Date(Date.parse(source.orders[0].createdAt)+200+7*3600000).toISOString().replace('Z','+07:00');
  const payment=new Date(Date.parse(source.orders[0].createdAt)+150).toISOString().replace(/\.[0-9]{3}/,value=>value+'56');
  source.owner(db=>db.prepare('UPDATE a2a_orders SET started_at=?,updated_at=?,payment_started_at=?,result_saving_at=? WHERE id=?').run(started,updated,payment,updated,clockId));
  pg(`UPDATE public.a2a_orders SET started_at=${q(started)},updated_at=${q(updated)},payment_started_at=${q(payment)},result_saving_at=${q(updated)} WHERE id=${q(clockId)};UPDATE keryx_storage.a2a_original_time_projection SET started_at=${q(started)},updated_at=${q(updated)},payment_started_at=${q(payment)},result_saving_at=${q(updated)} WHERE order_id=${q(clockId)};`);
  assert.equal(input.ownerSql(`SELECT count(*) FROM keryx_storage.acceptance_original_projection WHERE order_id=${q(clockId)};`),'0');
  const clocks=await list(source.packet(),undefined,clockId);assert.equal(clocks.rows[0].started_at,started);assert.equal(clocks.rows[0].updated_at,updated);assert.equal(clocks.rows[0].payment_started_at,payment);assert.equal(clocks.rows[0].result_saving_at,updated);
  const nativeOriginal=await composePostgresA2aOriginals(channel,false).getA2aOrder(clockId),sourceOriginal=await source.core.getA2aOrder(clockId);assert.deepEqual(nativeOriginal,sourceOriginal);assert(nativeOriginal);
  assert.equal(retainedRecoveryMatches(nativeOriginal,JSON.parse(source.recovery),{network:input.identity.network,payee:nativeOriginal.payee},Date.now()),false);vectors++;
  // The held owner cannot change immutable creation text even to an equivalent
  // instant; a current-native inconsistency cannot become an owner observation.
  assert.throws(()=>pg(`UPDATE keryx_storage.a2a_original_time_projection SET created_at=replace(created_at,'Z','+00:00') WHERE order_id=${q(clockId)};`));vectors++;
  assert.throws(()=>pg(`UPDATE keryx_storage.a2a_original_time_projection SET started_at='2026-01-01T00:00:00.000Z' WHERE order_id=${q(clockId)};`));vectors++;
  pg(`UPDATE public.a2a_orders SET started_at='2026-01-01T00:00:00.000Z' WHERE id=${q(clockId)};`);
  await assert.rejects(list(source.packet(),undefined,clockId));await assert.rejects(composePostgresA2aOriginals(channel,false).getA2aOrder(clockId));vectors++;
  pg(`UPDATE public.a2a_orders SET started_at=${q(started)} WHERE id=${q(clockId)};`);await list(source.packet(),undefined,clockId);
  await assert.rejects(input.contentionClient.query('SELECT * FROM keryx_storage.a2a_original_time_projection'));vectors++;
  for(const field of ['hash','wallet','issuedAt','expiresAt'] as const){const packet=source.packet(true);const session={...packet.session,[field]:field==='hash'?'ff'.repeat(32):field==='wallet'?'0x'+'ff'.repeat(20):packet.session[field]+1};const changed={...packet,session};assert.throws(()=>source!.current(changed));await assert.rejects(admission(changed));vectors++;}
  for(const field of Object.keys(input.identity) as (keyof StorageIdentity)[]){const packet=source.packet(true);const changed={...packet,identity:{...packet.identity,[field]:'changed'}} as unknown as PostgresPendingOwnerSessionPacket;await assert.rejects(admission(changed));vectors++;}
  for(const packet of [{...source.packet(true),proofExpiresAt:Date.now()-1},{...source.packet(true),proofExpiresAt:Date.now()+600001},{...source.packet(true),binding:null}]){await assert.rejects(admission(packet));vectors++;}
  await assert.rejects(channel.call('pendingOwnerList',[JSON.stringify(source.packet()),'{"id":"injected","createdAt":"now"}',null]));vectors++;
  input.ownerSql("UPDATE keryx_storage.control SET mode='held';");try{await assert.rejects(admission(source.packet(true)));vectors++;}finally{input.ownerSql("UPDATE keryx_storage.control SET mode='active';");}
  wrong=createPostgresDomainChannel(input.options,{...input.identity,storageId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'},input.digest);await assert.rejects(wrong.call('pendingOwnerAdmission',[JSON.stringify(source.packet(true))]));vectors++;
  reader=createPostgresDomainChannel({...input.options,role:'keryx_reader'},input.identity,input.digest);
  const readValue=await reader.call('pendingOwnerList',[JSON.stringify(source.packet()),null,source.orders[0].id]);assert(readValue&&typeof readValue==='object');vectors++;
  // The metadata observation is readable; an installed read-only port still
  // rejects admission before touching any supplied proof/getter or native SQL.
  let touched=0;const fake=new Proxy({}, {get(){touched++;throw Error('untrusted proof touched');}});
  const readPort=composePostgresPendingJobOwners(reader,input.identity,true);assert.throws(()=>readPort.assertAdmission(fake as never));await assert.rejects(readPort.assertAdmissionAsync!(fake as never));assert.equal(touched,0);vectors++;
  const calibrationStarted=performance.now();assert.equal(await admission(source.packet(true)),true);const calibrationMs=Math.max(1,Math.ceil(performance.now()-calibrationStarted));assert(calibrationMs<=4000);const proofTtlMs=calibrationMs+400;
  // Native SQL takes its clock after actually obtaining the data lock.
  await input.contentionClient.query('BEGIN');try{
   await input.contentionClient.query('SELECT pg_advisory_xact_lock_shared(634781904177021::bigint),pg_advisory_xact_lock(634781904177022::bigint)');
   const packet={...source.packet(true),proofExpiresAt:Date.now()+proofTtlMs},outcome={settled:false},pending=admission(packet).then(value=>{outcome.settled=true;return {value};},error=>{outcome.settled=true;return {error};});await blocked(outcome,packet.proofExpiresAt);
   await new Promise(resolve=>setTimeout(resolve,Math.max(0,packet.proofExpiresAt-Date.now()+10)));assert(Date.now()>=packet.proofExpiresAt);assert(!outcome.settled,'Pending observer timed out before release');await input.contentionClient.query('COMMIT');assert('error' in await pending);assert.throws(()=>source!.current(packet));vectors++;
  }finally{await input.contentionClient.query('ROLLBACK');}
  // Source-owner auth fault injection while the independent app data lock is
  // held: no application-side extra writer, factory bypass or payment action.
  assert(input.options.endpoint.kind==='loopback');admin=new Client({host:'127.0.0.1',port:input.options.endpoint.port,user:'postgres',database:input.options.database,password:input.options.password,ssl:false,connectionTimeoutMillis:1000,query_timeout:5000,options:'-c statement_timeout=5000 -c lock_timeout=1000'});await admin.connect();
  await input.contentionClient.query('BEGIN');try{
   await input.contentionClient.query('SELECT pg_advisory_xact_lock_shared(634781904177021::bigint),pg_advisory_xact_lock(634781904177022::bigint)');
   const outcome={settled:false},pending=admission(source.packet(true)).then(value=>{outcome.settled=true;return {value};},error=>{outcome.settled=true;return {error};});await blocked(outcome);
   await admin.query(`BEGIN;INSERT INTO keryx_storage.writer(transaction_id,identity_digest,operation) SELECT txid_current(),identity_digest,'revoke_web_session' FROM keryx_storage.identity;DELETE FROM public.web_sessions WHERE hash=${q(source.session.hash)};DELETE FROM keryx_storage.writer WHERE transaction_id=txid_current();COMMIT;`);
   source.owner(writer=>writer.prepare('DELETE FROM web_sessions WHERE hash=?').run(source!.session.hash));await input.contentionClient.query('COMMIT');assert('error' in await pending);assert.throws(()=>source!.current(source!.packet(true)));vectors++;
  }finally{await input.contentionClient.query('ROLLBACK');}
  await assert.rejects(reader.call('pendingOwnerList',[JSON.stringify(source.packet()),null,null]));vectors++;
  await channel.close();await assert.rejects(admission(source.packet(true)));vectors++;
  assert.equal(input.ownerSql('SELECT count(*) FROM keryx_storage.writer;'),'0');
  return {vectors,expiryLockTiming:{calibrationMs,proofTtlMs},actualPostgres:true,actualVerifiedSqliteCore:true,actualSourceSessionHelper:true,sourceMetadataJoinAndPagingCompared:true,exactOffsetOriginalDateText:true,allFiveSourceTimeWiresRetained:true,subMillisecondRecoveryRemainsFalse:true,bodyProjectionDeletionDoesNotEraseTimes:true,immutableCreationAndCurrentNativeTimesFenced:true,privateTimeMetadataDeniedToApp:true,escapedNulAndSurrogateResponseRetained:true,exactOriginalJoinExclusions:true,currentSessionAfterNativeLock:true,proofExpiryAfterNativeLock:true,readerObservationOnly:true,allNineIdentityFieldsCompared:true,rawNativePacketsSynthetic:true,ownerAssociationsImportedSynthetic:true,installedNativeProofQualified:false,atomicOwnedProducerQualified:false,fullWriterQualified:false,productionData:false,paymentActions:0,jobExecutions:0};
 }finally{
  try{
  await Promise.allSettled([admin?.end(),wrong?.close(),reader?.close(),channel.close()]);source?.selected.close();
  if(imported&&source){const ids=source.orders.map(o=>q(o.id)).join(',');
   // The disposable fixture owner alone removes its imported retained prefix,
   // restoring the exact retention trigger before subsequent domain checks.
   pg(`ALTER TABLE public.pending_job_owners DISABLE TRIGGER native_pending_owner_retained;DELETE FROM public.pending_job_owners WHERE job_id IN(${ids});ALTER TABLE public.pending_job_owners ENABLE TRIGGER native_pending_owner_retained;DELETE FROM public.a2a_orders WHERE id IN(${ids});DELETE FROM public.web_sessions WHERE hash=${q(source.session.hash)};DELETE FROM public.deliverable_acceptance_store WHERE id=${q(source.storeId)};`+(originalWorker===null?"DELETE FROM public.sync_state WHERE key='a2aWorker';":`INSERT INTO public.sync_state(key,value,updated_at) VALUES('a2aWorker',${q(originalWorker.value)},${q(originalWorker.updated_at)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;`));
  }
  }finally{for(const path of paths)if(existsSync(path))unlinkSync(path);rmdirSync(folder);}
 }
}
