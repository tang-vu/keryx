/** Consumes an immutable, independently prepared Linux MAINNET Next image.
 * No build/install/PG creation/deploy. The supplied standalone synthetic PG
 * fixture is permanently disconnected; caller must dispose it after return. */
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,mkdtempSync,realpathSync,rmdirSync,unlinkSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';
import type {PostgresConnectionOptions} from '../../lib/db/postgres/connection';
import type {StorageIdentity} from '../../lib/db/storage-identity';
import {capturePreparedNextChildInput,PREPARED_NEXT_INPUT_BYTES,PREPARED_NEXT_REPORT_BYTES,PREPARED_NEXT_MODES,preparedNextRefused,type PreparedNextMode} from './prepared-next-child.mts';

export const PREPARED_NEXT_NODE_IMAGE='node@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c';
export const PREPARED_NEXT_POSTGRES_IMAGE='postgres@sha256:d3244e8ce3f165ee3c93d9c4a4b1d0fe48b3a89e2287b717fdcbbde92d405065';
export const PREPARED_NEXT_DEADLINE_MS=300000;
const LABEL='keryx.prepared-next-owner';
export interface PreparedNextQualificationInput{
 preparedImage:string;candidate:string;sourceManifestSha256:string;artifactInspectionSha256:string;preparationSha256:string;
 publicBuildControls:Record<string,string>;options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;postgresContainer:string;
}
export function capturePreparedNextInput(raw:PreparedNextQualificationInput):PreparedNextQualificationInput{
 if(!raw||Object.keys(raw).sort().join(',')!=='artifactInspectionSha256,candidate,digest,identity,options,postgresContainer,preparationSha256,preparedImage,publicBuildControls,sourceManifestSha256'||
  !/^sha256:[a-f0-9]{64}$/.test(raw.preparedImage)||!/^keryx-postgres-consents-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(raw.postgresContainer))preparedNextRefused();
 const o=raw.options;if(!o||Object.keys(o).sort().join(',')!=='database,endpoint,password,role'||o.database!=='native_target'||o.role!=='keryx_app'||!o.endpoint||Object.keys(o.endpoint).sort().join(',')!=='kind,port'||o.endpoint.kind!=='loopback'||!Number.isSafeInteger(o.endpoint.port)||o.endpoint.port<1||o.endpoint.port>65535)preparedNextRefused();
 const x=capturePreparedNextChildInput({mode:'verify',candidate:raw.candidate,sourceManifestSha256:raw.sourceManifestSha256,artifactInspectionSha256:raw.artifactInspectionSha256,preparationSha256:raw.preparationSha256,publicBuildControls:raw.publicBuildControls,identity:raw.identity,digest:raw.digest,password:o.password});
 return {...raw,candidate:x.candidate,identity:x.identity,publicBuildControls:{...x.publicBuildControls},options:{database:'native_target',role:'keryx_app',endpoint:{kind:'loopback',port:o.endpoint.port},password:x.password}};
}
export function preparedNextContainerArguments(name:string,owner:string,postgres:string,image:string,mode:PreparedNextMode){
 if(!/^keryx-prepared-next-[a-z-]+-[a-f0-9-]{36}$/.test(name)||!/^[a-f0-9-]{36}$/.test(owner)||!/^keryx-postgres-consents-[a-f0-9-]{36}$/.test(postgres)||!/^sha256:[a-f0-9]{64}$/.test(image)||!PREPARED_NEXT_MODES.includes(mode))preparedNextRefused();
 const memory=mode==='limits'?'384m':'512m';
 return ['create','-i','--name',name,'--label',LABEL+'='+owner,'--user','0:0','--read-only','--memory',memory,'--memory-swap',memory,'--cpus','1','--pids-limit','64','--cap-drop','ALL','--security-opt','no-new-privileges','--network','container:'+postgres,'--tmpfs','/run/keryx-prepared-next:rw,nosuid,noexec,mode=0700,size=32m','--workdir','/run/keryx-prepared-next','--entrypoint','node','-e','TMPDIR=/run/keryx-prepared-next','-e','TMP=/run/keryx-prepared-next','-e','TEMP=/run/keryx-prepared-next','-e','HOME=/run/keryx-prepared-next','-e','NODE_ENV=production','-e','NEXT_TELEMETRY_DISABLED=1',image,'--max-old-space-size=256','/prepared-next-child.cjs'];
}
export function preparedNextRecords(wire:string):Record<string,unknown>[]{
 if(!wire||Buffer.byteLength(wire)>PREPARED_NEXT_REPORT_BYTES||Buffer.from(wire).toString('utf8')!==wire)preparedNextRefused();
 const lines=wire.trim().split('\n');if(lines.length>2)preparedNextRefused();
 return lines.map(line=>{const x=JSON.parse(line) as Record<string,unknown>;if(!x||typeof x!=='object'||Array.isArray(x))preparedNextRefused();
  for(const [key,value]of Object.entries(x)){
   if(['started','passed','limitsVerified','namespaceVerified','artifactVerified','actualCompiledNext','mainnetPublicBuild','sqlObserved','httpDrained','noSqliteFallback','nativeGracefulDrainProven'].includes(key)){if(typeof value!=='boolean')preparedNextRefused();}
   else if(['observedMemoryBytes','healthRequests','pageBytes','assetBytes','blockedRegistryFetches','otherBlockedFetches','logCalls'].includes(key)){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)preparedNextRefused();}
   else if(key==='mode'){if(!['verify','writer','restart','wrong-identity','wrong-source','wrong-key','reader-credential','held-target','limits','oom','hang'].includes(String(value)))preparedNextRefused();}
   else if(key==='refusal'){if(!['limits_refused','prepared_next_refused'].includes(String(value)))preparedNextRefused();}
   else if(key==='refusalAt'){if(value!==null&&value!=='startup'&&value!=='health')preparedNextRefused();}
   else if(key==='artifactDigest'){if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))preparedNextRefused();}
   else if(key==='buildId'){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value))preparedNextRefused();}
   else preparedNextRefused();
  }return x;
 });
}
export async function qualifyPreparedNext(raw:PreparedNextQualificationInput){
 const input=capturePreparedNextInput(raw),owner=randomUUID(),containers=new Set<string>();let folder:string|undefined,image:string|undefined;
 const docker=(args:string[],timeout=30000,wire?:string)=>execFileSync('docker',args,{input:wire,encoding:'utf8',windowsHide:true,timeout,maxBuffer:131072,stdio:['pipe','pipe','pipe']}).trim();
 const inspect=(name:string)=>JSON.parse(docker(['inspect',name]))[0];
 const owned=(name:string)=>{const x=inspect(name);if(x.Name!=='/'+name||x.Config?.Labels?.[LABEL]!==owner)preparedNextRefused();return x;};
 const stop=(name:string)=>{if(owned(name).State.Running){docker(['kill',name]);docker(['wait',name]);}if(owned(name).State.Running)preparedNextRefused();};
 const remove=(name:string)=>{stop(name);docker(['rm',name]);if(docker(['ps','-aq','--filter','name=^/'+name+'$']))preparedNextRefused();containers.delete(name);};
 const pgImage=docker(['image','inspect',PREPARED_NEXT_POSTGRES_IMAGE,'--format','{{.Id}}']),node=JSON.parse(docker(['image','inspect',PREPARED_NEXT_NODE_IMAGE]))[0],prepared=JSON.parse(docker(['image','inspect',input.preparedImage]))[0];
 assert.equal(prepared.Id,input.preparedImage);assert.deepEqual(prepared.RootFS.Layers.slice(0,node.RootFS.Layers.length),node.RootFS.Layers,'Prepared image must retain the pinned Linux Node base');
 for(const entry of prepared.Config.Env??[]){const [key,...rest]=String(entry).split('=');if(rest.join('=')&&(/(?:SECRET|PASSWORD|PRIVATE_KEY|FUNDER_KEY|API_KEY|AUTH_TOKEN|STORAGE_MANIFEST|CONTENT_MASTER_KEY)/i.test(key)||key==='NODE_OPTIONS'))preparedNextRefused();}
 const pgFixture=inspect(input.postgresContainer);
 if(pgFixture.Name!=='/'+input.postgresContainer||pgFixture.Image!==pgImage||pgFixture.State?.Running!==true||pgFixture.State.Paused||pgFixture.State.OOMKilled||pgFixture.Config?.User!=='postgres'||!pgFixture.Config.Env.includes('POSTGRES_PASSWORD='+input.options.password)||!['default','bridge'].includes(pgFixture.HostConfig?.NetworkMode)||pgFixture.Mounts.some((m:{Type:string})=>m.Type!=='tmpfs')||Object.keys(pgFixture.NetworkSettings.Networks).join(',')!=='bridge')preparedNextRefused();
 const ports=pgFixture.NetworkSettings.Ports['5432/tcp'];if(!ports||ports.length!==1||ports[0].HostIp!=='127.0.0.1'||ports[0].HostPort!==String(input.options.endpoint.port))preparedNextRefused();
 const common=execFileSync('git',['rev-parse','--path-format=absolute','--git-common-dir'],{cwd:dirname(fileURLToPath(import.meta.url)),encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:16384}).trim();
 const temp=resolve(dirname(common),'.local/tmp/postgres-mainnet-migration-20261111/agents/purchase_monthly');mkdirSync(temp,{recursive:true});
 // After namespace disconnection, every SQL query is local to this exact
 // disposable PG container. No host endpoint query/reconnect is attempted.
 const roleCount=()=>docker(['exec','--user','postgres','-i',input.postgresContainer,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-d','native_target'],30000,"SELECT pg_stat_clear_snapshot(); SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND usename IN('keryx_app','keryx_reader');\n").split(/\r?\n/).filter(Boolean).at(-1);
 const run=async(mode:PreparedNextMode)=>{
  const name='keryx-prepared-next-'+mode+'-'+randomUUID();containers.add(name);docker(preparedNextContainerArguments(name,owner,input.postgresContainer,image!,mode));
  const c=owned(name),memory=mode==='limits'?402653184:536870912;
  if(c.Image!==image||c.HostConfig.Memory!==memory||c.HostConfig.MemorySwap!==memory||c.HostConfig.NanoCpus!==1000000000||c.HostConfig.PidsLimit!==64||!c.HostConfig.ReadonlyRootfs||c.Config.User!=='0:0'||!['container:'+input.postgresContainer,'container:'+pgFixture.Id].includes(c.HostConfig.NetworkMode)||JSON.stringify(c.HostConfig.CapDrop)!=='["ALL"]'||!c.HostConfig.SecurityOpt?.some((x:string)=>['no-new-privileges','no-new-privileges:true'].includes(x))||c.Mounts.some((m:{Type:string})=>m.Type==='bind'))preparedNextRefused();
  const wire=JSON.stringify({mode,candidate:input.candidate,sourceManifestSha256:input.sourceManifestSha256,artifactInspectionSha256:input.artifactInspectionSha256,preparationSha256:input.preparationSha256,publicBuildControls:input.publicBuildControls,identity:input.identity,digest:input.digest,password:input.options.password});if(Buffer.byteLength(wire)>PREPARED_NEXT_INPUT_BYTES)preparedNextRefused();
  const output:Buffer[]=[];let bytes=0,stderrBytes=0,timedOut=false,overflow=false;
  try{
   await new Promise<void>((accept,reject)=>{
    const child=spawn('docker',['start','-ai',name],{windowsHide:true,stdio:['pipe','pipe','pipe']});let ending=false,hangGuarded=false;
    const terminate=()=>{if(ending)return;ending=true;try{stop(name);}catch{reject(Error('Prepared Next stop refused'));}child.kill();};
    let timer=setTimeout(()=>{timedOut=true;terminate();},PREPARED_NEXT_DEADLINE_MS);
    child.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>PREPARED_NEXT_REPORT_BYTES){overflow=true;terminate();return;}output.push(chunk);
     if(mode==='hang'&&!hangGuarded){const text=Buffer.concat(output).toString('utf8');if(text.includes('\n'))try{const first=preparedNextRecords(text.split('\n')[0])[0];if(first.started===true&&first.limitsVerified===true&&first.namespaceVerified===true&&first.mode==='hang'){hangGuarded=true;clearTimeout(timer);timer=setTimeout(()=>{timedOut=true;terminate();},2000);}}catch{overflow=true;terminate();}}
    });
    child.stderr.on('data',(chunk:Buffer)=>{stderrBytes+=chunk.length;if(stderrBytes>8192){overflow=true;terminate();}});child.on('error',()=>{clearTimeout(timer);reject(Error('Prepared Next start refused'));});child.on('close',()=>{clearTimeout(timer);accept();});child.stdin.on('error',()=>{});child.stdin.end(wire);
   });
   const state=owned(name).State;if(state.Running||overflow)preparedNextRefused();const records=preparedNextRecords(Buffer.concat(output).toString('utf8'));
   if(mode==='limits'){assert(!timedOut&&!state.OOMKilled);assert.equal(state.ExitCode,2);assert.equal(records.length,1);assert.equal(records[0].refusal,'limits_refused');assert.equal(records[0].observedMemoryBytes,402653184);}
   else{
    assert.equal(records[0].started,true);assert.equal(records[0].mode,mode);assert.equal(records[0].limitsVerified,true);assert.equal(records[0].namespaceVerified,true);
    if(mode==='oom'){assert(!timedOut);assert.equal(state.OOMKilled,true);assert.equal(state.ExitCode,137);}
    else if(mode==='hang'){assert(timedOut);assert.equal(state.OOMKilled,false);assert.equal(state.ExitCode,137);}
    else{assert(!timedOut&&!state.OOMKilled);assert.equal(state.ExitCode,0);assert.equal(records.length,2);const last=records[1];assert.equal(last.passed,true);assert.equal(last.mode,mode);
     if(mode==='verify')assert.equal(last.artifactVerified,true);
     else{assert.equal(last.actualCompiledNext,true);assert.equal(last.mainnetPublicBuild,true);assert.equal(last.noSqliteFallback,true);assert.equal(last.nativeGracefulDrainProven,false);
      if(mode==='writer'||mode==='restart'){assert.equal(last.sqlObserved,true);assert.equal(last.healthRequests,16);assert.equal(last.httpDrained,true);assert.equal(last.refusalAt,null);assert(Number(last.pageBytes)>0&&Number(last.assetBytes)>0&&Number(last.blockedRegistryFetches)>0);assert.equal(last.otherBlockedFetches,0);}
      else assert(['startup','health'].includes(String(last.refusalAt)));
     }
    }
   }
   const cleanupDeadline=performance.now()+2000;let connections=roleCount();while(connections!=='0'&&performance.now()<cleanupDeadline){await new Promise(accept=>setTimeout(accept,40));connections=roleCount();}
   assert.equal(connections,'0','Actual process exit must clean every application/reader connection');return {mode,exitCode:state.ExitCode as number,report:records.at(-1)!};
  }finally{remove(name);}
 };
 try{
  folder=mkdtempSync(join(temp,'prepared-next-'));const child=join(folder,'child.cjs');buildSync({entryPoints:[fileURLToPath(new URL('./prepared-next-child.mts',import.meta.url))],outfile:child,bundle:true,platform:'node',target:'node24',format:'cjs',external:['pg-native'],logLevel:'silent'});if(lstatSync(child).size>16*1024*1024)preparedNextRefused();
  const staging='keryx-prepared-next-image-'+randomUUID();containers.add(staging);docker(['create','--name',staging,'--network','none','--label',LABEL+'='+owner,'--entrypoint','node',input.preparedImage,'--version']);docker(['cp',child,staging+':/prepared-next-child.cjs']);image=docker(['commit','--change','LABEL '+LABEL+'='+owner,staging],120000);if(!/^sha256:[a-f0-9]{64}$/.test(image))preparedNextRefused();remove(staging);
  assert.equal(inspect(input.postgresContainer).Id,pgFixture.Id);docker(['network','disconnect','bridge',input.postgresContainer]);assert.equal(Object.keys(inspect(input.postgresContainer).NetworkSettings.Networks).length,0);assert.equal(roleCount(),'0');
  const before=await run('verify'),limits=await run('limits'),oom=await run('oom'),deadline=await run('hang'),reports=[];
  for(const mode of ['writer','restart','wrong-identity','wrong-source','wrong-key','reader-credential','held-target'] as const)reports.push(await run(mode));
  const after=await run('verify');assert.deepEqual(before.report,after.report);
  return {passed:true,compiledMainnetNext512:true,actualCompiledRoutes:true,preparedArtifactVerifiedBeforeAndAfter:true,artifactDigest:before.report.artifactDigest,buildId:before.report.buildId,healthRequests:32,maximumHealthConcurrency:2,actual384MiBRefused:true,actualOomKilled:true,actualDeadlineKilled:true,negativeControlExitCodes:{limits:limits.exitCode,oom:oom.exitCode,deadline:deadline.exitCode},reports,selectedWriterStartupAndRestart:true,readerCredentialRefused:true,readonlyFactoryPositiveQualifiedHere:false,processExitConnectionsCleaned:true,nativeGracefulDrainProven:false,registryOnlineQualified:false,postgresCreated:false,productionChanged:false,fullApplicationQualified:false};
 }finally{
  const failures:string[]=[];for(const name of [...containers])try{remove(name);}catch{failures.push('container');}
  try{for(const id of docker(['image','ls','--no-trunc','-q','--filter','label='+LABEL+'='+owner]).split(/\s+/).filter(Boolean)){if(id===input.preparedImage||!/^sha256:[a-f0-9]{64}$/.test(id)||docker(['image','inspect',id,'--format','{{index .Config.Labels "'+LABEL+'"}}'])!==owner)preparedNextRefused();docker(['image','rm','--no-prune',id]);}if(docker(['image','ls','-q','--filter','label='+LABEL+'='+owner]))preparedNextRefused();}catch{failures.push('image');}
  try{if(folder){if(resolve(folder)!==realpathSync(folder)||dirname(folder)!==temp||lstatSync(folder).isSymbolicLink())preparedNextRefused();const file=join(folder,'child.cjs');if(existsSync(file)){if(!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink())preparedNextRefused();unlinkSync(file);}rmdirSync(folder);}}catch{failures.push('files');}
  if(failures.length)throw Error('Prepared Next owned cleanup refused');
 }
}
