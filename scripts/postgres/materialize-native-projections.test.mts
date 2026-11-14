/** Intake/query-protocol unit test with actual SQLite Source cells and a
 * recording driver stand-in. This does not qualify PostgreSQL or containment. */
import { DatabaseSync } from 'node:sqlite';
import { beforeEach,expect,it,vi } from 'vitest';
import { ARC_MAINNET_PROFILE } from '../../lib/arc-network-profile';
import { syntheticA2aOriginal } from '../../lib/db/a2a-original-fixture';
import { monthlyOrderToRow } from '../../lib/db/research-monthly';
import { insertStorageIdentity } from '../../lib/db/storage-identity-sqlite';
import { STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity } from '../../lib/db/storage-identity';
import { materializeNativeProjections } from './materialize-native-projections.mts';

const driver=vi.hoisted(()=>({rows:new Map<string,Record<string,unknown>[]>(),queries:[] as string[],identity:undefined as unknown,changeWire:false}));
vi.mock('../../lib/db/postgres/runtime-profile',()=>({NATIVE_READONLY_RUNTIME_PROFILE:{catalogSha256:'a'.repeat(64)}}));
vi.mock('./native-contract.mts',()=>({exportNativePostgresSchemaContract:()=>({sha256:'a'.repeat(64)})}));
vi.mock('./materialize-native-snapshot.mts',()=>({assertDevelopmentMaterializationContainment:()=>{},NativeMaterializationUnavailable:class extends Error{constructor(readonly diagnostic:unknown){super('Native materialization unavailable');}}}));
vi.mock('pg',()=>({Client:class{
 on(){} async connect(){} async end(){}
 async query(sql:string,values:unknown[]=[]){
  driver.queries.push(sql);
  const result=(rows:Record<string,unknown>[])=>({rows,rowCount:rows.length});
  if(sql==='BEGIN'||sql==='COMMIT')return result([]);
  if(sql==='ROLLBACK'){driver.rows.clear();return result([]);}
  if(sql.includes('SELECT identity::text'))return result([{wire:JSON.stringify(driver.identity)}]);
  if(sql.includes('SELECT mode'))return result([{mode:'held'}]);
  if(sql.includes('SELECT source_digest'))return result([{source_digest:'a'.repeat(64)}]);
  if(sql.includes('catalog_contract()'))return result([{wire:'recording-driver-catalog'}]);
  if(sql.startsWith('SELECT count(*)')){const table=/keryx_storage\."([a-z0-9_]+)"/.exec(sql)![1];return result([{n:String(driver.rows.get(table)?.length??0)}]);}
  if(sql.startsWith('INSERT INTO')){
   const [,table,columns]=/keryx_storage\."([a-z0-9_]+)"\(([^)]+)\)/.exec(sql)!;
   const keys=columns.match(/[a-z0-9_]+/g)!,json=new Set([...sql.matchAll(/\$(\d+)::jsonb/g)].map(m=>Number(m[1])-1));
   const row=Object.fromEntries(keys.map((key,i)=>[key,json.has(i)&&values[i]!==null?JSON.parse(String(values[i])):values[i]]));
   driver.rows.set(table,[...(driver.rows.get(table)??[]),row]);return {rows:[],rowCount:1};
  }
  if(sql.startsWith('SELECT to_jsonb(t)')){
   const [,columns,table]=/FROM \(SELECT (.+?) FROM keryx_storage\."([a-z0-9_]+)"/.exec(sql)!;
   const keys=columns.match(/[a-z0-9_]+/g)!,stored=driver.rows.get(table)![0];
   // A native derivative exists, but is never an implicit Source input column.
   const target={...stored,generated_native_date:'unexpected-native-derivative'};
   const selected=Object.fromEntries(keys.map(key=>[key,(target as Record<string,unknown>)[key]]));
   if(driver.changeWire&&table==='a2a_original_time_projection')selected.created_at='2026-11-14T00:00:00.000Z';
   return result([{wire:JSON.stringify(selected),nulls:JSON.stringify(keys.map(key=>stored[key]===null))}]);
  }
  throw Error('Unexpected recording-driver query');
 }
}}));
const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',deploymentId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',storageId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',network:'eip155:5042',authorityMode:'mainnet-real',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,enrollmentId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',enrolledAt:'2026-10-01T00:00:00.000Z',provenanceDigest:'dd'.repeat(32)};
beforeEach(()=>{driver.rows.clear();driver.queries=[];driver.identity=identity;driver.changeWire=false;});
it.each([false,true])('imports independently captured Source time wires and detects same-instant byte drift (changed=%s)',async changed=>{
 const db=new DatabaseSync(':memory:');try{
  insertStorageIdentity(db,identity);
  db.exec('CREATE TABLE query_runs(id TEXT);CREATE TABLE decision_review_records(id TEXT,run_id TEXT,network TEXT,input_json TEXT);CREATE TABLE topic_watches(wallet TEXT,id TEXT);CREATE TABLE deliverable_acceptance_store(singleton INTEGER,id TEXT);');
  db.exec("INSERT INTO deliverable_acceptance_store VALUES(1,'3821e833-f4ca-44d3-a944-0cf892ab0b85')");
  const original={...syntheticA2aOriginal(1872,ARC_MAINNET_PROFILE).order,createdAt:'2026-11-14T07:00:00.000+07:00',updatedAt:'2026-11-14T00:00:00.123456789Z',startedAt:'2026-11-14T00:00:00.1234+00:00'};
  const row=monthlyOrderToRow(original);for(const key of ['request_data','package_data','response_data','resolution_data'])if(row[key]!==null)row[key]=JSON.stringify(row[key]);
  const keys=Object.keys(row);db.exec('CREATE TABLE a2a_orders('+keys.map(key=>key+' '+(typeof row[key]==='number'?'REAL':'TEXT')).join(',')+')');
  db.prepare('INSERT INTO a2a_orders VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(key=>row[key] as string|number|null));
  db.exec('PRAGMA query_only=ON;BEGIN');driver.changeWire=changed;
  const pending=materializeNativeProjections(db,{endpoint:{kind:'loopback',port:5432},database:'native_materialized',role:'postgres',password:'b'.repeat(48)});
  if(changed){await expect(pending).rejects.toMatchObject({diagnostic:{stage:'projection-re-read',table:'a2a_original_time_projection',commitOutcome:'not_attempted'}});expect(driver.rows.size).toBe(0);}
  else{
   const result=await pending;expect(result.orders).toBe(1);expect(result.domains.find(d=>d.table==='a2a_original_time_projection')?.rows).toBe(1);
   expect(driver.rows.get('a2a_original_time_projection')![0]).toMatchObject({created_at:original.createdAt,updated_at:original.updatedAt,started_at:original.startedAt});
   expect(driver.queries.filter(q=>q.startsWith('SELECT to_jsonb(t)')).every(q=>q.includes('FROM (SELECT '))).toBe(true);
  }
 }finally{db.close();}
});
