/** Recording controls exercise operator phases, never native installed proof. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { StorageIdentity } from '../../lib/db/storage-identity';
import type { Client } from 'pg';

const model=vi.hoisted(()=>({files:new Map<string,Buffer>(),fds:new Map<number,string>(),next:20,closed:[] as number[],queries:[] as {database:string;sql:string}[],configs:[] as Record<string,unknown>[],ends:[] as string[],kernels:[] as string[],identity:{} as StorageIdentity,digest:'',
 catalog:'',sqlHash:'',fault:'',commit:0,rollback:0,openError:'',keepaliveFailure:false,delayKernel:false,delayBegin:false,privateRows:0,publicRows:0,stagingRows:0,journalWrites:0,fsyncs:0,
 snapshotClosed:false,failDescriptorClose:false,failSqliteClose:false,failPgClose:false,failJournalSync:false,lateControlDrift:false,role:'postgres',held:true,allowConnect:true,sourceTables:94,stagingCount:94,domains:12,badPublic:false,
 resourceFault:'',resourceAt:0,resourceChecks:0,serviceReads:0,resourceWaiting:false,heartbeatsDuringGuard:0,finalGuardLocked:false}));
const base='/root/keryx-migration',b0=base+'/postgres-b0',prep=base+'/postgres17-server1-preparation.json',held=base+'/postgres17-server1-held-target.json',manifest='/root/.local/share/keryx-mainnet-runtime/production-v2/storage.json',audit='/root/.local/share/keryx-mainnet-runtime/production-v2/.business-operator-audit';
const digest=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const packageWire='postgresql-17\t17.12-1.pgdg24.04+1\tinstalled\n',pgGroup='/system.slice/system-postgresql.slice/postgresql@17-keryx.service',vendor='/usr/lib/systemd/system/postgresql@.service';
const runtimeDrift=()=>model.resourceAt===model.resourceChecks;
vi.mock('node:path',async importOriginal=>{const real=await importOriginal<typeof import('node:path')>();return {...real,...real.posix,default:real.posix};});
vi.mock('node:child_process',()=>({
 execFileSync:(_bin:string,args:string[])=>args.includes('RuntimeMaxUSec')?'30min':'ActiveState=active\nUser=postgres\nGroup=root\nDropInPaths=/etc/systemd/system/postgresql@17-keryx.service.d/20-keryx-preparation.conf',
 execFile:(bin:string,args:string[],options:Record<string,unknown>,done:(error:Error|null,stdout:string,stderr:string)=>void)=>{
  expect(options).toMatchObject({encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024,env:{PATH:'/usr/bin:/bin'}});
  if(bin==='/usr/bin/dpkg-query'){
   expect(args).toEqual(['-W','-f=${binary:Package}\t${Version}\t${db:Status-Status}\n']);model.resourceChecks++;model.serviceReads=0;
   if(model.resourceChecks===5){const q=model.queries.filter(x=>x.database==='keryx_mainnet').map(x=>x.sql),begin=q.findLastIndex(x=>x.startsWith('BEGIN')),end=q.findLastIndex(x=>x==='COMMIT'||x==='ROLLBACK'),lock=q.findLastIndex(x=>x.startsWith('LOCK TABLE '));model.finalGuardLocked=begin>end&&lock>begin;}
   const output=runtimeDrift()&&model.resourceFault==='inventory'?packageWire+'unreviewed\t1\tinstalled\n':packageWire;
   if(runtimeDrift()&&model.resourceFault==='delay'){model.resourceWaiting=true;setTimeout(()=>{model.resourceWaiting=false;done(null,output,'');},1150);}else queueMicrotask(()=>done(null,output,''));
  }else{
   expect(bin).toBe('/usr/bin/systemctl');expect(args.slice(0,2)).toEqual(['show','postgresql@17-keryx.service']);model.serviceReads++;
   const p:Record<string,string>={LoadState:'loaded',ActiveState:'active',SubState:'running',UnitFileState:'enabled',User:'postgres',Group:'root',Type:'simple',DropInPaths:'/etc/systemd/system/postgresql@17-keryx.service.d/20-keryx-preparation.conf',RuntimeDirectory:'postgresql-keryx',RuntimeDirectoryMode:'0750',MemoryMax:'1073741824',MemorySwapMax:'0',CPUQuotaPerSecUSec:'750ms',TasksMax:'64',NoNewPrivileges:'yes',CapabilityBoundingSet:'',MainPID:'4242',FragmentPath:vendor,ExecStart:'path=/usr/lib/postgresql/17/bin/postgres ; argv[]=/usr/lib/postgresql/17/bin/postgres -D /var/lib/postgresql/17/keryx -c config_file=/etc/postgresql/17/keryx/postgresql.conf ;',ControlGroup:pgGroup};
   if(runtimeDrift()&&model.resourceFault==='service')p.MemoryMax='2147483648';if(runtimeDrift()&&model.resourceFault==='pid'&&model.serviceReads===2)p.MainPID='4243';
   queueMicrotask(()=>done(null,args.slice(2).map(x=>{const k=x.slice('--property='.length);return k+'='+p[k];}).join('\n')+'\n',''));
  }return {};
 },
}));
vi.mock('node:fs',async importOriginal=>{
 const real=await importOriginal<typeof import('node:fs')>();
 const file=(path:string)=>model.files.get(path);
 const stat=(path:string)=>{
  const bytes=file(path),socket=path==='/run/postgresql-keryx/.s.PGSQL.5432',socketDir=path==='/run/postgresql-keryx';
  const mode=bytes?0o100600:socket?0o140770:socketDir?0o40750:0o40700;
  return {dev:BigInt(1),ino:BigInt([...path].reduce((sum,c)=>sum+c.charCodeAt(0),100)),uid:BigInt(socket||socketDir?123:0),gid:BigInt(0),mode:BigInt(mode),nlink:BigInt(1),size:BigInt(bytes?.length??0),mtimeNs:BigInt(1),ctimeNs:BigInt(1),isFile:()=>!!bytes,isDirectory:()=>!bytes&&!socket,isSocket:()=>socket,isSymbolicLink:()=>false};
 };
 const pathOf=(v:string|number)=>typeof v==='number'?model.fds.get(v)!:v;
 return {...real,
  lstatSync:(path:string)=>stat(path),realpathSync:(path:string)=>path,
  fstatSync:(fd:number,options?:{bigint?:boolean})=>{const s=stat(pathOf(fd));return options?.bigint?s:{...s,size:Number(s.size)};},
  openSync:(path:string,flags:number)=>{
   if(path===b0+'/intake.jsonl'&&(flags&real.constants.O_EXCL)){if(model.files.has(path))throw Object.assign(new Error('existing'),{code:'EEXIST'});model.files.set(path,Buffer.alloc(0));}
   if(model.openError===path)throw new Error('open refused');const fd=model.next++;model.fds.set(fd,path);return fd;
  },
  closeSync:(fd:number)=>{model.closed.push(fd);if(model.failDescriptorClose&&pathOf(fd)===b0+'/source.sqlite')throw new Error('close');model.fds.delete(fd);},
  readSync:(fd:number,buffer:Buffer,offset:number,length:number,position:number)=>{const data=file(pathOf(fd))!;const bytes=data.subarray(position,position+length);bytes.copy(buffer,offset);return bytes.length;},
  readFileSync:(p:string|number,encoding?:string)=>{
   const path=pathOf(p);let value:Buffer|string|undefined=file(path);
   if(path==='/proc/self/status')value='CapEff:\t0000000000000000\nNoNewPrivs:\t1\n';
   if(path==='/proc/net/route')value='Iface Destination\n';
   if(path==='/proc/self/cgroup')value='0::/system.slice/keryx-postgres-online-b0.service';
   const limits:Record<string,string>={'memory.max':'536870912','memory.swap.max':'0','cpu.max':'25000 100000','pids.max':'32'};
   if(path.startsWith('/sys/fs/cgroup/'))value=limits[path.split('/').at(-1)!];
   if(path==='/proc/4242/status')value=`CapEff:\t${runtimeDrift()&&model.resourceFault==='caps'?'0000000000000001':'0000000000000000'}\nNoNewPrivs:\t${runtimeDrift()&&model.resourceFault==='nnp'?'0':'1'}\nUid:\t${Array(4).fill(runtimeDrift()&&model.resourceFault==='uid'?'124':'123').join('\t')}\n`;
   if(path==='/proc/4242/cgroup')value='0::'+(runtimeDrift()&&model.resourceFault==='group'?'/other':pgGroup);
   if(path.startsWith('/sys/fs/cgroup'+pgGroup+'/')){const pgLimits:Record<string,string>={'memory.max':runtimeDrift()&&model.resourceFault==='memory'?'2147483648':'1073741824','memory.swap.max':runtimeDrift()&&model.resourceFault==='swap'?'1073741824':'0','cpu.max':runtimeDrift()&&model.resourceFault==='cpu'?'100000 100000':'75000 100000','pids.max':runtimeDrift()&&model.resourceFault==='pids'?'128':'64'};value=pgLimits[path.split('/').at(-1)!];}
   if(value===undefined)return real.readFileSync(p,encoding as BufferEncoding);
   return encoding?value.toString():Buffer.from(value);
  },
  createReadStream:(path:string)=>({async *[Symbol.asyncIterator](){yield path===vendor&&runtimeDrift()&&model.resourceFault==='vendor'?Buffer.from('changed vendor unit'):file(path)!;}}),
  writeSync:(fd:number,buffer:Buffer,offset:number,length:number)=>{const path=pathOf(fd);model.files.set(path,Buffer.concat([file(path)??Buffer.alloc(0),buffer.subarray(offset,offset+length)]));model.journalWrites++;return length;},
  fsyncSync:()=>{model.fsyncs++;if(model.failJournalSync&&model.commit>0)throw new Error('fsync');},
 };
});
vi.mock('node:sqlite',()=>({DatabaseSync:class{
 readonly recordingSource=true;
 isTransaction=false;
 constructor(_path:string,options:unknown){expect(options).toMatchObject({readOnly:true,allowExtension:false});}
 exec(sql:string){if(sql==='BEGIN')this.isTransaction=true;if(sql==='ROLLBACK')this.isTransaction=false;}
 prepare(){return {get:()=>({query_only:1})};}
 close(){model.snapshotClosed=true;if(model.failSqliteClose)throw new Error('sqlite close');}
}}));
vi.mock('../../lib/db/storage-identity-sqlite',()=>({readStorageIdentity:()=>model.identity}));
vi.mock('../../lib/db/storage-provenance-snapshot',()=>({checkSnapshotSidecars:()=>{},configureSnapshotConnection:()=>{},validateSnapshotHeader:()=>{}}));
vi.mock('../../lib/db/postgres/runtime-profile',()=>({NATIVE_CURRENT_DATA_INTAKE_PROFILE:{get sourceSqlSha256(){return model.sqlHash;},get catalogSha256(){return model.catalog;}}}));
vi.mock('./native-contract.mts',()=>({exportNativePostgresSchemaContract:()=>({sha256:model.fault==='catalog-mismatch'?'f'.repeat(64):model.catalog,metadata:{sections:{relations:[...Array.from({length:94},(_,i)=>({schema:'public',name:'table_'+i,kind:'r'})),...Array.from({length:14},(_,i)=>({schema:'keryx_storage',name:'table_'+i,kind:'r'}))]}}})}));
vi.mock('./typed-snapshot.mts',async importOriginal=>{
 const real=await importOriginal<typeof import('./typed-snapshot.mts')>();
 return {...real,snapshotTables:(db:unknown)=>db&&typeof db==='object'&&'recordingSource' in db?Array.from({length:model.sourceTables},(_,i)=>({name:'recording_'+i})):real.snapshotTables(db as Parameters<typeof real.snapshotTables>[0])};
});
vi.mock('./typed-snapshot-delta.mts',()=>({inspectTypedDeltaSnapshot:async()=>({tables:94,identityDigest:model.digest,schemaSha256:'a'.repeat(64),dataDigest:'b'.repeat(64)})}));
vi.mock('./rehearse-snapshot.mts',()=>({
 stageSnapshotTransaction:async()=>{model.kernels.push('stage');if(model.fault==='stage')throw new Error('stage');model.stagingRows=1;return {};},
 compareStagedSnapshotTransaction:async()=>{model.kernels.push('compare-stage');return {tables:Array.from({length:model.stagingCount},(_,i)=>({name:'table_'+i,rows:1,digest:'a'.repeat(64)})),totalRows:model.stagingCount};},
}));
vi.mock('./materialize-native-snapshot.mts',()=>({
 compareFreshNativePublicTransaction:async()=>{model.kernels.push('fresh');if(model.badPublic)throw new Error('nonempty');},
 materializeNativeSnapshotTransaction:async()=>{model.kernels.push('public');if(model.fault==='public')throw new Error('public');model.publicRows=1;return {};},
 compareNativeSnapshotTransaction:async()=>{model.kernels.push('compare-public');if(model.fault==='census')throw new Error('census');return {copiedTables:90,totalRows:1,tables:[]};},
}));
vi.mock('./materialize-native-projections.mts',()=>({
 materializeNativeProjectionsTransaction:async()=>{
  model.kernels.push('private');if(model.delayKernel||model.delayBegin)await new Promise(resolve=>setTimeout(resolve,model.delayKernel?1150:10));if(model.fault==='private')throw new Error('private');model.privateRows=1;return {domains:Array(model.domains).fill({})};
 },
 compareNativeProjectionsTransaction:async()=>{model.kernels.push('compare-private');return {domains:Array(model.domains).fill({})};},
}));
vi.mock('pg',async importOriginal=>{
 const real=await importOriginal<typeof import('pg')>();
 return {...real,Client:class{
 database:string;ended=false;
 constructor(readonly config:Record<string,unknown>){this.database=String(config.database);model.configs.push(config);}
 on(){return this;}async connect(){if(this.config.user!=='postgres'&&model.fault!=='hba-success')throw Object.assign(new Error(model.fault==='hba-password'?'password authentication failed':`pg_hba.conf rejects connection for host "[local]", user "${this.config.user}", database "${this.database}", no encryption`),{code:'28000'});}
 async query(sql:string){
  model.queries.push({database:this.database,sql});const row=(v:unknown)=>({rowCount:1,rows:[v]});
  if(model.delayBegin&&sql.startsWith('BEGIN'))await new Promise(resolve=>setTimeout(resolve,10));
  if(sql==='SELECT 1'){if(model.resourceWaiting)model.heartbeatsDuringGuard++;if(model.keepaliveFailure)throw Object.assign(new Error('secret fields not exposed'),{code:'08006'});return row({});}
  if(sql==='COMMIT'){model.commit++;if(model.fault==='ack-'+model.commit)throw Object.assign(new Error('raw private body not exposed'),{code:'08006'});if(model.lateControlDrift&&model.commit===1)model.identity={...model.identity,provenanceDigest:'f'.repeat(64)};return row({});}
  if(sql==='ROLLBACK'){model.rollback++;return row({});}
  if(sql.startsWith('SELECT current_database()'))return row({name:this.database,role:model.role,current_role:model.role,version:'170012',port:'5432',directory:'/var/lib/postgresql/17/keryx',socket:'/run/postgresql-keryx',socket_group:'root',socket_mode:'0770',listeners:'',fsync:'on',synchronous_commit:'on',full_page_writes:'on',data_checksums:'on',system_identifier:'123456789',oid:this.database==='keryx_source'?'10001':'10002'});
  if(sql.startsWith('SELECT encode(sha256'))return row({postgresql:'c'.repeat(64),hba:'d'.repeat(64),ident:'e'.repeat(64)});
  if(sql.startsWith('SELECT r.rolname owner'))return row({owner:'postgres',connection_limit:16});
  if(sql.startsWith('SELECT DISTINCT d.database_name'))return {rowCount:4,rows:[{database_name:'keryx_mainnet',role_name:'keryx_app'},{database_name:'keryx_mainnet',role_name:'keryx_reader'},{database_name:'keryx_source',role_name:'keryx_app'},{database_name:'keryx_source',role_name:'keryx_reader'}]};
  if(sql.startsWith('SELECT r.rolname'))return {rowCount:2,rows:[{rolname:'keryx_app',rolsuper:false,rolbypassrls:false,can_connect:model.allowConnect},{rolname:'keryx_reader',rolsuper:false,rolbypassrls:false,can_connect:model.allowConnect}]};
  if(sql.includes('rolname owner'))return row({owner:'postgres'});
  if(sql.includes('SELECT mode FROM'))return row({mode:model.held?'held':'active'});
  if(sql.startsWith('WITH observed'))return row({wire:'recording catalog'});
  if(sql.startsWith('SELECT identity::text'))return row({wire:JSON.stringify(model.identity),identity_digest:model.digest});
  if(sql.startsWith('SELECT source_digest'))return row({source_digest:model.catalog});
  if(sql.includes('count(*)::text n'))return row({n:'0'});
  return row({});
 }
 async end(){model.ends.push(this.database+':'+String(this.config.user));this.ended=true;if(model.failPgClose&&this.config.user==='postgres')throw new Error('private driver details');}
 }};
});
import { inspectServer1OnlineB0, runServer1OnlineB0, Server1B0Unavailable } from './server1-online-b0-intake.mts';

beforeEach(async()=>{
 model.files.clear();model.fds.clear();model.next=20;model.closed=[];model.queries=[];model.configs=[];model.ends=[];model.kernels=[];
 Object.assign(model,{fault:'',commit:0,rollback:0,openError:'',keepaliveFailure:false,delayKernel:false,delayBegin:false,privateRows:0,publicRows:0,stagingRows:0,journalWrites:0,fsyncs:0,snapshotClosed:false,failDescriptorClose:false,failSqliteClose:false,failPgClose:false,failJournalSync:false,lateControlDrift:false,role:'postgres',held:true,allowConnect:true,sourceTables:94,stagingCount:94,domains:12,badPublic:false,resourceFault:'',resourceAt:0,resourceChecks:0,serviceReads:0,resourceWaiting:false,heartbeatsDuringGuard:0,finalGuardLocked:false});
 const {STORAGE_MAINNET_PROFILE_DIGEST,storageIdentityDigest}=await import('../../lib/db/storage-identity');
 model.identity={format:'keryx-mainnet-storage-identity-v1',deploymentId:'11111111-1111-4111-8111-111111111111',storageId:'22222222-2222-4222-8222-222222222222',network:'eip155:5042',authorityMode:'mainnet-real',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,enrollmentId:'33333333-3333-4333-8333-333333333333',enrolledAt:'2026-11-11T00:00:00.000Z',provenanceDigest:'4'.repeat(64)};
 model.digest=storageIdentityDigest(model.identity);model.catalog='9'.repeat(64);model.sqlHash=digest('fixed-sql');
 const put=(p:string,v:unknown)=>model.files.set(p,Buffer.from(typeof v==='string'?v:JSON.stringify(v)));
 put('/etc/systemd/system/postgresql@17-keryx.service.d/20-keryx-preparation.conf','fixed-service');
 put(vendor,'fixed-vendor-unit');
 put(prep,{format:'keryx-server1-postgres17-preparation-v1',phase:'prepared-unenrolled',cluster:'17/keryx',service:'postgresql@17-keryx.service',socketDirectory:'/run/postgresql-keryx',port:5432,serverVersionNum:170012,dataDirectory:'/var/lib/postgresql/17/keryx',systemIdentifier:'123456789',approvedPinSha256:'a'.repeat(64),packageInventorySha256:digest(packageWire),vendorUnitSha256:digest('fixed-vendor-unit'),configHashes:{postgresql:'c'.repeat(64),hba:'d'.repeat(64),ident:'e'.repeat(64),service:digest('fixed-service')},observations:{socketDirectoryUid:123}});
 put(manifest,{format:'keryx-storage-deployment-v1',identity:model.identity,backend:{kind:'sqlite',databasePath:'/root/live/source.sqlite'}});put('/root/live/source.sqlite','live Original is never opened');put(b0+'/source.sqlite','bounded synthetic copy');put(b0+'/source.sql','fixed-sql');put(b0+'/intake.cjs','fixed-bundle');
 put(held,{format:'keryx-server1-postgres17-held-target-v1',phase:'fresh-held-unenrolled',preparationSha256:digest(model.files.get(prep)!),systemIdentifier:'123456789',sourceDatabaseOid:'10001',targetDatabaseOid:'10002',sourceSqlSha256:model.sqlHash,catalogSha256:model.catalog,identityDigest:model.digest,sourceManifestSha256:digest(model.files.get(manifest)!),intakeSha256:digest('fixed-bundle'),connectionDenial:'hba-reject',applicationConnectDenied:true,readerConnectDenied:true});
 put(b0+'/snapshot.json',{format:'keryx-consistent-online-sqlite-copy-v1',backupComplete:true,sourceOpenedReadOnly:true,sha256:digest('bounded synthetic copy'),bytes:Buffer.byteLength('bounded synthetic copy'),sourceManifestSha256:digest(model.files.get(manifest)!)});
 const original=globalThis.process;
 vi.stubGlobal('process',new Proxy(original,{get(target,key){if(key==='platform')return 'linux';if(key==='version')return 'v24.22.1';if(key==='getuid')return ()=>0;if(key==='argv')return ['node',b0+'/intake.cjs'];if(key==='execArgv')return ['--no-warnings','--max-old-space-size=256'];if(key==='env')return {...target.env,KERYX_NETWORK:'arc',NEXT_PUBLIC_KERYX_NETWORK:'arc',KERYX_FORCE_OFFLINE:'0'};return Reflect.get(target,key,target);}}));
});
afterEach(()=>vi.unstubAllGlobals());
const events=()=>model.files.get(b0+'/intake.jsonl')?.toString().trim().split('\n').filter(Boolean).map(v=>JSON.parse(v))??[];
async function refusal(){try{await runServer1OnlineB0();throw new Error('expected refusal');}catch(error){expect(error).toBeInstanceOf(Server1B0Unavailable);return (error as Server1B0Unavailable).diagnostic;}}

describe('fixed server1 B0 recording lifecycle (not actual PG qualification)',()=>{
 it('keeps real timer heartbeats behind first locks even when BEGIN is delayed',async()=>{
  const interval=globalThis.setInterval;
  const timer=vi.spyOn(globalThis,'setInterval').mockImplementation(((callback:()=>void)=>interval(callback,1)) as typeof setInterval);
  model.delayBegin=true;
  try{
   await runServer1OnlineB0();
   expect(model.queries.some(q=>q.sql==='SELECT 1')).toBe(true);
   for(let i=0;i<model.queries.length;i++)if(model.queries[i].sql.startsWith('BEGIN')){
    expect(model.queries[i+1].sql).not.toBe('SELECT 1');
    if(model.queries[i].sql==='BEGIN ISOLATION LEVEL REPEATABLE READ')expect(model.queries[i+1].sql).toMatch(/^LOCK TABLE /);
   }
  }finally{timer.mockRestore();}
 });
 it('uses only fixed peer clients, locks before RR reads and independently compares all domains',async()=>{
  const result=await runServer1OnlineB0().catch(error=>{throw new Error(JSON.stringify(error.diagnostic));}) as {phases:Record<string,string>;writerMode:string;applicationAuthority:boolean};
  expect(result.phases).toEqual({'typed-staging':'acknowledged','public-cells':'acknowledged','private-projections':'acknowledged'});expect(result.writerMode).toBe('held');expect(result.applicationAuthority).toBe(false);
  expect(model.configs.filter(c=>c.user==='postgres').map(c=>[c.host,c.database,c.user])).toEqual([['/run/postgresql-keryx','keryx_source','postgres'],['/run/postgresql-keryx','keryx_mainnet','postgres'],['/run/postgresql-keryx','keryx_source','postgres'],['/run/postgresql-keryx','keryx_mainnet','postgres']]);
  expect(model.configs.every(c=>typeof c.password==='function')).toBe(true);expect(()=>Reflect.apply(model.configs[0].password as ()=>never,undefined,[])).toThrow('peer authentication');
  expect(model.kernels).toEqual(['fresh','stage','public','private','compare-stage','compare-public','compare-private']);
  for(let i=0;i<model.queries.length;i++)if(model.queries[i].sql==='BEGIN ISOLATION LEVEL REPEATABLE READ')expect(model.queries[i+1].sql).toMatch(/^LOCK TABLE /);
  expect(model.ends.filter(e=>e.endsWith(':postgres'))).toHaveLength(4);expect(model.snapshotClosed).toBe(true);expect(model.fds.size).toBe(0);expect(events().at(-1).event).toBe('held-census');expect(model.fsyncs).toBeGreaterThan(12);
 });
 it.each(['stage','public','private'])('rolls back a %s kernel refusal without resubmitting it',async fault=>{
  model.fault=fault;const error=await refusal();expect(error.phases[fault==='stage'?'typed-staging':fault==='public'?'public-cells':'private-projections']).toBe('not_attempted');expect(model.kernels.filter(k=>k===fault)).toHaveLength(1);expect(model.rollback).toBeGreaterThan(0);expect(model.ends.filter(e=>e.endsWith(':postgres'))).toHaveLength(2);expect(model.snapshotClosed).toBe(true);
 });
 it.each([1,2,3])('preserves unknown phase after COMMIT %i loses its ACK',async count=>{
  model.fault='ack-'+count;const error=await refusal();expect(error.phases[['typed-staging','public-cells','private-projections'][count-1] as keyof typeof error.phases]).toBe('unknown');expect(model.commit).toBe(count);expect(events().some(e=>e.event==='held-census')).toBe(false);expect(JSON.stringify(error)).not.toContain('raw private');expect(error.pgCode).toBe('08006');
 });
 it('keeps acknowledged COMMIT after a final control failure and attempts all cleanup',async()=>{
  model.lateControlDrift=true;model.failSqliteClose=true;model.failDescriptorClose=true;model.failPgClose=true;
  const error=await refusal();expect(error.phases['typed-staging']).toBe('acknowledged');expect(error.phases['public-cells']).toBe('not_attempted');expect(error.cleanupFailures).toEqual(expect.arrayContaining(['postgres','sqlite_close','descriptor','control_stability']));expect(model.ends.filter(e=>e.endsWith(':postgres'))).toHaveLength(2);expect(model.closed.length).toBeGreaterThanOrEqual(8);expect(events().at(-1).event).toBe('refused');
 });
 it('keeps actual acknowledgement even when durable ACK receipt fsync fails',async()=>{
  model.failJournalSync=true;const error=await refusal();expect(error.phases['typed-staging']).toBe('acknowledged');expect(error.cleanupFailures).toContain('receipt');expect(model.commit).toBe(1);
 });
 it('rejects an existing or partial target before any stage write',async()=>{
  model.badPublic=true;await refusal();expect(model.kernels).toEqual(['fresh']);expect(model.commit).toBe(0);expect(model.stagingRows).toBe(0);
 });
 it.each(['role','held','connect','catalog','source-count','domain-count','census'])('retains actual %s guard refusal',async which=>{
  if(which==='role')model.role='owneradmin';if(which==='held')model.held=false;if(which==='connect')model.allowConnect=false;if(which==='catalog')model.fault='catalog-mismatch';if(which==='source-count')model.sourceTables=93;if(which==='domain-count')model.domains=11;if(which==='census')model.fault='census';
  await refusal();expect(events().some(e=>e.event==='held-census')).toBe(false);if(['role','held','connect','catalog','source-count'].includes(which))expect(model.commit).toBe(0);
 });
 it('refuses absent protected control and never opens a client',async()=>{
  model.openError=held;await refusal();expect(model.configs).toHaveLength(0);expect(model.commit).toBe(0);
 });
 it('refuses caller targets/callbacks before any file or SQL access',async()=>{
  await expect(Reflect.apply(runServer1OnlineB0,undefined,[{database:'other',allowProduction:true}])).rejects.toThrow();expect(model.fds.size).toBe(0);expect(model.configs).toHaveLength(0);
 });
 it.each(['hba-success','hba-password'])('refuses %s instead of accepting generic authentication refusal',async fault=>{
  model.fault=fault;await refusal();expect(model.commit).toBe(0);expect(model.ends.some(e=>e.endsWith(':keryx_app'))).toBe(true);expect(model.kernels).toHaveLength(0);
 });
 it('refuses re-execution instead of adopting its prior receipt',async()=>{
  await runServer1OnlineB0();const count=model.commit;await refusal();expect(model.commit).toBe(count);expect(model.configs.filter(c=>c.user==='postgres')).toHaveLength(4);
 });
 it('drains bounded keepalive failure before any next COMMIT',async()=>{
  model.delayKernel=true;model.keepaliveFailure=true;const error=await refusal();expect(error.phases['public-cells']).toBe('acknowledged');expect(error.phases['private-projections']).toBe('not_attempted');expect(error.cleanupFailures).toContain('keepalive');expect(model.queries.some(q=>q.sql==='SELECT 1')).toBe(true);expect(model.commit).toBe(2);
 });
 it('inspects ambiguity with independent reads and no new COMMIT or copy',async()=>{
  model.fault='ack-3';await refusal();model.fault='';model.kernels=[];const before=model.commit;
  const report=await inspectServer1OnlineB0() as {inspectionOnly:boolean;phases:Record<string,string>};expect(report.inspectionOnly).toBe(true);expect(report.phases['private-projections']).toBe('unknown');expect(model.commit).toBe(before);expect(model.kernels).toEqual(['compare-stage','compare-public','compare-private']);
 });
});

describe('development wrapper and kernel source boundaries',()=>{
 it('keeps every development containment/target pin and no production bypass parameter',async()=>{
  const fs=await vi.importActual<typeof import('node:fs')>('node:fs');
  const root=new URL('.',import.meta.url);
  const publicWire=fs.readFileSync(new URL('materialize-native-snapshot.mts',root),'utf8'),privateWire=fs.readFileSync(new URL('materialize-native-projections.mts',root),'utf8');
  for(const wire of [publicWire,privateWire]){expect(wire).toContain('assertDevelopmentMaterializationContainment();');expect(wire).toContain("assert.equal(options.database,'native_materialized')");expect(wire).toContain("assert.equal(options.role,'postgres')");expect(wire).toContain("assert.deepEqual(options.endpoint,{kind:'loopback',port:5432})");expect(wire).toContain("/^[a-f0-9]{48}$/");expect(wire).not.toContain('allowProduction');}
  expect(publicWire).toContain("assert.equal(server.version,'170012')");expect(publicWire).toContain("['memory.max','536870912']");expect(publicWire).toContain("['cpu.max','25000 100000']");expect(publicWire).toContain("['pids.max','32']");expect(publicWire).toContain("'/child.cjs','--materialize'");
 });
 it('has no application importer and no native issuer or activation call',async()=>{
  const fs=await vi.importActual<typeof import('node:fs')>('node:fs');const text=fs.readFileSync(new URL('server1-online-b0-intake.mts',import.meta.url),'utf8');
  expect(text).not.toMatch(/assertPostgresRuntimeIdentity|registerPostgres|control_transition\(|allowProduction/);expect(text).not.toContain('postgresPoolConfiguration');
  expect(text).toContain("stage='independent-census'");expect(text).toContain("event:'commit-intent'");expect(text).toContain("constants.O_EXCL");expect(text).toContain("await stopKeepalive()");
  expect(text).toContain("if(process.argv[1]===paths.bundle||typeof import.meta.url==='string'");
 });
});

describe('current package/service/kernel observations under CapEff0 (recording only)',()=>{
 it.each(['inventory','service','uid','caps','nnp','group','memory','swap','cpu','pids','vendor','pid'])('refuses initial %s drift before any SQL copy or journal',async fault=>{
  model.resourceFault=fault;model.resourceAt=1;const error=await refusal();expect(error.stage).toBe('resource-initial');expect(model.commit).toBe(0);expect(model.kernels).toEqual([]);expect(model.files.has(b0+'/intake.jsonl')).toBe(false);expect(model.fds.size).toBe(0);
 });
 it('does not relabel an acknowledged prior phase when a precommit package check fails',async()=>{
  model.resourceFault='inventory';model.resourceAt=3;const error=await refusal();expect(model.commit).toBe(1);expect(error.phases).toEqual({'typed-staging':'acknowledged','public-cells':'not_attempted','private-projections':'not_attempted'});expect(error.stage).toBe('public-cells-resource-precommit');expect(model.rollback).toBeGreaterThan(0);expect(events().some(e=>e.event==='held-census')).toBe(false);
 });
 it('checks final service state while target locks remain held and retains all known ACKs',async()=>{
  model.resourceFault='service';model.resourceAt=5;const error=await refusal();expect(model.commit).toBe(3);expect(model.finalGuardLocked).toBe(true);expect(error.stage).toBe('resource-final');expect(Object.values(error.phases)).toEqual(['acknowledged','acknowledged','acknowledged']);expect(events().at(-1).event).toBe('refused');expect(model.ends.filter(e=>e.endsWith(':postgres'))).toHaveLength(4);
 });
 it('keeps a real heartbeat runnable during slow asynchronous precommit metadata',async()=>{
  model.resourceFault='delay';model.resourceAt=2;await runServer1OnlineB0();expect(model.resourceChecks).toBe(5);expect(model.heartbeatsDuringGuard).toBeGreaterThan(0);expect(model.commit).toBe(3);expect(events().at(-1).event).toBe('held-census');
 });
});

it('stages and independently rechecks real SQLite typed bytes without owning a transaction or connection',async()=>{
 const {DatabaseSync}=await vi.importActual<typeof import('node:sqlite')>('node:sqlite');
 const {stageSnapshotTransaction,compareStagedSnapshotTransaction}=await vi.importActual<typeof import('./rehearse-snapshot.mts')>('./rehearse-snapshot.mts');
 const db=new DatabaseSync(':memory:');const sqls:string[]=[],rows=new Map<string,Array<{ordinal:number;wire:string}>>(),tables=new Map<string,Record<string,unknown>>();let schema:Record<string,string>={};
 const pg={async query(sql:string,values:unknown[]=[]){
  sqls.push(sql);const row=(v:unknown)=>({rowCount:1,rows:[v]});
  if(sql.includes("current_setting('server_version_num')"))return row({version:'170012'});
  if(sql.startsWith('INSERT INTO keryx_migration.snapshot_manifest')){schema={schema_wire:String(values[0]),schema_digest:String(values[1])};return row({});}
  if(sql.startsWith('INSERT INTO keryx_migration.snapshot_rows')){const name=String(values[0]);rows.set(name,[...(rows.get(name)??[]),...JSON.parse(String(values[1]))]);return row({});}
  if(sql.startsWith('INSERT INTO keryx_migration.snapshot_tables')){tables.set(String(values[0]),{descriptor_wire:values[1],row_count:String(values[2]),row_digest:values[3]});return row({});}
  if(sql.startsWith('SELECT schema_wire'))return row(schema);
  if(sql.startsWith('SELECT descriptor_wire'))return row(tables.get(String(values[0])));
  if(sql.startsWith('SELECT r.ordinal')){const page=(rows.get(String(values[0]))??[]).filter(r=>r.ordinal>=Number(values[1])).slice(0,8).map(r=>({ordinal:String(r.ordinal),row_wire:r.wire}));return {rowCount:page.length,rows:page};}
  if(sql.includes('count(*)::text n FROM keryx_migration.snapshot_tables'))return row({n:String(tables.size)});
  if(sql.includes('count(*)::text n FROM keryx_migration.snapshot_rows'))return row({n:String([...rows.values()].reduce((n,r)=>n+r.length,0))});
  return row({});
 }} as unknown as Client;
 try{
  db.exec("CREATE TABLE original(id INTEGER PRIMARY KEY,raw,value); INSERT INTO original VALUES(9223372036854775807,CAST(x'efbbbf0061c3ff' AS TEXT),x'00ff'); PRAGMA query_only=ON; BEGIN");
  const first=await stageSnapshotTransaction(db,pg),again=await compareStagedSnapshotTransaction(db,pg);expect(again.tables).toEqual(first.tables);expect(again.totalRows).toBe(1);expect(rows.get('original')![0].wire).toContain('9223372036854775807');expect(rows.get('original')![0].wire).toContain('efbbbf0061c3ff');
  expect(db.isTransaction).toBe(true);expect(sqls.some(s=>/^(BEGIN|COMMIT|ROLLBACK)/.test(s))).toBe(false);
  rows.get('original')![0].wire=rows.get('original')![0].wire.replace('efbbbf0061c3ff','efbbbf0061c3fe');await expect(compareStagedSnapshotTransaction(db,pg)).rejects.toThrow('digest mismatch');
 }finally{db.close();}
});
