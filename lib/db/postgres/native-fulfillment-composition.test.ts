import { expect,it,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { assembleNativePostgresBusinessCore } from '../supabase-adapter';
import { storageDomainClient,type StorageDomainAuthority } from '../supabase-authority';
import { STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity } from '../storage-identity';
import { composePostgresA2aFulfillment,type PostgresA2aFulfillmentPort } from './a2a-fulfillment-transport';
import { assertPostgresRuntimeIdentity } from './runtime-adapter';
import type { PostgresDomainChannel } from './domain-channel';
import { PostgresDomainWriteOutcomeUnknown } from './domain-channel';
import { composePostgresRuntimeTransport } from './runtime-transport';
const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',network:'eip155:5042',authorityMode:'mainnet-real',deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:'2026-11-15T00:00:00.000Z',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,provenanceDigest:'11'.repeat(32)};
const id='a2a_'+'aa'.repeat(32);
function fixture(readOnly:boolean,override?:PostgresA2aFulfillmentPort){
 const rpc=vi.fn<StorageDomainAuthority['rpcResult']>(async()=>({data:null,error:null})),authority={rpcResult:rpc};
 const call=vi.fn<PostgresDomainChannel['call']>(async()=>({claimRowWire:null,completionRowWire:null})),channel:PostgresDomainChannel={closed:false,call,close:async()=>{}};
 const core=assembleNativePostgresBusinessCore({identity,authority:{...authority,domainClient:()=>storageDomainClient(authority)},assertEntry:()=>{},verify:async()=>{},a2aFulfillment:override??composePostgresA2aFulfillment(channel,readOnly)});return {core,rpc,call};
}
it('routes current fulfillment reads without a legacy RPC fallback or installed proof',async()=>{
 const f=fixture(false);await f.core.adapter.init();expect(await f.core.adapter.getA2aFailedOriginalFulfillment(id)).toBeNull();
 expect(f.call).toHaveBeenCalledExactlyOnceWith('a2aFulfillmentGet',[id]);expect(f.rpc).not.toHaveBeenCalled();
 await expect(assertPostgresRuntimeIdentity(f.core.adapter,'write')).rejects.toThrow();
});
it('refuses readonly claims before caller getters or SQL',async()=>{
 const f=fixture(true);await f.core.adapter.init();let fields=0;
 await expect(f.core.adapter.claimA2aFailedOriginalFulfillment({get authority(){fields++;throw Error('caller field');}} as never)).rejects.toThrow();
 expect(fields).toBe(0);expect(f.call).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();
});
it('rejects a fulfilled read after terminal core disposal',async()=>{
 let finish!:(value:null)=>void;const pending=new Promise<null>(resolve=>{finish=resolve;});
 const channel:PostgresDomainChannel={closed:false,call:async()=>{throw Error('unused');},close:async()=>{}},base=composePostgresA2aFulfillment(channel,false);
 const f=fixture(false,{...base,getA2aFailedOriginalFulfillment:()=>pending});await f.core.adapter.init();
 const result=f.core.adapter.getA2aFailedOriginalFulfillment(id),refused=expect(result).rejects.toThrow();f.core.hooks.close();finish(null);await refused;
});
it('preserves unknown outcome after a fulfillment mutation finishes on a disposed core',async()=>{
 let finish!:(value:null)=>void;const pending=new Promise<null>(resolve=>{finish=resolve;});
 const channel:PostgresDomainChannel={closed:false,call:async()=>{throw Error('unused');},close:async()=>{}},base=composePostgresA2aFulfillment(channel,false);
 // Internal synthetic composition only: no native capture or installed proof.
 const f=fixture(false,{...base,claimA2aFailedOriginalFulfillment:()=>pending});await f.core.adapter.init();
 const result=f.core.adapter.claimA2aFailedOriginalFulfillment({} as never),refused=expect(result).rejects.toThrow(PostgresDomainWriteOutcomeUnknown);
 f.core.hooks.close();finish(null);await refused;expect(f.rpc).not.toHaveBeenCalled();
});
it('composes financial and fulfillment reads on one fixed channel without granting provenance',async()=>{
 const call=vi.fn<PostgresDomainChannel['call']>(async operation=>operation==='a2aFulfillmentGet'?{claimRowWire:null,completionRowWire:null}:null),channel:PostgresDomainChannel={closed:false,call,close:async()=>{}};
 const transport=composePostgresRuntimeTransport(channel,identity,'22'.repeat(32),true),rpc=vi.fn<StorageDomainAuthority['rpcResult']>(async()=>{throw Error('legacy RPC');}),authority={rpcResult:rpc};
 const core=assembleNativePostgresBusinessCore({identity,authority:{...authority,domainClient:()=>storageDomainClient(authority)},assertEntry:()=>{},verify:async()=>{},a2aFulfillment:transport,financialApplication:transport.financialApplication});
 await core.adapter.init();expect(await core.adapter.getA2aFailedOriginalFulfillment(id)).toBeNull();expect(await core.adapter.getSessionGrantConsent('0x'+'ab'.repeat(20),'cccccccc-cccc-4ccc-8ccc-cccccccccccc')).toBeNull();
 expect(call.mock.calls.map(c=>c[0])).toEqual(['a2aFulfillmentGet','get']);expect(rpc).not.toHaveBeenCalled();
 await expect(assertPostgresRuntimeIdentity(core.adapter)).rejects.toThrow();
});
