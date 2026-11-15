import { describe,expect,it,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ARC_MAINNET_PROFILE } from '../../arc-network-profile';
import { canonicalJson } from '../../canonical-json';
import { syntheticA2aOriginal } from '../a2a-original-fixture';
import type { NativePostgresBusinessCoreOptions } from '../supabase-adapter';
import { STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity } from '../storage-identity';
import { assembleCurrentPostgresCore } from './current-core-assembly';
import { composePostgresRuntimeTransport,type PostgresRuntimeTransport } from './runtime-transport';
import { composePostgresRuntimeStores,POSTGRES_RUNTIME_STORE_NAMES } from './runtime-stores';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
import { PostgresStorageUnavailable } from './connection';
import { assertPostgresRuntimeIdentity,createPostgresRuntimeAdapter } from './runtime-adapter';

// Observe arguments while delegating to the actual shared Core constructor.
// All transport responses/guards below are dependency recordings, never genuine
// installed native provenance, funding observations or factory acceptance.
const construction=vi.hoisted(()=>({capture:vi.fn()}));
vi.mock('../supabase-adapter',async original=>{
 const actual=await original<typeof import('../supabase-adapter')>();
 return {...actual,assembleNativePostgresBusinessCore(options:NativePostgresBusinessCoreOptions){construction.capture(options);return actual.assembleNativePostgresBusinessCore(options);}};
});

const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',network:'eip155:5042',authorityMode:'mainnet-real',deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:'2026-11-15T00:00:00.000Z',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,provenanceDigest:'11'.repeat(32)};
const digest='22'.repeat(32),payer=`0x${'ab'.repeat(20)}`,intentId=`prv_${'cd'.repeat(32)}`,monthlyId=`monthly_${'ef'.repeat(32)}`,at='2026-11-15T00:00:00.000Z';
const emptyPrivate={intentRowWire:null,paymentRowWire:null,executionRowWire:null,resultRowWire:null,interruptionRowWire:null,reservationRowWire:null,releaseRowWire:null,submissionsWire:'[]',confirmationsWire:'[]'};
function fixture(readOnly=false){
 let closed=false,current=true;
 const call=vi.fn<PostgresDomainChannel['call']>().mockResolvedValue(null),channel:PostgresDomainChannel={call,get closed(){return closed;},async close(){closed=true;}};
 const transport=composePostgresRuntimeTransport(channel,identity,digest,readOnly),entry=vi.fn(()=>{if(!current||closed)throw new PostgresStorageUnavailable();}),verify=vi.fn(async()=>{entry();});
 const stores=composePostgresRuntimeStores({transport,identity,readOnly,privacyActive:true,claimsEnabled:true,publicProfilesActive:true,entry,guard:verify,evidence:async()=>new Set<string>()});
 const input={transport,identity,runtimeStores:stores,assertEntry:entry,verify};
 const core=assembleCurrentPostgresCore(input),options=construction.capture.mock.lastCall![0] as Required<NativePostgresBusinessCoreOptions>;
 return {core,transport,stores,input,options,call,channel,entry,verify,revoke(){current=false;}};
}

describe('complete current internal Core assembly',()=>{
 it('maps all26 required options and shares the exact guarded store objects without initializing or enrolling',()=>{
  const f=fixture();
  expect(Object.keys(f.options).sort()).toEqual(['identity','authority','assertEntry','verify','runtimeStores','sourceClaims','a2aFulfillment','paymentEvents','browserJournal','sourceObservations','articleOffers','operatorWithdrawal','referenceArchive','paymentObservations','privateResearch','onramp','scholarly','registrationSponsor','a2aOriginals','researchPurchases','publication','financialApplication','sourceClaimWrites','sourceUpkeep','sourceUpsert','sourceMetaSetter'].sort());
  expect(f.options.identity).toBe(identity);expect(f.options.assertEntry).toBe(f.entry);expect(f.options.verify).toBe(f.verify);expect(f.options.runtimeStores).toBe(f.stores);
  for(const name of ['sourceClaims','paymentEvents','browserJournal','sourceObservations','articleOffers','operatorWithdrawal','referenceArchive','paymentObservations','privateResearch','onramp','scholarly','registrationSponsor','financialApplication','sourceClaimWrites','sourceUpkeep'] as const)expect(f.options[name]).toBe(f.transport[name]);
  for(const name of ['a2aFulfillment','a2aOriginals','researchPurchases'] as const)expect(f.options[name]).toBe(f.transport);
  expect(f.options.publication).toBe(f.transport.saveQueryRun);expect(f.options.sourceUpsert).toBe(f.transport.sourceUpsert.upsertSource);expect(f.options.sourceMetaSetter).toBe(f.transport.sourceUpsert.setSourceMeta);
  for(const name of POSTGRES_RUNTIME_STORE_NAMES)expect(Reflect.get(f.core.adapter,name)).toBe(f.stores[name]);
  expect(f.verify).not.toHaveBeenCalled();expect(f.call).not.toHaveBeenCalled();
 });
 it('constructs only the fixed native authority and refuses unknown/table operations instead of ordinary Supabase fallback',async()=>{
  const f=fixture(),client=f.options.authority.domainClient();
  expect(()=>client.from('arbitrary_table')).toThrow('invalid_operation');await expect(f.options.authority.rpcResult('unrecognized_rpc',{})).rejects.toThrow(PostgresStorageUnavailable);
  expect(f.call).not.toHaveBeenCalled();await f.core.adapter.init();
  await f.core.adapter.setSourceNotify('synthetic-source','https://synthetic.invalid','synthetic-secret');
  expect(f.call).toHaveBeenCalledOnce();expect(f.call.mock.calls[0][0]).toBe('content_set_source_notify');
  expect(JSON.parse(f.call.mock.calls[0][1][0]!)).toEqual({p_row:{source_id:'synthetic-source',notify_url:'https://synthetic.invalid',secret:'synthetic-secret',updated_at:expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)} });
 });
 it('refuses a missing prepared group instead of constructing an incomplete Core',()=>{
  const f=fixture(),transport={...f.transport,financialApplication:undefined} as unknown as PostgresRuntimeTransport;
  construction.capture.mockClear();expect(()=>assembleCurrentPostgresCore({...f.input,transport})).toThrow(PostgresStorageUnavailable);expect(construction.capture).not.toHaveBeenCalled();expect(f.call).not.toHaveBeenCalled();
 });
 it('routes actual private, monthly, offer, archive and financial reads through their explicit ports',async()=>{
  const f=fixture();await f.core.adapter.init();
  f.call.mockResolvedValueOnce(emptyPrivate);expect(await f.core.adapter.getPrivateResearchIntent(intentId,payer)).toBeNull();expect(f.call.mock.lastCall).toEqual(['privateResearchSnapshot',[intentId,JSON.stringify({payer})]]);
  expect(await f.core.adapter.getResearchMonthly(monthlyId)).toBeNull();expect(f.call.mock.lastCall).toEqual(['researchMonthlyGet',[JSON.stringify({id:monthlyId})]]);
  expect(await f.core.adapter.getArticleOffer('synthetic-source','synthetic-item')).toBeNull();expect(f.call.mock.lastCall?.[0]).toBe('app_get_article_offer');
  f.call.mockResolvedValueOnce([]);expect(await f.core.adapter.listPublicReferences()).toEqual([]);expect(f.call.mock.lastCall).toEqual(['referenceArchiveRead',['list','{}']]);
  expect(await f.core.adapter.getSessionGrantConsent(payer,randomUUID())).toBeNull();expect(f.call.mock.lastCall?.[0]).toBe('get');expect(f.call).toHaveBeenCalledTimes(5);
 });
 it('maps the existing Source metadata and upkeep paths, retaining their current snapshot refusal',async()=>{
  const f=fixture();await f.core.adapter.init();
  await f.core.adapter.setSourceMeta('synthetic-source',{name:'Synthetic',description:'Original metadata',url:'https://synthetic.invalid'});
  expect(f.call.mock.lastCall?.[0]).toBe('content_set_source_meta');
  const refusal=new PostgresStorageUnavailable();f.call.mockRejectedValueOnce(refusal);await expect(f.core.adapter.claimSourceUpkeep!(Date.parse(at))).rejects.toBe(refusal);expect(f.call.mock.lastCall?.[0]).toBe('sourceProducerSnapshot');expect(f.call).toHaveBeenCalledTimes(2);
 });
 it('retains the exact-original claim alias and refuses a bare queue claim without legacy dispatch',async()=>{
  const f=fixture(),original=syntheticA2aOriginal(9601,ARC_MAINNET_PROFILE);await f.core.adapter.init();
  await expect(f.core.adapter.claimNextA2aOrder('synthetic-worker',at)).rejects.toThrow('invalid_operation');expect(f.call).not.toHaveBeenCalled();
  const captured={...original.binding},pending=f.core.adapter.claimNextA2aOrder('synthetic-worker',at,captured);captured.payer=payer;expect(await pending).toBeNull();
  expect(f.call).toHaveBeenCalledExactlyOnceWith('a2aOriginalClaim',[canonicalJson(original.binding),'synthetic-worker',at]);
 });
 it('keeps research admission and the sponsor facade cycle closed before genuine registration',async()=>{
  const f=fixture();await f.core.adapter.init();let getters=0;const hostile=new Proxy({},{get(){getters++;throw Error('Closed port inspected arguments');}}) as never;
  await expect(f.core.adapter.assertResearchPurchaseAuthority(hostile)).rejects.toThrow(PostgresStorageUnavailable);
  for(const candidate of [f.core.adapter,new Proxy(f.core.adapter,{}),{}] as never[])await expect(f.transport.bindRegistrationSponsor(candidate)).rejects.toThrow(PostgresStorageUnavailable);
  await expect(f.core.adapter.admitRegistrationSponsor!(hostile,hostile)).rejects.toThrow(PostgresStorageUnavailable);
  expect(getters).toBe(0);expect(f.call).not.toHaveBeenCalled();
 });
 it('refuses current-context loss and an uninitialized Core before caller inspection',async()=>{
  const f=fixture();let getters=0;const hostile=new Proxy({},{get(){getters++;throw Error('Current context must precede arguments');}}) as never;
  await expect(f.core.adapter.createA2aOrder(hostile)).rejects.toThrow('adapter_not_initialized');expect(f.call).not.toHaveBeenCalled();await f.core.adapter.init();f.revoke();
  await expect(f.core.adapter.reservePrivateResearchIntent(hostile)).rejects.toThrow(PostgresStorageUnavailable);await expect(f.core.adapter.getArticleOffer(hostile,hostile)).rejects.toThrow(PostgresStorageUnavailable);expect(getters).toBe(0);expect(f.call).not.toHaveBeenCalled();
 });
 const mutations=['issueSessionGrantConsent','issueSourceClaimChallenge','claimSourceUpkeep','upsertSource','setSourceMeta','verifySourceIfUnchanged','createA2aOrder','claimA2aFailedOriginalFulfillment','recordPayment','admitBrowserJournal','setArticleOffer','recordWithdrawal','upsertPublicReference','reservePrivateResearchIntent','reserveOnramp','claimResearchPurchase','saveQueryRun','beginPaperEnrollment','admitRegistrationSponsor'] as const;
 it.each(mutations)('retains readonly refusal before caller getters or SQL for %s',async name=>{
  const f=fixture(true);await f.core.adapter.init();let getters=0;const hostile=new Proxy({},{get(){getters++;throw Error('Readonly arguments inspected');},ownKeys(){getters++;throw Error('Readonly keys inspected');}});
  const method=Reflect.get(f.core.adapter,name);expect(typeof method).toBe('function');
  if(typeof method!=='function')throw Error('Expected prepared native mutation');
  await expect(Reflect.apply(method,f.core.adapter,[hostile,hostile,hostile,hostile])).rejects.toThrow();expect(getters).toBe(0);expect(f.call).not.toHaveBeenCalled();
 });
 it.each([false,true])('retires acquired methods and suppresses late completion (write=%s)',async write=>{
  const f=fixture();await f.core.adapter.init();const acquired=f.core.adapter.getArticleOffer;let finish!:(value:unknown)=>void;f.call.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=write?f.core.adapter.markA2aOrderPaymentStarted('synthetic-order',at):acquired('synthetic-source','synthetic-item');const rejected=expect(pending).rejects.toThrow(write?PostgresDomainWriteOutcomeUnknown:'adapter_not_initialized');f.core.hooks.close();finish(write?true:null);await rejected;
  let getters=0;const hostile=new Proxy({},{get(){getters++;throw Error('Closed arguments inspected');}}) as never;await expect(acquired(hostile,hostile)).rejects.toThrow('adapter_not_initialized');expect(getters).toBe(0);expect(f.call).toHaveBeenCalledOnce();
 });
 it('preserves unknown submitted writes without retry or fallback',async()=>{
  const f=fixture();await f.core.adapter.init();const unknown=new PostgresDomainWriteOutcomeUnknown();f.call.mockRejectedValueOnce(unknown);await expect(f.core.adapter.markA2aOrderResultSaving('synthetic-order',at)).rejects.toBe(unknown);expect(f.call).toHaveBeenCalledOnce();
 });
 it('creates no genuine facade, issuer, writer admission or extra Source methods',async()=>{
  const f=fixture();await f.core.adapter.init();for(const candidate of [f.core.adapter,f.transport,f.stores,new Proxy(f.core.adapter,{})])for(const access of ['read','write'] as const)await expect(assertPostgresRuntimeIdentity(candidate,access)).rejects.toThrow('adapter_not_initialized');
  expect(Object.hasOwn(f.core.adapter,'claimA2aOriginal')).toBe(false);expect(Object.hasOwn(f.core.adapter,'bindRegistrationSponsor')).toBe(false);expect(Object.hasOwn(f.core.adapter,'scanPaymentRows')).toBe(false);await expect(createPostgresRuntimeAdapter()).rejects.toThrow('adapter_not_initialized');expect(f.call).not.toHaveBeenCalled();
 });
});
