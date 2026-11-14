import { describe,expect,it,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { assembleNativePostgresBusinessCore } from '../supabase-adapter';
import { storageDomainClient,type StorageDomainAuthority } from '../supabase-authority';
import { STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity } from '../storage-identity';
import type { SessionGrantConsent } from '../../payments/session-grant-consent';
import { composePostgresRuntimeTransport } from './runtime-transport';
import { assertPostgresRuntimeIdentity,createPostgresRuntimeAdapter } from './runtime-adapter';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
import { PostgresStorageUnavailable } from './connection';
import type { NativeFinancialApplicationPort } from './native-financial-application-port';

const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',network:'eip155:5042',authorityMode:'mainnet-real',deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:'2026-11-15T00:00:00.000Z',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,provenanceDigest:'11'.repeat(32)};
const signer=`0x${'ab'.repeat(20)}`;
const consent:SessionGrantConsent={format:'keryx-session-grant-consent-v1',network:'eip155:5042',origin:'https://keryx.cc',ownerAddr:signer,sessAddr:`0x${'cd'.repeat(20)}`,grantEpoch:randomUUID(),capMicroUsdc:'10',expirySeconds:'2000000000'};
const writeNames=[
 'issueSessionGrantConsent','consumeSessionGrantConsent','admitHostedTreasuryPolicy','admitHostedAuthorization','submitHostedAuthorization','confirmHostedAuthorization',
 'reserveSessionWithdrawal','authorizeSessionWithdrawal','cancelSessionWithdrawal','abortSessionWithdrawal','completeSessionWithdrawal',
 'admitCreatorOwnerWithdrawal','completeCreatorOwnerWithdrawal','reserveCreatorWithdrawal','claimCreatorWithdrawalTransfer','saveCreatorWithdrawalAttestation',
] as const satisfies readonly (keyof NativeFinancialApplicationPort)[];

// Synthetic protocol responses exercise shared composition only. No installed
// provenance, real receipt, authority callback or native database is fabricated.
function fixture(readOnly=false,configured=true){
 let closed=false;
 const call=vi.fn<PostgresDomainChannel['call']>().mockResolvedValue(null),channel:PostgresDomainChannel={call,get closed(){return closed;},async close(){closed=true;}};
 const transport=composePostgresRuntimeTransport(channel,identity,'22'.repeat(32),readOnly);
 const rpc=vi.fn<StorageDomainAuthority['rpcResult']>(async()=>{throw Error('legacy RPC must not be selected');}),authority={rpcResult:rpc};
 const core=assembleNativePostgresBusinessCore({identity,authority:{...authority,domainClient:()=>storageDomainClient(authority)},assertEntry:()=>{},verify:async()=>{},...(configured?{financialApplication:transport.financialApplication}:{})});
 return {core,transport,call,rpc,channel};
}

describe('optional native financial core composition',()=>{
 it('keeps unconfigured financial methods and unported payment history closed',async()=>{
  const f=fixture(false,false);await f.core.adapter.init();
  await expect(f.core.adapter.issueSessionGrantConsent(consent)).rejects.toThrow('not admitted');
  await expect(f.core.adapter.listSessionWithdrawalPayments(signer)).rejects.toThrow('not admitted');
  expect(f.call).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();
 });
 it('captures through actual fixed ports before awaiting and never invokes legacy RPC',async()=>{
  const f=fixture();await expect(f.core.adapter.issueSessionGrantConsent(consent)).rejects.toThrow('adapter_not_initialized');expect(f.call).not.toHaveBeenCalled();
  await f.core.adapter.init();const original={...consent},pending=f.core.adapter.issueSessionGrantConsent(original);original.capMicroUsdc='999';await pending;
  expect(f.call.mock.calls[0][0]).toBe('issue');expect(JSON.parse(f.call.mock.calls[0][1][0]!)).toEqual(consent);
  expect(await f.core.adapter.getSessionGrantConsent(signer,consent.grantEpoch)).toBeNull();expect(f.call.mock.calls[1]).toEqual(['get',[signer,consent.grantEpoch]]);
  expect(Object.keys(f.transport.financialApplication)).toHaveLength(33);
  for(const name of Object.keys(f.transport.financialApplication)){
   const descriptor=Object.getOwnPropertyDescriptor(f.core.adapter,name);expect(descriptor?.enumerable).toBe(false);expect(typeof descriptor?.value).toBe('function');
  }
  await expect(f.core.adapter.listSessionWithdrawalPayments(signer)).rejects.toThrow('not admitted');expect(f.call).toHaveBeenCalledTimes(2);expect(f.rpc).not.toHaveBeenCalled();
 });
 it.each(writeNames)('refuses readonly core %s before caller getters or SQL',async name=>{
  const f=fixture(true);await f.core.adapter.init();const fields=vi.fn(()=>{throw Error('caller fields touched');}),poison=new Proxy({},{get:fields,ownKeys:fields});
  const invoke=f.core.adapter[name] as (...args:unknown[])=>Promise<unknown>;
  await expect(invoke(poison,poison,poison,poison)).rejects.toThrow(PostgresStorageUnavailable);
  expect(fields).not.toHaveBeenCalled();expect(f.call).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();
 });
 it('preserves selected mainnet accounting and current protocol refusals without fallback',async()=>{
  const f=fixture(true);await f.core.adapter.init();
  f.call.mockResolvedValueOnce({hasAuthorityHistory:true,confirmedSpentMicroUsdc:'12',retainedSpentMicroUsdc:'20',postBaselineConfirmedDebitMicroUsdc:'0'});
  expect(await f.core.adapter.browserSignerConfirmedSpendMicro(signer.toUpperCase().replace('0X','0x'))).toBe(12);expect(f.call.mock.calls[0]).toEqual(['funding',[signer,null]]);
  const refused=new PostgresStorageUnavailable();f.call.mockRejectedValueOnce(refused);
  await expect(f.core.adapter.getSessionGrantConsent(signer,consent.grantEpoch)).rejects.toBe(refused);expect(f.call).toHaveBeenCalledTimes(2);expect(f.rpc).not.toHaveBeenCalled();
 });
 it('propagates an unknown write unchanged with exactly one fixed dispatch',async()=>{
  const f=fixture();await f.core.adapter.init();const unknown=new PostgresDomainWriteOutcomeUnknown();f.call.mockRejectedValueOnce(unknown);
  await expect(f.core.adapter.issueSessionGrantConsent(consent)).rejects.toBe(unknown);expect(f.call).toHaveBeenCalledOnce();expect(f.rpc).not.toHaveBeenCalled();
 });
 it.each([false,true])('suppresses late results after core disposal (write=%s)',async write=>{
  const f=fixture();await f.core.adapter.init();let finish!:(value:null)=>void;
  f.call.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const result=write?f.core.adapter.issueSessionGrantConsent(consent):f.core.adapter.getSessionGrantConsent(signer,consent.grantEpoch);
  const denied=expect(result).rejects.toThrow(write?PostgresDomainWriteOutcomeUnknown:'adapter_not_initialized');f.core.hooks.close();finish(null);await denied;
  await expect(f.core.adapter.issueSessionGrantConsent(consent)).rejects.toThrow('adapter_not_initialized');expect(f.call).toHaveBeenCalledOnce();expect(f.rpc).not.toHaveBeenCalled();
 });
 it('retains the channel close unknown outcome without a replacement dispatch',async()=>{
  const f=fixture();await f.core.adapter.init();let finish!:(value:null)=>void;
  f.call.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const result=f.core.adapter.issueSessionGrantConsent(consent),denied=expect(result).rejects.toThrow(PostgresDomainWriteOutcomeUnknown);
  await f.channel.close();finish(null);await denied;expect(f.call).toHaveBeenCalledOnce();expect(f.rpc).not.toHaveBeenCalled();
 });
 it('grants no installed identity or factory writer provenance',async()=>{
  const f=fixture();await f.core.adapter.init();
  for(const candidate of [f.core.adapter,new Proxy(f.core.adapter,{}),Object.create(f.core.adapter),f.transport])for(const access of ['read','write'] as const)await expect(assertPostgresRuntimeIdentity(candidate,access)).rejects.toThrow('adapter_not_initialized');
  await expect(createPostgresRuntimeAdapter()).rejects.toThrow('adapter_not_initialized');expect(f.call).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();
 });
});
