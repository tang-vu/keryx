/** Actual private chat journal and genuine selected SQLite, no provider sends. */
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,existsSync,unlinkSync,rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { nativeAccountFixture,nativeAccountFixturePaths,nativeAccountFixtureTables } from './native-account-fixture.mts';
import { registerStorageCapability } from '../../lib/db/storage-identity-sqlite';
import { openVerifiedSqliteStorage } from '../../lib/db/storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../../lib/db/enrolled-sqlite-schema-profile';
import { createEnrolledSqliteChatAccountLinks } from '../../lib/db/chat-accounts-sqlite';
import { composePostgresChatLinks } from '../../lib/db/postgres/chat-links-transport';
import { createPostgresDomainChannel,PostgresDomainWriteOutcomeUnknown } from '../../lib/db/postgres/domain-channel';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import type { StorageIdentity } from '../../lib/db/storage-identity';
import { randomAccountValue } from '../../lib/accounts/protocol';
import { chatTokenHash } from '../../lib/chat-accounts/service';
import type { ChatLink,ChatRecipient,PendingChatLink } from '../../lib/chat-accounts/contracts';
import { startCommitAckLossProxy } from './commit-ack-loss.mts';
import type { Client } from 'pg';
import { AUTH_WRITE_CALLS } from '../../lib/db/postgres/auth-write-calls';
export async function qualifyChatLinks(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;contentionClient:Client;ownerSql:(sql:string)=>string}){
 const folder=mkdtempSync(join(tmpdir(),'keryx-native-chat-links-')),paths=nativeAccountFixturePaths(folder),now=Date.now(),session={hash:'b9'.repeat(32),wallet:'0x'+'b8'.repeat(20),issuedAt:now-1000,expiresAt:now+600000};
 const q=(v:string)=>"'"+v.replaceAll("'","''")+"'",pg=(sql:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+sql+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 const channel=createPostgresDomainChannel(input.options,input.identity,input.digest),native=composePostgresChatLinks(channel,false);let selected:ReturnType<typeof openVerifiedSqliteStorage>|undefined,accountId:string|undefined,vectors=0;
 let lossChannel:ReturnType<typeof createPostgresDomainChannel>|undefined,proxy:Awaited<ReturnType<typeof startCommitAckLossProxy>>|undefined;
 const owner=(work:(db:DatabaseSync)=>void)=>{const db=new DatabaseSync(paths[0]);try{registerStorageCapability(db,input.identity,()=>true);db.exec('BEGIN IMMEDIATE');work(db);db.exec('COMMIT');}catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}finally{db.close();}};
 const normalized=(link:ChatLink|null)=>{if(!link)return null;const {linkedAt,...rest}=link;assert(Number.isSafeInteger(linkedAt)&&linkedAt>=now-1000&&linkedAt<=Date.now());return rest;};
 const recipients:ChatRecipient[]=[{platform:'telegram',scope:'telegram',userId:'712345',channel:'712345'},{platform:'slack',scope:'T123',userId:'U123',channel:'D123'},{platform:'discord',scope:'12345',userId:'23456',channel:'34567'}];
 const generated:PendingChatLink[]=[];
 const pending=(r:ChatRecipient)=>{const issuedAt=Date.now(),p:PendingChatLink={purpose:'chat-account-link-v1',tokenHash:chatTokenHash(randomAccountValue()),recipient:r,binding:{origin:'https://keryx.cc',network:'eip155:5042'},issuedAt,expiresAt:issuedAt+300000};generated.push(p);return p;};
 const financial=()=>input.ownerSql("SELECT encode(sha256(convert_to(jsonb_build_array((SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text COLLATE \"C\"),'[]'::jsonb) FROM public.payment_events r),(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text COLLATE \"C\"),'[]'::jsonb) FROM public.a2a_orders r),(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text COLLATE \"C\"),'[]'::jsonb) FROM public.session_grants r),(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text COLLATE \"C\"),'[]'::jsonb) FROM public.browser_signer_capacity r))::text,'UTF8')),'hex');");
 try{
  const seed=await nativeAccountFixture(folder,input.identity,session);accountId=seed.accountId;const {snapshot,binding}=seed.observation;
  pg(seed.sql+`INSERT INTO public.web_sessions(hash,wallet,issued_at,expires_at) VALUES(${q(session.hash)},${q(session.wallet)},${session.issuedAt},${session.expiresAt});`);
  const manifest=readFileSync(paths[4],'utf8');selected=openVerifiedSqliteStorage(paths[0],input.identity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>assert.equal(readFileSync(paths[4],'utf8'),manifest)});const oracle=createEnrolledSqliteChatAccountLinks(selected.db);assert(oracle);const beforeFinancial=financial();
  const issue=async(p:PendingChatLink)=>{await native.issue(p);await oracle.issue(p);};
  const complete=async(p:PendingChatLink)=>{const n=await native.complete(p.tokenHash,snapshot),o=await oracle.complete(p.tokenHash,snapshot);assert.deepEqual(normalized(n),normalized(o));return {n,o};};
  for(const r of recipients){assert.equal(await native.lookup(r,binding),null);assert.equal(await oracle.lookup(r,binding),null);vectors++;}
  const first=pending(recipients[0]);await issue(first);assert.deepEqual(await native.preview(first.tokenHash,binding),await oracle.preview(first.tokenHash,binding));vectors++;
  await complete(first);assert.deepEqual(normalized(await native.lookup(recipients[0],binding)),normalized(await oracle.lookup(recipients[0],binding)));vectors++;
  for(const port of [native,oracle])await assert.rejects(port.complete(first.tokenHash,snapshot),/chat_token_invalid/);vectors++;
  // Channel is delivery metadata, not a selector that can transfer a reservation.
  const differentChannel={...recipients[0],channel:'-712345'};assert.deepEqual(normalized(await native.lookup(differentChannel,binding)),normalized(await oracle.lookup(differentChannel,binding)));vectors++;
  for(const port of [native,oracle])await assert.rejects(port.issue(pending(recipients[0])),/chat_takeover_refused/);vectors++;
  assert.deepEqual((await native.list(snapshot)).map(normalized),(await oracle.list(snapshot)).map(normalized));vectors++;
  await native.unlinkAccount(recipients[0],snapshot);await oracle.unlinkAccount(recipients[0],snapshot);assert.equal(await native.lookup(recipients[0],binding),null);vectors++;
  const replaced=pending(recipients[0]),current=pending(recipients[0]);await issue(replaced);await issue(current);for(const port of [native,oracle])await assert.rejects(port.preview(replaced.tokenHash,binding),/chat_token_invalid/);vectors++;
  await native.unlink(recipients[0],binding);await oracle.unlink(recipients[0],binding);for(const port of [native,oracle])await assert.rejects(port.preview(current.tokenHash,binding),/chat_token_invalid/);vectors++;
  for(const r of recipients.slice(1)){const p=pending(r);await issue(p);await complete(p);vectors++;}
  const concurrent=pending(recipients[0]);await issue(concurrent);for(const port of [native,oracle]){const results=await Promise.allSettled([port.complete(concurrent.tokenHash,snapshot),port.complete(concurrent.tokenHash,snapshot)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert(results.some(r=>r.status==='rejected'&&String(r.reason).includes('chat_token_invalid')));}vectors++;
  await native.unlink(recipients[0],binding);await oracle.unlink(recipients[0],binding);
  const takeover=pending(recipients[0]);await issue(takeover);
  const foreign='acct_'+'b7'.repeat(32),seedForeign=(db:DatabaseSync)=>db.prepare('INSERT INTO chat263_links(platform,scope,user_id,channel,origin,network,account_id,wallet,member_generation,linked_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('telegram','telegram','712345','712345',binding.origin,binding.network,foreign,session.wallet,snapshot.memberGeneration,Date.now());owner(seedForeign);
  pg(`INSERT INTO public.chat263_links(platform,scope,user_id,channel,origin,network,account_id,wallet,member_generation,linked_at) VALUES('telegram','telegram','712345','712345',${q(binding.origin)},${q(binding.network)},${q(foreign)},${q(session.wallet)},${q(snapshot.memberGeneration)},${Date.now()});`);
  for(const port of [native,oracle]){await assert.rejects(port.complete(takeover.tokenHash,snapshot),/chat_takeover_refused/);await assert.rejects(port.preview(takeover.tokenHash,binding),/chat_token_invalid/);await assert.rejects(port.lookup(recipients[0],binding),/chat_account_changed/);await assert.rejects(port.unlinkAccount(recipients[0],snapshot),/chat_takeover_refused/);}vectors++;
  await native.unlink(recipients[0],binding);await oracle.unlink(recipients[0],binding);
  assert(input.options.endpoint.kind==='loopback');proxy=await startCommitAckLossProxy(input.options.endpoint.port);lossChannel=createPostgresDomainChannel({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest);const lossy=composePostgresChatLinks(lossChannel,false),lost=pending(recipients[0]);await issue(lost);proxy.arm();await assert.rejects(lossy.complete(lost.tokenHash,snapshot),e=>e instanceof PostgresDomainWriteOutcomeUnknown);assert.equal(proxy.observation().dropped,true);const o=await oracle.complete(lost.tokenHash,snapshot);assert.deepEqual(normalized(await native.lookup(recipients[0],binding)),normalized(o));await assert.rejects(native.complete(lost.tokenHash,snapshot),/chat_token_invalid/);vectors++;await lossChannel.close();await proxy.close();lossChannel=undefined;proxy=undefined;
  const stale={...snapshot,membership:{...snapshot.membership,revision:snapshot.membership.revision+1}};for(const port of [native,oracle])await assert.rejects(port.list(stale),/chat_account_changed/);vectors++;
  // Retain stale reservations: credential revocation must not transfer the link.
  owner(db=>{db.prepare('UPDATE account267_credentials SET active=0 WHERE wallet=?').run(session.wallet);});pg(`UPDATE public.account267_credentials SET active=0 WHERE wallet=${q(session.wallet)};`);for(const port of [native,oracle])await assert.rejects(port.lookup(recipients[1],binding),/chat_account_changed/);vectors++;
  owner(db=>{db.prepare('UPDATE account267_credentials SET active=1 WHERE wallet=?').run(session.wallet);});pg(`UPDATE public.account267_credentials SET active=1 WHERE wallet=${q(session.wallet)};`);
  const waitingRecipient={platform:'telegram' as const,scope:'telegram',userId:'712346',channel:'712346'},waiting=pending(waitingRecipient);await issue(waiting);
  await input.contentionClient.query('BEGIN');try{
   await input.contentionClient.query('SELECT pg_advisory_xact_lock_shared(634781904177021::bigint),pg_advisory_xact_lock(634781904177022::bigint)');const queued=native.complete(waiting.tokenHash,snapshot).then(value=>({value}),error=>({error}));let blocked=false;
   for(let i=0;i<50;i++){const r=await input.contentionClient.query('SELECT count(*) n FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND pg_backend_pid()=ANY(pg_blocking_pids(pid))');if(Number(r.rows[0].n)>0){blocked=true;break;}await new Promise(r=>setTimeout(r,20));}assert(blocked);
   await input.contentionClient.query({text:AUTH_WRITE_CALLS.auth_revoke_web_session.sql,values:[JSON.stringify(input.identity),input.digest,JSON.stringify({p_hash:session.hash,p_wallet:session.wallet})]});await input.contentionClient.query('COMMIT');const outcome=await queued;assert('error'in outcome&&String(outcome.error).includes('chat_account_changed'));owner(db=>{db.prepare('DELETE FROM web_sessions WHERE hash=?').run(session.hash);});await assert.rejects(oracle.complete(waiting.tokenHash,snapshot),/chat_account_changed/);vectors++;
  }finally{await input.contentionClient.query('ROLLBACK');}
  owner(db=>{db.prepare('INSERT INTO web_sessions(hash,wallet,issued_at,expires_at) VALUES(?,?,?,?)').run(session.hash,session.wallet,session.issuedAt,session.expiresAt);});pg(`INSERT INTO public.web_sessions(hash,wallet,issued_at,expires_at) VALUES(${q(session.hash)},${q(session.wallet)},${session.issuedAt},${session.expiresAt});`);await complete(waiting);vectors++;
  const initial=(await native.list(snapshot)).length,filled:ChatRecipient[]=[];let fillSql='';const linkedAt=Date.now();
  owner(db=>{const insert=db.prepare('INSERT INTO chat263_links(platform,scope,user_id,channel,origin,network,account_id,wallet,member_generation,linked_at) VALUES(?,?,?,?,?,?,?,?,?,?)');for(let i=initial;i<32;i++){
   const userId=String(700000+i),r={platform:'telegram' as const,scope:'telegram',userId,channel:userId};filled.push(r);insert.run(r.platform,r.scope,r.userId,r.channel,binding.origin,binding.network,snapshot.membership.accountId,session.wallet,snapshot.memberGeneration,linkedAt);
   fillSql+=`INSERT INTO public.chat263_links(platform,scope,user_id,channel,origin,network,account_id,wallet,member_generation,linked_at) VALUES('telegram','telegram',${q(userId)},${q(userId)},${q(binding.origin)},${q(binding.network)},${q(snapshot.membership.accountId)},${q(session.wallet)},${q(snapshot.memberGeneration)},${linkedAt});`;
  }});pg(fillSql);assert.equal((await native.list(snapshot)).length,32);assert.deepEqual((await native.list(snapshot)).map(normalized),(await oracle.list(snapshot)).map(normalized));vectors++;
  const full=pending({platform:'telegram',scope:'telegram',userId:'799999',channel:'799999'});await issue(full);for(const port of [native,oracle]){await assert.rejects(port.complete(full.tokenHash,snapshot),/chat_unavailable/);assert.deepEqual(await port.preview(full.tokenHash,binding),full);}vectors++;
  assert(filled[0]);await native.unlinkAccount(filled[0],snapshot);await oracle.unlinkAccount(filled[0],snapshot);await complete(full);assert.equal((await native.list(snapshot)).length,32);vectors++;
  const expiring=pending({platform:'telegram',scope:'telegram',userId:'899998',channel:'899998'});await issue(expiring);const expiresAt=Date.now()+1000,issuedAt=expiresAt-300000;
  owner(db=>{db.prepare('UPDATE chat263_tokens SET issued_at=?,expires_at=? WHERE token_hash=?').run(issuedAt,expiresAt,expiring.tokenHash);});pg(`UPDATE public.chat263_tokens SET issued_at=${issuedAt},expires_at=${expiresAt} WHERE token_hash=${q(expiring.tokenHash)};`);
  await input.contentionClient.query('BEGIN');try{
   await input.contentionClient.query('SELECT pg_advisory_xact_lock_shared(634781904177021::bigint),pg_advisory_xact_lock(634781904177022::bigint)');const queued=native.preview(expiring.tokenHash,binding).then(value=>({value}),error=>({error}));let blocked=false;
   for(let i=0;i<50;i++){const r=await input.contentionClient.query('SELECT count(*) n FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND pg_backend_pid()=ANY(pg_blocking_pids(pid))');if(Number(r.rows[0].n)>0){blocked=true;break;}await new Promise(r=>setTimeout(r,20));}assert(blocked);
   await new Promise(r=>setTimeout(r,Math.max(0,expiresAt-Date.now()+20)));await input.contentionClient.query('COMMIT');const result=await queued;assert('error'in result&&String(result.error).includes('chat_token_invalid'));await assert.rejects(oracle.preview(expiring.tokenHash,binding),/chat_token_invalid/);vectors++;
  }finally{await input.contentionClient.query('ROLLBACK');}
  const fresh=pending(expiring.recipient);await issue(fresh);assert.equal(input.ownerSql(`SELECT count(*) FROM public.chat263_tokens WHERE token_hash=${q(expiring.tokenHash)};`),'0');assert.equal(selected.db.prepare('SELECT count(*) n FROM chat263_tokens WHERE token_hash=?').get(expiring.tokenHash)?.n,0);vectors++;
  let accessed=0;const bad={get wallet(){accessed++;throw Error();}} as never,readonly=composePostgresChatLinks(channel,true);for(const invoke of [()=>readonly.issue(bad),()=>readonly.complete('',bad),()=>readonly.unlink(bad,bad),()=>readonly.unlinkAccount(bad,bad)])await assert.rejects(invoke());assert.equal(accessed,0);vectors++;
  const reader=createPostgresDomainChannel({...input.options,role:'keryx_reader'},input.identity,input.digest);try{const port=composePostgresChatLinks(reader,true);assert.deepEqual((await port.list(snapshot)).map(normalized),(await oracle.list(snapshot)).map(normalized));vectors++;}finally{await reader.close();}
  input.ownerSql("UPDATE keryx_storage.control SET mode='held';");try{await assert.rejects(native.list(snapshot));vectors++;}finally{input.ownerSql("UPDATE keryx_storage.control SET mode='active';");}
  assert.equal(financial(),beforeFinancial);await channel.close();await assert.rejects(native.list(snapshot));vectors++;
  return {vectors,actualPostgres:true,genuineSelectedSqliteOracle:true,dedicatedCurrentBinding:true,allThreePlatforms:true,privateRecipientShape:true,channelDoesNotTransferReservation:true,tokenReplacementAndUnlinkBurn:true,takeoverRefusalCommitsBurn:true,staleReservationRetained:true,concurrentCompleteExactlyOnce:true,actualLostCommitAckExplicitLookup:true,actualWriterWaitThenSessionRevocationRefused:true,actual32LinkCapacityAndRollback:true,postWriterWaitExpiryFresh:true,onlyExpiredRecipientTokensDeleted:true,noAutomaticRetry:true,readonlyBeforeGetters:true,actualReaderRole:true,financialRowsUnchanged:true,terminalClose:true,providerEnvelopeOrConsentBypass:false,fullWriterQualified:false,productionData:false,paidOperations:0};
 }finally{
  await lossChannel?.close();await proxy?.close();await channel.close();selected?.close();
  pg(`DELETE FROM public.chat263_links WHERE wallet=${q(session.wallet)};DELETE FROM public.chat263_tokens WHERE token_hash IN(${generated.length?generated.map(p=>q(p.tokenHash)).join(','):"''"});`+(accountId?nativeAccountFixtureTables.filter(t=>t!=='account267_challenges').map(t=>`DELETE FROM public.${t} WHERE account_id=${q(accountId!)};`).join(''):'')+`DELETE FROM public.account267_challenges WHERE session_hash=${q(session.hash)};DELETE FROM public.web_sessions WHERE hash=${q(session.hash)};`);
  for(const path of paths)if(existsSync(path))unlinkSync(path);rmdirSync(folder);
 }
}
