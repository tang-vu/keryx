/** Separate genuine Linux readonly-runtime profile. SOURCE identity and cache
 * expectations arrive from the immutable snapshot, never from target discovery. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync,readSync,readlinkSync,writeFileSync } from 'node:fs';
import { canonicalJson } from '../../lib/canonical-json';
import { validateStorageIdentity,storageIdentityDigest } from '../../lib/db/storage-identity';
import { NATIVE_READONLY_RUNTIME_PROFILE } from '../../lib/db/postgres/runtime-profile';
import { createPostgresRuntimeTransport } from '../../lib/db/postgres/runtime-transport';
import { openEnrolledCacheText } from '../../lib/sources/enrolled-content-cache';
import { createReadonlyApplicationStorage,closeReadonlyApplicationStorage } from '../../lib/db/application-storage';
import { assertPostgresRuntimeIdentity } from '../../lib/db/postgres/runtime-adapter';
let stage='containment';
async function main(){
 assert.equal(process.platform,'linux');assert.equal(process.version,'v24.22.1');assert.equal(process.getuid!(),0);assert.equal(process.ppid,1);
 for(const [name,expected] of [['memory.max','536870912'],['memory.swap.max','0'],['cpu.max','100000 100000'],['pids.max','64']])assert.equal(readFileSync('/sys/fs/cgroup/'+name,'utf8').trim(),expected);
 const status=readFileSync('/proc/self/status','utf8');assert(/^NoNewPrivs:\s+1$/m.test(status)&&/^CapEff:\s+0+$/m.test(status));assert.equal(readFileSync('/proc/net/route','utf8').trim().split('\n').length,1);
 assert.equal(readlinkSync('/proc/1/exe'),'/usr/bin/timeout');assert.deepEqual(process.argv.slice(2),['--cold']);
 assert.deepEqual(readFileSync('/proc/1/cmdline','utf8').split('\0').filter(Boolean),['/usr/bin/timeout','--signal=KILL','180s','node','--no-warnings','--max-old-space-size=256','/cold.cjs','--cold']);
 const buffer=Buffer.alloc(32769);let bytes=0;for(;;){const n=readSync(0,buffer,bytes,buffer.length-bytes,null);if(!n)break;bytes+=n;assert(bytes<buffer.length);}
 const input=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(buffer.subarray(0,bytes))) as {identity:unknown;password:string;key:string;cache:{rows:number;authenticatedRows:number;nullRows:number;envelopeBytes:number;plaintextBytes:number;sourceIdentityDigest:string;keyFingerprint:string;projectionDigest:string}};buffer.fill(0);
 assert.deepEqual(Object.keys(input).sort(),['cache','identity','key','password']);assert(/^[a-f0-9]{48}$/.test(input.password)&&/^[a-fA-F0-9]{64}$/.test(input.key));
 const identity=validateStorageIdentity(input.identity),cache=input.cache;assert.equal(storageIdentityDigest(identity),cache.sourceIdentityDigest);assert(cache.authenticatedRows>0&&cache.rows===cache.authenticatedRows&&cache.nullRows===0);
 assert.equal(createHash('sha256').update(Buffer.from(input.key,'hex')).digest('hex'),cache.keyFingerprint);
 const folder='/run/keryx-runtime',reader=folder+'/reader.json',application=folder+'/application.json',manifest=folder+'/storage.json';
 for(const [path,role] of [[reader,'keryx_reader'],[application,'keryx_app']])writeFileSync(path,canonicalJson({format:'keryx-postgres-role-credential-v1',role,password:input.password}),{mode:0o600});
 writeFileSync(manifest,canonicalJson({format:'keryx-storage-deployment-v1',identity,backend:{kind:'postgres',database:'native_materialized',sourceDigest:NATIVE_READONLY_RUNTIME_PROFILE.catalogSha256,endpoint:{kind:'loopback',port:5432},credentialPaths:{application,reader}}}),{mode:0o600});
 process.env.KERYX_STORAGE_MANIFEST=manifest;process.env.KERYX_RUN_PRIVACY_ENABLED='true';process.env.KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED='true';process.env.KERYX_PUBLIC_PROFILES_ENABLED='true';
 let outbound=0;globalThis.fetch=async()=>{outbound++;throw Error('Materialized cold qualification forbids outbound HTTP');};
 stage='wrong-key-factory';process.env.CONTENT_MASTER_KEY=(input.key.startsWith('ff')?'00':'ff')+input.key.slice(2);
 await assert.rejects(async()=>{const value=await createReadonlyApplicationStorage();if(value)await closeReadonlyApplicationStorage(value);});
 stage='original-key-cold-factory';process.env.CONTENT_MASTER_KEY=input.key;const facade=await createReadonlyApplicationStorage();assert(facade);
 try{
  assert.equal(canonicalJson(await assertPostgresRuntimeIdentity(facade)),canonicalJson(identity));
  stage='source-ciphertext-and-plaintext-fidelity';const transport=createPostgresRuntimeTransport({endpoint:{kind:'loopback',port:5432},database:'native_materialized',role:'keryx_reader',password:input.password},identity,NATIVE_READONLY_RUNTIME_PROFILE.catalogSha256,true,true);
  try{
   const actual=await transport.readColdCache(),digest=createHash('sha256');let plaintextBytes=0;
   for(const row of actual.cacheRows){const plaintext=openEnrolledCacheText(row.text,row.sourceId,identity);assert(typeof plaintext==='string');plaintextBytes+=Buffer.byteLength(plaintext);digest.update(JSON.stringify([row.sourceId,createHash('sha256').update(row.text).digest('hex'),createHash('sha256').update(plaintext).digest('hex')])).update('\n');}
   assert.equal(actual.cacheRowCount,cache.authenticatedRows);assert.equal(actual.cacheWireBytes,cache.envelopeBytes);assert.equal(plaintextBytes,cache.plaintextBytes);assert.equal(digest.digest('hex'),cache.projectionDigest);
  }finally{await transport.close();}
 }finally{await closeReadonlyApplicationStorage(facade);}
 stage='terminal-disposal';await assert.rejects(assertPostgresRuntimeIdentity(facade));assert.equal(outbound,0);delete process.env.CONTENT_MASTER_KEY;input.key='';
 console.log(JSON.stringify({format:'keryx-native-materialized-cold-factory-v1',passed:true,genuineZeroArgumentReadonlyFactory:true,sourceLogicalIdentityPreserved:true,sourceCiphertextAndPlaintextDigestsEqual:true,authenticatedRows:cache.authenticatedRows,plaintextBytes:cache.plaintextBytes,sourceIdentityDigest:cache.sourceIdentityDigest,keyFingerprint:cache.keyFingerprint,projectionDigest:cache.projectionDigest,wrongKeyFactoryRefused:true,actualTerminalDrain:true,outbound,plaintextDisclosed:false,rawKeyDisclosed:false,completeApplicationWriterQualified:false,productionChanged:false,applicationBackendSwitched:false}));
}
void main().catch(()=>{console.log(JSON.stringify({format:'keryx-native-materialized-cold-factory-v1',passed:false,stage,productionChanged:false}));process.exitCode=1;});
