import type { DatabaseSync } from 'node:sqlite';
import type { StorageIdentity } from '../../lib/db/storage-identity';
import { captureA2aTimeMetadata } from '../../lib/db/postgres/a2a-time-metadata';
/** Independent held SOURCE intake. This SELECT never hydrates paid bodies or
 * relies on the disposable acceptance projection to retain creation history. */
export function sqliteA2aTimeProjection(db:DatabaseSync,id:string,identity:StorageIdentity){
 if(typeof id!=='string'||id.length<1||id.length>256)throw Error('A2A SOURCE time identity refused');
 return captureA2aTimeMetadata(db.prepare('SELECT id,query_id,request_hash,created_at,updated_at,started_at,payment_started_at,result_saving_at FROM a2a_orders WHERE id=?').get(id),identity);
}
export function heldA2aTimeProjectionSql(row:ReturnType<typeof captureA2aTimeMetadata>){
 const q=(value:string)=>"'"+value.replaceAll("'","''")+"'";
 const keys=Object.keys(row) as (keyof typeof row)[];
 return `INSERT INTO keryx_storage.a2a_original_time_projection(${keys.join(',')}) VALUES(${keys.map(key=>row[key]===null?'NULL':q(row[key]!)).join(',')});`;
}
