/** Fixed server1 online B0 intake. Data preparation only; target stays HELD.
 * No target selector, supplied connection, approval callback, runtime issuer,
 * Source retirement, application activation, retry, or financial delta. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { closeSync, constants, createReadStream, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, readSync, realpathSync, writeSync, type BigIntStats } from 'node:fs';
import { dirname, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Client, types } from 'pg';
import { canonicalJson } from '../../lib/canonical-json';
import { readStorageIdentity } from '../../lib/db/storage-identity-sqlite';
import { storageIdentityDigest } from '../../lib/db/storage-identity';
import { NATIVE_CURRENT_DATA_INTAKE_PROFILE as profile } from '../../lib/db/postgres/runtime-profile';
import { checkSnapshotSidecars, configureSnapshotConnection, validateSnapshotHeader } from '../../lib/db/storage-provenance-snapshot';
import { OFFLINE_SNAPSHOT_LIMITS } from '../../lib/db/storage-provenance';
import { exportNativePostgresSchemaContract } from './native-contract.mts';

const ROOT='/root/keryx-migration', B0=ROOT+'/postgres-b0';
const paths={preparation:ROOT+'/postgres17-server1-preparation.json',held:ROOT+'/postgres17-server1-held-target.json',
 manifest:'/root/.local/share/keryx-mainnet-runtime/production-v2/storage.json',audit:'/root/.local/share/keryx-mainnet-runtime/production-v2/.business-operator-audit',
 snapshot:B0+'/source.sqlite',copy:B0+'/snapshot.json',sql:B0+'/source.sql',bundle:B0+'/intake.cjs',journal:B0+'/intake.jsonl'} as const;
const socket='/run/postgresql-keryx',unit='keryx-postgres-online-b0.service',serviceDropIn='/etc/systemd/system/postgresql@17-keryx.service.d/20-keryx-preparation.conf',mode='development-current510-data-only' as const;
const phaseNames=['typed-staging','public-cells','private-projections'] as const;
type Phase=typeof phaseNames[number];type Outcome='not_attempted'|'unknown'|'acknowledged';
type Outcomes=Record<Phase,Outcome>;
type Json=Record<string,unknown>;
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const quoted=(v:string)=>{assert(/^[a-z][a-z0-9_]{0,62}$/.test(v));return '"'+v+'"';};
const fingerprint=(s:BigIntStats)=>[s.dev,s.ino,s.uid,s.gid,s.mode,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');
const location=(s:BigIntStats)=>[s.dev,s.ino,s.uid,s.gid,s.mode,s.nlink].join(':');
function refuse():never{throw new Error('B0 binding refused');}
function record(value:unknown):Json{if(!value||typeof value!=='object'||Array.isArray(value))refuse();return value as Json;}
function hash(value:unknown):string{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))refuse();return value;}
function decimal(value:unknown):string{if(typeof value!=='string'||!/^[1-9][0-9]{0,19}$/.test(value))refuse();return value;}
function pathStat(path:string){
 assert(resolve(path)===path);let current=parse(path).root;
 for(const leaf of relative(current,path).split(sep)){current=resolve(current,leaf);assert(!lstatSync(current).isSymbolicLink());}
 assert.equal(realpathSync(path),path);return lstatSync(path,{bigint:true});
}
function privateDirectory(path:string){const s=pathStat(path);assert(s.isDirectory()&&s.uid===BigInt(0)&&(s.mode&BigInt(0o777))===BigInt(0o700));return s;}
function pin(path:string,maximum:number,visibility:'private'|'root-owned'='private'){
 const initial=pathStat(path);assert(initial.isFile()&&initial.uid===BigInt(0)&&initial.nlink===BigInt(1)&&(initial.mode&BigInt(visibility==='private'?0o077:0o022))===BigInt(0)&&initial.size>BigInt(0)&&initial.size<=BigInt(maximum));
 const descriptor=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 const verify=()=>{assert.equal(fingerprint(fstatSync(descriptor,{bigint:true})),fingerprint(initial));assert.equal(fingerprint(pathStat(path)),fingerprint(initial));};
 try{verify();return {descriptor,initial,verify,close:()=>closeSync(descriptor)};}catch(error){closeSync(descriptor);throw error;}
}
function pinnedJson(path:string){
 const held=pin(path,65536);
 try{const bytes=Buffer.alloc(Number(held.initial.size));let n=0;while(n<bytes.length){const read=readSync(held.descriptor,bytes,n,bytes.length-n,n);assert(read>0);n+=read;}
  held.verify();return {...held,sha256:sha(bytes),value:record(JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)))};
 }catch(error){held.close();throw error;}
}
async function fileSha(path:string,held:ReturnType<typeof pin>){held.verify();const h=createHash('sha256');for await(const chunk of createReadStream(path,{fd:held.descriptor,autoClose:false,start:0})){h.update(chunk);}held.verify();return h.digest('hex');}
function containment(){
 assert.equal(process.platform,'linux');assert.equal(process.version,'v24.22.1');assert.equal(process.getuid!(),0);
 assert.equal(process.argv[1],paths.bundle);assert.deepEqual(process.execArgv,['--no-warnings','--max-old-space-size=256']);
 const cg=readFileSync('/proc/self/cgroup','utf8').trim();assert.equal(cg,'0::/system.slice/'+unit);
 for(const [key,value] of [['memory.max','536870912'],['memory.swap.max','0'],['cpu.max','25000 100000'],['pids.max','32']])assert.equal(readFileSync('/sys/fs/cgroup/system.slice/'+unit+'/'+key,'utf8').trim(),value);
 const status=readFileSync('/proc/self/status','utf8');assert(/^CapEff:\s+0+$/m.test(status)&&/^NoNewPrivs:\s+1$/m.test(status));
 assert.equal(readFileSync('/proc/net/route','utf8').trim().split('\n').length,1);
 const deadline=execFileSync('/usr/bin/systemctl',['show',unit,'-p','RuntimeMaxUSec','--value'],{encoding:'utf8',timeout:2000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin'}}).trim();assert.equal(deadline,'30min');
 const service=execFileSync('/usr/bin/systemctl',['show','postgresql@17-keryx.service','--property=ActiveState,User,Group,DropInPaths'],{encoding:'utf8',timeout:2000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin'}}).trim();
 const observed=Object.fromEntries(service.split('\n').map(line=>{const at=line.indexOf('=');assert(at>0);return [line.slice(0,at),line.slice(at+1)];}));
 assert.deepEqual(observed,{ActiveState:'active',User:'postgres',Group:'root',DropInPaths:serviceDropIn});
 assert.equal(process.env.KERYX_NETWORK,'arc');assert.equal(process.env.NEXT_PUBLIC_KERYX_NETWORK,'arc');assert.equal(process.env.KERYX_FORCE_OFFLINE,'0');
 privateDirectory(ROOT);privateDirectory(B0);privateDirectory(dirname(paths.manifest));privateDirectory(paths.audit);
}
function peer(database:'keryx_source'|'keryx_mainnet',role:'postgres'|'keryx_app'|'keryx_reader'='postgres'){
 // Peer authentication has no password. Never route this through the separate
 // password transport's validation or accept PG* environment defaults.
 const client=new Client({host:socket,port:5432,database,user:role,password:()=>{throw new Error('B0 peer authentication required');},ssl:false,
  application_name:'keryx-server1-online-b0',connectionTimeoutMillis:2000,query_timeout:6000,
  options:'-c statement_timeout=5000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=5000 -c client_encoding=UTF8 -c timezone=UTC -c synchronous_commit=on',
  types:{getTypeParser:(oid,format)=>format!=='binary'&&(oid===114||oid===3802)?(value:string)=>value:types.getTypeParser(oid,format)}});
 // The driver parser default is preserved explicitly below; no body decoding
 // or private JSONB hydration is requested by this connector.
 client.on('error',()=>{});return client;
}
async function deniedByLoadedHba(database:'keryx_source'|'keryx_mainnet',role:'keryx_app'|'keryx_reader'){
 const pg=peer(database,role);let denied=false;
 try{await pg.connect();}catch(error){
  // Authentication reject is before password negotiation. A wrong password,
  // peer mismatch, transport failure or successful connection proves nothing.
  const code=error&&typeof error==='object'?Reflect.get(error,'code'):null;
  const message=error&&typeof error==='object'?Reflect.get(error,'message'):null;
  denied=code==='28000'&&message===`pg_hba.conf rejects connection for host "[local]", user "${role}", database "${database}", no encryption`;
 }finally{await pg.end();}
 assert(denied,'Initial loaded HBA reject required');
}
export class Server1B0Unavailable extends Error{
 constructor(readonly diagnostic:Readonly<{stage:string;phases:Outcomes;cleanupFailures:readonly string[];pgCode:string|null}>){super('Server1 online B0 unavailable');}
}
type Context={preparation:ReturnType<typeof pinnedJson>;held:ReturnType<typeof pinnedJson>;manifest:ReturnType<typeof pinnedJson>;copy:ReturnType<typeof pinnedJson>;source:ReturnType<typeof pin>;sql:ReturnType<typeof pin>;bundle:ReturnType<typeof pin>;service:ReturnType<typeof pin>;db:DatabaseSync;identityDigest:string;identityWire:string;referenceWire:string;lockSql:string;sourceHash:string;auditToken:string;started:number;keepaliveFailure?:unknown};
function controls(c:Context){
 assert(performance.now()-c.started<1790000);for(const p of [c.preparation,c.held,c.manifest,c.copy,c.source,c.sql,c.bundle,c.service])p.verify();checkSnapshotSidecars(paths.snapshot);
 if(c.keepaliveFailure)refuse();
 assert.equal(location(privateDirectory(paths.audit)),c.auditToken);
 assert(c.db.isTransaction&&c.db.prepare('PRAGMA query_only').get()?.query_only===1);assert.equal(canonicalJson(readStorageIdentity(c.db)),c.identityWire);
}
const pgService='postgresql@17-keryx.service',pgCgroup='/system.slice/system-postgresql.slice/'+pgService;
const runtimeProperties=['LoadState','ActiveState','SubState','UnitFileState','User','Group','Type','DropInPaths','RuntimeDirectory','RuntimeDirectoryMode','MemoryMax','MemorySwapMax','CPUQuotaPerSecUSec','TasksMax','NoNewPrivileges','CapabilityBoundingSet','MainPID','FragmentPath','ExecStart','ControlGroup'] as const;
function runtimeCommand(bin:'/usr/bin/dpkg-query'|'/usr/bin/systemctl',args:string[]):Promise<string>{
 return new Promise((accept,reject)=>execFile(bin,args,{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',LC_ALL:'C.UTF-8'}},(error,stdout,stderr)=>{
  if(error||Buffer.byteLength(stdout)>4*1024*1024||Buffer.byteLength(stderr)>4*1024*1024)reject(new Error('B0 runtime observation unavailable'));else accept(stdout);
 }));
}
async function runtimeService(){
 const wire=await runtimeCommand('/usr/bin/systemctl',['show',pgService,...runtimeProperties.map(p=>'--property='+p)]),entries=wire.trim().split('\n').map(line=>{const at=line.indexOf('=');assert(at>0);return [line.slice(0,at),line.slice(at+1)] as const;});
 assert.equal(entries.length,runtimeProperties.length);const p=Object.fromEntries(entries);assert.deepEqual(Object.keys(p).sort(),[...runtimeProperties].sort());
 assert.equal(p.LoadState,'loaded');assert.equal(p.ActiveState,'active');assert.equal(p.SubState,'running');assert.equal(p.UnitFileState,'enabled');assert.equal(p.User,'postgres');assert.equal(p.Group,'root');assert.equal(p.Type,'simple');assert.equal(p.DropInPaths,serviceDropIn);assert.equal(p.RuntimeDirectory,'postgresql-keryx');assert.equal(p.RuntimeDirectoryMode,'0750');assert.equal(p.MemoryMax,'1073741824');assert.equal(p.MemorySwapMax,'0');assert.equal(p.CPUQuotaPerSecUSec,'750ms');assert.equal(p.TasksMax,'64');assert.equal(p.NoNewPrivileges,'yes');assert.equal(p.CapabilityBoundingSet,'');assert.equal(p.ControlGroup,pgCgroup);assert(/^[1-9][0-9]{0,9}$/.test(p.MainPID));
 assert(['/lib/systemd/system/postgresql@.service','/usr/lib/systemd/system/postgresql@.service'].includes(p.FragmentPath));assert(p.ExecStart.includes('path=/usr/lib/postgresql/17/bin/postgres ; argv[]=/usr/lib/postgresql/17/bin/postgres -D /var/lib/postgresql/17/keryx -c config_file=/etc/postgresql/17/keryx/postgresql.conf ;'));
 return p;
}
function runtimeKernel(p:Record<string,string>,c:Context){
 const status=readFileSync('/proc/'+p.MainPID+'/status','utf8');assert(Buffer.byteLength(status)<=16384);assert(/^CapEff:\s+0+$/m.test(status)&&/^NoNewPrivs:\s+1$/m.test(status));
 const expected=Number(record(c.preparation.value.observations).socketDirectoryUid);assert(Number.isSafeInteger(expected)&&expected>0);const uid=status.match(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/m);assert(uid&&uid.slice(1).every(x=>x===String(expected)));
 const group=readFileSync('/proc/'+p.MainPID+'/cgroup','utf8');assert(Buffer.byteLength(group)<=4096);assert.equal(group.trim(),'0::'+pgCgroup);
 const root='/sys/fs/cgroup'+pgCgroup+'/';for(const [key,value]of [['memory.max','1073741824'],['memory.swap.max','0'],['pids.max','64']])assert.equal(readFileSync(root+key,'utf8').trim(),value);
 const cpu=readFileSync(root+'cpu.max','utf8').trim();assert(/^[1-9][0-9]* [1-9][0-9]*$/.test(cpu));const [quota,period]=cpu.split(' ').map(Number);assert(Number.isSafeInteger(quota)&&Number.isSafeInteger(period)&&quota/period===0.75);
}
/** Observe bounded metadata under CapEff0, without ptrace or /proc/PID/exe.
 * These are current observations, never a caller-supplied admission result.
 * Async commands keep the existing transaction heartbeat runnable. */
async function verifyPreparedRuntime(c:Context){
 controls(c);const inventory=await runtimeCommand('/usr/bin/dpkg-query',['-W','-f=${binary:Package}\t${Version}\t${db:Status-Status}\n']);controls(c);
 // Byte-identical to Managed's preparation inventory, including the final LF.
 assert.equal(sha(inventory),hash(c.preparation.value.packageInventorySha256));assert(inventory.length>0);for(const line of inventory.trimEnd().split('\n')){const cells=line.split('\t');assert.equal(cells.length,3);assert.equal(cells[2],'installed');}
 const service=await runtimeService();controls(c);runtimeKernel(service,c);
 const vendor=realpathSync(service.FragmentPath);assert(['/lib/systemd/system/postgresql@.service','/usr/lib/systemd/system/postgresql@.service'].includes(vendor));const held=pin(vendor,65536,'root-owned');
 try{assert.equal(await fileSha(vendor,held),hash(c.preparation.value.vendorUnitSha256));controls(c);const after=await runtimeService();controls(c);assert.deepEqual(after,service);runtimeKernel(after,c);held.verify();}finally{held.close();}
 controls(c);
}
async function actual(pg:Client,database:'keryx_source'|'keryx_mainnet',c:Context){
 controls(c);const p=c.preparation.value,h=c.held.value,observations=record(p.observations);
 const result=await pg.query(`SELECT current_database() name,session_user role,current_user current_role,current_setting('server_version_num') version,current_setting('port') port,current_setting('data_directory') directory,current_setting('unix_socket_directories') socket,current_setting('unix_socket_group') socket_group,current_setting('unix_socket_permissions') socket_mode,current_setting('listen_addresses') listeners,current_setting('fsync') fsync,current_setting('synchronous_commit') synchronous_commit,current_setting('full_page_writes') full_page_writes,current_setting('data_checksums') data_checksums,(SELECT system_identifier::text FROM pg_control_system()) system_identifier,(SELECT oid::text FROM pg_database WHERE datname=current_database()) oid`);controls(c);
 assert.equal(result.rowCount,1);const r=result.rows[0];
 assert.equal(r.name,database);assert.equal(r.role,'postgres');assert.equal(r.current_role,'postgres');assert.equal(r.version,'170012');assert.equal(r.port,'5432');assert.equal(r.directory,'/var/lib/postgresql/17/keryx');assert.equal(r.socket,socket);assert.equal(r.socket_group,'root');assert.equal(r.socket_mode,'0770');assert.equal(r.listeners,'');
 for(const key of ['fsync','synchronous_commit','full_page_writes','data_checksums'])assert.equal(r[key],'on');
 assert.equal(r.system_identifier,p.systemIdentifier);assert.equal(r.system_identifier,h.systemIdentifier);assert.equal(r.oid,database==='keryx_source'?h.sourceDatabaseOid:h.targetDatabaseOid);
 const s=pathStat(socket),endpoint=pathStat(socket+'/.s.PGSQL.5432');assert(s.isDirectory()&&s.uid===BigInt(Number(observations.socketDirectoryUid))&&s.gid===BigInt(0)&&(s.mode&BigInt(0o777))===BigInt(0o750));assert(endpoint.isSocket()&&endpoint.uid===s.uid&&endpoint.gid===BigInt(0)&&(endpoint.mode&BigInt(0o777))===BigInt(0o770));
 const configs=await pg.query(`SELECT encode(sha256(pg_read_binary_file(current_setting('config_file'))),'hex') postgresql,encode(sha256(pg_read_binary_file(current_setting('hba_file'))),'hex') hba,encode(sha256(pg_read_binary_file(current_setting('ident_file'))),'hex') ident`);controls(c);
 const expected=record(p.configHashes);for(const k of ['postgresql','hba','ident'])assert.equal(configs.rows[0][k],expected[k]);
 const access=await pg.query(`SELECT r.rolname,r.rolsuper,r.rolbypassrls,has_database_privilege(r.oid,d.oid,'CONNECT') can_connect FROM pg_roles r CROSS JOIN pg_database d WHERE r.rolname IN('keryx_app','keryx_reader') AND d.datname=current_database() ORDER BY r.rolname`);controls(c);
 // The qualified catalog retains its original DB ACL. Loaded HBA, not a role
 // or ACL mutation, independently denies application connection admission.
 assert.deepEqual(access.rows,[{rolname:'keryx_app',rolsuper:false,rolbypassrls:false,can_connect:true},{rolname:'keryx_reader',rolsuper:false,rolbypassrls:false,can_connect:true}]);
 const rules=await pg.query(`SELECT DISTINCT d.database_name,u.role_name FROM pg_hba_file_rules h CROSS JOIN LATERAL unnest(h.database) d(database_name) CROSS JOIN LATERAL unnest(h.user_name) u(role_name) WHERE h.type='local' AND h.auth_method='reject' AND h.error IS NULL AND d.database_name IN('keryx_mainnet','keryx_source') AND u.role_name IN('keryx_app','keryx_reader') ORDER BY d.database_name,u.role_name`);controls(c);
 assert.deepEqual(rules.rows,[{database_name:'keryx_mainnet',role_name:'keryx_app'},{database_name:'keryx_mainnet',role_name:'keryx_reader'},{database_name:'keryx_source',role_name:'keryx_app'},{database_name:'keryx_source',role_name:'keryx_reader'}]);
 await deniedByLoadedHba(database,'keryx_app');controls(c);await deniedByLoadedHba(database,'keryx_reader');controls(c);
 const owner=await pg.query('SELECT r.rolname owner,d.datconnlimit connection_limit FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datname=current_database()');assert.equal(owner.rows[0]?.owner,'postgres');assert.equal(owner.rows[0]?.connection_limit,16);
 const clients=await pg.query("SELECT count(*)::text n FROM pg_stat_activity WHERE datname IN('keryx_source','keryx_mainnet') AND usename<>'postgres'");controls(c);assert.equal(clients.rows[0].n,'0');
}
async function lockTarget(pg:Client,c:Context){
 // First command after BEGIN. Obtain the complete fixed catalog's relation
 // locks without establishing a repeatable-read data snapshot first.
 assert(c.lockSql);await pg.query(c.lockSql);
}
async function target(pg:Client,c:Context,fresh:boolean){
 await actual(pg,'keryx_mainnet',c);
 assert.equal((await pg.query('SELECT mode FROM keryx_storage.control WHERE singleton FOR SHARE')).rows[0]?.mode,'held');
 const catalog=await pg.query("WITH observed AS MATERIALIZED(SELECT keryx_storage.catalog_contract()::text wire) SELECT CASE WHEN octet_length(wire)<=8388608 THEN wire END wire FROM observed");controls(c);
 assert.equal(exportNativePostgresSchemaContract(catalog.rows[0].wire).sha256,profile.catalogSha256);c.referenceWire=catalog.rows[0].wire;
 const sections=record(exportNativePostgresSchemaContract(c.referenceWire).metadata.sections);const relations=sections.relations;assert(Array.isArray(relations));
 const names=relations.map(record).filter(r=>(r.schema==='public'||r.schema==='keryx_storage')&&r.kind==='r').map(r=>quoted(String(r.schema))+'.'+quoted(String(r.name))).sort();assert(names.length>=108&&names.length<=256);
 const lockSql='LOCK TABLE '+names.join(',')+' IN SHARE ROW EXCLUSIVE MODE';if(c.lockSql)assert.equal(c.lockSql,lockSql);else c.lockSql=lockSql;
 for(const name of ['writer','browser_journal_writer','browser_signing_v2_writer','browser_signing_v3_writer']){
  const schema=name==='writer'?'keryx_storage':'public';assert.equal((await pg.query('SELECT count(*)::text n FROM '+schema+'.'+quoted(name))).rows[0].n,'0');controls(c);
 }
 if(fresh){
  for(const name of ['identity','source_contract','run_history_projection','run_ownership_projection','run_privacy_projection','usage_projection','public_ledger_projection','review_projection','topic_watch_projection','a2a_original_time_projection','a2a_original_cell_projection','acceptance_original_projection','payment_event_originals','private_research_result_identity']){assert.equal((await pg.query('SELECT count(*)::text n FROM keryx_storage.'+quoted(name))).rows[0].n,'0');controls(c);}
 }else{
  const selected=await pg.query('SELECT identity::text wire,identity_digest FROM keryx_storage.identity WHERE singleton');assert.equal(selected.rowCount,1);assert.equal(canonicalJson(JSON.parse(selected.rows[0].wire)),c.identityWire);assert.equal(selected.rows[0].identity_digest,c.identityDigest);
  assert.equal((await pg.query('SELECT source_digest FROM keryx_storage.source_contract WHERE singleton')).rows[0]?.source_digest,profile.catalogSha256);controls(c);
 }
}

/** Sole fixed production write entry. Arguments are refused before any I/O. */
export async function runServer1OnlineB0(){if(arguments.length)refuse();return intake(false);}
/** Reads a prior ambiguous target independently; never resumes or repeats it. */
export async function inspectServer1OnlineB0(){if(arguments.length)refuse();return intake(true);}
async function intake(inspect:boolean){
 const started=performance.now();
 let stage='containment',journal:number|undefined,c:Context|undefined,db:DatabaseSync|undefined,active:Client|undefined;
 const outcomes:Outcomes={'typed-staging':'not_attempted','public-cells':'not_attempted','private-projections':'not_attempted'};
 const cleanupFailures:string[]=[],pins:Array<ReturnType<typeof pin>>=[],clients:Client[]=[];let result:unknown,failure:unknown;
 let timer:ReturnType<typeof setInterval>|undefined,inFlight:Promise<void>|undefined;
 const startKeepalive=()=>{assert(!timer);timer=setInterval(()=>{if(!inFlight&&!c?.keepaliveFailure){inFlight=Promise.allSettled(clients.map(pg=>pg.query('SELECT 1'))).then(results=>{const failed=results.find(r=>r.status==='rejected');if(c&&failed?.status==='rejected')c.keepaliveFailure=failed.reason;}).finally(()=>{inFlight=undefined;});}},1000);};
 const stopKeepalive=async()=>{if(timer){clearInterval(timer);timer=undefined;}await inFlight;if(c?.keepaliveFailure)refuse();};
 const emit=(event:Json)=>{assert(journal!==undefined);privateDirectory(B0);assert.equal(location(fstatSync(journal,{bigint:true})),location(pathStat(paths.journal)));const wire=JSON.stringify(event)+'\n';assert(Buffer.byteLength(wire)<=131072&&fstatSync(journal).size+Buffer.byteLength(wire)<=1048576);const b=Buffer.from(wire);let n=0;while(n<b.length){const written=writeSync(journal,b,n,b.length-n);assert(written>0);n+=written;}fsyncSync(journal);const directory=openSync(B0,constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(directory);}finally{closeSync(directory);}};
 try{
  containment();stage='controls';
  const preparation=pinnedJson(paths.preparation);pins.push(preparation);const held=pinnedJson(paths.held);pins.push(held);const manifest=pinnedJson(paths.manifest);pins.push(manifest);const copy=pinnedJson(paths.copy);pins.push(copy);
  const p=preparation.value,h=held.value;
  assert.equal(p.format,'keryx-server1-postgres17-preparation-v1');assert.equal(p.phase,'prepared-unenrolled');assert.equal(p.cluster,'17/keryx');assert.equal(p.service,'postgresql@17-keryx.service');assert.equal(p.socketDirectory,socket);assert.equal(p.port,5432);assert.equal(p.serverVersionNum,170012);assert.equal(p.dataDirectory,'/var/lib/postgresql/17/keryx');decimal(p.systemIdentifier);hash(p.approvedPinSha256);hash(p.packageInventorySha256);
  assert.equal(h.format,'keryx-server1-postgres17-held-target-v1');assert.equal(h.phase,'fresh-held-unenrolled');assert.equal(h.preparationSha256,preparation.sha256);assert.equal(h.systemIdentifier,p.systemIdentifier);decimal(h.sourceDatabaseOid);decimal(h.targetDatabaseOid);assert.notEqual(h.sourceDatabaseOid,h.targetDatabaseOid);assert.equal(h.sourceSqlSha256,profile.sourceSqlSha256);assert.equal(h.catalogSha256,profile.catalogSha256);hash(h.identityDigest);assert.equal(h.sourceManifestSha256,manifest.sha256);assert.equal(h.connectionDenial,'hba-reject');assert.equal(h.applicationConnectDenied,true);assert.equal(h.readerConnectDenied,true);
  const service=pin(serviceDropIn,65536,'root-owned');pins.push(service);assert.equal(await fileSha(serviceDropIn,service),hash(record(p.configHashes).service));
  const source=pin(paths.snapshot,536870912);pins.push(source);validateSnapshotHeader(source.descriptor);checkSnapshotSidecars(paths.snapshot);const sourceHash=await fileSha(paths.snapshot,source);
  assert.equal(copy.value.format,'keryx-consistent-online-sqlite-copy-v1');assert.equal(copy.value.backupComplete,true);assert.equal(copy.value.sha256,sourceHash);assert.equal(copy.value.bytes,Number(source.initial.size));assert.equal(copy.value.sourceManifestSha256,manifest.sha256);
  const sql=pin(paths.sql,8388608);pins.push(sql);assert.equal(await fileSha(paths.sql,sql),profile.sourceSqlSha256);const bundle=pin(paths.bundle,4194304);pins.push(bundle);assert.equal(await fileSha(paths.bundle,bundle),hash(h.intakeSha256));
  stage='source';db=new DatabaseSync(paths.snapshot,{readOnly:true,allowExtension:false,timeout:1000});configureSnapshotConnection(db,OFFLINE_SNAPSHOT_LIMITS);db.exec('BEGIN');
  const identity=readStorageIdentity(db),identityWire=canonicalJson(identity),identityDigest=storageIdentityDigest(identity);assert.equal(identity.network,'eip155:5042');assert.equal(identity.authorityMode,'mainnet-real');assert.equal(identityDigest,h.identityDigest);assert.equal(canonicalJson(manifest.value.identity),identityWire);assert.equal(record(manifest.value.backend).kind,'sqlite');assert.notEqual(record(manifest.value.backend).databasePath,paths.snapshot);
  const original=pathStat(String(record(manifest.value.backend).databasePath));assert(original.isFile());assert(original.dev!==source.initial.dev||original.ino!==source.initial.ino);
  c={preparation,held,manifest,copy,source,sql,bundle,service,db,sourceHash,identityDigest,identityWire,referenceWire:'',lockSql:'',auditToken:location(privateDirectory(paths.audit)),started};controls(c);
  stage='resource-initial';await verifyPreparedRuntime(c);controls(c);
  stage='receipt';if(inspect){const previous=pin(paths.journal,1048576);try{const lines=readFileSync(previous.descriptor,'utf8').trim().split('\n').map(v=>record(JSON.parse(v)));assert(lines.length>0&&lines.length<=64);const first=lines[0];assert.equal(first.sourceSha256,sourceHash);assert.equal(first.heldSha256,held.sha256);assert.equal(first.preparationSha256,preparation.sha256);for(const event of lines)if(phaseNames.includes(event.phase as Phase)){if(event.event==='commit-intent')outcomes[event.phase as Phase]='unknown';if(event.event==='phase'){assert(event.outcome==='acknowledged');outcomes[event.phase as Phase]='acknowledged';}}previous.verify();journal=openSync(paths.journal,constants.O_WRONLY|constants.O_APPEND|constants.O_NOFOLLOW);assert.equal(fingerprint(fstatSync(journal,{bigint:true})),fingerprint(previous.initial));}finally{previous.close();}}
  else{journal=openSync(paths.journal,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);emit({event:'intent',format:'keryx-server1-online-b0-journal-v1',sourceSha256:sourceHash,preparationSha256:preparation.sha256,heldSha256:held.sha256,manifestSha256:manifest.sha256,identityDigest,sourceSqlSha256:profile.sourceSqlSha256,catalogSha256:profile.catalogSha256});}
  // Dynamic literal imports after fixed mainnet environment checks. No Source
  // module can turn this copy or these clients into an installed native proof.
  const typed=await import('./rehearse-snapshot.mts'),publicCells=await import('./materialize-native-snapshot.mts'),privateCells=await import('./materialize-native-projections.mts');
  const {snapshotTables}=await import('./typed-snapshot.mts');assert.equal(snapshotTables(db).length,94);
  // The full Source CPU census runs before either PG transaction. Heartbeats
  // are liveness only; bounded loops below yield so timers can actually run.
  const {inspectTypedDeltaSnapshot}=await import('./typed-snapshot-delta.mts');const typedCensus=await inspectTypedDeltaSnapshot({path:paths.snapshot,sha256:sourceHash});assert.equal(typedCensus.tables,94);assert.equal(typedCensus.identityDigest,identityDigest);controls(c);
  const make=async(database:'keryx_source'|'keryx_mainnet')=>{const pg=peer(database);clients.push(pg);await pg.connect();await actual(pg,database,c!);return pg;};
  const sourcePg=await make('keryx_source'),targetPg=await make('keryx_mainnet');startKeepalive();
  // Drain the timer's queued SELECTs before BEGIN. Otherwise a heartbeat queued
  // behind an in-flight BEGIN can acquire the RR snapshot before our locks.
  const beginLocked=async(pg:Client,begin:string,lock:()=>Promise<unknown>)=>{
   await stopKeepalive();await pg.query(begin);active=pg;await lock();startKeepalive();
  };
  const commit=async(pg:Client,phase:Phase)=>{if(!timer)startKeepalive();stage=phase+'-resource-precommit';await verifyPreparedRuntime(c!);await stopKeepalive();controls(c!);stage=phase+'-commit';emit({event:'commit-intent',phase});outcomes[phase]='unknown';await pg.query('COMMIT');active=undefined;outcomes[phase]='acknowledged';emit({event:'phase',phase,outcome:'acknowledged'});controls(c!);startKeepalive();};
  if(!inspect){
   stage='fresh-target';await target(targetPg,c,true);await beginLocked(targetPg,'BEGIN ISOLATION LEVEL REPEATABLE READ',()=>lockTarget(targetPg,c!));await target(targetPg,c,true);await publicCells.compareFreshNativePublicTransaction(targetPg,c.referenceWire,mode);await targetPg.query('ROLLBACK');active=undefined;
   stage='typed-staging';await stopKeepalive();await sourcePg.query('BEGIN');active=sourcePg;await actual(sourcePg,'keryx_source',c);
   assert.equal((await sourcePg.query("SELECT count(*)::text n FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN('information_schema','public')")).rows[0].n,'0');
   assert.equal((await sourcePg.query("SELECT count(*)::text n FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN('r','p','v','m','S','f')")).rows[0].n,'0');
   await typed.stageSnapshotTransaction(db,sourcePg);await actual(sourcePg,'keryx_source',c);await commit(sourcePg,'typed-staging');
   stage='public-cells';await beginLocked(targetPg,'BEGIN ISOLATION LEVEL REPEATABLE READ',()=>lockTarget(targetPg,c!));await target(targetPg,c,true);await publicCells.materializeNativeSnapshotTransaction(db,targetPg,sourcePg,c.referenceWire,mode);await target(targetPg,c,false);await commit(targetPg,'public-cells');
   stage='private-projections';await beginLocked(targetPg,'BEGIN ISOLATION LEVEL REPEATABLE READ',()=>lockTarget(targetPg,c!));await target(targetPg,c,false);const copied=await privateCells.materializeNativeProjectionsTransaction(db,targetPg,mode);assert.equal(copied.domains.length,12);await target(targetPg,c,false);await commit(targetPg,'private-projections');
  }
  // Close producer connections before using independent owner sessions. All
  // cleanup is retried only as disposal; no SQL write is ever repeated.
  await stopKeepalive();for(const pg of clients)await pg.end();clients.length=0;
  stage='independent-census';const readSource=await make('keryx_source'),readTarget=await make('keryx_mainnet');startKeepalive();
  await beginLocked(readSource,'BEGIN',()=>readSource.query('LOCK TABLE keryx_migration.snapshot_manifest,keryx_migration.snapshot_tables,keryx_migration.snapshot_rows IN SHARE MODE'));
  const staging=await typed.compareStagedSnapshotTransaction(db,readSource);assert.equal(staging.tables.length,94);
  await target(readTarget,c,false);await beginLocked(readTarget,'BEGIN ISOLATION LEVEL REPEATABLE READ',()=>lockTarget(readTarget,c!));await target(readTarget,c,false);
  const publicCensus=await publicCells.compareNativeSnapshotTransaction(db,readTarget,readSource,c.referenceWire,mode),projections=await privateCells.compareNativeProjectionsTransaction(db,readTarget,mode);assert.equal(projections.domains.length,12);await target(readTarget,c,false);
  stage='resource-final';await verifyPreparedRuntime(c);controls(c);await stopKeepalive();await readTarget.query('ROLLBACK');active=readSource;await readSource.query('ROLLBACK');active=undefined;assert.equal(await fileSha(paths.snapshot,source),sourceHash);
  const heldBaseline={format:'keryx-native-held-data-baseline-metadata-v1',profileMode:mode,catalogSha256:profile.catalogSha256,targetState:'held',sequence:0,snapshotSha256:sourceHash,schemaSha256:typedCensus.schemaSha256,identityDigest,dataDigest:typedCensus.dataDigest};
  result={format:'keryx-server1-online-b0-receipt-v1',inspectionOnly:inspect,phases:{...outcomes},sourceSnapshotSha256:sourceHash,sourceSchemaSha256:typedCensus.schemaSha256,dataDigest:typedCensus.dataDigest,identity:JSON.parse(identityWire),identityDigest,sourceSqlSha256:profile.sourceSqlSha256,catalogSha256:profile.catalogSha256,preparationSha256:preparation.sha256,heldControlSha256:held.sha256,sourceManifestSha256:manifest.sha256,intakeSha256:h.intakeSha256,systemIdentifier:p.systemIdentifier,sourceDatabaseOid:h.sourceDatabaseOid,targetDatabaseOid:h.targetDatabaseOid,staging,publicCensus,projections,nativeCensusSha256:sha(canonicalJson({staging,publicCensus,projections})),heldBaseline,writerMode:'held',applicationBackendSwitched:false,sourceRetired:false,financialCatchupQualified:false,privateAuditRootPreserved:true,applicationAuthority:false,paymentActions:0,jobActions:0};
 }catch(error){failure=error;}
 // Every owned disposal is attempted, including after acknowledged COMMIT.
 try{await stopKeepalive();}catch{cleanupFailures.push('keepalive');}
 if(active)try{await active.query('ROLLBACK');}catch{cleanupFailures.push('rollback');}
 for(const pg of clients)try{await pg.end();}catch{cleanupFailures.push('postgres');}
 if(c)try{controls(c);}catch{cleanupFailures.push('control_stability');}
 if(db){try{if(db.isTransaction)db.exec('ROLLBACK');}catch{cleanupFailures.push('sqlite_rollback');}try{db.close();}catch{cleanupFailures.push('sqlite_close');}}
 for(const held of pins)try{held.close();}catch{cleanupFailures.push('descriptor');}
 if(journal!==undefined){try{emit(failure||cleanupFailures.length?{event:'refused',stage,phases:{...outcomes},cleanupFailures:[...cleanupFailures]}:{event:'held-census',receipt:result});}catch{cleanupFailures.push('receipt');}try{closeSync(journal);}catch{cleanupFailures.push('receipt_close');}}
 if(failure||cleanupFailures.length){const code=failure&&typeof failure==='object'?Reflect.get(failure,'code'):null;throw new Server1B0Unavailable({stage,phases:{...outcomes},cleanupFailures,pgCode:typeof code==='string'&&/^[A-Z0-9]{5}$/.test(code)?code:null});}
 return result;
}
if(process.argv[1]===paths.bundle||typeof import.meta.url==='string'&&process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);const task=args.length===0?runServer1OnlineB0:args.length===1&&args[0]==='--inspect'?inspectServer1OnlineB0:null;
 if(!task)process.exitCode=1;else task().then(receipt=>console.log(JSON.stringify(receipt))).catch(error=>{console.log(JSON.stringify({format:'keryx-server1-online-b0-refusal-v1',diagnostic:error instanceof Server1B0Unavailable?error.diagnostic:null}));process.exitCode=1;});
}
