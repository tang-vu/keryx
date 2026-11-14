import { z } from 'zod';
import { createHash } from 'node:crypto';
import { ARC_MAINNET_PROFILE } from '../../arc-network-profile';
import { canonicalJson } from '../../canonical-json';
import type { A2aOrder } from '../../a2a/order';
import type { QueryRun } from '../../types';
import { validateA2aOriginalClaim } from '../../a2a/original-claim';
import { fulfillmentAuthoritySchema,fulfillmentClaimInputSchema,fulfillmentCompletionInputSchema,matchesFailedFulfillmentOriginal,
 validateFulfilledQueryRun,type FulfillmentClaimInput,type FulfillmentAuthority,type A2aFulfillmentCompletion,type A2aFulfillmentRecord } from '../../a2a/failed-original-fulfillment-protocol';
import type { FulfillmentEvidenceCapability } from '../../a2a/fulfillment-supplement-evidence';
import { fulfilledOriginalOrders } from '../../a2a/fulfillment-delivery';
import { monthlyOrderToRow } from '../research-monthly';
import { acceptanceOriginalMetadata } from './acceptance-metadata';
import { capturePostgresPublication } from './publication-packet';
import { decodePostgresA2aOrder } from './a2a-originals-transport';

export const fulfillmentWireSha=(wire:string)=>createHash('sha256').update(wire).digest('hex');
const refuse=()=>new Error('Native failed-original fulfillment refused');
const frozen=<T>(value:T):T=>{if(value&&typeof value==='object'){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;};
const bounded=(wire:string,limit:number)=>{if(typeof wire!=='string'||Buffer.byteLength(wire)>limit)throw refuse();return wire;};
const copy=<T>(value:T,limit:number):T=>JSON.parse(bounded(canonicalJson(value),limit)) as T;
const id=z.string().regex(/^a2a_[a-f0-9]{64}$/),digest=z.string().regex(/^[a-f0-9]{64}$/);
const claimRow=z.object({original_id:id,claim_id:digest,authority_data:z.string(),failed_order_data:z.string(),claimed_at:z.string()}).strict();
const completionRow=z.object({original_id:id,claim_id:digest,run_sha256:digest,provider_ledger_sha256:digest,completed_at:z.string()}).strict();
const records=z.object({claimRowWire:z.string().nullable(),completionRowWire:z.string().nullable()}).strict();
const snapshot=records.extend({orderWire:z.string().nullable(),runWire:z.string().nullable(),storeId:z.string().nullable(),settled:z.boolean(),noCreatorAttempts:z.boolean()}).strict();

export function captureNativeFulfillmentAuthority(raw:FulfillmentAuthority){
 const authority=fulfillmentAuthoritySchema.parse(raw);validateA2aOriginalClaim(authority.original,ARC_MAINNET_PROFILE);
 return frozen(copy(authority,524288));
}
export function captureNativeFulfillmentClaim(raw:FulfillmentClaimInput){
 const input=fulfillmentClaimInputSchema.parse(raw);validateA2aOriginalClaim(input.authority.original,ARC_MAINNET_PROFILE);
 const now=Date.now();if(Date.parse(input.claimedAt)>now||now-Date.parse(input.claimedAt)>60000||now>=Date.parse(input.authority.expiresAt))throw refuse();
 return frozen(copy(input,524288));
}
export function captureNativeFulfillmentCompletion(raw:A2aFulfillmentCompletion){
 const completion=fulfillmentCompletionInputSchema.parse({claimId:raw.claimId,originalId:raw.originalId,runSha256:raw.runSha256,providerLedgerSha256:raw.providerLedgerSha256,completedAt:raw.completedAt});
 if(Date.parse(completion.completedAt)>Date.now())throw refuse();
 return frozen({...completion,run:copy(raw.run,4000000)});
}
export function nativeFulfillmentOrderWire(order:A2aOrder){
 const row=monthlyOrderToRow(order);for(const field of ['request_data','package_data','response_data','resolution_data'])if(row[field]!==null)row[field]=JSON.stringify(row[field]);
 return bounded(JSON.stringify(row),4000000);
}
export function readNativeFulfillmentOrder(wire:string):A2aOrder{
 const row=JSON.parse(bounded(wire,4000000)) as Record<string,unknown>;
 for(const field of ['request_data','package_data','response_data','resolution_data'])if(typeof row[field]==='string')row[field]=JSON.parse(row[field] as string);
 return decodePostgresA2aOrder(row);
}
export function readNativeFulfillmentRecord(raw:unknown):A2aFulfillmentRecord|null{
 const value=records.parse(raw);if(value.claimRowWire===null){if(value.completionRowWire!==null)throw refuse();return null;}
 const row=claimRow.parse(JSON.parse(bounded(value.claimRowWire,16777216))),authority=JSON.parse(bounded(row.authority_data,524288));
 const input=fulfillmentClaimInputSchema.parse({authority,claimId:row.claim_id,claimedAt:row.claimed_at}),failedOrder=JSON.parse(bounded(row.failed_order_data,4000000)) as A2aOrder;
 if(input.authority.original.id!==row.original_id||!matchesFailedFulfillmentOriginal(failedOrder,input.authority))throw refuse();
 const saved=value.completionRowWire===null?null:completionRow.parse(JSON.parse(bounded(value.completionRowWire,2048)));
 const completion=saved===null?null:fulfillmentCompletionInputSchema.parse({claimId:saved.claim_id,originalId:saved.original_id,runSha256:saved.run_sha256,providerLedgerSha256:saved.provider_ledger_sha256,completedAt:saved.completed_at});
 if(completion&&(completion.claimId!==input.claimId||completion.originalId!==row.original_id))throw refuse();
 return frozen({claim:{...input,failedOrder},completion});
}
export function readNativeFulfillmentSnapshot(raw:unknown){
 const value=snapshot.parse(raw),record=readNativeFulfillmentRecord({claimRowWire:value.claimRowWire,completionRowWire:value.completionRowWire});
 const original=value.orderWire===null?null:readNativeFulfillmentOrder(value.orderWire),run=value.runWire===null?null:JSON.parse(bounded(value.runWire,4000000)) as QueryRun;
 return {value,record,original,run};
}
export type NativeFulfillmentSnapshot=ReturnType<typeof readNativeFulfillmentSnapshot>;
export function nativeFulfillmentClaimPacket(input:ReturnType<typeof captureNativeFulfillmentClaim>,order:A2aOrder){
 if(!matchesFailedFulfillmentOriginal(order,input.authority)||Date.parse(order.updatedAt)>Date.parse(input.claimedAt))return null;
 return bounded(JSON.stringify({input,authorityWire:canonicalJson(input.authority),failedOrderWire:bounded(canonicalJson(order),4000000),beforeWire:nativeFulfillmentOrderWire(order)}),33554432);
}
export function nativeFulfillmentVerifyPacket(state:NativeFulfillmentSnapshot){
 const {value}=state;if(value.claimRowWire===null||value.completionRowWire===null||value.orderWire===null||value.runWire===null)throw refuse();
 return JSON.stringify({claimSha256:fulfillmentWireSha(value.claimRowWire),completionSha256:fulfillmentWireSha(value.completionRowWire),orderSha256:fulfillmentWireSha(value.orderWire),runSha256:fulfillmentWireSha(value.runWire)});
}
/** Opaque supplement/quality WeakMaps are consumed here without replacement.
 * Protected evidence is revalidated by the transport after every native await. */
export function nativeFulfillmentCompletionPacket(input:ReturnType<typeof captureNativeFulfillmentCompletion>,state:NativeFulfillmentSnapshot,capability?:FulfillmentEvidenceCapability){
 const {record,original,value}=state;if(!record||!original||!value.orderWire||!value.claimRowWire||!value.storeId||record.claim.claimId!==input.claimId)throw refuse();
 validateFulfilledQueryRun(input.run,record.claim,input,capability);
 const expected=fulfilledOriginalOrders(input.run,record.claim,input)[0],afterWire=nativeFulfillmentOrderWire(expected),row=JSON.parse(afterWire) as Record<string,unknown>;
 // This existing producer deliberately refuses unrepresentable scalar text.
 // It grants no complete writer or claim of full original-data/domain parity.
 const publication=JSON.parse(capturePostgresPublication(input.run).wire) as {originalHex:string};
 if(fulfillmentWireSha(Buffer.from(publication.originalHex,'hex').toString('utf8'))!==input.runSha256)throw refuse();
 return bounded(JSON.stringify({completion:{claimId:input.claimId,originalId:input.originalId,runSha256:input.runSha256,providerLedgerSha256:input.providerLedgerSha256,completedAt:input.completedAt},
  claimSha256:fulfillmentWireSha(value.claimRowWire),beforeWire:value.orderWire,afterWire,publication,projection:acceptanceOriginalMetadata(row,value.storeId)}),67108864);
}
