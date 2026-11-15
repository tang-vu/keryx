import { describe,it,expect,vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createHash,randomUUID } from 'node:crypto';
import { mkdtempSync,existsSync,unlinkSync,rmdirSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PaymentRecord } from '../../types';
import { installMainnetApplicationSchema } from '../mainnet-application-schema';
import { installNativeUserDomainSchema } from '../native-user-domain-schema';
import { insertStorageIdentity,installStorageFences } from '../storage-identity-sqlite';
import { openVerifiedSqliteStorage,assertVerifiedSqliteConnection } from '../storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../enrolled-sqlite-schema-profile';
import { STORAGE_MAINNET_PROFILE_DIGEST,validateStorageIdentity } from '../storage-identity';
import { SqliteAdapter } from '../sqlite-adapter';
import { capturePaymentEventRow,PAYMENT_EVENT_FIELDS,type PaymentEventRow } from './payment-events-packet';
import type { PostgresDomainChannel } from './domain-channel';
import { capturePaymentObservation,decodePaymentObservations,sourcePaymentRecord,PAYMENT_OBSERVATION_LIMITS,type PaymentObservationSelector } from './payment-observation-packet';
import { composePostgresPaymentObservations } from './payment-observation-transport';

// Genuine Source + fixed-channel boundaries only, never a positive Native
// factory/installed proof. All rows are unpaid synthetic metadata.
const digest='ab'.repeat(32),sha=(wire:string)=>createHash('sha256').update(wire).digest('hex');
const payment=(id:string,edit:Partial<PaymentRecord>={}):PaymentRecord=>({id,createdAt:'2026-11-15T00:00:00.000Z',kind:'citation',queryId:'query',sourceId:'source',sourceName:'Synthetic',payer:'0x'+'11'.repeat(20),payee:'0x'+'22'.repeat(20),amountUsdc:.01,network:'eip155:5042',settled:false,settlementStatus:'pending',authorizationId:'synthetic-nonce',...edit});
function cells(db:DatabaseSync,id:string){const row=db.prepare('SELECT * FROM payment_events WHERE id=?').get(id)!;expect(Object.keys(row).sort()).toEqual([...PAYMENT_EVENT_FIELDS].sort());return row as PaymentEventRow;}
function envelope(selector:PaymentObservationSelector,rows:readonly PaymentEventRow[],originals?:readonly PaymentEventRow[]){return {format:'keryx-payment-observations-v1',identityDigest:digest,selector,rows:rows.map((row,i)=>({id:row.id,identityDigest:digest,originalSha256:sha(JSON.stringify(originals?.[i]??row)),currentSha256:sha(JSON.stringify(row)),currentWire:JSON.stringify(row)}))};}
function channel(call:(op:string,args:readonly(string|null)[])=>Promise<unknown>):PostgresDomainChannel{return {closed:false,close:async()=>{},call:call as PostgresDomainChannel['call']};}
async function sourceFixture(run:(core:SqliteAdapter,db:DatabaseSync)=>Promise<void>){
 const folder=mkdtempSync(join(tmpdir(),'keryx-payment-observers-')),file=join(folder,'source.sqlite'),identity=validateStorageIdentity({format:'keryx-mainnet-storage-identity-v1',authorityMode:'mainnet-real',network:'eip155:5042',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:new Date().toISOString(),provenanceDigest:'71'.repeat(32)});
 let source:ReturnType<typeof openVerifiedSqliteStorage>|undefined;
 try{const seed=new DatabaseSync(file);try{seed.exec('BEGIN IMMEDIATE');installMainnetApplicationSchema(seed,{publicReferenceArchive:true});installNativeUserDomainSchema(seed);insertStorageIdentity(seed,identity);installStorageFences(seed,identity);seed.exec('COMMIT');}finally{seed.close();}
  source=openVerifiedSqliteStorage(file,identity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>{}});const core=SqliteAdapter.assembleConnectionCore(source.db,identity,()=>expect(assertVerifiedSqliteConnection(source!.db)).toEqual(identity));await run(core,source.db);
 }finally{source?.close();for(const path of [file,file+'-wal',file+'-shm',file+'-journal'])if(existsSync(path))unlinkSync(path);rmdirSync(folder);}
}
describe('actual selected Source payment observers',()=>{
 it('maps all five readers from exact Source cells without date/text normalization',async()=>sourceFixture(async(core,db)=>{
  const raw='\ufeffpaid\0lone\ud800';
  for(const [i,date] of ['\ufeffinvalid\0date\udfff','2026-11-15T01:00:00.123456+01:00','2026-11-15T00:00:00.0001Z',null,''].entries())await core.recordPayment(payment('synthetic-'+i,{createdAt:date as unknown as string,sourceName:raw,rationale:'literal\\ud800',itemTitle:'\ufefftitle',txHash:'receipt\0raw',weight:0,listPriceUsdc:0,authorizationId:i===0?'':undefined}));
  await core.recordPayment(payment('synthetic-inbound',{kind:'inbound'}));await core.recordPayment(payment('synthetic-fee',{kind:'operating-fee'}));
  const sourceRead=async(s:PaymentObservationSelector)=>s.mode==='list'?core.listPayments(s.limit!):s.mode==='pending'?core.listPendingPayments(s.limit!):s.mode==='query'?core.listPaymentsByQuery(JSON.parse(s.keyWire!)):s.mode==='creator'?core.listCreatorPaymentAttemptsByQuery(JSON.parse(s.keyWire!)):core.listPaymentsBySource(JSON.parse(s.keyWire!));
  const calls:string[]=[];const port=composePostgresPaymentObservations(channel(async(op,args)=>{calls.push(op);const s=JSON.parse(args[0]!) as PaymentObservationSelector;return envelope(s,(await sourceRead(s)).map(p=>cells(db,p.id!)));}));
  expect(await port.listPayments(100)).toEqual(await core.listPayments(100));expect(await port.listPendingPayments(100)).toEqual(await core.listPendingPayments(100));expect(await port.listPaymentsByQuery('query')).toEqual(await core.listPaymentsByQuery('query'));expect(await port.listCreatorPaymentAttemptsByQuery('query')).toEqual(await core.listCreatorPaymentAttemptsByQuery('query'));expect(await port.listPaymentsBySource('source')).toEqual(await core.listPaymentsBySource('source'));
  const observed=(await port.listPaymentsByQuery('query')).find(p=>p.id==='synthetic-0')!;expect(observed.sourceName).toBe('\ufeffpaid\0lone\ufffd');expect(observed.createdAt).toBe('\ufeffinvalid\0date\ufffd');expect(observed.rationale).toBe('literal\\ud800');expect(observed.authorizationId).toBe('');expect(observed.weight).toBe(0);expect(Object.hasOwn(observed,'offerId')).toBe(true);expect(observed.offerId).toBeUndefined();expect(calls.every(v=>v==='paymentObserve')).toBe(true);
 }));
 it('proves Source authority NUL rows are legal but their current native intake remains held',async()=>sourceFixture(async(core,db)=>{
  const query='query\0lone\ud800\ufeff',source='source\0\ufeff';await core.recordPayment(payment('synthetic-key',{queryId:query,sourceId:source}));
  expect((await core.listPaymentsByQuery(query))[0].queryId).toBe('query\0lone\ufffd\ufeff');expect((await core.listPaymentsBySource(source))[0].sourceId).toBe(source);expect(()=>capturePaymentEventRow(cells(db,'synthetic-key'))).toThrow('lookup text unsupported');
  const port=composePostgresPaymentObservations(channel(async(_op,args)=>envelope(JSON.parse(args[0]!),[])));expect(await port.listPaymentsByQuery(query)).toEqual([]);expect(await port.listPaymentsBySource(source)).toEqual([]);
 }));
 it('proves SQL equal-date ties differ across Source plans, without adopting rowid order',async()=>sourceFixture(async(core,db)=>{
  await core.recordPayment(payment('synthetic-tie-a'));await core.recordPayment(payment('synthetic-tie-b'));
  expect((await core.listPaymentsByQuery('query')).map(p=>p.id)).toEqual(['synthetic-tie-a','synthetic-tie-b']);expect((await core.listPendingPayments(10)).map(p=>p.id)).toEqual(['synthetic-tie-b','synthetic-tie-a']);
  expect(db.prepare("EXPLAIN QUERY PLAN SELECT * FROM payment_events WHERE settlement_status='pending' ORDER BY created_at ASC").all().some(r=>String(r.detail).includes('payment_events_pending'))).toBe(true);
 }));
 it('proves Source raw date ordering uses complete UTF8 bytes, including after NUL',async()=>sourceFixture(async(core)=>{
  const dates=['prefix\0b','prefix\0a','\ue000','\ud800\udc00','\ufeffprefix','',null];
  for(const [i,date] of dates.entries())await core.recordPayment(payment('synthetic-date-'+i,{createdAt:date as unknown as string}));
  const expected=[...dates].sort((a,b)=>a===null?b===null?0:-1:b===null?1:Buffer.compare(Buffer.from(a),Buffer.from(b)));
  expect((await core.listPaymentsByQuery('query')).map(p=>p.createdAt)).toEqual(expected);expect((await core.listPaymentsBySource('source')).map(p=>p.createdAt)).toEqual([...expected].reverse());
 }));
 it('retains Source LIMIT0/negative/fraction behavior and an explicit native unbounded hold',async()=>sourceFixture(async(core)=>{
  await core.recordPayment(payment('synthetic-limit'));expect(await core.listPayments(0)).toEqual([]);expect(await core.listPayments(-1)).toHaveLength(1);await expect(core.listPayments(1.5)).rejects.toThrow();
  const call=vi.fn(async(_op:string,args:readonly(string|null)[])=>envelope(JSON.parse(args[0]!),[])),port=composePostgresPaymentObservations(channel(call));expect(await port.listPayments(0)).toEqual([]);expect(call).toHaveBeenCalledTimes(1);
  for(const limit of [-1,1.5,NaN,Infinity])await expect(port.listPayments(limit)).rejects.toThrow('LIMIT surface unsupported');expect(call).toHaveBeenCalledTimes(1);
 }));
 it('returns changed current wire while retaining the original digest',async()=>sourceFixture(async(core,db)=>{
  await core.recordPayment(payment('synthetic-terminal'));const before=cells(db,'synthetic-terminal');await core.settlePendingPayment('synthetic-terminal','synthetic-nonce','receipt\0lone\ud800');const after=cells(db,'synthetic-terminal'),s=capturePaymentObservation('query','query',null),raw=envelope(s,[after],[before]);
  expect(raw.rows[0].originalSha256).not.toBe(raw.rows[0].currentSha256);expect(sourcePaymentRecord(decodePaymentObservations(raw,s)[0])).toEqual((await core.listPaymentsByQuery('query'))[0]);expect(after.tx_hash).toBe('receipt\0lone\ufffd');
 }));
});
describe('payment observation fixed-channel boundaries',()=>{
 it('refuses a closed channel before caller data and after its only await',async()=>{
  const raw=new Proxy({},{get(){throw Error('caller inspected');}}),call=vi.fn(async()=>null),closed=channel(call);Object.defineProperty(closed,'closed',{value:true});await expect(composePostgresPaymentObservations(closed).listPayments(raw as never)).rejects.toThrow('PostgreSQL storage unavailable');expect(call).not.toHaveBeenCalled();
  const c=channel(async(_op,args)=>{Object.defineProperty(c,'closed',{value:true});return envelope(JSON.parse(args[0]!),[]);});await expect(composePostgresPaymentObservations(c).listPayments(0)).rejects.toThrow('PostgreSQL storage unavailable');
 });
 it('never retries a failed read or sends a write/fallback action',async()=>{
  const call=vi.fn(async(_op:string,_args:readonly(string|null)[])=>{throw Error('fixed read failed');});await expect(composePostgresPaymentObservations(channel(call)).listPaymentsByQuery('q')).rejects.toThrow('fixed read failed');expect(call).toHaveBeenCalledTimes(1);expect(call.mock.calls[0][0]).toBe('paymentObserve');
 });
 it('binds selector, current SHA, row id, selected cells and identity before returning any page',()=>{
  const s=capturePaymentObservation('query','query',null),row=Object.fromEntries(PAYMENT_EVENT_FIELDS.map(k=>[k,null])) as PaymentEventRow;Object.assign(row,{id:'synthetic',kind:'citation',query_id:'query',settled:0,settlement_status:'pending'});
  for(const mutate of [(r:ReturnType<typeof envelope>)=>{r.selector={...s,keyWire:'"foreign"'};},(r:ReturnType<typeof envelope>)=>{r.rows[0].identityDigest='cd'.repeat(32);},(r:ReturnType<typeof envelope>)=>{r.rows[0].currentWire+=' ';},(r:ReturnType<typeof envelope>)=>{r.rows[0].id='foreign';},(r:ReturnType<typeof envelope>)=>{r.rows[0].currentWire=JSON.stringify({...row,query_id:'foreign'});r.rows[0].currentSha256=sha(r.rows[0].currentWire);},(r:ReturnType<typeof envelope>)=>{r.rows.push({...r.rows[0]});}]){const r=envelope(s,[row]);mutate(r);expect(()=>decodePaymentObservations(r,s)).toThrow();}
 });
 it('refuses an oversized later row or whole collection without exposing a partial page',()=>{
  const s=capturePaymentObservation('list',null,1000),row=Object.fromEntries(PAYMENT_EVENT_FIELDS.map(k=>[k,null])) as PaymentEventRow;Object.assign(row,{id:'synthetic',settled:0});
  expect(()=>decodePaymentObservations(envelope(s,[row,{...row,id:'later',rationale:'x'.repeat(PAYMENT_OBSERVATION_LIMITS.rowWireBytes)}]),s)).toThrow();
  expect(()=>decodePaymentObservations(envelope(capturePaymentObservation('query','query',null),Array.from({length:1001},(_,i)=>({...row,id:String(i),query_id:'query',kind:'citation'}))),capturePaymentObservation('query','query',null))).toThrow();
 });
 it('keeps raw scan prepared only, including hidden phases and default bounded arguments',async()=>{
  const call=vi.fn(async(_op:string,args:readonly(string|null)[])=>envelope(JSON.parse(args[0]!),[])),port=composePostgresPaymentObservations(channel(call));expect(await port.scanPaymentRows(0)).toEqual([]);expect(JSON.parse(call.mock.calls[0][1][0]!)).toEqual({mode:'scan',keyWire:null,limit:1000,offset:0});
  for(const [offset,limit] of [[-1,1],[200001,1],[0,0],[0,1001]])await expect(port.scanPaymentRows(offset,limit)).rejects.toThrow();expect(call).toHaveBeenCalledTimes(1);expect(Object.keys(port)).not.toContain('metrics');expect(Object.keys(port)).not.toContain('dailySettled');
 });
 it('extends only an existing function and keeps unsafe raw getters out of the owned SQL',()=>{
  const sql=readFileSync(new URL('../../../ops/keryx-postgres/payment-observers.sql',import.meta.url),'utf8');expect(sql).not.toMatch(/CREATE\s+(?:OR REPLACE\s+)?(?:FUNCTION|TABLE)/i);expect(sql).not.toContain('enter_operation');expect(sql).toContain("source_scalar_text(o.current_wire::text,'tokens')->>'created_at'");expect(sql).not.toMatch(/current_wire\s*->/);expect(sql).toContain('to_jsonb(definition)::text');expect(sql).not.toContain('count(*) FROM public.payment_events');
 });
});
