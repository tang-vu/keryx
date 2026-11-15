import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { createHash,randomUUID } from "node:crypto";
import { STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity } from "./storage-identity";
const state=vi.hoisted(()=>({sdk:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:state.sdk}));
import { assembleNativePostgresBusinessCore,type NativePostgresBusinessCoreOptions } from "./supabase-adapter";
import { composePostgresPublication } from "./postgres/publication-transport";
import { composePostgresResearchPurchases } from "./postgres/research-purchases-transport";
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from "./postgres/domain-channel";
import { assertPostgresRuntimeIdentity } from "./postgres/runtime-adapter";
import type { QueryRun } from "../types";
import { storageDomainClient,callSupabaseDomain,type StorageDomainAuthority } from "./supabase-authority";
import { assertEnrolledSupabaseAuthority } from "./enrolled-supabase-adapter";
import { assertEnrolledSqliteAdapter } from "./enrolled-sqlite-adapter";
import * as contentCrypto from '../ipfs/content-crypto';
import { sealEnrolledCacheText } from '../sources/enrolled-content-cache';

const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',network:'eip155:5042',authorityMode:'mainnet-real',deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:'2026-11-12T00:00:00.000Z',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,provenanceDigest:'11'.repeat(32)};
type DomainResult=Awaited<ReturnType<StorageDomainAuthority["rpcResult"]>>;
function fixture(options:Partial<NativePostgresBusinessCoreOptions>={}){
 const rpc=vi.fn(async():Promise<DomainResult>=>({data:null,error:null}));
 const authority:StorageDomainAuthority={rpcResult:rpc};
 const verify=vi.fn(async()=>{}),entry=vi.fn();
 const core=assembleNativePostgresBusinessCore({identity,authority:{...authority,domainClient:()=>storageDomainClient(authority)},assertEntry:entry,verify,...options});
 return {...core,rpc,verify,entry,authority};
}
beforeEach(()=>{vi.clearAllMocks();state.sdk.mockImplementation(()=>{throw new Error('SDK construction is forbidden in native assembly');});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
describe('native PostgreSQL shared business-code assembly',()=>{
 it('initializes through its native guard without constructing a Supabase client or ordinary optional ports',async()=>{
  const f=fixture();await expect(f.adapter.getSource('synthetic')).rejects.toThrow();await f.adapter.init();expect(f.verify).toHaveBeenCalledTimes(1);expect(state.sdk).not.toHaveBeenCalled();
  expect(f.adapter.privateProfiles).toBeUndefined();expect(f.adapter.runClaims).toBeUndefined();expect(f.adapter.personalHistory).toBeUndefined();
  expect(await f.adapter.listAllSources()).toEqual([]);expect(f.rpc).toHaveBeenCalledWith('list_all_sources',{});
 });
 it('does not give assembled callbacks or a typed object installed backend provenance',async()=>{
  const f=fixture();await f.adapter.init();await expect(assertEnrolledSupabaseAuthority(f.adapter)).rejects.toThrow();expect(()=>assertEnrolledSqliteAdapter(f.adapter)).toThrow();
 });
 it('registers a native helper port without allowing its legacy table closure',async()=>{
  const f=fixture(),legacy=vi.fn();await f.adapter.init();await callSupabaseDomain(storageDomainClient(f.authority),'get_user',{p_wallet_address:'synthetic'},legacy);
  expect(legacy).not.toHaveBeenCalled();expect(f.rpc).toHaveBeenCalledWith('get_user',{p_wallet_address:'synthetic'});
 });
 it('does not fall back after a native domain failure',async()=>{
  const f=fixture();await f.adapter.init();f.rpc.mockRejectedValue(new Error('native domain unavailable'));await expect(f.adapter.listAllSources()).rejects.toThrow('native domain unavailable');expect(state.sdk).not.toHaveBeenCalled();
 });
 it('keeps close terminal across initialization and already-dispatched results',async()=>{
  const f=fixture();await f.adapter.init();let finish!:(v:DomainResult)=>void;
  f.rpc.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const request=f.adapter.getSource('synthetic'),outcome=expect(request).rejects.toThrow();f.hooks.close();finish({data:null,error:null});await outcome;
  await expect(f.adapter.init()).rejects.toThrow();await expect(f.hooks.verify()).rejects.toThrow();
 });
 it('requires identity-bound encrypted caches in the native core',async()=>{
  vi.stubEnv('CONTENT_MASTER_KEY','11'.repeat(32));const f=fixture();await f.adapter.init();f.rpc.mockResolvedValue({data:{text:'unbound legacy plaintext'},error:null});
  await expect(f.adapter.getCached('synthetic')).rejects.toThrow();
 });
 it('waits for a native API-key audit before publishing authentication',async()=>{
  const f=fixture();await f.adapter.init();const hash='12'.repeat(32);let finish!:(v:DomainResult)=>void,returned=false;
  f.rpc.mockImplementation(async(name?:unknown)=>name==='verify_api_key'?{data:{id:'synthetic',key_hash:hash,wallet:'wallet',scopes:'read',source_ids:null},error:null}:await new Promise<DomainResult>(resolve=>{finish=resolve;}));
  const request=f.adapter.verifyApiKey('synthetic',hash).then(value=>{returned=true;return value;});await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));expect(returned).toBe(false);finish({data:null,error:null});expect((await request)?.keyId).toBe('synthetic');
 });
 it('surfaces native API-key audit failure without an unhandled background write',async()=>{
  const f=fixture();await f.adapter.init();const hash='12'.repeat(32);
  f.rpc.mockImplementation(async(name?:unknown)=>{if(name==='verify_api_key')return {data:{id:'synthetic',key_hash:hash,wallet:'wallet'},error:null};throw new Error('native audit unavailable');});
  await expect(f.adapter.verifyApiKey('synthetic',hash)).rejects.toThrow('native audit unavailable');
 });
 it('uses one native dashboard observation and never falls back to whole-table scans',async()=>{
  const f=fixture();await f.adapter.init();const observation={totalQueries:123};f.rpc.mockResolvedValue({data:observation,error:null});
  expect(await f.adapter.metrics()).toBe(observation);expect(f.rpc).toHaveBeenCalledExactlyOnceWith('dashboard_metrics',{});expect(state.sdk).not.toHaveBeenCalled();
  f.rpc.mockRejectedValue(new Error('native report unavailable'));await expect(f.adapter.metrics()).rejects.toThrow('native report unavailable');
 });
it('checks fresh native authority before opening cached ciphertext',async()=>{
 vi.stubEnv('CONTENT_MASTER_KEY','11'.repeat(32));const ciphertext=sealEnrolledCacheText('Synthetic private cache','synthetic',identity),f=fixture();await f.adapter.init();
 f.rpc.mockResolvedValue({data:{text:ciphertext},error:null});f.verify.mockRejectedValueOnce(new Error('native authority held'));
 const decrypt=vi.spyOn(contentCrypto,'decryptContent');await expect(f.adapter.getCached('synthetic')).rejects.toThrow('native authority held');expect(decrypt).not.toHaveBeenCalled();expect(f.rpc).toHaveBeenCalledExactlyOnceWith('get_cached',{p_source_id:'synthetic'});
});
it('refuses uninitialized or revoked native authority before sealing or submission',async()=>{
 vi.stubEnv('CONTENT_MASTER_KEY','11'.repeat(32));const f=fixture(),encrypt=vi.spyOn(contentCrypto,'encryptContent');await expect(f.adapter.setCached('synthetic','private')).rejects.toThrow();expect(encrypt).not.toHaveBeenCalled();await f.adapter.init();
 f.verify.mockRejectedValueOnce(new Error('native authority held'));await expect(f.adapter.setCached('synthetic','private')).rejects.toThrow('native authority held');expect(encrypt).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();
});
it('keeps native disposal terminal during the pre-crypto authority check',async()=>{
 vi.stubEnv('CONTENT_MASTER_KEY','11'.repeat(32));const f=fixture();await f.adapter.init();let finish!:()=>void;f.verify.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
 const encrypt=vi.spyOn(contentCrypto,'encryptContent'),request=f.adapter.setCached('synthetic','private'),outcome=expect(request).rejects.toThrow();await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));f.hooks.close();finish();await outcome;expect(encrypt).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();
});
});

// Real fixed port implementations on a recorded channel exercise composition;
// these protocol fixtures cannot enroll a facade or issue installed authority.
function preparedFixture(readOnly=false){
 let closed=false;const call=vi.fn<PostgresDomainChannel['call']>(),channel:PostgresDomainChannel={call,get closed(){return closed;},async close(){closed=true;}};
 const publication=composePostgresPublication(channel,readOnly),researchPurchases=composePostgresResearchPurchases(channel,readOnly,{identity,role:readOnly?'keryx_reader':'keryx_app'});
 return {...fixture({publication,researchPurchases}),call,channel};
}
const publicationRun=():QueryRun=>({id:'synthetic-core-publication',createdAt:'2026-11-15T00:00:00.000Z',question:'Original question',answer:'Synthetic answer',engine:'heuristic',budget:0,totalSpent:0,totalToCreators:0,subClaims:[],decisions:[],citations:[],trace:[]});
const publicationAck=(args:readonly(string|null)[])=>{const packet=JSON.parse(args[0]!);return {id:packet.row.id,originalSha256:createHash('sha256').update(Buffer.from(packet.originalHex,'hex')).digest('hex')};};

describe('optional fixed native research admission and publication bindings',()=>{
 it('preserves the unconfigured authority-bound refusals without a legacy RPC',async()=>{
  vi.stubEnv('KERYX_RUN_PRIVACY_ENABLED','true');const f=fixture();await f.adapter.init();
  await expect(f.adapter.assertResearchPurchaseAuthority(identity.network)).rejects.toThrow('invalid_operation');await expect(f.adapter.saveQueryRun(publicationRun(),{visibility:'public'})).rejects.toThrow('privacy_unavailable');expect(f.rpc).not.toHaveBeenCalled();expect(state.sdk).not.toHaveBeenCalled();
 });
 it('binds the actual admission port to the existing fixed all-nine catalog observation',async()=>{
  const f=preparedFixture();await f.adapter.init();f.call.mockResolvedValue({identity,sourceDigest:'ab'.repeat(32)});
  await f.adapter.assertResearchPurchaseAuthority(identity.network);expect(f.call).toHaveBeenCalledExactlyOnceWith('nativeRuntimeAuthority',[]);expect(f.rpc).not.toHaveBeenCalled();
  await expect(assertPostgresRuntimeIdentity(f.adapter,'write')).rejects.toThrow('adapter_not_initialized');expect(state.sdk).not.toHaveBeenCalled();
 });
 it('checks Core initialization and terminal disposal before either port inspects caller fields',async()=>{
  const f=preparedFixture(),read=vi.fn(),run={get id(){read();return 'unused';}} as QueryRun,network={toString:read} as unknown as string;
  await expect(f.adapter.saveQueryRun(run)).rejects.toThrow('adapter_not_initialized');await expect(f.adapter.assertResearchPurchaseAuthority(network)).rejects.toThrow('adapter_not_initialized');expect(read).not.toHaveBeenCalled();expect(f.call).not.toHaveBeenCalled();
  await f.adapter.init();const save=f.adapter.saveQueryRun,admit=f.adapter.assertResearchPurchaseAuthority;f.hooks.close();await expect(save(run)).rejects.toThrow('adapter_not_initialized');await expect(admit(network)).rejects.toThrow('adapter_not_initialized');expect(read).not.toHaveBeenCalled();expect(f.call).not.toHaveBeenCalled();
 });
 it('preserves the actual readonly port refusals before caller fields or SQL',async()=>{
  const f=preparedFixture(true),read=vi.fn(),run={get id(){read();return 'unused';}} as QueryRun;await f.adapter.init();
  await expect(f.adapter.saveQueryRun(run,{visibility:'public'})).rejects.toThrow('privacy_unavailable');await expect(f.adapter.assertResearchPurchaseAuthority({toString:read} as unknown as string)).rejects.toThrow('PostgreSQL storage unavailable');expect(read).not.toHaveBeenCalled();expect(f.call).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();
 });
 it('captures publication before the first await and uses the actual fixed writer with privacy active',async()=>{
  vi.stubEnv('KERYX_RUN_PRIVACY_ENABLED','true');const f=preparedFixture(),run=publicationRun(),visibility={visibility:'public' as const};await f.adapter.init();let finish!:(value:unknown)=>void;f.call.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  const pending=f.adapter.saveQueryRun(run,visibility);run.question='Caller changed';const args=f.call.mock.calls[0][1],packet=JSON.parse(args[0]!);expect(JSON.parse(Buffer.from(packet.originalHex,'hex').toString()).question).toBe('Original question');expect(f.call.mock.calls[0][0]).toBe('publicationSave');finish(publicationAck(args));await pending;expect(f.call).toHaveBeenCalledTimes(1);expect(f.rpc).not.toHaveBeenCalled();expect(state.sdk).not.toHaveBeenCalled();
 });
 it('propagates unknown publication commit loss exactly once without RPC fallback',async()=>{
  const f=preparedFixture(),unknown=new PostgresDomainWriteOutcomeUnknown();await f.adapter.init();f.call.mockRejectedValueOnce(unknown);await expect(f.adapter.saveQueryRun(publicationRun())).rejects.toBe(unknown);expect(f.call).toHaveBeenCalledTimes(1);expect(f.rpc).not.toHaveBeenCalled();
 });
 it.each(['close','entry'] as const)('keeps a submitted publication unknown after %s changes during the await',async fault=>{
  const f=preparedFixture();await f.adapter.init();let finish!:(value:unknown)=>void;f.call.mockReturnValue(new Promise(resolve=>{finish=resolve;}));const pending=f.adapter.saveQueryRun(publicationRun()),rejected=expect(pending).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown),args=f.call.mock.calls[0][1];
  if(fault==='close')f.hooks.close();else f.entry.mockImplementation(()=>{throw Error('Selected storage changed');});finish(publicationAck(args));await rejected;expect(f.call).toHaveBeenCalledTimes(1);expect(f.rpc).not.toHaveBeenCalled();
 });
 it('refuses a post-await foreign admission identity instead of falling back',async()=>{
  const f=preparedFixture();await f.adapter.init();f.call.mockResolvedValue({identity:{...identity,storageId:randomUUID()},sourceDigest:'ab'.repeat(32)});await expect(f.adapter.assertResearchPurchaseAuthority(identity.network)).rejects.toThrow('PostgreSQL storage unavailable');expect(f.call).toHaveBeenCalledExactlyOnceWith('nativeRuntimeAuthority',[]);expect(f.rpc).not.toHaveBeenCalled();
 });
});
