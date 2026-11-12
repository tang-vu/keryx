/** Actual synthetic native identity lifecycle against the current SQLite oracle. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { createSqlitePrivateProfiles } from '../../lib/db/private-profiles-sqlite';
import { createSqliteProfileIdentities } from '../../lib/db/profile-identities-sqlite';
import { ProfileIdentityError,type IdentityChallenge,type VerifiedIdentity } from '../../lib/profiles/verified-identities';
import { createPostgresUserDomainTransport,type PostgresUserDomainTransport } from '../../lib/db/postgres/user-domain-transport';
import { PostgresDomainWriteOutcomeUnknown } from '../../lib/db/postgres/domain-channel';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import type { StorageIdentity } from '../../lib/db/storage-identity';
import { startCommitAckLossProxy } from './commit-ack-loss.mts';
export async function qualifyProfileIdentities(input:{transport:PostgresUserDomainTransport;options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;ownerSql:(sql:string)=>string}){
 const db=new DatabaseSync(':memory:'),native=input.transport.profileIdentities,wallet=(s:string)=>'0x'+s.repeat(20),owner=wallet('a7'),other=wallet('b8'),missing=wallet('c9');let vectors=0;
 const q=(s:string)=>"'"+s.replaceAll("'","''")+"'",hash=()=>randomBytes(32).toString('hex'),now=Date.now(),session=hash(),secondSession=hash(),deadline=new Date(now+600000).toISOString();
 const pg=(s:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+s+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 const both=(s:string)=>{db.exec(s);pg(s);};
 const challenge=(w=owner,provider:'github'|'orcid'='github'):IdentityChallenge=>({wallet:w,provider,stateHash:hash(),sessionHash:w===other?secondSession:session,expiresAt:deadline});
 const error=(code:string)=>(e:unknown)=>e instanceof ProfileIdentityError&&e.code===code;
 const withoutTime=({verifiedAt:_,...v}:VerifiedIdentity)=>v;
 try{
  db.exec('BEGIN');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);db.exec('COMMIT');
  const profiles=createSqlitePrivateProfiles(db),sqlite=createSqliteProfileIdentities(db);
  for(const [w,h] of [[owner,session],[other,secondSession]] as const){const profile={displayName:'Identity reader',handle:'',bio:'',purpose:'',links:[]};await profiles.update(w,profile);await input.transport.privateProfiles.update(w,profile);both(`INSERT INTO web_sessions(hash,wallet,issued_at,expires_at) VALUES(${q(h)},${q(w)},${now-1000},${now+900000});`);}
  assert.deepEqual(await native.list(owner),await sqlite.list(owner));vectors++;
  await assert.rejects(native.begin(challenge(missing)),error('profile_required'));await assert.rejects(sqlite.begin(challenge(missing)),error('profile_required'));vectors++;
  const first=challenge();await native.begin(first);await sqlite.begin(first);assert.deepEqual(await native.list(owner),await sqlite.list(owner));vectors++;
  await assert.rejects(native.begin(first),error('identity_expired'));await assert.rejects(sqlite.begin(first),error('identity_expired'));vectors++;
  const wrongSession={...first,sessionHash:secondSession};await assert.rejects(native.consume(wrongSession),error('identity_expired'));await assert.rejects(sqlite.consume(wrongSession),error('identity_expired'));vectors++;
  const concurrent=await Promise.allSettled([native.consume(first),native.consume(first)]);assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal(concurrent.filter(r=>r.status==='rejected'&&error('identity_expired')(r.reason)).length,1);await sqlite.consume(first);vectors++;
  const github={provider:'github' as const,externalId:'123456789',label:'keryx-reader'},saved=await native.complete(first,github),reference=await sqlite.complete(first,github);assert.deepEqual(withoutTime(saved),withoutTime(reference));assert.equal(new Date(saved.verifiedAt).toISOString(),saved.verifiedAt);vectors++;
  await assert.rejects(native.complete(first,github),error('identity_expired'));await assert.rejects(sqlite.complete(first,github),error('identity_expired'));vectors++;
  const replacement=challenge();await native.begin(replacement);await sqlite.begin(replacement);assert.equal((await native.list(owner)).identities[0]?.externalId,github.externalId);await native.consume(replacement);await sqlite.consume(replacement);await native.unlink(owner,'github');await sqlite.unlink(owner,'github');await assert.rejects(native.complete(replacement,github),error('identity_expired'));await assert.rejects(sqlite.complete(replacement,github),error('identity_expired'));vectors++;
  const a=challenge(),b=challenge(other);for(const c of [a,b]){await native.begin(c);await sqlite.begin(c);await native.consume(c);await sqlite.consume(c);}
  const claim=await Promise.allSettled([native.complete(a,github),native.complete(b,github)]);assert.equal(claim.filter(r=>r.status==='fulfilled').length,1);assert.equal(claim.filter(r=>r.status==='rejected'&&error('identity_conflict')(r.reason)).length,1);const winner=claim[0].status==='fulfilled'?a:b,loser=winner===a?b:a;await sqlite.complete(winner,github);await assert.rejects(sqlite.complete(loser,github),error('identity_conflict'));assert.deepEqual((await native.list(loser.wallet)).identities,[]);vectors++;
  const superseded=challenge(owner,'orcid'),current=challenge(owner,'orcid');await native.begin(superseded);await sqlite.begin(superseded);await native.consume(superseded);await sqlite.consume(superseded);await native.begin(current);await sqlite.begin(current);const orcid={provider:'orcid' as const,externalId:'0000-0002-1825-0097',label:'Synthetic reader'};await assert.rejects(native.complete(superseded,orcid),error('identity_expired'));await assert.rejects(sqlite.complete(superseded,orcid),error('identity_expired'));await native.consume(current);await sqlite.consume(current);assert.deepEqual(withoutTime(await native.complete(current,orcid)),withoutTime(await sqlite.complete(current,orcid)));vectors++;
  const revoked=challenge(owner,'orcid');await native.begin(revoked);await sqlite.begin(revoked);await native.consume(revoked);await sqlite.consume(revoked);await input.transport.applicationWrite('revoke_web_session',{p_hash:session,p_wallet:owner});db.prepare('DELETE FROM web_sessions WHERE hash=? AND wallet=?').run(session,owner);await assert.rejects(native.complete(revoked,orcid),error('identity_expired'));await assert.rejects(sqlite.complete(revoked,orcid),error('identity_expired'));vectors++;
  const expired={...challenge(other,'orcid'),expiresAt:new Date(now-1).toISOString()};await assert.rejects(native.begin(expired),error('identity_expired'));await assert.rejects(sqlite.begin(expired),error('identity_expired'));vectors++;
  const lost=challenge(other,'orcid');await native.begin(lost);await native.consume(lost);assert.equal(input.options.endpoint.kind,'loopback');const proxy=await startCommitAckLossProxy(input.options.endpoint.port),broken=createPostgresUserDomainTransport({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest);
  try{proxy.arm();const lostIdentity={...orcid,externalId:'0000-0001-5109-3700'};await assert.rejects(broken.profileIdentities.complete(lost,lostIdentity),PostgresDomainWriteOutcomeUnknown);assert.deepEqual(proxy.observation(),{dropped:true,commands:1});assert.equal((await native.list(other)).identities.find(r=>r.provider==='orcid')?.externalId,lostIdentity.externalId);await assert.rejects(native.complete(lost,lostIdentity),error('identity_expired'));vectors++;}finally{await broken.close();await proxy.close();}
  const reader=createPostgresUserDomainTransport({...input.options,role:'keryx_reader'},input.identity,input.digest);try{assert.equal((await reader.profileIdentities.list(other)).wallet,other);await assert.rejects(reader.profileIdentities.begin(lost),error('identity_unavailable'));await assert.rejects(reader.profileIdentities.unlink(other,'orcid'),error('identity_unavailable'));vectors++;}finally{await reader.close();}await assert.rejects(reader.profileIdentities.list(other),error('identity_unavailable'));vectors++;
  await input.transport.privateProfiles.delete(other);await assert.rejects(native.complete(lost,orcid),error('profile_required'));assert.equal((await native.list(other)).identities.length,0);vectors++;
  assert.equal(input.ownerSql('SELECT count(*) FROM keryx_storage.writer;'),'0');
  return {vectors,currentSqliteOracle:true,actualConcurrentConsume:true,actualConcurrentExternalIdentityClaim:true,retainedVerificationDuringReplacement:true,supersededLineageRefused:true,unlinkAndProfileDeleteInvalidate:true,durableSessionRevocation:true,expiredChallengeRefused:true,validOrcidChecksum:true,exactIsoText:true,actualLostCommitAck:true,noAutomaticRetry:true,readonlyWritesRefused:true,terminalClose:true,productionData:false,paidOperations:0};
 }finally{db.close();pg(`DELETE FROM public.private_profiles WHERE wallet IN(${[owner,other,missing].map(q).join(',')});DELETE FROM public.web_sessions WHERE hash IN(${[session,secondSession].map(q).join(',')});`);}
}
