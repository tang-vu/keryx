/** Synthetic reservation metadata only. No faucet/provider/wallet/signature or
 * transfer runs; the selected verified SQLite core is the behavior oracle. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,existsSync,unlinkSync,rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from 'pg';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { insertStorageIdentity,installStorageFences } from '../../lib/db/storage-identity-sqlite';
import { openVerifiedSqliteStorage,assertVerifiedSqliteConnection } from '../../lib/db/storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../../lib/db/enrolled-sqlite-schema-profile';
import type { StorageIdentity } from '../../lib/db/storage-identity';
import { SqliteAdapter } from '../../lib/db/sqlite-adapter';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import { createPostgresDomainChannel,PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from '../../lib/db/postgres/domain-channel';
import { composePostgresOnramp } from '../../lib/db/postgres/onramp-transport';
import { startCommitAckLossProxy } from './commit-ack-loss.mts';

export async function qualifyOnramp(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;contentionClient:Client;ownerSql:(sql:string)=>string}){
 const folder=mkdtempSync(join(tmpdir(),'keryx-native-onramp-')),file=join(folder,'source.sqlite'),prefix='synthetic:onramp:'+randomUUID()+':';
 const q=(value:string)=>"'"+value.replaceAll("'","''")+"'",hex=(value:string)=>Buffer.from(value).toString('hex');
 const held=(sql:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+sql+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 const base=createPostgresDomainChannel(input.options,input.identity,input.digest),native=composePostgresOnramp(base,false);
 let source:ReturnType<typeof openVerifiedSqliteStorage>|undefined,loss:PostgresDomainChannel|undefined,proxy:Awaited<ReturnType<typeof startCommitAckLossProxy>>|undefined,vectors=0,knownChanges=0;
 const nativeRow=(key:string)=>{const wire=input.ownerSql(`SELECT coalesce((SELECT jsonb_build_object('value',value,'updatedAt',updated_at)::text FROM public.sync_state WHERE encode(convert_to(key,'UTF8'),'hex')=${q(hex(key))}),'null');`);return JSON.parse(wire) as {value:string;updatedAt:string|null}|null;};
 const writersEmpty=()=>assert.equal(input.ownerSql('SELECT count(*) FROM keryx_storage.writer;'),'0');
 const outsideHash=()=>input.ownerSql(`SELECT encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha COLLATE "C"),''),'UTF8')),'hex') FROM(SELECT encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') row_sha FROM public.sync_state s WHERE left(key,${prefix.length})<>${q(prefix)}) retained;`);
 const prior=outsideHash();
 try{
  const seed=new DatabaseSync(file);try{seed.exec('BEGIN');installMainnetApplicationSchema(seed,{publicReferenceArchive:true});installNativeUserDomainSchema(seed);insertStorageIdentity(seed,input.identity);installStorageFences(seed,input.identity);seed.exec('COMMIT');}finally{seed.close();}
  source=openVerifiedSqliteStorage(file,input.identity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>{}});
  const core=SqliteAdapter.assembleConnectionCore(source.db,input.identity,()=>assert.deepEqual(assertVerifiedSqliteConnection(source!.db),input.identity));
  const sourceRow=(key:string)=>{const row=source!.db.prepare('SELECT value,updated_at FROM sync_state WHERE key=?').get(key);return row?{value:String(row.value),updatedAt:row.updated_at as string|null}:null;};
  const seedValue=async(key:string,value:string)=>{await core.setSyncState(key,value);const row=sourceRow(key)!;held(`INSERT INTO public.sync_state(key,value,updated_at) VALUES(${q(Buffer.from(key).toString('utf8'))},${q(row.value)},${q(row.updatedAt!)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;`);};
  const reserve=async(address:string,day:string,amount:number,cap:number,now:number)=>{
   let expected:Awaited<ReturnType<typeof core.reserveOnramp>>|undefined,error=false;
   try{expected=await core.reserveOnramp(address,day,amount,cap,now);}catch{error=true;}
   if(error)await assert.rejects(native.reserveOnramp(address,day,amount,cap,now));else assert.equal(await native.reserveOnramp(address,day,amount,cap,now),expected);
   assert.deepEqual(nativeRow(address),sourceRow(address));assert.deepEqual(nativeRow(day),sourceRow(day));writersEmpty();vectors++;
  };
  const release=async(address:string,day:string,amount:number)=>{
   const before=Number(input.ownerSql('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::text;'));
   await core.releaseOnramp(address,day,amount);await native.releaseOnramp(address,day,amount);
   const expected=sourceRow(day),actual=nativeRow(day),after=Number(input.ownerSql('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::text;'));
   assert.equal(nativeRow(address),null);assert.equal(sourceRow(address),null);
   assert.equal(actual?.value,expected?.value);if(actual){assert.equal(new Date(actual.updatedAt!).toISOString(),actual.updatedAt);assert(Date.parse(actual.updatedAt!)>=before&&Date.parse(actual.updatedAt!)<=after);}
   writersEmpty();vectors++;
  };
  let n=0;
  for(const value of ['0.7tail','\ufeff .7extra','not-a-number','Infinity','-Infinity','-0','1e309','0x10']){
   const address=prefix+'address:'+n,day=prefix+'day:'+n++;await seedValue(day,value);await reserve(address,day,0.7,Infinity,0.9);
  }
  for(const amount of [NaN,Infinity,-Infinity,-2,-0]){const address=prefix+'special:'+n,day=prefix+'special-day:'+n++;await reserve(address,day,amount,Infinity,0);}
  for(const now of [-0,0.9,-0.9,8640000000000000,-8640000000000000]){const address=prefix+'clock:'+n,day=prefix+'clock-day:'+n++;await reserve(address,day,0.7,2.1,now);}
  const claimed=prefix+'claimed';await seedValue(claimed,'opaque marker');
  await reserve(claimed,prefix+'unused',1,0,NaN);await reserve(prefix+'capped',prefix+'empty-day',2,1,Infinity);await reserve(prefix+'invalid-now',prefix+'empty-day',1,2,NaN);
  const alias=prefix+'alias';await reserve(alias,alias,0.7,2.1,0);await release(alias,alias,0.7);
  const lone=prefix+'\ud800',replacement=prefix+'\ufffd';await reserve(lone,prefix+'lone-day',0.7,2.1,0);await release(replacement,prefix+'lone-day',0.7);
  const bom=prefix+'\ufeffaddress',bomDay=prefix+'\ufeffday';await reserve(bom,bomDay,0.7,2.1,0);await release(bom,bomDay,0.7);await release(prefix+'missing-address',prefix+'missing-day',0.7);
  // Exact Source-positive/NATIVE-HOLD class: PostgreSQL TEXT cannot store NUL.
  // Both address and day variants must fail before EITHER business write.
  for(const nulDay of [false,true]){
   const address=prefix+'nul-address:'+nulDay+(nulDay?'':'\0'),day=prefix+'nul-day:'+nulDay+(nulDay?'\0':'');
   assert.equal(await core.reserveOnramp(address,day,0.7,2.1,0),'reserved');
   await assert.rejects(native.reserveOnramp(address,day,0.7,2.1,0));assert.equal(nativeRow(address),null);assert.equal(nativeRow(day),null);
   await core.releaseOnramp(address,day,0.7);await core.releaseOnramp(day,day,0);await native.releaseOnramp(address,day,0);await native.releaseOnramp(day,day,0);
   assert.equal(sourceRow(address),null);assert.equal(sourceRow(day),null);assert.equal(nativeRow(address),null);assert.equal(nativeRow(day),null);writersEmpty();vectors++;
  }
  // ACKed no-write CAS changes re-evaluate the captured request, not caller data.
  const changedAddress=prefix+'changed',changedDay=prefix+'changed-day';let changeOnce=false;
  const changedChannel:PostgresDomainChannel={get closed(){return base.closed;},close:()=>base.close(),async call(operation,args){const value=await base.call(operation,args);if(operation===('onrampFrame' as Parameters<typeof base.call>[0])&&!changeOnce){changeOnce=true;await seedValue(changedDay,'1.2tail');}if(operation===('onrampApply' as Parameters<typeof base.call>[0])&&(value as {status?:string})?.status==='changed')knownChanges++;return value;}};
  assert.equal(await composePostgresOnramp(changedChannel,false).reserveOnramp(changedAddress,changedDay,0.7,2.1,0),await core.reserveOnramp(changedAddress,changedDay,0.7,2.1,0));assert(knownChanges>0);assert.deepEqual(nativeRow(changedDay),sourceRow(changedDay));writersEmpty();vectors++;
  // Ten operations exercise the shared quota, two concurrently. This matches
  // the pool's active connection bound without mistaking queued acquisition
  // timeouts for a Source status; the2s/5s/1s runtime budgets stay unchanged.
  const paired=async<T,>(work:(i:number)=>Promise<T>)=>{const results:T[]=[];for(let i=0;i<10;i+=2)results.push(...await Promise.all([work(i),work(i+1)]));return results;};
  const sameAddress=prefix+'concurrent',sameDay=prefix+'concurrent-day';const actual=await paired(()=>native.reserveOnramp(sameAddress,sameDay,0.7,20,0)),expected=await paired(()=>core.reserveOnramp(sameAddress,sameDay,0.7,20,0));assert.deepEqual([...actual].sort(),[...expected].sort());vectors++;
  const sharedDay=prefix+'shared-day';const cappedNative=await paired(i=>native.reserveOnramp(prefix+'cap:'+i,sharedDay,0.7,2.1,0)),cappedSource=await paired(i=>core.reserveOnramp(prefix+'cap:'+i,sharedDay,0.7,2.1,0));assert.equal(cappedNative.filter(v=>v==='reserved').length,3);assert.equal(cappedNative.filter(v=>v==='daily-cap').length,7);assert.deepEqual([...cappedNative].sort(),[...cappedSource].sort());assert.equal(nativeRow(sharedDay)?.value,sourceRow(sharedDay)?.value);writersEmpty();vectors++;
  const readOnly=composePostgresOnramp(base,true);await assert.rejects(readOnly.reserveOnramp(prefix+'readonly',prefix+'readonly-day',1,2,0));await assert.rejects(readOnly.releaseOnramp(prefix+'readonly',prefix+'readonly-day',1));vectors++;
  assert(input.options.endpoint.kind==='loopback');proxy=await startCommitAckLossProxy(input.options.endpoint.port);loss=createPostgresDomainChannel({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest);
  const lossy:PostgresDomainChannel={get closed(){return loss!.closed;},close:()=>loss!.close(),call(operation,args){if(operation===('onrampApply' as Parameters<typeof base.call>[0]))proxy!.arm();return loss!.call(operation,args);}};
  const lostAddress=prefix+'lost',lostDay=prefix+'lost-day';await assert.rejects(composePostgresOnramp(lossy,false).reserveOnramp(lostAddress,lostDay,0.7,2.1,0),PostgresDomainWriteOutcomeUnknown);assert(proxy.observation().dropped);assert.equal(nativeRow(lostAddress)?.value,'0');assert.equal(nativeRow(lostDay)?.value,'0.7');assert.equal(await core.reserveOnramp(lostAddress,lostDay,0.7,2.1,0),'reserved');assert.deepEqual(nativeRow(lostAddress),sourceRow(lostAddress));assert.deepEqual(nativeRow(lostDay),sourceRow(lostDay));assert.equal(await native.reserveOnramp(lostAddress,lostDay,0.7,2.1,0),'already-funded');writersEmpty();vectors++;
  assert.equal(outsideHash(),prior);
  return {vectors,knownChanges,genuineSelectedSqliteCore:true,fixedNativeSnapshotApply:true,sourceParseFloatAndIeee754:true,callerTimeClipAndStringValues:true,invalidClockEarlyReturns:true,keyAliasesAndMissingDayRelease:true,scalarReplacementAndBom:true,sourceLegalNulReservationHeldAtomically:true,noNulKeyNormalization:true,finiteAckedCasRecomputation:true,unknownAckNeverRetried:true,concurrentOnceAndDailyCap:true,releaseOperationClock:true,otherRetainedStateUnchanged:true,sourceRepresentationHolds:['new-sync-state-key-containing-NUL'],retainedNulKeyCensusRequired:true,manifestBetweenAwaitsFactoryQualificationPending:true,fullWriterQualified:false,fundingActions:0,providerActions:0,realSignatures:0};
 }finally{await loss?.close();await proxy?.close();await base.close();source?.close();for(const path of [file,file+'-wal',file+'-shm',file+'-journal'])if(existsSync(path))unlinkSync(path);rmdirSync(folder);}
}
