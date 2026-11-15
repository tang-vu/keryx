/** Recording protocol channel only; never installed adapter provenance. */
import { beforeEach,afterEach,expect,it,vi } from 'vitest';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir,homedir } from 'node:os';
import { ARC_MAINNET_PROFILE } from '../../arc-network-profile';
import { syntheticFailedOriginal,syntheticFulfilledRun } from '../a2a-fulfillment-fixture';
import { canonicalJson } from '../../canonical-json';
import { fulfilledOriginalOrders } from '../../a2a/fulfillment-delivery';
import { fulfillmentObjectSha256,fulfillmentSha256 } from '../../a2a/failed-original-fulfillment-protocol';
import { readBoundSupplementaryContext,fulfillmentEvidenceCapability } from '../../a2a/fulfillment-supplement-evidence';
import { renderFulfilledOriginalAnswer } from '../../a2a/original-fulfillment-answer';
import type { GatheredContent } from '../../llm/reasoning-engine';
import { nativeFulfillmentOrderWire } from './a2a-fulfillment-packet';
import { composePostgresA2aFulfillment } from './a2a-fulfillment-transport';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
const setup=()=>{
 const f=syntheticFailedOriginal(4210,ARC_MAINNET_PROFILE),claim={...f.input,failedOrder:f.order},result=syntheticFulfilledRun(claim),state={closed:false};
 const claimRowWire=JSON.stringify({original_id:f.order.id,claim_id:f.input.claimId,authority_data:canonicalJson(f.authority),failed_order_data:canonicalJson(f.order),claimed_at:f.input.claimedAt});
 const snapshot={claimRowWire,completionRowWire:null as string|null,orderWire:nativeFulfillmentOrderWire(f.order),runWire:null as string|null,storeId:'3821e833-f4ca-44d3-a944-0cf892ab0b85',settled:true,noCreatorAttempts:true};
 const call=vi.fn<PostgresDomainChannel['call']>().mockResolvedValue(true),channel:PostgresDomainChannel={get closed(){return state.closed;},call,async close(){state.closed=true;}};
 return {...f,claim,result,snapshot,channel,call,state,port:composePostgresA2aFulfillment(channel,false)};
};
const folders:string[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime('2026-10-06T10:00:05.000Z');});afterEach(()=>{vi.useRealTimers();for(const folder of folders.splice(0))rmSync(folder,{recursive:true});});
function supplemental(f:ReturnType<typeof setup>){
 const folder=mkdtempSync(join(process.platform==='win32'?tmpdir():homedir(),'keryx-native-supplement-'));folders.push(folder);
 const quotes=['Synthetic original quotation for the first target.','Synthetic supplemental quotation for the second target.'],hash=fulfillmentSha256;
 const gathered:GatheredContent[]=[{sourceId:'public:fulfillment:document-one',sourceName:'Synthetic original',marker:'S1',text:quotes[0],sourceKind:'public-reference',creatorRewardEligible:false,
  itemId:'document-one',itemTitle:'Synthetic original',itemUrl:'https://developers.circle.com/synthetic/original',contentVersion:hash(quotes[0]),requestedSource:{urls:['https://developers.circle.com/synthetic/original'],readScope:'bounded-whole-document'},
  webProvenance:{retrievedAt:'2026-10-06T09:00:00.000Z',publisherGroup:'developers.circle.com',normalizedBodyHash:hash(quotes[0]),extraction:'text',truncated:false}}];
 const packet={input:f.authority.input,gathered,packetSha256:fulfillmentObjectSha256({input:f.authority.input,gathered}),inputSemanticSha256:fulfillmentObjectSha256(f.authority.input)};
 const binding={nativeClaimSha256:fulfillmentObjectSha256(f.claim),ownerAuthorizationSha256:'bb'.repeat(32),executorCommit:f.authority.executorCommit};
 const raw='Header\n'+quotes[1]+'\nFooter',bodyFile=join(folder,'section.txt');writeFileSync(join(folder,'raw.txt'),raw,{mode:0o600});writeFileSync(bodyFile,quotes[1],{mode:0o600});
 const manifest={format:'keryx-original-supplementary-evidence-v1',...binding,originalAuthoritySha256:fulfillmentObjectSha256(f.authority),originalPacketSha256:packet.packetSha256,originalInputSemanticSha256:packet.inputSemanticSha256,questionSha256:f.authority.input.questionSha256,
  sources:[{id:'synthetic-second',title:'Synthetic supplement',requestedUrl:'https://docs.arc.io/synthetic/second',finalUrl:'https://docs.arc.io/synthetic/second',retrievedAt:'2026-10-06T09:30:00.000Z',status:200,
   rawFile:'raw.txt',rawSha256:hash(raw),rawBytes:Buffer.byteLength(raw),bodyFile:'section.txt',bodySha256:hash(quotes[1]),bodyBytes:Buffer.byteLength(quotes[1]),spans:[{start:7,end:7+quotes[1].length}]}],payments:0,creatorRewards:0,provenance:'reviewed-free-official-verbatim-sections'};
 const inputFile=join(folder,'supplement.json'),bytes=canonicalJson(manifest);writeFileSync(inputFile,bytes,{mode:0o600});
 const context=readBoundSupplementaryContext(inputFile,hash(bytes),{authority:f.authority,packet},binding),run=f.result.run;
 const statements=quotes.map((quote,claimIndex)=>({claimIndex,quote,marker:`S${claimIndex+1}`,text:`Synthetic reviewed target ${claimIndex}.`}));
 run.citations=context.gathered.map(source=>({marker:source.marker,sourceId:source.sourceId,sourceName:source.sourceName,sourceKind:'public-reference',itemId:source.itemId,itemTitle:source.itemTitle,itemUrl:source.itemUrl,contentVersion:source.contentVersion,requestedSource:source.requestedSource,webProvenance:source.webProvenance,weight:0,reward:0,rationale:'Synthetic protected body.'}));
 run.evidence=statements.map((statement,index)=>({...statement,claim:run.subClaims[index],...run.citations[index],support:.9,qualifiesForAnswer:true,qualifiesForReward:false}));
 run.claimCoverage=statements.map((statement,index)=>({claimIndex:index,claim:run.subClaims[index],coverage:.9,coveredBy:[statement.marker]}));
 run.originalFulfillment={...run.originalFulfillment!,format:'keryx-a2a-original-fulfillment-result-v2',supplementaryInputSha256:context.authoritySha256,contextSha256:context.contextSha256,statements,statementReviews:statements.map(s=>({...s,support:.9}))};
 run.answer=renderFulfilledOriginalAnswer({question:run.question,answer:'',statements,evidenceGaps:[],ledger:{evidence:run.evidence,claimCoverage:run.claimCoverage,acceptedMarkers:new Set(['S1','S2']),droppedEvidence:0,droppedCitations:[]}});
 f.result.runSha256=fulfillmentObjectSha256(run);return {capability:fulfillmentEvidenceCapability(context,f.claim,run),bodyFile};
}
it('refuses readonly writes and provenance callbacks before inspecting untrusted getters',async()=>{
 const f=setup();let touched=0;const input={get authority(){touched++;throw Error('untrusted');},get run(){touched++;throw Error('untrusted');}} as never;
 const reader=composePostgresA2aFulfillment(f.channel,true);await expect(reader.claimA2aFailedOriginalFulfillment(input)).rejects.toThrow();await expect(reader.completeA2aFailedOriginalFulfillment(input)).rejects.toThrow();
 expect(touched).toBe(0);expect(f.call).not.toHaveBeenCalled();expect(()=>Reflect.apply(composePostgresA2aFulfillment,undefined,[f.channel,false,()=>true])).toThrow();
});
it('captures claim metadata before the original read and never retries an unknown claim acknowledgement',async()=>{
 const f=setup(),question=f.input.authority.question;
 f.call.mockImplementation(async operation=>operation==='a2aOriginalSnapshot'?{orderWire:f.snapshot.orderWire,storeId:f.snapshot.storeId}:Promise.reject(new PostgresDomainWriteOutcomeUnknown()));
 const pending=f.port.claimA2aFailedOriginalFulfillment(f.input);f.input.authority.question='caller mutation';await expect(pending).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);
 expect(f.call.mock.calls.map(c=>c[0])).toEqual(['a2aOriginalSnapshot','a2aFulfillmentClaim']);expect(JSON.parse(f.call.mock.calls[1][1][1]!).input.authority.question).toBe(question);
});
it('requires one exact native snapshot, then rechecks its current digests before publishing historical delivery',async()=>{
 const f=setup(),metadata={claimId:f.result.claimId,originalId:f.result.originalId,runSha256:f.result.runSha256,providerLedgerSha256:f.result.providerLedgerSha256,completedAt:f.result.completedAt};
 f.snapshot.completionRowWire=JSON.stringify({original_id:metadata.originalId,claim_id:metadata.claimId,run_sha256:metadata.runSha256,provider_ledger_sha256:metadata.providerLedgerSha256,completed_at:metadata.completedAt});
 f.snapshot.runWire=canonicalJson(f.result.run);f.snapshot.orderWire=nativeFulfillmentOrderWire(fulfilledOriginalOrders(f.result.run,f.claim,f.result).at(-1)!);
 f.call.mockImplementation(async operation=>operation==='a2aFulfillmentSnapshot'?f.snapshot:true);
 expect(await f.port.hasA2aFailedOriginalFulfillment(f.authority)).toBe(true);expect(f.call.mock.calls.map(c=>c[0])).toEqual(['a2aFulfillmentSnapshot','a2aFulfillmentVerify']);
 f.call.mockClear();f.call.mockImplementation(async operation=>operation==='a2aFulfillmentSnapshot'?f.snapshot:false);expect(await f.port.hasA2aFailedOriginalFulfillment(f.authority)).toBe(false);
 expect(f.call.mock.calls.map(c=>c[0])).toEqual(['a2aFulfillmentSnapshot','a2aFulfillmentVerify']);
});
it('does not mint supplement evidence from metadata or callbacks and never submits completion on missing proof',async()=>{
 const f=setup(),m=f.result.run.originalFulfillment!;f.result.run.originalFulfillment={...m,format:'keryx-a2a-original-fulfillment-result-v2',supplementaryInputSha256:'ba'.repeat(32),contextSha256:'bb'.repeat(32),statementReviews:m.statements.map(s=>({...s,support:.9}))};f.result.runSha256=fulfillmentObjectSha256(f.result.run);
 f.call.mockResolvedValue(f.snapshot);for(const proof of [undefined,{},()=>true])await expect(f.port.completeA2aFailedOriginalFulfillment(f.result,proof as never)).rejects.toThrow(/evidence refused/);
 expect(f.call.mock.calls.every(c=>c[0]==='a2aFulfillmentSnapshot')).toBe(true);
});
it('captures the run before await and reports malformed/disposed completion acknowledgements without a retry',async()=>{
 const f=setup(),answer=f.result.run.answer;f.call.mockImplementation(async operation=>operation==='a2aFulfillmentSnapshot'?f.snapshot:{});
 const pending=f.port.completeA2aFailedOriginalFulfillment(f.result);f.result.run.answer='mutated after capture';await expect(pending).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);
 expect(f.call.mock.calls.map(c=>c[0])).toEqual(['a2aFulfillmentSnapshot','a2aFulfillmentComplete']);
 const packet=JSON.parse(f.call.mock.calls[1][1][1]!);expect(JSON.parse(Buffer.from(packet.publication.originalHex,'hex').toString('utf8')).answer).toBe(answer);
});
it('accepts genuine protected supplement evidence, then revalidates it after the final native read',async()=>{
 const f=setup(),proof=supplemental(f);f.call.mockImplementation(async operation=>operation==='a2aFulfillmentSnapshot'?f.snapshot:true);
 expect(await f.port.completeA2aFailedOriginalFulfillment(f.result,proof.capability)).toBe(true);
 const m=f.result;f.snapshot.completionRowWire=JSON.stringify({original_id:m.originalId,claim_id:m.claimId,run_sha256:m.runSha256,provider_ledger_sha256:m.providerLedgerSha256,completed_at:m.completedAt});
 f.snapshot.orderWire=nativeFulfillmentOrderWire(fulfilledOriginalOrders(m.run,f.claim,m)[0]);f.snapshot.runWire=canonicalJson(m.run);
 expect(await f.port.hasA2aFailedOriginalFulfillment(f.authority,proof.capability)).toBe(true);
 f.call.mockClear();f.call.mockImplementation(async operation=>{if(operation==='a2aFulfillmentSnapshot')return f.snapshot;writeFileSync(proof.bodyFile,'revoked protected bytes',{mode:0o600});return true;});
 expect(await f.port.hasA2aFailedOriginalFulfillment(f.authority,proof.capability)).toBe(false);expect(f.call.mock.calls.map(c=>c[0])).toEqual(['a2aFulfillmentSnapshot','a2aFulfillmentVerify']);
});
it('classifies evidence revocation during completion acknowledgement as unknown and never retries',async()=>{
 const f=setup(),proof=supplemental(f);f.call.mockImplementation(async operation=>{if(operation==='a2aFulfillmentSnapshot')return f.snapshot;writeFileSync(proof.bodyFile,'revoked after submission',{mode:0o600});return true;});
 await expect(f.port.completeA2aFailedOriginalFulfillment(f.result,proof.capability)).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);
 expect(f.call.mock.calls.map(c=>c[0])).toEqual(['a2aFulfillmentSnapshot','a2aFulfillmentComplete']);
});
