import { ARC_MAINNET_PROFILE } from '../../arc-network-profile';
import { canonicalJson } from '../../canonical-json';
import { validateA2aOriginalClaim,validateA2aClaimWorker,matchesA2aOriginalBinding,type A2aOriginalClaim } from '../../a2a/original-claim';
import { decodeUnfinishedA2aOrders,unfinishedA2aOrderLimit,type UnfinishedA2aOrders } from '../../a2a/overdue-escalation-queue';
import type { A2aOrder } from '../../a2a/order';
import { PostgresStorageUnavailable } from './connection';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
export interface PostgresA2aOriginalsPort {
 hasA2aOriginalSettlement(expected:A2aOriginalClaim):Promise<boolean>;
 listUnfinishedA2aOrders(limit:number):Promise<UnfinishedA2aOrders>;
 claimA2aOriginal(expected:A2aOriginalClaim,workerId:string,startedAt:string):Promise<A2aOrder|null>;
 markA2aOrderPaymentStarted(id:string,startedAt:string):Promise<boolean>;
 markA2aOrderResultSaving(id:string,startedAt:string):Promise<boolean>;
 failA2aOrder(id:string,errorCode:string,updatedAt:string):Promise<boolean>;
}
const unavailable=()=>new PostgresStorageUnavailable();
/** Native JSON cells are already decoded; preserve false/0/empty-string JSON
 * values exactly as SQLite's JSON.parse(TEXT), including malformed legacy kinds. */
function order(raw:unknown):A2aOrder{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw unavailable();const r=raw as Record<string,unknown>;
 const fields=['id','query_id','authorization_id','request_hash','payer','payee','amount_usdc','creator_budget_usdc','service_fee_usdc','research_mode','package_data','status','transaction_id','request_data','started_at','worker_id','execution_journal_version','payment_started_at','result_saving_at','response_data','error_code','resolution_data','created_at','updated_at'];
 if(fields.some(field=>!Object.hasOwn(r,field)))throw unavailable();
 return {id:String(r.id),queryId:String(r.query_id),authorizationId:String(r.authorization_id),requestHash:String(r.request_hash),payer:String(r.payer),payee:String(r.payee),amountUsdc:Number(r.amount_usdc),creatorBudgetUsdc:Number(r.creator_budget_usdc),serviceFeeUsdc:Number(r.service_fee_usdc),researchMode:r.research_mode==='quick'?'quick':'deep',researchPackage:(r.package_data??null) as A2aOrder['researchPackage'],status:r.status as A2aOrder['status'],transaction:String(r.transaction_id),request:(r.request_data??null) as A2aOrder['request'],startedAt:r.started_at==null?null:String(r.started_at),workerId:r.worker_id==null?null:String(r.worker_id),executionJournalVersion:r.execution_journal_version===1?1:null,paymentStartedAt:r.payment_started_at==null?null:String(r.payment_started_at),resultSavingAt:r.result_saving_at==null?null:String(r.result_saving_at),response:(r.response_data??null) as A2aOrder['response'],errorCode:r.error_code==null?null:String(r.error_code),resolution:(r.resolution_data??null) as A2aOrder['resolution'],createdAt:String(r.created_at),updatedAt:String(r.updated_at)};
}
/** Qualified fixed ports only. Construction grants no installed provenance,
 * original purchase, provider execution, ownership association or write retry. */
export function composePostgresA2aOriginals(channel:PostgresDomainChannel,readOnly:boolean):PostgresA2aOriginalsPort{
 if(typeof readOnly!=='boolean')throw unavailable();const live=()=>{if(channel.closed)throw unavailable();};
 const binding=(raw:A2aOriginalClaim)=>{const value=validateA2aOriginalClaim(raw,ARC_MAINNET_PROFILE),wire=canonicalJson(value);if(Buffer.byteLength(wire)>8192)throw unavailable();return {value,wire};};
 const checkpoint=async(operation:'a2aPaymentStart'|'a2aResultSaving'|'a2aFail',id:string,at:string,errorCode?:string)=>{
  live();if(readOnly)throw unavailable();
  const text=(v:unknown,length:number,bytes:number):v is string=>typeof v==='string'&&v.length<=length&&Buffer.byteLength(v)<=bytes&&!v.includes('\0')&&Buffer.from(v).toString('utf8')===v;
  if(!text(id,256,1024)||id.length<1||typeof at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at)||!Number.isFinite(Date.parse(at))||new Date(at).toISOString()!==at
   ||operation==='a2aFail'&&!text(errorCode,512,2048))throw unavailable();
  const result=await channel.call(operation,operation==='a2aFail'?[id,errorCode!,at]:[id,at]);
  if(channel.closed||typeof result!=='boolean')throw new PostgresDomainWriteOutcomeUnknown();return result;
 };
 return Object.freeze({
  async hasA2aOriginalSettlement(raw){live();const input=binding(raw),result=await channel.call('a2aOriginalSettled',[input.wire]);live();if(typeof result!=='boolean')throw unavailable();return result;},
  async listUnfinishedA2aOrders(raw){live();const take=unfinishedA2aOrderLimit(raw),result=await channel.call('a2aOriginalUnfinished',[String(take)]);live();if(!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).join(',')!=='rows')throw unavailable();const rows=Reflect.get(result,'rows');if(!Array.isArray(rows)||rows.length>take+1)throw unavailable();return decodeUnfinishedA2aOrders(rows,take,order);},
  async claimA2aOriginal(raw,workerId,startedAt){
   live();if(readOnly)throw unavailable();const input=binding(raw);validateA2aClaimWorker(workerId,startedAt);
   if(workerId.includes('\0')||Buffer.from(workerId).toString('utf8')!==workerId)throw unavailable();
   const result=await channel.call('a2aOriginalClaim',[input.wire,workerId,startedAt]);if(channel.closed)throw new PostgresDomainWriteOutcomeUnknown();if(result===null)return null;
   try{const claimed=order(result);if(!matchesA2aOriginalBinding(claimed,input.value)||claimed.status!=='running'||claimed.startedAt!==startedAt||claimed.workerId!==workerId||claimed.updatedAt!==startedAt||claimed.executionJournalVersion!==1||claimed.paymentStartedAt!==null||claimed.resultSavingAt!==null||claimed.response!==null||claimed.errorCode!==null||claimed.resolution!==null)throw unavailable();return claimed;}catch{throw new PostgresDomainWriteOutcomeUnknown();}
  },
  markA2aOrderPaymentStarted:(id,at)=>checkpoint('a2aPaymentStart',id,at),
  markA2aOrderResultSaving:(id,at)=>checkpoint('a2aResultSaving',id,at),
  failA2aOrder:(id,errorCode,at)=>checkpoint('a2aFail',id,at,errorCode),
 } satisfies PostgresA2aOriginalsPort);
}
