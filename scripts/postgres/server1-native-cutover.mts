/** Fixed server1 protected-data cutover; five closed sync rows, two bounded operational tables and paired encrypted upkeep additions retain exact B1 cells.
 * No caller target/handle/callback,
 * provenance issuer, generic catchup, funding, policy renewal or automatic rollback.
 * Production invocation requires separate Root release authorization. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {closeSync,constants,createReadStream,existsSync,fstatSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,readSync,readdirSync,realpathSync,renameSync,writeSync,type BigIntStats} from 'node:fs';
import {dirname,join,parse,relative,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseEnv} from 'node:util';
import {createRequire} from 'node:module';
import {hostname} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {Client,types} from 'pg';
import {canonicalJson} from '../../lib/canonical-json';
import {storageIdentityDigest,validateStorageIdentity,type StorageIdentity} from '../../lib/db/storage-identity';
import {readStorageIdentity} from '../../lib/db/storage-identity-sqlite';
import {checkSnapshotSidecars,configureSnapshotConnection,validateSnapshotHeader} from '../../lib/db/storage-provenance-snapshot';
import {OFFLINE_SNAPSHOT_LIMITS} from '../../lib/db/storage-provenance';
import {parsePlannedWindow,readWindowControl,maintenanceStatus} from '../../lib/maintenance/planned-window';
import {exportNativePostgresSchemaContract} from './native-contract.mts';
import {snapshotRows,snapshotRowWire,snapshotTables,type SnapshotRow,type SnapshotValue} from './typed-snapshot.mts';
import {nativeMaterializationCell,nativeMaterializationValueKey} from './native-materialization-codec.mts';
import {sourceRegistryAuthoritySchema} from '../../lib/registry/source-registry-authority-schema';
import {createOwnerSessionHeartbeat} from './owner-session-heartbeat.mts';
import {assertServer1PlatformCurrent} from './server1-platform-compatibility.mts';

const root='/root/keryx-migration',archive='/root/.local/share/keryx-private-release-archives/postgres-mainnet-cutover-20261116';
export const SERVER1_CUTOVER=Object.freeze({
 archive,intent:archive+'/intent.json',roles:archive+'/roles.json',review:archive+'/compatibility-review.json',
 environment:archive+'/runtime.env',manifest:archive+'/storage.json',expected:archive+'/native-cutover.expected.json',receipt:archive+'/native-cutover.json',
 dropin:archive+'/native-boot.service.conf',journal:archive+'/cutover.jsonl',finalSnapshot:archive+'/final-source.sqlite',
 baseline:root+'/postgres-b0/baseline.json',snapshot:root+'/postgres-b0/source.sqlite',sourceSql:root+'/postgres-b0/source.sql',
 preparation:root+'/postgres17-server1-preparation.json',held:root+'/postgres17-server1-held-target.json',
 activeEnvironment:'/root/keryx/.env.local',activeManifest:'/root/.local/share/keryx-mainnet-runtime/production-v2/storage.json',
 oldBootstrap:root+'/bootstrap.mjs',transfer:root+'/authority-transfer.json',snapshotChild:root+'/create-online-snapshot-child.cjs',
 bundle:root+'/server1-native-cutover.cjs',maintenance:'/root/.local/share/keryx-maintenance-front-door',
 bootUnit:'/etc/systemd/system/keryx-public-roles.service',bootDropin:'/etc/systemd/system/keryx-public-roles.service.d/30-native-postgres.conf',
 runtimeHba:root+'/postgres17-server1-runtime.pg_hba.conf',activeHba:'/etc/postgresql/17/keryx/pg_hba.conf',
 sourceCommit:'3654cf66bd3541a90d9c621eb72d57556e306dd6',sourceSqlSha256:'cc15c6b020b5b838eef62f7f247bec9943567cbc66dfc6359cddd599d65b848c',
 catalogSha256:'d368c98db910ff072d10d7c2a20ba3b8b2934e4f5f76c0afdd875ebfda07803f',publicPolicySha256:'c70be6ac6ca452b15ef1a8caac96654aa181a025ed0638b8e138569c7b62f422',
 oldBootstrapSha256:'54cc1f65bff697ec0ba90aab02fb1b2547c200a014195b11cc1e052ca9e48dbb',transferSha256:'e9212277066c6774ea5959914823ce59125892ed1da9706725a50597e56ddb68',
 bootUnitSha256:'32a638fbcafe28cb4b950de63257d7f39c2a310e61cd1ce9686e33db5e089125',
 immutableInspectorSha256:'f563d99e557aa4d957778dd4667f07c8998ea3c133984c1ad0a8e718df688bc8',
});
const sourceMode='development-current510-data-only' as const,socket='/run/postgresql-keryx';
const immutableInspector='/root/.local/share/keryx-releases/'+SERVER1_CUTOVER.sourceCommit+'/source/scripts/immutable-release-staging.mjs';
export const SERVER1_CHECKPOINT_KEYS=Object.freeze([
 'keryx:registry-index:v1:eip155:5042:0x2217250019ab614dae7391d346d05c3fc4d71ae1:3:0xc915aed2667848d7a52af54c6202940116145dca6f7dbb8a9c58ce8335740fb9:lastSyncedBlock',
 'keryx:registry-index:v1:eip155:5042:0x42a64061b6cd84067bb660b2a9b8aa881fd225bb:1:0x4fffb030de9d91ff1638b3a0c6b452d67d7794765b53babfc3a6bd20e6ae1949:lastSyncedBlock',
] as const);
const landingDay='2026-11-15';
type Json=Record<string,unknown>;type Outcome='not_attempted'|'unknown'|'acknowledged';
type Stage='preflight'|'online-census'|'maintenance'|'drain'|'final-copy'|'source-retirement'|'activation'|'runtime-hba'|'native-verification'|'publication'|'role-start'|'complete';
function refuse(stage:string):never{throw Error('server1_native_cutover_refused:'+stage);}
const sha=(wire:string|Uint8Array)=>createHash('sha256').update(wire).digest('hex');
function releaseSource(commit:string){assert(/^[a-f0-9]{40}$/.test(commit));return '/root/.local/share/keryx-releases/'+commit+'/source';}
type ReleaseModule=typeof import('../redeploy-reviewed-roles.mjs');
async function releaseModule(commit:string):Promise<ReleaseModule>{return import(pathToFileURL(join(releaseSource(commit),'scripts/redeploy-reviewed-roles.mjs')).href);}
const token=(s:BigIntStats)=>[s.dev,s.ino,s.uid,s.gid,s.mode,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');
function record(value:unknown):Json{if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Reflect.ownKeys(value).some(key=>typeof key!=='string')||Object.values(Object.getOwnPropertyDescriptors(value)).some(d=>!Object.hasOwn(d,'value')))return refuse('object');return value as Json;}
function hash(value:unknown):string{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))return refuse('hash');return value;}
function canonicalTime(value:unknown):string{if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)return refuse('time');return value;}
function exact(value:Json,keys:readonly string[]){if(Object.keys(value).sort().join('|')!==[...keys].sort().join('|'))refuse('fields');}
export function parseServer1CutoverMode(args:readonly string[]):'preflight'|'apply'|'verify-native-only'|'verify-artifact-only'{
 if(args.length===0||args.length===1&&args[0]==='--preflight')return 'preflight';if(args.length===1&&args[0]==='--apply')return 'apply';if(args.length===1&&args[0]==='--verify-native-only')return 'verify-native-only';if(args.length===1&&args[0]==='--verify-artifact-only')return 'verify-artifact-only';return refuse('cli');
}
export function parseServer1CutoverIntent(raw:unknown){
 const p=record(raw);const hashes=['baselineSha256','rolesSha256','reviewSha256','oldEnvironmentSha256','oldManifestSha256','runtimeEnvironmentSha256','runtimeManifestSha256','receiptTemplateSha256','nativeBootSha256','snapshotChildSha256','cutoverBundleSha256'] as const;
 exact(p,['format','sourceCommit','targetCommit','createdAt','windowId',...hashes]);
 if(p.format!=='keryx-server1-native-cutover-intent-v1'||p.sourceCommit!==SERVER1_CUTOVER.sourceCommit||typeof p.targetCommit!=='string'||!/^[a-f0-9]{40}$/.test(p.targetCommit)||p.targetCommit===p.sourceCommit||typeof p.windowId!=='string'||!/^postgres-native-cutover-20261116-[a-f0-9]{16}$/.test(p.windowId))refuse('intent');
 for(const name of hashes)hash(p[name]);canonicalTime(p.createdAt);return Object.freeze({...p}) as Readonly<Json>;
}
function parentFrame(path:string){
 assert.equal(resolve(path),path);let cursor=parse(path).root;const ids:string[]=[];
 for(const part of relative(cursor,dirname(path)).split(sep)){cursor=resolve(cursor,part);const s=lstatSync(cursor,{bigint:true});assert(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===BigInt(0)&&s.gid===BigInt(0)&&(s.mode&BigInt(0o022))===BigInt(0));assert.equal(realpathSync(cursor),cursor);ids.push([cursor,s.dev,s.ino,s.uid,s.gid,s.mode].join(':'));}return ids.join('|');
}
function pin(path:string,max:number,privateMode=true){
 const parents=parentFrame(path),initial=lstatSync(path,{bigint:true});assert(initial.isFile()&&!initial.isSymbolicLink()&&initial.uid===BigInt(0)&&initial.gid===BigInt(0)&&initial.nlink===BigInt(1)&&initial.size>BigInt(0)&&initial.size<=BigInt(max));assert(privateMode?(initial.mode&BigInt(0o777))===BigInt(0o600):(initial.mode&BigInt(0o022))===BigInt(0));
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 const frame=()=>{assert.equal(parentFrame(path),parents);assert.equal(token(fstatSync(fd,{bigint:true})),token(initial));assert.equal(token(lstatSync(path,{bigint:true})),token(initial));};
 try{frame();return {path,fd,initial,frame,close:()=>closeSync(fd)};}catch(error){closeSync(fd);throw error;}
}
type Pin=ReturnType<typeof pin>;
function bytes(p:Pin,max=65536){p.frame();assert(p.initial.size<=BigInt(max));const out=Buffer.alloc(Number(p.initial.size));let n=0;while(n<out.length){const got=readSync(p.fd,out,n,out.length-n,n);assert(got>0);n+=got;}assert.equal(readSync(p.fd,Buffer.alloc(1),0,1,n),0);p.frame();return out;}
function json(p:Pin){return record(JSON.parse(new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(bytes(p))));}
async function fileSha(p:Pin){p.frame();const h=createHash('sha256');for await(const chunk of createReadStream(p.path,{fd:p.fd,autoClose:false,start:0}))h.update(chunk);p.frame();return h.digest('hex');}
function syncParent(path:string){const fd=openSync(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}}
function exclusive(path:string,wire:Buffer,mode=0o600){parentFrame(path);const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,mode);try{let n=0;while(n<wire.length){const got=writeSync(fd,wire,n,wire.length-n,n);assert(got>0);n+=got;}fsyncSync(fd);}finally{closeSync(fd);}syncParent(path);}
function command(bin:string,args:readonly string[],maximum=65536,timeout=30000,env:NodeJS.ProcessEnv={PATH:'/usr/bin:/bin',HOME:'/root',LANG:'C.UTF-8',LC_ALL:'C.UTF-8'}):Promise<string>{
 return new Promise((accept,reject)=>execFile(bin,[...args],{encoding:'utf8',timeout,maxBuffer:maximum,env},(error,stdout,stderr)=>error||Buffer.byteLength(stdout)>maximum||Buffer.byteLength(stderr)>maximum?reject(Error('Cutover command unavailable')):accept(stdout)));
}
function peer(database:'keryx_source'|'keryx_mainnet',role:'postgres'|'keryx_app'|'keryx_reader'='postgres',password?:string){
 const pg=new Client({host:socket,port:5432,database,user:role,password:password??(()=>{throw Error('Cutover peer challenge refused');}),ssl:false,application_name:'keryx-server1-native-cutover',connectionTimeoutMillis:2000,query_timeout:6000,options:'-c statement_timeout=5000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=5000 -c client_encoding=UTF8 -c timezone=UTC -c synchronous_commit=on',types:{getTypeParser:(oid,format)=>format!=='binary'&&(oid===114||oid===3802)?(value:string)=>value:types.getTypeParser(oid,format)}});pg.on('error',()=>{});return pg;
}
async function hbaRejected(database:'keryx_source'|'keryx_mainnet',role:'keryx_app'|'keryx_reader'){
 const pg=peer(database,role);let denied=false;try{await pg.connect();}catch(error){denied=!!error&&typeof error==='object'&&Reflect.get(error,'code')==='28000'&&Reflect.get(error,'message')===`pg_hba.conf rejects connection for host "[local]", user "${role}", database "${database}", no encryption`;}finally{await pg.end();}assert(denied);
}
const completeFields=['format','phase','sourceCommit','targetCommit','sourceManifestSha256','runtimeManifestSha256','identityDigest','sourceSqlSha256','catalogSha256','finalSnapshotSha256','finalSchemaSha256','finalDataDigest','nativeCensusSha256','publicPolicySha256','sourceWritersNaturallyEnded','sourceStartupRetired','sourceManifestRetired','privateWorkerInactive','pendingOriginalsPreserved','targetMode','activationOutcome','runtimeHbaVerified','newFunding','financialPolicyChanged','createdAt'] as const;
/** Static byte bindings only. No future outcome or B1 digest is accepted. */
export function parseServer1CutoverReceiptTemplate(raw:unknown,intent:Readonly<Json>){
 const r=record(raw);exact(r,['format','sourceCommit','targetCommit','sourceManifestSha256','runtimeManifestSha256','identityDigest','sourceSqlSha256','catalogSha256','publicPolicySha256','newFunding','financialPolicyChanged','createdAt']);
 if(r.format!=='keryx-server1-native-cutover-template-v1'||r.sourceCommit!==SERVER1_CUTOVER.sourceCommit||r.targetCommit!==intent.targetCommit||r.createdAt!==intent.createdAt||r.sourceSqlSha256!==SERVER1_CUTOVER.sourceSqlSha256||r.catalogSha256!==SERVER1_CUTOVER.catalogSha256||r.publicPolicySha256!==SERVER1_CUTOVER.publicPolicySha256||r.newFunding!==false||r.financialPolicyChanged!==false)refuse('receipt_template');
 for(const key of Object.keys(r).filter(k=>k.endsWith('Sha256')||k.endsWith('Digest')))hash(r[key]);
 canonicalTime(r.createdAt);return Object.freeze({...r});
}
type Inputs={intent:Readonly<Json>;expected:Readonly<Json>;baseline:Json;preparation:Json;held:Json;identity:Readonly<StorageIdentity>;pins:Pin[];byPath:Map<string,Pin>;activeEnvironment:Pin;activeManifest:Pin;frame:()=>void;close:()=>void};
async function inputs():Promise<Inputs>{
 const pins:Pin[]=[],byPath=new Map<string,Pin>();
 const take=(path:string,max=65536,privateMode=true)=>{const p=pin(path,max,privateMode);pins.push(p);byPath.set(path,p);return p;};
 try{
  const intent=parseServer1CutoverIntent(json(take(SERVER1_CUTOVER.intent))),expected=parseServer1CutoverReceiptTemplate(json(take(SERVER1_CUTOVER.expected)),intent);
  const names=[['baselineSha256',SERVER1_CUTOVER.baseline],['rolesSha256',SERVER1_CUTOVER.roles],['reviewSha256',SERVER1_CUTOVER.review],['runtimeEnvironmentSha256',SERVER1_CUTOVER.environment],['runtimeManifestSha256',SERVER1_CUTOVER.manifest],['nativeBootSha256',SERVER1_CUTOVER.dropin],['snapshotChildSha256',SERVER1_CUTOVER.snapshotChild],['cutoverBundleSha256',SERVER1_CUTOVER.bundle]] as const;
  for(const [key,path]of names){const p=take(path,path===SERVER1_CUTOVER.bundle?4194304:path===SERVER1_CUTOVER.snapshotChild?4194304:65536);assert.equal(await fileSha(p),hash(intent[key]));}
  assert.equal(sha(bytes(byPath.get(SERVER1_CUTOVER.expected)!)),intent.receiptTemplateSha256);
  const baseline=json(byPath.get(SERVER1_CUTOVER.baseline)!);assert.equal(baseline.format,'keryx-server1-online-b0-receipt-v1');assert.equal(baseline.writerMode,'held');assert.equal(baseline.sourceRetired,false);assert.equal(baseline.financialCatchupQualified,false);assert.equal(baseline.applicationAuthority,false);
  const identity=validateStorageIdentity(baseline.identity);assert.equal(identity.network,'eip155:5042');assert.equal(identity.authorityMode,'mainnet-real');assert.equal(storageIdentityDigest(identity),baseline.identityDigest);
  for(const key of ['typed-staging','public-cells','private-projections'])assert.equal(record(baseline.phases)[key],'acknowledged');
  const preparation=json(take(SERVER1_CUTOVER.preparation)),held=json(take(SERVER1_CUTOVER.held));assert.equal(preparation.format,'keryx-server1-postgres17-preparation-v1');assert.equal(preparation.phase,'prepared-unenrolled');assert.equal(held.format,'keryx-server1-postgres17-held-target-v1');assert.equal(held.phase,'fresh-held-unenrolled');
  assert.equal(sha(bytes(byPath.get(SERVER1_CUTOVER.preparation)!)),baseline.preparationSha256);assert.equal(sha(bytes(byPath.get(SERVER1_CUTOVER.held)!)),baseline.heldControlSha256);assert.equal(held.preparationSha256,baseline.preparationSha256);assert.equal(held.identityDigest,baseline.identityDigest);
  const source=take(SERVER1_CUTOVER.snapshot,536870912);assert.equal(await fileSha(source),hash(baseline.sourceSnapshotSha256));validateSnapshotHeader(source.fd);checkSnapshotSidecars(SERVER1_CUTOVER.snapshot);
  assert.equal(await fileSha(take(SERVER1_CUTOVER.sourceSql,8388608)),SERVER1_CUTOVER.sourceSqlSha256);assert.equal(baseline.sourceSqlSha256,SERVER1_CUTOVER.sourceSqlSha256);assert.equal(baseline.catalogSha256,SERVER1_CUTOVER.catalogSha256);
  assert.equal(await fileSha(take(SERVER1_CUTOVER.oldBootstrap)),SERVER1_CUTOVER.oldBootstrapSha256);assert.equal(await fileSha(take(SERVER1_CUTOVER.transfer)),SERVER1_CUTOVER.transferSha256);assert.equal(await fileSha(take(SERVER1_CUTOVER.bootUnit,65536,false)),SERVER1_CUTOVER.bootUnitSha256);
  assert.equal(await fileSha(take(immutableInspector,65536,false)),SERVER1_CUTOVER.immutableInspectorSha256);
  const activeEnvironment=pin(SERVER1_CUTOVER.activeEnvironment,65536),activeManifest=pin(SERVER1_CUTOVER.activeManifest,8192);pins.push(activeEnvironment,activeManifest);
  assert.equal(sha(bytes(activeEnvironment)),intent.oldEnvironmentSha256);assert.equal(sha(bytes(activeManifest)),intent.oldManifestSha256);assert.equal(intent.oldManifestSha256,baseline.sourceManifestSha256);
  const current=json(activeManifest);assert.equal(record(current.backend).kind,'sqlite');assert.equal(canonicalJson(current.identity),canonicalJson(identity));
  const beforeEnv=parseEnv(bytes(activeEnvironment).toString('utf8'));assert.equal(beforeEnv.KERYX_REGISTRY_ORIGINS,beforeEnv.NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS);validateServer1RegistryOrigins(beforeEnv.KERYX_REGISTRY_ORIGINS);const nextEnv=parseEnv(bytes(byPath.get(SERVER1_CUTOVER.environment)!).toString('utf8'));const legacy=['KERYX_SQLITE_PATH','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
  assert.equal(nextEnv.KERYX_STORAGE_MANIFEST,SERVER1_CUTOVER.activeManifest);for(const key of legacy)assert(!nextEnv[key]);for(const key of new Set([...Object.keys(beforeEnv),...Object.keys(nextEnv)]))if(!legacy.includes(key))assert.equal(nextEnv[key],beforeEnv[key]);
  const selected=json(byPath.get(SERVER1_CUTOVER.manifest)!);assert.equal(canonicalJson(selected.identity),canonicalJson(identity));const backend=record(selected.backend);assert.equal(backend.kind,'postgres');assert.equal(backend.database,'keryx_mainnet');assert.equal(backend.sourceDigest,SERVER1_CUTOVER.catalogSha256);assert.equal(canonicalJson(backend.endpoint),canonicalJson({kind:'unix',directory:socket,port:5432}));
  for(const role of ['application','reader']){const path=record(backend.credentialPaths)[role];assert.equal(path,dirname(SERVER1_CUTOVER.activeManifest)+(role==='application'?'/postgres-app.json':'/postgres-reader.json'));take(String(path),8192);}
  const runtimeHba=take(SERVER1_CUTOVER.runtimeHba,32768);assert.equal(await fileSha(runtimeHba),hash(preparation.runtimeHbaTemplateSha256));
  const sourceMachine=take(root+'/source-machine-id',256),machine=take('/etc/machine-id',256,false);assert.equal(sha(bytes(sourceMachine)),'a9baadf374fdfbacaa7ac7d7562109b32111821b583170a94d423de4ef4e65eb');assert.equal(bytes(machine).toString('ascii').trim(),bytes(sourceMachine).toString('ascii').trim());
  for(const [key,path]of [['postgresql','/etc/postgresql/17/keryx/postgresql.conf'],['hba',SERVER1_CUTOVER.activeHba],['ident','/etc/postgresql/17/keryx/pg_ident.conf'],['service','/etc/systemd/system/postgresql@17-keryx.service.d/20-keryx-preparation.conf']])assert.equal(await fileSha(take(path,65536,false)),hash(record(preparation.configHashes)[key]));
  assert.equal(expected.identityDigest,baseline.identityDigest);assert.equal(expected.sourceManifestSha256,baseline.sourceManifestSha256);assert.equal(expected.runtimeManifestSha256,intent.runtimeManifestSha256);
  const frame=()=>{for(const p of pins)if(p!==activeEnvironment&&p!==activeManifest)p.frame();};frame();activeEnvironment.frame();activeManifest.frame();
  return {intent,expected,baseline,preparation,held,identity,pins,byPath,activeEnvironment,activeManifest,frame,close:()=>{const failed:unknown[]=[];for(const p of pins)try{p.close();}catch(error){failed.push(error);}if(failed.length)refuse('descriptor_cleanup');}};
 }catch(error){for(const p of pins)try{p.close();}catch{/* all remaining descriptors still attempted */}throw error;}
}
function scalarText(cell:SnapshotRow[number]):string{
 assert.equal(cell[0],'text');const value=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(Buffer.from(cell[1] as string,'hex'));assert.equal(Buffer.from(value).toString('hex'),cell[1]);return value;
}
function sourceIdleWorker(row:SnapshotRow,pid:number){
 assert(Number.isSafeInteger(pid)&&pid>1);assert.equal(row.length,3);assert.equal(scalarText(row[0]),'a2aWorker');const wire=scalarText(row[1]);assert(Buffer.byteLength(wire)<=4096);const value=record(JSON.parse(wire));exact(value,['workerId','status','orderId','updatedAt']);assert.equal(value.status,'idle');assert.equal(value.orderId,null);
 assert(typeof value.workerId==='string'&&value.workerId.startsWith(hostname()+':'+pid+':'));const nonce=value.workerId.slice((hostname()+':'+pid+':').length);assert(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(nonce));
 const observed=Date.parse(canonicalTime(value.updatedAt)),column=Date.parse(canonicalTime(scalarText(row[2])));assert(observed<=column);assert.equal(wire,JSON.stringify({workerId:value.workerId,status:'idle',orderId:null,updatedAt:value.updatedAt}));return {wire,value,observed,column};
}
/** Data validation only; never supplies a target/write capability. */
export function validateServer1WorkerStop(before:SnapshotRow,after:SnapshotRow,pid:number,from:number,until:number){
 assert(Number.isFinite(from)&&Number.isFinite(until)&&from<=until);const old=sourceIdleWorker(before,pid);assert.equal(after.length,3);assert.equal(snapshotRowWire([before[0]]),snapshotRowWire([after[0]]));const newWire=scalarText(after[1]);assert(Buffer.byteLength(newWire)<=4096);const next=record(JSON.parse(newWire));exact(next,['workerId','status','updatedAt']);assert.equal(next.status,'stopped');assert.equal(next.workerId,old.value.workerId);
 const nextTime=Date.parse(canonicalTime(next.updatedAt)),nextColumn=Date.parse(canonicalTime(scalarText(after[2])));assert(old.column<=from&&nextTime>=from&&nextTime<=nextColumn&&nextColumn<=until);assert.equal(newWire,JSON.stringify({workerId:old.value.workerId,status:'stopped',updatedAt:next.updatedAt}));return Object.freeze({before:old.wire,after:newWire});
}
function sourceOperatorClock(row:SnapshotRow){
 assert.equal(row.length,3);assert.equal(scalarText(row[0]),'businessOperator');const wire=scalarText(row[1]);assert(Buffer.byteLength(wire)<=4096);const value=record(JSON.parse(wire));exact(value,['version','network','observedAt','decision','auditRecorded','state']);assert.equal(value.version,1);assert.equal(value.network,'eip155:5042');assert.equal(value.auditRecorded,true);assert(typeof value.state==='string'&&['idle','held','review'].includes(value.state));
 const decision=record(value.decision);exact(decision,['action','reason','liquidity','observedAt']);assert(typeof decision.action==='string'&&['hold','idle'].includes(decision.action));assert(typeof decision.reason==='string'&&['no-orders','liquidity-covered','liquidity-unavailable','liquidity-short','policy-cap','incomplete-inventory','original-job-needs-review','another-job-active','acceptance-paused'].includes(decision.reason));assert(typeof decision.liquidity==='string'&&['covered','short','unknown','not-needed'].includes(decision.liquidity));
 const decisionTime=Date.parse(canonicalTime(decision.observedAt)),observed=Date.parse(canonicalTime(value.observedAt)),column=Date.parse(canonicalTime(scalarText(row[2])));assert(decisionTime<=observed&&observed<=column);
 const producer={version:1,network:'eip155:5042',observedAt:value.observedAt,decision:{action:decision.action,reason:decision.reason,liquidity:decision.liquidity,observedAt:decision.observedAt},auditRecorded:true,state:value.state};assert.equal(wire,JSON.stringify(producer));return {wire,value,decisionTime,observed,column};
}
/** Only the Source nested/TOP observation clocks and independent SQLite clock
 * may advance. Decision action/reason/liquidity, state and all other bytes stay exact. */
export function validateServer1OperatorClock(before:SnapshotRow,after:SnapshotRow,from:number,until:number){
 assert(Number.isFinite(from)&&Number.isFinite(until)&&from<=until);const old=sourceOperatorClock(before),next=sourceOperatorClock(after);assert.equal(snapshotRowWire([before[0]]),snapshotRowWire([after[0]]));
 assert(old.decisionTime<=from&&old.column<=from&&next.decisionTime>=old.decisionTime&&next.decisionTime<=until&&next.observed>=old.observed&&next.column>=old.column&&next.column<=until);
 assert.equal(next.wire,JSON.stringify({...old.value,observedAt:next.value.observedAt,decision:{...record(old.value.decision),observedAt:record(next.value.decision).observedAt}}));return Object.freeze({before:old.wire,after:next.wire});
}
/** Pure Source-data checks, never an origin enrollment or write capability. */
export function validateServer1RegistryOrigins(wire:unknown){
 assert(typeof wire==='string'&&Buffer.byteLength(wire)<=8192);const values=JSON.parse(wire);assert(Array.isArray(values)&&values.length===2);const found=values.map(value=>{const a=sourceRegistryAuthoritySchema.parse(value);assert.equal(a.network,'eip155:5042');return `keryx:registry-index:v1:${a.network}:${a.address}:${a.version}:${a.codeHash}:lastSyncedBlock`;});assert.deepEqual([...found].sort(),[...SERVER1_CHECKPOINT_KEYS].sort());
}
function sourceCheckpoint(row:SnapshotRow){
 assert.equal(row.length,3);const key=scalarText(row[0]);assert((SERVER1_CHECKPOINT_KEYS as readonly string[]).includes(key));const wire=scalarText(row[1]);assert(/^(0|[1-9]\d{0,19})$/.test(wire));return {key,wire,column:Date.parse(canonicalTime(scalarText(row[2])))};
}
export function validateServer1RegistryCheckpoint(before:SnapshotRow,after:SnapshotRow,from:number,until:number){
 assert(Number.isFinite(from)&&Number.isFinite(until)&&from<=until);const old=sourceCheckpoint(before),next=sourceCheckpoint(after);assert.equal(next.key,old.key);assert(old.column<=from&&next.column>=old.column&&next.column<=until&&BigInt(next.wire)>=BigInt(old.wire));
}
function sourceCompletedUpkeep(row:SnapshotRow){
 assert.equal(row.length,3);assert.equal(scalarText(row[0]),'sourceUpkeep');const wire=scalarText(row[1]);assert(Buffer.byteLength(wire)<=8192);const value=record(JSON.parse(wire));exact(value,['slot','cursor','leaseUntil','completedAt','summary']);const integer=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
 assert(integer(value.slot)&&value.leaseUntil===0&&typeof value.cursor==='string'&&value.cursor.length<=512);const summary=record(value.summary);exact(summary,['attempted','added','failed','skipped']);assert(integer(summary.attempted)&&Number(summary.attempted)<=2&&integer(summary.added)&&Number(summary.added)<=2000&&integer(summary.failed)&&Number(summary.failed)<=2&&integer(summary.skipped)&&Number(summary.skipped)<=2);
 const completed=Date.parse(canonicalTime(value.completedAt)),column=Date.parse(canonicalTime(scalarText(row[2])));assert.equal(column,completed);assert(Number(value.slot)<=Math.floor(completed/3600000));assert.equal(wire,JSON.stringify({slot:value.slot,cursor:value.cursor,leaseUntil:0,completedAt:value.completedAt,summary:{attempted:summary.attempted,added:summary.added,failed:summary.failed,skipped:summary.skipped}}));return {wire,value,completed,column};
}
export function validateServer1CompletedUpkeep(before:SnapshotRow,after:SnapshotRow,from:number,until:number){
 assert(Number.isFinite(from)&&Number.isFinite(until)&&from<=until);const old=sourceCompletedUpkeep(before),next=sourceCompletedUpkeep(after);assert(old.column<=from&&next.completed>=old.completed&&next.completed<=until&&Number(next.value.slot)>=Number(old.value.slot));if(next.value.slot===old.value.slot)assert.equal(next.value.cursor,old.value.cursor);assert.equal(JSON.stringify(next.value.summary),JSON.stringify(old.value.summary));
}
function sourceLanding(row:SnapshotRow){
 assert.equal(row.length,3);const day=scalarText(row[0]);assert.equal(day,landingDay);assert.equal(new Date(day+'T00:00:00.000Z').toISOString().slice(0,10),day);assert.equal(scalarText(row[1]),'reader_landing');assert.equal(row[2][0],'integer');const count=nativeMaterializationCell(row[2],'integer');assert(typeof count==='string'&&BigInt(count)>=BigInt(0));return count;
}
export function validateServer1LandingCounter(before:SnapshotRow,after:SnapshotRow){
 const old=sourceLanding(before),next=sourceLanding(after);assert.equal(snapshotRowWire(before.slice(0,2)),snapshotRowWire(after.slice(0,2)));assert(BigInt(next)>=BigInt(old));
}
// Exact windows of the selected Source producers: ordinary/faucet/withdrawal/
// grant/run-claim 60s; scholarly-submit 1h; sponsored/gap-offer daily 24h.
// This is an expiry shape bound, never a points/budget limit or a quota reset.
const SOURCE_RATE_WINDOWS_MS=[60000,3600000,86400000] as const;
const SOURCE_ACTIVATION_EVENTS=['reader_landing','reader_ask_started','reader_answer_completed','reader_wallet_connected','reader_session_funded','reader_returning_dispatch','creator_registration_started','creator_verification_completed','creator_citation_settled','creator_withdrawal_completed'] as const;
type OperationalTable='activation_events'|'rate_limit_counters';
type OperationalDelta={before:SnapshotRow|null;after:SnapshotRow|null};
function sourceOperationalRow(table:OperationalTable,row:SnapshotRow,until:number){
 assert(Number.isSafeInteger(until)&&until>0);assert.equal(row.length,3);
 if(table==='activation_events'){
  assert.equal(row[2][0],'integer');const values=row.map((cell,i)=>nativeMaterializationCell(cell,i===0?'date':i===1?'text':'integer'));assert(values.every(v=>typeof v==='string'));const [day,event,count]=values as string[];assert((SOURCE_ACTIVATION_EVENTS as readonly string[]).includes(event)&&day<=new Date(until).toISOString().slice(0,10)&&BigInt(count)>=BigInt(0));
  return {key:snapshotRowWire(row.slice(0,2)),values,count:BigInt(count),reset:BigInt(0)};
 }
 assert.equal(table,'rate_limit_counters');const values=row.map((cell,i)=>nativeMaterializationCell(cell,i===0?'text':i===1?'integer':'bigint'));assert(values.every(v=>typeof v==='string'));assert(row[1][0]==='integer'&&row[2][0]==='integer');const count=BigInt(values[1]!),reset=BigInt(values[2]!);assert(count>BigInt(0)&&reset>BigInt(0)&&reset<=BigInt(Number.MAX_SAFE_INTEGER)&&reset<=BigInt(until)+BigInt(SOURCE_RATE_WINDOWS_MS[2]));
 return {key:snapshotRowWire(row.slice(0,1)),values,count,reset};
}
/** Pure Source transition checks only. Capture/delta limits bound whole tables,
 * not opaque keys or request budgets. No caller can obtain a write capability. */
export function validateServer1OperationalTable(table:OperationalTable,before:readonly SnapshotRow[],after:readonly SnapshotRow[],until:number):readonly OperationalDelta[]{
 assert(table==='activation_events'||table==='rate_limit_counters');assert(before.length<=4096&&after.length<=4096);
 const map=(rows:readonly SnapshotRow[])=>{let bytes=0;const result=new Map<string,{row:SnapshotRow;value:ReturnType<typeof sourceOperationalRow>}>();for(const row of rows){bytes+=Buffer.byteLength(snapshotRowWire(row));assert(bytes<=8388608);const value=sourceOperationalRow(table,row,until);assert(!result.has(value.key));result.set(value.key,{row,value});}return result;},old=map(before),next=map(after),delta:OperationalDelta[]=[];
 for(const [key,prior]of old){const current=next.get(key);if(!current){assert(table==='rate_limit_counters'&&prior.value.reset<=BigInt(until));delta.push({before:prior.row,after:null});continue;}if(snapshotRowWire(prior.row)===snapshotRowWire(current.row))continue;
  if(table==='activation_events')assert(current.value.count>=prior.value.count);
  else if(current.value.reset===prior.value.reset)assert(current.value.count>=prior.value.count);
  else assert(current.value.reset>prior.value.reset&&prior.value.reset<=BigInt(until)&&SOURCE_RATE_WINDOWS_MS.some(window=>current.value.reset-BigInt(window)>=prior.value.reset&&current.value.reset-BigInt(window)<=BigInt(until)));
  delta.push({before:prior.row,after:current.row});
 }
 for(const [key,current]of next)if(!old.has(key)){assert(current.value.count>BigInt(0));delta.push({before:null,after:current.row});}
 assert(delta.length<=4096);return delta;
}

// The selected upkeep producer clears only a source's cache, then appends unseen
// RSS items encrypted locally. This is raw data preservation, never a receipt,
// publisher-signature verifier, content decryption or application capability.
export const SERVER1_CONTENT_ITEM_COLUMNS=Object.freeze(['id','source_id','title','summary','content','link','published_at','ipfs_cid','item_key_enc','item_iv','item_auth_tag','item_wrap_iv','delivery_kind','storage_mode','plaintext_bytes','body_hash','manifest_id','manifest_signer','manifest_nonce','manifest_signature','manifest_created_at','evidence_provenance'] as const);
type ContentTables={cacheRows:readonly SnapshotRow[];itemRows:readonly SnapshotRow[]};
type ContentContext={sourceRows:readonly SnapshotRow[];identityDigest?:string;until:number};
function sourceBase64(value:unknown,bytes?:number){assert(typeof value==='string'&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value));const raw=Buffer.from(value,'base64');assert.equal(raw.toString('base64'),value);if(bytes!==undefined)assert.equal(raw.length,bytes);return raw.length;}
function sourceCacheEnvelope(row:SnapshotRow,identityDigest:string|undefined){
 assert.equal(row.length,3);const [id,value,updated]=row.map(c=>nativeMaterializationCell(c,'text'));assert(typeof id==='string'&&id.length>0&&id.length<=256&&Buffer.byteLength(id)<=512&&typeof value==='string'&&Buffer.byteLength(value)<=2097152&&value.startsWith('enc:v3:'));assert(typeof identityDigest==='string'&&/^[a-f0-9]{64}$/.test(identityDigest));
 const outer=value.slice(7);sourceBase64(outer);const decoded=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(Buffer.from(outer,'base64')),envelope=record(JSON.parse(decoded));assert.equal(canonicalJson(envelope),decoded);exact(envelope,['format','sourceId','storageIdentityDigest','cipherB64','ivB64','authTagB64','wrappedKeyB64','wrapIvB64']);assert.equal(envelope.format,'keryx-enrolled-cache-v1');assert.equal(envelope.sourceId,id);assert.equal(envelope.storageIdentityDigest,identityDigest);assert(sourceBase64(envelope.cipherB64)<=1048576);sourceBase64(envelope.ivB64,12);sourceBase64(envelope.authTagB64,16);sourceBase64(envelope.wrappedKeyB64,48);sourceBase64(envelope.wrapIvB64,12);assert(typeof updated==='string');return {id,value,time:Date.parse(canonicalTime(updated)),cipherBytes:sourceBase64(envelope.cipherB64)};
}
function sourceUpkeepItem(row:SnapshotRow){
 assert.equal(row.length,22);const values=row.map((c,i)=>nativeMaterializationCell(c,i===14?'integer':'text'));for(const i of [0,1,2,3,4,5,8,9,10,11,12,13,15])assert(typeof values[i]==='string');const [id,sourceId,title,summary,content,link]=values as string[];assert(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)&&sourceId.length>0&&title.trim().length>0&&summary.length<=280&&link.length>0);assert.equal(values[7],null);for(const i of [16,17,18,19,20])assert.equal(values[i],null);if(values[6]!==null)canonicalTime(values[6]);assert.equal(values[13],'db_encrypted');assert(['full_text','excerpt','abstract'].includes(values[12]!));assert.equal(row[14][0],'integer');assert(typeof values[14]==='string');const size=Number(values[14]);assert(Number.isSafeInteger(size)&&size>0&&size<=500000&&sourceBase64(content)===size);sourceBase64(values[8],48);sourceBase64(values[9],12);sourceBase64(values[10],16);sourceBase64(values[11],12);assert(/^0x[a-f0-9]{64}$/.test(values[15]!));assert(values[21]===null||values[21]==='synthetic-demo');return {id,sourceId,link,provenance:values[21],values};
}
export function validateServer1ContentTables(before:ContentTables,after:ContentTables,context:ContentContext){
 assert(Number.isSafeInteger(context.until)&&context.until>0);let bytes=0;
 const map=(rows:readonly SnapshotRow[],columns:number)=>{assert(rows.length<=4096);const result=new Map<string,SnapshotRow>();for(const row of rows){assert.equal(row.length,columns);bytes+=Buffer.byteLength(snapshotRowWire(row));assert(bytes<=67108864);const key=nativeMaterializationCell(row[0],'text');assert(typeof key==='string'&&!result.has(key));result.set(key,row);}return result;};
 const oldCache=map(before.cacheRows,3),nextCache=map(after.cacheRows,3),oldItems=map(before.itemRows,22),nextItems=map(after.itemRows,22),cache:{before:SnapshotRow;after:SnapshotRow}[]=[],items:SnapshotRow[]=[];
 assert.equal(oldCache.size,nextCache.size);for(const [id,row]of oldCache){const next=nextCache.get(id);assert(next);if(snapshotRowWire(row)===snapshotRowWire(next))continue;const old=sourceCacheEnvelope(row,context.identityDigest),current=sourceCacheEnvelope(next,context.identityDigest);assert.equal(current.id,old.id);assert(current.time>=old.time&&current.time<=context.until&&current.cipherBytes===0);cache.push({before:row,after:next});}
 for(const [id,row]of oldItems){const current=nextItems.get(id);assert(current);assert.equal(snapshotRowWire(current),snapshotRowWire(row));}
 const sources=new Map<string,SnapshotRow>();assert(context.sourceRows.length<=4096);for(const row of context.sourceRows){assert.equal(row.length,5);bytes+=Buffer.byteLength(snapshotRowWire(row));assert(bytes<=67108864);const id=nativeMaterializationCell(row[0],'text');assert(typeof id==='string'&&!sources.has(id));sources.set(id,row);}
 const changed=new Map(cache.map(v=>[scalarText(v.after[0]),0])),seenLinks=new Set(before.itemRows.map(row=>snapshotRowWire([row[1],row[5]])));
 for(const [id,row]of nextItems)if(!oldItems.has(id)){const item=sourceUpkeepItem(row),owner=sources.get(item.sourceId);assert(owner&&changed.has(item.sourceId)&&!/^public:/i.test(item.sourceId));assert.deepEqual(owner[1],['integer','1']);assert.deepEqual(owner[2],['integer','1']);const rss=nativeMaterializationCell(owner[3],'text'),provenance=nativeMaterializationCell(owner[4],'text');assert(typeof rss==='string'&&rss.trim().length>0);assert.equal(item.provenance,provenance);const link=snapshotRowWire([row[1],row[5]]);assert(!seenLinks.has(link));seenLinks.add(link);changed.set(item.sourceId,changed.get(item.sourceId)!+1);items.push(row);}
 for(const count of changed.values())assert(count>0);assert.equal(nextItems.size,oldItems.size+items.length);return {cache,items};
}

type TypedTable={name:string;columns:readonly string[];sql:string;keys:string[];rows:number;digest:string};
type Inventory=ContentTables&{schemaSha256:string;dataDigest:string;normalizedDataDigest:string;tables:TypedTable[];rows:number;worker:SnapshotRow;operatorClock:SnapshotRow;syncSemanticDigest:string;activationSemanticDigest:string;checkpoints:SnapshotRow[];upkeep:SnapshotRow;landing?:SnapshotRow;activationRows:readonly SnapshotRow[];rateRows:readonly SnapshotRow[];rateSemanticDigest:string;operationalUntil:number;sourceRows:readonly SnapshotRow[];storageIdentityDigest?:string;cacheSemanticDigest:string;itemSemanticDigest:string};
function sourceSchema(db:DatabaseSync){
 const b=db.prepare('SELECT count(*) n,coalesce(sum(length(CAST(sql AS BLOB))),0) bytes FROM sqlite_schema').get()!;assert(typeof b.n==='number'&&b.n<=1024&&typeof b.bytes==='number'&&b.bytes<=4194304);
 const rows=db.prepare("SELECT lower(hex(CAST(type AS BLOB))) type,lower(hex(CAST(name AS BLOB))) name,lower(hex(CAST(tbl_name AS BLOB))) parent,CASE WHEN sql IS NULL THEN NULL ELSE lower(hex(CAST(sql AS BLOB))) END sql FROM sqlite_schema ORDER BY type,name COLLATE BINARY").all(),wire=JSON.stringify(rows);assert(Buffer.byteLength(wire)<=9437184);return sha(wire);
}
/** One bounded streaming pass, same typed-wire/header/order as the existing
 * typed snapshot codec. Only validated operational tables, five sync rows and
 * paired encrypted upkeep tables feed B0 bytes into the
 * normalized hash. The actual B1 digest always contains the actual B1 bytes. */
async function typedInventory(db:DatabaseSync,check:()=>void,stop?:{baseline:Inventory;pid:number;from:number;until:number;copyUntil?:number},identityDigest?:string):Promise<Inventory>{
 assert(db.isTransaction&&db.prepare('PRAGMA query_only').get()?.query_only===1);const started=performance.now(),data=createHash('sha256'),normalized=createHash('sha256'),sync=createHash('sha256'),activation=createHash('sha256'),rate=createHash('sha256'),cache=createHash('sha256'),items=createHash('sha256'),tables:TypedTable[]=[];let total=0,worker:SnapshotRow|undefined,operatorClock:SnapshotRow|undefined,upkeep:SnapshotRow|undefined,landing:SnapshotRow|undefined,yieldBytes=0;const activationRows:SnapshotRow[]=[],rateRows:SnapshotRow[]=[],cacheRows:SnapshotRow[]=[],itemRows:SnapshotRow[]=[],sourceRows:SnapshotRow[]=[],operationalUntil=stop?.copyUntil??stop?.until??Date.now(),storageDigest=stop?.baseline.storageIdentityDigest??identityDigest;let operationalBytes=0,contentBytes=0;if(storageDigest!==undefined)assert(/^[a-f0-9]{64}$/.test(storageDigest));const checkpoints:SnapshotRow[]=[],copy=(row:SnapshotRow)=>Object.freeze(row.map(c=>Object.freeze([...c]) as SnapshotValue));
 const schemaSha256=sourceSchema(db);if(stop)assert.equal(schemaSha256,stop.baseline.schemaSha256);
 const declared=snapshotTables(db);assert.equal(declared.length,94);
 for(const table of declared){
  check();const quote='"'+table.name.replaceAll('"','""')+'"',columns=db.prepare(`PRAGMA table_xinfo(${quote})`).all(),keys=columns.filter(c=>typeof c.pk==='number'&&c.pk>0).sort((a,b)=>Number(a.pk)-Number(b.pk)).map(c=>String(c.name));
  const prior=stop?.baseline.tables.find(t=>t.name===table.name);if(stop){assert(prior);assert.equal(prior.sql,table.sql);assert.equal(canonicalJson(prior.columns),canonicalJson(table.columns));assert.equal(canonicalJson(prior.keys),canonicalJson(keys));}
  const operational=table.name==='activation_events'||table.name==='rate_limit_counters',content=table.name==='cache_items'||table.name==='source_items';if(operational){assert.deepEqual(table.columns,table.name==='activation_events'?['day','event','count']:['bucket','count','reset_at']);assert.deepEqual(keys,table.name==='activation_events'?['day','event']:['bucket']);}if(content){assert.deepEqual(table.columns,table.name==='cache_items'?['source_id','text','updated_at']:SERVER1_CONTENT_ITEM_COLUMNS);assert.deepEqual(keys,[table.name==='cache_items'?'source_id':'id']);}
  const header=JSON.stringify({table:table.name,columns:table.columns,keys})+'\n';data.update(header);normalized.update(header);const tableHash=createHash('sha256');let count=0;
  for(const row of snapshotRows(db,table,keys)){
   assert(performance.now()-started<60000);const wire=snapshotRowWire(row);let normalizedWire=wire;
   if(table.name==='sync_state'){
    assert.equal(canonicalJson(table.columns),canonicalJson(['key','value','updated_at']));assert.equal(canonicalJson(keys),canonicalJson(['key']));
    if(scalarText(row[0])==='a2aWorker'){assert.equal(worker,undefined);worker=Object.freeze(row.map(c=>Object.freeze([...c]) as SnapshotValue));if(stop){validateServer1WorkerStop(stop.baseline.worker,row,stop.pid,stop.from,stop.until);normalizedWire=snapshotRowWire(stop.baseline.worker);}}
    if(scalarText(row[0])==='businessOperator'){assert.equal(operatorClock,undefined);operatorClock=Object.freeze(row.map(c=>Object.freeze([...c]) as SnapshotValue));if(stop){validateServer1OperatorClock(stop.baseline.operatorClock,row,stop.from,stop.until);normalizedWire=snapshotRowWire(stop.baseline.operatorClock);}}
    if((SERVER1_CHECKPOINT_KEYS as readonly string[]).includes(scalarText(row[0]))){sourceCheckpoint(row);checkpoints.push(copy(row));if(stop){const old=stop.baseline.checkpoints.find(r=>scalarText(r[0])===scalarText(row[0]));assert(old);validateServer1RegistryCheckpoint(old,row,stop.from,stop.until);normalizedWire=snapshotRowWire(old);}}
    if(scalarText(row[0])==='sourceUpkeep'){assert.equal(upkeep,undefined);sourceCompletedUpkeep(row);upkeep=copy(row);if(stop){validateServer1CompletedUpkeep(stop.baseline.upkeep,row,stop.from,stop.until);normalizedWire=snapshotRowWire(stop.baseline.upkeep);}}
    sync.update(JSON.stringify(row.map(cell=>nativeMaterializationValueKey('text',nativeMaterializationCell(cell,'text'))))).update('\n');
   }
   if(operational){
    sourceOperationalRow(table.name as OperationalTable,row,operationalUntil);operationalBytes+=Buffer.byteLength(wire);assert(operationalBytes<=8388608&&activationRows.length+rateRows.length<4096);
    const selected=table.name==='activation_events'?activationRows:rateRows;selected.push(copy(row));
    if(table.name==='activation_events'&&scalarText(row[0])===landingDay&&scalarText(row[1])==='reader_landing')landing=copy(row);
    const digest=table.name==='activation_events'?activation:rate;digest.update(JSON.stringify(row.map((cell,i)=>nativeMaterializationValueKey(table.name==='activation_events'?(i===0?'date':i===1?'text':'integer'):(i===0?'text':i===1?'integer':'bigint'),nativeMaterializationCell(cell,table.name==='activation_events'?(i===0?'date':i===1?'text':'integer'):(i===0?'text':i===1?'integer':'bigint')))))).update('\n');
   }
   if(content){const selected=table.name==='cache_items'?cacheRows:itemRows;assert(selected.length<4096);contentBytes+=Buffer.byteLength(wire);assert(contentBytes<=33554432);selected.push(copy(row));const digest=table.name==='cache_items'?cache:items;digest.update(JSON.stringify(row.map((cell,i)=>{const type=table.name==='source_items'&&i===14?'integer':'text';return nativeMaterializationValueKey(type,nativeMaterializationCell(cell,type));}))).update('\n');}
   if(table.name==='sources'){assert(sourceRows.length<4096);const selected=['id','active','verified','rss_url','evidence_provenance'].map(name=>{const i=table.columns.indexOf(name);assert(i>=0);return row[i];});contentBytes+=Buffer.byteLength(snapshotRowWire(selected));assert(contentBytes<=33554432);sourceRows.push(copy(selected));}
   data.update(wire).update('\n');if(!stop||!operational&&!content)normalized.update(normalizedWire).update('\n');tableHash.update(wire).update('\n');count++;total++;assert(total<=2000000);yieldBytes+=Buffer.byteLength(wire);
   if(count%64===0||yieldBytes>=1048576){await new Promise<void>(done=>setImmediate(done));check();yieldBytes=0;}
  }
  if(stop){if(operational){const before=table.name==='activation_events'?stop.baseline.activationRows:stop.baseline.rateRows,after=table.name==='activation_events'?activationRows:rateRows;validateServer1OperationalTable(table.name as OperationalTable,before,after,operationalUntil);for(const row of before)normalized.update(snapshotRowWire(row)).update('\n');}else if(content){for(const row of table.name==='cache_items'?stop.baseline.cacheRows:stop.baseline.itemRows)normalized.update(snapshotRowWire(row)).update('\n');}else assert.equal(count,prior!.rows);}
  tables.push({name:table.name,columns:table.columns,sql:table.sql,keys,rows:count,digest:tableHash.digest('hex')});
 }
 assert(worker&&operatorClock&&upkeep&&checkpoints.length===2);checkpoints.sort((a,b)=>SERVER1_CHECKPOINT_KEYS.indexOf(scalarText(a[0]) as typeof SERVER1_CHECKPOINT_KEYS[number])-SERVER1_CHECKPOINT_KEYS.indexOf(scalarText(b[0]) as typeof SERVER1_CHECKPOINT_KEYS[number]));assert.equal(sourceSchema(db),schemaSha256);check();const result={schemaSha256,dataDigest:data.digest('hex'),normalizedDataDigest:normalized.digest('hex'),tables,rows:total,worker,operatorClock,checkpoints,upkeep,landing,syncSemanticDigest:sync.digest('hex'),activationSemanticDigest:activation.digest('hex'),rateSemanticDigest:rate.digest('hex'),activationRows:Object.freeze(activationRows),rateRows:Object.freeze(rateRows),operationalUntil,cacheRows:Object.freeze(cacheRows),itemRows:Object.freeze(itemRows),sourceRows:Object.freeze(sourceRows),storageIdentityDigest:storageDigest,cacheSemanticDigest:cache.digest('hex'),itemSemanticDigest:items.digest('hex')};
 if(stop){validateServer1ContentTables(stop.baseline,result,{sourceRows,identityDigest:storageDigest,until:operationalUntil});assert.equal(result.rows,stop.baseline.rows-stop.baseline.activationRows.length-stop.baseline.rateRows.length-stop.baseline.cacheRows.length-stop.baseline.itemRows.length+activationRows.length+rateRows.length+cacheRows.length+itemRows.length);assert.equal(result.normalizedDataDigest,stop.baseline.dataDigest);assert.equal(result.tables.length,stop.baseline.tables.length);}return result;
}

/** Called only inside the existing locked HELD target TX after full B0 census.
 * No retries, target selection, receipt issuer or application capability. */
async function preserveServer1SourceRows(pg:Client,before:Inventory,after:Inventory,frame:()=>void,emit:(event:Json)=>void){
 const operations=[
  {key:'a2aWorker',before:before.worker,after:after.worker,sql:"UPDATE public.sync_state SET value=$1,updated_at=$2 WHERE key='a2aWorker' AND value IS NOT DISTINCT FROM $3 AND updated_at IS NOT DISTINCT FROM $4 RETURNING key,value,updated_at"},
  {key:'businessOperator',before:before.operatorClock,after:after.operatorClock,sql:"UPDATE public.sync_state SET value=$1,updated_at=$2 WHERE key='businessOperator' AND value IS NOT DISTINCT FROM $3 AND updated_at IS NOT DISTINCT FROM $4 RETURNING key,value,updated_at"},
  {key:SERVER1_CHECKPOINT_KEYS[0],before:before.checkpoints[0],after:after.checkpoints[0],sql:"UPDATE public.sync_state SET value=$1,updated_at=$2 WHERE key='keryx:registry-index:v1:eip155:5042:0x2217250019ab614dae7391d346d05c3fc4d71ae1:3:0xc915aed2667848d7a52af54c6202940116145dca6f7dbb8a9c58ce8335740fb9:lastSyncedBlock' AND value IS NOT DISTINCT FROM $3 AND updated_at IS NOT DISTINCT FROM $4 RETURNING key,value,updated_at"},
  {key:SERVER1_CHECKPOINT_KEYS[1],before:before.checkpoints[1],after:after.checkpoints[1],sql:"UPDATE public.sync_state SET value=$1,updated_at=$2 WHERE key='keryx:registry-index:v1:eip155:5042:0x42a64061b6cd84067bb660b2a9b8aa881fd225bb:1:0x4fffb030de9d91ff1638b3a0c6b452d67d7794765b53babfc3a6bd20e6ae1949:lastSyncedBlock' AND value IS NOT DISTINCT FROM $3 AND updated_at IS NOT DISTINCT FROM $4 RETURNING key,value,updated_at"},
  {key:'sourceUpkeep',before:before.upkeep,after:after.upkeep,sql:"UPDATE public.sync_state SET value=$1,updated_at=$2 WHERE key='sourceUpkeep' AND value IS NOT DISTINCT FROM $3 AND updated_at IS NOT DISTINCT FROM $4 RETURNING key,value,updated_at"},
 ];
 for(const op of operations){const old=op.before.map(c=>nativeMaterializationCell(c,'text')),next=op.after.map(c=>nativeMaterializationCell(c,'text'));assert(old.every(v=>typeof v==='string')&&next.every(v=>typeof v==='string'));assert.equal(old[0],op.key);assert.equal(next[0],op.key);frame();emit({event:'fixed-sync-row-cas-intent',keySha256:sha(op.key)});const changed=await pg.query(op.sql,[next[1],next[2],old[1],old[2]]);frame();assert.equal(changed.rowCount,1);assert.deepEqual(changed.rows,[{key:op.key,value:next[1],updated_at:next[2]}]);}
 for(const table of ['activation_events','rate_limit_counters'] as const){
  const old=table==='activation_events'?before.activationRows:before.rateRows,next=table==='activation_events'?after.activationRows:after.rateRows;
  for(const change of validateServer1OperationalTable(table,old,next,after.operationalUntil)){
   const prior=change.before?sourceOperationalRow(table,change.before,after.operationalUntil).values:null,current=change.after?sourceOperationalRow(table,change.after,after.operationalUntil).values:null;frame();emit({event:'fixed-operational-row-cas-intent',table,operation:!prior?'insert':!current?'delete':'update',keySha256:sha(snapshotRowWire((change.after??change.before)!.slice(0,table==='activation_events'?2:1)))});
   let changed;
   if(table==='activation_events'){
    assert(current);changed=prior?await pg.query('UPDATE public.activation_events SET count=$3::integer WHERE day=$1::date AND event=$2::text AND count=$4::integer RETURNING day::text AS day,event,count::text AS count',[current[0],current[1],current[2],prior[2]]):await pg.query('INSERT INTO public.activation_events(day,event,count) SELECT $1::date,$2::text,$3::integer WHERE NOT EXISTS(SELECT 1 FROM public.activation_events WHERE day=$1::date AND event=$2::text) RETURNING day::text AS day,event,count::text AS count',current);
    frame();assert.equal(changed.rowCount,1);assert.deepEqual(changed.rows,[{day:current[0],event:current[1],count:current[2]}]);
   }else{
    changed=!current?await pg.query('DELETE FROM public.rate_limit_counters WHERE bucket=$1::text AND count=$2::integer AND reset_at=$3::bigint RETURNING bucket,count::text AS count,reset_at::text AS reset_at',prior!):prior?await pg.query('UPDATE public.rate_limit_counters SET count=$2::integer,reset_at=$3::bigint WHERE bucket=$1::text AND count=$4::integer AND reset_at=$5::bigint RETURNING bucket,count::text AS count,reset_at::text AS reset_at',[current[0],current[1],current[2],prior[1],prior[2]]):await pg.query('INSERT INTO public.rate_limit_counters(bucket,count,reset_at) SELECT $1::text,$2::integer,$3::bigint WHERE NOT EXISTS(SELECT 1 FROM public.rate_limit_counters WHERE bucket=$1::text) RETURNING bucket,count::text AS count,reset_at::text AS reset_at',current);
    const expected=current??prior!;frame();assert.equal(changed.rowCount,1);assert.deepEqual(changed.rows,[{bucket:expected[0],count:expected[1],reset_at:expected[2]}]);
   }
  }
 }
 const content=validateServer1ContentTables(before,after,{sourceRows:after.sourceRows,identityDigest:after.storageIdentityDigest,until:after.operationalUntil});
 for(const change of content.cache){
  const old=change.before.map(c=>nativeMaterializationCell(c,'text')),next=change.after.map(c=>nativeMaterializationCell(c,'text'));frame();emit({event:'fixed-source-cache-invalidation-cas-intent',keySha256:sha(snapshotRowWire(change.after.slice(0,1)))});
  const result=await pg.query('UPDATE public.cache_items SET text=$2::text,updated_at=$3::text WHERE source_id=$1::text AND text IS NOT DISTINCT FROM $4::text AND updated_at IS NOT DISTINCT FROM $5::text RETURNING source_id,text,updated_at',[next[0],next[1],next[2],old[1],old[2]]);frame();assert.equal(result.rowCount,1);assert.deepEqual(result.rows,[{source_id:next[0],text:next[1],updated_at:next[2]}]);
 }
 for(const row of content.items){
  const item=sourceUpkeepItem(row);frame();emit({event:'fixed-source-upkeep-item-insert-intent',keySha256:sha(snapshotRowWire(row.slice(0,1)))});
  const result=await pg.query('INSERT INTO public.source_items(id,source_id,title,summary,content,link,published_at,ipfs_cid,item_key_enc,item_iv,item_auth_tag,item_wrap_iv,delivery_kind,storage_mode,plaintext_bytes,body_hash,manifest_id,manifest_signer,manifest_nonce,manifest_signature,manifest_created_at,evidence_provenance) SELECT $1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::text,$10::text,$11::text,$12::text,$13::text,$14::text,$15::integer,$16::text,$17::text,$18::text,$19::text,$20::text,$21::text,$22::text WHERE NOT EXISTS(SELECT 1 FROM public.source_items WHERE id=$1::text OR source_id=$2::text AND link=$6::text) RETURNING id,source_id,title,summary,content,link,published_at,ipfs_cid,item_key_enc,item_iv,item_auth_tag,item_wrap_iv,delivery_kind,storage_mode,plaintext_bytes::text AS plaintext_bytes,body_hash,manifest_id,manifest_signer,manifest_nonce,manifest_signature,manifest_created_at,evidence_provenance',item.values);frame();assert.equal(result.rowCount,1);assert.deepEqual(result.rows,[Object.fromEntries(SERVER1_CONTENT_ITEM_COLUMNS.map((name,i)=>[name,item.values[i]]))]);
 }
 for(const table of ['sync','activation','rate'] as const){const digest=createHash('sha256');let seen=0;
  if(table==='sync')await pg.query('DECLARE cutover_sync NO SCROLL CURSOR FOR SELECT key,value,updated_at FROM public.sync_state ORDER BY key COLLATE "C"');else if(table==='activation')await pg.query('DECLARE cutover_activation NO SCROLL CURSOR FOR SELECT day::text AS day,event,count::text AS count FROM public.activation_events ORDER BY day::text COLLATE "C",event COLLATE "C"');else await pg.query('DECLARE cutover_rate NO SCROLL CURSOR FOR SELECT bucket,count::text AS count,reset_at::text AS reset_at FROM public.rate_limit_counters ORDER BY bucket COLLATE "C"');frame();
  for(;;){const page=await pg.query(table==='sync'?'FETCH FORWARD 8 FROM cutover_sync':table==='activation'?'FETCH FORWARD 8 FROM cutover_activation':'FETCH FORWARD 8 FROM cutover_rate');frame();for(const row of page.rows){const cells=table==='sync'?[row.key,row.value,row.updated_at]:table==='activation'?[row.day,row.event,row.count]:[row.bucket,row.count,row.reset_at];assert(cells.every(v=>typeof v==='string'||v===null));digest.update(JSON.stringify(cells.map((v,i)=>nativeMaterializationValueKey(table==='sync'?'text':table==='activation'?(i===0?'date':i===1?'text':'integer'):(i===0?'text':i===1?'integer':'bigint'),v)))).update('\n');seen++;}if(page.rowCount===0)break;}
  if(table==='sync')await pg.query('CLOSE cutover_sync');else if(table==='activation')await pg.query('CLOSE cutover_activation');else await pg.query('CLOSE cutover_rate');frame();assert.equal(seen,after.tables.find(t=>t.name===(table==='sync'?'sync_state':table==='activation'?'activation_events':'rate_limit_counters'))!.rows);assert.equal(digest.digest('hex'),table==='sync'?after.syncSemanticDigest:table==='activation'?after.activationSemanticDigest:after.rateSemanticDigest);
 }
 for(const table of ['cache','items'] as const){const digest=createHash('sha256');let seen=0;
  if(table==='cache')await pg.query('DECLARE cutover_cache NO SCROLL CURSOR FOR SELECT source_id,text,updated_at FROM public.cache_items ORDER BY source_id COLLATE "C"');else await pg.query('DECLARE cutover_items NO SCROLL CURSOR FOR SELECT id,source_id,title,summary,content,link,published_at,ipfs_cid,item_key_enc,item_iv,item_auth_tag,item_wrap_iv,delivery_kind,storage_mode,plaintext_bytes::text AS plaintext_bytes,body_hash,manifest_id,manifest_signer,manifest_nonce,manifest_signature,manifest_created_at,evidence_provenance FROM public.source_items ORDER BY id COLLATE "C"');frame();
  for(;;){const page=await pg.query(table==='cache'?'FETCH FORWARD 8 FROM cutover_cache':'FETCH FORWARD 8 FROM cutover_items');frame();for(const row of page.rows){const values=(table==='cache'?['source_id','text','updated_at']:SERVER1_CONTENT_ITEM_COLUMNS).map((name,i)=>{const value=row[name];assert(typeof value==='string'||value===null);return nativeMaterializationValueKey(table==='items'&&i===14?'integer':'text',value);});digest.update(JSON.stringify(values)).update('\n');seen++;}if(page.rowCount===0)break;}
  if(table==='cache')await pg.query('CLOSE cutover_cache');else await pg.query('CLOSE cutover_items');frame();assert.equal(seen,after.tables.find(t=>t.name===(table==='cache'?'cache_items':'source_items'))!.rows);assert.equal(digest.digest('hex'),table==='cache'?after.cacheSemanticDigest:after.itemSemanticDigest);
 }

}

const cutoverUnit='keryx-postgres-native-cutover.service',pgUnit='postgresql@17-keryx.service',pgGroup='/system.slice/system-postgresql.slice/'+pgUnit;
const pgDropin='/etc/systemd/system/postgresql@17-keryx.service.d/20-keryx-preparation.conf';
function properties(wire:string){const pairs=wire.trim().split('\n').map(line=>{const at=line.indexOf('=');assert(at>0);return [line.slice(0,at),line.slice(at+1)];});assert.equal(new Set(pairs.map(p=>p[0])).size,pairs.length);return Object.fromEntries(pairs);}
async function completeEmptyExecProperties(unit:'pm2-root.service'|'keryx-public-roles.service',value:Record<string,string>,frame:()=>void){
 const fixed=unit==='pm2-root.service'?[['/org/freedesktop/systemd1/unit/pm2_2droot_2eservice','ExecStop']]:unit==='keryx-public-roles.service'?[['/org/freedesktop/systemd1/unit/keryx_2dpublic_2droles_2eservice','ExecStop'],['/org/freedesktop/systemd1/unit/keryx_2dpublic_2droles_2eservice','ExecStopPost']]:refuse('exec_unit');
 for(const [object,property]of fixed){if(Object.prototype.hasOwnProperty.call(value,property))continue;frame();const wire=await command('/usr/bin/busctl',['--system','get-property','org.freedesktop.systemd1',object,'org.freedesktop.systemd1.Service',property],1024,5000);frame();assert.equal(wire,'a(sasbttttuii) 0\n');value[property]='';}return value;
}
function privateDirectory(path:string){parentFrame(path+'/file');const s=lstatSync(path,{bigint:true});assert(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===BigInt(0)&&s.gid===BigInt(0)&&(s.mode&BigInt(0o777))===BigInt(0o700));return [s.dev,s.ino,s.uid,s.gid,s.mode].join(':');}
function containment(){
 assert.equal(process.platform,'linux');assert.equal(process.version,'v24.22.1');assert.equal(process.getuid!(),0);assert.equal(process.cwd(),'/root/keryx');assert.equal(process.argv[1],SERVER1_CUTOVER.bundle);assert.deepEqual(process.execArgv,['--no-warnings','--max-old-space-size=256']);
 assert.equal(readFileSync('/proc/self/cgroup','utf8').trim(),'0::/system.slice/'+cutoverUnit);assert.deepEqual(readdirSync('/sys/class/net').sort(),['lo']);
 for(const [key,value]of [['memory.max','536870912'],['memory.swap.max','0'],['cpu.max','100000 100000'],['pids.max','64']])assert.equal(readFileSync('/sys/fs/cgroup/system.slice/'+cutoverUnit+'/'+key,'utf8').trim(),value);
 const status=readFileSync('/proc/self/status','utf8');assert(/^CapEff:\s+0+$/m.test(status)&&/^NoNewPrivs:\s+1$/m.test(status));assert.equal(readFileSync('/proc/net/route','utf8').trim().split('\n').length,1);
 privateDirectory(SERVER1_CUTOVER.archive);privateDirectory(SERVER1_CUTOVER.maintenance);assert.equal(process.env.KERYX_NETWORK,'arc');assert.equal(process.env.NEXT_PUBLIC_KERYX_NETWORK,'arc');assert.equal(process.env.KERYX_FORCE_OFFLINE,'0');
}
const serviceProperties=['LoadState','ActiveState','SubState','UnitFileState','User','Group','Type','DropInPaths','RuntimeDirectory','RuntimeDirectoryMode','MemoryMax','MemorySwapMax','CPUQuotaPerSecUSec','TasksMax','NoNewPrivileges','CapabilityBoundingSet','MainPID','FragmentPath','ExecStart','ControlGroup'] as const;
async function preparedRuntime(c:Inputs,frame:()=>void){
 frame();await assertServer1PlatformCurrent();frame();
 const observe=async()=>{const p=properties(await command('/usr/bin/systemctl',['show',pgUnit,'--all',...serviceProperties.map(v=>'--property='+v)]));frame();exact(p,[...serviceProperties]);
  for(const [key,value]of Object.entries({LoadState:'loaded',ActiveState:'active',SubState:'running',UnitFileState:'enabled',User:'postgres',Group:'root',Type:'simple',DropInPaths:pgDropin,RuntimeDirectory:'postgresql-keryx',RuntimeDirectoryMode:'0750',MemoryMax:'1073741824',MemorySwapMax:'0',CPUQuotaPerSecUSec:'750ms',TasksMax:'64',NoNewPrivileges:'yes',CapabilityBoundingSet:'',ControlGroup:pgGroup}))assert.equal(p[key],value);
  assert(/^[1-9][0-9]{0,9}$/.test(p.MainPID));assert(['/lib/systemd/system/postgresql@.service','/usr/lib/systemd/system/postgresql@.service'].includes(p.FragmentPath));assert(p.ExecStart.includes('path=/usr/lib/postgresql/17/bin/postgres ; argv[]=/usr/lib/postgresql/17/bin/postgres -D /var/lib/postgresql/17/keryx -c config_file=/etc/postgresql/17/keryx/postgresql.conf ;'));
  const status=readFileSync('/proc/'+p.MainPID+'/status','utf8'),uid=String(record(c.preparation.observations).socketDirectoryUid);assert(/^CapEff:\s+0+$/m.test(status)&&/^NoNewPrivs:\s+1$/m.test(status));const actualUid=status.match(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/m);assert(actualUid&&actualUid.slice(1).every(v=>v===uid));assert.equal(readFileSync('/proc/'+p.MainPID+'/cgroup','utf8').trim(),'0::'+pgGroup);
  for(const [key,value]of [['memory.max','1073741824'],['memory.swap.max','0'],['pids.max','64']])assert.equal(readFileSync('/sys/fs/cgroup'+pgGroup+'/'+key,'utf8').trim(),value);const cpu=readFileSync('/sys/fs/cgroup'+pgGroup+'/cpu.max','utf8').trim().split(' ').map(Number);assert(cpu.length===2&&cpu.every(v=>Number.isSafeInteger(v)&&v>0)&&cpu[0]/cpu[1]===0.75);return p;
 };
 const first=await observe(),vendor=pin(realpathSync(first.FragmentPath),65536,false);try{assert.equal(await fileSha(vendor),hash(c.preparation.vendorUnitSha256));frame();assert.deepEqual(await observe(),first);vendor.frame();}finally{vendor.close();}frame();
}
const quote=(s:string)=>{assert(/^[a-z][a-z0-9_]{0,62}$/.test(s));return '"'+s+'"';};
async function pgGuard(pg:Client,database:'keryx_source'|'keryx_mainnet',c:Inputs,frame:()=>void,hba:'initial'|'runtime'){
 frame();const p=c.preparation,h=c.held;
 const result=await pg.query(`SELECT current_database() name,session_user role,current_user current_role,current_setting('server_version_num') version,current_setting('port') port,current_setting('data_directory') directory,current_setting('unix_socket_directories') socket,current_setting('unix_socket_group') socket_group,current_setting('unix_socket_permissions') socket_mode,current_setting('listen_addresses') listeners,current_setting('fsync') fsync,current_setting('synchronous_commit') synchronous_commit,current_setting('full_page_writes') full_page_writes,current_setting('data_checksums') data_checksums,(SELECT system_identifier::text FROM pg_control_system()) system_identifier,(SELECT oid::text FROM pg_database WHERE datname=current_database()) oid`);frame();assert.equal(result.rowCount,1);const r=result.rows[0];
 for(const [key,value]of Object.entries({name:database,role:'postgres',current_role:'postgres',version:'170012',port:'5432',directory:'/var/lib/postgresql/17/keryx',socket,socket_group:'root',socket_mode:'0770',listeners:'',fsync:'on',synchronous_commit:'on',full_page_writes:'on',data_checksums:'on',system_identifier:p.systemIdentifier,oid:database==='keryx_source'?h.sourceDatabaseOid:h.targetDatabaseOid}))assert.equal(r[key],value);assert.equal(r.system_identifier,h.systemIdentifier);
 const directory=lstatSync(socket,{bigint:true}),endpoint=lstatSync(socket+'/.s.PGSQL.5432',{bigint:true});assert(directory.isDirectory()&&!directory.isSymbolicLink()&&directory.uid===BigInt(Number(record(p.observations).socketDirectoryUid))&&directory.gid===BigInt(0)&&(directory.mode&BigInt(0o777))===BigInt(0o750));assert(endpoint.isSocket()&&endpoint.uid===directory.uid&&endpoint.gid===BigInt(0)&&(endpoint.mode&BigInt(0o777))===BigInt(0o770));
 const configs=await pg.query(`SELECT encode(sha256(pg_read_binary_file(current_setting('config_file'))),'hex') postgresql,encode(sha256(pg_read_binary_file(current_setting('hba_file'))),'hex') hba,encode(sha256(pg_read_binary_file(current_setting('ident_file'))),'hex') ident`);frame();for(const key of ['postgresql','hba','ident'])assert.equal(configs.rows[0][key],key==='hba'&&hba==='runtime'?p.runtimeHbaTemplateSha256:record(p.configHashes)[key]);
 const access=await pg.query(`SELECT r.rolname,r.rolsuper,r.rolbypassrls,has_database_privilege(r.oid,d.oid,'CONNECT') can_connect FROM pg_roles r CROSS JOIN pg_database d WHERE r.rolname IN('keryx_app','keryx_reader') AND d.datname=current_database() ORDER BY r.rolname`);frame();assert.deepEqual(access.rows,[{rolname:'keryx_app',rolsuper:false,rolbypassrls:false,can_connect:true},{rolname:'keryx_reader',rolsuper:false,rolbypassrls:false,can_connect:true}]);
 const errors=await pg.query('SELECT count(*)::text n FROM pg_hba_file_rules WHERE error IS NOT NULL');assert.equal(errors.rows[0].n,'0');frame();
 if(hba==='initial'){await hbaRejected(database,'keryx_app');frame();await hbaRejected(database,'keryx_reader');frame();}
 const owner=await pg.query('SELECT r.rolname owner,d.datconnlimit connection_limit FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datname=current_database()');frame();assert.deepEqual(owner.rows,[{owner:'postgres',connection_limit:16}]);
 const sessions=await pg.query("SELECT count(*)::text n FROM pg_stat_activity WHERE datname IN('keryx_source','keryx_mainnet') AND usename<>'postgres'");frame();assert.equal(sessions.rows[0].n,'0');
}
async function targetGuard(pg:Client,c:Inputs,frame:()=>void,mode:'held'|'active'='held'){
 frame();assert.equal((await pg.query('SELECT mode FROM keryx_storage.control WHERE singleton')).rows[0]?.mode,mode);frame();
 const wire=(await pg.query("WITH observed AS MATERIALIZED(SELECT keryx_storage.catalog_contract()::text wire) SELECT CASE WHEN octet_length(wire)<=8388608 THEN wire END wire FROM observed")).rows[0]?.wire;frame();const catalog=exportNativePostgresSchemaContract(wire);assert.equal(catalog.sha256,SERVER1_CUTOVER.catalogSha256);
 const selected=await pg.query('SELECT identity::text wire,identity_digest FROM keryx_storage.identity WHERE singleton');frame();assert.equal(selected.rowCount,1);assert.equal(canonicalJson(JSON.parse(selected.rows[0].wire)),canonicalJson(c.identity));assert.equal(selected.rows[0].identity_digest,storageIdentityDigest(c.identity));assert.equal((await pg.query('SELECT source_digest FROM keryx_storage.source_contract WHERE singleton')).rows[0]?.source_digest,SERVER1_CUTOVER.catalogSha256);frame();
 for(const [schema,name]of [['keryx_storage','writer'],['public','browser_journal_writer'],['public','browser_signing_v2_writer'],['public','browser_signing_v3_writer']]){assert.equal((await pg.query('SELECT count(*)::text n FROM '+schema+'.'+quote(name))).rows[0]?.n,'0');frame();}
 const relations=record(catalog.metadata.sections).relations;assert(Array.isArray(relations));const names=relations.map(record).filter(r=>(r.schema==='public'||r.schema==='keryx_storage')&&r.kind==='r').map(r=>quote(String(r.schema))+'.'+quote(String(r.name))).sort();assert(names.length>=108&&names.length<=256);return {wire,lock:'LOCK TABLE '+names.join(',')+' IN SHARE ROW EXCLUSIVE MODE'};
}

type ProcessFrame={pid:number;start:string;command:string};
function processFrame(pid:number):ProcessFrame{
 assert(Number.isSafeInteger(pid)&&pid>1);const directory=lstatSync('/proc/'+pid,{bigint:true});assert(directory.isDirectory()&&directory.uid===BigInt(0));const stat=readFileSync('/proc/'+pid+'/stat','utf8'),end=stat.lastIndexOf(') ');assert(end>0);const fields=stat.slice(end+2).trim().split(' ');assert(fields.length>=20&&fields[0]!=='Z');return {pid,start:fields[19],command:readFileSync('/proc/'+pid+'/cmdline').toString('hex')};
}
function sameProcess(frame:ProcessFrame){assert.deepEqual(processFrame(frame.pid),frame);}
function gone(frame:ProcessFrame){try{const current=processFrame(frame.pid);assert.equal(current.start,frame.start);return false;}catch(error){if(error&&typeof error==='object'&&Reflect.get(error,'code')==='ENOENT')return true;throw error;}}
async function until(check:()=>Promise<boolean>|boolean,frame:()=>void,milliseconds:number){const deadline=performance.now()+milliseconds;while(true){frame();if(await check()){frame();return;}assert(performance.now()<deadline);await new Promise<void>(done=>setTimeout(done,25));}}
type RoleFrame={name:string;id:number;pid:number;status:string;autorestart:boolean;kill_timeout:number;restarts:number;exit_code:unknown;exec:string;cwd:string;interpreter:string;args:unknown};
export function parseServer1SourceRoles(raw:unknown):readonly RoleFrame[]{
 assert(Array.isArray(raw)&&raw.length===2&&Buffer.byteLength(JSON.stringify(raw))<=1048576);const rows=raw.map(item=>{const r=record(item),e=record(r.pm2_env);return {name:String(r.name??e.name),id:r.pm_id??e.pm_id,pid:r.pid??record(r.process).pid,status:e.status,autorestart:e.autorestart,kill_timeout:e.kill_timeout,restarts:e.restart_time,exit_code:e.exit_code,exec:e.pm_exec_path,cwd:e.pm_cwd,interpreter:e.exec_interpreter,args:Array.isArray(e.args)?Object.freeze([...e.args]):e.args};}).sort((a,b)=>a.name<b.name?-1:1) as RoleFrame[];
 assert.deepEqual(rows.map(r=>r.name),['keryx','keryx-a2a-worker']);assert.equal(new Set(rows.map(r=>r.id)).size,2);assert.equal(new Set(rows.map(r=>r.pid)).size,2);
 for(const r of rows){assert(Number.isSafeInteger(r.id)&&r.id>=0&&Number.isSafeInteger(r.pid)&&r.pid>1&&Number.isSafeInteger(r.restarts)&&r.restarts>=0);assert.equal(r.status,'online');assert.equal(r.autorestart,true);assert.equal(r.kill_timeout,330000);assert.equal(r.exec,'/usr/bin/env');assert.equal(r.cwd,'/root/keryx');assert.equal(r.interpreter,'none');assert(Array.isArray(r.args)&&r.args.every(v=>typeof v==='string')&&Buffer.byteLength(JSON.stringify(r.args))<=16384);}
 return Object.freeze(rows.map(r=>Object.freeze(r)));
}
type Rpc={call:(method:string,data:Json,cb:(error:unknown,data:unknown)=>void)=>void;sock:{connected:boolean;closing:boolean;retry:number;set:(name:string,value:number)=>void;close:()=>void}};
type PmApi={Client:{client:Rpc;launchRPC:(cb:(error:unknown)=>void)=>void;killDaemon:(cb:(error:unknown)=>void)=>void}};
type Lease={api:PmApi;rpc:Rpc;sock:Rpc['sock'];process:ProcessFrame};
const pm2Hashes={
 'lib/God.js':'fb1f0e352d8356d8b00ae19a52c0f58baf0ff6c55a624b8a245d9f9cfecf3b24',
 'lib/God/ActionMethods.js':'4fc5442ff948a0e61d147629e8ff584de417b7fa6ba013791c7ada706ba2f96e',
 'lib/Client.js':'535b4b98bdba8251ddd5480f71f327c89393dbfa28f00c568a74ba5984162a7b',
 'lib/Daemon.js':'a558268d79a0a73116ff3327a62bb88abde101250a19c18a9dca74059bdc022f',
};
function pm2Source(){
 const executable=realpathSync('/usr/bin/pm2');assert(executable.endsWith('/pm2/bin/pm2'));const path=dirname(dirname(executable)),pins:Pin[]=[];
 try{for(const [leaf,expected]of Object.entries(pm2Hashes)){const p=pin(path+'/'+leaf,1048576,false);pins.push(p);assert.equal(sha(bytes(p,1048576)),expected);}const pkg=pin(path+'/package.json',65536,false);pins.push(pkg);assert.equal(json(pkg).version,'7.0.1');const PM2=createRequire('/root/keryx/package.json')(path) as {custom:new(options:{pm2_home:string})=>PmApi};assert.equal(typeof PM2.custom,'function');return {PM2,frame:()=>pins.forEach(p=>p.frame()),close:()=>pins.forEach(p=>p.close())};}catch(error){for(const p of pins)p.close();throw error;}
}
function managerPid(){const file=pin('/root/.pm2/pm2.pid',64,false);try{const value=bytes(file).toString('ascii');assert(/^[1-9][0-9]*\n?$/.test(value));return Number(value);}finally{file.close();}}
function closeRpc(lease:Lease){lease.sock.set('retry timeout',0);lease.sock.retry=0;lease.sock.close();}
function leaseGuard(lease:Lease){assert.equal(lease.api.Client.client,lease.rpc);assert(lease.sock.connected===true&&!lease.sock.closing);assert.equal(managerPid(),lease.process.pid);sameProcess(lease.process);}
async function connectOnly(source:ReturnType<typeof pm2Source>,frame:()=>void):Promise<Lease>{
 frame();source.frame();const captured=processFrame(managerPid()),api=new source.PM2.custom({pm2_home:'/root/.pm2'});let sock:Rpc['sock']|undefined,rpc:Rpc|undefined;
 try{await new Promise<void>((accept,reject)=>{const timer=setTimeout(()=>{sock?.close();reject(Error('Cutover connect-only unavailable'));},3000);api.Client.launchRPC(error=>{clearTimeout(timer);error?reject(Error('Cutover connect-only unavailable')):accept();});rpc=api.Client.client;assert(rpc&&rpc.sock);sock=rpc.sock;sock.set('retry timeout',0);sock.retry=0;});frame();assert(rpc&&sock);const lease={api,rpc,sock,process:captured};leaseGuard(lease);return lease;}catch(error){if(sock){sock.set('retry timeout',0);sock.retry=0;sock.close();}throw error;}
}
async function rpc(lease:Lease,method:'ping'|'getMonitorData'|'stopProcessId',data:Json,frame:()=>void){
 frame();leaseGuard(lease);const result=await new Promise<unknown>((accept,reject)=>{const timer=setTimeout(()=>reject(Error('Cutover RPC unavailable')),3000);lease.rpc.call(method,data,(error,value)=>{clearTimeout(timer);error?reject(Error('Cutover RPC unavailable')):accept(value);});});frame();leaseGuard(lease);return result;
}
function stoppedRows(raw:unknown,old:readonly RoleFrame[],zero:boolean|ReadonlySet<number>){
 assert(Array.isArray(raw)&&raw.length===2);for(const expected of old){const rows:Json[]=raw.map(record).filter(r=>(r.name??record(r.pm2_env).name)===expected.name);assert.equal(rows.length,1);const r=rows[0],e=record(r.pm2_env);assert.equal(r.pm_id??e.pm_id,expected.id);assert.equal(e.status,'stopped');assert.equal(e.restart_time,expected.restarts);assert.equal(e.exit_code,expected.name==='keryx'?130:0);assert.equal(e.autorestart,true);assert.equal(e.kill_timeout,330000);assert.equal(e.pm_exec_path,expected.exec);assert.equal(e.pm_cwd,expected.cwd);assert.equal(e.exec_interpreter,expected.interpreter);assert.equal(canonicalJson(e.args),canonicalJson(expected.args));assert.equal(r.pid,(typeof zero==='boolean'?zero:zero.has(expected.id))?0:expected.pid);}return true;
}
async function pm2Service(frame:()=>void){
 const p=properties(await command('/usr/bin/systemctl',['show','pm2-root.service','--all','--property=ExecStart,ExecStop,Restart,KillMode,SendSIGKILL,TimeoutStopUSec']));frame();await completeEmptyExecProperties('pm2-root.service',p,frame);exact(p,['ExecStart','ExecStop','Restart','KillMode','SendSIGKILL','TimeoutStopUSec']);assert(p.ExecStart.includes('path=/usr/bin/pm2 ; argv[]=/usr/bin/pm2 ping ;'));for(const [key,value]of Object.entries({ExecStop:'',Restart:'no',KillMode:'process',SendSIGKILL:'no',TimeoutStopUSec:'infinity'}))assert.equal(p[key],value);
}
async function drainSource(lease:Lease,old:readonly RoleFrame[],os:readonly ProcessFrame[],frame:()=>void,emit:(event:Json)=>void){
 assert.deepEqual(parseServer1SourceRoles(await rpc(lease,'getMonitorData',{},frame)),old);for(const p of os)sameProcess(p);
 // Qualified PM2 7.0.1: callback intentionally never fires. Same captured
 // client ping + exact monitor frame is the ordering barrier, no reconnect.
 frame();leaseGuard(lease);emit({event:'restart-suppression-intent'});lease.rpc.call('notifyKillPM2',{},()=>{});
 assert.equal(record(await rpc(lease,'ping',{},frame)).msg,'pong');assert.deepEqual(parseServer1SourceRoles(await rpc(lease,'getMonitorData',{},frame)),old);emit({event:'restart-suppression-barrier'});
 const from=Date.now();for(const p of os){frame();sameProcess(p);emit({event:'natural-sigint-intent',pid:p.pid});process.kill(p.pid,'SIGINT');}
 await until(async()=>{const rows=await rpc(lease,'getMonitorData',{},frame);if(!os.every(gone))return false;stoppedRows(rows,old,false);return true;},frame,330000);const untilAt=Date.now();emit({event:'source-natural-exits',webExit:130,workerExit:0});
 await new Promise<void>(done=>setTimeout(done,1250));frame();stoppedRows(await rpc(lease,'getMonitorData',{},frame),old,false);assert(os.every(gone));
 const zero=new Set<number>();for(const row of old){frame();assert(os.every(gone));stoppedRows(await rpc(lease,'getMonitorData',{},frame),old,zero);await rpc(lease,'stopProcessId',{id:row.id},frame);zero.add(row.id);stoppedRows(await rpc(lease,'getMonitorData',{},frame),old,zero);}
 stoppedRows(await rpc(lease,'getMonitorData',{},frame),old,true);assert(os.every(gone));emit({event:'source-stopped-fastpaths'});
 frame();leaseGuard(lease);emit({event:'old-manager-close-intent'});
 try{await new Promise<void>((accept,reject)=>{const timer=setTimeout(()=>reject(Error('Cutover daemon close unavailable')),3000);lease.api.Client.killDaemon(error=>{clearTimeout(timer);error?reject(Error('Cutover daemon close unavailable')):accept();});});}finally{closeRpc(lease);}
 await until(()=>gone(lease.process),frame,5000);emit({event:'old-manager-ended'});return {from,until:untilAt};
}

/** Replace exactly one named JSON hash token. All other original bytes, key
 * order, whitespace and values remain unchanged. This is data, not admission. */
export function replaceServer1HashToken(wire:string,key:'cutoverReceiptSha256'|'compatibilityReviewSha256',before:string,after:string){
 assert(['cutoverReceiptSha256','compatibilityReviewSha256'].includes(key));hash(before);hash(after);assert(Buffer.byteLength(wire)<=65536);JSON.parse(wire);const pattern=new RegExp('"'+key+'"\\s*:\\s*"([a-f0-9]{64})"','g'),matches=[...wire.matchAll(pattern)];assert.equal(matches.length,1);assert.equal(matches[0][1],before);const at=matches[0].index!+matches[0][0].lastIndexOf(before);const result=wire.slice(0,at)+after+wire.slice(at+64);JSON.parse(result);return result;
}
function bootWire(commit:string,rolesSha:string){
 assert(/^[a-f0-9]{40}$/.test(commit));hash(rolesSha);const source=releaseSource(commit);return '[Unit]\nRequires=postgresql@17-keryx.service\nAfter=postgresql@17-keryx.service\n\n[Service]\nExecStart=\nExecStart=/usr/bin/node --env-file=/root/keryx/.env.local --import '+source+'/node_modules/tsx/dist/loader.mjs '+source+'/scripts/postgres/server1-native-bootstrap.mts '+SERVER1_CUTOVER.roles+' '+rolesSha+'\n';
}
function preparedRoles(c:Inputs,ops:ReleaseModule){
 const roles=ops.readReviewedRoles(SERVER1_CUTOVER.roles,String(c.intent.rolesSha256));assert(roles.release);const binding=roles.release;assert.equal(binding.commit,c.intent.targetCommit);assert.equal(binding.compatibilityReviewFile,SERVER1_CUTOVER.review);assert.equal(binding.compatibilityReviewSha256,c.intent.reviewSha256);assert.equal(binding.runtimeEnvironmentSha256,c.intent.runtimeEnvironmentSha256);assert.equal(binding.artifactReuseFile,undefined);assert.equal(binding.artifactReuseSha256,undefined);assert.equal(bytes(c.byPath.get(SERVER1_CUTOVER.dropin)!).toString('utf8'),bootWire(String(c.intent.targetCommit),String(c.intent.rolesSha256)));return roles;
}
function replaceHeld(c:Inputs,path:string,wire:Buffer,emit:(event:Json)=>void,mode=0o600){
 const old=c.byPath.get(path);assert(old);old.frame();const suffix=path===SERVER1_CUTOVER.roles?'roles.original.json':path===SERVER1_CUTOVER.review?'compatibility-review.original.json':path===SERVER1_CUTOVER.dropin?'native-boot.original.conf':refuse('mutable_control');
 const original=SERVER1_CUTOVER.archive+'/'+suffix;emit({event:'control-retention-intent',control:suffix,sha256:sha(bytes(old))});exclusive(original,bytes(old));const retained=pin(original,65536);c.pins.push(retained);assert.equal(sha(bytes(retained)),sha(bytes(old)));
 const next=path+'.next';emit({event:'control-rebind-intent',control:suffix,newSha256:sha(wire)});exclusive(next,wire,mode);old.frame();renameSync(next,path);syncParent(path);const current=pin(path,65536);assert.equal(sha(bytes(current)),sha(wire));c.pins.splice(c.pins.indexOf(old),1,current);c.byPath.set(path,current);old.close();emit({event:'control-rebind-ack',control:suffix,newSha256:sha(wire)});
}
function lateBind(c:Inputs,preview:Buffer,emit:(event:Json)=>void){
 const reviewWire=bytes(c.byPath.get(SERVER1_CUTOVER.review)!).toString('utf8'),rolesWire=bytes(c.byPath.get(SERVER1_CUTOVER.roles)!).toString('utf8'),review=record(JSON.parse(reviewWire)),native=record(review.nativeStorage);assert.equal(review.format,'keryx-reviewed-native-release-compatibility-v1');assert.equal(review.storageIdentityDigest,storageIdentityDigest(c.identity));assert.equal(native.sourceSqlSha256,SERVER1_CUTOVER.sourceSqlSha256);assert.equal(native.catalogSha256,SERVER1_CUTOVER.catalogSha256);assert.equal(native.runtimeManifestSha256,c.intent.runtimeManifestSha256);
 const boundReview=replaceServer1HashToken(reviewWire,'cutoverReceiptSha256',hash(native.cutoverReceiptSha256),sha(preview)),boundRoles=replaceServer1HashToken(rolesWire,'compatibilityReviewSha256',hash(c.intent.reviewSha256),sha(boundReview));
 const expectedReview=structuredClone(review);record(expectedReview.nativeStorage).cutoverReceiptSha256=sha(preview);assert.equal(canonicalJson(JSON.parse(boundReview)),canonicalJson(expectedReview));const expectedRoles=record(JSON.parse(rolesWire));record(expectedRoles.release).compatibilityReviewSha256=sha(boundReview);assert.equal(canonicalJson(JSON.parse(boundRoles)),canonicalJson(expectedRoles));
 emit({event:'unpublished-preview-intent',sha256:sha(preview)});exclusive(SERVER1_CUTOVER.archive+'/native-cutover.preview.json',preview);replaceHeld(c,SERVER1_CUTOVER.review,Buffer.from(boundReview),emit);replaceHeld(c,SERVER1_CUTOVER.roles,Buffer.from(boundRoles),emit);replaceHeld(c,SERVER1_CUTOVER.dropin,Buffer.from(bootWire(String(c.intent.targetCommit),sha(boundRoles))),emit);
 return sha(boundRoles);
}
function childCommand(commit:string,mode:'verify-artifact-only'|'verify-native-only'){
 return ['/usr/bin/node',['--no-warnings','--max-old-space-size=256',...(mode==='verify-native-only'?['--env-file='+SERVER1_CUTOVER.activeEnvironment,'--import',releaseSource(commit)+'/node_modules/tsx/dist/loader.mjs']:[]),SERVER1_CUTOVER.bundle,'--'+mode]] as const;
}
async function privateWorker(frame:()=>void){const p=properties(await command('/usr/bin/systemctl',['show','keryx-private-worker.service','--property=ActiveState,UnitFileState']));frame();assert.equal(p.ActiveState,'inactive');assert(!['enabled','enabled-runtime','linked','linked-runtime'].includes(p.UnitFileState));}
async function copyFinal(c:Inputs,frame:()=>void){
 const seed=sha(String(c.intent.windowId)),uuid=seed.slice(0,8)+'-'+seed.slice(8,12)+'-4'+seed.slice(13,16)+'-8'+seed.slice(17,20)+'-'+seed.slice(20,32),unit='keryx-provenance-'+uuid+'.service';frame();assert(!existsSync(SERVER1_CUTOVER.finalSnapshot));
 // Keep the qualified privileged-read snapshot recipe: its unchanged kernel
 // guard must read /proc/1/ns/net. The outer cutover remains CapEff0/NNP1.
 const wire=await command('/usr/bin/systemd-run',['--quiet','--wait','--pipe','--collect','--unit='+unit,'--property=MemoryMax=256M','--property=MemorySwapMax=0','--property=CPUQuota=50%','--property=TasksMax=32','--property=RuntimeMaxSec=30s','--property=PrivateNetwork=yes','--property=NoNewPrivileges=yes','--property=WorkingDirectory=/root/keryx','/usr/bin/node','--no-warnings','--max-old-space-size=128',SERVER1_CUTOVER.snapshotChild,SERVER1_CUTOVER.activeManifest,String(c.intent.oldManifestSha256),SERVER1_CUTOVER.finalSnapshot,unit],65536,35000);frame();
 const packet=record(JSON.parse(wire));assert.equal(packet.format,'keryx-consistent-online-sqlite-copy-v1');assert.equal(packet.backupComplete,true);assert.equal(packet.sourceManifestSha256,c.intent.oldManifestSha256);assert.equal(packet.schemaSha256,c.baseline.sourceSchemaSha256);const held=pin(SERVER1_CUTOVER.finalSnapshot,536870912);c.pins.push(held);assert.equal(await fileSha(held),hash(packet.sha256));frame();assert.equal(Number(held.initial.size),packet.bytes);checkSnapshotSidecars(SERVER1_CUTOVER.finalSnapshot);validateSnapshotHeader(held.fd);return {held,sha256:hash(packet.sha256)};
}
function journal(){
 const fd=openSync(SERVER1_CUTOVER.journal,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600),initial=fstatSync(fd,{bigint:true});syncParent(SERVER1_CUTOVER.journal);let length=0;
 const emit=(event:Json)=>{const s=lstatSync(SERVER1_CUTOVER.journal,{bigint:true}),live=fstatSync(fd,{bigint:true});assert(s.dev===initial.dev&&s.ino===initial.ino&&s.nlink===BigInt(1)&&s.uid===BigInt(0)&&(s.mode&BigInt(0o777))===BigInt(0o600)&&token(s)===token(live)&&Number(s.size)===length);const b=Buffer.from(JSON.stringify({at:new Date().toISOString(),...event})+'\n');assert(b.length<=16384&&length+b.length<=262144);let n=0;while(n<b.length){const count=writeSync(fd,b,n,b.length-n);assert(count>0);n+=count;}length+=b.length;fsyncSync(fd);syncParent(SERVER1_CUTOVER.journal);};return {emit,close:()=>closeSync(fd)};
}
function installFile(path:string,wire:Buffer,backup:string|undefined,emit:(event:Json)=>void,prior?:Pin,mode=0o600){
 parentFrame(path);if(prior){prior.frame();if(backup){emit({event:'original-retention-intent',file:basenameSafe(path),sha256:sha(bytes(prior))});exclusive(backup,bytes(prior));}}
 else assert(!existsSync(path));const next=path+'.native-next';emit({event:'file-switch-intent',file:basenameSafe(path),sha256:sha(wire)});exclusive(next,wire,mode);prior?.frame();if(!prior)assert(!existsSync(path));renameSync(next,path);syncParent(path);const current=pin(path,65536,mode===0o600);assert.equal(sha(bytes(current)),sha(wire));emit({event:'file-switch-ack',file:basenameSafe(path),sha256:sha(wire)});return current;
}
function basenameSafe(path:string){return path.slice(path.lastIndexOf('/')+1);}
async function scram(c:Inputs,role:'keryx_app'|'keryx_reader',frame:()=>void){
 const path=dirname(SERVER1_CUTOVER.activeManifest)+(role==='keryx_app'?'/postgres-app.json':'/postgres-reader.json'),p=c.byPath.get(path)!;p.frame();const credential=json(p);exact(credential,['format','password','role']);assert.equal(credential.format,'keryx-postgres-role-credential-v1');assert.equal(credential.role,role);assert(typeof credential.password==='string'&&/^[a-f0-9]{48}$/.test(credential.password));
 const pg=peer('keryx_mainnet',role,credential.password);let sasl=0,final=0;
 const connection=Reflect.get(pg,'connection') as {on:(name:string,cb:(value:unknown)=>void)=>void;removeListener:(name:string,cb:(value:unknown)=>void)=>void};assert(connection&&typeof connection.on==='function');
 let validMechanism=false;const start=(value:unknown)=>{if(value&&typeof value==='object'){const mechanisms=Reflect.get(value,'mechanisms');validMechanism=Array.isArray(mechanisms)&&mechanisms.includes('SCRAM-SHA-256');}sasl++;},finish=()=>{final++;};connection.on('authenticationSASL',start);connection.on('authenticationSASLFinal',finish);
 try{frame();await pg.connect();frame();assert.equal(sasl,1);assert.equal(final,1);assert(validMechanism);const result=await pg.query('SELECT current_user role,current_database() database');frame();assert.deepEqual(result.rows,[{role,database:'keryx_mainnet'}]);}finally{await pg.end();connection.removeListener('authenticationSASL',start);connection.removeListener('authenticationSASLFinal',finish);}frame();
}

function receiptPreview(c:Inputs,final:Inventory,snapshotSha256:string,nativeCensusSha256:string){
 const result={format:'keryx-server1-native-cutover-v1',phase:'complete',sourceCommit:SERVER1_CUTOVER.sourceCommit,targetCommit:c.intent.targetCommit,sourceManifestSha256:c.intent.oldManifestSha256,runtimeManifestSha256:c.intent.runtimeManifestSha256,identityDigest:storageIdentityDigest(c.identity),sourceSqlSha256:SERVER1_CUTOVER.sourceSqlSha256,catalogSha256:SERVER1_CUTOVER.catalogSha256,finalSnapshotSha256:snapshotSha256,finalSchemaSha256:final.schemaSha256,finalDataDigest:final.dataDigest,nativeCensusSha256,publicPolicySha256:SERVER1_CUTOVER.publicPolicySha256,sourceWritersNaturallyEnded:true,sourceStartupRetired:true,sourceManifestRetired:true,privateWorkerInactive:true,pendingOriginalsPreserved:true,targetMode:'active',activationOutcome:'acknowledged',runtimeHbaVerified:true,newFunding:false,financialPolicyChanged:false,createdAt:c.intent.createdAt};
 exact(result,[...completeFields]);return Buffer.from(JSON.stringify(result)+'\n');
}
/** Fixed child, fresh process config. This never accepts identity/proof handles,
 * never opens a writer and never publishes a receipt. The preview is ONLY a
 * future byte binding for the artifact stage; it supplies no observed witness. */
async function child(mode:'verify-native-only'|'verify-artifact-only'){
 assert.equal(process.platform,'linux');assert.equal(process.getuid!(),0);assert.equal(process.version,'v24.22.1');assert.equal(process.cwd(),'/root/keryx');assert.equal(process.argv[1],SERVER1_CUTOVER.bundle);assert.equal(readFileSync('/proc/self/cgroup','utf8').trim(),'0::/system.slice/'+cutoverUnit);assert.equal(readFileSync('/sys/fs/cgroup/system.slice/'+cutoverUnit+'/memory.max','utf8').trim(),'536870912');assert.equal(readFileSync('/sys/fs/cgroup/system.slice/'+cutoverUnit+'/memory.swap.max','utf8').trim(),'0');assert.deepEqual(readdirSync('/sys/class/net').sort(),['lo']);
 const held:Pin[]=[];const take=(path:string,max=65536)=>{const p=pin(path,max);held.push(p);return p;};let store:unknown,closeStore:(()=>Promise<void>)|undefined;
 try{
  const intent=parseServer1CutoverIntent(json(take(SERVER1_CUTOVER.intent))),commit=String(intent.targetCommit);assert.deepEqual(process.execArgv,childCommand(commit,mode)[1].slice(0,-2));const template=take(SERVER1_CUTOVER.expected);assert.equal(sha(bytes(template)),intent.receiptTemplateSha256);parseServer1CutoverReceiptTemplate(json(template),intent);const bundle=take(SERVER1_CUTOVER.bundle,4194304);assert.equal(await fileSha(bundle),intent.cutoverBundleSha256);
  const currentRoles=take(SERVER1_CUTOVER.roles),currentReview=take(SERVER1_CUTOVER.review),currentBoot=take(SERVER1_CUTOVER.dropin),previewPath=SERVER1_CUTOVER.archive+'/native-cutover.preview.json';let rolesSha=String(intent.rolesSha256);
  if(existsSync(previewPath)){
   const originalRoles=take(SERVER1_CUTOVER.archive+'/roles.original.json'),originalReview=take(SERVER1_CUTOVER.archive+'/compatibility-review.original.json'),originalBoot=take(SERVER1_CUTOVER.archive+'/native-boot.original.conf'),preview=take(previewPath);assert.equal(sha(bytes(originalRoles)),intent.rolesSha256);assert.equal(sha(bytes(originalReview)),intent.reviewSha256);assert.equal(sha(bytes(originalBoot)),intent.nativeBootSha256);
   const r=json(preview),t=json(template);exact(r,[...completeFields]);for(const key of ['sourceCommit','targetCommit','sourceManifestSha256','runtimeManifestSha256','identityDigest','sourceSqlSha256','catalogSha256','publicPolicySha256','newFunding','financialPolicyChanged','createdAt'])assert.equal(r[key],t[key]);for(const key of ['finalSnapshotSha256','finalSchemaSha256','finalDataDigest','nativeCensusSha256'])hash(r[key]);
   const boundReview=replaceServer1HashToken(bytes(originalReview).toString('utf8'),'cutoverReceiptSha256',hash(record(json(originalReview).nativeStorage).cutoverReceiptSha256),sha(bytes(preview)));assert.equal(bytes(currentReview).toString('utf8'),boundReview);const boundRoles=replaceServer1HashToken(bytes(originalRoles).toString('utf8'),'compatibilityReviewSha256',String(intent.reviewSha256),sha(boundReview));assert.equal(bytes(currentRoles).toString('utf8'),boundRoles);rolesSha=sha(boundRoles);assert.equal(bytes(currentBoot).toString('utf8'),bootWire(commit,rolesSha));
  }else{assert.equal(sha(bytes(currentRoles)),intent.rolesSha256);assert.equal(sha(bytes(currentReview)),intent.reviewSha256);assert.equal(sha(bytes(currentBoot)),intent.nativeBootSha256);assert.equal(mode,'verify-artifact-only');}
  // The old installed inspector is byte-identical to reviewed3654. No code or
  // TSX loader from the candidate is executed before its full hash succeeds.
  const inspector=pin(immutableInspector,65536,false);held.push(inspector);assert.equal(await fileSha(inspector),SERVER1_CUTOVER.immutableInspectorSha256);const rawBinding=record(json(currentRoles).release);assert.equal(rawBinding.commit,commit);assert.equal(rawBinding.artifactReuseFile,undefined);assert.equal(rawBinding.artifactReuseSha256,undefined);
  const immutable:typeof import('../immutable-release-staging.mjs')=await import(pathToFileURL('/root/.local/share/keryx-releases/3654cf66bd3541a90d9c621eb72d57556e306dd6/source/scripts/immutable-release-staging.mjs').href);inspector.frame();const artifact=immutable.verifyImmutableArtifact({candidate:dirname(releaseSource(commit)),sourceManifestSha256:hash(rawBinding.sourceManifestSha256),artifactInspectionSha256:hash(rawBinding.artifactInspectionSha256)});assert.equal(artifact.commit,commit);inspector.frame();
  const ops=await releaseModule(commit);const roles=ops.readReviewedRoles(SERVER1_CUTOVER.roles,rolesSha);assert(roles.release&&roles.release.commit===commit&&!roles.release.artifactReuseFile&&!roles.release.artifactReuseSha256);const binding=roles.release;ops.verifyReleaseSourcePaths(releaseSource(commit));const review=ops.verifyReleaseReview(binding,ops.readProtectedDeploymentJson,artifact,undefined,'artifact');assert.equal(review.format,'keryx-reviewed-native-release-compatibility-v1');
  const frame=()=>{for(const p of held)p.frame();assert.equal(canonicalJson(ops.readReviewedRoles(SERVER1_CUTOVER.roles,rolesSha)),canonicalJson(roles));assert.equal(canonicalJson(ops.verifyReleaseReview(binding,ops.readProtectedDeploymentJson,artifact,undefined,'artifact')),canonicalJson(review));};frame();
  if(mode==='verify-artifact-only')return {format:'keryx-server1-cutover-artifact-check-v1',accepted:true,fullArtifactHashed:true,reuseProofUsed:false};
  const env=take(SERVER1_CUTOVER.activeEnvironment),manifest=take(SERVER1_CUTOVER.activeManifest,8192);assert.equal(sha(bytes(env)),intent.runtimeEnvironmentSha256);assert.equal(sha(bytes(manifest)),intent.runtimeManifestSha256);const parsed=parseEnv(bytes(env).toString('utf8'));for(const [key,value]of Object.entries(parsed))assert.equal(process.env[key],value);assert.equal(process.env.KERYX_STORAGE_MANIFEST,SERVER1_CUTOVER.activeManifest);
  const app:typeof import('../../lib/db/application-storage')=await import(pathToFileURL(join(releaseSource(commit),'lib/db/application-storage.ts')).href),configuration:typeof import('../../lib/config')=await import(pathToFileURL(join(releaseSource(commit),'lib/config.ts')).href),policyModule:typeof import('../../lib/payments/hosted-treasury-policy')=await import(pathToFileURL(join(releaseSource(commit),'lib/payments/hosted-treasury-policy.ts')).href),allowance:typeof import('../../lib/research/research-allowance')=await import(pathToFileURL(join(releaseSource(commit),'lib/research/research-allowance.ts')).href),deployment:typeof import('../../lib/db/runtime-storage-config')=await import(pathToFileURL(join(releaseSource(commit),'lib/db/runtime-storage-config.ts')).href);frame();
  const selected=deployment.readRuntimeStorageDeployment();assert.equal(selected.backend.kind,'postgres');assert.equal(canonicalJson(selected.identity),canonicalJson(json(manifest).identity));assert.equal(storageIdentityDigest(selected.identity),review.storageIdentityDigest);const selection=canonicalJson(selected);
  const current=()=>{frame();assert.equal(canonicalJson(deployment.readRuntimeStorageDeployment()),selection);assert.equal(configuration.config.profile.name,'arc');assert.equal(configuration.config.baseUrl,'https://keryx.cc');assert.equal(allowance.configuredResearchAllowance(),null);for(const [key,value]of Object.entries(parsed))assert.equal(process.env[key],value);const policy=policyModule.configuredHostedTreasuryPolicy(selected.identity,'https://keryx.cc','public');assert.equal(policyModule.hostedTreasuryPolicyDigest(policy),SERVER1_CUTOVER.publicPolicySha256);return policy;};current();await privateWorker(current);current();
  const native=await app.createReadonlyApplicationStorage();assert(native);store=native;closeStore=async()=>{await app.closeReadonlyApplicationStorage(native);};current();const identity=await app.applicationStorageIdentity(native,'read');current();assert.equal(canonicalJson(identity),canonicalJson(selected.identity));assert.equal(storageIdentityDigest(identity),review.storageIdentityDigest);
  const guard=()=>{assert.equal(app.assertApplicationStorageCurrentLocal(native,'read'),undefined);return current();};let policy=guard();const accounting=await native.hostedTreasuryAccounting(policy.signer,'public');policy=guard();assert(typeof accounting.retainedMicroUsdc==='string'&&/^(?:0|[1-9][0-9]*)$/.test(accounting.retainedMicroUsdc));assert(BigInt(accounting.retainedMicroUsdc)<=BigInt(policy.lifetimeCapMicroUsdc));assert.equal(canonicalJson(await app.applicationStorageIdentity(native,'read')),canonicalJson(identity));guard();
  await closeStore();closeStore=undefined;store=undefined;current();await privateWorker(current);current();return {format:'keryx-server1-cutover-native-check-v1',accepted:true,genuineReadonlyFactory:true,allNineIdentity:true,coldKeyAdmission:true,publicPolicyCurrent:true,privateWorkerInactive:true,canonicalCloseAwaited:true,writerOpened:false};
 }finally{try{if(store&&closeStore)await closeStore();}finally{for(const p of held)p.close();}}
}

function cutoverOwnerSessions(clients:readonly Client[],transactions:Set<Client>,cleanupFailures:string[]){
 const heartbeat=createOwnerSessionHeartbeat(clients);let started=false;
 return Object.freeze({
  get failure(){return heartbeat.failure;},
  start(){heartbeat.start();started=true;},
  pauseAndDrain:heartbeat.pauseAndDrain,
  resume:heartbeat.resume,
  async beginLocked(pg:Client,lock:string){
   await heartbeat.pauseAndDrain(pg);transactions.add(pg);
   await pg.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await pg.query(lock);
   heartbeat.resume(pg);
  },
  async dispose(){
   // Retire one session at a time: a sibling transaction remains live while
   // this client's pending probe, ROLLBACK and connection close drain.
   for(const pg of clients){
    if(started)try{await heartbeat.pauseAndDrain(pg);}catch{cleanupFailures.push('heartbeat');}
    if(transactions.has(pg))try{await pg.query('ROLLBACK');transactions.delete(pg);}catch{cleanupFailures.push('transaction-disposal');}
    try{await pg.end();}catch{cleanupFailures.push('postgres-close');}
   }
   try{await heartbeat.stopAndDrain();}catch{cleanupFailures.push('heartbeat');}
  },
 });
}

export class Server1CutoverUnavailable extends Error{
 constructor(readonly diagnostic:Readonly<{stage:Stage;activationOutcome:Outcome;sourceSwitchOutcome:Outcome;runtimeHbaOutcome:Outcome;roleStartOutcome:Outcome;maintenanceHeld:boolean;cleanupFailures:readonly string[]}>){super('Server1 native cutover unavailable; retain owned maintenance and journal');}
}
/** Fixed host preflight. It acquires no application authority and writes no
 * control. Existing/partial cutover outputs refuse instead of being adopted. */
export async function inspectServer1NativeCutover(){if(arguments.length)refuse('arguments');return cutover(false);}
/** Sole fixed mutation entry. There is no supplied target, callback, proof,
 * production opt-out or financial catchup. Release authorization is external. */
export async function runServer1NativeCutover(){if(arguments.length)refuse('arguments');return cutover(true);}
async function cutover(apply:boolean){
 let stage:Stage='preflight',activationOutcome:Outcome='not_attempted',runtimeHbaOutcome:Outcome='not_attempted',roleStartOutcome:Outcome='not_attempted',sourceSwitchOutcome:Outcome='not_attempted',maintenanceHeld=false;
 let c:Inputs|undefined,db:DatabaseSync|undefined,finalDb:DatabaseSync|undefined,ownedJournal:ReturnType<typeof journal>|undefined,source:ReturnType<typeof pm2Source>|undefined,lease:Lease|undefined;
 const clients:Client[]=[],transactions=new Set<Client>(),cleanupFailures:string[]=[],extraPins:Pin[]=[];let sessions:ReturnType<typeof cutoverOwnerSessions>|undefined,failure:unknown,result:unknown;const started=performance.now();let windowPin:Pin|undefined,activeEnvironment:Pin|undefined,activeManifest:Pin|undefined;
 const frame=()=>{assert(c);assert(performance.now()-started<1790000);c.frame();for(const p of extraPins)p.frame();source?.frame();const heartbeatError=sessions?.failure;if(heartbeatError)throw heartbeatError;checkSnapshotSidecars(SERVER1_CUTOVER.snapshot);assert(db?.isTransaction&&db.prepare('PRAGMA query_only').get()?.query_only===1);assert.equal(canonicalJson(readStorageIdentity(db)),canonicalJson(c.identity));if(activeEnvironment)activeEnvironment.frame();else c.activeEnvironment.frame();if(activeManifest)activeManifest.frame();else c.activeManifest.frame();if(windowPin){windowPin.frame();const status=maintenanceStatus(readWindowControl(SERVER1_CUTOVER.maintenance),Date.now());assert(status.admissionClosed&&status.window?.id===c.intent.windowId&&status.state==='draining');}};
 const emit=(event:Json)=>{assert(ownedJournal);ownedJournal.emit({stage,...event});};
 try{
  containment();c=await inputs();
  for(const path of [SERVER1_CUTOVER.journal,SERVER1_CUTOVER.finalSnapshot,SERVER1_CUTOVER.receipt,SERVER1_CUTOVER.archive+'/native-cutover.preview.json',SERVER1_CUTOVER.archive+'/roles.original.json',SERVER1_CUTOVER.archive+'/compatibility-review.original.json',SERVER1_CUTOVER.archive+'/native-boot.original.conf',SERVER1_CUTOVER.archive+'/source.env.original',SERVER1_CUTOVER.archive+'/source.storage.original.json',SERVER1_CUTOVER.archive+'/source.pg_hba.original.conf',SERVER1_CUTOVER.bootDropin])assert(!existsSync(path));assert.equal(readWindowControl(SERVER1_CUTOVER.maintenance).kind,'absent');
  db=new DatabaseSync(SERVER1_CUTOVER.snapshot,{readOnly:true,allowExtension:false,timeout:1000});configureSnapshotConnection(db,OFFLINE_SNAPSHOT_LIMITS);db.exec('BEGIN');frame();assert.equal(canonicalJson(readStorageIdentity(db)),canonicalJson(c.identity));const b0=await typedInventory(db,frame,undefined,storageIdentityDigest(c.identity));assert.equal(b0.schemaSha256,c.baseline.sourceSchemaSha256);assert.equal(b0.dataDigest,c.baseline.dataDigest);
  const [firstNode,firstArgs]=childCommand(String(c.intent.targetCommit),'verify-artifact-only');const firstArtifact=record(JSON.parse(await command(firstNode,firstArgs,65536,180000)));frame();assert.equal(firstArtifact.accepted,true);assert.equal(firstArtifact.fullArtifactHashed,true);assert.equal(firstArtifact.reuseProofUsed,false);const ops=await releaseModule(String(c.intent.targetCommit));frame();preparedRoles(c,ops);source=pm2Source();source.frame();lease=await connectOnly(source,frame);const old=parseServer1SourceRoles(await rpc(lease,'getMonitorData',{},frame)),os=old.map(r=>processFrame(r.pid)),worker=old.find(r=>r.name==='keryx-a2a-worker')!;
  // The B0 worker must be this exact idle installed3654 process, not another
  // epoch/process or an in-flight original. No mutation follows a failed check.
  const workerValue=sourceIdleWorker(b0.worker,worker.pid),operatorValue=sourceOperatorClock(b0.operatorClock);assert(workerValue.column<=Date.now()&&operatorValue.column<=Date.now());
  await pm2Service(frame);await privateWorker(frame);await preparedRuntime(c,frame);
  const beforeBoot=properties(await command('/usr/bin/systemctl',['show','keryx-public-roles.service','--all','--property=DropInPaths,Type,RemainAfterExit,WorkingDirectory,TimeoutStopUSec,SendSIGKILL,ExecStop,ExecStopPost']));frame();await completeEmptyExecProperties('keryx-public-roles.service',beforeBoot,frame);assert.deepEqual(beforeBoot,{DropInPaths:'',Type:'oneshot',RemainAfterExit:'yes',WorkingDirectory:'/root/keryx',TimeoutStopUSec:'infinity',SendSIGKILL:'no',ExecStop:'',ExecStopPost:''});
  if(apply){ownedJournal=journal();emit({event:'intent',format:'keryx-server1-native-cutover-journal-v1',intentSha256:sha(bytes(c.byPath.get(SERVER1_CUTOVER.intent)!)),sourceSqlSha256:SERVER1_CUTOVER.sourceSqlSha256,catalogSha256:SERVER1_CUTOVER.catalogSha256,automaticRetry:false});}
  const sourcePg=peer('keryx_source');clients.push(sourcePg);const targetPg=peer('keryx_mainnet');clients.push(targetPg);sessions=cutoverOwnerSessions(clients,transactions,cleanupFailures);
  const connect=async(pg:Client,database:'keryx_source'|'keryx_mainnet')=>{frame();await pg.connect();frame();await pgGuard(pg,database,c!,frame,'initial');};
  await connect(sourcePg,'keryx_source');await connect(targetPg,'keryx_mainnet');assert.equal((await targetPg.query('SELECT pg_try_advisory_lock(634781904177029::bigint) acquired')).rows[0].acquired,true);frame();const target=await targetGuard(targetPg,c,frame);sessions.start();
  stage='online-census';
  // Pause only the transitioning client through BEGIN/first LOCK. The other
  // owner transaction stays alive without a queued SELECT taking an RR snapshot.
  await sessions.beginLocked(targetPg,target.lock);frame();
  await sessions.beginLocked(sourcePg,'LOCK TABLE keryx_migration.snapshot_manifest,keryx_migration.snapshot_tables,keryx_migration.snapshot_rows IN SHARE MODE');frame();
  const checked=(pg:Client)=>new Proxy(pg,{get(object,key){if(key!=='query')return Reflect.get(object,key,object);return (...args:unknown[])=>{frame();return Promise.resolve(Reflect.apply(object.query,object,args)).then(value=>{frame();return value;});};}}) as Client;
  const typed=await import('./rehearse-snapshot.mts'),publicCells=await import('./materialize-native-snapshot.mts'),privateCells=await import('./materialize-native-projections.mts');frame();const staging=await typed.compareStagedSnapshotTransaction(db,checked(sourcePg));frame();assert.equal(staging.tables.length,94);
  const publicCensus=await publicCells.compareNativeSnapshotTransaction(db,checked(targetPg),checked(sourcePg),target.wire,sourceMode),projections=await privateCells.compareNativeProjectionsTransaction(db,checked(targetPg),sourceMode);frame();assert.equal(projections.domains.length,12);assert.equal(canonicalJson(staging),canonicalJson(c.baseline.staging));assert.equal(canonicalJson(publicCensus),canonicalJson(c.baseline.publicCensus));assert.equal(canonicalJson(projections),canonicalJson(c.baseline.projections));assert.equal(sha(canonicalJson({staging,publicCensus,projections})),c.baseline.nativeCensusSha256);await targetGuard(targetPg,c,frame);
  // Full artifact hashing is synchronous in its existing implementation. A
  // fixed child leaves this parent's real PostgreSQL keepalive event loop live.
  const [node,warmArgs]=childCommand(String(c.intent.targetCommit),'verify-artifact-only');frame();const warm=record(JSON.parse(await command(node,warmArgs,65536,180000)));frame();assert.equal(warm.format,'keryx-server1-cutover-artifact-check-v1');assert.equal(warm.accepted,true);assert.equal(warm.fullArtifactHashed,true);assert.equal(warm.reuseProofUsed,false);
  // Readiness is reobserved while the predecessor is still online. No policy,
  // custody, queue or allowance renewal is performed by this helper.
  await command('/usr/bin/node',['--env-file='+SERVER1_CUTOVER.activeEnvironment,'--import',releaseSource(SERVER1_CUTOVER.sourceCommit)+'/node_modules/tsx/dist/loader.mjs',SERVER1_CUTOVER.oldBootstrap,'--verify-only'],65536,180000);frame();await privateWorker(frame);await preparedRuntime(c,frame);await pgGuard(targetPg,'keryx_mainnet',c,frame,'initial');await pgGuard(sourcePg,'keryx_source',c,frame,'initial');assert.deepEqual(parseServer1SourceRoles(await rpc(lease,'getMonitorData',{},frame)),old);for(const p of os)sameProcess(p);
  if(!apply){await preparedRuntime(c,frame);result={format:'keryx-server1-native-cutover-preflight-v1',preflight:true,mutated:false,sourceTables:94,sourceRows:b0.rows,privateDomains:12,fullArtifactHashed:true,targetMode:'held',applicationAuthority:false};}
  else{
   stage='maintenance';frame();assert.equal(readWindowControl(SERVER1_CUTOVER.maintenance).kind,'absent');const now=Date.now(),window=parsePlannedWindow({format:'keryx-planned-maintenance-v1',id:c.intent.windowId,announcedAt:new Date(now).toISOString(),startsAt:new Date(now+1000).toISOString(),endsAt:new Date(now+1000+25*60*1000).toISOString(),phase:'draining',message:'Storage maintenance is in progress.'});emit({event:'maintenance-intent',id:c.intent.windowId});exclusive(SERVER1_CUTOVER.maintenance+'/window.json',Buffer.from(JSON.stringify(window)+'\n'));maintenanceHeld=true;await new Promise<void>(done=>setTimeout(done,1000));windowPin=pin(SERVER1_CUTOVER.maintenance+'/window.json',4096);extraPins.push(windowPin);frame();emit({event:'maintenance-held'});
   stage='drain';const oldManager=lease.process.pid,stop=await drainSource(lease,old,os,frame,emit);lease=undefined;frame();source.frame();await pm2Service(frame);emit({event:'fresh-empty-manager-intent'});await command('/usr/bin/systemctl',['start','pm2-root.service']);frame();lease=await connectOnly(source,frame);assert.notEqual(lease.process.pid,oldManager);assert.deepEqual(await rpc(lease,'getMonitorData',{},frame),[]);emit({event:'fresh-empty-manager-ack'});
   stage='final-copy';emit({event:'final-source-copy-intent'});const final=await copyFinal(c,frame),copyUntil=Date.now();emit({event:'final-source-copy-ack',sha256:final.sha256});finalDb=new DatabaseSync(SERVER1_CUTOVER.finalSnapshot,{readOnly:true,allowExtension:false,timeout:1000});configureSnapshotConnection(finalDb,OFFLINE_SNAPSHOT_LIMITS);finalDb.exec('BEGIN');assert.equal(canonicalJson(readStorageIdentity(finalDb)),canonicalJson(c.identity));
   const b1=await typedInventory(finalDb,frame,{baseline:b0,pid:worker.pid,from:stop.from,until:stop.until,copyUntil});assert.equal(b1.normalizedDataDigest,b0.dataDigest);assert.equal(b1.schemaSha256,b0.schemaSha256);frame();assert(os.every(gone));
   await preserveServer1SourceRows(targetPg,b0,b1,frame,emit);
   const finalPublic=structuredClone(publicCensus);for(const [table,before,after]of [['sync_state',b0.syncSemanticDigest,b1.syncSemanticDigest],['activation_events',b0.activationSemanticDigest,b1.activationSemanticDigest],['rate_limit_counters',b0.rateSemanticDigest,b1.rateSemanticDigest],['cache_items',b0.cacheSemanticDigest,b1.cacheSemanticDigest],['source_items',b0.itemSemanticDigest,b1.itemSemanticDigest]]){const entries=finalPublic.tables.filter(r=>r.table===table),old=b0.tables.find(r=>r.name===table)!,next=b1.tables.find(r=>r.name===table)!;assert.equal(entries.length,1);assert.equal(entries[0].semanticDigest,before);assert.equal(entries[0].rows,old.rows);entries[0].semanticDigest=after;entries[0].rows=next.rows;finalPublic.totalRows+=next.rows-old.rows;}const nativeCensusSha256=sha(canonicalJson({staging,publicCensus:finalPublic,projections}));emit({event:'source-rows-cas-and-census-verified',schemaSha256:b1.schemaSha256,dataDigest:b1.dataDigest,normalizedDataDigest:b1.normalizedDataDigest,nativeCensusSha256});
   const preview=receiptPreview(c,b1,final.sha256,nativeCensusSha256),rolesSha=lateBind(c,preview,emit);frame();const [artifactNode,artifactArgs]=childCommand(String(c.intent.targetCommit),'verify-artifact-only');const verified=record(JSON.parse(await command(artifactNode,artifactArgs,65536,180000)));frame();assert.equal(verified.accepted,true);assert.equal(verified.fullArtifactHashed,true);assert.equal(verified.reuseProofUsed,false);await preparedRuntime(c,frame);await targetGuard(targetPg,c,frame);assert(os.every(gone));leaseGuard(lease);assert.deepEqual(await rpc(lease,'getMonitorData',{},frame),[]);
   stage='source-retirement';emit({event:'source-retirement-intent'});sourceSwitchOutcome='unknown';activeEnvironment=installFile(SERVER1_CUTOVER.activeEnvironment,bytes(c.byPath.get(SERVER1_CUTOVER.environment)!),SERVER1_CUTOVER.archive+'/source.env.original',emit,c.activeEnvironment);extraPins.push(activeEnvironment);
   activeManifest=installFile(SERVER1_CUTOVER.activeManifest,bytes(c.byPath.get(SERVER1_CUTOVER.manifest)!),SERVER1_CUTOVER.archive+'/source.storage.original.json',emit,c.activeManifest);extraPins.push(activeManifest);
   if(!existsSync(dirname(SERVER1_CUTOVER.bootDropin))){parentFrame(dirname(SERVER1_CUTOVER.bootDropin));emit({event:'native-boot-directory-intent'});mkdirSync(dirname(SERVER1_CUTOVER.bootDropin),{mode:0o755});syncParent(dirname(SERVER1_CUTOVER.bootDropin));}const boot=installFile(SERVER1_CUTOVER.bootDropin,bytes(c.byPath.get(SERVER1_CUTOVER.dropin)!),undefined,emit,undefined,0o644);extraPins.push(boot);frame();await command('/usr/bin/systemctl',['daemon-reload']);frame();const bootState=properties(await command('/usr/bin/systemctl',['show','keryx-public-roles.service','--property=DropInPaths,ExecStart,WorkingDirectory,Requires,After']));frame();assert.equal(bootState.DropInPaths,SERVER1_CUTOVER.bootDropin);assert.equal(bootState.WorkingDirectory,'/root/keryx');assert(bootState.Requires.split(' ').includes(pgUnit)&&bootState.After.split(' ').includes(pgUnit));assert(bootState.ExecStart.includes('argv[]='+bootWire(String(c.intent.targetCommit),rolesSha).trim().split('\n').at(-1)!.slice('ExecStart='.length)+' ;'));sourceSwitchOutcome='acknowledged';emit({event:'source-startup-and-manifest-retired'});
   stage='activation';await privateWorker(frame);await preparedRuntime(c,frame);await targetGuard(targetPg,c,frame);frame();const activated=await targetPg.query("UPDATE keryx_storage.control SET mode='active' WHERE singleton AND mode='held' RETURNING mode");assert.deepEqual(activated.rows,[{mode:'active'}]);frame();await sessions.pauseAndDrain(targetPg);frame();emit({event:'activation-commit-intent'});activationOutcome='unknown';
   await targetPg.query('COMMIT');transactions.delete(targetPg);activationOutcome='acknowledged';emit({event:'activation-acknowledged'});frame();sessions.resume(targetPg);await targetGuard(targetPg,c,frame,'active');
   stage='runtime-hba';emit({event:'runtime-hba-install-intent'});runtimeHbaOutcome='unknown';const oldHba=c.byPath.get(SERVER1_CUTOVER.activeHba)!;const newHba=installFile(SERVER1_CUTOVER.activeHba,bytes(c.byPath.get(SERVER1_CUTOVER.runtimeHba)!),SERVER1_CUTOVER.archive+'/source.pg_hba.original.conf',emit,oldHba,0o640);c.pins.splice(c.pins.indexOf(oldHba),1,newHba);c.byPath.set(SERVER1_CUTOVER.activeHba,newHba);oldHba.close();frame();emit({event:'runtime-hba-reload-intent'});assert.equal((await targetPg.query('SELECT pg_reload_conf() reloaded')).rows[0].reloaded,true);frame();
   // The loaded rules are witnessed by actual SCRAM negotiations for BOTH new
   // fixed credentials. File views/reload ACK alone never establish admission.
   await scram(c,'keryx_app',frame);await scram(c,'keryx_reader',frame);await pgGuard(targetPg,'keryx_mainnet',c,frame,'runtime');runtimeHbaOutcome='acknowledged';emit({event:'runtime-hba-scram-verified'});
   stage='native-verification';const [nativeNode,nativeArgs]=childCommand(String(c.intent.targetCommit),'verify-native-only'),native=record(JSON.parse(await command(nativeNode,nativeArgs,65536,180000)));frame();assert.equal(native.format,'keryx-server1-cutover-native-check-v1');for(const name of ['accepted','genuineReadonlyFactory','allNineIdentity','coldKeyAdmission','publicPolicyCurrent','privateWorkerInactive','canonicalCloseAwaited'])assert.equal(native[name],true);assert.equal(native.writerOpened,false);await privateWorker(frame);await preparedRuntime(c,frame);await targetGuard(targetPg,c,frame,'active');assert(os.every(gone));assert.deepEqual(await rpc(lease,'getMonitorData',{},frame),[]);
   stage='publication';assert.equal(activationOutcome,'acknowledged');assert.equal(runtimeHbaOutcome,'acknowledged');emit({event:'complete-receipt-publication-intent',sha256:sha(preview)});exclusive(SERVER1_CUTOVER.receipt,preview);const receipt=pin(SERVER1_CUTOVER.receipt,65536);extraPins.push(receipt);assert.equal(sha(bytes(receipt)),sha(preview));frame();emit({event:'complete-receipt-published',sha256:sha(preview)});
   stage='role-start';const cohort=releaseSource(String(c.intent.targetCommit)),bootArgs=['--env-file='+SERVER1_CUTOVER.activeEnvironment,'--import',cohort+'/node_modules/tsx/dist/loader.mjs',cohort+'/scripts/postgres/server1-native-bootstrap.mts',SERVER1_CUTOVER.roles,rolesSha,'--verify-only'];const bootAdmission=record(JSON.parse(await command('/usr/bin/node',bootArgs,65536,180000)));frame();assert.equal(bootAdmission.accepted,true);assert.equal(bootAdmission.verifyOnly,true);assert.equal(bootAdmission.rolesStarted,false);leaseGuard(lease);assert.deepEqual(await rpc(lease,'getMonitorData',{},frame),[]);
   for(const role of ['a2a','web']){frame();leaseGuard(lease);emit({event:'reviewed-role-start-intent',role});roleStartOutcome='unknown';await command('/usr/bin/node',[cohort+'/scripts/redeploy-reviewed-roles.mjs',SERVER1_CUTOVER.roles,rolesSha,role,'1',String(c.intent.targetCommit)],65536,30000);roleStartOutcome='acknowledged';emit({event:'reviewed-role-start-ack',role});frame();leaseGuard(lease);}
   frame();await command('/usr/bin/pm2',['save'],65536,10000,{PATH:'/usr/bin:/bin',HOME:'/root',PM2_HOME:'/root/.pm2'});frame();leaseGuard(lease);stage='complete';emit({event:'complete',maintenanceHeld:true,publicPostflightPerformed:false});result={format:'keryx-server1-native-cutover-result-v1',phase:'complete',receiptSha256:sha(preview),maintenanceHeld:true,sourceDelta:'five-sync-two-operational-and-paired-encrypted-upkeep-preserved',activationOutcome,applicationAuthority:false,publicPostflightPerformed:false,newFunding:false,financialPolicyChanged:false};
  }
 }catch(error){failure=error;try{ownedJournal?.emit({event:'held-failure',stage,activationOutcome,runtimeHbaOutcome,roleStartOutcome,sourceSwitchOutcome,maintenanceHeld});}catch{cleanupFailures.push('failure-journal');}}
 // No rollback/fallback of acknowledged activation or filesystem switches.
 // SQL ROLLBACK below disposes only an uncommitted owned transaction.
 if(sessions)await sessions.dispose();else for(const pg of clients)try{await pg.end();}catch{cleanupFailures.push('postgres-close');}if(lease)try{closeRpc(lease);}catch{cleanupFailures.push('rpc-close');}try{source?.close();}catch{cleanupFailures.push('pm2-source-close');}
 for(const sqlite of [finalDb,db])if(sqlite)try{if(sqlite.isTransaction)sqlite.exec('ROLLBACK');sqlite.close();}catch{cleanupFailures.push('sqlite-close');}for(const p of extraPins)try{p.close();}catch{cleanupFailures.push('descriptor-close');}try{c?.close();}catch{cleanupFailures.push('input-close');}try{ownedJournal?.close();}catch{cleanupFailures.push('journal-close');}
 if(failure||cleanupFailures.length)throw new Server1CutoverUnavailable(Object.freeze({stage,activationOutcome,sourceSwitchOutcome,runtimeHbaOutcome,roleStartOutcome,maintenanceHeld,cleanupFailures:Object.freeze([...cleanupFailures])}));return result;
}

const ownUrl=typeof import.meta.url==='string'?fileURLToPath(import.meta.url):undefined;
if(process.argv[1]&&(process.argv[1]===SERVER1_CUTOVER.bundle||ownUrl&&resolve(process.argv[1])===ownUrl)){
 let selected:ReturnType<typeof parseServer1CutoverMode>='preflight';try{selected=parseServer1CutoverMode(process.argv.slice(2));}catch{process.stderr.write('Server1 native cutover refused\n');process.exitCode=1;}
 if(!process.exitCode){const operation=selected==='apply'?runServer1NativeCutover():selected==='preflight'?inspectServer1NativeCutover():child(selected);operation.then(value=>process.stdout.write(JSON.stringify(value)+'\n')).catch(error=>{const diagnostic=error instanceof Server1CutoverUnavailable?error.diagnostic:{stage:'preflight'};process.stderr.write(JSON.stringify({format:'keryx-server1-native-cutover-failure-v1',...diagnostic})+'\n');process.exitCode=1;});}
}
