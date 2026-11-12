/** Synthetic owner-bound profile protocol, not installed factory provenance. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { createSqlitePrivateProfiles } from '../../lib/db/private-profiles-sqlite';
import { PrivateProfileError,type PrivateProfileRecord } from '../../lib/profiles/private-profile';
import { createPostgresUserDomainTransport,type PostgresUserDomainTransport } from '../../lib/db/postgres/user-domain-transport';
import { PostgresDomainWriteOutcomeUnknown } from '../../lib/db/postgres/domain-channel';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import type { StorageIdentity } from '../../lib/db/storage-identity';
import { startCommitAckLossProxy } from './commit-ack-loss.mts';
export async function qualifyPrivateProfiles(input:{transport:PostgresUserDomainTransport;options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;ownerSql:(sql:string)=>string}){
 const db=new DatabaseSync(':memory:'),wallet=(s:string)=>'0x'+s.repeat(20),owner=wallet('a3'),other=wallet('b4'),network=input.identity.network,stamp='2026-01-02T03:04:05.000Z';let vectors=0;
 const native=input.transport.privateProfiles,q=(s:string)=>"'"+s.replaceAll("'","''")+"'";
 const pg=(s:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+s+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 const both=(s:string)=>{db.exec(s);pg(s);};
 const fields=({createdAt:_created,updatedAt:_updated,...record}:PrivateProfileRecord)=>record;
 const conflict=(e:unknown)=>e instanceof PrivateProfileError&&e.code==='handle_conflict';
 const raw={displayName:'  Plain <script>text</script>  ',handle:'Reader_01',bio:' Reader ',purpose:' Papers ',links:[{kind:'github' as const,url:'https://github.com/keryx-reader'}]};
 try{
  db.exec('BEGIN');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);db.exec('COMMIT');
  const sqlite=createSqlitePrivateProfiles(db);
  assert.deepEqual(await native.get(owner,network),await sqlite.get(owner,network));vectors++;
  const first=await native.update(owner,raw),reference=await sqlite.update(owner,raw);assert.deepEqual(fields(first),fields(reference));assert.equal(first.createdAt,first.updatedAt);vectors++;
  const updatedInput={...raw,displayName:'Updated',handle:'Reader_02'},updated=await native.update(owner,updatedInput),updatedReference=await sqlite.update(owner,updatedInput);assert.deepEqual(fields(updated),fields(updatedReference));assert.equal(updated.createdAt,first.createdAt);vectors++;
  await assert.rejects(native.update(other,updatedInput),conflict);await assert.rejects(sqlite.update(other,updatedInput),conflict);assert.equal((await native.get(other,network)).profile,null);vectors++;
  for(const bad of [{...raw,handle:'admin'},{...raw,displayName:'bad\nline'},{...raw,links:[{kind:'github' as const,url:'https://elsewhere.edu/person'}]}]){await assert.rejects(native.update(owner,bad));await assert.rejects(sqlite.update(owner,bad));vectors++;}
  const raced=await Promise.allSettled([native.update(wallet('c5'),{...raw,handle:'racing_handle'}),native.update(wallet('d6'),{...raw,handle:'racing_handle'})]);assert.equal(raced.filter(r=>r.status==='fulfilled').length,1);assert.equal(raced.filter(r=>r.status==='rejected'&&conflict(r.reason)).length,1);vectors++;
  both(`INSERT INTO users(wallet_address,role,display_handle,first_seen_at,last_seen_at) VALUES(${q(owner)},'reader','synthetic-private-profile',${q(stamp)},${q(stamp)});`);
  const upper=owner.toUpperCase().replace('0X','0x');
  for(let i=0;i<1201;i++)db.prepare('INSERT INTO query_runs(id,created_at,question,budget,data,origin,asker) VALUES(?,?,?,?,?,?,?)').run('synthetic-profile-run-'+i,stamp,'synthetic',0,'{}','web',upper);
  pg(`INSERT INTO public.query_runs(id,created_at,question,budget,data,origin,asker) SELECT 'synthetic-profile-run-'||g,${q(stamp)},'synthetic',0,'{}'::jsonb,'web',${q(upper)} FROM generate_series(0,1200) g;`);
  both(`INSERT INTO query_memories(id,source_scores,sources_read,topics,created_at) VALUES('synthetic-profile-run-0','{}','[]','["biology","papers","biology"]',${q(stamp)});`);
  const activity=await native.get(owner,network),expected=await sqlite.get(owner,network);assert.deepEqual(activity.activity,expected.activity);assert.equal(activity.activity.questions,1201);assert.deepEqual(activity.activity.topics,['biology','papers']);vectors++;
  await assert.rejects(native.get(owner,'eip155:5042002'));vectors++;
  assert.equal(input.options.endpoint.kind,'loopback');const proxy=await startCommitAckLossProxy(input.options.endpoint.port),broken=createPostgresUserDomainTransport({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest),lost={...raw,handle:'reader_02',displayName:'Lost acknowledgement'};
  try{proxy.arm();await assert.rejects(broken.privateProfiles.update(owner,lost),PostgresDomainWriteOutcomeUnknown);assert.deepEqual(proxy.observation(),{dropped:true,commands:1});assert.equal((await native.get(owner,network)).profile?.displayName,lost.displayName);vectors++;}finally{await broken.close();await proxy.close();}
  const reader=createPostgresUserDomainTransport({...input.options,role:'keryx_reader'},input.identity,input.digest);try{assert.equal((await reader.privateProfiles.get(owner,network)).profile?.wallet,owner);await assert.rejects(reader.privateProfiles.update(owner,raw));await assert.rejects(reader.privateProfiles.delete(owner));vectors++;}finally{await reader.close();}await assert.rejects(reader.privateProfiles.get(owner,network));vectors++;
  // Match the current FK cascade without deleting retained questions/history.
  const child=`INSERT INTO profile_verified_identities(wallet,provider,external_id,label,verified_at,current_state_hash) VALUES(${q(owner)},'github','1234','synthetic',${q(stamp)},'${'ab'.repeat(32)}');`;
  both(child);both(`INSERT INTO profile_identity_challenges(state_hash,wallet,provider,session_hash,expires_at,status) VALUES('${'ab'.repeat(32)}',${q(owner)},'github','${'cd'.repeat(32)}',${Date.now()+100000},'pending');INSERT INTO public_researcher_profiles(wallet,handle,published,fields,run_ids,binding,revision,updated_at) VALUES(${q(owner)},'reader_02',0,'[]','[]','{}',0,${q(stamp)});`);await native.delete(owner);await sqlite.delete(owner);assert.equal((await native.get(owner,network)).profile,null);assert.equal(input.ownerSql(`SELECT count(*) FROM public.profile_verified_identities WHERE wallet=${q(owner)};`),'0');assert.equal(db.prepare('SELECT count(*) AS n FROM profile_verified_identities WHERE wallet=?').get(owner)?.n,0);for(const table of ['profile_identity_challenges','public_researcher_profiles']){assert.equal(input.ownerSql(`SELECT count(*) FROM public.${table} WHERE wallet=${q(owner)};`),'0');assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE wallet=?`).get(owner)?.n,0);}assert.equal((await native.get(owner,network)).activity.questions,1201);vectors++;
  assert.equal(input.ownerSql('SELECT count(*) FROM keryx_storage.writer;'),'0');
  return {vectors,normalizedProfileFields:true,createdAtRetained:true,handleConflictAndConcurrentClaim:true,ownerActivityRows:1201,networkBound:true,actualLostCommitAck:true,noAutomaticRetry:true,readonlyWritesRefused:true,terminalClose:true,foreignKeyCascade:true,historyRetained:true,productionData:false,paidOperations:0};
 }finally{db.close();pg(`DELETE FROM public.private_profiles WHERE wallet IN(${[owner,other,wallet('c5'),wallet('d6')].map(q).join(',')});DELETE FROM public.query_memories WHERE id LIKE 'synthetic-profile-run-%';DELETE FROM public.query_runs WHERE id LIKE 'synthetic-profile-run-%';DELETE FROM public.users WHERE display_handle='synthetic-private-profile';`);}
}
