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
export function sqlitePrivacyProjection(db:DatabaseSync,id:string,includeErasure=true){
 const row=db.prepare(`SELECT q.id,q.created_at,q.asker,length(CAST(q.data AS BLOB)) data_bytes,
 CASE WHEN length(CAST(q.data AS BLOB))<=4000000 THEN q.data END original,
 CASE WHEN length(CAST(q.data AS BLOB))<=4000000 THEN lower(hex(CAST(q.data AS BLOB))) END original_hex,
 ${SQLITE_PUBLIC_QUESTION_FIELDS} question_fields,${SQLITE_PUBLIC_SOURCE_HISTORY_FIELDS} history_fields,${SQLITE_PUBLIC_LEARNING_FIELDS} learning_fields
 FROM query_runs q WHERE q.id=?`).get(id);
 if(!row||typeof row.original!=='string'||Buffer.from(row.original).toString('hex')!==row.original_hex)throw new Error('Privacy SOURCE original unavailable');
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
   prospective.exec('CREATE TABLE query_runs(id TEXT,created_at TEXT,asker TEXT,data TEXT)');
   prospective.prepare('INSERT INTO query_runs VALUES(?,?,?,?)').run(id,String(row.created_at),row.asker,eraseWire);
   eraseProjection={history:sqliteOriginalHistoryProjection(prospective,id),ownership:sqliteOwnershipHistoryProjection(prospective,id),privacy:sqlitePrivacyProjection(prospective,id,false)};
  }finally{prospective.close();}
 }
 return Object.freeze({sha256:createHash('sha256').update(row.original).digest('hex'),dataBytes:Number(row.data_bytes),valid,eraseWire,originalFulfillment,
  questionFields:typeof row.question_fields==='string'?row.question_fields:null,historyFields:history.fields,historyReferences:history.references,learningFields:typeof row.learning_fields==='string'?row.learning_fields:null,archiveWire,eraseProjection,usage:sqliteUsageProjection(db,id),ledger:sqliteLedgerProjection(db,id),publicProfile:publicProfileOriginalMetadata(JSON.parse(row.original),id,String(row.created_at))});
}
export function heldPrivacyProjectionSql(id:string,p:ReturnType<typeof sqlitePrivacyProjection>){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(id)||!/^[a-f0-9]{64}$/.test(p.sha256))throw new Error('Privacy SOURCE projection refused');
 const q=(s:string)=>"'"+s.replaceAll("'","''")+"'",text=(s:string|null)=>s===null?'NULL':q(s);
 return `INSERT INTO keryx_storage.run_privacy_projection(run_id,original_sha256,data_bytes,original_valid,erase_wire,original_fulfillment,question_fields,history_fields,history_references,learning_fields,archive_wire,erase_projection,profile_fields,payment_offline,funding_offline,funding_treasury) VALUES(${q(id)},${q(p.sha256)},${p.dataBytes},${p.valid},${text(p.eraseWire)},${p.originalFulfillment},${text(p.questionFields)},${text(p.historyFields)},${q(JSON.stringify(p.historyReferences))}::jsonb,${text(p.learningFields)},${text(p.archiveWire)},${p.eraseProjection===null?'NULL':q(JSON.stringify(p.eraseProjection))+'::jsonb'},${text(p.publicProfile.profileFields)},${p.publicProfile.paymentOffline},${p.publicProfile.fundingOffline},${p.publicProfile.fundingTreasury});`+heldUsageProjectionSql(id,p.usage)+heldLedgerProjectionSql(id,p.ledger);
}
