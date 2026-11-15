/** Real SQLite Source + recording protocol driver only. These tests do not
 * qualify PostgreSQL, containment or an installed native writer. */
import { DatabaseSync } from 'node:sqlite';
import { beforeEach,expect,it,vi } from 'vitest';
import { canonicalJson } from '../../lib/canonical-json';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { insertStorageIdentity } from '../../lib/db/storage-identity-sqlite';
import { STORAGE_MAINNET_PROFILE_DIGEST,storageIdentityDigest,type StorageIdentity } from '../../lib/db/storage-identity';
import { capturePaymentEventRow,PAYMENT_EVENT_FIELDS,type PaymentEventRow } from '../../lib/db/postgres/payment-events-packet';
import { syntheticA2aOriginal } from '../../lib/db/a2a-original-fixture';
import { ARC_MAINNET_PROFILE } from '../../lib/arc-network-profile';
import { monthlyOrderToRow } from '../../lib/db/research-monthly';
import { captureObservedPaymentSource } from './payment-original-source.mts';
import { materializeNativeProjections } from './materialize-native-projections.mts';

const state=vi.hoisted(()=>({present:true,badShape:false,rows:new Map<string,Record<string,unknown>[]>(),saved:new Map<string,Record<string,unknown>[]>(),publicRows:new Map<string,Record<string,unknown>>(),queries:[] as string[],identity:undefined as unknown,drift:'',hook:undefined as undefined|(()=>void)}));
vi.mock('../../lib/db/postgres/runtime-profile',()=>({NATIVE_READONLY_RUNTIME_PROFILE:{catalogSha256:'a'.repeat(64)}}));
vi.mock('./native-contract.mts',()=>({exportNativePostgresSchemaContract:()=>({sha256:'a'.repeat(64),metadata:{sections:{relations:state.present?[{schema:'keryx_storage',name:'payment_event_originals',kind:'r'}]:[],columns:state.present?[['payment_id','text'],['identity_digest','text'],['original_wire',state.badShape?'jsonb':'json'],['original_sha256','text'],['current_wire','json'],['current_sha256','text'],['native_projection','jsonb'],['unprojected_fields','text[]']].map(([name,type])=>({schema:'keryx_storage',relation:'payment_event_originals',name,type})):[]}}})}));
vi.mock('./materialize-native-snapshot.mts',()=>({assertDevelopmentMaterializationContainment:()=>{},NativeMaterializationUnavailable:class extends Error{constructor(readonly diagnostic:unknown){super('Native materialization unavailable');}}}));
vi.mock('pg',()=>({Client:class{
 on(){}async connect(){}async end(){}
 async query(sql:string,values:unknown[]=[]){
  state.queries.push(sql);const result=(rows:Record<string,unknown>[])=>({rows,rowCount:rows.length});
  if(sql==='BEGIN'){state.saved=new Map([...state.rows].map(([key,rows])=>[key,structuredClone(rows)]));return result([]);}if(sql==='COMMIT')return result([]);if(sql==='ROLLBACK'){state.rows=new Map(state.saved);return result([]);}if(sql.startsWith('LOCK TABLE '))return result([]);
  if(sql.includes('SELECT identity::text'))return result([{wire:JSON.stringify(state.identity)}]);if(sql.includes('SELECT mode'))return result([{mode:'held'}]);if(sql.includes('SELECT source_digest'))return result([{source_digest:'a'.repeat(64)}]);if(sql.includes('catalog_contract()'))return result([{wire:'recording-profile'}]);
  if(sql.startsWith('SELECT count(*)')){if(sql.includes('FROM public.payment_events'))return result([{n:String(state.publicRows.size)}]);const name=/keryx_storage\."([a-z0-9_]+)"/.exec(sql)![1];return result([{n:String(state.rows.get(name)?.length??0)}]);}
  if(sql.startsWith('SELECT to_jsonb(expected)')){expect(sql).toContain('jsonb_populate_record(NULL::public.payment_events,$2::jsonb)');expect(sql).toContain('to_jsonb(p) IS NOT DISTINCT FROM to_jsonb(expected)');expect(sql).toContain('FOR SHARE OF p');const actual=state.publicRows.get(String(values[0]));state.hook?.();return actual?result([{expected_projection:String(values[1]),actual_projection:state.drift==='numeric-public'?JSON.stringify(actual).replace('"amount_usdc":0.01','"amount_usdc":0.0100000000000000001'):JSON.stringify(actual),projection_matches:state.drift!=='numeric-public'&&canonicalJson(actual)===canonicalJson(JSON.parse(String(values[1])))}]):result([]);}
  if(sql.startsWith('INSERT INTO keryx_storage."payment_event_originals"')){
   expect(sql).toContain('$3::json');expect(sql).toContain('$5::json');expect(sql).not.toContain('$3::jsonb');const [payment_id,identity_digest,original_wire,original_sha256,current_wire,current_sha256,projection,unprojected_fields]=values;
   const row={payment_id,identity_digest,original_wire,original_sha256,current_wire,current_sha256,native_projection:JSON.parse(String(projection)),unprojected_fields};state.rows.set('payment_event_originals',[...(state.rows.get('payment_event_originals')??[]),row]);return result([{}]);
  }
  if(sql.startsWith('SELECT payment_id,identity_digest,original_wire::text')){
   expect(sql).not.toContain('to_jsonb');const row=state.rows.get('payment_event_originals')!.find(r=>r.payment_id===values[0])!,actual:Record<string,unknown>={...row,native_projection:JSON.stringify(row.native_projection),unprojected_fields:JSON.stringify(row.unprojected_fields),nulls:JSON.stringify(Array(8).fill(false))};
   if(state.drift==='wire')actual.current_wire=String(actual.current_wire)+' ';if(state.drift==='sha')actual.original_sha256='0'.repeat(64);if(state.drift==='identity')actual.identity_digest='0'.repeat(64);if(state.drift==='projection')actual.native_projection=JSON.stringify({...row.native_projection as object,payee:'changed'});if(state.drift==='numeric-private')actual.native_projection=String(actual.native_projection).replace('"amount_usdc":0.01','"amount_usdc":0.0100000000000000001');if(state.drift==='fields')actual.unprojected_fields='[]';if(state.drift==='nulls')actual.nulls='[false,false,true,false,false,false,false,false]';return result([actual]);
  }
  if(sql.startsWith('INSERT INTO')){const [,name,columns]=/keryx_storage\."([a-z0-9_]+)"\(([^)]+)\)/.exec(sql)!,keys=columns.match(/[a-z0-9_]+/g)!,json=new Set([...sql.matchAll(/\$(\d+)::jsonb/g)].map(m=>Number(m[1])-1)),row=Object.fromEntries(keys.map((key,i)=>[key,json.has(i)&&values[i]!==null?JSON.parse(String(values[i])):values[i]]));state.rows.set(name,[...(state.rows.get(name)??[]),row]);return result([{}]);}
  if(sql.startsWith('SELECT to_jsonb(t)')){const [,columns,name]=/FROM \(SELECT (.+?) FROM keryx_storage\."([a-z0-9_]+)"/.exec(sql)!,keys=columns.match(/[a-z0-9_]+/g)!,row=state.rows.get(name)![0];return result([{wire:JSON.stringify(Object.fromEntries(keys.map(k=>[k,row[k]]))),nulls:JSON.stringify(keys.map(k=>row[k]===null))}]);}
  throw Error('Unexpected protocol driver statement');
 }
}}));
const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',deploymentId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',storageId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',network:'eip155:5042',authorityMode:'mainnet-real',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,enrollmentId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',enrolledAt:'2026-10-01T00:00:00.000Z',provenanceDigest:'dd'.repeat(32)};
beforeEach(()=>{state.present=true;state.badShape=false;state.rows.clear();state.saved.clear();state.publicRows.clear();state.queries=[];state.identity=identity;state.drift='';state.hook=undefined;});
async function fixture(work:(db:DatabaseSync)=>Promise<void>){
 const db=new DatabaseSync(':memory:');try{
  db.exec('BEGIN');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);
  const row:PaymentEventRow={id:'synthetic-source-payment',created_at:'2026-11-15T01:00:00.123456789+01:00',kind:'citation',query_id:'synthetic-query',source_id:'synthetic-source',source_name:'\uFEFFactual\0Source',payer:'0x'+'11'.repeat(20),payee:'0x'+'22'.repeat(20),amount_usdc:.01,weight:null,rationale:'actual\0metadata\ud800',tx_hash:null,network:'eip155:5042',settled:0,settlement_status:'pending',authorization_id:null,authorization_expires_at:'source invalid date',grant_epoch:null,origin:'engine',item_id:null,item_title:null,item_url:null,content_version:null,item_published_at:null,offer_id:null,list_price_usdc:null,authorization_phase:null};
  db.prepare(`INSERT INTO payment_events(${PAYMENT_EVENT_FIELDS.join(',')}) VALUES(${PAYMENT_EVENT_FIELDS.map(()=>'?').join(',')})`).run(...PAYMENT_EVENT_FIELDS.map(k=>row[k]));
  const observed=db.prepare('SELECT * FROM payment_events').get() as PaymentEventRow,projection=capturePaymentEventRow(observed).projection;state.publicRows.set(String(row.id),{...projection,settled:false});
  // Existing A2A derivatives are written first, so a later payment error must
  // roll those back too. These are Source fixture bytes, not native authority.
  const order=monthlyOrderToRow(syntheticA2aOriginal(1872,ARC_MAINNET_PROFILE).order);for(const key of ['request_data','package_data','response_data','resolution_data'])if(order[key]!==null)order[key]=JSON.stringify(order[key]);const keys=Object.keys(order);db.prepare(`INSERT INTO a2a_orders(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>order[k] as string|number|null));
  insertStorageIdentity(db,identity);db.exec('COMMIT;PRAGMA query_only=ON;BEGIN');await work(db);
 }finally{db.close();}
}
const materialize=(db:DatabaseSync)=>materializeNativeProjections(db,{endpoint:{kind:'loopback',port:5432},database:'native_materialized',role:'postgres',password:'b'.repeat(48)});
it('captures actual27 Source cells, exact raw bytes and typed NULL projections without reconstructing from Native',async()=>fixture(async db=>{
 const before=db.prepare('SELECT * FROM payment_events').get()!,captured=captureObservedPaymentSource(db,String(before.id))!;expect(Object.keys(captured.row)).toHaveLength(27);expect(captured.row).toEqual(before);expect(JSON.parse(captured.rowWire)).toEqual(before);expect(captured.row.source_name).toBe('\uFEFFactual\0Source');expect(captured.row.rationale).toBe('actual\0metadata\ufffd');expect(captured.projection.created_at).toBeNull();expect(captured.unprojectedFields).toEqual(['authorization_expires_at','created_at','rationale','source_name']);
 const report=await materialize(db);expect(report).toMatchObject({paymentEventOriginalsPresent:true,payments:1,completeApplicationWriterQualified:false});expect(report.domains).toHaveLength(11);const saved=state.rows.get('payment_event_originals')![0];expect(saved).toMatchObject({identity_digest:storageIdentityDigest(identity),original_wire:captured.rowWire,current_wire:captured.rowWire,original_sha256:captured.sha256,current_sha256:captured.sha256});expect(saved.native_projection).toEqual(state.publicRows.get(String(before.id)));expect(db.prepare('SELECT * FROM payment_events').get()).toEqual(before);
 const begin=state.queries.indexOf('BEGIN'),firstInsert=state.queries.findIndex(q=>q.startsWith('INSERT INTO'));expect(state.queries.filter((q,i)=>q.startsWith('SELECT count(*)')&&i<firstInsert)).toHaveLength(11);expect(state.queries.findIndex(q=>q.startsWith('SELECT count(*)'))).toBeGreaterThan(begin);expect(state.queries).toContain('COMMIT');
}));
it('keeps the qualified legacy ten-table path explicit when the pinned schema has no payment originals',async()=>fixture(async db=>{
 state.present=false;const report=await materialize(db);expect(report).toMatchObject({paymentEventOriginalsPresent:false,payments:0});expect(report.domains).toHaveLength(10);expect(state.queries.some(q=>q.includes('payment_event_originals'))).toBe(false);
}));
it.each(['wire','sha','identity','projection','numeric-private','fields','nulls'])('rolls back all existing and payment derivatives on exact readback drift (%s)',async drift=>fixture(async db=>{
 state.drift=drift;await expect(materialize(db)).rejects.toMatchObject({diagnostic:{stage:'payment-original-re-read',table:'payment_event_originals',commitOutcome:'not_attempted'}});expect(state.rows.size).toBe(0);expect(state.queries.some(q=>q.startsWith('INSERT INTO keryx_storage."a2a_original_cell_projection"'))).toBe(true);expect(state.queries).not.toContain('COMMIT');expect(state.queries).toContain('ROLLBACK');
}));
it('honors exact native numeric inequality even when JavaScript JSON numbers round equal',async()=>fixture(async db=>{
 expect(JSON.parse('0.0100000000000000001')).toBe(JSON.parse('0.01'));state.drift='numeric-public';await expect(materialize(db)).rejects.toMatchObject({diagnostic:{stage:'payment-public-compare',commitOutcome:'not_attempted'}});expect(state.rows.size).toBe(0);expect(state.queries.some(q=>q.startsWith('INSERT INTO keryx_storage."payment_event_originals"'))).toBe(false);
}));
it.each(['payment_event_originals','a2a_original_cell_projection'])('refuses any retained private projection before inserting and preserves it (%s)',async table=>fixture(async db=>{
 const original={retained:'required original'};state.rows.set(table,[original]);await expect(materialize(db)).rejects.toMatchObject({diagnostic:{stage:'projection-preflight',table}});expect(state.rows.get(table)).toEqual([original]);expect(state.queries.some(q=>q.startsWith('INSERT INTO'))).toBe(false);
}));
it.each(['missing','changed','extra'])('requires complete exact public projection coverage from captured Source (%s)',async change=>fixture(async db=>{
 const id='synthetic-source-payment';if(change==='missing')state.publicRows.delete(id);else if(change==='changed')state.publicRows.set(id,{...state.publicRows.get(id)!,amount_usdc:99});else state.publicRows.set('unexpected',{id:'unexpected'});
 await expect(materialize(db)).rejects.toMatchObject({diagnostic:{commitOutcome:'not_attempted'}});expect(state.rows.size).toBe(0);expect(state.queries).not.toContain('COMMIT');
}));
it('refuses changed private schema, a lost Source transaction or a lost query_only pin',async()=>fixture(async db=>{
 state.badShape=true;await expect(materialize(db)).rejects.toThrow();expect(state.queries.some(q=>q.startsWith('INSERT INTO'))).toBe(false);state.badShape=false;state.hook=()=>db.exec('ROLLBACK');await expect(materialize(db)).rejects.toThrow();expect(state.rows.size).toBe(0);db.exec('BEGIN;PRAGMA query_only=OFF');await expect(materialize(db)).rejects.toThrow();
}));
it('refuses malformed Source UTF8, extra/missing cells, oversized bytes and changed storage classes',()=>{
 const db=new DatabaseSync(':memory:');try{
  const fields=PAYMENT_EVENT_FIELDS.map(k=>k+(k==='amount_usdc'||k==='settled'?' NUMERIC':' TEXT'));db.exec('CREATE TABLE payment_events('+fields.join(',')+')');
  const row=Object.fromEntries(PAYMENT_EVENT_FIELDS.map(k=>[k,null]));Object.assign(row,{id:'source',settled:0,settlement_status:'pending',amount_usdc:.01});db.prepare('INSERT INTO payment_events VALUES('+PAYMENT_EVENT_FIELDS.map(()=>'?').join(',')+')').run(...PAYMENT_EVENT_FIELDS.map(k=>row[k]));
  expect(captureObservedPaymentSource(db,'missing')).toBeNull();db.exec("UPDATE payment_events SET source_name=CAST(x'ff' AS TEXT)");expect(()=>captureObservedPaymentSource(db,'source')).toThrow();db.exec("UPDATE payment_events SET source_name=CAST(x'00ff' AS BLOB)");expect(()=>captureObservedPaymentSource(db,'source')).toThrow();db.exec("UPDATE payment_events SET source_name=zeroblob(1048577)");expect(()=>captureObservedPaymentSource(db,'source')).toThrow();db.exec('UPDATE payment_events SET source_name=NULL;ALTER TABLE payment_events ADD COLUMN unexpected TEXT');expect(()=>captureObservedPaymentSource(db,'source')).toThrow();db.exec('ALTER TABLE payment_events DROP COLUMN unexpected;ALTER TABLE payment_events DROP COLUMN offer_id');expect(()=>captureObservedPaymentSource(db,'source')).toThrow();
 }finally{db.close();}
});
