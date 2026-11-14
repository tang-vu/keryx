/** Actual PostgreSQL operational parity against the current SQLite SOURCE. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash,randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { canonicalJson } from '../../lib/canonical-json';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { SqliteAdapter } from '../../lib/db/sqlite-adapter';
import { assembleNativePostgresBusinessCore } from '../../lib/db/supabase-adapter';
import { createPostgresApplicationDomainAuthority } from '../../lib/db/postgres/application-domain-authority';
import { createPostgresApplicationDomainTransport,type PostgresApplicationDomainTransport } from '../../lib/db/postgres/application-domain-transport';
import { PostgresDomainWriteOutcomeUnknown } from '../../lib/db/postgres/domain-channel';
import { postgresPoolConfiguration,type PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import { OPERATIONAL_WRITE_OPERATIONS } from '../../lib/db/postgres/operational-write-calls';
import type { StorageIdentity } from '../../lib/db/storage-identity';
import { startCommitAckLossProxy } from './commit-ack-loss.mts';
export async function qualifyOperationalDomains(input:{transport:PostgresApplicationDomainTransport;options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;ownerSql:(sql:string)=>string}){
 const db=new DatabaseSync(':memory:'),wallet='0x'+'a8'.repeat(20),other='0x'+'b7'.repeat(20),hash=createHash('sha256').update(randomUUID()).digest('hex'),now=Date.now(),day=new Date(now).toISOString().slice(0,10);let vectors=0;
 const native=assembleNativePostgresBusinessCore({identity:input.identity,authority:createPostgresApplicationDomainAuthority(input.transport),assertEntry:()=>{},verify:async()=>{await input.transport.applicationRead('get_sync_state',{p_key:'synthetic-operational-authority'});}});
 const q=(s:string)=>"'"+s.replaceAll("'","''")+"'";
 try{
  db.exec('BEGIN');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);db.exec('COMMIT');
  const sqlite=SqliteAdapter.assembleConnectionCore(db,input.identity,()=>{});await native.adapter.init();
  for(const at of [now,now,now,now+99,now+100]){assert.deepEqual(await native.adapter.consumeRateLimit('synthetic-rate',2,100,at),await sqlite.consumeRateLimit('synthetic-rate',2,100,at));vectors++;}
  await native.adapter.deleteExpiredRateLimits(now+200);await sqlite.deleteExpiredRateLimits(now+200);assert.deepEqual(await native.adapter.consumeRateLimit('synthetic-rate',2,100,now+201),await sqlite.consumeRateLimit('synthetic-rate',2,100,now+201));vectors++;
  const race=await Promise.all([native.adapter.consumeRateLimit('synthetic-rate-race',1,1000,now),native.adapter.consumeRateLimit('synthetic-rate-race',1,1000,now)]);assert.equal(race.filter(r=>r.allowed).length,1);vectors++;
  const key='synthetic-circuit';assert.deepEqual(await native.adapter.acquireReasoningCircuit(key,now,50),await sqlite.acquireReasoningCircuit(key,now,50));vectors++;
  for(const [transient,at] of [[true,now],[true,now+1],[false,now+2],[true,now+3]] as const){assert.deepEqual(await native.adapter.recordReasoningCircuitFailure(key,transient,at,3,100,400),await sqlite.recordReasoningCircuitFailure(key,transient,at,3,100,400));vectors++;}
  for(const at of [now+4,now+1000,now+1001,now+1100]){assert.deepEqual(await native.adapter.acquireReasoningCircuit(key,at,50),await sqlite.acquireReasoningCircuit(key,at,50));vectors++;}
  await native.adapter.recordReasoningCircuitFailure('synthetic-circuit-race',false,now,1,10,10);const probes=await Promise.all([native.adapter.acquireReasoningCircuit('synthetic-circuit-race',now+11,50),native.adapter.acquireReasoningCircuit('synthetic-circuit-race',now+11,50)]);assert.equal(probes.filter(r=>r.allowed).length,1);vectors++;
  await native.adapter.clearReasoningCircuit(key);await sqlite.clearReasoningCircuit(key);assert.deepEqual(await native.adapter.acquireReasoningCircuit(key,now,50),await sqlite.acquireReasoningCircuit(key,now,50));vectors++;
  const id=randomUUID(),prefix='synthetic-prefix',stamp='2026-01-02T03:04:05.000Z',scopes='query,read',sourceIds='["synthetic-source"]';
  db.prepare('INSERT INTO api_keys(id,prefix,key_hash,wallet,label,created_at,scopes,source_ids) VALUES(?,?,?,?,?,?,?,?)').run(id,prefix,hash,wallet,'synthetic',stamp,scopes,sourceIds);
  input.ownerSql(`BEGIN;UPDATE keryx_storage.control SET mode='held';INSERT INTO public.api_keys(id,prefix,key_hash,wallet,label,created_at,scopes,source_ids) VALUES(${[id,prefix,hash,wallet,'synthetic',stamp,scopes,sourceIds].map(q).join(',')});UPDATE keryx_storage.control SET mode='active';COMMIT;`);
  assert.equal(await native.adapter.verifyApiKey(prefix,'00'.repeat(32)),await sqlite.verifyApiKey(prefix,'00'.repeat(32)));vectors++;
  assert.deepEqual(await native.adapter.verifyApiKey(prefix,hash),await sqlite.verifyApiKey(prefix,hash));const saved=(await native.adapter.listApiKeys(wallet))[0];assert.equal(saved.createdAt,stamp);assert.equal(new Date(saved.lastUsedAt!).toISOString(),saved.lastUsedAt);assert.equal(saved.scopes,scopes);assert.equal(saved.sourceIds,sourceIds);vectors++;
  await native.adapter.revokeApiKey(id,other);assert(await native.adapter.verifyApiKey(prefix,hash));await native.adapter.revokeApiKey(id,wallet);await sqlite.revokeApiKey(id,wallet);assert.equal(await native.adapter.verifyApiKey(prefix,hash),await sqlite.verifyApiKey(prefix,hash));vectors++;
  const minted=await native.adapter.mintApiKey(wallet,'synthetic-minted',hash,'label','read',null);assert.equal(minted.rawKey,'');assert.equal((await native.adapter.verifyApiKey(minted.prefix,hash))?.keyId,minted.id);await assert.rejects(native.adapter.mintApiKey(wallet,minted.prefix,hash));vectors++;
  await Promise.all([native.adapter.incrementUsage(id),native.adapter.incrementUsage(id)]);await sqlite.incrementUsage(id);await sqlite.incrementUsage(id);assert.deepEqual(await native.adapter.getUsage(id),await sqlite.getUsage(id));vectors++;
  for(const rating of ['up','up','down'] as const){await native.adapter.recordFeedback('synthetic-feedback',rating,'synthetic');await sqlite.recordFeedback('synthetic-feedback',rating,'synthetic');}
  assert.deepEqual(await native.adapter.getFeedbackStats('synthetic-feedback'),await sqlite.getFeedbackStats('synthetic-feedback'));vectors++;
  await Promise.all([native.adapter.recordActivationEvent('reader_landing',day),native.adapter.recordActivationEvent('reader_landing',day)]);
  const counts=await input.transport.applicationRead('activation_funnel',{p_day:day});assert(Array.isArray(counts));assert.equal(Number(counts.find(r=>r.event==='reader_landing')?.count),2);vectors++;
  // Pin this independent counter's day in every request. The public helper
  // above uses the current UTC date, which may roll over during qualification.
  await Promise.all([input.transport.applicationWrite('upsert_api_key_usage',{p_key_id:minted.id,p_day:day}),input.transport.applicationWrite('upsert_api_key_usage',{p_key_id:minted.id,p_day:day})]);
  assert.deepEqual(await native.adapter.getUsage(minted.id),[{day,count:2}]);
  assert.equal(input.options.endpoint.kind,'loopback');const proxy=await startCommitAckLossProxy(input.options.endpoint.port),broken=createPostgresApplicationDomainTransport({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest);
  try{proxy.arm();await assert.rejects(broken.applicationWrite('upsert_api_key_usage',{p_key_id:minted.id,p_day:day}),PostgresDomainWriteOutcomeUnknown);assert.deepEqual(proxy.observation(),{dropped:true,commands:1});assert.deepEqual(await native.adapter.getUsage(minted.id),[{day,count:3}]);vectors++;}finally{await broken.close();await proxy.close();}
  const reader=createPostgresApplicationDomainTransport({...input.options,role:'keryx_reader'},input.identity,input.digest);try{await assert.rejects(reader.applicationWrite('consume_rate_limit',{p_bucket:'refused',p_points:1,p_window_ms:100,p_now:now}));vectors++;}finally{await reader.close();}
  const operations=Object.keys(OPERATIONAL_WRITE_OPERATIONS);assert.equal(operations.length,11);
  const privateNames=operations.map(name=>'storage_'+name),legacyNames=operations.map(name=>'storage_application_'+name);
  assert.equal(input.ownerSql(`SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY[${legacyNames.map(q).join(',')}]::text[]);`),'0');vectors++;
  const permissions=JSON.parse(input.ownerSql(`SELECT jsonb_build_object('count',count(*),'untrusted',count(*) FILTER(WHERE EXISTS(
   SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE'
    AND(a.grantee=0 OR a.grantee IN(SELECT oid FROM pg_roles WHERE rolname=ANY(ARRAY['anon','authenticated','service_role','keryx_app','keryx_reader']))))))::text
   FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname=ANY(ARRAY[${privateNames.map(q).join(',')}]::text[]);`));
  assert.deepEqual(permissions,{count:11,untrusted:0});vectors++;
  assert.equal(input.ownerSql("SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='storage_application_operational_write' AND pg_get_function_identity_arguments(oid)='expected jsonb, digest text, op text, payload jsonb' AND octet_length(prosrc)<=32768;"),'1');vectors++;
  const state=()=>input.ownerSql(`SELECT encode(sha256(convert_to(jsonb_build_array(${['rate_limit_counters','reasoning_circuits','api_keys','api_key_usage','answer_feedback','activation_events'].map(table=>`(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) FROM public.${table} r)`).join(',')})::text,'UTF8')),'hex');`),before=state();
  const direct=new Client(postgresPoolConfiguration(input.options)),directReader=new Client(postgresPoolConfiguration({...input.options,role:'keryx_reader'}));
  direct.on('error',()=>{});directReader.on('error',()=>{});
  const statement='SELECT public.storage_application_operational_write($1::jsonb,$2::text,$3::text,$4::jsonb) AS result',identity=canonicalJson(input.identity);
  const code=(expected:string)=>(error:unknown)=>!!error&&typeof error==='object'&&Reflect.get(error,'code')===expected;
  try{
   await direct.connect();await directReader.connect();
   for(const operation of [null,'','unreviewed_operation','upsert_user','set_sync_state','consume_rate_limit;DROP TABLE public.api_keys']){
    await assert.rejects(direct.query(statement,[identity,input.digest,operation,'{}']),code('P0001'));vectors++;
   }
   for(const payload of ['null','[]','{"unexpected":true}',JSON.stringify({p_bucket:'x'.repeat(65537)})]){
    await assert.rejects(direct.query(statement,[identity,input.digest,'consume_rate_limit',payload]),code('P0001'));vectors++;
   }
   await direct.query('BEGIN READ ONLY');try{await assert.rejects(direct.query(statement,[identity,input.digest,'consume_rate_limit',JSON.stringify({p_bucket:'refused-native',p_points:1,p_window_ms:100,p_now:now})]),code('P0001'));vectors++;}finally{await direct.query('ROLLBACK');}
   await assert.rejects(directReader.query(statement,[identity,input.digest,'consume_rate_limit','{}']),code('42501'));vectors++;
   await assert.rejects(direct.query('SELECT public.storage_application_consume_rate_limit($1::jsonb,$2::text,$3::jsonb)',[identity,input.digest,'{}']),code('42883'));vectors++;
   await assert.rejects(direct.query('SELECT public.storage_delete_expired_rate_limits($1::jsonb,$2)',[identity,String(now)]),code('42501'));vectors++;
  }finally{await Promise.allSettled([direct.end(),directReader.end()]);}
  assert.equal(state(),before);vectors++;
  assert.equal(input.ownerSql('SELECT count(*) FROM keryx_storage.writer;'),'0');
  return {vectors,concurrentRateAdmission:true,singleCircuitProbe:true,walletScopedKeyRevocation:true,keyScopeRetention:true,awaitedNativeAuthenticationAudit:true,concurrentCounters:true,actualLostCommitAck:true,noAutomaticRetry:true,readonlyWritesRefused:true,elevenOperationsOneFixedRouter:true,legacyJsonEntriesAbsent:true,privateBusinessRpcPermissionsRetained:true,unknownAndForeignOpcodesRefused:true,malformedPayloadAndNativeReadonlyRefused:true,negativeProbesLeaveOperationalStateUnchanged:true,productionData:false,paidOperations:0};
 }finally{native.hooks.close();db.close();}
}
