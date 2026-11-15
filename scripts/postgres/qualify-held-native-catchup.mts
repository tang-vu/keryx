/** Finite synthetic preparation. Default CLI never connects to PostgreSQL.
 * Root installs this exact Source baseline with the existing public + twelve
 * derivative materializers before scheduling the exported actual protocol. */
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { chmodSync,copyFileSync,readFileSync,readdirSync,rmdirSync,unlinkSync } from 'node:fs';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { HeldNativeCatchupRequest } from './apply-held-native-catchup.mts';

const owners=new WeakMap<object,{folder:string;spool:string}>(); // Cleanup only, never storage provenance.
const sha=(wire:string|Buffer)=>createHash('sha256').update(wire).digest('hex');
/** Caller must initialize a fresh spending-free Arc child BEFORE Keryx imports. */
export async function prepareHeldCatchupSynthetic(){
 assert.equal(process.versions.node,'24.22.1');assert.equal(process.env.KERYX_NETWORK,'arc');assert.equal(process.env.KERYX_FORCE_OFFLINE,'0');
 for(const key of ['AGENT_FUNDER_PRIVATE_KEY','BUYER_PRIVATE_KEY','DEPLOYER_PRIVATE_KEY','KERYX_PRIVATE_TREASURY_PRIVATE_KEY'])assert(!process.env[key]);
 const {canonicalJson}=await import('../../lib/canonical-json');
 const {installMainnetApplicationSchema}=await import('../../lib/db/mainnet-application-schema');
 const {installNativeUserDomainSchema}=await import('../../lib/db/native-user-domain-schema');
 const {insertStorageIdentity,installStorageFences,registerStorageCapability}=await import('../../lib/db/storage-identity-sqlite');
 const {validateStorageIdentity,STORAGE_MAINNET_PROFILE_DIGEST}=await import('../../lib/db/storage-identity');
 const {writeSqliteQueryRun}=await import('../../lib/db/query-run-record');
 const {nativeMaterializationProfile}=await import('../../lib/db/postgres/runtime-profile');
 const {inspectTypedDeltaSnapshot}=await import('./typed-snapshot-delta.mts');
 const {prepareHeldNativeCatchupInput}=await import('./held-native-catchup-input.mts');
 const {privateHeadlessTestDirectory}=await import('../helpers/headless-state-test-fixture');
 const folder=privateHeadlessTestDirectory(),beforePath=join(folder,'before.sqlite'),afterPath=join(folder,'after.sqlite');let spool:string|undefined;
 const identity=validateStorageIdentity({format:'keryx-mainnet-storage-identity-v1',deploymentId:randomUUID(),storageId:randomUUID(),network:'eip155:5042',authorityMode:'mainnet-real',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,enrollmentId:randomUUID(),enrolledAt:'2026-10-01T00:00:00.000Z',provenanceDigest:'a'.repeat(64)});
 const run=(id:string,answer:string)=>({id,createdAt:'2026-11-15T00:00:00.000Z',question:'Synthetic Source\0question',answer,engine:'heuristic' as const,budget:1,totalSpent:0.1,totalToCreators:0.05,subClaims:[],decisions:[],citations:[],trace:[{raw:'\ud800\0\udfff'}] as never,paymentMode:'offline' as const});
 try{
  const db=new DatabaseSync(beforePath);try{db.exec('PRAGMA journal_mode=DELETE;BEGIN');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);
   writeSqliteQueryRun(db,run('synthetic-catchup-a','Before\0\ud800'),false);
   db.prepare('INSERT INTO sources(id,name,url) VALUES(?,?,?)').run('synthetic-catchup-source','Synthetic Source','https://synthetic.invalid/feed');
   db.prepare('INSERT INTO article_offers VALUES(?,?,?,?,?,?,?,?,?,?)').run('synthetic-catchup-source','synthetic-item','synthetic-offer','a'.repeat(64),1,1800000000,'0x'+'ab'.repeat(20),'0x'+'12'.repeat(32),'0x'+'cd'.repeat(65),'2026-11-15T00:00:00.000Z');
   insertStorageIdentity(db,identity);installStorageFences(db,identity);db.exec('COMMIT');
  }finally{db.close();}chmodSync(beforePath,0o600);copyFileSync(beforePath,afterPath);chmodSync(afterPath,0o600);
  const owner=new DatabaseSync(afterPath);try{registerStorageCapability(owner,identity,()=>true);owner.exec('BEGIN');
   writeSqliteQueryRun(owner,run('synthetic-catchup-a','After\0\udfff'),true);writeSqliteQueryRun(owner,run('synthetic-catchup-b','New Source answer'),false);
   owner.exec('UPDATE article_offers SET rowid=71');owner.exec('COMMIT');
  }finally{owner.close();}
  const before={path:beforePath,sha256:sha(readFileSync(beforePath))},after={path:afterPath,sha256:sha(readFileSync(afterPath))},inventory=await inspectTypedDeltaSnapshot(before);
  const prior=canonicalJson({format:'keryx-native-held-data-baseline-metadata-v1',profileMode:'development-current510-data-only',catalogSha256:nativeMaterializationProfile('development-current510-data-only').catalogSha256,targetState:'held',sequence:0,snapshotSha256:before.sha256,schemaSha256:inventory.schemaSha256,identityDigest:inventory.identityDigest,dataDigest:inventory.dataDigest});
  const source={delta:{before,after,priorTarget:{wire:prior,expectedSha256:sha(prior)}},spoolDirectory:folder},sealed=await prepareHeldNativeCatchupInput(source);spool=dirname(sealed.path);
  assert.equal(sealed.completion.delta.tables,94);assert(sealed.completion.delta.changes>0);assert.equal(sealed.completion.affectedOfferOrders,1);assert.equal(sealed.completion.holds.length,0);
  assert.equal(sha(readFileSync(beforePath)),before.sha256);assert.equal(sha(readFileSync(afterPath)),after.sha256);
  const result={source,sealed:{path:sealed.path,sha256:sealed.sha256},identity,summary:{format:'keryx-held-native-catchup-synthetic-preparation-v1',sourceTables:94,typedChanges:sealed.completion.delta.changes,affectedProjectionPackets:sealed.completion.affectedProjectionPackets,affectedOfferOrders:sealed.completion.affectedOfferOrders,spoolBytes:sealed.bytes,targetVerified:false,actualPostgresQualified:false,kernelContainmentQualified:false,nativeFactoryQualified:false,briefCutoverQualified:false,targetWrites:0,paymentActions:0,jobActions:0}};
  owners.set(result,{folder,spool});return result;
 }catch(error){if(spool){for(const leaf of readdirSync(spool))unlinkSync(join(spool,leaf));rmdirSync(spool);}for(const leaf of readdirSync(folder))unlinkSync(join(folder,leaf));rmdirSync(folder);throw error;}
}
export function disposeHeldCatchupSynthetic(fixture:Awaited<ReturnType<typeof prepareHeldCatchupSynthetic>>){
 const owned=owners.get(fixture);assert(owned,'Only the creator disposes its synthetic fixture');owners.delete(fixture);
 for(const leaf of readdirSync(owned.spool))unlinkSync(join(owned.spool,leaf));rmdirSync(owned.spool);for(const leaf of readdirSync(owned.folder))unlinkSync(join(owned.folder,leaf));rmdirSync(owned.folder);
}
/** Root must establish the exact fixture baseline first; no target setup,
 * repair/adoption or SQL callback is accepted here. */
export async function qualifyHeldNativeCatchup(input:Readonly<{fixture:Awaited<ReturnType<typeof prepareHeldCatchupSynthetic>>;options:HeldNativeCatchupRequest['options'];referenceWire:string}>){
 assert.equal(process.platform,'linux');assert.equal(readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),'536870912');assert.equal(readFileSync('/sys/fs/cgroup/memory.swap.max','utf8').trim(),'0');assert.equal(readFileSync('/sys/fs/cgroup/pids.max','utf8').trim(),'32');
 assert(/^NoNewPrivs:\s+1$/m.test(readFileSync('/proc/self/status','utf8')));assert.equal(readFileSync('/proc/net/route','utf8').trim().split('\n').length,1);
 const owned=owners.get(input.fixture);assert(owned,'Contention qualifies only this module\'s owned fresh synthetic fixture');
 assert.equal(input.fixture.source.delta.before.path,join(owned.folder,'before.sqlite'));
 assert.equal(input.options.role,'postgres');assert.equal(input.options.database,'native_materialized');assert.deepEqual(input.options.endpoint,{kind:'loopback',port:5432});assert(/^[a-f0-9]{48}$/.test(input.options.password));
 const {applyHeldNativeCatchup,HeldNativeCatchupRefused}=await import('./apply-held-native-catchup.mts');
 const {Client}=await import('pg'),{postgresPoolConfiguration}=await import('../../lib/db/postgres/connection');
 const sourceId='synthetic-catchup-source',driftName='Synthetic held-CAS concurrent owner drift';
 assert.equal(sha(readFileSync(input.fixture.source.delta.before.path)),input.fixture.source.delta.before.sha256);
 const source=new DatabaseSync(input.fixture.source.delta.before.path,{readOnly:true,allowExtension:false});let originalName:string;
 try{source.exec('PRAGMA query_only=ON;BEGIN');const row=source.prepare('SELECT name FROM sources WHERE id=?').get(sourceId);assert(row&&typeof row.name==='string');originalName=row.name;}
 finally{try{if(source.isTransaction)source.exec('ROLLBACK');}finally{source.close();}}
 assert.notEqual(originalName,driftName);
 const holder=new Client(postgresPoolConfiguration(input.options));holder.on('error',()=>{});
 let transaction=false,driftOwned=false,refusalQualified=false,waitWitnessMs=0;
 let pending:Promise<{ok:true;value:Awaited<ReturnType<typeof applyHeldNativeCatchup>>}|{ok:false;error:unknown}>|undefined;
 const restoreName=async()=>{
  if(!driftOwned)return;
  await holder.query('BEGIN');transaction=true;await holder.query('LOCK TABLE public.sources IN SHARE ROW EXCLUSIVE MODE');
  assert.equal((await holder.query('SELECT mode FROM keryx_storage.control WHERE singleton')).rows[0]?.mode,'held');
  const current=await holder.query('SELECT name FROM public.sources WHERE id=$1 FOR UPDATE',[sourceId]);assert.equal(current.rowCount,1);
  if(current.rows[0].name===driftName)assert.equal((await holder.query('UPDATE public.sources SET name=$1 WHERE id=$2 AND name IS NOT DISTINCT FROM $3',[originalName,sourceId,driftName])).rowCount,1);
  else assert.equal(current.rows[0].name,originalName);
  await holder.query('COMMIT');transaction=false;driftOwned=false;
  assert.equal((await holder.query('SELECT name FROM public.sources WHERE id=$1',[sourceId])).rows[0]?.name,originalName);
 };
 try{
  await holder.connect();await holder.query('BEGIN');transaction=true;
  await holder.query('LOCK TABLE public.sources IN SHARE ROW EXCLUSIVE MODE');
  assert.equal((await holder.query('SELECT name FROM public.sources WHERE id=$1',[sourceId])).rows[0]?.name,originalName);
  pending=applyHeldNativeCatchup({source:input.fixture.source,sealed:input.fixture.sealed,options:input.options,referenceWire:input.referenceWire}).then(value=>({ok:true as const,value}),error=>({ok:false as const,error}));
  const started=performance.now();let witness=false;
  while(performance.now()-started<4000){
   await holder.query('SELECT pg_stat_clear_snapshot()');
   const waiting=await holder.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND usename='postgres' AND application_name='keryx-postgres-guarded' AND wait_event_type='Lock' AND query LIKE 'LOCK TABLE %' AND pg_backend_pid()=ANY(pg_blocking_pids(pid))");
   if(waiting.rowCount===1){witness=true;waitWitnessMs=Math.ceil(performance.now()-started);break;}
   assert.equal(waiting.rowCount,0);await new Promise<void>(done=>setTimeout(done,25));
  }
  assert(witness,'Actual catchup table-lock wait was not observed');
  assert.equal((await holder.query('UPDATE public.sources SET name=$1 WHERE id=$2 AND name IS NOT DISTINCT FROM $3',[driftName,sourceId,originalName])).rowCount,1);driftOwned=true;
  await holder.query('COMMIT');transaction=false;
  const refused=await pending;assert.equal(refused.ok,false,'Unrelated owner drift must not receive an applied receipt');
  assert(!refused.ok&&refused.error instanceof HeldNativeCatchupRefused);assert.equal(refused.error.stage,'before-state');assert.equal(refused.error.commitOutcome,'not_attempted');refusalQualified=true;
 }finally{
  // Release the real blocker before draining the admitted applier. Restore only
  // the one exact owned synthetic field; all other target data stays for teardown.
  try{if(transaction){await holder.query('ROLLBACK');transaction=false;}}
  finally{try{if(pending)await pending;}finally{try{await restoreName();}finally{try{if(transaction)await holder.query('ROLLBACK');}finally{await holder.end();}}}}
 }
 assert(refusalQualified);
 // This independent positive call rechecks the entire old public/twelve-sidecar
 // census, proving the failed negative phase left zero delta mutations behind.
 const result=await applyHeldNativeCatchup({source:input.fixture.source,sealed:input.fixture.sealed,options:input.options,referenceWire:input.referenceWire});assert.equal(result.outcome,'applied');assert.equal(result.targetVerified,false);assert.equal(result.nativeFactoryQualified,false);
 return {format:'keryx-held-native-catchup-synthetic-protocol-v1',passed:true,dataProtocolOnly:true,kernelContainmentObserved:true,actualOwnerContentionRefusalQualified:true,actualLockWaitWitnessObserved:true,ownedSourceNameRestoredExactly:true,negativeDeltaWrites:0,waitWitnessMs,result};
}
async function main(){
 assert.deepEqual(process.argv.slice(2),['--synthetic-preparation-only']);
 process.env.KERYX_NETWORK='arc';process.env.NEXT_PUBLIC_KERYX_NETWORK='arc';process.env.KERYX_FORCE_OFFLINE='0';
 for(const key of ['KERYX_REGISTRY_ADDRESS','NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS','KERYX_REGISTRY_READ_ADDRESS','NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS'])process.env[key]='0x'+'ef'.repeat(20);
 for(const key of ['AGENT_FUNDER_PRIVATE_KEY','BUYER_PRIVATE_KEY','DEPLOYER_PRIVATE_KEY','KERYX_PRIVATE_TREASURY_PRIVATE_KEY','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','CONTENT_MASTER_KEY','KERYX_REGISTRY_ORIGINS','NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS'])process.env[key]='';
 for(const key of ['KERYX_STORAGE_MANIFEST','KERYX_SQLITE_PATH','KERYX_USDC_ADDRESS','KERYX_GATEWAY_WALLET','KERYX_GATEWAY_MINTER','KERYX_MAX_TIMEOUT_SECONDS'])delete process.env[key];
 let outbound=0;globalThis.fetch=(()=>{outbound++;throw Error('Synthetic Source forbids outbound I/O');}) as typeof fetch;
 let fixture:Awaited<ReturnType<typeof prepareHeldCatchupSynthetic>>|undefined;try{fixture=await prepareHeldCatchupSynthetic();assert.equal(outbound,0);process.stdout.write(JSON.stringify({...fixture.summary,outboundCalls:outbound,inputsUnchanged:true})+'\n');}finally{if(fixture)disposeHeldCatchupSynthetic(fixture);}
}
if(typeof import.meta.url==='string'&&process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{process.stderr.write('Synthetic held catchup preparation refused\n');process.exitCode=1;});
