import { createHash,randomUUID } from 'node:crypto';
import { assertPaymentSettlementState } from '../../payments/payment-state';
import type { PaymentRecord } from '../../types';

export const PAYMENT_EVENT_WIRE_BYTES=1048576;
export const PAYMENT_EVENT_FIELDS=Object.freeze(['id','created_at','kind','query_id','source_id','source_name','payer','payee','amount_usdc','weight','rationale','tx_hash','network','settled','settlement_status','authorization_id','authorization_expires_at','grant_epoch','origin','item_id','item_title','item_url','content_version','item_published_at','offer_id','list_price_usdc','authorization_phase'] as const);
const authorityFields=new Set(['id','kind','query_id','source_id','payer','payee','network','settlement_status','authorization_id','grant_epoch','authorization_phase']);
const numericFields=new Set(['amount_usdc','weight','list_price_usdc','settled']);
export type PaymentEventRow=Record<typeof PAYMENT_EVENT_FIELDS[number],string|number|null>;
function nativeText(value:string){return !value.includes('\0')&&Buffer.from(value).toString('utf8')===value;}
export function paymentEventWireSha256(wire:string){return createHash('sha256').update(wire).digest('hex');}
/** Raw JS JSON retains postpaid NUL/surrogate escape bytes. A NULL relational
 * metadata cell is explicitly unprojected, never a substitute for the original.
 * The mandatory shared observation guard must hold all older payment readers. */
export function capturePaymentEventRow(row:PaymentEventRow){
 const keys=Object.keys(row);if(keys.length!==PAYMENT_EVENT_FIELDS.length||PAYMENT_EVENT_FIELDS.some(key=>!Object.hasOwn(row,key)))throw Error('Payment original fields unavailable');
 const projection:PaymentEventRow={...row},unprojectedFields:string[]=[];
 for(const [key,value] of Object.entries(row)){
  if(numericFields.has(key)){if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER))throw Error('Native payment numeric surface unsupported');continue;}
  if(value!==null&&typeof value!=='string')throw Error('Payment original text unavailable');
  if(typeof value==='string'&&!nativeText(value)){if(authorityFields.has(key))throw Error('Native payment lookup text unsupported');projection[key as keyof PaymentEventRow]=null;unprojectedFields.push(key);}
 }
 for(const key of ['created_at','authorization_expires_at'] as const){const value=row[key];if(typeof value==='string'&&(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(value)||value.startsWith('0000-')||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)){projection[key]=null;if(!unprojectedFields.includes(key))unprojectedFields.push(key);}}
 if(row.created_at===null&&!unprojectedFields.includes('created_at'))unprojectedFields.push('created_at');
 if(typeof row.id!=='string'||Buffer.byteLength(row.id)>1024||typeof row.settled!=='number'||![0,1].includes(row.settled)||typeof row.settlement_status!=='string'||(row.settled===1)!==(row.settlement_status==='settled'))throw Error('Payment original state unavailable');
 const rowWire=JSON.stringify(row);if(Buffer.byteLength(rowWire)>PAYMENT_EVENT_WIRE_BYTES)throw Error('Payment original bound');
 return {row:Object.freeze({...row}),rowWire,sha256:paymentEventWireSha256(rowWire),projection:Object.freeze(projection),unprojectedFields:Object.freeze(unprojectedFields.sort())};
}
/** Source insertPayment's exact column/default mapping. The generic API does
 * not create authorization_phase even if a caller supplies that property. */
export function capturePaymentEvent(raw:PaymentRecord){
 const values={id:raw.id??randomUUID(),createdAt:raw.createdAt,kind:raw.kind,queryId:raw.queryId,sourceId:raw.sourceId,sourceName:raw.sourceName,payer:raw.payer,payee:raw.payee,amountUsdc:raw.amountUsdc,weight:raw.weight??null,rationale:raw.rationale??null,txHash:raw.txHash??null,network:raw.network,settled:raw.settled,settlementStatus:raw.settlementStatus,authorizationId:raw.authorizationId??null,authorizationExpiresAt:raw.authorizationExpiresAt??null,grantEpoch:raw.grantEpoch??null,origin:raw.origin??'engine',itemId:raw.itemId??null,itemTitle:raw.itemTitle??null,itemUrl:raw.itemUrl??null,contentVersion:raw.contentVersion??null,itemPublishedAt:raw.itemPublishedAt??null,offerId:raw.offerId??null,listPriceUsdc:raw.listPriceUsdc??null};
 const status=assertPaymentSettlementState(values);
 if(typeof values.settled!=='boolean'||typeof values.amountUsdc!=='number'||!Number.isFinite(values.amountUsdc)||Math.abs(values.amountUsdc*1e6)>Number.MAX_SAFE_INTEGER)throw Error('Native payment amount surface unsupported');
 const row:PaymentEventRow={id:values.id,created_at:values.createdAt,kind:values.kind,query_id:values.queryId,source_id:values.sourceId,source_name:values.sourceName,payer:values.payer,payee:values.payee,amount_usdc:values.amountUsdc,weight:values.weight,rationale:values.rationale,tx_hash:values.txHash,network:values.network,settled:values.settled?1:0,settlement_status:status,authorization_id:values.authorizationId,authorization_expires_at:values.authorizationExpiresAt,grant_epoch:values.grantEpoch,origin:values.origin,item_id:values.itemId,item_title:values.itemTitle,item_url:values.itemUrl,content_version:values.contentVersion,item_published_at:values.itemPublishedAt,offer_id:values.offerId,list_price_usdc:values.listPriceUsdc,authorization_phase:null};
 return capturePaymentEventRow(row);
}
export function capturePaymentTerminal(id:string,authorizationId:string,transaction:string){
 if(typeof id!=='string'||typeof authorizationId!=='string'||typeof transaction!=='string'||!nativeText(id)||!nativeText(authorizationId)||Buffer.byteLength(id)>1024||Buffer.byteLength(authorizationId)>1024||Buffer.byteLength(JSON.stringify(transaction))>PAYMENT_EVENT_WIRE_BYTES)throw Error('Native payment terminal input unsupported');
 return Object.freeze({id,authorizationId,transaction,transactionWire:JSON.stringify(transaction)});
}
export interface PaymentEventTerminalSnapshot {
 beforeWire:string|null;
 hosted:{signer:string;submitted:number;original:string}|null;
 browserActive:boolean;
 browser:{signer:string;grantEpoch:string;paymentMetadata:string}|null;
}
/** Mirror Source's hosted -> active browser -> legacy dispatch. The snapshot is
 * a local retained original; it never authenticates the caller's Circle proof. */
export function capturePaymentTerminalPlan(snapshot:PaymentEventTerminalSnapshot,input:ReturnType<typeof capturePaymentTerminal>,failed:boolean){
 if(typeof failed!=='boolean'||typeof snapshot.browserActive!=='boolean'||snapshot.beforeWire!==null&&(typeof snapshot.beforeWire!=='string'||Buffer.byteLength(snapshot.beforeWire)>PAYMENT_EVENT_WIRE_BYTES))throw Error('Payment original snapshot unavailable');
 const before=snapshot.beforeWire===null?null:JSON.parse(snapshot.beforeWire) as PaymentEventRow;
 if(before&&before.id!==input.id)throw Error('Payment original selector mismatch');
 const noChange=(dispatch:string,resolved=false)=>({dispatch,resolved,reservationReleased:false,after:null,release:null});
 const patch=(changes:Partial<PaymentEventRow>)=>{if(!before)throw Error('Payment original unavailable');return capturePaymentEventRow({...before,...changes});};
 const retainedRelease=(signer:string,grantEpoch:string,amountUsdc:unknown)=>{
  const amount=Number(amountUsdc),micros=Math.round(amount*1e6);if(!Number.isSafeInteger(micros)||micros<0||Math.abs(amount*1e6-micros)>=0.000001)throw Error('Retained browser capacity mismatch');
  if(typeof signer!=='string'||typeof grantEpoch!=='string'||!nativeText(signer)||!nativeText(grantEpoch))throw Error('Retained browser identity unsupported');
  return {mode:'retained' as const,signer:signer.toLowerCase(),grantEpoch,amountMicros:String(micros)};
 };
 const hosted=snapshot.hosted;
 if(hosted&&input.id==='x402:'+input.authorizationId){
  const original=JSON.parse(hosted.original) as {context:{privateJob?:unknown}};
  if(!original.context.privateJob){
   if(hosted.submitted!==1)return noChange('hosted');
   if(failed){if(!before||before.settlement_status!=='pending')return noChange('hosted',true);return {dispatch:'hosted',resolved:true,reservationReleased:false,after:patch({settlement_status:'failed',authorization_phase:'failed',tx_hash:input.transaction}),release:null};}
   if(!/^0x[0-9a-f]{40}$/.test(hosted.signer)||!/^0x[0-9a-f]{64}$/.test(input.authorizationId)||!input.transaction||input.transaction.length>256)throw Error('Hosted settlement evidence refused');
   // Source immediately reads scalar TEXT back and compares it to this exact
   // identifier. Node SQLite replaces unpaired UTF-16 during binding, so that
   // Source confirmation rolls back. NUL itself round-trips and stays raw JSON.
   if(Buffer.from(input.transaction).toString('utf8')!==input.transaction)throw Error('Original hosted receipt cannot round-trip Source text');
   if(before?.settlement_status==='pending')return {dispatch:'hosted',resolved:true,reservationReleased:false,after:patch({settled:1,settlement_status:'settled',authorization_phase:'settled',tx_hash:input.transaction}),release:null};
   if(before?.settled===1&&before.tx_hash===input.transaction)return noChange('hosted',true);
   throw Error('Original hosted settlement conflict');
  }
 }
 if(snapshot.browserActive){
  if(snapshot.browser&&input.id==='x402:'+input.authorizationId){
   if(!before||!['exposed','signed','submission_attempted'].includes(String(before.authorization_phase))||before.settlement_status!=='pending')return noChange('browser');
   const payment=JSON.parse(snapshot.browser.paymentMetadata) as {amountUsdc:unknown},release=failed?retainedRelease(snapshot.browser.signer,snapshot.browser.grantEpoch,payment.amountUsdc):null;
   return {dispatch:'browser',resolved:true,reservationReleased:failed,after:patch({settled:failed?0:1,settlement_status:failed?'failed':'settled',authorization_phase:failed?'failed':'settled',tx_hash:input.transaction}),release};
  }
  if(!before||before.authorization_id!==input.authorizationId||before.authorization_phase!==null||before.settlement_status!=='pending')return noChange('journal-legacy');
  const release=failed&&before.grant_epoch?retainedRelease(String(before.payer),String(before.grant_epoch),before.amount_usdc):null;
  return {dispatch:'journal-legacy',resolved:true,reservationReleased:release!==null,after:patch({settled:failed?0:1,settlement_status:failed?'failed':'settled',tx_hash:input.transaction}),release};
 }
 if(!before||before.authorization_id!==input.authorizationId||before.settled!==0||before.settlement_status!=='pending')return noChange('legacy');
 return {dispatch:'legacy',resolved:true,reservationReleased:false,after:patch({settlement_status:failed?'failed':'settled',settled:failed?0:1,tx_hash:input.transaction}),release:failed&&before.grant_epoch?{mode:'legacy' as const,signer:String(before.payer),grantEpoch:String(before.grant_epoch),amountUsdc:before.amount_usdc}:null};
}
