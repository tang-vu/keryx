/** Current SQLite oracle; independently installed candidate native SOURCE only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { installSqliteApplicationSchema } from '../../lib/db/sqlite-application-schema';
import { RUN_CLAIMS_SQL,createSqliteRunClaims } from '../../lib/db/run-claims-sqlite';
import { createSqliteRunOwnershipHistory } from '../../lib/db/run-ownership-history-sqlite';
import { RUN_PRIVACY_SQL,createSqliteRunPrivacy } from '../../lib/db/run-privacy-sqlite';
import { writeSqliteQueryRun } from '../../lib/db/query-run-record';
import { createPostgresUserDomainTransport } from '../../lib/db/postgres/user-domain-transport';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import type { StorageIdentity } from '../../lib/db/storage-identity';
import type { QueryRun } from '../../lib/types';
import { heldHistoryProjectionSql,sqliteOriginalHistoryProjection } from './run-history-projection.mts';
import { heldOwnershipHistoryProjectionSql,sqliteOwnershipHistoryProjection } from './ownership-history-projection.mts';
import { heldPrivacyProjectionSql,sqlitePrivacyProjection } from './privacy-projection.mts';
import { startCommitAckLossProxy } from './commit-ack-loss.mts';
import { PostgresDomainWriteOutcomeUnknown } from '../../lib/db/postgres/domain-channel';
export async function qualifyPrivacy(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;ownerSql:(sql:string)=>string}){
 const db=new DatabaseSync(':memory:'),transport=createPostgresUserDomainTransport(input.options,input.identity,input.digest),native=transport.runPrivacy,transports=[transport];
 let proxy:Awaited<ReturnType<typeof startCommitAckLossProxy>>|undefined;
 const owner='0x'+'e1'.repeat(20),other='0x'+'e2'.repeat(20),session='e3'.repeat(32),binding={network:'eip155:5042' as const,origin:'https://keryx.cc'},actor={wallet:owner,binding,sessionHash:session},date=new Date(Date.now()-1000).toISOString(),q=(s:string)=>"'"+s.replaceAll("'","''")+"'";
 const pg=(s:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+s+"UPDATE keryx_storage.control SET mode='active';COMMIT;");let vectors=0;
 const historical:QueryRun={id:'synthetic-native-privacy-historical',createdAt:date,question:'Historical question',answer:'Historical answer',engine:'heuristic',budget:0,totalSpent:0,totalToCreators:0,subClaims:[],decisions:[],citations:[],trace:[],asker:owner};
 const derive=(id:string)=>heldHistoryProjectionSql(id,sqliteOriginalHistoryProjection(db,id))+heldOwnershipHistoryProjectionSql(id,sqliteOwnershipHistoryProjection(db,id))+heldPrivacyProjectionSql(id,sqlitePrivacyProjection(db,id));
 const usageBound=(id:string)=>assert.equal(input.ownerSql(`SELECT count(*) FROM keryx_storage.usage_projection u JOIN public.query_runs q ON q.id=u.run_id WHERE q.id=${q(id)} AND u.original_sha256=keryx_storage.run_original_sha256(q.data) AND u.body_identity_valid;`),'1');
 try{
  installSqliteApplicationSchema(db);writeSqliteQueryRun(db,historical,false);db.exec(RUN_CLAIMS_SQL);db.exec(RUN_PRIVACY_SQL);const history=createSqliteRunOwnershipHistory(db),sqlite=createSqliteRunPrivacy(db,history);
  pg(`INSERT INTO public.query_runs(id,created_at,question,budget,data,asker,engine,total_spent,total_to_creators,answer) VALUES(${q(historical.id)},${q(date)},${q(historical.question)},0,${q(String(db.prepare('SELECT data FROM query_runs WHERE id=?').get(historical.id)!.data))}::json,${q(owner)},'heuristic',0,0,${q(historical.answer)});`+derive(historical.id));
  db.prepare('INSERT INTO web_sessions(hash,wallet,issued_at,expires_at) VALUES(?,?,?,?)').run(session,owner,Date.now()-10000,Date.now()+86400000);
  pg(`INSERT INTO public.web_sessions(hash,wallet,issued_at,expires_at) VALUES(${q(session)},${q(owner)},${Date.now()-10000},${Date.now()+86400000});`);
  const save=(suffix:string,visibility:'public'|'private'|'unlisted'='public',patch:Partial<QueryRun>={})=>{
   const run:QueryRun={id:'synthetic-native-privacy-'+suffix,createdAt:date,question:'Synthetic private question',answer:'Private original answer',engine:'heuristic',budget:0,totalSpent:0,totalToCreators:0,subClaims:[],decisions:[],citations:[],trace:[],paymentMode:'offline',asker:owner,...patch};writeSqliteQueryRun(db,run,false);db.prepare('UPDATE run_privacy SET visibility=? WHERE run_id=?').run(visibility,run.id);const wire=String(db.prepare('SELECT data FROM query_runs WHERE id=?').get(run.id)!.data);
   pg(`INSERT INTO public.query_runs(id,created_at,question,budget,data,asker,engine,total_spent,total_to_creators,answer) VALUES(${q(run.id)},${q(date)},${q(run.question)},0,${q(wire)}::json,${run.asker?q(run.asker):'NULL'},'heuristic',0,0,'Private original answer');INSERT INTO public.run_privacy(run_id,visibility,updated_at) VALUES(${q(run.id)},${q(visibility)},${q(date)});`+derive(run.id));return run;
  };
  const publicRun=save('public'),privateRun=save('private','private'),unlisted=save('unlisted','unlisted'),foreign=save('foreign','private',{asker:other});
  for(const run of [publicRun,privateRun,unlisted,foreign])for(const who of [undefined,actor,{wallet:other,binding}]){assert.deepEqual(await native.read(run.id,who),await sqlite.read(run.id,who));vectors++;}
  assert.deepEqual(Object.keys((await sqlite.read(privateRun.id,actor)).item!).sort(),['run','state']);vectors++;
  assert.deepEqual(await native.defaults(actor),await sqlite.defaults(actor));vectors++;
  for(const options of [{take:50},{take:50,ids:[]},{take:1},{take:50,ids:[publicRun.id,privateRun.id]},{take:1,before:{createdAt:date,id:publicRun.id}}]){assert.deepEqual(await native.list(options),await sqlite.list(options));vectors++;}
  assert.deepEqual(await native.owner(privateRun.id,actor),await sqlite.owner(privateRun.id,actor));vectors++;
  assert.deepEqual(await native.settlement(privateRun.id),await sqlite.settlement(privateRun.id));vectors++;
  assert.deepEqual(await native.pending('missing'),await sqlite.pending('missing'));vectors++;
  const preference=randomUUID();assert.equal(await native.setDefault(actor,'private',preference),await sqlite.setDefault(actor,'private',preference));vectors++;assert.equal(await native.setDefault(actor,'private',preference),await sqlite.setDefault(actor,'private',preference));vectors++;
  const change={visibility:'unlisted' as const,revision:0,requestId:randomUUID()};assert.deepEqual(await native.change(privateRun.id,actor,change),await sqlite.change(privateRun.id,actor,change));vectors++;assert.deepEqual(await native.change(privateRun.id,actor,change),await sqlite.change(privateRun.id,actor,change));vectors++;
  await Promise.all([assert.rejects(native.change(privateRun.id,actor,{visibility:'public',revision:0,requestId:randomUUID()}),/conflict/),assert.rejects(sqlite.change(privateRun.id,actor,{visibility:'public',revision:0,requestId:randomUUID()}),/conflict/)]);vectors++;
  const exported=randomUUID();assert.deepEqual(await native.export(privateRun.id,actor,exported),await sqlite.export(privateRun.id,actor,exported));vectors++;
  const erase={revision:1,requestId:randomUUID()};assert.deepEqual(await native.erase(privateRun.id,actor,erase),await sqlite.erase(privateRun.id,actor,erase));vectors++;assert.deepEqual(await native.erase(privateRun.id,actor,erase),await sqlite.erase(privateRun.id,actor,erase));vectors++;
  usageBound(privateRun.id);vectors++;
  assert.deepEqual(await native.read(privateRun.id,actor),await sqlite.read(privateRun.id,actor));vectors++;assert.deepEqual(await native.owner(privateRun.id,actor),await sqlite.owner(privateRun.id,actor));vectors++;
  assert.equal(input.ownerSql(`SELECT data::text FROM public.query_runs WHERE id=${q(privateRun.id)};`),db.prepare('SELECT data FROM query_runs WHERE id=?').get(privateRun.id)!.data);vectors++;
  assert.throws(()=>input.ownerSql(`UPDATE public.query_runs SET data=${q(JSON.stringify(privateRun))}::json WHERE id=${q(privateRun.id)};`),/privacy_erased|native storage writer required/);vectors++;
  await native.creationReady();await sqlite.creationReady();vectors++;
  const creation={privacy:{runPrivacy:sqlite,runPrivacyActive:true},enrolled:false};
  for(const [suffix,asker,visibility] of [['new-public',undefined,undefined],['new-default',owner,undefined],['new-explicit',owner,'unlisted']] as const){
   const run={...publicRun,id:'synthetic-native-privacy-'+suffix,asker};
   const publication=visibility?{visibility}:undefined;
   await transport.saveQueryRun(run,publication);writeSqliteQueryRun(db,run,true,{...creation,publication});
   await transport.saveQueryRun(run,publication);usageBound(run.id);vectors++;
   assert.deepEqual(await native.read(run.id,actor),await sqlite.read(run.id,actor));vectors++;
   assert.equal(input.ownerSql(`SELECT data::text FROM public.query_runs WHERE id=${q(run.id)};`),db.prepare('SELECT data FROM query_runs WHERE id=?').get(run.id)!.data);vectors++;
   await transport.saveQueryRun({...run,answer:'Replacement original'}, {visibility:'public'});writeSqliteQueryRun(db,{...run,answer:'Replacement original'},true,{...creation,publication:{visibility:'public'}});
   usageBound(run.id);vectors++;
   assert.deepEqual(await native.read(run.id,actor),await sqlite.read(run.id,actor));vectors++;
  }
  await transport.saveQueryRun(historical,{visibility:'public'});writeSqliteQueryRun(db,historical,true,{...creation,publication:{visibility:'public'}});
  assert.deepEqual(await native.read(historical.id,actor),await sqlite.read(historical.id,actor));assert.equal((await native.read(historical.id)).item!.state.visibility,'unlisted');vectors++;
  for(const who of [actor,{wallet:other,binding}]){
   assert.deepEqual(await native.questions!([publicRun.id,foreign.id]),await sqlite.questions!([publicRun.id,foreign.id]));vectors++;
   assert.deepEqual(await native.owner(foreign.id,who),await sqlite.owner(foreign.id,who));vectors++;
  }
  assert.deepEqual(await native.learningPage!({take:32}),await sqlite.learningPage!({take:32}));vectors++;
  assert.deepEqual(await native.sourceHistory!(),await sqlite.sourceHistory!());vectors++;
  assert.deepEqual(await native.archivePage!({take:32}),await sqlite.archivePage!({take:32}));vectors++;
  assert.deepEqual(await native.memories(32),await sqlite.memories(32));vectors++;
  assert.deepEqual(await native.offers(32),await sqlite.offers(32));vectors++;
  const source='synthetic-native-privacy-source',item='synthetic-native-privacy-item';
  db.prepare('INSERT INTO sources(id,name,wallet_address) VALUES(?,?,?)').run(source,'Synthetic provenance',owner);db.prepare('INSERT INTO source_items(id,source_id,title) VALUES(?,?,?)').run(item,source,'Synthetic title');
  pg(`INSERT INTO public.sources(id,name,wallet_address) VALUES(${q(source)},'Synthetic provenance',${q(owner)});INSERT INTO public.source_items(id,source_id,title) VALUES(${q(item)},${q(source)},'Synthetic title');`);
  const provenance=save('provenance','public',{answer:'',citations:[{marker:'S1',sourceId:source,itemId:item,sourceName:'Synthetic provenance',itemTitle:'Synthetic title',weight:1,reward:0,rationale:'Fixture only'}]});
  const sourceOnly=save('source-only','public',{answer:'',citations:[{marker:'S1',sourceId:source,sourceName:'Synthetic provenance',itemTitle:'Synthetic title',weight:1,reward:0,rationale:'Fixture only'}]});
  assert.deepEqual(await native.sourceHistory!(),await sqlite.sourceHistory!());vectors++;
  for(const table of ['source_items','sources'] as const){const selected=table==='sources'?source:item;db.prepare(`UPDATE ${table} SET evidence_provenance='synthetic-demo' WHERE id=?`).run(selected);pg(`UPDATE public.${table} SET evidence_provenance='synthetic-demo' WHERE id=${q(selected)};`);assert.deepEqual(await native.sourceHistory!(),await sqlite.sourceHistory!());const visible=await native.sourceHistory!();assert.equal(visible.find(r=>r.id===provenance.id)?.hasAnswer,true);assert.equal(visible.find(r=>r.id===sourceOnly.id)?.hasAnswer,table==='sources');vectors++;}
  for(const run of [publicRun,foreign]){db.prepare("INSERT INTO query_memories(id,created_at,source_scores,topics,sources_read) VALUES(?,?,'{}','[]','[]')").run(run.id,date);pg(`INSERT INTO public.query_memories(id,created_at,source_scores,topics,sources_read) VALUES(${q(run.id)},${q(date)},'{}'::jsonb,'[]'::jsonb,'[]'::jsonb);`);}
  assert.deepEqual(await native.memories(32),await sqlite.memories(32));assert.deepEqual((await native.memories(32)).map(r=>r.id),[publicRun.id]);vectors++;
  await assert.rejects(transport.saveQueryRun(privateRun,{visibility:'public'}),/privacy_unavailable/);vectors++;
  assert.deepEqual(await native.owner(privateRun.id,actor),await sqlite.owner(privateRun.id,actor));vectors++;
  const held=save('retention-hold','private',{originalFulfillment:{}} as unknown as Partial<QueryRun>),hold={revision:0,requestId:randomUUID()};
  await Promise.all([assert.rejects(native.erase(held.id,actor,hold),/retention_hold/),assert.rejects(sqlite.erase(held.id,actor,hold),/retention_hold/)]);vectors++;
  const concurrent=save('concurrent','private'),results=await Promise.allSettled([native.change(concurrent.id,actor,{visibility:'public',revision:0,requestId:randomUUID()}),native.change(concurrent.id,actor,{visibility:'unlisted',revision:0,requestId:randomUUID()})]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected'&&String(x.reason).includes('conflict')).length,1);vectors++;
  let now=Date.now();const claims=createSqliteRunClaims(db,{fixtureClock:()=>now}),claimed=save('claim-owned','private',{asker:undefined}),claimRequest={runId:claimed.id,tokenHash:'e4'.repeat(32),completedAt:date,binding};
  const issuance=await transport.runClaims.issue(claimRequest);now=Date.parse(issuance.issuedAt);assert.deepEqual(issuance,await claims.issue(claimRequest));vectors++;
  const attempt={tokenHash:claimRequest.tokenHash,wallet:owner,sessionHash:session,binding},receipt=await transport.runClaims.claim(attempt);now=Date.parse(receipt.claimedAt);assert.deepEqual(receipt,await claims.claim(attempt));vectors++;
  assert.deepEqual(await native.read(claimed.id,actor),await sqlite.read(claimed.id,actor));vectors++;
  const disabled=createPostgresUserDomainTransport(input.options,input.identity,input.digest,false);transports.push(disabled);assert.equal((await disabled.runPrivacy.read(claimed.id,actor)).item,null);vectors++;
  const claimedErase={revision:0,requestId:randomUUID()};assert.deepEqual(await native.erase(claimed.id,actor,claimedErase),await sqlite.erase(claimed.id,actor,claimedErase));vectors++;
  assert.deepEqual(await native.owner(claimed.id,actor),await sqlite.owner(claimed.id,actor));vectors++;
  const foreignOrigin={...actor,binding:{...binding,origin:'https://other.example'}};assert.equal(await native.owner(claimed.id,foreignOrigin),null);assert.equal(await sqlite.owner(claimed.id,foreignOrigin),null);vectors++;
  assert(input.options.endpoint.kind==='loopback');proxy=await startCommitAckLossProxy(input.options.endpoint.port);
  const lossy=createPostgresUserDomainTransport({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest);transports.push(lossy);await lossy.runPrivacy.creationReady();proxy.arm();
  const lost={...publicRun,id:'synthetic-native-privacy-lost-publication'};
  await assert.rejects(lossy.saveQueryRun(lost),e=>e instanceof PostgresDomainWriteOutcomeUnknown);assert.equal(proxy.observation().dropped,true);vectors++;
  writeSqliteQueryRun(db,lost,true,creation);assert.deepEqual(await native.read(lost.id,actor),await sqlite.read(lost.id,actor));vectors++;
  await lossy.close();await proxy.close();proxy=await startCommitAckLossProxy(input.options.endpoint.port);
  const eraseLoss=createPostgresUserDomainTransport({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest);transports.push(eraseLoss);await eraseLoss.runPrivacy.creationReady();
  const lostErase=save('lost-erase','private'),eraseRequest={revision:0,requestId:randomUUID()};proxy.arm();
  await assert.rejects(eraseLoss.runPrivacy.erase(lostErase.id,actor,eraseRequest),e=>e instanceof PostgresDomainWriteOutcomeUnknown);assert.equal(proxy.observation().dropped,true);vectors++;
  const erased=await sqlite.erase(lostErase.id,actor,eraseRequest);assert.deepEqual((await native.owner(lostErase.id,actor))?.state,erased);assert.deepEqual(await native.erase(lostErase.id,actor,eraseRequest),erased);vectors++;
  pg(`DELETE FROM public.web_sessions WHERE hash=${q(session)};`);db.prepare('DELETE FROM web_sessions WHERE hash=?').run(session);
  await Promise.all([assert.rejects(native.setDefault(actor,'public',randomUUID()),/unauthenticated/),assert.rejects(sqlite.setDefault(actor,'public',randomUUID()),/unauthenticated/)]);vectors++;
  return {vectors,currentSqliteOracle:true,originalsPreserved:true,publicPrivateUnlistedFilteredInStorage:true,atomicPublicationVisibilityAndErasure:true,liveSourceAndItemProvenance:true,claimedErasureRetainsExactOwnerBinding:true,claimsDisabledRefusesPrivateClaimedReads:true,actualLostPublicationAndErasureCommitAcknowledgements:true,noAutomaticRetry:true,retainedOwnerAndDigest:true,idempotentRequests:true,productionData:false,paidOperations:0,runtimeQualified:false};
 }finally{await Promise.all(transports.map(t=>t.close()));if(proxy)await proxy.close();db.close();pg("DELETE FROM public.query_memories WHERE id LIKE 'synthetic-native-privacy-%';DELETE FROM public.anonymous_run_claims WHERE run_id LIKE 'synthetic-native-privacy-%';DELETE FROM public.query_runs WHERE id LIKE 'synthetic-native-privacy-%';DELETE FROM public.source_items WHERE id='synthetic-native-privacy-item';DELETE FROM public.sources WHERE id='synthetic-native-privacy-source';DELETE FROM public.web_sessions WHERE hash='"+session+"';");}
}
