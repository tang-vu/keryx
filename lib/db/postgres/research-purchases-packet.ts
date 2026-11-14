import { z } from 'zod';
import { ARC_MAINNET_PROFILE } from '../../arc-network-profile';
import { a2aOrderId,a2aRequestHash,sameA2aOrder,type A2aOrder } from '../../a2a/order';
import { a2aResearchPackageFingerprint,isSupportedA2aResearchPackage } from '../../a2a/research-package';
import { isWellFormedAskText } from '../../ask-input';
import { sourceClaimReceiptSchema } from '../../sources/public-source-claim';
import { monthlyOrderId,monthlyOrderToRow,monthlyPurchaseId,validateMonthlyPurchase,MONTHLY_REQUEST_LIMIT,type MonthlyPurchase,type MonthlyRedemption,type MonthlyRedemptionInput,type ResearchPurchaseClaim } from '../research-monthly';

const address=z.string().regex(/^0x[0-9a-fA-F]{40}$/),id=z.string().regex(/^monthly_[0-9a-f]{64}$/),requestId=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),at=z.string().datetime({offset:true});
const seconds=z.string().regex(/^(0|[1-9]\d{0,15})$/);
const issued=z.object({validAfter:seconds,validBefore:seconds,expiresAt:seconds}).strict().refine(v=>BigInt(v.validBefore)-BigInt(v.validAfter)>=604800n&&BigInt(v.validBefore)-BigInt(v.validAfter)<=2592000n&&BigInt(v.expiresAt)>BigInt(v.validAfter)&&BigInt(v.expiresAt)<BigInt(v.validBefore));
const claimSchema=z.object({network:z.literal(ARC_MAINNET_PROFILE.networkId),asset:z.literal(ARC_MAINNET_PROFILE.usdcAddress.toLowerCase()).optional(),payer:address,payee:address,authorizationId:z.string().min(1).max(256),purpose:z.enum(['a2a','monthly','resource']),requestHash:z.string().regex(/^[0-9a-f]{64}$/),amountMicros:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),requireExisting:z.boolean().optional(),issued:issued.optional(),resourceSourceId:z.string().min(1).max(256).optional(),resourceKind:z.enum(['fetch','citation','operating-fee']).optional(),sourceClaim:z.object({sourceId:z.string().min(1).max(256),receipt:sourceClaimReceiptSchema,kind:z.enum(['fetch','citation'])}).strict().optional()}).strict();

/** Snapshot before the first await. PostgreSQL JSONB cannot represent NUL or an
 * unpaired UTF-16 code unit; refuse before dispatch, never sanitize identities. */
function capture<T>(raw:T):T {
 const wire=JSON.stringify(raw);if(typeof wire!=='string'||Buffer.byteLength(wire)>65536)throw Error('Research purchase packet bound');
 const value=JSON.parse(wire) as T;
 const check=(v:unknown):void=>{if(typeof v==='string'&&!isWellFormedAskText(v))throw Error('Research purchase text refused');if(v&&typeof v==='object')for(const [key,item] of Object.entries(v)){if(!isWellFormedAskText(key))throw Error('Research purchase key refused');check(item);}};check(value);return value;
}
export function captureResearchPurchaseClaim(raw:ResearchPurchaseClaim,now=Date.now()) {
 const value=claimSchema.parse(capture(raw)),required=value.requireExisting===true;
 if(value.sourceClaim&&(value.purpose!=='resource'||value.resourceSourceId&&value.resourceSourceId!==value.sourceClaim.sourceId||value.resourceKind&&value.resourceKind!==value.sourceClaim.kind))throw Error('Research source claim context differs from seller resource');
 if(required&&(!value.issued||value.purpose!=='monthly'))throw Error('Issued Monthly authorization required');
 if(value.issued){const n=BigInt(Math.floor(now/1000)),a=BigInt(value.issued.validAfter),b=BigInt(value.issued.validBefore),e=BigInt(value.issued.expiresAt);
  if(value.purpose!=='monthly'||!required&&(a<n-660n||n<=a||b<n+604800n||e<=n||e>n+660n))throw Error('Issued Monthly authorization expired or invalid');}
 return {required,context:{sourceId:value.resourceSourceId??value.sourceClaim?.sourceId,receipt:value.sourceClaim?.receipt,kind:value.sourceClaim?.kind??value.resourceKind},row:{network:ARC_MAINNET_PROFILE.networkId,asset:ARC_MAINNET_PROFILE.usdcAddress.toLowerCase(),payer:value.payer.toLowerCase(),payee:value.payee.toLowerCase(),authorization_id:value.authorizationId.toLowerCase(),product:value.purpose,purchase_id:value.purpose==='monthly'?monthlyPurchaseId(value):a2aOrderId(value),request_hash:value.requestHash,amount_micros:value.amountMicros,issued_data:value.issued??null}};
}
export function captureResearchMonthly(raw:MonthlyPurchase){return validateMonthlyPurchase(capture(raw),ARC_MAINNET_PROFILE);}
export function sameResearchMonthly(a:MonthlyPurchase,b:MonthlyPurchase){
 return a.format===b.format&&a.network===b.network&&a.asset===b.asset&&a.gatewayContract===b.gatewayContract&&a.id===b.id&&a.payer.toLowerCase()===b.payer.toLowerCase()&&a.payee.toLowerCase()===b.payee.toLowerCase()&&a.authorizationId.toLowerCase()===b.authorizationId.toLowerCase()&&a.transaction===b.transaction&&a.quoteId===b.quoteId&&a.createdAt===b.createdAt&&a.expiresAt===b.expiresAt&&a.creatorBudgetMicros===b.creatorBudgetMicros&&a.serviceFeeMicros===b.serviceFeeMicros&&a.totalMicros===b.totalMicros&&a2aResearchPackageFingerprint(a.researchPackage)===a2aResearchPackageFingerprint(b.researchPackage);
}
export function researchMonthlyId(value:string){return id.parse(value);}
export function captureResearchMonthlyRedemption(raw:MonthlyRedemptionInput){
 const input=capture(raw);id.parse(input.monthlyId);address.parse(input.payer);requestId.parse(input.requestId);at.parse(input.now);
 const o=input.order;
 if(!o||!o.request||o.request.network!==ARC_MAINNET_PROFILE.networkId||o.id!==monthlyOrderId(input.monthlyId,input.requestId)||o.queryId!==o.id||o.request.origin!=='a2a'||o.request.monthlyId!==input.monthlyId||typeof o.request.question!=='string'||!o.request.question.trim()||o.request.question.length>10000||o.request.model!==undefined&&(typeof o.request.model!=='string'||o.request.model.length>256)||!isSupportedA2aResearchPackage(o.researchPackage,o.researchMode)||o.requestHash!==a2aRequestHash({...o,...o.request})||o.status!=='running'||o.startedAt!==null||o.workerId!==null||o.executionJournalVersion!==1||o.paymentStartedAt!==null||o.resultSavingAt!==null||o.response!==null||o.errorCode!==null||o.resolution!==null||!at.safeParse(o.createdAt).success||o.updatedAt!==o.createdAt)throw Error('Monthly redemption contract mismatch');
 const row=monthlyOrderToRow(o);for(const field of ['request_data','package_data','response_data','resolution_data'])if(row[field]!==null)row[field]=JSON.stringify(row[field]);
 return {input,row,rowWire:JSON.stringify(row)};
}
export function assertResearchMonthlyOrder(p:MonthlyPurchase,input:MonthlyRedemptionInput){
 const o=input.order;
 if(input.payer.toLowerCase()!==p.payer.toLowerCase()||o.authorizationId!==`${p.authorizationId}:monthly:${input.requestId}`||o.payer.toLowerCase()!==p.payer.toLowerCase()||o.payee.toLowerCase()!==p.payee.toLowerCase()||o.transaction!==p.transaction||o.creatorBudgetUsdc!==p.creatorBudgetMicros/1e6||o.serviceFeeUsdc!==p.serviceFeeMicros/MONTHLY_REQUEST_LIMIT/1e6||o.amountUsdc!==p.totalMicros/MONTHLY_REQUEST_LIMIT/1e6||a2aResearchPackageFingerprint(o.researchPackage)!==a2aResearchPackageFingerprint(p.researchPackage))throw Error('Monthly redemption contract mismatch');
}
const redemption=z.object({requestId,orderId:z.string().regex(/^a2a_[0-9a-f]{64}$/),requestHash:z.string().regex(/^[0-9a-f]{64}$/),createdAt:at,slot:z.number().int().min(0).max(3)}).strict();
export function decodeResearchMonthly(raw:unknown){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!=='purchase,redemptions')throw Error('Invalid stored Monthly purchase');
 const value=raw as {purchase:MonthlyPurchase;redemptions:unknown[]},purchase=captureResearchMonthly(value.purchase);
 if(!Array.isArray(value.redemptions)||value.redemptions.length>MONTHLY_REQUEST_LIMIT)throw Error('Invalid stored Monthly redemptions');
 const redemptions=value.redemptions.map(v=>redemption.parse(v));
 if(redemptions.some((v,index)=>v.slot!==index||v.orderId!==monthlyOrderId(purchase.id,v.requestId)||Date.parse(v.createdAt)<Date.parse(purchase.createdAt)||Date.parse(v.createdAt)>=Date.parse(purchase.expiresAt))||new Set(redemptions.map(v=>v.requestId)).size!==redemptions.length)throw Error('Invalid stored Monthly redemptions');
 return {purchase,redemptions};
}
export function decodeResearchMonthlyOrder(wire:unknown):A2aOrder {
 if(typeof wire!=='string'||Buffer.byteLength(wire)>4000000)throw Error('Monthly order unavailable');const r=JSON.parse(wire) as Record<string,unknown>;
 const fields=['id','query_id','authorization_id','request_hash','payer','payee','amount_usdc','creator_budget_usdc','service_fee_usdc','research_mode','package_data','status','transaction_id','request_data','started_at','worker_id','execution_journal_version','payment_started_at','result_saving_at','response_data','error_code','resolution_data','created_at','updated_at'];if(!r||Array.isArray(r)||fields.some(k=>!Object.hasOwn(r,k)))throw Error('Monthly order unavailable');
 for(const f of ['request_data','package_data','response_data','resolution_data'])if(typeof r[f]==='string')r[f]=JSON.parse(r[f] as string);
 return {id:String(r.id),queryId:String(r.query_id),authorizationId:String(r.authorization_id),requestHash:String(r.request_hash),payer:String(r.payer),payee:String(r.payee),amountUsdc:Number(r.amount_usdc),creatorBudgetUsdc:Number(r.creator_budget_usdc),serviceFeeUsdc:Number(r.service_fee_usdc),researchMode:r.research_mode==='quick'?'quick':'deep',researchPackage:r.package_data as A2aOrder['researchPackage'],status:r.status as A2aOrder['status'],transaction:String(r.transaction_id),request:r.request_data as A2aOrder['request'],startedAt:r.started_at==null?null:String(r.started_at),workerId:r.worker_id==null?null:String(r.worker_id),executionJournalVersion:r.execution_journal_version===1?1:null,paymentStartedAt:r.payment_started_at==null?null:String(r.payment_started_at),resultSavingAt:r.result_saving_at==null?null:String(r.result_saving_at),response:r.response_data as A2aOrder['response'],errorCode:r.error_code==null?null:String(r.error_code),resolution:r.resolution_data as A2aOrder['resolution'],createdAt:String(r.created_at),updatedAt:String(r.updated_at)};
}
export function assertResearchMonthlyReplay(stored:A2aOrder,proposed:A2aOrder,redemption:Pick<MonthlyRedemption,'orderId'|'requestHash'>){
 if(!sameA2aOrder(stored,proposed)||!stored.request||!proposed.request||stored.request.network!==proposed.request.network||stored.request.question!==proposed.request.question||stored.request.model!==proposed.request.model||stored.request.origin!=='a2a'||stored.request.monthlyId!==proposed.request.monthlyId||redemption.orderId!==stored.id||redemption.requestHash!==stored.requestHash)throw Error('Monthly request replay conflict');
}
