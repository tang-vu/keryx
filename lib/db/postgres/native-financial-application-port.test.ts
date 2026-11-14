import { describe,expect,it,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { STORAGE_MAINNET_PROFILE_DIGEST,storageIdentityDigest,type StorageIdentity } from '../storage-identity';
import type { SessionGrantConsent } from '../../payments/session-grant-consent';
import type { HostedTreasuryPolicy } from '../../payments/hosted-treasury-policy';
import { composePostgresOwnerWithdrawalTransport } from './owner-withdrawal-transport';
import { composePostgresHostedAdmission } from './hosted-admission-transport';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
import { PostgresStorageUnavailable } from './connection';
import { composeNativeFinancialApplicationPort,type NativeFinancialApplicationPort } from './native-financial-application-port';

const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',network:'eip155:5042',authorityMode:'mainnet-real',deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),
 enrolledAt:'2026-11-12T00:00:00.000Z',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,provenanceDigest:'11'.repeat(32)};
const signer=`0x${'ab'.repeat(20)}`,nonce=`0x${'12'.repeat(32)}`,signature=`0x${'34'.repeat(65)}`;
const consent:SessionGrantConsent={format:'keryx-session-grant-consent-v1',network:'eip155:5042',origin:'https://keryx.cc',ownerAddr:signer,sessAddr:`0x${'cd'.repeat(20)}`,grantEpoch:randomUUID(),capMicroUsdc:'10',expirySeconds:'2000000000'};
const policy=():HostedTreasuryPolicy=>({format:'keryx-hosted-treasury-policy-v1',network:'eip155:5042',storageIdentityDigest:storageIdentityDigest(identity),origin:'https://keryx.cc',signer,lifetimeCapMicroUsdc:'100',queryCapMicroUsdc:'10',expiresAtSeconds:Math.floor(Date.now()/1000)+60});
const writeNames=[
 'issueSessionGrantConsent','consumeSessionGrantConsent','admitHostedTreasuryPolicy','admitHostedAuthorization','submitHostedAuthorization','confirmHostedAuthorization',
 'reserveSessionWithdrawal','authorizeSessionWithdrawal','cancelSessionWithdrawal','abortSessionWithdrawal','completeSessionWithdrawal',
 'admitCreatorOwnerWithdrawal','completeCreatorOwnerWithdrawal','reserveCreatorWithdrawal','claimCreatorWithdrawalTransfer','saveCreatorWithdrawalAttestation',
] as const satisfies readonly (keyof NativeFinancialApplicationPort)[];
function fixture(readOnly=false){
 let closed=false;
 const call=vi.fn<PostgresDomainChannel['call']>().mockResolvedValue(null),channel:PostgresDomainChannel={call,get closed(){return closed;},async close(){closed=true;}};
 const transport={...composePostgresOwnerWithdrawalTransport(channel,identity),...composePostgresHostedAdmission(channel,identity,readOnly)};
 return {call,channel,transport,port:composeNativeFinancialApplicationPort(transport,readOnly,()=>closed),close:()=>{closed=true;}};
}

describe('native financial application names over fixed protocols',()=>{
 it('uses consent aliases and captures the original synchronously before dispatch awaits',async()=>{
  const {port,call}=fixture(),input={...consent};
  const pending=port.issueSessionGrantConsent(input);input.capMicroUsdc='999';await pending;
  expect(call.mock.calls[0][0]).toBe('issue');expect(JSON.parse(call.mock.calls[0][1][0]!)).toEqual(consent);
  await port.consumeSessionGrantConsent(consent,signature,signature);
  expect(call.mock.calls[1][0]).toBe('consume');expect(call.mock.calls[1][1].slice(1)).toEqual([signature,signature]);
  expect(await port.getSessionGrantConsent(signer,consent.grantEpoch)).toBeNull();expect(call.mock.calls[2]).toEqual(['get',[signer,consent.grantEpoch]]);
 });
 it('preserves the mainnet confirmed-spend branch and existing selector validation',async()=>{
  const {port,call}=fixture(true),upper=signer.toUpperCase().replace('0X','0x');
  call.mockResolvedValueOnce(12);expect(await port.browserSignerRetainedSpendMicro(upper)).toBe(12);expect(call.mock.calls[0]).toEqual(['retained',[signer]]);
  call.mockResolvedValueOnce({hasAuthorityHistory:true,confirmedSpentMicroUsdc:'9007199254740991',retainedSpentMicroUsdc:'9007199254740991',postBaselineConfirmedDebitMicroUsdc:'0'});
  expect(await port.browserSignerConfirmedSpendMicro(upper)).toBe(Number.MAX_SAFE_INTEGER);expect(call.mock.calls[1]).toEqual(['funding',[signer,null]]);
  await expect(port.sessionFundingAccounting(upper)).rejects.toThrow(PostgresStorageUnavailable);expect(call).toHaveBeenCalledTimes(2);
 });
 it('binds receiver-dependent aliases once and leaves optional arguments untouched',async()=>{
  const {transport}=fixture(),seen:unknown[][]=[];
  transport.get=async function(...args){expect(this).toBe(transport);seen.push(args);return null;};
  const port=composeNativeFinancialApplicationPort(transport,false,()=>false);
  transport.get=async()=>{throw Error('replacement must not be selected');};
  expect(await port.getSessionGrantConsent(signer,consent.grantEpoch)).toBeNull();expect(seen).toEqual([[signer,consent.grantEpoch]]);
 });
 it('preserves hosted custody-role validation and exact fixed policy binding',async()=>{
  const {port,call}=fixture(),p=policy();await port.admitHostedTreasuryPolicy(p,'private');
  expect(call.mock.calls[0][0]).toBe('hostedPolicy');expect(JSON.parse(call.mock.calls[0][1][0]!)).toEqual(p);expect(call.mock.calls[0][1][2]).toBe('private');
  await expect(port.admitHostedTreasuryPolicy(p,'invalid' as never)).rejects.toThrow(PostgresStorageUnavailable);
  await expect(port.admitHostedTreasuryPolicy({...p,network:'eip155:5042002'} as never,'public')).rejects.toThrow();expect(call).toHaveBeenCalledTimes(1);
 });
 it.each(writeNames)('refuses readonly %s before touching caller-owned fields',async name=>{
  const {port,call}=fixture(true),access=vi.fn(()=>{throw Error('caller field accessed');}),poison=new Proxy({},{get:access,ownKeys:access});
  const invoke=port[name] as (...args:unknown[])=>Promise<unknown>;
  await expect(invoke(poison,poison,poison,poison)).rejects.toThrow(PostgresStorageUnavailable);expect(access).not.toHaveBeenCalled();expect(call).not.toHaveBeenCalled();
 });
 it('uses fixed creator history and session snapshots without legacy fallback or invented absence',async()=>{
  const {port,call}=fixture();call.mockResolvedValueOnce([]);
  expect(await port.listCreatorWithdrawalHistory(signer,undefined,3)).toEqual({requests:[],nextCursor:null});
  expect(call.mock.calls[0]).toEqual(['creatorHistory',[signer,null,null,'3']]);
  expect(await port.getSessionWithdrawal(nonce,signer)).toBeNull();expect(call.mock.calls[1]).toEqual(['withdrawalRead',[nonce,signer]]);
  call.mockRejectedValueOnce(new PostgresStorageUnavailable());await expect(port.getCreatorWithdrawal(nonce,signer)).rejects.toThrow(PostgresStorageUnavailable);expect(call).toHaveBeenCalledTimes(3);
  expect(Object.keys(port)).toHaveLength(33);expect(Object.hasOwn(port,'listSessionWithdrawalPayments')).toBe(false);
 });
 it('propagates an unknown commit unchanged without a second dispatch',async()=>{
  const {port,call}=fixture(),unknown=new PostgresDomainWriteOutcomeUnknown();call.mockRejectedValueOnce(unknown);
  await expect(port.confirmHostedAuthorization(signer,nonce,'synthetic-receipt')).rejects.toBe(unknown);expect(call).toHaveBeenCalledTimes(1);
 });
 it('refuses closed entry and suppresses results when closed during an await',async()=>{
  const f=fixture();f.close();await expect(f.port.browserSignerConfirmedSpendMicro(signer)).rejects.toThrow(PostgresStorageUnavailable);expect(f.call).not.toHaveBeenCalled();
  for(const write of [false,true]){
   const {transport}=fixture();let closed=false,finish!:(value:never)=>void;
   const pending=new Promise<never>(resolve=>{finish=resolve;});
   transport.hostedTreasuryAccounting=async()=>pending;transport.confirmHostedAuthorization=async()=>pending;
   const port=composeNativeFinancialApplicationPort(transport,false,()=>closed);
   const result=write?port.confirmHostedAuthorization(signer,nonce,'synthetic-receipt'):port.hostedTreasuryAccounting(signer);
   const outcome=expect(result).rejects.toThrow(write?PostgresDomainWriteOutcomeUnknown:PostgresStorageUnavailable);
   closed=true;finish(undefined as never);await outcome;
  }
 });
});
