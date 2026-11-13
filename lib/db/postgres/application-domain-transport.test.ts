import { beforeEach,describe,expect,it,vi } from "vitest";
import { randomUUID } from "node:crypto";
import { STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity } from "../storage-identity";
const state=vi.hoisted(()=>({query:vi.fn(),end:vi.fn(),pools:0}));
vi.mock('pg',()=>({Pool:class{constructor(){state.pools++;}query(...args:unknown[]){return state.query(...args);}end(){return state.end();}on(){}},types:{getTypeParser:()=>(s:string)=>s}}));
import { composePostgresApplicationDomainTransport,createPostgresApplicationDomainTransport,type PostgresAuthWrite } from './application-domain-transport';
import { createPostgresApplicationDomainAuthority } from './application-domain-authority';
import { PostgresStorageUnavailable } from './connection';
import { PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from './domain-channel';
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
 it('admits a bounded content batch without widening authentication writes',async()=>{
  const t=make(),body='x'.repeat(100000),args={p_row:[{id:'synthetic-item',content:body}]},pending=t.applicationWrite('add_items',args);args.p_row[0].content='changed';await pending;
  expect(state.query.mock.calls[0][0].text).toBe('SELECT public.storage_application_add_items($1::jsonb,$2::text,$3::jsonb) AS result');
  expect(JSON.parse(state.query.mock.calls[0][0].values[2]).p_row[0].content).toBe(body);
  await expect(t.applicationWrite('create_auth_challenge',{p_hash:body})).rejects.toThrow(PostgresStorageUnavailable);expect(state.query).toHaveBeenCalledTimes(1);await t.close();
 });
 it('refuses oversized content before submission and retains the small setter bound',async()=>{
  const t=make();await expect(t.applicationWrite('save_query_memory',{p_row:{topics:['x'.repeat(1048576)]}})).rejects.toThrow(PostgresStorageUnavailable);
  await expect(t.applicationWrite('set_source_notify',{p_row:{secret:'x'.repeat(65536)}})).rejects.toThrow(PostgresStorageUnavailable);expect(state.query).not.toHaveBeenCalled();await t.close();
 });
 it('uses one exact native item identity call and refuses extra RPC arguments',async()=>{
  const call=vi.fn<PostgresDomainChannel['call']>().mockResolvedValue({items:[],ambiguous:false}),channel:PostgresDomainChannel={closed:false,call,async close(){}},t=composePostgresApplicationDomainTransport(channel,identity),authority=createPostgresApplicationDomainAuthority(t);
  expect(await authority.rpcResult('source_item_by_link',{p_source_id:'source',p_link:'https://example.invalid/item'})).toEqual({data:[],error:null});
  expect(call).toHaveBeenCalledExactlyOnceWith('sourceItemByLink',['source','https://example.invalid/item']);
  await expect(authority.rpcResult('source_item_by_link',{p_source_id:'source',p_link:'url',unexpected:true})).rejects.toThrow('Native item identity arguments refused');expect(call).toHaveBeenCalledTimes(1);
  call.mockResolvedValue({items:[],ambiguous:true});await expect(t.sourceItemByLink('source','url')).rejects.toThrow('Ambiguous exact source article membership');call.mockResolvedValue({items:[{},{},{}],ambiguous:false});await expect(t.sourceItemByLink('source','url')).rejects.toThrow(PostgresStorageUnavailable);
 });
 it('keeps an item identity read unpublished after terminal disposal',async()=>{
  let closed=false,finish!:(v:unknown)=>void;const call=vi.fn<PostgresDomainChannel['call']>().mockImplementation(()=>new Promise(resolve=>{finish=resolve;})),channel:PostgresDomainChannel={get closed(){return closed;},call,async close(){closed=true;}},t=composePostgresApplicationDomainTransport(channel,identity);
  const pending=t.sourceItemByLink('source','url'),outcome=expect(pending).rejects.toThrow(PostgresStorageUnavailable);await t.close();finish({items:[],ambiguous:false});await outcome;await expect(t.sourceItemByLink('source','url')).rejects.toThrow(PostgresStorageUnavailable);expect(call).toHaveBeenCalledTimes(1);
 });
});
