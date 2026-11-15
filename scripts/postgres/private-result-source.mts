/** Actual read-only Source cells only. This operator derivative grants no
 * installed storage, worker, receipt, payment or publication authority. */
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../../lib/canonical-json';
import { readStorageIdentity } from '../../lib/db/storage-identity-sqlite';
import { storageIdentityDigest,type StorageIdentity } from '../../lib/db/storage-identity';
import { nativeMaterializationProfile,type NativeMaterializationProfileMode } from '../../lib/db/postgres/runtime-profile';
import type { exportNativePostgresSchemaContract } from './native-contract.mts';

export const PRIVATE_RESULT_SOURCE_COLUMNS=Object.freeze({private_research_intents:Object.freeze(['id','payer','data','created_at'] as const),private_research_payment_attempts:Object.freeze(['id','started_at','confirmation','settled_at'] as const),private_research_executions:Object.freeze(['id','worker_id','started_at'] as const),private_research_results:Object.freeze(['id','serialized_run','saved_at'] as const)});
export const PRIVATE_RESULT_SOURCE_BYTE_LIMITS=Object.freeze({private_research_intents:524288,private_research_payment_attempts:32768,private_research_executions:32768,private_research_results:16777216});
export const PRIVATE_RESULT_IDENTITY_COLUMNS=Object.freeze({id:'text',identity_digest:'text',intent_sha256:'text',run_sha256:'text',owner:'text',question_sha256:'text',creator_budget_micros:'bigint',research_mode:'text',worker_id:'text',execution_started_at:'text',payment_started_at:'text',payment_settled_at:'text',payment_confirmation_sha256:'text',saved_at:'text'});
type Reference=Pick<ReturnType<typeof exportNativePostgresSchemaContract>,'sha256'|'metadata'>;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** Feature classification follows only an independently exported, pinned
 * descriptor. Presence with a different schema/fence refuses, never adopts. */
export function hasPrivateResultIdentity(reference:Reference,mode:NativeMaterializationProfileMode='observation505'){
 assert.equal(reference.sha256,nativeMaterializationProfile(mode).catalogSha256);const sections=reference.metadata?.sections;if(!object(sections))return false;
 const relations=sections.relations;assert(Array.isArray(relations));const matches=relations.filter(v=>object(v)&&v.schema==='keryx_storage'&&v.name==='private_research_result_identity');assert(matches.length<=1);if(!matches.length)return false;assert(object(matches[0])&&matches[0].kind==='r');
 const columns=sections.columns,constraints=sections.constraints,triggers=sections.triggers,functions=sections.functions;assert(Array.isArray(columns)&&Array.isArray(constraints)&&Array.isArray(triggers)&&Array.isArray(functions));
 const actual=columns.filter(v=>object(v)&&v.schema==='keryx_storage'&&v.relation==='private_research_result_identity').map(v=>{assert(object(v));return [v.name,v.type];});assert.deepEqual(actual.sort(),Object.entries(PRIVATE_RESULT_IDENTITY_COLUMNS).sort());
 for(const [name,fields] of Object.entries(PRIVATE_RESULT_SOURCE_COLUMNS)){const cells:unknown[][]=columns.filter(v=>object(v)&&v.schema==='public'&&v.relation===name).map(v=>{assert(object(v));return [v.name,v.type];});assert.deepEqual(cells.sort(),fields.map(f=>[f,'text']).sort());}
 assert(constraints.some(v=>object(v)&&v.schema==='keryx_storage'&&v.relation==='private_research_result_identity'&&v.type==='p'&&v.definition==='PRIMARY KEY (id)'));
 assert(constraints.some(v=>object(v)&&v.schema==='keryx_storage'&&v.relation==='private_research_result_identity'&&v.type==='f'&&v.referencedSchema==='public'&&v.referencedRelation==='private_research_results'&&typeof v.definition==='string'&&/^FOREIGN KEY \(id\) REFERENCES (?:public\.)?private_research_results\(id\) ON DELETE CASCADE$/.test(v.definition)));
 for(const [name,fn] of [['native_private_result_identity_writer','write_fence'],['native_private_result_identity_retained','immutable']])assert(triggers.some(v=>object(v)&&v.schema==='keryx_storage'&&v.relation==='private_research_result_identity'&&v.name===name&&v.functionSchema==='keryx_storage'&&v.function===fn&&v.enabled==='O'));
 assert(functions.some(v=>object(v)&&v.schema==='keryx_storage'&&v.name==='write_fence'&&typeof v.source==='string'&&v.source.includes('Private result Source identity fence v1')&&v.source.includes('NEW.question_sha256')&&v.source.includes('private_research_save_result')));return true;
}
export type PrivateResultSourceTable=keyof typeof PRIVATE_RESULT_SOURCE_COLUMNS;
export async function captureObservedPrivateResultSource(db:DatabaseSync,id:string,identity:StorageIdentity){
 const pinned=canonicalJson(identity),current=()=>{assert(db.isTransaction&&db.prepare('PRAGMA query_only').get()?.query_only===1);assert.equal(canonicalJson(readStorageIdentity(db)),pinned);};current();
 assert(/^prv_[a-f0-9]{64}$/.test(id));const rows={} as Record<PrivateResultSourceTable,Record<string,string>>;
 for(const [name,columns] of Object.entries(PRIVATE_RESULT_SOURCE_COLUMNS)){
  const schema=db.prepare('PRAGMA table_info('+name+')').all();assert.deepEqual(schema.map(c=>String(c.name)).sort(),[...columns].sort());assert(schema.every(c=>c.type==='TEXT'));assert.deepEqual(schema.filter(c=>Number(c.pk)>0).map(c=>String(c.name)),['id']);
  const cellBytes=columns.map(c=>`length(CAST(${c} AS BLOB))`).join('+'),maximum=PRIVATE_RESULT_SOURCE_BYTE_LIMITS[name as PrivateResultSourceTable];
  const sizes=db.prepare('SELECT '+cellBytes+' n FROM '+name+' WHERE id=?').get(id);assert(typeof sizes?.n==='number'&&sizes.n>0&&sizes.n<=maximum);
  const row=db.prepare('SELECT * FROM '+name+' WHERE id=?').get(id);assert(row,'Private Source result requires every original row');assert.deepEqual(Object.keys(row).sort(),[...columns].sort());
  const observed=db.prepare('SELECT '+columns.flatMap((c,i)=>[`typeof(${c}) kind${i}`,`lower(hex(CAST(${c} AS BLOB))) hex${i}`]).join(',')+' FROM '+name+' WHERE id=?').get(id)!;
  for(const [i,c] of columns.entries()){assert.equal(observed['kind'+i],'text');assert.equal(typeof row[c],'string');assert.equal(Buffer.from(String(row[c])).toString('hex'),observed['hex'+i],'Private Source UTF8 cannot be repaired');}
  rows[name as PrivateResultSourceTable]=Object.freeze(row) as Record<string,string>;
 }
 // These real Source modules must initialize under the fresh mainnet child
 // before any sticky buyer-profile import; no historical profile is relabelled.
 const {BUYER_NETWORK}=await import('../../lib/buyer/protocol');assert.equal(BUYER_NETWORK,identity.network);assert.equal(identity.network,'eip155:5042');current();
 const source=await import('../../lib/db/postgres/private-research-packet'),intent=rows.private_research_intents;
 const state=await source.readPrivateResearchSnapshot({intentRowWire:JSON.stringify(intent),paymentRowWire:JSON.stringify(rows.private_research_payment_attempts),executionRowWire:JSON.stringify(rows.private_research_executions),resultRowWire:JSON.stringify(rows.private_research_results),interruptionRowWire:null,reservationRowWire:null,releaseRowWire:null,submissionsWire:'[]',confirmationsWire:'[]'},source.privateResearchLookup(id,intent.payer));current();
 const captured=source.privateResearchResultIdentity(rows.private_research_results.serialized_run,state);assert(captured.sourceSavedAt!==null);assert.equal(captured.id,id);assert.equal(captured.sourceSavedAt,rows.private_research_results.saved_at);
 const metadata={id,identity_digest:storageIdentityDigest(identity),intent_sha256:captured.intentSha256,run_sha256:captured.runSha256,owner:captured.owner,question_sha256:captured.questionSha256,creator_budget_micros:Number(captured.budgetMicros),research_mode:captured.researchMode,worker_id:captured.workerId,execution_started_at:captured.executionStartedAt,payment_started_at:captured.paymentStartedAt,payment_settled_at:captured.paymentSettledAt,payment_confirmation_sha256:captured.paymentConfirmationSha256,saved_at:captured.sourceSavedAt};
 assert(Number.isSafeInteger(metadata.creator_budget_micros)&&metadata.creator_budget_micros>=1&&metadata.creator_budget_micros<=500000);current();return Object.freeze({metadata:Object.freeze(metadata),rows:Object.freeze(rows)});
}
