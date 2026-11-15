/** Source-only metadata intake after public-cell fidelity. The actual target
 * remains held; no caller can turn these derivatives into runtime authority. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Client } from 'pg';
import { canonicalJson } from '../../lib/canonical-json';
import { readStorageIdentity } from '../../lib/db/storage-identity-sqlite';
import { validateStorageIdentity,storageIdentityDigest } from '../../lib/db/storage-identity';
import { postgresPoolConfiguration,type PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import { NATIVE_READONLY_RUNTIME_PROFILE } from '../../lib/db/postgres/runtime-profile';
import { reviewOriginalMetadata } from '../../lib/db/postgres/review-packet';
import { PAYMENT_EVENT_FIELDS,PAYMENT_EVENT_WIRE_BYTES } from '../../lib/db/postgres/payment-events-packet';
import { exportNativePostgresSchemaContract } from './native-contract.mts';
import { assertDevelopmentMaterializationContainment,NativeMaterializationUnavailable } from './materialize-native-snapshot.mts';
import { sqliteOriginalHistoryProjection } from './run-history-projection.mts';
import { sqliteOwnershipHistoryProjection } from './ownership-history-projection.mts';
import { sqlitePrivacyProjection } from './privacy-projection.mts';
import { sqliteWatchProjection } from './watch-projection.mts';
import { sqliteAcceptanceProjection } from './acceptance-projection.mts';
import { captureObservedPaymentSource } from './payment-original-source.mts';
import { hasPrivateResultIdentity,captureObservedPrivateResultSource,PRIVATE_RESULT_IDENTITY_COLUMNS,PRIVATE_RESULT_SOURCE_COLUMNS,PRIVATE_RESULT_SOURCE_BYTE_LIMITS,type PrivateResultSourceTable } from './private-result-source.mts';
import { sqliteA2aTimeProjection,sqliteA2aOriginalCellProjection } from './a2a-time-projection.mts';
const tables=['run_history_projection','run_ownership_projection','run_privacy_projection','usage_projection','public_ledger_projection','review_projection','topic_watch_projection','a2a_original_time_projection','a2a_original_cell_projection','acceptance_original_projection'] as const;
type Table=typeof tables[number]|'payment_event_originals'|'private_research_result_identity';
type Kind='json'|'json-null'|'hex';
type Field={name:string;kind?:Kind};
const field=(name:string,kind?:Kind):Field=>({name,...(kind?{kind}:{})});
const quote=(name:string)=>{assert(/^[a-z][a-z0-9_]{0,62}$/.test(name));return '"'+name+'"';};
const sha=(wire:string)=>createHash('sha256').update(wire).digest('hex');
function hasPaymentOriginals(contract:ReturnType<typeof exportNativePostgresSchemaContract>){
 const sections=contract.metadata?.sections;if(!sections||typeof sections!=='object'||Array.isArray(sections))return false;
 const relations=sections.relations;assert(Array.isArray(relations));
 const matching=relations.filter(r=>r&&typeof r==='object'&&!Array.isArray(r)&&r.schema==='keryx_storage'&&r.name==='payment_event_originals');
 assert(matching.length<=1);if(!matching.length)return false;assert.equal((matching[0] as Record<string,unknown>).kind,'r');
 const columns=sections.columns;assert(Array.isArray(columns));
 const actual=columns.filter(c=>c&&typeof c==='object'&&!Array.isArray(c)&&c.schema==='keryx_storage'&&c.relation==='payment_event_originals').map(c=>{assert(c&&typeof c==='object'&&!Array.isArray(c));return [c.name,c.type];});
 assert.deepEqual(actual.sort(),[['payment_id','text'],['identity_digest','text'],['original_wire','json'],['original_sha256','text'],['current_wire','json'],['current_sha256','text'],['native_projection','jsonb'],['unprojected_fields','text[]']].sort());return true;
}
export async function materializeNativeProjections(db:DatabaseSync,options:PostgresConnectionOptions){
 assertDevelopmentMaterializationContainment();assert(db.isTransaction&&db.prepare('PRAGMA query_only').get()?.query_only===1);assert.equal(options.role,'postgres');assert.equal(options.database,'native_materialized');assert.deepEqual(options.endpoint,{kind:'loopback',port:5432});assert(/^[a-f0-9]{48}$/.test(options.password));
 const identity=readStorageIdentity(db),pg=new Client(postgresPoolConfiguration(options));pg.on('error',()=>{});let stage='projection-entry',table:string|null=null,started=false,commit=false;
 const candidates:Table[]=[...tables,'payment_event_originals','private_research_result_identity'],counts=Object.fromEntries(candidates.map(t=>[t,0])) as Record<Table,number>,digests=new Map(candidates.map(t=>[t,createHash('sha256')]));
 let paymentEventOriginalsPresent:boolean|undefined,privateResultIdentityPresent:boolean|undefined;const identityWire=canonicalJson(identity),sourceCurrent=()=>{assert(db.isTransaction&&db.prepare('PRAGMA query_only').get()?.query_only===1);assert.equal(canonicalJson(readStorageIdentity(db)),identityWire);};
 try{
  await pg.connect();const selected=(await pg.query('SELECT identity::text wire FROM keryx_storage.identity WHERE singleton')).rows;assert.equal(selected.length,1);assert.equal(canonicalJson(validateStorageIdentity(JSON.parse(selected[0].wire))),canonicalJson(identity));
  const verify=async()=>{
   sourceCurrent();assert.equal((await pg.query("SELECT mode FROM keryx_storage.control WHERE singleton FOR SHARE")).rows[0]?.mode,'held');
   const current=(await pg.query('SELECT identity::text wire FROM keryx_storage.identity WHERE singleton FOR SHARE')).rows;assert.equal(current.length,1);assert.equal(canonicalJson(validateStorageIdentity(JSON.parse(current[0].wire))),identityWire);
   assert.equal((await pg.query('SELECT source_digest FROM keryx_storage.source_contract WHERE singleton FOR SHARE')).rows[0]?.source_digest,NATIVE_READONLY_RUNTIME_PROFILE.catalogSha256);
   const contract=exportNativePostgresSchemaContract((await pg.query('SELECT keryx_storage.catalog_contract()::text wire')).rows[0].wire);assert.equal(contract.sha256,NATIVE_READONLY_RUNTIME_PROFILE.catalogSha256);
   const present=hasPaymentOriginals(contract);if(paymentEventOriginalsPresent!==undefined)assert.equal(present,paymentEventOriginalsPresent);paymentEventOriginalsPresent=present;const privatePresent=hasPrivateResultIdentity(contract);if(privateResultIdentityPresent!==undefined)assert.equal(privatePresent,privateResultIdentityPresent);privateResultIdentityPresent=privatePresent;if(privatePresent)assert(present);sourceCurrent();
  };await verify();
  await pg.query('BEGIN');started=true;
  stage='projection-preflight';await verify();const selectedTables:Table[]=[...tables,...(paymentEventOriginalsPresent?['payment_event_originals' as const]:[]),...(privateResultIdentityPresent?['private_research_result_identity' as const]:[])];
  if(paymentEventOriginalsPresent)await pg.query(`LOCK TABLE ${selectedTables.map(name=>'keryx_storage.'+quote(name)).join(',')},public.payment_events${privateResultIdentityPresent?','+Object.keys(PRIVATE_RESULT_SOURCE_COLUMNS).map(name=>'public.'+quote(name)).join(','):''} IN SHARE ROW EXCLUSIVE MODE`);
  for(const name of selectedTables){table=name;assert.equal((await pg.query(`SELECT count(*)::text n FROM keryx_storage.${quote(name)}`)).rows[0].n,'0');}
  const insert=async(name:Table,keys:string[],columns:Field[],row:Record<string,unknown>)=>{
   table=name;stage='projection-copy';assert.deepEqual(Object.keys(row).sort(),columns.map(c=>c.name).sort());const wire=canonicalJson(row);assert(Buffer.byteLength(wire)<=8388608);
   const values=columns.map(c=>{const v=row[c.name];return c.kind==='json-null'?JSON.stringify(v):c.kind==='json'&&v!==null?JSON.stringify(v):v;});
   const expressions=columns.map((c,i)=>c.kind==='hex'?`decode($${i+1},'hex')`:c.kind==='json'||c.kind==='json-null'?`$${i+1}::jsonb`:`$${i+1}`);
   assert.equal((await pg.query(`INSERT INTO keryx_storage.${quote(name)}(${columns.map(c=>quote(c.name)).join(',')}) VALUES(${expressions.join(',')})`,values)).rowCount,1);
   // Only captured Source columns enter equality. A native/generated derivative
   // must not change the Source row shape or become an implicit input cell.
   stage='projection-re-read';const selected=await pg.query(`SELECT to_jsonb(t)::text wire,jsonb_build_array(${columns.map(c=>`t.${quote(c.name)} IS NULL`).join(',')})::text nulls FROM (SELECT ${columns.map(c=>quote(c.name)).join(',')} FROM keryx_storage.${quote(name)} WHERE ${keys.map((k,i)=>`${quote(k)}=$${i+1}`).join(' AND ')}) t`,keys.map(k=>row[k]));assert.equal(selected.rowCount,1);
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
   await insert('run_privacy_projection',['run_id'],[field('run_id'),field('original_sha256'),field('data_bytes'),field('original_valid'),field('scalar_identity_sha256'),field('scalar_cells','json'),field('answer_scalar','hex'),field('erase_wire'),field('original_fulfillment'),field('question_fields'),field('history_fields'),field('history_references','json'),field('learning_fields'),field('archive_wire'),field('erase_projection','json'),field('profile_fields'),field('payment_offline'),field('funding_offline'),field('funding_treasury')],{run_id:id,original_sha256:p.sha256,data_bytes:p.dataBytes,original_valid:p.valid,scalar_identity_sha256:storageIdentityDigest(identity),scalar_cells:p.scalarCells,answer_scalar:p.answerHex,erase_wire:p.eraseWire,original_fulfillment:p.originalFulfillment,question_fields:p.questionFields,history_fields:p.historyFields,history_references:p.historyReferences,learning_fields:p.learningFields,archive_wire:p.archiveWire,erase_projection:p.eraseProjection,profile_fields:p.publicProfile.profileFields,payment_offline:p.publicProfile.paymentOffline,funding_offline:p.publicProfile.fundingOffline,funding_treasury:p.publicProfile.fundingTreasury});
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
   assert(++orders<=10000&&typeof r.id==='string');
   const time=sqliteA2aTimeProjection(db,r.id,identity);await insert('a2a_original_time_projection',['order_id'],Object.keys(time).map(name=>field(name)),time);
   const cells=sqliteA2aOriginalCellProjection(db,r.id,identity);await insert('a2a_original_cell_projection',['order_id'],Object.keys(cells).map(name=>field(name)),cells);
   const p=sqliteAcceptanceProjection(db,r.id);await insert('acceptance_original_projection',['order_id'],[field('order_id'),field('store_id'),field('source_order_wire'),field('source_order_sha256'),field('delivery_token'),field('owner'),field('network'),field('binding','json'),field('health_meta','json')],{order_id:p.orderId,store_id:p.storeId,source_order_wire:p.orderWire,source_order_sha256:p.orderSha256,delivery_token:p.deliveryToken,owner:p.owner,network:p.network,binding:p.binding,health_meta:p.health});
  }
  let payments=0;
  if(paymentEventOriginalsPresent)for(const key of db.prepare("SELECT CASE WHEN typeof(id)='text' AND length(CAST(id AS BLOB))<=1024 THEN id END id FROM payment_events ORDER BY payment_events.id COLLATE BINARY").iterate()){
   table='payment_event_originals';stage='payment-source-capture';sourceCurrent();assert(typeof key.id==='string'&&++payments<=100000);
   const captured=captureObservedPaymentSource(db,key.id);assert(captured);
   const projectionWire=JSON.stringify({...captured.projection,settled:captured.projection.settled===1});
   const publicBytes=PAYMENT_EVENT_FIELDS.map(name=>`coalesce(octet_length(p.${quote(name)}::text),0)`).join('+');
   stage='payment-public-compare';const projected=await pg.query(`SELECT to_jsonb(expected)::text expected_projection,CASE WHEN ${publicBytes}<=${PAYMENT_EVENT_WIRE_BYTES*2} THEN to_jsonb(p)::text END actual_projection,CASE WHEN ${publicBytes}<=${PAYMENT_EVENT_WIRE_BYTES*2} THEN to_jsonb(p) IS NOT DISTINCT FROM to_jsonb(expected) ELSE false END projection_matches FROM jsonb_populate_record(NULL::public.payment_events,$2::jsonb) expected CROSS JOIN public.payment_events p WHERE p.id=$1 FOR SHARE OF p`,[key.id,projectionWire]);
   assert.equal(projected.rowCount,1);assert.equal(projected.rows[0].projection_matches,true);for(const name of ['expected_projection','actual_projection'])assert(typeof projected.rows[0][name]==='string'&&Buffer.byteLength(projected.rows[0][name])<=PAYMENT_EVENT_WIRE_BYTES*2);
   const nativeProjectionWire:string=projected.rows[0].expected_projection,expectedProjection=JSON.parse(nativeProjectionWire);assert(expectedProjection&&typeof expectedProjection==='object'&&!Array.isArray(expectedProjection));assert.deepEqual(Object.keys(expectedProjection).sort(),[...PAYMENT_EVENT_FIELDS].sort());assert.equal(canonicalJson(JSON.parse(projected.rows[0].actual_projection)),canonicalJson(expectedProjection));sourceCurrent();
   const row={payment_id:key.id,identity_digest:storageIdentityDigest(identity),original_wire:captured.rowWire,original_sha256:captured.sha256,current_wire:captured.rowWire,current_sha256:captured.sha256,native_projection:expectedProjection,unprojected_fields:[...captured.unprojectedFields]},wire=canonicalJson(row);assert(Buffer.byteLength(wire)<=8388608);
   stage='payment-original-copy';assert.equal((await pg.query('INSERT INTO keryx_storage."payment_event_originals"(payment_id,identity_digest,original_wire,original_sha256,current_wire,current_sha256,native_projection,unprojected_fields) VALUES($1,$2,$3::json,$4,$5::json,$6,$7::jsonb,$8::text[])',[row.payment_id,row.identity_digest,row.original_wire,row.original_sha256,row.current_wire,row.current_sha256,nativeProjectionWire,row.unprojected_fields])).rowCount,1);
   // Arbitrary raw JSON may contain escaped NUL. Never run to_jsonb on this
   // private row; only safe scalar ::text columns and boolean nullness escape.
   stage='payment-original-re-read';const selected=await pg.query('SELECT payment_id,identity_digest,original_wire::text original_wire,original_sha256,current_wire::text current_wire,current_sha256,native_projection::text native_projection,array_to_json(unprojected_fields)::text unprojected_fields,jsonb_build_array(payment_id IS NULL,identity_digest IS NULL,original_wire IS NULL,original_sha256 IS NULL,current_wire IS NULL,current_sha256 IS NULL,native_projection IS NULL,unprojected_fields IS NULL)::text nulls FROM keryx_storage."payment_event_originals" WHERE payment_id=$1',[key.id]);
   assert.equal(selected.rowCount,1);const actual={...selected.rows[0]};assert.deepEqual(JSON.parse(actual.nulls),Array(8).fill(false));delete actual.nulls;
   assert.equal(actual.native_projection,nativeProjectionWire);actual.native_projection=JSON.parse(actual.native_projection);actual.unprojected_fields=JSON.parse(actual.unprojected_fields);assert.equal(canonicalJson(actual),wire);assert.equal(sha(actual.original_wire),actual.original_sha256);assert.equal(sha(actual.current_wire),actual.current_sha256);sourceCurrent();
   digests.get('payment_event_originals')!.update(wire).update('\n');counts.payment_event_originals++;
  }
  let privateResults=0;
  if(privateResultIdentityPresent){
   table='private_research_result_identity';stage='private-result-public-preflight';sourceCurrent();
   for(const name of Object.keys(PRIVATE_RESULT_SOURCE_COLUMNS)){
    const sourceCount=db.prepare('SELECT count(*) n FROM '+name).get()!.n;assert(typeof sourceCount==='number'&&Number.isSafeInteger(sourceCount)&&sourceCount>=0&&sourceCount<=100000);
    assert.equal((await pg.query('SELECT count(*)::text n FROM public.'+quote(name))).rows[0].n,String(sourceCount));sourceCurrent();
   }
   for(const key of db.prepare('SELECT id FROM private_research_results ORDER BY id COLLATE BINARY').iterate()){
    table='private_research_result_identity';stage='private-result-source-capture';sourceCurrent();assert(typeof key.id==='string'&&++privateResults<=10000);
    const captured=await captureObservedPrivateResultSource(db,key.id,identity);sourceCurrent();
    stage='private-result-public-compare';
    for(const [name,columns] of Object.entries(PRIVATE_RESULT_SOURCE_COLUMNS)){
     const bytes=columns.map(c=>'octet_length('+quote(c)+'::text)').join('+'),bounded=bytes+'<='+PRIVATE_RESULT_SOURCE_BYTE_LIMITS[name as PrivateResultSourceTable];
     const native=await pg.query('SELECT '+columns.map(c=>'CASE WHEN '+bounded+' THEN '+quote(c)+'::text END AS '+quote(c)).join(',')+','+bounded+' bounded FROM public.'+quote(name)+' WHERE id=$1 FOR SHARE',[key.id]);
     assert.equal(native.rowCount,1);assert.equal(native.rows[0].bounded,true);const actual={...native.rows[0]};delete actual.bounded;
     assert(canonicalJson(actual)===canonicalJson(captured.rows[name as PrivateResultSourceTable]),'Private Source public cells changed');sourceCurrent();
    }
    await insert('private_research_result_identity',['id'],Object.keys(PRIVATE_RESULT_IDENTITY_COLUMNS).map(name=>field(name)),captured.metadata);sourceCurrent();
   }
  }
  stage='projection-final';await verify();for(const name of selectedTables)assert.equal((await pg.query(`SELECT count(*)::text n FROM keryx_storage.${quote(name)}`)).rows[0].n,String(counts[name]));
  if(paymentEventOriginalsPresent)assert.equal((await pg.query('SELECT count(*)::text n FROM public.payment_events')).rows[0].n,String(payments));
  commit=true;await pg.query('COMMIT');started=false;
  return {format:'keryx-native-source-projection-materialization-v1',passed:true,sourceDerivedProjectionsMaterialized:true,sourceLogicalIdentityPreserved:true,runs,reviews,watches,orders,paymentEventOriginalsPresent:paymentEventOriginalsPresent===true,payments,privateResultIdentityPresent:privateResultIdentityPresent===true,privateResults,domains:selectedTables.map(name=>({table:name,rows:counts[name],digest:digests.get(name)!.digest('hex')})),writerMode:'held',applicationBackendSwitched:false,completeApplicationWriterQualified:false,productionChanged:false,paymentActions:0,jobActions:0};
 }catch(error){
  if(started)try{await pg.query('ROLLBACK');}catch{}
  const safe=(k:string)=>{const value=error&&typeof error==='object'?Reflect.get(error,k):null;return typeof value==='string'&&/^[a-zA-Z0-9_]{1,128}$/.test(value)?value:null;};
  throw new NativeMaterializationUnavailable({stage,table,pgCode:safe('code'),constraint:safe('constraint'),column:safe('column'),commitOutcome:commit?'unknown':'not_attempted'});
 }finally{try{await pg.end();}catch{throw new NativeMaterializationUnavailable({stage:'projection-dispose',table:null,pgCode:null,constraint:null,commitOutcome:commit?'unknown':'not_attempted'});}}
}
