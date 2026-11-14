/** Source-only metadata intake after public-cell fidelity. The actual target
 * remains held; no caller can turn these derivatives into runtime authority. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Client } from 'pg';
import { canonicalJson } from '../../lib/canonical-json';
import { readStorageIdentity } from '../../lib/db/storage-identity-sqlite';
import { validateStorageIdentity } from '../../lib/db/storage-identity';
import { postgresPoolConfiguration,type PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import { NATIVE_READONLY_RUNTIME_PROFILE } from '../../lib/db/postgres/runtime-profile';
import { reviewOriginalMetadata } from '../../lib/db/postgres/review-packet';
import { exportNativePostgresSchemaContract } from './native-contract.mts';
import { assertDevelopmentMaterializationContainment,NativeMaterializationUnavailable } from './materialize-native-snapshot.mts';
import { sqliteOriginalHistoryProjection } from './run-history-projection.mts';
import { sqliteOwnershipHistoryProjection } from './ownership-history-projection.mts';
import { sqlitePrivacyProjection } from './privacy-projection.mts';
import { sqliteWatchProjection } from './watch-projection.mts';
import { sqliteAcceptanceProjection } from './acceptance-projection.mts';
const tables=['run_history_projection','run_ownership_projection','run_privacy_projection','usage_projection','public_ledger_projection','review_projection','topic_watch_projection','acceptance_original_projection'] as const;
type Table=typeof tables[number];
type Kind='json'|'json-null'|'hex';
type Field={name:string;kind?:Kind};
const field=(name:string,kind?:Kind):Field=>({name,...(kind?{kind}:{})});
const quote=(name:string)=>{assert(/^[a-z][a-z0-9_]{0,62}$/.test(name));return '"'+name+'"';};
const sha=(wire:string)=>createHash('sha256').update(wire).digest('hex');
export async function materializeNativeProjections(db:DatabaseSync,options:PostgresConnectionOptions){
 assertDevelopmentMaterializationContainment();assert(db.isTransaction&&db.prepare('PRAGMA query_only').get()?.query_only===1);assert.equal(options.role,'postgres');assert.equal(options.database,'native_materialized');assert.deepEqual(options.endpoint,{kind:'loopback',port:5432});assert(/^[a-f0-9]{48}$/.test(options.password));
 const identity=readStorageIdentity(db),pg=new Client(postgresPoolConfiguration(options));pg.on('error',()=>{});let stage='projection-entry',table:string|null=null,started=false,commit=false;
 const counts=Object.fromEntries(tables.map(t=>[t,0])) as Record<Table,number>,digests=new Map(tables.map(t=>[t,createHash('sha256')]));
 try{
  await pg.connect();const selected=(await pg.query('SELECT identity::text wire FROM keryx_storage.identity WHERE singleton')).rows;assert.equal(selected.length,1);assert.equal(canonicalJson(validateStorageIdentity(JSON.parse(selected[0].wire))),canonicalJson(identity));
  const verify=async()=>{
   assert.equal((await pg.query("SELECT mode FROM keryx_storage.control WHERE singleton")).rows[0]?.mode,'held');
   assert.equal((await pg.query('SELECT source_digest FROM keryx_storage.source_contract WHERE singleton')).rows[0]?.source_digest,NATIVE_READONLY_RUNTIME_PROFILE.catalogSha256);
   assert.equal(exportNativePostgresSchemaContract((await pg.query('SELECT keryx_storage.catalog_contract()::text wire')).rows[0].wire).sha256,NATIVE_READONLY_RUNTIME_PROFILE.catalogSha256);
  };await verify();
  for(const name of tables){table=name;assert.equal((await pg.query(`SELECT count(*)::text n FROM keryx_storage.${quote(name)}`)).rows[0].n,'0');}
  await pg.query('BEGIN');started=true;
  const insert=async(name:Table,keys:string[],columns:Field[],row:Record<string,unknown>)=>{
   table=name;stage='projection-copy';assert.deepEqual(Object.keys(row).sort(),columns.map(c=>c.name).sort());const wire=canonicalJson(row);assert(Buffer.byteLength(wire)<=8388608);
   const values=columns.map(c=>{const v=row[c.name];return c.kind==='json-null'?JSON.stringify(v):c.kind==='json'&&v!==null?JSON.stringify(v):v;});
   const expressions=columns.map((c,i)=>c.kind==='hex'?`decode($${i+1},'hex')`:c.kind==='json'||c.kind==='json-null'?`$${i+1}::jsonb`:`$${i+1}`);
   assert.equal((await pg.query(`INSERT INTO keryx_storage.${quote(name)}(${columns.map(c=>quote(c.name)).join(',')}) VALUES(${expressions.join(',')})`,values)).rowCount,1);
   stage='projection-re-read';const selected=await pg.query(`SELECT to_jsonb(t)::text wire,jsonb_build_array(${columns.map(c=>`t.${quote(c.name)} IS NULL`).join(',')})::text nulls FROM keryx_storage.${quote(name)} t WHERE ${keys.map((k,i)=>`t.${quote(k)}=$${i+1}`).join(' AND ')}`,keys.map(k=>row[k]));assert.equal(selected.rowCount,1);
   const actual=JSON.parse(selected.rows[0].wire) as Record<string,unknown>,nulls=JSON.parse(selected.rows[0].nulls);
   for(const c of columns)if(c.kind==='hex'&&actual[c.name]!==null){const hex=actual[c.name];assert(typeof hex==='string'&&/^\\x[a-f0-9]*$/.test(hex));actual[c.name]=hex.slice(2);}
   assert.deepEqual(nulls,columns.map(c=>row[c.name]===null&&c.kind!=='json-null'));assert.equal(canonicalJson(actual),wire);
   digests.get(name)!.update(wire).update('\n');counts[name]++;
  };
  const runKeys=db.prepare('SELECT id FROM query_runs ORDER BY id COLLATE BINARY');let runs=0;
  for(const key of runKeys.iterate()){
   assert(typeof key.id==='string'&&++runs<=10000);const id=key.id,h=sqliteOriginalHistoryProjection(db,id),o=sqliteOwnershipHistoryProjection(db,id),p=sqlitePrivacyProjection(db,id);
   await insert('run_history_projection',['run_id'],[field('run_id'),field('original_sha256'),field('original_created_at'),field('recorded_owner'),field('owner_invalid'),field('funded'),field('provenance','json'),field('anonymous_claim_eligible')],{run_id:id,original_sha256:h.sha256,original_created_at:h.originalCreatedAt??null,recorded_owner:h.recordedOwner,owner_invalid:h.ownerInvalid,funded:h.funded,provenance:h.provenance,anonymous_claim_eligible:h.anonymousClaimEligible??false});
   await insert('run_ownership_projection',['run_id'],[field('run_id'),field('original_sha256'),field('question_search','hex'),field('history_eligible'),field('recorded_valid'),field('claimed_valid'),field('summary','json')],{run_id:id,original_sha256:o.sha256,question_search:o.questionHex,history_eligible:o.historyEligible,recorded_valid:o.recordedValid,claimed_valid:o.claimedValid,summary:o.summary});
   await insert('run_privacy_projection',['run_id'],[field('run_id'),field('original_sha256'),field('data_bytes'),field('original_valid'),field('erase_wire'),field('original_fulfillment'),field('question_fields'),field('history_fields'),field('history_references','json'),field('learning_fields'),field('archive_wire'),field('erase_projection','json'),field('profile_fields'),field('payment_offline'),field('funding_offline'),field('funding_treasury')],{run_id:id,original_sha256:p.sha256,data_bytes:p.dataBytes,original_valid:p.valid,erase_wire:p.eraseWire,original_fulfillment:p.originalFulfillment,question_fields:p.questionFields,history_fields:p.historyFields,history_references:p.historyReferences,learning_fields:p.learningFields,archive_wire:p.archiveWire,erase_projection:p.eraseProjection,profile_fields:p.publicProfile.profileFields,payment_offline:p.publicProfile.paymentOffline,funding_offline:p.publicProfile.fundingOffline,funding_treasury:p.publicProfile.fundingTreasury});
   await insert('usage_projection',['run_id'],[field('run_id'),field('original_sha256'),field('usage_wire'),field('provenance_wire'),field('parsed_usage','json-null'),field('body_identity_valid')],{run_id:id,original_sha256:p.usage.sha256,usage_wire:p.usage.usageWire,provenance_wire:p.usage.provenanceWire,parsed_usage:p.usage.parsedUsage,body_identity_valid:p.usage.bodyIdentityValid});
   await insert('public_ledger_projection',['run_id'],[field('run_id'),field('original_sha256'),field('original_valid'),field('snapshot_wire'),field('reference_ids','json')],{run_id:id,original_sha256:p.ledger.sha256,original_valid:p.ledger.valid,snapshot_wire:p.ledger.snapshotWire,reference_ids:p.ledger.references});
  }
  let reviews=0;for(const r of db.prepare("SELECT id,run_id,network,CASE WHEN typeof(input_json)='text' AND length(CAST(input_json AS BLOB))<=8192 THEN input_json END input_json FROM decision_review_records ORDER BY id COLLATE BINARY").iterate()){
   assert(++reviews<=100000&&typeof r.id==='string'&&typeof r.input_json==='string');const metadata=reviewOriginalMetadata(r.input_json);assert.equal(metadata.runId,r.run_id);assert.equal(metadata.terms.network,r.network);
   await insert('review_projection',['id'],[field('id'),field('original_sha256'),field('metadata','json')],{id:r.id,original_sha256:sha(r.input_json),metadata});
  }
  let watches=0;for(const r of db.prepare('SELECT wallet,id FROM topic_watches ORDER BY wallet COLLATE BINARY,id COLLATE BINARY').iterate()){
   assert(++watches<=10000&&typeof r.wallet==='string'&&typeof r.id==='string');const p=sqliteWatchProjection(db,r.wallet,r.id);await insert('topic_watch_projection',['wallet','id'],[field('wallet'),field('id'),field('original_sha256'),field('metadata','json')],{wallet:p.owner,id:p.id,original_sha256:p.originalSha256,metadata:p});
  }
  let orders=0;for(const r of db.prepare('SELECT id FROM a2a_orders ORDER BY id COLLATE BINARY').iterate()){
   assert(++orders<=10000&&typeof r.id==='string');const p=sqliteAcceptanceProjection(db,r.id);await insert('acceptance_original_projection',['order_id'],[field('order_id'),field('store_id'),field('source_order_wire'),field('source_order_sha256'),field('delivery_token'),field('owner'),field('network'),field('binding','json'),field('health_meta','json')],{order_id:p.orderId,store_id:p.storeId,source_order_wire:p.orderWire,source_order_sha256:p.orderSha256,delivery_token:p.deliveryToken,owner:p.owner,network:p.network,binding:p.binding,health_meta:p.health});
  }
  stage='projection-final';await verify();for(const name of tables)assert.equal((await pg.query(`SELECT count(*)::text n FROM keryx_storage.${quote(name)}`)).rows[0].n,String(counts[name]));
  commit=true;await pg.query('COMMIT');started=false;
  return {format:'keryx-native-source-projection-materialization-v1',passed:true,sourceDerivedProjectionsMaterialized:true,sourceLogicalIdentityPreserved:true,runs,reviews,watches,orders,domains:tables.map(name=>({table:name,rows:counts[name],digest:digests.get(name)!.digest('hex')})),writerMode:'held',applicationBackendSwitched:false,completeApplicationWriterQualified:false,productionChanged:false,paymentActions:0,jobActions:0};
 }catch(error){
  if(started)try{await pg.query('ROLLBACK');}catch{}
  const safe=(k:string)=>{const value=error&&typeof error==='object'?Reflect.get(error,k):null;return typeof value==='string'&&/^[a-zA-Z0-9_]{1,128}$/.test(value)?value:null;};
  throw new NativeMaterializationUnavailable({stage,table,pgCode:safe('code'),constraint:safe('constraint'),column:safe('column'),commitOutcome:commit?'unknown':'not_attempted'});
 }finally{try{await pg.end();}catch{throw new NativeMaterializationUnavailable({stage:'projection-dispose',table:null,pgCode:null,constraint:null,commitOutcome:commit?'unknown':'not_attempted'});}}
}
