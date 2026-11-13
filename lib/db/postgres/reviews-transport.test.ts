import { describe,it,expect,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { canonicalJson } from '../../canonical-json';
import { composePostgresDecisionReviews } from './reviews-transport';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
const owner='0x'+'11'.repeat(20),id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',runId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',at=Date.parse('2026-10-09T10:00:00.000Z');
const input=()=>({policyVersion:'captured-owner-decisions-v1' as const,engine:'synthetic',requestedModel:null,runId,round:0,ordinal:0,sourceName:'Original\0🌍',modelAction:'BUY' as const,codeAction:'BUY' as const,codeRule:'selected' as const,reviewFirst:true,cohort:'unknown' as const,cohortEvidence:null,terms:{assetId:'item:one',sourceId:'one',owned:true,itemId:'one',contentVersion:'version-one',network:'eip155:5042' as const,payTo:owner,priceMicroUsdc:'1',listPriceMicroUsdc:'1',citationBudgetMicroUsdc:'1'}});
const row=()=>({id,inputHex:Buffer.from(canonicalJson(input())).toString('hex'),createdAt:new Date(at).toISOString(),expiresAt:null,state:'observed',action:'BUY',rule:'selected',verdictHex:null});
function fixture(){let closed=false;const call=vi.fn<PostgresDomainChannel['call']>().mockResolvedValue({row:row()}),channel:PostgresDomainChannel={get closed(){return closed;},call,async close(){closed=true;}};return {call,channel,port:composePostgresDecisionReviews(channel,false)};}
describe('native decision reviews',()=>{
 it('captures original input before awaiting and preserves escaped NUL in a source name',async()=>{
  const {port,call}=fixture(),raw=input(),pending=port.capture(owner,raw,at);raw.sourceName='Changed';const record=await pending;
  const [operation,[wallet,wire]]=call.mock.calls[0];expect(operation).toBe('reviewCapture');expect(wallet).toBe(owner);expect(JSON.parse(JSON.parse(wire!).inputWire).sourceName).toBe('Original\0🌍');expect(record.sourceName).toBe('Original\0🌍');
 });
 it('refuses readonly mutations and malformed inputs before submission',async()=>{
  const {channel,call}=fixture(),port=composePostgresDecisionReviews(channel,true);await expect(port.capture(owner,input(),at)).rejects.toThrow('review_unavailable');await expect(port.verdict(owner,{id,key:randomUUID(),context:'gate',value:'agree'},at)).rejects.toThrow('review_unavailable');expect(call).not.toHaveBeenCalled();
  await expect(composePostgresDecisionReviews(channel,false).capture(owner,{...input(),sourceName:'\ud800'},at)).rejects.toThrow();expect(call).not.toHaveBeenCalled();
 });
 it('maps only closed business refusals and keeps malformed writes uncertain',async()=>{
  const {port,call}=fixture();call.mockResolvedValue({error:'review_conflict'});await expect(port.begin(owner,id,at)).rejects.toThrow('review_conflict');
  call.mockResolvedValue({row:{...row(),inputHex:'zz'}});await expect(port.begin(owner,id,at)).rejects.toThrow(PostgresDomainWriteOutcomeUnknown);await expect(port.read(owner,id)).rejects.toThrow('review_unavailable');expect(call).toHaveBeenCalledTimes(3);
 });
 it('never publishes after terminal disposal or retries an uncertain write',async()=>{
  const {port,channel,call}=fixture();let finish!:(v:unknown)=>void;call.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const pending=port.begin(owner,id,at),outcome=expect(pending).rejects.toThrow(PostgresDomainWriteOutcomeUnknown);await channel.close();finish({row:row()});await outcome;await expect(port.read(owner,id)).rejects.toThrow('review_unavailable');expect(call).toHaveBeenCalledTimes(1);
 });
 it('validates aggregate counts and publishes no private review text',async()=>{
  const {port,call}=fixture();call.mockResolvedValue({groups:[{cohort:'unknown',model:'BUY',action:'SKIP',rule:'budget',verdict:'agree',n:2}]});const args=['eip155:5042','2026-10-09T00:00:00.000Z','2026-10-10T00:00:00.000Z'] as const,result=await port.metrics(...args);expect(result.cohorts[3]).toMatchObject({decisions:2,agrees:2,agreementRate:1,modelCodeDifferences:2,codeRefusals:2,refusalReasons:{budget:2}});expect(JSON.stringify(result)).not.toContain('Original');
  call.mockResolvedValue({groups:[{cohort:'unknown',model:'BUY',action:'SKIP',rule:'budget',verdict:'agree',n:Number.MAX_SAFE_INTEGER+1}]});await expect(port.metrics(...args)).rejects.toThrow('review_unavailable');
 });
});
