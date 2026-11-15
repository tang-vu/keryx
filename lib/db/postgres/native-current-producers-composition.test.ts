import {describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {canonicalJson} from '../../canonical-json';
import {assembleNativePostgresBusinessCore,type NativePostgresBusinessCoreOptions} from '../supabase-adapter';
import {storageDomainClient,type StorageDomainAuthority} from '../supabase-authority';
import {STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity} from '../storage-identity';
import {syntheticA2aOriginal} from '../a2a-original-fixture';
import {ARC_MAINNET_PROFILE} from '../../arc-network-profile';
import type {Source} from '../../types';
import {composePostgresRuntimeTransport} from './runtime-transport';
import {assertPostgresRuntimeIdentity,createPostgresRuntimeAdapter} from './runtime-adapter';
import {PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel} from './domain-channel';
import {PostgresStorageUnavailable} from './connection';

const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',network:'eip155:5042',authorityMode:'mainnet-real',deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:'2026-11-15T00:00:00.000Z',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,provenanceDigest:'11'.repeat(32)};
const digest='22'.repeat(32),payer=`0x${'ab'.repeat(20)}`,id=`prv_${'cd'.repeat(32)}`,monthlyId=`monthly_${'ef'.repeat(32)}`;
const privateMethods=[
 ['getPrivateResearchIntent',false],['getPrivatePaymentState',false],['getPrivateResearchExecution',false],['getPrivateResearchResult',false],
 ['getPrivateResearchInterruption',false],['getPrivateTreasury',false],['listPrivateCreatorSubmissions',false],['getPrivateCreatorConfirmation',false],
 ['listPrivateResearchHistory',false],['getPrivateTreasurySummary',false],['listPrivateWorkerCandidates',false],['listPrivateReconciliationCandidates',false],
 ['reservePrivateResearchIntent',true],['reservePrivateTreasury',true],['claimPrivatePaymentSubmission',true],['confirmPrivatePayment',true],
 ['claimPrivateResearchExecution',true],['admitPrivateCreatorSubmission',true],['confirmPrivateCreatorSubmission',true],['savePrivateResearchResult',true],
 ['interruptPrivateResearch',true],['releasePrivateTreasury',true],
] as const;
const onrampMethods=[['reserveOnramp',true],['releaseOnramp',true]] as const;
const scholarlyMethods=[['getPaperState',false],['beginPaperEnrollment',true],['submitPaper',true],['reviewPaper',true],['getPaperAdmission',false]] as const;
const sponsorMethods=[['admitRegistrationSponsor',true],['getRegistrationSponsor',false],['getRegistrationSponsorExecution',false],['inspectRegistrationSponsorFunding',false],['transitionRegistrationSponsor',true]] as const;
const purchaseMethods=[['claimResearchPurchase',true],['createResearchMonthly',true],['getResearchMonthly',false],['redeemResearchMonthly',true]] as const;
const originalMethods=[['hasA2aOriginalSettlement',false],['createA2aOrder',true],['createOwnedA2aOrder',true],['getA2aOrder',false],['completeA2aOrder',true],['resolveA2aOrder',true],['listUnfinishedA2aOrders',false],['markA2aOrderPaymentStarted',true],['markA2aOrderResultSaving',true],['failA2aOrder',true]] as const;
const emptyPrivate={intentRowWire:null,paymentRowWire:null,executionRowWire:null,resultRowWire:null,interruptionRowWire:null,reservationRowWire:null,releaseRowWire:null,submissionsWire:'[]',confirmationsWire:'[]'};

// Raw fixed-protocol recordings test composition and lifecycle. Neither these
// responses nor the injected Core/guard is an installed native authority proof.
function fixture(readOnly=false,overrides:Partial<NativePostgresBusinessCoreOptions>={}){
 let closed=false,selected=true;
 const call=vi.fn<PostgresDomainChannel['call']>().mockResolvedValue(null),channel:PostgresDomainChannel={call,get closed(){return closed;},async close(){closed=true;}};
 const transport=composePostgresRuntimeTransport(channel,identity,digest,readOnly);
 const rpc=vi.fn<StorageDomainAuthority['rpcResult']>(async()=>{throw Error('Legacy RPC must not be selected');}),authority={rpcResult:rpc};
 const entry=()=>{if(!selected)throw Error('Selected manifest changed');};
 const core=assembleNativePostgresBusinessCore({identity,authority:{...authority,domainClient:()=>storageDomainClient(authority)},assertEntry:entry,verify:async()=>{},privateResearch:transport.privateResearch,onramp:transport.onramp,scholarly:transport.scholarly,registrationSponsor:transport.registrationSponsor,a2aOriginals:transport,researchPurchases:transport,...overrides});
 return {core,transport,channel,call,rpc,revoke:()=>{selected=false;},restore:()=>{selected=true;}};
}

describe('closed current producer composition',()=>{
 it('composes every named prepared group without prototype or extra-property exposure',async()=>{
  const f=fixture();await f.core.adapter.init();
  for(const [port,methods] of [[f.transport.privateResearch,privateMethods],[f.transport.onramp,onrampMethods],[f.transport.scholarly,scholarlyMethods],[f.transport.registrationSponsor,sponsorMethods]] as const){
   expect(Object.keys(port).sort()).toEqual(methods.map(([name])=>name).sort());
   for(const [name] of methods)expect(Object.getOwnPropertyDescriptor(f.core.adapter,name)).toMatchObject({enumerable:false,value:expect.any(Function)});
  }
  expect(Object.hasOwn(f.core.adapter,'claimA2aOriginal')).toBe(false);
  expect(Object.hasOwn(f.core.adapter,'bindRegistrationSponsor')).toBe(false);
  expect(Object.hasOwn(f.core.adapter,'scanPaymentRows')).toBe(false);
  expect(f.call).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();
 });
 it('uses actual typed private, monthly and scholarly reads with fixed arguments',async()=>{
  const f=fixture();await f.core.adapter.init();
  f.call.mockResolvedValueOnce(emptyPrivate);expect(await f.core.adapter.getPrivateResearchIntent(id,payer.toUpperCase().replace('0X','0x'))).toBeNull();
  expect(f.call.mock.calls[0]).toEqual(['privateResearchSnapshot',[id,JSON.stringify({payer})]]);
  f.call.mockResolvedValueOnce(null);expect(await f.core.adapter.getResearchMonthly(monthlyId)).toBeNull();expect(f.call.mock.calls[1]).toEqual(['researchMonthlyGet',[JSON.stringify({id:monthlyId})]]);
  f.call.mockResolvedValueOnce({identity,sourceDigest:digest});expect(await f.core.adapter.getPaperAdmission!('not-a-mainnet-grant')).toBeNull();expect(f.call.mock.calls[2]).toEqual(['nativeRuntimeAuthority',[]]);
  const refused=new PostgresStorageUnavailable();f.call.mockRejectedValueOnce(refused);await expect(f.core.adapter.getResearchMonthly(monthlyId)).rejects.toBe(refused);
  expect(f.call).toHaveBeenCalledTimes(4);expect(f.rpc).not.toHaveBeenCalled();
 });
 it('maps exact-original claims without admitting a bare mainnet queue claim',async()=>{
  const f=fixture(),original=syntheticA2aOriginal(9501,ARC_MAINNET_PROFILE);await f.core.adapter.init();
  await expect(f.core.adapter.claimNextA2aOrder('synthetic-worker','2026-11-15T00:00:00.000Z')).rejects.toThrow('invalid_operation');expect(f.call).not.toHaveBeenCalled();
  const captured={...original.binding},pending=f.core.adapter.claimNextA2aOrder('synthetic-worker','2026-11-15T00:00:00.000Z',captured);captured.payer=payer;expect(await pending).toBeNull();
  expect(f.call).toHaveBeenCalledExactlyOnceWith('a2aOriginalClaim',[canonicalJson(original.binding),'synthetic-worker','2026-11-15T00:00:00.000Z']);expect(f.rpc).not.toHaveBeenCalled();
 });
 it.each([...privateMethods,...onrampMethods,...purchaseMethods,...originalMethods,...sponsorMethods].filter(([,write])=>write).map(([name])=>name))('refuses readonly %s before input getters or dispatch',async name=>{
  const f=fixture(true);await f.core.adapter.init();const inspected=vi.fn(()=>{throw Error('Caller input inspected');}),poison=new Proxy({},{get:inspected,ownKeys:inspected});
  await expect(Reflect.apply(Reflect.get(f.core.adapter,name),f.core.adapter,[poison,poison,poison,poison])).rejects.toThrow();
  expect(inspected).not.toHaveBeenCalled();expect(f.call).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();
 });
 it('keeps readonly expected-original claims and scholarly Source refusals ahead of getters',async()=>{
  const f=fixture(true);await f.core.adapter.init();const inspected=vi.fn(()=>{throw Error('Caller input inspected');}),poison=new Proxy({},{get:inspected,ownKeys:inspected}) as never;
  await expect(f.core.adapter.claimNextA2aOrder(poison,poison,poison)).rejects.toThrow(PostgresStorageUnavailable);
  await expect(f.core.adapter.beginPaperEnrollment!(poison,poison)).rejects.toThrow('Scholarly enrollment is unsupported');
  await expect(f.core.adapter.submitPaper!(poison)).rejects.toThrow('Scholarly enrollment is unsupported');
  await expect(f.core.adapter.reviewPaper!(poison)).rejects.toThrow('Scholarly review is unsupported');
  expect(inspected).not.toHaveBeenCalled();expect(f.call).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();
 });
 it('does not turn optional composition into purchase authority or unsafe publication capture',async()=>{
  const f=fixture();await f.core.adapter.init();
  await expect(f.core.adapter.assertResearchPurchaseAuthority(identity.network)).rejects.toThrow('invalid_operation');
  await expect(f.core.adapter.saveQueryRun({} as never,{visibility:'public'})).rejects.toThrow('privacy_unavailable');
  expect(f.call).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();
 });
 it('keeps the sponsor facade cycle closed to Core, forged, proxy and arbitrary guard objects',async()=>{
  const f=fixture();await f.core.adapter.init();const inspected=vi.fn(()=>{throw Error('Caller input inspected');}),poison=new Proxy({},{get:inspected,ownKeys:inspected}) as never;
  for(const candidate of [f.core.adapter,new Proxy(f.core.adapter,{}),Object.create(f.core.adapter),{assertEntry:()=>{},verify:async()=>{}}] as never[]){
   await expect(f.transport.bindRegistrationSponsor(candidate)).rejects.toThrow(PostgresStorageUnavailable);
   await expect(f.core.adapter.admitRegistrationSponsor!(poison,poison)).rejects.toThrow(PostgresStorageUnavailable);
  }
  expect(inspected).not.toHaveBeenCalled();expect(f.call).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();
 });
 it.each([false,true])('suppresses actual typed-port late completion after terminal Core close (write=%s)',async write=>{
  const f=fixture();await f.core.adapter.init();let finish!:(value:unknown)=>void;f.call.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=write?f.core.adapter.markA2aOrderPaymentStarted('synthetic-order','2026-11-15T00:00:00.000Z'):f.core.adapter.getPrivateResearchIntent(id,payer);
  const denied=expect(pending).rejects.toThrow(write?PostgresDomainWriteOutcomeUnknown:'adapter_not_initialized');f.core.hooks.close();finish(write?true:emptyPrivate);await denied;
  f.restore();await expect(f.core.adapter.getPrivateResearchIntent(id,payer)).rejects.toThrow('adapter_not_initialized');expect(f.call).toHaveBeenCalledOnce();expect(f.rpc).not.toHaveBeenCalled();
 });
 it('preserves an unknown submitted write without a readback, retry or fallback',async()=>{
  const f=fixture();await f.core.adapter.init();const unknown=new PostgresDomainWriteOutcomeUnknown();f.call.mockRejectedValueOnce(unknown);
  await expect(f.core.adapter.markA2aOrderResultSaving('synthetic-order','2026-11-15T00:00:00.000Z')).rejects.toBe(unknown);expect(f.call).toHaveBeenCalledOnce();expect(f.rpc).not.toHaveBeenCalled();
 });
 it('keeps all injected assemblies negative for genuine installed identity and the writer factory',async()=>{
  const f=fixture();await f.core.adapter.init();
  for(const candidate of [f.core.adapter,new Proxy(f.core.adapter,{}),f.transport,{}])for(const access of ['read','write'] as const)await expect(assertPostgresRuntimeIdentity(candidate,access)).rejects.toThrow('adapter_not_initialized');
  await expect(createPostgresRuntimeAdapter()).rejects.toThrow('adapter_not_initialized');expect(f.call).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();
 });
});

describe('Core post-await generic mutation classification',()=>{
 const source:Source={id:'synthetic-source',name:'Synthetic',url:'https://synthetic.invalid',description:'Synthetic composition only',walletAddress:payer,fetchPrice:0,tags:[],authors:[],createdAt:'2026-11-15T00:00:00.000Z',active:true,verified:false};
 it.each(['context','close'] as const)('classifies source-upsert success followed by %s as unknown',async change=>{
  const work=vi.fn(async()=>{}),f=fixture(false,{sourceUpsert:work});await f.core.adapter.init();work.mockImplementationOnce(async()=>{if(change==='context')f.revoke();else f.core.hooks.close();});
  await expect(f.core.adapter.upsertSource(source)).rejects.toThrow(PostgresDomainWriteOutcomeUnknown);expect(work).toHaveBeenCalledExactlyOnceWith(source);expect(f.rpc).not.toHaveBeenCalled();
 });
 it.each(['call','rpc'] as const)('classifies generic native %s write after successful ACK and authority loss as unknown',async method=>{
  const f=fixture();await f.core.adapter.init();f.rpc.mockImplementationOnce(async()=>{f.revoke();return {data:null,error:null};});
  const pending=method==='call'?f.core.adapter.setSourceNotify('synthetic-source','https://synthetic.invalid','synthetic-secret'):f.core.adapter.createAuthChallenge('synthetic-hash',0,1);
  await expect(pending).rejects.toThrow(PostgresDomainWriteOutcomeUnknown);expect(f.rpc).toHaveBeenCalledOnce();expect(f.call).not.toHaveBeenCalled();
 });
 it('keeps generic native reads and known predispatch refusals out of unknown-write classification',async()=>{
  const f=fixture();await f.core.adapter.init();const before=new PostgresStorageUnavailable();f.rpc.mockRejectedValueOnce(before);
  await expect(f.core.adapter.setSourceNotify('synthetic-source','https://synthetic.invalid','synthetic-secret')).rejects.toBe(before);
  f.rpc.mockImplementationOnce(async()=>{f.revoke();return {data:null,error:null};});await expect(f.core.adapter.getSourceNotify('synthetic-source')).rejects.toThrow('Selected manifest changed');expect(f.rpc).toHaveBeenCalledTimes(2);
 });
});
