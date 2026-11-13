import type { DatabaseSync } from 'node:sqlite';
import { deliverableIdSchema } from '../../lib/deliverable-acceptance/contracts';
import { acceptanceOriginalMetadata } from '../../lib/db/postgres/acceptance-metadata';
/** Held source-row producer only; no original or journal mutation. */
export function sqliteAcceptanceProjection(db:DatabaseSync,rawId:string){
 const id=deliverableIdSchema.parse(rawId),seed=db.prepare('SELECT singleton,id FROM deliverable_acceptance_store LIMIT 2').all();
 if(seed.length!==1||seed[0].singleton!==1||typeof seed[0].id!=='string')throw Error('Acceptance SOURCE store unavailable');
 const columns=db.prepare('PRAGMA table_info(a2a_orders)').all().map(row=>{if(typeof row.name!=='string'||!/^[a-z][a-z0-9_]*$/.test(row.name))throw Error('Acceptance SOURCE shape refused');return '"'+row.name+'"';});
 if(!columns.length||columns.length>128)throw Error('Acceptance SOURCE shape refused');
 const bytes=columns.map(name=>`coalesce(length(CAST(${name} AS BLOB)),0)`).join('+');
 const row=db.prepare(`SELECT * FROM a2a_orders WHERE id=? AND (${bytes})<=4000000`).get(id);
 if(!row)throw Error('Acceptance SOURCE original unavailable');return acceptanceOriginalMetadata(row,seed[0].id);
}
export function heldAcceptanceProjectionSql(p:ReturnType<typeof sqliteAcceptanceProjection>){
 const q=(s:string)=>"'"+s.replaceAll("'","''")+"'",nullable=(s:string|null)=>s===null?'NULL':q(s);
 return `INSERT INTO keryx_storage.acceptance_original_projection(order_id,store_id,source_order_wire,source_order_sha256,delivery_token,owner,network,binding) VALUES(${q(p.orderId)},${q(p.storeId)},${q(p.orderWire)},${q(p.orderSha256)},${q(p.deliveryToken)},${nullable(p.owner)},${nullable(p.network)},${p.binding===null?'NULL':q(JSON.stringify(p.binding))+'::jsonb'});`;
}
