import { expect,it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createHash,randomUUID } from 'node:crypto';
import { mkdtempSync,existsSync,unlinkSync,rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson } from '../../canonical-json';
import { publicReferenceItemId,type PublicReference } from '../../public-references/catalog-contract';
import type { PublicReferenceItem } from '../../public-references/archive';
import { installMainnetApplicationSchema } from '../mainnet-application-schema';
import { installNativeUserDomainSchema } from '../native-user-domain-schema';
import { insertStorageIdentity,installStorageFences } from '../storage-identity-sqlite';
import { openVerifiedSqliteStorage,assertVerifiedSqliteConnection } from '../storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../enrolled-sqlite-schema-profile';
import { STORAGE_MAINNET_PROFILE_DIGEST,validateStorageIdentity } from '../storage-identity';
import { SqliteAdapter } from '../sqlite-adapter';
import { upsertSqlitePublicReference,archiveSqlitePublicReferenceItems,querySqlitePublicReferenceItems,readSqlitePublicReference } from '../public-reference-archive';
import { decodeReference,normalizeItem } from '../public-reference-archive-contract';
import { captureReferenceUpsert,captureReferenceArchive,referenceArchiveSelector,archiveWireSha256,decodeReferenceArchiveFrame,prepareReferenceArchiveMutation,captureReferenceArchiveQuery,finishReferenceArchivePage,type ReferenceArchiveCapture } from './reference-archive-packet';

const referenceId='public:portable-archive',at='2026-11-14T00:00:00.000Z';
function item(n:number,edit:Partial<PublicReferenceItem>={}):PublicReferenceItem {const link=`https://public.example/items/${n}`;return {id:publicReferenceItemId(referenceId,link),link,title:'Ａlpha alpha Unicode café',summary:'alpha beta',content:'alpha gamma retained\0text\ud800',publishedAt:at,deliveryKind:'excerpt',...edit};}
function publisher(items:PublicReferenceItem[]=[],active=true):PublicReference{return {id:referenceId,name:'Public\ud800 publisher',url:'https://public.example/',rssUrl:'https://public.example/feed',description:'Public context\0metadata',tags:['synthetic'],active,items,refreshedAt:at};}
function frame(db:DatabaseSync,captured:ReferenceArchiveCapture){const selector=referenceArchiveSelector(captured),row=db.prepare('SELECT * FROM public_references WHERE id=?').get(referenceId),ids=new Set(selector.itemIds);if(captured.action==='upsert'&&row)for(const item of decodeReference(row).items)ids.add(normalizeItem(referenceId,item).id);selector.itemIds=[...ids].sort();const articles=db.prepare('SELECT a.*,v.snapshot,v.collection_kind FROM public_reference_articles a LEFT JOIN public_reference_article_versions v ON v.reference_id=a.reference_id AND v.item_id=a.item_id AND v.revision=a.current_revision WHERE a.reference_id=? ORDER BY a.item_id').all(referenceId).filter(row=>ids.has(String(row.item_id))),wire=JSON.stringify({selector,publisher:row??null,articles});return decodeReferenceArchiveFrame({wire,sha256:archiveWireSha256(wire)},selector);}
/** A SQLite schema sink verifies portable planning only. It is not PostgreSQL,
 * an installed native adapter, or evidence of runtime/factory acceptance. */
function applySink(db:DatabaseSync,value:ReturnType<typeof prepareReferenceArchiveMutation>){const p=value.packet;db.exec('BEGIN IMMEDIATE');try{
 for(const row of p.versions)db.prepare('INSERT INTO public_reference_article_versions(reference_id,item_id,revision,content_version,snapshot,original_snapshot,collection_kind,collected_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING').run(row.reference_id,row.item_id,row.revision,row.content_version,row.snapshot,row.original_snapshot,row.collection_kind,row.collected_at);
 for(const row of p.articles)db.prepare('INSERT INTO public_reference_articles VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(reference_id,item_id) DO UPDATE SET current_revision=excluded.current_revision,first_collected_at=excluded.first_collected_at,last_collected_at=excluded.last_collected_at,published_at=excluded.published_at,sort_at=excluded.sort_at').run(row.reference_id,row.item_id,row.canonical_url,row.current_revision,row.first_collected_at,row.last_collected_at,row.published_at,row.sort_at);
 for(const id of p.indexItemIds)db.prepare('DELETE FROM public_reference_article_terms WHERE reference_id=? AND item_id=?').run(referenceId,id);for(const row of p.terms)db.prepare('INSERT INTO public_reference_article_terms VALUES(?,?,?,?)').run(row.term,row.reference_id,row.item_id,row.weight);
 if(p.publisher)db.prepare('INSERT INTO public_references VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET active=excluded.active,rss_url=excluded.rss_url,snapshot=excluded.snapshot').run(p.publisher.id as string,p.publisher.active as number,p.publisher.rss_url as string,p.publisher.snapshot as string);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
function rows(db:DatabaseSync){return Object.fromEntries(['public_references','public_reference_articles','public_reference_article_versions','public_reference_article_terms'].map(table=>[table,db.prepare('SELECT * FROM '+table).all().sort((a,b)=>canonicalJson(a)<canonicalJson(b)?-1:canonicalJson(a)>canonicalJson(b)?1:0)]));}

it('matches actual Source archive writes across immutable versions, raw originals, quality, duplicate transitions and old observations',()=>{
 const source=new DatabaseSync(':memory:'),sink=new DatabaseSync(':memory:');try{for(const db of [source,sink]){db.exec('BEGIN');installMainnetApplicationSchema(db,{publicReferenceArchive:true});db.exec('COMMIT');}
 const run=(capture:ReferenceArchiveCapture)=>{const prepared=prepareReferenceArchiveMutation(capture,frame(sink,capture)),expected=capture.action==='upsert'?upsertSqlitePublicReference(source,capture.reference):archiveSqlitePublicReferenceItems(source,referenceId,capture.items,capture.kind,capture.observedAt);applySink(sink,prepared);expect(prepared.result).toEqual(expected);expect(rows(sink)).toEqual(rows(source));};
 run(captureReferenceUpsert(publisher(Array.from({length:35},(_,n)=>item(n)))));
 const legacyLink='https://public.example/legacy?utm_source=retained#fragment',legacy={...item(99),link:legacyLink,id:'public-item:'+createHash('sha256').update(referenceId+'\n'+legacyLink).digest('hex')};run(captureReferenceArchive(referenceId,[legacy],'article',at));
 const a=item(1,{content:'Full retained body that cannot be truncated by feed.',deliveryKind:'full_text'}),b={...a,title:'B current title'};run(captureReferenceArchive(referenceId,[a,b,a],'article','2026-11-13T00:00:00.000Z'));run(captureReferenceUpsert(publisher([item(1,{content:'short',deliveryKind:'full_text'}),item(50)],false)));expect(querySqlitePublicReferenceItems(source,{query:'alpha'}).total).toBe(0);run(captureReferenceUpsert(publisher([item(50)],true)));
 expect(String(sink.prepare('SELECT original_snapshot FROM public_reference_article_versions WHERE item_id=?').get(normalizeItem(referenceId,legacy).id)!.original_snapshot)).toContain('utm_source');expect(sink.prepare('SELECT weight FROM public_reference_article_terms WHERE reference_id=? AND item_id=? AND term=?').get(referenceId,item(2).id,'alpha')!.weight).toBe(9);
 }finally{source.close();sink.close();}
});
it('uses the exact portable tokenizer/cursor/provenance contract for Source query rows',()=>{
 const db=new DatabaseSync(':memory:');try{db.exec('BEGIN');installMainnetApplicationSchema(db,{publicReferenceArchive:true});db.exec('COMMIT');upsertSqlitePublicReference(db,publisher(Array.from({length:7},(_,n)=>item(n,{publishedAt:n%2?undefined:at}))));
 for(const query of [{query:'ＡLPHA alpha'},{query:'the and a'},{query:'alpha café',match:'all' as const,sort:'relevance' as const},{sort:'oldest' as const,limit:2}]){const captured=captureReferenceArchiveQuery(query),plan=captured.plan,total=Number(db.prepare(plan.total.sql).get(...plan.total.params)!.n),page=db.prepare(plan.page.sql).all(...plan.page.params),ids=[...new Set(page.slice(0,plan.limit).map(r=>r.reference_id))],publishers=ids.map(id=>db.prepare('SELECT * FROM public_references WHERE id=?').get(id!)!);expect(finishReferenceArchivePage(captured,{total,rows:page,publishers})).toEqual(querySqlitePublicReferenceItems(db,query));}
 const first=querySqlitePublicReferenceItems(db,{limit:2,sort:'relevance',query:'alpha'});expect(()=>captureReferenceArchiveQuery({limit:2,sort:'oldest',cursor:first.nextCursor})).toThrow('another query');expect(()=>captureReferenceArchiveQuery({query:'alpha',limit:0})).toThrow();
 }finally{db.close();}
});
it('qualifies genuine selected Source nonempty reads and atomic write-capacity refusal without suppressing reads',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'keryx-selected-archive-')),file=join(folder,'source.sqlite'),identity=validateStorageIdentity({format:'keryx-mainnet-storage-identity-v1',authorityMode:'mainnet-real',network:'eip155:5042',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:new Date().toISOString(),provenanceDigest:'65'.repeat(32)});let selected:ReturnType<typeof openVerifiedSqliteStorage>|undefined;
 try{const seed=new DatabaseSync(file);try{seed.exec('BEGIN');installMainnetApplicationSchema(seed,{publicReferenceArchive:true});installNativeUserDomainSchema(seed);seed.exec('COMMIT');upsertSqlitePublicReference(seed,publisher(Array.from({length:17},(_,n)=>item(n))));upsertSqlitePublicReference(seed,{...publisher([],false),id:'public:hidden'});seed.prepare('UPDATE public_references SET snapshot=? WHERE id=?').run('{','public:hidden');seed.exec('BEGIN');insertStorageIdentity(seed,identity);installStorageFences(seed,identity);seed.exec('COMMIT');}finally{seed.close();}
  selected=openVerifiedSqliteStorage(file,identity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>{}});const core=SqliteAdapter.assembleConnectionCore(selected.db,identity,()=>expect(assertVerifiedSqliteConnection(selected!.db)).toEqual(identity)),before=await core.queryPublicReferenceItems({referenceId,limit:3,query:'alpha'});expect(before.total).toBe(17);expect((await core.listPublicReferences()).map(p=>p.id)).toEqual([referenceId]);expect((await core.getPublicReference(referenceId))!.archivedItemCount).toBe(17);
  for(const key of [referenceId+'\0',referenceId+'\ud800',referenceId+'\ud83d\ude00'])expect(await core.getPublicReference(key)).toBeNull();
  selected.db.prepare('UPDATE public_references SET snapshot=? WHERE id=?').run('x'.repeat(2097153),'public:hidden');try{await expect(core.upsertPublicReference(publisher([item(90)]))).rejects.toThrow('Public archive write row/byte limit');expect(await core.queryPublicReferenceItems({referenceId,limit:3,query:'alpha'})).toEqual(before);expect((await core.listPublicReferences())[0].archivedItemCount).toBe(17);expect((await core.publicReferenceArchiveStats()).articles).toBe(17);}finally{selected.db.prepare('UPDATE public_references SET snapshot=? WHERE id=?').run('{','public:hidden');}
  expect(await core.archivePublicReferenceItems(referenceId,[item(90)],'article',at)).toEqual({added:1,updated:0});expect((await core.publicReferenceArchiveStats()).articles).toBe(18);
 }finally{selected?.close();for(const path of [file,file+'-wal',file+'-shm',file+'-journal'])if(existsSync(path))unlinkSync(path);rmdirSync(folder);}
});

it('validates actual Source fields before any caller JSON hook',()=>{
 const db=new DatabaseSync(':memory:');try{
  installMainnetApplicationSchema(db,{publicReferenceArchive:true});
  const raw=publisher([item(150)]),hooked={...raw,toJSON(){return {...raw,active:false};}};
  expect(()=>upsertSqlitePublicReference(db,hooked)).toThrow();expect(()=>captureReferenceUpsert(hooked)).toThrow();
  const hidden=publisher([item(151)]);Object.defineProperty(hidden,'toJSON',{value(){throw Error('hidden JSON hook ran');}});
  const captured=captureReferenceUpsert(hidden);expect(captured.reference).toEqual(hidden);expect(captured.reference.active).toBe(true);
  upsertSqlitePublicReference(db,hidden);expect(readSqlitePublicReference(db,db.prepare('SELECT * FROM public_references WHERE id=?').get(referenceId)!)?.active).toBe(true);
  const query={query:'alpha',toJSON(){return {query:'different'};}};
  expect(()=>querySqlitePublicReferenceItems(db,query)).toThrow('Invalid public archive query');expect(()=>captureReferenceArchiveQuery(query)).toThrow('Invalid public archive query');
  const rawItem={...item(152),toJSON(){return item(153);}};expect(()=>captureReferenceArchive(referenceId,[rawItem],'article',at)).toThrow();
 }finally{db.close();}
});
it('observes legal SQLite REAL weights without treating decimal SUM as Source IEEE754',()=>{
 const db=new DatabaseSync(':memory:');try{
  installMainnetApplicationSchema(db,{publicReferenceArchive:true});upsertSqlitePublicReference(db,publisher([item(160)]));
  const set=(value:number|bigint)=>db.prepare("UPDATE public_reference_article_terms SET weight=? WHERE reference_id=? AND item_id=? AND term='alpha'").run(value,referenceId,item(160).id);
  for(const weight of [0.5,0.1,Number.MIN_VALUE,Number.MAX_VALUE]){
   set(weight);const statement=db.prepare("SELECT typeof(weight) AS kind,weight FROM public_reference_article_terms WHERE reference_id=? AND item_id=? AND term='alpha'");statement.setReadBigInts(true);const cell=statement.get(referenceId,item(160).id)!;
   expect(cell.kind).toBe('real');expect(Object.is(cell.weight,weight)).toBe(true);
   const query={referenceId,query:'alpha'},captured=captureReferenceArchiveQuery(query),plan=captured.plan,rows=db.prepare(plan.page.sql).all(...plan.page.params),total=Number(db.prepare(plan.total.sql).get(...plan.total.params)!.n),pub=db.prepare('SELECT * FROM public_references WHERE id=?').get(referenceId)!;
   expect(querySqlitePublicReferenceItems(db,query).total).toBe(1);
   expect(()=>finishReferenceArchivePage(captured,{rows,total,publishers:[pub]})).toThrow('numeric score fidelity unavailable');
  }
  set(BigInt(Number.MAX_SAFE_INTEGER));expect(querySqlitePublicReferenceItems(db,{referenceId,query:'alpha'}).total).toBe(1);
  expect(()=>querySqlitePublicReferenceItems(db,{referenceId,query:'alpha beta'})).toThrow();
  set(9007199254740993n);const raw=db.prepare("SELECT typeof(weight) AS kind,CAST(weight AS TEXT) AS wire FROM public_reference_article_terms WHERE reference_id=? AND item_id=? AND term='alpha'").get(referenceId,item(160).id)!;
  expect(raw).toEqual({kind:'integer',wire:'9007199254740993'});expect(()=>querySqlitePublicReferenceItems(db,{referenceId,query:'alpha'})).toThrow();
  // Searches can hold while Source non-search reads/stats still expose rows.
  expect(querySqlitePublicReferenceItems(db,{referenceId}).total).toBe(1);expect(readSqlitePublicReference(db,db.prepare('SELECT * FROM public_references WHERE id=?').get(referenceId)!)?.archivedItemCount).toBe(1);
 }finally{db.close();}
});
it('shows why Source fractional score aggregation cannot be replaced by decimal arithmetic',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec('CREATE TABLE weights(term TEXT PRIMARY KEY,weight INTEGER NOT NULL CHECK(weight>0))');
  db.prepare('INSERT INTO weights VALUES(?,?)').run('alpha',0.1);db.prepare('INSERT INTO weights VALUES(?,?)').run('beta',0.2);
  expect(db.prepare('SELECT sum(weight) AS score FROM weights').get()?.score).toBe(0.1+0.2);expect(0.1+0.2).not.toBe(0.3);
 }finally{db.close();}
});

it('keeps Source orphan rows representable and preserves count/page join behavior',()=>{
 const db=new DatabaseSync(':memory:');try{
  installMainnetApplicationSchema(db,{publicReferenceArchive:true});upsertSqlitePublicReference(db,publisher([item(170)]));
  for(const table of ['public_reference_articles','public_reference_article_versions','public_reference_article_terms'])expect(db.prepare('PRAGMA foreign_key_list('+table+')').all()).toEqual([]);
  const orphan=item(171),revision='ab'.repeat(32);
  db.prepare('INSERT INTO public_reference_articles(reference_id,item_id,canonical_url,current_revision,first_collected_at,last_collected_at,published_at,sort_at) VALUES(?,?,?,?,?,?,NULL,?)').run(referenceId,orphan.id,orphan.link,revision,at,at,at);
  db.prepare('INSERT INTO public_reference_article_terms(term,reference_id,item_id,weight) VALUES(?,?,?,?)').run('orphan',referenceId,orphan.id,1);
  const result=querySqlitePublicReferenceItems(db,{referenceId,query:'orphan'});expect(result).toEqual({items:[],total:1});
  expect(readSqlitePublicReference(db,db.prepare('SELECT * FROM public_references WHERE id=?').get(referenceId)!).archivedItemCount).toBe(2);
  // No array JSON/map hook is part of the Source archive input protocol.
  const inputs=[item(172)];Object.defineProperty(inputs,'map',{value(){throw Error('array map hook');}});Object.defineProperty(inputs,'toJSON',{value(){throw Error('array JSON hook');}});
  expect(captureReferenceArchive(referenceId,inputs,'article',at).items).toEqual([item(172)]);
 }finally{db.close();}
});

it('observes Source inactive overflow evaluation before choosing numeric hold scope',()=>{
 const db=new DatabaseSync(':memory:');try{
  installMainnetApplicationSchema(db,{publicReferenceArchive:true});upsertSqlitePublicReference(db,publisher([item(180)]));
  const hiddenId='public:inactive-numeric',link='https://public.example/inactive-numeric',hiddenItem={...item(181),id:publicReferenceItemId(hiddenId,link),link};
  upsertSqlitePublicReference(db,{...publisher([hiddenItem],false),id:hiddenId});
  db.prepare("UPDATE public_reference_article_terms SET weight=? WHERE reference_id=? AND term='alpha'").run(9223372036854775807n,hiddenId);
  db.prepare("UPDATE public_reference_article_terms SET weight=1 WHERE reference_id=? AND term='beta'").run(hiddenId);
  const outcome=(referenceId?:string)=>{try{querySqlitePublicReferenceItems(db,{referenceId,query:'alpha beta'});return 'success';}catch(e){return e instanceof Error&&e.message.includes('overflow')?'overflow':'other-error';}};
  expect({unscoped:outcome(),scoped:outcome(referenceId)}).toEqual({unscoped:'overflow',scoped:'success'});
 }finally{db.close();}
});
