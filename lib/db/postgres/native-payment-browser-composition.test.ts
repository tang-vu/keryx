import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {assembleNativePostgresBusinessCore} from '../supabase-adapter';
import {storageDomainClient,type StorageDomainAuthority} from '../supabase-authority';
import {STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity} from '../storage-identity';
import {assertPostgresRuntimeIdentity} from './runtime-adapter';
import {PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel} from './domain-channel';
import {composePostgresPaymentEvents} from './payment-events-transport';
import {composePostgresBrowserJournal} from './browser-journal-transport';
import type {PaymentRecord} from '../../types';

const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',network:'eip155:5042',authorityMode:'mainnet-real',deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:'2026-11-15T00:00:00.000Z',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,provenanceDigest:'11'.repeat(32)};
function fixture(readOnly=false){
 const rpc=vi.fn<StorageDomainAuthority['rpcResult']>(async()=>{throw Error('legacy RPC must not run');}),authority={rpcResult:rpc},call=vi.fn<PostgresDomainChannel['call']>(async()=>null),channel:PostgresDomainChannel={closed:false,call,async close(){}};
 const core=assembleNativePostgresBusinessCore({identity,authority:{...authority,domainClient:()=>storageDomainClient(authority)},assertEntry:()=>{},verify:async()=>{},paymentEvents:composePostgresPaymentEvents(channel,readOnly),browserJournal:composePostgresBrowserJournal(channel,readOnly)});
 return {core,call,rpc};
}
it('uses only the fixed read while refusing readonly mutations before caller getters',async()=>{
 const f=fixture(true);await f.core.adapter.init();let getters=0;
 expect(await f.core.adapter.getSessionGrant('synthetic-session')).toBeNull();expect(f.call.mock.calls[0][0]).toBe('browserJournalReplay');
 await expect(f.core.adapter.recordPayment({get kind(){getters++;throw Error('caller getter');}} as never)).rejects.toThrow();
 await expect(f.core.adapter.upsertSessionGrant({get ownerAddr(){getters++;throw Error('caller getter');}} as never)).rejects.toThrow();
 expect(getters).toBe(0);expect(f.call).toHaveBeenCalledOnce();expect(f.rpc).not.toHaveBeenCalled();
 await expect(assertPostgresRuntimeIdentity(f.core.adapter,'write')).rejects.toThrow();
});
it('captures the original payment before its first await and keeps a submitted write unknown after disposal',async()=>{
 const f=fixture();await f.core.adapter.init();let finish!:(value:boolean)=>void;
 f.call.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const p:PaymentRecord={id:'synthetic-original',createdAt:'2026-11-15T00:00:00.000Z',kind:'citation',queryId:'synthetic',sourceId:'synthetic',sourceName:'original\0name',payer:'0x'+'11'.repeat(20),payee:'0x'+'22'.repeat(20),amountUsdc:0.01,network:'eip155:5042',settled:false,settlementStatus:'pending'};
 const pending=f.core.adapter.recordPayment(p),refused=expect(pending).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);
 p.sourceName='changed';const packet=JSON.parse(f.call.mock.calls[0][1][0]!);expect(JSON.parse(packet.rowWire).source_name).toBe('original\0name');
 f.core.hooks.close();finish(true);await refused;expect(f.call).toHaveBeenCalledOnce();expect(f.rpc).not.toHaveBeenCalled();
});
it('suppresses a delayed browser read after disposal without classifying it as a submitted write',async()=>{
 const f=fixture();await f.core.adapter.init();let finish!:(value:boolean)=>void;
 f.call.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const result=f.core.adapter.browserJournalActive(),refused=expect(result).rejects.not.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);
 f.core.hooks.close();finish(true);await refused;expect(f.call).toHaveBeenCalledOnce();expect(f.rpc).not.toHaveBeenCalled();
});
