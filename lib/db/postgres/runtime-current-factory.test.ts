/** Recording I/O tests only. The platform/manifest/credential/pg fixtures below
 * do NOT qualify Linux, PostgreSQL, a retained intake, installed authority, or
 * the complete writer. Only actual zero-argument factories touch their WeakMap. */
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { createHash,randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { config } from '../../config';
import { ARC_MAINNET_PROFILE,ARC_TESTNET_PROFILE } from '../../arc-network-profile';
import type { KeryxDB } from '../keryx-db';
import type { QueryRun } from '../../types';
import type { StorageDeploymentManifest,PostgresStorageBackend } from '../runtime-storage-config';
import { STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity } from '../storage-identity';
const state=vi.hoisted(()=>({
 readDeployment:vi.fn(),readCredential:vi.fn(),acquire:vi.fn(),query:vi.fn(),release:vi.fn(),end:vi.fn(),fetch:vi.fn(),
 manifest:undefined as Readonly<StorageDeploymentManifest>|undefined,
 fixtureDigest:'',observedIdentity:undefined as Readonly<StorageIdentity>|undefined,credentialVersion:0,profileFailure:false,
 cacheRows:[] as {sourceId:string;text:string}[],pools:[] as Record<string,unknown>[],clients:[] as EventEmitter[],
}));
vi.mock('../runtime-storage-config',()=>({readRuntimeStorageDeployment:state.readDeployment}));
vi.mock('./private-credential',()=>({readPrivatePostgresCredential:state.readCredential}));
vi.mock('pg',()=>({Pool:class{
 constructor(options:Record<string,unknown>){state.pools.push(options);}
 on(){return this;}
 async connect(){await state.acquire();const client=Object.assign(new EventEmitter(),{query:state.query,release:state.release});state.clients.push(client);return client;}
 end(){return state.end();}
},types:{getTypeParser:()=>((wire:string)=>wire)}}));
import { NATIVE_CURRENT_RUNTIME_CANDIDATE_PROFILE as candidate,NATIVE_CURRENT_DATA_INTAKE_PROFILE as data,NATIVE_READONLY_RUNTIME_PROFILE as observation } from './runtime-profile';
import { createPostgresRuntimeAdapter,createReadonlyPostgresRuntimeAdapter,assertPostgresRuntimeIdentity,assertPostgresRuntimeCurrentLocal,closePostgresRuntimeAdapter } from './runtime-adapter';
import { PostgresDomainWriteOutcomeUnknown } from './domain-channel';
import { PostgresStorageUnavailable } from './connection';
import { sealEnrolledCacheText } from '../../sources/enrolled-content-cache';
import { POSTGRES_SOURCE_METHOD_ACCESS } from './runtime-surface';

const platformDescriptor=Object.getOwnPropertyDescriptor(process,'platform')!;
const configurationKeys=['profile','network','networkId','chainId','rpcUrl','usdcAddress','gatewayWallet','baseUrl','sellerAddress'] as const;
const originalConfiguration=Object.fromEntries(configurationKeys.map(name=>[name,config[name]]));
const opened:KeryxDB[]=[];
const owner='0x'+'ab'.repeat(20),monthly='monthly_'+'11'.repeat(32);
const run=():QueryRun=>({id:'synthetic-current-factory',createdAt:'2026-11-15T00:00:00.000Z',question:'Synthetic question',answer:'Synthetic answer',engine:'heuristic',budget:0,totalSpent:0,totalToCreators:0,subClaims:[],decisions:[],citations:[],trace:[]});
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};};
const response=(value:unknown)=>({rows:[[JSON.stringify(value)]],fields:[{name:'result',dataTypeID:3802}]});
function manifest(digest=candidate.catalogSha256):Readonly<StorageDeploymentManifest>{
 const identity:Readonly<StorageIdentity>=Object.freeze({format:'keryx-mainnet-storage-identity-v1',network:'eip155:5042',authorityMode:'mainnet-real',deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:'2026-11-15T00:00:00.000Z',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,provenanceDigest:'ab'.repeat(32)});
 const backend:PostgresStorageBackend=Object.freeze({kind:'postgres',database:'native_target',sourceDigest:digest,endpoint:Object.freeze({kind:'loopback',port:5432}),credentialPaths:Object.freeze({application:'/run/synthetic/application.json',reader:'/run/synthetic/reader.json'})});
 return Object.freeze({format:'keryx-storage-deployment-v1',identity,backend});
}
function reply(query:unknown){
 if(typeof query==='string')return {};
 const statement=query as {text:string;values:unknown[]},identity=state.observedIdentity??state.manifest!.identity;
 if(statement.text.includes('storage_native_runtime_authority'))return response({identity,sourceDigest:state.fixtureDigest});
 if(statement.text.includes('storage_native_runtime_cold_read'))return response({format:'keryx-native-storage-cold-read-v1',identity,sourceDigest:state.fixtureDigest,cacheRows:state.cacheRows,cacheRowCount:state.cacheRows.length,cacheWireBytes:state.cacheRows.reduce((n,row)=>n+Buffer.byteLength(row.text),0)});
 if(statement.text.includes('storage_research_purchases'))return response(null);
 if(statement.text.includes('storage_publication_save')){
  const packet=JSON.parse(statement.values[2] as string);return response({id:packet.row.id,originalSha256:createHash('sha256').update(Buffer.from(packet.originalHex,'hex')).digest('hex')});
 }
 if(statement.text.includes('storage_private_profile_get')&&state.profileFailure)return response({profile:null,activity:{firstSeenAt:null,questions:1,surfacesUsed:['web\0tail'],topics:[],creatorsPaid:0,scope:'attributed-current-store',network:identity.network}});
 throw Error('Unrecorded fixed operation');
}
async function open(readOnly=false){const facade=await(readOnly?createReadonlyPostgresRuntimeAdapter():createPostgresRuntimeAdapter());opened.push(facade);return facade;}
beforeEach(()=>{
 vi.clearAllMocks();Object.defineProperty(process,'platform',{...platformDescriptor,value:'linux'});
 Object.assign(config,{profile:ARC_MAINNET_PROFILE,network:ARC_MAINNET_PROFILE.name,networkId:ARC_MAINNET_PROFILE.networkId,chainId:ARC_MAINNET_PROFILE.chainId,rpcUrl:'http://127.0.0.1:9',usdcAddress:ARC_MAINNET_PROFILE.usdcAddress,gatewayWallet:ARC_MAINNET_PROFILE.gatewayWallet,baseUrl:'https://synthetic.invalid',sellerAddress:owner});
 for(const [key,value] of Object.entries({KERYX_STORAGE_MANIFEST:'/run/synthetic/storage.json',CONTENT_MASTER_KEY:'11'.repeat(32),KERYX_FORCE_OFFLINE:'0',KERYX_RUN_PRIVACY_ENABLED:'true',KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED:'true',KERYX_PUBLIC_PROFILES_ENABLED:'true'}))vi.stubEnv(key,value);
 state.manifest=manifest();state.fixtureDigest=candidate.catalogSha256;state.observedIdentity=undefined;state.credentialVersion=0;state.profileFailure=false;state.pools.length=0;state.clients.length=0;
 state.cacheRows=[{sourceId:'synthetic-cache',text:sealEnrolledCacheText('Synthetic cold cache','synthetic-cache',state.manifest.identity)}];
 state.readDeployment.mockImplementation(()=>state.manifest);
 state.readCredential.mockImplementation((path:string,role:string)=>{
  const backend=state.manifest!.backend as PostgresStorageBackend;
  if(path!==(role==='keryx_app'?backend.credentialPaths.application:backend.credentialPaths.reader)||!['keryx_app','keryx_reader'].includes(role))throw new PostgresStorageUnavailable();
  return {password:'synthetic-recording-only-password',fingerprint:createHash('sha256').update(role+state.credentialVersion).digest('hex')};
 });
 state.acquire.mockResolvedValue(undefined);state.query.mockImplementation(async(query:unknown)=>reply(query));state.release.mockReset();state.end.mockResolvedValue(undefined);
 state.fetch.mockImplementation(()=>{throw Error('Recording factory must not use HTTP');});vi.stubGlobal('fetch',state.fetch);
});
afterEach(async()=>{
 for(const facade of opened.splice(0))await closePostgresRuntimeAdapter(facade).catch(()=>{});
 Object.defineProperty(process,'platform',platformDescriptor);Object.assign(config,originalConfiguration);vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();
});

describe('unmerged current-profile zero-argument factory recording boundaries',()=>{
 it('keeps the current runtime candidate distinct from the unapproved DATA artifact and505 reader',()=>{
  expect(candidate).not.toBe(data);expect(candidate.format).toBe('keryx-native-postgres-current-runtime-candidate-v1');expect(candidate.catalogSha256).toBe(data.catalogSha256);expect(candidate.sourceSqlSha256).toBe(data.sourceSqlSha256);expect(candidate.localUnmergedCandidate).toBe(true);expect(candidate.applicationFactoryApproved).toBe(false);expect(candidate.fullWriterQualified).toBe(false);expect(candidate.genuineColdFactoryQualified).toBe(false);expect(observation.catalogSha256).toBe('3c6074ffdd9c2effc5fc59d09d650c643902e6238d8424fd37d5ee08e9b4580a');
 });
 it('records construction through real transport/Core/facade and only the factory private registry',async()=>{
  const facade=await open();expect(Object.keys(facade).sort()).toEqual(Object.keys(POSTGRES_SOURCE_METHOD_ACCESS).sort());expect(state.pools).toHaveLength(1);expect(state.pools[0].user).toBe('keryx_app');expect(state.readCredential.mock.calls.every(([,role])=>role==='keryx_app')).toBe(true);
  expect(await assertPostgresRuntimeIdentity(facade,'write')).toEqual(state.manifest!.identity);expect(()=>assertPostgresRuntimeCurrentLocal(facade,'write')).not.toThrow();
  for(const fake of [{},new Proxy(facade,{})])await expect(assertPostgresRuntimeIdentity(fake,'write')).rejects.toThrow('adapter_not_initialized');
  expect(state.fetch).not.toHaveBeenCalled();expect(state.clients.every(client=>client.listenerCount('error')===0)).toBe(true);
 });
 it('keeps the current reader on reader credentials and refuses writes before caller fields',async()=>{
  const facade=await open(true);expect(state.pools[0].user).toBe('keryx_reader');expect(state.readCredential.mock.calls.every(([,role])=>role==='keryx_reader')).toBe(true);expect(await assertPostgresRuntimeIdentity(facade)).toEqual(state.manifest!.identity);
  await expect(assertPostgresRuntimeIdentity(facade,'write')).rejects.toThrow('readonly_operation');expect(()=>assertPostgresRuntimeCurrentLocal(facade,'write')).toThrow('readonly_operation');let fields=0;const raw=new Proxy({},{get(){fields++;throw Error('Caller fields');}});state.query.mockClear();await expect(facade.saveQueryRun(raw as QueryRun)).rejects.toThrow('readonly_operation');expect(fields).toBe(0);expect(state.query).not.toHaveBeenCalled();
 });
 it('preserves the separate505 reader and refuses that digest for the application writer',async()=>{
  state.manifest=manifest(observation.catalogSha256);state.fixtureDigest=observation.catalogSha256;state.cacheRows=[];
  await expect(createPostgresRuntimeAdapter()).rejects.toThrow('adapter_not_initialized');expect(state.pools).toHaveLength(0);
  const reader=await open(true);expect(await assertPostgresRuntimeIdentity(reader)).toEqual(state.manifest.identity);await expect(assertPostgresRuntimeIdentity(reader,'write')).rejects.toThrow('readonly_operation');expect(state.pools[0].user).toBe('keryx_reader');
 });
 it.each(['unknown-digest','historical','platform','profile'] as const)('refuses %s construction before credentials or a pool',async fault=>{
  if(fault==='unknown-digest')state.manifest=manifest('00'.repeat(32));else if(fault==='historical')state.manifest={...state.manifest!,identity:{...state.manifest!.identity,authorityMode:'testnet-real'}};else if(fault==='platform')Object.defineProperty(process,'platform',{...platformDescriptor,value:'win32'});else Object.assign(config,{profile:ARC_TESTNET_PROFILE});
  await expect(createPostgresRuntimeAdapter()).rejects.toThrow();expect(state.readCredential).not.toHaveBeenCalled();expect(state.pools).toHaveLength(0);
 });
 it('keeps an unselected mainnet writer closed before manifest I/O',async()=>{vi.stubEnv('KERYX_STORAGE_MANIFEST',undefined);await expect(createPostgresRuntimeAdapter()).rejects.toThrow('adapter_not_initialized');expect(state.readDeployment).not.toHaveBeenCalled();expect(state.pools).toHaveLength(0);});
 it('refuses missing private credential or cache key before a pool is created',async()=>{
  state.readCredential.mockImplementationOnce(()=>{throw new PostgresStorageUnavailable();});await expect(createPostgresRuntimeAdapter()).rejects.toThrow('PostgreSQL storage unavailable');expect(state.pools).toHaveLength(0);
  vi.stubEnv('CONTENT_MASTER_KEY','');await expect(createPostgresRuntimeAdapter()).rejects.toThrow('cache_migration_required');expect(state.pools).toHaveLength(0);
 });
 it('refuses a wrong cache key and drains setup without returning a facade',async()=>{
  vi.stubEnv('CONTENT_MASTER_KEY','22'.repeat(32));await expect(createPostgresRuntimeAdapter()).rejects.toThrow();expect(state.pools).toHaveLength(1);expect(state.end).toHaveBeenCalledTimes(1);
 });
 it('rejects a foreign observed identity and independently mismatched catalog reply',async()=>{
  state.observedIdentity={...state.manifest!.identity,storageId:randomUUID()};await expect(createPostgresRuntimeAdapter()).rejects.toThrow();expect(state.end).toHaveBeenCalledTimes(1);
  state.observedIdentity=undefined;state.fixtureDigest='00'.repeat(32);await expect(createPostgresRuntimeAdapter()).rejects.toThrow();expect(state.end).toHaveBeenCalledTimes(2);
 });
 it('rechecks credential fingerprint after checkout and does not dispatch setup SQL after a queued change',async()=>{
  state.acquire.mockImplementationOnce(async()=>{state.credentialVersion++;});await expect(createPostgresRuntimeAdapter()).rejects.toThrow();expect(state.query).not.toHaveBeenCalled();expect(state.release).toHaveBeenCalledExactlyOnceWith(true);expect(state.end).toHaveBeenCalledTimes(1);
 });
 it.each(['credential','key','flags','configuration','manifest'] as const)('rejects current %s changes before business SQL',async fault=>{
  const facade=await open(),read=facade.getResearchMonthly;state.query.mockClear();
  if(fault==='credential')state.credentialVersion++;else if(fault==='key')vi.stubEnv('CONTENT_MASTER_KEY','22'.repeat(32));else if(fault==='flags')vi.stubEnv('KERYX_RUN_PRIVACY_ENABLED','false');else if(fault==='configuration')Object.assign(config,{baseUrl:'https://changed.invalid'});else state.manifest={...state.manifest!,identity:{...state.manifest!.identity,provenanceDigest:'cd'.repeat(32)}};
  await expect(read(monthly)).rejects.toThrow();expect(state.query).not.toHaveBeenCalled();
 });
 it('keeps a queued write unavailable rather than unknown and never dispatches or retries it',async()=>{
  const facade=await open(),wait=deferred<void>();state.query.mockClear();state.acquire.mockClear();state.release.mockClear();state.acquire.mockReturnValueOnce(wait.promise);const pending=facade.saveQueryRun(run());await vi.waitFor(()=>expect(state.acquire).toHaveBeenCalledTimes(1));state.credentialVersion++;wait.resolve();
  let failure:unknown;try{await pending;}catch(error){failure=error;}expect(failure).toBeInstanceOf(PostgresStorageUnavailable);expect(failure).not.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);expect(state.query).not.toHaveBeenCalled();expect(state.release).toHaveBeenCalledExactlyOnceWith(true);
 });
 it('keeps an already-dispatched publication unknown when context changes before its ACK',async()=>{
  const facade=await open(),wait=deferred<unknown>();state.query.mockClear();state.query.mockImplementationOnce(()=>wait.promise);const pending=facade.saveQueryRun(run());await vi.waitFor(()=>expect(state.query).toHaveBeenCalledTimes(1));const statement=state.query.mock.calls[0][0];state.credentialVersion++;wait.resolve(reply(statement));await expect(pending).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);expect(state.query).toHaveBeenCalledTimes(1);
 });
 it('does not retry an unknown acknowledgement and keeps canonical drain idempotent',async()=>{
  const facade=await open();state.query.mockClear();state.query.mockRejectedValueOnce(Error('Recorded connection ACK loss'));await expect(facade.saveQueryRun(run())).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);expect(state.query.mock.calls.filter(([query])=>typeof query!=='string'&&(query as {text:string}).text.includes('storage_publication_save'))).toHaveLength(1);expect(state.query.mock.calls.every(([query])=>typeof query==='string'||/storage_publication_save|storage_native_runtime_authority/.test((query as {text:string}).text))).toBe(true);const first=closePostgresRuntimeAdapter(facade),second=closePostgresRuntimeAdapter(facade);expect(first).toBe(second);await first;expect(state.end).toHaveBeenCalledTimes(1);await expect(assertPostgresRuntimeIdentity(facade,'write')).rejects.toThrow('adapter_not_initialized');
 });
 it('retires the facade/Core and acquired top/nested methods when a strict sibling closes the shared channel',async()=>{
  const facade=await open(),save=facade.saveQueryRun,profile=facade.privateProfiles!.get,close=(facade as KeryxDB&{close:()=>Promise<void>}).close;state.profileFailure=true;
  await expect(profile(owner,state.manifest!.identity.network)).rejects.toThrow();await expect(assertPostgresRuntimeIdentity(facade)).rejects.toThrow('adapter_not_initialized');state.query.mockClear();let fields=0;const raw=new Proxy({},{get(){fields++;throw Error('Caller fields');}});await expect(save(raw as QueryRun)).rejects.toThrow('adapter_not_initialized');await expect(profile(raw as never,raw as never)).rejects.toThrow();expect(fields).toBe(0);expect(state.query).not.toHaveBeenCalled();await close();expect(state.end).toHaveBeenCalledTimes(1);
 });
 it('drains a failure during private registration/sponsor setup instead of publishing a partial factory',async()=>{
  let authorityReads=0;state.query.mockImplementation(async(query:unknown)=>{if(typeof query!=='string'&&(query as {text:string}).text.includes('storage_native_runtime_authority')&&++authorityReads===4)throw Error('Recorded sponsor-stage authority failure');return reply(query);});
  await expect(createPostgresRuntimeAdapter()).rejects.toThrow();expect(authorityReads).toBe(4);expect(state.end).toHaveBeenCalledTimes(1);expect(state.fetch).not.toHaveBeenCalled();
 });
});
