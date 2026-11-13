import { describe,it,expect,vi } from 'vitest';
import { composePostgresHealth } from './health-transport';
import type { PostgresDomainChannel } from './domain-channel';
const hex=(v:string)=>Buffer.from(v).toString('hex');
function fixture(){let closed=false;const call=vi.fn<PostgresDomainChannel['call']>(),channel:PostgresDomainChannel={get closed(){return closed;},call,async close(){closed=true;}};return {call,channel,port:composePostgresHealth(channel)};}
describe('fixed native health observation calls',()=>{
 it('captures and deduplicates keys before awaiting, retaining BOM/NUL and missing keys',async()=>{
  const {call,port}=fixture(),keys=['a','a','missing','nul\0'];call.mockResolvedValue({entries:[{keyHex:hex('a'),valueHex:hex('\ufeffvalue')},{keyHex:hex('missing'),valueHex:null},{keyHex:hex('nul\0'),valueHex:null}]});const request=port.getSyncStates(keys);keys[0]='changed';expect([...(await request)]).toEqual([['a','\ufeffvalue'],['missing',null],['nul\0',null]]);expect(call).toHaveBeenCalledExactlyOnceWith('syncStateBatch',[JSON.stringify(['a','missing','nul\0'].map(hex))]);
 });
 it('refuses malformed or excessive key inputs before submission',async()=>{const {call,port}=fixture();for(const keys of [Array(33).fill('key'),[''],['x'.repeat(257)],['\ud800']])await expect(port.getSyncStates(keys)).rejects.toThrow();expect(call).not.toHaveBeenCalled();});
 it('refuses incomplete, reordered, duplicate or malformed state replies',async()=>{
  const {call,port}=fixture();for(const entries of [[],[{keyHex:hex('b'),valueHex:null}],[{keyHex:hex('a'),valueHex:'zz'}],[{keyHex:hex('a'),valueHex:null},{keyHex:hex('a'),valueHex:null}]]){call.mockResolvedValue({entries});await expect(port.getSyncStates(['a'])).rejects.toThrow();}
 });
 it('uses a captured finite clock and complete completion markers for job snapshots',async()=>{
  const {call,port}=fixture(),now=Date.parse('2026-10-09T12:00:00.000Z');call.mockResolvedValue({rows:[]});const jobs=await port.currentA2aOperationsSnapshot(now);expect(jobs.queued).toBe(0);expect(jobs.completionLatencyCohorts).not.toBeNull();expect(call).toHaveBeenCalledExactlyOnceWith('currentJobSnapshot',['2026-10-08T12:00:00.000Z']);
  for(const value of [NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER])await expect(port.currentA2aOperationsSnapshot(value)).rejects.toThrow();expect(call).toHaveBeenCalledTimes(1);
 });
 it('keeps disposal terminal before and after pending observations',async()=>{
  const {call,port,channel}=fixture();let finish!:(v:unknown)=>void;call.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const request=port.getSyncStates(['a']),outcome=expect(request).rejects.toThrow();await channel.close();finish({entries:[{keyHex:hex('a'),valueHex:null}]});await outcome;await expect(port.getSyncStates([])).rejects.toThrow();expect(call).toHaveBeenCalledTimes(1);
 });
 it('refuses job packets with missing completion markers or unknown status',async()=>{
  const {call,port}=fixture(),row={status:'completed',createdAt:'2026-10-09T10:00:00.000Z',updatedAt:'2026-10-09T10:00:00.000Z',startedAt:null,executionJournalVersion:null,researchPackage:null,serviceReceipt:null,resolution:null};
  for(const key of ['executionJournalVersion','researchPackage','serviceReceipt','resolution']){const broken={...row};Reflect.deleteProperty(broken,key);call.mockResolvedValue({rows:[broken]});await expect(port.currentA2aOperationsSnapshot(Date.now())).rejects.toThrow();}
  call.mockResolvedValue({rows:[{...row,status:'unknown'}]});await expect(port.currentA2aOperationsSnapshot(Date.now())).rejects.toThrow();
 });
});
