/** Synthetic complete-result bounds and projected scans on actual PostgreSQL. */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import type { PostgresApplicationReadTransport } from '../../lib/db/postgres/application-read-transport';
import { PostgresStorageUnavailable } from '../../lib/db/postgres/connection';
export async function qualifyBoundedReads(input:{transport:PostgresApplicationReadTransport;ownerSql:(sql:string)=>string}){
 const read=input.transport.applicationRead;let vectors=0;
 const imported=(sql:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+sql+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 const baseline=(query:string)=>JSON.parse(input.ownerSql("SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM ("+query+") r;"));
 assert.equal(input.ownerSql("SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND position('FOR native_bound_row IN' in prosrc)>0 AND position('FOR native_bound_row IN' in prosrc)<position('jsonb_agg(' in prosrc);"),'29');vectors++;
 try{
  imported("INSERT INTO public.source_items(id,source_id,title,content,published_at) VALUES('synthetic-bound-small-a','synthetic-domain-source','A','small-a','2026-01-02'),('synthetic-bound-small-b','synthetic-domain-source','B','small-b','2026-01-01');");
  assert.deepEqual(await read('get_items',{p_source_id:'synthetic-domain-source'}),baseline("SELECT * FROM public.source_items WHERE source_id='synthetic-domain-source' ORDER BY published_at DESC LIMIT 1001"));vectors++;
  assert.deepEqual(await read('list_all_sources',{}),baseline('SELECT * FROM public.sources ORDER BY created_at ASC LIMIT 1001'));vectors++;
  imported("INSERT INTO public.query_runs(id,question,budget,data) VALUES('synthetic-bound-small','synthetic',0,'{\"answer\":\"small\"}'::jsonb);");
  assert.deepEqual(await read('list_recent_queries',{p_limit:1}),baseline('SELECT data FROM public.query_runs ORDER BY created_at DESC LIMIT 1'));vectors++;
  imported("DELETE FROM public.query_runs WHERE id='synthetic-bound-small';DELETE FROM public.source_items WHERE id IN('synthetic-bound-small-a','synthetic-bound-small-b');"+
   "INSERT INTO public.source_items(id,source_id,title,content,published_at) SELECT 'synthetic-bound-large-'||g,'synthetic-domain-source','synthetic',repeat(chr(9),131072),'2026-01-01' FROM generate_series(1,32) g;"+
   "INSERT INTO public.query_runs(id,question,budget,data) SELECT 'synthetic-bound-large-'||g,'synthetic',0,jsonb_build_object('answer',repeat('x',327680)) FROM generate_series(1,32) g;");
  let ticks=0,maxGap=0,last=performance.now();const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;ticks++;},10);
  try{await assert.rejects(read('get_items',{p_source_id:'synthetic-domain-source'}),PostgresStorageUnavailable);vectors++;}finally{clearInterval(timer);}
  assert(ticks>0&&maxGap<500,'Native aggregate refusal must not block JavaScript timers');vectors++;
  await assert.rejects(read('list_recent_queries',{p_limit:32}),PostgresStorageUnavailable);vectors++;
  const scan=await read('scan_query_metrics',{p_offset:0,p_limit:1000});assert(Array.isArray(scan));assert.equal(scan.length,32);assert(scan.every(r=>!Object.hasOwn(r,'data')&&!Object.hasOwn(r,'answer')));assert(Buffer.byteLength(JSON.stringify(scan))<32768);vectors++;
  assert.deepEqual(await read('scan_query_metrics',{p_offset:32,p_limit:1000}),[]);vectors++;
  await assert.rejects(read('scan_query_metrics',{p_offset:0,p_limit:1001}),PostgresStorageUnavailable);vectors++;
  await assert.rejects(read('scan_query_metrics',{p_offset:-1,p_limit:1}),PostgresStorageUnavailable);vectors++;
  for(const op of ['scan_payment_metrics','scan_feedback_metrics','scan_gap_metrics','scan_order_economics'] as const){assert.deepEqual(await read(op,{p_offset:0,p_limit:1000}),[]);vectors++;}
  return {vectors,boundedAggregates:29,normalResultParity:true,escapedWireOverflowRefused:true,largeAnswerAggregationRefused:true,largeAnswersExcludedFromMetricScans:true,cursorBoundsRetained:true,jsTicks:ticks,maxJsGapMs:Math.round(maxGap),productionData:false,paidOperations:0,
   limitations:'Single-row conversion and whole-report accumulation still need separate bounds; custom read families, full current domains, installed runtime and compiled production load remain unqualified.'};
 }finally{imported("DELETE FROM public.query_runs WHERE id LIKE 'synthetic-bound-%';DELETE FROM public.source_items WHERE id LIKE 'synthetic-bound-%';");}
}
