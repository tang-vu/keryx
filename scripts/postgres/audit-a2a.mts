/** Read-only financial compatibility inventory, inside the contained intake
 * snapshot. Consistent retained tuples do not authorize enrollment or execution. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ARC_MAINNET_PROFILE,ARC_TESTNET_PROFILE } from '../../lib/arc-network-profile';
import { exactA2aMicros } from '../../lib/a2a/amount-micros';
import { a2aOrderId } from '../../lib/a2a/order';

export function auditA2a(db:DatabaseSync,deadline:number){
 assert(db.isTransaction);let orders=0,invalidAmounts=0,splitMismatches=0,mainnetRequests=0,testnetRequests=0,unknownNetworkRequests=0,monthlyOrders=0,canonicalOrderIds=0,purchaseTuples=0,inboundTuples=0,oversizeOriginals=0;
 const digest=createHash('sha256');
 const purchases=db.prepare("SELECT network,asset,payer,payee,authorization_id,request_hash,amount_micros FROM research_purchase_authorizations WHERE product='a2a' AND purchase_id=? LIMIT 2");
 const inbound=db.prepare("SELECT query_id,network,payer,payee,authorization_id,amount_usdc,settled,settlement_status,tx_hash FROM payment_events WHERE id=? AND kind='inbound' AND source_id='a2a' LIMIT 2");
 const statement=db.prepare(`SELECT id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,service_fee_usdc,transaction_id,
   CASE WHEN request_data IS NULL THEN NULL WHEN typeof(request_data)='text' AND length(CAST(request_data AS BLOB))<=262144 THEN request_data END request_data,
   CASE WHEN request_data IS NOT NULL AND (typeof(request_data)<>'text' OR length(CAST(request_data AS BLOB))>262144) THEN 1 ELSE 0 END request_refused
   FROM a2a_orders ORDER BY id COLLATE BINARY`);
 for(const row of statement.iterate()){
  assert(performance.now()<deadline&&orders<10000);orders++;
  for(const key of ['id','query_id','authorization_id','request_hash','payer','payee','transaction_id'])assert(typeof row[key]==='string'&&Buffer.byteLength(row[key])<=1024);
  const amount=typeof row.amount_usdc==='number'?exactA2aMicros(row.amount_usdc):null,creator=typeof row.creator_budget_usdc==='number'?exactA2aMicros(row.creator_budget_usdc):null,fee=typeof row.service_fee_usdc==='number'?exactA2aMicros(row.service_fee_usdc):null;
  const positive=amount!==null&&amount>0&&creator!==null&&creator>0&&fee!==null&&fee>0,balanced=positive&&BigInt(amount)===BigInt(creator)+BigInt(fee);if(!positive)invalidAmounts++;else if(!balanced)splitMismatches++;
  let request:Record<string,unknown>|null=null;try{if(typeof row.request_data==='string'){const parsed:unknown=JSON.parse(row.request_data);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))request=parsed as Record<string,unknown>;}}catch{/* Unknown original stays unknown. */}
  if(row.request_refused===1)oversizeOriginals++;
  const network=request?.network,profile=network===ARC_MAINNET_PROFILE.networkId?ARC_MAINNET_PROFILE:network===ARC_TESTNET_PROFILE.networkId?ARC_TESTNET_PROFILE:null;
  if(profile===ARC_MAINNET_PROFILE)mainnetRequests++;else if(profile===ARC_TESTNET_PROFILE)testnetRequests++;else unknownNetworkRequests++;
  const monthly=!!request&&Object.hasOwn(request,'monthlyId');if(monthly)monthlyOrders++;
  const payer=String(row.payer).toLowerCase(),payee=String(row.payee).toLowerCase(),authorizationId=String(row.authorization_id).toLowerCase();
  if(profile&&row.id===row.query_id&&row.id===a2aOrderId({network:profile.networkId,payer,payee,authorizationId}))canonicalOrderIds++;
  const claims=purchases.all(row.id),payments=inbound.all('inbound_'+row.id);
  const claim=claims.length===1?claims[0]:undefined,payment=payments.length===1?payments[0]:undefined;
  const claimMatches=!!(balanced&&profile&&!monthly&&claim&&claim.network===profile.networkId&&claim.asset===profile.usdcAddress.toLowerCase()&&claim.payer===payer&&claim.payee===payee&&claim.authorization_id===authorizationId&&claim.request_hash===row.request_hash&&claim.amount_micros===amount);
  if(claimMatches)purchaseTuples++;
  const paymentAmount=typeof payment?.amount_usdc==='number'?exactA2aMicros(payment.amount_usdc):null;
  const inboundMatches=!!(claimMatches&&payment&&payment.query_id===row.id&&payment.network===network&&typeof payment.payer==='string'&&payment.payer.toLowerCase()===payer&&typeof payment.payee==='string'&&payment.payee.toLowerCase()===payee&&typeof payment.authorization_id==='string'&&payment.authorization_id.toLowerCase()===authorizationId&&paymentAmount===amount&&payment.settled===1&&payment.settlement_status==='settled'&&payment.tx_hash===row.transaction_id&&String(row.transaction_id).trim());
  if(inboundMatches)inboundTuples++;
  digest.update(JSON.stringify({row,amount,creator,fee,claims,payments,claimMatches,inboundMatches})).update('\n');
 }
 return {format:'keryx-a2a-financial-real-data-audit-v1',orders,invalidAmounts,splitMismatches,mainnetRequests,testnetRequests,unknownNetworkRequests,monthlyOrders,canonicalOrderIds,purchaseTuples,inboundTuples,oversizeOriginals,projectionDigest:digest.digest('hex'),rawOrdersDisclosed:false,originalsModified:false,applicationMaterialized:false,settlementAuthenticityVerified:false,enrollmentAuthorized:false,executionAuthorized:false};
}
