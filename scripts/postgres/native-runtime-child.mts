/** Compiled Linux fixture entry. All identity, credentials, keys and data are
 * independently generated synthetic inputs; no live login, signer or vendor. */
import assert from 'node:assert/strict';
import { chmodSync,linkSync,readFileSync,readSync,rmSync,symlinkSync,writeFileSync } from 'node:fs';
import { canonicalJson } from '../../lib/canonical-json';
async function main(){
 const buffer=Buffer.alloc(16385);let bytes=0;while(bytes<buffer.length){const n=readSync(0,buffer,bytes,buffer.length-bytes,null);if(!n)break;bytes+=n;}assert(bytes<=16384);
 const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,bytes))) as {mode:string;identity:Record<string,unknown>;digest:string;password:string;key:string;owner:string};
 assert.equal(process.platform,'linux');assert.equal(process.version,'v24.22.1');assert.equal(process.getuid!(),0);
 const cgroup=(name:string)=>readFileSync('/sys/fs/cgroup/'+name,'utf8').trim();
 const limits={memoryMax:cgroup('memory.max'),swapMax:cgroup('memory.swap.max'),cpuMax:cgroup('cpu.max'),pidsMax:cgroup('pids.max')};
 assert.deepEqual(limits,{memoryMax:'536870912',swapMax:'0',cpuMax:'100000 100000',pidsMax:'64'});
 const folder='/run/keryx-runtime',readerPath=folder+'/reader.json',appPath=folder+'/application.json',manifestPath=folder+'/storage.json';
 const credential=(role:string,password=input.password)=>canonicalJson({format:'keryx-postgres-role-credential-v1',role,password});
 writeFileSync(readerPath,credential('keryx_reader'),{mode:0o600});writeFileSync(appPath,credential('keryx_app'),{mode:0o600});
 const identity={...input.identity};if(input.mode==='wrong-identity')identity.storageId='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
 const manifest={format:'keryx-storage-deployment-v1',identity,backend:{kind:'postgres',database:'native_target',sourceDigest:input.mode==='wrong-source'?'00'.repeat(32):input.digest,
  endpoint:{kind:'loopback',port:5432},credentialPaths:{application:appPath,reader:readerPath}}};
 writeFileSync(manifestPath,canonicalJson(manifest),{mode:0o600});
 process.env.KERYX_STORAGE_MANIFEST=manifestPath;process.env.CONTENT_MASTER_KEY=input.mode==='missing-key'?'':input.mode==='wrong-key'?'ff'.repeat(32):input.key;
 let outbound=0;globalThis.fetch=async()=>{outbound++;throw new Error('Synthetic native runtime forbids outbound HTTP');};
 const application=await import('../../lib/db/application-storage'),native=await import('../../lib/db/postgres/runtime-adapter'),privateFile=await import('../../lib/db/postgres/private-credential');
 let checks=0;
 assert.equal(privateFile.readPrivatePostgresCredential(readerPath,'keryx_reader').password,input.password);checks++;
 chmodSync(readerPath,0o644);assert.throws(()=>privateFile.readPrivatePostgresCredential(readerPath,'keryx_reader'));chmodSync(readerPath,0o600);checks++;
 const alias=folder+'/alias';linkSync(readerPath,alias);assert.throws(()=>privateFile.readPrivatePostgresCredential(readerPath,'keryx_reader'));rmSync(alias);symlinkSync(readerPath,alias);assert.throws(()=>privateFile.readPrivatePostgresCredential(alias,'keryx_reader'));rmSync(alias);checks++;
 assert.throws(()=>privateFile.readPrivatePostgresCredential(readerPath,'keryx_app'));checks++;
 if(input.mode==='wrong-credential-role')writeFileSync(readerPath,credential('keryx_app'));
 if(input.mode!=='success'){
  if(input.mode==='wrong-source'){
   chmodSync(readerPath,0o644);
   await assert.rejects(application.createReadonlyApplicationStorage(),/adapter_not_initialized/);
  }else await assert.rejects(application.createReadonlyApplicationStorage());checks++;
  assert.equal(outbound,0);console.log(JSON.stringify({passed:true,mode:input.mode,checks,platform:process.platform,node:process.version,outbound,limits,resourcePressureQualified:false,selectedApplicationWriter:false}));return;
 }
 const reader=await application.createReadonlyApplicationStorage();assert(reader);checks++;
 try{
  assert.deepEqual(await native.assertPostgresRuntimeIdentity(reader),input.identity);checks++;
  await assert.rejects(native.assertPostgresRuntimeIdentity(reader,'write'));await assert.rejects(native.assertPostgresRuntimeIdentity(new Proxy(reader,{})));checks++;
  await assert.rejects(application.createApplicationStorage());checks++;
  const metrics=await reader.metrics();assert.equal(metrics.totalQueries,1);checks++;
  assert.throws(()=>Reflect.get(reader,'getQueryRun'));assert.throws(()=>Reflect.get(reader,'upsertSource'));assert.throws(()=>Reflect.get(reader,'runPrivacy'));assert.deepEqual(Reflect.ownKeys(reader),[]);assert.equal(Object.getPrototypeOf(reader),null);checks++;
  const profile=await reader.privateProfiles!.get(input.owner,'eip155:5042');assert.equal(profile.profile,null);assert.equal(profile.activity.questions,1);checks++;
  assert.equal((await reader.profileIdentities!.list(input.owner)).identities.length,0);checks++;
  let parsed=0;await assert.rejects(reader.privateProfiles!.update(input.owner,{get displayName(){parsed++;return 'unused';}} as never));assert.equal(parsed,0);checks++;
  const filters={search:'Original'},pending=reader.personalHistory!.list(input.owner,{filters,take:1});filters.search='Changed';const rows=await pending;assert.equal(rows.length,1);assert.equal(rows[0].id,'synthetic-runtime-run');checks++;
  const ownership=reader.runOwnershipHistory!,binding={network:'eip155:5042' as const,origin:'https://keryx.cc'};
  assert.equal((await ownership.list(input.owner,{binding,filters:{},take:1}))[0]?.id,'synthetic-runtime-run');checks++;
  const original=await ownership.read(input.owner,binding,'synthetic-runtime-run');assert.equal(original?.run.id,'synthetic-runtime-run');assert.equal(original?.run.asker,input.owner);checks++;
  const before=performance.now();await reader.metrics();const observedReadMs=performance.now()-before;
  // A changed credential is not adopted by an already-created facade.
  writeFileSync(readerPath,credential('keryx_reader','different-synthetic-password'));assert.throws(()=>reader.metrics());writeFileSync(readerPath,credential('keryx_reader'));checks++;
  const captured=reader.personalHistory!,request=captured.list(input.owner,{filters:{},take:1}),outcome=request.then(()=>({returned:true}),()=>({returned:false}));
  await application.closeReadonlyApplicationStorage(reader);assert.equal((await outcome).returned,false);await assert.rejects(native.assertPostgresRuntimeIdentity(reader));await assert.rejects(captured.list(input.owner,{filters:{},take:1}));checks++;
  await assert.rejects(ownership.read(input.owner,binding,'synthetic-runtime-run'));checks++;
  assert.equal(outbound,0);console.log(JSON.stringify({passed:true,mode:input.mode,checks,platform:process.platform,node:process.version,outbound,limits,resourcePressureQualified:false,actualPrivatePermissions:true,genuineZeroArgumentReadonlyFactory:true,exactFacadeProvenance:true,coldCacheAuthenticated:true,inputCapturedBeforeAwait:true,actualTerminalDrain:true,observedReadMs,selectedApplicationWriter:false,productionData:false,paidOperations:0}));
 }finally{await native.closePostgresRuntimeAdapter(reader);}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
