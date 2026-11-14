/** Synthetic new-original admission, never real custody, signatures or vendor IO.
 * The actual SQLite business helper remains the independent behavior oracle. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes,createHash,randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { ARC_MAINNET_PROFILE as profile } from '../../lib/arc-network-profile';
import { canonicalJson } from '../../lib/canonical-json';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { admitSqliteHostedPolicy,admitSqliteHostedAuthorization,sqliteHostedAccounting,type HostedAuthorizationAdmission } from '../../lib/db/hosted-treasury-journal';
import { storageIdentityDigest,type StorageIdentity } from '../../lib/db/storage-identity';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import { createPostgresDomainChannel,PostgresDomainWriteOutcomeUnknown } from '../../lib/db/postgres/domain-channel';
import { composePostgresHostedLedgerTransport } from '../../lib/db/postgres/hosted-ledger-transport';
import { composePostgresHostedAdmission } from '../../lib/db/postgres/hosted-admission-transport';
import { operatingFeePolicyDigest } from '../../lib/payments/operating-fee-policy';
import { publicSourceClaimId } from '../../lib/db/public-source-claims';
import { sqliteJournalTransaction } from '../../lib/db/sqlite-browser-journal';
import { startCommitAckLossProxy } from './commit-ack-loss.mts';
const wallet=()=>`0x${randomBytes(20).toString('hex')}`,nonce=()=>`0x${randomBytes(32).toString('hex')}`;
export async function qualifyHostedAdmission(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;contentionClient:Client;ownerSql:(sql:string)=>string}){
 const db=new DatabaseSync(':memory:'),channel=createPostgresDomainChannel(input.options,input.identity,input.digest),native=composePostgresHostedAdmission(channel,input.identity,false),ledger=composePostgresHostedLedgerTransport(channel,input.identity),q=(s:string)=>"'"+s.replaceAll("'","''")+"'";
 const pg=(s:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+s+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 let vectors=0,proxy:Awaited<ReturnType<typeof startCommitAckLossProxy>>|undefined,loss:ReturnType<typeof createPostgresDomainChannel>|undefined;
 const previous={json:process.env.KERYX_OPERATING_FEE_POLICY_JSON,digest:process.env.KERYX_OPERATING_FEE_POLICY_DIGEST};
 const fresh=async(role:'public'|'private'='public',caps={lifetime:'100',query:'20'})=>{
  const policy={format:'keryx-hosted-treasury-policy-v1' as const,network:profile.networkId,storageIdentityDigest:storageIdentityDigest(input.identity),origin:'https://keryx.cc',signer:wallet(),lifetimeCapMicroUsdc:caps.lifetime,queryCapMicroUsdc:caps.query,expiresAtSeconds:Math.floor(Date.now()/1000)+3600};
  admitSqliteHostedPolicy(db,policy,input.identity,role);await ledger.admitHostedTreasuryPolicy(policy,role);
  const now=Math.floor(Date.now()/1000),value:HostedAuthorizationAdmission={policy,context:{kind:'fetch',queryId:nonce(),queryBudgetMicroUsdc:caps.query,sourceId:'synthetic-unmanaged-'+nonce(),itemId:null,privateJob:null},
   payload:{domain:{name:'GatewayWalletBatched',version:'1',chainId:profile.chainId,verifyingContract:profile.gatewayWallet},primaryType:'TransferWithAuthorization',types:{TransferWithAuthorization:[{name:'from',type:'address'},{name:'to',type:'address'},{name:'value',type:'uint256'},{name:'validAfter',type:'uint256'},{name:'validBefore',type:'uint256'},{name:'nonce',type:'bytes32'}]},message:{from:policy.signer,to:wallet(),value:'7',validAfter:String(now-600),validBefore:String(now+605000),nonce:nonce()}},
   accounting:{retainedMicroUsdc:'0',confirmedMicroUsdc:'0'},availableMicroUsdc:'100'};
  return value;
 };
 const count=(id:string)=>input.ownerSql(`SELECT count(*) FROM public.hosted_treasury_authorizations WHERE nonce=${q(id)};`);
 const compare=async(value:HostedAuthorizationAdmission,allowed:boolean)=>{
  const id=String(value.payload.message.nonce).toLowerCase();
  if(allowed){const expected=admitSqliteHostedAuthorization(db,value,input.identity);assert.equal(await native.admitHostedAuthorization(value),expected);assert.deepEqual(await ledger.hostedTreasuryAccounting(value.policy.signer),sqliteHostedAccounting(db,value.policy.signer));
   const row=JSON.parse(input.ownerSql(`SELECT to_jsonb(a)::text FROM public.hosted_treasury_authorizations a WHERE nonce=${q(id)};`));const source=db.prepare('SELECT * FROM hosted_treasury_authorizations WHERE nonce=?').get(id)!;
   for(const field of ['nonce','policy_digest','signer','query_id','amount_micro','original','header_hash','submitted'])assert.equal(row[field],source[field]);
  }else{assert.throws(()=>admitSqliteHostedAuthorization(db,value,input.identity));await assert.rejects(native.admitHostedAuthorization(value));assert.equal(count(id),'0');}
  vectors++;
 };
 const sync=(key:string,value:string)=>{db.prepare('INSERT INTO sync_state(key,value,updated_at) VALUES(?,?,?)').run(key,value,new Date().toISOString());pg(`INSERT INTO public.sync_state(key,value,updated_at) VALUES(${q(key)},${q(value)},clock_timestamp());`);};
 try{
  db.exec('BEGIN');installMainnetApplicationSchema(db);db.exec('COMMIT');
  // Mainnet application schema contains the actual source-claim payment tables.
  const first=await fresh();await compare(first,true);assert.throws(()=>admitSqliteHostedAuthorization(db,first,input.identity));await assert.rejects(native.admitHostedAuthorization(first));vectors++;
  const citation=await fresh();citation.context.kind='citation';await compare(citation,true);
  for(const change of [
   (v:HostedAuthorizationAdmission)=>{v.availableMicroUsdc='6';},
   (v:HostedAuthorizationAdmission)=>{v.accounting.retainedMicroUsdc='1';},
   (v:HostedAuthorizationAdmission)=>{v.context.queryBudgetMicroUsdc='6';},
   (v:HostedAuthorizationAdmission)=>{v.context.queryBudgetMicroUsdc='21';},
   (v:HostedAuthorizationAdmission)=>{v.payload.message.value='0';},
   (v:HostedAuthorizationAdmission)=>{v.payload.message.value='9007199254740992';},
   (v:HostedAuthorizationAdmission)=>{v.payload.domain.chainId=5042002;},
   (v:HostedAuthorizationAdmission)=>{v.payload.message.from=wallet();},
   (v:HostedAuthorizationAdmission)=>{v.payload.message.validBefore=String(Math.floor(Date.now()/1000)+3600);},
   (v:HostedAuthorizationAdmission)=>{v.policy={...v.policy,expiresAtSeconds:1};},
  ]){const value=await fresh();change(value);await compare(value,false);}
  const budget=await fresh();await compare(budget,true);const next=structuredClone(budget);next.payload.message.nonce=nonce();next.accounting=sqliteHostedAccounting(db,budget.policy.signer);next.context.queryBudgetMicroUsdc='19';await compare(next,false);
  const capacity=await fresh();capacity.context.queryBudgetMicroUsdc='10';await compare(capacity,true);const over=structuredClone(capacity);over.payload.message.nonce=nonce();over.accounting=sqliteHostedAccounting(db,capacity.policy.signer);await compare(over,false);
  const lifetime=await fresh('public',{lifetime:'10',query:'10'});await compare(lifetime,true);const lifeOver=structuredClone(lifetime);lifeOver.context.queryId=nonce();lifeOver.payload.message.nonce=nonce();lifeOver.accounting=sqliteHostedAccounting(db,lifetime.policy.signer);await compare(lifeOver,false);
  const retained=await fresh();await compare(retained,true);const unavailable=structuredClone(retained);unavailable.payload.message.nonce=nonce();unavailable.accounting=sqliteHostedAccounting(db,retained.policy.signer);unavailable.availableMicroUsdc='10';await compare(unavailable,false);
  const rollback=await fresh(),collisionId='x402:'+String(rollback.payload.message.nonce),foreignNonce=nonce();
  sqliteJournalTransaction(db,()=>db.prepare("INSERT INTO payment_events(id,kind,query_id,source_id,payer,payee,amount_usdc,network,settled,settlement_status,authorization_id) VALUES(?,'fetch','synthetic-collision','synthetic-source',?,?,0.000007,?,0,'pending',?)").run(collisionId,rollback.policy.signer,String(rollback.payload.message.to),profile.networkId,foreignNonce));
  pg(`INSERT INTO public.payment_events(id,kind,query_id,source_id,payer,payee,amount_usdc,network,settled,settlement_status,authorization_id) VALUES(${q(collisionId)},'fetch','synthetic-collision','synthetic-source',${q(rollback.policy.signer)},${q(String(rollback.payload.message.to))},0.000007,${q(profile.networkId)},false,'pending',${q(foreignNonce)});`);
  await compare(rollback,false);assert.equal(db.prepare('SELECT count(*) n FROM hosted_treasury_authorizations WHERE nonce=?').get(String(rollback.payload.message.nonce))?.n,0);
  // Torn/corrupt managed state remains managed. These fixtures do not fabricate
  // a valid claim or grant a registry owner/payout policy.
  for(const kind of ['marker','source','claim','history'] as const){
   const value=await fresh(),sid=value.context.sourceId,hash=createHash('sha256').update(sid).digest('hex');
   const key='keryx:source-claims:v1:'+((kind==='marker'||kind==='source')?kind+':'+hash:kind+':'+randomBytes(32).toString('hex')+(kind==='history'?':0000000000000001':''));
   sync(key,kind==='claim'?JSON.stringify({linkedSourceId:sid}):kind==='history'?JSON.stringify({claim:{linkedSourceId:sid}}):'corrupt retained marker');await compare(value,false);
  }
  for(const escape of ['\0','\ud800']){
   const value=await fresh(),key='keryx:source-claims:v1:history:'+randomBytes(32).toString('hex')+':0000000000000001';
   sync(key,JSON.stringify({claim:{linkedSourceId:value.context.sourceId},unrelated:escape}));
   try{await compare(value,false);}finally{
    // Remove this exact isolated fault fixture. PostgreSQL's JSON decoder also
    // refuses an unrelated escaped surrogate; ambiguous managed history holds
    // new admissions rather than falling through to unmanaged authority.
    db.prepare('DELETE FROM sync_state WHERE key=?').run(key);pg(`DELETE FROM public.sync_state WHERE key=${q(key)};`);
   }
  }
  // Operating fee policy is isolated synthetic configuration, restored below.
  const feeValue=await fresh(),feePolicy={format:'keryx-operating-fee-policy-v1' as const,network:profile.networkId,origin:feeValue.policy.origin,storageIdentityDigest:storageIdentityDigest(input.identity),beneficiary:String(feeValue.payload.message.to).toLowerCase(),expiresAtSeconds:Math.floor(Date.now()/1000)+3600};
  process.env.KERYX_OPERATING_FEE_POLICY_JSON=canonicalJson(feePolicy);process.env.KERYX_OPERATING_FEE_POLICY_DIGEST=operatingFeePolicyDigest(feePolicy);
  feeValue.context={...feeValue.context,kind:'operating-fee',sourceId:'keryx:operating-fee',itemId:null,privateJob:null,operatingFee:{policyDigest:operatingFeePolicyDigest(feePolicy),allocationDigest:'ab'.repeat(32),amountMicroUsdc:'7',sourceUrls:['https://synthetic-unclaimed.invalid/source']}};
  await compare(feeValue,true);const again=structuredClone(feeValue);again.payload.message.nonce=nonce();again.accounting=sqliteHostedAccounting(db,feeValue.policy.signer);await compare(again,false);
  const changedSigner=await fresh();changedSigner.payload.message.to=feePolicy.beneficiary;changedSigner.context=structuredClone(feeValue.context);await compare(changedSigner,false);
  const ownerFee=await fresh();ownerFee.payload.message.to=feePolicy.beneficiary;ownerFee.context={...feeValue.context,queryId:nonce()};sync('keryx:source-claims:v1:history:'+publicSourceClaimId(ownerFee.context.operatingFee!.sourceUrls[0],ownerFee.policy.origin,profile.networkId)+':0000000000000001','{}');await compare(ownerFee,false);
  // Historical private dependency facts, imported only into isolated fixtures.
  // No private payment/execution producer is enabled or claimed by this test.
  for(const state of ['active','missing','wrong-worker','result','interrupted'] as const){
   const value=await fresh('private'),id='prv_'+randomBytes(32).toString('hex'),owner=wallet(),worker=randomUUID();value.context.privateJob={id,owner,workerId:worker};value.context.queryId=id;
   if(state!=='missing'){
    const data=JSON.stringify({submission:{request:{budget:0.00002}}});
    sqliteJournalTransaction(db,()=>{
     db.prepare('INSERT INTO private_research_intents(id,payer,data) VALUES(?,?,?)').run(id,owner,data);
     db.prepare('INSERT INTO private_research_payment_attempts(id) VALUES(?)').run(id);
     db.prepare('INSERT INTO private_research_executions(id,worker_id) VALUES(?,?)').run(id,worker);
     if(state==='result')db.prepare('INSERT INTO private_research_results(id,serialized_run) VALUES(?,?)').run(id,'{}');
     if(state==='interrupted')db.prepare("INSERT INTO private_research_interruptions(id,worker_id,reason) VALUES(?,?,'worker-interrupted')").run(id,worker);
    });
    pg(`INSERT INTO public.private_research_intents(id,payer,data) VALUES(${q(id)},${q(owner)},${q(data)});INSERT INTO public.private_research_payment_attempts(id) VALUES(${q(id)});INSERT INTO public.private_research_executions(id,worker_id) VALUES(${q(id)},${q(worker)});`+(state==='result'?`INSERT INTO public.private_research_results(id,serialized_run) VALUES(${q(id)},'{}');`:state==='interrupted'?`INSERT INTO public.private_research_interruptions(id,worker_id,reason) VALUES(${q(id)},${q(worker)},'worker-interrupted');`:''));
   }
   if(state==='wrong-worker')value.context.privateJob.workerId='different-worker';
   await compare(value,state==='active');
   if(state==='active')assert.equal(input.ownerSql(`SELECT count(*) FROM public.payment_events WHERE query_id=${q(id)};`),'0');
  }
  const race=await fresh(),other=structuredClone(race);other.payload.message.nonce=nonce();const results=await Promise.allSettled([native.admitHostedAuthorization(race),native.admitHostedAuthorization(other)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(input.ownerSql(`SELECT count(*) FROM public.hosted_treasury_authorizations WHERE signer=${q(race.policy.signer)};`),'1');vectors++;
  const locked=await fresh();await input.contentionClient.query('BEGIN');try{await input.contentionClient.query('SELECT pg_advisory_xact_lock(634781904177022::bigint)');await assert.rejects(native.admitHostedAuthorization(locked),e=>e instanceof PostgresDomainWriteOutcomeUnknown);assert.equal(count(String(locked.payload.message.nonce)),'0');vectors++;}finally{await input.contentionClient.query('ROLLBACK');}
  assert(input.options.endpoint.kind==='loopback');proxy=await startCommitAckLossProxy(input.options.endpoint.port);loss=createPostgresDomainChannel({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest);const lost=await fresh();proxy.arm();await assert.rejects(composePostgresHostedAdmission(loss,input.identity,false).admitHostedAuthorization(lost),e=>e instanceof PostgresDomainWriteOutcomeUnknown);assert(proxy.observation().dropped);assert.equal(count(String(lost.payload.message.nonce)),'1');await assert.rejects(native.admitHostedAuthorization(lost));vectors++;
  const reader=createPostgresDomainChannel({...input.options,role:'keryx_reader'},input.identity,input.digest);try{await assert.rejects(composePostgresHostedAdmission(reader,input.identity,true).admitHostedAuthorization(await fresh()));const raw=await fresh();await assert.rejects(reader.call('hostedAdmitAuthorization',[canonicalJson(raw.policy),'ab'.repeat(32),canonicalJson({context:raw.context,payload:raw.payload}),canonicalJson(raw.accounting),raw.availableMicroUsdc,null]));vectors++;}finally{await reader.close();}
  const held=await fresh();input.ownerSql("UPDATE keryx_storage.control SET mode='held';");try{await assert.rejects(native.admitHostedAuthorization(held));assert.equal(count(String(held.payload.message.nonce)),'0');vectors++;}finally{input.ownerSql("UPDATE keryx_storage.control SET mode='active';");}
  assert.equal(input.ownerSql('SELECT count(*) FROM keryx_storage.writer;'),'0');
  assert.equal(input.ownerSql('SELECT count(*) FROM public.browser_journal_writer;'),'0');
  return {vectors,actualNewOriginalAdmission:true,unmanagedSourceOnly:true,managedStateNeverFallsBack:true,originalFeePolicyAndOnePerQuery:true,privateOriginalExecution:true,atomicRetainedPayment:true,latePaymentFailureRollsBackOriginal:true,actualConcurrentAdmission:true,actualWriterContention:true,actualLostCommitAck:proxy.observation().dropped,automaticWriteRetry:false,fullWriterAdmitted:false};
 }finally{
  for(const [key,value] of [['KERYX_OPERATING_FEE_POLICY_JSON',previous.json],['KERYX_OPERATING_FEE_POLICY_DIGEST',previous.digest]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  await loss?.close();await proxy?.close();await channel.close();db.close();
 }
}
