import { z } from 'zod';
import { storageIdentityDigest,type StorageIdentity } from '../storage-identity';

const text=z.string().min(1).max(256).refine(value=>!value.includes('\0')&&Buffer.from(value).toString('utf8')===value);
const time=z.string().max(64).datetime({offset:true});
const source=z.object({id:text,query_id:text,request_hash:text,created_at:time,updated_at:time,
 started_at:time.nullable(),payment_started_at:time.nullable(),result_saving_at:time.nullable()}).strict();
/** Body-less Source cells only. Preserve offset and fractional precision bytes;
 * native SQL independently binds these wires to the current row instants.
 * Capturing metadata confers no session, settlement or installed provenance. */
export function captureA2aSourceTimeCells(raw:unknown){return Object.freeze(source.parse(raw));}
export function captureA2aTimeMetadata(raw:unknown,identity:StorageIdentity){
 const row=captureA2aSourceTimeCells(raw);
 return Object.freeze({order_id:row.id,identity_digest:storageIdentityDigest(identity),query_id:row.query_id,request_hash:row.request_hash,
  created_at:row.created_at,updated_at:row.updated_at,started_at:row.started_at,payment_started_at:row.payment_started_at,result_saving_at:row.result_saving_at});
}
const jsonWire=z.string().refine(value=>{
 if(Buffer.byteLength(value)>4000000||Buffer.from(value).toString('utf8')!==value)return false;
 try{JSON.parse(value);return true;}catch{return false;}
});
/** Independent private immutable cells, captured from the actual Source row.
 * This is data for held intake, never installed writer or paid-body authority. */
export function captureA2aOriginalCellMetadata(raw:unknown,identity:StorageIdentity){
 const row=z.object({id:text,query_id:text,request_hash:text,package_data:jsonWire.nullable(),request_data:jsonWire.nullable()}).strict().parse(raw);
 return Object.freeze({order_id:row.id,identity_digest:storageIdentityDigest(identity),query_id:row.query_id,request_hash:row.request_hash,
  package_data_wire:row.package_data,request_data_wire:row.request_data});
}
