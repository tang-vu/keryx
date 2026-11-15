import {expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {PAYMENT_EVENT_FIELDS,type PaymentEventRow} from '../../lib/db/postgres/payment-events-packet';
import {snapshotRows,snapshotRowWire,snapshotTables,type SnapshotRow} from './typed-snapshot.mts';
import type {NativeMaterializationType} from './native-materialization-codec.mts';
import {nativeMaterializationPaymentCells} from './payment-materialization-codec.mts';

const numbers=new Set(['amount_usdc','weight','list_price_usdc']),dates=new Set(['created_at','authorization_expires_at']);
function fixture(edit:Partial<PaymentEventRow>={}){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE payment_events('+PAYMENT_EVENT_FIELDS.map(name=>'"'+name+'" '+(name==='settled'?'INTEGER':numbers.has(name)?'REAL':'TEXT')).join(',')+')');
 const data={...Object.fromEntries(PAYMENT_EVENT_FIELDS.map(name=>[name,null])),id:'synthetic-original',created_at:'2026-11-15T00:00:00.000Z',kind:'citation',amount_usdc:0.01,network:'eip155:5042',settled:0,settlement_status:'pending',...edit} as PaymentEventRow;
 db.prepare('INSERT INTO payment_events VALUES('+PAYMENT_EVENT_FIELDS.map(()=>'?').join(',')+')').run(...PAYMENT_EVENT_FIELDS.map(name=>data[name]));
 db.exec('BEGIN;PRAGMA query_only=ON');const table=snapshotTables(db).find(t=>t.name==='payment_events')!;
 const types=table.columns.map(name=>name==='settled'?'boolean':numbers.has(name)?'numeric':dates.has(name)?'timestamp with time zone':'text') as NativeMaterializationType[];
 const row=[...snapshotRows(db,table)][0];return {db,table,types,row};
}
it('projects only declared unsafe metadata and clocks while leaving actual typed Source bytes unchanged',()=>{
 const f=fixture({source_name:'raw\0name',created_at:'2026-11-15T07:00:00.000+07:00',rationale:'null',item_title:'\ufefftitle'});
 try{
  const before=snapshotRowWire(f.row),cells=nativeMaterializationPaymentCells(f.db,f.table,f.row,f.types),at=(name:string)=>cells[f.table.columns.indexOf(name)];
  expect(at('source_name')).toBeNull();expect(at('created_at')).toBeNull();expect(at('rationale')).toBe('null');expect(at('item_title')).toBe('\ufefftitle');expect(at('settled')).toBe('false');expect(at('amount_usdc')).toBe('0.01');
  expect(snapshotRowWire(f.row)).toBe(before);expect(f.db.prepare('SELECT source_name,created_at FROM payment_events').get()).toEqual({source_name:'raw\0name',created_at:'2026-11-15T07:00:00.000+07:00'});
 }finally{f.db.close();}
});
it('refuses a staged row that no longer matches the independently read pinned Source',()=>{
 const f=fixture({source_name:'original'});
 try{
  const row=f.row.map((cell,i)=>f.table.columns[i]==='source_name'?['text',Buffer.from('changed').toString('hex')]:cell) as SnapshotRow;
  expect(()=>nativeMaterializationPaymentCells(f.db,f.table,row,f.types)).toThrow();
  expect(f.db.prepare('SELECT source_name FROM payment_events').get()!.source_name).toBe('original');
 }finally{f.db.close();}
});
it('refuses unsupported BLOB cells and a missing immutable Source transaction pin',()=>{
 const f=fixture();
 try{
  const bad=f.row.map((cell,i)=>f.table.columns[i]==='source_name'?['blob','ff']:cell) as SnapshotRow;
  expect(()=>nativeMaterializationPaymentCells(f.db,f.table,bad,f.types)).toThrow();
  f.db.exec('ROLLBACK');expect(()=>nativeMaterializationPaymentCells(f.db,f.table,f.row,f.types)).toThrow();
 }finally{f.db.close();}
});
