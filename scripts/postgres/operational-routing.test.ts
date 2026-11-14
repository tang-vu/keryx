import { createHash } from 'node:crypto';
import { expect,it,vi } from 'vitest';
import { nativeApplicationJsonEntrySource } from './source-json-entries.mts';
import { nativeOperationalApplicationSource } from './operational-domain-source.mts';
import { nativeAuthApplicationSource } from './auth-domain-source.mts';
import { AUTH_WRITE_OPERATIONS } from '../../lib/db/postgres/auth-write-calls';
import { APPLICATION_READ_OPERATIONS } from '../../lib/db/postgres/application-read-calls';
import { CONTENT_WRITE_OPERATIONS,CONTENT_WRITE_INPUT_BYTES } from '../../lib/db/postgres/content-write-calls';
import { OPERATIONAL_WRITE_CALLS,OPERATIONAL_WRITE_OPERATIONS } from '../../lib/db/postgres/operational-write-calls';
import { composePostgresApplicationDomainTransport } from '../../lib/db/postgres/application-domain-transport';
import type { PostgresDomainChannel } from '../../lib/db/postgres/domain-channel';
import { STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity } from '../../lib/db/storage-identity';

const expected=['consume_rate_limit','delete_expired_rate_limits','acquire_reasoning_circuit','record_reasoning_circuit_failure',
 'clear_reasoning_circuit','mint_api_key','verify_api_key_2','revoke_api_key','upsert_api_key_usage','record_feedback','increment_activation_event'] as const;
const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',deploymentId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',storageId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',network:'eip155:5042',authorityMode:'mainnet-real',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,enrollmentId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',enrolledAt:'2026-10-01T00:00:00.000Z',provenanceDigest:'dd'.repeat(32)};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');

it('preserves every existing named TypeScript call and its argument/result/write policy behind a fixed literal operation',async()=>{
 expect(Object.keys(OPERATIONAL_WRITE_OPERATIONS)).toEqual(expected);expect(Object.keys(OPERATIONAL_WRITE_CALLS)).toHaveLength(11);
 const call=vi.fn<PostgresDomainChannel['call']>().mockResolvedValue(null),channel:PostgresDomainChannel={call,closed:false,async close(){}};
 const port=composePostgresApplicationDomainTransport(channel,identity);
 for(const name of expected){
  const selected=OPERATIONAL_WRITE_OPERATIONS[name],entry=OPERATIONAL_WRITE_CALLS[selected];
  expect(selected).toBe('operational_'+name);
  expect(entry).toEqual({sql:`SELECT public.storage_application_operational_write($1::jsonb,$2::text,'${name}',$3::jsonb) AS result`,args:1,write:true,bytes:4194304});
  const input={marker:name,selected_action:'caller-cannot-select-another-operation'};
  const pending=port.applicationWrite(name,input);input.marker='mutated after capture';expect(await pending).toBeNull();
  expect(call.mock.calls.at(-1)).toEqual([selected,[JSON.stringify({marker:name,selected_action:'caller-cannot-select-another-operation'})]]);
 }
 const count=call.mock.calls.length;
 await expect(port.applicationWrite('storage_application_operational_write' as never,{})).rejects.toThrow();
 await expect(port.applicationWrite('unreviewed_operation' as never,{})).rejects.toThrow();expect(call).toHaveBeenCalledTimes(count);
});
it('leaves all ungrouped auth/content/read generator output byte-identical to f69d925d',()=>{
 // These receipts predate the optional grouped variant. They cover the actual
 // auth/content invocations and the complete generic read inventory.
 expect(hash(nativeApplicationJsonEntrySource(Object.keys(AUTH_WRITE_OPERATIONS),true))).toBe('d60aa66b462b62a8aa6979a013e0cea4e3e2a76de32b489afd6412491f160837');
 const content=Object.keys(CONTENT_WRITE_OPERATIONS).map(name=>nativeApplicationJsonEntrySource([name],true,Object.hasOwn(CONTENT_WRITE_INPUT_BYTES,name)?CONTENT_WRITE_INPUT_BYTES[name as keyof typeof CONTENT_WRITE_INPUT_BYTES]:65536)).join('\n');
 expect(hash(content)).toBe('3d4392a8c3bf1b6b024376c732b83b67e1c5013018c1a33ba82a401728ab31f5');
 expect(hash(nativeApplicationJsonEntrySource(Object.keys(APPLICATION_READ_OPERATIONS)))).toBe('a76b56efa2113477166dbd513d37759f3ee859694e4e9a3fff4e2661f1ffeeae');
 expect(hash(nativeApplicationJsonEntrySource(['get_sync_state']))).toBe('4bcc3447da23e33363333aa6dbf49693cf47cf4c6ed3a29386592c6e527cbc80');
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
