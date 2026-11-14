/** Fresh host process for two fixed synthetic protocols. This creates no
 * PostgreSQL instance, installed facade, signer, job or payment authority. */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { lstatSync,mkdtempSync,realpathSync,rmSync } from 'node:fs';
import { dirname,join,relative,resolve,sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { validateStorageIdentity,type StorageIdentity } from '../../lib/db/storage-identity';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';

export interface FreshMainnetProtocolInput {mode:'private'|'browser';options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;postgresContainer:string}
export interface FreshMainnetProtocolReport {format:'keryx-fresh-mainnet-protocol-v1';mode:'private'|'browser';passed:true;network:'eip155:5042';qualifier:Readonly<Record<string,boolean|number>>;hostChild:true;spawnedPostgres:false;selectedApplicationWriter:false}
const refused=()=>new Error('Fresh mainnet protocol unavailable');
const exact=(value:unknown,keys:string):Record<string,unknown>=>{
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.getOwnPropertySymbols(value).length
  ||Object.values(Object.getOwnPropertyDescriptors(value)).some(d=>!d.enumerable||!('value'in d))||Object.keys(value).sort().join(',')!==keys)throw refused();
 return value as Record<string,unknown>;
};
/** Shape-only fixture metadata. It grants no database or installed provenance. */
export function captureFreshMainnetProtocolInput(raw:unknown):Readonly<FreshMainnetProtocolInput>{
 const input=exact(raw,'digest,identity,mode,options,postgresContainer'),options=exact(input.options,'database,endpoint,password,role'),endpoint=exact(options.endpoint,'kind,port');
 if(typeof input.mode!=='string'||!['private','browser'].includes(input.mode)||endpoint.kind!=='loopback'||!Number.isSafeInteger(endpoint.port)||Number(endpoint.port)<1||Number(endpoint.port)>65535
  ||options.database!=='native_target'||options.role!=='keryx_app'||typeof options.password!=='string'||!/^[a-f0-9]{48}$/.test(options.password)
  ||typeof input.digest!=='string'||!/^[a-f0-9]{64}$/.test(input.digest)||typeof input.postgresContainer!=='string'
  ||!/^keryx-postgres-consents-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.postgresContainer))throw refused();
 const identity=validateStorageIdentity(input.identity);
 if(identity.authorityMode!=='mainnet-real'||identity.network!=='eip155:5042')throw refused();
 return Object.freeze({mode:input.mode as FreshMainnetProtocolInput['mode'],options:Object.freeze({database:'native_target',role:'keryx_app',password:options.password,
  endpoint:Object.freeze({kind:'loopback' as const,port:Number(endpoint.port)})}),identity,digest:input.digest,postgresContainer:input.postgresContainer});
}
const root=resolve(fileURLToPath(new URL('../..',import.meta.url))),childPath=fileURLToPath(new URL('./fresh-mainnet-protocol-child.mts',import.meta.url));
const spending=['AGENT_FUNDER_PRIVATE_KEY','BUYER_PRIVATE_KEY','DEPLOYER_PRIVATE_KEY','KERYX_MAINNET_TREASURY_PRIVATE_KEY','KERYX_MAINNET_PRIVATE_TREASURY_PRIVATE_KEY','KERYX_BOT_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY','DEEPSEEK_API_KEY','TAVILY_API_KEY','CONTENT_MASTER_KEY'];
/** Closed environment metadata only; this does not start or qualify a process. */
export function freshMainnetProtocolEnvironment(folder:string){
 try{if(arguments.length!==1||typeof folder!=='string'||dirname(resolve(folder))!==resolve(tmpdir())||!folder.includes('keryx-fresh-mainnet-protocol-')||lstatSync(folder).isSymbolicLink()||!lstatSync(folder).isDirectory())throw refused();}catch{throw refused();}
 const env:NodeJS.ProcessEnv={};for(const name of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','HOME','USERPROFILE','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA'])if(process.env[name]!==undefined)env[name]=process.env[name];
 Object.assign(env,{TEMP:folder,TMP:folder,TMPDIR:folder,NODE_NO_WARNINGS:'1',KERYX_NETWORK:'arc',NEXT_PUBLIC_KERYX_NETWORK:'arc',KERYX_FORCE_OFFLINE:'0',KERYX_EXTERNAL_DISCOVERY:'0',
  KERYX_STORAGE_MANIFEST:'',KERYX_SQLITE_PATH:'',NEXT_PUBLIC_SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:'',KERYX_RUN_PRIVACY_ENABLED:'false',KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED:'false',KERYX_PUBLIC_PROFILES_ENABLED:'false'});
 // Public synthetic pins satisfy genuine Source startup; no registry request
 // or payout is possible through the child's network trap.
 env.KERYX_REGISTRY_ADDRESS='0x'+'11'.repeat(20);env.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS=env.KERYX_REGISTRY_ADDRESS;
 for(const key of spending)env[key]='';return env;
}
/** The caller supplies fixture metadata only. Executable/module, credentials
 * transport, environment, SQL owner and timeout remain fixed here. */
export async function qualifyFreshMainnetProtocol(raw:FreshMainnetProtocolInput):Promise<Readonly<FreshMainnetProtocolReport>>{
 if(arguments.length!==1)throw refused();const input=captureFreshMainnetProtocolInput(raw),wire=JSON.stringify(input);if(Buffer.byteLength(wire)>8192)throw refused();
 const real=realpathSync(childPath);if(lstatSync(childPath).isSymbolicLink()||!lstatSync(childPath).isFile()||(process.platform==='win32'?real.toLowerCase()!==resolve(childPath).toLowerCase():real!==resolve(childPath)))throw refused();
 const base=resolve(tmpdir());if(process.platform==='win32'&&!base.toLowerCase().startsWith(resolve('D:/repos/server/Github/Hackathon/keryx/.local').toLowerCase()+sep))throw refused();
 const folder=mkdtempSync(join(base,'keryx-fresh-mainnet-protocol-'));
 try{
  const loader=pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href;
  return await new Promise<Readonly<FreshMainnetProtocolReport>>((done,fail)=>{
   const child=spawn(process.execPath,['--max-old-space-size=512','--import',loader,childPath],{cwd:root,env:freshMainnetProtocolEnvironment(folder),windowsHide:true,stdio:['pipe','pipe','pipe']});
   let settled=false,failed=false,stdout=Buffer.alloc(0),stderrBytes=0;const finish=(error?:Error,value?:Readonly<FreshMainnetProtocolReport>)=>{if(settled)return;settled=true;clearTimeout(timer);error?fail(error):done(value!);};
   const stop=()=>{failed=true;child.kill('SIGKILL');};const timer=setTimeout(stop,300000);
   child.on('error',()=>{failed=true;if(!child.pid)finish(refused());else child.kill('SIGKILL');});child.stdin.on('error',stop);
   child.stdout.on('data',(part:Buffer)=>{if(stdout.length+part.length>65536){stop();}else stdout=Buffer.concat([stdout,part]);});
   child.stderr.on('data',(part:Buffer)=>{stderrBytes+=part.length;if(stderrBytes>8192){stop();}});
   child.on('close',code=>{
    if(failed||code!==0)return finish(refused());try{
     const report=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(stdout)) as FreshMainnetProtocolReport;
     if(Object.keys(report).sort().join(',')!=='format,hostChild,mode,network,passed,qualifier,selectedApplicationWriter,spawnedPostgres'||report.format!=='keryx-fresh-mainnet-protocol-v1'||report.mode!==input.mode||report.passed!==true||report.network!=='eip155:5042'||report.hostChild!==true||report.spawnedPostgres!==false||report.selectedApplicationWriter!==false)throw refused();
     const rows=report.qualifier;if(!rows||typeof rows!=='object'||Array.isArray(rows)||Object.keys(rows).length>128||Object.entries(rows).some(([key,value])=>!/^[A-Za-z][A-Za-z0-9]{0,79}$/.test(key)||typeof value!=='boolean'&&(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e12))||rows.productionData!==false||rows.installedNativeWriterQualified===true||rows.fullWriterQualified===true)throw refused();
     finish(undefined,Object.freeze({...report,qualifier:Object.freeze({...rows})}));
    }catch{finish(refused());}
   });child.stdin.end(wire);
  });
 }finally{
  if(resolve(folder)===base||relative(base,resolve(folder)).startsWith('..')||dirname(resolve(folder))!==base||lstatSync(folder).isSymbolicLink()||realpathSync(folder).toLowerCase()!==resolve(folder).toLowerCase())throw refused();
  rmSync(folder,{recursive:true,force:true});
 }
}
