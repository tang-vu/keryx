import {beforeEach,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity} from '../storage-identity';
import {PrivateProfileError} from '../../profiles/private-profile';
const state=vi.hoisted(()=>({query:vi.fn(),clientQuery:vi.fn(),release:vi.fn(),end:vi.fn()}));
vi.mock('pg',()=>({Pool:class{query(...args:unknown[]){return state.query(...args);}connect(){return Promise.resolve({query:state.clientQuery,release:state.release});}end(){return state.end();}on(){}},types:{getTypeParser:()=>(s:string)=>s}}));
import {composePostgresPrivateProfiles} from './private-profiles-transport';
import {createPostgresDomainChannel,PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel} from './domain-channel';
import {PostgresStorageBusy,PostgresStorageUnavailable} from './connection';
import {composePostgresPrivacy} from './privacy-transport';
const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',network:'eip155:5042',authorityMode:'mainnet-real',deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:'2026-11-15T00:00:00.000Z',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,provenanceDigest:'ab'.repeat(32)};
const wallet='0x'+'a1'.repeat(20),other='0x'+'b2'.repeat(20),stamp='2026-11-15T00:00:00.000Z';
const input=()=>({displayName:'Original',handle:'reader_01',bio:'Reader',purpose:'Papers',links:[]});
const record=(owner=wallet)=>({...input(),wallet:owner,createdAt:stamp,updatedAt:stamp});
const snapshot=()=>({profile:record(),activity:{firstSeenAt:null,questions:1,surfacesUsed:['web'],topics:[],creatorsPaid:0,scope:'attributed-current-store',network:identity.network}});
const response=(value:unknown)=>({rows:[[JSON.stringify(value)]],fields:[{name:'result',dataTypeID:3802}]});
function fixture(readOnly=false){let closed=false;const call=vi.fn<PostgresDomainChannel['call']>().mockResolvedValue(snapshot()),close=vi.fn(async()=>{closed=true;});const channel:PostgresDomainChannel={get closed(){return closed;},call,close};return {call,close,channel,port:composePostgresPrivateProfiles(channel,identity,readOnly)};}
beforeEach(()=>{vi.clearAllMocks();state.end.mockResolvedValue(undefined);state.clientQuery.mockImplementation(async(query:unknown)=>typeof query==='string'?{}:response(snapshot()));});
describe('native private-profile Source terminal retirement',()=>{
 it.each(['surface','record-owner','activity-network'] as const)('retires strict %s failures and blocks every future method before IO',async fault=>{
  const f=fixture(),value=snapshot();if(fault==='surface')value.activity.surfacesUsed=['web\0tail'];else if(fault==='record-owner')value.profile=record(other);else value.activity.network='eip155:5042002';f.call.mockResolvedValue(value);
  await expect(f.port.get(wallet,identity.network)).rejects.toThrow('profile_unavailable');expect(f.channel.closed).toBe(true);expect(f.close).toHaveBeenCalledTimes(1);
  await expect(f.port.get(wallet,identity.network)).rejects.toThrow('profile_unavailable');await expect(f.port.update(wallet,input())).rejects.toThrow('profile_unavailable');await expect(f.port.delete(wallet)).rejects.toThrow('profile_unavailable');expect(f.call).toHaveBeenCalledTimes(1);
 });
 it('closes the genuine shared channel so sibling privacy reads also refuse',async()=>{
  state.clientQuery.mockImplementation(async(query:unknown)=>typeof query==='string'?{}:response({...snapshot(),activity:{...snapshot().activity,surfacesUsed:['web\0tail']}}));
  const channel=createPostgresDomainChannel({endpoint:{kind:'loopback',port:5432},database:'synthetic',role:'keryx_app',password:'synthetic-not-a-secret'},identity,'ab'.repeat(32)),port=composePostgresPrivateProfiles(channel,identity,false),privacy=composePostgresPrivacy(channel,identity.network,false,true);
  await expect(port.get(wallet,identity.network)).rejects.toThrow('profile_unavailable');expect(channel.closed).toBe(true);expect(state.end).toHaveBeenCalledTimes(1);const queries=state.clientQuery.mock.calls.length;
  await expect(privacy.sourceHistory!()).rejects.toThrow('privacy_unavailable');expect(state.clientQuery).toHaveBeenCalledTimes(queries);
 });
 it('retires unclassified SQL/read failures while recognized contention stays usable',async()=>{
  const f=fixture();f.call.mockRejectedValueOnce(new PostgresStorageBusy());await expect(f.port.get(wallet,identity.network)).rejects.toThrow('profile_unavailable');expect(f.close).not.toHaveBeenCalled();expect((await f.port.get(wallet,identity.network)).profile?.wallet).toBe(wallet);
  f.call.mockRejectedValueOnce(new PostgresStorageUnavailable());await expect(f.port.get(wallet,identity.network)).rejects.toThrow('profile_unavailable');expect(f.channel.closed).toBe(true);
 });
 it('leaves pre-transaction network, wallet, input and readonly refusals nonterminal',async()=>{
  const f=fixture();await expect(f.port.get(wallet,'eip155:5042002')).rejects.toThrow(PrivateProfileError);await expect(f.port.get('invalid',identity.network)).rejects.toThrow();await expect(f.port.update(wallet,{...input(),handle:'admin'})).rejects.toThrow();expect(f.call).not.toHaveBeenCalled();expect(f.close).not.toHaveBeenCalled();expect((await f.port.get(wallet,identity.network)).profile?.wallet).toBe(wallet);
  const reader=fixture(true),parsed=vi.fn(),raw={get displayName(){parsed();return 'bad';}};await expect(reader.port.update(wallet,raw as ReturnType<typeof input>)).rejects.toThrow('profile_unavailable');await expect(reader.port.delete(wallet)).rejects.toThrow('profile_unavailable');expect(parsed).not.toHaveBeenCalled();expect(reader.call).not.toHaveBeenCalled();expect(reader.close).not.toHaveBeenCalled();
 });
 it('keeps exact handle conflicts and recognized write contention nonterminal',async()=>{
  const f=fixture();f.call.mockResolvedValueOnce({status:'handle_conflict'});await expect(f.port.update(wallet,input())).rejects.toThrow('handle_conflict');expect(f.close).not.toHaveBeenCalled();f.call.mockRejectedValueOnce(new PostgresStorageBusy());await expect(f.port.delete(wallet)).rejects.toThrow('profile_unavailable');expect(f.close).not.toHaveBeenCalled();expect((await f.port.get(wallet,identity.network)).profile?.wallet).toBe(wallet);
 });
 it.each(['update','delete'] as const)('keeps %s lost acknowledgement unknown and never resubmits after retirement',async method=>{
  const f=fixture(),unknown=new PostgresDomainWriteOutcomeUnknown();f.call.mockRejectedValueOnce(unknown);await expect(method==='update'?f.port.update(wallet,input()):f.port.delete(wallet)).rejects.toBe(unknown);expect(f.channel.closed).toBe(true);await expect(f.port.get(wallet,identity.network)).rejects.toThrow('profile_unavailable');expect(f.call).toHaveBeenCalledTimes(1);
 });
 it.each(['update','delete'] as const)('retires malformed %s acknowledgements without publishing a success',async method=>{
  const f=fixture();f.call.mockResolvedValueOnce(method==='update'?{status:'updated',profile:record(other)}:{deleted:false});await expect(method==='update'?f.port.update(wallet,input()):f.port.delete(wallet)).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);expect(f.channel.closed).toBe(true);expect(f.call).toHaveBeenCalledTimes(1);
 });
 it('rejects an already in-flight profile result after a sibling profile call retires the channel',async()=>{
  const f=fixture();let finish!:(value:unknown)=>void;f.call.mockResolvedValueOnce({...snapshot(),activity:{...snapshot().activity,surfacesUsed:['web\0tail']}}).mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
  const malformed=f.port.get(wallet,identity.network),pending=f.port.get(wallet,identity.network),rejected=expect(pending).rejects.toThrow('profile_unavailable');await expect(malformed).rejects.toThrow('profile_unavailable');expect(f.channel.closed).toBe(true);finish(snapshot());await rejected;expect(f.call).toHaveBeenCalledTimes(2);
 });
 it('retires the genuine shared channel after an unclassified SQL transaction failure',async()=>{
  state.clientQuery.mockImplementation(async(query:unknown)=>{if(typeof query!=='string')throw Object.assign(new Error('native profile surface unavailable'),{code:'P0001'});return {};});
  const channel=createPostgresDomainChannel({endpoint:{kind:'loopback',port:5432},database:'synthetic',role:'keryx_app',password:'synthetic-not-a-secret'},identity,'ab'.repeat(32)),port=composePostgresPrivateProfiles(channel,identity,false);
  await expect(port.get(wallet,identity.network)).rejects.toThrow('profile_unavailable');expect(channel.closed).toBe(true);expect(state.release).toHaveBeenCalledWith(true);expect(state.end).toHaveBeenCalledTimes(1);await expect(port.get(wallet,identity.network)).rejects.toThrow('profile_unavailable');
 });
 it('does not revive a retired capability when cleanup fails',async()=>{
  const f=fixture();f.close.mockRejectedValueOnce(new Error('cleanup failed'));f.call.mockResolvedValueOnce({...snapshot(),activity:{...snapshot().activity,topics:['bad\0topic']}});await expect(f.port.get(wallet,identity.network)).rejects.toThrow('profile_unavailable');await expect(f.port.get(wallet,identity.network)).rejects.toThrow('profile_unavailable');expect(f.call).toHaveBeenCalledTimes(1);
 });
});
