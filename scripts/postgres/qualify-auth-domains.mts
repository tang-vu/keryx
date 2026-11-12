/** Unfunded synthetic authentication semantics. No wallet, login to a provider,
 * external delivery, live user data or installed application provenance. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash,randomUUID } from 'node:crypto';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { assembleNativePostgresBusinessCore } from '../../lib/db/supabase-adapter';
import { createPostgresApplicationDomainAuthority } from '../../lib/db/postgres/application-domain-authority';
import { createPostgresApplicationDomainTransport,type PostgresApplicationDomainTransport } from '../../lib/db/postgres/application-domain-transport';
import { PostgresDomainWriteOutcomeUnknown } from '../../lib/db/postgres/domain-channel';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import type { StorageIdentity } from '../../lib/db/storage-identity';
import { startCommitAckLossProxy } from './commit-ack-loss.mts';
export async function qualifyAuthDomains(input:{transport:PostgresApplicationDomainTransport;options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;ownerSql:(sql:string)=>string}){
 const db=new DatabaseSync(':memory:'),owner='0x'+'a9'.repeat(20),other='0x'+'b8'.repeat(20),hash=()=>createHash('sha256').update(randomUUID()).digest('hex'),now=Date.now();let vectors=0;
 const native=assembleNativePostgresBusinessCore({identity:input.identity,authority:createPostgresApplicationDomainAuthority(input.transport),assertEntry:()=>{},verify:async()=>{await input.transport.applicationRead('get_sync_state',{p_key:'synthetic-auth-authority'});}});
 const nonce=(h:string,issued:number,expires:number)=>{db.prepare('DELETE FROM auth_challenges WHERE expires_at<=?').run(issued);db.prepare('INSERT INTO auth_challenges VALUES(?,?,?)').run(h,issued,expires);};
 const consume=(h:string,time:number)=>Number(db.prepare('DELETE FROM auth_challenges WHERE hash=? AND issued_at<=? AND expires_at>?').run(h,time,time).changes)===1;
 const session=(h:string,wallet:string,issued:number,expires:number)=>{db.prepare('DELETE FROM web_sessions WHERE expires_at<=?').run(issued);db.prepare('INSERT INTO web_sessions VALUES(?,?,?,?)').run(h,wallet.toLowerCase(),issued,expires);};
 const list=(wallet:string,time:number)=>db.prepare('SELECT hash,wallet,issued_at,expires_at FROM web_sessions WHERE wallet=lower(?) AND issued_at<=? AND expires_at>? ORDER BY issued_at DESC,hash ASC LIMIT 101').all(wallet,time,time).map(r=>({hash:String(r.hash),wallet:String(r.wallet),issuedAt:Number(r.issued_at),expiresAt:Number(r.expires_at)}));
 const q=(s:string)=>"'"+s.replaceAll("'","''")+"'";
 try{
  db.exec('BEGIN');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);db.exec('COMMIT');await native.adapter.init();
  for(const [issued,expires,at] of [[now-10,now+1000,now],[now+10,now+1000,now],[now-1000,now,now]] as const){const h=hash();nonce(h,issued,expires);await native.adapter.createAuthChallenge(h,issued,expires);assert.equal(await native.adapter.consumeAuthChallenge(h,at),consume(h,at));vectors++;assert.equal(await native.adapter.consumeAuthChallenge(h,at),consume(h,at));vectors++;}
  const raceHash=hash();await native.adapter.createAuthChallenge(raceHash,now-1,now+1000);const raced=await Promise.all([native.adapter.consumeAuthChallenge(raceHash,now),native.adapter.consumeAuthChallenge(raceHash,now)]);assert.equal(raced.filter(Boolean).length,1);vectors++;
  const first=hash(),second=hash(),foreign=hash();for(const [h,w,issued] of [[first,owner,now-2],[second,owner,now-1],[foreign,other,now-1]] as const){session(h,w,issued,now+1000);await native.adapter.createWebSession({hash:h,wallet:w,issuedAt:issued,expiresAt:now+1000});}
  assert.deepEqual(await native.adapter.listWebSessions(owner,now),list(owner,now));vectors++;
  await native.adapter.revokeWebSession(first,other);db.prepare('DELETE FROM web_sessions WHERE hash=? AND wallet=?').run(first,other);assert.deepEqual(await native.adapter.listWebSessions(owner,now),list(owner,now));vectors++;
  await native.adapter.revokeOtherWebSessions(owner,second);db.prepare('DELETE FROM web_sessions WHERE wallet=? AND hash!=?').run(owner,second);assert.deepEqual(await native.adapter.listWebSessions(owner,now),list(owner,now));vectors++;
  assert(await native.adapter.getWebSession(foreign));await native.adapter.revokeWebSession(second,owner);db.prepare('DELETE FROM web_sessions WHERE hash=? AND wallet=?').run(second,owner);assert.deepEqual(await native.adapter.listWebSessions(owner,now),list(owner,now));vectors++;
  await assert.rejects(native.adapter.createWebSession({hash:foreign,wallet:owner,issuedAt:now,expiresAt:now+1000}));assert.equal((await native.adapter.getWebSession(foreign))?.wallet,other);vectors++;
  const old='2025-01-02T03:04:05.000Z';db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(owner,'reader','Retained handle',old,old);
  input.ownerSql(`BEGIN;UPDATE keryx_storage.control SET mode='held';INSERT INTO public.users VALUES(${q(owner)},'reader','Retained handle',${q(old)},${q(old)});UPDATE keryx_storage.control SET mode='active';COMMIT;`);
  const update=await native.adapter.upsertUser(owner.toUpperCase(),'creator');assert.equal(update.created,false);assert.equal(update.user.firstSeenAt,old);assert.equal(update.user.displayHandle,'Retained handle');assert.equal(update.user.role,'creator');assert.equal(new Date(update.user.lastSeenAt).toISOString(),update.user.lastSeenAt);vectors++;
  assert.equal(await native.adapter.getUser('%'),null);vectors++;
  assert.equal(input.options.endpoint.kind,'loopback');const proxy=await startCommitAckLossProxy(input.options.endpoint.port),broken=createPostgresApplicationDomainTransport({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest),lost=hash();
  try{proxy.arm();await assert.rejects(broken.applicationWrite('create_auth_challenge',{p_hash:lost,p_issued_at:now-1,p_expires_at:now+1000}),PostgresDomainWriteOutcomeUnknown);assert.deepEqual(proxy.observation(),{dropped:true,commands:1});assert.equal(await native.adapter.consumeAuthChallenge(lost,now),true);assert.equal(await native.adapter.consumeAuthChallenge(lost,now),false);vectors++;}finally{await broken.close();await proxy.close();}
  const reader=createPostgresApplicationDomainTransport({...input.options,role:'keryx_reader'},input.identity,input.digest);try{await assert.rejects(reader.applicationWrite('create_auth_challenge',{p_hash:hash(),p_issued_at:now-1,p_expires_at:now+1000}));vectors++;}finally{await reader.close();}
  assert.equal(input.ownerSql('SELECT count(*) FROM keryx_storage.writer;'),'0');
  return {vectors,singleUseNonce:true,actualConcurrentConsume:true,walletScopedRevocation:true,retainedFirstSeenAndHandle:true,exactWalletLookup:true,actualLostCommitAck:true,noAutomaticRetry:true,readonlyWritesRefused:true,productionData:false,paidOperations:0};
 }finally{native.hooks.close();db.close();}
}
