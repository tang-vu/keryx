import { beforeEach,describe,expect,it,vi } from "vitest";
import { randomUUID } from "node:crypto";
import { STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity } from "../storage-identity";
const state=vi.hoisted(()=>({query:vi.fn(),connect:vi.fn(),clientQuery:vi.fn(),release:vi.fn(),end:vi.fn(),pools:0}));
vi.mock('pg',()=>({Pool:class{constructor(){state.pools++;}query(...args:unknown[]){return state.query(...args);}connect(){return state.connect();}end(){return state.end();}on(){}},types:{getTypeParser:()=>(s:string)=>s}}));
import { createPostgresApplicationReadTransport,type PostgresApplicationRead } from './application-read-transport';
import { PostgresStorageBusy,PostgresStorageUnavailable } from './connection';
const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',network:'eip155:5042',authorityMode:'mainnet-real',deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:'2026-11-12T00:00:00.000Z',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,provenanceDigest:'11'.repeat(32)};
const options={endpoint:{kind:'loopback' as const,port:5432},database:'synthetic',role:'keryx_app',password:'synthetic-not-a-live-secret'};
const response=(v:unknown)=>({rows:[[v===null?null:JSON.stringify(v)]],fields:[{name:'result',dataTypeID:3802}]});
const client=()=>({query:state.clientQuery,release:state.release});
const make=()=>createPostgresApplicationReadTransport(options,identity,'22'.repeat(32));
beforeEach(()=>{vi.clearAllMocks();state.pools=0;state.query.mockResolvedValue(response(0));state.connect.mockResolvedValue(client());state.clientQuery.mockImplementation(async (q:unknown)=>typeof q==='string'?{}:response([]));state.end.mockResolvedValue(undefined);});
describe('native application read composition',()=>{
 it('uses a real read-only transaction and the same bounded pool as financial ports',async()=>{
  const t=make();expect(await t.applicationRead('list_all_sources',{})).toEqual([]);expect(await t.browserSignerRetainedSpend('0x'+'11'.repeat(20))).toBe(0);
  expect(state.pools).toBe(1);expect(state.clientQuery.mock.calls[0][0]).toBe('BEGIN READ ONLY');expect(state.clientQuery.mock.calls[1][0].text).toBe('SELECT public.storage_application_list_all_sources($1::jsonb,$2::text,$3::jsonb) AS result');
  expect(state.clientQuery.mock.calls[2][0]).toBe('COMMIT');expect(state.release).toHaveBeenCalledWith(false);await t.close();
 });
 it.each(['__proto__','constructor','get_user;drop table sources','set_sync_state'])( 'refuses a caller-selected operation %s before pool admission',async operation=>{
  const t=make();await expect(t.applicationRead(operation as PostgresApplicationRead,{})).rejects.toThrow(PostgresStorageUnavailable);expect(state.connect).not.toHaveBeenCalled();await t.close();
 });
 it('captures argument bytes before awaiting a queued native connection',async()=>{
  let resume!:(c:ReturnType<typeof client>)=>void;state.connect.mockReturnValue(new Promise(resolve=>{resume=resolve;}));const t=make(),args={p_wallet_address:'original'},request=t.applicationRead('get_user',args);args.p_wallet_address='changed';resume(client());
  await request;expect(JSON.parse(state.clientQuery.mock.calls[1][0].values[2])).toEqual({p_wallet_address:'original'});await t.close();
 });
 it('destroys a failed transaction without retrying or returning private database text',async()=>{
  state.clientQuery.mockRejectedValue(new Error('private database detail'));const t=make();await expect(t.applicationRead('list_all_sources',{})).rejects.toThrow(/^PostgreSQL storage unavailable$/);
  expect(state.clientQuery).toHaveBeenCalledTimes(1);expect(state.release).toHaveBeenCalledWith(true);await t.close();
 });
 it('does not publish a read if its COMMIT acknowledgement is lost',async()=>{
  state.clientQuery.mockImplementation(async(q:unknown)=>{if(q==='COMMIT')throw new Error('lost ack');return typeof q==='string'?{}:response([]);});const t=make();await expect(t.applicationRead('list_all_sources',{})).rejects.toThrow(PostgresStorageUnavailable);
  expect(state.connect).toHaveBeenCalledTimes(1);expect(state.release).toHaveBeenCalledWith(true);await t.close();
 });
 it('keeps disposal terminal while a native read is waiting to finish',async()=>{
  let finish!:()=>void;state.clientQuery.mockImplementation(async(q:unknown)=>{if(q==='COMMIT')await new Promise<void>(resolve=>{finish=resolve;});return typeof q==='string'?{}:response([]);});
  const t=make(),request=t.applicationRead('list_all_sources',{}),outcome=expect(request).rejects.toThrow(PostgresStorageUnavailable);await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));const close=t.close();expect(state.end).not.toHaveBeenCalled();finish();await outcome;await close;
  await expect(t.applicationRead('list_all_sources',{})).rejects.toThrow(PostgresStorageUnavailable);expect(state.end).toHaveBeenCalledTimes(1);
 });
 it('bounds all queued reads before acquiring more native connections',async()=>{
  let resume!:(c:ReturnType<typeof client>)=>void;state.connect.mockReturnValue(new Promise(resolve=>{resume=resolve;}));const t=make(),requests=Array.from({length:10},()=>t.applicationRead('list_all_sources',{}));
  await expect(t.applicationRead('list_all_sources',{})).rejects.toThrow(PostgresStorageBusy);expect(state.connect).toHaveBeenCalledTimes(10);resume(client());await Promise.all(requests);await t.close();
 });
});
