import type { A2aOrder } from '../../a2a/order';
import type { MonthlyPurchase,MonthlyRedemptionInput,ResearchPurchaseClaim } from '../research-monthly';
import { PostgresStorageUnavailable } from './connection';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
import { acceptanceOriginalMetadata } from './acceptance-metadata';
import { canonicalJson } from '../../canonical-json';
import { sourceClaimPolicySelector,sourceClaimPolicyRuntime,decodeSourceClaimPolicySnapshot,captureSourceClaimPurchasePolicy,type SourceClaimPurchasePolicyInput } from './source-claim-purchase-policy';
import { captureResearchPurchaseClaim,captureResearchMonthly,captureResearchMonthlyRedemption,sameResearchMonthly,researchMonthlyId,decodeResearchMonthly,decodeResearchMonthlyOrder,assertResearchMonthlyOrder,assertResearchMonthlyReplay } from './research-purchases-packet';
export interface PostgresResearchPurchasesPort {
 claimResearchPurchase(input:ResearchPurchaseClaim):Promise<void>;
 createResearchMonthly(input:MonthlyPurchase):Promise<{created:boolean;purchase:MonthlyPurchase}>;
 getResearchMonthly(id:string):Promise<ReturnType<typeof decodeResearchMonthly>|null>;
 redeemResearchMonthly(input:MonthlyRedemptionInput):Promise<{created:boolean;order:A2aOrder}>;
}
/** Closed native protocol. A purchase claim records nonce ownership, never
 * chain settlement, funding, signatures, execution or installed provenance. */
export function composePostgresResearchPurchases(channel:PostgresDomainChannel,readOnly:boolean):PostgresResearchPurchasesPort {
 const unavailable=()=>new PostgresStorageUnavailable();if(typeof readOnly!=='boolean')throw unavailable();
 const live=()=>{if(channel.closed)throw unavailable();},writer=()=>{live();if(readOnly)throw unavailable();};
 // Parent registers these four immutable operations with the bounded channel.
 const call=(operation:'researchPurchaseClaim'|'researchMonthlyCreate'|'researchMonthlyGet'|'researchMonthlyRedeem',args:readonly(string|null)[])=>channel.call(operation as Parameters<PostgresDomainChannel['call']>[0],args);
 const getMonthly=async(id:string)=>{live();researchMonthlyId(id);const result=await call('researchMonthlyGet',[JSON.stringify({id})]);live();if(result===null)return null;const monthly=decodeResearchMonthly(result);if(monthly.purchase.id!==id)throw unavailable();return monthly;};
 const sourcePolicy=async(input:Omit<SourceClaimPurchasePolicyInput,'existing'>)=>{
  const runtime=sourceClaimPolicyRuntime(),runtimeWire=canonicalJson(runtime),selector=sourceClaimPolicySelector({sourceId:input.sourceId??null,identity:input.identity});
  const envelope=await channel.call('hostedSourcePolicySnapshot' as Parameters<PostgresDomainChannel['call']>[0],[selector]);live();
  if(canonicalJson(sourceClaimPolicyRuntime())!==runtimeWire)throw unavailable();
  const existing=decodeSourceClaimPolicySnapshot(envelope,selector).snapshot.purchase!==null;
  return {capture:captureSourceClaimPurchasePolicy(envelope,{...input,existing},runtime),runtimeWire};
 };
 const policyCurrent=(wire:string)=>{try{if(canonicalJson(sourceClaimPolicyRuntime())!==wire)throw unavailable();}catch{throw new PostgresDomainWriteOutcomeUnknown();}};
 return Object.freeze({
  async claimResearchPurchase(raw){writer();const input=captureResearchPurchaseClaim(raw),r=input.row,policy=await sourcePolicy({identity:{network:r.network,payer:r.payer,authorizationId:r.authorization_id},...input.context,payee:r.payee,amountMicros:r.amount_micros,requestHash:r.request_hash});
   const result=await call('researchPurchaseClaim',[JSON.stringify({required:input.required,row:r,sourcePolicyCapture:{...policy.capture,purchaseRow:r}})]);if(channel.closed||result!==true)throw new PostgresDomainWriteOutcomeUnknown();policyCurrent(policy.runtimeWire);},
  async createResearchMonthly(raw){writer();const purchase=captureResearchMonthly(raw),original=await getMonthly(purchase.id);live();
   if(original&&!sameResearchMonthly(original.purchase,purchase))throw unavailable();
   const r=captureResearchPurchaseClaim({network:purchase.network!,payer:purchase.payer,payee:purchase.payee,authorizationId:purchase.authorizationId,purpose:'monthly',requestHash:purchase.quoteId,amountMicros:purchase.totalMicros}).row;
   const policy=original?null:await sourcePolicy({identity:{network:r.network,payer:r.payer,authorizationId:r.authorization_id},payee:r.payee,amountMicros:r.amount_micros,requestHash:r.request_hash}),result=await call('researchMonthlyCreate',[JSON.stringify({purchase,sourcePolicyCapture:policy?{...policy.capture,purchaseRow:r}:null})]);
   try{if(channel.closed||!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).sort().join(',')!=='created,purchase'||typeof Reflect.get(result,'created')!=='boolean')throw unavailable();const saved=captureResearchMonthly(Reflect.get(result,'purchase'));if(!sameResearchMonthly(saved,purchase))throw unavailable();if(policy)policyCurrent(policy.runtimeWire);return {created:Reflect.get(result,'created') as boolean,purchase:saved};}catch{throw new PostgresDomainWriteOutcomeUnknown();}},
  getResearchMonthly:getMonthly,
  async redeemResearchMonthly(raw){
   writer();const captured=captureResearchMonthlyRedemption(raw),{input}=captured;
   const monthly=await getMonthly(input.monthlyId);live();if(!monthly)throw unavailable();assertResearchMonthlyOrder(monthly.purchase,input);
   const context=await channel.call('a2aOriginalStore',[]);live();if(!context||typeof context!=='object'||Array.isArray(context)||Object.keys(context).join(',')!=='storeId'||typeof Reflect.get(context,'storeId')!=='string')throw unavailable();
   const projection=acceptanceOriginalMetadata(captured.row,Reflect.get(context,'storeId') as string),packet=JSON.stringify({monthlyId:input.monthlyId,payer:input.payer,requestId:input.requestId,rowWire:captured.rowWire,projection});if(Buffer.byteLength(packet)>262144)throw unavailable();
   const result=await call('researchMonthlyRedeem',[packet,input.now]);
   try{if(channel.closed||!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).sort().join(',')!=='created,orderWire'||typeof Reflect.get(result,'created')!=='boolean')throw unavailable();const order=decodeResearchMonthlyOrder(Reflect.get(result,'orderWire'));assertResearchMonthlyReplay(order,input.order,monthly.redemptions.find(r=>r.requestId===input.requestId)??{orderId:input.order.id,requestHash:input.order.requestHash});return {created:Reflect.get(result,'created') as boolean,order};}catch{throw new PostgresDomainWriteOutcomeUnknown();}
  },
 } satisfies PostgresResearchPurchasesPort);
}
