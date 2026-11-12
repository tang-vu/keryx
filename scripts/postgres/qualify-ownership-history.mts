/** Actual current SQLite ownership oracle and independent PG SOURCE. Synthetic. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { installSqliteApplicationSchema } from '../../lib/db/sqlite-application-schema';
import { createSqliteRunClaims,RUN_CLAIMS_SQL } from '../../lib/db/run-claims-sqlite';
import { createSqliteRunOwnershipHistory } from '../../lib/db/run-ownership-history-sqlite';
import { writeSqliteQueryRun } from '../../lib/db/query-run-record';
import { readRunOwnershipHistory,type RunOwnershipHistoryQuery } from '../../lib/run-claims/history';
import { createPostgresUserDomainTransport } from '../../lib/db/postgres/user-domain-transport';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import type { StorageIdentity } from '../../lib/db/storage-identity';
import type { QueryRun } from '../../lib/types';
import { heldHistoryProjectionSql,sqliteOriginalHistoryProjection } from './run-history-projection.mts';
import { heldOwnershipHistoryProjectionSql,sqliteOwnershipHistoryProjection } from './ownership-history-projection.mts';
export async function qualifyOwnershipHistory(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;ownerSql:(sql:string)=>string}){
 const db=new DatabaseSync(':memory:'),transport=createPostgresUserDomainTransport(input.options,input.identity,input.digest),native=transport.runOwnershipHistory;
 const owner='0x'+'b1'.repeat(20),other='0x'+'b2'.repeat(20),binding={network:'eip155:5042' as const,origin:'https://keryx.cc'},otherBinding={...binding,origin:'https://another.example'},date=new Date(Date.now()-2000).toISOString(),session='a3'.repeat(32),hash=(s:string)=>createHash('sha256').update(s).digest('hex'),q=(s:string)=>"'"+s.replaceAll("'","''")+"'";
 const pg=(s:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+s+"UPDATE keryx_storage.control SET mode='active';COMMIT;");let vectors=0,now=Date.now();
 const derive=(id:string)=>heldHistoryProjectionSql(id,sqliteOriginalHistoryProjection(db,id))+heldOwnershipHistoryProjectionSql(id,sqliteOwnershipHistoryProjection(db,id));
 try{
  installSqliteApplicationSchema(db);db.exec(RUN_CLAIMS_SQL);const sqlite=createSqliteRunOwnershipHistory(db),claims=createSqliteRunClaims(db,{fixtureClock:()=>now});
  db.prepare('INSERT INTO web_sessions(hash,wallet,issued_at,expires_at) VALUES(?,?,?,?)').run(session,owner,now-10000,now+86400000);
  const save=(suffix:string,patch:Partial<QueryRun>={},make?:(run:QueryRun)=>string)=>{
   const run:QueryRun={id:'synthetic-ownership-'+suffix,createdAt:date,question:'Original %_ synthetic question',budget:0,engine:'heuristic',answer:'Private answer',subClaims:[],decisions:[],citations:[],trace:[],totalSpent:.01,totalToCreators:.005,paymentMode:'offline',...patch};
   writeSqliteQueryRun(db,run,false);const wire=make?make(run):JSON.stringify(run);db.prepare('UPDATE query_runs SET data=? WHERE id=?').run(wire,run.id);
   pg(`INSERT INTO public.query_runs(id,created_at,question,budget,data,asker) VALUES(${q(run.id)},${q(date)},'Different scalar column',0,${q(wire)}::json,${run.asker?q(run.asker):'NULL'});`+derive(run.id));return run;
  };
  const claim=async(id:string,targetBinding=binding)=>{
   await claims.issue({runId:id,completedAt:date,tokenHash:hash(id),binding:targetBinding});await claims.claim({tokenHash:hash(id),wallet:owner,sessionHash:session,binding:targetBinding});
   const c=db.prepare('SELECT * FROM anonymous_run_claims WHERE run_id=?').get(id)!;
   pg(`INSERT INTO public.anonymous_run_claims(run_id,network,origin,token_hash,original_sha256,completed_at,issued_at,expires_at,claimed_wallet,claimed_at) VALUES(${q(id)},${q(targetBinding.network)},${q(targetBinding.origin)},${q(String(c.token_hash))},${q(String(c.original_sha256))},${q(String(c.completed_at))},${c.issued_at},${c.expires_at},${q(owner)},${c.claimed_at});`);
  };
  const list=async(query:Partial<RunOwnershipHistoryQuery>={},wallet=owner)=>{const full={binding,filters:{},take:51,...query};assert.deepEqual(await native.list(wallet,full),await sqlite.list(wallet,full));vectors++;};
  const read=async(id:string,wallet=owner,targetBinding=binding)=>{assert.deepEqual(await native.read(wallet,targetBinding,id),await sqlite.read(wallet,targetBinding,id));vectors++;};
  const recorded=save('recorded',{asker:owner,askerFunded:true,provenance:{version:1,surface:'web',ownershipMethod:'session'}}),claimed=save('claimed');await claim(claimed.id);save('other',{asker:other});save('unclaimed');const foreign=save('foreign');await claim(foreign.id,otherBinding);
  await list();await list({},other);await list({binding:otherBinding});for(const id of [recorded.id,claimed.id,foreign.id,'missing'])await read(id);await read(claimed.id,other);await read(claimed.id,owner,otherBinding);
  assert(!JSON.stringify(await native.list(owner,{binding,filters:{},take:51})).includes('Private answer'));vectors++;
  for(const filters of [{search:'%_'},{search:'absent'},{surface:'web' as const},{surface:'unknown' as const},{funding:'browser-recorded' as const},{funding:'other-or-unknown' as const},{from:date,to:date}])await list({filters});
  for(const id of ['A','a','b','c']){const run=save('page-'+id,id==='b'?{asker:owner}:{});if(id!=='b')await claim(run.id);}
  assert.deepEqual(await readRunOwnershipHistory(native,owner,binding,{limit:2}),await readRunOwnershipHistory(sqlite,owner,binding,{limit:2}));vectors++;
  const first=await readRunOwnershipHistory(native,owner,binding,{limit:2});assert(first.nextCursor);assert.deepEqual(await readRunOwnershipHistory(native,owner,binding,{limit:2,cursor:first.nextCursor}),await readRunOwnershipHistory(sqlite,owner,binding,{limit:2,cursor:first.nextCursor}));vectors++;
  for(const value of ['private\0answer','private\ud800answer']){const run=save('escaped-'+vectors,{answer:value});await claim(run.id);await read(run.id);await list();}
  const duplicate=save('duplicate',{asker:owner},run=>JSON.stringify(run).slice(0,-1)+',"question":"Different last question"}');await read(duplicate.id);await list();
  await assert.rejects(native.list(owner,{binding,filters:{search:'%_'},take:51}),/history_unavailable/);await assert.rejects(sqlite.list(owner,{binding,filters:{search:'%_'},take:51}),/history_unavailable/);vectors++;
  db.prepare('DELETE FROM query_runs WHERE id=?').run(duplicate.id);pg(`DELETE FROM public.query_runs WHERE id=${q(duplicate.id)};`);
  const conflict=save('owner-conflict',{asker:owner},run=>JSON.stringify({...run,asker:other}));
  await assert.rejects(native.read(owner,binding,conflict.id),/history_unavailable/);await assert.rejects(sqlite.read(owner,binding,conflict.id),/history_unavailable/);vectors++;
  await assert.rejects(native.list(owner,{binding,filters:{},take:51}),/history_unavailable/);await assert.rejects(sqlite.list(owner,{binding,filters:{},take:51}),/history_unavailable/);vectors++;
  db.prepare('DELETE FROM query_runs WHERE id=?').run(conflict.id);pg(`DELETE FROM public.query_runs WHERE id=${q(conflict.id)};`);
  const before=JSON.stringify(db.prepare('SELECT data FROM query_runs ORDER BY id').all());await read(recorded.id);assert.equal(JSON.stringify(db.prepare('SELECT data FROM query_runs ORDER BY id').all()),before);vectors++;
  const a2a=save('a2a');await claim(a2a.id);
  const orderSql=`INSERT INTO a2a_orders(id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,service_fee_usdc,research_mode,status,transaction_id,created_at,updated_at) VALUES('synthetic-ownership-order',${q(a2a.id)},'synthetic-ownership-authorization','synthetic-ownership-request',${q(owner)},${q(other)},0.1,0.09,0.01,'deep','completed','synthetic-ownership-transaction',${q(date)},${q(date)});`;
  db.exec(orderSql);pg(orderSql.replace('INSERT INTO a2a_orders','INSERT INTO public.a2a_orders'));await read(a2a.id);await list();
  db.prepare('UPDATE query_runs SET asker=? WHERE id=?').run(other,recorded.id);pg(`UPDATE public.query_runs SET asker=${q(other)} WHERE id=${q(recorded.id)};`);assert.equal(input.ownerSql(`SELECT count(*) FROM keryx_storage.run_ownership_projection WHERE run_id=${q(recorded.id)};`),'0');vectors++;await read(recorded.id);
  db.prepare('UPDATE query_runs SET asker=? WHERE id=?').run(owner,recorded.id);pg(`UPDATE public.query_runs SET asker=${q(owner)} WHERE id=${q(recorded.id)};`+heldOwnershipHistoryProjectionSql(recorded.id,sqliteOwnershipHistoryProjection(db,recorded.id)));
  now+=172800000;await read(claimed.id);await list();
  const changed=String(db.prepare('SELECT data FROM query_runs WHERE id=?').get(claimed.id)!.data)+' ';db.prepare('UPDATE query_runs SET data=? WHERE id=?').run(changed,claimed.id);pg(`UPDATE public.query_runs SET data=${q(changed)}::json WHERE id=${q(claimed.id)};`);await read(claimed.id);await list();
  pg(`DELETE FROM keryx_storage.run_ownership_projection WHERE run_id=${q(recorded.id)};`);await assert.rejects(native.list(owner,{binding,filters:{search:'would hide missing derivative'},take:51}),/history_unavailable/);vectors++;pg(heldOwnershipHistoryProjectionSql(recorded.id,sqliteOwnershipHistoryProjection(db,recorded.id)));
  assert.throws(()=>input.ownerSql(`DELETE FROM keryx_storage.run_ownership_projection WHERE run_id=${q(recorded.id)};`),/writer required/);vectors++;
  await transport.close();await assert.rejects(native.read(owner,binding,recorded.id),/history_unavailable/);vectors++;
  return {vectors,currentSqliteOracle:true,unchangedPrivateOriginal:true,summaryOmitsPrivateBody:true,currentA2aMembershipRechecked:true,recordedMetadataInvalidatesDerivative:true,recordedAndClaimedDeduplicated:true,binaryKeysetAndExactBinding:true,literalFilters:true,expiredConsumedClaimRetained:true,changedOriginalExcluded:true,escapedNulAndSurrogatePreserved:true,duplicateKeySemanticsPreserved:true,missingDerivativeRefusedBeforeFilters:true,heldWriterFence:true,terminalClose:true,productionData:false,paidOperations:0};
 }finally{await transport.close();db.close();pg("DELETE FROM public.a2a_orders WHERE id='synthetic-ownership-order';DELETE FROM public.anonymous_run_claims WHERE run_id LIKE 'synthetic-ownership-%';DELETE FROM public.query_runs WHERE id LIKE 'synthetic-ownership-%';");}
}
