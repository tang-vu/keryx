/** Held SOURCE producer, not installed runtime authority or a visibility grant. */
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { privacyId } from '../../lib/run-privacy/contracts';
import { usageBodyMetadata } from '../../lib/db/postgres/usage-metadata';
export function sqliteUsageProjection(db:DatabaseSync,rawId:string){
 // One fixed SELECT observes original bytes and both extracted fields together.
 // Whole-corpus intake callers additionally hold their existing transaction.
 const id=privacyId.parse(rawId);
 const row=db.prepare(`SELECT id,created_at,
  CASE WHEN typeof(data)='text' AND length(CAST(data AS BLOB))<=4000000 THEN data END original,
  CASE WHEN typeof(data)='text' AND length(CAST(data AS BLOB))<=4000000 THEN lower(hex(CAST(data AS BLOB))) END original_hex,
  CASE WHEN json_valid(data) AND json_type(data,'$.usage')='object' AND length(CAST(json_extract(data,'$.usage') AS BLOB))<=2048 THEN json_extract(data,'$.usage') END usage,
  CASE WHEN json_valid(data) AND json_type(data,'$.provenance')='object' AND length(CAST(json_extract(data,'$.provenance') AS BLOB))<=1024 THEN json_extract(data,'$.provenance') END provenance
  FROM query_runs WHERE id=?`).get(id);
 if(!row||row.id!==id||typeof row.original!=='string'||Buffer.from(row.original).toString('hex')!==row.original_hex)throw new Error('Usage SOURCE original unavailable');
 let parsed:unknown=null;try{parsed=JSON.parse(row.original);}catch{}
 return Object.freeze({sha256:createHash('sha256').update(row.original).digest('hex'),usageWire:typeof row.usage==='string'?row.usage:null,provenanceWire:typeof row.provenance==='string'?row.provenance:null,...usageBodyMetadata(parsed,id,row.created_at)});
}
export function heldUsageProjectionSql(rawId:string,p:ReturnType<typeof sqliteUsageProjection>){
 const id=privacyId.parse(rawId);if(!/^[a-f0-9]{64}$/.test(p.sha256))throw new Error('Usage SOURCE digest refused');
 const q=(s:string)=>"'"+s.replaceAll("'","''")+"'",text=(s:string|null,limit:number)=>{if(s===null)return 'NULL';if(Buffer.byteLength(s)>limit||s.includes('\0'))throw new Error('Usage SOURCE metadata refused');return q(s);};
 return `INSERT INTO keryx_storage.usage_projection(run_id,original_sha256,usage_wire,provenance_wire,parsed_usage,body_identity_valid) VALUES(${q(id)},${q(p.sha256)},${text(p.usageWire,2048)},${text(p.provenanceWire,1024)},${q(JSON.stringify(p.parsedUsage))}::jsonb,${p.bodyIdentityValid});`;
}
