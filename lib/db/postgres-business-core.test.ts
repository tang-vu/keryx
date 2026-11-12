import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { randomUUID } from "node:crypto";
import { STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity } from "./storage-identity";
const state=vi.hoisted(()=>({sdk:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:state.sdk}));
import { assembleNativePostgresBusinessCore } from "./supabase-adapter";
import { storageDomainClient,callSupabaseDomain,type StorageDomainAuthority } from "./supabase-authority";
import { assertEnrolledSupabaseAuthority } from "./enrolled-supabase-adapter";
import { assertEnrolledSqliteAdapter } from "./enrolled-sqlite-adapter";

const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',network:'eip155:5042',authorityMode:'mainnet-real',deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:'2026-11-12T00:00:00.000Z',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,provenanceDigest:'11'.repeat(32)};
type DomainResult=Awaited<ReturnType<StorageDomainAuthority["rpcResult"]>>;
function fixture(){
 const rpc=vi.fn(async():Promise<DomainResult>=>({data:null,error:null}));
 const authority:StorageDomainAuthority={rpcResult:rpc};
 const verify=vi.fn(async()=>{}),entry=vi.fn();
 const core=assembleNativePostgresBusinessCore({identity,authority:{...authority,domainClient:()=>storageDomainClient(authority)},assertEntry:entry,verify});
 return {...core,rpc,verify,entry,authority};
}
beforeEach(()=>{vi.clearAllMocks();state.sdk.mockImplementation(()=>{throw new Error('SDK construction is forbidden in native assembly');});});
afterEach(()=>vi.unstubAllEnvs());
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
});
