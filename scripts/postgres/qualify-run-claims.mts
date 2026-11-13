/** Real native claim writes compared with the current SQLite protocol. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { installSqliteApplicationSchema } from '../../lib/db/sqlite-application-schema';
import { createSqliteRunClaims,RUN_CLAIMS_SQL } from '../../lib/db/run-claims-sqlite';
import { RunClaimError,runClaimBindingSchema,type RunClaimAttempt } from '../../lib/run-claims/contracts';
import { createPostgresUserDomainTransport,type PostgresUserDomainTransport } from '../../lib/db/postgres/user-domain-transport';
import { PostgresDomainWriteOutcomeUnknown } from '../../lib/db/postgres/domain-channel';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import type { StorageIdentity } from '../../lib/db/storage-identity';
import { heldHistoryProjectionSql,sqliteOriginalHistoryProjection } from './run-history-projection.mts';
import { startCommitAckLossProxy } from './commit-ack-loss.mts';
export async function qualifyRunClaims(input:{transport:PostgresUserDomainTransport;options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;ownerSql:(sql:string)=>string}){
 const db=new DatabaseSync(':memory:'),native=input.transport.runClaims,owner='0x'+'c7'.repeat(20),other='0x'+'d8'.repeat(20),date=new Date(Date.now()-10000).toISOString();let now=Date.now(),vectors=0;
 const binding=runClaimBindingSchema.parse({network:input.identity.network,origin:'https://keryx.cc'}),hash=(s:string)=>createHash('sha256').update(s).digest('hex'),q=(s:string)=>"'"+s.replaceAll("'","''")+"'";
 const pg=(s:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+s+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 const code=(name:RunClaimError['code'])=>(error:unknown)=>error instanceof RunClaimError&&error.code===name;
 const session=hash('synthetic-native-claims-session'),expiredSession=hash('synthetic-native-claims-expired-session'),attempt=(id:string,wallet=owner):RunClaimAttempt=>({tokenHash:hash(id),wallet,sessionHash:session,binding});
 let proxy:Awaited<ReturnType<typeof startCommitAckLossProxy>>|undefined;const transports:PostgresUserDomainTransport[]=[];
 try{
  installSqliteApplicationSchema(db);db.exec(RUN_CLAIMS_SQL);const sqlite=createSqliteRunClaims(db,{fixtureClock:()=>now});
  const issuedAt=Date.now()-60000,expiresAt=Date.now()+3600000;
  db.prepare('INSERT INTO web_sessions VALUES(?,?,?,?)').run(session,owner,issuedAt,expiresAt);
  pg(`INSERT INTO public.web_sessions(hash,wallet,issued_at,expires_at) VALUES(${q(session)},${q(owner)},${issuedAt},${expiresAt});`);
  const save=(label:string,patch:Record<string,unknown>={},createdAt=date,raw?:string)=>{
   const id='synthetic-native-claim-'+label,wire=raw??JSON.stringify({id,createdAt,question:'Synthetic native claim',budget:0,engine:'heuristic',answer:'Synthetic original',subClaims:[],decisions:[],citations:[],trace:[],totalSpent:0,totalToCreators:0,paymentMode:'offline',...patch});
   db.prepare('INSERT INTO query_runs(id,created_at,question,budget,data) VALUES(?,?,?,0,?)').run(id,createdAt,'Synthetic native claim',wire);
   pg(`INSERT INTO public.query_runs(id,created_at,question,budget,data) VALUES(${q(id)},${q(createdAt)},'Synthetic native claim',0,${q(wire)}::json);`+heldHistoryProjectionSql(id,sqliteOriginalHistoryProjection(db,id)));
   return {id,wire,request:{runId:id,completedAt:createdAt,tokenHash:hash(id),binding}};
  };
  const issue=async(row:ReturnType<typeof save>)=>{const result=await native.issue(row.request);now=Date.parse(result.issuedAt);assert.deepEqual(result,await sqlite.issue(row.request));vectors++;return result;};
  await native.assertAvailable();vectors++;
  // The SOURCE compares the original date bytes, not merely the instant. A
  // retained offset representation cannot authorize a normalized UTC ticket.
  const offset=save('offset-original',{},date.replace('Z','+00:00')),normalized={...offset.request,completedAt:date};
  now=Date.now();await assert.rejects(sqlite.issue(normalized),code('claim_unavailable'));
  await assert.rejects(native.issue(normalized),code('claim_unavailable'));vectors++;
  // Held corrupt/legacy ticket fixture, never a valid issuance. Consumption
  // independently checks the exact retained completion string as SQLite does.
  const retainedAt=Date.now(),originalHash=hash(offset.wire);
  db.prepare('INSERT INTO anonymous_run_claims(run_id,network,origin,token_hash,original_sha256,completed_at,issued_at,expires_at) VALUES(?,?,?,?,?,?,?,?)')
   .run(offset.id,binding.network,binding.origin,hash(offset.id),originalHash,date,retainedAt,retainedAt+86400000);
  pg(`INSERT INTO public.anonymous_run_claims(run_id,network,origin,token_hash,original_sha256,completed_at,issued_at,expires_at) VALUES(${q(offset.id)},${q(binding.network)},${q(binding.origin)},${q(hash(offset.id))},${q(originalHash)},${q(date)},${retainedAt},${retainedAt+86400000});`);
  now=Date.now();await assert.rejects(sqlite.claim(attempt(offset.id)),code('claim_unavailable'));await assert.rejects(native.claim(attempt(offset.id)),code('claim_unavailable'));vectors++;
  // Retained tickets are checked against their own exact date, without adding
  // the canonical-UTC issuance restriction to the existing consume protocol.
  const retained=save('retained-offset',{},date.replace('Z','+00:00')),retainedHash=hash(retained.wire);
  db.prepare('INSERT INTO anonymous_run_claims(run_id,network,origin,token_hash,original_sha256,completed_at,issued_at,expires_at) VALUES(?,?,?,?,?,?,?,?)')
   .run(retained.id,binding.network,binding.origin,hash(retained.id),retainedHash,retained.request.completedAt,retainedAt,retainedAt+86400000);
  pg(`INSERT INTO public.anonymous_run_claims(run_id,network,origin,token_hash,original_sha256,completed_at,issued_at,expires_at) VALUES(${q(retained.id)},${q(binding.network)},${q(binding.origin)},${q(hash(retained.id))},${q(retainedHash)},${q(retained.request.completedAt)},${retainedAt},${retainedAt+86400000});`);
  const retainedReceipt=await native.claim(attempt(retained.id));now=Date.parse(retainedReceipt.claimedAt);assert.deepEqual(retainedReceipt,await sqlite.claim(attempt(retained.id)));vectors++;
  const first=save('first');await issue(first);const receipt=await native.claim(attempt(first.id));now=Date.parse(receipt.claimedAt);assert.deepEqual(receipt,await sqlite.claim(attempt(first.id)));vectors++;
  assert.equal(input.ownerSql(`SELECT data::text FROM public.query_runs WHERE id=${q(first.id)};`),first.wire);assert.equal(input.ownerSql(`SELECT asker IS NULL FROM public.query_runs WHERE id=${q(first.id)};`),'t');vectors++;
  await assert.rejects(native.claim(attempt(first.id)),code('claim_unavailable'));await assert.rejects(sqlite.claim(attempt(first.id)),code('claim_unavailable'));vectors++;
  await assert.rejects(native.issue({...first.request,tokenHash:hash('replacement')}),code('claim_unavailable'));await assert.rejects(sqlite.issue({...first.request,tokenHash:hash('replacement')}),code('claim_unavailable'));vectors++;
  const blocked=save('wrong-session');await issue(blocked);await assert.rejects(native.claim({...attempt(blocked.id),sessionHash:hash('missing-session')}),code('claim_unauthenticated'));await assert.rejects(sqlite.claim({...attempt(blocked.id),sessionHash:hash('missing-session')}),code('claim_unauthenticated'));vectors++;
  await assert.rejects(native.claim(attempt(blocked.id,other)),code('claim_unauthenticated'));vectors++;
  for(const [label,patch] of [['funded',{askerFunded:true}],['browser',{fundingOwner:'browser'}],['null-owner',{asker:null}],['fulfillment',{originalFulfillment:{}}],['wrong-id',{id:'other-id'}],['wrong-date',{createdAt:'2020-01-01T00:00:00.000Z'}]] as const){const row=save(label,patch);now=Date.now();await assert.rejects(native.issue(row.request),code('claim_unavailable'));await assert.rejects(sqlite.issue(row.request),code('claim_unavailable'));vectors++;}
  const future=save('future',{},new Date(Date.now()+3600000).toISOString());now=Date.now();await assert.rejects(native.issue(future.request),code('claim_unavailable'));await assert.rejects(sqlite.issue(future.request),code('claim_unavailable'));vectors++;
  const escaped=save('escaped',{answer:'Synthetic\u0000answer\ud800'});await issue(escaped);const escapedReceipt=await native.claim(attempt(escaped.id));now=Date.parse(escapedReceipt.claimedAt);assert.deepEqual(escapedReceipt,await sqlite.claim(attempt(escaped.id)));assert.equal(input.ownerSql(`SELECT data::text FROM public.query_runs WHERE id=${q(escaped.id)};`),escaped.wire);vectors++;
  const expired=save('expired',{},new Date(Date.now()-26*3600000).toISOString());now=Date.now()-25*3600000;await sqlite.issue(expired.request);const old=db.prepare('SELECT * FROM anonymous_run_claims WHERE run_id=?').get(expired.id)!;
  pg(`INSERT INTO public.anonymous_run_claims(run_id,network,origin,token_hash,original_sha256,completed_at,issued_at,expires_at) VALUES(${q(expired.id)},${q(binding.network)},${q(binding.origin)},${q(hash(expired.id))},${q(String(old.original_sha256))},${q(expired.request.completedAt)},${old.issued_at},${old.expires_at});`);now=Date.now();await assert.rejects(native.claim(attempt(expired.id)),code('claim_unavailable'));await assert.rejects(sqlite.claim(attempt(expired.id)),code('claim_unavailable'));vectors++;
  const sessionStart=Date.now()-60000,sessionEnd=Date.now()-1000;db.prepare('INSERT INTO web_sessions VALUES(?,?,?,?)').run(expiredSession,owner,sessionStart,sessionEnd);pg(`INSERT INTO public.web_sessions(hash,wallet,issued_at,expires_at) VALUES(${q(expiredSession)},${q(owner)},${sessionStart},${sessionEnd});`);await assert.rejects(native.claim({...attempt(blocked.id),sessionHash:expiredSession}),code('claim_unauthenticated'));await assert.rejects(sqlite.claim({...attempt(blocked.id),sessionHash:expiredSession}),code('claim_unauthenticated'));vectors++;
  const a2a=save('a2a'),order='synthetic-native-claim-order',authorization='synthetic-native-claim-auth',request='synthetic-native-claim-request';
  const orderSql=`INSERT INTO a2a_orders(id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,service_fee_usdc,research_mode,status,transaction_id,created_at,updated_at) VALUES(${q(order)},${q(a2a.id)},${q(authorization)},${q(request)},${q(owner)},${q(other)},0.1,0.09,0.01,'deep','completed','synthetic-native-claim-transaction',${q(date)},${q(date)});`;db.exec(orderSql);pg(orderSql.replace('INSERT INTO a2a_orders','INSERT INTO public.a2a_orders'));now=Date.now();await assert.rejects(native.issue(a2a.request),code('claim_unavailable'));await assert.rejects(sqlite.issue(a2a.request),code('claim_unavailable'));vectors++;
  const changed=save('changed');await issue(changed);db.prepare('UPDATE query_runs SET data=? WHERE id=?').run(changed.wire+' ',changed.id);pg(`UPDATE public.query_runs SET data=${q(changed.wire+' ')}::json WHERE id=${q(changed.id)};`+heldHistoryProjectionSql(changed.id,sqliteOriginalHistoryProjection(db,changed.id)));now=Date.now();await assert.rejects(native.claim(attempt(changed.id)),code('claim_unavailable'));await assert.rejects(sqlite.claim(attempt(changed.id)),code('claim_unavailable'));vectors++;
  const metadata=save('metadata');await issue(metadata);pg(`UPDATE public.query_runs SET created_at=created_at+interval '1 second' WHERE id=${q(metadata.id)};`);assert.equal(input.ownerSql(`SELECT count(*) FROM keryx_storage.run_history_projection WHERE run_id=${q(metadata.id)};`),'0');await assert.rejects(native.claim(attempt(metadata.id)),code('claim_unavailable'));vectors++;
  const race=save('race');await issue(race);const competing=createPostgresUserDomainTransport(input.options,input.identity,input.digest);transports.push(competing);
  const outcomes=await Promise.allSettled([native.claim(attempt(race.id)),competing.runClaims.claim(attempt(race.id))]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.filter(x=>x.status==='rejected'&&code('claim_unavailable')(x.reason)).length,1);vectors++;
  const winner=outcomes.find(x=>x.status==='fulfilled');assert(winner?.status==='fulfilled');now=Date.parse(winner.value.claimedAt);assert.deepEqual(await sqlite.claim(attempt(race.id)),winner.value);vectors++;
  // Keep a warm connection, then lose the actual implicit-transaction commit ACK.
  const lost=save('lost-ack');await issue(lost);proxy=await startCommitAckLossProxy(input.options.endpoint.port);const lossy=createPostgresUserDomainTransport({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest);transports.push(lossy);await lossy.runClaims.assertAvailable();proxy.arm();await assert.rejects(lossy.runClaims.claim(attempt(lost.id)),e=>e instanceof PostgresDomainWriteOutcomeUnknown);assert.equal(proxy.observation().dropped,true);assert.equal(input.ownerSql(`SELECT claimed_wallet FROM public.anonymous_run_claims WHERE run_id=${q(lost.id)};`),owner);await assert.rejects(native.claim(attempt(lost.id)),code('claim_unavailable'));vectors++;
  db.prepare('UPDATE web_sessions SET wallet=? WHERE hash=?').run(other,session);pg(`UPDATE public.web_sessions SET wallet=${q(other)} WHERE hash=${q(session)};`);now=Date.now();await assert.rejects(native.claim(attempt(blocked.id)),code('claim_unauthenticated'));await assert.rejects(sqlite.claim(attempt(blocked.id)),code('claim_unauthenticated'));db.prepare('UPDATE web_sessions SET wallet=? WHERE hash=?').run(owner,session);pg(`UPDATE public.web_sessions SET wallet=${q(owner)} WHERE hash=${q(session)};`);vectors++;
  assert.throws(()=>input.ownerSql(`UPDATE public.anonymous_run_claims SET original_sha256='${'00'.repeat(32)}' WHERE run_id=${q(first.id)};`),/claim_unavailable|native storage writer required/);vectors++;
  const revoked=save('revoked');await issue(revoked);db.prepare('DELETE FROM web_sessions WHERE hash=?').run(session);pg(`DELETE FROM public.web_sessions WHERE hash=${q(session)};`);await assert.rejects(native.claim(attempt(revoked.id)),code('claim_unauthenticated'));await assert.rejects(sqlite.claim(attempt(revoked.id)),code('claim_unauthenticated'));vectors++;
  const reader=createPostgresUserDomainTransport({...input.options,role:'keryx_reader'},input.identity,input.digest);transports.push(reader);await reader.runClaims.assertAvailable();await assert.rejects(reader.runClaims.issue(first.request),code('claims_unavailable'));await reader.close();await assert.rejects(reader.runClaims.assertAvailable(),code('claims_unavailable'));vectors++;
  return {vectors,currentSqliteOracle:true,exactRawOriginalDigest:true,exactCompletionDateBytes:true,retainedExactOffsetTicketPreserved:true,immutableOwnershipOnly:true,singleConsumeAcrossConnections:true,actualLostCommitAck:true,noAutomaticRetry:true,durableSessionRevocation:true,expiredTicketAndSessionRefused:true,replacedSessionOwnerRefused:true,a2aOriginalRefused:true,escapedNulAndSurrogateOriginal:true,changedOriginalAndMetadataRefused:true,ineligibleAndFutureOriginalsRefused:true,readonlyRoleAndTerminalClose:true,productionData:false,paidOperations:0};
 }finally{
  await Promise.allSettled(transports.map(t=>t.close()));await proxy?.close();db.close();pg(`DELETE FROM public.a2a_orders WHERE id='synthetic-native-claim-order';DELETE FROM public.anonymous_run_claims WHERE run_id LIKE 'synthetic-native-claim-%';DELETE FROM public.query_runs WHERE id LIKE 'synthetic-native-claim-%';DELETE FROM public.web_sessions WHERE hash IN(${q(session)},${q(expiredSession)});`);
 }
}
