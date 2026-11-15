/** Actual prepared Next routes, never a bundled replacement application/factory.
 * Only synthetic storage credentials/key cross stdin. No custody/provider action. */
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {lstatSync,readFileSync,readSync,readdirSync,writeFileSync} from 'node:fs';
import {request} from 'node:http';
import {createRequire} from 'node:module';
import {networkInterfaces} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Client as PgClient,ClientConfig} from 'pg';
import {canonicalJson} from '../../lib/canonical-json';
import {ARC_MAINNET_PROFILE} from '../../lib/arc-network-profile';
import {validateStorageIdentity,type StorageIdentity} from '../../lib/db/storage-identity';
import {NATIVE_CURRENT_RUNTIME_CANDIDATE_PROFILE as PROFILE} from '../../lib/db/postgres/runtime-profile';
import {sealEnrolledCacheText} from '../../lib/sources/enrolled-content-cache';

export const PREPARED_NEXT_INPUT_BYTES=32768,PREPARED_NEXT_REPORT_BYTES=65536;
export const PREPARED_NEXT_MODES=['verify','writer','restart','wrong-identity','wrong-source','wrong-key','reader-credential','held-target','limits','oom','hang'] as const;
export type PreparedNextMode=typeof PREPARED_NEXT_MODES[number];
export const PREPARED_NEXT_PUBLIC_KEYS=Object.freeze([
 'NEXT_PUBLIC_CIRCLE_APP_ID','NEXT_PUBLIC_GOOGLE_CLIENT_ID','KERYX_REGISTRY_ADDRESS','NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS',
 'KERYX_REGISTRY_READ_ADDRESS','NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS','KERYX_RUN_PRIVACY_ENABLED','NEXT_PUBLIC_WC_PROJECT_ID',
 'KERYX_REGISTRY_VERSION','NEXT_PUBLIC_KERYX_REGISTRY_VERSION','KERYX_REGISTRY_ORIGINS','NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS',
 'KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS','NEXT_PUBLIC_KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS',
]);
export interface PreparedNextChildInput{
 mode:PreparedNextMode;candidate:string;sourceManifestSha256:string;artifactInspectionSha256:string;preparationSha256:string;
 publicBuildControls:Record<string,string>;identity:StorageIdentity;digest:string;password:string;
}
export function preparedNextRefused():never{throw Error('Prepared mainnet Next qualification refused');}
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
function object(raw:unknown,keys:string):Record<string,unknown>{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||![Object.prototype,null].includes(Object.getPrototypeOf(raw))||
  Object.getOwnPropertySymbols(raw).length||Object.values(Object.getOwnPropertyDescriptors(raw)).some(x=>!x.enumerable||!('value'in x))||Object.keys(raw).sort().join(',')!==keys)preparedNextRefused();
 return raw as Record<string,unknown>;
}
export function capturePreparedNextChildInput(raw:unknown):PreparedNextChildInput{
 const x=object(raw,'artifactInspectionSha256,candidate,digest,identity,mode,password,preparationSha256,publicBuildControls,sourceManifestSha256');
 if(typeof x.mode!=='string'||!PREPARED_NEXT_MODES.includes(x.mode as PreparedNextMode)||typeof x.candidate!=='string'||!/^\/work\/releases\/[a-f0-9]{40}$/.test(x.candidate))preparedNextRefused();
 for(const key of ['sourceManifestSha256','artifactInspectionSha256','preparationSha256','digest'])if(typeof x[key]!=='string'||!/^([a-f0-9]{64})$/.test(x[key] as string))preparedNextRefused();
 if(x.digest!==PROFILE.catalogSha256||typeof x.password!=='string'||!/^[a-f0-9]{48}$/.test(x.password))preparedNextRefused();
 const identity=validateStorageIdentity(x.identity);if(identity.network!=='eip155:5042'||identity.authorityMode!=='mainnet-real')preparedNextRefused();
 const controls=object(x.publicBuildControls,[...PREPARED_NEXT_PUBLIC_KEYS].sort().join(','));
 if(Object.values(controls).some(v=>typeof v!=='string'||Buffer.byteLength(v)>8192||/[\x00-\x1f\x7f]/.test(v)))preparedNextRefused();
 const captured={...x,identity,publicBuildControls:{...controls}} as unknown as PreparedNextChildInput;
 if(Buffer.byteLength(JSON.stringify(captured))>PREPARED_NEXT_INPUT_BYTES)preparedNextRefused();return captured;
}
export function assertPreparedNextLimits(x:{memory:string;swap:string;cpu:string;pids:string}){
 if(x.memory!=='536870912'||x.swap!=='0'||x.cpu!=='100000 100000'||x.pids!=='64')preparedNextRefused();
}
export function assertPreparedNextNamespace(interfaces:string[],route:string,ipv6:string){
 if(interfaces.join(',')!=='lo')preparedNextRefused();
 if(route.trim().split(/\r?\n/).slice(1).some(line=>line.trim()&&!/^lo\s/.test(line)))preparedNextRefused();
 if(ipv6.trim().split(/\r?\n/).some(line=>line.trim()&&!/\slo\s*$/.test(line)))preparedNextRefused();
}
function privateBytes(file:string,max:number):Buffer{
 const a=lstatSync(file,{bigint:true});if(!a.isFile()||a.isSymbolicLink()||a.nlink!==BigInt(1)||a.size<BigInt(1)||a.size>BigInt(max)||a.uid!==BigInt(process.getuid!())||(a.mode&BigInt(0o022)))preparedNextRefused();
 const bytes=readFileSync(file),b=lstatSync(file,{bigint:true});
 if([a.dev,a.ino,a.size,a.mtimeNs].join(':')!==[b.dev,b.ino,b.size,b.mtimeNs].join(':')||bytes.length!==Number(a.size))preparedNextRefused();return bytes;
}
async function preparedMetadata(input:PreparedNextChildInput,full:boolean){
 const source=join(input.candidate,'source'),commit=input.candidate.split('/').at(-1)!;
 const manifestBytes=privateBytes(join(input.candidate,'source-manifest.json'),64*1024*1024),artifactBytes=privateBytes(join(input.candidate,'artifact-inspection.json'),16384),prepBytes=privateBytes(join(input.candidate,'preparation.json'),262144);
 assert.equal(sha(manifestBytes),input.sourceManifestSha256);assert.equal(sha(artifactBytes),input.artifactInspectionSha256);assert.equal(sha(prepBytes),input.preparationSha256);
 const manifest=JSON.parse(manifestBytes.toString('utf8')),artifact=JSON.parse(artifactBytes.toString('utf8')),prep=JSON.parse(prepBytes.toString('utf8'));
 assert.equal(manifest.format,'keryx-immutable-source-v1');assert.equal(manifest.commit,commit);assert.equal(manifest.productionAdmitted,false);
 assert.equal(artifact.format,'keryx-immutable-artifact-inspection-v2');assert.equal(artifact.commit,commit);assert.equal(artifact.productionAdmitted,false);
 assert.equal(prep.format,'keryx-immutable-preparation-v1');assert.equal(prep.commit,commit);assert.equal(prep.productionAdmitted,false);assert.equal(prep.writerHoldStarted,false);assert.equal(prep.runtimeEnvironmentLoaded,false);
 assert.equal(prep.sourceManifestSha256,input.sourceManifestSha256);assert.equal(prep.artifactInspectionSha256,input.artifactInspectionSha256);assert.equal(prep.artifactDigest,artifact.artifactDigest);assert.equal(prep.buildId,artifact.buildId);
 assert.match(artifact.artifactDigest,/^[a-f0-9]{64}$/);assert.equal(prep.checks.platform,'linux');assert.equal(prep.checks.arch,'x64');assert.equal(prep.checks.node,'24.22.1');assert.equal(prep.checks.npm,'11.19.0');
 assert.equal(prep.inputs.method,'independent-file-copy');assert.equal(prep.checks.publicBuildSettings.network,'arc');assert.equal(prep.checks.publicBuildSettings.forceOffline,false);
 assert.deepEqual(prep.checks.results.map((r:{name:string})=>r.name),['typecheck','tests','build']);
 for(const result of prep.checks.results){assert.equal(result.exitCode,0);assert.equal(result.signal,null);assert.equal(result.processError,null);}
 assert.equal(privateBytes(join(source,'.next/BUILD_ID'),256).toString('utf8').trim(),artifact.buildId);
 for(const name of ['.env','.env.local','.env.production','.env.production.local'])assert(!readdirSync(source).includes(name),'Runtime ENV must not be in the code cohort');
 // Check these executable helper bytes against the independently supplied
 // source manifest BEFORE importing them. The complete artifact is rehashed
 // in verify mode; all application runs use this same immutable readonly image.
 for(const name of ['scripts/immutable-release-staging.mjs','scripts/immutable-release-public-profile.mjs','scripts/next-public-server.mjs']){
  const entry=manifest.files.find((x:{path:string})=>x.path===name);assert(entry&&/^[a-f0-9]{64}$/.test(entry.sha256));assert.equal(sha(privateBytes(join(source,name),262144)),entry.sha256);
 }
 const publicHelper=await import(pathToFileURL(join(source,'scripts/immutable-release-public-profile.mjs')).href);
 assert.deepEqual(publicHelper.mainnetPublicBuildProfile(input.publicBuildControls),input.publicBuildControls);
 assert.equal(publicHelper.mainnetPublicBuildProfileSha256(input.publicBuildControls),prep.checks.publicBuildSettings.mainnetPublicConfigSha256);
 assert.equal(publicHelper.mainnetPrivateHeaderDigest(source),prep.checks.publicBuildSettings.privateRunHeadersSha256);
 if(full){const helper=await import(pathToFileURL(join(source,'scripts/immutable-release-staging.mjs')).href);assert.deepEqual(helper.verifyImmutableArtifact({candidate:input.candidate,sourceManifestSha256:input.sourceManifestSha256,artifactInspectionSha256:input.artifactInspectionSha256}),artifact);}
 return {source,commit,buildId:artifact.buildId as string,artifactDigest:artifact.artifactDigest as string};
}
function get(path:string,max=65536):Promise<{status:number;body:Buffer;type:string}>{
 return new Promise((accept,reject)=>{
  const req=request({hostname:'127.0.0.1',port:3940,path,agent:false,headers:{Host:'keryx.cc','X-Forwarded-Proto':'https'}},res=>{
   const chunks:Buffer[]=[];let bytes=0;res.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>max)res.destroy(Error('Prepared Next response bound'));else chunks.push(chunk);});
   res.on('error',reject);res.on('end',()=>accept({status:res.statusCode??0,body:Buffer.concat(chunks),type:String(res.headers['content-type']??'')}));
  });req.setTimeout(30000,()=>req.destroy(Error('Prepared Next health deadline')));req.on('error',reject);req.end();
 });
}
function noSqlite(folder:string){
 for(const entry of readdirSync(folder,{withFileTypes:true})){
  const file=join(folder,entry.name);if(entry.isSymbolicLink())preparedNextRefused();if(entry.isDirectory())noSqlite(file);
  else if(/(?:\.sqlite(?:3)?|\.db)(?:-wal|-shm|-journal)?$/i.test(entry.name))preparedNextRefused();
 }
}
let reportBytes=0;
function report(x:Record<string,unknown>){const wire=JSON.stringify(x)+'\n';reportBytes+=Buffer.byteLength(wire);if(reportBytes>PREPARED_NEXT_REPORT_BYTES)preparedNextRefused();return new Promise<void>((accept,reject)=>process.stdout.write(wire,e=>e?reject(e):accept()));}
async function main(){
 assert.equal(process.platform,'linux');assert.equal(process.version,'v24.22.1');assert.equal(process.getuid!(),0);assert(process.execArgv.includes('--max-old-space-size=256'));
 const buffer=Buffer.alloc(PREPARED_NEXT_INPUT_BYTES+1);let bytes=0;while(bytes<buffer.length){const n=readSync(0,buffer,bytes,buffer.length-bytes,null);if(!n)break;bytes+=n;}if(bytes>PREPARED_NEXT_INPUT_BYTES)preparedNextRefused();
 const input=capturePreparedNextChildInput(JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(buffer.subarray(0,bytes))));buffer.fill(0);
 const limits={memory:readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),swap:readFileSync('/sys/fs/cgroup/memory.swap.max','utf8').trim(),cpu:readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim(),pids:readFileSync('/sys/fs/cgroup/pids.max','utf8').trim()};
 try{assertPreparedNextLimits(limits);}catch{if(input.mode!=='limits')throw Error('Prepared Next limits refused');await report({passed:false,mode:'limits',refusal:'limits_refused',observedMemoryBytes:Number(limits.memory)});process.exitCode=2;return;}
 const status=readFileSync('/proc/self/status','utf8');assert(/^NoNewPrivs:\s+1$/m.test(status)&&/^CapEff:\s+0+$/m.test(status));
 let ipv6='';try{ipv6=readFileSync('/proc/net/ipv6_route','utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 assertPreparedNextNamespace(Object.keys(networkInterfaces()).sort(),readFileSync('/proc/net/route','utf8'),ipv6);
 await report({started:true,mode:input.mode,limitsVerified:true,namespaceVerified:true});
 if(input.mode==='limits')preparedNextRefused();
 if(input.mode==='oom'){const retained:Buffer[]=[];for(;;)retained.push(Buffer.alloc(16*1024*1024,0x75));}
 if(input.mode==='hang')await new Promise<never>(()=>{setInterval(()=>{},1000);});
 const metadata=await preparedMetadata(input,input.mode==='verify');
 if(input.mode==='verify'){await report({passed:true,mode:'verify',artifactVerified:true,artifactDigest:metadata.artifactDigest,buildId:metadata.buildId});return;}
 Object.assign(process.env,input.publicBuildControls,{NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',KERYX_NETWORK:'arc',NEXT_PUBLIC_KERYX_NETWORK:'arc',KERYX_FORCE_OFFLINE:'0',BASE_URL:'https://keryx.cc',KERYX_COMMIT:metadata.commit,KERYX_RPC_WS_URL:'',KERYX_RUN_PRIVACY_ENABLED:'true',KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED:'true',KERYX_PUBLIC_PROFILES_ENABLED:'true'});
 const folder='/run/keryx-prepared-next',key=randomBytes(32).toString('hex'),cacheId='synthetic-prepared-next-'+randomUUID(),text='Prepared Next synthetic encrypted cold cache';
 process.env.CONTENT_MASTER_KEY=key;const envelope=sealEnrolledCacheText(text,cacheId,input.identity);
 const credential=(role:string)=>canonicalJson({format:'keryx-postgres-role-credential-v1',role,password:input.password});
 const application=join(folder,'application.json'),reader=join(folder,'reader.json'),manifest=join(folder,'storage.json');
 writeFileSync(application,credential(input.mode==='reader-credential'?'keryx_reader':'keryx_app'),{flag:'wx',mode:0o600});writeFileSync(reader,credential('keryx_reader'),{flag:'wx',mode:0o600});
 writeFileSync(manifest,canonicalJson({format:'keryx-storage-deployment-v1',identity:input.mode==='wrong-identity'?{...input.identity,storageId:input.identity.storageId==='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'?'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb':'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'}:input.identity,backend:{kind:'postgres',database:'native_target',sourceDigest:input.mode==='wrong-source'?'00'.repeat(32):input.digest,endpoint:{kind:'loopback',port:5432},credentialPaths:{application,reader}}}),{flag:'wx',mode:0o600});
 process.env.KERYX_STORAGE_MANIFEST=manifest;if(input.mode==='wrong-key')process.env.CONTENT_MASTER_KEY=key==='ff'.repeat(32)?'ee'.repeat(32):'ff'.repeat(32);
 // Use this prepared cohort's pg for the independent observer, never hooks on
 // a second bundled driver's prototype. Actual pg_stat_activity supplies the
 // application's SQL witness, irrespective of Next's trace alias resolution.
 const requireApp=createRequire(join(metadata.source,'package.json'));
 const pg=requireApp('pg') as {Client:new(config:ClientConfig)=>PgClient};
 const owner=new pg.Client({host:'127.0.0.1',port:5432,database:'native_target',user:'postgres',password:input.password,ssl:false,connectionTimeoutMillis:2000,query_timeout:6000,options:'-c statement_timeout=5000 -c lock_timeout=1000 -c timezone=UTC',application_name:'keryx-prepared-next-owner'});
 owner.on('error',()=>{});await owner.connect();let rowOwned=false,running:{close:()=>Promise<void>}|undefined;
 let logCalls=0,blockedRegistryFetches=0,otherBlockedFetches=0;const originalFetch=globalThis.fetch;
 const logs=[console.log,console.info,console.warn,console.error,console.debug] as const;
 const silence=()=>{if(++logCalls>10000)preparedNextRefused();};console.log=console.info=console.warn=console.error=console.debug=silence;
 globalThis.fetch=(async(resource:Parameters<typeof fetch>[0],...args:unknown[])=>{
  const url=new URL(typeof resource==='string'?resource:resource instanceof URL?resource.href:resource.url);
  if(url.origin===new URL(ARC_MAINNET_PROFILE.rpcUrl).origin)blockedRegistryFetches++;else otherBlockedFetches++;
  throw Error('Prepared Next external fetch blocked');
 }) as typeof fetch;
 const positive=input.mode==='writer'||input.mode==='restart';let healthRequests=0,assetBytes=0,pageBytes=0,sqlObserved=false,refusalAt:'startup'|'health'|null=null,httpDrained=false;
 try{
  assert.equal((await owner.query("SELECT mode FROM keryx_storage.control")).rows[0]?.mode,'active');
  assert.equal((await owner.query('SELECT count(*)::int AS n FROM public.cache_items')).rows[0]?.n,0,'Only fresh synthetic cache intake is admitted');
  assert.equal((await owner.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND usename IN('keryx_app','keryx_reader')")).rows[0]?.n,0);
  await owner.query('BEGIN');try{await owner.query("UPDATE keryx_storage.control SET mode='held'");await owner.query('INSERT INTO public.cache_items(source_id,text) VALUES($1,$2)',[cacheId,envelope]);await owner.query("UPDATE keryx_storage.control SET mode='active'");await owner.query('COMMIT');rowOwned=true;}catch(e){await owner.query('ROLLBACK');throw e;}
  if(input.mode==='held-target')await owner.query("UPDATE keryx_storage.control SET mode='held'");
  const server=await import(pathToFileURL(join(metadata.source,'scripts/next-public-server.mjs')).href);
  try{running=await server.startNextPublicServer({dir:metadata.source,port:3940,useBuildConfig:true});}catch{if(positive)throw Error('Prepared Next positive startup refused');refusalAt='startup';}
  if(running){
   const first=await get('/api/health');healthRequests++;
   if(positive){
    const check=(response:Awaited<ReturnType<typeof get>>)=>{assert.equal(response.status,200);const body=JSON.parse(response.body.toString('utf8'));assert.equal(body.ok,true);assert.equal(body.db,'ok');assert.equal(body.network,'arc');assert.equal(body.commit,metadata.commit);assert.equal(body.status,'operational');assert.equal(body.settles,'real');return JSON.stringify(body.traction);};
    const observed=check(first);
    const activity=await owner.query("SELECT usename,application_name FROM pg_stat_activity WHERE datname=current_database() AND usename IN('keryx_app','keryx_reader')");
    assert(activity.rows.some((r:{usename:string;application_name:string})=>r.usename==='keryx_app'&&r.application_name==='keryx-postgres-guarded'));assert(activity.rows.every((r:{usename:string})=>r.usename==='keryx_app'));sqlObserved=true;
    // Sixteen actual dynamic health responses, at most two in flight.
    while(healthRequests<16){const count=Math.min(2,16-healthRequests),responses=await Promise.all(Array.from({length:count},()=>get('/api/health')));healthRequests+=count;for(const response of responses)assert.equal(check(response),observed);}
    const page=await get('/',2*1024*1024);assert.equal(page.status,200);assert.match(page.type,/text\/html/);pageBytes=page.body.length;
    const html=page.body.toString('utf8'),assets=[...html.matchAll(/(?:src|href)="([^"<>]+)"/g)].map(x=>x[1].replaceAll('&amp;','&')).filter(x=>/^\/_next\/static\/[A-Za-z0-9_./%?=+&-]+\.(?:css|js)(?:\?[^"<>]*)?$/.test(x));assert(assets.length,'Prepared public page must load a local compiled asset');
    const asset=await get(assets.find(x=>x.includes('.css'))??assets[0],2*1024*1024);assert.equal(asset.status,200);assert(asset.body.length>0);assetBytes=asset.body.length;
    assert(blockedRegistryFetches>0,'Actual immediate mainnet registry sync must be observed and blocked');assert.equal(otherBlockedFetches,0,'Unexpected provider HTTP is not qualified');
   }else{assert.equal(first.status,503);const body=JSON.parse(first.body.toString('utf8'));assert.equal(body.ok,false);assert.equal(body.db,'unreachable');refusalAt='health';}
   await running.close();httpDrained=true;running=undefined;
  }
  if(!positive)assert(refusalAt!==null);noSqlite(folder);
 }finally{
  await running?.close();globalThis.fetch=originalFetch;[console.log,console.info,console.warn,console.error,console.debug]=logs;
  try{if(rowOwned){await owner.query('BEGIN');try{await owner.query("UPDATE keryx_storage.control SET mode='held'");const removed=await owner.query('DELETE FROM public.cache_items WHERE source_id=$1 AND text=$2',[cacheId,envelope]);assert.equal(removed.rowCount,1);await owner.query("UPDATE keryx_storage.control SET mode='active'");await owner.query('COMMIT');}catch(e){await owner.query('ROLLBACK');throw e;}}}finally{await owner.end();}
  process.env.CONTENT_MASTER_KEY='';input.password='';
 }
 await report({passed:true,mode:input.mode,actualCompiledNext:true,mainnetPublicBuild:true,sqlObserved,healthRequests,pageBytes,assetBytes,blockedRegistryFetches,otherBlockedFetches,logCalls,httpDrained,refusalAt,noSqliteFallback:true,nativeGracefulDrainProven:false});
 // Next's existing custom shutdown exits after HTTP/Next drain. Background
 // timers/native sockets end with this process; the controller proves actual
 // post-exit PG connection cleanup, never labels this graceful facade drain.
 process.exit(0);
}
if(process.argv[1]==='/prepared-next-child.cjs')void main().catch(async()=>{await report({passed:false,refusal:'prepared_next_refused'}).catch(()=>{});process.exit(1);});
