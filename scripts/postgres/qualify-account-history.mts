/** Actual native final evidence read versus the genuine selected SQLite seal. */
import assert from 'node:assert/strict';
import { mkdtempSync,existsSync,unlinkSync,rmdirSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { nativeAccountFixture,nativeAccountFixturePaths,nativeAccountFixtureTables } from './native-account-fixture.mts';
import { registerStorageCapability } from '../../lib/db/storage-identity-sqlite';
import { openVerifiedSqliteStorage } from '../../lib/db/storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../../lib/db/enrolled-sqlite-schema-profile';
import { createEnrolledSqliteAccountMembership } from '../../lib/accounts/sqlite-store';
import { writeSqliteQueryRun } from '../../lib/db/query-run-record';
import { createPostgresDomainChannel } from '../../lib/db/postgres/domain-channel';
import { composePostgresAccountHistory } from '../../lib/db/postgres/account-history-transport';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import type { StorageIdentity } from '../../lib/db/storage-identity';
import type { AccountHistoryObservation } from '../../lib/accounts/contracts';
import type { QueryRun } from '../../lib/types';
import { heldHistoryProjectionSql,sqliteOriginalHistoryProjection } from './run-history-projection.mts';
export async function qualifyAccountHistory(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;ownerSql:(sql:string)=>string}){
 const folder=mkdtempSync(join(tmpdir(),'keryx-account-history-')),paths=nativeAccountFixturePaths(folder),q=(s:string)=>"'"+s.replaceAll("'","''")+"'";
 const now=Date.now(),session={hash:'f8'.repeat(32),wallet:'0x'+'f7'.repeat(20),issuedAt:now-1000,expiresAt:now+600000},date=new Date(now-10000).toISOString();
 const channel=createPostgresDomainChannel(input.options,input.identity,input.digest),native=composePostgresAccountHistory(channel);
 const pg=(s:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+s+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 let selected:ReturnType<typeof openVerifiedSqliteStorage>|undefined,accountId:string|undefined,vectors=0;
 const owner=(work:(db:DatabaseSync)=>void)=>{const db=new DatabaseSync(paths[0]);try{registerStorageCapability(db,input.identity,()=>true);db.exec('BEGIN IMMEDIATE');work(db);db.exec('COMMIT');}catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}finally{db.close();}};
 const ids=['synthetic-account-history-recorded','synthetic-account-history-claimed'];
 try{
  const fixture=await nativeAccountFixture(folder,input.identity,session);accountId=fixture.accountId;const {snapshot,binding}=fixture.observation;
  pg(fixture.sql+`INSERT INTO public.web_sessions(hash,wallet,issued_at,expires_at) VALUES(${q(session.hash)},${q(session.wallet)},${session.issuedAt},${session.expiresAt});`);
  const originals=new Map<string,string>(),historyMetadata=new Map<string,string>(),observed:AccountHistoryObservation[]=[];
  owner(db=>{for(const [index,id] of ids.entries()){
   const run={id,createdAt:date,question:'Synthetic private history',answer:'Retained whole answer',budget:0,engine:'heuristic',totalSpent:0,totalToCreators:0,subClaims:[],decisions:[],citations:[],trace:[],paymentMode:'offline',...(index===0?{asker:session.wallet}:{}),extra:{escaped:'\0\ud800',unrelated:'Preserve all original fields'}} as QueryRun;
   writeSqliteQueryRun(db,run,false);assert.equal(db.prepare("UPDATE run_privacy SET visibility='private',updated_at=? WHERE run_id=?").run(date,id).changes,1);
   const wire=String(db.prepare('SELECT data FROM query_runs WHERE id=?').get(id)!.data);originals.set(id,wire);historyMetadata.set(id,heldHistoryProjectionSql(id,sqliteOriginalHistoryProjection(db,id)));
   if(index===1){db.prepare('INSERT INTO anonymous_run_claims(run_id,network,origin,token_hash,original_sha256,completed_at,issued_at,expires_at) VALUES(?,?,?,?,?,?,?,?)').run(id,binding.network,binding.origin,'f6'.repeat(32),createHash('sha256').update(wire).digest('hex'),date,now-5000,now-5000+86400000);db.prepare('UPDATE anonymous_run_claims SET claimed_wallet=?,claimed_at=? WHERE run_id=?').run(session.wallet,now-1000,id);}
   observed.push({id,ownerWallet:session.wallet,run:JSON.parse(wire) as QueryRun,state:{visibility:'private',revision:0,erased:false},ownership:index===0?{method:'recorded',claimedAt:null}:{method:'claimed',claimedAt:new Date(now-1000).toISOString()}});
  }});
  for(const [index,id] of ids.entries()){
   const wire=originals.get(id)!;pg(`INSERT INTO public.query_runs(id,created_at,question,budget,data,asker,engine,total_spent,total_to_creators,answer) VALUES(${q(id)},${q(date)},'Synthetic private history',0,${q(wire)}::json,${index===0?q(session.wallet):'NULL'},'heuristic',0,0,'Retained whole answer');INSERT INTO public.run_privacy(run_id,visibility,updated_at) VALUES(${q(id)},'private',${q(date)});`+(index===1?`INSERT INTO public.anonymous_run_claims(run_id,network,origin,token_hash,original_sha256,completed_at,issued_at,expires_at,claimed_wallet,claimed_at) VALUES(${q(id)},${q(binding.network)},${q(binding.origin)},${q('f6'.repeat(32))},${q(createHash('sha256').update(wire).digest('hex'))},${q(date)},${now-5000},${now-5000+86400000},${q(session.wallet)},${now-1000});`:'')+historyMetadata.get(id)!);
  }
  const manifest=readFileSync(paths[4],'utf8');selected=openVerifiedSqliteStorage(paths[0],input.identity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>assert.equal(readFileSync(paths[4],'utf8'),manifest)});
  const oracle=createEnrolledSqliteAccountMembership(selected.db);assert(oracle?.prepareHistoryFence);
  const prepare=async(items:readonly AccountHistoryObservation[]=observed)=>{const deadline=Date.now()+25000;return {n:await native.prepareAsyncHistoryFence!(snapshot,items,deadline),o:await oracle.prepareHistoryFence!(snapshot,items,deadline)};};
  const success=await prepare();await success.n();success.o();vectors++;await assert.rejects(success.n());assert.throws(success.o);vectors++;
  const empty=await prepare([]);await empty.n();empty.o();vectors++;
  for(const change of ['body','visibility','a2a'] as const){
   const proof=await prepare(),id=change==='a2a'?ids[1]:ids[0];
   if(change==='body'){const wire=JSON.stringify({...JSON.parse(originals.get(id)!),extra:{changed:true}});owner(db=>{db.prepare('UPDATE query_runs SET data=? WHERE id=?').run(wire,id);});pg(`UPDATE public.query_runs SET data=${q(wire)}::json WHERE id=${q(id)};`);}
   else if(change==='visibility'){owner(db=>{db.prepare("UPDATE run_privacy SET visibility='public',revision=revision+1 WHERE run_id=?").run(id);});pg(`UPDATE public.run_privacy SET visibility='public',revision=revision+1 WHERE run_id=${q(id)};`);}

   else{const orderSql=`INSERT INTO a2a_orders(id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,service_fee_usdc,research_mode,status,transaction_id,request_data,created_at,updated_at) VALUES('synthetic-account-history-a2a',${q(id)},${q('0x'+'f4'.repeat(32))},${q('f3'.repeat(32))},${q(session.wallet)},${q('0x'+'f5'.repeat(20))},.1,.09,.01,'quick','completed','synthetic-no-settlement',${q(JSON.stringify({network:binding.network}))},${q(date)},${q(date)});`;owner(db=>{db.exec(orderSql);});pg(orderSql.replace('INSERT INTO a2a_orders','INSERT INTO public.a2a_orders'));}
   await assert.rejects(proof.n());assert.throws(proof.o);vectors++;
   if(change==='body'){owner(db=>{db.prepare('UPDATE query_runs SET data=? WHERE id=?').run(originals.get(id)!,id);});pg(`UPDATE public.query_runs SET data=${q(originals.get(id)!)}::json WHERE id=${q(id)};`);}
   else if(change==='visibility'){owner(db=>{db.prepare("UPDATE run_privacy SET visibility='private',revision=0 WHERE run_id=?").run(id);});pg(`UPDATE public.run_privacy SET visibility='private',revision=0 WHERE run_id=${q(id)};`);}

   else{owner(db=>{db.prepare("DELETE FROM a2a_orders WHERE id='synthetic-account-history-a2a'").run();});pg("DELETE FROM public.a2a_orders WHERE id='synthetic-account-history-a2a';");}
  }
  const completion=(value:string)=>{owner(db=>{const sql=String(db.prepare("SELECT sql FROM sqlite_schema WHERE name='anonymous_run_claims_single_use'").get()!.sql);db.exec('DROP TRIGGER anonymous_run_claims_single_use');try{db.prepare('UPDATE anonymous_run_claims SET completed_at=? WHERE run_id=?').run(value,ids[1]);}finally{db.exec(sql);}});pg(`UPDATE public.anonymous_run_claims SET completed_at=${q(value)} WHERE run_id=${q(ids[1])};`);};
  const completionProof=await prepare([observed[1]]);completion(date.replace('Z','+00:00'));await assert.rejects(completionProof.n());assert.throws(completionProof.o);vectors++;
  completion(date);const restoredCompletion=await prepare([observed[1]]);await restoredCompletion.n();restoredCompletion.o();vectors++;
  const claimProof=await prepare([observed[1]]);
  owner(db=>{assert.throws(()=>db.prepare('UPDATE anonymous_run_claims SET claimed_wallet=? WHERE run_id=?').run('0x'+'f5'.repeat(20),ids[1]),/claim_unavailable/);});
  pg(`UPDATE public.anonymous_run_claims SET claimed_wallet=${q('0x'+'f5'.repeat(20))} WHERE run_id=${q(ids[1])};`);
  await assert.rejects(claimProof.n());claimProof.o();vectors++;
  const detailObservation={...observed[1],ownership:undefined};await assert.rejects(native.prepareAsyncHistoryFence!(snapshot,[detailObservation],Date.now()+25000));vectors++;
  pg(`UPDATE public.anonymous_run_claims SET claimed_wallet=${q(session.wallet)} WHERE run_id=${q(ids[1])};`);
  for(const items of [[observed[0],observed[0]],[{...observed[0],ownerWallet:'0x'+'f5'.repeat(20)}],[{...observed[0],run:{...observed[0].run,answer:'Changed input'}}]]){
   await assert.rejects(native.prepareAsyncHistoryFence!(snapshot,items,Date.now()+25000));await assert.rejects(oracle.prepareHistoryFence!(snapshot,items,Date.now()+25000));vectors++;
  }
  const revoked=await prepare([]);owner(db=>{db.prepare('DELETE FROM web_sessions WHERE hash=?').run(session.hash);});pg(`DELETE FROM public.web_sessions WHERE hash=${q(session.hash)};`);await assert.rejects(revoked.n(),/account_unauthenticated/);assert.throws(revoked.o,/account_unauthenticated/);vectors++;
  owner(db=>{db.prepare('INSERT INTO web_sessions(hash,wallet,issued_at,expires_at) VALUES(?,?,?,?)').run(session.hash,session.wallet,session.issuedAt,session.expiresAt);});pg(`INSERT INTO public.web_sessions(hash,wallet,issued_at,expires_at) VALUES(${q(session.hash)},${q(session.wallet)},${session.issuedAt},${session.expiresAt});`);
  const foreignId='synthetic-account-history-foreign';ids.push(foreignId);pg(`INSERT INTO public.query_runs(id,created_at,question,budget,data,asker) VALUES(${q(foreignId)},${q(date)},'Foreign private',0,${q(JSON.stringify({...observed[0].run,id:foreignId,asker:'0x'+'f5'.repeat(20)}))}::json,${q('0x'+'f5'.repeat(20))});`);
  assert.deepEqual(await channel.call('accountHistory',[JSON.stringify(snapshot),JSON.stringify([foreignId]),'true',String(Date.now()+25000)]),{ok:false,error:'account_unavailable'});vectors++;
  for(const badIds of [Array.from({length:1001},(_,i)=>'synthetic-bound-'+i),['synthetic;SELECT 1'],[ids[0],ids[0]]]){
   const refused=await channel.call('accountHistory',[JSON.stringify(snapshot),JSON.stringify(badIds),'true',String(Date.now()+25000)]);assert.deepEqual(refused,{ok:false,error:'account_unavailable'});vectors++;
  }
  const oversize=JSON.stringify({...observed[0].run,answer:'x'.repeat(4000001)});owner(db=>{db.prepare('UPDATE query_runs SET data=? WHERE id=?').run(oversize,ids[0]);});pg(`UPDATE public.query_runs SET data=${q(oversize)}::json WHERE id=${q(ids[0])};`);
  await assert.rejects(native.prepareAsyncHistoryFence!(snapshot,[observed[0]],Date.now()+25000));await assert.rejects(oracle.prepareHistoryFence!(snapshot,[observed[0]],Date.now()+25000));vectors++;
  owner(db=>{db.prepare('UPDATE query_runs SET data=? WHERE id=?').run(originals.get(ids[0])!,ids[0]);});pg(`UPDATE public.query_runs SET data=${q(originals.get(ids[0])!)}::json WHERE id=${q(ids[0])};`);
  const large:AccountHistoryObservation[]=[];
  for(let i=0;i<5;i++){
   const id='synthetic-account-history-bound-'+i;ids.push(id);
   const run:QueryRun={id,createdAt:date,question:'Bounded fixture',answer:'x'.repeat(3300000),budget:0,engine:'heuristic',totalSpent:0,totalToCreators:0,subClaims:[],decisions:[],citations:[],trace:[],paymentMode:'offline',asker:session.wallet};
   large.push({id,ownerWallet:session.wallet,run,state:{visibility:'unlisted',revision:0,erased:false}});
   // Different raw JSON key ordering/spacing is intentional. The full semantic
   // original is compared while the final fingerprint keeps the actual raw SHA.
   pg(`INSERT INTO public.query_runs(id,created_at,question,budget,data,asker) VALUES(${q(id)},${q(date)},'Bounded fixture',0,json_build_object('asker',${q(session.wallet)},'paymentMode','offline','trace','[]'::json,'citations','[]'::json,'decisions','[]'::json,'subClaims','[]'::json,'totalToCreators',0,'totalSpent',0,'engine','heuristic','budget',0,'answer',repeat('x',3300000),'question','Bounded fixture','createdAt',${q(date)},'id',${q(id)}),${q(session.wallet)});`);
  }
  const largeFinal=await native.prepareAsyncHistoryFence!(snapshot,large.slice(0,4),Date.now()+25000);await largeFinal();vectors++;
  assert.deepEqual(await channel.call('accountHistory',[JSON.stringify(snapshot),JSON.stringify(large.map(x=>x.id)),'true',String(Date.now()+25000)]),{ok:false,error:'account_unavailable'});vectors++;
  const held=await prepare();input.ownerSql("UPDATE keryx_storage.control SET mode='held';");try{await assert.rejects(held.n());vectors++;}finally{input.ownerSql("UPDATE keryx_storage.control SET mode='active';");}
  const disposed=await prepare();await channel.close();await assert.rejects(disposed.n());vectors++;
  return {vectors,actualPostgres:true,genuineSelectedSqliteSeal:true,wholeSemanticOriginalIncludingEscapedFields:true,exactRawOriginalSha256:true,finalPrivacyClaimAndA2aChangesRefused:true,emptyStillChecksCurrentSession:true,oneUseFinalRead:true,nativeForeignBodyRefusedBeforeMaterialization:true,native1001AndMalformedIdsRefused:true,actualOversizeOriginalRefusedBeforeBodies:true,nativeLargeWindowAnswerBytes:13200000,nativeAggregate16500000BytesRefused:true,noSynchronousPostgresSeal:true,terminalClose:true,fullWriterQualified:false,productionData:false,paidOperations:0};
 }finally{
  await channel.close();selected?.close();if(accountId)pg(nativeAccountFixtureTables.filter(t=>t!=='account267_challenges').map(t=>`DELETE FROM public.${t} WHERE account_id=${q(accountId!)};`).join('')+`DELETE FROM public.account267_challenges WHERE session_hash=${q(session.hash)};DELETE FROM public.web_sessions WHERE hash=${q(session.hash)};DELETE FROM public.anonymous_run_claims WHERE run_id IN(${ids.map(q).join(',')});DELETE FROM public.a2a_orders WHERE id='synthetic-account-history-a2a';DELETE FROM public.research_purchase_authorizations WHERE purchase_id='synthetic-account-history-a2a';DELETE FROM public.query_runs WHERE id IN(${ids.map(q).join(',')});`);
  for(const path of paths)if(existsSync(path))unlinkSync(path);rmdirSync(folder);
 }
}
