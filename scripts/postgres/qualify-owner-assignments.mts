/** Actual recipient protocol against genuine selected Full19 SQLite. The
 * unchanged local-owner CLI produces synthetic genesis as real POSIX uid 0. */
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,existsSync,unlinkSync,rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID,createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { nativeAccountFixture,nativeAccountFixturePaths,nativeAccountFixtureTables } from './native-account-fixture.mts';
import { sourceOwnerAssignment } from './owner-assignment-source-cli.mts';
import { registerStorageCapability } from '../../lib/db/storage-identity-sqlite';
import { openVerifiedSqliteStorage } from '../../lib/db/storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../../lib/db/enrolled-sqlite-schema-profile';
import { createEnrolledSqliteOwnerRunAssignments } from '../../lib/db/owner-run-assignments-sqlite';
import { storageIdentityDigest,type StorageIdentity } from '../../lib/db/storage-identity';
import { composePostgresOwnerAssignments } from '../../lib/db/postgres/owner-assignments-transport';
import { createPostgresDomainChannel } from '../../lib/db/postgres/domain-channel';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import { heldHistoryProjectionSql,sqliteOriginalHistoryProjection } from './run-history-projection.mts';
import { type Manifest,type RecipientAction,type Receipt } from '../../lib/owner-run-assignments/contracts';
import { startCommitAckLossProxy } from './commit-ack-loss.mts';
import { Client } from 'pg';
import { composePostgresRunClaims } from '../../lib/db/postgres/claims-transport';
import { createEnrolledSqliteRunClaims } from '../../lib/db/run-claims-sqlite';
export async function qualifyOwnerAssignments(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;contentionClient:Client;ownerSql:(sql:string)=>string}){
 const folder=mkdtempSync(join(tmpdir(),'keryx-native-owner269-')),paths=nativeAccountFixturePaths(folder),now=Date.now(),session={hash:'d1'.repeat(32),wallet:'0x'+'d2'.repeat(20),issuedAt:now-1000,expiresAt:now+600000};
 const q=(v:string)=>"'"+v.replaceAll("'","''")+"'",pg=(sql:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+sql+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 const channel=createPostgresDomainChannel(input.options,input.identity,input.digest),native=composePostgresOwnerAssignments(channel,false);
 let selected:ReturnType<typeof openVerifiedSqliteStorage>|undefined,oracle:ReturnType<typeof createEnrolledSqliteOwnerRunAssignments>,accountId:string|undefined,vectors=0;
 let proxy:Awaited<ReturnType<typeof startCommitAckLossProxy>>|undefined,loss:ReturnType<typeof createPostgresDomainChannel>|undefined;
 const runIds:string[]=[],operationIds:string[]=[];
 const owner=(work:(db:DatabaseSync)=>void)=>{const db=new DatabaseSync(paths[0]);try{registerStorageCapability(db,input.identity,()=>true);db.exec('BEGIN IMMEDIATE');work(db);db.exec('COMMIT');}finally{db.close();}};
 const open=()=>{const manifest=readFileSync(paths[4],'utf8');selected=openVerifiedSqliteStorage(paths[0],input.identity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>assert.equal(readFileSync(paths[4],'utf8'),manifest)});oracle=createEnrolledSqliteOwnerRunAssignments(selected.db);assert(oracle);};
 const clean=(value:unknown):unknown=>JSON.parse(JSON.stringify(value),(key,v)=>['committedAt','assignedAt','confirmedAt'].includes(key)&&v!==null?'generated-time':v);
 const requestId=()=>{const id=randomUUID();operationIds.push(id);return id;};
 const financial=()=>input.ownerSql("SELECT encode(sha256(convert_to(jsonb_build_array((SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text COLLATE \"C\"),'[]') FROM public.payment_events r),(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text COLLATE \"C\"),'[]') FROM public.a2a_orders r),(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text COLLATE \"C\"),'[]') FROM public.session_grants r),(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text COLLATE \"C\"),'[]') FROM public.browser_signer_capacity r))::text,'UTF8')),'hex');");
 try{
  const seed=await nativeAccountFixture(folder,input.identity,session,{freshLogin:true});accountId=seed.accountId;const {snapshot}=seed.observation,s=snapshot.session,origin=snapshot.binding.origin;
  const recipient={accountId,accountCreatedAt:snapshot.membership.createdAt,wallet:session.wallet,memberGeneration:snapshot.memberGeneration};
  pg(seed.sql+`INSERT INTO public.web_sessions VALUES(${q(session.hash)},${q(session.wallet)},${session.issuedAt},${session.expiresAt});`);
  const members:Manifest['members']=[];
  owner(db=>{
   for(let i=0;i<6;i++){
    const id='synthetic-owner269-'+i,date=new Date(now-60000-i).toISOString(),run={id,createdAt:date,question:'Synthetic assignment',answer:'Private answer',uninterpreted:'\0\ud800'},wire=JSON.stringify(run);runIds.push(id);
    db.prepare('INSERT INTO query_runs(id,created_at,question,budget,data) VALUES(?,?,?,?,?)').run(id,date,run.question,1,wire);
    db.prepare("INSERT INTO payment_events(id,query_id,created_at,network,kind,amount_usdc,settlement_status,settled,source_id,source_name,payer,payee) VALUES(?,?,?,'eip155:5042','fetch',0,'pending',0,'synthetic-domain-source','Synthetic network provenance',?,?)").run(id+'-network',id,date,session.wallet,session.wallet);
    const payment=db.prepare('SELECT * FROM payment_events WHERE id=?').get(id+'-network')!;
    const paymentSql=`INSERT INTO public.payment_events(${Object.keys(payment).join(',')}) VALUES(${Object.entries(payment).map(([key,v])=>v===null?'NULL':key==='settled'?String(v===1):typeof v==='number'?String(v):q(String(v))).join(',')});`;
    pg(`INSERT INTO public.query_runs(id,created_at,question,budget,data) VALUES(${q(id)},${q(date)},'Synthetic assignment',1,${q(wire)}::json);`+paymentSql+heldHistoryProjectionSql(id,sqliteOriginalHistoryProjection(db,id)));
    members.push({assignmentId:randomUUID(),runId:id,originalSha256:createHash('sha256').update(wire).digest('hex'),completedAt:date});
   }
  });
  open();const beforeFinancial=financial();
  const manifest:Manifest={version:1,binding:{...snapshot.binding,storageDigest:storageIdentityDigest(input.identity)},recipient,basis:{code:'early-run-recovery',reference:'synthetic-source-only'},scope:'association-history-and-confirmation',admissionExpiresAt:Date.now()+120000,members};
  const compare=async()=>{assert(oracle);const a=await native.reply(s,session.wallet,origin,recipient),b=oracle.reply(s,session.wallet,origin,recipient);assert.equal(a.headers.get('Cache-Control'),'private, no-store');const na=await a.json(),ob=await b.json();assert.deepEqual(clean(na),clean(ob));assert(!JSON.stringify(na).includes('Private answer'));vectors++;return na;};
  const act=async(action:RecipientAction)=>{assert(oracle);const a=await native.act(s,recipient,action,origin),b=oracle.act(s,recipient,action,origin);assert.deepEqual(clean(a),clean(b));vectors++;return {a,b};};
  await compare();
  const consent:RecipientAction={action:'consent',requestId:requestId(),manifest,acknowledgeAssignedLabel:true,noFinancialAuthority:true};
  const accepted=await act(consent);assert.equal(accepted.a.inputDigest,accepted.b.inputDigest);assert.deepEqual(await native.act(s,recipient,consent,origin),accepted.a);vectors++;
  pg(`UPDATE keryx_storage.run_history_projection SET original_created_at=replace(original_created_at,'Z','+00:00') WHERE run_id=${q(members[0].runId)};`);
  await assert.rejects(native.act(s,recipient,{...consent,requestId:requestId()},origin),/assignment_ineligible/);vectors++;
  owner(db=>pg(heldHistoryProjectionSql(members[0].runId,sqliteOriginalHistoryProjection(db,members[0].runId))));
  selected!.close();selected=undefined;
  const apply={action:'apply' as const,requestId:requestId(),manifest,consentId:consent.requestId};
  const applied=sourceOwnerAssignment(folder,paths[0],input.identity,apply);assert.equal(applied.results.length,6);
  const closed=new DatabaseSync(paths[0]);try{
   assert.equal(closed.prepare('PRAGMA integrity_check').get()?.integrity_check,'ok');assert.equal(closed.prepare('PRAGMA foreign_key_check').all().length,0);
   // Exact genuine SOURCE prefix, after independently checked native consent.
   let sql=`DELETE FROM public.owner269_associations WHERE recipient_account=${q(accountId)};DELETE FROM public.owner269_operations WHERE request_id=${q(consent.requestId)};`;
   for(const table of ['owner269_operations','owner269_associations'])for(const row of closed.prepare('SELECT * FROM '+table).all())sql+=`INSERT INTO public.${table}(${Object.keys(row).join(',')}) VALUES(${Object.values(row).map(v=>v===null?'NULL':typeof v==='number'?String(v):q(String(v))).join(',')});`;
   pg(sql);
  }finally{closed.close();}
  open();assert.equal((await compare()).history.length,6);vectors++;
  const ticket={runId:members[3].runId,completedAt:members[3].completedAt,tokenHash:'db'.repeat(32),binding:snapshot.binding};
  await assert.rejects(composePostgresRunClaims(channel,input.identity.network,false).issue(ticket),/claim_unavailable/);
  const claimManifest=readFileSync(paths[4],'utf8'),claimSelected=openVerifiedSqliteStorage(paths[0],input.identity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>assert.equal(readFileSync(paths[4],'utf8'),claimManifest)});
  try{await assert.rejects(createEnrolledSqliteRunClaims(claimSelected.db).issue(ticket),/claims_unavailable/);}finally{try{claimSelected.close();}catch{/* The unchanged SOURCE claim port retires its connection on a native trigger refusal. */}}vectors++;
  assert.throws(()=>owner(db=>db.prepare('UPDATE query_runs SET question=question WHERE id=?').run(members[3].runId)),/assignment_original_occupied/);
  assert.throws(()=>input.ownerSql(`BEGIN;INSERT INTO keryx_storage.writer(transaction_id,identity_digest,operation) SELECT txid_current(),identity_digest,'privacy_erase' FROM keryx_storage.identity;UPDATE public.query_runs SET question=question WHERE id=${q(members[3].runId)};COMMIT;`),/assignment_original_occupied/);vectors++;
  const confirmed=await act({action:'confirm',requestId:requestId(),expected:{assignmentId:members[0].assignmentId,revision:1}});await compare();
  assert.deepEqual(clean(await(await native.reply(s,session.wallet,origin,recipient,confirmed.a)).json()),clean(await oracle!.reply(s,session.wallet,origin,recipient,confirmed.b).json()));vectors++;
  await act({action:'reject',requestId:requestId(),expected:{assignmentId:members[1].assignmentId,revision:1}});await compare();
  for(const port of [native,oracle!])await assert.rejects(Promise.resolve().then(()=>port.act(s,recipient,{action:'confirm',requestId:requestId(),expected:{assignmentId:members[0].assignmentId,revision:1}},origin)),/assignment_conflict/);vectors++;
  owner(db=>{db.prepare("UPDATE run_privacy SET visibility='private',updated_at=? WHERE run_id=?").run(new Date().toISOString(),members[2].runId);});pg(`INSERT INTO public.run_privacy(run_id,visibility,updated_at) VALUES(${q(members[2].runId)},'private',now()) ON CONFLICT(run_id) DO UPDATE SET visibility='private';`);
  assert.equal((await compare()).history.find((r:{assignmentId:string})=>r.assignmentId===members[2].assignmentId).effective,false);
  await act({action:'reject',requestId:requestId(),expected:{assignmentId:members[2].assignmentId,revision:1}});await compare();
  assert(input.options.endpoint.kind==='loopback');proxy=await startCommitAckLossProxy(input.options.endpoint.port);loss=createPostgresDomainChannel({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest);
  const lost={action:'withdraw' as const,requestId:requestId(),expected:{assignmentId:members[0].assignmentId,revision:2}};proxy.arm();await assert.rejects(composePostgresOwnerAssignments(loss,false).act(s,recipient,lost,origin),/assignment_outcome_unresolved/);assert.deepEqual(proxy.observation(),{dropped:true,commands:1});
  const sourceLost=oracle!.act(s,recipient,lost,origin),reconciled=await native.act(s,recipient,lost,origin);assert.deepEqual(clean(reconciled),clean(sourceLost));await compare();vectors++;
  await assert.rejects(native.reply({...s,expiresAt:s.expiresAt+1},session.wallet,origin,recipient),/assignment_unauthenticated/);vectors++;
  await assert.rejects(native.reply(s,'0x'+'ef'.repeat(20),origin,recipient,reconciled),/assignment_conflict/);vectors++;
  const withdrawal={action:'withdraw-consent' as const,requestId:requestId(),consentId:consent.requestId,expected:members.slice(3).map(m=>({assignmentId:m.assignmentId,revision:1}))};await act(withdrawal);assert.equal((await compare()).history.length,0);
  assert.deepEqual(clean(await native.act(s,recipient,consent,origin)),clean(accepted.b));vectors++;
  const healthyReader=createPostgresDomainChannel({...input.options,role:'keryx_reader'},input.identity,input.digest);try{assert.deepEqual(await(await composePostgresOwnerAssignments(healthyReader,true).reply(s,session.wallet,origin,recipient)).json(),await(await native.reply(s,session.wallet,origin,recipient)).json());vectors++;}finally{await healthyReader.close();}
  const waitUntilBlocked=async()=>{for(let i=0;i<50;i++){const r=await input.contentionClient.query('SELECT count(*) n FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND pg_backend_pid()=ANY(pg_blocking_pids(pid))');if(Number(r.rows[0].n)>0)return;await new Promise(resolve=>setTimeout(resolve,20));}assert.fail('Native assignment did not reach the actual writer lock');};
  await input.contentionClient.query('BEGIN');try{
   await input.contentionClient.query('SELECT pg_advisory_xact_lock_shared(634781904177021::bigint),pg_advisory_xact_lock(634781904177022::bigint)');
   const expiry={...consent,requestId:requestId(),manifest:{...manifest,admissionExpiresAt:Date.now()+700}};
   const pending=native.act(s,recipient,expiry,origin).then(value=>({value}),error=>({error}));await waitUntilBlocked();
   await new Promise(resolve=>setTimeout(resolve,Math.max(0,expiry.manifest.admissionExpiresAt-Date.now()+10)));await input.contentionClient.query('COMMIT');
   const outcome=await pending;assert('error'in outcome&&String(outcome.error).includes('assignment_consent_required'));
   assert.throws(()=>oracle!.act(s,recipient,expiry,origin),/assignment_consent_required/);vectors++;
  }finally{await input.contentionClient.query('ROLLBACK');}
  assert(input.options.endpoint.kind==='loopback');const admin=new Client({host:'127.0.0.1',port:input.options.endpoint.port,user:'postgres',database:input.options.database,password:input.options.password,ssl:false,connectionTimeoutMillis:1000,query_timeout:5000,options:'-c statement_timeout=5000 -c lock_timeout=1000'});
  try{
   await admin.connect();await input.contentionClient.query('BEGIN');try{
    await input.contentionClient.query('SELECT pg_advisory_xact_lock_shared(634781904177021::bigint),pg_advisory_xact_lock(634781904177022::bigint)');
    const pending=native.act(s,recipient,consent,origin).then(value=>({value}),error=>({error}));await waitUntilBlocked();
    // Disposable SOURCE-owner fault injection under the existing auth fence,
    // not a second app writer or a production revocation capability.
    await admin.query(`BEGIN;INSERT INTO keryx_storage.writer(transaction_id,identity_digest,operation) SELECT txid_current(),identity_digest,'revoke_web_session' FROM keryx_storage.identity;DELETE FROM public.web_sessions WHERE hash=${q(s.sessionHash)};DELETE FROM keryx_storage.writer WHERE transaction_id=txid_current();COMMIT;`);
    await input.contentionClient.query('COMMIT');const outcome=await pending;assert('error'in outcome&&String(outcome.error).includes('assignment_unauthenticated'));
    owner(db=>db.prepare('DELETE FROM web_sessions WHERE hash=?').run(s.sessionHash));assert.throws(()=>oracle!.act(s,recipient,consent,origin),/assignment_unauthenticated/);vectors++;
   }finally{await input.contentionClient.query('ROLLBACK');}
  }finally{await admin.end();}
  let touched=0;const bad={get wallet(){touched++;throw Error();}} as never;await assert.rejects(composePostgresOwnerAssignments(channel,true).act(bad,bad,bad,''));assert.equal(touched,0);vectors++;
  const reader=createPostgresDomainChannel({...input.options,role:'keryx_reader'},input.identity,input.digest);try{await assert.rejects(composePostgresOwnerAssignments(reader,true).reply(s,session.wallet,origin,recipient),/assignment_unauthenticated/);vectors++;}finally{await reader.close();}
  assert.equal(input.ownerSql(`SELECT count(*) FROM public.owner269_associations WHERE recipient_account=${q(accountId)};`),'6');assert.equal(financial(),beforeFinancial);await channel.close();await assert.rejects(native.reply(s,session.wallet,origin));vectors++;
  assert(confirmed.a.results[0].status==='claimed');
  return {vectors,actualPostgres:true,genuineSelectedFull19SqliteOracle:true,genuinePosixRootSourceCliGenesis:true,canonicalOriginalDatePreserved:true,escapedNulAndSurrogateOriginalText:true,currentDurableActorBeforeReplay:true,consentConfirmRejectWithdrawAndWithdrawConsent:true,exactRevisionCas:true,privateOriginalSuppressedAndNegativeDecisionAllowed:true,actualLostCommitAckReconciledByOriginalId:true,noAutomaticRetry:true,actualReaderRole:true,readonlyBeforeGetters:true,sourceOwnerAuthFaultInjection:true,actualWriterWaitThenSessionRevocationRefused:true,postWriterWaitExpiryFresh:true,jointClaimAndOriginalOccupancy:true,terminalAssociationAuditRetained:true,financialRowsUnchanged:true,fullWriterQualified:false,productionOperatorAssignmentQualified:false,productionData:false,paidOperations:0};
 }catch(error){process.stderr.write(JSON.stringify({ownerAssignmentFixtureFailure:error instanceof Error?error.message:'unknown'})+'\n');throw error;}finally{
  await loss?.close();await proxy?.close();await channel.close();selected?.close();
  pg(`DELETE FROM public.owner269_associations WHERE recipient_account=${q(accountId??'')};`+(operationIds.length?`DELETE FROM public.owner269_operations WHERE request_id IN(${operationIds.map(q).join(',')});`:'')+
   runIds.map(id=>`DELETE FROM public.payment_events WHERE query_id=${q(id)};DELETE FROM keryx_storage.run_history_projection WHERE run_id=${q(id)};DELETE FROM public.query_runs WHERE id=${q(id)};`).join('')+
   (accountId?nativeAccountFixtureTables.filter(t=>t!=='account267_challenges').map(t=>`DELETE FROM public.${t} WHERE account_id=${q(accountId!)};`).join(''):'')+`DELETE FROM public.account267_challenges WHERE session_hash=${q(session.hash)};DELETE FROM public.web_sessions WHERE wallet=${q(session.wallet)};`);
  for(const path of paths)if(existsSync(path))unlinkSync(path);rmdirSync(folder);
 }
}
