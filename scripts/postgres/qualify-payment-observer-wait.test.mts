import {beforeEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Client} from 'pg';
import {createPaymentConsumedFieldsFixture} from './payment-consumed-fields-fixture.mts';
import {STORAGE_MAINNET_PROFILE_DIGEST,validateStorageIdentity} from '../../lib/db/storage-identity';
import {PostgresStorageUnavailable} from '../../lib/db/postgres/connection';
import {LEGACY_PAYMENT_CONSUMED_FIELDS} from './payment-browser-source.mts';

// Dependency-only sequencing tests, never actual PostgreSQL qualification or
// installed facade proof. Packet bytes below come from genuine local Source SQL.
const state=vi.hoisted(()=>({call:vi.fn(),close:vi.fn(),create:vi.fn()}));
vi.mock('../../lib/db/postgres/domain-channel',()=>({createPostgresDomainChannel:state.create}));
import {qualifyPaymentObserverWait} from './qualify-payment-observer-wait.mts';
const expectedIdentity=()=>validateStorageIdentity({format:'keryx-mainnet-storage-identity-v1',authorityMode:'mainnet-real',network:'eip155:5042',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:'2026-11-14T00:00:00.000Z',provenanceDigest:'71'.repeat(32)});
beforeEach(()=>{vi.resetAllMocks();state.create.mockReturnValue({call:state.call,close:state.close});state.close.mockResolvedValue(undefined);});
function dependencies(mode:'raw'|'resolved'|'early'|'timeout'='raw'){
 const events:string[]=[],identity=expectedIdentity();let reject!: (error:unknown)=>void,resolve!: (value:unknown)=>void,committed=false;
 const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});
 state.call.mockResolvedValueOnce({synthetic:'baseline only'}).mockImplementationOnce(()=>{events.push('adapter-queued');return mode==='early'?Promise.resolve({synthetic:'too early'}):pending;});
 const query=vi.fn(async(raw:unknown,values?:unknown[])=>{
  const sql=typeof raw==='string'?raw:(raw as {text:string}).text;
  if(sql==='SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND usename=$1')return {rows:[{pid:17}]};
  if(sql.includes("application_name='keryx-postgres-guarded'")){expect(values?.[0]).toBe('keryx_app');expect(values?.[1]).toContain('storage_session_funding_accounting');return {rows:[{pid:17},{pid:41}]};}
  if(sql==='BEGIN'){events.push('writer-begin');return {rows:[]};}
  if(sql.includes('storage_payment_events')){events.push('writer-record');return {rows:[]};}
  if(sql.includes('FROM pg_locks w JOIN pg_locks h')){
   expect(values).toEqual([41]);expect(sql).toContain("w.mode='ShareLock'");expect(sql).toContain("h.mode='ExclusiveLock'");
   expect(sql).toContain('634781904177022::bigint');expect(sql).toContain('pg_blocking_pids(w.pid)');events.push('exact-witness');return {rows:[{n:'1'}]};
  }
  if(sql==='COMMIT'){events.push('writer-commit');committed=true;if(mode==='resolved')resolve({synthetic:'wrongly accepted'});else reject(new PostgresStorageUnavailable());return {rows:[]};}
  if(sql==='ROLLBACK'){events.push('writer-rollback');if(mode==='early')resolve({synthetic:'unused dependency promise'});else reject(new PostgresStorageUnavailable());return {rows:[]};}
  if(sql.includes('storage_session_funding_accounting')){expect(committed).toBe(true);events.push('direct-postcommit');throw new Error(mode==='timeout'?'canceling statement due to lock timeout':'native payment raw observation unavailable to legacy observer');}
  throw new Error('Unexpected synthetic dependency query');
 });
 return {events,query,input:{identity,digest:'ab'.repeat(32),options:{endpoint:{kind:'loopback' as const,port:5432},database:'synthetic_fixture',role:'keryx_app',password:'synthetic-fixture-only'},holder:{query} as unknown as Client}};
}
it('rejects presentation-only gaps that actual Source financial readers safely ignore before any target access',async()=>{
 const d=dependencies(),fixture=createPaymentConsumedFieldsFixture(d.input.identity);try{
  const before=fixture.read(),packet=fixture.addPresentationGaps();expect(fixture.read()).toEqual(before);
  expect(packet.unprojectedFields).not.toContain('tx_hash');
  await expect(qualifyPaymentObserverWait(d.input,packet)).rejects.toThrow('unsupported consumed tx_hash');
  expect(state.create).not.toHaveBeenCalled();expect(d.query).not.toHaveBeenCalled();
 }finally{fixture.close();}
});
it('uses genuine Source NUL receipt bytes and keeps the adapter pending until the exact writer commits',async()=>{
 const d=dependencies(),fixture=createPaymentConsumedFieldsFixture(d.input.identity);try{
  fixture.expose('nul');fixture.settleNul();const packet=fixture.payment('nul');
  expect(fixture.read('nul').confirmed).toBe(1);expect(packet.row.tx_hash).toBe('receipt\0retained');expect(packet.projection.tx_hash).toBeNull();
  expect(packet.unprojectedFields.filter(field=>(LEGACY_PAYMENT_CONSUMED_FIELDS.session_funding_accounting as readonly string[]).includes(field))).toEqual(['tx_hash']);
  const result=await qualifyPaymentObserverWait(d.input,packet);
  expect(d.events).toEqual(['writer-begin','writer-record','adapter-queued','exact-witness','writer-commit','direct-postcommit']);
  expect(result).toMatchObject({exactDataLockWitness:true,readerPendingUntilWriterCommit:true,consumedFieldRawRefusal:true,noLockOrStatementBudgetRaised:true,installedWriterQualified:false});
  expect(state.call).toHaveBeenCalledTimes(2);expect(state.close).toHaveBeenCalledOnce();
 }finally{fixture.close();}
});
it.each(['resolved','early','timeout'] as const)('rejects %s dependency outcomes rather than accepting a false queued/refusal witness',async mode=>{
 const d=dependencies(mode),fixture=createPaymentConsumedFieldsFixture(d.input.identity);try{
  fixture.expose('nul');fixture.settleNul();await expect(qualifyPaymentObserverWait(d.input,fixture.payment('nul'))).rejects.toThrow();
  if(mode==='early')expect(d.events).toContain('writer-rollback');
  if(mode==='resolved')expect(d.events).not.toContain('direct-postcommit');
  if(mode==='timeout')expect(d.events).toContain('direct-postcommit');
  expect(state.close).toHaveBeenCalledOnce();
 }finally{fixture.close();}
});
