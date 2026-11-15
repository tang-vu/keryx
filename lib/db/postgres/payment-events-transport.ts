import type { PaymentRecord } from '../../types';
import { canonicalJson } from '../../canonical-json';
import { PostgresStorageUnavailable } from './connection';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
import { capturePaymentEvent,capturePaymentTerminal,capturePaymentTerminalPlan,paymentEventWireSha256,PAYMENT_EVENT_WIRE_BYTES,type PaymentEventTerminalSnapshot } from './payment-events-packet';
export interface PostgresPaymentEventsPort {
 recordPayment(payment:PaymentRecord):Promise<void>;
 recordPaymentOnce(payment:PaymentRecord):Promise<boolean>;
 settlePendingPayment(id:string,authorizationId:string,transaction:string):Promise<boolean>;
 failPendingPayment(id:string,authorizationId:string,transaction:string):Promise<{resolved:boolean;reservationReleased:boolean}>;
}
/** Closed metadata/ledger protocol only. Caller evidence was verified elsewhere;
 * no receipt lookup, provider call, signing, funding or write retry occurs here.
 * Incomplete raw projections require the shared native observation refusal. */
export function composePostgresPaymentEvents(channel:PostgresDomainChannel,readOnly:boolean):PostgresPaymentEventsPort {
 const unavailable=()=>new PostgresStorageUnavailable();if(typeof readOnly!=='boolean')throw unavailable();
 const writer=()=>{if(readOnly||channel.closed)throw unavailable();};
 const call=(op:'paymentEventRecord'|'paymentEventRecordOnce'|'paymentEventSnapshot'|'paymentEventTerminal',args:readonly(string|null)[])=>channel.call(op as Parameters<PostgresDomainChannel['call']>[0],args);
 const record=async(raw:PaymentRecord,once:boolean)=>{writer();const p=capturePaymentEvent(raw),packet=JSON.stringify({rowWire:p.rowWire,sha256:p.sha256,projection:p.projection,unprojectedFields:p.unprojectedFields});
  const result=await call(once?'paymentEventRecordOnce':'paymentEventRecord',[packet]);if(channel.closed||typeof result!=='boolean'||!once&&result!==true)throw new PostgresDomainWriteOutcomeUnknown();return result;};
 const terminal=async(id:string,authorizationId:string,transaction:string,failed:boolean)=>{
  writer();const input=capturePaymentTerminal(id,authorizationId,transaction),selector=JSON.stringify({id:input.id,authorizationId:input.authorizationId}),envelope=await call('paymentEventSnapshot',[selector]);
  if(channel.closed||!envelope||typeof envelope!=='object'||Array.isArray(envelope)||Object.keys(envelope).sort().join(',')!=='sha256,wire')throw unavailable();
  const {wire,sha256}=envelope as Record<string,unknown>;if(typeof wire!=='string'||Buffer.byteLength(wire)>3*PAYMENT_EVENT_WIRE_BYTES||typeof sha256!=='string'||sha256!==paymentEventWireSha256(wire))throw unavailable();
  const snapshot=JSON.parse(wire) as PaymentEventTerminalSnapshot&{selector:unknown};
  if(!snapshot||Array.isArray(snapshot)||Object.keys(snapshot).sort().join(',')!=='beforeWire,browser,browserActive,hosted,selector'||canonicalJson(snapshot.selector)!==canonicalJson(JSON.parse(selector)))throw unavailable();
  const plan=capturePaymentTerminalPlan(snapshot,input,failed),after=plan.after,packet=JSON.stringify({snapshotWire:wire,snapshotSha256:sha256,failed,transactionWire:input.transactionWire,dispatch:plan.dispatch,after:after?{rowWire:after.rowWire,sha256:after.sha256,projection:after.projection,unprojectedFields:after.unprojectedFields}:null,release:plan.release});
  if(Buffer.byteLength(packet)>8*PAYMENT_EVENT_WIRE_BYTES)throw unavailable();
  const result=await call('paymentEventTerminal',[packet]);
  if(channel.closed||!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).sort().join(',')!=='reservationReleased,resolved'||typeof Reflect.get(result,'resolved')!=='boolean'||typeof Reflect.get(result,'reservationReleased')!=='boolean'||Reflect.get(result,'reservationReleased')===true&&(Reflect.get(result,'resolved')!==true||!failed)||!plan.resolved&&Reflect.get(result,'resolved')===true||plan.release?.mode!=='legacy'&&Reflect.get(result,'resolved')===true&&Reflect.get(result,'reservationReleased')!==plan.reservationReleased)throw new PostgresDomainWriteOutcomeUnknown();
  return result as {resolved:boolean;reservationReleased:boolean};
 };
 return Object.freeze({async recordPayment(p){await record(p,false);},recordPaymentOnce:(p)=>record(p,true),async settlePendingPayment(id,nonce,tx){return (await terminal(id,nonce,tx,false)).resolved;},failPendingPayment:(id,nonce,tx)=>terminal(id,nonce,tx,true)} satisfies PostgresPaymentEventsPort);
}
