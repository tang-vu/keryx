/** Native aggregates compared with the current SQLite calculator. Synthetic
 * recorded statistics are not settlement proof, payments or traction. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { SqliteAdapter } from '../../lib/db/sqlite-adapter';
import { assembleNativePostgresBusinessCore } from '../../lib/db/supabase-adapter';
import { createPostgresApplicationDomainAuthority } from '../../lib/db/postgres/application-domain-authority';
import type { PostgresApplicationDomainTransport } from '../../lib/db/postgres/application-domain-transport';
import type { StorageIdentity } from '../../lib/db/storage-identity';
export async function qualifyDashboardMetrics(input:{transport:PostgresApplicationDomainTransport;identity:StorageIdentity;ownerSql:(sql:string)=>string}){
 const db=new DatabaseSync(':memory:'),stamp='2026-01-02T03:04:05.000Z',wallet='0x'+'a6'.repeat(20),q=(s:string)=>"'"+s.replaceAll("'","''")+"'";let vectors=0;
 const native=assembleNativePostgresBusinessCore({identity:input.identity,authority:createPostgresApplicationDomainAuthority(input.transport),assertEntry:()=>{},verify:async()=>{await input.transport.applicationRead('get_sync_state',{p_key:'synthetic-dashboard-authority'});}});
 const pg=(sql:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+sql+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 const both=(sql:string)=>{db.exec(sql);pg(sql.replaceAll('settled_integer','settled'));};
 try{
  db.exec('BEGIN');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);db.exec('COMMIT');
  const sqlite=SqliteAdapter.assembleConnectionCore(db,input.identity,()=>{});await native.adapter.init();
  const compare=async()=>{assert.deepEqual(await native.adapter.metrics(),await sqlite.metrics());vectors++;};await compare();
  const runRows=[['web',null,null,null,null],['web','',null,2,0],['web',wallet,null,3,1],['mcp',null,'codex',null,null],['mcp',null,'claude',0,0],['mcp',null,null,1,0],['mcp',null,'codex',5,2]] as const;
  for(let i=0;i<runRows.length;i++){
   const [origin,asker,client,evidence,rewarded]=runRows[i];
   both(`INSERT INTO query_runs(id,created_at,question,budget,data,origin,asker,mcp_client,evidence_claim_count,rewarded_citation_count) VALUES('synthetic-metric-run-${i}',${q(stamp)},'synthetic',0,'{}',${q(origin)},${asker===null?'NULL':q(asker)},${client===null?'NULL':q(client)},${evidence??'NULL'},${rewarded??'NULL'});`);
  }
  for(const address of [wallet,wallet.toUpperCase(),'not-a-wallet'])both(`INSERT INTO users(wallet_address,role,display_handle,first_seen_at,last_seen_at) VALUES(${q(address)},'reader','synthetic',${q(stamp)},${q(stamp)});`);
  for(const [i,status] of ['pending','running','filled','missed','unpaid','stale','failed'].entries())both(`INSERT INTO gap_intents(id,gap_id,claim,question,failed_query_id,source_id,owner_wallet,status,created_at,updated_at) VALUES('synthetic-metric-gap-${i}','gap-${i}','synthetic','synthetic','synthetic','synthetic',${q(wallet)},${q(status)},${q(stamp)},${q(stamp)});`);
  for(const [i,rating] of ['up','down','up'].entries())both(`INSERT INTO answer_feedback(id,query_id,rating,created_at) VALUES('synthetic-metric-feedback-${i}','synthetic',${q(rating)},${q(stamp)});`);
  await compare();
  const cases=[['fetch',true,'settled','synthetic'],['citation',true,'settled','synthetic'],['inbound',true,'settled','synthetic'],
   ['fetch',false,'pending',null],['citation',false,'failed',null],['fetch',false,'failed','synthetic'],
   ['operating-fee',true,'settled','synthetic'],['operating-fee',true,'settled',' \t\n '],['operating-fee',true,'settled','\u00a0'],
   ['operating-fee',false,'failed','synthetic'],['operating-fee',false,'pending',null]] as const;
  for(const [i,[kind,settled,status,tx]] of cases.entries()){
   const cols='id,created_at,kind,query_id,source_id,source_name,payer,payee,amount_usdc,network,settled,settlement_status,tx_hash';
   const before=`'synthetic-metric-payment-${i}',${q(stamp)},${q(kind)},'synthetic-metric-run-${i%runRows.length}','source-${i%2}','synthetic',${q(wallet)},${q(wallet)},${i%2?'.123456':'.000001'},'eip155:5042',`;
   const after=`,${status===null?'NULL':q(status)},${tx===null?'NULL':q(tx)}`;
   db.exec(`INSERT INTO payment_events(${cols}) VALUES(${before}${settled?1:0}${after});`);
   pg(`INSERT INTO payment_events(${cols}) VALUES(${before}${settled?'true':'false'}${after});`);await compare();
  }
  // Tens of thousands of persisted answers do not become Node input rows.
  const baseline=await native.adapter.metrics();
  pg("INSERT INTO public.query_runs(id,question,budget,data,origin) SELECT 'synthetic-metric-scale-'||g,'synthetic',0,jsonb_build_object('answer',repeat('x',4096)),'web' FROM generate_series(1,20000) g;");
  const scaled=await native.adapter.metrics();assert.equal(scaled.totalQueries,baseline.totalQueries+20000);assert.equal(scaled.guestQuestions,baseline.guestQuestions!+20000);assert.equal(scaled.totalPayments,baseline.totalPayments);assert(Buffer.byteLength(JSON.stringify(scaled))<8192);vectors++;
  return {vectors,currentSqliteDashboardParity:true,settlementClassificationAndEcmascriptWhitespace:true,mcpChannelsAndEvidenceCounters:true,validNormalizedAccountAggregate:true,scaleRows:20000,resultBytes:Buffer.byteLength(JSON.stringify(scaled)),rawAnswerTransport:false,productionData:false,paidOperations:0};
 }finally{
  native.hooks.close();db.close();
  pg("DELETE FROM public.payment_events WHERE id LIKE 'synthetic-metric-%';DELETE FROM public.query_runs WHERE id LIKE 'synthetic-metric-%';DELETE FROM public.answer_feedback WHERE id LIKE 'synthetic-metric-%';DELETE FROM public.gap_intents WHERE id LIKE 'synthetic-metric-%';DELETE FROM public.users WHERE display_handle='synthetic';");
 }
}
