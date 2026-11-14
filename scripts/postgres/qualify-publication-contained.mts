/** Standalone disposable-fixture mode. Disconnects the supplied PostgreSQL
 * fixture permanently; the caller must not query it again and must dispose it.
 * No new PostgreSQL server, bind mount, dependency install or installed facade. */
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,mkdtempSync,realpathSync,rmdirSync,unlinkSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';
import type {PostgresConnectionOptions} from '../../lib/db/postgres/connection';
import type {StorageIdentity} from '../../lib/db/storage-identity';
import {PUBLICATION_INPUT_BYTES,PUBLICATION_REPORT_BYTES,parsePublicationChildInput,validatePublicationObservation,publicationRefused,type PublicationMode} from './publication-owner-sql-worker.mts';

export const PUBLICATION_NODE_IMAGE='node@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c';
export const PUBLICATION_POSTGRES_IMAGE='postgres@sha256:d3244e8ce3f165ee3c93d9c4a4b1d0fe48b3a89e2287b717fdcbbde92d405065';
export const PUBLICATION_DEADLINE_MS=300000;
const LABEL='keryx.publication-contained-owner',BUNDLE_BYTES=16*1024*1024;
export interface ContainedPublicationInput{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;postgresContainer:string;}
export function captureContainedPublicationInput(raw:ContainedPublicationInput):ContainedPublicationInput{
 try{
  if(!raw||Object.keys(raw).sort().join(',')!=='digest,identity,options,postgresContainer'||!/^keryx-postgres-consents-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(raw.postgresContainer))publicationRefused();
  const o=raw.options;if(!o||Object.keys(o).sort().join(',')!=='database,endpoint,password,role'||o.database!=='native_target'||o.role!=='keryx_app'||!o.endpoint||Object.keys(o.endpoint).sort().join(',')!=='kind,port'||o.endpoint.kind!=='loopback'||!Number.isSafeInteger(o.endpoint.port)||o.endpoint.port<1||o.endpoint.port>65535)publicationRefused();
  const child=parsePublicationChildInput({mode:'qualify',identity:raw.identity,digest:raw.digest,password:o.password});
  return {postgresContainer:raw.postgresContainer,identity:child.identity,digest:child.digest,options:{database:'native_target',role:'keryx_app',endpoint:{kind:'loopback',port:o.endpoint.port},password:child.password}};
 }catch{return publicationRefused();}
}
export function assertPublicationFixture(raw:unknown,input:ContainedPublicationInput,imageId:string){
 const x=raw as {Name?:unknown;Image?:unknown;State?:{Running?:unknown;Paused?:unknown;OOMKilled?:unknown};Config?:{User?:unknown};HostConfig?:{NetworkMode?:unknown};Mounts?:{Type?:unknown}[];NetworkSettings?:{Networks?:Record<string,unknown>;Ports?:Record<string,{HostIp:string;HostPort:string}[]>}};
 if(!x||x.Name!=='/'+input.postgresContainer||x.Image!==imageId||x.State?.Running!==true||x.State.Paused!==false||x.State.OOMKilled!==false||x.Config?.User!=='postgres'||!['default','bridge'].includes(String(x.HostConfig?.NetworkMode))||!Array.isArray(x.Mounts)||x.Mounts.some(m=>m.Type==='bind'))publicationRefused();
 if(Object.keys(x.NetworkSettings?.Networks??{}).join(',')!=='bridge')publicationRefused();const ports=x.NetworkSettings?.Ports?.['5432/tcp'];
 if(!ports||ports.length!==1||ports[0].HostIp!=='127.0.0.1'||ports[0].HostPort!==String(input.options.endpoint.port))publicationRefused();
}
export function publicationContainerArguments(name:string,owner:string,postgres:string,image:string,mode:PublicationMode):string[]{
 if(!/^keryx-publication-[a-z]+-[a-f0-9-]{36}$/.test(name)||!/^[a-f0-9-]{36}$/.test(owner)||!/^keryx-postgres-consents-[a-f0-9-]{36}$/.test(postgres)||!/^sha256:[a-f0-9]{64}$/.test(image)||!['qualify','oom','limits','hang'].includes(mode))publicationRefused();
 const memory=mode==='limits'?'384m':'512m';
 return ['create','-i','--name',name,'--label',LABEL+'='+owner,'--user','0:0','--read-only','--memory',memory,'--memory-swap',memory,'--cpus','1','--pids-limit','64','--cap-drop','ALL','--security-opt','no-new-privileges','--network','container:'+postgres,'--tmpfs','/run/keryx-publication:rw,nosuid,noexec,mode=0700,size=32m','--workdir','/run/keryx-publication','-e','TMPDIR=/run/keryx-publication','-e','KERYX_NETWORK=arcTestnet','-e','NEXT_PUBLIC_KERYX_NETWORK=arcTestnet','-e','KERYX_FORCE_OFFLINE=1',image,'node','--max-old-space-size=256','/publication-child.cjs'];
}
export function publicationReportRecords(wire:string):Record<string,unknown>[]{
 try{
 if(Buffer.byteLength(wire)>PUBLICATION_REPORT_BYTES||Buffer.from(wire).toString('utf8')!==wire)publicationRefused();const lines=wire.trim().split('\n');if(!lines.length||lines.length>3)publicationRefused();
 return lines.map(line=>{const x=JSON.parse(line);if(!x||typeof x!=='object'||Array.isArray(x))publicationRefused();for(const [k,v]of Object.entries(x)){
  if(!['started','passed','mode','limitsVerified','namespaceVerified','ownerWorker128','sqlAsserted','publication','refusal','observedMemoryBytes'].includes(k))publicationRefused();
  if(k==='publication')validatePublicationObservation(v);
  else if(k==='mode'){if(!['qualify','oom','limits','hang'].includes(String(v)))publicationRefused();}
  else if(k==='refusal'){if(!['limits_refused','publication_refused'].includes(String(v)))publicationRefused();}
  else if(k==='observedMemoryBytes'){if(!Number.isSafeInteger(v)||Number(v)<0)publicationRefused();}
  else if(typeof v!=='boolean')publicationRefused();
 }return x;});
 }catch{return publicationRefused();}
}
export async function qualifyContainedPublication(raw:ContainedPublicationInput){
 const input=captureContainedPublicationInput(raw),owner=randomUUID(),containers=new Set<string>();let candidateImage:string|undefined,folder:string|undefined;
 const docker=(args:string[],timeout=30000)=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,timeout,maxBuffer:131072,stdio:['pipe','pipe','pipe']}).trim();
 const inspect=(name:string)=>JSON.parse(docker(['inspect',name]))[0];
 const owned=(name:string)=>{if(!containers.has(name))publicationRefused();const x=inspect(name);if(x.Name!=='/'+name||x.Config?.Labels?.[LABEL]!==owner)publicationRefused();return x;};
 const stop=(name:string)=>{if(owned(name).State.Running)docker(['kill',name]);docker(['wait',name],30000);return owned(name);};
 const remove=(name:string)=>{if(!containers.has(name))publicationRefused();if(docker(['ps','-aq','--filter','name=^/'+name+'$'])){let x=owned(name);if(x.State.Running)x=stop(name);if(x.State.Running)publicationRefused();docker(['rm',name]);}if(docker(['ps','-aq','--filter','name=^/'+name+'$']))publicationRefused();containers.delete(name);};
 const nodeId=docker(['image','inspect',PUBLICATION_NODE_IMAGE,'--format','{{.Id}}']),postgresId=docker(['image','inspect',PUBLICATION_POSTGRES_IMAGE,'--format','{{.Id}}']);
 if(!/^sha256:[a-f0-9]{64}$/.test(nodeId)||!/^sha256:[a-f0-9]{64}$/.test(postgresId))publicationRefused();const pgFixture=inspect(input.postgresContainer);assertPublicationFixture(pgFixture,input,postgresId);if(!/^[a-f0-9]{64}$/.test(pgFixture.Id))publicationRefused();
 const common=execFileSync('git',['rev-parse','--path-format=absolute','--git-common-dir'],{cwd:dirname(fileURLToPath(import.meta.url)),encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:16384}).trim();
 const taskTemp=resolve(dirname(common),'.local/tmp/postgres-mainnet-migration-20261111/agents/purchase_monthly');mkdirSync(taskTemp,{recursive:true});
 const run=async(mode:PublicationMode)=>{
  const name='keryx-publication-'+mode+'-'+randomUUID();containers.add(name);docker(publicationContainerArguments(name,owner,input.postgresContainer,candidateImage!,mode));
  const before=owned(name),memory=mode==='limits'?402653184:536870912;
  if(before.Image!==candidateImage||before.HostConfig.Memory!==memory||before.HostConfig.MemorySwap!==memory||before.HostConfig.NanoCpus!==1000000000||before.HostConfig.PidsLimit!==64||before.HostConfig.ReadonlyRootfs!==true||before.Config.User!=='0:0'||!['container:'+input.postgresContainer,'container:'+pgFixture.Id].includes(before.HostConfig.NetworkMode)||JSON.stringify(before.HostConfig.CapDrop)!=='["ALL"]'||!before.HostConfig.SecurityOpt?.some((v:string)=>v==='no-new-privileges'||v==='no-new-privileges:true')||before.Mounts.some((m:{Type:string})=>m.Type==='bind'))publicationRefused();
  const stdin=JSON.stringify({mode,identity:input.identity,digest:input.digest,password:input.options.password});if(Buffer.byteLength(stdin)>PUBLICATION_INPUT_BYTES)publicationRefused();
  let timedOut=false,overflow=false;const stdout:Buffer[]=[];let outBytes=0,errBytes=0;
  try{
   await new Promise<void>((resolveRun,reject)=>{
    const process=spawn('docker',['start','-ai',name],{windowsHide:true,stdio:['pipe','pipe','pipe']});let ending=false;
    const terminate=()=>{if(ending)return;ending=true;try{stop(name);}catch{reject(Error('Contained publication stop refused'));}process.kill();};
    let timer=setTimeout(()=>{timedOut=true;terminate();},PUBLICATION_DEADLINE_MS),hangGuarded=false;
    process.stdout.on('data',(chunk:Buffer)=>{outBytes+=chunk.length;if(outBytes>PUBLICATION_REPORT_BYTES){overflow=true;terminate();}else{stdout.push(chunk);if(mode==='hang'&&!hangGuarded&&Buffer.concat(stdout).includes(10)){try{const first=publicationReportRecords(Buffer.concat(stdout).toString('utf8').split('\n')[0])[0];if(first.started===true&&first.mode==='hang'&&first.limitsVerified===true&&first.namespaceVerified===true){hangGuarded=true;clearTimeout(timer);timer=setTimeout(()=>{timedOut=true;terminate();},2000);}}catch{overflow=true;terminate();}}}});
    process.stderr.on('data',(chunk:Buffer)=>{errBytes+=chunk.length;if(errBytes>8192){overflow=true;terminate();}});
    process.on('error',()=>{clearTimeout(timer);reject(Error('Contained publication start refused'));});process.on('close',()=>{clearTimeout(timer);resolveRun();});process.stdin.on('error',()=>{});process.stdin.end(stdin);
   });
   const state=owned(name).State;if(state.Running||overflow)publicationRefused();const records=publicationReportRecords(Buffer.concat(stdout).toString('utf8'));
   if(mode==='limits'){if(timedOut||state.OOMKilled||state.ExitCode!==2||records.length!==1||records[0].refusal!=='limits_refused'||records[0].observedMemoryBytes!==402653184)publicationRefused();}
   else{
    const first=records[0];if(first.started!==true||first.mode!==mode||first.limitsVerified!==true||first.namespaceVerified!==true)publicationRefused();
    if(mode==='oom'){if(timedOut||state.OOMKilled!==true||state.ExitCode!==137)publicationRefused();}
    else if(mode==='hang'){if(!timedOut||state.OOMKilled||state.ExitCode!==137)publicationRefused();}
    else{const last=records.at(-1)!;if(timedOut||state.OOMKilled||state.ExitCode!==0||last.passed!==true||last.mode!=='qualify'||last.limitsVerified!==true||last.namespaceVerified!==true||last.ownerWorker128!==true||last.sqlAsserted!==true)publicationRefused();return validatePublicationObservation(last.publication);}
   }
   return {exitCode:state.ExitCode as number};
  }finally{remove(name);}
 };
 try{
  folder=mkdtempSync(join(taskTemp,'publication-contained-'));const child=join(folder,'child.cjs'),worker=join(folder,'owner-worker.cjs');
  for(const [entry,outfile]of [['publication-contained-child.mts',child],['publication-owner-sql-worker.mts',worker]]){buildSync({entryPoints:[fileURLToPath(new URL('./'+entry,import.meta.url))],outfile,bundle:true,platform:'node',target:'node24',format:'cjs',external:['pg-native'],logLevel:'silent'});const size=lstatSync(outfile).size;if(size<=0||size>BUNDLE_BYTES)publicationRefused();}
  const staging='keryx-publication-image-'+randomUUID();containers.add(staging);docker(['create','--name',staging,'--network','none','--label',LABEL+'='+owner,nodeId,'node','--version']);
  docker(['cp',child,staging+':/publication-child.cjs']);docker(['cp',worker,staging+':/publication-owner-worker.cjs']);candidateImage=docker(['commit','--change','LABEL '+LABEL+'='+owner,staging],120000);if(!/^sha256:[a-f0-9]{64}$/.test(candidateImage))publicationRefused();remove(staging);
  // No host query follows this point. All SQL is on127.0.0.1 inside the same
  // namespace, whose only interface/routes the actual child checks itself.
  assertPublicationFixture(inspect(input.postgresContainer),input,postgresId);docker(['network','disconnect','bridge',input.postgresContainer]);if(Object.keys(inspect(input.postgresContainer).NetworkSettings.Networks).length)publicationRefused();
  const limits=await run('limits'),oom=await run('oom'),deadline=await run('hang'),publication=await run('qualify');
  return {compiled512:true,compiled512MiBQualified:true,actualLinuxNode24:true,actualCgroupAndSqlAssertions:true,actual384MiBRefused:true,actualOomKilled:true,actualDeadlineKilled:true,negativeControlExitCodes:{limits:limits.exitCode,oom:oom.exitCode,deadline:deadline.exitCode},publication,fullFactoryQualified:false,postgresCreated:false,externalNetworkAvailable:false,productionData:false};
 }finally{
  const failed:string[]=[];for(const name of [...containers])try{remove(name);}catch{failed.push('container');}
  try{for(const id of docker(['image','ls','--no-trunc','-q','--filter','label='+LABEL+'='+owner]).split(/\s+/).filter(Boolean)){if(!/^sha256:[a-f0-9]{64}$/.test(id)||docker(['image','inspect',id,'--format','{{index .Config.Labels "'+LABEL+'"}}'])!==owner)publicationRefused();docker(['image','rm',id]);}if(docker(['image','ls','-q','--filter','label='+LABEL+'='+owner]))publicationRefused();}catch{failed.push('image');}
  try{if(folder){if(realpathSync(folder).toLowerCase()!==resolve(folder).toLowerCase()||dirname(folder).toLowerCase()!==taskTemp.toLowerCase()||lstatSync(folder).isSymbolicLink())publicationRefused();for(const name of ['child.cjs','owner-worker.cjs']){const path=join(folder,name);if(existsSync(path)){if(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink())publicationRefused();unlinkSync(path);}}rmdirSync(folder);if(existsSync(folder))publicationRefused();}}catch{failed.push('files');}
  if(failed.length)throw Error('Contained publication owned cleanup refused');
 }
}
