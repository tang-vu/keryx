/** Initial isolated HELD DATA CAS only. No activation, enrollment, application
 * writer, financial proof, DDL, fresh-intake token or automatic retry. Run in
 * an independently enforced <=512 MiB process; the qualifier checks that OS
 * boundary. A sealed DTO is never trusted instead of Source and target reads. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fstatSync,readSync,rmdirSync,unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Client } from 'pg';
import { canonicalJson } from '../../lib/canonical-json';
import { storageIdentityDigest,validateStorageIdentity } from '../../lib/db/storage-identity';
import { holdStorageTarget,readStorageIdentity } from '../../lib/db/storage-identity-sqlite';
import { configureSnapshotConnection,checkSnapshotSidecars } from '../../lib/db/storage-provenance-snapshot';
import { OFFLINE_SNAPSHOT_LIMITS } from '../../lib/db/storage-provenance';
import { postgresPoolConfiguration,type PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import { nativeMaterializationProfile } from '../../lib/db/postgres/runtime-profile';
import { capturePaymentEventRow,PAYMENT_EVENT_WIRE_BYTES } from '../../lib/db/postgres/payment-events-packet';
import { exportNativePostgresSchemaContract } from './native-contract.mts';
import { snapshotRows,snapshotTables,snapshotRowWire,type SnapshotRow } from './typed-snapshot.mts';
import { nativeMaterializationCell,nativeMaterializationQueryCell,nativeMaterializationValueKey,type NativeMaterializationType } from './native-materialization-codec.mts';
import { nativeMaterializationPaymentCells } from './payment-materialization-codec.mts';
import { articleOfferSourceOrder,planNativeMaterializationTables } from './materialize-native-snapshot.mts';
import { prepareHeldNativeCatchupInput,HELD_CATCHUP_INPUT_LIMITS } from './held-native-catchup-input.mts';
import { TYPED_SNAPSHOT_DELTA_LIMITS,type TypedDeltaChange } from './typed-snapshot-delta.mts';
import { captureNativeProjectionSource,checkedNativeProjectionRow,compareNativeSourceProjection,insertNativeSourceProjection,deriveNativePaymentSourceProjection,readNativePaymentSourceOriginal,insertNativePaymentSourceOriginal,compareNativePrivateResultSourceRow,type NativeProjectionSelector,type NativeProjectionRow } from './materialize-native-projections.mts';
import { PRIVATE_RESULT_SOURCE_COLUMNS,PRIVATE_RESULT_IDENTITY_COLUMNS,type PrivateResultSourceTable } from './private-result-source.mts';

const MiB=1048576,mode='development-current510-data-only' as const,profile=nativeMaterializationProfile(mode);
const quote=(name:string)=>{assert(/^[a-z][a-z0-9_]{0,62}$/.test(name));return '"'+name+'"';};
const sha=(wire:string|Buffer)=>createHash('sha256').update(wire).digest('hex');
type Plan=ReturnType<typeof planNativeMaterializationTables>[number];
type NativeTable=Parameters<typeof planNativeMaterializationTables>[1][number];
type Prepared=Awaited<ReturnType<typeof prepareHeldNativeCatchupInput>>;
export type HeldNativeCatchupRequest=Readonly<{source:Parameters<typeof prepareHeldNativeCatchupInput>[0];sealed:Readonly<{path:string;sha256:string}>;referenceWire:string;options:PostgresConnectionOptions}>;
export class HeldNativeCatchupRefused extends Error{
 constructor(readonly stage:string,readonly commitOutcome:'not_attempted'|'unknown'|'acknowledged'='not_attempted'){super('Held native catchup refused: '+stage);}
}
const refuse=(stage:string):never=>{throw new HeldNativeCatchupRefused(stage);};
function capture(input:HeldNativeCatchupRequest){
 let fields=0;const plain=(value:unknown,depth=0):void=>{
  if(depth>10||++fields>128||value===undefined||typeof value==='function'||typeof value==='symbol'||typeof value==='bigint')refuse('request');
  if(typeof value==='string'&&(value.length>8*MiB||Buffer.byteLength(value)>8*MiB))refuse('request');
  if(value&&typeof value==='object'){if(Object.getPrototypeOf(value)!==Object.prototype||Object.getOwnPropertySymbols(value).length||Object.keys(value).length>16)refuse('request');for(const d of Object.values(Object.getOwnPropertyDescriptors(value))){if(!d.enumerable||!('value'in d))refuse('request');plain(d.value,depth+1);}}
 };
 plain(input);assert(input&&Object.keys(input).sort().join(',')==='options,referenceWire,sealed,source');const r=JSON.parse(JSON.stringify(input)) as HeldNativeCatchupRequest;
 assert.equal(r.options.role,'postgres');assert.equal(r.options.database,'native_materialized');assert.deepEqual(r.options.endpoint,{kind:'loopback',port:5432});assert(/^[a-f0-9]{48}$/.test(r.options.password));postgresPoolConfiguration(r.options);
 assert(Object.keys(r.sealed).sort().join(',')==='path,sha256'&&/^[a-f0-9]{64}$/.test(r.sealed.sha256));
 const reference=exportNativePostgresSchemaContract(r.referenceWire);assert.equal(reference.sha256,profile.catalogSha256);return {r,reference};
}
function fingerprint(path:string,expected:string,bound:number,check:()=>void){
 const held=holdStorageTarget(path),initial=fstatSync(held.descriptor,{bigint:true}),token=(s:typeof initial)=>[s.dev,s.ino,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');
 try{assert(initial.nlink===BigInt(1)&&initial.size<=BigInt(bound));if(process.platform!=='win32')assert(initial.uid===BigInt(process.getuid!())&&(initial.mode&BigInt(0o077))===BigInt(0));
  const verify=()=>{check();held.verify();assert.equal(token(fstatSync(held.descriptor,{bigint:true})),token(initial));};
  const hash=()=>{verify();const h=createHash('sha256'),buffer=Buffer.alloc(MiB);for(let offset=0;;){const n=readSync(held.descriptor,buffer,0,buffer.length,offset);if(!n)break;h.update(buffer.subarray(0,n));offset+=n;check();}verify();assert.equal(h.digest('hex'),expected);};hash();return {...held,verify,hash,bytes:Number(initial.size)};
 }catch(error){held.close();throw error;}
}
function openSource(source:HeldNativeCatchupRequest['source']['delta']['before'],identityDigest:string,check:()=>void){
 const held=fingerprint(source.path,source.sha256,TYPED_SNAPSHOT_DELTA_LIMITS.snapshotBytes,check);let db:DatabaseSync|undefined;
 try{checkSnapshotSidecars(source.path);db=new DatabaseSync(source.path,{readOnly:true,allowExtension:false,timeout:1000});configureSnapshotConnection(db,OFFLINE_SNAPSHOT_LIMITS);db.exec('BEGIN');const native=db;
  const identity=readStorageIdentity(native);assert.equal(storageIdentityDigest(identity),identityDigest);assert.equal(identity.authorityMode,'mainnet-real');
  const verify=()=>{held.verify();checkSnapshotSidecars(source.path);assert(native.isTransaction&&native.prepare('PRAGMA query_only').get()?.query_only===1);assert.equal(storageIdentityDigest(readStorageIdentity(native)),identityDigest);};verify();
  return {db:native,identity,verify,hash:held.hash,close(){try{if(native.isTransaction)native.exec('ROLLBACK');}finally{try{native.close();}finally{held.close();}}}};
 }catch(error){try{db?.close();}finally{held.close();}throw error;}
}
type Source=ReturnType<typeof openSource>;
type Span={offset:number;bytes:number};
/** Bounded seek index, never the entire raw delta/object graph. */
function indexSpool(file:ReturnType<typeof fingerprint>,check:()=>void){
 const changes=new Map<string,Span[]>(),projections:Span[]=[],orders:Span[]=[],offerKeys=new Set<string>();let cursor=0,carry=Buffer.alloc(0),lineOffset=0,frames=0;
 const consume=(line:Buffer)=>{check();assert(line.length+1<=HELD_CATCHUP_INPUT_LIMITS.changeFrameBytes);const value=JSON.parse(line.toString('utf8')),span={offset:lineOffset,bytes:line.length};lineOffset+=line.length+1;frames++;
  if(value.format==='keryx-typed-snapshot-delta-batch-v1'){
   assert(Array.isArray(value.changes)&&value.changes.length<=64);const names=new Set<string>();for(const change of value.changes){assert(typeof change.table==='string');names.add(change.table);if(change.table==='article_offers')offerKeys.add(sha(snapshotRowWire(change.key)));}
   for(const name of names){let group=changes.get(name);if(!group){group=[];changes.set(name,group);}group.push(span);}
  }else if(value.format==='keryx-held-native-catchup-projection-v1'){assert(line.length+1<=HELD_CATCHUP_INPUT_LIMITS.projectionFrameBytes);projections.push(span);}
  else if(value.format==='keryx-held-native-catchup-offer-order-v1'){assert(line.length+1<=HELD_CATCHUP_INPUT_LIMITS.projectionFrameBytes);orders.push(span);}
  else assert(value.format==='keryx-held-native-catchup-header-v1'||value.format==='keryx-held-native-catchup-completion-v1');
 };
 const buffer=Buffer.alloc(MiB);for(;;){file.verify();const n=readSync(file.descriptor,buffer,0,buffer.length,cursor);if(!n)break;cursor+=n;const block=carry.length?Buffer.concat([carry,buffer.subarray(0,n)]):buffer.subarray(0,n);let start=0;
  for(let end=block.indexOf(10,start);end>=0;end=block.indexOf(10,start)){consume(block.subarray(start,end));start=end+1;}carry=Buffer.from(block.subarray(start));assert(carry.length<=HELD_CATCHUP_INPUT_LIMITS.changeFrameBytes);
 }assert.equal(carry.length,0);assert.equal(lineOffset,file.bytes);file.verify();return {changes,projections,orders,offerKeys,frames};
}
function readFrame(file:ReturnType<typeof fingerprint>,span:Span){file.verify();assert(span.bytes<HELD_CATCHUP_INPUT_LIMITS.changeFrameBytes);const b=Buffer.alloc(span.bytes);let used=0;while(used<b.length){const n=readSync(file.descriptor,b,used,b.length-used,span.offset+used);assert(n>0);used+=n;}return JSON.parse(b.toString('utf8'));}
function fixedNativeTables(reference:ReturnType<typeof exportNativePostgresSchemaContract>){
 const sections=reference.metadata.sections as Record<string,unknown>,relations=sections.relations as Record<string,unknown>[],columns=sections.columns as Record<string,unknown>[],constraints=sections.constraints as Record<string,unknown>[];
 assert(Array.isArray(relations)&&Array.isArray(columns)&&Array.isArray(constraints));
 const tuple=(definition:unknown,prefix:string)=>{assert(typeof definition==='string'&&definition.startsWith(prefix));const part=definition.slice(prefix.length).split(')')[0].split(',').map(v=>v.trim().replace(/^"|"$/g,''));part.forEach(quote);return part;};
 const result=relations.filter(t=>t.schema==='public'&&t.kind==='r').map(t=>{assert(typeof t.name==='string');quote(t.name);const cs=constraints.filter(c=>c.schema==='public'&&c.relation===t.name),pk=cs.filter(c=>c.type==='p');assert(pk.length<=1);
  return {name:t.name,columns:columns.filter(c=>c.schema==='public'&&c.relation===t.name).sort((a,b)=>Number(a.position)-Number(b.position)).map(c=>{assert(typeof c.name==='string'&&typeof c.type==='string');quote(c.name);return {name:c.name,type:c.type};}),primary_key:pk.length?tuple(pk[0].definition,'PRIMARY KEY ('):[],parents:cs.filter(c=>c.type==='f'&&c.deferrable===false).map(c=>{assert(c.referencedSchema==='public'&&typeof c.referencedRelation==='string');quote(c.referencedRelation);return c.referencedRelation as string;}),foreignColumns:cs.filter(c=>c.type==='f').flatMap(c=>tuple(c.definition,'FOREIGN KEY ('))};
 });assert.equal(result.length,94);return result;
}
function cells(source:Source,plan:Plan,row:SnapshotRow){return plan.source.name==='payment_events'?nativeMaterializationPaymentCells(source.db,plan.source,row,plan.types):row.map((cell,i)=>plan.source.name==='query_runs'?nativeMaterializationQueryCell(cell,plan.types[i],plan.source.columns[i]):nativeMaterializationCell(cell,plan.types[i]));}
function render(column:string,type:NativeMaterializationType){const c=quote(column);return type==='timestamp with time zone'?`to_char(${c} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`:type==='date'?`to_char(${c},'YYYY-MM-DD')`:`${c}::text`;}
const rowKey=(plan:Plan,values:readonly(string|null)[])=>JSON.stringify(values.map((v,i)=>nativeMaterializationValueKey(plan.types[i],v)));
function projected(source:Source,plan:Plan,row:SnapshotRow){return [...cells(source,plan,row),...(plan.sourceOrder?[articleOfferSourceOrder(source.db,plan.source,row)]:[])];}
function whereCells(plan:Plan,values:readonly(string|null)[],start=1){
 const names=[...plan.source.columns,...(plan.sourceOrder?['source_order']:[])],types=[...plan.types,...(plan.sourceOrder?['bigint' as const]:[])];assert.equal(values.length,names.length);
 return names.map((name,i)=>types[i]==='json'?`${quote(name)}::text IS NOT DISTINCT FROM $${start+i}::text`:`${quote(name)} IS NOT DISTINCT FROM $${start+i}::${types[i]}`).join(' AND ');
}
function protectedChange(change:TypedDeltaChange){
 if(change.table==='payment_events'&&change.before!==null)return 'payment-current-original';
 if(/^(private_|browser_|session_|hosted_|creator_owner_|research_|a2a_|deliverable_)/.test(change.table))return 'custody-immutable-dependency';
 if(['anonymous_run_claims','pending_job_owners','owner269_operations','owner269_associations','run_privacy_audit','public_reference_article_versions'].includes(change.table)&&change.operation!=='insert')return 'retained-policy-row';
 return null;
}
const sidecarNames=['run_history_projection','run_ownership_projection','run_privacy_projection','usage_projection','public_ledger_projection','review_projection','topic_watch_projection','a2a_original_time_projection','a2a_original_cell_projection','acceptance_original_projection','payment_event_originals','private_research_result_identity'] as const;
const writerNames=['browser_journal_writer','browser_signing_v2_writer','browser_signing_v3_writer'] as const;
async function gate(pg:Client,source:Source,check:()=>void,locked:boolean){
 const server=(await pg.query("SELECT current_database() name,session_user role,current_user current_role,current_setting('server_version_num') version")).rows[0];check();
 assert.deepEqual(server,{name:'native_materialized',role:'postgres',current_role:'postgres',version:'170012'});
 const control=await pg.query('SELECT mode FROM keryx_storage.control WHERE singleton'+(locked?' FOR UPDATE':''));check();assert.equal(control.rowCount,1);assert.equal(control.rows[0].mode,'held');
 const identity=await pg.query('SELECT identity::text wire,identity_digest FROM keryx_storage.identity WHERE singleton AND octet_length(identity::text)<=2048'+(locked?' FOR SHARE':''));check();assert.equal(identity.rowCount,1);
 const actual=validateStorageIdentity(JSON.parse(identity.rows[0].wire));assert.equal(canonicalJson(actual),canonicalJson(source.identity));assert.equal(identity.rows[0].identity_digest,storageIdentityDigest(source.identity));
 const contract=await pg.query('SELECT source_digest FROM keryx_storage.source_contract WHERE singleton'+(locked?' FOR SHARE':''));check();assert.equal(contract.rowCount,1);assert.equal(contract.rows[0].source_digest,profile.catalogSha256);
 const catalog=await pg.query('WITH observed AS MATERIALIZED(SELECT keryx_storage.catalog_contract()::text wire) SELECT CASE WHEN octet_length(wire)<=8388608 THEN wire END wire FROM observed');check();assert.equal(exportNativePostgresSchemaContract(catalog.rows[0].wire).sha256,profile.catalogSha256);
 assert.equal((await pg.query("SELECT count(*)::text n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND usename IN('keryx_app','keryx_reader','service_role','authenticated','anon')")).rows[0].n,'0');check();
 for(const name of ['keryx_storage.writer',...writerNames.map(n=>'public.'+quote(n))]){assert.equal((await pg.query('SELECT count(*)::text n FROM '+name)).rows[0].n,'0');check();}
}
function plansFor(before:Source,after:Source,native:NativeTable[],reference:ReturnType<typeof exportNativePostgresSchemaContract>){
 const old=snapshotTables(before.db),next=snapshotTables(after.db);assert.equal(old.length,94);assert.deepEqual(old,next);
 const counts=new Map<string,number>();for(const table of old){const a=before.db.prepare('SELECT count(*) n FROM '+quote(table.name)).get()!.n,b=after.db.prepare('SELECT count(*) n FROM '+quote(table.name)).get()!.n;assert(typeof a==='number'&&typeof b==='number');counts.set(table.name,Math.max(a,b));}
 const plans=planNativeMaterializationTables(before.db,native,counts,reference,mode);assert.equal(plans.length,90);return plans;
}
async function comparePublic(pg:Client,source:Source,plans:Plan[],native:NativeTable[],check:()=>void){
 let total=0;const digest=createHash('sha256');
 for(const table of native){const original=plans.find(p=>p.source.name===table.name),expected=original?source.db.prepare('SELECT count(*) n FROM '+quote(table.name)).get()!.n:0;
  assert.equal((await pg.query('SELECT count(*)::text n FROM public.'+quote(table.name))).rows[0].n,String(expected));check();
 }
 for(const plan of plans){
  const names=[...plan.source.columns,...(plan.sourceOrder?['source_order']:[])],selected=plan.source.columns.map((c,i)=>render(c,plan.types[i])).join(',')+(plan.sourceOrder?',"source_order"::text':'');
  const rawBytes=names.map(n=>'coalesce(octet_length('+quote(n)+'::text),0)').join('+'),array='json_build_array('+selected+')::text';
  // Bound hostile target cells in SQL before hydrating them in this process.
  const bounded=`CASE WHEN ${rawBytes}<=8388608 THEN CASE WHEN octet_length(${array})<=8388608 THEN ${array} END END`;
  const ordered=plan.keys.map(k=>{const type=plan.types[plan.source.columns.indexOf(k)];return quote(k)+(['text','keryx_storage.native_uuid_text'].includes(type)?' COLLATE "C"':'');}).join(',');
  await pg.query(`DECLARE catchup_rows NO SCROLL CURSOR FOR SELECT ${bounded} wire FROM public.${quote(plan.source.name)}${ordered?' ORDER BY '+ordered:''}`);check();
  let page:Record<string,unknown>[]=[],offset=0,seen=0;
  try{for(const row of snapshotRows(source.db,plan.source,plan.keys)){
   const expected=projected(source,plan,row);if(offset>=page.length){page=(await pg.query('FETCH FORWARD 8 FROM catchup_rows')).rows;offset=0;check();}
   assert(offset<page.length);const wire=page[offset++].wire;assert(typeof wire==='string'&&Buffer.byteLength(wire)<=8*MiB);const actual=JSON.parse(wire);assert(Array.isArray(actual)&&actual.length===expected.length&&actual.every(v=>v===null||typeof v==='string'));
   assert.equal(rowKey(plan,actual.slice(0,plan.types.length)),rowKey(plan,expected.slice(0,plan.types.length)));if(plan.sourceOrder)assert.equal(actual.at(-1),expected.at(-1));digest.update(plan.source.name).update('\0').update(JSON.stringify(expected)).update('\n');seen++;
  }assert.equal(offset,page.length);assert.equal((await pg.query('FETCH FORWARD 1 FROM catchup_rows')).rowCount,0);check();}
  finally{await pg.query('CLOSE catchup_rows');check();}total+=seen;
 }
 return {rows:total,digest:digest.digest('hex')};
}
function* sourceSelectors(db:DatabaseSync){
 const groups=[['run','query_runs',['id'],10000],['review','decision_review_records',['id'],100000],['watch','topic_watches',['wallet','id'],10000],['a2a','a2a_orders',['id'],10000],['payment','payment_events',['id'],100000],['private-result','private_research_results',['id'],10000]] as const;
 for(const [family,table,keys,maximum] of groups){let count=0;for(const row of db.prepare('SELECT '+keys.join(',')+' FROM '+table+' ORDER BY '+keys.map(k=>k+' COLLATE BINARY').join(',')).iterate()){
  assert(++count<=maximum&&typeof row.id==='string');if(family==='watch')assert(typeof row.wallet==='string');yield {family,id:row.id,...(family==='watch'?{wallet:row.wallet as string}:{})} as NativeProjectionSelector;
 }}
}
async function boundPrivateRow(pg:Client,packet:NativeProjectionRow,check:()=>void){
 const p=checkedNativeProjectionRow(packet),sum=p.columns.map(c=>'coalesce(octet_length('+quote(c.name)+'::text),0)').join('+');
 const selected=await pg.query('SELECT ('+sum+'<=8388608) bounded FROM keryx_storage.'+quote(p.table)+' WHERE '+p.keys.map((k,i)=>quote(k)+'=$'+(i+1)).join(' AND '),p.keys.map(k=>p.row[k]));check();assert.equal(selected.rowCount,1);assert.equal(selected.rows[0].bounded,true);
 await compareNativeSourceProjection(pg,packet);check();
}
async function compareSidecars(pg:Client,source:Source,old:Source,check:()=>void){
 const counts=new Map<string,number>(sidecarNames.map(n=>[n,0])),digest=createHash('sha256'),retainedFirst=createHash('sha256');let packets=0;
 for(const selector of sourceSelectors(source.db)){
  const captured=await captureNativeProjectionSource(source.db,selector);check();packets++;
  for(const packet of captured.rows){await boundPrivateRow(pg,packet,check);counts.set(packet.table,counts.get(packet.table)!+1);digest.update(packet.table).update('\0').update(canonicalJson(packet.row)).update('\n');}
  if(captured.payment){
   const capturedPayment=captured.payment,{nativeProjectionWire,expectedProjection}=await deriveNativePaymentSourceProjection(pg,selector.id,capturedPayment);check();
   // Current and first originals remain separate. Existing first bytes are
   // validated and hash-carried, never reconstructed from current Source.
   const size=await pg.query('SELECT (octet_length(original_wire::text)+octet_length(current_wire::text)+octet_length(native_projection::text)+octet_length(array_to_json(unprojected_fields)::text)<=8388608) bounded FROM keryx_storage.payment_event_originals WHERE payment_id=$1',[selector.id]);check();assert.equal(size.rowCount,1);assert.equal(size.rows[0].bounded,true);
   const actual=await readNativePaymentSourceOriginal(pg,selector.id);check();assert.equal(actual.payment_id,selector.id);assert.equal(actual.identity_digest,storageIdentityDigest(source.identity));assert.equal(actual.current_wire,capturedPayment.rowWire);assert.equal(actual.current_sha256,capturedPayment.sha256);assert.equal(actual.native_projection,nativeProjectionWire);assert.equal(canonicalJson(JSON.parse(actual.unprojected_fields)),canonicalJson(capturedPayment.unprojectedFields));
   assert(Buffer.byteLength(actual.original_wire)<=PAYMENT_EVENT_WIRE_BYTES);const first=JSON.parse(actual.original_wire);assert.equal(first.id,selector.id);assert.deepEqual(capturePaymentEventRow(first).row,first);
   if(old.db.prepare('SELECT 1 FROM payment_events WHERE id=?').get(selector.id))retainedFirst.update(canonicalJson({id:selector.id,wire:actual.original_wire,sha256:actual.original_sha256,identityDigest:actual.identity_digest})).update('\n');
   else{assert.equal(actual.original_wire,capturedPayment.rowWire);assert.equal(actual.original_sha256,capturedPayment.sha256);}
   digest.update('payment_event_originals\0').update(canonicalJson({id:selector.id,currentWire:capturedPayment.rowWire,projection:expectedProjection})).update('\n');counts.set('payment_event_originals',counts.get('payment_event_originals')!+1);
  }
  if(captured.privateResult){
   for(const name of Object.keys(PRIVATE_RESULT_SOURCE_COLUMNS) as PrivateResultSourceTable[]){await compareNativePrivateResultSourceRow(pg,name,selector.id,captured.privateResult.rows[name]);check();}
   const packet:NativeProjectionRow={table:'private_research_result_identity',keys:['id'],columns:Object.keys(PRIVATE_RESULT_IDENTITY_COLUMNS).map(name=>({name})),row:captured.privateResult.metadata};await boundPrivateRow(pg,packet,check);counts.set(packet.table,counts.get(packet.table)!+1);digest.update(packet.table).update('\0').update(canonicalJson(packet.row)).update('\n');
  }
 }
 for(const name of sidecarNames){assert.equal((await pg.query('SELECT count(*)::text n FROM keryx_storage.'+quote(name))).rows[0].n,String(counts.get(name)));check();}
 return {packets,digest:digest.digest('hex'),retainedPaymentFirstDigest:retainedFirst.digest('hex')};
}
function changesFor(file:ReturnType<typeof fingerprint>,index:ReturnType<typeof indexSpool>,table:string,operation?:TypedDeltaChange['operation']){
 return (function*(){for(const span of index.changes.get(table)??[]){const frame=readFrame(file,span);for(const change of frame.changes as TypedDeltaChange[])if(change.table===table&&(!operation||change.operation===operation))yield change;}})();
}
function preflightChanges(file:ReturnType<typeof fingerprint>,index:ReturnType<typeof indexSpool>,plans:Plan[],native:ReturnType<typeof fixedNativeTables>){
 for(const name of index.changes.keys()){
  const plan=plans.find(p=>p.source.name===name);if(!plan)refuse('unsupported-table-operation');
  for(const change of changesFor(file,index,name)){
   assert(['insert','update','delete'].includes(change.operation));if(protectedChange(change))refuse('protected-dependency');
   assert.equal(change.before===null,change.operation==='insert');assert.equal(change.after===null,change.operation==='delete');
   if(change.operation==='update')for(const column of native.find(t=>t.name===name)!.foreignColumns){const position=plan.source.columns.indexOf(column);assert(position>=0);if(canonicalJson(change.before![position])!==canonicalJson(change.after![position]))refuse('foreign-key-move');}
  }
 }
 for(const span of index.projections){const frame=readFrame(file,span),family=frame.before?.selector.family??frame.after?.selector.family;if(['a2a','private-result'].includes(family))refuse('protected-projection');}
}
async function deleteOldProjections(pg:Client,file:ReturnType<typeof fingerprint>,index:ReturnType<typeof indexSpool>,check:()=>void){
 for(const span of index.projections){const frame=readFrame(file,span);for(const packet of frame.before?.rows??[]){const p=checkedNativeProjectionRow(packet);assert(!p.table.startsWith('a2a_')&&p.table!=='acceptance_original_projection'&&p.table!=='private_research_result_identity');
  const values=p.columns.map(c=>c.kind==='json-null'?JSON.stringify(p.row[c.name]):c.kind==='json'&&p.row[c.name]!==null?JSON.stringify(p.row[c.name]):p.row[c.name]);
  const predicate=p.columns.map((c,i)=>quote(c.name)+' IS NOT DISTINCT FROM '+(c.kind==='hex'?`decode($${i+1},'hex')`:c.kind==='json'||c.kind==='json-null'?`$${i+1}::jsonb`:`$${i+1}`)).join(' AND ');
  assert.equal((await pg.query('DELETE FROM keryx_storage.'+quote(p.table)+' WHERE '+predicate,values)).rowCount,1);check();
 }}
}
async function applyPublicChange(pg:Client,sourceBefore:Source,sourceAfter:Source,plan:Plan,change:TypedDeltaChange,check:()=>void){
 const old=change.before&&projected(sourceBefore,plan,change.before),next=change.after&&projected(sourceAfter,plan,change.after),names=[...plan.source.columns,...(plan.sourceOrder?['source_order']:[])],types=[...plan.types,...(plan.sourceOrder?['bigint' as const]:[])];
 if(change.operation==='insert'){
  assert(next);const keyPositions=plan.keys.map(k=>plan.source.columns.indexOf(k)),keyValues=keyPositions.map(i=>next[i]),absence=plan.keys.map((k,i)=>quote(k)+' IS NOT DISTINCT FROM $'+(next.length+i+1)+'::'+plan.types[keyPositions[i]]).join(' AND ');
  assert.equal((await pg.query('INSERT INTO public.'+quote(plan.source.name)+'('+names.map(quote).join(',')+') SELECT '+types.map((t,i)=>'$'+(i+1)+'::'+t).join(',')+' WHERE NOT EXISTS(SELECT 1 FROM public.'+quote(plan.source.name)+' WHERE '+absence+')',[...next,...keyValues])).rowCount,1);
 }else if(change.operation==='delete'){assert(old);assert.equal((await pg.query('DELETE FROM public.'+quote(plan.source.name)+' WHERE '+whereCells(plan,old),old)).rowCount,1);}
 else{assert(old&&next);assert.equal((await pg.query('UPDATE public.'+quote(plan.source.name)+' SET '+names.map((n,i)=>quote(n)+'=$'+(i+1)+'::'+types[i]).join(',')+' WHERE '+whereCells(plan,old,next.length+1),[...next,...old])).rowCount,1);}
 check();
}
async function installAfterProjections(pg:Client,file:ReturnType<typeof fingerprint>,index:ReturnType<typeof indexSpool>,identityDigest:string,check:()=>void){
 for(const span of index.projections){const frame=readFrame(file,span);for(const packet of frame.after?.rows??[]){await insertNativeSourceProjection(pg,packet);check();await compareNativeSourceProjection(pg,packet);check();}
  if(frame.after?.payment){assert(frame.before===null,'Existing payment originals are a preflight hold');const p=frame.after.payment,id=frame.after.selector.id,{nativeProjectionWire,expectedProjection}=await deriveNativePaymentSourceProjection(pg,id,p);check();
   assert.equal((await pg.query('SELECT count(*)::text n FROM keryx_storage.payment_event_originals WHERE payment_id=$1',[id])).rows[0].n,'0');check();
   await insertNativePaymentSourceOriginal(pg,{payment_id:id,identity_digest:identityDigest,original_wire:p.rowWire,original_sha256:p.sha256,current_wire:p.rowWire,current_sha256:p.sha256,native_projection:expectedProjection,unprojected_fields:[...p.unprojectedFields]},nativeProjectionWire);check();
  }
 }
}
async function applyOfferOrderOnly(pg:Client,before:Source,after:Source,plans:Plan[],file:ReturnType<typeof fingerprint>,index:ReturnType<typeof indexSpool>,check:()=>void){
 let changed=0;const plan=plans.find(p=>p.source.name==='article_offers')!;assert(plan.sourceOrder);const first=snapshotRows(before.db,plan.source,plan.keys),second=snapshotRows(after.db,plan.source,plan.keys);let a=first.next(),b=second.next();
 const key=(row:SnapshotRow)=>plan.keys.map(k=>row[plan.source.columns.indexOf(k)]),order=(x:SnapshotRow,y:SnapshotRow)=>{for(let i=0;i<x.length;i++){assert(x[i][0]==='text'&&y[i][0]==='text');const n=Buffer.compare(Buffer.from(x[i][1]!,'hex'),Buffer.from(y[i][1]!,'hex'));if(n)return n;}return 0;};
 try{for(const span of index.orders){const frame=readFrame(file,span),selected=frame.before?.key??frame.after?.key;assert(Array.isArray(selected));if(index.offerKeys.has(sha(snapshotRowWire(selected))))continue;assert(frame.before&&frame.after);
  while(!a.done&&order(key(a.value),selected)<0)a=first.next();while(!b.done&&order(key(b.value),selected)<0)b=second.next();assert(!a.done&&!b.done&&order(key(a.value),selected)===0&&order(key(b.value),selected)===0);assert.equal(snapshotRowWire(a.value),snapshotRowWire(b.value));
  const old=projected(before,plan,a.value),next=projected(after,plan,b.value);assert.equal(old.at(-1),frame.before.sourceOrder);assert.equal(next.at(-1),frame.after.sourceOrder);
  assert.equal((await pg.query('UPDATE public.article_offers SET source_order=$1::bigint WHERE '+whereCells(plan,old,2),[next.at(-1),...old])).rowCount,1);changed++;check();
 }}finally{first.return(undefined);second.return(undefined);}return changed;
}
/** No Source tuple or flag can qualify a target. All guards are queried again
 * inside the locked transaction before the first public write. */
export function applyHeldNativeCatchup(input:HeldNativeCatchupRequest){const request=capture(input);return apply(request);}
async function apply(request:ReturnType<typeof capture>){
 const startedAt=performance.now(),clock=()=>{if(performance.now()-startedAt>TYPED_SNAPSHOT_DELTA_LIMITS.elapsedMs)refuse('deadline');};
 let prepared:Prepared|undefined,file:ReturnType<typeof fingerprint>|undefined,supplied:ReturnType<typeof fingerprint>|undefined,before:Source|undefined,after:Source|undefined,pg:Client|undefined;
 let stage='source-seal',transaction=false,commitSubmitted=false,acknowledged=false,disposeFailed=false;
 const commitOutcome=()=>acknowledged?'acknowledged' as const:commitSubmitted?'unknown' as const:'not_attempted' as const;
 let priorFirstDigest:string|undefined,publicWrites=0,sidecarPackets=0,selectedPlans:Plan[]|undefined,selectedNative:ReturnType<typeof fixedNativeTables>|undefined;
 const base={dataOnly:true,targetVerified:false,applicationAuthority:false,nativeFactoryQualified:false,completeWriterQualified:false,briefCutoverQualified:false,applicationBackendSwitched:false,automaticRetry:false,paymentActions:0,jobActions:0};
 const check=()=>{clock();before?.verify();after?.verify();file?.verify();};
 const closePg=async()=>{const selected=pg;pg=undefined;if(selected)try{await selected.end();}catch(error){disposeFailed=true;throw error;}};
 const lock=async(client:Client,native:NativeTable[])=>{await client.query('LOCK TABLE '+[...native.map(t=>'public.'+quote(t.name)),...sidecarNames.map(n=>'keryx_storage.'+quote(n)),'keryx_storage.writer'].join(',')+' IN SHARE ROW EXCLUSIVE MODE');check();};
 const inspect=async(plans:Plan[],native:NativeTable[])=>{
  let client:Client|undefined,open=false;try{
   client=new Client(postgresPoolConfiguration(request.r.options));client.on('error',()=>{});await client.connect();check();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');open=true;check();await lock(client,native);await gate(client,before!,check,true);
   const equivalent=async(source:Source)=>{try{await comparePublic(client!,source,plans,native,check);const sidecars=await compareSidecars(client!,source,before!,check);return sidecars.retainedPaymentFirstDigest===priorFirstDigest;}catch{return false;}};
   const allBefore=await equivalent(before!),allAfter=await equivalent(after!);await gate(client,before!,check,true);before!.hash();after!.hash();check();
   // This observes DATA equivalence only. Both-match is explicitly ambiguous.
   return {inspection:'complete' as const,allBefore,allAfter,dataEquivalentAfterOnly:allAfter&&!allBefore,ambiguous:allBefore===allAfter,targetHeld:true};
  }catch{return {inspection:'unavailable' as const,allBefore:false,allAfter:false,dataEquivalentAfterOnly:false,ambiguous:true,targetHeld:null};}
  finally{if(client){if(open)try{await client.query('ROLLBACK');}catch{disposeFailed=true;}try{await client.end();}catch{disposeFailed=true;}}}
 };
 try{
  // Independently regenerate from the actual hashed Source snapshots before
  // constructing any target client. The supplied sealed file is DATA, not proof.
  prepared=await prepareHeldNativeCatchupInput(request.r.source);clock();
  supplied=fingerprint(request.r.sealed.path,request.r.sealed.sha256,HELD_CATCHUP_INPUT_LIMITS.spoolBytes,clock);assert.equal(request.r.sealed.sha256,prepared.sha256);supplied.hash();
  file=fingerprint(prepared.path,prepared.sha256,HELD_CATCHUP_INPUT_LIMITS.spoolBytes,clock);const index=indexSpool(file,clock);assert.equal(index.frames,prepared.frames);
  if(prepared.completion.holds.length)refuse('protected-dependency');
  before=openSource(request.r.source.delta.before,prepared.completion.delta.identityDigest,clock);after=openSource(request.r.source.delta.after,prepared.completion.delta.identityDigest,clock);check();
  const native=fixedNativeTables(request.reference),plans=plansFor(before,after,native,request.reference);selectedNative=native;selectedPlans=plans;preflightChanges(file,index,plans,native);check();
  stage='target-connect';pg=new Client(postgresPoolConfiguration(request.r.options));pg.on('error',()=>{});await pg.connect();check();await gate(pg,before,check,false);
  // LOCK is deliberately the first command after BEGIN. A gate SELECT before
  // the lock could pin an RR snapshot that hides an owner's concurrent commit.
  stage='target-lock';await pg.query('BEGIN ISOLATION LEVEL REPEATABLE READ');transaction=true;check();await lock(pg,native);await gate(pg,before,check,true);await pg.query('SET CONSTRAINTS ALL DEFERRED');check();
  // All old cells and all twelve private families are mandatory, even when no
  // changed row mentions them. Missing/foreign/unprojected originals refuse.
  stage='before-state';const oldPublic=await comparePublic(pg,before,plans,native,check),oldPrivate=await compareSidecars(pg,before,before,check);priorFirstDigest=oldPrivate.retainedPaymentFirstDigest;
  const noChanges=prepared.completion.delta.changes===0&&prepared.completion.affectedProjectionPackets===0&&prepared.completion.affectedOfferOrders===0;
  if(noChanges){before.hash();after.hash();await gate(pg,before,check,true);check();await pg.query('ROLLBACK');transaction=false;check();await closePg();
   return {format:'keryx-held-native-catchup-data-result-v1',...base,outcome:'unchanged' as const,commitOutcome:'not_attempted' as const,targetHeld:true,publicWrites:0,sidecarPackets:0,before:oldPublic,after:oldPublic,retainedPaymentFirstDigest:priorFirstDigest,sourceInputSha256:prepared.sha256};
  }
  stage='old-sidecar-cas';await deleteOldProjections(pg,file,index,check);
  // Deletions reverse the FK graph; new parent rows precede child inserts.
  // FK-column moves and protected original dependencies were refused above.
  for(const operation of ['delete','insert','update'] as const){stage='public-'+operation;for(const plan of operation==='delete'?[...plans].reverse():plans)for(const change of changesFor(file,index,plan.source.name,operation)){await applyPublicChange(pg,before,after,plan,change,check);publicWrites++;}}
  stage='offer-order-cas';publicWrites+=await applyOfferOrderOnly(pg,before,after,plans,file,index,check);
  stage='new-sidecars';await installAfterProjections(pg,file,index,storageIdentityDigest(before.identity),check);sidecarPackets=prepared.completion.affectedProjectionPackets;
  stage='after-state';const newPublic=await comparePublic(pg,after,plans,native,check),newPrivate=await compareSidecars(pg,after,before,check);assert.equal(newPrivate.retainedPaymentFirstDigest,priorFirstDigest);before.hash();after.hash();file.hash();supplied.hash();check();await gate(pg,before,check,true);check();
  stage='commit';commitSubmitted=true;await pg.query('COMMIT');acknowledged=true;transaction=false;check();await closePg();
  return {format:'keryx-held-native-catchup-data-result-v1',...base,outcome:'applied' as const,commitOutcome:'acknowledged' as const,targetHeld:true,publicWrites,sidecarPackets,before:oldPublic,after:newPublic,retainedPaymentFirstDigest:priorFirstDigest,sourceInputSha256:prepared.sha256};
 }catch(error){
  if(commitSubmitted&&!acknowledged){try{await closePg();}catch{}const observation=before&&after&&file&&selectedPlans&&selectedNative?await inspect(selectedPlans,selectedNative):{inspection:'unavailable' as const,allBefore:false,allAfter:false,dataEquivalentAfterOnly:false,ambiguous:true,targetHeld:null};
   return {format:'keryx-held-native-catchup-data-result-v1',...base,outcome:'commit-ack-unknown' as const,commitOutcome:'unknown' as const,publicWrites,sidecarPackets,inspection:observation,sourceInputSha256:prepared?.sha256};
  }
  if(transaction&&pg)try{await pg.query('ROLLBACK');transaction=false;}catch{disposeFailed=true;}
  throw new HeldNativeCatchupRefused(error instanceof HeldNativeCatchupRefused?error.stage:stage,commitOutcome());
 }finally{
  try{await closePg();}catch{disposeFailed=true;}
  // Attempt each owned resource independently. Cleanup must neither leak the
  // remaining resources nor erase the known COMMIT submission/ACK phase.
  for(const resource of [before,after,file,supplied])try{resource?.close();}catch{disposeFailed=true;}
  if(prepared){try{unlinkSync(prepared.path);}catch{disposeFailed=true;}try{rmdirSync(dirname(prepared.path));}catch{disposeFailed=true;}}
  if(disposeFailed)throw new HeldNativeCatchupRefused('dispose',commitOutcome());
 }
}
