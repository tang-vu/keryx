import { describe,it,expect,vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,existsSync,unlinkSync,rmdirSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isAddress } from 'viem';
import { installMainnetApplicationSchema } from '../mainnet-application-schema';
import { installNativeUserDomainSchema } from '../native-user-domain-schema';
import { insertStorageIdentity,installStorageFences } from '../storage-identity-sqlite';
import { openVerifiedSqliteStorage,assertVerifiedSqliteConnection } from '../storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../enrolled-sqlite-schema-profile';
import { STORAGE_MAINNET_PROFILE_DIGEST,validateStorageIdentity } from '../storage-identity';
import { SqliteAdapter } from '../sqlite-adapter';
import type { PostgresDomainChannel } from './domain-channel';
import { PostgresDomainWriteOutcomeUnknown } from './domain-channel';
import { composePostgresOnramp } from './onramp-transport';
import { captureOnrampReserve,captureOnrampRelease,decodeOnrampFrame,prepareOnrampEffect,onrampWireSha256,ONRAMP_PROTOCOL_LIMITS,type OnrampCapture } from './onramp-packet';

// Genuine Source observations and fixed-channel boundaries only. No native
// factory/provenance, wallet, provider or actual transfer is supplied.
function envelope(capture:OnrampCapture,db?:DatabaseSync,claimedOverride=false){
 const value=(wire:string)=>JSON.parse(wire) as string;
 const get=(wire:string)=>{const row=db?.prepare('SELECT value,updated_at FROM sync_state WHERE key=?').get(value(wire));return row?{value:String(row.value),updatedAt:row.updated_at as string|null}:null;};
 const present=claimedOverride||!!db?.prepare('SELECT 1 FROM sync_state WHERE key=?').get(value(capture.addressKeyWire));
 const skipped=capture.action==='reserve'&&present;
 const frame={format:'source-onramp-frame-v1',identityDigest:'ab'.repeat(32),capture,addressHex:Buffer.from(value(capture.addressKeyWire)).toString('hex'),dayHex:Buffer.from(value(capture.dayKeyWire)).toString('hex'),claimed:present,
  address:capture.action==='release'?get(capture.addressKeyWire):null,day:skipped?null:get(capture.dayKeyWire)};
 const wire=JSON.stringify(frame);return {wire,sha256:onrampWireSha256(wire)};
}
async function sourceFixture(work:(db:DatabaseSync,core:SqliteAdapter)=>Promise<void>){
 const folder=mkdtempSync(join(tmpdir(),'keryx-source-onramp-')),file=join(folder,'source.sqlite');
 const identity=validateStorageIdentity({format:'keryx-mainnet-storage-identity-v1',authorityMode:'mainnet-real',network:'eip155:5042',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:new Date().toISOString(),provenanceDigest:'71'.repeat(32)});
 let source:ReturnType<typeof openVerifiedSqliteStorage>|undefined;
 try{const seed=new DatabaseSync(file);try{seed.exec('BEGIN');installMainnetApplicationSchema(seed,{publicReferenceArchive:true});installNativeUserDomainSchema(seed);insertStorageIdentity(seed,identity);installStorageFences(seed,identity);seed.exec('COMMIT');}finally{seed.close();}
  source=openVerifiedSqliteStorage(file,identity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>{}});
  const core=SqliteAdapter.assembleConnectionCore(source.db,identity,()=>expect(assertVerifiedSqliteConnection(source!.db)).toEqual(identity));await work(source.db,core);
 }finally{source?.close();for(const path of [file,file+'-wal',file+'-shm',file+'-journal'])if(existsSync(path))unlinkSync(path);rmdirSync(folder);}
}
describe('selected Source onramp arithmetic and ordering',()=>{
 it('uses actual Source parseFloat, binary64, epsilon and String values',async()=>sourceFixture(async(db,core)=>{
  const values=['0.7tail','\ufeff .7extra','not-a-number','Infinity','-Infinity','-0','1e309','0x10'];
  let n=0;for(const prior of values)for(const amount of [0.7,-2,NaN,Infinity,-Infinity]){
   const address='synthetic:address:'+n,day='synthetic:day:'+n++;await core.setSyncState(day,prior);
   const capture=captureOnrampReserve(address,day,amount,Infinity,0.9),observed=decodeOnrampFrame(envelope(capture,db),capture),prepared=prepareOnrampEffect(capture,observed);
   expect(await core.reserveOnramp(address,day,amount,Infinity,0.9)).toBe(prepared.result);
   if(prepared.effect?.action==='reserve'){
    expect(db.prepare('SELECT value,updated_at FROM sync_state WHERE key=?').get(address)).toEqual({value:prepared.effect.addressValue,updated_at:prepared.effect.updatedAt});
    expect(db.prepare('SELECT value,updated_at FROM sync_state WHERE key=?').get(day)).toEqual({value:prepared.effect.dayValue,updated_at:prepared.effect.updatedAt});
   }
  }
 }));
 it('defers invalid caller Date until after both Source early returns',async()=>sourceFixture(async(db,core)=>{
  await core.setSyncState('claimed','anything');
  for(const now of [NaN,Infinity,8640000000000001]){
   const claimed=captureOnrampReserve('claimed','unused',1,0,now);expect(prepareOnrampEffect(claimed,decodeOnrampFrame(envelope(claimed,db),claimed)).result).toBe('already-funded');expect(await core.reserveOnramp('claimed','unused',1,0,now)).toBe('already-funded');
   const capped=captureOnrampReserve('capped','day',2,1,now);expect(prepareOnrampEffect(capped,decodeOnrampFrame(envelope(capped,db),capped)).result).toBe('daily-cap');expect(await core.reserveOnramp('capped','day',2,1,now)).toBe('daily-cap');
   const invalid=captureOnrampReserve('invalid','day',1,2,now);expect(()=>prepareOnrampEffect(invalid,decodeOnrampFrame(envelope(invalid,db),invalid))).toThrow();await expect(core.reserveOnramp('invalid','day',1,2,now)).rejects.toThrow();expect(db.prepare('SELECT 1 FROM sync_state WHERE key=?').get('invalid')).toBeUndefined();
  }
 }));
 it('retains caller clock String values independently of TimeClip ISO formatting',async()=>sourceFixture(async(db,core)=>{
  let n=0;for(const now of [-0,0.9,-0.9,8640000000000000,-8640000000000000]){
   const address='clock-address:'+n,day='clock-day:'+n++,capture=captureOnrampReserve(address,day,0.7,2.1,now),prepared=prepareOnrampEffect(capture,decodeOnrampFrame(envelope(capture,db),capture));
   expect(await core.reserveOnramp(address,day,0.7,2.1,now)).toBe('reserved');
   if(prepared.effect?.action!=='reserve')throw Error('wrong effect');expect(db.prepare('SELECT value,updated_at FROM sync_state WHERE key=?').get(address)).toEqual({value:String(now),updated_at:prepared.effect.updatedAt});
  }
 }));
 it('preserves normalized key aliases and release read-after-delete/update-only behavior',async()=>sourceFixture(async(db,core)=>{
  for(const [address,day] of [['alias','alias'],['\ud800','\ufffd'],['\ufeffaddress','\ufeffday'],['absent\0','missing\0']]){
   if(!address.includes('\0')){await core.setSyncState(address,'1.5junk');await core.setSyncState(day,'1.5junk');}
   const capture=captureOnrampRelease(address,day,0.7),prepared=prepareOnrampEffect(capture,decodeOnrampFrame(envelope(capture,db),capture));
   expect(prepared.effect?.action).toBe('release');await core.releaseOnramp(address,day,0.7);
   expect(db.prepare('SELECT 1 FROM sync_state WHERE key=?').get(address)).toBeUndefined();
   const saved=db.prepare('SELECT value,updated_at FROM sync_state WHERE key=?').get(day);
   if(prepared.effect?.action==='release'&&prepared.effect.dayExistsAfterDelete){expect(saved?.value).toBe(prepared.effect.dayValue);expect(new Date(String(saved?.updated_at)).toISOString()).toBe(saved?.updated_at);}else expect(saved).toBeUndefined();
  }
 }));
 it('proves Source NUL-key reservation is legal and distinct from the native representation hold',async()=>sourceFixture(async(db,core)=>{
  expect(await core.reserveOnramp('synthetic:address\0','synthetic:day',0.7,2.1,0)).toBe('reserved');
  expect(db.prepare('SELECT hex(key) AS bytes,value FROM sync_state WHERE key=?').get('synthetic:address\0')).toEqual({bytes:Buffer.from('synthetic:address\0').toString('hex').toUpperCase(),value:'0'});
 }));
 it('keeps Source concurrent once-per-address and 0.7/2.1 cap outcomes',async()=>sourceFixture(async(_db,core)=>{
  const same=await Promise.all(Array.from({length:10},()=>core.reserveOnramp('one','one-day',0.7,20,0)));expect(same.filter(v=>v==='reserved')).toHaveLength(1);expect(same.filter(v=>v==='already-funded')).toHaveLength(9);
  const cap=await Promise.all(Array.from({length:10},(_,n)=>core.reserveOnramp('address:'+n,'shared-day',0.7,2.1,0)));expect(cap.filter(v=>v==='reserved')).toHaveLength(3);expect(cap.filter(v=>v==='daily-cap')).toHaveLength(7);
 }));
});
function channel(call:(op:string,args:readonly(string|null)[])=>Promise<unknown>){return {closed:false,close:async()=>{},call:call as PostgresDomainChannel['call']} as PostgresDomainChannel;}
describe('closed native onramp fixed-channel protocol',()=>{
 it('refuses readonly access before inspecting any caller value',async()=>{
  const call=vi.fn(async()=>null),port=composePostgresOnramp(channel(call),true),raw=new Proxy({},{get(){throw Error('caller inspected');}});
  await expect(port.reserveOnramp(raw as never,raw as never,raw as never,raw as never,raw as never)).rejects.toThrow('PostgreSQL storage unavailable');await expect(port.releaseOnramp(raw as never,raw as never,raw as never)).rejects.toThrow('PostgreSQL storage unavailable');expect(call).not.toHaveBeenCalled();
 });
 it('recomputes only an ACKed no-write CAS change, without recapturing caller input',async()=>{
  let frames=0,writes=0;const captures:OnrampCapture[]=[],port=composePostgresOnramp(channel(async(op,args)=>{const payload=JSON.parse(args[0]!);captures.push(payload.capture);if(op==='onrampFrame')return envelope(payload.capture,undefined,++frames>1);writes++;return {status:'changed'};}),false);
  expect(await port.reserveOnramp('address','day',0.7,2.1,0.9)).toBe('already-funded');expect(frames).toBe(2);expect(writes).toBe(1);expect(captures.every(v=>JSON.stringify(v)===JSON.stringify(captures[0]))).toBe(true);
 });
 it('bounds known CAS recomputation and never retries an unknown write ACK',async()=>{
  let writes=0;const port=composePostgresOnramp(channel(async(op,args)=>{const payload=JSON.parse(args[0]!);if(op==='onrampFrame')return envelope(payload.capture);writes++;return {status:'changed'};}),false);
  await expect(port.reserveOnramp('address','day',1,2,0)).rejects.toThrow('PostgreSQL storage unavailable');expect(writes).toBe(ONRAMP_PROTOCOL_LIMITS.attempts);
  writes=0;const lost=composePostgresOnramp(channel(async(op,args)=>{const payload=JSON.parse(args[0]!);if(op==='onrampFrame')return envelope(payload.capture);writes++;throw new PostgresDomainWriteOutcomeUnknown();}),false);
  await expect(lost.reserveOnramp('address','day',1,2,0)).rejects.toBeInstanceOf(PostgresDomainWriteOutcomeUnknown);expect(writes).toBe(1);
 });
 it('stops after a frame when its channel closes before apply',async()=>{
  let calls=0;const c=channel(async(_op,args)=>{calls++;const result=envelope(JSON.parse(args[0]!).capture);Object.defineProperty(c,'closed',{value:true});return result;}),port=composePostgresOnramp(c,false);
  await expect(port.reserveOnramp('address','day',1,2,0)).rejects.toThrow('PostgreSQL storage unavailable');expect(calls).toBe(1);
 });
 it('enforces the whole-operation deadline before dispatching an apply',async()=>{
  let writes=0;const port=composePostgresOnramp(channel(async(op,args)=>{if(op==='onrampFrame')return envelope(JSON.parse(args[0]!).capture);writes++;return {status:'applied'};}),false);
  const clock=vi.spyOn(performance,'now').mockReturnValueOnce(0).mockReturnValueOnce(1).mockReturnValue(ONRAMP_PROTOCOL_LIMITS.deadlineMs+1);
  try{await expect(port.reserveOnramp('address','day',1,2,0)).rejects.toThrow('PostgreSQL storage unavailable');expect(writes).toBe(0);}finally{clock.mockRestore();}
 });
 it('proves the current HTTP callsite constructs NUL-free validated address/day keys',()=>{
  const source=readFileSync(new URL('../../../app/api/faucet/onramp/route.ts',import.meta.url),'utf8');
  expect(source.indexOf('if (!isAddress(address))')).toBeLessThan(source.indexOf('db.reserveOnramp('));expect(source).toContain('const lower = address.toLowerCase()');expect(source).toContain('`onramp:${a}`');expect(source).toContain('`onramp-day:${new Date().toISOString().slice(0, 10)}`');
  expect(isAddress('0x'+'11'.repeat(20))).toBe(true);
  for(const value of ['0x'+'11'.repeat(20)+'\0','\ufeff0x'+'11'.repeat(20),'0x'+'11'.repeat(20)+'\ud800'])expect(isAddress(value)).toBe(false);
 });
});
