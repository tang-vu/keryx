/** Fresh-process genuine SQLite oracle for one synthetic native-runtime fixture.
 * No PostgreSQL authority, payment observation, signer or factory proof issuer. */
import assert from 'node:assert/strict';
import { readSync } from 'node:fs';
import { isAbsolute,resolve } from 'node:path';

const buffer=Buffer.alloc(16385);let bytes=0;
while(bytes<buffer.length){const n=readSync(0,buffer,bytes,buffer.length-bytes,null);if(!n)break;bytes+=n;}
assert(bytes>0&&bytes<=16384,'Synthetic Source oracle input bound');
const input:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,bytes)));
assert(input&&typeof input==='object'&&!Array.isArray(input));
assert.equal(Object.keys(input).sort().join(','),'format,identity,key,manifestPath,original,owner');
const value=input as {format:unknown;identity:unknown;key:unknown;manifestPath:unknown;original:unknown;owner:unknown};
assert.equal(value.format,'keryx-native-runtime-source-oracle-v1');
assert(typeof value.manifestPath==='string'&&value.manifestPath.length<=2048&&isAbsolute(value.manifestPath)&&resolve(value.manifestPath)===value.manifestPath);
assert(typeof value.key==='string'&&/^[a-f0-9]{64}$/.test(value.key));
assert(typeof value.owner==='string'&&/^0x[a-f0-9]{40}$/.test(value.owner));
assert(typeof value.original==='string'&&Buffer.byteLength(value.original)<=8192);
assert.equal(process.versions.node,'24.22.1');

// Set the one process-lifetime manifest and Source profile before app imports.
// Mainnet's offline bypass remains forbidden; all outbound HTTP is trapped.
process.env.KERYX_NETWORK='arc';process.env.NEXT_PUBLIC_KERYX_NETWORK='arc';process.env.KERYX_FORCE_OFFLINE='0';
process.env.KERYX_STORAGE_MANIFEST=value.manifestPath;process.env.CONTENT_MASTER_KEY=value.key;process.env.BASE_URL='https://keryx.cc';
for(const name of ['KERYX_RUN_PRIVACY_ENABLED','KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED','KERYX_PUBLIC_PROFILES_ENABLED'])process.env[name]='true';
for(const name of ['KERYX_REGISTRY_ADDRESS','NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS','KERYX_REGISTRY_READ_ADDRESS','NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS'])process.env[name]='0x'+'55'.repeat(20);
for(const name of ['AGENT_FUNDER_PRIVATE_KEY','BUYER_PRIVATE_KEY','DEPLOYER_PRIVATE_KEY','KERYX_PRIVATE_TREASURY_PRIVATE_KEY','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','KERYX_REGISTRY_ORIGINS','NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS'])process.env[name]='';
for(const name of ['KERYX_SQLITE_PATH','KERYX_USDC_ADDRESS','KERYX_GATEWAY_WALLET','KERYX_GATEWAY_MINTER','KERYX_MAX_TIMEOUT_SECONDS'])delete process.env[name];
let outbound=0;globalThis.fetch=async()=>{outbound++;throw Error('Synthetic Source oracle forbids outbound HTTP');};

const {canonicalJson}=await import('../../lib/canonical-json'),{validateStorageIdentity}=await import('../../lib/db/storage-identity');
const identity=validateStorageIdentity(value.identity);assert.equal(identity.authorityMode,'mainnet-real');assert.equal(identity.network,'eip155:5042');
const original=JSON.parse(value.original);assert.equal(original.id,'synthetic-runtime-run');assert.equal(original.parentId,'synthetic-runtime-parent');assert.equal(original.asker,value.owner);
const {inspectStorageDeploymentManifest}=await import('../../lib/db/runtime-storage-config');
const deployment=inspectStorageDeploymentManifest(process.env);assert.equal(deployment.backend.kind,'sqlite');assert.equal(canonicalJson(deployment.identity),canonicalJson(identity));
const {createReadonlyApplicationStorage,applicationStorageIdentity,closeReadonlyApplicationStorage}=await import('../../lib/db/application-storage');
const reader=await createReadonlyApplicationStorage();assert(reader);let queryReads:{projected:unknown;sourceHistory:unknown}|undefined;
try{
 assert.equal(canonicalJson(await applicationStorageIdentity(reader,'read')),canonicalJson(identity));
 await assert.rejects(()=>applicationStorageIdentity(reader,'write'));
 const projected=await reader.getQueryRun(original.id);assert(projected);assert.notEqual(projected.answer,original.answer);
 const equal=(rows:unknown)=>assert.equal(canonicalJson(rows),canonicalJson([projected]));
 equal(await reader.listRecentQueries(1));equal(await reader.listQueryRunsByAsker(value.owner,1));equal(await reader.listFollowUps(original.parentId));
 const streamed=[];for await(const row of reader.iterateRecentQueries(1))streamed.push(row);equal(streamed);
 const privacy=reader.runPrivacy;assert(privacy?.sourceHistory);
 assert.equal(canonicalJson((await privacy.read(projected.id)).item!.run),canonicalJson(projected));
 const owned=await privacy.owner(projected.id,{wallet:value.owner,binding:{network:identity.network,origin:'https://keryx.cc'}});assert(owned);assert.equal(canonicalJson(owned.run),canonicalJson(original));
 queryReads={projected:JSON.parse(JSON.stringify(projected)),sourceHistory:await privacy.sourceHistory()};
 assert.equal(canonicalJson(await applicationStorageIdentity(reader,'read')),canonicalJson(identity));
 assert.equal(outbound,0);
}finally{await closeReadonlyApplicationStorage(reader);}
await assert.rejects(()=>applicationStorageIdentity(reader,'read'));
const output=JSON.stringify({format:'keryx-native-runtime-source-oracle-v1',identity,queryReads,outbound});
assert(Buffer.byteLength(output)<=16384,'Synthetic Source oracle result bound');process.stdout.write(output+'\n');
