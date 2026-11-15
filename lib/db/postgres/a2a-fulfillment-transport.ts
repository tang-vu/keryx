import type { A2aFulfillmentClaim,A2aFulfillmentCompletion,A2aFulfillmentRecord,FulfillmentAuthority,FulfillmentClaimInput } from '../../a2a/fulfillment-authority';
import { validateFulfilledQueryRun } from '../../a2a/failed-original-fulfillment-protocol';
import type { FulfillmentEvidenceCapability } from '../../a2a/fulfillment-supplement-evidence';
import { fulfilledOriginalOrders,fulfillmentResolution } from '../../a2a/fulfillment-delivery';
import { matchesA2aOriginalBinding } from '../../a2a/original-claim';
import { canonicalJson } from '../../canonical-json';
import { PostgresStorageUnavailable } from './connection';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
import { composePostgresA2aOriginals } from './a2a-originals-transport';
import { captureNativeFulfillmentAuthority,captureNativeFulfillmentClaim,captureNativeFulfillmentCompletion,nativeFulfillmentClaimPacket,
 nativeFulfillmentCompletionPacket,nativeFulfillmentVerifyPacket,readNativeFulfillmentRecord,readNativeFulfillmentSnapshot,type NativeFulfillmentSnapshot } from './a2a-fulfillment-packet';

export interface PostgresA2aFulfillmentPort{
 claimA2aFailedOriginalFulfillment(input:FulfillmentClaimInput):Promise<A2aFulfillmentClaim|null>;
 getA2aFailedOriginalFulfillment(originalId:string):Promise<A2aFulfillmentRecord|null>;
 completeA2aFailedOriginalFulfillment(input:A2aFulfillmentCompletion,capability?:FulfillmentEvidenceCapability):Promise<boolean>;
 hasA2aFailedOriginalFulfillment(authority:FulfillmentAuthority,capability?:FulfillmentEvidenceCapability):Promise<boolean>;
}
const unavailable=()=>new PostgresStorageUnavailable(),same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
const originalId=(value:string)=>{if(typeof value!=='string'||!/^a2a_[a-f0-9]{64}$/.test(value))throw unavailable();return value;};
/** Fixed data protocol only. Composition supplies no installed writer/proof,
 * supplier permission, evidence capability, provider work or retry authority. */
export function composePostgresA2aFulfillment(channel:PostgresDomainChannel,readOnly:boolean):PostgresA2aFulfillmentPort{
 if(arguments.length!==2||typeof readOnly!=='boolean')throw unavailable();
 const live=()=>{if(channel.closed)throw unavailable();},write=()=>{live();if(readOnly)throw unavailable();};
 const originals=composePostgresA2aOriginals(channel,readOnly);
 const snapshot=async(id:string)=>{const result=await channel.call('a2aFulfillmentSnapshot',[id]);live();return readNativeFulfillmentSnapshot(result);};
 const validated=(state:NativeFulfillmentSnapshot,authority:FulfillmentAuthority,capability?:FulfillmentEvidenceCapability)=>{
  const {record,original,run,value}=state;
  if(!record?.completion||!original||!run||!same(record.claim.authority,authority)||!value.settled||!value.noCreatorAttempts
   ||!matchesA2aOriginalBinding(original,authority.original)||original.status!=='completed'||original.errorCode!==null
   ||original.startedAt!==record.claim.failedOrder.startedAt||original.workerId!==record.claim.failedOrder.workerId||original.executionJournalVersion!==1
   ||original.paymentStartedAt!==null||original.resultSavingAt!==record.completion.completedAt||original.updatedAt!==record.completion.completedAt
   ||!same(original.resolution,fulfillmentResolution(record.claim,record.completion)))return false;
  try{validateFulfilledQueryRun(run,record.claim,record.completion,capability);}catch{return false;}
  return fulfilledOriginalOrders(run,record.claim,record.completion).some(expected=>same(original,expected));
 };
 const verify=async(state:NativeFulfillmentSnapshot,authority:FulfillmentAuthority,capability?:FulfillmentEvidenceCapability)=>{
  if(!validated(state,authority,capability))return false;
  const result=await channel.call('a2aFulfillmentVerify',[authority.original.id,nativeFulfillmentVerifyPacket(state)]);live();
  if(typeof result!=='boolean')throw unavailable();
  // Final protected-file/WeakMap validation is synchronous after the last native
  // observation. No stale body verdict or callback can mint evidence provenance.
  return result&&validated(state,authority,capability);
 };
 return Object.freeze({
  async claimA2aFailedOriginalFulfillment(raw){
   write();const input=captureNativeFulfillmentClaim(raw),order=await originals.getA2aOrder(input.authority.original.id);live();if(!order)return null;
   const packet=nativeFulfillmentClaimPacket(input,order);if(packet===null)return null;
   const result=await channel.call('a2aFulfillmentClaim',[input.authority.original.id,packet]);
   if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();if(result===null)return null;
   try{const record=readNativeFulfillmentRecord(result);if(!record||record.completion!==null||!same(record.claim,{...input,failedOrder:order}))throw unavailable();return record.claim;}
   catch{throw new PostgresDomainWriteOutcomeUnknown();}
  },
  async getA2aFailedOriginalFulfillment(raw){live();const id=originalId(raw),result=await channel.call('a2aFulfillmentGet',[id]);live();return readNativeFulfillmentRecord(result);},
  async completeA2aFailedOriginalFulfillment(raw,capability){
   write();const input=captureNativeFulfillmentCompletion(raw),state=await snapshot(input.originalId),record=state.record;
   if(!record||record.claim.claimId!==input.claimId)return false;
   const authority=captureNativeFulfillmentAuthority(record.claim.authority);validateFulfilledQueryRun(input.run,record.claim,input,capability);
   if(record.completion)return same(record.completion,{claimId:input.claimId,originalId:input.originalId,runSha256:input.runSha256,providerLedgerSha256:input.providerLedgerSha256,completedAt:input.completedAt})&&verify(state,authority,capability);
   if(!state.original||!same(state.original,record.claim.failedOrder)||!state.value.settled||!state.value.noCreatorAttempts||state.run!==null)return false;
   const packet=nativeFulfillmentCompletionPacket(input,state,capability);live();validateFulfilledQueryRun(input.run,record.claim,input,capability);
   const result=await channel.call('a2aFulfillmentComplete',[input.originalId,packet]);
   if(channel.closed||typeof result!=='boolean')throw new PostgresDomainWriteOutcomeUnknown();
   if(result){try{validateFulfilledQueryRun(input.run,record.claim,input,capability);}catch{throw new PostgresDomainWriteOutcomeUnknown();}}
   return result;
  },
  async hasA2aFailedOriginalFulfillment(raw,capability){live();const authority=captureNativeFulfillmentAuthority(raw),state=await snapshot(authority.original.id);return verify(state,authority,capability);},
 } satisfies PostgresA2aFulfillmentPort);
}
