import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { privacyId } from '../../lib/run-privacy/contracts';
import { ledgerOriginalMetadata } from '../../lib/db/postgres/ledger-metadata';
/** Held SOURCE producer; it grants no publication or installed authority. */
export function sqliteLedgerProjection(db:DatabaseSync,rawId:string){
 const id=privacyId.parse(rawId),row=db.prepare(`SELECT id,created_at,
  CASE WHEN typeof(data)='text' AND length(CAST(data AS BLOB))<=4000000 THEN data END original,
  CASE WHEN typeof(data)='text' AND length(CAST(data AS BLOB))<=4000000 THEN lower(hex(CAST(data AS BLOB))) END original_hex
  FROM query_runs WHERE id=?`).get(id);
 if(!row||row.id!==id||typeof row.original!=='string'||Buffer.from(row.original).toString('hex')!==row.original_hex)throw Error('Ledger SOURCE original unavailable');
 let raw:unknown=null;try{raw=JSON.parse(row.original);}catch{}
 return Object.freeze({sha256:createHash('sha256').update(row.original).digest('hex'),...ledgerOriginalMetadata(raw,id,row.created_at)});
}
export function heldLedgerProjectionSql(rawId:string,p:ReturnType<typeof sqliteLedgerProjection>){
 const id=privacyId.parse(rawId),q=(s:string)=>"'"+s.replaceAll("'","''")+"'";if(!/^[a-f0-9]{64}$/.test(p.sha256))throw Error('Ledger SOURCE digest refused');
 return `DELETE FROM keryx_storage.public_ledger_projection WHERE run_id=${q(id)};INSERT INTO keryx_storage.public_ledger_projection(run_id,original_sha256,original_valid,snapshot_wire,reference_ids) VALUES(${q(id)},${q(p.sha256)},${p.valid},${p.snapshotWire===null?'NULL':q(p.snapshotWire)},${q(JSON.stringify(p.references))}::jsonb);`;
}
