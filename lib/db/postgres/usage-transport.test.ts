import { describe,it,expect,vi } from 'vitest';
import { composePostgresUsage } from './usage-transport';
import type { PostgresDomainChannel } from './domain-channel';
import type { QueryRun } from '../../types';
const at='2026-10-09T10:00:00.000Z',window={network:'eip155:5042' as const,since:'1970-01-01T00:00:00.000Z',until:'2026-10-10T00:00:00.000Z',period:'all' as const};
const usage={version:1,network:'eip155:5042',cohort:'unknown',payment:'unknown',actorEvidenceSha256:null,fundingEvidenceSha256:null};
const run=(id:string):QueryRun=>({id,createdAt:at,question:'Original question',answer:'Original body',engine:'heuristic',budget:0,totalSpent:0,totalToCreators:0,subClaims:[],decisions:[],citations:[],trace:[],usage:usage as QueryRun['usage']});
function fixture(){
 let closed=false;const call=vi.fn<PostgresDomainChannel['call']>(),channel:PostgresDomainChannel={get closed(){return closed;},call,async close(){closed=true;}};
 const candidates=['usage-one','usage-two'].map(id=>({id,createdAt:at,originalSha256:'11'.repeat(32),usage}));
 call.mockImplementation(async operation=>{
  if(operation==='usageWindow')return {format:'keryx-native-usage-window-v1',window,runs:candidates.map(r=>({id:r.id,createdAt:r.createdAt,originalSha256:r.originalSha256,usageHex:Buffer.from(JSON.stringify(usage)).toString('hex'),provenanceHex:null,actorId:null})),payments:[]};
  if(operation==='usageSelect')return {format:'keryx-native-usage-selection-v1',candidates};
  if(operation==='usageFinish')return {format:'keryx-native-usage-final-v1',allowed:['usage-two'],runs:[run('usage-two')]};
  throw Error('Unexpected operation');
 });return {call,channel,port:composePostgresUsage(channel,true),candidates};
}
describe('native complete usage reads and final current bodies',()=>{
 it('captures the window before awaiting and keeps financial metadata independent of public bodies',async()=>{const f=fixture(),input={...window},pending=f.port.publicUsage.summary(input);input.network='eip155:5042002' as never;const result=await pending;expect(result.network).toBe('eip155:5042');expect(f.call).toHaveBeenCalledExactlyOnceWith('usageWindow',[JSON.stringify(window)]);});
 it('selects metadata only, then samples remaining captured public originals after withdrawal',async()=>{
  const f=fixture(),plan=await f.port.prepareUsageHistory(window,'unknown',1,true);expect(f.call.mock.calls.map(row=>row[0])).toEqual(['usageWindow','usageSelect']);expect(Reflect.ownKeys(plan)).toEqual(['kind']);
  expect(await f.port.finishPublishedUsageHistory(plan)).toEqual({windowRuns:1,runs:[run('usage-two')]});
 });
 it('does not accept fabricated, copied or mode-confused selections',async()=>{const f=fixture();await expect(f.port.finishUsageHistory({kind:'native-usage-selection'})).rejects.toThrow();const plan=await f.port.prepareUsageHistory(window,'unknown',1,true);await expect(f.port.finishUsageHistory(plan)).rejects.toThrow();await expect(f.port.finishPublishedUsageHistory({...plan})).rejects.toThrow();expect(f.call.mock.calls.some(row=>row[0]==='usageFinish')).toBe(false);});
 it('refuses unexpected, duplicate, reordered or changed final rows',async()=>{
  for(const packet of [{allowed:['other'],runs:[run('other')]},{allowed:['usage-one','usage-one'],runs:[run('usage-one')]},{allowed:['usage-two','usage-one'],runs:[run('usage-two')]},{allowed:['usage-two'],runs:[{...run('usage-two'),createdAt:'2026-10-08T10:00:00.000Z'}]}]){const f=fixture(),plan=await f.port.prepareUsageHistory(window,'unknown',1,true);f.call.mockResolvedValue({format:'keryx-native-usage-final-v1',...packet});await expect(f.port.finishPublishedUsageHistory(plan)).rejects.toThrow();}
 });
 it('refuses invalid selectors and disabled publication before SQL, with terminal disposal',async()=>{
  const f=fixture();for(const limit of [0,101,1.5])await expect(f.port.publicUsage.history(window,'unknown',limit)).rejects.toThrow();await expect(composePostgresUsage(f.channel,false).publicUsage.publishedHistory!(window,'unknown',1)).rejects.toThrow();expect(f.call).not.toHaveBeenCalled();const plan=await f.port.prepareUsageHistory(window,'unknown',1,true);await f.channel.close();await expect(f.port.finishPublishedUsageHistory(plan)).rejects.toThrow();
 });
});
