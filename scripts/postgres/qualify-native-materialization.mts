/** Development-only native materialization controller. Source metadata is built
 * independently; no existing target, runtime writer or production deployment. */
import assert from 'node:assert/strict';
import { execFileSync,spawn } from 'node:child_process';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { chmodSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmdirSync,unlinkSync } from 'node:fs';
import { dirname,isAbsolute,join,relative,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { setTimeout as delay } from 'node:timers/promises';
import { nativeRuntimeSource } from './native-runtime-source.mts';
import { exportNativePostgresSchemaContract } from './native-contract.mts';
import { NATIVE_READONLY_RUNTIME_PROFILE } from '../../lib/db/postgres/runtime-profile';
const pgImage='postgres@sha256:d3244e8ce3f165ee3c93d9c4a4b1d0fe48b3a89e2287b717fdcbbde92d405065';
const nodeImage='node@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c';
const args=process.argv.slice(2),sourcePlanOnly=args[0]==='--source-plan-only',synthetic=args[0]==='--synthetic',retained=args[0]==='--retained';
assert(sourcePlanOnly||synthetic||retained);assert.equal(args.length,retained?3:1);assert.equal(process.version,'v24.22.1');
const common=execFileSync('git',['rev-parse','--path-format=absolute','--git-common-dir'],{encoding:'utf8',windowsHide:true,timeout:10000}).trim(),root=dirname(common),taskRoot=resolve(root,'.local/tmp/postgres-mainnet-migration-20261111');
const input=retained?resolve(args[1]):undefined,expectedHash=retained?args[2]:undefined;
if(input){
 assert(/^[a-f0-9]{64}$/.test(expectedHash!));const backupRoot=resolve(root,'.local/backups/postgres-mainnet-migration-20261111'),within=relative(backupRoot,input);
 assert(!isAbsolute(within)&&within!==''&&within!=='..'&&!within.startsWith('..'+(process.platform==='win32'?'\\':'/')));assert.equal(realpathSync(input).toLowerCase(),input.toLowerCase());const st=lstatSync(input);assert(st.isFile()&&!st.isSymbolicLink()&&st.size>0&&st.size<=536870912);
 if(process.platform==='win32')execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop';$a=Get-Acl -LiteralPath $env:KERYX_SNAPSHOT_INPUT;if(-not $a.AreAccessRulesProtected){throw 'Private ACL required'};$u=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;foreach($r in $a.Access){$s=$r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;if($r.IsInherited -or $r.AccessControlType -ne 'Allow' -or @($u,'S-1-5-18','S-1-5-32-544') -notcontains $s){throw 'Unexpected private ACL principal'}}"],{env:{...process.env,KERYX_SNAPSHOT_INPUT:input},windowsHide:true,timeout:10000,stdio:'pipe'});
 else{assert.equal(st.uid,process.getuid?.());assert.equal(st.nlink,1);assert.equal(st.mode&0o077,0);}
}
const name='keryx-native-materialization-'+randomUUID(),password=randomBytes(24).toString('hex'),key=synthetic?randomBytes(32).toString('hex'):process.env.CONTENT_MASTER_KEY;let owned=false;
if(!sourcePlanOnly)assert(typeof key==='string'&&/^[a-fA-F0-9]{64}$/.test(key));
let folder:string|undefined,bundle:string|undefined,coldBundle:string|undefined,nodeName:string|undefined;
const docker=(args:string[],input?:string,timeout=30000)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout,maxBuffer:8388608,stdio:['pipe','pipe','pipe']}).trim();
const sql=(database:'postgres'|'native_source'|'native_materialized',query:string)=>docker(['exec','-i',name,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],query);
const runChild=(run:string[],packet:string,deadline:number)=>new Promise<{code:number|null;stdout:string}>(resolveResult=>{
 const child=spawn('docker',run,{windowsHide:true,stdio:['pipe','pipe','ignore']});child.stdin.on('error',()=>{});child.stdin.end(packet);let stdout='',done=false;
 const stop=()=>{try{if(nodeName)docker(['kill',nodeName]);}finally{child.kill();}};
 const timer=setTimeout(stop,deadline);child.stdout.on('data',(chunk:Buffer)=>{stdout+=chunk.toString('utf8');if(Buffer.byteLength(stdout)>262144)stop();});
 const finish=(code:number|null)=>{if(done)return;done=true;clearTimeout(timer);resolveResult({code,stdout});};child.once('error',()=>finish(null));child.once('close',finish);
});
try{
 const source=nativeRuntimeSource();assert.equal(source.sha256,NATIVE_READONLY_RUNTIME_PROFILE.sourceSqlSha256);
 assert.match(docker(['image','inspect',pgImage,'--format','{{.Id}}']),/^sha256:[a-f0-9]{64}$/);
 owned=true;docker(['run','-d','--name',name,'--label','keryx.native-materialization='+name,'--network','none','--user','postgres','--read-only','--memory','3g','--memory-swap','3g','--cpus','1','--pids-limit','64','--cap-drop','ALL','--security-opt','no-new-privileges','--ulimit','core=0','--tmpfs','/var/lib/postgresql/data:rw,nosuid,uid=70,gid=70,size=2g','--tmpfs','/var/run/postgresql:rw,nosuid,uid=70,gid=70,size=8m','--tmpfs','/tmp:rw,nosuid,size=16m','-e','POSTGRES_PASSWORD='+password,pgImage,'-c','shared_buffers=64MB','-c','max_connections=12','-c','work_mem=4MB','-c','max_wal_size=256MB','-c','log_min_error_statement=panic','-c','log_error_verbosity=terse']);
 let ready=false;for(let i=0;i<200;i++){try{docker(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],undefined,2000);ready=true;break;}catch{await delay(100);}}assert(ready);
 assert.equal(docker(['exec',name,'cat','/sys/fs/cgroup/memory.max','/sys/fs/cgroup/memory.swap.max','/sys/fs/cgroup/cpu.max','/sys/fs/cgroup/pids.max']),'3221225472\n0\n100000 100000\n64');
 sql('postgres',`CREATE ROLE keryx_owner NOLOGIN NOINHERIT;CREATE ROLE keryx_app LOGIN NOINHERIT CONNECTION LIMIT 8 PASSWORD '${password}';CREATE ROLE keryx_reader LOGIN NOINHERIT CONNECTION LIMIT 4 PASSWORD '${password}';CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN;
 CREATE DATABASE native_source WITH TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE 'C' LC_CTYPE 'C' CONNECTION LIMIT 16;
 CREATE DATABASE native_materialized WITH TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE 'C' LC_CTYPE 'C' CONNECTION LIMIT 16;
 CREATE DATABASE native_staging WITH TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE 'C' LC_CTYPE 'C' CONNECTION LIMIT 16;
 REVOKE ALL ON DATABASE native_staging FROM PUBLIC,keryx_app,keryx_reader,anon,authenticated,service_role;`);
 for(const database of ['native_source','native_materialized'] as const){
  assert.equal(sql(database,"SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public';"),'0');
  sql(database,`GRANT CREATE ON DATABASE ${database} TO keryx_owner;CREATE PUBLICATION supabase_realtime;ALTER PUBLICATION supabase_realtime OWNER TO keryx_owner;GRANT CREATE ON SCHEMA public TO keryx_owner;SET statement_timeout='30s';BEGIN;`+source.sql+'\nCOMMIT;');
 }
 const describe="SET statement_timeout='5s';SELECT keryx_storage.catalog_contract();",referenceWire=sql('native_source',describe),reference=exportNativePostgresSchemaContract(referenceWire),actual=exportNativePostgresSchemaContract(sql('native_materialized',describe));
 assert.equal(reference.sha256,NATIVE_READONLY_RUNTIME_PROFILE.catalogSha256);assert.equal(actual.sha256,reference.sha256);
 if(sourcePlanOnly){
 const tables=JSON.parse(sql('native_source',`SELECT jsonb_agg(t ORDER BY t.name) FROM(SELECT c.relname name,
 (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'nullable',NOT a.attnotnull) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) columns,
 (SELECT jsonb_agg(jsonb_build_object('name',k.conname,'definition',pg_get_constraintdef(k.oid),'referencedTable',r.relname,'deferrable',k.condeferrable,'initiallyDeferred',k.condeferred) ORDER BY k.conname) FROM pg_constraint k JOIN pg_class r ON r.oid=k.confrelid WHERE k.conrelid=c.oid AND k.contype='f') foreign_keys
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r')t;`)) as Array<{name:string}>;
 assert.equal(tables.length,94);const seeds:Record<string,unknown[]>={};
 for(const table of tables){assert(/^[a-z][a-z0-9_]*$/.test(table.name));const rows=JSON.parse(sql('native_source',`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT * FROM public."${table.name}" LIMIT 3)t;`)) as unknown[];assert(rows.length<=1);if(rows.length)seeds[table.name]=rows;}
 console.log(JSON.stringify({format:'keryx-native-materialization-source-plan-v1',passed:true,sourceSqlSha256:source.sha256,catalogSha256:reference.sha256,independentFreshSourceTargetEqual:true,postgresImage:pgImage,postgresMemoryBytes:3221225472,postgresSwapBytes:0,nativePublicTables:tables,pristineSeedRows:seeds,applicationMaterialized:false,selectedApplicationWriter:false,productionDataRead:false,productionChanged:false,paymentActions:0,jobActions:0}));
 }else{
  assert.match(docker(['image','inspect',nodeImage,'--format','{{.Id}}']),/^sha256:[a-f0-9]{64}$/);const location=join(taskRoot,'native-materialization');mkdirSync(location,{recursive:true});assert.equal(realpathSync(location).toLowerCase(),location.toLowerCase());folder=mkdtempSync(join(location,'job-'));if(process.platform!=='win32')chmodSync(folder,0o700);bundle=join(folder,'child.cjs');
  buildSync({entryPoints:[fileURLToPath(new URL('./native-materialization-child.mts',import.meta.url))],outfile:bundle,bundle:true,platform:'node',target:'node24',format:'cjs',minifyWhitespace:true,external:['pg-native'],logLevel:'silent'});
  const compiled=readFileSync(bundle);assert(compiled.length>0&&compiled.length<=4194304);nodeName='keryx-native-materialization-node-'+randomUUID();
  const run=['run','-i','--name',nodeName,'--label','keryx.native-materialization-node='+name,'--network','container:'+name,'--user','0:0','--read-only','--memory','512m','--memory-swap','512m','--cpus','.25','--pids-limit','32','--cap-drop','ALL','--security-opt','no-new-privileges','--ulimit','core=0','--tmpfs','/run/keryx-intake:rw,nosuid,noexec,mode=0700,size=16m','--mount',`type=bind,source=${bundle},target=/child.cjs,readonly`];
  if(input)run.push('--mount',`type=bind,source=${input},target=/input/snapshot.sqlite,readonly`);run.push(nodeImage,'/usr/bin/timeout','--signal=KILL','1800s','node','--no-warnings','--max-old-space-size=256','/child.cjs','--materialize');
  const packet=JSON.stringify({mode:retained?'retained':'synthetic',password,referenceWire,key,...(expectedHash?{expectedHash}:{})});assert(Buffer.byteLength(packet)<=8388608);
  const result=await runChild(run,packet,1810000);
  const state=JSON.parse(docker(['inspect',nodeName,'--format','{{json .State}}'])) as {Running:boolean;OOMKilled:boolean};assert(!state.Running);
  const reports=result.stdout.split(/\r?\n/).filter(s=>s.startsWith('{')).map(s=>JSON.parse(s) as Record<string,unknown>),report=reports.at(-1)??null;
  const sourceIdentityForColdChild=report?.sourceIdentityForColdChild;delete report?.sourceIdentityForColdChild;
  console.log(JSON.stringify({format:'keryx-native-materialization-qualification-v1',sourceSqlSha256:source.sha256,catalogSha256:reference.sha256,independentFreshSourceTargetEqual:true,postgresImage:pgImage,nodeImage,compiledSha256:createHash('sha256').update(compiled).digest('hex'),compiledBytes:compiled.length,compiledByteLimitInclusive:4194304,postgresMemoryBytes:3221225472,postgresSwapBytes:0,privateInputCopiedIntoImage:false,workerExit:result.code,oomKilled:state.OOMKilled,report,productionChanged:false,applicationBackendSwitched:false}));
  assert.equal(result.code,0);assert.equal(state.OOMKilled,false);assert.equal(report?.passed,true);
  assert.equal(docker(['inspect',nodeName,'--format','{{index .Config.Labels "keryx.native-materialization-node"}}']),name);docker(['rm',nodeName]);nodeName=undefined;
  coldBundle=join(folder,'cold.cjs');buildSync({entryPoints:[fileURLToPath(new URL('./native-materialized-cold-child.mts',import.meta.url))],outfile:coldBundle,bundle:true,platform:'node',target:'node24',format:'cjs',minifyWhitespace:true,external:['pg-native'],logLevel:'silent'});
  const coldCompiled=readFileSync(coldBundle);assert(coldCompiled.length>0&&coldCompiled.length<=16777216);
  nodeName='keryx-native-materialization-cold-'+randomUUID();
  const coldRun=['run','-i','--name',nodeName,'--label','keryx.native-materialization-node='+name,'--network','container:'+name,'--user','0:0','--read-only','--memory','512m','--memory-swap','512m','--cpus','1','--pids-limit','64','--cap-drop','ALL','--security-opt','no-new-privileges','--ulimit','core=0','--tmpfs','/run/keryx-runtime:rw,nosuid,noexec,mode=0700,size=16m','--mount',`type=bind,source=${coldBundle},target=/cold.cjs,readonly`,
   '-e','KERYX_NETWORK=arc','-e','NEXT_PUBLIC_KERYX_NETWORK=arc','-e','KERYX_FORCE_OFFLINE=0','-e','BASE_URL=https://keryx.cc',
   '-e','KERYX_REGISTRY_ADDRESS=0x5555555555555555555555555555555555555555','-e','NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS=0x5555555555555555555555555555555555555555',
   nodeImage,'/usr/bin/timeout','--signal=KILL','180s','node','--no-warnings','--max-old-space-size=256','/cold.cjs','--cold'];
  const coldPacket=JSON.stringify({identity:sourceIdentityForColdChild,password,key,cache:report.cache});assert(Buffer.byteLength(coldPacket)<=32768);
  sql('native_materialized',"BEGIN;UPDATE keryx_storage.control SET mode='active' WHERE singleton;COMMIT;");
  try{
   const coldResult=await runChild(coldRun,coldPacket,190000),coldState=JSON.parse(docker(['inspect',nodeName,'--format','{{json .State}}'])) as {Running:boolean;OOMKilled:boolean};assert(!coldState.Running);
   const coldReports=coldResult.stdout.split(/\r?\n/).filter(s=>s.startsWith('{')).map(s=>JSON.parse(s) as Record<string,unknown>),coldReport=coldReports.at(-1)??null;
   console.log(JSON.stringify({format:'keryx-native-materialized-cold-qualification-v1',compiledSha256:createHash('sha256').update(coldCompiled).digest('hex'),compiledBytes:coldCompiled.length,compiledByteLimitInclusive:16777216,workerExit:coldResult.code,oomKilled:coldState.OOMKilled,report:coldReport,productionChanged:false,applicationBackendSwitched:false}));
   assert.equal(coldResult.code,0);assert.equal(coldState.OOMKilled,false);assert.equal(coldReport?.passed,true);
  }finally{sql('native_materialized',"BEGIN;UPDATE keryx_storage.control SET mode='held' WHERE singleton;COMMIT;");}
  assert.equal(sql('native_materialized',"SELECT mode FROM keryx_storage.control WHERE singleton;"),'held');
  assert.equal(sql('postgres',"SELECT count(*) FROM pg_stat_activity WHERE usename IN('keryx_app','keryx_reader');"),'0');
  console.log(JSON.stringify({format:'keryx-native-projection-and-cold-qualification-v1',passed:true,sourceDerivedProjectionsMaterialized:true,genuineOriginalKeyColdFactory:true,sourceIdentityUsedAsExpectation:true,isolatedTargetReturnedHeld:true,actualReaderConnectionsDrained:true,completeApplicationWriterQualified:false,productionChanged:false,applicationBackendSwitched:false}));
 }
}catch{
 console.error(JSON.stringify({format:'keryx-native-materialization-source-plan-v1',passed:false,reason:'native_materialization_source_unavailable',productionChanged:false}));process.exitCode=1;
}finally{
 if(nodeName&&docker(['ps','-aq','--filter','name=^/'+nodeName+'$'])){assert.equal(docker(['inspect',nodeName,'--format','{{index .Config.Labels "keryx.native-materialization-node"}}']),name);docker(['rm','-f',nodeName]);}
 if(owned){assert.equal(docker(['inspect',name,'--format','{{index .Config.Labels "keryx.native-materialization"}}']),name);docker(['rm','-f',name]);assert.equal(docker(['ps','-aq','--filter','name=^/'+name+'$']),'');owned=false;}
 if(bundle)unlinkSync(bundle);if(coldBundle)unlinkSync(coldBundle);if(folder)rmdirSync(folder);
}
