/** Development operator intake. Only generic code enters an owned image;
 * a private retained input stays on its original host volume, read-only. */
import assert from 'node:assert/strict';
import { execFileSync,spawn } from 'node:child_process';
import { createHash,randomUUID,randomBytes } from 'node:crypto';
import { chmodSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmdirSync,unlinkSync } from 'node:fs';
import { dirname,isAbsolute,join,relative,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { setTimeout as delay } from 'node:timers/promises';
const image='node@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c';
const pgImage='postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
assert.equal(process.version,'v24.22.1');const args=process.argv.slice(2),rehearsal=args.at(-1)==='--rehearse',audit=args.at(-1)==='--audit-run-domains',privacyAudit=args.at(-1)==='--audit-run-privacy',workspaceAudit=args.at(-1)==='--audit-workspaces',reviewAudit=args.at(-1)==='--audit-reviews';if(rehearsal||audit||privacyAudit||workspaceAudit||reviewAudit)args.pop();assert([0,2].includes(args.length));if(audit||privacyAudit||workspaceAudit||reviewAudit)assert.equal(args.length,2);
const [input,expectedHash]=args;
if(input){
 assert.match(expectedHash,/^[a-f0-9]{64}$/);assert.equal(realpathSync(input).toLowerCase(),resolve(input).toLowerCase());const stat=lstatSync(input);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=536870912);
 if(process.platform==='win32'){
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; $a=Get-Acl -LiteralPath $env:KERYX_SNAPSHOT_INPUT; if(-not $a.AreAccessRulesProtected){throw 'Private ACL required'}; $u=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; foreach($r in $a.Access){$s=$r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; if($r.IsInherited -or $r.AccessControlType -ne 'Allow' -or @($u,'S-1-5-18','S-1-5-32-544') -notcontains $s){throw 'Unexpected private ACL principal'}}"],{env:{...process.env,KERYX_SNAPSHOT_INPUT:input},windowsHide:true,timeout:10000,stdio:'pipe'});
 }else{assert.equal(stat.uid,process.getuid?.());assert.equal(stat.nlink,1);assert.equal(stat.mode&0o077,0);}
}
const common=execFileSync('git',['rev-parse','--path-format=absolute','--git-common-dir'],{encoding:'utf8',windowsHide:true,timeout:10000}).trim();
const taskRoot=resolve(dirname(common),'.local/tmp/postgres-mainnet-migration-20261111'),root=resolve(process.env.KERYX_POSTGRES_INTAKE_TMP??join(taskRoot,'offline-intake'));
const within=relative(taskRoot,root);assert(!isAbsolute(within)&&within!=='..'&&!within.startsWith('..'+(process.platform==='win32'?'\\':'/')),'Canonical task temp storage required');
mkdirSync(root,{recursive:true});assert.equal(realpathSync(root).toLowerCase(),root.toLowerCase(),'No task temp symlink');const folder=mkdtempSync(join(root,'job-'));if(process.platform!=='win32')chmodSync(folder,0o700);
const bundle=join(folder,'child.cjs'),staging='keryx-offline-intake-'+randomUUID(),containers=new Set<string>();let candidate:string|undefined;
let pgContainer:string|undefined;const password=randomBytes(24).toString('hex');
const docker=(args:string[],timeout=15000)=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,timeout,maxBuffer:524288,stdio:['ignore','pipe','pipe']}).trim();
async function run(mode:'pressure'|'deadline'|'synthetic'|'inventory'|'rehearsal'|'synthetic-rehearsal'|'domain-audit'|'privacy-audit'|'workspace-audit'|'review-audit',memory='512m'){
 const name='keryx-offline-intake-'+randomUUID();containers.add(name);
 try{
  const isRehearsal=mode.endsWith('rehearsal');
  const args=['run','-i','--name',name,'--label','keryx.offline-intake='+staging,'--network',isRehearsal?'container:'+pgContainer:'none','--user','0:0','--read-only','--memory',memory,'--memory-swap',memory,'--cpus','.25','--pids-limit','32','--cap-drop','ALL','--security-opt','no-new-privileges','--ulimit','core=0','--tmpfs','/run/keryx-intake:rw,nosuid,noexec,mode=0700,size=16m'];
  if(mode==='inventory'||mode==='rehearsal'||mode.endsWith('-audit'))args.push('--mount',`type=bind,source=${resolve(input)},target=/input/snapshot.sqlite,readonly`);
  args.push(candidate!,'/usr/bin/timeout','--signal=KILL',mode==='deadline'?'5s':isRehearsal?'1800s':'300s','node','--no-warnings','--max-old-space-size=256','/child.cjs',mode);if(mode==='inventory'||mode==='rehearsal'||mode.endsWith('-audit'))args.push(expectedHash);
  const result=await new Promise<{code:number|null;stdout:string}>(resolveResult=>{
   const child=spawn('docker',args,{windowsHide:true,stdio:['pipe','pipe','ignore']});child.stdin.on('error',()=>{});child.stdin.end(isRehearsal?JSON.stringify({password}):'');let stdout='',done=false;
   const timer=setTimeout(()=>{try{docker(['kill',name]);}finally{child.kill();}},isRehearsal?1810000:310000);
   child.stdout.on('data',(chunk:Buffer)=>{stdout+=chunk.toString('utf8');if(Buffer.byteLength(stdout)>262144){try{docker(['kill',name]);}finally{child.kill();}}});
   const finish=(code:number|null)=>{if(done)return;done=true;clearTimeout(timer);resolveResult({code,stdout});};child.once('error',()=>finish(null));child.once('close',finish);
  });
  const state=JSON.parse(docker(['inspect',name,'--format','{{json .State}}'])) as {OOMKilled:boolean;ExitCode:number;Running:boolean};assert.equal(state.Running,false);
  const reports=result.stdout.split(/\r?\n/).filter(s=>s.startsWith('{')).map(s=>JSON.parse(s) as Record<string,unknown>);return {...result,reports,state};
 }finally{
  if(docker(['ps','-aq','--filter','name=^/'+name+'$'])){assert.equal(docker(['inspect',name,'--format','{{index .Config.Labels "keryx.offline-intake"}}']),staging);docker(['rm','-f',name]);}
  assert.equal(docker(['ps','-aq','--filter','name=^/'+name+'$']),'');containers.delete(name);
 }
}
try{
 assert.match(docker(['image','inspect',image,'--format','{{.Id}}']),/^sha256:[a-f0-9]{64}$/);
 buildSync({entryPoints:[fileURLToPath(new URL('./offline-intake-child.mts',import.meta.url))],outfile:bundle,bundle:true,platform:'node',target:'node24',format:'cjs',minifyWhitespace:true,external:['pg-native'],logLevel:'silent'});
 const bytes=readFileSync(bundle);assert(bytes.length>0&&bytes.length<1048576);containers.add(staging);
 docker(['create','--name',staging,'--label','keryx.offline-intake='+staging,'--network','none',image,'node','--version']);docker(['cp',bundle,staging+':/child.cjs']);candidate=docker(['commit','--change','LABEL keryx.offline-intake='+staging,staging]);assert.match(candidate,/^sha256:[a-f0-9]{64}$/);docker(['rm',staging]);containers.delete(staging);
 const outside=await run('pressure','256m');assert.notEqual(outside.code,0);assert.equal(outside.reports[0]?.actualKernelLimitsVerified,undefined);assert.equal(outside.state.OOMKilled,false);
 const pressure=await run('pressure');assert.notEqual(pressure.code,0);assert.equal(pressure.reports[0]?.actualKernelLimitsVerified,true);assert.equal(pressure.state.OOMKilled,true);
 const deadline=await run('deadline');assert.equal(deadline.code,137);assert.equal(deadline.reports[0]?.actualKernelLimitsVerified,true);assert.equal(deadline.state.OOMKilled,false);
 const synthetic=await run('synthetic');assert.equal(synthetic.code,0);const fixture=synthetic.reports[0] as {fullTypedInventoryComplete:boolean;totalRows:number;tables:{columns:{unsafeJsInteger:number;textNul:number;blob:number}[]}[]};assert.equal(fixture.fullTypedInventoryComplete,true);assert.equal(fixture.totalRows,1);assert.equal(fixture.tables[0].columns[1].unsafeJsInteger,1);assert.equal(fixture.tables[0].columns[3].textNul,1);assert.equal(fixture.tables[0].columns[4].blob,1);
 const qualification={format:'keryx-development-offline-intake-qualification-v1',image,compiledSha256:createHash('sha256').update(bytes).digest('hex'),compiledBytes:bytes.length,compiledByteLimitExclusive:1048576,actualNativeSqliteOom:true,actualHardDeadlineKilledBlockedChild:true,wrongMemoryRefusedBeforeTarget:true,syntheticInt64RealNulBlob:true,privateInputCopiedIntoImage:false,selectedApplicationWriter:false};
 console.log(JSON.stringify({qualification}));
 if(rehearsal){
  pgContainer='keryx-offline-intake-'+randomUUID();containers.add(pgContainer);
  docker(['run','-d','--name',pgContainer,'--label','keryx.offline-intake='+staging,'--network','none','--user','postgres','--read-only','--memory','3g','--memory-swap','3g','--cpus','1','--pids-limit','64','--cap-drop','ALL','--security-opt','no-new-privileges','--ulimit','core=0','--tmpfs','/var/lib/postgresql/data:rw,nosuid,uid=70,gid=70,size=2g','--tmpfs','/var/run/postgresql:rw,nosuid,uid=70,gid=70,size=8m','--tmpfs','/tmp:rw,nosuid,size=16m','-e','POSTGRES_PASSWORD='+password,pgImage,'-c','shared_buffers=64MB','-c','max_connections=8','-c','work_mem=4MB','-c','max_wal_size=256MB','-c','log_min_error_statement=panic','-c','log_error_verbosity=terse'],20000);
  let ready=false;for(let i=0;i<200;i++){try{docker(['exec',pgContainer,'pg_isready','-h','127.0.0.1','-U','postgres'],2000);ready=true;break;}catch{await delay(100);}}assert(ready,'Owned private PG startup');
  assert.equal(docker(['exec',pgContainer,'cat','/sys/fs/cgroup/memory.max','/sys/fs/cgroup/memory.swap.max','/sys/fs/cgroup/cpu.max','/sys/fs/cgroup/pids.max']),'3221225472\n0\n100000 100000\n64');
  // Fixed isolated importer; neither the runtime roles nor public application
  // schema is created. This ephemeral password never appears in evidence.
  execFileSync('docker',['exec','-i',pgContainer,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:`CREATE ROLE keryx_rehearsal LOGIN PASSWORD '${password}';GRANT CREATE ON DATABASE postgres TO keryx_rehearsal;`,windowsHide:true,timeout:10000,stdio:['pipe','ignore','ignore']});
  const actual=await run(input?'rehearsal':'synthetic-rehearsal');console.log(JSON.stringify({workerExit:actual.code,oomKilled:actual.state.OOMKilled,postgresActualKernelLimitsVerified:true,postgresMemoryBytes:3221225472,postgresSwapBytes:0,postgresImage:pgImage,report:actual.reports.at(-1)??null}));assert.equal(actual.code,0);assert.equal(actual.reports.at(-1)?.verified,true);
 }else if(input){const actual=await run(reviewAudit?'review-audit':workspaceAudit?'workspace-audit':privacyAudit?'privacy-audit':audit?'domain-audit':'inventory');console.log(JSON.stringify({workerExit:actual.code,oomKilled:actual.state.OOMKilled,report:actual.reports.at(-1)??null}));assert.equal(actual.code,0);if(reviewAudit)assert.equal(actual.reports.at(-1)?.format,'keryx-review-real-data-audit-v1');else if(workspaceAudit)assert.equal(actual.reports.at(-1)?.format,'keryx-workspace-real-data-audit-v1');else if(privacyAudit)assert.equal(actual.reports.at(-1)?.format,'keryx-run-privacy-real-data-audit-v1');else if(audit)assert.equal(actual.reports.at(-1)?.format,'keryx-run-domain-real-data-audit-v1');else assert.equal(actual.reports.at(-1)?.fullTypedInventoryComplete,true);}
}finally{
 for(const name of containers){if(docker(['ps','-aq','--filter','name=^/'+name+'$'])){assert.equal(docker(['inspect',name,'--format','{{index .Config.Labels "keryx.offline-intake"}}']),staging);docker(['rm','-f',name]);}}
 if(candidate){assert.equal(docker(['image','inspect',candidate,'--format','{{index .Config.Labels "keryx.offline-intake"}}']),staging);docker(['image','rm',candidate]);assert.equal(docker(['image','ls','-q','--filter','label=keryx.offline-intake='+staging]),'');}
 unlinkSync(bundle);rmdirSync(folder);
}
