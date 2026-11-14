import { z } from 'zod';
import { ARC_MAINNET_PROFILE } from '../../arc-network-profile';
import { canonicalJson } from '../../canonical-json';
import { createSessionSigningPolicy } from '../../session/session-signing-policy';
import type { TypedDataPayload } from '../../session/session-signer-protocol';
import { hostedPaymentContextSchema,type HostedAuthorizationAdmission } from '../hosted-treasury-journal';
import { validateHostedTreasuryPolicy,hostedTreasuryPolicyDigest } from '../../payments/hosted-treasury-policy';
import { configuredOperatingFeePolicy,operatingFeePolicyDigest,operatingFeeMaxMicroUsdc } from '../../payments/operating-fee-policy';
import { validateStorageIdentity,type StorageIdentity } from '../storage-identity';
import { PostgresStorageUnavailable } from './connection';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
const micro=z.string().regex(/^(0|[1-9][0-9]{0,15})$/).refine(v=>BigInt(v)<=BigInt(Number.MAX_SAFE_INTEGER));
const accounting=z.object({retainedMicroUsdc:micro,confirmedMicroUsdc:micro}).strict();
export interface PostgresHostedAdmissionPort {admitHostedAuthorization(input:HostedAuthorizationAdmission):Promise<string>;}
/** Fixed native admission for unmanaged sources and original private executions.
 * Managed claims remain refused until their current-policy protocol is qualified.
 * This port grants no installed provenance, custody, signing or provider access. */
export function composePostgresHostedAdmission(channel:PostgresDomainChannel,identity:StorageIdentity,readOnly:boolean):PostgresHostedAdmissionPort{
 const expected=validateStorageIdentity(identity),fail=()=>{throw new PostgresStorageUnavailable();};
 if(typeof readOnly!=='boolean')fail();
 return Object.freeze({async admitHostedAuthorization(input){
  if(channel.closed||readOnly)fail();
  const policy=validateHostedTreasuryPolicy(input.policy,expected),context=hostedPaymentContextSchema.parse(input.context);
  const payload=JSON.parse(JSON.stringify(input.payload,(_key,v)=>typeof v==='bigint'?String(v):v)) as TypedDataPayload;
  createSessionSigningPolicy(ARC_MAINNET_PROFILE).validatePayment(payload,policy.signer);
  const amount=Number(payload.message.value),nonce=String(payload.message.nonce).toLowerCase();
  if(!Number.isSafeInteger(amount)||amount<=0||policy.expiresAtSeconds<=Math.floor(Date.now()/1000)||BigInt(context.queryBudgetMicroUsdc)>BigInt(policy.queryCapMicroUsdc))fail();
  const totals=accounting.parse(input.accounting),available=micro.parse(input.availableMicroUsdc),original=canonicalJson({context,payload});
  if(Buffer.byteLength(original)>8192)fail();
  let feeWire:string|null=null;
  if(context.kind==='operating-fee'){
   const fee=configuredOperatingFeePolicy(expected,policy.origin,policy.signer);
   if(context.operatingFee.policyDigest!==operatingFeePolicyDigest(fee)||String(payload.message.to).toLowerCase()!==fee.beneficiary||String(amount)!==context.operatingFee.amountMicroUsdc||BigInt(amount)>BigInt(operatingFeeMaxMicroUsdc(context.queryBudgetMicroUsdc)))fail();
   feeWire=canonicalJson(fee);
  }else if(context.sourceClaim)fail();
  // PostgreSQL identifiers cannot carry NUL or unpaired UTF-16. Reject before
  // dispatch; JSON escape bytes in a later paid answer are a separate protocol.
  const strings=[context.queryId,context.sourceId,context.itemId,...(context.privateJob?Object.values(context.privateJob):[])];
  if(strings.some(v=>v!==null&&(v.includes('\0')||Buffer.from(v).toString('utf8')!==v)))fail();
  const result=await channel.call('hostedAdmitAuthorization',[canonicalJson(policy),hostedTreasuryPolicyDigest(policy),original,canonicalJson(totals),available,feeWire]);
  if(channel.closed||result!==nonce)throw new PostgresDomainWriteOutcomeUnknown();
  try{
   if(policy.expiresAtSeconds<=Math.floor(Date.now()/1000))fail();
   createSessionSigningPolicy(ARC_MAINNET_PROFILE).validatePayment(payload,policy.signer);
   if(feeWire!==null&&canonicalJson(configuredOperatingFeePolicy(expected,policy.origin,policy.signer))!==feeWire)fail();
  }catch{throw new PostgresDomainWriteOutcomeUnknown();}
  return nonce;
 }} satisfies PostgresHostedAdmissionPort);
}
