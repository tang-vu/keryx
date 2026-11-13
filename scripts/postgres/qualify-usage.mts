/** Actual native PostgreSQL versus a genuine selected SQLite usage reader.
 * Synthetic recorded facts only: no provider, signing, settlement or jobs. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,writeFileSync,unlinkSync,rmdirSync,existsSync,realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname,resolve } from 'node:path';
import { canonicalJson } from '../../lib/canonical-json';
import type { QueryRun } from '../../lib/types';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { insertStorageIdentity,installStorageFences,registerStorageCapability } from '../../lib/db/storage-identity-sqlite';
import { openVerifiedSqliteStorage } from '../../lib/db/storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../../lib/db/enrolled-sqlite-schema-profile';
import { inspectStorageDeploymentManifest } from '../../lib/db/runtime-storage-config';
import { createEnrolledSqlitePublicUsage } from '../../lib/db/public-usage-sqlite';
import { writeSqliteQueryRun } from '../../lib/db/query-run-record';
import { createPostgresDomainChannel } from '../../lib/db/postgres/domain-channel';
import { composePostgresUsage } from '../../lib/db/postgres/usage-transport';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import { validateStorageIdentity,type StorageIdentity } from '../../lib/db/storage-identity';
import { sqliteOriginalHistoryProjection,heldHistoryProjectionSql } from './run-history-projection.mts';
import { sqliteOwnershipHistoryProjection,heldOwnershipHistoryProjectionSql } from './ownership-history-projection.mts';
import { sqlitePrivacyProjection,heldPrivacyProjectionSql } from './privacy-projection.mts';
import { capturePostgresPublication } from '../../lib/db/postgres/publication-packet';
import type { UsageWindow } from '../../lib/usage/contracts';

export async function qualifyUsage(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;ownerSql:(sql:string)=>string}){
 const folder=mkdtempSync(join(tmpdir(),'keryx-native-usage-')),file=join(folder,'oracle.sqlite'),manifestPath=join(folder,'storage.json');
 const identity=validateStorageIdentity({...input.identity,deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),provenanceDigest:'d9'.repeat(32)});
 const manifest=canonicalJson({format:'keryx-storage-deployment-v1',identity,backend:{kind:'sqlite',databasePath:file}}),oldPrivacy=process.env.KERYX_RUN_PRIVACY_ENABLED;
 const channel=createPostgresDomainChannel(input.options,input.identity,input.digest),native=composePostgresUsage(channel,true),inactive=composePostgresUsage(channel,false);
 const stamp='2026-10-09T10:00:00.000Z',wallet='0x'+'e3'.repeat(20),q=(s:string)=>"'"+s.replaceAll("'","''")+"'",window:UsageWindow={network:'eip155:5042',since:'1970-01-01T00:00:00.000Z',until:'2026-10-10T00:00:00.000Z',period:'all'};let vectors=0;
 const pg=(s:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+s+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 const owner=(action:(db:DatabaseSync)=>void)=>{const db=new DatabaseSync(file);try{registerStorageCapability(db,identity,()=>true);db.exec('BEGIN IMMEDIATE');action(db);db.exec('COMMIT');}finally{db.close();}};
 const oracle=async<T,>(action:(port:ReturnType<typeof createEnrolledSqlitePublicUsage>)=>Promise<T>,active=true)=>{
  process.env.KERYX_RUN_PRIVACY_ENABLED=String(active);const connection=openVerifiedSqliteStorage(file,identity,{readOnly:true,applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>{assert.equal(canonicalJson(inspectStorageDeploymentManifest({KERYX_STORAGE_MANIFEST:manifestPath})),manifest);}});
  try{return await action(createEnrolledSqlitePublicUsage(connection.db));}finally{connection.close();process.env.KERYX_RUN_PRIVACY_ENABLED='true';}
 };
 const make=(suffix:string,cohort='unknown'):QueryRun=>({id:'synthetic-usage-'+suffix,createdAt:stamp,question:'Synthetic question '+suffix,answer:'Synthetic answer '+suffix,budget:0,engine:'heuristic',totalSpent:0,totalToCreators:0,subClaims:[],decisions:[],citations:[],trace:[],usage:{version:1,network:'eip155:5042',cohort,payment:cohort==='outside'?'independent':cohort==='team'?'team':'unknown',actorEvidenceSha256:cohort==='outside'?'12'.repeat(32):null,fundingEvidenceSha256:cohort==='outside'||cohort==='team'?'13'.repeat(32):null},uninterpreted:'\0\ud800'} as QueryRun);
 const sync=(db:DatabaseSync,id:string)=>{
  const row=db.prepare('SELECT data,created_at,asker FROM query_runs WHERE id=?').get(id)!;assert(typeof row.data==='string');const raw=JSON.parse(row.data) as QueryRun;
  const h=heldHistoryProjectionSql(id,sqliteOriginalHistoryProjection(db,id)),o=heldOwnershipHistoryProjectionSql(id,sqliteOwnershipHistoryProjection(db,id)),p=heldPrivacyProjectionSql(id,sqlitePrivacyProjection(db,id));
  const packet=JSON.parse(capturePostgresPublication(raw).wire) as {row:Record<string,unknown>};
  const values=[q(id),q(String(row.created_at)),q(String(packet.row.question)),String(packet.row.budget),q(row.data)+'::json',q(String(packet.row.engine)),String(packet.row.total_spent),String(packet.row.total_to_creators),q(String(packet.row.answer)),row.asker===null?'NULL':q(String(row.asker))];
  pg(`INSERT INTO public.query_runs(id,created_at,question,budget,data,engine,total_spent,total_to_creators,answer,asker) VALUES(${values.join(',')}) ON CONFLICT(id) DO UPDATE SET data=excluded.data,question=excluded.question,answer=excluded.answer,asker=excluded.asker;DELETE FROM keryx_storage.run_history_projection WHERE run_id=${q(id)};DELETE FROM keryx_storage.run_ownership_projection WHERE run_id=${q(id)};DELETE FROM keryx_storage.run_privacy_projection WHERE run_id=${q(id)};DELETE FROM keryx_storage.usage_projection WHERE run_id=${q(id)};`+h+o+p);
 };
 const save=(run:QueryRun,visibility='public')=>owner(db=>{if(db.prepare('SELECT 1 FROM query_runs WHERE id=?').get(run.id))db.prepare('UPDATE query_runs SET data=?,question=?,answer=? WHERE id=?').run(JSON.stringify(run),run.question,run.answer??'',run.id);else writeSqliteQueryRun(db,run,false);db.prepare('UPDATE run_privacy SET visibility=? WHERE run_id=?').run(visibility,run.id);sync(db,run.id);pg(`INSERT INTO public.run_privacy(run_id,visibility,updated_at) VALUES(${q(run.id)},${q(visibility)},${q(stamp)}) ON CONFLICT(run_id) DO UPDATE SET visibility=excluded.visibility;`);});
 const visibility=(id:string,value:string)=>owner(db=>{db.prepare('UPDATE run_privacy SET visibility=? WHERE run_id=?').run(value,id);pg(`UPDATE public.run_privacy SET visibility=${q(value)} WHERE run_id=${q(id)};`);});
 const raced=async<T,>(pending:Promise<T>,edit:()=>void)=>{let failure:unknown;queueMicrotask(()=>{try{edit();}catch(error){failure=error;}});const value=await pending;if(failure)throw failure;return value;};
 try{
  const db=new DatabaseSync(file);try{db.exec('BEGIN IMMEDIATE');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);insertStorageIdentity(db,identity);installStorageFences(db,identity);db.exec('COMMIT');}finally{db.close();}writeFileSync(manifestPath,manifest,{mode:0o600});process.env.KERYX_RUN_PRIVACY_ENABLED='true';
  assert.deepEqual(await native.publicUsage.summary(window),await oracle(port=>port.summary(window)));vectors++;
  assert.deepEqual(await native.publicUsage.publishedHistory!(window,'default',10),await oracle(port=>port.publishedHistory!(window,'default',10)));vectors++;
  for(const [suffix,cohort,state] of [['a','unknown','public'],['b','outside','public'],['c','outside','private'],['d','outside','unlisted'],['e','team','public'],['f','scripted','public']] as const)save(make(suffix,cohort),state);
  owner(db=>{for(const [index,suffix] of ['a','b','c','d'].entries()){const id='synthetic-usage-payment-'+suffix,runId='synthetic-usage-'+suffix,amount=(index+1)/1000000;db.prepare("INSERT INTO payment_events(id,query_id,created_at,network,kind,amount_usdc,settled,settlement_status,tx_hash,payee,source_id,source_name,payer) VALUES(?,?,?,'eip155:5042','fetch',?,1,'settled','synthetic-recorded',?,'synthetic-domain-source','Synthetic recorded',?)").run(id,runId,stamp,amount,wallet,wallet);pg(`INSERT INTO public.payment_events(id,query_id,created_at,network,kind,amount_usdc,settled,settlement_status,tx_hash,payee,source_id,source_name,payer) VALUES(${q(id)},${q(runId)},${q(stamp)},'eip155:5042','fetch',${amount},true,'settled','synthetic-recorded',${q(wallet)},'synthetic-domain-source','Synthetic recorded',${q(wallet)});`);}});
  assert.deepEqual(await native.publicUsage.summary(window),await oracle(port=>port.summary(window)));vectors++;
  for(const cohort of ['default','outside','team','scripted','unknown'] as const){assert.deepEqual(await native.publicUsage.history(window,cohort,10),await oracle(port=>port.history(window,cohort,10)));assert.deepEqual(await native.publicUsage.publishedHistory!(window,cohort,1),await oracle(port=>port.publishedHistory!(window,cohort,1)));vectors++;}
  assert.deepEqual(await inactive.publicUsage.history(window,'outside',10),await oracle(port=>port.history(window,'outside',10),false));vectors++;
  // Genuine SQLite's existing finalizer runs after its last await. The queued
  // owner edit reaches that boundary without replacing its native privacy port.
  const selected='synthetic-usage-b',plan=await native.prepareUsageHistory(window,'outside',1,false);
  const reference=oracle(port=>raced(port.history(window,'outside',1),()=>visibility(selected,'private')));
  const expected=await reference;assert.deepEqual(expected,[]);assert.deepEqual(await native.finishUsageHistory(plan),expected);vectors++;visibility(selected,'public');
  const older=make('aa','outside');save(older);
  const publishedPlan=await native.prepareUsageHistory(window,'outside',1,true);
  const publishedReference=await oracle(port=>raced(port.publishedHistory!(window,'outside',1),()=>visibility(selected,'private')));
  assert.equal(publishedReference.windowRuns,1);assert.equal(publishedReference.runs[0]?.id,older.id);assert.deepEqual(await native.finishPublishedUsageHistory(publishedPlan),publishedReference);vectors++;visibility(selected,'public');
  const updatedPlan=await native.prepareUsageHistory(window,'outside',1,false);
  const updatedReference=await oracle(port=>raced(port.history(window,'outside',1),()=>save({...make('b','outside'),answer:'Current replacement answer'})));assert.equal(updatedReference[0]?.answer,'Current replacement answer');assert.deepEqual(await native.finishUsageHistory(updatedPlan),updatedReference);vectors++;
  const wrong=await native.prepareUsageHistory(window,'outside',1,false);save(make('b','team'));await assert.rejects(native.finishUsageHistory(wrong));vectors++;
  // SQLite classifies the first root usage key, but its JSON body parser sees
  // the last. Active privacy refuses that mismatch; legacy inactive history
  // checks identity/time only and must preserve that exact original body.
  owner(db=>{const raw=String(db.prepare('SELECT data FROM query_runs WHERE id=?').get(older.id)!.data);const duplicate=raw.slice(0,-1)+',"usage":'+JSON.stringify({...older.usage,network:'eip155:5042002'})+'}';db.prepare('UPDATE query_runs SET data=? WHERE id=?').run(duplicate,older.id);sync(db,older.id);});
  await assert.rejects(native.publicUsage.history(window,'outside',10));await assert.rejects(oracle(port=>port.history(window,'outside',10)));vectors++;
  assert.deepEqual(await inactive.publicUsage.history(window,'outside',10),await oracle(port=>port.history(window,'outside',10),false));assert.equal((await inactive.publicUsage.history(window,'outside',10)).find(run=>run.id===older.id)?.usage?.network,'eip155:5042002');vectors++;save(older);
  // Bounds apply to the COMPLETE financial population, before derivative/body
  // work. Missing private derivatives cannot turn an oversized window partial.
  owner(db=>{const insert=db.prepare('INSERT INTO query_runs(id,created_at,question,budget,data,engine,total_spent,total_to_creators,answer) VALUES(?,?,\'Bound\',0,\'{}\',\'heuristic\',0,0,\'\')');for(let n=0;n<10001;n++)insert.run('synthetic-usage-bound-'+n,stamp);});
  pg(`INSERT INTO public.query_runs(id,created_at,question,budget,data,engine,total_spent,total_to_creators,answer) SELECT 'synthetic-usage-bound-'||n,${q(stamp)}::timestamptz,'Bound',0,'{}'::json,'heuristic',0,0,'' FROM generate_series(0,10000)n;`);
  await assert.rejects(native.publicUsage.summary(window));await assert.rejects(oracle(port=>port.summary(window)));vectors++;
  owner(db=>{db.exec("DELETE FROM query_runs WHERE id LIKE 'synthetic-usage-bound-%'");});pg("DELETE FROM public.query_runs WHERE id LIKE 'synthetic-usage-bound-%';");
  owner(db=>{const insert=db.prepare("INSERT INTO payment_events(id,query_id,created_at,network,kind,amount_usdc,settled,settlement_status,source_id,source_name,payer,payee) VALUES(?,?,?,'eip155:5042','fetch',0,0,'pending','synthetic-domain-source','Bound',?,?)");for(let n=0;n<50001;n++)insert.run('synthetic-usage-payment-bound-'+n,older.id,stamp,wallet,wallet);});
  pg(`INSERT INTO public.payment_events(id,query_id,created_at,network,kind,amount_usdc,settled,settlement_status,source_id,source_name,payer,payee) SELECT 'synthetic-usage-payment-bound-'||n,${q(older.id)},${q(stamp)}::timestamptz,'eip155:5042','fetch',0,false,'pending','synthetic-domain-source','Bound',${q(wallet)},${q(wallet)} FROM generate_series(0,50000)n;`);
  await assert.rejects(native.publicUsage.summary(window));await assert.rejects(oracle(port=>port.summary(window)));vectors++;
  owner(db=>{db.exec("DELETE FROM payment_events WHERE id LIKE 'synthetic-usage-payment-bound-%'");});pg("DELETE FROM public.payment_events WHERE id LIKE 'synthetic-usage-payment-bound-%';");
  await assert.rejects(native.finishUsageHistory({kind:'native-usage-selection'}));await assert.rejects(inactive.publicUsage.publishedHistory!(window,'outside',1));vectors++;
  input.ownerSql("UPDATE keryx_storage.control SET mode='held';");try{await assert.rejects(native.publicUsage.summary(window));vectors++;}finally{input.ownerSql("UPDATE keryx_storage.control SET mode='active';");}
  const readerChannel=createPostgresDomainChannel({...input.options,role:'keryx_reader'},input.identity,input.digest);try{assert.deepEqual(await composePostgresUsage(readerChannel,true).publicUsage.summary(window),await oracle(port=>port.summary(window)));vectors++;}finally{await readerChannel.close();}
  await channel.close();await assert.rejects(native.publicUsage.summary(window));await assert.rejects(native.finishUsageHistory(plan));vectors++;
  return {vectors,actualPostgres:true,genuineSelectedSqliteOracle:true,allVisibilityFinancialPopulation:true,completeWindowClassification:true,separatePublishedPopulation:true,actualFinalWithdrawalRevalidation:true,capturedPopulationSampleAfterWithdrawal:true,currentBodyRereadAfterAwait:true,changedUsageRefused:true,legacyDuplicateRootUsageParity:true,oversizedCompleteRunAndPaymentWindowsRefused:true,unknownSelectionsRefused:true,readonlyRole:true,terminalClose:true,productionData:false,paidOperations:0,fullWriterQualified:false};
 }finally{
  try{await channel.close();pg("DELETE FROM public.payment_events WHERE id LIKE 'synthetic-usage-payment-%';DELETE FROM public.query_runs WHERE id LIKE 'synthetic-usage-%';");}
  finally{if(oldPrivacy===undefined)delete process.env.KERYX_RUN_PRIVACY_ENABLED;else process.env.KERYX_RUN_PRIVACY_ENABLED=oldPrivacy;assert.equal(realpathSync(folder).toLowerCase(),resolve(folder).toLowerCase());assert.equal(dirname(folder).toLowerCase(),resolve(tmpdir()).toLowerCase());for(const path of [file,file+'-wal',file+'-shm',file+'-journal',manifestPath])if(existsSync(path))unlinkSync(path);rmdirSync(folder);}
 }
}
