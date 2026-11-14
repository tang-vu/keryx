/** Pure capture and genuine SOURCE validation. No signer, payment transport,
 * publication callback, SQL selector or installed adapter proof is supplied. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ARC_MAINNET_PROFILE } from '../../arc-network-profile';
import { addressSchema } from '../../buyer/protocol';
import { privateResearchIdSchema,validatePrivateResearchIntent,type PrivateResearchIntent } from '../../a2a/private-research-intent';
import { privatePaymentConfirmation,privatePaymentState,type PrivatePaymentConfirmation } from '../../a2a/private-payment-state';
import { privateCreatorSubmissionSchema,type PrivateCreatorSubmissionRecord } from '../private-creator-submissions';
import { capturePrivateCreatorConfirmation,readPrivateCreatorConfirmation } from '../private-creator-confirmations';
import { capturePrivateResearchResult,readPrivateResearchResult,validatePrivateResearchResultSnapshot } from '../private-research-results';
import type { QueryRun } from '../../types';

export const privateResearchActions=Object.freeze(['reserve-intent','reserve-treasury','claim-payment','confirm-payment','claim-execution','admit-creator','confirm-creator','save-result','interrupt','release'] as const);
export type PrivateResearchAction=typeof privateResearchActions[number];
const date=z.string().datetime({offset:true}),uuid=z.string().uuid();
const refuse=()=>new Error('Native private research refused');
export const privateResearchSha=(wire:string)=>createHash('sha256').update(wire).digest('hex');
export const privateCreatorLegId=(data:z.infer<typeof privateCreatorSubmissionSchema>)=>privateResearchSha(JSON.stringify([data.kind,data.sourceId,data.itemId,data.submission.payee]));
const freeze=<T>(value:T):T=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const bound=(value:string,bytes:number)=>{if(typeof value!=='string'||Buffer.byteLength(value)>bytes)throw refuse();return value;};
const copy=(value:unknown,bytes:number)=>JSON.parse(bound(JSON.stringify(value),bytes)) as unknown;
export function privateResearchLookup(id:string,payer:string){return freeze({id:privateResearchIdSchema.parse(id),payer:addressSchema.parse(payer).toLowerCase()});}
export function capturePrivateResearchValue(action:PrivateResearchAction,value:unknown){
 if(!privateResearchActions.includes(action))throw refuse();
 switch(action){
  case 'reserve-intent':return freeze(copy(value,524288));
  case 'reserve-treasury':{const p=z.object({signer:addressSchema,capacityMicros:z.string().regex(/^[1-9]\d{0,11}$/)}).strict().parse(value);return freeze({...p,signer:p.signer.toLowerCase()});}
  case 'confirm-payment':return freeze(copy(value,8192));
  case 'admit-creator':return freeze(privateCreatorSubmissionSchema.parse(value));
  case 'confirm-creator':return freeze(capturePrivateCreatorConfirmation(value));
  case 'save-result':return capturePrivateResearchResult(value as QueryRun);
  case 'release':return addressSchema.parse(value).toLowerCase();
  case 'claim-execution':return uuid.parse(value);
  default:if(value!==undefined)throw refuse();return null;
 }
}
const snapshotSchema=z.object({intentRowWire:z.string().nullable(),paymentRowWire:z.string().nullable(),executionRowWire:z.string().nullable(),resultRowWire:z.string().nullable(),interruptionRowWire:z.string().nullable(),reservationRowWire:z.string().nullable(),releaseRowWire:z.string().nullable(),submissionsWire:z.string(),confirmationsWire:z.string()}).strict();
// Attests only genuine SOURCE codec/signature validation of these exact bytes.
// It does not attest installed Native provenance, session or payment authority.
const checkedSourceStates=new WeakMap<object,{intent:PrivateResearchIntent|null;intentRowWire:string|null;paymentRowWire:string|null;executionRowWire:string|null;resultRowWire:string|null;id:string;payer:string}>();
const parsed=(wire:string|null,bytes:number)=>wire===null?null:JSON.parse(bound(wire,bytes)) as Record<string,unknown>;
export async function readPrivateResearchSnapshot(raw:unknown,key:ReturnType<typeof privateResearchLookup>){
 const wire=snapshotSchema.parse(raw),intentRow=parsed(wire.intentRowWire,2097152);
 let intent:PrivateResearchIntent|null=null;
 if(intentRow){intent=await validatePrivateResearchIntent(JSON.parse(bound(String(intentRow.data),524288)));
  if(intent.id!==key.id||intent.submission.payment.authorization.from!==key.payer||intentRow.id!==key.id||intentRow.payer!==key.payer||intent.requirement.network!==ARC_MAINNET_PROFILE.networkId)throw refuse();}
 else if([wire.paymentRowWire,wire.executionRowWire,wire.resultRowWire,wire.interruptionRowWire,wire.reservationRowWire,wire.releaseRowWire].some(v=>v!==null)||wire.submissionsWire!=='[]'||wire.confirmationsWire!=='[]')throw refuse();
 const state={wire,key,intent,paymentRow:parsed(wire.paymentRowWire,32768),executionRow:parsed(wire.executionRowWire,2048),resultRow:parsed(wire.resultRowWire,33554432),interruptionRow:parsed(wire.interruptionRowWire,2048),reservationRow:parsed(wire.reservationRowWire,2048),releaseRow:parsed(wire.releaseRowWire,2048),
  submissionRows:JSON.parse(bound(wire.submissionsWire,33554432)) as Record<string,unknown>[],confirmationRows:JSON.parse(bound(wire.confirmationsWire,33554432)) as Record<string,unknown>[]};
 checkedSourceStates.set(state,{intent:intent===null?null:freeze(JSON.parse(JSON.stringify(intent)) as PrivateResearchIntent),intentRowWire:wire.intentRowWire,paymentRowWire:wire.paymentRowWire,executionRowWire:wire.executionRowWire,resultRowWire:wire.resultRowWire,id:key.id,payer:key.payer});return state;
}
export type PrivateResearchSnapshot=Awaited<ReturnType<typeof readPrivateResearchSnapshot>>;
export function privateSnapshotPayment(state:PrivateResearchSnapshot){
 if(!state.intent||!state.paymentRow)return null;const r=state.paymentRow;if(r.id!==state.key.id)throw refuse();
 return privatePaymentState({started_at:r.started_at,settled_at:r.settled_at,confirmation:r.confirmation===null?null:JSON.parse(String(r.confirmation))},state.intent);
}
export function privateSnapshotExecution(state:PrivateResearchSnapshot){
 if(privateSnapshotPayment(state)?.status!=='settled'||!state.executionRow)return null;const r=state.executionRow;if(r.id!==state.key.id)throw refuse();
 return {id:state.key.id,workerId:uuid.parse(r.worker_id),startedAt:date.parse(r.started_at)};
}
export function privateSnapshotResult(state:PrivateResearchSnapshot){
 if(!privateSnapshotExecution(state)||!state.resultRow)return null;const r=state.resultRow;if(r.id!==state.key.id)throw refuse();
 return readPrivateResearchResult({serialized_run:r.serialized_run,saved_at:r.saved_at},state.intent!);
}
export function privateSnapshotInterruption(state:PrivateResearchSnapshot){
 const claim=privateSnapshotExecution(state);if(!claim||!state.interruptionRow)return null;const r=state.interruptionRow;
 if(r.id!==state.key.id||r.worker_id!==claim.workerId||r.reason!=='worker-interrupted')throw refuse();return {reason:'worker-interrupted' as const,recordedAt:date.parse(r.recorded_at)};
}
export function privateSnapshotSubmissions(state:PrivateResearchSnapshot):PrivateCreatorSubmissionRecord[]{
 const claim=privateSnapshotExecution(state);if(!claim)return [];if(!Array.isArray(state.submissionRows))throw refuse();
 return state.submissionRows.map(r=>{const data=privateCreatorSubmissionSchema.parse(JSON.parse(String(r.data))),legId=privateCreatorLegId(data);
  if(r.job_id!==state.key.id||r.leg_id!==legId||r.worker_id!==claim.workerId||r.authorization_id!==data.submission.authorizationId||Number(r.amount_micros)!==Number(data.submission.amountMicros))throw refuse();
  return {jobId:state.key.id,workerId:claim.workerId,legId,startedAt:date.parse(r.started_at),data};});
}
export function privateSnapshotConfirmation(state:PrivateResearchSnapshot,authorizationId:string){
 const attempt=privateSnapshotSubmissions(state).find(r=>r.data.submission.authorizationId===authorizationId);if(!attempt)return null;
 if(!Array.isArray(state.confirmationRows))throw refuse();const row=state.confirmationRows.find(r=>r.authorization_id===authorizationId);
 return row?readPrivateCreatorConfirmation({data:row.data,settled_at:row.settled_at},attempt):null;
}
export function privateSnapshotReservation(state:PrivateResearchSnapshot){
 if(!state.intent||!state.reservationRow)return null;const r=state.reservationRow,amount=Math.round(state.intent.submission.request.budget*1e6),signer=addressSchema.parse(r.signer).toLowerCase();
 if(r.job_id!==state.key.id||r.signer!==signer||Number(r.amount_micros)!==amount)throw refuse();return {signer,amountMicros:String(amount)};
}
export function privateResearchExpected(state:PrivateResearchSnapshot){
 const hash=(v:string|null)=>v===null?null:privateResearchSha(v);return {intent:hash(state.wire.intentRowWire),payment:hash(state.wire.paymentRowWire),execution:hash(state.wire.executionRowWire)};
}
/** SOURCE codecs validate the actual copied raw result before this body-less
 * capture. JSON-token hashing preserves NUL/unpaired-scalar distinctions. This
 * is identity data, never installed writer, settlement or execution authority. */
export function privateResearchResultIdentity(serializedRun:string,state:PrivateResearchSnapshot){
 const entry=checkedSourceStates.get(state);
 if(!entry?.intent||!entry.intentRowWire||state.wire.intentRowWire!==entry.intentRowWire||state.key.id!==entry.id||state.key.payer!==entry.payer)throw refuse();
 validatePrivateResearchResultSnapshot(serializedRun,entry.intent);
 const original={...state,intent:entry.intent,key:privateResearchLookup(entry.id,entry.payer),paymentRow:parsed(entry.paymentRowWire,32768),executionRow:parsed(entry.executionRowWire,2048),resultRow:parsed(entry.resultRowWire,33554432)};
 const claim=privateSnapshotExecution(original),payment=privateSnapshotPayment(original);if(!claim||payment?.status!=='settled')throw refuse();
 const saved=privateSnapshotResult(original);if(saved&&saved.serializedRun!==serializedRun)throw Error('Private research result conflict');
 const run=JSON.parse(serializedRun) as {question:string;budget:number;researchMode:string},row=JSON.parse(entry.intentRowWire) as {data:string};
 return freeze({id:entry.id,runSha256:privateResearchSha(serializedRun),intentSha256:privateResearchSha(row.data),owner:entry.payer,questionSha256:privateResearchSha(JSON.stringify(run.question)),budgetMicros:String(Math.round(run.budget*1e6)),researchMode:run.researchMode,
  workerId:claim.workerId,executionStartedAt:claim.startedAt,paymentStartedAt:payment.startedAt,paymentSettledAt:payment.settledAt,paymentConfirmationSha256:privateResearchSha(String(original.paymentRow!.confirmation)),sourceSavedAt:saved?.savedAt??null});
}
export function checkedPrivatePayment(value:unknown,state:PrivateResearchSnapshot){if(!state.intent)throw refuse();return privatePaymentConfirmation(value as PrivatePaymentConfirmation,state.intent);}
export function privateResearchPacket(value:unknown){return bound(JSON.stringify(value),67108864);}
