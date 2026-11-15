/** Held SOURCE producer. These private derivatives grant no public visibility. */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { erasedRun,validatePrivacyRun } from '../../lib/run-privacy/contracts';
import { SQLITE_PUBLIC_QUESTION_FIELDS } from '../../lib/db/public-question-projection';
import { SQLITE_PUBLIC_SOURCE_HISTORY_FIELDS } from '../../lib/db/public-source-history-projection';
import { SQLITE_PUBLIC_LEARNING_FIELDS } from '../../lib/db/public-source-learning-projection';
import { sqliteOriginalHistoryProjection } from './run-history-projection.mts';
import { sqliteOwnershipHistoryProjection } from './ownership-history-projection.mts';
import { archiveEntryFromRun } from '../../lib/answers-archive';
import { slimPrivacyHistoryFields } from '../../lib/db/postgres/privacy-metadata';
import { sqliteUsageProjection,heldUsageProjectionSql } from './usage-projection.mts';
import { sqliteLedgerProjection,heldLedgerProjectionSql } from './ledger-projection.mts';
import { publicProfileOriginalMetadata } from '../../lib/db/postgres/public-profile-metadata';
import { publicationScalarText,publicationSqliteJsonTextHex,type PublicationScalarCell } from '../../lib/db/postgres/publication-scalar-text';
function observedScalarProjection(row:Record<string,unknown>){
 if(typeof row.original!=='string'||Buffer.from(row.original).toString('hex')!==row.original_hex)throw Error('Source original scalar snapshot unavailable');
 // Held intake retains the observed scalar columns separately. A mismatch
 // between a retained original and a column is never recomputed away.
 const parsedOriginal:unknown=JSON.parse(row.original as string),raw=parsedOriginal&&typeof parsedOriginal==='object'&&!Array.isArray(parsedOriginal)?parsedOriginal as Record<string,unknown>:{};
 const scalarCells=Object.fromEntries(['id','created_at','question','engine','parent_id','asker','origin','mcp_client','payment_mode','confidence_level'].map(key=>{
  const rootKey=({created_at:'createdAt',parent_id:'parentId',mcp_client:'mcpClient',payment_mode:'paymentMode'} as Record<string,string>)[key]??key;
  const value=key==='confidence_level'?(raw.confidence&&typeof raw.confidence==='object'&&!Array.isArray(raw.confidence)?Reflect.get(raw.confidence,'level'):undefined):raw[rootKey];
  const rawKind:PublicationScalarCell['rawKind']=value===undefined?'missing':value===null?'null':Array.isArray(value)?'array':typeof value as PublicationScalarCell['rawKind'];
  const observed=row[key];if(observed!==null&&typeof observed!=='string')throw Error('Source observed scalar unavailable');
  const bound=observed===null?null:publicationScalarText(observed);
  return [key,{rawKind,boundHex:bound?.sourceHex??null,...(key==='asker'&&(typeof value==='string'?publicationSqliteJsonTextHex(value):null)!==(bound?.sourceHex??null)?{rawHex:typeof value==='string'?publicationSqliteJsonTextHex(value):null}:{})}];
 }));
 if(row.answer!==null&&typeof row.answer!=='string')throw Error('Source observed answer scalar unavailable');
 const answerHex=row.answer===null?null:publicationScalarText(row.answer).sourceHex;
 const answer=row.answer===null?null:publicationScalarText(row.answer as string);
 const shadows=Object.fromEntries(Object.keys(scalarCells).map(key=>{const value=row[key] as string|null,scalar=value===null?null:publicationScalarText(value);return [key,scalar===null?null:scalar.postgres.kind==='text'?scalar.postgres.value:scalar.sourceJsonWire];}));
 return Object.freeze({sha256:createHash('sha256').update(row.original).digest('hex'),dataBytes:Buffer.byteLength(row.original),scalarCells,shadows,answerHex,
  answerShadow:answer===null?null:answer.postgres.kind==='text'?answer.postgres.value:answer.sourceJsonWire});
}
/** Held SOURCE-only scalar census, including partial legacy JSON and observed
 * original/column mismatches. No original is repaired or inferred here. */
export function sqlitePublicationScalarProjection(db:DatabaseSync,id:string){
 const row=db.prepare(`SELECT q.*,CASE WHEN typeof(data)='text' AND length(CAST(data AS BLOB))<=4000000 THEN data END original,
  CASE WHEN typeof(data)='text' AND length(CAST(data AS BLOB))<=4000000 THEN lower(hex(CAST(data AS BLOB))) END original_hex FROM query_runs q WHERE id=?`).get(id);
 if(!row)throw Error('Source scalar row unavailable');return observedScalarProjection(row);
}
/** Minimal metadata sidecar for legacy history fixtures/intake. Full valid run
 * intake uses heldPrivacyProjectionSql, which installs all private derivatives.
 * Identity comes from the genuine selected SQL identity, never caller metadata. */
export function heldPublicationScalarProjectionSql(id:string,p:ReturnType<typeof sqlitePublicationScalarProjection>){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(id)||!/^[a-f0-9]{64}$/.test(p.sha256))throw Error('Source scalar projection refused');
 const q=(s:string)=>"'"+s.replaceAll("'","''")+"'";
 return `INSERT INTO keryx_storage.run_privacy_projection(run_id,original_sha256,data_bytes,original_valid,scalar_identity_sha256,scalar_cells,answer_scalar,original_fulfillment,history_references) VALUES(${q(id)},${q(p.sha256)},${p.dataBytes},false,(SELECT identity_digest FROM keryx_storage.identity WHERE singleton),${q(JSON.stringify(p.scalarCells))}::jsonb,${p.answerHex===null?'NULL':`decode(${q(p.answerHex)},'hex')`},false,'[]'::jsonb) ON CONFLICT(run_id) DO UPDATE SET original_sha256=excluded.original_sha256,data_bytes=excluded.data_bytes,scalar_identity_sha256=excluded.scalar_identity_sha256,scalar_cells=excluded.scalar_cells,answer_scalar=excluded.answer_scalar;`;
}
export function sqlitePrivacyProjection(db:DatabaseSync,id:string,includeErasure=true){
 const row=db.prepare(`SELECT q.*,length(CAST(q.data AS BLOB)) data_bytes,
 CASE WHEN length(CAST(q.data AS BLOB))<=4000000 THEN q.data END original,
 CASE WHEN length(CAST(q.data AS BLOB))<=4000000 THEN lower(hex(CAST(q.data AS BLOB))) END original_hex,
 ${SQLITE_PUBLIC_QUESTION_FIELDS} question_fields,${SQLITE_PUBLIC_SOURCE_HISTORY_FIELDS} history_fields,${SQLITE_PUBLIC_LEARNING_FIELDS} learning_fields
 FROM query_runs q WHERE q.id=?`).get(id);
 if(!row||typeof row.original!=='string'||Buffer.from(row.original).toString('hex')!==row.original_hex)throw new Error('Privacy SOURCE original unavailable');
 const {scalarCells,answerHex}=observedScalarProjection(row);
 let valid=false,eraseWire:string|null=null,archiveWire:string|null=null,originalFulfillment=false;
 try{const run=validatePrivacyRun(JSON.parse(row.original),id);valid=true;originalFulfillment=!!run.originalFulfillment;eraseWire=JSON.stringify(erasedRun(run));
  if(run.createdAt===row.created_at)try{archiveWire=JSON.stringify(archiveEntryFromRun(run));}catch{}
 }catch{}
 const history=slimPrivacyHistoryFields(row.history_fields);
 // Prospective erased packet only. This private SOURCE calculation neither
 // rewrites nor enrolls the retained input; runtime publication uses a separate
 // pure Node packet producer and never opens SQLite after backend selection.
 let eraseProjection:unknown=null;
 if(includeErasure&&eraseWire!==null){
  const prospective=new DatabaseSync(':memory:');try{
   const columns=['id','created_at','question','engine','parent_id','asker','origin','mcp_client','payment_mode','confidence_level','answer','data'];
   prospective.exec('CREATE TABLE query_runs('+columns.map(key=>key+' TEXT').join(',')+')');
   prospective.prepare('INSERT INTO query_runs VALUES('+columns.map(()=>'?').join(',')+')').run(...columns.map(key=>key==='data'?eraseWire:key==='question'||key==='answer'?'':row[key]));
   const {questionHex,...ownership}=sqliteOwnershipHistoryProjection(prospective,id),child=sqlitePrivacyProjection(prospective,id,false),{answerHex,...privacy}=child,{question,...scalarCells}=privacy.scalarCells;void questionHex;void answerHex;void question;eraseProjection={history:sqliteOriginalHistoryProjection(prospective,id),ownership,privacy:{...privacy,scalarCells}};
  }finally{prospective.close();}
 }
 return Object.freeze({sha256:createHash('sha256').update(row.original).digest('hex'),dataBytes:Number(row.data_bytes),valid,eraseWire,originalFulfillment,
  scalarCells,answerHex,questionFields:typeof row.question_fields==='string'?row.question_fields:null,historyFields:history.fields,historyReferences:history.references,learningFields:typeof row.learning_fields==='string'?row.learning_fields:null,archiveWire,eraseProjection,usage:sqliteUsageProjection(db,id),ledger:sqliteLedgerProjection(db,id),publicProfile:publicProfileOriginalMetadata(JSON.parse(row.original),id,String(row.created_at))});
}
export function heldPrivacyProjectionSql(id:string,p:ReturnType<typeof sqlitePrivacyProjection>){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(id)||!/^[a-f0-9]{64}$/.test(p.sha256))throw new Error('Privacy SOURCE projection refused');
 const q=(s:string)=>"'"+s.replaceAll("'","''")+"'",text=(s:string|null)=>s===null?'NULL':q(s);
 return `INSERT INTO keryx_storage.run_privacy_projection(run_id,original_sha256,data_bytes,original_valid,scalar_identity_sha256,scalar_cells,answer_scalar,erase_wire,original_fulfillment,question_fields,history_fields,history_references,learning_fields,archive_wire,erase_projection,profile_fields,payment_offline,funding_offline,funding_treasury) VALUES(${q(id)},${q(p.sha256)},${p.dataBytes},${p.valid},(SELECT identity_digest FROM keryx_storage.identity WHERE singleton),${q(JSON.stringify(p.scalarCells))}::jsonb,${p.answerHex===null?'NULL':`decode(${q(p.answerHex)},'hex')`},${text(p.eraseWire)},${p.originalFulfillment},${text(p.questionFields)},${text(p.historyFields)},${q(JSON.stringify(p.historyReferences))}::jsonb,${text(p.learningFields)},${text(p.archiveWire)},${p.eraseProjection===null?'NULL':q(JSON.stringify(p.eraseProjection))+'::jsonb'},${text(p.publicProfile.profileFields)},${p.publicProfile.paymentOffline},${p.publicProfile.fundingOffline},${p.publicProfile.fundingTreasury});`+heldUsageProjectionSql(id,p.usage)+heldLedgerProjectionSql(id,p.ledger);
}
