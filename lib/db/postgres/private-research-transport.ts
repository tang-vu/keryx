import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ARC_MAINNET_PROFILE } from '../../arc-network-profile';
import type { KeryxDB } from '../keryx-db';
import { validatePrivateResearchIntent,samePrivateResearchIntent } from '../../a2a/private-research-intent';
import { requirePrivatePaymentConfirmation } from '../../a2a/private-payment-state';
import { requireOriginalPrivateCreatorConfirmation } from '../private-creator-confirmations';
import { validatePrivateResearchResultSnapshot,requireOriginalPrivateResearchResult } from '../private-research-results';
import { PostgresStorageUnavailable } from './connection';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
import { capturePrivateResearchValue,privateResearchLookup,readPrivateResearchSnapshot,privateSnapshotPayment,privateSnapshotExecution,privateSnapshotResult,privateSnapshotInterruption,
 privateSnapshotSubmissions,privateSnapshotConfirmation,privateSnapshotReservation,privateResearchExpected,privateResearchPacket,privateResearchResultIdentity,privateCreatorLegId,checkedPrivatePayment,privateHistorySelection,privateCandidateSelection,readPrivateHistory,readPrivateCandidates,readPrivateTreasurySummary,type PrivateResearchAction,type PrivateResearchSnapshot } from './private-research-packet';

export type PostgresPrivateResearchReadPort=Pick<KeryxDB,'getPrivateResearchIntent'|'getPrivatePaymentState'|'getPrivateResearchExecution'|'getPrivateResearchResult'|'getPrivateResearchInterruption'|'getPrivateTreasury'|'listPrivateCreatorSubmissions'|'getPrivateCreatorConfirmation'|'listPrivateResearchHistory'|'getPrivateTreasurySummary'|'listPrivateWorkerCandidates'|'listPrivateReconciliationCandidates'>;
export type PostgresPrivateResearchPort=PostgresPrivateResearchReadPort&Pick<KeryxDB,'reservePrivateResearchIntent'|'reservePrivateTreasury'|'claimPrivatePaymentSubmission'|'confirmPrivatePayment'|'claimPrivateResearchExecution'|'admitPrivateCreatorSubmission'|'confirmPrivateCreatorSubmission'|'savePrivateResearchResult'|'interruptPrivateResearch'|'releasePrivateTreasury'>;
const operations={
 'reserve-intent':'privateResearchReserveIntent','reserve-treasury':'privateResearchReserveTreasury','claim-payment':'privateResearchClaimPayment','confirm-payment':'privateResearchConfirmPayment',
 'claim-execution':'privateResearchClaimExecution','admit-creator':'privateResearchAdmitCreator','confirm-creator':'privateResearchConfirmCreator','save-result':'privateResearchSaveResult','interrupt':'privateResearchInterrupt','release':'privateResearchRelease',
} as const;
const ack=z.object({created:z.boolean(),snapshot:z.unknown()}).strict();
const unavailable=()=>new PostgresStorageUnavailable();
/** Fixed backend metadata calls only. No construction callback can supply
 * installed writer, authenticated session, facilitator or signing authority. */
export function composePostgresPrivateResearch(channel:PostgresDomainChannel,readOnly:boolean):PostgresPrivateResearchPort{
 if(arguments.length!==2||typeof readOnly!=='boolean')throw unavailable();
 const live=()=>{if(channel.closed)throw unavailable();},write=()=>{live();if(readOnly)throw unavailable();};
 const snapshot=async(key:ReturnType<typeof privateResearchLookup>)=>{const raw=await channel.call('privateResearchSnapshot',[key.id,JSON.stringify({payer:key.payer})]);live();const state=await readPrivateResearchSnapshot(raw,key);live();return state;};
 const execute=async(action:PrivateResearchAction,state:PrivateResearchSnapshot,value:unknown,workerId?:string)=>{
  live();const packet=privateResearchPacket({payer:state.key.payer,expected:privateResearchExpected(state),valueWire:JSON.stringify(value),workerId:workerId??null});
  const raw=await channel.call(operations[action],[state.key.id,packet]);
  if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();
  // Only this documented Source partial side effect is a committed refusal.
  // SQL faults are never caught/committed as a successful application outcome.
  if(action==='reserve-treasury'&&raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.keys(raw).join(',')==='refusal'&&Reflect.get(raw,'refusal')==='treasury-reservation-conflict')throw Error('Private treasury reservation conflict');
  try{const result=ack.parse(raw),after=await readPrivateResearchSnapshot(result.snapshot,state.key);if(channel.closed)throw unavailable();return {created:result.created,state:after};}
  catch{throw new PostgresDomainWriteOutcomeUnknown();}
 };
 const intent=(state:PrivateResearchSnapshot)=>{if(!state.intent)throw Error('Private research intent unavailable');return state.intent;};
 const observed=<T>(work:()=>T):T=>{try{return work();}catch{throw new PostgresDomainWriteOutcomeUnknown();}};
 const worker=(state:PrivateResearchSnapshot,id:string)=>{const claim=privateSnapshotExecution(state);if(!claim||claim.workerId!==id)throw Error('Private execution authority unavailable');return claim;};
 const workerId=(id:string)=>z.string().uuid().parse(id);
 return Object.freeze({
  async listPrivateResearchHistory(payer,before){live();const selected=privateHistorySelection(payer,before),raw=await channel.call('privateResearchHistory',[selected.payer,JSON.stringify({before:selected.before})]);live();const result=await readPrivateHistory(raw,selected.payer);live();return result;},
  async getPrivateTreasurySummary(signer){live();const selected=privateCandidateSelection(signer),raw=await channel.call('privateResearchSummary',[selected.signer,'{}']);live();return readPrivateTreasurySummary(raw);},
  async listPrivateWorkerCandidates(signer,after){live();const selected=privateCandidateSelection(signer,after),raw=await channel.call('privateResearchWorkers',[selected.signer,JSON.stringify({after:selected.after})]);live();return readPrivateCandidates(raw,25);},
  async listPrivateReconciliationCandidates(signer,after){live();const selected=privateCandidateSelection(signer,after),raw=await channel.call('privateResearchReconciliation',[selected.signer,JSON.stringify({after:selected.after})]);live();return readPrivateCandidates(raw,1);},
  async getPrivateResearchIntent(id,payer){live();return (await snapshot(privateResearchLookup(id,payer))).intent;},
  async getPrivatePaymentState(id,payer){live();return privateSnapshotPayment(await snapshot(privateResearchLookup(id,payer)));},
  async getPrivateResearchExecution(id,payer){live();return privateSnapshotExecution(await snapshot(privateResearchLookup(id,payer)));},
  async getPrivateResearchResult(id,payer){live();return privateSnapshotResult(await snapshot(privateResearchLookup(id,payer)));},
  async getPrivateResearchInterruption(id,payer){live();return privateSnapshotInterruption(await snapshot(privateResearchLookup(id,payer)));},
  async getPrivateTreasury(id,payer){live();return privateSnapshotReservation(await snapshot(privateResearchLookup(id,payer)));},
  async listPrivateCreatorSubmissions(id,payer){live();return privateSnapshotSubmissions(await snapshot(privateResearchLookup(id,payer)));},
  async getPrivateCreatorConfirmation(id,payer,authorizationId){live();const key=privateResearchLookup(id,payer),nonce=z.string().regex(/^0x[a-fA-F0-9]{64}$/).parse(authorizationId).toLowerCase();return privateSnapshotConfirmation(await snapshot(key),nonce);},
  async reservePrivateResearchIntent(raw){
   write();const captured=capturePrivateResearchValue('reserve-intent',raw),proposed=await validatePrivateResearchIntent(captured);live();if(proposed.requirement.network!==ARC_MAINNET_PROFILE.networkId)throw unavailable();
   const key=privateResearchLookup(proposed.id,proposed.submission.payment.authorization.from),state=await snapshot(key);
   if(state.intent&&!samePrivateResearchIntent(state.intent,proposed))throw Error('Private research reservation conflict');
   const result=await execute('reserve-intent',state,proposed);if(!result.state.intent||!samePrivateResearchIntent(result.state.intent,proposed))throw new PostgresDomainWriteOutcomeUnknown();return result.state.intent;
  },
  async reservePrivateTreasury(id,payer,raw){
   write();const key=privateResearchLookup(id,payer),value=capturePrivateResearchValue('reserve-treasury',raw),state=await snapshot(key);intent(state);
   const result=await execute('reserve-treasury',state,value),saved=observed(()=>privateSnapshotReservation(result.state));if(result.created&&(!saved||saved.signer!==(value as {signer:string}).signer))throw new PostgresDomainWriteOutcomeUnknown();return result.created;
  },
  async claimPrivatePaymentSubmission(id,payer){
   write();const key=privateResearchLookup(id,payer),state=await snapshot(key);intent(state);const result=await execute('claim-payment',state,null),payment=observed(()=>privateSnapshotPayment(result.state));
   if(!payment)throw new PostgresDomainWriteOutcomeUnknown();return {claimed:result.created&&payment.status==='pending',state:payment};
  },
  async confirmPrivatePayment(id,payer,raw){
   write();const key=privateResearchLookup(id,payer),value=capturePrivateResearchValue('confirm-payment',raw),state=await snapshot(key),confirmation=checkedPrivatePayment(value,state);
   const result=await execute('confirm-payment',state,confirmation);return observed(()=>requirePrivatePaymentConfirmation(privateSnapshotPayment(result.state),confirmation));
  },
  async claimPrivateResearchExecution(id,payer){
   write();const key=privateResearchLookup(id,payer),value=capturePrivateResearchValue('claim-execution',randomUUID()),state=await snapshot(key);
   if(privateSnapshotPayment(state)?.status!=='settled')throw Error('Settled private payment unavailable');const result=await execute('claim-execution',state,value);
   if(!result.created)return null;const claim=observed(()=>privateSnapshotExecution(result.state));if(!claim||claim.workerId!==value)throw new PostgresDomainWriteOutcomeUnknown();return claim;
  },
  async admitPrivateCreatorSubmission(id,payer,rawWorker,raw){
   write();const key=privateResearchLookup(id,payer),selected=workerId(rawWorker),value=capturePrivateResearchValue('admit-creator',raw),state=await snapshot(key);worker(state,selected);
   const result=await execute('admit-creator',state,value,selected);if(result.created){const parsed=value as Parameters<KeryxDB['admitPrivateCreatorSubmission']>[3],saved=observed(()=>privateSnapshotSubmissions(result.state).find(row=>row.legId===privateCreatorLegId(parsed)));if(!saved||JSON.stringify(saved.data)!==JSON.stringify(parsed))throw new PostgresDomainWriteOutcomeUnknown();}return result.created;
  },
  async confirmPrivateCreatorSubmission(id,payer,rawWorker,raw){
   write();const key=privateResearchLookup(id,payer),selected=workerId(rawWorker),value=capturePrivateResearchValue('confirm-creator',raw) as Parameters<KeryxDB['confirmPrivateCreatorSubmission']>[3],state=await snapshot(key);
   const attempt=privateSnapshotSubmissions(state).find(row=>row.data.submission.authorizationId===value.submission.authorizationId);
   if(!attempt||attempt.workerId!==selected)throw Error('Private creator submission unavailable');if(JSON.stringify(value.submission)!==JSON.stringify(attempt.data.submission))throw Error('Private creator confirmation mismatch');
   const result=await execute('confirm-creator',state,value,selected);return observed(()=>requireOriginalPrivateCreatorConfirmation(privateSnapshotConfirmation(result.state,value.submission.authorizationId),value));
  },
  async savePrivateResearchResult(id,payer,rawWorker,raw){
   write();const key=privateResearchLookup(id,payer),selected=workerId(rawWorker),value=capturePrivateResearchValue('save-result',raw) as string,state=await snapshot(key);worker(state,selected);validatePrivateResearchResultSnapshot(value,intent(state));
   const result=await execute('save-result',state,{serializedRun:value,identity:privateResearchResultIdentity(value,state)},selected);return observed(()=>requireOriginalPrivateResearchResult(privateSnapshotResult(result.state),value));
  },
  async interruptPrivateResearch(id,payer,rawWorker){
   write();const key=privateResearchLookup(id,payer),selected=workerId(rawWorker),state=await snapshot(key);worker(state,selected);if(privateSnapshotResult(state))return null;
   const result=await execute('interrupt',state,null,selected);return observed(()=>{const saved=privateSnapshotInterruption(result.state);if(!saved&&!privateSnapshotResult(result.state))throw unavailable();return saved;});
  },
  async releasePrivateTreasury(id,payer,rawSigner){
   write();const key=privateResearchLookup(id,payer),value=capturePrivateResearchValue('release',rawSigner) as string,state=await snapshot(key);
   if(!privateSnapshotResult(state)&&!privateSnapshotInterruption(state))return null;const reservation=privateSnapshotReservation(state);
   if(!reservation||reservation.signer!==value)throw Error('Private treasury release authority unavailable');
   const used=privateSnapshotSubmissions(state).reduce((sum,leg)=>{if(leg.data.submission.payer!==value)throw Error('Private treasury release accounting mismatch');return sum+BigInt(leg.data.submission.amountMicros);},BigInt('0')),remaining=BigInt(reservation.amountMicros)-used;
   if(remaining<BigInt('0'))throw Error('Private treasury release accounting mismatch');const result=await execute('release',state,value),row=result.state.releaseRow;
   if(!row||row.job_id!==key.id||String(row.amount_micros)!==String(remaining))throw new PostgresDomainWriteOutcomeUnknown();return {amountMicros:String(remaining),newlyReleased:result.created};
  },
 } satisfies PostgresPrivateResearchPort);
}
