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
import { createOwnedHistoryRoute } from '../../lib/history/owned-history-route';
import { chatAccountPort } from '../../lib/chat-accounts/service';
import type { ChatLink,PendingChatLink,ChatRecipient } from '../../lib/chat-accounts/contracts';
import { requirePublicProfiles,type PublicProfileActor,type PublicProfileSnapshot,type PublicProfileSettings } from '../../lib/profiles/public-profile';
import { readPublicProfileJson } from '../../lib/profiles/public-profile-route';
import type { KeryxDB } from '../../lib/db/keryx-db';
import { createAssignmentRoutes } from '../../lib/owner-run-assignments/http';
import { syntheticA2aOriginal } from '../../lib/db/a2a-original-fixture';
import { ARC_MAINNET_PROFILE } from '../../lib/arc-network-profile';
import type { Source,QueryRun } from '../../lib/types';
import type { SourceMeta } from '../../lib/db/keryx-db';
import type { SourceClaim,SourceClaimChallenge } from '../../lib/sources/public-source-claim';
import { APPLICATION_READ_OPERATIONS } from '../../lib/db/postgres/application-read-calls';
const nativeRuntimeModes=['success','public-profiles','owner-assignments','remaining-ports','query-readers','held-during-provenance','credential-during-provenance','close-during-provenance','query-iterator-guards','wrong-identity','wrong-source','wrong-key','missing-key','wrong-credential-role','withdrawn-before-usage-body','withdrawn-before-ledger-read','withdrawn-before-acceptance-read','withdrawn-before-account-read','withdrawn-before-public-profile-read','claims-issuance-off','public-profiles-off','withdrawn-before-chat-read','withdrawn-before-owner-assignment-reply','withdrawn-before-account-history','held-before-cache-crypto','foreign-cache-identity','foreign-cache-source','plaintext-cache','oversized-cache','restored-cold-factory','private-profile-terminal-retirement'] as const;
export type NativeRuntimeMode=typeof nativeRuntimeModes[number];
async function main(){
 const sourceMethods=['getSource','getSourceByOnchainId','listSources','listAllSources','getSourceMeta','getSourceClaim','getSourceClaimForSource','getSourceClaimChallenge','listSourceClaims'];
 const queryMethods=['getQueryRun','listRecentQueries','listQueryRunsByAsker','listFollowUps','iterateRecentQueries'];
 const buffer=Buffer.alloc(16385);let bytes=0;while(bytes<buffer.length){const n=readSync(0,buffer,bytes,buffer.length-bytes,null);if(!n)break;bytes+=n;}assert(bytes<=16384);
 const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,bytes))) as {mode:NativeRuntimeMode;identity:Record<string,unknown>;digest:string;password:string;key:string;owner:string;session:{hash:string;wallet:string;issuedAt:number;expiresAt:number};acceptance:{owner:string;network:string;id:string;snapshot:AcceptanceSnapshot;publicState:PublicAcceptance;metrics:AcceptanceMetrics};account:{session:InteractiveSession;binding:AccountBinding;snapshot:AccountSnapshot;offer:AccountPrecondition};chat:{link:ChatLink;preview:PendingChatLink;recipient:ChatRecipient};sourceClaims:{source:Source;meta:SourceMeta;claim:SourceClaim;challenge:SourceClaimChallenge};queryReads:{projected:QueryRun;sourceHistory:unknown};publicProfile:{actor:PublicProfileActor;handle:string;snapshot:PublicProfileSnapshot;settings:PublicProfileSettings;sitemap:Array<{handle:string;updatedAt:string}>}};
 assert(nativeRuntimeModes.includes(input.mode),'Unknown native runtime fixture mode');
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
 process.env.KERYX_RUN_PRIVACY_ENABLED='true';process.env.KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED=input.mode==='claims-issuance-off'?'false':'true';process.env.KERYX_PUBLIC_PROFILES_ENABLED=input.mode==='public-profiles-off'?'false':'true';
 let outbound=0;globalThis.fetch=async()=>{outbound++;throw new Error('Synthetic native runtime forbids outbound HTTP');};
 const application=await import('../../lib/db/application-storage'),native=await import('../../lib/db/postgres/runtime-adapter'),privateFile=await import('../../lib/db/postgres/private-credential');
 let checks=0;
 const startedAt=performance.now(),phaseMs:Record<string,number>={};
 const progress=(stage:string)=>{const elapsedMs=Math.round(performance.now()-startedAt);phaseMs[stage]=elapsedMs;process.stderr.write(JSON.stringify({fixtureMode:input.mode,stage,elapsedMs})+'\n');};
 assert.equal(privateFile.readPrivatePostgresCredential(readerPath,'keryx_reader').password,input.password);checks++;
 chmodSync(readerPath,0o644);assert.throws(()=>privateFile.readPrivatePostgresCredential(readerPath,'keryx_reader'));chmodSync(readerPath,0o600);checks++;
 const alias=folder+'/alias';linkSync(readerPath,alias);assert.throws(()=>privateFile.readPrivatePostgresCredential(readerPath,'keryx_reader'));rmSync(alias);symlinkSync(readerPath,alias);assert.throws(()=>privateFile.readPrivatePostgresCredential(alias,'keryx_reader'));rmSync(alias);checks++;
 assert.throws(()=>privateFile.readPrivatePostgresCredential(readerPath,'keryx_app'));checks++;
 if(input.mode==='private-profile-terminal-retirement'){
  const admin=new Client({host:'127.0.0.1',port:5432,user:'postgres',database:'native_target',password:input.password,ssl:false,connectionTimeoutMillis:1000,query_timeout:5000,options:'-c statement_timeout=4000 -c lock_timeout=1000',application_name:'keryx-synthetic-owner'});
  let reader:Awaited<ReturnType<typeof application.createReadonlyApplicationStorage>>,locked=false,readerSql=0,profileSelectsCompleted=0;
  let profileSelectFailure:{sqlState:string;refusal:string}|undefined;
  const observedProfileFailure=():{sqlState:string;refusal:string}|undefined=>profileSelectFailure;
  const fixedProfileRefusals=new Set(['native profile read-only transaction required','native profile context refused','native profile network refused','native profile activity bound','native profile topic shape','native profile surface unavailable','native profile record bound','native history context refused','native Source scalar projection unavailable','canceling statement due to lock timeout','canceling statement due to statement timeout']);
  const descriptor=Object.getOwnPropertyDescriptor(Client.prototype,'query');assert(descriptor&&typeof descriptor.value==='function');
  // Record the real driver's reader calls without replacing SQL, results,
  // credentials, factory selection or its private provenance registration.
  Object.defineProperty(Client.prototype,'query',{...descriptor,value:new Proxy(descriptor.value,{apply(target,thisArg,args){
   const params=(thisArg as Client&{connectionParameters?:{user?:string;database?:string}}).connectionParameters;
   const observed=params?.user==='keryx_reader'&&params.database==='native_target';
   if(observed)readerSql++;
   const result=Reflect.apply(target,thisArg,args);
   const query=args[0],text=typeof query==='string'?query:query&&typeof query==='object'?Reflect.get(query,'text'):'';
   if(observed&&typeof text==='string'&&text.includes('public.storage_private_profile_get('))
    void Promise.resolve(result).then(()=>{profileSelectsCompleted++;},(error:unknown)=>{
     const code=error&&typeof error==='object'?Reflect.get(error,'code'):undefined,message=error instanceof Error?error.message:undefined;
     profileSelectFailure={sqlState:typeof code==='string'&&/^[0-9A-Z]{5}$/.test(code)?code:'unclassified',refusal:typeof message==='string'&&fixedProfileRefusals.has(message)?message:'unclassified native profile refusal'};
    });
   return result;
  }})});
  const readerCount=async()=>Number((await admin.query("SELECT count(*)::integer n FROM pg_stat_activity WHERE datname=current_database() AND usename='keryx_reader'")).rows[0].n);
  try{
   await admin.connect();const baseline=await readerCount();
   reader=await application.createReadonlyApplicationStorage();assert(reader);
   assert.deepEqual(await application.applicationStorageIdentity(reader,'read'),input.identity);checks++;
   application.assertApplicationStorageCurrentLocal(reader,'read');
   await assert.rejects(application.applicationStorageIdentity(reader,'write'),/readonly_operation/);await assert.rejects(application.createApplicationStorage(),/adapter_not_initialized/);checks++;
   const profiles=reader.privateProfiles!,identities=reader.profileIdentities!,history=reader.personalHistory!,privacy=reader.runPrivacy!;
   const top=reader.getSource,coreRead=reader.getQueryRun,coreMetrics=reader.metrics,profileRead=profiles.get,identityRead=identities.list,historyRead=history.list,privacyRead=privacy.read;
   const iterator=reader.iterateRecentQueries(1)[Symbol.asyncIterator](),bound=reader.topicWatches!.bindSession(input.session),boundRead=bound.list;
   const other='0x'+'d7'.repeat(20);assert.notEqual(other,input.owner);
   assert.equal((await profileRead(other,'eip155:5042')).activity.questions,0);checks++;
   await assert.rejects(profileRead('invalid-wallet','eip155:5042'));assert.deepEqual(await native.assertPostgresRuntimeIdentity(reader),input.identity);checks++;
   await admin.query('BEGIN');locked=true;await admin.query('SELECT pg_advisory_xact_lock(634781904177022::bigint)');
   let settled=false;const contention=profileRead(other,'eip155:5042').then(()=>{settled=true;return false;},()=>{settled=true;return true;});
   let waited=false;const deadline=Date.now()+4000;
   while(Date.now()<deadline&&!settled){
    const wait=await admin.query("SELECT count(*)::integer n FROM pg_locks WHERE locktype='advisory' AND mode='ShareLock' AND NOT granted AND objsubid=1 AND classid::bigint*4294967296+objid::bigint=634781904177022::bigint AND pg_backend_pid()=ANY(pg_blocking_pids(pid))");
    if(Number(wait.rows[0].n)>0){waited=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
   }
   assert(waited,'Private-profile control must actually wait behind the data lock');assert.equal(await contention,true);
   await admin.query('ROLLBACK');locked=false;assert.deepEqual(await native.assertPostgresRuntimeIdentity(reader),input.identity);assert.equal((await profileRead(other,'eip155:5042')).activity.questions,0);checks+=2;
   let getters=0;const hostile=new Proxy({},{get(){getters++;throw Error('Terminal facade inspected caller fields');}}) as never;
   await assert.rejects(profiles.update(input.owner,hostile),/readonly_operation/);assert.equal(getters,0);assert.deepEqual(await native.assertPostgresRuntimeIdentity(reader),input.identity);checks++;
   const completed=profileSelectsCompleted;profileSelectFailure=undefined;
   await assert.rejects(profileRead('0x'+'d8'.repeat(20),'eip155:5042'),/adapter_not_initialized/);
   const failure=observedProfileFailure();if(failure)process.stderr.write(JSON.stringify({fixtureMode:input.mode,event:'terminal-profile-native-select-refused',...failure})+'\n');
   assert.equal(profileSelectsCompleted,completed+1,'The actual SELECT must succeed before strict Source profile decoding retires the reader');assert.equal(failure,undefined);checks++;
   const afterFailure=readerSql;
   assert.throws(()=>native.assertPostgresRuntimeCurrentLocal(reader!),/adapter_not_initialized/);
   await assert.rejects(native.assertPostgresRuntimeIdentity(reader),/adapter_not_initialized/);await assert.rejects(application.applicationStorageIdentity(reader,'read'),/adapter_not_initialized/);checks++;
   for(const invoke of [()=>top(hostile),()=>coreRead(hostile),()=>coreMetrics(),()=>profileRead(hostile,hostile),()=>identityRead(hostile),()=>historyRead(hostile,hostile),()=>privacyRead(hostile,hostile),()=>boundRead(),()=>iterator.next()])await assert.rejects(async()=>invoke(),/adapter_not_initialized/);checks+=9;
   assert.throws(()=>Reflect.get(reader!,'getSource'),/adapter_not_initialized/);assert.throws(()=>Reflect.get(reader!,'privateProfiles'),/adapter_not_initialized/);assert.equal(getters,0);assert.equal(readerSql,afterFailure);checks++;
   await application.closeReadonlyApplicationStorage(reader);assert.equal(await readerCount(),baseline);assert.equal(readerSql,afterFailure);checks++;
   assert.equal(outbound,0);
   console.log(JSON.stringify({passed:true,mode:input.mode,checks,platform:process.platform,node:process.version,outbound,limits,genuineZeroArgumentReadonlyFactory:true,exactFacadeProvenance:true,strictPrivateProfileDecodeAfterSuccessfulNativeSelect:true,ordinaryInputAndLockRefusalsNonterminal:true,actualDataLockWait:true,acquiredTopNestedAndCoreMethodsRetired:true,noCallerGettersAfterRetirement:true,noReaderSqlAfterRetirement:true,canonicalDisposalDrainedReaders:true,nativeFacadeTerminalRetirementQualified:true,fullWriterQualified:false,selectedApplicationWriter:false,productionData:false,paidOperations:0}));return;
  }finally{
   try{if(locked)await admin.query('ROLLBACK');if(reader)try{await application.closeReadonlyApplicationStorage(reader);}catch(error){await native.closePostgresRuntimeAdapter(reader);}}
   finally{Object.defineProperty(Client.prototype,'query',descriptor);await admin.end();}
  }
 }
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
 if(input.mode==='withdrawn-before-account-history'){
  const admin=new Client({host:'127.0.0.1',port:5432,user:'postgres',database:'native_target',password:input.password,ssl:false,connectionTimeoutMillis:1000,query_timeout:5000,options:'-c statement_timeout=4000 -c lock_timeout=1000'});
  let barrier:Awaited<ReturnType<typeof startReadonlyCommitBarrier>>|undefined,previous:{visibility:string;revision:number}|undefined;
  try{
   await admin.connect();previous=(await admin.query("SELECT visibility,revision::integer FROM public.run_privacy WHERE run_id='synthetic-runtime-run'")).rows[0];assert(previous);
   barrier=await startReadonlyCommitBarrier(5432,async()=>{await admin.query('BEGIN');await admin.query("UPDATE keryx_storage.control SET mode='held'");await admin.query("UPDATE public.run_privacy SET visibility='private',revision=revision+1 WHERE run_id='synthetic-runtime-run'");await admin.query("UPDATE keryx_storage.control SET mode='active'");await admin.query('COMMIT');});
   writeFileSync(manifestPath,canonicalJson({...manifest,backend:{...manifest.backend,endpoint:{kind:'loopback',port:barrier.port}}}));
   // Open under the actual proxy endpoint; the same zero-argument factory owns
   // admission. No caller-injected DB, guard or synchronous history substitute.
   const reader=await application.createReadonlyApplicationStorage();assert(reader);
   try{
    let sessions=0;const route=createOwnedHistoryRoute({binding:input.account.binding,key:async()=>null,db:async()=>reader,session:async()=>{const row=await reader.getWebSession(input.session.hash);assert.deepEqual(row,input.session);if(++sessions===2)barrier!.arm();return {db:reader,wallet:input.owner,currentId:input.session.hash};}},'detail');
    const response=await route(new Request('https://keryx.cc/api/me/asks/synthetic-runtime-run'),'synthetic-runtime-run');assert.equal(sessions,2);assert.equal(response.status,503);assert(!(await response.text()).includes('Original answer'));assert.equal(barrier.observation().completed,true);
    assert.equal(outbound,0);console.log(JSON.stringify({passed:true,mode:input.mode,checks:7,platform:process.platform,node:process.version,outbound,limits,genuineZeroArgumentReadonlyFactory:true,genuineOwnedHistoryRoute:true,actualCommittedAuthorityReadThenPrivacyChange:true,finalNativeHistoryReadAfterAllRequestAwaits:true,selectedApplicationWriter:false,productionData:false,paidOperations:0}));return;
   }finally{await native.closePostgresRuntimeAdapter(reader);}
  }finally{
   if(previous){await admin.query('BEGIN');await admin.query("UPDATE keryx_storage.control SET mode='held'");await admin.query("UPDATE public.run_privacy SET visibility=$1,revision=$2 WHERE run_id='synthetic-runtime-run'",[previous.visibility,previous.revision]);await admin.query("UPDATE keryx_storage.control SET mode='active'");await admin.query('COMMIT');}
   await admin.end();await barrier?.close();
  }
 }
 const exerciseRemainingPorts=async(reader:KeryxDB)=>{
  const privacy=reader.runPrivacy!,id='synthetic-runtime-run',binding={network:'eip155:5042' as const,origin:'https://keryx.cc'},actor={wallet:input.owner,binding};let parsed=0;
  progress('remaining-ports');
  assert.equal((await privacy.list({take:1}))[0].id,id);assert.deepEqual(await privacy.questions!([id]),[{id,question:'Original'}]);checks++;
  assert.deepEqual(await privacy.sourceHistory!(),input.queryReads.sourceHistory);assert.equal((await privacy.learningPage!({take:1}))[0].id,id);assert.equal((await privacy.archivePage!({take:1}))[0].id,id);checks++;
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
  return {privacy,bibliographies,bound,reviews};
 };
 if(input.mode==='owner-assignments'||input.mode==='withdrawn-before-owner-assignment-reply'){
  const admin=new Client({host:'127.0.0.1',port:5432,user:'postgres',database:'native_target',password:input.password,ssl:false,connectionTimeoutMillis:1000,query_timeout:5000,options:'-c statement_timeout=4000 -c lock_timeout=1000'});
  let barrier:Awaited<ReturnType<typeof startReadonlyCommitBarrier>>|undefined,reader:Awaited<ReturnType<typeof application.createReadonlyApplicationStorage>>;
  const withdrawing=input.mode==='withdrawn-before-owner-assignment-reply';
  try{
   await admin.connect();
   if(withdrawing){
    barrier=await startReadonlyCommitBarrier(5432,async()=>{await admin.query('BEGIN');await admin.query("UPDATE keryx_storage.control SET mode='held'");await admin.query('DELETE FROM public.web_sessions WHERE hash=$1',[input.account.session.sessionHash]);await admin.query("UPDATE keryx_storage.control SET mode='active'");await admin.query('COMMIT');});
    manifest.backend.endpoint.port=barrier.port;writeFileSync(manifestPath,canonicalJson(manifest));
   }
   reader=await application.createReadonlyApplicationStorage();assert(reader);const port=reader.ownerRunAssignments;assert(port&&'mode'in port&&port.mode==='native-postgres-async-v1');
   const descriptor=Object.getOwnPropertyDescriptor(reader,'ownerRunAssignments');assert(descriptor&&!descriptor.enumerable&&descriptor.value===port);checks+=2;
   let getters=0;const bad={get wallet(){getters++;throw Error();}} as never;await assert.rejects(port.act(bad,bad,bad,''),/readonly_operation/);assert.equal(getters,0);checks++;
   let sessions=0;const route=createAssignmentRoutes(async()=>{if(++sessions===3&&barrier)barrier.arm();return {db:reader!,wallet:input.owner,currentId:input.account.session.sessionHash};},'https://keryx.cc');
   const response=await route.GET(new Request('https://keryx.cc/api/me/owner-run-assignments',{headers:{'x-keryx-expected-wallet':input.owner}}));assert.equal(sessions,3);assert.equal(response.headers.get('Cache-Control'),'private, no-store');checks+=2;
   if(withdrawing){assert.equal(response.status,401);assert.deepEqual(await response.json(),{error:'assignment_unauthenticated'});assert.deepEqual(barrier!.observation(),{intercepted:true,completed:true,failed:false});checks+=3;}
   else{assert.equal(response.status,200);const body=await response.json();assert.equal(body.kind,'owner-assignment-inbox');assert.deepEqual(body.history,[]);assert.equal(body.recipient.accountId,input.account.snapshot.membership.accountId);checks+=4;}
   await native.closePostgresRuntimeAdapter(reader);await assert.rejects(port.reply(input.account.session,input.owner,input.account.binding.origin));checks++;assert.equal(outbound,0);checks++;
   console.log(JSON.stringify({passed:true,mode:input.mode,checks,platform:process.platform,node:process.version,outbound,limits,genuineZeroArgumentReadonlyFactory:true,genuineAssignmentRoute:true,ownerAssignmentsPositiveProtocol:!withdrawing,actualCommittedAuthorityReadThenSessionRevocation:withdrawing,finalNativeAssignmentReplyAfterAllRequestAwaits:withdrawing,selectedApplicationWriter:false,productionData:false,paidOperations:0}));return;
  }finally{
   if(reader)await native.closePostgresRuntimeAdapter(reader);
   if(withdrawing){await admin.query('ROLLBACK;BEGIN');await admin.query("UPDATE keryx_storage.control SET mode='held'");await admin.query('DELETE FROM public.web_sessions WHERE hash=$1',[input.account.session.sessionHash]);await admin.query('INSERT INTO public.web_sessions VALUES($1,$2,$3,$4)',[input.account.session.sessionHash,input.account.session.wallet,input.account.session.issuedAt,input.account.session.expiresAt]);await admin.query("UPDATE keryx_storage.control SET mode='active'");await admin.query('COMMIT');}
   await admin.end();await barrier?.close();
  }
 }
 if(input.mode==='remaining-ports'){
  const reader=await application.createReadonlyApplicationStorage();assert(reader);checks++;
  try{const ports=await exerciseRemainingPorts(reader);await native.closePostgresRuntimeAdapter(reader);await assert.rejects(ports.privacy.read('synthetic-runtime-run'));await assert.rejects(ports.bibliographies.list(input.owner));await assert.rejects(ports.bound.list());await assert.rejects(ports.reviews.list(input.owner,'cccccccc-cccc-4ccc-8ccc-cccccccccccc'));checks+=4;assert.equal(outbound,0);checks++;console.log(JSON.stringify({passed:true,mode:input.mode,checks,platform:process.platform,node:process.version,outbound,limits,remainingPositiveProtocolsAndTerminalDrain:true,selectedApplicationWriter:false,productionData:false,paidOperations:0}));return;}finally{await native.closePostgresRuntimeAdapter(reader);}
 }
 if(input.mode==='public-profiles'){
  const reader=await application.createReadonlyApplicationStorage();assert(reader);checks++;
  try{
  const publicProfiles=requirePublicProfiles(reader);assert.deepEqual(await publicProfiles.read(input.publicProfile.handle),input.publicProfile.snapshot);checks++;assert.deepEqual(await publicProfiles.settings(input.publicProfile.actor),input.publicProfile.settings);checks++;assert.deepEqual(await publicProfiles.sitemap(10),input.publicProfile.sitemap);checks++;const descriptor=Object.getOwnPropertyDescriptor(reader,'publicProfiles');assert(descriptor&&!descriptor.enumerable&&descriptor.value===publicProfiles);checks++;let profileGetters=0;const badProfile={get wallet(){profileGetters++;throw Error();}} as never;for(const work of [()=>publicProfiles.update(badProfile,badProfile),()=>publicProfiles.unpublish(badProfile)])await assert.rejects(work(),/readonly_operation/);assert.equal(profileGetters,0);checks++;
   assert.equal(outbound,0);checks++;console.log(JSON.stringify({passed:true,mode:input.mode,checks,platform:process.platform,node:process.version,outbound,limits,genuineZeroArgumentReadonlyFactory:true,publicProfilesPositiveProtocol:true,selectedApplicationWriter:false,productionData:false,paidOperations:0}));return;
  }finally{await native.closePostgresRuntimeAdapter(reader);}
 }
 if(input.mode==='claims-issuance-off'){
  const reader=await application.createReadonlyApplicationStorage();assert(reader);
  try{
   const profiles=requirePublicProfiles(reader);assert.deepEqual(await profiles.read(input.publicProfile.handle),input.publicProfile.snapshot);assert.deepEqual(await profiles.settings(input.publicProfile.actor),input.publicProfile.settings);assert.equal(process.env.KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED,'false');assert.equal(outbound,0);
   console.log(JSON.stringify({passed:true,mode:input.mode,checks:5,platform:process.platform,node:process.version,outbound,limits,genuineZeroArgumentReadonlyFactory:true,retainedPublicProfilesAvailableWithIssuanceDisabled:true,selectedApplicationWriter:false,productionData:false,paidOperations:0}));return;
  }finally{await native.closePostgresRuntimeAdapter(reader);}
 }
 if(input.mode==='public-profiles-off'){
  const reader=await application.createReadonlyApplicationStorage();assert(reader);
  try{
   assert.equal(reader.publicProfiles,undefined);assert.equal(Object.getOwnPropertyDescriptor(reader,'publicProfiles'),undefined);assert.throws(()=>requirePublicProfiles(reader));assert.deepEqual(Reflect.ownKeys(reader),[...sourceMethods,...queryMethods,'pendingJobOwners','publicLedgerRuns','accountMembership','chatAccountLinks','ownerRunAssignments']);
   process.env.KERYX_PUBLIC_PROFILES_ENABLED='true';assert.throws(()=>Reflect.get(reader,'publicProfiles'));assert.equal(outbound,0);
   console.log(JSON.stringify({passed:true,mode:input.mode,checks:7,platform:process.platform,node:process.version,outbound,limits,genuineZeroArgumentReadonlyFactory:true,publicProfilesDisabledAbsent:true,changedPublicationFlagRefused:true,selectedApplicationWriter:false,productionData:false,paidOperations:0}));return;
  }finally{await native.closePostgresRuntimeAdapter(reader);}
 }
 if(input.mode==='withdrawn-before-public-profile-read'){
  const admin=new Client({host:'127.0.0.1',port:5432,user:'postgres',database:'native_target',password:input.password,ssl:false,connectionTimeoutMillis:1000,query_timeout:5000,options:'-c statement_timeout=4000 -c lock_timeout=1000'});
  let reader:Awaited<ReturnType<typeof application.createReadonlyApplicationStorage>>,barrier:Awaited<ReturnType<typeof startReadonlyCommitBarrier>>|undefined;
  try{
   await admin.connect();barrier=await startReadonlyCommitBarrier(5432,async()=>{await admin.query('BEGIN');await admin.query("UPDATE keryx_storage.control SET mode='held'");await admin.query('UPDATE public.public_researcher_profiles SET published=0 WHERE wallet=$1',[input.owner]);await admin.query("UPDATE keryx_storage.control SET mode='active'");await admin.query('COMMIT');});
   writeFileSync(manifestPath,canonicalJson({...manifest,backend:{...manifest.backend,endpoint:{kind:'loopback',port:barrier.port}}}));reader=await application.createReadonlyApplicationStorage();assert(reader);const profiles=requirePublicProfiles(reader);
   assert.deepEqual(await profiles.read(input.publicProfile.handle),input.publicProfile.snapshot);barrier.arm();const response=await readPublicProfileJson(reader,input.publicProfile.handle);assert.equal(response.status,404);assert(!(await response.text()).includes('Private profile bio'));assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(barrier.observation(),{intercepted:true,completed:true,failed:false});assert.equal(outbound,0);
   console.log(JSON.stringify({passed:true,mode:input.mode,checks:7,platform:process.platform,node:process.version,outbound,limits,genuineZeroArgumentReadonlyFactory:true,genuinePublicProfileJsonRoute:true,actualCommittedAuthorityReadThenUnpublish:true,finalNativePublicProfileReadAfterAuthorityAwait:true,selectedApplicationWriter:false,productionData:false,paidOperations:0}));return;
  }finally{
   if(reader)await native.closePostgresRuntimeAdapter(reader);await admin.query('ROLLBACK;BEGIN');await admin.query("UPDATE keryx_storage.control SET mode='held'");await admin.query('UPDATE public.public_researcher_profiles SET published=1 WHERE wallet=$1',[input.owner]);await admin.query("UPDATE keryx_storage.control SET mode='active'");await admin.query('COMMIT');await admin.end();await barrier?.close();
  }
 }
 if(input.mode==='withdrawn-before-chat-read'){
  const admin=new Client({host:'127.0.0.1',port:5432,user:'postgres',database:'native_target',password:input.password,ssl:false,connectionTimeoutMillis:1000,query_timeout:5000,options:'-c statement_timeout=4000 -c lock_timeout=1000'});let barrier:Awaited<ReturnType<typeof startReadonlyCommitBarrier>>|undefined,reader:Awaited<ReturnType<typeof application.createReadonlyApplicationStorage>>;
  try{
   await admin.connect();barrier=await startReadonlyCommitBarrier(5432,async()=>{await admin.query('BEGIN');await admin.query("UPDATE keryx_storage.control SET mode='held'");await admin.query('UPDATE public.account267_credentials SET active=0 WHERE wallet=$1',[input.owner]);await admin.query("UPDATE keryx_storage.control SET mode='active'");await admin.query('COMMIT');});
   writeFileSync(manifestPath,canonicalJson({...manifest,backend:{...manifest.backend,endpoint:{kind:'loopback',port:barrier.port}}}));reader=await application.createReadonlyApplicationStorage();assert(reader);const chat=chatAccountPort(reader);assert(chat);
   assert.deepEqual(await chat.lookup(input.chat.recipient,input.account.binding),input.chat.link);barrier.arm();await assert.rejects(chat.lookup(input.chat.recipient,input.account.binding),/chat_account_changed/);assert.deepEqual(barrier.observation(),{intercepted:true,completed:true,failed:false});assert.equal(outbound,0);
   console.log(JSON.stringify({passed:true,mode:input.mode,checks:7,platform:process.platform,node:process.version,outbound,limits,genuineZeroArgumentReadonlyFactory:true,actualCommittedAuthorityReadThenCredentialRevocation:true,finalNativeChatReadAfterAuthorityAwait:true,selectedApplicationWriter:false,productionData:false,paidOperations:0}));return;
  }finally{
   if(reader)await native.closePostgresRuntimeAdapter(reader);await admin.query('ROLLBACK;BEGIN');await admin.query("UPDATE keryx_storage.control SET mode='held'");await admin.query('UPDATE public.account267_credentials SET active=1 WHERE wallet=$1',[input.owner]);await admin.query("UPDATE keryx_storage.control SET mode='active'");await admin.query('COMMIT');await admin.end();await barrier?.close();
  }
 }
 if(input.mode==='withdrawn-before-account-read'){
  const admin=new Client({host:'127.0.0.1',port:5432,user:'postgres',database:'native_target',password:input.password,ssl:false,connectionTimeoutMillis:1000,query_timeout:5000,options:'-c statement_timeout=4000 -c lock_timeout=1000',application_name:'keryx-synthetic-owner'});let barrier:Awaited<ReturnType<typeof startReadonlyCommitBarrier>>|undefined,observer:Awaited<ReturnType<typeof application.createReadonlyApplicationStorage>>;
  try{
   await admin.connect();barrier=await startReadonlyCommitBarrier(5432,async()=>{await admin.query("BEGIN;UPDATE keryx_storage.control SET mode='held';");await admin.query('DELETE FROM public.web_sessions WHERE hash=$1',[input.account.session.sessionHash]);await admin.query("UPDATE keryx_storage.control SET mode='active';COMMIT;");});manifest.backend.endpoint.port=barrier.port;writeFileSync(manifestPath,canonicalJson(manifest));observer=await application.createReadonlyApplicationStorage();assert(observer);const accounts=observer.accountMembership!;
   assert.deepEqual(await accounts.resolve(input.account.session,input.account.binding),input.account.snapshot);checks++;barrier.arm();await assert.rejects(accounts.resolve(input.account.session,input.account.binding),/account_unauthenticated/);checks++;assert.deepEqual(barrier.observation(),{intercepted:true,completed:true,failed:false});checks++;
   console.log(JSON.stringify({passed:true,mode:input.mode,checks,platform:process.platform,node:process.version,outbound,limits,genuineZeroArgumentReadonlyFactory:true,actualCommittedAuthorityReadThenSessionRevocation:true,finalNativeAccountReadAfterAuthorityAwait:true,selectedApplicationWriter:false,productionData:false,paidOperations:0}));return;
  }finally{try{if(observer)await application.closeReadonlyApplicationStorage(observer);await admin.query("ROLLBACK;BEGIN;UPDATE keryx_storage.control SET mode='held';");await admin.query('DELETE FROM public.web_sessions WHERE hash=$1',[input.account.session.sessionHash]);await admin.query('INSERT INTO public.web_sessions(hash,wallet,issued_at,expires_at) VALUES($1,$2,$3,$4)',[input.account.session.sessionHash,input.account.session.wallet,input.account.session.issuedAt,input.account.session.expiresAt]);await admin.query("UPDATE keryx_storage.control SET mode='active';COMMIT;");}finally{await admin.end();await barrier?.close();}}
 }
 if(input.mode==='withdrawn-before-acceptance-read'){
  const admin=new Client({host:'127.0.0.1',port:5432,user:'postgres',database:'native_target',password:input.password,ssl:false,connectionTimeoutMillis:1000,query_timeout:5000,options:'-c statement_timeout=4000 -c lock_timeout=1000',application_name:'keryx-synthetic-owner'});let barrier:Awaited<ReturnType<typeof startReadonlyCommitBarrier>>|undefined,observer:Awaited<ReturnType<typeof application.createReadonlyApplicationStorage>>;
  try{
   await admin.connect();barrier=await startReadonlyCommitBarrier(5432,async()=>{await admin.query(`BEGIN;UPDATE keryx_storage.control SET mode='held';INSERT INTO public.deliverable_acceptance_entries(owner,network,original_id,revision,idempotency_key,original_fingerprint,delivered_digest,data) SELECT owner,network,original_id,2,'synthetic-factory-withdrawn',original_fingerprint,delivered_digest,(data::jsonb||'{"expectedRevision":1,"idempotencyKey":"synthetic-factory-withdrawn","revision":2,"publishState":false}'::jsonb)::text FROM public.deliverable_acceptance_entries WHERE original_id=$1 AND revision=1;UPDATE keryx_storage.control SET mode='active';COMMIT;`.replace('WHERE original_id=$1',()=>"WHERE original_id='"+input.acceptance.id+"'"));});manifest.backend.endpoint.port=barrier.port;writeFileSync(manifestPath,canonicalJson(manifest));observer=await application.createReadonlyApplicationStorage();assert(observer);const port=observer.deliverableAcceptance!;
   assert.deepEqual(await port.publicState(input.acceptance.network,input.acceptance.id),input.acceptance.publicState);checks++;barrier.arm();assert.equal((await port.publicState(input.acceptance.network,input.acceptance.id)).state,'not_shared');checks++;assert.deepEqual(barrier.observation(),{intercepted:true,completed:true,failed:false});checks++;
   console.log(JSON.stringify({passed:true,mode:input.mode,checks,platform:process.platform,node:process.version,outbound,limits,genuineZeroArgumentReadonlyFactory:true,actualCommittedAuthorityReadThenWithdrawal:true,finalNativeAcceptanceReadAfterAuthorityAwait:true,selectedApplicationWriter:false,productionData:false,paidOperations:0}));return;
  }finally{try{if(observer)await application.closeReadonlyApplicationStorage(observer);await admin.query("ROLLBACK;BEGIN;UPDATE keryx_storage.control SET mode='held';DELETE FROM public.deliverable_acceptance_entries WHERE original_id='"+input.acceptance.id+"' AND revision=2;UPDATE keryx_storage.control SET mode='active';COMMIT;");}finally{await admin.end();await barrier?.close();}}
 }
 if(input.mode==='query-readers'){
  const reader=await application.createReadonlyApplicationStorage();assert(reader);const same=(value:unknown,expected:unknown)=>assert.equal(canonicalJson(value),canonicalJson(expected)),expected=input.queryReads.projected,id=expected.id;
  try{
   same(await reader.getQueryRun(id),expected);same(await reader.listRecentQueries(1),[expected]);same(await reader.listQueryRunsByAsker(input.owner,1),[expected]);same(await reader.listFollowUps('synthetic-runtime-parent'),[expected]);const streamed=[];for await(const row of reader.iterateRecentQueries(1))streamed.push(row);same(streamed,[expected]);checks+=5;
   same((await reader.runPrivacy!.read(id)).item!.run,expected);assert.equal(expected.confidence?.level,'Low');assert(expected.citations.length===2&&expected.citations.every(c=>c.evidenceProvenance==='synthetic-demo'));checks++;
   const original=await reader.runPrivacy!.owner(id,{wallet:input.owner,binding:{network:'eip155:5042',origin:'https://keryx.cc'}});assert(original);assert.equal(original.run.answer,'Original answer');assert(original.run.citations.every(c=>c.evidenceProvenance===undefined));assert.equal(Reflect.get(original.run,'uninterpreted'),'\0\ud800');checks++;
   for(const name of queryMethods){const descriptor=Object.getOwnPropertyDescriptor(reader,name);assert(descriptor&&!descriptor.enumerable&&typeof descriptor.value==='function');}checks++;
   // The existing application RPC inventory has no provenance fallback. A
   // nonempty successful page therefore exercises the fixed metadata port.
   assert.equal(Object.hasOwn(APPLICATION_READ_OPERATIONS,'read_evidence_provenance'),false);for(const name of ['readEvidenceProvenance','verifySourceIfUnchanged','saveQueryRun','recordPayment','upsertSource'])assert.throws(()=>Reflect.get(reader,name));await assert.rejects(application.createApplicationStorage());checks++;
   const captured=reader.getQueryRun,iterator=reader.iterateRecentQueries(1)[Symbol.asyncIterator]();await native.closePostgresRuntimeAdapter(reader);await assert.rejects(async()=>captured(id));await assert.rejects(iterator.next());checks++;
   assert.equal(outbound,0);console.log(JSON.stringify({passed:true,mode:input.mode,checks,platform:process.platform,node:process.version,outbound,limits,genuineFiveQueryReadersAndPrivacyProjection:true,sourceAndItemFlagsNonempty:true,ownerOriginalExact:true,noProvenanceRpcFallback:true,selectedApplicationWriter:false,productionData:false,paidOperations:0}));return;
  }finally{await native.closePostgresRuntimeAdapter(reader);}
 }
 if(['held-during-provenance','credential-during-provenance','close-during-provenance'].includes(input.mode)){
  const admin=new Client({host:'127.0.0.1',port:5432,user:'postgres',database:'native_target',password:input.password,ssl:false,connectionTimeoutMillis:1000,query_timeout:5000,options:'-c statement_timeout=4000 -c lock_timeout=1000'});let reader:Awaited<ReturnType<typeof application.createReadonlyApplicationStorage>>,barrier:Awaited<ReturnType<typeof startReadonlyCommitBarrier>>|undefined,closing:Promise<void>|undefined;
  try{
   await admin.connect();barrier=await startReadonlyCommitBarrier(5432,async()=>{
    if(input.mode==='held-during-provenance')await admin.query("UPDATE keryx_storage.control SET mode='held'");
    else if(input.mode==='credential-during-provenance')writeFileSync(readerPath,credential('keryx_reader','different-synthetic-password'));
    else{assert(reader);closing=Promise.resolve(application.closeReadonlyApplicationStorage(reader));void closing.catch(()=>{});}
   });manifest.backend.endpoint.port=barrier.port;writeFileSync(manifestPath,canonicalJson(manifest));reader=await application.createReadonlyApplicationStorage();assert(reader);
   // Privacy read: authority, body, authority, flags. Core point read:
   // authority, original, flags. Delay the actual flags acknowledgement.
   barrier.arm(input.mode==='held-during-provenance'?4:3);const pending=input.mode==='held-during-provenance'?reader.runPrivacy!.read(input.queryReads.projected.id):reader.getQueryRun(input.queryReads.projected.id);await assert.rejects(pending);checks++;
   assert.deepEqual(barrier.observation(),{intercepted:true,completed:true,failed:false});if(closing)await closing;checks++;
   assert.equal(outbound,0);console.log(JSON.stringify({passed:true,mode:input.mode,checks,platform:process.platform,node:process.version,outbound,limits,committedProvenanceThenAuthorityChangeRefused:true,noStaleBodyPublished:true,closeDidNotAwaitItsInflightCall:true,selectedApplicationWriter:false,productionData:false,paidOperations:0}));return;
  }finally{writeFileSync(readerPath,credential('keryx_reader'));try{await admin.query("ROLLBACK;UPDATE keryx_storage.control SET mode='active'");if(reader)await native.closePostgresRuntimeAdapter(reader);}finally{await admin.end();await barrier?.close();}}
 }
 if(input.mode==='query-iterator-guards'){
  const admin=new Client({host:'127.0.0.1',port:5432,user:'postgres',database:'native_target',password:input.password,ssl:false,connectionTimeoutMillis:1000,query_timeout:5000,options:'-c statement_timeout=4000 -c lock_timeout=1000'});const reader=await application.createReadonlyApplicationStorage();assert(reader);
  try{
   await admin.connect();
   for(const fault of ['held','credential','close']){
    const iterator=reader.iterateRecentQueries(2)[Symbol.asyncIterator](),first=await iterator.next();assert.equal(first.done,false);assert.equal(canonicalJson(first.value),canonicalJson(input.queryReads.projected));checks++;
    if(fault==='held')await admin.query("UPDATE keryx_storage.control SET mode='held'");else if(fault==='credential')writeFileSync(readerPath,credential('keryx_reader','different-synthetic-password'));else await native.closePostgresRuntimeAdapter(reader);
    await assert.rejects(iterator.next());checks++;if(fault==='held')await admin.query("UPDATE keryx_storage.control SET mode='active'");if(fault==='credential')writeFileSync(readerPath,credential('keryx_reader'));
   }
   assert.equal(outbound,0);console.log(JSON.stringify({passed:true,mode:input.mode,checks,platform:process.platform,node:process.version,outbound,limits,perYieldHeldCredentialAndCloseGuards:true,selectedApplicationWriter:false,productionData:false,paidOperations:0}));return;
  }finally{writeFileSync(readerPath,credential('keryx_reader'));try{await admin.query("ROLLBACK;UPDATE keryx_storage.control SET mode='active'");await native.closePostgresRuntimeAdapter(reader);}finally{await admin.end();}}
 }
 if(input.mode==='restored-cold-factory'){
  progress('restored-cold-admission');const restored=await application.createReadonlyApplicationStorage();assert(restored);checks++;
  try{
   assert.deepEqual(await native.assertPostgresRuntimeIdentity(restored),input.identity);checks++;
   const original=syntheticA2aOriginal(739,ARC_MAINNET_PROFILE);
   const hasOriginal=restored.hasA2aOriginalSettlement,unfinished=restored.listUnfinishedA2aOrders;assert(hasOriginal&&unfinished);
   assert.equal(await hasOriginal(original.binding),true);checks++;
   assert.equal(await hasOriginal({...original.binding,requestHash:'ab'.repeat(32)}),false);checks++;
   assert.deepEqual(await unfinished(1),{orders:[],unreadable:0,truncated:false});checks++;
   await assert.rejects(async()=>restored.claimNextA2aOrder('synthetic-readonly-worker',new Date().toISOString(),original.binding));checks++;
   assert.equal((await restored.metrics()).totalQueries,1);checks++;
   assert.deepEqual(await restored.accountMembership!.resolve(input.account.session,input.account.binding),input.account.snapshot);checks++;
   assert.deepEqual(await chatAccountPort(restored)!.lookup(input.chat.recipient,input.account.binding),input.chat.link);checks++;
   assert.deepEqual(await requirePublicProfiles(restored).read(input.publicProfile.handle),input.publicProfile.snapshot);checks++;
   await native.closePostgresRuntimeAdapter(restored);await assert.rejects(native.assertPostgresRuntimeIdentity(restored));checks++;
   assert.equal(outbound,0);checks++;progress('restored-cold-complete');
   console.log(JSON.stringify({passed:true,mode:input.mode,checks,platform:process.platform,node:process.version,outbound,limits,phaseMs,genuineZeroArgumentReadonlyFactory:true,restoredAuthenticatedColdCache:true,currentIdentityAndAccount:true,actualTerminalDrain:true,selectedApplicationWriter:false,productionData:false,paidOperations:0}));return;
  }finally{await native.closePostgresRuntimeAdapter(restored);}
 }
 if(input.mode!=='success'){
  if(input.mode==='wrong-source'){
   chmodSync(readerPath,0o644);
   await assert.rejects(application.createReadonlyApplicationStorage(),/adapter_not_initialized/);
  }else await assert.rejects(application.createReadonlyApplicationStorage());checks++;
  assert.equal(outbound,0);console.log(JSON.stringify({passed:true,mode:input.mode,checks,platform:process.platform,node:process.version,outbound,limits,resourcePressureQualified:false,selectedApplicationWriter:false}));return;
 }
 progress('admission');const reader=await application.createReadonlyApplicationStorage();assert(reader);checks++;progress('observations');
 try{
  assert.deepEqual(await native.assertPostgresRuntimeIdentity(reader),input.identity);checks++;
  await assert.rejects(native.assertPostgresRuntimeIdentity(reader,'write'));await assert.rejects(native.assertPostgresRuntimeIdentity(new Proxy(reader,{})));checks++;
  assert.deepEqual(await application.applicationStorageIdentity(reader),input.identity);checks++;
  await assert.rejects(application.applicationStorageIdentity(reader,'write'),/readonly_operation/);checks++;
  let identityFields=0;const forgedIdentity=new Proxy({identity:input.identity},{get(){identityFields++;throw Error('Caller identity fields are not provenance');}}) as unknown as typeof reader;
  for(const candidate of [forgedIdentity,new Proxy(reader,{}),Object.create(reader) as typeof reader])for(const access of ['read','write'] as const)await assert.rejects(application.applicationStorageIdentity(candidate,access),/adapter_not_initialized/);
  assert.equal(identityFields,0);checks++;
  await assert.rejects(application.createApplicationStorage());checks++;
  const metrics=await reader.metrics();assert.equal(metrics.totalQueries,1);checks++;
  const sourceEqual=(value:unknown,expected:unknown)=>assert.deepEqual(JSON.parse(JSON.stringify(value)),expected);
  const sourceExpected=input.sourceClaims;
  sourceEqual(await reader.getSource(sourceExpected.source.id),sourceExpected.source);checks++;
  sourceEqual(await reader.getSourceByOnchainId(sourceExpected.source.onchainId!),sourceExpected.source);checks++;
  sourceEqual((await reader.listSources()).find(row=>row.id===sourceExpected.source.id),sourceExpected.source);checks++;
  sourceEqual((await reader.listAllSources()).find(row=>row.id===sourceExpected.source.id),sourceExpected.source);checks++;
  sourceEqual(await reader.getSourceMeta(sourceExpected.source.onchainId!),sourceExpected.meta);checks++;
  sourceEqual(await reader.getSourceClaim!(sourceExpected.claim.id),sourceExpected.claim);sourceEqual(await reader.getSourceClaimForSource!(sourceExpected.source.id),sourceExpected.claim);checks++;
  sourceEqual(await reader.getSourceClaimChallenge!(sourceExpected.challenge.id),sourceExpected.challenge);sourceEqual(await reader.listSourceClaims!(input.owner),[sourceExpected.claim]);checks++;
  for(const name of sourceMethods){const descriptor=Object.getOwnPropertyDescriptor(reader,name);assert(descriptor&&!descriptor.enumerable&&typeof descriptor.value==='function');}checks++;
  const pendingOwners=reader.pendingJobOwners!;assert(pendingOwners);let parsedProof=0;const fakeProof={get session(){parsedProof++;throw Error();}} as never;
  await assert.rejects(pendingOwners.list(fakeProof));assert.equal(parsedProof,0);await assert.rejects(pendingOwners.assertAdmissionAsync!(fakeProof));checks++;

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
  const chatDescriptor=Object.getOwnPropertyDescriptor(reader,'chatAccountLinks'),chat=chatAccountPort(reader);assert(chatDescriptor&&!chatDescriptor.enumerable&&chatDescriptor.value===chat&&chat===reader.chatAccountLinks);assert.equal(chatAccountPort(Object.create(reader)),null);checks++;
  assert.deepEqual(await chat.preview(input.chat.preview.tokenHash,input.account.binding),input.chat.preview);checks++;
  assert.deepEqual(await chat.lookup(input.chat.recipient,input.account.binding),input.chat.link);assert.deepEqual(await chat.list(input.account.snapshot),[input.chat.link]);checks++;
  let chatParsed=0;const badChat={get wallet(){chatParsed++;throw Error();}} as never;for(const invoke of [()=>chat.issue(badChat),()=>chat.complete('',badChat),()=>chat.unlink(badChat,badChat),()=>chat.unlinkAccount(badChat,badChat)])await assert.rejects(invoke(),/readonly_operation/);assert.equal(chatParsed,0);checks++;
  const funding=reader.sessionFundingAccounting.bind(reader),financialId='0x'+'cd'.repeat(32),missingEpoch='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  progress('financial-observations');
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
  assert.equal(typeof Reflect.get(reader,'getQueryRun'),'function');assert.throws(()=>Reflect.get(reader,'upsertSource'));assert.throws(()=>Reflect.get(reader,'saveQueryRun'));assert.deepEqual(Reflect.ownKeys(reader),[...sourceMethods,...queryMethods,'pendingJobOwners','publicLedgerRuns','accountMembership','chatAccountLinks','ownerRunAssignments','publicProfiles']);assert.deepEqual(Object.keys(reader),['publicLedgerRuns']);assert.equal(Object.getPrototypeOf(reader),null);checks++;
  progress('owner-reads');const profile=await reader.privateProfiles!.get(input.owner,'eip155:5042');assert.equal(profile.profile?.handle,input.publicProfile.handle);assert.equal(profile.activity.questions,1);checks++;
  assert.equal((await reader.profileIdentities!.list(input.owner)).identities.length,0);checks++;
  let parsed=0;await assert.rejects(reader.privateProfiles!.update(input.owner,{get displayName(){parsed++;return 'unused';}} as never));assert.equal(parsed,0);checks++;
  const filters={search:'Original'},pending=reader.personalHistory!.list(input.owner,{filters,take:1});filters.search='Changed';const rows=await pending;assert.equal(rows.length,1);assert.equal(rows[0].id,'synthetic-runtime-run');checks++;
  const ownership=reader.runOwnershipHistory!,binding={network:'eip155:5042' as const,origin:'https://keryx.cc'};
  assert.equal((await ownership.list(input.owner,{binding,filters:{},take:1}))[0]?.id,'synthetic-runtime-run');checks++;
  const original=await ownership.read(input.owner,binding,'synthetic-runtime-run');assert.equal(original?.run.id,'synthetic-runtime-run');assert.equal(original?.run.asker,input.owner);checks++;
  const privacy=reader.runPrivacy!,actor={wallet:input.owner,binding},id='synthetic-runtime-run';assert.equal(reader.runPrivacyActive,true);
  assert.equal((await privacy.read(id)).item?.run.answer,input.queryReads.projected.answer);assert.equal(Reflect.get((await privacy.read(id)).item!.run,'uninterpreted'),'\0\ud800');checks++;
  assert.equal((await privacy.owner(id,actor))?.run.asker,input.owner);assert.equal(await privacy.defaults(actor),'public');checks++;
  progress('account-history');assert.equal(typeof accounts.prepareAsyncHistoryFence,'function');
  const observed=await privacy.owner(id,actor);assert(observed);const finalHistory=await accounts.prepareAsyncHistoryFence!(input.account.snapshot,[{id,ownerWallet:input.owner,...observed}],Date.now()+25000);await finalHistory();await assert.rejects(finalHistory());checks++;
  const detailRoute=createOwnedHistoryRoute({binding,key:async()=>null,db:async()=>reader,session:async()=>{assert.deepEqual(await getWebSession(input.session.hash),input.session);return {db:reader,wallet:input.owner,currentId:input.session.hash};}},'detail');
  const detail=await detailRoute(new Request('https://keryx.cc/api/me/asks/'+id),id);assert.equal(detail.status,200);assert.equal((await detail.json()).run.answer,'Original answer');checks++;
  const disposedHistory=await accounts.prepareAsyncHistoryFence!(input.account.snapshot,[],Date.now()+25000);
  const bibliographies=reader.privateBibliographies!,bound=reader.topicWatches!.bindSession(input.session),reviews=reader.decisionReviews!;
  const before=performance.now();await reader.metrics();const observedReadMs=performance.now()-before;
  // A changed credential is not adopted by an already-created facade.
  writeFileSync(readerPath,credential('keryx_reader','different-synthetic-password'));assert.throws(()=>reader.metrics());await assert.rejects(application.applicationStorageIdentity(reader),/identity_mismatch/);writeFileSync(readerPath,credential('keryx_reader'));checks++;
  progress('terminal-drain');const captured=reader.personalHistory!,request=captured.list(input.owner,{filters:{},take:1}),outcome=request.then(()=>({returned:true}),()=>({returned:false}));
  const identityOutcome=application.applicationStorageIdentity(reader).then(()=>true,()=>false);
  await application.closeReadonlyApplicationStorage(reader);assert.equal((await outcome).returned,false);await assert.rejects(native.assertPostgresRuntimeIdentity(reader));await assert.rejects(captured.list(input.owner,{filters:{},take:1}));checks++;
  assert.equal(await identityOutcome,false);await assert.rejects(application.applicationStorageIdentity(reader),/adapter_not_initialized/);checks++;
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
  await assert.rejects(disposedHistory());checks++;
  await assert.rejects(async()=>reader.getSource(sourceExpected.source.id));await assert.rejects(pendingOwners.list(fakeProof));checks++;
  await assert.rejects(chat.lookup(input.chat.recipient,input.account.binding));await assert.rejects(chat.list(input.account.snapshot));checks++;
  progress('complete');assert.equal(outbound,0);console.log(JSON.stringify({passed:true,mode:input.mode,checks,platform:process.platform,node:process.version,outbound,limits,phaseMs,resourcePressureQualified:false,actualPrivatePermissions:true,genuineZeroArgumentReadonlyFactory:true,exactFacadeProvenance:true,awaitedSelectedReadonlyIdentity:true,forgedWrappedAndWriteIdentityRefused:true,identityResultSuppressedOnClose:true,coldCacheAuthenticated:true,inputCapturedBeforeAwait:true,actualTerminalDrain:true,observedReadMs,selectedApplicationWriter:false,productionData:false,paidOperations:0}));
 }finally{await native.closePostgresRuntimeAdapter(reader);}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
