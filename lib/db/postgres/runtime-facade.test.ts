import { describe,expect,it,vi } from 'vitest';
import { createHash,randomUUID } from 'node:crypto';
import type { KeryxDB } from '../keryx-db';
import type { QueryRun } from '../../types';
import { STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity } from '../storage-identity';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
import { PostgresStorageUnavailable } from './connection';
import { composePostgresRuntimeTransport } from './runtime-transport';
import { composePostgresRuntimeStores,POSTGRES_RUNTIME_STORE_NAMES,type NativePostgresRuntimeStores } from './runtime-stores';
import { composePostgresResearchPurchases } from './research-purchases-transport';
import { composePostgresPublication } from './publication-transport';
import { assertPostgresRuntimeIdentity,createPostgresRuntimeAdapter } from './runtime-adapter';
import { composePostgresRuntimeFacade,type PostgresRuntimeFacadeOptions,type PostgresRuntimeFacadeOverrides } from './runtime-facade';
import { POSTGRES_SOURCE_METHOD_ACCESS,POSTGRES_SOURCE_PROPERTIES,postgresSourcePropertyEnabled,type PostgresSourceSurface } from './runtime-surface';

const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',network:'eip155:5042',authorityMode:'mainnet-real',deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:'2026-11-15T00:00:00.000Z',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,provenanceDigest:'ab'.repeat(32)};
const monthly='monthly_'+'11'.repeat(32),owner='0x'+'ab'.repeat(20);
const run=():QueryRun=>({id:'synthetic-facade-publication',createdAt:'2026-11-15T00:00:00.000Z',question:'Original question',answer:'Synthetic answer',engine:'heuristic',budget:0,totalSpent:0,totalToCreators:0,subClaims:[],decisions:[],citations:[],trace:[]});
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};};
const acknowledgement=(args:readonly(string|null)[])=>{const packet=JSON.parse(args[0]!);return {id:packet.row.id,originalSha256:createHash('sha256').update(Buffer.from(packet.originalHex,'hex')).digest('hex')};};
// Complete method records test routing, not implementation/Source acceptance.
// Selected calls below use real fixed ports and already-guarded nested stores.
// No fixture is registered with a factory or can acquire installed provenance.
function fixture(changes:Partial<PostgresSourceSurface>={}){
 const surface={mainnet:true,readOnly:false,privacyActive:true,claimsEnabled:true,publicProfilesActive:true,...changes};
 const state={closed:false,held:false},entry=vi.fn(()=>{if(state.closed||state.held)throw new PostgresStorageUnavailable();}),guard=vi.fn(async()=>{entry();});
 const call=vi.fn<PostgresDomainChannel['call']>(),channel:PostgresDomainChannel={call,get closed(){return state.closed;},async close(){state.closed=true;}};
 const transport=composePostgresRuntimeTransport(channel,identity,'ab'.repeat(32),surface.readOnly,surface.claimsEnabled,surface.privacyActive);
 const all=composePostgresRuntimeStores({transport,identity,readOnly:surface.readOnly,claimsEnabled:surface.claimsEnabled,privacyActive:surface.privacyActive,publicProfilesActive:surface.publicProfilesActive,entry,guard,evidence:async()=>new Set<string>()});
 const stores=Object.freeze(Object.fromEntries(POSTGRES_RUNTIME_STORE_NAMES.filter(name=>postgresSourcePropertyEnabled(name,surface)).map(name=>[name,all[name]]))) as NativePostgresRuntimeStores;
 const rawCore:Record<string,unknown>=Object.create(null),unused=vi.fn(async()=>undefined);
 for(const name of Object.keys(POSTGRES_SOURCE_METHOD_ACCESS))rawCore[name]=unused;
 rawCore.saveQueryRun=composePostgresPublication(channel,surface.readOnly);
 rawCore.getResearchMonthly=composePostgresResearchPurchases(channel,surface.readOnly).getResearchMonthly;
 rawCore.iterateRecentQueries=vi.fn(()=>({async *[Symbol.asyncIterator](){yield run();}}));
 rawCore.runPrivacyActive=surface.privacyActive;rawCore.init=vi.fn(async()=>{});
 for(const name of Object.keys(stores))rawCore[name]=stores[name as keyof NativePostgresRuntimeStores];
 const close=vi.fn(async()=>{state.closed=true;await channel.close();});
 const options:PostgresRuntimeFacadeOptions={core:rawCore as unknown as KeryxDB,surface,stores,entry,guard,close};
 return {options,rawCore,state,entry,guard,call,channel,unused,close,surface,stores};
}
const closeOf=(facade:KeryxDB)=>(facade as KeryxDB&{close:()=>Promise<void>}).close;

describe('internal complete current Source facade',()=>{
 it('exposes exactly the 219 reviewed methods and enabled properties on a frozen null-prototype object',()=>{
  const f=fixture(),facade=composePostgresRuntimeFacade(f.options);
  expect(Object.keys(POSTGRES_SOURCE_METHOD_ACCESS)).toHaveLength(219);expect(Object.keys(POSTGRES_SOURCE_PROPERTIES)).toHaveLength(20);expect(POSTGRES_RUNTIME_STORE_NAMES).toHaveLength(17);
  expect(Object.keys(facade).sort()).toEqual(Object.keys(POSTGRES_SOURCE_METHOD_ACCESS).sort());
  const properties=Object.keys(POSTGRES_SOURCE_PROPERTIES).filter(name=>postgresSourcePropertyEnabled(name as keyof typeof POSTGRES_SOURCE_PROPERTIES,f.surface));
  expect(Reflect.ownKeys(facade).sort()).toEqual([...Object.keys(POSTGRES_SOURCE_METHOD_ACCESS),...properties].sort());expect(Object.getPrototypeOf(facade)).toBeNull();expect(Object.isFrozen(facade)).toBe(true);
  expect(Reflect.set(facade,'unknown',true)).toBe(false);expect(Reflect.defineProperty(facade,'unknown',{value:true})).toBe(false);expect(Reflect.setPrototypeOf(facade,{})).toBe(false);
 });
 it('keeps every Source feature predicate and the identical already-guarded Core stores',()=>{
  for(const mainnet of [false,true])for(const readOnly of [false,true])for(const privacyActive of [false,true])for(const claimsEnabled of [false,true])for(const publicProfilesActive of [false,true]){
   const f=fixture({mainnet,readOnly,privacyActive,claimsEnabled,publicProfilesActive}),facade=composePostgresRuntimeFacade(f.options);
   for(const name of POSTGRES_RUNTIME_STORE_NAMES){const expected=postgresSourcePropertyEnabled(name,f.surface);expect(Object.hasOwn(facade,name)).toBe(expected);expect(Reflect.get(facade,name)).toBe(expected?Reflect.get(f.options.core,name):undefined);}
   expect(facade.runPrivacyActive).toBe(privacyActive);
  }
 });
 it('refuses incomplete/unknown surface, methods, stores and mismatched store identity',()=>{
  for(const surface of [{...fixture().surface,extra:true},{...fixture().surface,readOnly:undefined},{mainnet:true}]){const f=fixture();expect(()=>composePostgresRuntimeFacade({...f.options,surface} as never)).toThrow('invalid_operation');}
  const f=fixture();delete f.rawCore.getSource;expect(()=>composePostgresRuntimeFacade(f.options)).toThrow('invalid_operation');
  const g=fixture();expect(()=>composePostgresRuntimeFacade({...g.options,stores:{...g.stores,personalHistory:{}}} as never)).toThrow('invalid_operation');
  expect(()=>composePostgresRuntimeFacade({...g.options,stores:{...g.stores,proof:{}}} as never)).toThrow('invalid_operation');
  const h=fixture();delete h.rawCore.privateProfiles;expect(()=>composePostgresRuntimeFacade(h.options)).toThrow('invalid_operation');
 });
 it('never reads unknown Core properties or accepts arbitrary override/router names',()=>{
  const f=fixture(),inspected=vi.fn();Object.defineProperty(f.rawCore,'rawSql',{get(){inspected();throw Error('Core leak');}});const facade=composePostgresRuntimeFacade(f.options);
  for(const name of ['rawSql','readEvidenceProvenance','constructor','toString','then','zotero','proof'])expect(Reflect.get(facade,name)).toBeUndefined();expect(Reflect.get(facade,Symbol.asyncIterator)).toBeUndefined();expect(inspected).not.toHaveBeenCalled();
  expect(()=>composePostgresRuntimeFacade({...f.options,overrides:{saveQueryRun:async()=>{}}} as never)).toThrow('invalid_operation');
  expect(()=>composePostgresRuntimeFacade({...f.options,overrides:{rpc:async()=>{}}} as never)).toThrow('invalid_operation');
 });
 it('captures Source booleans, Core method references and the finite standalone observation overrides once',async()=>{
  const f=fixture(),web=vi.fn(async()=>null),overrides:PostgresRuntimeFacadeOverrides={getWebSession:web},facade=composePostgresRuntimeFacade({...f.options,overrides}),read=facade.getResearchMonthly;
  f.surface.readOnly=true;f.surface.privacyActive=false;f.rawCore.getResearchMonthly=()=>{throw Error('Changed method');};overrides.getWebSession=async()=>{throw Error('Changed override');};f.call.mockResolvedValue(null);
  expect(await read(monthly)).toBeNull();expect(f.call).toHaveBeenCalledExactlyOnceWith('researchMonthlyGet',[JSON.stringify({id:monthly})]);expect(await facade.getWebSession('synthetic')).toBeNull();expect(web).toHaveBeenCalledExactlyOnceWith('synthetic');expect(facade.runPrivacyActive).toBe(true);
 });
 it('refuses every readonly writer and the Source purchase-authority exception before caller fields',async()=>{
  const f=fixture({readOnly:true}),facade=composePostgresRuntimeFacade(f.options);let inspected=0;const raw=new Proxy({},{get(){inspected++;throw Error('Caller fields');}});
  for(const [name,access] of Object.entries(POSTGRES_SOURCE_METHOD_ACCESS))if(access==='write'||access==='mainnet-write'||name==='assertResearchPurchaseAuthority')await expect(Reflect.apply(Reflect.get(facade,name) as Function,undefined,[raw,raw,raw])).rejects.toThrow('readonly_operation');
  expect(inspected).toBe(0);expect(f.unused).not.toHaveBeenCalled();expect(f.call).not.toHaveBeenCalled();
 });
 it('keeps held method references and nested stores terminal before SQL',async()=>{
  const f=fixture(),facade=composePostgresRuntimeFacade(f.options),read=facade.getResearchMonthly,profile=facade.privateProfiles!.get,close=closeOf(facade);await close();
  await expect(read(monthly)).rejects.toThrow('adapter_not_initialized');await expect(profile(owner,identity.network)).rejects.toThrow('PostgreSQL storage unavailable');expect(()=>facade.getSource).toThrow('adapter_not_initialized');expect(f.call).not.toHaveBeenCalled();
 });
 it('refuses a captured writer and historical mainnet-only methods before caller fields',async()=>{
  const f=fixture(),facade=composePostgresRuntimeFacade(f.options),save=facade.saveQueryRun;let inspected=0;const raw=new Proxy({},{get(){inspected++;throw Error('Caller fields');}});f.state.held=true;await expect(save(raw as QueryRun)).rejects.toThrow('PostgreSQL storage unavailable');expect(inspected).toBe(0);expect(f.call).not.toHaveBeenCalled();
  const g=fixture({mainnet:false}),historical=composePostgresRuntimeFacade(g.options);await expect(historical.claimResearchPurchase(raw as never)).rejects.toThrow('invalid_operation');expect(inspected).toBe(0);expect(g.unused).not.toHaveBeenCalled();
 });
 it('refuses delayed read results after current entry changes',async()=>{
  const f=fixture(),facade=composePostgresRuntimeFacade(f.options),wait=deferred<unknown>();f.call.mockReturnValue(wait.promise);const pending=facade.getResearchMonthly(monthly);f.state.held=true;wait.resolve(null);await expect(pending).rejects.toThrow('PostgreSQL storage unavailable');expect(f.call).toHaveBeenCalledTimes(1);
 });
 it('captures through the actual publication port before awaiting, then marks completed writes unknown on lost context',async()=>{
  const f=fixture(),facade=composePostgresRuntimeFacade(f.options),wait=deferred<unknown>(),input=run();f.call.mockReturnValue(wait.promise);const pending=facade.saveQueryRun(input),args=f.call.mock.calls[0][1];input.question='Changed';expect(JSON.parse(Buffer.from(JSON.parse(args[0]!).originalHex,'hex').toString()).question).toBe('Original question');f.state.held=true;wait.resolve(acknowledgement(args));await expect(pending).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);expect(f.call).toHaveBeenCalledExactlyOnceWith('publicationSave',args);
 });
 it('preserves the port known pre-SQL rejection when the later context guard fails',async()=>{
  const f=fixture(),known=new PostgresStorageUnavailable(),attempt=vi.fn(()=>{f.state.held=true;return Promise.reject(known);});f.rawCore.recordFeedback=attempt;const facade=composePostgresRuntimeFacade(f.options);
  await expect(facade.recordFeedback('synthetic','up')).rejects.toBe(known);expect(attempt).toHaveBeenCalledTimes(1);expect(f.call).not.toHaveBeenCalled();
 });
 it('preserves an already-unknown actual publication rejection without retry',async()=>{
  const f=fixture(),unknown=new PostgresDomainWriteOutcomeUnknown(),facade=composePostgresRuntimeFacade(f.options);f.call.mockImplementation(async()=>{f.state.held=true;throw unknown;});await expect(facade.saveQueryRun(run())).rejects.toBe(unknown);expect(f.call).toHaveBeenCalledTimes(1);
 });
 it('keeps Source health degradation only while the fresh guard remains current',async()=>{
  const f=fixture();f.rawCore.readPublicHealthSnapshot=async()=>{throw Error('Known health read failure');};const facade=composePostgresRuntimeFacade(f.options);expect(await facade.readPublicHealthSnapshot!(Date.now(),false)).toBeUndefined();f.rawCore.readPublicHealthSnapshot=()=>undefined;
  f.guard.mockRejectedValueOnce(new PostgresStorageUnavailable());await expect(facade.readPublicHealthSnapshot!(Date.now(),false)).rejects.toThrow('PostgreSQL storage unavailable');
 });
 it('uses Source init as a fresh guard and captures one canonical close promise even after retirement',async()=>{
  const f=fixture(),wait=deferred<void>();f.close.mockImplementation(()=>{f.state.closed=true;return wait.promise;});const facade=composePostgresRuntimeFacade(f.options),init=facade.init,close=closeOf(facade);await init();expect(f.rawCore.init).not.toHaveBeenCalled();expect(f.guard).toHaveBeenCalledTimes(1);
  const first=close(),second=closeOf(facade)();expect(first).toBe(second);expect(f.close).toHaveBeenCalledTimes(1);await expect(init()).rejects.toThrow('adapter_not_initialized');wait.resolve();await first;expect(close()).toBe(first);
 });
 it('does not re-run failed cleanup or resurrect the internal facade',async()=>{
  const f=fixture(),failure=Error('Cleanup failed');f.close.mockRejectedValue(failure);const facade=composePostgresRuntimeFacade(f.options),close=closeOf(facade),first=close();await expect(first).rejects.toBe(failure);expect(close()).toBe(first);expect(f.close).toHaveBeenCalledTimes(1);expect(()=>facade.runPrivacyActive).toThrow('adapter_not_initialized');
 });
 it('invokes a typed iterator before its first await and guards every yield and early return',async()=>{
  const f=fixture(),next=vi.fn(async()=>({done:false as const,value:run()})),ret=vi.fn(async()=>({done:true as const,value:undefined})),make=vi.fn((_limit:number)=>({[Symbol.asyncIterator](){return {next,return:ret};}}));f.rawCore.iterateRecentQueries=make;const facade=composePostgresRuntimeFacade(f.options),iterator=facade.iterateRecentQueries(2)[Symbol.asyncIterator]();expect(make).toHaveBeenCalledExactlyOnceWith(2);expect(next).not.toHaveBeenCalled();expect((await iterator.next()).value).toEqual(run());await iterator.return!();expect(next).toHaveBeenCalledTimes(1);expect(ret).toHaveBeenCalledTimes(1);expect(f.guard.mock.calls.length).toBeGreaterThanOrEqual(4);
 });
 it('cleans a captured iterator without yielding after context changes during next',async()=>{
  const f=fixture(),wait=deferred<IteratorResult<QueryRun>>(),next=vi.fn(()=>wait.promise),ret=vi.fn(async()=>({done:true as const,value:undefined}));f.rawCore.iterateRecentQueries=()=>({[Symbol.asyncIterator](){return {next,return:ret};}});const facade=composePostgresRuntimeFacade(f.options),iterator=facade.iterateRecentQueries(1)[Symbol.asyncIterator](),pending=iterator.next();await vi.waitFor(()=>expect(next).toHaveBeenCalledTimes(1));f.state.held=true;wait.resolve({done:false,value:run()});await expect(pending).rejects.toThrow('PostgreSQL storage unavailable');expect(ret).toHaveBeenCalledTimes(1);expect(next).toHaveBeenCalledTimes(1);
 });
 it('never grants genuine native facade identity or opens the writer factory',async()=>{
  const f=fixture(),facade=composePostgresRuntimeFacade(f.options);for(const value of [facade,new Proxy(facade,{}),f.options.core])await expect(assertPostgresRuntimeIdentity(value,'write')).rejects.toThrow('adapter_not_initialized');await expect(createPostgresRuntimeAdapter()).rejects.toThrow('adapter_not_initialized');expect(f.call).not.toHaveBeenCalled();
 });
});
