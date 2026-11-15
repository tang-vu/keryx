import { createHash } from 'node:crypto';
import type { PaymentRecord } from '../../types';
import { PAYMENT_EVENT_FIELDS,type PaymentEventRow } from './payment-events-packet';

export const PAYMENT_OBSERVATION_LIMITS=Object.freeze({inputBytes:65536,keyWireBytes:16384,rowWireBytes:1048576,resultBytes:4194304,rows:1000,scanOffset:200000});
export type PaymentObservationMode='list'|'pending'|'query'|'creator'|'source'|'scan';
export interface PaymentObservationSelector {mode:PaymentObservationMode;keyWire:string|null;limit:number|null;offset:number;}
function keyWire(key:string){if(typeof key!=='string')throw Error('Payment selector unavailable');const wire=JSON.stringify(key);if(Buffer.byteLength(wire)>PAYMENT_OBSERVATION_LIMITS.keyWireBytes)throw Error('Payment selector bound');return wire;}
function limitValue(limit:number){if(typeof limit!=='number'||!Number.isSafeInteger(limit)||limit<0)throw Error('Native payment LIMIT surface unsupported');return limit;}
export function capturePaymentObservation(mode:PaymentObservationMode,key:string|null,limit:number|null,offset=0):Readonly<PaymentObservationSelector>{
 if(!['list','pending','query','creator','source','scan'].includes(mode))throw Error('Payment mode unavailable');
 const keyed=['query','creator','source'].includes(mode);
 if(keyed&&(key===null||limit!==null||offset!==0)||!keyed&&key!==null)throw Error('Payment selector fields unavailable');
 if(!keyed&&limit===null)throw Error('Payment limit unavailable');
 if(!Number.isSafeInteger(offset)||offset<0||offset>PAYMENT_OBSERVATION_LIMITS.scanOffset||mode!=='scan'&&offset!==0)throw Error('Payment scan offset unavailable');
 const captured=Object.freeze({mode,keyWire:keyed?keyWire(key!):null,limit:keyed?null:limitValue(limit!),offset});
 if(mode==='scan'&&(captured.limit!<1||captured.limit!>1000))throw Error('Payment scan limit unavailable');
 return captured;
}
export function paymentObservationRequest(selector:Readonly<PaymentObservationSelector>){const wire=JSON.stringify(selector);if(Buffer.byteLength(wire)>PAYMENT_OBSERVATION_LIMITS.inputBytes)throw Error('Payment request bound');return wire;}
const hash=(wire:string)=>createHash('sha256').update(wire).digest('hex');
const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const keys=(value:object)=>Object.keys(value).sort().join(',');
const numeric=new Set(['amount_usdc','weight','list_price_usdc','settled']);
/** Decode retained actual Source cells only. This is deliberately NOT the
 * writer capture: it must neither bind strings again nor normalize dates. */
export function decodePaymentObservations(raw:unknown,selector:Readonly<PaymentObservationSelector>):readonly Readonly<PaymentEventRow>[] {
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||keys(raw)!=='format,identityDigest,rows,selector')throw Error('Payment observations unavailable');
 const result=raw as {format:unknown;identityDigest:unknown;rows:unknown;selector:unknown};
 if(result.format!=='keryx-payment-observations-v1'||!digest(result.identityDigest)||!result.selector||typeof result.selector!=='object'||keys(result.selector)!==keys(selector)
  ||Object.entries(selector).some(([key,value])=>(result.selector as Record<string,unknown>)[key]!==value)||!Array.isArray(result.rows)||result.rows.length>PAYMENT_OBSERVATION_LIMITS.rows
  ||selector.limit!==null&&result.rows.length>selector.limit||Buffer.byteLength(JSON.stringify(raw))>PAYMENT_OBSERVATION_LIMITS.resultBytes)throw Error('Payment observation binding unavailable');
 const seen=new Set<string>();
 return Object.freeze(result.rows.map((value:unknown)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||keys(value)!=='currentSha256,currentWire,id,identityDigest,originalSha256')throw Error('Payment original unavailable');
  const item=value as {id:unknown;identityDigest:unknown;originalSha256:unknown;currentSha256:unknown;currentWire:unknown};
  // SQL checks immutable Original SHA and native projection under the data
  // lock. Current SHA also binds the exact wire crossing this fixed channel.
  if(typeof item.id!=='string'||seen.has(item.id)||item.identityDigest!==result.identityDigest||!digest(item.originalSha256)||!digest(item.currentSha256)||typeof item.currentWire!=='string'
   ||Buffer.byteLength(item.currentWire)>PAYMENT_OBSERVATION_LIMITS.rowWireBytes||hash(item.currentWire)!==item.currentSha256)throw Error('Payment original binding unavailable');
  seen.add(item.id);const row=JSON.parse(item.currentWire) as PaymentEventRow;
  if(!row||Array.isArray(row)||typeof row!=='object'||keys(row)!==[...PAYMENT_EVENT_FIELDS].sort().join(',')||row.id!==item.id)throw Error('Payment current cells unavailable');
  for(const [key,cell] of Object.entries(row)){
   if(cell===null)continue;
   if(numeric.has(key)){if(typeof cell!=='number'||!Number.isFinite(cell)||Math.abs(cell)>Number.MAX_SAFE_INTEGER)throw Error('Payment numeric cells unavailable');}
   else if(typeof cell!=='string'||Buffer.from(cell).toString('utf8')!==cell)throw Error('Payment Source text unavailable');
  }
  if(row.settled!==0&&row.settled!==1)throw Error('Payment settled cell unavailable');
  const matches=(cell:unknown)=>typeof cell==='string'&&Buffer.from(cell).equals(Buffer.from(JSON.parse(selector.keyWire!) as string));
  if(selector.mode!=='scan'&&['prepared','cancelled_unexposed'].includes(String(row.authorization_phase))
   ||selector.mode==='pending'&&(row.settlement_status!=='pending'||row.settled!==0||row.authorization_id===null)
   ||selector.mode==='query'&&(!matches(row.query_id)||row.kind!=='citation')
   ||selector.mode==='creator'&&(!matches(row.query_id)||row.kind===null||row.kind==='inbound')
   ||selector.mode==='source'&&(!matches(row.source_id)||row.kind===null||row.kind==='inbound'))throw Error('Payment selected cells unavailable');
  return Object.freeze(row);
 }));
}
/** Exact current selected Source rowToPayment contract (including own optional
 * properties with undefined). created_at is raw TEXT/null, never a Date. */
export function sourcePaymentRecord(r:Readonly<PaymentEventRow>):PaymentRecord {
 return {id:r.id as string,kind:r.kind as PaymentRecord['kind'],queryId:r.query_id as string,sourceId:r.source_id as string,sourceName:r.source_name as string,payer:r.payer as string,payee:r.payee as string,amountUsdc:r.amount_usdc as number,
  weight:(r.weight as number)??undefined,rationale:(r.rationale as string)??undefined,txHash:(r.tx_hash as string)??null,network:r.network as string,settled:Boolean(r.settled),
  settlementStatus:(r.settlement_status as PaymentRecord['settlementStatus'])??(Boolean(r.settled)?'settled':'simulated'),authorizationId:(r.authorization_id as string)??undefined,authorizationPhase:(r.authorization_phase as PaymentRecord['authorizationPhase'])??undefined,
  authorizationExpiresAt:(r.authorization_expires_at as string)??undefined,grantEpoch:(r.grant_epoch as string)??undefined,origin:(r.origin as PaymentRecord['origin'])??undefined,itemId:(r.item_id as string)??undefined,itemTitle:(r.item_title as string)??undefined,itemUrl:(r.item_url as string)??undefined,contentVersion:(r.content_version as string)??undefined,itemPublishedAt:(r.item_published_at as string)??undefined,offerId:(r.offer_id as string)??undefined,
  listPriceUsdc:r.list_price_usdc===null||r.list_price_usdc===undefined?undefined:Number(r.list_price_usdc),createdAt:r.created_at as string};
}
