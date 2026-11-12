import { describe,expect,it,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity } from '../storage-identity';
import { PrivateProfileError } from '../../profiles/private-profile';
import { composePostgresUserDomainTransport } from './user-domain-transport';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',network:'eip155:5042',authorityMode:'mainnet-real',deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:'2026-11-12T00:00:00.000Z',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,provenanceDigest:'11'.repeat(32)};
const wallet='0x'+'a1'.repeat(20),other='0x'+'b2'.repeat(20),stamp='2026-11-12T00:00:00.000Z';
const input=()=>({displayName:'Original',handle:'reader_01',bio:'Reader',purpose:'Papers',links:[]});
const record=(owner=wallet)=>({...input(),wallet:owner,createdAt:stamp,updatedAt:stamp});
const snapshot=(owner=wallet)=>({profile:record(owner),activity:{firstSeenAt:null,questions:0,surfacesUsed:[],topics:[],creatorsPaid:0,scope:'attributed-current-store',network:identity.network}});
function fixture(readOnly=false){
 let closed=false;const call=vi.fn<PostgresDomainChannel['call']>().mockResolvedValue(snapshot());
 const channel:PostgresDomainChannel={get closed(){return closed;},call,close:async()=>{closed=true;}};
 return {call,channel,transport:composePostgresUserDomainTransport(channel,identity,readOnly)};
}
describe('native user profile protocol composition',()=>{
 it('refuses readonly writes before parsing or submitting their input',async()=>{
  const f=fixture(true),parsed=vi.fn(),raw={get displayName(){parsed();return 'bad';}};
  await expect(f.transport.privateProfiles.update(wallet,raw as ReturnType<typeof input>)).rejects.toThrow(PrivateProfileError);await expect(f.transport.privateProfiles.delete(wallet)).rejects.toThrow(PrivateProfileError);
  expect(parsed).not.toHaveBeenCalled();expect(f.call).not.toHaveBeenCalled();expect((await f.transport.privateProfiles.get(wallet,identity.network)).profile?.wallet).toBe(wallet);
 });
 it('rejects another network before SQL and another owner before publication',async()=>{
  const f=fixture();await expect(f.transport.privateProfiles.get(wallet,'eip155:5042002')).rejects.toThrow(PrivateProfileError);expect(f.call).not.toHaveBeenCalled();
  f.call.mockResolvedValue(snapshot(other));await expect(f.transport.privateProfiles.get(wallet,identity.network)).rejects.toThrow(PrivateProfileError);
 });
 it('captures normalized argument bytes before a native write awaits',async()=>{
  const f=fixture();let finish!:(value:unknown)=>void;f.call.mockReturnValue(new Promise(resolve=>{finish=resolve;}));const raw=input(),request=f.transport.privateProfiles.update(wallet,raw);raw.displayName='Changed';
  expect(JSON.parse(f.call.mock.calls[0][1][1]!).displayName).toBe('Original');finish({status:'updated',profile:record()});expect((await request).displayName).toBe('Original');
 });
 it('keeps close terminal during a submitted write',async()=>{
  const f=fixture();let finish!:(value:unknown)=>void;f.call.mockReturnValue(new Promise(resolve=>{finish=resolve;}));const request=f.transport.privateProfiles.update(wallet,input()),outcome=expect(request).rejects.toThrow(PostgresDomainWriteOutcomeUnknown);
  await f.transport.close();finish({status:'updated',profile:record()});await outcome;await expect(f.transport.privateProfiles.get(wallet,identity.network)).rejects.toThrow(PrivateProfileError);
 });
 it('preserves only the exact native handle-conflict result',async()=>{
  const f=fixture();f.call.mockResolvedValue({status:'handle_conflict'});await expect(f.transport.privateProfiles.update(wallet,input())).rejects.toMatchObject({code:'handle_conflict'});
  f.call.mockResolvedValue({status:'handle_conflict',profile:record(other)});await expect(f.transport.privateProfiles.update(wallet,input())).rejects.toThrow(PostgresDomainWriteOutcomeUnknown);
 });
 it('does not retry uncertain writes or turn an invalid response into success',async()=>{
  const f=fixture();f.call.mockRejectedValue(new PostgresDomainWriteOutcomeUnknown());await expect(f.transport.privateProfiles.update(wallet,input())).rejects.toThrow(PostgresDomainWriteOutcomeUnknown);expect(f.call).toHaveBeenCalledTimes(1);
  f.call.mockResolvedValue({status:'updated',profile:record(other)});await expect(f.transport.privateProfiles.update(wallet,input())).rejects.toThrow(PostgresDomainWriteOutcomeUnknown);
 });
});
