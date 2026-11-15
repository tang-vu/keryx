import { DatabaseSync } from 'node:sqlite';
import { expect,it } from 'vitest';
import { ARC_MAINNET_PROFILE } from '../../arc-network-profile';
import { retainedRecoveryMatches } from '../../a2a/overdue-escalation-queue';
import { syntheticA2aOriginal } from '../a2a-original-fixture';
import { STORAGE_MAINNET_PROFILE_DIGEST,storageIdentityDigest,type StorageIdentity } from '../storage-identity';
import { captureA2aTimeMetadata,captureA2aOriginalCellMetadata } from './a2a-time-metadata';
import { sqliteA2aTimeProjection,heldA2aTimeProjectionSql,sqliteA2aOriginalCellProjection,heldA2aOriginalCellProjectionSql } from '../../../scripts/postgres/a2a-time-projection.mjs';

const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',deploymentId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',storageId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',network:'eip155:5042',authorityMode:'mainnet-real',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,enrollmentId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',enrolledAt:'2026-10-01T00:00:00.000Z',provenanceDigest:'dd'.repeat(32)};
const row=()=>({id:'a2a_'+'aa'.repeat(32),query_id:'a2a_'+'aa'.repeat(32),request_hash:'ab'.repeat(32),
 created_at:'2026-11-14T07:00:00+07:00',updated_at:'2026-11-14T00:00:00.123456789+00:00',started_at:'2026-11-14T07:00:00.1234+07:00',
 payment_started_at:'2026-11-14T00:00:00.12345Z',result_saving_at:null});

it('retains exact offset and finer-than-millisecond Source time bytes with the complete storage identity digest',()=>{
 const input=row(),captured=captureA2aTimeMetadata(input,identity);input.created_at='changed';
 expect(captured).toEqual({order_id:row().id,identity_digest:storageIdentityDigest(identity),query_id:row().query_id,request_hash:row().request_hash,
  created_at:row().created_at,updated_at:row().updated_at,started_at:row().started_at,payment_started_at:row().payment_started_at,result_saving_at:null});
 expect(Object.isFrozen(captured)).toBe(true);
 for(const changed of [{...row(),created_at:'2026-02-30T00:00:00Z'},{...row(),started_at:'2026-11-14T00:00:00\0Z'},{...row(),response_data:'paid body'}])expect(()=>captureA2aTimeMetadata(changed,identity)).toThrow();
});
it('reads actual SQLite selected metadata without evaluating a paid body expression',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.function('paid_body_trap',()=>{throw Error('paid body hydrated');});
  const source=row(),q=(s:string)=>"'"+s.replaceAll("'","''")+"'";
  db.exec('CREATE VIEW a2a_orders AS SELECT '+Object.entries(source).map(([key,value])=>(value===null?'NULL':q(value))+' AS '+key).join(',')+',paid_body_trap() AS response_data');
  const captured=sqliteA2aTimeProjection(db,source.id,identity);
  expect(captured.started_at).toBe(source.started_at);expect(Object.keys(captured)).toHaveLength(9);
  expect(heldA2aTimeProjectionSql(captured)).not.toMatch(/response_data|request_data|package_data|resolution_data/);
  expect(()=>db.prepare('SELECT * FROM a2a_orders').get()).toThrow('paid body hydrated');
 }finally{db.close();}
});
it('keeps the existing recovery predicate false for retained sub-millisecond Source clocks',()=>{
 const source=row(),captured=captureA2aTimeMetadata(source,identity),original={...syntheticA2aOriginal(1871,ARC_MAINNET_PROFILE).order,
  createdAt:captured.created_at,updatedAt:captured.updated_at,startedAt:captured.started_at,workerId:'synthetic-worker'};
 const retained={workerId:original.workerId,status:'recovery_pending',orderId:original.id,updatedAt:'2026-11-14T00:00:01.000Z'};
 expect(retainedRecoveryMatches(original,retained,{network:identity.network,payee:original.payee},Date.parse('2026-11-14T00:00:02.000Z'))).toBe(false);
});
it('captures immutable Source JSON cell bytes separately without hydrating a result or receipt',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.function('paid_body_trap',()=>{throw Error('paid body hydrated');});
  const input={id:row().id,query_id:row().query_id,request_hash:row().request_hash,package_data:'{ "z":2, "a":1 }',request_data:'{"extension":"\\u0000\\ud800","question":"retained"}'},q=(s:string)=>"'"+s.replaceAll("'","''")+"'";
  db.exec('CREATE VIEW a2a_orders AS SELECT '+Object.entries(input).map(([key,value])=>q(value)+' AS '+key).join(',')+',paid_body_trap() AS response_data,paid_body_trap() AS resolution_data');
  const captured=sqliteA2aOriginalCellProjection(db,input.id,identity);
  expect(captured).toMatchObject({package_data_wire:input.package_data,request_data_wire:input.request_data,identity_digest:storageIdentityDigest(identity)});
  expect(Object.keys(captured)).toHaveLength(6);expect(Object.isFrozen(captured)).toBe(true);
  expect(heldA2aOriginalCellProjectionSql(captured)).not.toMatch(/response_data|resolution_data/);
  for(const patch of [{request_data:'malformed'},{package_data:'{"raw":"\ud800"}'},{response_data:'paid body'}])expect(()=>captureA2aOriginalCellMetadata({...input,...patch},identity)).toThrow();
  expect(()=>db.prepare('SELECT * FROM a2a_orders').get()).toThrow('paid body hydrated');
 }finally{db.close();}
});
