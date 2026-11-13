/** Actual PostgreSQL vs the selected Full19 SQLite publication capability. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,writeFileSync,readFileSync,existsSync,unlinkSync,rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { canonicalJson } from '../../lib/canonical-json';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { insertStorageIdentity,installStorageFences,registerStorageCapability } from '../../lib/db/storage-identity-sqlite';
import { openVerifiedSqliteStorage } from '../../lib/db/storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../../lib/db/enrolled-sqlite-schema-profile';
import { createEnrolledSqlitePublicProfiles } from '../../lib/db/public-profiles-sqlite';
import { createEnrolledSqliteRunClaims } from '../../lib/db/run-claims-sqlite';
import { writeSqliteQueryRun } from '../../lib/db/query-run-record';
import type { QueryRun } from '../../lib/types';
import type { PublicProfileInput } from '../../lib/profiles/public-profile';
import { validateStorageIdentity,type StorageIdentity } from '../../lib/db/storage-identity';
import { createPostgresDomainChannel,PostgresDomainWriteOutcomeUnknown } from '../../lib/db/postgres/domain-channel';
import { composePostgresPublicProfiles } from '../../lib/db/postgres/public-profiles-transport';
import { createPostgresRuntimeTransport } from '../../lib/db/postgres/runtime-transport';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import { capturePostgresPublication } from '../../lib/db/postgres/publication-packet';
import { heldHistoryProjectionSql,sqliteOriginalHistoryProjection } from './run-history-projection.mts';
import { heldOwnershipHistoryProjectionSql,sqliteOwnershipHistoryProjection } from './ownership-history-projection.mts';
import { heldPrivacyProjectionSql,sqlitePrivacyProjection } from './privacy-projection.mts';
import { startCommitAckLossProxy } from './commit-ack-loss.mts';
export async function qualifyPublicProfiles(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;contentionClient:Client;ownerSql:(sql:string)=>string}){
 const folder=mkdtempSync(join(tmpdir(),'keryx-native-public-profiles-')),file=join(folder,'oracle.sqlite'),manifestPath=join(folder,'storage.json');
 const identity=validateStorageIdentity({...input.identity,deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),provenanceDigest:'9e'.repeat(32)}),manifest=canonicalJson({format:'keryx-storage-deployment-v1',identity,backend:{kind:'sqlite',databasePath:file}});
 const wallet='0x'+'9b'.repeat(20),foreign='0x'+'9c'.repeat(20),hash='9d'.repeat(32),date='2026-11-13T00:00:00.000Z',handle='migration_researcher',binding={network:'eip155:5042' as const,origin:'https://keryx.cc'},actor={wallet,sessionHash:hash,binding};
 const q=(s:string)=>"'"+s.replaceAll("'","''")+"'",pg=(s:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+s+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 const channel=createPostgresDomainChannel(input.options,input.identity,input.digest),native=composePostgresPublicProfiles(channel,false);let vectors=0,selected:ReturnType<typeof openVerifiedSqliteStorage>|undefined;
 assert(input.options.endpoint.kind==='loopback');
 const sourceOwner=new Client({host:'127.0.0.1',port:input.options.endpoint.port,user:'postgres',database:input.options.database,password:input.options.password,ssl:false,connectionTimeoutMillis:2000,query_timeout:6000,options:'-c statement_timeout=5000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=5000',application_name:'keryx-public-profile-synthetic-owner'});
 // Administrative fault injection in this disposable SOURCE fixture only.
 // A scoped existing auth writer context satisfies the row fence without a
 // control transition or another full application admission inside the 1s wait.
 const authFault=(operation:'revoke_web_session'|'create_web_session',sql:string)=>sourceOwner.query(`BEGIN;INSERT INTO keryx_storage.writer(transaction_id,identity_digest,operation) SELECT txid_current(),identity_digest,${q(operation)} FROM keryx_storage.identity WHERE singleton;${sql}DELETE FROM keryx_storage.writer WHERE transaction_id=txid_current();COMMIT;`);
 let proxy:Awaited<ReturnType<typeof startCommitAckLossProxy>>|undefined,loss:ReturnType<typeof createPostgresDomainChannel>|undefined;
 const owner=(work:(db:DatabaseSync)=>void)=>{const db=new DatabaseSync(file);try{registerStorageCapability(db,identity,()=>true);db.exec('BEGIN IMMEDIATE');work(db);db.exec('COMMIT');}finally{db.close();}};
 const clean=(value:unknown):unknown=>JSON.parse(JSON.stringify(value),(key,v)=>['publishedAt','updatedAt'].includes(key)&&v!==null?'generated-time':v);
 const make=(suffix:string,patch:Partial<QueryRun>={}):QueryRun=>({id:'synthetic-public-profile-'+suffix,createdAt:date,question:'Published question '+suffix,answer:'Private answer',engine:'heuristic',budget:1,totalSpent:0,totalToCreators:0,subClaims:[],decisions:[],citations:[],trace:[],asker:wallet,uninterpreted:'\0\ud800',...patch} as QueryRun);
 const save=(run:QueryRun,visibility='public')=>owner(db=>{
  if(db.prepare('SELECT 1 FROM query_runs WHERE id=?').get(run.id))db.prepare('UPDATE query_runs SET data=?,question=? WHERE id=?').run(JSON.stringify(run),run.question,run.id);else writeSqliteQueryRun(db,run,false);
  db.prepare('UPDATE run_privacy SET visibility=? WHERE run_id=?').run(visibility,run.id);
  const row=db.prepare('SELECT data,asker FROM query_runs WHERE id=?').get(run.id)!,packet=JSON.parse(capturePostgresPublication(run).wire);
  pg(`INSERT INTO public.query_runs(id,created_at,question,budget,data,asker,engine,total_spent,total_to_creators,answer) VALUES(${q(run.id)},${q(date)},${q(run.question)},1,${q(String(row.data))}::json,${row.asker===null?'NULL':q(String(row.asker))},'heuristic',0,0,'Private answer') ON CONFLICT(id) DO UPDATE SET data=excluded.data,question=excluded.question,asker=excluded.asker;
   DELETE FROM keryx_storage.run_history_projection WHERE run_id=${q(run.id)};DELETE FROM keryx_storage.run_ownership_projection WHERE run_id=${q(run.id)};DELETE FROM keryx_storage.run_privacy_projection WHERE run_id=${q(run.id)};DELETE FROM keryx_storage.usage_projection WHERE run_id=${q(run.id)};DELETE FROM keryx_storage.public_ledger_projection WHERE run_id=${q(run.id)};`+
   heldHistoryProjectionSql(run.id,sqliteOriginalHistoryProjection(db,run.id))+heldOwnershipHistoryProjectionSql(run.id,sqliteOwnershipHistoryProjection(db,run.id))+heldPrivacyProjectionSql(run.id,sqlitePrivacyProjection(db,run.id))+
   `INSERT INTO public.run_privacy(run_id,visibility,updated_at) VALUES(${q(run.id)},${q(visibility)},${q(date)}) ON CONFLICT(run_id) DO UPDATE SET visibility=excluded.visibility;`);
  assert.equal(packet.privacy.publicProfile.profileFields,sqlitePrivacyProjection(db,run.id).publicProfile.profileFields);
 });
 const intent=(runIds:string[]=[],fields:PublicProfileInput['fields']=['displayName'],revision=0):PublicProfileInput=>({published:true,fields,runIds,revision});
 try{
  await sourceOwner.connect();
  const db=new DatabaseSync(file);try{db.exec('PRAGMA foreign_keys=ON;BEGIN IMMEDIATE');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);insertStorageIdentity(db,identity);installStorageFences(db,identity);db.exec('COMMIT');}finally{db.close();}writeFileSync(manifestPath,manifest,{mode:0o600});
  owner(db=>{db.prepare('INSERT INTO private_profiles VALUES(?,?,?,?,?,?,?,?)').run(wallet,handle,'Researcher','Private bio','Private purpose','[]',date,date);db.prepare('INSERT INTO web_sessions VALUES(?,?,?,?)').run(hash,wallet,Date.now()-1000,Date.now()+600000);});
  pg(`INSERT INTO public.private_profiles VALUES(${q(wallet)},${q(handle)},'Researcher','Private bio','Private purpose','[]',${q(date)},${q(date)});INSERT INTO public.web_sessions VALUES(${q(hash)},${q(wallet)},${Date.now()-1000},${Date.now()+600000});`);
  selected=openVerifiedSqliteStorage(file,identity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>assert.equal(readFileSync(manifestPath,'utf8'),manifest)});const oracle=createEnrolledSqlitePublicProfiles(selected.db);assert(oracle);
  const compare=async()=>{assert.deepEqual(clean(await native.settings(actor)),clean(await oracle.settings(actor)));assert.deepEqual(clean(await native.read(handle)),clean(await oracle.read(handle)));assert.deepEqual(clean(await native.sitemap(1000)),clean(await oracle.sitemap(1000)));vectors++;};
  const update=async(i:PublicProfileInput)=>{assert.deepEqual(clean(await native.update(actor,i)),clean(await oracle.update(actor,i)));await compare();};
  await compare();const a=make('public'),b=make('private'),c=make('foreign',{asker:foreign}),d=make('offline',{paymentMode:'offline'}),sponsored=make('sponsored',{fundingOwner:'treasury'});for(const r of [a,c,d,sponsored])save(r);save(b,'private');
  await update(intent([a.id,b.id],['displayName','about','purpose','verifiedLinks','ledgers']));assert.equal((await native.read(handle))!.runs.length,1);vectors++;
  for(const port of [native,oracle])await assert.rejects(port.update(actor,intent([c.id],[],1)),/not_owned/);await compare();
  for(const port of [native,oracle])await assert.rejects(port.update(actor,intent([],[],0)),/conflict/);vectors++;
  // Record-only facts, not a transfer, provider request or financial authority.
  const amounts=[0.000001,0.123456,0.0000001,0.1234567,1000000000000000100,1e21];
  for(const [index,amount] of amounts.entries())owner(db=>{const id='synthetic-public-profile-payment-'+index,runId=index===0?d.id:index===1?sponsored.id:a.id;
   db.prepare("INSERT INTO payment_events(id,query_id,created_at,network,kind,amount_usdc,settled,settlement_status,tx_hash,payee,source_id,source_name,payer) VALUES(?,?,?,'eip155:5042','fetch',?,1,'settled','synthetic-recorded',?,'synthetic-domain-source','Synthetic recorded',?)").run(id,runId,date,amount,wallet,wallet);
   pg(`INSERT INTO public.payment_events(id,query_id,created_at,network,kind,amount_usdc,settled,settlement_status,tx_hash,payee,source_id,source_name,payer) VALUES(${q(id)},${q(runId)},${q(date)},'eip155:5042','fetch',${amount},true,'settled','synthetic-recorded',${q(wallet)},'synthetic-domain-source','Synthetic recorded',${q(wallet)});`);
  });
  const financial=()=>input.ownerSql("SELECT encode(sha256(convert_to(jsonb_build_array((SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.payment_events p),(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM public.a2a_orders a),(SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY to_jsonb(g)::text),'[]') FROM public.session_grants g),(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY to_jsonb(c)::text),'[]') FROM public.browser_signer_capacity c))::text,'UTF8')),'hex');");const beforeFinancial=financial();
  await compare();
  owner(db=>{db.prepare("INSERT INTO profile_verified_identities(wallet,provider,external_id,label,verified_at) VALUES(?,'github','123','migration-researcher',?)").run(wallet,date);});pg(`INSERT INTO public.profile_verified_identities(wallet,provider,external_id,label,verified_at) VALUES(${q(wallet)},'github','123','migration-researcher',${q(date)});`);await compare();
  owner(db=>{db.prepare("UPDATE run_privacy SET visibility='private' WHERE run_id=?").run(a.id);});pg(`UPDATE public.run_privacy SET visibility='private' WHERE run_id=${q(a.id)};`);await compare();assert.equal((await native.read(handle))!.runs.length,0);vectors++;
  pg(`UPDATE public.query_runs SET data=(data::text||' ')::json WHERE id=${q(a.id)};`);await assert.rejects(native.read(handle));vectors++;
  save({...a,question:'Changed original',uninterpreted:'Different\0\ud800'} as QueryRun);await compare();assert.equal((await native.read(handle))!.runs[0].question,'Changed original');vectors++;
  await native.unpublish(actor);await oracle.unpublish(actor);await compare();assert.equal(await native.read(handle),null);vectors++;
  await update(intent([a.id],[],2));
  const concurrent=await Promise.allSettled([native.update(actor,intent([],[],3)),native.update(actor,intent([],[],3))]);assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);await oracle.update(actor,intent([],[],3));vectors++;await compare();
  assert(input.options.endpoint.kind==='loopback');proxy=await startCommitAckLossProxy(input.options.endpoint.port);loss=createPostgresDomainChannel({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest);proxy.arm();await assert.rejects(composePostgresPublicProfiles(loss,false).update(actor,intent([a.id],[],4)),e=>e instanceof PostgresDomainWriteOutcomeUnknown);assert.deepEqual(proxy.observation(),{dropped:true,commands:1});assert.equal((await native.settings(actor)).revision,5);await oracle.update(actor,intent([a.id],[],4));await compare();vectors++;
  await input.contentionClient.query('BEGIN');try{
   await input.contentionClient.query('SELECT pg_advisory_xact_lock_shared(634781904177021::bigint),pg_advisory_xact_lock(634781904177022::bigint)');const queued=native.update(actor,intent([],[],5)).then(value=>({value}),error=>({error}));let blocked=false;
   for(let n=0;n<50;n++){const r=await input.contentionClient.query('SELECT count(*) n FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND pg_backend_pid()=ANY(pg_blocking_pids(pid))');if(Number(r.rows[0].n)>0){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}assert(blocked);
   await authFault('revoke_web_session',`DELETE FROM public.web_sessions WHERE hash=${q(hash)} AND wallet=${q(wallet)};`);await input.contentionClient.query('COMMIT');const outcome=await queued;assert('error' in outcome&&String(outcome.error).includes('unauthenticated'));assert.equal((await native.read(handle))!==null,true);vectors++;
  }finally{await input.contentionClient.query('ROLLBACK');}
  pg(`INSERT INTO public.web_sessions VALUES(${q(hash)},${q(wallet)},${Date.now()-1000},${Date.now()+600000});`);
  const claimed=make('claimed',{asker:undefined});save(claimed);
  const claims=createEnrolledSqliteRunClaims(selected.db);await claims.issue({runId:claimed.id,completedAt:date,tokenHash:'9f'.repeat(32),binding});await claims.claim({tokenHash:'9f'.repeat(32),wallet,sessionHash:hash,binding});
  const ticket=selected.db.prepare('SELECT * FROM anonymous_run_claims WHERE run_id=?').get(claimed.id)!;
  pg(`INSERT INTO public.anonymous_run_claims VALUES(${q(claimed.id)},${q(binding.network)},${q(binding.origin)},${q(String(ticket.token_hash))},${q(String(ticket.original_sha256))},${q(String(ticket.completed_at))},${ticket.issued_at},${ticket.expires_at},${q(wallet)},${ticket.claimed_at});`);
  await update(intent([a.id,claimed.id],['verifiedLinks'],5));assert.equal((await native.read(handle))!.runs.find(r=>r.id===claimed.id)!.ownership,'claimed');vectors++;
  pg(`DELETE FROM keryx_storage.run_ownership_projection WHERE run_id=${q(claimed.id)};`);await assert.rejects(native.read(handle));owner(db=>{pg(heldOwnershipHistoryProjectionSql(claimed.id,sqliteOwnershipHistoryProjection(db,claimed.id)));});await compare();vectors++;
  const issuanceOff=createPostgresRuntimeTransport(input.options,input.identity,input.digest,false,true);try{assert.deepEqual(clean(await issuanceOff.publicProfiles.read(handle)),clean(await oracle.read(handle)));assert.equal((await issuanceOff.publicProfiles.read(handle))!.runs.some(r=>r.id===claimed.id),true);vectors++;}finally{await issuanceOff.close();}
  save({...claimed,uninterpreted:'Changed exact original\0\ud800'} as QueryRun);await compare();assert.equal((await native.read(handle))!.runs.some(r=>r.id===claimed.id),false);for(const port of [native,oracle])await assert.rejects(port.update(actor,intent([claimed.id],[],6)),/not_owned/);vectors++;
  owner(db=>{db.prepare('DELETE FROM profile_verified_identities WHERE wallet=?').run(wallet);});pg(`DELETE FROM public.profile_verified_identities WHERE wallet=${q(wallet)};`);await compare();assert.deepEqual((await native.read(handle))!.verifiedLinks,[]);vectors++;
  owner(db=>{db.prepare("UPDATE private_profiles SET handle='migration_changed' WHERE wallet=?").run(wallet);});pg(`UPDATE public.private_profiles SET handle='migration_changed' WHERE wallet=${q(wallet)};`);await compare();assert.equal(await native.read(handle),null);vectors++;
  owner(db=>{db.prepare('UPDATE private_profiles SET handle=? WHERE wallet=?').run(handle,wallet);});pg(`UPDATE public.private_profiles SET handle=${q(handle)} WHERE wallet=${q(wallet)};`);
  assert.equal((await native.settings(actor)).revision,6);await input.contentionClient.query('BEGIN');try{
   await input.contentionClient.query('SELECT pg_advisory_xact_lock_shared(634781904177021::bigint),pg_advisory_xact_lock(634781904177022::bigint)');const queued=native.update(actor,intent([],[],6)).then(value=>({value}),error=>({error}));let blocked=false;
   for(let n=0;n<50;n++){const r=await input.contentionClient.query('SELECT count(*) n FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND pg_backend_pid()=ANY(pg_blocking_pids(pid))');if(Number(r.rows[0].n)>0){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}assert(blocked);
   // SOURCE-owner fault injection only: expire this synthetic row after the
   // real application writer is blocked. The owner uses a scoped, cleaned auth
   // writer context, without trying to transition the shared control lock or
   // changing a production role, catalog, grant, connection or timeout.
   await authFault('create_web_session',`UPDATE public.web_sessions SET expires_at=floor(extract(epoch FROM clock_timestamp())*1000)+100 WHERE hash=${q(hash)};`);await new Promise(resolve=>setTimeout(resolve,200));await input.contentionClient.query('COMMIT');const outcome=await queued;assert('error' in outcome&&String(outcome.error).includes('unauthenticated'));vectors++;
  }finally{await input.contentionClient.query('ROLLBACK');}pg(`UPDATE public.web_sessions SET expires_at=${Date.now()+600000} WHERE hash=${q(hash)};`);
  const reader=createPostgresDomainChannel({...input.options,role:'keryx_reader'},input.identity,input.digest);try{assert.deepEqual(await composePostgresPublicProfiles(reader,true).read(handle),await native.read(handle));vectors++;}finally{await reader.close();}
  assert.equal(financial(),beforeFinancial);vectors++;await channel.close();await assert.rejects(native.read(handle));vectors++;
  return {vectors,actualPostgres:true,genuineSelectedFull19SqliteOracle:true,optInOnly:true,currentPrivacyAndOriginal:true,claimedExactOriginalAndBinding:true,retainedClaimsIndependentOfIssuanceFlag:true,currentPrivateHandleAndIdentities:true,closedVerifiedIdentities:true,exactJsMicrosGroupedByOriginalNumber:true,concurrentRevisionExactlyOnce:true,actualLostCommitAcknowledgement:true,explicitSettingsReconciliation:true,noAutomaticRetry:true,actualWriterWaitThenRevokedSessionRefused:true,sourceOwnerAuthFaultInjection:true,postWaitClockFresh:true,financialRowsUnchanged:true,actualReaderRole:true,terminalClose:true,productionData:false,paidOperations:0,fullWriterQualified:false};
 }finally{
  await loss?.close();await proxy?.close();await channel.close();selected?.close();await sourceOwner.end();
  pg(`DELETE FROM public.payment_events WHERE id LIKE 'synthetic-public-profile-payment-%';DELETE FROM public.anonymous_run_claims WHERE run_id LIKE 'synthetic-public-profile-%';DELETE FROM public.query_runs WHERE id LIKE 'synthetic-public-profile-%';DELETE FROM public.public_researcher_profiles WHERE wallet=${q(wallet)};DELETE FROM public.profile_verified_identities WHERE wallet=${q(wallet)};DELETE FROM public.private_profiles WHERE wallet=${q(wallet)};DELETE FROM public.web_sessions WHERE hash=${q(hash)};`);
  for(const p of [file,file+'-wal',file+'-shm',file+'-journal',manifestPath])if(existsSync(p))unlinkSync(p);rmdirSync(folder);
 }
}
