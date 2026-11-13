/** A real compiled Linux process, native permissions and selected read facade.
 * Same bounded PostgreSQL fixture; never a caller-injected facade or guard. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { mkdirSync,mkdtempSync,readFileSync,realpathSync,rmdirSync,unlinkSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { sealEnrolledCacheText } from '../../lib/sources/enrolled-content-cache';
import { validateStorageIdentity,type StorageIdentity } from '../../lib/db/storage-identity';
import { heldHistoryProjectionSql,sqliteOriginalHistoryProjection } from './run-history-projection.mts';
import { heldOwnershipHistoryProjectionSql,sqliteOwnershipHistoryProjection } from './ownership-history-projection.mts';
import { DatabaseSync } from 'node:sqlite';
import { heldPrivacyProjectionSql,sqlitePrivacyProjection } from './privacy-projection.mts';
import { createTopicWatch,type TopicWatchState } from '../../lib/research/topic-watches';
import { topicWatchProjection } from '../../lib/db/postgres/watch-packet';
import { heldWatchProjectionSql } from './watch-projection.mts';
import { canonicalJson } from '../../lib/canonical-json';
import { ARC_MAINNET_PROFILE } from '../../lib/arc-network-profile';
import { syntheticA2aOriginal } from '../../lib/db/a2a-original-fixture';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { insertStorageIdentity,installStorageFences } from '../../lib/db/storage-identity-sqlite';
import { openVerifiedSqliteStorage } from '../../lib/db/storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../../lib/db/enrolled-sqlite-schema-profile';
import { createEnrolledSqliteDeliverableAcceptance } from '../../lib/db/deliverable-acceptance-sqlite';
import { inspectStorageDeploymentManifest } from '../../lib/db/runtime-storage-config';
import { sqliteAcceptanceProjection,heldAcceptanceProjectionSql } from './acceptance-projection.mts';
import type { AcceptanceSnapshot,PublicAcceptance,AcceptanceMetrics } from '../../lib/deliverable-acceptance/contracts';
export async function qualifyNativeRuntime(input:{postgresContainer:string;password:string;identity:StorageIdentity;digest:string;ownerSql:(sql:string)=>string}){
 input={...input,identity:validateStorageIdentity(input.identity)};
 assert.match(input.postgresContainer,/^keryx-postgres-consents-[a-f0-9-]{36}$/);
 const docker=(args:string[],wire?:string)=>execFileSync('docker',args,{input:wire,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:131072,stdio:['pipe','pipe','pipe']}).trim();
 // Keep the single compiled artifact in task-owned temporary storage. Windows
 // already has the task TEMP; Linux CI uses its canonical checkout's .local.
 const fixtureRoot=process.platform==='linux'?resolve('.local/tmp/postgres-mainnet-migration-20261111/os-tmp'):tmpdir();
 mkdirSync(fixtureRoot,{recursive:true});
 const folder=mkdtempSync(join(fixtureRoot,'keryx-native-runtime-')),bundle=join(folder,'child.cjs'),key=randomBytes(32).toString('hex'),owner='0x'+'a8'.repeat(20),cacheId='synthetic-runtime-cache';
 const q=(s:string)=>"'"+s.replaceAll("'","''")+"'",pg=(s:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+s+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 const image=docker(['image','inspect','node:24.22.1-bookworm-slim','--format','{{.Id}}']),containers=new Set<string>();let vectors=0;
 const staging='keryx-postgres-runtime-'+randomUUID();let candidateImage:string|undefined;
 const seal=(id:string,identity:StorageIdentity)=>{const previous=process.env.CONTENT_MASTER_KEY;try{process.env.CONTENT_MASTER_KEY=key;return sealEnrolledCacheText('Synthetic cached text; no payment',id,identity);}finally{if(previous===undefined)delete process.env.CONTENT_MASTER_KEY;else process.env.CONTENT_MASTER_KEY=previous;}};
 const envelope=seal(cacheId,input.identity);
 const now=Date.now(),session={hash:'ab'.repeat(32),wallet:owner,issuedAt:now-1000,expiresAt:now+86400000},bibliographyId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',bibliographyToken='a9'.repeat(32);
 let watch:TopicWatchState|undefined;
 const acceptanceFixture=syntheticA2aOriginal(739,ARC_MAINNET_PROFILE),acceptanceFile=join(folder,'acceptance.sqlite'),acceptanceManifestPath=join(folder,'acceptance-storage.json');
 let acceptance:{owner:string;network:string;id:string;snapshot:AcceptanceSnapshot;publicState:PublicAcceptance;metrics:AcceptanceMetrics}|undefined,acceptanceStoreId:string|undefined;
 const created=await createTopicWatch({store:{async read(){return null;},async compareAndSwap(_key,_revision,next){watch=next;return true;}},now:()=>now,isOwnerCurrent:wallet=>wallet===owner,metadata:{async read(){throw new Error('Synthetic native factory does not run metadata checks');}}},owner,{watchId:'synthetic-runtime-watch',question:'Synthetic metadata',keywords:['term'],authors:[],venues:[],cadenceMs:60000,periodMs:86400000,maximumChecksPerPeriod:4,maximumRowsPerCheck:32,maximumDigestItems:16,expiresAtMs:now+86400000,requestedCaps:{perCheckMicroUsdc:0,perPeriodMicroUsdc:0},consent:{manualMetadata:true,emptyHeartbeat:false}});
 assert.equal(created.status,'created');assert(watch);const watchWire=canonicalJson(watch);
 const run=(mode:string)=>{
  const name='keryx-postgres-runtime-'+randomUUID();containers.add(name);
  try{
   const result=JSON.parse(docker(['run','-i','--rm','--name',name,'--user','0:0','--read-only','--memory','512m','--memory-swap','512m','--cpus','1','--pids-limit','64','--cap-drop','ALL','--security-opt','no-new-privileges',
    '--network','container:'+input.postgresContainer,'--tmpfs','/run/keryx-runtime:rw,nosuid,noexec,mode=0700,size=16m',
    '-e','KERYX_NETWORK=arc','-e','NEXT_PUBLIC_KERYX_NETWORK=arc','-e','KERYX_FORCE_OFFLINE=0','-e','BASE_URL=https://keryx.cc',
    '-e','KERYX_REGISTRY_ADDRESS=0x5555555555555555555555555555555555555555','-e','NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS=0x5555555555555555555555555555555555555555',
    candidateImage!,'node','--max-old-space-size=256','/child.cjs'],JSON.stringify({mode,identity:input.identity,digest:input.digest,password:input.password,key,owner,session,acceptance})));
   assert.equal(result.passed,true);assert.equal(result.outbound,0);assert.equal(result.selectedApplicationWriter,false);vectors+=result.checks;return result;
  }finally{
   const remaining=docker(['ps','-aq','--filter',`name=^/${name}$`]);if(remaining)docker(['rm','-f',name]);assert.equal(docker(['ps','-aq','--filter',`name=^/${name}$`]),'');containers.delete(name);
  }
 };
 try{
  assert.equal(input.ownerSql('SELECT count(*) FROM public.deliverable_acceptance_store;'),'0');
  const source=new DatabaseSync(acceptanceFile),{order,binding}=acceptanceFixture;
  try{
   source.exec('BEGIN IMMEDIATE');installMainnetApplicationSchema(source,{publicReferenceArchive:true});installNativeUserDomainSchema(source);
   source.prepare(`INSERT INTO a2a_orders(id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,service_fee_usdc,research_mode,package_data,status,transaction_id,request_data,response_data,execution_journal_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(order.id,order.id,order.authorizationId,order.requestHash,order.payer,order.payee,order.amountUsdc,order.creatorBudgetUsdc,order.serviceFeeUsdc,order.researchMode,JSON.stringify(order.researchPackage),'completed',order.transaction,JSON.stringify(order.request),JSON.stringify({status:'completed',queryId:order.id,answer:'Synthetic native factory delivery',researchPackage:order.researchPackage}),1,order.createdAt,order.updatedAt);
   source.prepare("INSERT INTO payment_events(id,query_id,kind,source_id,source_name,payer,payee,amount_usdc,network,tx_hash,settled,settlement_status,authorization_id,created_at) VALUES(?,?,'inbound','a2a','Synthetic only',?,?,?,?,?,1,'settled',?,?)").run('inbound_'+order.id,order.id,order.payer,order.payee,order.amountUsdc,binding.network,order.transaction,order.authorizationId,order.createdAt);
   source.prepare('INSERT INTO web_sessions(hash,wallet,issued_at,expires_at) VALUES(?,?,?,?)').run(session.hash,order.payer,session.issuedAt,session.expiresAt);
   insertStorageIdentity(source,input.identity);installStorageFences(source,input.identity);source.exec('COMMIT');
  }finally{source.close();}
  const acceptanceManifest=canonicalJson({format:'keryx-storage-deployment-v1',identity:input.identity,backend:{kind:'sqlite',databasePath:acceptanceFile}});writeFileSync(acceptanceManifestPath,acceptanceManifest,{mode:0o600});
  const selected=openVerifiedSqliteStorage(acceptanceFile,input.identity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>assert.equal(canonicalJson(inspectStorageDeploymentManifest({KERYX_STORAGE_MANIFEST:acceptanceManifestPath})),acceptanceManifest)});
  try{
   const port=createEnrolledSqliteDeliverableAcceptance(selected.db);assert(port);const initial=await port.read(order.payer,binding.network,order.id);
   const snapshot=await port.submit(order.payer,binding.network,order.id,{originalFingerprint:initial.originalFingerprint,deliveredDigest:initial.deliveredDigest,expectedRevision:0,idempotencyKey:'synthetic-factory-acceptance-739',choice:'accept',reason:'PRIVATE FACTORY REASON',publishState:true},{kind:'session',id:session.hash});
   acceptance={owner:order.payer,network:binding.network,id:order.id,snapshot,publicState:await port.publicState(binding.network,order.id),metrics:await port.metrics(binding.network)};
   const projection=sqliteAcceptanceProjection(selected.db,order.id);acceptanceStoreId=projection.storeId;
   let seed=`INSERT INTO public.deliverable_acceptance_store(singleton,id) VALUES(1,${q(projection.storeId)});`;
   for(const table of ['a2a_orders','payment_events','research_purchase_authorizations','deliverable_acceptance_entries'])for(const row of selected.db.prepare('SELECT * FROM '+table).all()){
    const keys=Object.keys(row);assert(keys.every(k=>/^[a-z][a-z0-9_]*$/.test(k)));
    seed+=`INSERT INTO public.${table}(${keys.join(',')}) VALUES(${keys.map(k=>{const v=row[k];if(v===null)return 'NULL';if(k==='settled')return v===1?'true':'false';if(typeof v==='number'||typeof v==='bigint')return String(v);assert(typeof v==='string');return q(v)+(table==='a2a_orders'&&['request_data','response_data','package_data','resolution_data'].includes(k)?'::jsonb':'');}).join(',')});`;
   }pg(seed+heldAcceptanceProjectionSql(projection));
  }finally{selected.close();}
  // Transfer through the daemon archive API instead of assuming host bind paths
  // share the runner namespace. Bundle JS dependencies; optional native PG is
  // deliberately unavailable (this profile uses the qualified pure JS driver).
  buildSync({entryPoints:[fileURLToPath(new URL('./native-runtime-child.mts',import.meta.url))],outfile:bundle,bundle:true,platform:'node',target:'node24',format:'cjs',external:['pg-native'],logLevel:'silent'});
  assert(readFileSync(bundle).byteLength>0&&readFileSync(bundle).byteLength<=16777216,'Compiled native child byte bound');
  containers.add(staging);
  docker(['create','--name',staging,'--network','none','--label','keryx.native-runtime-fixture='+staging,image,'node','--version']);
  docker(['cp',bundle,staging+':/child.cjs']);
  candidateImage=docker(['commit','--change','LABEL keryx.native-runtime-fixture='+staging,staging]);
  assert.match(candidateImage,/^sha256:[a-f0-9]{64}$/);
  docker(['rm',staging]);containers.delete(staging);
  const original=JSON.stringify({id:'synthetic-runtime-run',createdAt:'2026-01-02T03:04:05.000Z',question:'Original',answer:'Original answer',budget:0,engine:'heuristic',subClaims:[],decisions:[],citations:[],trace:[],asker:owner,totalSpent:0,totalToCreators:0,paymentMode:'offline',origin:'web',provenance:{version:1,surface:'web',ownershipMethod:'session'},usage:{version:1,network:'eip155:5042',cohort:'unknown',payment:'unknown',actorEvidenceSha256:null,fundingEvidenceSha256:null},uninterpreted:'\0\ud800'});
  const oracle=new DatabaseSync(':memory:');let historyProjection:string,ownershipProjection:string,privacyProjection:string;
  try{oracle.exec('CREATE TABLE query_runs(id TEXT,created_at TEXT,asker TEXT,data TEXT)');oracle.prepare('INSERT INTO query_runs VALUES(?,?,?,?)').run('synthetic-runtime-run','2026-01-02T03:04:05.000Z',owner,original);historyProjection=heldHistoryProjectionSql('synthetic-runtime-run',sqliteOriginalHistoryProjection(oracle,'synthetic-runtime-run'));ownershipProjection=heldOwnershipHistoryProjectionSql('synthetic-runtime-run',sqliteOwnershipHistoryProjection(oracle,'synthetic-runtime-run'));privacyProjection=heldPrivacyProjectionSql('synthetic-runtime-run',sqlitePrivacyProjection(oracle,'synthetic-runtime-run'));}finally{oracle.close();}
  pg(`INSERT INTO public.query_runs(id,created_at,question,budget,data,asker,engine,total_spent,total_to_creators,answer) VALUES('synthetic-runtime-run','2026-01-02T03:04:05.000Z','Original',0,${q(original)}::json,${q(owner)},'heuristic',0,0,'Original answer');INSERT INTO public.run_privacy(run_id,visibility,updated_at) VALUES('synthetic-runtime-run','public','2026-01-02T03:04:05.000Z');`+
   historyProjection+ownershipProjection+privacyProjection+`INSERT INTO public.cache_items(source_id,text) VALUES(${q(cacheId)},${q(envelope)});
   INSERT INTO public.private_bibliographies(id,wallet,token_hash,title,content,reference_count,revision,created_at,updated_at) VALUES(${q(bibliographyId)},${q(owner)},${q(createHash('sha256').update('keryx-private-bib-v1:'+bibliographyToken).digest('hex'))},'Synthetic bibliography','Synthetic bibliography content',0,1,'2026-01-02T03:04:05.000Z','2026-01-02T03:04:05.000Z');
   INSERT INTO public.web_sessions(hash,wallet,issued_at,expires_at) VALUES(${q(session.hash)},${q(owner)},${session.issuedAt},${session.expiresAt});
   INSERT INTO public.topic_watches(wallet,id,revision,state) VALUES(${q(owner)},'synthetic-runtime-watch',1,${q(watchWire)});`+heldWatchProjectionSql(topicWatchProjection(watchWire)));
  const baseline=input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),success=run('success');
  assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),baseline);
  for(const mode of ['wrong-identity','wrong-source','wrong-key','missing-key','wrong-credential-role']){run(mode);assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),baseline);}
  const withdrawnUsage=run('withdrawn-before-usage-body');assert.equal(withdrawnUsage.finalNativeBodyReadAfterAuthorityAwait,true);assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),baseline);
  const withdrawnLedger=run('withdrawn-before-ledger-read');assert.equal(withdrawnLedger.finalNativeLedgerReadAfterAuthorityAwait,true);assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),baseline);
  const withdrawnAcceptance=run('withdrawn-before-acceptance-read');assert.equal(withdrawnAcceptance.finalNativeAcceptanceReadAfterAuthorityAwait,true);assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),baseline);
  const beforeCrypto=run('held-before-cache-crypto');assert.equal(beforeCrypto.asyncAuthorityBeforeCacheCrypto,true);assert(beforeCrypto.positiveControlDecryptionCalls>0);assert.equal(beforeCrypto.decipherCalls,0);assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),baseline);
  pg(`UPDATE public.cache_items SET text=${q(seal(cacheId,{...input.identity,storageId:randomUUID()}))} WHERE source_id=${q(cacheId)};`);run('foreign-cache-identity');
  pg(`UPDATE public.cache_items SET text=${q(seal(cacheId+'-foreign',input.identity))} WHERE source_id=${q(cacheId)};`);run('foreign-cache-source');
  pg(`UPDATE public.cache_items SET text='unbound legacy plaintext' WHERE source_id=${q(cacheId)};`);run('plaintext-cache');
  pg(`UPDATE public.cache_items SET text=repeat('x',2097153) WHERE source_id=${q(cacheId)};`);run('oversized-cache');
  pg(`UPDATE public.cache_items SET text=${q(envelope)} WHERE source_id=${q(cacheId)};`);run('success');assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),baseline);
  return {vectors,image,compiledDependenciesInOwnedImage:true,genuineLinuxCompiledFactory:true,actualPrivateFilePermissions:true,sourceAndIdentityPinned:true,cacheCiphertextAuthenticated:true,cacheSourceAndIdentityBound:true,asyncAuthorityBeforeCacheCrypto:true,actualCommittedColdReadThenAuthorityHold:true,heldBeforeCrypto:beforeCrypto,finalUsageBodyAfterAuthorityAwait:withdrawnUsage,finalLedgerReadAfterAuthorityAwait:withdrawnLedger,finalAcceptanceReadAfterAuthorityAwait:withdrawnAcceptance,missingAndWrongKeysRefused:true,plaintextAndOversizedCacheRefused:true,validColdFactoryRestored:true,actualReaderConnectionsDrained:true,noFallback:true,observation:success,selectedApplicationWriter:false,productionData:false,paidOperations:0};
 }finally{
  for(const name of containers){try{docker(['rm','-f',name]);}catch{}}
  if(candidateImage){assert.equal(docker(['image','inspect',candidateImage,'--format','{{index .Config.Labels "keryx.native-runtime-fixture"}}']),staging);docker(['image','rm',candidateImage]);assert.equal(docker(['image','ls','-q','--filter','label=keryx.native-runtime-fixture='+staging]),'');}
  pg(`DELETE FROM public.cache_items WHERE source_id=${q(cacheId)};DELETE FROM public.query_runs WHERE id='synthetic-runtime-run';DELETE FROM keryx_storage.topic_watch_projection WHERE wallet=${q(owner)} AND id='synthetic-runtime-watch';DELETE FROM public.topic_watches WHERE wallet=${q(owner)} AND id='synthetic-runtime-watch';DELETE FROM public.private_bibliographies WHERE id=${q(bibliographyId)};DELETE FROM public.web_sessions WHERE hash=${q(session.hash)};`);
  // Only this fixture's one generated bundle, then its empty unique directory.
  assert.equal(realpathSync(folder).toLowerCase(),resolve(folder).toLowerCase());assert.equal(dirname(folder).toLowerCase(),resolve(fixtureRoot).toLowerCase());
  pg(`DELETE FROM public.deliverable_acceptance_entries WHERE original_id=${q(acceptanceFixture.order.id)};DELETE FROM public.payment_events WHERE query_id=${q(acceptanceFixture.order.id)};DELETE FROM public.research_purchase_authorizations WHERE purchase_id=${q(acceptanceFixture.order.id)};DELETE FROM public.a2a_orders WHERE id=${q(acceptanceFixture.order.id)};`+(acceptanceStoreId?`DELETE FROM public.deliverable_acceptance_store WHERE id=${q(acceptanceStoreId)};`:''));
  for(const path of [bundle,acceptanceFile,acceptanceFile+'-wal',acceptanceFile+'-shm',acceptanceFile+'-journal',acceptanceManifestPath])try{unlinkSync(path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}rmdirSync(folder);
 }
}
