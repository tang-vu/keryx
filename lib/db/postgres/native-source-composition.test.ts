import { describe,it,expect,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { assembleNativePostgresBusinessCore } from '../supabase-adapter';
import { storageDomainClient,type StorageDomainAuthority } from '../supabase-authority';
import { STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity } from '../storage-identity';
import { assertPostgresRuntimeIdentity } from './runtime-adapter';
import type { PostgresSourceClaimsPort } from './source-claims-transport';
import { composePostgresSourceUpsert } from './source-upsert-policy';
import type { PostgresDomainChannel } from './domain-channel';

const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',network:'eip155:5042',authorityMode:'mainnet-real',deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:'2026-11-12T00:00:00.000Z',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,provenanceDigest:'11'.repeat(32)};
function fixture(){
 const rpc=vi.fn<StorageDomainAuthority['rpcResult']>(async()=>({data:null,error:null})),authority={rpcResult:rpc};
 const source={id:'synthetic-source',name:'Synthetic',url:'https://synthetic.invalid/',description:'',walletAddress:'0x'+'11'.repeat(20),fetchPrice:0.01,tags:[],authors:[],createdAt:'2026-11-12T00:00:00.000Z',sourceClaimId:'ab'.repeat(32)};
 const claims:PostgresSourceClaimsPort={getSource:vi.fn(async()=>source),getSourceByOnchainId:vi.fn(async()=>source),listSources:vi.fn(async()=>[source]),listAllSources:vi.fn(async()=>[source]),getSourceMeta:vi.fn(async()=>null),getSourceClaim:vi.fn(async()=>null),getSourceClaimForSource:vi.fn(async()=>null),getSourceClaimChallenge:vi.fn(async()=>null),listSourceClaims:vi.fn(async()=>[])};
 const entry=vi.fn(),verify=vi.fn(async()=>{}),call=vi.fn<PostgresDomainChannel['call']>();
 const channel:PostgresDomainChannel={closed:false,call,close:async()=>{}};
 const core=assembleNativePostgresBusinessCore({identity,authority:{...authority,domainClient:()=>storageDomainClient(authority)},assertEntry:entry,verify,sourceClaims:claims,sourceUpsert:composePostgresSourceUpsert(channel,true).upsertSource});
 return {core,source,claims,rpc,call,entry};
}
describe('native Source composition boundaries',()=>{
 it('uses one complete Source observation, retaining its managed marker without a generic-row fallback',async()=>{
  const f=fixture();await expect(f.core.adapter.getSource(f.source.id)).rejects.toThrow();expect(f.claims.getSource).not.toHaveBeenCalled();
  await f.core.adapter.init();expect(await f.core.adapter.getSource(f.source.id)).toEqual(f.source);
  expect(await f.core.adapter.listAllSources()).toEqual([f.source]);expect(await f.core.adapter.getSourceClaimForSource!(f.source.id)).toBeNull();
  expect(f.claims.getSource).toHaveBeenCalledOnce();expect(f.rpc).not.toHaveBeenCalled();
 });
 it('never falls back after a refusing current Source snapshot',async()=>{
  const f=fixture();await f.core.adapter.init();vi.mocked(f.claims.getSource).mockRejectedValue(new Error('torn Source binding'));
  await expect(f.core.adapter.getSource(f.source.id)).rejects.toThrow('torn Source binding');expect(f.rpc).not.toHaveBeenCalled();
 });
 it('discards an otherwise successful Source result after terminal core disposal',async()=>{
  const f=fixture();await f.core.adapter.init();let finish!:(value:typeof f.source)=>void;
  vi.mocked(f.claims.getSource).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const request=f.core.adapter.getSource(f.source.id),denied=expect(request).rejects.toThrow();f.core.hooks.close();finish(f.source);await denied;
  await expect(f.core.adapter.listSources()).rejects.toThrow();expect(f.claims.listSources).not.toHaveBeenCalled();
 });
 it('refuses readonly upsert before reading caller fields and grants no installed writer provenance',async()=>{
  const f=fixture();await f.core.adapter.init();let fields=0;
  await expect(f.core.adapter.upsertSource({get registryAuthority(){fields++;return undefined;}} as never)).rejects.toThrow();
  expect(fields).toBe(0);expect(f.call).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();
  await expect(assertPostgresRuntimeIdentity(f.core.adapter,'write')).rejects.toThrow();
 });
});
