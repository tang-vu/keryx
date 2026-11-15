import assert from 'node:assert/strict';
import type {DatabaseSync} from 'node:sqlite';
import {PAYMENT_EVENT_FIELDS,type PaymentEventRow} from '../../lib/db/postgres/payment-events-packet';
import {snapshotRowWire,type SnapshotRow,type SnapshotTable,type SnapshotValue} from './typed-snapshot.mts';
import {nativeMaterializationCell,type NativeMaterializationType} from './native-materialization-codec.mts';
import {captureObservedPaymentSource} from './payment-original-source.mts';

function sourceValue(cell:SnapshotValue):string|number|null{
 if(cell[0]==='null')return null;
 if(cell[0]==='text'){
  const value=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(Buffer.from(cell[1],'hex'));
  assert.equal(Buffer.from(value).toString('hex'),cell[1]);return value;
 }
 if(cell[0]==='integer'){const value=BigInt(cell[1]);assert(value>=BigInt(-Number.MAX_SAFE_INTEGER)&&value<=BigInt(Number.MAX_SAFE_INTEGER));return Number(value);}
 assert.equal(cell[0],'real');const value=Buffer.from(cell[1],'hex').readDoubleBE();assert(Number.isFinite(value));return value;
}
/** Preserve the typed Source row independently. Only metadata fields explicitly
 * declared unprojected by the actual Source capture become relational NULLs;
 * their exact originals enter the separate immutable private intake stage. */
export function nativeMaterializationPaymentCells(db:DatabaseSync,table:SnapshotTable,row:SnapshotRow,types:readonly NativeMaterializationType[]):(string|null)[]{
 assert(db.isTransaction&&db.prepare('PRAGMA query_only').get()?.query_only===1);
 assert.equal(table.name,'payment_events');assert.deepEqual([...table.columns].sort(),[...PAYMENT_EVENT_FIELDS].sort());
 assert.equal(row.length,table.columns.length);assert.equal(types.length,row.length);snapshotRowWire(row);
 const values=Object.fromEntries(table.columns.map((name,i)=>[name,sourceValue(row[i])])) as PaymentEventRow;
 assert.equal(typeof values.id,'string');const packet=captureObservedPaymentSource(db,values.id as string);assert(packet);assert.deepEqual(packet.row,values);
 return row.map((cell,i)=>{
  const name=table.columns[i] as keyof PaymentEventRow;
  if(packet.unprojectedFields.includes(name)){assert.equal(packet.projection[name],null);return null;}
  return nativeMaterializationCell(cell,types[i]);
 });
}
