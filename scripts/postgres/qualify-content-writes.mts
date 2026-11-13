/** Current SQLite/native ordinary-content differential; synthetic protocol only. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { SqliteAdapter } from '../../lib/db/sqlite-adapter';
import { assembleNativePostgresBusinessCore } from '../../lib/db/supabase-adapter';
import { createPostgresApplicationDomainAuthority } from '../../lib/db/postgres/application-domain-authority';
import { createPostgresApplicationDomainTransport,type PostgresApplicationDomainTransport } from '../../lib/db/postgres/application-domain-transport';
import { PostgresDomainWriteOutcomeUnknown } from '../../lib/db/postgres/domain-channel';
import { openEnrolledCacheText,sealEnrolledCacheText } from '../../lib/sources/enrolled-content-cache';
import type { Source,SourceItem } from '../../lib/types';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import type { StorageIdentity } from '../../lib/db/storage-identity';
import { startCommitAckLossProxy } from './commit-ack-loss.mts';
export async function qualifyContentWrites(input:{transport:PostgresApplicationDomainTransport;options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;ownerSql:(sql:string)=>string}){
 const db=new DatabaseSync(':memory:'),stamp='2026-01-02T03:04:05.006Z',wallet='0x'+'ac'.repeat(20),id='synthetic-native-content',originalKey=process.env.CONTENT_MASTER_KEY;let vectors=0,ownedFixtureRows=false;
 const native=assembleNativePostgresBusinessCore({identity:input.identity,authority:createPostgresApplicationDomainAuthority(input.transport),assertEntry:()=>{},verify:async()=>{await input.transport.applicationRead('get_sync_state',{p_key:'synthetic-content-authority'});}});
 const q=(s:string)=>"'"+s.replaceAll("'","''")+"'",pg=(s:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+s+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 const normalized=(v:unknown)=>JSON.parse(JSON.stringify(v)),equal=(a:unknown,b:unknown)=>assert.deepEqual(normalized(a),normalized(b));
 try{
  process.env.CONTENT_MASTER_KEY=randomBytes(32).toString('hex');
  db.exec('BEGIN');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);db.exec('COMMIT');
  const sqlite=SqliteAdapter.assembleConnectionCore(db,input.identity,()=>{}),n=native.adapter;await n.init();
  assert.equal(input.ownerSql('SELECT count(*) FROM public.cache_items;'),'0','Synthetic content quota fixture must start without another cache owner');
  assert.equal(await n.getSource(id),null);ownedFixtureRows=true;
  const source:Source={id,name:'Synthetic content',url:'https://example.invalid/content',description:'Exact UTF-8 🌍',walletAddress:wallet,fetchPrice:0.000001,tags:['synthetic'],authors:[{name:'Synthetic',walletAddress:wallet,splitWeight:1}],createdAt:stamp,evidenceProvenance:'synthetic-demo',onchainId:'0x'+'bd'.repeat(32),registerTx:'0x'+'ce'.repeat(32),previewDepth:'full'};
  for(const store of [n,sqlite])await store.upsertSource(source);equal(await n.getSource(id),await sqlite.getSource(id));vectors++;
  const replaced={...source,name:'Replaced',createdAt:'2026-02-03T04:05:06.000Z',onchainId:undefined,registerTx:undefined,previewDepth:undefined,evidenceProvenance:undefined};
  for(const store of [n,sqlite])await store.upsertSource(replaced);equal(await n.getSource(id),await sqlite.getSource(id));assert.equal((await n.getSource(id))?.createdAt,stamp);assert.equal((await n.getSource(id))?.evidenceProvenance,'synthetic-demo');vectors++;
  for(const store of [n,sqlite])await store.setSourceMeta(id,{name:'Metadata',description:'Description',url:source.url,rssUrl:source.url+'/rss'});equal(await n.getSourceMeta(id),await sqlite.getSourceMeta(id));vectors++;
  for(const store of [n,sqlite])await store.setSourcePreviewDepth(id,'summary');equal(await n.getSource(id),await sqlite.getSource(id));vectors++;
  const item:SourceItem={id:id+'-item',sourceId:id,title:'Exact item',summary:'Preview',content:'Private body 🌍',link:source.url+'/item',publishedAt:stamp,deliveryKind:'full_text',storageMode:'db_plaintext',plaintextBytes:17};
  for(const store of [n,sqlite])await store.addItems([item]);equal(await n.getItem(id,item.id),await sqlite.getItem(id,item.id));assert.equal((await n.getItem(id,item.id))?.evidenceProvenance,'synthetic-demo');vectors++;
  const orphan={...item,id:id+'-orphan-item',sourceId:id+'-missing-parent',evidenceProvenance:undefined};
  for(const store of [n,sqlite])await store.addItems([orphan]);equal(await n.getItem(orphan.sourceId,orphan.id),await sqlite.getItem(orphan.sourceId,orphan.id));
  assert.equal(await n.getSource(orphan.sourceId),null);assert.equal(await sqlite.getSource(orphan.sourceId),null);assert.equal(await n.getItem(id,orphan.id),null);vectors++;
  equal(await n.getSourceItemByLink(id,item.link),await sqlite.getSourceItemByLink(id,item.link));assert.equal(await n.getSourceItemByLink(id,item.link+'#different'),null);assert.equal(await n.getSourceItemByLink(id+'-other',item.link),null);vectors++;
  for(const store of [n,sqlite])await store.addItems([{...item,title:'Updated',content:'Updated body'}]);equal(await n.getItem(id,item.id),await sqlite.getItem(id,item.id));vectors++;
  const manifested:SourceItem={...item,id:id+'-manifest',publishedAt:'2026-01-02T03:04:05.007Z',bodyHash:'de'.repeat(32),manifest:{id:'synthetic-manifest',sourceId:id,itemId:id+'-manifest',canonicalUrl:item.link,bodyHash:'de'.repeat(32),plaintextBytes:17,deliveryKind:'full_text',signer:wallet,nonce:'synthetic-manifest-nonce',signature:'0x'+'ab'.repeat(65),createdAt:stamp}};for(const store of [n,sqlite])await store.addItems([manifested]);equal(await n.getItem(id,manifested.id),await sqlite.getItem(id,manifested.id));assert.equal((await n.getItem(id,manifested.id))?.manifest?.createdAt,stamp);vectors++;
  for(const store of [n,sqlite])await store.addItems([{...item,id:id+'-undated',publishedAt:undefined},{...item,id:id+'-rfc',publishedAt:'Wed, 02 Oct 2024 00:00:00 GMT'}]);equal(await n.getItems(id),await sqlite.getItems(id));vectors++;
  for(const store of [n,sqlite])await assert.rejects(store.getSourceItemByLink(id,item.link),/Ambiguous exact source article membership/);vectors++;
  const largeLink=source.url+'/ambiguous-large';pg(`INSERT INTO public.source_items(id,source_id,title,content,link) SELECT ${q(id)}||'-large-'||g,${q(id)},'Synthetic oversized duplicate',repeat('x',3145728),${q(largeLink)} FROM generate_series(1,2) g;`);await assert.rejects(n.getSourceItemByLink(id,largeLink),/Ambiguous exact source article membership/);pg(`DELETE FROM public.source_items WHERE source_id=${q(id)} AND link=${q(largeLink)};`);vectors++;
  equal(await n.newestItemDates([id]),await sqlite.newestItemDates([id]));equal(await n.countItemsPublishedBetween([id],'2026-01-01T00:00:00.000Z','2026-01-03T00:00:00.000Z'),await sqlite.countItemsPublishedBetween([id],'2026-01-01T00:00:00.000Z','2026-01-03T00:00:00.000Z'));vectors++;
  for(const store of [n,sqlite])await store.setSourceNotify(id,'https://example.invalid/notify','synthetic-secret');equal(await n.getSourceNotify(id),await sqlite.getSourceNotify(id));vectors++;
  for(const store of [n,sqlite]){await store.setSourceNotifyEmail(id,'synthetic@example.invalid','synthetic-unsubscribe');await store.markSourceNotifyEmailSent(id,stamp);}equal(await n.getSourceNotifyEmail(id),await sqlite.getSourceNotifyEmail(id));vectors++;
  for(const store of [n,sqlite])await store.setSourceNotifyEmail(id,'changed@example.invalid','changed-token');equal(await n.getSourceNotifyEmail(id),await sqlite.getSourceNotifyEmail(id));assert.equal((await n.getSourceNotifyEmail(id))?.lastSentAt,null);vectors++;
  for(const store of [n,sqlite]){await store.deleteSourceNotify(id);await store.deleteSourceNotifyEmail(id);}assert.equal(await n.getSourceNotify(id),null);assert.equal(await n.getSourceNotifyEmail(id),null);vectors++;
  for(const store of [n,sqlite])await store.setSyncState('synthetic-content-wire','a'.repeat(90000)+'\n🌍');equal(await n.getSyncState('synthetic-content-wire'),await sqlite.getSyncState('synthetic-content-wire'));vectors++;
  for(const store of [n,sqlite])await store.setCached(id,'cache body\0🌍');equal(await n.getCached(id),await sqlite.getCached(id));vectors++;
  const ciphertext=input.ownerSql(`SELECT text FROM public.cache_items WHERE source_id=${q(id)};`);assert.notEqual(ciphertext,'cache body\0🌍');assert.equal(openEnrolledCacheText(ciphertext,id,input.identity),'cache body\0🌍');assert.throws(()=>openEnrolledCacheText(ciphertext,id,{...input.identity,storageId:'00000000-0000-4000-8000-000000000000'}));assert.throws(()=>openEnrolledCacheText(ciphertext,id+'-other',input.identity));vectors++;
  const tooManyUnits='🌍'.repeat(100)+'x'.repeat(100);assert(Buffer.byteLength(tooManyUnits)<512);await assert.rejects(input.transport.applicationWrite('set_cached',{p_row:{source_id:tooManyUnits,text:ciphertext,updated_at:stamp}}));assert.equal(input.ownerSql('SELECT count(*) FROM public.cache_items;'),'1');vectors++;
  const memory={id:'synthetic-content-memory',sourceScores:{[id]:{name:source.name,weight:1,reward:0.000001}},sourcesRead:[id],topics:['synthetic'],createdAt:stamp};for(const store of [n,sqlite])await store.saveQueryMemory(memory);equal(await n.loadQueryMemories(1),await sqlite.loadQueryMemories(1));vectors++;
  for(const store of [n,sqlite])await assert.rejects(store.saveQueryMemory(memory));assert.equal(input.ownerSql(`SELECT count(*) FROM public.query_memories WHERE id=${q(memory.id)};`),'1');vectors++;
  const gap={gapId:'synthetic-content-gap',claim:'Synthetic gap',question:'Synthetic question',failedQueryId:'synthetic-prior-query',sourceId:id,sourceItemLink:item.link,itemId:item.id,ownerWallet:wallet};const ng=await n.createGapIntent(gap),sg=await sqlite.createGapIntent(gap);
  const stableGap=(g:typeof ng)=>({...g,id:'generated',createdAt:'generated',updatedAt:'generated'});equal(stableGap(ng),stableGap(sg));assert.equal((await n.createGapIntent(gap)).id,ng.id);vectors++;
  const now=Date.now()+1000,lease=30000,nc=await n.claimGapIntent(now,lease),sc=await sqlite.claimGapIntent(now,lease);assert(nc&&sc);equal(stableGap(nc),stableGap(sc));assert.equal(nc.updatedAt,sc.updatedAt);assert.equal(nc.updatedAt,new Date(now).toISOString());assert.equal(await n.claimGapIntent(now,lease),null);vectors++;
  for(const [store,g] of [[n,ng],[sqlite,sg]] as const)await store.failGapIntent(g.id,'Synthetic retry',3);equal(stableGap((await n.listGapIntents()).find(g=>g.id===ng.id)!),stableGap((await sqlite.listGapIntents()).find(g=>g.id===sg.id)!));vectors++;
  for(const store of [n,sqlite])assert(await store.claimGapIntent(now,lease));for(const [store,g] of [[n,ng],[sqlite,sg]] as const)await store.finishGapIntent(g.id,{status:'missed',retryRunId:'synthetic-retry-run',coverage:0,rewardUsdc:0});equal(stableGap((await n.listGapIntents()).find(g=>g.id===ng.id)!),stableGap((await sqlite.listGapIntents()).find(g=>g.id===sg.id)!));vectors++;
  await assert.rejects(n.finishGapIntent(ng.id,{status:'filled',retryRunId:'synthetic-no-lease',coverage:1,rewardUsdc:0}));vectors++;
  const ng2=await n.createGapIntent({...gap,gapId:gap.gapId+'-expire'}),sg2=await sqlite.createGapIntent({...gap,gapId:gap.gapId+'-expire'});
  const claims=await Promise.all([n.claimGapIntent(now,lease),n.claimGapIntent(now,lease)]);assert.equal(claims.filter(Boolean).length,1);assert.equal(claims.find(Boolean)?.id,ng2.id);assert.equal((await sqlite.claimGapIntent(now,lease))?.id,sg2.id);vectors++;
  for(const [store,g] of [[n,ng2],[sqlite,sg2]] as const)await store.expireGapIntent(g.id,'Synthetic expiry');equal(stableGap((await n.listGapIntents()).find(g=>g.id===ng2.id)!),stableGap((await sqlite.listGapIntents()).find(g=>g.id===sg2.id)!));assert.equal(await n.claimGapIntent(now+lease+1,lease),null);vectors++;
  assert.equal(input.options.endpoint.kind,'loopback');const proxy=await startCommitAckLossProxy(input.options.endpoint.port),broken=createPostgresApplicationDomainTransport({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest);
  try{proxy.arm();await assert.rejects(broken.applicationWrite('set_sync_state',{p_row:{key:'synthetic-content-ack',value:'committed',updated_at:stamp}}),PostgresDomainWriteOutcomeUnknown);assert.deepEqual(proxy.observation(),{dropped:true,commands:1});assert.equal(await n.getSyncState('synthetic-content-ack'),'committed');vectors++;}finally{await broken.close();await proxy.close();}
  const reader=createPostgresApplicationDomainTransport({...input.options,role:'keryx_reader'},input.identity,input.digest);try{await assert.rejects(reader.applicationWrite('set_source_preview_depth',{p_id:id,p_row:{preview_depth:'full'}}));vectors++;}finally{await reader.close();}
  // Saturation uses synthetic held rows only; the app cannot admit a 513th row.
  pg(`DELETE FROM public.cache_items WHERE source_id=${q(id)};INSERT INTO public.cache_items(source_id,text,updated_at) SELECT 'synthetic-limit-'||g,'enc:v3:synthetic',${q(stamp)} FROM generate_series(1,512) g;`);
  await assert.rejects(n.setCached('synthetic-over-limit','body'));assert.equal(input.ownerSql('SELECT count(*) FROM public.cache_items;'),'512');vectors++;
  pg(`DELETE FROM public.cache_items WHERE source_id LIKE 'synthetic-limit-%';INSERT INTO public.cache_items(source_id,text,updated_at) SELECT 'synthetic-byte-limit-'||g,'enc:v3:'||repeat('x',2097145),${q(stamp)} FROM generate_series(1,4) g;`);
  await assert.rejects(n.setCached('synthetic-over-byte-limit','body'));assert.equal(input.ownerSql('SELECT sum(octet_length(text)) FROM public.cache_items;'),'8388608');vectors++;
  pg("DELETE FROM public.cache_items WHERE source_id LIKE 'synthetic-byte-limit-%';");const sealed=sealEnrolledCacheText('after failure',id,input.identity);await input.transport.applicationWrite('set_cached',{p_row:{source_id:id,text:sealed,updated_at:stamp}});assert.equal(await n.getCached(id),'after failure');assert.equal(input.ownerSql('SELECT count(*) FROM keryx_storage.writer;'),'0');vectors++;
  return {vectors,ordinarySourceAndItemParity:true,historicalOrphanItemPreservedWithoutSourceOrPayout:true,stickyEvidenceAndOnchainMetadata:true,exactTextTimestamps:true,authenticatedIdentityBoundCache:true,finiteCacheRowsAndBytes:true,leasedGapTransitions:true,knownDuplicateMemoryRefused:true,actualLostCommitAck:true,noAutomaticRetry:true,readonlyRoleRefused:true,productionData:false,paidOperations:0,fullWriterQualified:false};
 }finally{
  try{if(ownedFixtureRows)pg(`DELETE FROM public.gap_intents WHERE source_id=${q(id)};DELETE FROM public.query_memories WHERE id='synthetic-content-memory';DELETE FROM public.source_items WHERE source_id IN(${q(id)},${q(id+'-missing-parent')});DELETE FROM public.source_meta WHERE id=${q(id)};DELETE FROM public.source_notify WHERE source_id=${q(id)};DELETE FROM public.source_notify_email WHERE source_id=${q(id)};DELETE FROM public.sources WHERE id=${q(id)};DELETE FROM public.cache_items WHERE source_id=${q(id)} OR source_id LIKE 'synthetic-limit-%' OR source_id LIKE 'synthetic-byte-limit-%';DELETE FROM public.sync_state WHERE key IN('synthetic-content-wire','synthetic-content-ack');`);}
  finally{if(originalKey===undefined)delete process.env.CONTENT_MASTER_KEY;else process.env.CONTENT_MASTER_KEY=originalKey;native.hooks.close();db.close();}
 }
}
