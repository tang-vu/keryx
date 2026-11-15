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
import { captureHostedSourceClaimPolicy,sourceClaimPolicySelector,sourceClaimPolicyRuntime } from './source-claim-purchase-policy';
import { capturePaymentEventRow } from './payment-events-packet';
import type { PostgresHostedPaymentProtocol } from './hosted-ledger-transport';
const micro=z.string().regex(/^(0|[1-9][0-9]{0,15})$/).refine(v=>BigInt(v)<=BigInt(Number.MAX_SAFE_INTEGER));
const accounting=z.object({retainedMicroUsdc:micro,confirmedMicroUsdc:micro}).strict();
export interface PostgresHostedAdmissionPort {admitHostedAuthorization(input:HostedAuthorizationAdmission):Promise<string>;}
/** Fixed native admission with digest-bound current SOURCE policy capture.
 * This port grants no installed provenance, custody, signing or provider access. */
export function composePostgresHostedAdmission(channel:PostgresDomainChannel,identity:StorageIdentity,readOnly:boolean,protocol:PostgresHostedPaymentProtocol='legacy-v1'):PostgresHostedAdmissionPort{
 const expected=validateStorageIdentity(identity),fail=()=>{throw new PostgresStorageUnavailable();};
 if(typeof readOnly!=='boolean'||protocol!=='legacy-v1'&&protocol!=='source-payment-originals-v1')fail();
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
  }
  // PostgreSQL identifiers cannot carry NUL or unpaired UTF-16. Reject before
  // dispatch; JSON escape bytes in a later paid answer are a separate protocol.
  const strings=[context.queryId,context.sourceId,context.itemId,...(context.privateJob?Object.values(context.privateJob):[])];
  if(strings.some(v=>v!==null&&(v.includes('\0')||Buffer.from(v).toString('utf8')!==v)))fail();
  // Source supplies these exact cells at creation. The fixed SQL producer fills
  // only created_at, from its clock after admission gates and the writer lock.
  // This null is a template slot; it is never retained as an imported original.
  const paymentTemplateWire=protocol==='legacy-v1'||context.privateJob?null:capturePaymentEventRow({
   id:'x402:'+nonce,created_at:null,kind:context.kind,query_id:context.queryId,source_id:context.sourceId,
   source_name:context.kind==='operating-fee'?'Keryx operating fee':context.sourceId,payer:policy.signer,
   payee:String(payload.message.to).toLowerCase(),amount_usdc:amount/1e6,weight:null,rationale:null,tx_hash:null,
   network:ARC_MAINNET_PROFILE.networkId,settled:0,settlement_status:'pending',authorization_id:nonce,
   authorization_expires_at:new Date(Number(payload.message.validBefore)*1000).toISOString(),grant_epoch:null,
   origin:'engine',item_id:context.itemId,item_title:null,item_url:null,content_version:null,item_published_at:null,
   offer_id:null,list_price_usdc:null,authorization_phase:'prepared',
  }).rowWire;
  const admissionWire=protocol==='source-payment-originals-v1'?canonicalJson({originalWire:original,paymentTemplateWire}):original;
  if(Buffer.byteLength(admissionWire)>32768)fail();
  let runtimeWire:string|null=null,recheckSource:(()=>void)|null=null;
  if(context.kind!=='operating-fee'){
   const runtime=sourceClaimPolicyRuntime();runtimeWire=canonicalJson(runtime);
   const selector=sourceClaimPolicySelector({sourceId:context.sourceId,identity:null});
   const snapshot=await channel.call('hostedSourcePolicySnapshot' as Parameters<PostgresDomainChannel['call']>[0],[selector]);
   if(channel.closed||canonicalJson(sourceClaimPolicyRuntime())!==runtimeWire)fail();
   const sourceInput={sourceId:context.sourceId,expected:context.sourceClaim??null,kind:context.kind,network:policy.network};
   const sourcePolicy=captureHostedSourceClaimPolicy(snapshot,sourceInput,runtime);
   recheckSource=()=>{captureHostedSourceClaimPolicy(snapshot,sourceInput,runtime);};
   feeWire=canonicalJson({sourcePolicy});
  }
  const result=await channel.call('hostedAdmitAuthorization',[canonicalJson(policy),hostedTreasuryPolicyDigest(policy),admissionWire,canonicalJson(totals),available,feeWire]);
  if(channel.closed||result!==nonce)throw new PostgresDomainWriteOutcomeUnknown();
  try{
   if(policy.expiresAtSeconds<=Math.floor(Date.now()/1000))fail();
   createSessionSigningPolicy(ARC_MAINNET_PROFILE).validatePayment(payload,policy.signer);
   if(context.kind==='operating-fee'&&canonicalJson(configuredOperatingFeePolicy(expected,policy.origin,policy.signer))!==feeWire)fail();
   if(runtimeWire!==null&&canonicalJson(sourceClaimPolicyRuntime())!==runtimeWire)fail();
   recheckSource?.();
  }catch{throw new PostgresDomainWriteOutcomeUnknown();}
  return nonce;
 }} satisfies PostgresHostedAdmissionPort);
}
