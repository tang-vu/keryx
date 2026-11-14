import { expect,it,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { assembleNativePostgresBusinessCore } from '../supabase-adapter';
import { storageDomainClient,type StorageDomainAuthority } from '../supabase-authority';
import { STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity } from '../storage-identity';
import { composePostgresSourceClaimWrites } from './source-claims-write-transport';
import { composePostgresSourceUpkeep } from './source-upkeep-transport';
import { assertPostgresRuntimeIdentity } from './runtime-adapter';
import type { PostgresDomainChannel } from './domain-channel';
const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',network:'eip155:5042',authorityMode:'mainnet-real',deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:'2026-11-15T00:00:00.000Z',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,provenanceDigest:'11'.repeat(32)};
function fixture(readOnly?:boolean){
 const rpc=vi.fn<StorageDomainAuthority['rpcResult']>(async()=>({data:null,error:null})),authority={rpcResult:rpc},call=vi.fn<PostgresDomainChannel['call']>(async()=>{throw Error('current Source snapshot refused');}),channel:PostgresDomainChannel={closed:false,call,close:async()=>{}};
 const core=assembleNativePostgresBusinessCore({identity,authority:{...authority,domainClient:()=>storageDomainClient(authority)},assertEntry:()=>{},verify:async()=>{},...(readOnly===undefined?{}:{sourceClaimWrites:composePostgresSourceClaimWrites(channel,readOnly),sourceUpkeep:composePostgresSourceUpkeep(channel,readOnly)})});return {core,rpc,call};
}
it('keeps unconfigured Source mutation capabilities absent instead of selecting a legacy writer',async()=>{
 const f=fixture();await f.core.adapter.init();expect(f.core.adapter.issueSourceClaimChallenge).toBeUndefined();expect(f.core.adapter.claimSourceUpkeep).toBeUndefined();expect(f.rpc).not.toHaveBeenCalled();
});
it('refuses readonly Source creation before touching caller fields or any SQL',async()=>{
 const f=fixture(true);await f.core.adapter.init();let parsed=0;await expect(f.core.adapter.issueSourceClaimChallenge!({get wallet(){parsed++;throw Error();}} as never)).rejects.toThrow();expect(parsed).toBe(0);expect(f.call).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();
});
it('preserves current Source snapshot refusal with no generic RPC fallback or installed authority',async()=>{
 const f=fixture(false);await expect(f.core.adapter.claimSourceUpkeep!(Date.now())).rejects.toThrow();expect(f.call).not.toHaveBeenCalled();await f.core.adapter.init();await expect(f.core.adapter.claimSourceUpkeep!(Date.now())).rejects.toThrow('current Source snapshot refused');expect(f.call).toHaveBeenCalledOnce();expect(f.rpc).not.toHaveBeenCalled();await expect(assertPostgresRuntimeIdentity(f.core.adapter,'write')).rejects.toThrow();
});
it('rejects an otherwise successful mutation result after terminal disposal',async()=>{
 let finish!:(value:null)=>void;const pending=new Promise<null>(resolve=>{finish=resolve;}),rpc=vi.fn<StorageDomainAuthority['rpcResult']>(async()=>({data:null,error:null})),authority={rpcResult:rpc};
 const core=assembleNativePostgresBusinessCore({identity,authority:{...authority,domainClient:()=>storageDomainClient(authority)},assertEntry:()=>{},verify:async()=>{},sourceUpkeep:{claimSourceUpkeep:()=>pending,finishSourceUpkeep:async()=>{}}});await core.adapter.init();const result=core.adapter.claimSourceUpkeep!(Date.now()),refused=expect(result).rejects.toThrow();core.hooks.close();finish(null);await refused;expect(rpc).not.toHaveBeenCalled();
});
