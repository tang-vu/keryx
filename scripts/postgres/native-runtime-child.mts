/** Compiled Linux fixture entry. All identity, credentials, keys and data are
 * independently generated synthetic inputs; no live login, signer or vendor. */
import assert from 'node:assert/strict';
import { chmodSync,linkSync,readFileSync,readSync,rmSync,symlinkSync,writeFileSync } from 'node:fs';
import { canonicalJson } from '../../lib/canonical-json';
import { createRequire,syncBuiltinESMExports } from 'node:module';
import { Client } from 'pg';
import { startReadonlyCommitBarrier } from './readonly-commit-barrier.mts';
import { publicLedgerRunReader } from '../../lib/operator-ledger/native-runs';
import type { AcceptanceSnapshot,PublicAcceptance,AcceptanceMetrics } from '../../lib/deliverable-acceptance/contracts';
import type { AccountBinding,AccountPrecondition,AccountSnapshot,InteractiveSession } from '../../lib/accounts/contracts';
async function main(){
 const buffer=Buffer.alloc(16385);let bytes=0;while(bytes<buffer.length){const n=readSync(0,buffer,bytes,buffer.length-bytes,null);if(!n)break;bytes+=n;}assert(bytes<=16384);
 const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,bytes))) as {mode:string;identity:Record<string,unknown>;digest:string;password:string;key:string;owner:string;session:{hash:string;wallet:string;issuedAt:number;expiresAt:number};acceptance:{owner:string;network:string;id:string;snapshot:AcceptanceSnapshot;publicState:PublicAcceptance;metrics:AcceptanceMetrics};account:{session:InteractiveSession;binding:AccountBinding;snapshot:AccountSnapshot;offer:AccountPrecondition}};
 assert.equal(process.platform,'linux');assert.equal(process.version,'v24.22.1');assert.equal(process.getuid!(),0);
 const cgroup=(name:string)=>readFileSync('/sys/fs/cgroup/'+name,'utf8').trim();
 const limits={memoryMax:cgroup('memory.max'),swapMax:cgroup('memory.swap.max'),cpuMax:cgroup('cpu.max'),pidsMax:cgroup('pids.max')};
 assert.deepEqual(limits,{memoryMax:'536870912',swapMax:'0',cpuMax:'100000 100000',pidsMax:'64'});
 const folder='/run/keryx-runtime',readerPath=folder+'/reader.json',appPath=folder+'/application.json',manifestPath=folder+'/storage.json';
 const credential=(role:string,password=input.password)=>canonicalJson({format:'keryx-postgres-role-credential-v1',role,password});
 writeFileSync(readerPath,credential('keryx_reader'),{mode:0o600});writeFileSync(appPath,credential('keryx_app'),{mode:0o600});
 const identity={...input.identity};if(input.mode==='wrong-identity')identity.storageId='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
 const manifest={format:'keryx-storage-deployment-v1',identity,backend:{kind:'postgres',database:'native_target',sourceDigest:input.mode==='wrong-source'?'00'.repeat(32):input.digest,
  endpoint:{kind:'loopback',port:5432},credentialPaths:{application:appPath,reader:readerPath}}};
 writeFileSync(manifestPath,canonicalJson(manifest),{mode:0o600});
 process.env.KERYX_STORAGE_MANIFEST=manifestPath;process.env.CONTENT_MASTER_KEY=input.mode==='missing-key'?'':input.mode==='wrong-key'?'ff'.repeat(32):input.key;
 process.env.KERYX_RUN_PRIVACY_ENABLED='true';process.env.KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED='true';
 let outbound=0;globalThis.fetch=async()=>{outbound++;throw new Error('Synthetic native runtime forbids outbound HTTP');};
 const application=await import('../../lib/db/application-storage'),native=await import('../../lib/db/postgres/runtime-adapter'),privateFile=await import('../../lib/db/postgres/private-credential');
 let checks=0;
 assert.equal(privateFile.readPrivatePostgresCredential(readerPath,'keryx_reader').password,input.password);checks++;
 chmodSync(readerPath,0o644);assert.throws(()=>privateFile.readPrivatePostgresCredential(readerPath,'keryx_reader'));chmodSync(readerPath,0o600);checks++;
 const alias=folder+'/alias';linkSync(readerPath,alias);assert.throws(()=>privateFile.readPrivatePostgresCredential(readerPath,'keryx_reader'));rmSync(alias);symlinkSync(readerPath,alias);assert.throws(()=>privateFile.readPrivatePostgresCredential(alias,'keryx_reader'));rmSync(alias);checks++;
 assert.throws(()=>privateFile.readPrivatePostgresCredential(readerPath,'keryx_app'));checks++;
 if(input.mode==='held-before-cache-crypto'){
  const admin=new Client({host:'127.0.0.1',port:5432,user:'postgres',database:'native_target',password:input.password,ssl:false,connectionTimeoutMillis:1000,query_timeout:5000,options:'-c statement_timeout=4000 -c lock_timeout=1000',application_name:'keryx-synthetic-owner'});
  let connected=false,barrier:Awaited<ReturnType<typeof startReadonlyCommitBarrier>>|undefined,decipherCalls=0;
  const builtin=createRequire('/child.cjs')('node:crypto') as typeof import('node:crypto'),original=builtin.createDecipheriv;
  try{
   await admin.connect();connected=true;
   barrier=await startReadonlyCommitBarrier(5432,async()=>{await admin.query("UPDATE keryx_storage.control SET mode='held' WHERE singleton");});
   manifest.backend.endpoint.port=barrier.port;writeFileSync(manifestPath,canonicalJson(manifest));
   Object.defineProperty(builtin,'createDecipheriv',{value:new Proxy(original,{apply(target,thisArg,args){decipherCalls++;return Reflect.apply(target,thisArg,args);}})});syncBuiltinESMExports();
   const control=await application.createReadonlyApplicationStorage();assert(control);await application.closeReadonlyApplicationStorage(control);assert(decipherCalls>0);const positiveControlDecryptionCalls=decipherCalls;decipherCalls=0;checks++;
   barrier.arm();
   await assert.rejects(async()=>{const value=await application.createReadonlyApplicationStorage();if(value)await native.closePostgresRuntimeAdapter(value);});
   assert.deepEqual(barrier.observation(),{intercepted:true,completed:true,failed:false});assert.equal(decipherCalls,0);checks++;
   console.log(JSON.stringify({passed:true,mode:input.mode,checks,platform:process.platform,node:process.version,outbound,limits,actualPrivatePermissions:true,genuineZeroArgumentReadonlyFactory:true,committedColdReadBeforeActualAuthorityHold:true,asyncAuthorityBeforeCacheCrypto:true,positiveControlDecryptionCalls,decipherCalls,selectedApplicationWriter:false,productionData:false,paidOperations:0}));return;
  }finally{
   Object.defineProperty(builtin,'createDecipheriv',{value:original});syncBuiltinESMExports();
   try{if(connected)await admin.query("UPDATE keryx_storage.control SET mode='active' WHERE singleton");}finally{await admin.end();await barrier?.close();}
  }
 }
 if(input.mode==='withdrawn-before-usage-body'||input.mode==='withdrawn-before-ledger-read'){
  const admin=new Client({host:'127.0.0.1',port:5432,user:'postgres',database:'native_target',password:input.password,ssl:false,connectionTimeoutMillis:1000,query_timeout:5000,options:'-c statement_timeout=4000 -c lock_timeout=1000',application_name:'keryx-synthetic-owner'});let barrier:Awaited<ReturnType<typeof startReadonlyCommitBarrier>>|undefined,observer:Awaited<ReturnType<typeof application.createReadonlyApplicationStorage>>;
  const window={network:'eip155:5042' as const,since:'1970-01-01T00:00:00.000Z',until:'2026-10-10T00:00:00.000Z',period:'all' as const};
  try{
   await admin.connect();barrier=await startReadonlyCommitBarrier(5432,async()=>{await admin.query("BEGIN;UPDATE keryx_storage.control SET mode='held';UPDATE public.run_privacy SET visibility='private' WHERE run_id='synthetic-runtime-run';UPDATE keryx_storage.control SET mode='active';COMMIT;");});manifest.backend.endpoint.port=barrier.port;writeFileSync(manifestPath,canonicalJson(manifest));observer=await application.createReadonlyApplicationStorage();assert(observer);
   const isLedger=input.mode==='withdrawn-before-ledger-read',ledger=publicLedgerRunReader(observer);
   if(isLedger){assert(ledger);assert.equal((await ledger.read(1))[0]?.id,'synthetic-runtime-run');barrier.arm();assert.deepEqual(await ledger.read(1),[]);}
   else{assert.equal((await observer.publicUsage!.history(window,'unknown',1))[0]?.id,'synthetic-runtime-run');barrier.arm(3);assert.deepEqual(await observer.publicUsage!.history(window,'unknown',1),[]);}
   checks++;assert.deepEqual(barrier.observation(),{intercepted:true,completed:true,failed:false});checks++;
   console.log(JSON.stringify({passed:true,mode:input.mode,checks,platform:process.platform,node:process.version,outbound,limits,genuineZeroArgumentReadonlyFactory:true,actualCommittedAuthorityReadThenWithdrawal:true,finalNativeBodyReadAfterAuthorityAwait:!isLedger,finalNativeLedgerReadAfterAuthorityAwait:isLedger,selectedApplicationWriter:false,productionData:false,paidOperations:0}));return;
  }finally{try{if(observer)await application.closeReadonlyApplicationStorage(observer);await admin.query("ROLLBACK;BEGIN;UPDATE keryx_storage.control SET mode='held';UPDATE public.run_privacy SET visibility='public' WHERE run_id='synthetic-runtime-run';UPDATE keryx_storage.control SET mode='active';COMMIT;");}finally{await admin.end();await barrier?.close();}}
 }
 if(input.mode==='wrong-credential-role')writeFileSync(readerPath,credential('keryx_app'));
 if(input.mode==='withdrawn-before-account-read'){
  const admin=new Client({host:'127.0.0.1',port:5432,user:'postgres',database:'native_target',password:input.password,ssl:false,connectionTimeoutMillis:1000,query_timeout:5000,options:'-c statement_timeout=4000 -c lock_timeout=1000',application_name:'keryx-synthetic-owner'});let barrier:Awaited<ReturnType<typeof startReadonlyCommitBarrier>>|undefined,observer:Awaited<ReturnType<typeof application.createReadonlyApplicationStorage>>;
  try{
   await admin.connect();barrier=await startReadonlyCommitBarrier(5432,async()=>{await admin.query("BEGIN;UPDATE keryx_storage.control SET mode='held';");await admin.query('DELETE FROM public.web_sessions WHERE hash=$1',[input.session.hash]);await admin.query("UPDATE keryx_storage.control SET mode='active';COMMIT;");});manifest.backend.endpoint.port=barrier.port;writeFileSync(manifestPath,canonicalJson(manifest));observer=await application.createReadonlyApplicationStorage();assert(observer);const accounts=observer.accountMembership!;
   assert.deepEqual(await accounts.resolve(input.account.session,input.account.binding),input.account.snapshot);checks++;barrier.arm();await assert.rejects(accounts.resolve(input.account.session,input.account.binding),/account_unauthenticated/);checks++;assert.deepEqual(barrier.observation(),{intercepted:true,completed:true,failed:false});checks++;
   console.log(JSON.stringify({passed:true,mode:input.mode,checks,platform:process.platform,node:process.version,outbound,limits,genuineZeroArgumentReadonlyFactory:true,actualCommittedAuthorityReadThenSessionRevocation:true,finalNativeAccountReadAfterAuthorityAwait:true,selectedApplicationWriter:false,productionData:false,paidOperations:0}));return;
  }finally{try{if(observer)await application.closeReadonlyApplicationStorage(observer);await admin.query("ROLLBACK;BEGIN;UPDATE keryx_storage.control SET mode='held';");await admin.query('DELETE FROM public.web_sessions WHERE hash=$1',[input.session.hash]);await admin.query('INSERT INTO public.web_sessions(hash,wallet,issued_at,expires_at) VALUES($1,$2,$3,$4)',[input.session.hash,input.session.wallet,input.session.issuedAt,input.session.expiresAt]);await admin.query("UPDATE keryx_storage.control SET mode='active';COMMIT;");}finally{await admin.end();await barrier?.close();}}
 }
 if(input.mode==='withdrawn-before-acceptance-read'){
  const admin=new Client({host:'127.0.0.1',port:5432,user:'postgres',database:'native_target',password:input.password,ssl:false,connectionTimeoutMillis:1000,query_timeout:5000,options:'-c statement_timeout=4000 -c lock_timeout=1000',application_name:'keryx-synthetic-owner'});let barrier:Awaited<ReturnType<typeof startReadonlyCommitBarrier>>|undefined,observer:Awaited<ReturnType<typeof application.createReadonlyApplicationStorage>>;
  try{
   await admin.connect();barrier=await startReadonlyCommitBarrier(5432,async()=>{await admin.query(`BEGIN;UPDATE keryx_storage.control SET mode='held';INSERT INTO public.deliverable_acceptance_entries(owner,network,original_id,revision,idempotency_key,original_fingerprint,delivered_digest,data) SELECT owner,network,original_id,2,'synthetic-factory-withdrawn',original_fingerprint,delivered_digest,(data::jsonb||'{"expectedRevision":1,"idempotencyKey":"synthetic-factory-withdrawn","revision":2,"publishState":false}'::jsonb)::text FROM public.deliverable_acceptance_entries WHERE original_id=$1 AND revision=1;UPDATE keryx_storage.control SET mode='active';COMMIT;`.replace('WHERE original_id=$1',()=>"WHERE original_id='"+input.acceptance.id+"'"));});manifest.backend.endpoint.port=barrier.port;writeFileSync(manifestPath,canonicalJson(manifest));observer=await application.createReadonlyApplicationStorage();assert(observer);const port=observer.deliverableAcceptance!;
   assert.deepEqual(await port.publicState(input.acceptance.network,input.acceptance.id),input.acceptance.publicState);checks++;barrier.arm();assert.equal((await port.publicState(input.acceptance.network,input.acceptance.id)).state,'not_shared');checks++;assert.deepEqual(barrier.observation(),{intercepted:true,completed:true,failed:false});checks++;
   console.log(JSON.stringify({passed:true,mode:input.mode,checks,platform:process.platform,node:process.version,outbound,limits,genuineZeroArgumentReadonlyFactory:true,actualCommittedAuthorityReadThenWithdrawal:true,finalNativeAcceptanceReadAfterAuthorityAwait:true,selectedApplicationWriter:false,productionData:false,paidOperations:0}));return;
  }finally{try{if(observer)await application.closeReadonlyApplicationStorage(observer);await admin.query("ROLLBACK;BEGIN;UPDATE keryx_storage.control SET mode='held';DELETE FROM public.deliverable_acceptance_entries WHERE original_id='"+input.acceptance.id+"' AND revision=2;UPDATE keryx_storage.control SET mode='active';COMMIT;");}finally{await admin.end();await barrier?.close();}}
 }
 if(input.mode!=='success'){
  if(input.mode==='wrong-source'){
   chmodSync(readerPath,0o644);
   await assert.rejects(application.createReadonlyApplicationStorage(),/adapter_not_initialized/);
  }else await assert.rejects(application.createReadonlyApplicationStorage());checks++;
  assert.equal(outbound,0);console.log(JSON.stringify({passed:true,mode:input.mode,checks,platform:process.platform,node:process.version,outbound,limits,resourcePressureQualified:false,selectedApplicationWriter:false}));return;
 }
 const reader=await application.createReadonlyApplicationStorage();assert(reader);checks++;
 try{
  assert.deepEqual(await native.assertPostgresRuntimeIdentity(reader),input.identity);checks++;
  await assert.rejects(native.assertPostgresRuntimeIdentity(reader,'write'));await assert.rejects(native.assertPostgresRuntimeIdentity(new Proxy(reader,{})));checks++;
  await assert.rejects(application.createApplicationStorage());checks++;
  const metrics=await reader.metrics();assert.equal(metrics.totalQueries,1);checks++;
  const publicUsage=reader.publicUsage!,usageWindow={network:'eip155:5042' as const,since:'1970-01-01T00:00:00.000Z',until:'2026-10-10T00:00:00.000Z',period:'all' as const};
  assert.equal((await publicUsage.summary(usageWindow)).unattributedNetworkRuns,0);assert.equal((await publicUsage.history(usageWindow,'unknown',1))[0]?.answer,'Original answer');checks++;
  assert.equal((await publicUsage.publishedHistory!(usageWindow,'unknown',1)).windowRuns,1);assert.throws(()=>Reflect.get(reader,'prepareUsageHistory'));assert.throws(()=>Reflect.get(reader,'finishUsageHistory'));checks++;
  const ledger=publicLedgerRunReader(reader);assert(ledger);const ledgerRows=await ledger.read(251);assert.equal(ledgerRows[0]?.id,'synthetic-runtime-run');assert(!JSON.stringify(ledgerRows).includes('Original answer'));checks++;
  const acceptance=reader.deliverableAcceptance!,acceptanceArgs=[input.acceptance.owner,input.acceptance.network,input.acceptance.id] as const;
  assert.deepEqual(await acceptance.read(...acceptanceArgs),input.acceptance.snapshot);assert.deepEqual(await acceptance.publicState(input.acceptance.network,input.acceptance.id),input.acceptance.publicState);assert.deepEqual(await acceptance.metrics(input.acceptance.network),input.acceptance.metrics);checks++;
  let acceptanceParsed=0;await assert.rejects(acceptance.submit(...acceptanceArgs,{get choice(){acceptanceParsed++;throw Error();}} as never,{} as never),/readonly_operation/);assert.equal(acceptanceParsed,0);checks++;
  const accountDescriptor=Object.getOwnPropertyDescriptor(reader,'accountMembership');assert(accountDescriptor&&!accountDescriptor.enumerable&&accountDescriptor.value===reader.accountMembership);const accounts=reader.accountMembership!;
  const getWebSession=reader.getWebSession;
  assert.deepEqual(await accounts.offer(input.account.session,input.account.binding),input.account.offer);assert.deepEqual(await accounts.resolve(input.account.session,input.account.binding),input.account.snapshot);await accounts.assertCurrent(input.account.snapshot);checks++;
  assert.deepEqual(await getWebSession(input.session.hash),input.session);checks++;
  let accountParsed=0;await assert.rejects(accounts.resume({get wallet(){accountParsed++;throw Error();}} as never,{} as never,{} as never,{} as never),/readonly_operation/);assert.equal(accountParsed,0);assert.equal(accounts.prepareHistoryFence,undefined);checks++;
  const funding=reader.sessionFundingAccounting.bind(reader),financialId='0x'+'cd'.repeat(32),missingEpoch='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const financialAdmin=new Client({host:'127.0.0.1',port:5432,user:'postgres',database:'native_target',password:input.password,ssl:false,connectionTimeoutMillis:1000,query_timeout:5000,options:'-c statement_timeout=4000 -c lock_timeout=1000',application_name:'keryx-synthetic-owner'});let journalActive:boolean|undefined;
  try{
  await financialAdmin.connect();journalActive=(await financialAdmin.query<{active:boolean}>('SELECT active FROM public.browser_journal_control WHERE id=1')).rows[0]?.active;assert.equal(typeof journalActive,'boolean');
  if(!journalActive){await assert.rejects(reader.browserSignerRetainedSpendMicro(input.owner));checks++;}
  await financialAdmin.query("BEGIN;UPDATE keryx_storage.control SET mode='held';UPDATE public.browser_journal_control SET active=true WHERE id=1;UPDATE keryx_storage.control SET mode='active';COMMIT;");
  assert.equal(await reader.getSessionGrantConsent(input.owner,missingEpoch),null);checks++;
  assert.equal(await reader.browserSignerRetainedSpendMicro(input.owner),0);assert.equal(await reader.browserSignerRetainedSpendMicro('0x'+'22'.repeat(20)),7);checks++;
  assert.deepEqual(await funding(input.owner),{hasAuthorityHistory:false,confirmedSpentMicroUsdc:'0',retainedSpentMicroUsdc:'0',postBaselineConfirmedDebitMicroUsdc:'0'});checks++;
  assert.deepEqual(await reader.sessionWithdrawalAccounting(input.owner),{heldPaymentMicroUsdc:'0',heldWithdrawalMicroUsdc:'0',confirmedSpentMicroUsdc:'0'});checks++;
  assert.equal(await reader.getSessionWithdrawal(financialId,input.owner),null);assert.equal(await reader.pendingSessionWithdrawal(input.owner,input.owner),null);checks++;
  assert.equal(await reader.getSessionWithdrawalCompletion(financialId,input.owner),null);assert.equal(await reader.getSessionWithdrawalSigningPhase(financialId,input.owner),null);assert.equal(await reader.getSessionWithdrawalAbort(financialId,input.owner),null);checks++;
  assert.deepEqual(await reader.listCreatorWithdrawalHistory(input.owner),{requests:[],nextCursor:null});assert.equal(await reader.getCreatorWithdrawal(financialId,input.owner),null);checks++;
  assert.equal(await reader.getCreatorWithdrawalTransferClaim(financialId,input.owner),null);assert.equal(await reader.getCreatorWithdrawalAttestation(financialId,input.owner),null);checks++;
  assert.deepEqual(await reader.creatorOwnerWithdrawalAccounting(input.owner),{heldPaymentMicroUsdc:'0',heldWithdrawalMicroUsdc:'0',confirmedPaymentMicroUsdc:'0',confirmedWithdrawalMicroUsdc:'0'});assert.equal(await reader.getCreatorOwnerWithdrawalCompletion(financialId,input.owner),null);checks++;
  for(const role of [undefined,'public','private'] as const)assert.deepEqual(await reader.hostedTreasuryAccounting(input.owner,role),{retainedMicroUsdc:'0',confirmedMicroUsdc:'0'});checks++;
  for(const name of ['issueSessionGrantConsent','consumeSessionGrantConsent','reserveSessionWithdrawal','admitHostedTreasuryPolicy','admitHostedAuthorization','submitHostedAuthorization','reserveCreatorWithdrawal','admitCreatorOwnerWithdrawal'])assert.throws(()=>Reflect.get(reader,name));checks++;
  }finally{try{if(journalActive!==undefined)await financialAdmin.query("ROLLBACK;BEGIN;UPDATE keryx_storage.control SET mode='held';UPDATE public.browser_journal_control SET active="+String(journalActive)+" WHERE id=1;UPDATE keryx_storage.control SET mode='active';COMMIT;");}finally{await financialAdmin.end();}}
  const health=reader.readPublicHealthSnapshot!,sync=reader.getSyncStates!,jobs=reader.a2aOperationsSnapshot.bind(reader),healthNow=Date.parse('2026-10-09T12:00:00.000Z');
  assert.deepEqual([...(await sync(['dispatchHealth','dispatchHealth','missing']))],[['dispatchHealth',null],['missing',null]]);checks++;
  const snapshot=await health(healthNow,true);assert(snapshot);assert.deepEqual(snapshot.metrics,metrics);assert.equal(snapshot.syncState.size,6);assert.deepEqual(snapshot.jobs,await jobs(healthNow));assert.notEqual(snapshot.jobs.completionLatencyCohorts,null);checks++;
  assert.equal((await health(healthNow,false))?.syncState.size,4);assert.throws(()=>health(NaN,false));assert.throws(()=>health(healthNow,1 as never));checks++;
  const healthAdmin=new Client({host:'127.0.0.1',port:5432,user:'postgres',database:'native_target',password:input.password,ssl:false,connectionTimeoutMillis:1000,query_timeout:5000,options:'-c statement_timeout=4000 -c lock_timeout=1000',application_name:'keryx-synthetic-owner'});
  try{
   await healthAdmin.connect();
   await healthAdmin.query("BEGIN;UPDATE keryx_storage.control SET mode='held';INSERT INTO public.sync_state(key,value) VALUES('dispatchHealth',repeat('x',4194305));UPDATE keryx_storage.control SET mode='active';COMMIT;");
   assert.equal(await health(healthNow,false),undefined);checks++;
   await healthAdmin.query("BEGIN;UPDATE keryx_storage.control SET mode='held';DELETE FROM public.sync_state WHERE key='dispatchHealth';UPDATE keryx_storage.control SET mode='active';COMMIT;");
   assert(await health(healthNow,false));checks++;
   await healthAdmin.query("UPDATE keryx_storage.control SET mode='held';");await assert.rejects(health(healthNow,false));await assert.rejects(sync([]));await assert.rejects(funding(input.owner));checks++;
  }finally{try{await healthAdmin.query("ROLLBACK;UPDATE keryx_storage.control SET mode='active';");}finally{await healthAdmin.end();}}
  assert.throws(()=>Reflect.get(reader,'getQueryRun'));assert.throws(()=>Reflect.get(reader,'upsertSource'));assert.throws(()=>Reflect.get(reader,'saveQueryRun'));assert.deepEqual(Reflect.ownKeys(reader),['publicLedgerRuns','accountMembership']);assert.deepEqual(Object.keys(reader),['publicLedgerRuns']);assert.equal(Object.getPrototypeOf(reader),null);checks++;
  const profile=await reader.privateProfiles!.get(input.owner,'eip155:5042');assert.equal(profile.profile,null);assert.equal(profile.activity.questions,1);checks++;
  assert.equal((await reader.profileIdentities!.list(input.owner)).identities.length,0);checks++;
  let parsed=0;await assert.rejects(reader.privateProfiles!.update(input.owner,{get displayName(){parsed++;return 'unused';}} as never));assert.equal(parsed,0);checks++;
  const filters={search:'Original'},pending=reader.personalHistory!.list(input.owner,{filters,take:1});filters.search='Changed';const rows=await pending;assert.equal(rows.length,1);assert.equal(rows[0].id,'synthetic-runtime-run');checks++;
  const ownership=reader.runOwnershipHistory!,binding={network:'eip155:5042' as const,origin:'https://keryx.cc'};
  assert.equal((await ownership.list(input.owner,{binding,filters:{},take:1}))[0]?.id,'synthetic-runtime-run');checks++;
  const original=await ownership.read(input.owner,binding,'synthetic-runtime-run');assert.equal(original?.run.id,'synthetic-runtime-run');assert.equal(original?.run.asker,input.owner);checks++;
  const privacy=reader.runPrivacy!,actor={wallet:input.owner,binding},id='synthetic-runtime-run';assert.equal(reader.runPrivacyActive,true);
  assert.equal((await privacy.read(id)).item?.run.answer,'Original answer');assert.equal(Reflect.get((await privacy.read(id)).item!.run,'uninterpreted'),'\0\ud800');checks++;
  assert.equal((await privacy.owner(id,actor))?.run.asker,input.owner);assert.equal(await privacy.defaults(actor),'public');checks++;
  assert.equal((await privacy.list({take:1}))[0].id,id);assert.deepEqual(await privacy.questions!([id]),[{id,question:'Original'}]);checks++;
  assert.deepEqual(await privacy.sourceHistory!(),[{id,createdAt:'2026-01-02T03:04:05.000Z',hasAnswer:true,citations:[]}]);assert.equal((await privacy.learningPage!({take:1}))[0].id,id);assert.equal((await privacy.archivePage!({take:1}))[0].id,id);checks++;
  assert.deepEqual(await privacy.memories(1),[]);assert.deepEqual(await privacy.offers(1),[]);assert.equal(await privacy.pending('missing'),null);assert.equal((await privacy.settlement(id))?.question,'');checks++;
  await assert.rejects(privacy.creationReady(),/readonly_operation/);await assert.rejects(privacy.export(id,actor,'12345678-1234-4234-8234-123456789abc'),/readonly_operation/);checks++;
  process.env.KERYX_RUN_PRIVACY_ENABLED='false';assert.throws(()=>reader.runPrivacy);process.env.KERYX_RUN_PRIVACY_ENABLED='true';checks++;
  process.env.KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED='false';assert.throws(()=>reader.runPrivacy);process.env.KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED='true';checks++;
  const bibliographies=reader.privateBibliographies!;assert.equal((await bibliographies.list(input.owner))[0].id,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');assert.deepEqual(await bibliographies.read('a9'.repeat(32)),{content:'Synthetic bibliography content'});checks++;
  await assert.rejects(bibliographies.create(input.owner,{title:'Unused',papers:[]}),/readonly_operation/);checks++;
  const bound=reader.topicWatches!.bindSession(input.session);assert.equal((await bound.list())[0].key.watchId,'synthetic-runtime-watch');assert.equal((await bound.read({ownerWallet:input.owner,watchId:'synthetic-runtime-watch'}) as {revision:number}).revision,1);checks++;
  await assert.rejects(bound.compareAndSwap({ownerWallet:input.owner,watchId:'synthetic-runtime-watch'},null,{} as never,Date.now()+1000),/readonly_operation/);checks++;
  const reviews=reader.decisionReviews!;await reviews.ready();assert.equal(await reviews.read(input.owner,'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),null);checks++;
  assert.deepEqual(await reviews.list(input.owner,'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),[]);checks++;
  const reviewMetrics=await reviews.metrics('eip155:5042','2026-10-09T00:00:00.000Z','2026-10-10T00:00:00.000Z');assert(reviewMetrics.cohorts.every(row=>row.decisions===0));checks++;
  parsed=0;await assert.rejects(reviews.capture(input.owner,{get sourceName(){parsed++;return 'unused';}} as never),/readonly_operation/);await assert.rejects(reviews.begin(input.owner,'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),/readonly_operation/);assert.equal(parsed,0);checks++;
  const before=performance.now();await reader.metrics();const observedReadMs=performance.now()-before;
  // A changed credential is not adopted by an already-created facade.
  writeFileSync(readerPath,credential('keryx_reader','different-synthetic-password'));assert.throws(()=>reader.metrics());writeFileSync(readerPath,credential('keryx_reader'));checks++;
  const captured=reader.personalHistory!,request=captured.list(input.owner,{filters:{},take:1}),outcome=request.then(()=>({returned:true}),()=>({returned:false}));
  await application.closeReadonlyApplicationStorage(reader);assert.equal((await outcome).returned,false);await assert.rejects(native.assertPostgresRuntimeIdentity(reader));await assert.rejects(captured.list(input.owner,{filters:{},take:1}));checks++;
  await assert.rejects(ownership.read(input.owner,binding,'synthetic-runtime-run'));checks++;
  await assert.rejects(privacy.read(id,actor));checks++;
  await assert.rejects(bibliographies.list(input.owner));await assert.rejects(bound.list());checks++;
  await assert.rejects(reviews.list(input.owner,'cccccccc-cccc-4ccc-8ccc-cccccccccccc'));checks++;
  await assert.rejects(sync([]));await assert.rejects(jobs(healthNow));assert.throws(()=>health(healthNow,false));checks++;
  await assert.rejects(funding(input.owner));checks++;
  await assert.rejects(publicUsage.summary(usageWindow));await assert.rejects(publicUsage.history(usageWindow,'unknown',1));checks++;
  await assert.rejects(async()=>ledger.read(1));checks++;
  await assert.rejects(acceptance.read(...acceptanceArgs));await assert.rejects(acceptance.publicState(input.acceptance.network,input.acceptance.id));await assert.rejects(acceptance.metrics(input.acceptance.network));checks++;
  await assert.rejects(accounts.resolve(input.account.session,input.account.binding));await assert.rejects(getWebSession(input.session.hash));checks++;
  assert.equal(outbound,0);console.log(JSON.stringify({passed:true,mode:input.mode,checks,platform:process.platform,node:process.version,outbound,limits,resourcePressureQualified:false,actualPrivatePermissions:true,genuineZeroArgumentReadonlyFactory:true,exactFacadeProvenance:true,coldCacheAuthenticated:true,inputCapturedBeforeAwait:true,actualTerminalDrain:true,observedReadMs,selectedApplicationWriter:false,productionData:false,paidOperations:0}));
 }finally{await native.closePostgresRuntimeAdapter(reader);}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
