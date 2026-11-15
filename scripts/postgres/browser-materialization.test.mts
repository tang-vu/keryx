/** Actual SQLite physical/corpus tests and pure planner tests. Descriptor data
 * below is a shape vector, never a native profile/provenance qualification. */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import type { Client } from 'pg';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { insertStorageIdentity } from '../../lib/db/storage-identity-sqlite';
import { STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity } from '../../lib/db/storage-identity';
import { NATIVE_READONLY_RUNTIME_PROFILE } from '../../lib/db/postgres/runtime-profile';
import { snapshotTables,snapshotRows,snapshotRowWire } from './typed-snapshot.mts';
import { supportsBrowserMaterialization,planNativeMaterializationTables } from './materialize-native-snapshot.mts';
import { seedBrowserMaterializationFixture,assertBrowserMaterializationFixture } from './browser-materialization-fixture.mts';
import { captureObservedPaymentSource } from './payment-original-source.mts';

const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',deploymentId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',storageId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',network:'eip155:5042',authorityMode:'mainnet-real',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,enrollmentId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',enrolledAt:'2026-10-01T00:00:00.000Z',provenanceDigest:'dd'.repeat(32)};
const shape={browser_signing_namespaces:{namespace:'text',owner:'text',signer:'text',service:'text',network:'text',ceiling_micro:'bigint',job_limit:'bigint',allocated_micro:'bigint',jobs:'bigint',proof:'text'},browser_signing_queries:{query_id:'text',namespace:'text',policy_id:'text',request_nonce:'text',session_id:'text',grant_epoch:'text',proof:'text',proof_digest:'text',ceiling_micro:'bigint',spent_micro:'bigint'},browser_signing_originals:{nonce:'text',query_id:'text',original:'text',input:'text'}};
function reference(fresh=true){
 const metadata={format:'shape-vector-only',sections:{relations:fresh?[{schema:'keryx_storage',name:'payment_event_originals',kind:'r'}]:[],columns:[...Object.entries(shape).flatMap(([relation,fields])=>Object.entries(fields).map(([name,type])=>({schema:'public',relation,name,type}))),...(fresh?[['payment_id','text'],['identity_digest','text'],['original_wire','json'],['original_sha256','text'],['current_wire','json'],['current_sha256','text'],['native_projection','jsonb'],['unprojected_fields','text[]']].map(([name,type])=>({schema:'keryx_storage',relation:'payment_event_originals',name,type})):[])],constraints:Object.keys(shape).map(relation=>({schema:'public',relation,type:'p',definition:'PRIMARY KEY ('+(relation==='browser_signing_namespaces'?'namespace':relation==='browser_signing_queries'?'query_id':'nonce')+')'}))}};
 return {sha256:NATIVE_READONLY_RUNTIME_PROFILE.catalogSha256,metadata} as unknown as Parameters<typeof supportsBrowserMaterialization>[0];
}
async function fixture(run:(db:DatabaseSync)=>Promise<void>|void,seed=true,writer?:string,floor3=false){
 const db=new DatabaseSync(':memory:');try{db.exec('BEGIN');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);if(seed)await seedBrowserMaterializationFixture(db);if(writer)db.exec('INSERT INTO '+writer+' VALUES(1)');if(floor3)db.exec('UPDATE browser_signing_v2_control SET min_original_version=3 WHERE id=1');insertStorageIdentity(db,identity);db.exec('COMMIT;PRAGMA query_only=ON;BEGIN');await run(db);}finally{db.close();}
}
function nativeInputs(db:DatabaseSync){
 const tables=snapshotTables(db),native=tables.filter(t=>t.name!=='keryx_storage_identity').map(t=>({name:t.name,columns:t.columns.map(name=>({name,type:'text'})),primary_key:db.prepare('PRAGMA table_info('+t.name+')').all().filter(c=>Number(c.pk)>0).sort((a,b)=>Number(a.pk)-Number(b.pk)).map(c=>String(c.name)),parents:db.prepare('PRAGMA foreign_key_list('+t.name+')').all().map(r=>String(r.table))})),counts=new Map(tables.map(t=>[t.name,Number(db.prepare('SELECT count(*) n FROM '+t.name).get()!.n)]));
 for(const t of native)if(t.name.endsWith('_writer')&&['browser_journal_writer','browser_signing_v2_writer','browser_signing_v3_writer'].includes(t.name)){t.columns=[{name:'transaction_id',type:'bigint'}];t.primary_key=['transaction_id'];}
 return {native,counts};
}
function typedDigest(db:DatabaseSync){const h=createHash('sha256');for(const table of snapshotTables(db)){h.update(table.name).update('\n');for(const row of snapshotRows(db,table))h.update(snapshotRowWire(row)).update('\n');}return h.digest('hex');}
it('classifies only the digest-pinned exact permanent layouts; legacy, mismatched columns and PKs stay closed',()=>{
 expect(supportsBrowserMaterialization(reference())).toBe(true);expect(supportsBrowserMaterialization(reference(false))).toBe(false);
 const bad={...reference(),sha256:'0'.repeat(64)};expect(()=>supportsBrowserMaterialization(bad)).toThrow();
 const columns=reference();(columns.metadata.sections as any).columns.find((c:any)=>c.relation==='browser_signing_originals'&&c.name==='input').type='jsonb';expect(supportsBrowserMaterialization(columns)).toBe(false);
 const pk=reference();(pk.metadata.sections as any).constraints.find((c:any)=>c.relation==='browser_signing_queries').definition='PRIMARY KEY (namespace, query_id)';expect(supportsBrowserMaterialization(pk)).toBe(false);
});
it('plans all nonempty permanent Source rows with exact keys and preserves typed94 bytes/digests',async()=>fixture(async db=>{
 const before=typedDigest(db),{native,counts}=nativeInputs(db),plans=planNativeMaterializationTables(db,native,counts,reference());expect(snapshotTables(db)).toHaveLength(94);expect(plans).toHaveLength(90);
 for(const name of Object.keys(shape)){const p=plans.find(p=>p.source.name===name)!;expect(p.rows).toBe(1);expect(p.source.columns).toHaveLength(name==='browser_signing_originals'?4:10);expect(p.emptyDifferentPrimaryKey).toBe(false);}
 expect(plans.find(p=>p.source.name==='browser_signing_queries')!.keys).toEqual(['query_id']);expect(plans.some(p=>['browser_journal_writer','browser_signing_v2_writer','browser_signing_v3_writer'].includes(p.source.name))).toBe(false);
 const order=plans.map(p=>p.source.name);expect(order.indexOf('browser_signing_namespaces')).toBeLessThan(order.indexOf('browser_signing_queries'));expect(order.indexOf('browser_signing_queries')).toBeLessThan(order.indexOf('browser_signing_originals'));
 expect(typedDigest(db)).toBe(before);
}));
it('retains the legacy88 plan and empty permanent-layout refusals',async()=>{
 await fixture(db=>{const {native,counts}=nativeInputs(db),q=native.find(n=>n.name==='browser_signing_queries')!;q.primary_key=['namespace','query_id'];const plans=planNativeMaterializationTables(db,native,counts,reference(false));expect(plans).toHaveLength(88);expect(plans.find(p=>p.source.name==='browser_signing_queries')!.emptyDifferentPrimaryKey).toBe(true);},false);
 await fixture(db=>{const {native,counts}=nativeInputs(db);expect(()=>planNativeMaterializationTables(db,native,counts,reference(false))).toThrow();});
});
it.each(['browser_journal_writer','browser_signing_v2_writer','browser_signing_v3_writer'])('refuses a committed nonempty Source writer %s',async writer=>fixture(db=>{const {native,counts}=nativeInputs(db);expect(()=>planNativeMaterializationTables(db,native,counts,reference())).toThrow();},true,writer));
it('captures genuine Source raw originals/proof/input and pending-only payment NULL-shadow vectors',async()=>fixture(db=>{
 const original=db.prepare('SELECT original,input FROM browser_signing_originals').get()!;expect(String(original.original).startsWith(' \n')).toBe(true);expect(String(original.input)).toContain('\\u0000');expect(String(original.input)).toContain('\\ud800');expect(String(original.input)).toContain('\\udfff');
 expect(db.prepare('SELECT network FROM browser_signing_namespaces').get()!.network).toBe('eip155:5042002');expect(db.prepare('SELECT count(*) n FROM payment_events').get()!.n).toBe(3);expect(db.prepare("SELECT count(*) n FROM payment_events WHERE settled<>0 OR settlement_status<>'pending'").get()!.n).toBe(0);
 const raw=captureObservedPaymentSource(db,'synthetic-materialization-payment-raw')!,canonical=captureObservedPaymentSource(db,'synthetic-materialization-payment-canonical')!;expect(raw.row.created_at).toBe('2026-11-14T07:00:00.123456789+07:00');expect(raw.projection.created_at).toBeNull();expect(raw.row.rationale).toBe('null');expect(canonical.row.rationale).toBeNull();expect(canonical.row.source_name).toBe('\uFEFFsynthetic Source');
}));
it('compares raw browser readback without reserializing proof/input/original or copying Source writer IDs',async()=>fixture(async db=>{
 const client=(drift=false)=>({async query(sql:string){const count=/count\(\*\).*public\.([a-z0-9_]+)/.exec(sql);if(count)return {rows:[{n:'0'}],rowCount:1};const table=/FROM public\.([a-z0-9_]+)/.exec(sql)![1],keys=db.prepare('PRAGMA table_info('+table+')').all().map(c=>String(c.name)),rows=db.prepare('SELECT * FROM '+table).all().map(row=>Object.fromEntries(keys.map(k=>[k,row[k]===null?null:String(row[k])])));if(drift&&table==='browser_signing_originals')rows[0].input=String(rows[0].input).trim();return {rows,rowCount:rows.length};}} as unknown as Client);
 expect(await assertBrowserMaterializationFixture(db,client())).toMatchObject({rawBrowserRows:3,sourceWriterRowsCopied:0});await expect(assertBrowserMaterializationFixture(db,client(true))).rejects.toThrow('Browser Source raw cells changed');
}));
it('retains actual Source floor3/ever-active controls without transient writers in the copy plan',async()=>fixture(db=>{
 const {native,counts}=nativeInputs(db);expect(planNativeMaterializationTables(db,native,counts,reference())).toHaveLength(90);expect(db.prepare('SELECT * FROM browser_signing_v2_barrier').get()).toEqual({id:1,ever_active:1,min_original_version:3});
},true,undefined,true));
it('keeps owner intake exceptions transaction-local, insert-only, scoped, and zero-function-growth',()=>{
 const sql=readFileSync(new URL('../../ops/keryx-postgres/browser-journal-schema.sql',import.meta.url),'utf8'),child=readFileSync(new URL('./native-materialization-child.mts',import.meta.url),'utf8'),snapshot=readFileSync(new URL('./materialize-native-snapshot.mts',import.meta.url),'utf8');
 expect(Buffer.byteLength(sql.replaceAll('\r\n','\n'))).toBeLessThanOrEqual(16384);expect(sql).not.toMatch(/CREATE FUNCTION/);expect(sql).toContain("TG_OP='INSERT'");expect(sql).toContain("session_user='postgres'");expect(sql).toContain("current_setting('keryx.source_browser_intake',true)=txid_current()::text");expect(sql).toContain('OLD.active OR OLD.min_original_version<>2');expect(sql).toContain("IF TG_OP='DELETE' THEN RAISE EXCEPTION 'browser signing history is retained'");
 expect(snapshot.indexOf("set_config('keryx.source_browser_intake'")).toBeGreaterThan(snapshot.indexOf('LOCK TABLE ${native.map'));expect(child).toContain('reference=exportNativePostgresSchemaContract(packet.referenceWire),browser=supportsBrowserMaterialization(reference)');expect(child).toContain('await synthetic(browser,privateResults)');expect(child).toContain('if(browser)await seedBrowserMaterializationFixture(db)');expect(child).toContain('assert.equal(projections.payments,3)');
});
