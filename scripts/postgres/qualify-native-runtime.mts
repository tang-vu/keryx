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
import { heldPrivacyProjectionSql,sqlitePrivacyProjection,sqlitePublicationScalarProjection } from './privacy-projection.mts';
import { createTopicWatch,type TopicWatchState } from '../../lib/research/topic-watches';
import { topicWatchProjection } from '../../lib/db/postgres/watch-packet';
import { heldWatchProjectionSql } from './watch-projection.mts';
import { canonicalJson } from '../../lib/canonical-json';
import { ARC_MAINNET_PROFILE } from '../../lib/arc-network-profile';
import { syntheticA2aOriginal } from '../../lib/db/a2a-original-fixture';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { writeSqliteQueryRun } from '../../lib/db/query-run-record';
import type { QueryRun } from '../../lib/types';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { insertStorageIdentity,installStorageFences } from '../../lib/db/storage-identity-sqlite';
import { openVerifiedSqliteStorage } from '../../lib/db/storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../../lib/db/enrolled-sqlite-schema-profile';
import { createEnrolledSqliteDeliverableAcceptance } from '../../lib/db/deliverable-acceptance-sqlite';
import { inspectStorageDeploymentManifest } from '../../lib/db/runtime-storage-config';
import { sqliteAcceptanceProjection,heldAcceptanceProjectionSql } from './acceptance-projection.mts';
import type { AcceptanceSnapshot,PublicAcceptance,AcceptanceMetrics } from '../../lib/deliverable-acceptance/contracts';
import { nativeAccountFixture,nativeAccountFixturePaths,nativeAccountFixtureTables } from './native-account-fixture.mts';
import { nativeChatFixture } from './native-chat-fixture.mts';
import { nativePublicProfileFixture } from './native-public-profile-fixture.mts';
import { sqliteA2aTimeProjection,heldA2aTimeProjectionSql,sqliteA2aOriginalCellProjection,heldA2aOriginalCellProjectionSql } from './a2a-time-projection.mts';
import { SqliteAdapter } from '../../lib/db/sqlite-adapter';
import { issueSqliteSourceClaimChallenge,verifySqliteSourceClaim,bindSqliteSourceClaim,updateSqliteSourceClaimPolicy } from '../../lib/db/public-source-claims';
import type { Source } from '../../lib/types';
import type { SourceMeta } from '../../lib/db/keryx-db';
import type { SourceClaim,SourceClaimChallenge } from '../../lib/sources/public-source-claim';
import { projectRecordedEvidenceProvenance } from '../../lib/research/evidence-provenance';
import { captureObservedPaymentSource } from './payment-original-source.mts';
import { storageIdentityDigest } from '../../lib/db/storage-identity';
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
 let account:Awaited<ReturnType<typeof nativeAccountFixture>>['observation']|undefined,accountId:string|undefined;
 let chat:Awaited<ReturnType<typeof nativeChatFixture>>['observation']|undefined,chatTokenHashes:string[]=[];
 let publicProfile:Awaited<ReturnType<typeof nativePublicProfileFixture>>['observation']|undefined;
 let sourceClaims:{source:Source;meta:SourceMeta;claim:SourceClaim;challenge:SourceClaimChallenge}|undefined;const sourceClaimKeys:string[]=[];
 let queryReads:{projected:QueryRun;sourceHistory:unknown}|undefined;
 const paymentOriginals=input.ownerSql("SELECT (to_regclass('keryx_storage.payment_event_originals') IS NOT NULL)::integer;")==='1';
 const created=await createTopicWatch({store:{async read(){return null;},async compareAndSwap(_key,_revision,next){watch=next;return true;}},now:()=>now,isOwnerCurrent:wallet=>wallet===owner,metadata:{async read(){throw new Error('Synthetic native factory does not run metadata checks');}}},owner,{watchId:'synthetic-runtime-watch',question:'Synthetic metadata',keywords:['term'],authors:[],venues:[],cadenceMs:60000,periodMs:86400000,maximumChecksPerPeriod:4,maximumRowsPerCheck:32,maximumDigestItems:16,expiresAtMs:now+86400000,requestedCaps:{perCheckMicroUsdc:0,perPeriodMicroUsdc:0},consent:{manualMetadata:true,emptyHeartbeat:false}});
 assert.equal(created.status,'created');assert(watch);const watchWire=canonicalJson(watch);
 const run=(mode:string)=>{
  const name='keryx-postgres-runtime-'+randomUUID();containers.add(name);
  const startedAt=performance.now();process.stderr.write(JSON.stringify({fixtureMode:mode,event:'started'})+'\n');
  try{
   const wire=JSON.stringify({mode,identity:input.identity,digest:input.digest,password:input.password,key,owner,session,acceptance,account,chat,publicProfile,sourceClaims,queryReads});assert(Buffer.byteLength(wire)<=16384,'Native fixture input bound');
   const result=JSON.parse(docker(['run','-i','--rm','--name',name,'--user','0:0','--read-only','--memory','512m','--memory-swap','512m','--cpus','1','--pids-limit','64','--cap-drop','ALL','--security-opt','no-new-privileges',
    '--network','container:'+input.postgresContainer,'--tmpfs','/run/keryx-runtime:rw,nosuid,noexec,mode=0700,size=16m',
    '-e','KERYX_NETWORK=arc','-e','NEXT_PUBLIC_KERYX_NETWORK=arc','-e','KERYX_FORCE_OFFLINE=0','-e','BASE_URL=https://keryx.cc',
    '-e','KERYX_REGISTRY_ADDRESS=0x5555555555555555555555555555555555555555','-e','NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS=0x5555555555555555555555555555555555555555',
    candidateImage!,'node','--max-old-space-size=256','/child.cjs'],wire));
   assert.equal(result.passed,true);assert.equal(result.outbound,0);assert.equal(result.selectedApplicationWriter,false);vectors+=result.checks;process.stderr.write(JSON.stringify({fixtureMode:mode,event:'passed',checks:result.checks,elapsedMs:Math.round(performance.now()-startedAt)})+'\n');return result;
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
   const sourceId='synthetic-runtime-source',onchainId='0x'+'a1'.repeat(32),sourceUrl='https://synthetic-factory.invalid/source';
   selected.db.prepare('INSERT INTO sources(id,name,url,description,rss_url,wallet_address,fetch_price,tags,authors,created_at,onchain_id,evidence_provenance,preview_depth) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(sourceId,'Synthetic factory source',sourceUrl,'Current source metadata',sourceUrl+'/rss',owner,0.000007,'["synthetic"]',JSON.stringify([{name:'Synthetic owner',walletAddress:owner,splitWeight:1}]),'2026-01-02T03:04:05.000Z',onchainId,'synthetic-demo','locked');
   selected.db.prepare('INSERT INTO source_meta(id,name,description,url,rss_url,updated_at) VALUES(?,?,?,?,?,?)').run(onchainId,'Synthetic metadata','Current metadata description',sourceUrl,sourceUrl+'/rss','2026-01-02T03:04:05.000Z');
   const claimNow=Date.now()-3000,challenge=issueSqliteSourceClaimChallenge(selected.db,{wallet:owner,canonicalUrl:sourceUrl,rssUrl:sourceUrl+'/rss',deploymentOrigin:'https://keryx.cc',network:input.identity.network,now:claimNow}),verified=verifySqliteSourceClaim(selected.db,{challengeId:challenge.id,wallet:owner,proofDigest:'ad'.repeat(32),now:claimNow+1}),linked=bindSqliteSourceClaim(selected.db,{claimId:verified.id,wallet:owner,expectedRevision:1,sourceId,onchainId,registryAddress:'0x'+'88'.repeat(20),now:claimNow+2}),claim=updateSqliteSourceClaimPolicy(selected.db,{claimId:linked.id,wallet:owner,expectedRevision:2,mode:'free',distributionPermission:false,now:claimNow+3});
   const sourceOracle=SqliteAdapter.assembleConnectionCore(selected.db,input.identity,()=>{}),observedSource=await sourceOracle.getSource(sourceId),meta=await sourceOracle.getSourceMeta(onchainId);const retainedChallenge=await sourceOracle.getSourceClaimChallenge(challenge.id);assert(observedSource&&meta&&retainedChallenge);sourceClaims={source:observedSource,meta,claim,challenge:retainedChallenge};

   let seed=`INSERT INTO public.deliverable_acceptance_store(singleton,id) VALUES(1,${q(projection.storeId)});`;
   for(const table of ['a2a_orders','payment_events','research_purchase_authorizations','deliverable_acceptance_entries','sources','source_meta','sync_state'])for(const row of selected.db.prepare('SELECT * FROM '+table).all()){
    const keys=Object.keys(row);assert(keys.every(k=>/^[a-z][a-z0-9_]*$/.test(k)));
    seed+=`INSERT INTO public.${table}(${keys.join(',')}) VALUES(${keys.map(k=>{const v=row[k];if(v===null)return 'NULL';if(['settled','active','verified'].includes(k))return v===1?'true':'false';if(table==='sync_state'&&k==='key')sourceClaimKeys.push(String(v));if(typeof v==='number'||typeof v==='bigint')return String(v);assert(typeof v==='string');return q(v)+(table==='a2a_orders'&&['request_data','response_data','package_data','resolution_data'].includes(k)||table==='sources'&&['tags','authors'].includes(k)?'::jsonb':'');}).join(',')});`;
   }
   if(paymentOriginals)for(const row of selected.db.prepare('SELECT id FROM payment_events').all()){
    assert.equal(typeof row.id,'string');const captured=captureObservedPaymentSource(selected.db,row.id as string);assert(captured);
    const native=JSON.stringify({...captured.projection,settled:captured.projection.settled===1}),id=q(row.id as string);
    // The SOURCE capture, never a Native row, supplies all raw bytes/nullness.
    // Compare using the real Native row type so timestamp/boolean JSON is exact.
    seed+=`DO $payment_fixture$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.payment_events p CROSS JOIN jsonb_populate_record(NULL::public.payment_events,${q(native)}::jsonb) expected WHERE p.id=${id} AND to_jsonb(p) IS NOT DISTINCT FROM to_jsonb(expected)) THEN RAISE EXCEPTION 'native runtime Source payment projection differs';END IF;END;$payment_fixture$;
     INSERT INTO keryx_storage.payment_event_originals(payment_id,identity_digest,original_wire,original_sha256,current_wire,current_sha256,native_projection,unprojected_fields)
     SELECT p.id,${q(storageIdentityDigest(input.identity))},${q(captured.rowWire)}::json,${q(captured.sha256)},${q(captured.rowWire)}::json,${q(captured.sha256)},to_jsonb(expected),ARRAY[${captured.unprojectedFields.map(q).join(',')}]::text[] FROM public.payment_events p CROSS JOIN jsonb_populate_record(NULL::public.payment_events,${q(native)}::jsonb) expected WHERE p.id=${id};`;
   }
   pg(seed+heldA2aTimeProjectionSql(sqliteA2aTimeProjection(selected.db,order.id,input.identity))+heldA2aOriginalCellProjectionSql(sqliteA2aOriginalCellProjection(selected.db,order.id,input.identity))+heldAcceptanceProjectionSql(projection));
  }finally{selected.close();}
  for(const table of nativeAccountFixtureTables)assert.equal(input.ownerSql(`SELECT count(*) FROM public.${table};`),'0');
  const accountSeed=await nativeAccountFixture(folder,input.identity,session,{freshLogin:true});account=accountSeed.observation;accountId=accountSeed.accountId;pg(accountSeed.sql);
  for(const table of ['chat263_links','chat263_tokens'])assert.equal(input.ownerSql(`SELECT count(*) FROM public.${table};`),'0');
  const chatSeed=await nativeChatFixture(folder,input.identity,account.snapshot);chat=chatSeed.observation;chatTokenHashes=chatSeed.tokenHashes;pg(chatSeed.sql);
  const profileSeed=await nativePublicProfileFixture(folder,input.identity,session);publicProfile=profileSeed.observation;pg(profileSeed.sql);
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
  const original=JSON.stringify({id:'synthetic-runtime-run',parentId:'synthetic-runtime-parent',createdAt:'2026-01-02T03:04:05.000Z',question:'Original',answer:'Original answer',budget:0,engine:'heuristic',subClaims:[],decisions:[],citations:[{marker:'S1',sourceId:'synthetic-runtime-source',sourceName:'Fixture source A',weight:.5,reward:0,rationale:'Synthetic protocol only'},{marker:'S2',sourceId:'synthetic-runtime-item-source',sourceName:'Fixture source B',itemId:'synthetic-runtime-flagged-item',weight:.5,reward:0,rationale:'Synthetic protocol only'}],trace:[],asker:owner,totalSpent:0,totalToCreators:0,paymentMode:'offline',origin:'web',provenance:{version:1,surface:'web',ownershipMethod:'session'},usage:{version:1,network:'eip155:5042',cohort:'unknown',payment:'unknown',actorEvidenceSha256:null,fundingEvidenceSha256:null},uninterpreted:'\0\ud800'});
  const oracleConnection=openVerifiedSqliteStorage(acceptanceFile,input.identity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>assert.equal(canonicalJson(inspectStorageDeploymentManifest({KERYX_STORAGE_MANIFEST:acceptanceManifestPath})),acceptanceManifest)}),oracle=oracleConnection.db;let historyProjection:string,ownershipProjection:string,privacyProjection:string,runInsert:string;
  try{
   // A genuine SOURCE writer supplies every observed scalar independently of
   // PostgreSQL. Partial hand-made tables cannot attest missing/null cells.
   oracle.exec('BEGIN IMMEDIATE');
   oracle.prepare('INSERT INTO sources(id,name,url,description,wallet_address,fetch_price,tags,authors,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run('synthetic-runtime-item-source','Fixture source B','https://fixture-item.invalid/','Metadata only',owner,0,'[]','[]','2026-01-02T03:04:05.000Z');
   oracle.prepare('INSERT INTO source_items(id,source_id,title,link,published_at,summary,evidence_provenance) VALUES(?,?,?,?,?,?,?)').run('synthetic-runtime-flagged-item','synthetic-runtime-item-source','Fixture item','https://fixture-item.invalid/item','2026-01-02T03:04:05.000Z','Metadata only','synthetic-demo');
   writeSqliteQueryRun(oracle,JSON.parse(original) as QueryRun,false);
   oracle.prepare('UPDATE run_privacy SET visibility=? WHERE run_id=?').run('public','synthetic-runtime-run');
   const row=oracle.prepare('SELECT * FROM query_runs WHERE id=?').get('synthetic-runtime-run');assert(row);assert.equal(row.data,original);
   const scalar=sqlitePublicationScalarProjection(oracle,'synthetic-runtime-run'),keys=Object.keys(row);assert(keys.every(k=>/^[a-z][a-z0-9_]*$/.test(k)));
   runInsert=`INSERT INTO public.query_runs(${keys.join(',')}) VALUES(${keys.map(k=>{
    const observed=row[k];if(observed===null)return 'NULL';if(typeof observed==='number'){assert(Number.isFinite(observed));return String(observed);}if(typeof observed==='bigint')return String(observed);assert(typeof observed==='string');
    const shadow=k==='answer'?scalar.answerShadow:Object.hasOwn(scalar.shadows,k)?scalar.shadows[k]:observed;assert(typeof shadow==='string');return q(shadow)+(['data','economics_data'].includes(k)?'::json':'');
   }).join(',')});`;
   const policy=oracle.prepare('SELECT run_id,visibility,updated_at FROM run_privacy WHERE run_id=?').get('synthetic-runtime-run');assert(policy);assert.equal(policy.visibility,'public');
   // The native saved-run trigger inserts this row too; retain the actual
   // SOURCE policy/date rather than duplicating it or changing any fence.
   runInsert+=`INSERT INTO public.run_privacy(run_id,visibility,updated_at) VALUES(${q(String(policy.run_id))},${q(String(policy.visibility))},${q(String(policy.updated_at))}) ON CONFLICT(run_id) DO UPDATE SET visibility=excluded.visibility,updated_at=excluded.updated_at;`;
   historyProjection=heldHistoryProjectionSql('synthetic-runtime-run',sqliteOriginalHistoryProjection(oracle,'synthetic-runtime-run'));
   ownershipProjection=heldOwnershipHistoryProjectionSql('synthetic-runtime-run',sqliteOwnershipHistoryProjection(oracle,'synthetic-runtime-run'));
   privacyProjection=heldPrivacyProjectionSql('synthetic-runtime-run',sqlitePrivacyProjection(oracle,'synthetic-runtime-run'));oracle.exec('COMMIT');
  }finally{oracleConnection.close();}
  const sourceInput=JSON.stringify({format:'keryx-native-runtime-source-oracle-v1',manifestPath:acceptanceManifestPath,key,owner,original,identity:input.identity});assert(Buffer.byteLength(sourceInput)<=16384,'Synthetic Source oracle input bound');
  const sourceOutput=execFileSync(process.execPath,['--max-old-space-size=256','--import',new URL('../../node_modules/tsx/dist/loader.mjs',import.meta.url).href,fileURLToPath(new URL('./native-runtime-source-oracle.mts',import.meta.url))],{
   input:sourceInput,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:16384,stdio:['pipe','pipe','pipe'],env:{...process.env,TSX_DISABLE_CACHE:'1',TEMP:fixtureRoot,TMP:fixtureRoot,TMPDIR:fixtureRoot},
  });
  const observation=JSON.parse(sourceOutput);assert.equal(Object.keys(observation).sort().join(','),'format,identity,outbound,queryReads');assert.equal(observation.format,'keryx-native-runtime-source-oracle-v1');assert.equal(canonicalJson(validateStorageIdentity(observation.identity)),canonicalJson(input.identity));assert.equal(observation.outbound,0);
  assert.equal(Object.keys(observation.queryReads).sort().join(','),'projected,sourceHistory');queryReads=observation.queryReads;assert(queryReads);assert.equal(queryReads.projected.id,'synthetic-runtime-run');assert.notEqual(queryReads.projected.answer,'Original answer');assert(Array.isArray(queryReads.sourceHistory));assert.deepEqual(queryReads.sourceHistory.map(row=>row.id),['synthetic-runtime-run']);
  const sourceCopy=new DatabaseSync(acceptanceFile,{readOnly:true});try{sourceCopy.exec('PRAGMA query_only=ON');assert.equal(sourceCopy.prepare('SELECT data FROM query_runs WHERE id=?').get('synthetic-runtime-run')!.data,original);
   const expected=await projectRecordedEvidenceProvenance(async lookup=>{
    const flags=new Set<string>();for(const [table,ids]of [['sources',lookup.sourceIds],['source_items',lookup.itemIds]] as const)for(let offset=0;offset<ids.length;offset+=500){
     const batch=ids.slice(offset,offset+500);assert(batch.every(id=>id.length<=256));
     for(const row of sourceCopy.prepare(`SELECT id${table==='source_items'?',source_id':''} FROM ${table} WHERE evidence_provenance='synthetic-demo' AND id IN (${batch.map(()=>'?').join(',')})`).all(...batch))flags.add(table==='sources'?`source:${row.id}`:`item:${row.source_id}:${row.id}`);
    }return flags;
   },JSON.parse(original));assert.equal(canonicalJson(queryReads.projected),canonicalJson(expected));
   for(const table of ['sources','source_items'])for(const row of sourceCopy.prepare('SELECT * FROM '+table+(table==='sources'?" WHERE id='synthetic-runtime-item-source'":" WHERE id='synthetic-runtime-flagged-item'")).all()){const keys=Object.keys(row);runInsert+=`INSERT INTO public.${table}(${keys.join(',')}) VALUES(${keys.map(k=>{const v=row[k];if(v===null)return 'NULL';if(['active','verified'].includes(k))return v===1?'true':'false';if(typeof v==='number'||typeof v==='bigint')return String(v);assert(typeof v==='string');return q(v)+(table==='sources'&&['tags','authors'].includes(k)?'::jsonb':'');}).join(',')});`;}
  }finally{sourceCopy.close();}
  pg(runInsert+
   historyProjection+ownershipProjection+privacyProjection+`INSERT INTO public.cache_items(source_id,text) VALUES(${q(cacheId)},${q(envelope)});
   INSERT INTO public.private_bibliographies(id,wallet,token_hash,title,content,reference_count,revision,created_at,updated_at) VALUES(${q(bibliographyId)},${q(owner)},${q(createHash('sha256').update('keryx-private-bib-v1:'+bibliographyToken).digest('hex'))},'Synthetic bibliography','Synthetic bibliography content',0,1,'2026-01-02T03:04:05.000Z','2026-01-02T03:04:05.000Z');
   INSERT INTO public.web_sessions(hash,wallet,issued_at,expires_at) VALUES(${q(session.hash)},${q(owner)},${session.issuedAt},${session.expiresAt});
   INSERT INTO public.topic_watches(wallet,id,revision,state) VALUES(${q(owner)},'synthetic-runtime-watch',1,${q(watchWire)});`+heldWatchProjectionSql(topicWatchProjection(watchWire)));
  const baseline=input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),success=run('success');
  const publicProfilesPositive=run('public-profiles');assert.equal(publicProfilesPositive.publicProfilesPositiveProtocol,true);
  const ownerAssignmentsPositive=run('owner-assignments');assert.equal(ownerAssignmentsPositive.ownerAssignmentsPositiveProtocol,true);
  const remainingPositive=run('remaining-ports');assert.equal(remainingPositive.remainingPositiveProtocolsAndTerminalDrain,true);
  const queryPositive=run('query-readers');assert.equal(queryPositive.genuineFiveQueryReadersAndPrivacyProjection,true);
  for(const mode of ['held-during-provenance','credential-during-provenance','close-during-provenance','query-iterator-guards']){const observed=run(mode);assert.equal(mode==='query-iterator-guards'?observed.perYieldHeldCredentialAndCloseGuards:observed.committedProvenanceThenAuthorityChangeRefused,true);assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),baseline);}
  assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),baseline);
  for(const mode of ['wrong-identity','wrong-source','wrong-key','missing-key','wrong-credential-role']){run(mode);assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),baseline);}
  const withdrawnUsage=run('withdrawn-before-usage-body');assert.equal(withdrawnUsage.finalNativeBodyReadAfterAuthorityAwait,true);assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),baseline);
  const withdrawnLedger=run('withdrawn-before-ledger-read');assert.equal(withdrawnLedger.finalNativeLedgerReadAfterAuthorityAwait,true);assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),baseline);
  const withdrawnAcceptance=run('withdrawn-before-acceptance-read');assert.equal(withdrawnAcceptance.finalNativeAcceptanceReadAfterAuthorityAwait,true);assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),baseline);
  const withdrawnAccount=run('withdrawn-before-account-read');assert.equal(withdrawnAccount.finalNativeAccountReadAfterAuthorityAwait,true);assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),baseline);
  const withdrawnPublicProfile=run('withdrawn-before-public-profile-read');assert.equal(withdrawnPublicProfile.finalNativePublicProfileReadAfterAuthorityAwait,true);assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),baseline);
  const issuanceOff=run('claims-issuance-off');assert.equal(issuanceOff.retainedPublicProfilesAvailableWithIssuanceDisabled,true);assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),baseline);
  const profileOff=run('public-profiles-off');assert.equal(profileOff.publicProfilesDisabledAbsent,true);assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),baseline);
  const withdrawnChat=run('withdrawn-before-chat-read');assert.equal(withdrawnChat.finalNativeChatReadAfterAuthorityAwait,true);assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),baseline);
  const withdrawnOwnerAssignments=run('withdrawn-before-owner-assignment-reply');assert.equal(withdrawnOwnerAssignments.finalNativeAssignmentReplyAfterAllRequestAwaits,true);assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),baseline);
  const withdrawnAccountHistory=run('withdrawn-before-account-history');assert.equal(withdrawnAccountHistory.finalNativeHistoryReadAfterAllRequestAwaits,true);assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),baseline);
  const beforeCrypto=run('held-before-cache-crypto');assert.equal(beforeCrypto.asyncAuthorityBeforeCacheCrypto,true);assert(beforeCrypto.positiveControlDecryptionCalls>0);assert.equal(beforeCrypto.decipherCalls,0);assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),baseline);
  pg(`UPDATE public.cache_items SET text=${q(seal(cacheId,{...input.identity,storageId:randomUUID()}))} WHERE source_id=${q(cacheId)};`);run('foreign-cache-identity');
  pg(`UPDATE public.cache_items SET text=${q(seal(cacheId+'-foreign',input.identity))} WHERE source_id=${q(cacheId)};`);run('foreign-cache-source');
  pg(`UPDATE public.cache_items SET text='unbound legacy plaintext' WHERE source_id=${q(cacheId)};`);run('plaintext-cache');
  pg(`UPDATE public.cache_items SET text=repeat('x',2097153) WHERE source_id=${q(cacheId)};`);run('oversized-cache');
  // The complete successful facade/protocol assertions ran once across the bounded modes above. After cache
  // restoration, qualify a fresh cold factory/current reads/drain without
  // replaying every unchanged financial/history/permission assertion again.
  pg(`UPDATE public.cache_items SET text=${q(envelope)} WHERE source_id=${q(cacheId)};`);const restoredColdFactory=run('restored-cold-factory');assert.equal(restoredColdFactory.restoredAuthenticatedColdCache,true);assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),baseline);
  return {vectors,image,compiledDependenciesInOwnedImage:true,genuineLinuxCompiledFactory:true,actualPrivateFilePermissions:true,sourceAndIdentityPinned:true,cacheCiphertextAuthenticated:true,cacheSourceAndIdentityBound:true,asyncAuthorityBeforeCacheCrypto:true,actualCommittedColdReadThenAuthorityHold:true,heldBeforeCrypto:beforeCrypto,finalUsageBodyAfterAuthorityAwait:withdrawnUsage,finalLedgerReadAfterAuthorityAwait:withdrawnLedger,finalAcceptanceReadAfterAuthorityAwait:withdrawnAcceptance,finalAccountReadAfterAuthorityAwait:withdrawnAccount,finalChatReadAfterAuthorityAwait:withdrawnChat,finalPublicProfileReadAfterAuthorityAwait:withdrawnPublicProfile,publicProfilesDisabled:profileOff,publicProfilesWithClaimIssuanceDisabled:issuanceOff,finalAccountHistoryAfterAllRequestAwaits:withdrawnAccountHistory,missingAndWrongKeysRefused:true,plaintextAndOversizedCacheRefused:true,validColdFactoryRestored:true,restoredColdFactory,completeSuccessProtocolRunOnce:true,positiveProtocolsSplitWithoutTimeoutChange:true,ownerAssignmentsPositive,finalOwnerAssignmentReplyAfterAllRequestAwaits:withdrawnOwnerAssignments,publicProfilesPositive,remainingPositive,actualReaderConnectionsDrained:true,noFallback:true,observation:success,selectedApplicationWriter:false,productionData:false,paidOperations:0};
 }finally{
  for(const name of containers){try{docker(['rm','-f',name]);}catch{}}
  if(candidateImage){assert.equal(docker(['image','inspect',candidateImage,'--format','{{index .Config.Labels "keryx.native-runtime-fixture"}}']),staging);docker(['image','rm',candidateImage]);assert.equal(docker(['image','ls','-q','--filter','label=keryx.native-runtime-fixture='+staging]),'');}
  pg(`DELETE FROM public.cache_items WHERE source_id=${q(cacheId)};DELETE FROM public.query_runs WHERE id='synthetic-runtime-run';DELETE FROM keryx_storage.topic_watch_projection WHERE wallet=${q(owner)} AND id='synthetic-runtime-watch';DELETE FROM public.topic_watches WHERE wallet=${q(owner)} AND id='synthetic-runtime-watch';DELETE FROM public.private_bibliographies WHERE id=${q(bibliographyId)};DELETE FROM public.web_sessions WHERE wallet=${q(owner)};`);
  pg(`DELETE FROM public.source_items WHERE id='synthetic-runtime-flagged-item';DELETE FROM public.sources WHERE id IN('synthetic-runtime-source','synthetic-runtime-item-source');DELETE FROM public.source_meta WHERE id='0x${'a1'.repeat(32)}';DELETE FROM public.sync_state WHERE key IN(${sourceClaimKeys.length?sourceClaimKeys.map(q).join(','):"''"});`);
  // Only this fixture's one generated bundle, then its empty unique directory.
  assert.equal(realpathSync(folder).toLowerCase(),resolve(folder).toLowerCase());assert.equal(dirname(folder).toLowerCase(),resolve(fixtureRoot).toLowerCase());
  pg(`DELETE FROM keryx_storage.a2a_original_time_projection WHERE order_id=${q(acceptanceFixture.order.id)};`);
  pg(`DELETE FROM public.deliverable_acceptance_entries WHERE original_id=${q(acceptanceFixture.order.id)};DELETE FROM public.payment_events WHERE query_id=${q(acceptanceFixture.order.id)};`+(paymentOriginals?`DELETE FROM keryx_storage.payment_event_originals WHERE payment_id=${q('inbound_'+acceptanceFixture.order.id)};`:'')+`DELETE FROM public.research_purchase_authorizations WHERE purchase_id=${q(acceptanceFixture.order.id)};DELETE FROM public.a2a_orders WHERE id=${q(acceptanceFixture.order.id)};`+(acceptanceStoreId?`DELETE FROM public.deliverable_acceptance_store WHERE id=${q(acceptanceStoreId)};`:''));
  if(accountId)pg(nativeAccountFixtureTables.map(table=>table==='account267_challenges'?`DELETE FROM public.${table} WHERE session_hash=${q(session.hash)};`:`DELETE FROM public.${table} WHERE account_id=${q(accountId!)};`).join(''));
  pg(`DELETE FROM public.public_researcher_profiles WHERE wallet=${q(owner)};DELETE FROM public.private_profiles WHERE wallet=${q(owner)};DELETE FROM public.chat263_links WHERE wallet=${q(owner)};DELETE FROM public.chat263_tokens WHERE token_hash IN(${chatTokenHashes.length?chatTokenHashes.map(q).join(','):"''"});`);
  for(const path of [bundle,acceptanceFile,acceptanceFile+'-wal',acceptanceFile+'-shm',acceptanceFile+'-journal',acceptanceManifestPath,...nativeAccountFixturePaths(folder)])try{unlinkSync(path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}rmdirSync(folder);
 }
}
