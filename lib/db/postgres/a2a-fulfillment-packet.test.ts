import { beforeEach,afterEach,expect,it,vi } from 'vitest';
import { ARC_MAINNET_PROFILE } from '../../arc-network-profile';
import { syntheticFailedOriginal,syntheticFulfilledRun } from '../a2a-fulfillment-fixture';
import { canonicalJson } from '../../canonical-json';
import { fulfillmentObjectSha256,failedOriginalEvidenceSha256 } from '../../a2a/failed-original-fulfillment-protocol';
import { fulfilledOriginalReceipt,fulfillmentResolution } from '../../a2a/fulfillment-delivery';
import { captureNativeFulfillmentClaim,captureNativeFulfillmentCompletion,nativeFulfillmentClaimPacket,nativeFulfillmentCompletionPacket,
 nativeFulfillmentOrderWire,readNativeFulfillmentRecord,readNativeFulfillmentSnapshot } from './a2a-fulfillment-packet';
const fixture=()=>{const f=syntheticFailedOriginal(4200,ARC_MAINNET_PROFILE);return {...f,claim:{...f.input,failedOrder:f.order}};};
function fulfillmentPacketFixture(){
 const f=fixture(),claimRowWire=JSON.stringify({original_id:f.order.id,claim_id:f.input.claimId,authority_data:canonicalJson(f.authority),failed_order_data:canonicalJson(f.order),claimed_at:f.input.claimedAt});
 const state={claimRowWire,completionRowWire:null,orderWire:nativeFulfillmentOrderWire(f.order),runWire:null,storeId:'3821e833-f4ca-44d3-a944-0cf892ab0b85',settled:true,noCreatorAttempts:true};
 return {...f,state,result:syntheticFulfilledRun(f.claim)};
}
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime('2026-10-06T10:00:05.000Z');});
afterEach(()=>vi.useRealTimers());
it('captures exact mainnet authority and the original failure before caller mutation',()=>{
 const f=fixture(),captured=captureNativeFulfillmentClaim(f.input),packet=nativeFulfillmentClaimPacket(captured,f.order);
 f.input.authority.input.targets[0]='changed after capture';expect(captured.authority.input.targets[0]).not.toBe(f.input.authority.input.targets[0]);expect(Object.isFrozen(captured.authority.original)).toBe(true);
 expect(packet).not.toBeNull();expect(JSON.parse(packet!).failedOrderWire).toBe(canonicalJson(f.order));
 expect(nativeFulfillmentClaimPacket(captured,{...f.order,status:'running'})).toBeNull();
});
it('retains large Source request extensions in the immutable failure snapshot',()=>{
 const f=fixture();Object.assign(f.order.request!,{retainedSourceExtension:'x'.repeat(200000)});f.authority.originalEvidenceSha256=failedOriginalEvidenceSha256(f.order);
 const packet=JSON.parse(nativeFulfillmentClaimPacket(captureNativeFulfillmentClaim(f.input),f.order)!);
 expect(packet.failedOrderWire).toBe(canonicalJson(f.order));
 const row={original_id:f.order.id,claim_id:f.input.claimId,authority_data:packet.authorityWire,failed_order_data:packet.failedOrderWire,claimed_at:f.input.claimedAt};
 expect(readNativeFulfillmentRecord({claimRowWire:JSON.stringify(row),completionRowWire:null})?.claim.failedOrder).toEqual(f.order);
});
it('refuses stale, future, expired and foreign-rail claims before native work',()=>{
 const f=fixture();for(const claimedAt of ['2026-10-06T09:59:00.000Z','2026-10-06T10:00:06.000Z'])expect(()=>captureNativeFulfillmentClaim({...f.input,claimedAt})).toThrow();
 expect(()=>captureNativeFulfillmentClaim(syntheticFailedOriginal(4201).input)).toThrow();vi.setSystemTime('2026-10-07T00:00:00.000Z');expect(()=>captureNativeFulfillmentClaim({...f.input,claimedAt:new Date().toISOString()})).toThrow();
});
it('keeps retained claims readable after historical expiry and rejects changed immutable records',()=>{
 const f=fulfillmentPacketFixture();vi.setSystemTime('2026-11-15T00:00:00.000Z');expect(readNativeFulfillmentRecord({claimRowWire:f.state.claimRowWire,completionRowWire:null})?.claim).toEqual(f.claim);
 const bad=JSON.parse(f.state.claimRowWire);bad.failed_order_data=canonicalJson({...f.order,workerId:'changed'});expect(()=>readNativeFulfillmentRecord({claimRowWire:JSON.stringify(bad),completionRowWire:null})).toThrow();
 expect(()=>readNativeFulfillmentRecord({claimRowWire:null,completionRowWire:'{}'})).toThrow();
});
it('captures prepared results and derives publication plus exact receipt/time metadata without a new debit',()=>{
 const f=fulfillmentPacketFixture(),captured=captureNativeFulfillmentCompletion(f.result);f.result.run.answer='mutated after capture';
 const packet=JSON.parse(nativeFulfillmentCompletionPacket(captured,readNativeFulfillmentSnapshot(f.state)));
 expect(packet.completion.runSha256).toBe(captured.runSha256);expect(packet.publication.row.total_spent).toBe(0);
 const after=JSON.parse(packet.afterWire);expect(after.result_saving_at).toBe(captured.completedAt);expect(after.created_at).toBe(f.order.createdAt);
 expect(JSON.parse(after.resolution_data).fulfillment.claimId).toBe(f.claim.claimId);expect(packet.projection.orderWire).toBe(packet.afterWire);
});
it('retains genuine supplement WeakMap checks and refuses a copied/caller-metadata capability',()=>{
 const f=fulfillmentPacketFixture(),run=f.result.run,metadata=run.originalFulfillment!;
 run.originalFulfillment={...metadata,format:'keryx-a2a-original-fulfillment-result-v2',supplementaryInputSha256:'ba'.repeat(32),contextSha256:'bb'.repeat(32),statementReviews:metadata.statements.map(s=>({...s,support:.9}))};
 f.result.runSha256=fulfillmentObjectSha256(run);const captured=captureNativeFulfillmentCompletion(f.result),state=readNativeFulfillmentSnapshot(f.state);
 for(const proof of [undefined,{},()=>true])expect(()=>nativeFulfillmentCompletionPacket(captured,state,proof as never)).toThrow(/evidence refused/);
});
it('preserves immutable raw order cells when retained JSON formatting differs from the canonical claim',()=>{
 const f=fulfillmentPacketFixture(),before=JSON.parse(f.state.orderWire);
 for(const key of ['package_data','request_data'])before[key]=JSON.stringify(JSON.parse(before[key]),null,2);
 f.state.orderWire=JSON.stringify(before);
 const captured=captureNativeFulfillmentCompletion(f.result),packet=JSON.parse(nativeFulfillmentCompletionPacket(captured,readNativeFulfillmentSnapshot(f.state))),after=JSON.parse(packet.afterWire);
 const mutable=new Set(['status','response_data','error_code','result_saving_at','resolution_data','updated_at']);
 for(const key of Object.keys(before))if(!mutable.has(key))expect(after[key],key).toEqual(before[key]);
 expect(after.status).toBe('completed');expect(after.result_saving_at).toBe(f.result.completedAt);
 expect(after.resolution_data).toBe(canonicalJson(fulfillmentResolution(f.claim,f.result)));
 expect(after.response_data).toBe(JSON.stringify(fulfilledOriginalReceipt(captured.run,readNativeFulfillmentSnapshot(f.state).original!)));
 expect(packet.projection.orderWire).toBe(packet.afterWire);
});
it('retains unrelated NUL/high/low-surrogate trace text while preparing a genuine Source-validated result',()=>{
 const f=fulfillmentPacketFixture();f.result.run.trace.push({type:'synthetic-only',detail:'NUL\0 high\ud800 low\udfff'} as never);f.result.runSha256=fulfillmentObjectSha256(f.result.run);
 const packet=JSON.parse(nativeFulfillmentCompletionPacket(captureNativeFulfillmentCompletion(f.result),readNativeFulfillmentSnapshot(f.state)));
 const run=JSON.parse(Buffer.from(packet.publication.originalHex,'hex').toString('utf8'));
 expect(run.trace[0].detail).toBe('NUL\0 high\ud800 low\udfff');expect(packet.completion.runSha256).toBe(f.result.runSha256);
});
