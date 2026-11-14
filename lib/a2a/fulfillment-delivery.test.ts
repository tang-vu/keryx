import { expect,it } from 'vitest';
import { syntheticFailedOriginal,syntheticFulfilledRun } from '../db/a2a-fulfillment-fixture';
import { validateFulfilledQueryRun,fulfillmentObjectSha256 } from './failed-original-fulfillment-protocol';
import { fulfilledOriginalOrders,fulfillmentResolution,fulfilledOriginalReceipt } from './fulfillment-delivery';
import { a2aResponseFromRun,quoteFromA2aOrder } from './result';
import { canonicalJson } from '../canonical-json';

it('retains full exact expected-side receipts and never normalizes a changed stored field',()=>{
 const fixture=syntheticFailedOriginal(),claim={...fixture.input,failedOrder:fixture.order},completion=syntheticFulfilledRun(claim);
 validateFulfilledQueryRun(completion.run,claim,completion);const original=canonicalJson(claim.failedOrder),variants=fulfilledOriginalOrders(completion.run,claim,completion);
 expect(variants[0]).toMatchObject({status:'completed',errorCode:null,payer:claim.failedOrder.payer,amountUsdc:claim.failedOrder.amountUsdc,createdAt:claim.failedOrder.createdAt,startedAt:claim.failedOrder.startedAt});
 expect(variants.some(v=>!Object.hasOwn(v.response!,'readCheckpoints'))).toBe(true);
 expect(variants.some(v=>!Object.hasOwn(v.response!.researchExports as object,'cslJson'))).toBe(true);
 for(const changed of [{...variants[0],amountUsdc:variants[0].amountUsdc+.000001},{...variants[0],response:{...variants[0].response,unexpected:'untrusted'}}])expect(variants.some(v=>canonicalJson(v)===canonicalJson(changed))).toBe(false);
 expect(canonicalJson(claim.failedOrder)).toBe(original);
});
it('binds the permanent claim, original failure, authority and provider/run digests in the same Source resolution',()=>{
 const fixture=syntheticFailedOriginal(),claim={...fixture.input,failedOrder:fixture.order},completion=syntheticFulfilledRun(claim),resolution=fulfillmentResolution(claim,completion);
 expect(resolution.fulfillment).toEqual({claimId:claim.claimId,originalFailureSha256:claim.authority.originalEvidenceSha256,authoritySha256:fulfillmentObjectSha256(claim.authority),providerLedgerSha256:completion.providerLedgerSha256,runSha256:completion.runSha256});
 expect(resolution.evidence).toMatchObject({creatorAttempts:0,queryRunFound:true,paymentBoundaryCrossed:false,resultSaveBoundaryCrossed:true});
});
it('uses the current original package key order for the exact newly written Source receipt',()=>{
 const f=syntheticFailedOriginal(),claim={...f.input,failedOrder:JSON.parse(canonicalJson(f.order))},completion=syntheticFulfilledRun(claim);
 const current={...f.order,researchPackage:Object.fromEntries(Object.entries(f.order.researchPackage!).reverse()) as typeof f.order.researchPackage};
 const actual=JSON.stringify(fulfilledOriginalReceipt(completion.run,current));
 expect(actual).toBe(JSON.stringify(a2aResponseFromRun(completion.run,quoteFromA2aOrder(current),{acceptedAt:current.createdAt,startedAt:current.startedAt})));
 expect(actual).not.toBe(JSON.stringify(fulfilledOriginalOrders(completion.run,claim,completion)[0].response));
});
