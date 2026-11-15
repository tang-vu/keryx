/** Source-only metadata intake after public-cell fidelity. The actual target
 * remains held; no caller can turn these derivatives into runtime authority. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Client,type QueryResult } from 'pg';
import { canonicalJson } from '../../lib/canonical-json';
import { readStorageIdentity } from '../../lib/db/storage-identity-sqlite';
import { validateStorageIdentity,storageIdentityDigest } from '../../lib/db/storage-identity';
import { postgresPoolConfiguration,type PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import { nativeMaterializationProfile,type NativeMaterializationProfileMode } from '../../lib/db/postgres/runtime-profile';
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
export const NATIVE_PROJECTION_SOURCE_DOMAINS=Object.freeze([...tables,'payment_event_source_observation','private_research_result_identity'] as const);
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
/** Fixed Source-only capture shared by fresh intake and sealed catchup input.
 * No target, receipt, native projection or application authority is returned. */
export type NativeProjectionSelector = Readonly<{family:'run'|'review'|'a2a'|'payment'|'private-result';id:string}>|Readonly<{family:'watch';wallet:string;id:string}>;
export type NativeProjectionRow = Readonly<{table:Table;keys:string[];columns:Field[];row:Record<string,unknown>}>;
export async function captureNativeProjectionSource(db:DatabaseSync,selector:NativeProjectionSelector){
 assert(db.isTransaction&&db.prepare('PRAGMA query_only').get()?.query_only===1);
 const identity=readStorageIdentity(db),pinned=canonicalJson(identity),current=()=>{assert(db.isTransaction&&db.prepare('PRAGMA query_only').get()?.query_only===1);assert.equal(canonicalJson(readStorageIdentity(db)),pinned);};
 const rows:NativeProjectionRow[]=[],add=(table:Table,keys:string[],columns:Field[],row:Record<string,unknown>)=>{assert.deepEqual(Object.keys(row).sort(),columns.map(c=>c.name).sort());assert(Buffer.byteLength(canonicalJson(row))<=8388608);rows.push({table,keys,columns,row});};
 let payment:ReturnType<typeof captureObservedPaymentSource>|null=null,privateResult:Awaited<ReturnType<typeof captureObservedPrivateResultSource>>|null=null;
 switch(selector.family){
 case 'run':{const id=selector.id,h=sqliteOriginalHistoryProjection(db,id),o=sqliteOwnershipHistoryProjection(db,id),p=sqlitePrivacyProjection(db,id);
   add('run_history_projection',['run_id'],[field('run_id'),field('original_sha256'),field('original_created_at'),field('recorded_owner'),field('owner_invalid'),field('funded'),field('provenance','json'),field('anonymous_claim_eligible')],{run_id:id,original_sha256:h.sha256,original_created_at:h.originalCreatedAt??null,recorded_owner:h.recordedOwner,owner_invalid:h.ownerInvalid,funded:h.funded,provenance:h.provenance,anonymous_claim_eligible:h.anonymousClaimEligible??false});
   add('run_ownership_projection',['run_id'],[field('run_id'),field('original_sha256'),field('question_search','hex'),field('history_eligible'),field('recorded_valid'),field('claimed_valid'),field('summary','json')],{run_id:id,original_sha256:o.sha256,question_search:o.questionHex,history_eligible:o.historyEligible,recorded_valid:o.recordedValid,claimed_valid:o.claimedValid,summary:o.summary});
   add('run_privacy_projection',['run_id'],[field('run_id'),field('original_sha256'),field('data_bytes'),field('original_valid'),field('scalar_identity_sha256'),field('scalar_cells','json'),field('answer_scalar','hex'),field('erase_wire'),field('original_fulfillment'),field('question_fields'),field('history_fields'),field('history_references','json'),field('learning_fields'),field('archive_wire'),field('erase_projection','json'),field('profile_fields'),field('payment_offline'),field('funding_offline'),field('funding_treasury')],{run_id:id,original_sha256:p.sha256,data_bytes:p.dataBytes,original_valid:p.valid,scalar_identity_sha256:storageIdentityDigest(identity),scalar_cells:p.scalarCells,answer_scalar:p.answerHex,erase_wire:p.eraseWire,original_fulfillment:p.originalFulfillment,question_fields:p.questionFields,history_fields:p.historyFields,history_references:p.historyReferences,learning_fields:p.learningFields,archive_wire:p.archiveWire,erase_projection:p.eraseProjection,profile_fields:p.publicProfile.profileFields,payment_offline:p.publicProfile.paymentOffline,funding_offline:p.publicProfile.fundingOffline,funding_treasury:p.publicProfile.fundingTreasury});
   add('usage_projection',['run_id'],[field('run_id'),field('original_sha256'),field('usage_wire'),field('provenance_wire'),field('parsed_usage','json-null'),field('body_identity_valid')],{run_id:id,original_sha256:p.usage.sha256,usage_wire:p.usage.usageWire,provenance_wire:p.usage.provenanceWire,parsed_usage:p.usage.parsedUsage,body_identity_valid:p.usage.bodyIdentityValid});
   add('public_ledger_projection',['run_id'],[field('run_id'),field('original_sha256'),field('original_valid'),field('snapshot_wire'),field('reference_ids','json')],{run_id:id,original_sha256:p.ledger.sha256,original_valid:p.ledger.valid,snapshot_wire:p.ledger.snapshotWire,reference_ids:p.ledger.references});
 break;}
 case 'review':{
 const r=db.prepare("SELECT id,run_id,network,CASE WHEN typeof(input_json)='text' AND length(CAST(input_json AS BLOB))<=8192 THEN input_json END input_json FROM decision_review_records WHERE id=?").get(selector.id);assert(r&&typeof r.id==='string'&&typeof r.input_json==='string');const metadata=reviewOriginalMetadata(r.input_json);assert.equal(metadata.runId,r.run_id);assert.equal(metadata.terms.network,r.network);
   add('review_projection',['id'],[field('id'),field('original_sha256'),field('metadata','json')],{id:r.id,original_sha256:sha(r.input_json),metadata});
 break;}
 case 'watch':{const r=selector;const p=sqliteWatchProjection(db,r.wallet,r.id);add('topic_watch_projection',['wallet','id'],[field('wallet'),field('id'),field('original_sha256'),field('metadata','json')],{wallet:p.owner,id:p.id,original_sha256:p.originalSha256,metadata:p});
 break;}
 case 'a2a':{const r=selector;
   const time=sqliteA2aTimeProjection(db,r.id,identity);add('a2a_original_time_projection',['order_id'],Object.keys(time).map(name=>field(name)),time);
   const cells=sqliteA2aOriginalCellProjection(db,r.id,identity);add('a2a_original_cell_projection',['order_id'],Object.keys(cells).map(name=>field(name)),cells);
   const p=sqliteAcceptanceProjection(db,r.id);add('acceptance_original_projection',['order_id'],[field('order_id'),field('store_id'),field('source_order_wire'),field('source_order_sha256'),field('delivery_token'),field('owner'),field('network'),field('binding','json'),field('health_meta','json')],{order_id:p.orderId,store_id:p.storeId,source_order_wire:p.orderWire,source_order_sha256:p.orderSha256,delivery_token:p.deliveryToken,owner:p.owner,network:p.network,binding:p.binding,health_meta:p.health});
 break;}
 case 'payment':payment=captureObservedPaymentSource(db,selector.id);assert(payment);break;
 case 'private-result':privateResult=await captureObservedPrivateResultSource(db,selector.id,identity);break;
 default:assert.fail('Unknown fixed Source capture');
 }
 current();return {selector,rows,payment,privateResult};
}
/** Closed operational tuple shapes. No caller SQL or arbitrary column/key tuple.
 * These helpers use the operator's PG handle, not an application capability. */
const projectionLayouts:Record<Exclude<Table,'payment_event_originals'>,{keys:string[];columns:Field[]}>= {
 run_history_projection:{keys:['run_id'],columns:[field('run_id'),field('original_sha256'),field('original_created_at'),field('recorded_owner'),field('owner_invalid'),field('funded'),field('provenance','json'),field('anonymous_claim_eligible')]},
 run_ownership_projection:{keys:['run_id'],columns:[field('run_id'),field('original_sha256'),field('question_search','hex'),field('history_eligible'),field('recorded_valid'),field('claimed_valid'),field('summary','json')]},
 run_privacy_projection:{keys:['run_id'],columns:[field('run_id'),field('original_sha256'),field('data_bytes'),field('original_valid'),field('scalar_identity_sha256'),field('scalar_cells','json'),field('answer_scalar','hex'),field('erase_wire'),field('original_fulfillment'),field('question_fields'),field('history_fields'),field('history_references','json'),field('learning_fields'),field('archive_wire'),field('erase_projection','json'),field('profile_fields'),field('payment_offline'),field('funding_offline'),field('funding_treasury')]},
 usage_projection:{keys:['run_id'],columns:[field('run_id'),field('original_sha256'),field('usage_wire'),field('provenance_wire'),field('parsed_usage','json-null'),field('body_identity_valid')]},
 public_ledger_projection:{keys:['run_id'],columns:[field('run_id'),field('original_sha256'),field('original_valid'),field('snapshot_wire'),field('reference_ids','json')]},
 review_projection:{keys:['id'],columns:[field('id'),field('original_sha256'),field('metadata','json')]},
 topic_watch_projection:{keys:['wallet','id'],columns:[field('wallet'),field('id'),field('original_sha256'),field('metadata','json')]},
 acceptance_original_projection:{keys:['order_id'],columns:[field('order_id'),field('store_id'),field('source_order_wire'),field('source_order_sha256'),field('delivery_token'),field('owner'),field('network'),field('binding','json'),field('health_meta','json')]},
 a2a_original_time_projection:{keys:['order_id'],columns:['order_id', 'identity_digest', 'query_id', 'request_hash', 'created_at', 'updated_at', 'started_at', 'payment_started_at', 'result_saving_at'].map(name=>field(name))},
 a2a_original_cell_projection:{keys:['order_id'],columns:['order_id', 'identity_digest', 'query_id', 'request_hash', 'package_data_wire', 'request_data_wire'].map(name=>field(name))},
 private_research_result_identity:{keys:['id'],columns:Object.keys(PRIVATE_RESULT_IDENTITY_COLUMNS).map(name=>field(name))},
};
export function checkedNativeProjectionRow(packet:NativeProjectionRow){
 assert(packet&&Object.hasOwn(projectionLayouts,packet.table));const layout=projectionLayouts[packet.table as keyof typeof projectionLayouts];
 assert.deepEqual(packet.keys,layout.keys);assert.deepEqual(packet.columns,layout.columns);assert.deepEqual(Object.keys(packet.row).sort(),layout.columns.map(c=>c.name).sort());
 const wire=canonicalJson(packet.row);assert(Buffer.byteLength(wire)<=8388608);return {table:packet.table,keys:layout.keys,columns:layout.columns,row:packet.row,wire};
}
export async function insertNativeSourceProjection(pg:Client,packet:NativeProjectionRow){
 const {table:name,columns,row,wire}=checkedNativeProjectionRow(packet);
 const values=columns.map(c=>{const v=row[c.name];return c.kind==='json-null'?JSON.stringify(v):c.kind==='json'&&v!==null?JSON.stringify(v):v;});
 const expressions=columns.map((c,i)=>c.kind==='hex'?`decode($${i+1},'hex')`:c.kind==='json'||c.kind==='json-null'?`$${i+1}::jsonb`:`$${i+1}`);
 assert.equal((await pg.query(`INSERT INTO keryx_storage.${quote(name)}(${columns.map(c=>quote(c.name)).join(',')}) VALUES(${expressions.join(',')})`,values)).rowCount,1);return wire;
}
export async function compareNativeSourceProjection(pg:Client,packet:NativeProjectionRow){
 const {table:name,keys,columns,row,wire}=checkedNativeProjectionRow(packet);
 // Captured Source columns only: a native/generated derivative is not input.
 const selected=await pg.query(`SELECT to_jsonb(t)::text wire,jsonb_build_array(${columns.map(c=>`t.${quote(c.name)} IS NULL`).join(',')})::text nulls FROM (SELECT ${columns.map(c=>quote(c.name)).join(',')} FROM keryx_storage.${quote(name)} WHERE ${keys.map((k,i)=>`${quote(k)}=$${i+1}`).join(' AND ')}) t`,keys.map(k=>row[k]));assert.equal(selected.rowCount,1);
 const actual=JSON.parse(selected.rows[0].wire) as Record<string,unknown>,nulls=JSON.parse(selected.rows[0].nulls);
 for(const c of columns)if(c.kind==='hex'&&actual[c.name]!==null){const hex=actual[c.name];assert(typeof hex==='string'&&/^\\x[a-f0-9]*$/.test(hex));actual[c.name]=hex.slice(2);}
 assert.deepEqual(nulls,columns.map(c=>row[c.name]===null&&c.kind!=='json-null'));assert.equal(canonicalJson(actual),wire);return wire;
}
export async function deriveNativePaymentSourceProjection(pg:Client,id:string,captured:NonNullable<ReturnType<typeof captureObservedPaymentSource>>){
 const projectionWire=JSON.stringify({...captured.projection,settled:captured.projection.settled===1});
 const publicBytes=PAYMENT_EVENT_FIELDS.map(name=>`coalesce(octet_length(p.${quote(name)}::text),0)`).join('+');
 const projected=await pg.query(`SELECT to_jsonb(expected)::text expected_projection,CASE WHEN ${publicBytes}<=${PAYMENT_EVENT_WIRE_BYTES*2} THEN to_jsonb(p)::text END actual_projection,CASE WHEN ${publicBytes}<=${PAYMENT_EVENT_WIRE_BYTES*2} THEN to_jsonb(p) IS NOT DISTINCT FROM to_jsonb(expected) ELSE false END projection_matches FROM jsonb_populate_record(NULL::public.payment_events,$2::jsonb) expected CROSS JOIN public.payment_events p WHERE p.id=$1 FOR SHARE OF p`,[id,projectionWire]);
 assert.equal(projected.rowCount,1);assert.equal(projected.rows[0].projection_matches,true);for(const name of ['expected_projection','actual_projection'])assert(typeof projected.rows[0][name]==='string'&&Buffer.byteLength(projected.rows[0][name])<=PAYMENT_EVENT_WIRE_BYTES*2);
 const nativeProjectionWire:string=projected.rows[0].expected_projection,expectedProjection=JSON.parse(nativeProjectionWire);assert(expectedProjection&&typeof expectedProjection==='object'&&!Array.isArray(expectedProjection));assert.deepEqual(Object.keys(expectedProjection).sort(),[...PAYMENT_EVENT_FIELDS].sort());assert.equal(canonicalJson(JSON.parse(projected.rows[0].actual_projection)),canonicalJson(expectedProjection));return {nativeProjectionWire,expectedProjection};
}
export async function readNativePaymentSourceOriginal(pg:Client,id:string){
 // Never to_jsonb a whole original: raw ::text does not decode unrelated NUL.
 const selected=await pg.query('SELECT payment_id,identity_digest,original_wire::text original_wire,original_sha256,current_wire::text current_wire,current_sha256,native_projection::text native_projection,array_to_json(unprojected_fields)::text unprojected_fields,jsonb_build_array(payment_id IS NULL,identity_digest IS NULL,original_wire IS NULL,original_sha256 IS NULL,current_wire IS NULL,current_sha256 IS NULL,native_projection IS NULL,unprojected_fields IS NULL)::text nulls FROM keryx_storage."payment_event_originals" WHERE payment_id=$1',[id]);
 assert.equal(selected.rowCount,1);const actual={...selected.rows[0]};assert.deepEqual(JSON.parse(actual.nulls),Array(8).fill(false));delete actual.nulls;
 assert.equal(sha(actual.original_wire),actual.original_sha256);assert.equal(sha(actual.current_wire),actual.current_sha256);return actual;
}
export async function insertNativePaymentSourceOriginal(pg:Client,row:Record<string,unknown>,nativeProjectionWire:string){
 assert.deepEqual(Object.keys(row).sort(),['payment_id','identity_digest','original_wire','original_sha256','current_wire','current_sha256','native_projection','unprojected_fields'].sort());assert(Buffer.byteLength(canonicalJson(row))<=8388608);
 assert.equal((await pg.query('INSERT INTO keryx_storage."payment_event_originals"(payment_id,identity_digest,original_wire,original_sha256,current_wire,current_sha256,native_projection,unprojected_fields) VALUES($1,$2,$3::json,$4,$5::json,$6,$7::jsonb,$8::text[])',[row.payment_id,row.identity_digest,row.original_wire,row.original_sha256,row.current_wire,row.current_sha256,nativeProjectionWire,row.unprojected_fields])).rowCount,1);
}
export async function compareNativePrivateResultSourceRow(pg:Client,name:PrivateResultSourceTable,id:string,expected:Record<string,string>){
 assert(Object.hasOwn(PRIVATE_RESULT_SOURCE_COLUMNS,name));const columns=PRIVATE_RESULT_SOURCE_COLUMNS[name];
 const bytes=columns.map(c=>'octet_length('+quote(c)+'::text)').join('+'),bounded=bytes+'<='+PRIVATE_RESULT_SOURCE_BYTE_LIMITS[name];
 const native:QueryResult<Record<string,unknown>>=await pg.query('SELECT '+columns.map(c=>'CASE WHEN '+bounded+' THEN '+quote(c)+'::text END AS '+quote(c)).join(',')+','+bounded+' bounded FROM public.'+quote(name)+' WHERE id=$1 FOR SHARE',[id]);
 assert.equal(native.rowCount,1);assert.equal(native.rows[0].bounded,true);const actual={...native.rows[0]};delete actual.bounded;assert(canonicalJson(actual)===canonicalJson(expected),'Private Source public cells changed');
}
export async function materializeNativeProjections(db:DatabaseSync,options:PostgresConnectionOptions,mode:NativeMaterializationProfileMode='observation505'){
 nativeMaterializationProfile(mode);
 assertDevelopmentMaterializationContainment();assert(db.isTransaction&&db.prepare('PRAGMA query_only').get()?.query_only===1);assert.equal(options.role,'postgres');assert.equal(options.database,'native_materialized');assert.deepEqual(options.endpoint,{kind:'loopback',port:5432});assert(/^[a-f0-9]{48}$/.test(options.password));
 const pg=new Client(postgresPoolConfiguration(options));pg.on('error',()=>{});let started=false,commit=false;
 try{
  await pg.connect();const selected=await pg.query('SELECT identity::text wire FROM keryx_storage.identity WHERE singleton');assert.equal(selected.rowCount,1);assert.equal(canonicalJson(validateStorageIdentity(JSON.parse(selected.rows[0].wire))),canonicalJson(readStorageIdentity(db)));
  await pg.query('BEGIN');started=true;
  const result=await materializeNativeProjectionsTransaction(db,pg,mode);
  commit=true;await pg.query('COMMIT');started=false;
  return {...result,productionChanged:false,paymentActions:0,jobActions:0};
 }catch(error){
  if(started)try{await pg.query('ROLLBACK');}catch{}
  if(error instanceof NativeMaterializationUnavailable)throw error;
  throw new NativeMaterializationUnavailable({stage:commit?'projection-commit':'projection-entry',table:null,pgCode:null,constraint:null,commitOutcome:commit?'unknown':'not_attempted'});
 }finally{try{await pg.end();}catch{throw new NativeMaterializationUnavailable({stage:'projection-dispose',table:null,pgCode:null,constraint:null,commitOutcome:commit?'unknown':'not_attempted'});}}
}
/** Data-only fixed operations; caller owns Source/PG handles and transaction. */
export function materializeNativeProjectionsTransaction(db:DatabaseSync,pg:Client,mode:NativeMaterializationProfileMode='observation505'){
 return projectionTransaction(db,pg,mode,'copy');
}
export function compareNativeProjectionsTransaction(db:DatabaseSync,pg:Client,mode:NativeMaterializationProfileMode='observation505'){
 return projectionTransaction(db,pg,mode,'compare');
}
async function projectionTransaction(db:DatabaseSync,pg:Client,mode:NativeMaterializationProfileMode,action:'copy'|'compare'){
 const profile=nativeMaterializationProfile(mode);
 assert(db.isTransaction&&db.prepare('PRAGMA query_only').get()?.query_only===1);
 const identity=readStorageIdentity(db);let stage='projection-entry',table:string|null=null;
 const candidates:Table[]=[...tables,'payment_event_originals','private_research_result_identity'],counts=Object.fromEntries(candidates.map(t=>[t,0])) as Record<Table,number>,digests=new Map(candidates.map(t=>[t,createHash('sha256')]));
 let paymentEventOriginalsPresent:boolean|undefined,privateResultIdentityPresent:boolean|undefined;const identityWire=canonicalJson(identity),sourceCurrent=()=>{assert(db.isTransaction&&db.prepare('PRAGMA query_only').get()?.query_only===1);assert.equal(canonicalJson(readStorageIdentity(db)),identityWire);};
 try{
  const selected=(await pg.query('SELECT identity::text wire FROM keryx_storage.identity WHERE singleton')).rows;assert.equal(selected.length,1);assert.equal(canonicalJson(validateStorageIdentity(JSON.parse(selected[0].wire))),canonicalJson(identity));
  const verify=async()=>{
   sourceCurrent();assert.equal((await pg.query("SELECT mode FROM keryx_storage.control WHERE singleton FOR SHARE")).rows[0]?.mode,'held');
   const current=(await pg.query('SELECT identity::text wire FROM keryx_storage.identity WHERE singleton FOR SHARE')).rows;assert.equal(current.length,1);assert.equal(canonicalJson(validateStorageIdentity(JSON.parse(current[0].wire))),identityWire);
   assert.equal((await pg.query('SELECT source_digest FROM keryx_storage.source_contract WHERE singleton FOR SHARE')).rows[0]?.source_digest,profile.catalogSha256);
   const contract=exportNativePostgresSchemaContract((await pg.query('SELECT keryx_storage.catalog_contract()::text wire')).rows[0].wire);assert.equal(contract.sha256,profile.catalogSha256);
   const present=hasPaymentOriginals(contract);if(paymentEventOriginalsPresent!==undefined)assert.equal(present,paymentEventOriginalsPresent);paymentEventOriginalsPresent=present;const privatePresent=hasPrivateResultIdentity(contract,mode);if(privateResultIdentityPresent!==undefined)assert.equal(privatePresent,privateResultIdentityPresent);privateResultIdentityPresent=privatePresent;if(privatePresent)assert(present);if(mode==='development-current510-data-only')assert(present&&privatePresent,'Current DATA intake requires all twelve private domains');sourceCurrent();
  };await verify();
  stage='projection-preflight';await verify();const selectedTables:Table[]=[...tables,...(paymentEventOriginalsPresent?['payment_event_originals' as const]:[]),...(privateResultIdentityPresent?['private_research_result_identity' as const]:[])];
  if(paymentEventOriginalsPresent)await pg.query(`LOCK TABLE ${selectedTables.map(name=>'keryx_storage.'+quote(name)).join(',')},public.payment_events${privateResultIdentityPresent?','+Object.keys(PRIVATE_RESULT_SOURCE_COLUMNS).map(name=>'public.'+quote(name)).join(','):''} IN SHARE ROW EXCLUSIVE MODE`);
  if(action==='copy')for(const name of selectedTables){table=name;assert.equal((await pg.query(`SELECT count(*)::text n FROM keryx_storage.${quote(name)}`)).rows[0].n,'0');}
  const insert=async(name:Table,keys:string[],columns:Field[],row:Record<string,unknown>)=>{
   table=name;stage='projection-copy';const packet={table:name,keys,columns,row},wire=action==='copy'?await insertNativeSourceProjection(pg,packet):checkedNativeProjectionRow(packet).wire;
   stage='projection-re-read';await compareNativeSourceProjection(pg,packet);
   digests.get(name)!.update(wire).update('\n');counts[name]++;
  };
  const capturedRows=async(selector:NativeProjectionSelector)=>{sourceCurrent();const captured=await captureNativeProjectionSource(db,selector);sourceCurrent();for(const row of captured.rows)await insert(row.table,row.keys,row.columns,row.row);sourceCurrent();};
  let runs=0;for(const key of db.prepare('SELECT id FROM query_runs ORDER BY id COLLATE BINARY').iterate()){assert(typeof key.id==='string'&&++runs<=10000);await capturedRows({family:'run',id:key.id});}
  let reviews=0;for(const r of db.prepare('SELECT id FROM decision_review_records ORDER BY id COLLATE BINARY').iterate()){assert(++reviews<=100000&&typeof r.id==='string');await capturedRows({family:'review',id:r.id});}
  let watches=0;for(const r of db.prepare('SELECT wallet,id FROM topic_watches ORDER BY wallet COLLATE BINARY,id COLLATE BINARY').iterate()){assert(++watches<=10000&&typeof r.wallet==='string'&&typeof r.id==='string');await capturedRows({family:'watch',wallet:r.wallet,id:r.id});}
  let orders=0;for(const r of db.prepare('SELECT id FROM a2a_orders ORDER BY id COLLATE BINARY').iterate()){assert(++orders<=10000&&typeof r.id==='string');await capturedRows({family:'a2a',id:r.id});}
  let payments=0;
  if(paymentEventOriginalsPresent)for(const key of db.prepare("SELECT CASE WHEN typeof(id)='text' AND length(CAST(id AS BLOB))<=1024 THEN id END id FROM payment_events ORDER BY payment_events.id COLLATE BINARY").iterate()){
   table='payment_event_originals';stage='payment-source-capture';sourceCurrent();assert(typeof key.id==='string'&&++payments<=100000);
   const captured=(await captureNativeProjectionSource(db,{family:'payment',id:key.id})).payment;assert(captured);sourceCurrent();
   stage='payment-public-compare';const {nativeProjectionWire,expectedProjection}=await deriveNativePaymentSourceProjection(pg,key.id,captured);sourceCurrent();
   const row={payment_id:key.id,identity_digest:storageIdentityDigest(identity),original_wire:captured.rowWire,original_sha256:captured.sha256,current_wire:captured.rowWire,current_sha256:captured.sha256,native_projection:expectedProjection,unprojected_fields:[...captured.unprojectedFields]},wire=canonicalJson(row);assert(Buffer.byteLength(wire)<=8388608);
   stage='payment-original-copy';if(action==='copy')await insertNativePaymentSourceOriginal(pg,row,nativeProjectionWire);
   stage='payment-original-re-read';const actual=await readNativePaymentSourceOriginal(pg,key.id);assert.equal(actual.native_projection,nativeProjectionWire);actual.native_projection=JSON.parse(actual.native_projection);actual.unprojected_fields=JSON.parse(actual.unprojected_fields);assert.equal(canonicalJson(actual),wire);sourceCurrent();
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
    const captured=(await captureNativeProjectionSource(db,{family:'private-result',id:key.id})).privateResult;assert(captured);sourceCurrent();
    stage='private-result-public-compare';
    for(const [name,columns] of Object.entries(PRIVATE_RESULT_SOURCE_COLUMNS)){
     await compareNativePrivateResultSourceRow(pg,name as PrivateResultSourceTable,key.id,captured.rows[name as PrivateResultSourceTable]);sourceCurrent();
    }
    await insert('private_research_result_identity',['id'],Object.keys(PRIVATE_RESULT_IDENTITY_COLUMNS).map(name=>field(name)),captured.metadata);sourceCurrent();
   }
  }
  stage='projection-final';await verify();for(const name of selectedTables)assert.equal((await pg.query(`SELECT count(*)::text n FROM keryx_storage.${quote(name)}`)).rows[0].n,String(counts[name]));
  if(paymentEventOriginalsPresent)assert.equal((await pg.query('SELECT count(*)::text n FROM public.payment_events')).rows[0].n,String(payments));
  return {format:'keryx-native-source-projection-materialization-v1',...(mode==='development-current510-data-only'?{profileMode:mode,dataIntakeOnly:true,genuineColdFactoryQualified:false}:{}),passed:true,sourceDerivedProjectionsMaterialized:true,sourceLogicalIdentityPreserved:true,runs,reviews,watches,orders,paymentEventOriginalsPresent:paymentEventOriginalsPresent===true,payments,privateResultIdentityPresent:privateResultIdentityPresent===true,privateResults,domains:selectedTables.map(name=>({table:name,rows:counts[name],digest:digests.get(name)!.digest('hex')})),writerMode:'held',applicationBackendSwitched:false,completeApplicationWriterQualified:false};
 }catch(error){
  const safe=(k:string)=>{const value=error&&typeof error==='object'?Reflect.get(error,k):null;return typeof value==='string'&&/^[a-zA-Z0-9_]{1,128}$/.test(value)?value:null;};
  throw new NativeMaterializationUnavailable({stage,table,pgCode:safe('code'),constraint:safe('constraint'),column:safe('column'),commitOutcome:'not_attempted'});
 }
}
