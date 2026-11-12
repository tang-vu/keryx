/** Actual SQLite-issued claim digests and privacy erasure bytes, independently
 * retained in the fresh PostgreSQL SOURCE. Not native claim/privacy admission. */
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { installSqliteApplicationSchema } from '../../lib/db/sqlite-application-schema';
import { createSqliteRunClaims,RUN_CLAIMS_SQL } from '../../lib/db/run-claims-sqlite';
import { createSqliteRunOwnershipHistory } from '../../lib/db/run-ownership-history-sqlite';
import { createSqliteRunPrivacy,RUN_PRIVACY_SQL } from '../../lib/db/run-privacy-sqlite';
import type { PostgresUserDomainTransport } from '../../lib/db/postgres/user-domain-transport';
export async function qualifyOriginalJson(input:{transport:PostgresUserDomainTransport;network:string;ownerSql:(sql:string)=>string}){
 const db=new DatabaseSync(':memory:'),owner='0x'+'b6'.repeat(20),stamp='2026-01-02T03:04:05.000Z',now=Date.parse(stamp)+1000;
 const hash=(s:string)=>createHash('sha256').update(s).digest('hex'),q=(s:string)=>"'"+s.replaceAll("'","''")+"'";
 const pg=(s:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+s+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 const binding={network:input.network,origin:'https://keryx.cc'},sessionHash=hash('synthetic-original-session');let vectors=0;
 const base=(id:string)=>({id,question:'Synthetic original byte preservation',createdAt:stamp,budget:0,engine:'heuristic',answer:'Private fixture answer',subClaims:[],decisions:[],citations:[],trace:[],totalSpent:0,totalToCreators:0,paymentMode:'offline'});
 const variants:[string,(id:string)=>string][]=[
  ['minified',id=>JSON.stringify(base(id))],
  ['indented',id=>JSON.stringify(base(id),null,'\t')+'\n'],
  ['key-order',id=>JSON.stringify(Object.fromEntries(Object.entries(base(id)).reverse()))],
  ['unicode-escapes',id=>JSON.stringify(base(id)).replace('Private fixture answer','\\u0050rivate \\u0066ixture answer')],
  ...[['negative-zero','-0'],['number-exponent','1.230e-5'],['large-integer','90071992547409931234567890'],['huge-exponent','1e100000'],['nul','"private\\u0000answer"'],['lone-surrogate','"private\\ud800answer"']].map(([name,value])=>[name,(id:string)=>JSON.stringify(base(id)).slice(0,-1)+',"uninterpreted":'+value+'}'] as [string,(id:string)=>string]),
  ['duplicate-unknown',id=>JSON.stringify(base(id)).slice(0,-1)+',"uninterpreted":1,"uninterpreted":2}'],
 ];
 try{
  installSqliteApplicationSchema(db);db.exec(RUN_CLAIMS_SQL);db.exec(RUN_PRIVACY_SQL);
  db.prepare('INSERT INTO web_sessions(hash,wallet,issued_at,expires_at) VALUES(?,?,?,?)').run(sessionHash,owner,now-2000,now+86400000);
  const claims=createSqliteRunClaims(db,{fixtureClock:()=>now}),history=createSqliteRunOwnershipHistory(db);
  assert.equal(input.ownerSql("SELECT format_type(atttypid,atttypmod) FROM pg_attribute WHERE attrelid='public.query_runs'::regclass AND attname='data';"),'json');vectors++;
  for(const [name,make] of variants){
   const id='synthetic-original-'+name,wire=make(id),tokenHash=hash(id);
   db.prepare('INSERT INTO query_runs(id,created_at,question,budget,data) VALUES(?,?,?,0,?)').run(id,stamp,base(id).question,wire);
   await claims.issue({runId:id,completedAt:stamp,tokenHash,binding});await claims.claim({tokenHash,wallet:owner,sessionHash,binding});
   const claim=db.prepare('SELECT * FROM anonymous_run_claims WHERE run_id=?').get(id)!;assert.equal(claim.original_sha256,hash(wire));
   assert.deepEqual((await history.read(owner,binding,id))?.run,JSON.parse(wire));
   pg(`INSERT INTO public.query_runs(id,created_at,question,budget,data) VALUES(${q(id)},${q(stamp)},'Synthetic original byte preservation',0,${q(wire)}::json);
INSERT INTO public.anonymous_run_claims(run_id,network,origin,token_hash,original_sha256,completed_at,issued_at,expires_at,claimed_wallet,claimed_at) VALUES(${q(id)},${q(binding.network)},${q(binding.origin)},${q(tokenHash)},${q(String(claim.original_sha256))},${q(stamp)},${claim.issued_at},${claim.expires_at},${q(owner)},${claim.claimed_at});`);
   const saved=JSON.parse(input.ownerSql(`SELECT jsonb_build_object('wire',r.data::text,'sha',keryx_storage.run_original_sha256(r.data),'claimSha',c.original_sha256,'matches',keryx_storage.run_original_sha256(r.data)=c.original_sha256) FROM public.query_runs r JOIN public.anonymous_run_claims c ON c.run_id=r.id WHERE r.id=${q(id)};`));
   assert.equal(saved.wire,wire);assert.equal(saved.sha,hash(wire));assert.equal(saved.claimSha,claim.original_sha256);assert.equal(saved.matches,true);vectors++;
   if(name==='indented'){
    assert.notEqual(input.ownerSql(`SELECT encode(sha256(convert_to((data::jsonb)::text,'UTF8')),'hex') FROM public.query_runs WHERE id=${q(id)};`),claim.original_sha256);vectors++;
    pg(`UPDATE public.query_runs SET data=${q(wire+' ')}::json WHERE id=${q(id)};`);
    assert.equal(input.ownerSql(`SELECT keryx_storage.run_original_sha256(r.data)=c.original_sha256 FROM public.query_runs r JOIN public.anonymous_run_claims c ON c.run_id=r.id WHERE r.id=${q(id)};`),'f');
    pg(`UPDATE public.query_runs SET data=${q(wire)}::json WHERE id=${q(id)};`);vectors++;
   }
  }
  // A private answer must never be converted just to extract a safe summary.
  const id='synthetic-original-recorded',wire=JSON.stringify({...base(id),asker:owner}).replace('Private fixture answer','private\\u0000answer\\ud800');
  pg(`INSERT INTO public.query_runs(id,created_at,question,budget,data,asker) VALUES(${q(id)},${q(stamp)},'Original projection sentinel',0,${q(wire)}::json,${q(owner)});`);
  const rows=await input.transport.personalHistory.list(owner,{filters:{search:'Original projection sentinel'},take:1});assert.equal(rows.length,1);assert.equal(rows[0].id,id);assert(!JSON.stringify(rows).includes('private'));vectors++;
  // Exercise the actual SQLite erasure writer and retain its existing digest.
  const erasedId='synthetic-original-erased',original=JSON.stringify({...base(erasedId),asker:owner});
  db.prepare('INSERT INTO query_runs(id,created_at,question,budget,data,asker) VALUES(?,?,?,0,?,?)').run(erasedId,stamp,'Private fixture',original,owner);
  const privacy=createSqliteRunPrivacy(db,history),actor={wallet:owner,binding,sessionHash};
  // Privacy uses the live clock, independently of the explicit claim clock.
  db.prepare('UPDATE web_sessions SET issued_at=?,expires_at=? WHERE hash=?').run(Date.now()-1000,Date.now()+60000,sessionHash);
  await privacy.erase(erasedId,actor,{requestId:randomUUID(),revision:0});
  const retained=db.prepare('SELECT q.data,p.retained_digest,p.retained_binding FROM query_runs q JOIN run_privacy p ON p.run_id=q.id WHERE q.id=?').get(erasedId)!;
  assert.equal(retained.retained_digest,hash(String(retained.data)));
  pg(`INSERT INTO public.query_runs(id,created_at,question,budget,data) VALUES(${q(erasedId)},${q(stamp)},'',0,${q(String(retained.data))}::json);`);
  assert.equal(input.ownerSql(`SELECT keryx_storage.run_original_sha256(data) FROM public.query_runs WHERE id=${q(erasedId)};`),retained.retained_digest);vectors++;
  const tooLarge='{"padding":"'+'x'.repeat(4000000)+'"}';
  assert.throws(()=>input.ownerSql(`SELECT keryx_storage.run_original_sha256(${q(tooLarge)}::json);`),/original run byte bound/);vectors++;
  assert.throws(()=>pg("INSERT INTO public.query_runs(id,created_at,question,budget,data) VALUES('synthetic-original-invalid',now(),'invalid',0,'{broken'::json);"),/invalid input syntax for type json/);vectors++;
  return {vectors,exactUtf8WireAndSha256:true,currentSqliteIssuedAndClaimedOriginals:variants.length,currentSqlitePrivacyErasureDigest:true,orderingWhitespaceUnicodeAndNumberLexemes:true,escapedNulAndSurrogatePreserved:true,privateAnswerNotConvertedForSummary:true,changedWireInvalidatesRetainedDigest:true,jsonbNormalizationDemonstratedIncompatible:true,byteBoundAndInvalidJsonRefused:true,nativeClaimPrivacyProtocolsQualified:false,productionData:false,paidOperations:0};
 }finally{db.close();pg("DELETE FROM public.anonymous_run_claims WHERE run_id LIKE 'synthetic-original-%';DELETE FROM public.query_runs WHERE id LIKE 'synthetic-original-%';");}
}
