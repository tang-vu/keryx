import { expect,it } from 'vitest';
import { syntheticFailedOriginal,syntheticFulfilledRun } from '../db/a2a-fulfillment-fixture';
import { validateFulfilledQueryRun,fulfillmentObjectSha256 } from './failed-original-fulfillment-protocol';
import { fulfilledOriginalOrders,fulfillmentResolution } from './fulfillment-delivery';
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
