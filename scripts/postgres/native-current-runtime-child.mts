/** Genuine, compiled current-profile factory checks against synthetic PG only.
 * Driver hooks observe real I/O; they never replace results or issue provenance. */
import assert from 'node:assert/strict';
import {readFileSync,readSync,writeFileSync} from 'node:fs';
import {Client} from 'pg';
import {canonicalJson} from '../../lib/canonical-json';
import {validateStorageIdentity} from '../../lib/db/storage-identity';
import {NATIVE_CURRENT_RUNTIME_CANDIDATE_PROFILE} from '../../lib/db/postgres/runtime-profile';
import {POSTGRES_SOURCE_METHOD_ACCESS,POSTGRES_SOURCE_PROPERTIES,postgresSourcePropertyEnabled} from '../../lib/db/postgres/runtime-surface';
import {POSTGRES_RUNTIME_STORE_NAMES} from '../../lib/db/postgres/runtime-stores';
import {PostgresDomainWriteOutcomeUnknown} from '../../lib/db/postgres/domain-channel';
const modes=['success','readonly','wrong-identity','wrong-source','wrong-key','credential-change','committed-context-loss','held-target'] as const;
export type CurrentRuntimeMode=typeof modes[number];
let stage='containment';
async function main(){
 assert.equal(process.platform,'linux');assert.equal(process.version,'v24.22.1');assert.equal(process.getuid!(),0);
 for(const [file,value]of [['memory.max','536870912'],['memory.swap.max','0'],['cpu.max','100000 100000'],['pids.max','64']])assert.equal(readFileSync('/sys/fs/cgroup/'+file,'utf8').trim(),value);
 const status=readFileSync('/proc/self/status','utf8');assert(/^NoNewPrivs:\s+1$/m.test(status)&&/^CapEff:\s+0+$/m.test(status));
 const buffer=Buffer.alloc(8193);let bytes=0;for(;;){const n=readSync(0,buffer,bytes,buffer.length-bytes,null);if(!n)break;bytes+=n;assert(bytes<buffer.length);}
 const input=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(buffer.subarray(0,bytes))) as {mode:CurrentRuntimeMode;identity:unknown;password:string;key:string;digest:string};buffer.fill(0);
 assert.deepEqual(Object.keys(input).sort(),['digest','identity','key','mode','password']);assert(modes.includes(input.mode));assert(/^[a-f0-9]{48}$/.test(input.password)&&/^[a-f0-9]{64}$/.test(input.key));
 assert.equal(input.digest,NATIVE_CURRENT_RUNTIME_CANDIDATE_PROFILE.catalogSha256);
 const identity=validateStorageIdentity(input.identity),folder='/run/keryx-runtime',reader=folder+'/reader.json',application=folder+'/application.json',manifest=folder+'/storage.json';
 const credential=(role:string,password=input.password)=>canonicalJson({format:'keryx-postgres-role-credential-v1',role,password});
 writeFileSync(reader,credential('keryx_reader'),{mode:0o600});writeFileSync(application,credential('keryx_app'),{mode:0o600});
 writeFileSync(manifest,canonicalJson({format:'keryx-storage-deployment-v1',identity:input.mode==='wrong-identity'?{...identity,storageId:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'}:identity,backend:{kind:'postgres',database:'native_target',sourceDigest:input.mode==='wrong-source'?'00'.repeat(32):input.digest,endpoint:{kind:'loopback',port:5432},credentialPaths:{application,reader}}}),{mode:0o600});
 process.env.KERYX_STORAGE_MANIFEST=manifest;process.env.CONTENT_MASTER_KEY=input.mode==='wrong-key'?'ff'.repeat(32):input.key;
 process.env.KERYX_RUN_PRIVACY_ENABLED='true';process.env.KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED='true';process.env.KERYX_PUBLIC_PROFILES_ENABLED='true';
 let outbound=0;globalThis.fetch=async()=>{outbound++;throw Error('Synthetic current factory forbids vendor HTTP');};
 let appSql=0,readerSql=0,writeResponses=0,armed=false;
 const queryDescriptor=Object.getOwnPropertyDescriptor(Client.prototype,'query');assert(queryDescriptor&&typeof queryDescriptor.value==='function');
 Object.defineProperty(Client.prototype,'query',{...queryDescriptor,value:new Proxy(queryDescriptor.value,{apply(target,thisArg,args){
  const user=(thisArg as Client&{connectionParameters?:{user?:string}}).connectionParameters?.user;
  if(user==='keryx_app')appSql++;if(user==='keryx_reader')readerSql++;
  const result=Reflect.apply(target,thisArg,args),raw=args[0],sql=typeof raw==='string'?raw:raw&&typeof raw==='object'?Reflect.get(raw,'text'):'';
  if(user==='keryx_app'&&typeof sql==='string'&&sql.includes('public.storage_application_upsert_user(')){
   // The fixed write is one implicit-transaction SELECT. Mutate context AFTER
   // its actual driver response, without replacing SQL/results. A separate
   // owner connection below independently proves that the row was committed.
   return Promise.resolve(result).then(value=>{writeResponses++;if(armed){armed=false;process.env.CONTENT_MASTER_KEY='ee'.repeat(32);}return value;});
  }
  return result;
 }})});
 const storage=await import('../../lib/db/application-storage'),native=await import('../../lib/db/postgres/runtime-adapter');
 let checks=0;
 const factory=input.mode==='readonly'?storage.createReadonlyApplicationStorage:storage.createApplicationStorage;
 if(['wrong-identity','wrong-source','wrong-key','held-target'].includes(input.mode)){
  stage='factory-refusal';await assert.rejects(factory());checks++;
  console.log(JSON.stringify({passed:true,mode:input.mode,checks,outbound,genuineFactory:true,positiveWriterQualified:false}));return;
 }
 stage='canonical-zero-argument-factory';const db=await factory();assert(db);checks++;
 try{
  assert.deepEqual(await storage.applicationStorageIdentity(db),identity);checks++;
  await assert.rejects(native.assertPostgresRuntimeIdentity({...db}));checks++;
  const surface={mainnet:true,readOnly:input.mode==='readonly',privacyActive:true,claimsEnabled:true,publicProfilesActive:true};
  assert(Object.isFrozen(db)&&Object.getPrototypeOf(db)===null);checks++;
  for(const name of Object.keys(POSTGRES_SOURCE_METHOD_ACCESS))assert.equal(typeof Reflect.get(db,name),'function');checks++;
  for(const name of Object.keys(POSTGRES_SOURCE_PROPERTIES) as Array<keyof typeof POSTGRES_SOURCE_PROPERTIES>)assert.equal(Reflect.has(db,name),postgresSourcePropertyEnabled(name,surface));checks++;
  for(const name of POSTGRES_RUNTIME_STORE_NAMES)if(postgresSourcePropertyEnabled(name,surface)){const store:unknown=Reflect.get(db,name);assert(store&&typeof store==='object');assert.equal(store,Reflect.get(db,name));}checks++;
  if(input.mode==='readonly'){
   stage='readonly-role-and-write-refusal';await assert.rejects(storage.applicationStorageIdentity(db,'write'),/readonly_operation/);checks++;
   await assert.rejects(Promise.resolve().then(()=>db.upsertUser('0x'+'e2'.repeat(20),'asker')),/readonly_operation/);checks++;
   assert.equal(await db.getCached('synthetic-current-cache'),'Synthetic current-profile encrypted cache');checks++;
   assert.equal(appSql,0);assert(readerSql>0);checks++;
  }else{
   assert.deepEqual(await storage.applicationStorageIdentity(db,'write'),identity);storage.assertApplicationStorageCurrentLocal(db,'write');checks++;
   if(input.mode==='credential-change'){
    stage='credential-change-before-hostile-argument';const borrowed=db.upsertUser,baseline=appSql+readerSql;let getters=0;
    const hostile=new Proxy({},{get(){getters++;throw Error('Caller argument must not be inspected');}});
    writeFileSync(application,credential('keryx_app','00'.repeat(24)),{mode:0o600});
    await assert.rejects(Promise.resolve().then(()=>Reflect.apply(borrowed,undefined,[hostile,'asker'])));assert.equal(getters,0);assert.equal(appSql+readerSql,baseline);checks+=3;
    writeFileSync(application,credential('keryx_app'),{mode:0o600});
   }else if(input.mode==='committed-context-loss'){
    stage='actual-committed-write-context-loss';const baseline=writeResponses;armed=true;
    await assert.rejects(db.upsertUser('0x'+'e3'.repeat(20),'asker'),error=>error instanceof PostgresDomainWriteOutcomeUnknown);assert.equal(armed,false);assert.equal(writeResponses,baseline+1,'A submitted ambiguous write must not be retried');checks+=3;
    process.env.CONTENT_MASTER_KEY=input.key;
    // Fresh read is evidence only; it is never an automatic write retry.
    assert.equal((await db.getUser('0x'+'e3'.repeat(20)))?.walletAddress,'0x'+'e3'.repeat(20));checks++;
   }else{
    stage='writer-user-roundtrip';const wallet='0x'+'e1'.repeat(20),created=await db.upsertUser(wallet,'asker');assert.equal(created.created,true);assert.equal((await db.getUser(wallet))?.walletAddress,wallet);checks+=2;
    stage='writer-sync-roundtrip';
    await db.setSyncState('synthetic-current-key','line one\nline two');assert.equal(await db.getSyncState('synthetic-current-key'),'line one\nline two');assert.equal((await db.getSyncStates!(['synthetic-current-key'])).get('synthetic-current-key'),'line one\nline two');checks+=3;
    stage='writer-session-roundtrip';const now=Date.now(),session={hash:'e1'.repeat(32),wallet,issuedAt:now,expiresAt:now+60000};await db.createWebSession(session);assert.deepEqual(await db.getWebSession(session.hash),session);await db.revokeWebSession(session.hash,wallet);assert.equal(await db.getWebSession(session.hash),null);checks+=2;
    stage='writer-cache-roundtrip';
    assert.equal(await db.getCached('synthetic-current-cache'),'Synthetic current-profile encrypted cache');await db.setCached('synthetic-current-written-cache','Fresh native writer encrypted text');assert.equal(await db.getCached('synthetic-current-written-cache'),'Fresh native writer encrypted text');checks+=2;
    stage='writer-query-readers';assert.deepEqual(await db.listRecentQueries(1),[]);assert.equal(await db.getQueryRun('synthetic-current-missing'),null);assert.deepEqual(await db.listFollowUps('synthetic-current-missing'),[]);checks+=3;
    assert(appSql>0);assert.equal(readerSql,0);checks++;
   }
  }
  stage='canonical-disposal-and-borrowed-methods';const borrowed=db.getUser,nested=db.privateProfiles!.get;const sql=appSql+readerSql;let getters=0;const hostile=new Proxy({},{get(){getters++;throw Error('Disposed arguments must remain untouched');}});
  await native.closePostgresRuntimeAdapter(db);await assert.rejects(native.assertPostgresRuntimeIdentity(db));checks++;
  await assert.rejects(Promise.resolve().then(()=>Reflect.apply(borrowed,undefined,[hostile])));await assert.rejects(Promise.resolve().then(()=>Reflect.apply(nested,undefined,[hostile,hostile])));assert.equal(getters,0);assert.equal(appSql+readerSql,sql);checks+=4;
 }finally{await native.closePostgresRuntimeAdapter(db);Object.defineProperty(Client.prototype,'query',queryDescriptor);}
 assert.equal(outbound,0);process.env.CONTENT_MASTER_KEY='';input.key='';
 console.log(JSON.stringify({passed:true,mode:input.mode,checks,outbound,genuineFactory:true,positiveWriterQualified:input.mode==='success',currentProfileFactorySmokeOnly:true,completeApplicationQualification:false,productionChanged:false}));
}
void main().catch(error=>{const frames=error instanceof Error?(error.stack??'').split('\n').slice(1).map(line=>line.match(/\/child\.cjs:[0-9]+:[0-9]+/)?.[0]).filter(Boolean).slice(0,4):[];console.log(JSON.stringify({passed:false,stage,errorClass:error instanceof Error?error.constructor.name:'unknown',frames,productionChanged:false}));process.exitCode=1;});
