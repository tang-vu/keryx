import { expect,it,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { STORAGE_MAINNET_PROFILE_DIGEST,validateStorageIdentity } from '../storage-identity';
import type { PostgresDomainChannel } from './domain-channel';
import { composePostgresScholarly } from './scholarly-transport';
const identity=validateStorageIdentity({format:'keryx-mainnet-storage-identity-v1',authorityMode:'mainnet-real',network:'eip155:5042',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:new Date().toISOString(),provenanceDigest:'24'.repeat(32)}),digest='25'.repeat(32);
// Channel doubles exercise only boundary/failure behavior, never native provenance.
function channel(call:PostgresDomainChannel['call'],closed=false):PostgresDomainChannel{return {call,closed,close:async()=>{}};}
it('uses the parent fixed Source-aware reader and propagates its retained-data failures',async()=>{
 const failure=Error('retained Source origin malformed'),getSource=vi.fn(async(id:string)=>{if(id==='bad')throw failure;return id==='marked'?{scholarlyEnrolled:true} as never:null;}),call=vi.fn(async()=>({identity,sourceDigest:digest})),port=composePostgresScholarly(channel(call),identity,digest,{getSource});expect(await port.getPaperState('missing')).toBeNull();await expect(port.getPaperState('marked')).rejects.toThrow('Scholarly rights are unsupported');await expect(port.getPaperState('bad')).rejects.toBe(failure);expect(getSource.mock.calls.map(args=>args[0])).toEqual(['missing','marked','bad']);expect(call).not.toHaveBeenCalled();
});
it('keeps all three writes unconditional early Source refusals without inspecting signed payloads',async()=>{
 const call=vi.fn(async()=>null),getSource=vi.fn(async()=>null),port=composePostgresScholarly(channel(call),identity,digest,{getSource}),poison=new Proxy({},{get(){throw Error('input evaluated');}}) as never;await expect(port.beginPaperEnrollment(poison,poison)).rejects.toThrow('Scholarly enrollment is unsupported');await expect(port.submitPaper(poison)).rejects.toThrow('Scholarly enrollment is unsupported');await expect(port.reviewPaper(poison)).rejects.toThrow('Scholarly review is unsupported');expect(call).not.toHaveBeenCalled();expect(getSource).not.toHaveBeenCalled();
});
it('returns null admission only after the existing exact current native authority guard',async()=>{
 const call=vi.fn(async()=>({identity,sourceDigest:digest})),port=composePostgresScholarly(channel(call),identity,digest,{getSource:async()=>null});expect(await port.getPaperAdmission('any')).toBeNull();expect(call).toHaveBeenCalledExactlyOnceWith('nativeRuntimeAuthority',[]);await expect(composePostgresScholarly(channel(async()=>({identity,sourceDigest:'00'.repeat(32)})),identity,digest,{getSource:async()=>null}).getPaperAdmission('any')).rejects.toThrow();
 const closed=vi.fn(async()=>null);await expect(composePostgresScholarly(channel(closed,true),identity,digest,{getSource:async()=>null}).getPaperAdmission('any')).rejects.toThrow();expect(closed).not.toHaveBeenCalled();
});
