/** Genuine fresh SQLite + recording PG protocol model. This neither qualifies
 * PostgreSQL/cgroup containment nor creates a genuine Native facade/proof. */
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { copyFileSync,readFileSync,rmdirSync,unlinkSync } from 'node:fs';
const model=vi.hoisted(()=>{
 vi.stubEnv('KERYX_NETWORK','arc');vi.stubEnv('NEXT_PUBLIC_KERYX_NETWORK','arc');vi.stubEnv('KERYX_FORCE_OFFLINE','0');
 for(const k of ['KERYX_REGISTRY_ADDRESS','NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS','KERYX_REGISTRY_READ_ADDRESS','NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS'])vi.stubEnv(k,'0x'+'ef'.repeat(20));
 for(const k of ['AGENT_FUNDER_PRIVATE_KEY','BUYER_PRIVATE_KEY','DEPLOYER_PRIVATE_KEY','KERYX_PRIVATE_TREASURY_PRIVATE_KEY','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','CONTENT_MASTER_KEY','KERYX_REGISTRY_ORIGINS','NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS'])vi.stubEnv(k,'');
 for(const k of ['KERYX_STORAGE_MANIFEST','KERYX_SQLITE_PATH','KERYX_USDC_ADDRESS','KERYX_GATEWAY_WALLET','KERYX_GATEWAY_MINTER','KERYX_MAX_TIMEOUT_SECONDS'])vi.stubEnv(k,undefined);
 const fetch=vi.fn(()=>{throw Error('No outbound Source I/O');});vi.stubGlobal('fetch',fetch);
 return {fetch,public:new Map<string,Record<string,unknown>[]>(),private:new Map<string,Record<string,unknown>[]>(),jsonNull:new Map<string,Set<string>>(),reference:null as unknown,identity:null as unknown,queries:[] as string[],clients:0,bad:'',writes:0,saved:null as unknown};
});
import { canonicalJson } from '../../lib/canonical-json';
import { storageIdentityDigest } from '../../lib/db/storage-identity';
import { registerStorageCapability } from '../../lib/db/storage-identity-sqlite';
import { nativeMaterializationProfile } from '../../lib/db/postgres/runtime-profile';
import { PRIVATE_RESULT_IDENTITY_COLUMNS } from './private-result-source.mts';
import { PAYMENT_EVENT_FIELDS } from '../../lib/db/postgres/payment-events-packet';
import { materializeNativeProjections } from './materialize-native-projections.mts';
import { nativeMaterializationCell,nativeMaterializationQueryCell,type NativeMaterializationType } from './native-materialization-codec.mts';
import { nativeMaterializationPaymentCells } from './payment-materialization-codec.mts';
import { snapshotRows,snapshotTables } from './typed-snapshot.mts';
import { inspectTypedDeltaSnapshot } from './typed-snapshot-delta.mts';
import { prepareHeldNativeCatchupInput } from './held-native-catchup-input.mts';
import { prepareHeldCatchupSynthetic,disposeHeldCatchupSynthetic } from './qualify-held-native-catchup.mts';
import { applyHeldNativeCatchup } from './apply-held-native-catchup.mts';
const current=()=>nativeMaterializationProfile('development-current510-data-only').catalogSha256;
vi.mock('./native-contract.mts',()=>({exportNativePostgresSchemaContract:(wire:string)=>{if(!wire.startsWith('recording-'))throw Error('Recording descriptor only');return {...model.reference as object,sha256:wire==='recording-target'&&model.bad==='catalog'?'f'.repeat(64):current()};}}));
vi.mock('./materialize-native-snapshot.mts',async original=>({...await original<typeof import('./materialize-native-snapshot.mts')>(),assertDevelopmentMaterializationContainment:()=>{}}));
const copy=()=>({public:structuredClone(model.public),private:structuredClone(model.private),jsonNull:structuredClone(model.jsonNull)});
const restore=(s:ReturnType<typeof copy>)=>{model.public=s.public;model.private=s.private;model.jsonNull=s.jsonNull;};
function tableName(sql:string,schema:'public'|'keryx_storage'){return new RegExp(schema+'\\.(?:"([a-z_0-9]+)"|([a-z_0-9]+))').exec(sql)?.slice(1).find(Boolean)!;}
function expectedValue(sql:string,parameter:number,value:unknown){return new RegExp('\\$'+parameter+'::jsonb').test(sql)&&value!==null?JSON.parse(String(value)):value;}
function matches(sql:string,row:Record<string,unknown>,values:unknown[]){
 const clauses=[...sql.matchAll(/"([a-z_0-9]+)"(?:::text)? IS NOT DISTINCT FROM (?:decode\(\$(\d+),'hex'\)|\$(\d+)(?:::[a-z._ ]+)?)/g)];
 return clauses.every(c=>{const number=Number(c[2]??c[3]);let actual=row[c[1]];if(typeof actual==='string'&&new RegExp('\\$'+number+'::jsonb').test(sql))actual=JSON.parse(actual);return canonicalJson(actual)===canonicalJson(expectedValue(sql,number,values[number-1]));});
}
vi.mock('pg',()=>({Client:class{
 cursor:Record<string,unknown>[]=[];offset=0;constructor(){model.clients++;}on(){}async connect(){}async end(){}
 async query(sql:string,values:unknown[]=[]){
  model.queries.push(sql);const result=(rows:Record<string,unknown>[])=>({rows,rowCount:rows.length});
  if(sql.startsWith('BEGIN')){model.saved=copy();return result([]);}if(sql==='ROLLBACK'){restore(model.saved as ReturnType<typeof copy>);return result([]);}if(sql==='COMMIT'){if(model.bad==='ack-before')restore(model.saved as ReturnType<typeof copy>);if(model.bad.startsWith('ack-'))throw Error('Synthetic lost ACK');return result([]);}
  if(sql.startsWith('LOCK TABLE')||sql.startsWith('SET CONSTRAINTS')||sql==='CLOSE catchup_rows')return result([]);
  if(sql.includes('current_database() name'))return result([{name:'native_materialized',role:'postgres',current_role:'postgres',version:'170012'}]);
  if(sql.startsWith('SELECT mode FROM'))return result([{mode:model.bad==='mode'?'active':'held'}]);
  if(sql.includes('SELECT identity::text'))return result([{wire:JSON.stringify(model.bad==='identity'?{...model.identity as object,storageId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'}:model.identity),identity_digest:storageIdentityDigest(model.identity)}]);
  if(sql.includes('SELECT source_digest'))return result([{source_digest:current()}]);
  if(sql.includes('catalog_contract()'))return result([{wire:'recording-target'}]);
  if(sql.includes('pg_stat_activity'))return result([{n:model.bad==='writers'?'1':'0'}]);
  if(sql.startsWith('SELECT count(*)')){const privateTable=tableName(sql,'keryx_storage'),publicTable=tableName(sql,'public');if(privateTable==='writer')return result([{n:'0'}]);const rows=(privateTable?model.private:model.public).get(privateTable??publicTable)??[];return result([{n:String(sql.includes(' WHERE payment_id=$1')?rows.filter(r=>r.payment_id===values[0]).length:rows.length)}]);}
  if(sql.startsWith('DECLARE catchup_rows')){const name=tableName(sql,'public'),select=/json_build_array\((.*?)\)::text/.exec(sql)![1],columns=[...select.matchAll(/"([a-z_0-9]+)"/g)].map(m=>m[1]);
   const ordered=sql.split(' ORDER BY ')[1]?.match(/"[a-z_0-9]+"/g)?.map(k=>k.slice(1,-1))??[];this.cursor=[...(model.public.get(name)??[])].sort((a,b)=>{for(const k of ordered){const n=Buffer.compare(Buffer.from(String(a[k])),Buffer.from(String(b[k])));if(n)return n;}return 0;}).map(row=>({wire:JSON.stringify(columns.map(c=>row[c]))}));this.offset=0;return result([]);}
  if(sql.startsWith('FETCH FORWARD')){const n=Number(sql.split(' ')[2]),rows=this.cursor.slice(this.offset,this.offset+n);this.offset+=rows.length;return result(rows);}
  if(sql.includes('jsonb_populate_record(NULL::public.payment_events')){
   const expected=JSON.parse(String(values[1])),row=model.public.get('payment_events')?.find(r=>r.id===values[0]),okay=row&&PAYMENT_EVENT_FIELDS.every(k=>row[k]===(expected[k]===null?null:String(expected[k])));
   return result(row?[{expected_projection:JSON.stringify(expected),actual_projection:JSON.stringify(expected),projection_matches:!!okay}]:[]);
  }
  if(sql.startsWith('SELECT payment_id,identity_digest,original_wire')){const row=model.private.get('payment_event_originals')?.find(r=>r.payment_id===values[0]);return result(row?[{...row,unprojected_fields:JSON.stringify(row.unprojected_fields),nulls:JSON.stringify(Array(8).fill(false))}]:[]);}
  if(sql.startsWith('SELECT (')){const name=tableName(sql,'keryx_storage'),rows=model.private.get(name)??[],keys=[...sql.matchAll(/(?:"([a-z_0-9]+)"|payment_id)=\$(\d+)/g)];return result(rows.filter(r=>keys.every(k=>r[k[1]??'payment_id']===values[Number(k[2])-1])).map(()=>({bounded:true})));}
  if(sql.startsWith('INSERT INTO keryx_storage.')){
   const name=tableName(sql,'keryx_storage'),columns=/\(([^)]+)\)/.exec(sql)![1].match(/[a-z_0-9]+/g)!;let row:Record<string,unknown>;
   if(name==='payment_event_originals')row=Object.fromEntries(columns.map((k,i)=>[k,values[i]]));else{row=Object.fromEntries(columns.map((k,i)=>[k,expectedValue(sql,i+1,values[i])]));model.jsonNull.set(name,new Set(columns.filter((k,i)=>row[k]===null&&values[i]!==null)));}
   model.private.set(name,[...(model.private.get(name)??[]),row]);if(model.bad==='after-sidecar'&&model.writes)row.original_sha256='f'.repeat(64);return {rows:[],rowCount:1};
  }
  if(sql.startsWith('SELECT to_jsonb(t)')){
   const columns=/FROM \(SELECT (.+?) FROM/.exec(sql)![1].match(/[a-z_0-9]+/g)!,name=tableName(sql,'keryx_storage'),keys=[...sql.matchAll(/"([a-z_0-9]+)"=\$(\d+)/g)],row=model.private.get(name)?.find(r=>keys.every(k=>r[k[1]]===values[Number(k[2])-1]));if(!row)return result([]);
   const selected=Object.fromEntries(columns.map(k=>[k,row[k]===null?null:['answer_scalar','question_search'].includes(k)?'\\x'+row[k]:row[k]]));return result([{wire:JSON.stringify(selected),nulls:JSON.stringify(columns.map(k=>row[k]===null&&!model.jsonNull.get(name)?.has(k)))}]);
  }
  if(sql.startsWith('DELETE FROM keryx_storage.')){const name=tableName(sql,'keryx_storage'),rows=model.private.get(name)??[],removed=rows.filter(r=>matches(sql,r,values));model.private.set(name,rows.filter(r=>!removed.includes(r)));return {rows:[],rowCount:removed.length};}
  if(sql.startsWith('INSERT INTO public.')){const name=tableName(sql,'public'),columns=/\(([^)]+)\)/.exec(sql)![1].match(/[a-z_0-9]+/g)!,rows=model.public.get(name)??[];const absent=sql.split(' WHERE NOT EXISTS')[1],duplicate=rows.some(r=>matches(absent,r,values));if(duplicate)return {rows:[],rowCount:0};rows.push(Object.fromEntries(columns.map((c,i)=>[c,values[i]])));model.public.set(name,rows);model.writes++;return {rows:[],rowCount:1};}
  if(sql.startsWith('UPDATE public.')||sql.startsWith('DELETE FROM public.')){
   if(model.bad==='cas')return {rows:[],rowCount:0};const name=tableName(sql,'public'),rows=model.public.get(name)??[],where=sql.split(' WHERE ')[1],selected=rows.filter(r=>matches(where,r,values));
   if(sql.startsWith('UPDATE')){const changes=[...sql.split(' WHERE ')[0].matchAll(/(?:"([a-z_0-9]+)"|source_order)=\$(\d+)/g)];for(const row of selected)for(const m of changes)row[m[1]??'source_order']=values[Number(m[2])-1];}else model.public.set(name,rows.filter(r=>!selected.includes(r)));model.writes+=selected.length;return {rows:[],rowCount:selected.length};
  }
  throw Error('Unrecognized recording protocol statement');
 }
}}));
type Fixture=Awaited<ReturnType<typeof prepareHeldCatchupSynthetic>>;
const fixtures:Fixture[]=[],extraSpools:string[]=[];
const options={endpoint:{kind:'loopback' as const,port:5432},database:'native_materialized',role:'postgres',password:'ab'.repeat(24)};
const digest=(wire:string|Buffer)=>createHash('sha256').update(wire).digest('hex');
beforeEach(()=>{model.public=new Map();model.private=new Map();model.jsonNull=new Map();model.queries=[];model.clients=0;model.bad='';model.writes=0;model.saved=null;});
afterEach(()=>{expect(model.fetch).not.toHaveBeenCalled();for(const path of extraSpools.splice(0)){unlinkSync(path);rmdirSync(dirname(path));}for(const f of fixtures.splice(0))disposeHeldCatchupSynthetic(f);});
async function fresh(){const f=await prepareHeldCatchupSynthetic();fixtures.push(f);return f;}
function typeFor(table:string,column:string,declared:string){if(table==='article_offers'&&column==='source_order')return 'bigint';if(table==='query_runs'&&column==='data')return 'json';if(table==='query_runs'&&column==='economics_data')return 'jsonb';if(table==='private_research_executions'&&column==='worker_id')return 'keryx_storage.native_uuid_text';if((table==='payment_events'&&column==='settled')||column==='active')return 'boolean';return /INT/i.test(declared)?'bigint':/REAL/i.test(declared)?'double precision':'text';}
async function baseline(f:Fixture){
 const db=new DatabaseSync(f.source.delta.before.path,{readOnly:true});try{db.exec('PRAGMA query_only=ON;BEGIN');const tables=snapshotTables(db).filter(t=>t.name!=='keryx_storage_identity'),relations:Record<string,unknown>[]=[],columns:Record<string,unknown>[]=[],constraints:Record<string,unknown>[]=[];
  for(const table of tables){relations.push({schema:'public',name:table.name,kind:'r'});const info=db.prepare('PRAGMA table_info("'+table.name+'")').all(),types=table.columns.map(c=>typeFor(table.name,c,String(info.find(x=>x.name===c)!.type)) as NativeMaterializationType);for(const [i,c]of table.columns.entries())columns.push({schema:'public',relation:table.name,name:c,type:types[i],position:i+1});
   const keys=info.filter(x=>Number(x.pk)>0).sort((a,b)=>Number(a.pk)-Number(b.pk)).map(x=>String(x.name));if(keys.length)constraints.push({schema:'public',relation:table.name,type:'p',definition:'PRIMARY KEY ('+keys.join(', ')+')'});
   const rows:Record<string,unknown>[]=[];for(const row of snapshotRows(db,table,keys)){const values=table.name==='payment_events'?nativeMaterializationPaymentCells(db,table,row,types):row.map((cell,i)=>table.name==='query_runs'?nativeMaterializationQueryCell(cell,types[i],table.columns[i]):nativeMaterializationCell(cell,types[i]));const target=Object.fromEntries(table.columns.map((c,i)=>[c,values[i]]));if(table.name==='article_offers'){const st=db.prepare('SELECT rowid value FROM article_offers WHERE source_id=? AND item_id=?');st.setReadBigInts(true);target.source_order=String(st.get(target.source_id,target.item_id)!.value);}rows.push(target);}model.public.set(table.name,rows);
   if(table.name==='article_offers')columns.push({schema:'public',relation:table.name,name:'source_order',type:'bigint',position:table.columns.length+1});
  }
  relations.push({schema:'public',name:'native_extra',kind:'r'});columns.push({schema:'public',relation:'native_extra',name:'id',type:'text',position:1});constraints.push({schema:'public',relation:'native_extra',type:'p',definition:'PRIMARY KEY (id)'});model.public.set('native_extra',[]);
  for(const name of ['browser_signing_namespaces','browser_signing_queries'])for(const c of columns)if(c.relation===name&&['ceiling_micro','job_limit','allocated_micro','jobs','spent_micro'].includes(String(c.name)))c.type='bigint';
  const privateName='private_research_result_identity';relations.push({schema:'keryx_storage',name:privateName,kind:'r'},{schema:'keryx_storage',name:'payment_event_originals',kind:'r'});
  for(const [name,type]of Object.entries(PRIVATE_RESULT_IDENTITY_COLUMNS))columns.push({schema:'keryx_storage',relation:privateName,name,type});
  for(const [name,type]of [['payment_id','text'],['identity_digest','text'],['original_wire','json'],['original_sha256','text'],['current_wire','json'],['current_sha256','text'],['native_projection','jsonb'],['unprojected_fields','text[]']])columns.push({schema:'keryx_storage',relation:'payment_event_originals',name,type});
  constraints.push({schema:'keryx_storage',relation:privateName,type:'p',definition:'PRIMARY KEY (id)'},{schema:'keryx_storage',relation:privateName,type:'f',referencedSchema:'public',referencedRelation:'private_research_results',definition:'FOREIGN KEY (id) REFERENCES public.private_research_results(id) ON DELETE CASCADE'});
  model.reference={sha256:current(),metadata:{sections:{relations,columns,constraints,triggers:[['native_private_result_identity_writer','write_fence'],['native_private_result_identity_retained','immutable']].map(([name,fn])=>({schema:'keryx_storage',relation:privateName,name,functionSchema:'keryx_storage',function:fn,enabled:'O'})),functions:[{schema:'keryx_storage',name:'write_fence',source:'Private result Source identity fence v1 NEW.question_sha256 private_research_save_result'}]}}};model.identity=f.identity;
  await materializeNativeProjections(db,options,'development-current510-data-only');model.queries=[];model.clients=0;model.writes=0;
 }finally{db.close();}
}
function request(f:Fixture){return {source:f.source,sealed:f.sealed,options,referenceWire:'recording-source'};}
async function recapture(f:Fixture,beforeEdit?:(db:DatabaseSync)=>void,afterEdit?:(db:DatabaseSync)=>void){
 for(const [side,edit]of [['before',beforeEdit],['after',afterEdit]] as const)if(edit){const db=new DatabaseSync(f.source.delta[side].path);try{registerStorageCapability(db,f.identity,()=>true);edit(db);}finally{db.close();}}
 for(const side of ['before','after'] as const)f.source.delta[side].sha256=digest(readFileSync(f.source.delta[side].path));const inventory=await inspectTypedDeltaSnapshot(f.source.delta.before);
 const wire=canonicalJson({...JSON.parse(f.source.delta.priorTarget.wire),snapshotSha256:inventory.snapshotSha256,schemaSha256:inventory.schemaSha256,identityDigest:inventory.identityDigest,dataDigest:inventory.dataDigest});f.source.delta.priorTarget={wire,expectedSha256:digest(wire)};
 const sealed=await prepareHeldNativeCatchupInput(f.source);extraSpools.push(sealed.path);return {...request(f),sealed:{path:sealed.path,sha256:sealed.sha256}};
}
it('CAS-applies actual Source query scalars + old/new sidecars and rowid-only offer order in one transaction',async()=>{
 const f=await fresh();await baseline(f);const beforeHash=digest(readFileSync(f.source.delta.before.path)),afterHash=digest(readFileSync(f.source.delta.after.path));const result=await applyHeldNativeCatchup(request(f));
 expect(result).toMatchObject({outcome:'applied',commitOutcome:'acknowledged',dataOnly:true,targetVerified:false,nativeFactoryQualified:false,briefCutoverQualified:false});expect(result.publicWrites).toBe(4);expect(model.queries.filter(s=>s==='COMMIT')).toHaveLength(1);expect(model.queries.some(s=>s.includes('set_config')||s.includes('INSERT INTO keryx_storage.writer')||/CREATE|ALTER|DISABLE/.test(s))).toBe(false);
 expect(model.public.get('article_offers')![0].source_order).toBe('71');expect(model.private.get('run_privacy_projection')).toHaveLength(2);expect(digest(readFileSync(f.source.delta.before.path))).toBe(beforeHash);expect(digest(readFileSync(f.source.delta.after.path))).toBe(afterHash);
});
it.each(['mode','identity','catalog','writers'])('refuses independent target %s drift before any data write',async bad=>{const f=await fresh();await baseline(f);const old=copy();model.bad=bad;await expect(applyHeldNativeCatchup(request(f))).rejects.toMatchObject({stage:'target-connect',commitOutcome:'not_attempted'});expect(model.writes).toBe(0);expect(model.public).toEqual(old.public);expect(model.private).toEqual(old.private);expect(model.queries).not.toContain('COMMIT');});
it.each(['public','private'])('requires the entire old %s census and never repairs missing/stale data',async kind=>{const f=await fresh();await baseline(f);if(kind==='public')model.public.get('query_runs')![0].answer='foreign';else model.private.get('run_privacy_projection')![0].original_sha256='f'.repeat(64);const old=copy();await expect(applyHeldNativeCatchup(request(f))).rejects.toMatchObject({stage:'before-state'});expect(model.writes).toBe(0);expect(model.public).toEqual(old.public);expect(model.private).toEqual(old.private);});
it.each(['cas','after-sidecar'])('rolls back every sidecar/public mutation on %s failure',async bad=>{const f=await fresh();await baseline(f);const old=copy();model.bad=bad;await expect(applyHeldNativeCatchup(request(f))).rejects.toMatchObject({commitOutcome:'not_attempted'});expect(model.public).toEqual(old.public);expect(model.private).toEqual(old.private);expect(model.queries).toContain('ROLLBACK');expect(model.queries).not.toContain('COMMIT');});
it.each(['ack-after','ack-before'])('lost COMMIT ACK is never retried; complete %s state is DATA observation only',async bad=>{const f=await fresh();await baseline(f);model.bad=bad;const result=await applyHeldNativeCatchup(request(f));expect(result).toMatchObject({outcome:'commit-ack-unknown',commitOutcome:'unknown',automaticRetry:false,targetVerified:false,inspection:{inspection:'complete',allBefore:bad==='ack-before',allAfter:bad==='ack-after',dataEquivalentAfterOnly:bad==='ack-after',targetHeld:true}});expect(model.queries.filter(s=>s==='COMMIT')).toHaveLength(1);});
it('rejects a stale sealed-file SHA and Source drift before constructing a target client',async()=>{const f=await fresh();await baseline(f);await expect(applyHeldNativeCatchup({...request(f),sealed:{...f.sealed,sha256:'f'.repeat(64)}})).rejects.toMatchObject({stage:'source-seal'});expect(model.clients).toBe(0);expect(model.writes).toBe(0);});

it('zero typed/projection/order changes compare the complete old state and avoid COMMIT',async()=>{
 const f=await fresh();await baseline(f);const source={...f.source,delta:{...f.source.delta,after:{...f.source.delta.before}}},sealed=await prepareHeldNativeCatchupInput(source);extraSpools.push(sealed.path);
 const result=await applyHeldNativeCatchup({...request(f),source,sealed:{path:sealed.path,sha256:sealed.sha256}});expect(result).toMatchObject({outcome:'unchanged',commitOutcome:'not_attempted',publicWrites:0,automaticRetry:false,targetVerified:false});expect(model.queries).not.toContain('COMMIT');expect(model.writes).toBe(0);
});
const addPayment=(db:DatabaseSync)=>db.prepare("INSERT INTO payment_events(id,created_at,kind,source_name,amount_usdc,network,settled,settlement_status) VALUES(?,?,'creator',?,0.01,'eip155:5042',0,'pending')").run('synthetic-payment','2026-11-15T00:00:00.000Z','Source\0name');
it('holds an existing payment CURRENT update before any target connection or public write',async()=>{
 const f=await fresh(),r=await recapture(f,addPayment,db=>{addPayment(db);db.prepare('UPDATE payment_events SET source_name=?').run('Changed Source name');});await baseline(f);const old=copy();await expect(applyHeldNativeCatchup(r)).rejects.toMatchObject({stage:'protected-dependency',commitOutcome:'not_attempted'});expect(model.clients).toBe(0);expect(model.writes).toBe(0);expect(model.private).toEqual(old.private);
});
it('new payment IDs use observed Source first/current bytes plus PG-derived projection only',async()=>{
 const f=await fresh(),r=await recapture(f,undefined,addPayment);await baseline(f);const result=await applyHeldNativeCatchup(r);expect(result.outcome).toBe('applied');const retained=model.private.get('payment_event_originals')![0];expect(retained.original_wire).toBe(retained.current_wire);expect(retained.original_sha256).toBe(digest(String(retained.original_wire)));expect(String(retained.original_wire)).toContain('\\u0000');expect(retained.unprojected_fields).toContain('source_name');expect(model.queries.some(s=>s.startsWith('DELETE FROM keryx_storage.')&&s.includes('payment_event_originals'))).toBe(false);
});
it('both-match after lost ACK remains UNKNOWN even when public JSONB semantics are equal',async()=>{
 const f=await fresh();copyFileSync(f.source.delta.before.path,f.source.delta.after.path);
 const r=await recapture(f,db=>db.prepare('UPDATE query_runs SET economics_data=?').run('{"n":1}'),db=>db.prepare('UPDATE query_runs SET economics_data=?').run(' { "n" : 1 } '));await baseline(f);model.bad='ack-after';
 const result=await applyHeldNativeCatchup(r);expect(result).toMatchObject({outcome:'commit-ack-unknown',commitOutcome:'unknown',targetVerified:false,inspection:{inspection:'complete',allBefore:true,allAfter:true,dataEquivalentAfterOnly:false,ambiguous:true}});expect(model.queries.filter(s=>s==='COMMIT')).toHaveLength(1);
});
it('foreign-key column moves are explicit preflight holds',async()=>{
 const f=await fresh(),r=await recapture(f,undefined,db=>db.prepare('UPDATE query_runs SET parent_id=? WHERE id=?').run('synthetic-other-parent','synthetic-catchup-a'));await baseline(f);
 const reference=model.reference as {metadata:{sections:{constraints:unknown[]}}};reference.metadata.sections.constraints.push({schema:'public',relation:'query_runs',type:'f',definition:'FOREIGN KEY (parent_id) REFERENCES public.query_runs(id)',deferrable:false,referencedSchema:'public',referencedRelation:'query_runs'});
 await expect(applyHeldNativeCatchup(r)).rejects.toMatchObject({stage:'foreign-key-move'});expect(model.clients).toBe(0);expect(model.writes).toBe(0);
});
