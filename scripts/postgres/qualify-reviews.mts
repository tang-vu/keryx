import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../../lib/canonical-json';
import { createSqliteDecisionReviews } from '../../lib/db/decision-reviews-sqlite';
import { type CaptureDecision,type DecisionReview,REVIEW_WAIT_MS } from '../../lib/research/decision-review-types';
import { createPostgresDomainChannel,PostgresDomainWriteOutcomeUnknown } from '../../lib/db/postgres/domain-channel';
import { composePostgresDecisionReviews } from '../../lib/db/postgres/reviews-transport';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import type { StorageIdentity } from '../../lib/db/storage-identity';
import { startCommitAckLossProxy } from './commit-ack-loss.mts';
import { reviewOriginalMetadata } from '../../lib/db/postgres/review-packet';
export async function qualifyReviews(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;ownerSql:(sql:string)=>string}){
 const channel=createPostgresDomainChannel(input.options,input.identity,input.digest),native=composePostgresDecisionReviews(channel,false),db=new DatabaseSync(':memory:'),sqlite=createSqliteDecisionReviews(db);
 const owner='0x'+'c7'.repeat(20),other='0x'+'c8'.repeat(20),at=Date.parse('2026-10-09T10:00:00.000Z'),q=(v:string)=>"'"+v.replaceAll("'","''")+"'";let vectors=0;
 const pg=(sql:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+sql+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 const decision=(patch:Partial<CaptureDecision>={}):CaptureDecision=>({policyVersion:'captured-owner-decisions-v1',engine:'synthetic',requestedModel:null,runId:randomUUID(),round:0,ordinal:0,sourceName:'Synthetic source',modelAction:'BUY',codeAction:'BUY',codeRule:'selected',reviewFirst:true,cohort:'unknown',cohortEvidence:null,terms:{assetId:'item:one',sourceId:'synthetic-review-source',owned:true,itemId:'one',contentVersion:'version-one',network:'eip155:5042',payTo:other,priceMicroUsdc:'5000',listPriceMicroUsdc:'5000',citationBudgetMicroUsdc:'10000'},...patch});
 const normalize=(r:DecisionReview|null)=>r===null?null:{...r,id:'generated'},equal=(a:DecisionReview|null,b:DecisionReview|null)=>assert.deepEqual(normalize(a),normalize(b));
 const paired=async(d:CaptureDecision,now=at)=>{const a=await native.capture(owner,d,now),b=await sqlite.capture(owner,d,now);equal(a,b);vectors++;return [a,b] as const;};
 const stores=[native,sqlite] as const;
 try{
  await native.ready();await sqlite.ready();vectors++;
  const first=await paired(decision({sourceName:'Synthetic\0name 🌍'}));equal(await native.read(owner,first[0].id),await sqlite.read(owner,first[1].id));vectors++;
  assert.equal(await native.read(other,first[0].id),null);assert.deepEqual(await native.list(other,first[0].runId),[]);await assert.rejects(native.begin(other,first[0].id,at),/review_not_found/);vectors++;
  let active:DecisionReview[]=[];for(const [i,s] of stores.entries())active.push(await s.begin(owner,first[i].id,at+1));equal(active[0],active[1]);assert.equal(Date.parse(active[0].expiresAt!),at+1+REVIEW_WAIT_MS);vectors++;
  for(const [i,s] of stores.entries())await assert.rejects(s.begin(owner,first[i].id,at+2),/review_conflict/);vectors++;
  const key=randomUUID();for(const [i,s] of stores.entries())active[i]=await s.verdict(owner,{id:first[i].id,key,context:'gate',value:'agree',reason:'Private reason 🌍'},at+2);equal(active[0],active[1]);vectors++;
  for(const [i,s] of stores.entries())await assert.rejects(s.consume(owner,first[i].id,{...first[i].terms,priceMicroUsdc:'5001'},at+3),/review_conflict/);vectors++;
  for(const [i,s] of stores.entries())active[i]=await s.consume(owner,first[i].id,first[i].terms,at+3);equal(active[0],active[1]);vectors++;
  for(const [i,s] of stores.entries())equal(await s.verdict(owner,{id:first[i].id,key,context:'gate',value:'agree',reason:'Private reason 🌍'},at+4),active[i]);vectors++;
  for(const [i,s] of stores.entries()){await assert.rejects(s.verdict(owner,{id:first[i].id,key,context:'gate',value:'disagree',reason:'Private reason 🌍'},at+4),/review_conflict/);await assert.rejects(s.consume(owner,first[i].id,first[i].terms,at+4),/review_conflict/);}vectors++;
  const opinionKey=randomUUID();for(const [i,s] of stores.entries())active[i]=await s.verdict(owner,{id:first[i].id,key:opinionKey,context:'opinion',value:'disagree',expectedCode:{action:'BUY',rule:'selected'}},at+REVIEW_WAIT_MS*2);equal(active[0],active[1]);assert.equal(active[0].state,'consumed');vectors++;
  const expired=await paired(decision());for(const [i,s] of stores.entries()){await s.begin(owner,expired[i].id,at);await assert.rejects(s.verdict(owner,{id:expired[i].id,key:randomUUID(),context:'gate',value:'agree'},at+REVIEW_WAIT_MS),/review_expired/);await s.expire(owner,expired[i].id,at+REVIEW_WAIT_MS);}equal(await native.read(owner,expired[0].id),await sqlite.read(owner,expired[1].id));vectors++;
  const changed=await paired(decision());for(const [i,s] of stores.entries()){await s.begin(owner,changed[i].id,at);await s.verdict(owner,{id:changed[i].id,key:randomUUID(),context:'gate',value:'agree'},at+1);await s.observe(owner,changed[i].id,'SKIP','terms-changed');await assert.rejects(s.consume(owner,changed[i].id,changed[i].terms,at+2),/review_conflict/);}equal(await native.read(owner,changed[0].id),await sqlite.read(owner,changed[1].id));vectors++;
  const opinion=await paired(decision({reviewFirst:false})),okey=randomUUID();for(const [i,s] of stores.entries()){await s.verdict(owner,{id:opinion[i].id,key:okey,context:'opinion',value:'agree',expectedCode:{action:'BUY',rule:'selected'}},at+1);await s.observe(owner,opinion[i].id,'SKIP','budget');await assert.rejects(s.verdict(owner,{id:opinion[i].id,key:randomUUID(),context:'opinion',value:'agree',expectedCode:{action:'BUY',rule:'selected'}},at+2),/review_conflict/);}
  equal(await native.verdict(owner,{id:opinion[0].id,key:okey,context:'opinion',value:'agree',expectedCode:{action:'BUY',rule:'selected'}},at+3),await sqlite.verdict(owner,{id:opinion[1].id,key:okey,context:'opinion',value:'agree',expectedCode:{action:'BUY',rule:'selected'}},at+3));vectors++;
  const cancelled=await paired(decision());for(const s of stores)await s.cancel(owner,cancelled[0].runId);equal(await native.read(owner,cancelled[0].id),await sqlite.read(owner,cancelled[1].id));vectors++;
  const race=await native.capture(owner,decision(),at);await native.begin(owner,race.id,at);const verdicts=await Promise.allSettled([0,1].map(()=>native.verdict(owner,{id:race.id,key:randomUUID(),context:'gate',value:'agree'},at+1)));assert.equal(verdicts.filter(r=>r.status==='fulfilled').length,1);const consumes=await Promise.allSettled([0,1].map(()=>native.consume(owner,race.id,race.terms,at+2)));assert.equal(consumes.filter(r=>r.status==='fulfilled').length,1);vectors++;
  // Keep the metric parity population equal after the native race proof.
  pg(`DELETE FROM public.decision_review_verdicts WHERE decision_id=${q(race.id)};DELETE FROM public.decision_review_records WHERE id=${q(race.id)};`);
  await paired(decision({codeAction:'SKIP',codeRule:'model-skip',modelAction:'SKIP',cohort:'team',cohortEvidence:'synthetic-team'}));
  const period=['eip155:5042','2026-10-09T00:00:00.000Z','2026-10-10T00:00:00.000Z'] as const;assert.deepEqual(await native.metrics(...period),await sqlite.metrics(...period));assert(!JSON.stringify(await native.metrics(...period)).includes('Private reason'));vectors++;
  for(const name of ['\ud800','🌍'.repeat(129)])await assert.rejects(native.capture(owner,decision({sourceName:name}),at));vectors++;
  const limitRun=randomUUID(),limitInput=canonicalJson(decision({runId:limitRun})),stamp=new Date(at).toISOString();
  pg(`INSERT INTO public.decision_review_records(id,wallet,run_id,network,created_at,input_json,state,code_action,code_rule) SELECT 'fefefefe-fefe-4efe-8efe-'||lpad(g::text,12,'0'),${q(owner)},${q(limitRun)},'eip155:5042',${q(stamp)},${q(limitInput)},'observed','BUY','selected' FROM generate_series(1,300) g;`);
  pg(`INSERT INTO keryx_storage.review_projection(id,original_sha256,metadata) SELECT id,encode(sha256(convert_to(input_json,'UTF8')),'hex'),${q(canonicalJson(reviewOriginalMetadata(limitInput)))}::jsonb FROM public.decision_review_records WHERE wallet=${q(owner)} AND run_id=${q(limitRun)};`);
  assert.equal((await native.list(owner,limitRun)).length,300);await assert.rejects(native.capture(owner,decision({runId:limitRun}),at),/review_unavailable/);vectors++;
  const original=input.ownerSql(`SELECT input_json FROM public.decision_review_records WHERE id=${q(first[0].id)};`),metadata=canonicalJson(reviewOriginalMetadata(original));
  pg(`UPDATE public.decision_review_records SET input_json=input_json||' ' WHERE id=${q(first[0].id)};`);await assert.rejects(native.read(owner,first[0].id),/review_unavailable/);await assert.rejects(native.metrics(...period),/review_unavailable/);vectors++;
  pg(`UPDATE public.decision_review_records SET input_json=${q(original)} WHERE id=${q(first[0].id)};`);await assert.rejects(native.read(owner,first[0].id),/review_unavailable/);pg(`INSERT INTO keryx_storage.review_projection(id,original_sha256,metadata) VALUES(${q(first[0].id)},encode(sha256(convert_to(${q(original)},'UTF8')),'hex'),${q(metadata)}::jsonb);`);equal(await native.read(owner,first[0].id),await sqlite.read(owner,first[1].id));vectors++;
  assert.equal(input.options.endpoint.kind,'loopback');const proxy=await startCommitAckLossProxy(input.options.endpoint.port),brokenChannel=createPostgresDomainChannel({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest),broken=composePostgresDecisionReviews(brokenChannel,false);
  try{const r=await native.capture(owner,decision(),at);proxy.arm();await assert.rejects(broken.begin(owner,r.id,at),PostgresDomainWriteOutcomeUnknown);assert.deepEqual(proxy.observation(),{dropped:true,commands:1});assert.equal((await native.read(owner,r.id))?.state,'held');vectors++;}finally{await brokenChannel.close();await proxy.close();}
  const readerChannel=createPostgresDomainChannel({...input.options,role:'keryx_reader'},input.identity,input.digest),reader=composePostgresDecisionReviews(readerChannel,true);try{await reader.ready();assert.equal(await reader.read(owner,first[0].id) instanceof Object,true);await assert.rejects(reader.capture(owner,decision(),at));await assert.rejects(composePostgresDecisionReviews(readerChannel,false).capture(owner,decision(),at));vectors++;}finally{await readerChannel.close();}
  return {vectors,actualPostgres:true,sqliteParity:true,escapedNulSourceNamePreserved:true,exactTermsAndDeadline:true,ownerIsolation:true,singleVerdictAndConsume:true,duplicateVerdictReadback:true,completeBoundedListAndMetrics:true,actualLostCommitAck:true,noAutomaticRetry:true,readonlyRoleRefused:true,productionData:false,paidOperations:0,fullWriterQualified:false};
 }finally{try{pg(`DELETE FROM public.decision_review_verdicts WHERE wallet=${q(owner)};DELETE FROM public.decision_review_records WHERE wallet=${q(owner)};`);}finally{await channel.close();db.close();}}
}
