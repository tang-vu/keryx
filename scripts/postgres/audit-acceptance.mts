/** Held current-contract compatibility only, never settlement authentication. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { exactA2aMicros } from '../../lib/a2a/amount-micros';
import { originalBinding } from '../../lib/deliverable-acceptance/original';
import { acceptanceEntrySchema } from '../../lib/deliverable-acceptance/contracts';
import { sqliteAcceptanceProjection } from './acceptance-projection.mts';
export function auditAcceptance(db:DatabaseSync,deadline:number,network:'eip155:5042'|'eip155:5042002'='eip155:5042'){
 assert(db.isTransaction&&['eip155:5042','eip155:5042002'].includes(network));const digest=createHash('sha256');
 const seed=db.prepare('SELECT singleton,id FROM deliverable_acceptance_store LIMIT 2').all(),storeId=seed.length===1&&seed[0].singleton===1&&typeof seed[0].id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(seed[0].id)?seed[0].id:null;
 // Match SELECT * property order, while refusing oversized rows before Node
 // receives their strings. This Source-only inspection is not runtime SQL.
 const columns=db.prepare('PRAGMA table_info(a2a_orders)').all().map(row=>{assert(typeof row.name==='string'&&/^[a-z][a-z0-9_]*$/.test(row.name));return '"'+row.name+'"';});assert(columns.length>0&&columns.length<=128);
 const bytes=columns.map(name=>`coalesce(length(CAST(${name} AS BLOB)),0)`).join('+');
 const read=db.prepare(`SELECT * FROM a2a_orders WHERE id=? AND (${bytes})<=4000000`);
 let orders=0,boundedOriginals=0,retainedDeliveries=0,settledOriginalTuples=0,eligibleOriginals=0,unavailableOriginals=0,originalTextBytes=0,preservedOriginalFingerprints=0,projectionMismatches=0,entries=0,invalidEntries=0,foreignNetworkEntries=0,matchingOriginalEntries=0,matchingHistoricalConsents=0;
 const bindings=new Map<string,ReturnType<typeof originalBinding>>();
 const settled=db.prepare(`SELECT 1 FROM research_purchase_authorizations c JOIN payment_events p
  ON p.id=? AND p.kind='inbound' AND p.source_id='a2a' AND p.query_id=c.purchase_id AND lower(p.payer)=c.payer
  AND lower(p.payee)=c.payee AND lower(p.authorization_id)=c.authorization_id AND p.network=c.network
  AND p.settled=1 AND p.settlement_status='settled' AND p.tx_hash=? AND p.amount_usdc=?
  WHERE c.network=? AND c.payer=? AND c.payee=lower(?) AND c.authorization_id=lower(?)
  AND c.product='a2a' AND c.purchase_id=? AND c.request_hash=? AND c.amount_micros=?
  AND NOT EXISTS(SELECT 1 FROM research_monthly_redemptions WHERE order_id=c.purchase_id)`);
 for(const key of db.prepare('SELECT id FROM a2a_orders ORDER BY id COLLATE BINARY').iterate()){
  assert(performance.now()<deadline&&orders<10000&&typeof key.id==='string');orders++;
  const row=read.get(key.id);if(!row){boundedOriginals++;continue;}if(typeof row.response_data==='string')retainedDeliveries++;
  const owner=typeof row.payer==='string'?row.payer.toLowerCase():'',paid=exactA2aMicros(Number(row.amount_usdc));
  const confirmed=Boolean(settled.get('inbound_'+key.id,row.transaction_id??null,row.amount_usdc??null,network,owner,String(row.payee),String(row.authorization_id),key.id,String(row.request_hash),paid??-1));if(confirmed)settledOriginalTuples++;
  const text=JSON.stringify({order:row,deliveryText:row.response_data,settled:confirmed,network});originalTextBytes+=Buffer.byteLength(text);digest.update(JSON.stringify([key.id,createHash('sha256').update(text).digest('hex')]));
  try{assert(storeId);const binding=originalBinding(storeId,text,owner,network,key.id);bindings.set(owner+'|'+key.id,binding);eligibleOriginals++;
   try{const projection=sqliteAcceptanceProjection(db,key.id);if(projection.orderWire===JSON.stringify(row)&&projection.network===network&&JSON.stringify(projection.binding)===JSON.stringify(binding))preservedOriginalFingerprints++;else projectionMismatches++;}catch{projectionMismatches++;}
  }catch{unavailableOriginals++;}
 }
 for(const row of db.prepare("SELECT owner,network,original_id,revision,idempotency_key,original_fingerprint,delivered_digest,CASE WHEN length(CAST(data AS BLOB))<=16384 THEN data END data FROM deliverable_acceptance_entries ORDER BY owner,network,original_id,revision").iterate()){
  assert(performance.now()<deadline&&entries<100000);entries++;if(row.network!==network)foreignNetworkEntries++;
  try{
   assert(typeof row.data==='string');const entry=acceptanceEntrySchema.parse(JSON.parse(row.data));
   assert(entry.revision===row.revision&&entry.idempotencyKey===row.idempotency_key&&entry.originalFingerprint===row.original_fingerprint&&entry.deliveredDigest===row.delivered_digest);
   const binding=bindings.get(String(row.owner)+'|'+String(row.original_id));if(row.network===network&&binding?.originalFingerprint===entry.originalFingerprint&&binding.deliveredDigest===entry.deliveredDigest){matchingOriginalEntries++;if(entry.publishState)matchingHistoricalConsents++;}
   digest.update(JSON.stringify([row.owner,row.network,row.original_id,entry])).update('\n');
  }catch{invalidEntries++;}
 }
 return {format:'keryx-deliverable-acceptance-real-data-audit-v1',eligibilityContext:'selected-acceptance-contract',networkContext:network,storeIdValid:storeId!==null,orders,boundedOriginals,retainedDeliveries,settledOriginalTuples,eligibleOriginals,unavailableOriginals,originalTextBytes,preservedOriginalFingerprints,projectionMismatches,entries,invalidEntries,foreignNetworkEntries,matchingOriginalEntries,matchingHistoricalConsents,projectionDigest:digest.digest('hex'),privateBodiesDisclosed:false,originalsModified:false,applicationMaterialized:false,enrollmentAuthorized:false,settlementAuthenticated:false,refundOrRevisionExecuted:false};
}
