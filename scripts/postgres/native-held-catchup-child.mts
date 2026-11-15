/** Contained synthetic HELD baseline + CAS protocol. No retained input,
 * application activation, cold-factory acceptance or cutover authority. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream,readFileSync,readlinkSync,readSync,realpathSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
let stage='containment';
async function main(){
 assert.equal(process.platform,'linux');assert.equal(process.version,'v24.22.1');assert.equal(process.getuid!(),0);assert.equal(process.ppid,1);assert.deepEqual(process.argv.slice(2),['--materialize']);
 const kernel=(name:string)=>readFileSync('/sys/fs/cgroup/'+name,'utf8').trim(),limits={memoryMax:kernel('memory.max'),swapMax:kernel('memory.swap.max'),cpuMax:kernel('cpu.max'),pidsMax:kernel('pids.max')};
 assert.deepEqual(limits,{memoryMax:'536870912',swapMax:'0',cpuMax:'25000 100000',pidsMax:'32'});
 const status=readFileSync('/proc/self/status','utf8');assert(/^NoNewPrivs:\s+1$/m.test(status)&&/^CapEff:\s+0+$/m.test(status));assert.equal(readFileSync('/proc/net/route','utf8').trim().split('\n').length,1);assert.equal(readlinkSync('/proc/1/exe'),'/usr/bin/timeout');
 assert.deepEqual(readFileSync('/proc/1/cmdline','utf8').split('\0').filter(Boolean),['/usr/bin/timeout','--signal=KILL','1800s','node','--no-warnings','--max-old-space-size=256','/child.cjs','--materialize']);
 const mounts=readFileSync('/proc/self/mountinfo','utf8').trim().split('\n').map(s=>s.split(' '));assert(mounts.some(p=>p[4]==='/'&&p[5].split(',').includes('ro')));assert(!mounts.some(p=>p[4]==='/input/snapshot.sqlite'));
 const buffer=Buffer.alloc(8388609);let bytes=0;for(;;){const n=readSync(0,buffer,bytes,buffer.length-bytes,null);if(!n)break;bytes+=n;assert(bytes<buffer.length);}
 const packet=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(buffer.subarray(0,bytes))) as {mode:string;password:string;referenceWire:string;key:string;profileMode:string};buffer.fill(0);
 assert.deepEqual(Object.keys(packet).sort(),['key','mode','password','profileMode','referenceWire']);assert.equal(packet.mode,'held-catchup-synthetic');assert.equal(packet.profileMode,'development-current510-data-only');assert(/^[a-f0-9]{48}$/.test(packet.password));assert(/^[a-f0-9]{64}$/.test(packet.key));packet.key='';
 // Docker initializes Arc before module evaluation. Neither a sticky profile
 // override nor an inherited spending key can enter this synthetic Source.
 assert.equal(process.env.KERYX_NETWORK,'arc');assert.equal(process.env.NEXT_PUBLIC_KERYX_NETWORK,'arc');assert.equal(process.env.KERYX_FORCE_OFFLINE,'0');
 for(const name of ['AGENT_PRIVATE_KEY','TREASURY_PRIVATE_KEY','KERYX_TREASURY_PRIVATE_KEY','SIGNER_PRIVATE_KEY','PRIVATE_KEY','AGENT_FUNDER_PRIVATE_KEY','BUYER_PRIVATE_KEY','DEPLOYER_PRIVATE_KEY','KERYX_PRIVATE_TREASURY_PRIVATE_KEY'])assert(!process.env[name]);
 process.env.TMPDIR='/run/keryx-intake';process.env.TEMP='/run/keryx-intake';process.env.TMP='/run/keryx-intake';
 let outbound=0;globalThis.fetch=async()=>{outbound++;throw Error('Synthetic catchup forbids provider HTTP');};
 stage='source-imports';const {prepareHeldCatchupSynthetic,qualifyHeldNativeCatchup,disposeHeldCatchupSynthetic}=await import('./qualify-held-native-catchup.mts');
 const {rehearseSqliteSnapshot}=await import('./rehearse-snapshot.mts');
 const {materializeNativeSnapshot}=await import('./materialize-native-snapshot.mts');
 const {materializeNativeProjections}=await import('./materialize-native-projections.mts');
 const {configureSnapshotConnection,checkSnapshotSidecars}=await import('../../lib/db/storage-provenance-snapshot');
 const {OFFLINE_SNAPSHOT_LIMITS}=await import('../../lib/db/storage-provenance');
 const {nativeMaterializationProfile}=await import('../../lib/db/postgres/runtime-profile');
 const {exportNativePostgresSchemaContract}=await import('./native-contract.mts');
 const {Client}=await import('pg');const {postgresPoolConfiguration}=await import('../../lib/db/postgres/connection');
 const profileMode='development-current510-data-only' as const,profile=nativeMaterializationProfile(profileMode);assert.equal(exportNativePostgresSchemaContract(packet.referenceWire).sha256,profile.catalogSha256);
 stage='synthetic-source';const fixture=await prepareHeldCatchupSynthetic();let source:DatabaseSync|undefined;
 const hash=async(path:string)=>{const digest=createHash('sha256');for await(const chunk of createReadStream(path))digest.update(chunk);return digest.digest('hex');};
 const options={endpoint:{kind:'loopback' as const,port:5432},database:'native_materialized',role:'postgres',password:packet.password};
 try{
  // Only the fresh BEFORE baseline uses the existing staging/intake writers.
  // The later applier receives no baseline DDL, GUC or writer-token callback.
  const path=fixture.source.delta.before.path;assert(path.startsWith('/run/keryx-intake/'));assert.equal(realpathSync(path),path);checkSnapshotSidecars(path);assert.equal(await hash(path),fixture.source.delta.before.sha256);
  source=new DatabaseSync(path,{readOnly:true,allowExtension:false,timeout:1000});configureSnapshotConnection(source,OFFLINE_SNAPSHOT_LIMITS);source.exec('BEGIN');
  stage='typed-before-baseline';const staging=await rehearseSqliteSnapshot(source,{...options,database:'native_staging'});assert(staging.verified);assert.equal(staging.tables.length,94);
  stage='public-before-baseline';const materialization=await materializeNativeSnapshot(source,options,packet.referenceWire,profileMode);
  stage='twelve-before-projections';const projections=await materializeNativeProjections(source,options,profileMode);assert.equal(projections.domains.length,12);
  source.exec('ROLLBACK');source.close();source=undefined;
  stage='held-cas-owner-contention-and-positive';const catchup=await qualifyHeldNativeCatchup({fixture,options,referenceWire:packet.referenceWire});
  assert(catchup.passed&&catchup.actualOwnerContentionRefusalQualified&&catchup.actualLockWaitWitnessObserved&&catchup.ownedSourceNameRestoredExactly);assert.equal(catchup.negativeDeltaWrites,0);assert.equal(catchup.result.outcome,'applied');assert.equal(catchup.result.targetVerified,false);assert.equal(catchup.result.nativeFactoryQualified,false);assert.equal(catchup.result.briefCutoverQualified,false);
  stage='held-target-and-drain';const check=new Client(postgresPoolConfiguration(options));check.on('error',()=>{});
  try{await check.connect();assert.equal((await check.query('SELECT mode FROM keryx_storage.control WHERE singleton')).rows[0]?.mode,'held');
   assert.equal((await check.query("SELECT count(*)::text n FROM pg_stat_activity WHERE usename IN('keryx_app','keryx_reader')")).rows[0].n,'0');
   assert.equal((await check.query("SELECT count(*)::text n FROM pg_stat_activity WHERE application_name='keryx-postgres-guarded' AND pid<>pg_backend_pid()")).rows[0].n,'0');
   for(const name of ['keryx_storage.writer','public.browser_journal_writer','public.browser_signing_v2_writer','public.browser_signing_v3_writer'])assert.equal((await check.query('SELECT count(*)::text n FROM '+name)).rows[0].n,'0');
  }finally{await check.end();}
  assert.equal(await hash(fixture.source.delta.before.path),fixture.source.delta.before.sha256);assert.equal(await hash(fixture.source.delta.after.path),fixture.source.delta.after.sha256);assert.equal(outbound,0);
  console.log(JSON.stringify({format:'keryx-native-held-catchup-synthetic-rehearsal-v1',passed:true,mode:packet.mode,profileMode,heldCatchupOnly:true,dataIntakeOnly:true,genuineColdFactoryQualified:false,nativeFactoryQualified:false,briefCutoverQualified:false,preparation:fixture.summary,staging,materialization,projections,catchup,limits,outbound,sourceUnchanged:true,isolatedTargetReturnedHeld:true,actualApplicationConnectionsDrained:true,actualOwnerConnectionsDrained:true,hardDeadlineSeconds:1800,retainedProductionSnapshotRead:false,liveProductionRead:false,productionChanged:false,applicationBackendSwitched:false,paymentActions:0,jobActions:0}));
 }finally{try{source?.close();}finally{disposeHeldCatchupSynthetic(fixture);}}
}
void main().catch((error:unknown)=>{
 const raw=error&&typeof error==='object'?Reflect.get(error,'diagnostic'):null,diagnostic:Record<string,string|null>={};
 if(raw&&typeof raw==='object')for(const name of ['stage','table','pgCode','constraint','column','commitOutcome']){const value=Reflect.get(raw,name);if(value===null||typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value))diagnostic[name]=value;}
 const phase=error&&typeof error==='object'?Reflect.get(error,'commitOutcome'):null,innerStage=error&&typeof error==='object'?Reflect.get(error,'stage'):null;
 console.log(JSON.stringify({format:'keryx-native-held-catchup-synthetic-rehearsal-v1',passed:false,reason:'held_catchup_synthetic_unavailable',stage,errorClass:error instanceof Error?error.constructor.name:'unknown',...(Object.keys(diagnostic).length?{diagnostic}:{}),...(['acknowledged','unknown','not_attempted'].includes(phase)?{commitOutcome:phase}:{}),...(typeof innerStage==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(innerStage)?{innerStage}:{}),heldCatchupOnly:true,genuineColdFactoryQualified:false,nativeFactoryQualified:false,briefCutoverQualified:false,productionChanged:false,applicationBackendSwitched:false}));process.exitCode=1;
});
