/** Pure closed composition + real fixed-port recordings. No installed Native
 * facade, SQL qualification, funding observation or accepted proof is created. */
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
import {STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity} from '../storage-identity';
import {composePostgresRuntimeTransport} from './runtime-transport';
import {composePostgresRuntimeStores,guardPostgresRuntimeIterator,POSTGRES_RUNTIME_STORE_NAMES} from './runtime-stores';
import {POSTGRES_SOURCE_METHOD_ACCESS,POSTGRES_SOURCE_PROPERTIES,POSTGRES_SOURCE_ASYNC_ALIASES,assertPostgresSourceMethodAccess,postgresSourcePropertyEnabled} from './runtime-surface';
import {PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel} from './domain-channel';
import {assembleNativePostgresBusinessCore} from '../supabase-adapter';
import {assertPostgresRuntimeIdentity,createPostgresRuntimeAdapter} from './runtime-adapter';
const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',deploymentId:randomUUID(),storageId:randomUUID(),network:'eip155:5042',authorityMode:'mainnet-real',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,enrollmentId:randomUUID(),enrolledAt:'2026-11-15T00:00:00.000Z',provenanceDigest:'ab'.repeat(32)};
const wallet='0x'+'11'.repeat(20),stamp='2026-11-15T00:00:00.000Z';
const profile=()=>({profile:{wallet,displayName:'Reader',handle:'reader_01',bio:'Synthetic',purpose:'Papers',links:[],createdAt:stamp,updatedAt:stamp},activity:{firstSeenAt:null,questions:1,surfacesUsed:['web'],topics:[],creatorsPaid:0,scope:'attributed-current-store',network:identity.network}});
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};};
function fixture(readOnly=true){
 const state={closed:false,held:false},entry=()=>{if(state.closed||state.held)throw Error('retired preparation');},guard=vi.fn(async()=>{entry();});
 const call=vi.fn<PostgresDomainChannel['call']>().mockResolvedValue(profile()),channel:PostgresDomainChannel={get closed(){return state.closed;},call,async close(){state.closed=true;}};
 const transport=composePostgresRuntimeTransport(channel,identity,'aa'.repeat(32),readOnly,true,true);
 const options={transport,identity,readOnly,privacyActive:true,claimsEnabled:true,publicProfilesActive:true,entry,guard,evidence:async()=>new Set<string>()};
 return {state,entry,guard,call,channel,transport,options,stores:composePostgresRuntimeStores(options)};
}
describe('reviewed Source surface preparation',()=>{
 it('matches every literal selected Source access, independently of Supabase193',()=>{
  const raw=readFileSync(new URL('../enrolled-sqlite-adapter.ts',import.meta.url),'utf8'),body=raw.split('export const ENROLLED_SQLITE_METHOD_ACCESS = Object.freeze({')[1].split('} as const);')[0];
  const actual=Object.fromEntries([...body.matchAll(/\b(\w+): "(read|write|mainnet-read|mainnet-write)"/g)].map(m=>[m[1],m[2]]));expect(POSTGRES_SOURCE_METHOD_ACCESS).toEqual(actual);expect(Object.keys(actual)).toHaveLength(219);
  const counts=Object.values(actual).reduce<Record<string,number>>((n,k)=>(n[k]=(n[k]??0)+1,n),{});expect(counts).toEqual({read:100,write:110,'mainnet-read':4,'mainnet-write':5});
  expect(Object.keys(POSTGRES_SOURCE_PROPERTIES)).toHaveLength(20);expect(POSTGRES_SOURCE_PROPERTIES).not.toHaveProperty('zotero');expect(POSTGRES_SOURCE_PROPERTIES).not.toHaveProperty('historyMembership');
  expect(Object.isFrozen(POSTGRES_RUNTIME_STORE_NAMES)).toBe(true);expect(Object.isFrozen(POSTGRES_SOURCE_METHOD_ACCESS)).toBe(true);expect(Object.isFrozen(POSTGRES_SOURCE_PROPERTIES)).toBe(true);
 });
 it('retains the extra readonly purchase-authority refusal and native async names',()=>{
  const surface={mainnet:true,readOnly:true,privacyActive:true,claimsEnabled:true,publicProfilesActive:true};
  expect(()=>assertPostgresSourceMethodAccess('assertResearchPurchaseAuthority',surface)).toThrow('readonly_operation');expect(assertPostgresSourceMethodAccess('getResearchMonthly',surface)).toBe('mainnet-read');
  expect(()=>assertPostgresSourceMethodAccess('getResearchMonthly',{...surface,mainnet:false})).toThrow();expect(()=>assertPostgresSourceMethodAccess('setSourceMeta',surface)).toThrow('readonly_operation');
  expect(()=>assertPostgresSourceMethodAccess('toString' as never,surface)).toThrow();expect(POSTGRES_SOURCE_ASYNC_ALIASES).toEqual({pendingAdmission:'pendingJobOwners.assertAdmissionAsync',historyFence:'accountMembership.prepareAsyncHistoryFence',ownerAssignments:'ownerRunAssignments.reply',ownerAssignmentMode:'native-postgres-async-v1'});
 });
 it.each([false,true])('keeps precise Source feature/role predicates (readonly=%s)',readOnly=>{
  for(const mainnet of [false,true])for(const privacyActive of [false,true])for(const claimsEnabled of [false,true])for(const publicProfilesActive of [false,true]){
   const s={mainnet,readOnly,privacyActive,claimsEnabled,publicProfilesActive};expect(postgresSourcePropertyEnabled('runClaims',s)).toBe(claimsEnabled);expect(postgresSourcePropertyEnabled('runOwnershipHistory',s)).toBe(privacyActive||claimsEnabled);expect(postgresSourcePropertyEnabled('runPrivacy',s)).toBe(privacyActive);expect(postgresSourcePropertyEnabled('publicProfiles',s)).toBe(mainnet&&privacyActive&&publicProfilesActive);expect(postgresSourcePropertyEnabled('publicLedgerRuns',s)).toBe(mainnet&&readOnly&&privacyActive);
  }
 });
});
describe('closed guarded nested stores',()=>{
 it('shares the identical guarded objects with Core and never grants runtime identity',async()=>{
  const f=fixture(),core=assembleNativePostgresBusinessCore({identity,authority:{domainClient:()=>new Proxy({},{get(){throw Error('No legacy RPC');}}),rpcResult:async()=>{throw Error('No legacy RPC');}} as never,assertEntry:f.entry,verify:f.guard,runtimeStores:f.stores});
  for(const name of POSTGRES_RUNTIME_STORE_NAMES)expect(Reflect.get(core.adapter,name)).toBe(f.stores[name]);
  await expect(core.adapter.privateProfiles!.get(wallet,identity.network)).resolves.toEqual(profile());expect(f.call).toHaveBeenCalledWith('privateProfileGet',[wallet,identity.network]);
  for(const value of [f.stores,core.adapter,new Proxy(core.adapter,{})])await expect(assertPostgresRuntimeIdentity(value)).rejects.toThrow('adapter_not_initialized');await expect(createPostgresRuntimeAdapter()).rejects.toThrow('adapter_not_initialized');
  f.state.closed=true;core.hooks.close();await expect(core.adapter.privateProfiles!.get(wallet,identity.network)).rejects.toThrow('retired');
 });
 it('denies readonly mutations before caller or target method getters and SQL',async()=>{
  const f=fixture();let inspected=0;const raw=new Proxy({},{get(){inspected++;throw Error('inspected');}}) as never;
  for(const work of [()=>f.stores.privateProfiles!.update(raw,raw),()=>f.stores.privateProfiles!.delete(raw),()=>f.stores.runPrivacy!.creationReady(),()=>f.stores.runPrivacy!.change(raw,raw),()=>f.stores.accountMembership!.resume(raw,raw,raw,raw),()=>f.stores.deliverableAcceptance!.submit(raw,raw,raw,raw,raw),()=>f.stores.runClaims!.issue(raw)])await expect(work()).rejects.toThrow('readonly_operation');
  expect(()=>f.stores.pendingJobOwners!.assertAdmission(raw)).toThrow('readonly_operation');expect(inspected).toBe(0);expect(f.call).not.toHaveBeenCalled();
  const hostile=new Proxy(f.transport.privateProfiles,{get(target,key){if(key==='update'){inspected++;throw Error('target getter');}return Reflect.get(target,key);}});const stores=composePostgresRuntimeStores({...f.options,transport:{...f.transport,privateProfiles:hostile}});await expect(stores.privateProfiles!.update(raw,raw)).rejects.toThrow('readonly_operation');expect(inspected).toBe(0);
 });
 it('holds a delayed concrete read until its fresh post-await guard succeeds',async()=>{
  const f=fixture(),wait=deferred<unknown>();f.call.mockReturnValue(wait.promise);const pending=f.stores.privateProfiles!.get(wallet,identity.network);expect(f.call).toHaveBeenCalledTimes(1);f.state.held=true;wait.resolve(profile());await expect(pending).rejects.toThrow('retired');expect(f.call).toHaveBeenCalledTimes(1);
 });
 it('preserves write outcome unknown after completed SQL/guard loss and never retries',async()=>{
  const f=fixture(false);f.call.mockImplementation(async op=>{expect(op).toBe('privateProfileDelete');f.state.held=true;return {deleted:true};});await expect(f.stores.privateProfiles!.delete(wallet)).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);expect(f.call).toHaveBeenCalledTimes(1);
  const g=fixture(false);g.call.mockRejectedValue(new PostgresDomainWriteOutcomeUnknown());await expect(g.stores.privateProfiles!.delete(wallet)).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);expect(g.call).toHaveBeenCalledTimes(1);
 });
 it('invokes a concrete typed writer before its first await captures caller mutation',async()=>{
  const f=fixture(false),wait=deferred<unknown>(),raw={displayName:'Before',handle:'reader_01',bio:'Synthetic',purpose:'Papers',links:[]};f.call.mockReturnValue(wait.promise);const pending=f.stores.privateProfiles!.update(wallet,raw);expect(f.call).toHaveBeenCalledTimes(1);raw.displayName='After';const saved=JSON.parse(f.call.mock.calls[0][1][1]!);expect(saved.displayName).toBe('Before');wait.resolve({status:'updated',profile:{...saved,wallet,createdAt:stamp,updatedAt:stamp}});expect((await pending).displayName).toBe('Before');
 });
 it('keeps repeated method names bound to their explicit domain, never a sibling store',async()=>{
  const f=fixture(false),seen:string[]=[],record=(domain:string,methods:string[])=>Object.fromEntries(methods.map(name=>[name,async()=>{seen.push(domain+'.'+name);}])) as never;
  const stores=composePostgresRuntimeStores({...f.options,transport:{...f.transport,
   privateProfiles:record('privateProfiles',['update','delete']),publicProfiles:record('publicProfiles',['update','unpublish']),
   accountMembership:record('accountMembership',['issue','complete','unlink']),chatAccountLinks:record('chatAccountLinks',['issue','complete','unlink']),profileIdentities:record('profileIdentities',['begin','consume','complete','unlink']),
  }});
  for(const [domain,names]of [['privateProfiles',['update','delete']],['publicProfiles',['update','unpublish']],['accountMembership',['issue','complete','unlink']],['chatAccountLinks',['issue','complete','unlink']],['profileIdentities',['begin','consume','complete','unlink']]] as const)for(const name of names){await Reflect.apply(Reflect.get(stores[domain]!,name),undefined,[]);expect(seen.at(-1)).toBe(domain+'.'+name);}
  expect(seen).toHaveLength(14);expect(f.call).not.toHaveBeenCalled();await expect(assertPostgresRuntimeIdentity(stores)).rejects.toThrow('adapter_not_initialized');
 });
 it('keeps pending admission final and synchronous after its separate one-use phase',async()=>{
  const f=fixture(false);let ready=false;const final=vi.fn(()=>{if(!ready)throw Error('No preceding durable phase');ready=false;});const pending={assertAdmission:final,async assertAdmissionAsync(){ready=true;},async list(){return [];}};
  const stores=composePostgresRuntimeStores({...f.options,transport:{...f.transport,pendingJobOwners:pending}}),proof={} as never;
  expect(()=>stores.pendingJobOwners!.assertAdmission(proof)).toThrow('durable');await stores.pendingJobOwners!.assertAdmissionAsync!(proof);expect(stores.pendingJobOwners!.assertAdmission(proof)).toBeUndefined();expect(()=>stores.pendingJobOwners!.assertAdmission(proof)).toThrow('durable');f.state.closed=true;expect(()=>stores.pendingJobOwners!.assertAdmission(proof)).toThrow('retired');
 });
 it('consumes a returned history finalizer once and guards held references after close',async()=>{
  const f=fixture(),final=vi.fn(async()=>{});const stores=composePostgresRuntimeStores({...f.options,transport:{...f.transport,accountMembership:{...f.transport.accountMembership,prepareAsyncHistoryFence:async()=>final}}});
  const finish=await stores.accountMembership!.prepareAsyncHistoryFence!({} as never,[],Date.now()+10000);await finish();await expect(finish()).rejects.toThrow('invalid_operation');expect(final).toHaveBeenCalledTimes(1);
  const stale=await stores.accountMembership!.prepareAsyncHistoryFence!({} as never,[],Date.now()+10000);f.state.closed=true;await expect(stale()).rejects.toThrow('retired');expect(final).toHaveBeenCalledTimes(1);
 });
 it('keeps synchronous session binding and closes every retained watch method',async()=>{
  const f=fixture(),session={hash:'aa'.repeat(32),wallet,issuedAt:1,expiresAt:2},bound=f.stores.topicWatches!.bindSession(session),key={ownerWallet:wallet,watchId:'synthetic-watch'};session.wallet='0x'+'22'.repeat(20);f.call.mockResolvedValue({item:null});await expect(bound.read(key)).resolves.toBeNull();expect(f.call.mock.calls[0][0]).toBe('watchRead');expect(JSON.parse(f.call.mock.calls[0][1][0]!).wallet).toBe(wallet);
  let inspected=0;await expect(bound.compareAndSwap(new Proxy({},{get(){inspected++;throw Error('inspected');}}) as never,null,{} as never,1)).rejects.toThrow('readonly_operation');expect(inspected).toBe(0);f.state.closed=true;await expect(bound.list()).rejects.toThrow('retired');await expect(bound.read(key)).rejects.toThrow('retired');
 });
 it('keeps feature-disabled stores absent without an ordinary fallback',()=>{
  const f=fixture(),stores=composePostgresRuntimeStores({...f.options,claimsEnabled:false,privacyActive:false,publicProfilesActive:false});for(const key of ['runPrivacy','runOwnershipHistory','runClaims','publicProfiles','publicLedgerRuns'])expect(stores).not.toHaveProperty(key);expect(Object.keys(stores).every(n=>(POSTGRES_RUNTIME_STORE_NAMES as readonly string[]).includes(n))).toBe(true);
 });
 it('guards iterator yields, pending next and cleanup return after retirement',async()=>{
  const f=fixture(),wait=deferred<IteratorResult<number>>(),returned=vi.fn(async()=>({done:true,value:undefined} as const)),next=vi.fn().mockResolvedValueOnce({done:false,value:1}).mockReturnValueOnce(wait.promise);const iterator=guardPostgresRuntimeIterator(()=>({next,return:returned}),f.entry,f.guard);expect(await iterator.next()).toEqual({done:false,value:1});const pending=iterator.next();await Promise.resolve();await Promise.resolve();f.state.closed=true;wait.resolve({done:false,value:2});await expect(pending).rejects.toThrow('retired');expect(returned).toHaveBeenCalledTimes(1);
 });
});
