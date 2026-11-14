import { createHash } from 'node:crypto';
import { expect,it,vi } from 'vitest';
import { nativeApplicationJsonEntrySource } from './source-json-entries.mts';
import { nativeOperationalApplicationSource } from './operational-domain-source.mts';
import { nativeAuthApplicationSource } from './auth-domain-source.mts';
import { OPERATIONAL_WRITE_CALLS,OPERATIONAL_WRITE_OPERATIONS } from '../../lib/db/postgres/operational-write-calls';
import { composePostgresApplicationDomainTransport } from '../../lib/db/postgres/application-domain-transport';
import type { PostgresDomainChannel } from '../../lib/db/postgres/domain-channel';
import { STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity } from '../../lib/db/storage-identity';

const expected=['consume_rate_limit','delete_expired_rate_limits','acquire_reasoning_circuit','record_reasoning_circuit_failure',
 'clear_reasoning_circuit','mint_api_key','verify_api_key_2','revoke_api_key','upsert_api_key_usage','record_feedback','increment_activation_event'] as const;
const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',deploymentId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',storageId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',network:'eip155:5042',authorityMode:'mainnet-real',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,enrollmentId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',enrolledAt:'2026-10-01T00:00:00.000Z',provenanceDigest:'dd'.repeat(32)};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
// Fixed representative inputs, independently evaluated with the pre-grouping
// f69d925d emitter. Live domain inventories and bounds may evolve separately;
// those input changes must not be mistaken for a generator regression.
const defaultEntryReceipts=[
 {label:'auth write',names:['create_auth_challenge','create_web_session'],write:true,bound:65536,sha256:'772585629f6464eeac6b8d3b3cb490936267cd484611efdd9d03fa724cf2e5d8'},
 {label:'read',names:['get_sync_state','list_sources'],write:false,bound:65536,sha256:'6d76d66845d147dfed251662c74266ff74c02ecbc6b7a7559b08c3524062aa17'},
 {label:'large content',names:['set_cached'],write:true,bound:8388608,sha256:'c9c34a721c56fa2fcd3519b92588640aa79f563a43ae12140f47c81e683ceae4'},
 {label:'memory content',names:['save_query_memory'],write:true,bound:1048576,sha256:'1c90c1d175a17791af3505d4a185fc5a80c74a989c06670b46693c52c9846317'},
 {label:'historical upsert bound',names:['upsert_source'],write:true,bound:262144,sha256:'749524b568a9e514a49084c24d16e3a9d031822a89e875c3c180339f2c7afb5c'},
 {label:'larger upsert bound',names:['upsert_source'],write:true,bound:524288,sha256:'81e2e40f95b00d38e5b596c3acc7d730b0341c59d60f70886c9745896f739bc2'},
] as const;

it('preserves every existing named TypeScript call and its argument/result/write policy behind a fixed literal operation',async()=>{
 expect(Object.keys(OPERATIONAL_WRITE_OPERATIONS)).toEqual(expected);expect(Object.keys(OPERATIONAL_WRITE_CALLS)).toHaveLength(11);
 const call=vi.fn<PostgresDomainChannel['call']>().mockResolvedValue(null),channel:PostgresDomainChannel={call,closed:false,async close(){}};
 const port=composePostgresApplicationDomainTransport(channel,identity);
 for(const name of expected){
  const selected=OPERATIONAL_WRITE_OPERATIONS[name],entry=OPERATIONAL_WRITE_CALLS[selected];
  expect(selected).toBe('operational_'+name);
  expect(entry).toEqual({sql:`SELECT public.storage_application_operational_write($1::jsonb,$2::text,'${name}',$3::jsonb) AS result`,args:1,write:true,bytes:4194304});
  const input:{marker:string;selected_action:string}={marker:name,selected_action:'caller-cannot-select-another-operation'};
  const pending=port.applicationWrite(name,input);input.marker='mutated after capture';expect(await pending).toBeNull();
  expect(call.mock.calls.at(-1)).toEqual([selected,[JSON.stringify({marker:name,selected_action:'caller-cannot-select-another-operation'})]]);
 }
 const count=call.mock.calls.length;
 await expect(port.applicationWrite('storage_application_operational_write' as never,{})).rejects.toThrow();
 await expect(port.applicationWrite('unreviewed_operation' as never,{})).rejects.toThrow();expect(call).toHaveBeenCalledTimes(count);
});
it.each(defaultEntryReceipts)('preserves pre-grouping default emitter bytes for fixed $label inputs',({names,write,bound,sha256})=>{
 expect(hash(nativeApplicationJsonEntrySource(names,write,bound))).toBe(sha256);
});
it('emits only one bounded operational router while retaining the untouched auth SOURCE prefix',()=>{
 const source=nativeOperationalApplicationSource(),base=nativeAuthApplicationSource();expect(source.sql.startsWith(base.sql)).toBe(true);
 const addition=source.sql.slice(base.sql.length),group=nativeApplicationJsonEntrySource(expected,true,65536,'operational_write');
 expect(Buffer.byteLength(addition)).toBeLessThanOrEqual(32768);expect(Buffer.byteLength(group)).toBeLessThanOrEqual(32768);
 expect([...addition.matchAll(/CREATE FUNCTION public\.storage_application_operational_write\(/g)]).toHaveLength(1);
 expect(addition).not.toContain("'storage_application_'||selected");
 expect(group).toContain("IF octet_length(statement)>32768 THEN RAISE EXCEPTION 'operational expanded SOURCE bound'");
 const runtime=group.slice(group.indexOf('$entry$CREATE FUNCTION'),group.indexOf('$fn$;$entry$'));
 expect(runtime).toContain('CASE op');expect(runtime).not.toMatch(/\bEXECUTE\b/);
});
it('refuses a grouped read, foreign group, altered bounds or another operation inventory',()=>{
 for(const invoke of [()=>nativeApplicationJsonEntrySource(expected,false,65536,'operational_write'),
  ()=>nativeApplicationJsonEntrySource(expected,true,65536,'caller_table' as never),
  ()=>nativeApplicationJsonEntrySource(expected,true,131072,'operational_write'),
  ()=>nativeApplicationJsonEntrySource(expected.slice(0,10),true,65536,'operational_write'),
  ()=>nativeApplicationJsonEntrySource([...expected.slice(0,10),'upsert_user'],true,65536,'operational_write')])expect(invoke).toThrow();
});
