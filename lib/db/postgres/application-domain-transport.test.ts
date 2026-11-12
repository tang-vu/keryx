import { beforeEach,describe,expect,it,vi } from "vitest";
import { randomUUID } from "node:crypto";
import { STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity } from "../storage-identity";
const state=vi.hoisted(()=>({query:vi.fn(),end:vi.fn(),pools:0}));
vi.mock('pg',()=>({Pool:class{constructor(){state.pools++;}query(...args:unknown[]){return state.query(...args);}end(){return state.end();}on(){}},types:{getTypeParser:()=>(s:string)=>s}}));
import { createPostgresApplicationDomainTransport,type PostgresAuthWrite } from './application-domain-transport';
import { PostgresStorageUnavailable } from './connection';
import { PostgresDomainWriteOutcomeUnknown } from './domain-channel';
const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',network:'eip155:5042',authorityMode:'mainnet-real',deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:'2026-11-12T00:00:00.000Z',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,provenanceDigest:'11'.repeat(32)};
const options={endpoint:{kind:'loopback' as const,port:5432},database:'synthetic',role:'keryx_app',password:'synthetic-not-a-live-secret'};
const make=()=>createPostgresApplicationDomainTransport(options,identity,'22'.repeat(32));
beforeEach(()=>{vi.clearAllMocks();state.pools=0;state.query.mockResolvedValue({rows:[[null]],fields:[{name:'result',dataTypeID:3802}]});state.end.mockResolvedValue(undefined);});
describe('native application writes',()=>{
 it('captures a fixed auth write and shares the financial pool',async()=>{
  const t=make(),args={p_hash:'original',p_issued_at:1,p_expires_at:2},request=t.applicationWrite('create_auth_challenge',args);args.p_hash='changed';await request;
  expect(state.query.mock.calls[0][0].text).toBe('SELECT public.storage_application_create_auth_challenge($1::jsonb,$2::text,$3::jsonb) AS result');
  expect(JSON.parse(state.query.mock.calls[0][0].values[2]).p_hash).toBe('original');expect(state.pools).toBe(1);await t.close();
 });
 it.each(['__proto__','constructor','record_payment','create_auth_challenge;drop table users'])('refuses an unqualified write %s before submission',async name=>{
  const t=make();await expect(t.applicationWrite(name as PostgresAuthWrite,{})).rejects.toThrow(PostgresStorageUnavailable);expect(state.query).not.toHaveBeenCalled();await t.close();
 });
 it('reports uncertain writes without retrying or leaking database detail',async()=>{
  state.query.mockRejectedValue(new Error('private database detail'));const t=make();await expect(t.applicationWrite('consume_auth_challenge',{p_hash:'test',p_now:1})).rejects.toThrow(PostgresDomainWriteOutcomeUnknown);expect(state.query).toHaveBeenCalledTimes(1);await t.close();
 });
 it('never publishes a write result after terminal disposal',async()=>{
  let finish!:(v:unknown)=>void;state.query.mockReturnValue(new Promise(resolve=>{finish=resolve;}));const t=make(),request=t.applicationWrite('consume_auth_challenge',{}),outcome=expect(request).rejects.toThrow(PostgresDomainWriteOutcomeUnknown),closing=t.close();
  expect(state.end).not.toHaveBeenCalled();finish({rows:[['true']],fields:[{name:'result',dataTypeID:3802}]});await outcome;await closing;
  await expect(t.applicationWrite('consume_auth_challenge',{})).rejects.toThrow(PostgresStorageUnavailable);expect(state.end).toHaveBeenCalledTimes(1);
 });
});
