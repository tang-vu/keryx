/** Isolated development operator only. No target adoption, application writer,
 * retry, DDL repair, original normalization or production cutover capability. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync,readlinkSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { Client } from 'pg';
import { canonicalJson } from '../../lib/canonical-json';
import { readStorageIdentity } from '../../lib/db/storage-identity-sqlite';
import { storageIdentityDigest } from '../../lib/db/storage-identity';
import { postgresPoolConfiguration,type PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import { NATIVE_READONLY_RUNTIME_PROFILE } from '../../lib/db/postgres/runtime-profile';
import { exportNativePostgresSchemaContract } from './native-contract.mts';
import { snapshotRows,snapshotTables,type SnapshotTable } from './typed-snapshot.mts';
import { nativeMaterializationCell,nativeMaterializationType,nativeMaterializationValueKey,type NativeMaterializationType } from './native-materialization-codec.mts';
type NativeTable={name:string;columns:Array<{name:string;type:string}>;primary_key:string[];parents:string[]};
type Plan={source:SnapshotTable;target:NativeTable;types:NativeMaterializationType[];keys:string[];rows:number;emptyDifferentPrimaryKey:boolean};
export class NativeMaterializationUnavailable extends Error{
 constructor(readonly diagnostic:{stage:string;table:string|null;pgCode:string|null;constraint:string|null;column?:string|null;commitOutcome:'not_attempted'|'unknown'}){super('Native materialization unavailable');}
}
const identifier=(value:string)=>{if(!/^[a-z][a-z0-9_]{0,62}$/.test(value))throw Error('Native materialization identifier refused');return '"'+value+'"';};
export function assertDevelopmentMaterializationContainment(){
 assert.equal(process.platform,'linux');assert.equal(process.version,'v24.22.1');assert.equal(process.getuid!(),0);assert.equal(process.ppid,1);
 for(const [name,expected] of [['memory.max','536870912'],['memory.swap.max','0'],['cpu.max','25000 100000'],['pids.max','32']])assert.equal(readFileSync('/sys/fs/cgroup/'+name,'utf8').trim(),expected);
 const status=readFileSync('/proc/self/status','utf8');assert(/^CapEff:\s+0+$/m.test(status)&&/^NoNewPrivs:\s+1$/m.test(status));
 assert.equal(readFileSync('/proc/net/route','utf8').trim().split('\n').length,1);assert.equal(readlinkSync('/proc/1/exe'),'/usr/bin/timeout');
 const parent=readFileSync('/proc/1/cmdline','utf8').split('\0').filter(Boolean);assert.deepEqual(parent.slice(0,8),['/usr/bin/timeout','--signal=KILL','1800s','node','--no-warnings','--max-old-space-size=256','/child.cjs','--materialize']);
}
/** Every nonempty input table must have an exact native column mapping and PK.
 * The three empty ephemeral writer tables use native transaction IDs. The two
 * empty historical browser layouts require their separate domain producer. */
function planTables(db:DatabaseSync,native:NativeTable[],counts:Map<string,number>):Plan[]{
 const emptyDifferent=new Set(['browser_journal_writer','browser_signing_v2_writer','browser_signing_v3_writer','browser_signing_namespaces','browser_signing_originals']);
 const plans=snapshotTables(db).filter(t=>t.name!=='keryx_storage_identity').map(source=>{try{
  const target=native.find(t=>t.name===source.name);assert(target);const rows=counts.get(source.name);assert(rows!==undefined&&Number.isSafeInteger(rows)&&rows>=0);
  if(emptyDifferent.has(source.name)){assert.equal(rows,0);return null;}
  assert.deepEqual([...source.columns].sort(),target.columns.map(c=>c.name).sort());
  const types=source.columns.map(c=>nativeMaterializationType(target.columns.find(t=>t.name===c)!.type));
  const keys=db.prepare(`PRAGMA table_xinfo(${identifier(source.name)})`).all().filter(r=>typeof r.pk==='number'&&r.pk>0).sort((a,b)=>Number(a.pk)-Number(b.pk)).map(r=>String(r.name));
  const emptyDifferentPrimaryKey=source.name==='browser_signing_queries'&&rows===0;
  if(!emptyDifferentPrimaryKey)assert.deepEqual([...keys].sort(),[...target.primary_key].sort());if(rows)assert(keys.length>0);return {source,target,types,keys,rows,emptyDifferentPrimaryKey};
 }catch{throw new NativeMaterializationUnavailable({stage:'table-plan',table:source.name,pgCode:null,constraint:null,commitOutcome:'not_attempted'});}}).filter((p):p is Plan=>p!==null);
 assert.equal(plans.length,88);const sorted:Plan[]=[],remaining=[...plans];
 while(remaining.length){const index=remaining.findIndex(p=>!p.rows||p.target.parents.every(parent=>parent===p.source.name||!remaining.some(other=>other.rows&&other.source.name===parent)));assert(index>=0,'Native import dependency cycle requires separate qualification');sorted.push(remaining.splice(index,1)[0]);}
 return sorted;
}
function rendering(column:string,type:NativeMaterializationType){
 const c=identifier(column);return type==='timestamp with time zone'?`to_char(${c} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`:type==='date'?`to_char(${c},'YYYY-MM-DD')`:`${c}::text`;
}
function rowKey(plan:Plan,values:readonly (string|null)[]){
 assert.equal(values.length,plan.types.length);return JSON.stringify(values.map((value,i)=>nativeMaterializationValueKey(plan.types[i],value)));
}
export async function materializeNativeSnapshot(db:DatabaseSync,options:PostgresConnectionOptions,referenceWire:string){
 assertDevelopmentMaterializationContainment();assert(db.isTransaction&&db.prepare('PRAGMA query_only').get()?.query_only===1);assert.equal(options.database,'native_materialized');assert.equal(options.role,'postgres');assert.deepEqual(options.endpoint,{kind:'loopback',port:5432});assert(/^[a-f0-9]{48}$/.test(options.password));
 const reference=exportNativePostgresSchemaContract(referenceWire);assert.equal(reference.sha256,NATIVE_READONLY_RUNTIME_PROFILE.catalogSha256);
 const identity=readStorageIdentity(db);assert.equal(identity.authorityMode,'mainnet-real');assert.equal(identity.network,'eip155:5042');
 const pg=new Client(postgresPoolConfiguration(options)),staging=new Client(postgresPoolConfiguration({...options,database:'native_staging'}));pg.on('error',()=>{});staging.on('error',()=>{});let stage='connect',table:string|null=null,commit=false,started=false;
 try{
  await pg.connect();const server=(await pg.query("SELECT current_database() name,session_user role,current_setting('server_version_num') version")).rows[0];assert.equal(server.name,'native_materialized');assert.equal(server.role,'postgres');assert.equal(server.version,'170012');
  stage='pristine-catalog';assert.equal(exportNativePostgresSchemaContract((await pg.query('SELECT keryx_storage.catalog_contract()::text wire')).rows[0].wire).sha256,reference.sha256);
  assert.equal((await pg.query("SELECT mode FROM keryx_storage.control WHERE singleton")).rows[0]?.mode,'held');
  assert.equal((await pg.query('SELECT count(*)::text n FROM keryx_storage.identity')).rows[0].n,'0');assert.equal((await pg.query('SELECT count(*)::text n FROM keryx_storage.source_contract')).rows[0].n,'0');
  const metadata=(await pg.query(`SELECT coalesce(jsonb_agg(t ORDER BY t.name),'[]'::jsonb)::text wire FROM(SELECT c.relname name,
   (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod)) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) columns,
   coalesce((SELECT jsonb_agg(a.attname ORDER BY k.position) FROM pg_constraint p CROSS JOIN LATERAL unnest(p.conkey) WITH ORDINALITY k(number,position) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.number WHERE p.conrelid=c.oid AND p.contype='p'),'[]'::jsonb) primary_key,
   coalesce((SELECT jsonb_agg(r.relname ORDER BY r.relname) FROM pg_constraint p JOIN pg_class r ON r.oid=p.confrelid WHERE p.conrelid=c.oid AND p.contype='f' AND NOT p.condeferrable),'[]'::jsonb) parents
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r')t`)).rows[0].wire;
  assert(typeof metadata==='string'&&Buffer.byteLength(metadata)<=262144);const native=JSON.parse(metadata) as NativeTable[];assert.equal(native.length,94);
  // The runtime rejects every extra namespace. Keep typed originals in a
  // separate operator database; do not add a catalog exception for staging.
  stage='retained-staging';await staging.connect();const retained=await staging.query('SELECT name,row_count::text rows FROM keryx_migration.snapshot_tables ORDER BY name');assert.equal(retained.rowCount,94);
  const counts=new Map<string,number>(retained.rows.map(r=>[r.name,Number(r.rows)])),plans=planTables(db,native,counts);
  stage='pristine-data';const seeds:Record<string,unknown[]>={browser_journal_control:[{id:1,active:false}],browser_signing_v2_control:[{id:1,active:false,min_original_version:2}]};
  for(const t of native){table=t.name;const rows=JSON.parse((await pg.query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb)::text wire FROM(SELECT * FROM public.${identifier(t.name)} LIMIT 2)t`)).rows[0].wire);assert.deepEqual(rows,seeds[t.name]??[]);}
  await pg.query('BEGIN');started=true;await pg.query('SET CONSTRAINTS ALL DEFERRED');
  stage='public-copy';let totalRows=0;const results:Array<{table:string;rows:number;semanticDigest:string;exactRawJsonRows:number}>=[];
  for(const plan of plans){
   table=plan.source.name;let batch:Array<{cells:(string|null)[]}>=[],bytes=0,copied=0;
   const projection=plan.types.map((type,i)=>`(r.cells->>${i})::${type}`).join(','),columns=plan.source.columns.map(identifier).join(',');
   const bootstrap=Object.hasOwn(seeds,table);if(bootstrap)assert.equal(plan.rows,1);
   // Exactly two independently verified fresh singleton controls already exist
   // in SOURCE DDL. Their retained no-delete/no-reinsert gates stay intact.
   // Update their existing id=1 cells; every other table uses plain INSERT.
   const statement=bootstrap?`UPDATE public.${identifier(table)} target SET ${plan.source.columns.map((c,i)=>`${identifier(c)}=(r.cells->>${i})::${plan.types[i]}`).join(',')} FROM jsonb_to_recordset($1::jsonb) r(cells jsonb) WHERE target.id=(r.cells->>${plan.source.columns.indexOf('id')})::integer`:`INSERT INTO public.${identifier(table)}(${columns}) SELECT ${projection} FROM jsonb_to_recordset($1::jsonb) r(cells jsonb)`;
   const flush=async()=>{if(!batch.length)return;const result=await pg.query(statement,[JSON.stringify(batch)]);assert.equal(result.rowCount,batch.length);batch=[];bytes=0;};
   for(const row of snapshotRows(db,plan.source)){
    const cells=row.map((cell,i)=>nativeMaterializationCell(cell,plan.types[i])),size=Buffer.byteLength(JSON.stringify(cells));
    if(batch.length>=64||bytes+size>1048576)await flush();batch.push({cells});bytes+=size;copied++;
   }await flush();assert.equal(copied,plan.rows);totalRows+=copied;
   // Re-read actual stored native cells in SOURCE primary-key order. A cursor
   // bounds pages and avoids OFFSET growth; neither entire table is held in JS.
   stage='public-re-read';const digest=createHash('sha256'),nativeDigest=createHash('sha256');let seen=0,page:(string|null)[][]=[],offset=0;
   const selected=plan.source.columns.map((column,i)=>rendering(column,plan.types[i])).join(','),ordered=plan.keys.map(k=>{const type=plan.types[plan.source.columns.indexOf(k)];return identifier(k)+(['text','keryx_storage.native_uuid_text'].includes(type)?' COLLATE "C"':'');}).join(',');
   await pg.query(`DECLARE materialized_rows NO SCROLL CURSOR FOR SELECT json_build_array(${selected})::text wire FROM public.${identifier(table)}${ordered?' ORDER BY '+ordered:''}`);
   for(const row of snapshotRows(db,plan.source,plan.keys)){
    if(offset>=page.length){const next=await pg.query('FETCH FORWARD 8 FROM materialized_rows');page=next.rows.map(r=>JSON.parse(r.wire));offset=0;}
    assert(offset<page.length);const expected=row.map((cell,i)=>nativeMaterializationCell(cell,plan.types[i])),actual=page[offset++];
    const sourceKey=rowKey(plan,expected),targetKey=rowKey(plan,actual);assert.equal(targetKey,sourceKey);digest.update(sourceKey).update('\n');nativeDigest.update(targetKey).update('\n');seen++;
   }assert.equal(offset,page.length);assert.equal((await pg.query('FETCH FORWARD 1 FROM materialized_rows')).rowCount,0);await pg.query('CLOSE materialized_rows');assert.equal(seen,copied);
   const semanticDigest=digest.digest('hex');assert.equal(nativeDigest.digest('hex'),semanticDigest);results.push({table,rows:copied,semanticDigest,exactRawJsonRows:plan.types.includes('json')?copied:0});stage='public-copy';
  }
  stage='identity-binding';await pg.query('INSERT INTO keryx_storage.identity VALUES(true,$1::jsonb,$2)',[canonicalJson(identity),storageIdentityDigest(identity)]);
  await pg.query('INSERT INTO keryx_storage.source_contract VALUES(true,$1::jsonb,$2)',[reference.canonicalJson,reference.sha256]);
  stage='final-catalog';assert.equal(exportNativePostgresSchemaContract((await pg.query('SELECT keryx_storage.catalog_contract()::text wire')).rows[0].wire).sha256,reference.sha256);
  stage='commit';commit=true;await pg.query('COMMIT');started=false;
  return {format:'keryx-native-public-materialization-v1',publicTables:93,emptyDifferentLayouts:5,emptyDifferentPrimaryKeys:plans.filter(p=>p.emptyDifferentPrimaryKey).map(p=>p.source.name),copiedTables:plans.length,totalRows,tables:results,typedOriginalStagingRetained:true,typedStagingDatabase:'native_staging',logicalIdentityPreserved:true,sourceCatalogSha256:reference.sha256,writerMode:'held',publicApplicationTablesMaterialized:true,sourceDerivedProjectionsMaterialized:false,applicationMaterialized:false,applicationBackendSwitched:false,completeWriterQualified:false,productionChanged:false,paymentActions:0,jobActions:0};
 }catch(error){
  if(started)try{await pg.query('ROLLBACK');}catch{}
  const field=(key:string)=>{const v=error&&typeof error==='object'?Reflect.get(error,key):null;return typeof v==='string'&&/^[a-zA-Z0-9_]{1,128}$/.test(v)?v:null;};
  if(error instanceof NativeMaterializationUnavailable)throw error;
  throw new NativeMaterializationUnavailable({stage,table,pgCode:field('code'),constraint:field('constraint'),column:field('column'),commitOutcome:commit?'unknown':'not_attempted'});
 }finally{const closed=await Promise.allSettled([pg.end(),staging.end()]);if(closed.some(r=>r.status==='rejected'))throw new NativeMaterializationUnavailable({stage:'dispose',table:null,pgCode:null,constraint:null,commitOutcome:commit?'unknown':'not_attempted'});}
}
