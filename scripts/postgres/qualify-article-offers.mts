/** Real fixed PostgreSQL leaf versus a verified current SQLite SOURCE core.
 * Synthetic signed-looking strings are storage bytes, never signer authority. */
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,existsSync,unlinkSync,rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { nativeAccountFixture,nativeAccountFixturePaths } from './native-account-fixture.mts';
import { openVerifiedSqliteStorage,assertVerifiedSqliteConnection } from '../../lib/db/storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../../lib/db/enrolled-sqlite-schema-profile';
import { SqliteAdapter } from '../../lib/db/sqlite-adapter';
import type { ArticleOffer } from '../../lib/types';
import type { StorageIdentity } from '../../lib/db/storage-identity';
import { canonicalJson } from '../../lib/canonical-json';
import { createPostgresDomainChannel,PostgresDomainWriteOutcomeUnknown } from '../../lib/db/postgres/domain-channel';
import { composePostgresArticleOffers } from '../../lib/db/postgres/article-offer-transport';
import { ArticleOfferRepresentabilityHold,captureArticleOfferSet } from '../../lib/db/postgres/article-offer-packet';
import { postgresPoolConfiguration,type PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import { startCommitAckLossProxy } from './commit-ack-loss.mts';

export async function qualifyArticleOffers(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;ownerSql:(sql:string)=>string}){
 const folder=mkdtempSync(join(tmpdir(),'keryx-native-offers-')),paths=nativeAccountFixturePaths(folder),prefix='synthetic-offer-'+randomUUID(),channel=createPostgresDomainChannel(input.options,input.identity,input.digest),native=composePostgresArticleOffers(channel,false);
 const q=(s:string)=>"'"+s.replaceAll("'","''")+"'",pg=(s:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+s+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 const app=new Client(postgresPoolConfiguration(input.options)),reader=new Client(postgresPoolConfiguration({...input.options,role:'keryx_reader'}));app.on('error',()=>{});reader.on('error',()=>{});
 let selected:ReturnType<typeof openVerifiedSqliteStorage>|undefined,vectors=0;
 const row=(patch:Partial<ArticleOffer>={}):ArticleOffer=>({sourceId:prefix,itemId:'z',id:prefix+'-id-z',contentVersion:'\uFEFFraw version',priceUsdc6:0,expiresAt:-1,signer:'\uFEFFMiXeD signer',nonce:'raw nonce ',signature:'\uFEFFsynthetic signature',createdAt:'2026-11-15T01:00:00.123456789+01:00',...patch});
 const columns='source_id,item_id,id,content_version,price_usdc6,expires_at,signer,nonce,signature,created_at';
 const state=()=>input.ownerSql(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY source_order),'[]')::text FROM public.article_offers r;`);
 const financial=()=>input.ownerSql("SELECT encode(sha256(convert_to(jsonb_build_array((SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text COLLATE \"C\"),'[]') FROM public.payment_events r),(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text COLLATE \"C\"),'[]') FROM public.a2a_orders r),(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text COLLATE \"C\"),'[]') FROM public.session_grants r))::text,'UTF8')),'hex');");
 try{
  assert.equal(input.ownerSql('SELECT count(*) FROM public.article_offers;'),'0','qualifier requires an untouched synthetic offer target');
  const financialBefore=financial();
  await nativeAccountFixture(folder,input.identity,{hash:'a1'.repeat(32),wallet:'0x'+'b1'.repeat(20),issuedAt:Date.now()-1000,expiresAt:Date.now()+600000});
  const manifest=readFileSync(paths[4],'utf8');selected=openVerifiedSqliteStorage(paths[0],input.identity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>assert.equal(readFileSync(paths[4],'utf8'),manifest)});
  const source=SqliteAdapter.assembleConnectionCore(selected.db,input.identity,()=>{assertVerifiedSqliteConnection(selected!.db,'write');});
  const compare=async()=>{
   assertVerifiedSqliteConnection(selected!.db,'read');
   for(const sourceId of [undefined,'',prefix,prefix+'-other'])assert.deepEqual(await native.listArticleOffers(sourceId),await source.listArticleOffers(sourceId));
   assert.deepEqual(await native.getArticleOffer(prefix,'z'),await source.getArticleOffer(prefix,'z'));
   assert.equal(await native.getArticleOffer(prefix,'absent'),null);
   assert.deepEqual(JSON.parse(input.ownerSql(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY source_id COLLATE "C",item_id COLLATE "C"),'[]')::text FROM(SELECT ${columns} FROM public.article_offers) r;`)),JSON.parse(JSON.stringify(selected!.db.prepare(`SELECT ${columns} FROM article_offers ORDER BY source_id,item_id`).all())));
   assert.equal(input.ownerSql('SELECT count(*) FROM keryx_storage.writer;'),'0');vectors++;
  };
  const set=async(value:ArticleOffer)=>{assertVerifiedSqliteConnection(selected!.db,'write');await source.setArticleOffer(value);await native.setArticleOffer(value);await compare();};
  const del=async(s:string,i:string)=>{assertVerifiedSqliteConnection(selected!.db,'write');await source.deleteArticleOffer(s,i);await native.deleteArticleOffer(s,i);await compare();};
  await set(row());const firstOrder=input.ownerSql(`SELECT source_order FROM public.article_offers WHERE source_id=${q(prefix)} AND item_id='z';`);
  await set(row({id:prefix+'-revision2',priceUsdc6:-7,expiresAt:Number.MAX_SAFE_INTEGER,nonce:'changed',signature:'changed raw',createdAt:'arbitrary Source TEXT'}));
  assert.equal(input.ownerSql(`SELECT source_order FROM public.article_offers WHERE source_id=${q(prefix)} AND item_id='z';`),firstOrder);vectors++;
  const beforeConflict=state();await assert.rejects(source.setArticleOffer(row({itemId:'collision',id:prefix+'-revision2'})));await assert.rejects(native.setArticleOffer(row({itemId:'collision',id:prefix+'-revision2'})),PostgresDomainWriteOutcomeUnknown);assert.equal(state(),beforeConflict);await compare();
  await del(prefix,'absent');await del(prefix,'z');
  // Same instant, different exact bytes; sub-ms precision is never Date/to_char.
  for(const [itemId,sourceId,createdAt] of [['z',prefix,'2026-11-15T01:00:00.123456789+01:00'],['a',prefix,'2026-11-15T01:00:00.123456789+01:00'],['b',prefix+'-other','2026-11-15T01:00:00.123456789+01:00'],['m',prefix,'2026-11-15T01:00:00.123456789+01:00'],['utc',prefix,'2026-11-15T00:00:00.123456789Z'],['subms',prefix,'2026-11-15T00:00:00.123456788Z']])await set(row({sourceId,itemId,id:prefix+'-'+itemId,createdAt}));
  assert.deepEqual((await native.listArticleOffers(prefix)).slice(0,3).map(r=>r.itemId),['a','m','z']);vectors++;
  await set(row({itemId:'z',id:prefix+'-changed-id'}));await compare();
  // Deleting a highest rowid permits exact max+1 reuse, unlike a sequence.
  const top=input.ownerSql('SELECT max(source_order) FROM public.article_offers;');await del(prefix,'subms');await set(row({itemId:'reuse',id:prefix+'-reuse'}));assert.equal(input.ownerSql(`SELECT source_order FROM public.article_offers WHERE item_id='reuse';`),top);vectors++;
  // Independent operation, native readonly and direct table/legacy-RPC fences.
  await app.connect();await reader.connect();const statement='SELECT public.storage_application_operational_write($1::jsonb,$2::text,$3::text,$4::jsonb) AS result',identity=canonicalJson(input.identity),before=state();
  for(const opcode of [null,'','set_article_offer;DROP TABLE public.article_offers','record_withdrawal','unreviewed_operation']){await assert.rejects(app.query(statement,[identity,input.digest,opcode,'{}']));vectors++;}
  for(const payload of ['{}','null','[]',JSON.stringify({...JSON.parse(captureArticleOfferSet(row())),unexpected:true}),JSON.stringify({p_row:{...JSON.parse(captureArticleOfferSet(row())).p_row,price_usdc6:0.5}})]){await assert.rejects(app.query(statement,[identity,input.digest,'set_article_offer',payload]));vectors++;}
  await app.query('BEGIN READ ONLY');try{await assert.rejects(app.query(statement,[identity,input.digest,'set_article_offer',captureArticleOfferSet(row())]));vectors++;}finally{await app.query('ROLLBACK');}
  await assert.rejects(reader.query(statement,[identity,input.digest,'delete_article_offer','{"p_source_id":"x","p_item_id":"x"}']));
  await assert.rejects(app.query('DELETE FROM public.article_offers'));await assert.rejects(app.query('SELECT public.storage_set_article_offer($1::jsonb,$2::jsonb)',[identity,JSON.stringify(JSON.parse(captureArticleOfferSet(row())).p_row)]));await assert.rejects(app.query('SELECT public.storage_delete_article_offer($1::jsonb,$2::text,$3::text)',[identity,prefix,'z']));assert.equal(state(),before);vectors+=4;
  const readonlyChannel=createPostgresDomainChannel({...input.options,role:'keryx_reader'},input.identity,input.digest);try{const port=composePostgresArticleOffers(readonlyChannel,true);assert.deepEqual(await port.listArticleOffers(),await source.listArticleOffers());await assert.rejects(port.setArticleOffer(row()));}finally{await readonlyChannel.close();}vectors++;
  for(const signature of ['before\0after','\uD800','\uDFFF']){await assert.rejects(native.setArticleOffer(row({signature})),ArticleOfferRepresentabilityHold);vectors++;}assert.equal(state(),before);
  // Actual Source rowids, including nonpositive values, are retained on held
  // intake. Native runtime never accepts an ordinal from a caller packet.
  for(const value of await source.listArticleOffers())await del(value.sourceId,value.itemId);
  const importRowid=(ordinal:bigint,itemId:string)=>{
   const value=row({itemId,id:prefix+'-'+itemId}),cells=JSON.parse(captureArticleOfferSet(value)).p_row;
   selected!.db.prepare(`INSERT INTO article_offers(rowid,${columns}) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(ordinal,...Object.values(cells) as (string|number)[]);
   const originalStatement=selected!.db.prepare(`SELECT rowid AS source_order,${columns} FROM article_offers WHERE source_id=? AND item_id=?`);originalStatement.setReadBigInts(true);
   const original=originalStatement.get(value.sourceId,value.itemId);assert(original);assert.equal(original.source_order,ordinal);
   pg(`INSERT INTO public.article_offers(${columns},source_order) VALUES(${columns.split(',').map(k=>typeof original[k]==='bigint'?String(original[k]):q(original[k] as string)).join(',')},${original.source_order});`);
  };
  importRowid(-3n,'negative');await set(row({itemId:'auto-negative',id:prefix+'-auto-negative'}));assert.equal(input.ownerSql("SELECT source_order FROM public.article_offers WHERE item_id='auto-negative';"),'-2');vectors++;
  importRowid(0n,'zero');await set(row({itemId:'auto-positive',id:prefix+'-auto-positive'}));assert.equal(input.ownerSql("SELECT source_order FROM public.article_offers WHERE item_id='auto-positive';"),'1');vectors++;
  importRowid(9223372036854775807n,'max-rowid');const exhausted=state();await assert.rejects(native.setArticleOffer(row({itemId:'exhausted',id:prefix+'-exhausted'})),PostgresDomainWriteOutcomeUnknown);assert.equal(state(),exhausted);await compare();vectors++;
  await del(prefix,'max-rowid');
  assert.equal(input.options.endpoint.kind,'loopback');const proxy=await startCommitAckLossProxy(input.options.endpoint.port),loss=createPostgresDomainChannel({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest);
  try{proxy.arm();const value=row({itemId:'lost-ack',id:prefix+'-lost-ack'});await assert.rejects(composePostgresArticleOffers(loss,false).setArticleOffer(value),PostgresDomainWriteOutcomeUnknown);assert.deepEqual(proxy.observation(),{dropped:true,commands:1});await source.setArticleOffer(value);await compare();vectors++;}finally{await loss.close();await proxy.close();}
  assert.equal(financial(),financialBefore);assert.equal(input.ownerSql('SELECT count(*) FROM keryx_storage.writer;'),'0');
  assert.equal(input.ownerSql("SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='storage_application_operational_write' AND octet_length(prosrc)<=32768;"),'1');
  return {vectors,actualVerifiedSqliteCore:true,actualNativeFixedProtocols:true,exactTenCellOriginals:true,sourceTextDatesAndOrdering:true,compositeKeyUpsertAndUniqueId:true,noForeignKeyOrCascadeAuthority:true,sourceRowidTiesAndMaxReuse:true,nonpositiveSourceRowids:true,exhaustedRowidExplicitHold:true,actualLostCommitAck:true,noAutomaticRetry:true,readonlyAndLegacyRpcRefused:true,publicWriterClearedAfterEachOutcome:true,financialStateUnchanged:true,scalarNulSupported:false,unpairedUtf16Supported:false,unsafeOrFractionalIntegerSupported:false,fullWriterQualified:false,installedNativeWriterQualified:false,productionData:false,providerActions:0,paymentActions:0,jobExecutions:0};
 }finally{
  await Promise.allSettled([app.end(),reader.end(),channel.close()]);selected?.close();
  pg(`DELETE FROM public.article_offers WHERE source_id IN(${q(prefix)},${q(prefix+'-other')});`);
  for(const path of paths)if(existsSync(path))unlinkSync(path);rmdirSync(folder);
 }
}
