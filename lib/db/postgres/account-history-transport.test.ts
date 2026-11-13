/** Packet/async boundary controls only; genuine admission is tested natively. */
import { createHash } from 'node:crypto';
import { expect,it,vi } from 'vitest';
import type { AccountSnapshot,AccountHistoryObservation } from '../../accounts/contracts';
import type { QueryRun } from '../../types';
import { composePostgresAccountHistory } from './account-history-transport';
import type { PostgresDomainChannel } from './domain-channel';
const wallet='0x'+'11'.repeat(20),binding={origin:'https://keryx.cc',network:'eip155:5042' as const};
const snapshot:AccountSnapshot={membership:{version:1,accountId:'acct_'+'22'.repeat(32),revision:1,createdAt:1,members:[{wallet,generation:'33'.repeat(32),linkedAt:1}]},session:{sessionHash:'44'.repeat(32),wallet,issuedAt:1,expiresAt:1000},memberGeneration:'33'.repeat(32),credentialGeneration:'55'.repeat(32),binding};
const run={id:'synthetic-private',createdAt:'2026-11-13T00:00:00.000Z',question:'Private question',answer:'Full original',budget:0,engine:'heuristic',totalSpent:0,totalToCreators:0,subClaims:[],decisions:[],citations:[],trace:[],asker:wallet,extra:{unrelated:'\0\ud800'}} as QueryRun;
const item:AccountHistoryObservation={id:run.id,ownerWallet:wallet,run,state:{visibility:'private',revision:0,erased:false}};
function fixture(){
 let closed=false;const call=vi.fn<PostgresDomainChannel['call']>(),channel:PostgresDomainChannel={get closed(){return closed;},call,async close(){closed=true;}};
 const wire=JSON.stringify(run),row={id:run.id,asker:wallet,created_at:run.createdAt,original_hash:createHash('sha256').update(wire).digest('hex'),original_hex:Buffer.from(wire).toString('hex'),p_id:run.id,visibility:'private',revision:0,erased:0,retained_owner:null,retained_digest:null,retained_binding:null,updated_at:run.createdAt,c_id:null,c_network:null,c_origin:null,claimed_wallet:null,claimed_at:null,completed_at:null,original_sha256:null,a2a:0};
 const response=(rows:unknown[]=[],fingerprint='66'.repeat(32))=>({ok:true,value:{format:'keryx-native-account-history-v1',fingerprint,rows}});
 const port=composePostgresAccountHistory(channel),prepare=(items:readonly AccountHistoryObservation[]=[item])=>port.prepareAsyncHistoryFence!(snapshot,items,Date.now()+25000);
 return {call,channel,row,response,port,prepare};
}
it('captures full input before awaiting and retains only selectors in the final read',async()=>{
 const f=fixture(),mutable=structuredClone(item),start=structuredClone(snapshot);let release!:(v:unknown)=>void;f.call.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 const pending=f.port.prepareAsyncHistoryFence!(start,[mutable],Date.now()+25000);mutable.run.answer='changed';start.membership.revision=2;release(f.response([f.row]));const finish=await pending;
 f.call.mockResolvedValueOnce(f.response());await finish();expect(f.call).toHaveBeenCalledTimes(2);expect(JSON.parse(f.call.mock.calls[0][1][0]!)).toEqual(snapshot);expect(f.call.mock.calls[1][1].join('')).not.toContain('Full original');expect(f.call.mock.calls[1][1][2]).toBe('false');await expect(finish()).rejects.toThrow();expect(f.call).toHaveBeenCalledTimes(2);
});
it('refuses a changed unrelated original field and raw byte hash mismatches',async()=>{
 for(const patch of [{original_hash:'77'.repeat(32)},{original_hex:Buffer.from(JSON.stringify({...run,extra:{changed:true}})).toString('hex')}]){const f=fixture();f.call.mockResolvedValue(f.response([{...f.row,...patch}]));await expect(f.prepare()).rejects.toThrow();expect(f.call).toHaveBeenCalledTimes(1);}
});
it('requires positive captured ownership for detail observations without attribution',async()=>{
 const f=fixture();f.call.mockResolvedValue(f.response([{...f.row,asker:null}]));await expect(f.prepare()).rejects.toThrow('account_unavailable');
});
it('refuses incomplete/foreign originals and malformed UTF-8 before a final capability escapes',async()=>{
 for(const rows of [[],[{...fixture().row,id:'foreign'}],[{...fixture().row,original_hex:'ff',original_hash:createHash('sha256').update(Buffer.from([255])).digest('hex')}]]){const f=fixture();f.call.mockResolvedValue(f.response(rows));await expect(f.prepare()).rejects.toThrow();}
});
it('refuses a changed fingerprint or leaked final bodies and consumes the failed final check',async()=>{
 for(const changed of ['fingerprint','rows']){const f=fixture();f.call.mockResolvedValueOnce(f.response([f.row]));const finish=await f.prepare();f.call.mockResolvedValueOnce(f.response(changed==='rows'?[f.row]:[],'77'.repeat(32)));await expect(finish()).rejects.toThrow();await expect(finish()).rejects.toThrow();expect(f.call).toHaveBeenCalledTimes(2);}
});
it('keeps a final current-session refusal typed and never retries it',async()=>{
 const f=fixture();f.call.mockResolvedValueOnce(f.response([f.row]));const finish=await f.prepare();f.call.mockResolvedValueOnce({ok:false,error:'account_unauthenticated'});await expect(finish()).rejects.toThrow('account_unauthenticated');expect(f.call).toHaveBeenCalledTimes(2);
});
it('retains item/deadline bounds before IO and discards in-flight disposal',async()=>{
 const f=fixture();await expect(f.prepare(Array(1001).fill(item))).rejects.toThrow();await expect(f.port.prepareAsyncHistoryFence!(snapshot,[],Date.now()-1)).rejects.toThrow();expect(f.call).not.toHaveBeenCalled();
 let release!:(v:unknown)=>void;f.call.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));const pending=f.prepare();await f.channel.close();release(f.response([f.row]));await expect(pending).rejects.toThrow();expect(f.call).toHaveBeenCalledTimes(1);
});
