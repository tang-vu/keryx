/** Pure actual Source-cell capture. No Native row, fallback, reconstruction,
 * signing, settlement or installed storage authority enters this helper. */
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { capturePaymentEventRow,PAYMENT_EVENT_FIELDS,PAYMENT_EVENT_WIRE_BYTES,type PaymentEventRow } from '../../lib/db/postgres/payment-events-packet';
export function captureObservedPaymentSource(db:DatabaseSync,id:string){
 const size=db.prepare('SELECT '+PAYMENT_EVENT_FIELDS.map(key=>`coalesce(length(CAST(${key} AS BLOB)),0)`).join('+')+' AS bytes FROM payment_events WHERE id=?').get(id);if(!size)return null;
 assert(typeof size.bytes==='number'&&Number.isSafeInteger(size.bytes)&&size.bytes<=PAYMENT_EVENT_WIRE_BYTES,'Source payment byte bound');
 const row=db.prepare('SELECT * FROM payment_events WHERE id=?').get(id);assert(row);
 assert.deepEqual(Object.keys(row).sort(),[...PAYMENT_EVENT_FIELDS].sort(),'Observe all27 actual Source payment cells');
 const observed=db.prepare('SELECT '+PAYMENT_EVENT_FIELDS.flatMap((key,i)=>[`typeof(${key}) AS kind${i}`,`lower(hex(CAST(${key} AS BLOB))) AS hex${i}`]).join(',')+' FROM payment_events WHERE id=?').get(id);assert(observed);
 for(const [i,key] of PAYMENT_EVENT_FIELDS.entries()){
  const value:unknown=row[key],kind:unknown=observed['kind'+i];
  if(value===null)assert.equal(kind,'null');
  else if(typeof value==='string'){assert.equal(kind,'text');assert.equal(Buffer.from(value).toString('hex'),observed['hex'+i],'Source payment UTF8 bytes cannot be repaired');}
  else{assert.equal(typeof value,'number');assert(Number.isFinite(value));assert(kind==='integer'||kind==='real');}
 }
 const cells=Object.fromEntries(PAYMENT_EVENT_FIELDS.map(key=>[key,row[key]])) as PaymentEventRow,packet=capturePaymentEventRow(cells);
 assert.deepEqual(packet.row,cells,'Source capture cannot normalize observed cells');return packet;
}
