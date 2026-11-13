/** SOURCE intake/fixture producer, not a runtime writer or enrollment API. The
 * retained SQLite bytes and its current JSON projection are read independently. */
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { parseRunProvenance,RUN_SURFACES,RUN_OWNERSHIP_METHODS,type RunProvenance } from '../../lib/research/run-provenance';
export interface OriginalHistoryProjection {sha256:string;originalCreatedAt?:string|null;recordedOwner:string|null;ownerInvalid:boolean;funded:boolean;provenance:RunProvenance|null;anonymousClaimEligible?:boolean;}
export function sqliteOriginalHistoryProjection(db:DatabaseSync,id:string):OriginalHistoryProjection{
 const row=db.prepare(`SELECT id,created_at,CASE WHEN length(CAST(data AS BLOB))<=4000000 THEN data END AS original,
 json_extract(data,'$.asker') AS owner,json_type(data,'$.askerFunded') AS funded,
 CASE WHEN json_type(data,'$.provenance')='object' AND (SELECT count(*) FROM json_each(data,'$.provenance'))=3
  AND json_type(data,'$.provenance.version') IN ('integer','real') AND json_extract(data,'$.provenance.version')=1
  AND json_extract(data,'$.provenance.surface') IN (${RUN_SURFACES.map(v=>"'"+v+"'").join(',')})
  AND json_extract(data,'$.provenance.ownershipMethod') IN (${RUN_OWNERSHIP_METHODS.map(v=>"'"+v+"'").join(',')})
 THEN json_extract(data,'$.provenance') END AS provenance FROM query_runs WHERE id=?`).get(id);
 if(!row||typeof row.original!=='string'||Buffer.from(row.original).toString('utf8')!==row.original)throw new Error('SOURCE original projection unavailable');
 const validOwner=typeof row.owner==='string'&&/^0x[0-9a-f]{40}$/.test(row.owner.toLowerCase());
 const original:unknown=JSON.parse(row.original),anonymousClaimEligible=!!original&&typeof original==='object'&&!Array.isArray(original)
  &&Reflect.get(original,'id')===row.id&&Reflect.get(original,'createdAt')===row.created_at&&!Object.hasOwn(original,'asker')&&!Object.hasOwn(original,'originalFulfillment')
  &&Reflect.get(original,'askerFunded')!==true&&Reflect.get(original,'fundingOwner')!=='browser';
 return Object.freeze({sha256:createHash('sha256').update(row.original).digest('hex'),originalCreatedAt:typeof row.created_at==='string'&&Buffer.byteLength(row.created_at)<=64?row.created_at:null,recordedOwner:validOwner?(row.owner as string).toLowerCase():null,
  ownerInvalid:row.owner!==null&&!validOwner,funded:row.funded==='true',provenance:typeof row.provenance==='string'?parseRunProvenance(JSON.parse(row.provenance))??null:null,anonymousClaimEligible});
}
/** Only used inside this task's held synthetic/import SQL, never an app call. */
export function heldHistoryProjectionSql(id:string,p:OriginalHistoryProjection){
 const q=(s:string)=>"'"+s.replaceAll("'","''")+"'";
 if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id)||!/^[a-f0-9]{64}$/.test(p.sha256)||p.recordedOwner!==null&&!/^0x[0-9a-f]{40}$/.test(p.recordedOwner)
  ||typeof p.ownerInvalid!=='boolean'||typeof p.funded!=='boolean'||p.provenance!==null&&!parseRunProvenance(p.provenance))throw new Error('SOURCE projection input refused');
 if(p.anonymousClaimEligible!==undefined&&typeof p.anonymousClaimEligible!=='boolean')throw new Error('SOURCE claim projection refused');
 if(p.originalCreatedAt!==undefined&&p.originalCreatedAt!==null&&(typeof p.originalCreatedAt!=='string'||Buffer.byteLength(p.originalCreatedAt)>64||p.originalCreatedAt.includes('\0')||Buffer.from(p.originalCreatedAt).toString()!==p.originalCreatedAt))throw new Error('SOURCE original date refused');
 const claim=p.anonymousClaimEligible===undefined?'':',anonymous_claim_eligible',claimValue=p.anonymousClaimEligible===undefined?'':','+p.anonymousClaimEligible,claimUpdate=p.anonymousClaimEligible===undefined?'':',anonymous_claim_eligible=excluded.anonymous_claim_eligible';
 const date=p.originalCreatedAt===undefined||p.originalCreatedAt===null?'NULL':q(p.originalCreatedAt);
 return `INSERT INTO keryx_storage.run_history_projection(run_id,original_sha256,original_created_at,recorded_owner,owner_invalid,funded,provenance${claim}) VALUES(${q(id)},${q(p.sha256)},${date},${p.recordedOwner===null?'NULL':q(p.recordedOwner)},${p.ownerInvalid},${p.funded},${p.provenance===null?'NULL':q(JSON.stringify(p.provenance))+'::jsonb'}${claimValue}) ON CONFLICT(run_id) DO UPDATE SET original_sha256=excluded.original_sha256,original_created_at=excluded.original_created_at,recorded_owner=excluded.recorded_owner,owner_invalid=excluded.owner_invalid,funded=excluded.funded,provenance=excluded.provenance${claimUpdate};`;
}
