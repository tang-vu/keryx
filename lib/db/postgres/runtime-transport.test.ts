import { describe,it,expect,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {EventEmitter} from 'node:events';
import { STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity } from '../storage-identity';
import { composePostgresRuntimeTransport,createPostgresRuntimeTransport } from './runtime-transport';
import type { PostgresDomainChannel } from './domain-channel';
import {PostgresStorageBusy} from './connection';
import {NATIVE_CURRENT_DATA_INTAKE_PROFILE,NATIVE_READONLY_RUNTIME_PROFILE} from './runtime-profile';
import {HOSTED_PAYMENT_SOURCE_RECEIPT_PREFIX} from './hosted-ledger-transport';
import {ARC_MAINNET_PROFILE} from '../../arc-network-profile';
// Driver recordings exercise captured-role wiring only, never installed proof.
const driver=vi.hoisted(()=>({config:vi.fn(),query:vi.fn(),release:vi.fn(),end:vi.fn()}));
vi.mock('pg',()=>({Pool:class{constructor(config:unknown){driver.config(config);}connect(){return Promise.resolve(Object.assign(new EventEmitter(),{query:driver.query,release:driver.release}));}end(){return driver.end();}on(){}},types:{getTypeParser:()=>(value:string)=>value}}));
const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',network:'eip155:5042',authorityMode:'mainnet-real',deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:'2026-11-12T00:00:00.000Z',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,provenanceDigest:'11'.repeat(32)},digest='ab'.repeat(32);
const authority=()=>({identity,sourceDigest:digest}),cold=()=>({...authority(),format:'keryx-native-storage-cold-read-v1',cacheRows:[{sourceId:'source',text:'synthetic-envelope'}],cacheRowCount:1,cacheWireBytes:18});
function fixture(){let closed=false;const call=vi.fn<PostgresDomainChannel['call']>(),channel:PostgresDomainChannel={get closed(){return closed;},call,async close(){closed=true;}};return {call,channel,transport:composePostgresRuntimeTransport(channel,identity,digest,true)};}
describe('native runtime cold reads and current authority',()=>{
 it('accepts only exact expected identity/digest responses',async()=>{const f=fixture();f.call.mockResolvedValue(authority());await f.transport.verifyRuntimeAuthority();expect(f.call).toHaveBeenCalledWith('nativeRuntimeAuthority',[]);for(const value of [{...authority(),ready:true},{...authority(),identity:{...identity,enrollmentId:randomUUID()}},{...authority(),sourceDigest:'cd'.repeat(32)}]){f.call.mockResolvedValue(value);await expect(f.transport.verifyRuntimeAuthority()).rejects.toThrow();}});
 it('verifies complete cache counts and immutable bounded snapshots',async()=>{const f=fixture();f.call.mockResolvedValue(cold());const value=await f.transport.readColdCache();expect(value.cacheRowCount).toBe(1);expect(Object.isFrozen(value.cacheRows)).toBe(true);expect(Object.isFrozen(value.cacheRows[0])).toBe(true);expect(f.call).toHaveBeenCalledWith('nativeRuntimeColdRead',[]);});
 it('refuses incorrect byte counts, duplicated ids and unexpected fields',async()=>{const f=fixture();for(const value of [{...cold(),cacheWireBytes:17},{...cold(),cacheRowCount:0},{...cold(),cacheRows:[...cold().cacheRows,...cold().cacheRows],cacheRowCount:2,cacheWireBytes:36},{...cold(),unverified:true}]){f.call.mockResolvedValue(value);await expect(f.transport.readColdCache()).rejects.toThrow();}});
 it('rejects a source id beyond its byte budget before publication',async()=>{const f=fixture();f.call.mockResolvedValue({...cold(),cacheRows:[{sourceId:'\u20ac'.repeat(256),text:'synthetic-envelope'}]});await expect(f.transport.readColdCache()).rejects.toThrow();});
 it('discards late cold results and keeps close terminal',async()=>{const f=fixture();let finish!:(v:unknown)=>void;f.call.mockReturnValue(new Promise(resolve=>{finish=resolve;}));const pending=f.transport.readColdCache(),outcome=expect(pending).rejects.toThrow();await f.transport.close();finish(cold());await outcome;await expect(f.transport.verifyRuntimeAuthority()).rejects.toThrow();expect(f.call).toHaveBeenCalledTimes(1);});
});

// Real strict port decoders over recording channels. These controls never
// construct/register a native application facade or qualify installed authority.
describe('runtime transport terminal state propagation',()=>{
 it('exposes terminal decoder retirement immediately to every acquired sibling/nested port',async()=>{
  const f=fixture(),read=f.transport.applicationRead.bind(f.transport),nested=f.transport.profileIdentities.list;
  expect(f.transport.closed).toBe(false);
  f.call.mockResolvedValue({profile:null,activity:{firstSeenAt:null,questions:0,surfacesUsed:['web\0tail'],topics:[],creatorsPaid:0,scope:'attributed-current-store',network:identity.network}});
  await expect(f.transport.privateProfiles.get('0x'+'11'.repeat(20),identity.network)).rejects.toThrow('profile_unavailable');
  expect(f.transport.closed).toBe(true);const calls=f.call.mock.calls.length;
  let inspected=0;const hostile=new Proxy({},{get(){inspected++;throw Error('No argument getters after retirement');}}) as never;
  await expect(read('get_query_run',hostile)).rejects.toThrow();await expect(nested(hostile)).rejects.toThrow();
  await expect(f.transport.privateProfiles.update(hostile,hostile)).rejects.toThrow();
  expect(inspected).toBe(0);expect(f.call).toHaveBeenCalledTimes(calls);
 });
 it('keeps ordinary contention and input refusals nonterminal',async()=>{
  const f=fixture();f.call.mockRejectedValueOnce(new PostgresStorageBusy());
  await expect(f.transport.privateProfiles.get('0x'+'11'.repeat(20),identity.network)).rejects.toThrow('profile_unavailable');expect(f.transport.closed).toBe(false);
  await expect(f.transport.privateProfiles.get('invalid-owner',identity.network)).rejects.toThrow();expect(f.transport.closed).toBe(false);
  f.call.mockResolvedValue(authority());await f.transport.verifyRuntimeAuthority();expect(f.transport.closed).toBe(false);
 });
 it('reports explicit close during a pending drain without waiting for another SQL call',async()=>{
  let closed=false,finish!:()=>void;
  const call=vi.fn<PostgresDomainChannel['call']>(),drain=new Promise<void>(done=>{finish=done;});
  const channel:PostgresDomainChannel={get closed(){return closed;},call,close(){closed=true;return drain;}};
  const transport=composePostgresRuntimeTransport(channel,identity,digest,true),closing=transport.close();
  expect(transport.closed).toBe(true);await expect(transport.verifyRuntimeAuthority()).rejects.toThrow();expect(call).not.toHaveBeenCalled();
  finish();await closing;expect(transport.closed).toBe(true);
 });
});
describe('finite prepared hosted protocol selection',()=>{
 it.each([NATIVE_READONLY_RUNTIME_PROFILE.catalogSha256,digest])('retains the exact legacy wire for non-current catalogue %s',async selected=>{
  const call=vi.fn<PostgresDomainChannel['call']>().mockResolvedValue(null),channel:PostgresDomainChannel={closed:false,call,async close(){}};
  const transport=composePostgresRuntimeTransport(channel,identity,selected,false);
  await transport.financialApplication.confirmHostedAuthorization('0x'+'11'.repeat(20),'0x'+'aa'.repeat(32),'synthetic-receipt');
  expect(call).toHaveBeenCalledExactlyOnceWith('hostedConfirm',['0x'+'11'.repeat(20),'0x'+'aa'.repeat(32),'synthetic-receipt']);
 });
 it('selects Source original submission/receipt wires only for the independently pinned current DATA catalogue',async()=>{
  const call=vi.fn<PostgresDomainChannel['call']>().mockResolvedValue(null),channel:PostgresDomainChannel={closed:false,call,async close(){}};
  const transport=composePostgresRuntimeTransport(channel,identity,NATIVE_CURRENT_DATA_INTAKE_PROFILE.catalogSha256,false);
  const signer='0x'+'11'.repeat(20),submission={authorizationId:'0x'+'aa'.repeat(32),authorizationExpiresAt:'2030-01-01T00:00:00.000Z',payer:signer,payee:'0x'+'22'.repeat(20),amountMicros:'1',network:ARC_MAINNET_PROFILE.networkId,asset:ARC_MAINNET_PROFILE.usdcAddress.toLowerCase()};
  await transport.financialApplication.submitHostedAuthorization(signer,submission,'0x'+'bb'.repeat(32));
  const wire=JSON.parse(call.mock.calls[0][1][1] as string);expect(wire.format).toBe('source-payment-originals-v1');expect(JSON.parse(wire.submissionWire)).toEqual(submission);
  await transport.confirmHostedAuthorization(signer,submission.authorizationId,'synthetic\0receipt');
  expect(call.mock.lastCall).toEqual(['hostedConfirm',[signer,submission.authorizationId,HOSTED_PAYMENT_SOURCE_RECEIPT_PREFIX+JSON.stringify('synthetic\0receipt')]]);
  expect(NATIVE_CURRENT_DATA_INTAKE_PROFILE.applicationFactoryApproved).toBe(false);expect(NATIVE_CURRENT_DATA_INTAKE_PROFILE.fullWriterQualified).toBe(false);
 });
});

describe('private actual connection-role research scope',()=>{
 it('keeps a bare composer closed even when its caller supplies readOnly false',async()=>{
  const call=vi.fn<PostgresDomainChannel['call']>();const channel:PostgresDomainChannel={closed:false,call,async close(){}};
  const transport=composePostgresRuntimeTransport(channel,identity,digest,false);let getters=0;
  const hostile=new Proxy({},{get(){getters++;throw Error('Missing scope must precede argument access');}}) as never;
  await expect(transport.assertResearchPurchaseAuthority!(hostile)).rejects.toThrow();expect(getters).toBe(0);expect(call).not.toHaveBeenCalled();expect(transport.closed).toBe(false);
 });
 it('captures the real reader role independently of later caller mutation and refuses before SQL',async()=>{
  driver.config.mockClear();driver.query.mockClear();driver.end.mockClear();
  const options={endpoint:{kind:'loopback' as const,port:5432},database:'synthetic',role:'keryx_reader',password:'synthetic-not-a-secret'};
  const transport=createPostgresRuntimeTransport(options,identity,digest);options.role='keryx_app';
  let getters=0;const hostile=new Proxy({},{get(){getters++;throw Error('Readonly scope must precede argument access');}}) as never;
  await expect(transport.assertResearchPurchaseAuthority!(hostile)).rejects.toThrow();expect(getters).toBe(0);expect(driver.query).not.toHaveBeenCalled();expect(driver.config.mock.lastCall?.[0]).toMatchObject({user:'keryx_reader'});await transport.close();
 });
 it('uses the exact captured app role and existing strict all9/catalog observation without registering provenance',async()=>{
  driver.config.mockClear();driver.query.mockClear();driver.release.mockClear();
  driver.query.mockResolvedValue({rows:[[JSON.stringify(authority())]],fields:[{name:'result',dataTypeID:3802}]});
  const options={endpoint:{kind:'loopback' as const,port:5432},database:'synthetic',role:'keryx_app',password:'synthetic-not-a-secret'};
  const transport=createPostgresRuntimeTransport(options,identity,digest);options.role='keryx_reader';
  try{
   await expect(transport.assertResearchPurchaseAuthority!(identity.network)).resolves.toBeUndefined();
   expect(driver.config.mock.lastCall?.[0]).toMatchObject({user:'keryx_app'});expect(driver.query).toHaveBeenCalledTimes(3);expect(driver.query.mock.calls[0]).toEqual(['BEGIN READ ONLY']);expect(driver.query.mock.calls[2]).toEqual(['COMMIT']);
   expect(driver.query.mock.calls[1][0]).toMatchObject({text:expect.stringContaining('storage_native_runtime_authority'),rowMode:'array'});
   expect(driver.release).toHaveBeenCalledExactlyOnceWith(false);
   const actual=await import('./runtime-adapter');await expect(actual.assertPostgresRuntimeIdentity(transport)).rejects.toThrow('adapter_not_initialized');
  }finally{await transport.close();}
 });
});
