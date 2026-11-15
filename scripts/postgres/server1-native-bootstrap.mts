/** Fixed server1 public boot admission. No migration, renewal, signing, job,
 * force-stop, predecessor restart, private-role activation or runtime issuer. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync, type BigIntStats } from 'node:fs';
import { dirname, parse, relative, resolve, sep } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { privateKeyToAddress } from 'viem/accounts';
import { canonicalJson } from '../../lib/canonical-json';
import { config } from '../../lib/config';
import { configuredResearchAllowance } from '../../lib/research/research-allowance';
import { configuredHostedTreasuryPolicy, hostedTreasuryPolicyDigest } from '../../lib/payments/hosted-treasury-policy';
import { applicationStorageIdentity, assertApplicationStorageCurrentLocal, closeReadonlyApplicationStorage, createReadonlyApplicationStorage } from '../../lib/db/application-storage';
import { readRuntimeStorageDeployment } from '../../lib/db/runtime-storage-config';
import { storageIdentityDigest, type StorageIdentity } from '../../lib/db/storage-identity';
import { readProtectedDeploymentJson, readReviewedRoles, releaseSource, SERVER1_NATIVE_RELEASE, verifyReleaseReview } from '../redeploy-reviewed-roles.mjs';
import { verifyImmutableArtifact } from '../immutable-release-staging.mjs';

const root='/root/keryx-migration',environment='/root/keryx/.env.local';
const transferSha='e9212277066c6774ea5959914823ce59125892ed1da9706725a50597e56ddb68';
const machineSha='a9baadf374fdfbacaa7ac7d7562109b32111821b583170a94d423de4ef4e65eb';
const sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const token=(s:BigIntStats)=>[s.dev,s.ino,s.uid,s.gid,s.mode,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');
const consumedEnvironment=['KERYX_STORAGE_MANIFEST','KERYX_SQLITE_PATH','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY',
 'KERYX_NETWORK','NEXT_PUBLIC_KERYX_NETWORK','KERYX_FORCE_OFFLINE','BASE_URL',
 'KERYX_MAINNET_TREASURY_POLICY_JSON','KERYX_MAINNET_TREASURY_POLICY_DIGEST','KERYX_MAINNET_TREASURY_PRIVATE_KEY'] as const;
function refuse():never{throw new Error('Server1 native public boot refused');}
function heldFile(path:string,maximum:number,privateMode=true){
 const ancestors=()=>{let cursor=parse(path).root;const parts=relative(cursor,path).split(sep);for(const [i,part] of parts.entries()){cursor=resolve(cursor,part);const s=lstatSync(cursor);assert(!s.isSymbolicLink());if(i<parts.length-1)assert(s.isDirectory()&&s.uid===0&&s.gid===0&&(s.mode&0o022)===0);}};
 ancestors();
 assert.equal(realpathSync(path),path);const initial=lstatSync(path,{bigint:true});
 assert(initial.isFile()&&initial.uid===BigInt(0)&&initial.gid===BigInt(0)&&initial.nlink===BigInt(1)&&initial.size>BigInt(0)&&initial.size<=BigInt(maximum));
 assert(privateMode?(initial.mode&BigInt(0o777))===BigInt(0o600):(initial.mode&BigInt(0o022))===BigInt(0));
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 const verify=()=>{ancestors();assert.equal(token(fstatSync(fd,{bigint:true})),token(initial));assert.equal(token(lstatSync(path,{bigint:true})),token(initial));};
 try{verify();const buffer=Buffer.alloc(maximum+1);let n=0;while(n<buffer.length){const count=readSync(fd,buffer,n,buffer.length-n,n);if(!count)break;n+=count;}assert(n<=maximum);assert.equal(BigInt(n),initial.size);verify();return {bytes:buffer.subarray(0,n),verify,close:()=>closeSync(fd)};}catch(error){closeSync(fd);throw error;}
}
function privateWorkerInactive(){
 const text=execFileSync('/usr/bin/systemctl',['show','keryx-private-worker.service','--property=ActiveState,UnitFileState','--no-pager'],{encoding:'utf8',timeout:3000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin'}});
 const values=Object.fromEntries(text.trim().split('\n').map(v=>{const at=v.indexOf('=');assert(at>0);return [v.slice(0,at),v.slice(at+1)];}));
 assert.equal(values.ActiveState,'inactive');assert(!['enabled','enabled-runtime','linked','linked-runtime'].includes(values.UnitFileState));
}
function pm2(args:string[]){
 // Never autospawn a daemon to make boot admission pass.
 const pid=Number(readFileSync('/root/.pm2/pm2.pid','utf8').trim());assert(Number.isSafeInteger(pid)&&pid>1);process.kill(pid,0);
 return execFileSync('/usr/bin/pm2',args,{encoding:'utf8',timeout:10000,maxBuffer:8388608,env:{HOME:'/root',PATH:'/usr/bin:/bin',PM2_HOME:'/root/.pm2'}});
}
function observedRoles(expected:ReturnType<typeof readReviewedRoles>,verifyOnly:boolean){
 const rows:unknown=JSON.parse(pm2(['jlist']));assert(Array.isArray(rows));
 assert(rows.length===0||rows.length===2);
 for(const app of rows){
  assert(app&&typeof app==='object');const wanted=expected.apps.find((v:{name:string})=>v.name===app.name);assert(wanted);
  const stopped=app.pid===0&&app.pm2_env?.status==='stopped';
  if(verifyOnly&&stopped)continue; // Definition replacement remains the existing reviewed-role helper's job.
  assert(Number.isSafeInteger(app.pid)&&app.pid>1&&app.pm2_env?.status==='online');
  for(const [field,value] of [['pm_exec_path',wanted.script],['pm_cwd',wanted.cwd],['exec_interpreter',wanted.interpreter],['autorestart',wanted.autorestart],['kill_timeout',wanted.kill_timeout]])assert.equal(app.pm2_env[field],value);
  assert.deepEqual(app.pm2_env.args,wanted.args);
 }
 assert.equal(new Set(rows.map(v=>v.name)).size,rows.length);return rows;
}
async function waitForPostgres(frame:()=>unknown){
 const deadline=performance.now()+30000;
 const remaining=()=>{const ms=Math.floor(deadline-performance.now());if(ms<=0)refuse();return Math.min(2000,ms);};
 while(true){
  frame();const text=execFileSync('/usr/bin/systemctl',['show','postgresql@17-keryx.service','--property=ActiveState,MainPID,User,Group','--no-pager'],{encoding:'utf8',timeout:remaining(),maxBuffer:4096,env:{PATH:'/usr/bin:/bin'}});
  const state=Object.fromEntries(text.trim().split('\n').map(line=>{const at=line.indexOf('=');assert(at>0);return [line.slice(0,at),line.slice(at+1)];}));
  assert(['active','activating'].includes(state.ActiveState));assert.equal(state.User,'postgres');assert.equal(state.Group,'root');
  let ready=false;
  try{execFileSync('/usr/lib/postgresql/17/bin/pg_isready',['-h','/run/postgresql-keryx','-p','5432','-d','keryx_mainnet','-U','postgres','-t','1'],{timeout:remaining(),maxBuffer:4096,stdio:'ignore',env:{PATH:'/usr/bin:/bin',PGPASSFILE:'/dev/null'}});ready=true;}
  catch(error){const status=error&&typeof error==='object'?Reflect.get(error,'status'):null;if(status!==1&&status!==2)refuse();}
  remaining();
  if(ready&&state.ActiveState==='active'){
   assert(/^[1-9][0-9]{0,9}$/.test(state.MainPID));
   const daemon=lstatSync('/proc/'+state.MainPID,{bigint:true}),directory=lstatSync('/run/postgresql-keryx',{bigint:true}),socket=lstatSync('/run/postgresql-keryx/.s.PGSQL.5432',{bigint:true});
   assert(!directory.isSymbolicLink()&&directory.isDirectory()&&directory.uid===daemon.uid&&directory.gid===BigInt(0)&&(directory.mode&BigInt(0o777))===BigInt(0o750));
   assert(!socket.isSymbolicLink()&&socket.isSocket()&&socket.uid===daemon.uid&&socket.gid===BigInt(0)&&(socket.mode&BigInt(0o777))===BigInt(0o770));
   frame();return;
  }
  await new Promise<void>(done=>setTimeout(done,Math.min(250,remaining())));frame();remaining();
 }
}

/** Protected role-file arguments are byte bindings to existing Root review,
 * never caller policy/facade/proof callbacks. This function performs real
 * selected native admission before any role start. */
export async function bootstrapServer1NativeRoles(rolesFile:string,rolesSha256:string,verifyOnly:boolean){
 if(arguments.length!==3||typeof rolesFile!=='string'||typeof rolesSha256!=='string'||typeof verifyOnly!=='boolean')refuse();
 if(!/^\/root\/\.local\/share\/[a-zA-Z0-9_./-]+\.json$/.test(rolesFile)||resolve(rolesFile)!==rolesFile||!/^[a-f0-9]{64}$/.test(rolesSha256))refuse();
 assert.equal(process.platform,'linux');assert.equal(process.getuid!(),0);assert.equal(process.version,'v24.22.1');assert.equal(process.cwd(),'/root/keryx');
 const held:Array<ReturnType<typeof heldFile>>=[];let db:Awaited<ReturnType<typeof createReadonlyApplicationStorage>>=undefined;let identity:Readonly<StorageIdentity>|undefined;
 let accepted:unknown,failure:unknown;const cleanup:string[]=[];
 try{
  const transfer=heldFile(root+'/authority-transfer.json',65536);held.push(transfer);assert.equal(sha(transfer.bytes),transferSha);
  const original=JSON.parse(transfer.bytes.toString('utf8'));assert.equal(original.format,'keryx-single-writer-host-transfer-v1');assert.equal(original.source,SERVER1_NATIVE_RELEASE.sourceCommit);
  assert.equal(original.sourceWritersNaturallyEnded,true);assert.equal(original.targetStartupAuthorized,true);assert.equal(original.financialPolicyChanged,false);assert.equal(original.newFunding,false);
  const machine=heldFile(root+'/source-machine-id',256);held.push(machine);assert.equal(sha(machine.bytes),machineSha);
  const actualMachine=heldFile('/etc/machine-id',256,false);held.push(actualMachine);assert.equal(actualMachine.bytes.toString('utf8').trim(),machine.bytes.toString('utf8').trim());
  const env=heldFile(environment,65536);held.push(env);const parsedEnvironment=parseEnv(env.bytes.toString('utf8'));
  const roles=readReviewedRoles(rolesFile,rolesSha256);assert(roles.release);const binding=roles.release;
  assert.notEqual(binding.commit,SERVER1_NATIVE_RELEASE.sourceCommit);assert.equal(sha(env.bytes),binding.runtimeEnvironmentSha256);
  assert.equal(typeof import.meta.url,'string');assert.equal(fileURLToPath(import.meta.url),releaseSource(binding.commit)+'/scripts/postgres/server1-native-bootstrap.mts');
  const artifact=verifyImmutableArtifact({candidate:dirname(releaseSource(binding.commit)),sourceManifestSha256:binding.sourceManifestSha256,artifactInspectionSha256:binding.artifactInspectionSha256});
  const review=verifyReleaseReview(binding,readProtectedDeploymentJson,artifact);assert.equal(review.format,'keryx-reviewed-native-release-compatibility-v1');
  const deployment=readRuntimeStorageDeployment();assert.equal(deployment.backend.kind,'postgres');assert.equal(process.env.KERYX_STORAGE_MANIFEST,SERVER1_NATIVE_RELEASE.manifest);
  const selection=canonicalJson(deployment),profile=canonicalJson({profile:config.profile,baseUrl:config.baseUrl,network:config.networkId});
  const key=process.env.KERYX_MAINNET_TREASURY_PRIVATE_KEY;assert(typeof key==='string'&&/^0x[a-fA-F0-9]{64}$/.test(key));const signer=privateKeyToAddress(key as `0x${string}`).toLowerCase();
  const frame=()=>{
   for(const pin of held)pin.verify();
   for(const field of consumedEnvironment)assert.equal(process.env[field]??'',parsedEnvironment[field]??'');
   assert.equal(canonicalJson(readReviewedRoles(rolesFile,rolesSha256)),canonicalJson(roles));
   assert.equal(canonicalJson(verifyReleaseReview(binding,readProtectedDeploymentJson,artifact)),canonicalJson(review));
   assert.equal(canonicalJson(readRuntimeStorageDeployment()),selection);
   assert.equal(canonicalJson({profile:config.profile,baseUrl:config.baseUrl,network:config.networkId}),profile);
   assert.equal(config.profile.name,'arc');assert.equal(config.baseUrl,'https://keryx.cc');assert.equal(configuredResearchAllowance(),null);
   assert.equal(process.env.KERYX_MAINNET_TREASURY_PRIVATE_KEY,key);privateWorkerInactive();
   const policy=configuredHostedTreasuryPolicy(identity??deployment.identity,'https://keryx.cc','public');assert.equal(hostedTreasuryPolicyDigest(policy),SERVER1_NATIVE_RELEASE.publicPolicySha256);assert.equal(policy.signer.toLowerCase(),signer);return policy;
  };
  frame();
  await waitForPostgres(frame);frame();
  try{
   db=await createReadonlyApplicationStorage();assert(db);frame();
   identity=await applicationStorageIdentity(db,'read');assert.equal(storageIdentityDigest(identity),review.storageIdentityDigest);assert.equal(canonicalJson(identity),canonicalJson(deployment.identity));
   const current=()=>{const value:unknown=assertApplicationStorageCurrentLocal(db!,'read');if(value!==undefined){void Promise.resolve(value).catch(()=>{});refuse();}return frame();};
   let policy=current();assert(policy);
   const accounting=await db.hostedTreasuryAccounting(policy.signer,'public');policy=current();assert(policy);
   assert(typeof accounting.retainedMicroUsdc==='string'&&/^(?:0|[1-9][0-9]*)$/.test(accounting.retainedMicroUsdc));assert(BigInt(accounting.retainedMicroUsdc)<=BigInt(policy.lifetimeCapMicroUsdc));
   const finalIdentity=await applicationStorageIdentity(db,'read');assert.equal(canonicalJson(finalIdentity),canonicalJson(identity));current();
  }finally{if(db)await closeReadonlyApplicationStorage(db);}
  // The reader is terminal now. Narrow only protected files/current public
  // policy after the last await; never use a retired facade as a fresh proof.
  frame();let rows=observedRoles(roles,verifyOnly);frame();let started=false;
  if(!verifyOnly&&rows.length===0){frame();pm2(['start',rolesFile]);started=true;frame();rows=observedRoles(roles,false);assert.equal(rows.length,2);}
  if(!verifyOnly){frame();pm2(['save']);frame();}
  accepted={format:'keryx-server1-native-public-boot-v1',accepted:true,verifyOnly,commit:binding.commit,buildId:artifact.buildId,identityDigest:review.storageIdentityDigest,policySha256:SERVER1_NATIVE_RELEASE.publicPolicySha256,policyExpiry:new Date(frame()!.expiresAtSeconds*1000).toISOString(),rolesStarted:started,sourceTransferPreserved:true,privateWorkerInactive:true,financialPolicyChanged:false,newFunding:false};
 }catch(error){failure=error;}
 for(const pin of held)try{pin.close();}catch{cleanup.push('descriptor');}
 if(failure||cleanup.length)throw new Error('Server1 native public boot refused');
 return accepted;
}
if(typeof import.meta.url==='string'&&process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.length!==2&&!(args.length===3&&args[2]==='--verify-only'))process.exitCode=1;
 else bootstrapServer1NativeRoles(args[0],args[1],args.length===3).then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error('Server1 native public boot refused');process.exitCode=1;});
}
