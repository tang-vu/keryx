import type { KeryxDB } from '../keryx-db';
import { PostgresStorageUnavailable } from './connection';
import type { PostgresDomainChannel } from './domain-channel';
import { capturePaymentObservation,decodePaymentObservations,paymentObservationRequest,sourcePaymentRecord,type PaymentObservationMode } from './payment-observation-packet';

export type PostgresPaymentObservationPort=Pick<KeryxDB,'listPayments'|'listPendingPayments'|'listPaymentsByQuery'|'listCreatorPaymentAttemptsByQuery'|'listPaymentsBySource'>;
/** Internal raw scan only. Its presence does NOT qualify metrics or any SUM;
 * Source metrics' row visitation/IEEE754 accumulation need separate proof. */
export interface PostgresPaymentRawScanPort {scanPaymentRows(offset:number,limit?:number):Promise<readonly Readonly<import('./payment-events-packet').PaymentEventRow>[]>;}
export function composePostgresPaymentObservations(channel:PostgresDomainChannel):PostgresPaymentObservationPort&PostgresPaymentRawScanPort {
 const live=()=>{if(channel.closed)throw new PostgresStorageUnavailable();};
 const read=async(mode:PaymentObservationMode,key:string|null,limit:number|null,offset=0)=>{
  live();const selector=capturePaymentObservation(mode,key,limit,offset);
  // Root supplies genuine current manifest/identity/readonly admission before
  // and after this await. There is no callback, fallback, write or retry here.
  const raw=await channel.call('paymentObserve' as Parameters<PostgresDomainChannel['call']>[0],[paymentObservationRequest(selector)]);live();
  return decodePaymentObservations(raw,selector);
 };
 const records=async(mode:PaymentObservationMode,key:string|null,limit:number|null)=>(await read(mode,key,limit)).map(sourcePaymentRecord);
 return Object.freeze({
  listPayments:(limit:number)=>records('list',null,limit),
  listPendingPayments:(limit:number)=>records('pending',null,limit),
  listPaymentsByQuery:(queryId:string)=>records('query',queryId,null),
  listCreatorPaymentAttemptsByQuery:(queryId:string)=>records('creator',queryId,null),
  listPaymentsBySource:(sourceId:string)=>records('source',sourceId,null),
  scanPaymentRows:(offset:number,limit=1000)=>read('scan',null,limit,offset),
 } satisfies PostgresPaymentObservationPort&PostgresPaymentRawScanPort);
}
