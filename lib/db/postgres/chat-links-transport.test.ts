/** Packet and disposal boundaries only, not genuine provider/account admission. */
import { expect,it,vi } from 'vitest';
import type { AccountSnapshot } from '../../accounts/contracts';
import { composePostgresChatLinks } from './chat-links-transport';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
const binding={origin:'https://keryx.cc',network:'eip155:5042' as const},recipient={platform:'telegram' as const,scope:'telegram',userId:'712345',channel:'712345'},wallet='0x'+'11'.repeat(20);
const snapshot:AccountSnapshot={membership:{version:1,accountId:'acct_'+'22'.repeat(32),revision:1,createdAt:1,members:[{wallet,generation:'33'.repeat(32),linkedAt:1}]},session:{sessionHash:'44'.repeat(32),wallet,issuedAt:1,expiresAt:1000},memberGeneration:'33'.repeat(32),credentialGeneration:'55'.repeat(32),binding};
const hash='66'.repeat(32),pending={purpose:'chat-account-link-v1' as const,tokenHash:hash,recipient,binding,issuedAt:1,expiresAt:300001},link={...recipient,accountId:snapshot.membership.accountId,wallet,memberGeneration:snapshot.memberGeneration,linkedAt:2,binding};
function fixture(readOnly=false){let closed=false;const call=vi.fn<PostgresDomainChannel['call']>(),channel:PostgresDomainChannel={get closed(){return closed;},call,async close(){closed=true;}};return {call,channel,port:composePostgresChatLinks(channel,readOnly)};}
it('refuses readonly mutations before input getters or IO',async()=>{
 const f=fixture(true);let getters=0;const bad={get wallet(){getters++;throw Error();}} as never;for(const work of [()=>f.port.issue(bad),()=>f.port.complete(bad,bad),()=>f.port.unlink(bad,bad),()=>f.port.unlinkAccount(bad,bad)])await expect(work()).rejects.toThrow('chat_unavailable');expect(getters).toBe(0);expect(f.call).not.toHaveBeenCalled();
});
it('captures recipient/binding before awaiting and keeps the original delivery channel',async()=>{
 const f=fixture(),r={...recipient,channel:'-712345'},b={...binding};let release!:(v:unknown)=>void;f.call.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));const request=f.port.lookup(r,b);r.userId='999999';b.origin='https://other.example';release({ok:true,value:link});expect(await request).toEqual(link);expect(JSON.parse(f.call.mock.calls[0][1][0]!)).toEqual({recipient:{...recipient,channel:'-712345'},binding});
});
it('captures pending and current account before submitting writes',async()=>{
 const f=fixture(),p=structuredClone(pending);let release!:(v:unknown)=>void;f.call.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));const request=f.port.issue(p);p.recipient.userId='999999';release({ok:true,value:null});await request;expect(JSON.parse(f.call.mock.calls[0][1][0]!)).toEqual({pending});
});
it('refuses foreign preview selectors and lookup identities',async()=>{
 for(const [method,value] of [['preview',{...pending,tokenHash:'77'.repeat(32)}],['lookup',{...link,userId:'999999'}]] as const){const f=fixture();f.call.mockResolvedValue({ok:true,value});await expect(method==='preview'?f.port.preview(hash,binding):f.port.lookup(recipient,binding)).rejects.toThrow('chat_unavailable');}
});
it('rejects oversized, duplicate, foreign-account and unordered list packets',async()=>{
 for(const value of [Array(33).fill(link),[link,link],[{...link,accountId:'acct_'+'77'.repeat(32)}],[{...link,userId:'999999'},link]]){const f=fixture();f.call.mockResolvedValue({ok:true,value});await expect(f.port.list(snapshot)).rejects.toThrow('chat_unavailable');}
});
it('keeps malformed or foreign write acknowledgement unknown without retry',async()=>{
 for(const value of [null,{}, {ok:true,value:{...link,wallet:'0x'+'88'.repeat(20)}},{ok:true,value:{...link,memberGeneration:'99'.repeat(32)}}]){const f=fixture();f.call.mockResolvedValue(value);await expect(f.port.complete(hash,snapshot)).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);expect(f.call).toHaveBeenCalledTimes(1);}
});
it('preserves typed committed refusals and actual unknown acknowledgement classes',async()=>{
 for(const error of ['chat_takeover_refused','chat_account_changed','chat_token_invalid']){const f=fixture();f.call.mockResolvedValue({ok:false,error});await expect(f.port.complete(hash,snapshot)).rejects.toThrow(error);expect(f.call).toHaveBeenCalledTimes(1);}
 const f=fixture(),unknown=new PostgresDomainWriteOutcomeUnknown();f.call.mockRejectedValue(unknown);await expect(f.port.issue(pending)).rejects.toBe(unknown);expect(f.call).toHaveBeenCalledTimes(1);
});
it('discards reads after terminal close and does not reopen or retry',async()=>{
 const f=fixture();let release!:(v:unknown)=>void;f.call.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));const request=f.port.preview(hash,binding);await f.channel.close();release({ok:true,value:pending});await expect(request).rejects.toThrow('chat_unavailable');await expect(f.port.list(snapshot)).rejects.toThrow();expect(f.call).toHaveBeenCalledTimes(1);
});
