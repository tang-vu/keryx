import { expect,it } from 'vitest';
import { ARC_MAINNET_PROFILE } from '../../arc-network-profile';
import { a2aRequestHash,legacyA2aRequestHash } from '../../a2a/order';
import { syntheticA2aOriginal } from '../a2a-original-fixture';
import { monthlyPurchaseId,monthlyOrderId,MONTHLY_TERM_MS,type MonthlyPurchase } from '../research-monthly';
import { captureResearchPurchaseClaim,captureResearchMonthly,captureResearchMonthlyRedemption,assertResearchMonthlyOrder,decodeResearchMonthly,assertResearchMonthlyReplay } from './research-purchases-packet';
const now=Date.parse('2026-11-14T00:00:00.000Z');
function fixture(){
 const {order:o}=syntheticA2aOriginal(1900,ARC_MAINNET_PROFILE),purchase:MonthlyPurchase={format:'keryx-research-monthly-purchase-v2',network:ARC_MAINNET_PROFILE.networkId,asset:ARC_MAINNET_PROFILE.usdcAddress.toLowerCase(),gatewayContract:ARC_MAINNET_PROFILE.gatewayWallet.toLowerCase(),id:monthlyPurchaseId({network:ARC_MAINNET_PROFILE.networkId,...o}),payer:o.payer,payee:o.payee,authorizationId:o.authorizationId,transaction:o.transaction,quoteId:'ab'.repeat(32),createdAt:new Date(now).toISOString(),expiresAt:new Date(now+MONTHLY_TERM_MS).toISOString(),creatorBudgetMicros:10000,serviceFeeMicros:20000,totalMicros:60000,researchPackage:o.researchPackage!};
 const id=monthlyOrderId(purchase.id,'request'),order={...o,id,queryId:id,authorizationId:purchase.authorizationId+':monthly:request',amountUsdc:0.015,creatorBudgetUsdc:0.01,serviceFeeUsdc:0.005,createdAt:purchase.createdAt,updatedAt:purchase.createdAt,request:{...o.request!,monthlyId:purchase.id}};order.requestHash=a2aRequestHash({...order,...order.request});return {purchase,input:{monthlyId:purchase.id,payer:purchase.payer,requestId:'request',now:purchase.createdAt,order}};
}
const claim=()=>{const f=fixture();return {network:ARC_MAINNET_PROFILE.networkId,payer:f.purchase.payer,payee:f.purchase.payee,authorizationId:f.purchase.authorizationId,purpose:'monthly' as const,requestHash:f.purchase.quoteId,amountMicros:f.purchase.totalMicros,issued:{validAfter:String(now/1000-60),validBefore:String(now/1000+604900),expiresAt:String(now/1000+300)}};};
it('captures the mainnet claim and immutable issued timing without aliasing caller data',()=>{
 const raw=claim(),packet=captureResearchPurchaseClaim(raw,now);raw.issued.expiresAt='0';expect(packet.row.issued_data!.expiresAt).toBe(String(now/1000+300));expect(packet.row.product).toBe('monthly');expect(packet.row.network).toBe('eip155:5042');expect(packet.required).toBe(false);
});
it('rejects foreign rails, unsafe micro amounts and malformed source receipts',()=>{
 for(const change of [{network:'eip155:5042002'},{asset:'0x'+'ab'.repeat(20)},{amountMicros:Number.MAX_SAFE_INTEGER+1},{amountMicros:0.5},{resourceKind:'unknown'},{sourceClaim:{sourceId:'managed'}}])expect(()=>captureResearchPurchaseClaim({...claim(),...change} as never,now)).toThrow();
 expect(captureResearchPurchaseClaim({...claim(),purpose:'resource',issued:undefined,resourceSourceId:'seller',resourceKind:'fetch'},now).context).toMatchObject({sourceId:'seller',kind:'fetch'});
});
it('separates fresh issue windows from already submitted challenge replay',()=>{
 for(const issued of [{...claim().issued,validAfter:String(now/1000)},{...claim().issued,validBefore:String(now/1000+604799)},{...claim().issued,expiresAt:String(now/1000+661)},{...claim().issued,expiresAt:String(now/1000)}])expect(()=>captureResearchPurchaseClaim({...claim(),issued},now)).toThrow();
 const expired={validAfter:'0',validBefore:'604800',expiresAt:'300'};expect(captureResearchPurchaseClaim({...claim(),issued:expired,requireExisting:true},now).required).toBe(true);
 expect(()=>captureResearchPurchaseClaim({...claim(),issued:undefined,requireExisting:true},now)).toThrow();expect(()=>captureResearchPurchaseClaim({...claim(),purpose:'a2a'},now)).toThrow();
});
it('preserves the Source monthly package, exact term and four-way accounting',()=>{
 const {purchase}=fixture();expect(captureResearchMonthly(purchase)).toEqual(purchase);
 for(const edit of [{format:undefined},{network:'eip155:5042002'},{totalMicros:60001},{serviceFeeMicros:20001,totalMicros:60001},{expiresAt:new Date(now+MONTHLY_TERM_MS-1).toISOString()},{researchPackage:{...purchase.researchPackage,version:'unsupported'}}])expect(()=>captureResearchMonthly({...purchase,...edit} as never)).toThrow();
});
it('captures the prepaid order without manufacturing another nonce or settlement',()=>{
 const {purchase,input}=fixture(),captured=captureResearchMonthlyRedemption(input);assertResearchMonthlyOrder(purchase,captured.input);input.order.request.question='mutated';expect(captured.input.order.request!.question).not.toBe('mutated');expect(JSON.parse(captured.rowWire).request_data).toBe(JSON.stringify(captured.input.order.request));
});
it('rejects package, rail, query/hash, started journal and economic mismatches',()=>{
 const {purchase,input}=fixture();for(const edit of [{queryId:'wrong'},{requestHash:'00'.repeat(32)},{startedAt:input.now},{response:{}},{executionJournalVersion:null},{request:{...input.order.request,network:'eip155:5042002'}}])expect(()=>captureResearchMonthlyRedemption({...input,order:{...input.order,...edit}} as never)).toThrow();
 expect(()=>assertResearchMonthlyOrder(purchase,{...input,order:{...input.order,amountUsdc:0.015001}})).toThrow();
});
it('keeps Unicode hash preimages and Source empty-model behavior while refusing JSONB-incompatible text',()=>{
 const {input}=fixture();input.order.request.question='\ufeff\u2028\ud83d\udd12 Unicode';input.order.request.model='';input.order.requestHash=a2aRequestHash({...input.order,...input.order.request});expect(captureResearchMonthlyRedemption(input).input.order.request!.model).toBe('');
 for(const text of ['NUL\0text','unpaired\ud800']){input.order.request.question=text;input.order.requestHash=a2aRequestHash({...input.order,...input.order.request});expect(()=>captureResearchMonthlyRedemption(input)).toThrow();}
});
it('validates contiguous retained slots and keeps conflicting replay private',()=>{
 const {purchase,input}=fixture(),redemption={requestId:input.requestId,orderId:input.order.id,requestHash:input.order.requestHash,createdAt:input.now,slot:0};expect(decodeResearchMonthly({purchase,redemptions:[redemption]}).redemptions).toHaveLength(1);
 for(const redemptions of [[{...redemption,slot:1}],[{...redemption,createdAt:purchase.expiresAt}],[{...redemption,orderId:'a2a_'+'00'.repeat(32)}],[redemption,{...redemption,slot:1}]])expect(()=>decodeResearchMonthly({purchase,redemptions})).toThrow();
 assertResearchMonthlyReplay({...input.order,status:'completed',response:{answer:'retained'}},input.order,redemption);expect(()=>assertResearchMonthlyReplay({...input.order,request:{...input.order.request,question:'different'}},input.order,redemption)).toThrow();
});
it('retains Source legacy package replay without admitting a fresh legacy allocation',()=>{
 const {input}=fixture(),stored={...input.order,researchPackage:null,requestHash:legacyA2aRequestHash({...input.order,...input.order.request})};
 assertResearchMonthlyReplay(stored,input.order,{orderId:stored.id,requestHash:stored.requestHash});expect(()=>captureResearchMonthlyRedemption({...input,order:stored})).toThrow();
});
