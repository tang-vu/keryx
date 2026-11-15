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
import { createPostgresDomainChannel,PostgresDomainWriteOutcomeUnknown,type PostgresDomainChannel } from '../../lib/db/postgres/domain-channel';
import { composePostgresHostedLedgerTransport,type PostgresHostedPaymentProtocol } from '../../lib/db/postgres/hosted-ledger-transport';
import { composePostgresHostedAdmission } from '../../lib/db/postgres/hosted-admission-transport';
import { operatingFeePolicyDigest } from '../../lib/payments/operating-fee-policy';
import { publicSourceClaimId,issueSqliteSourceClaimChallenge,verifySqliteSourceClaim,bindSqliteSourceClaim,updateSqliteSourceClaimPolicy } from '../../lib/db/public-source-claims';
import { config } from '../../lib/config';
import { sqliteJournalTransaction } from '../../lib/db/sqlite-browser-journal';
import { startCommitAckLossProxy } from './commit-ack-loss.mts';
import { captureObservedPaymentFixture } from './qualify-payment-events.mts';
import { paymentEventWireSha256 } from '../../lib/db/postgres/payment-events-packet';
const wallet=()=>`0x${randomBytes(20).toString('hex')}`,nonce=()=>`0x${randomBytes(32).toString('hex')}`;
export async function qualifyHostedAdmission(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;contentionClient:Client;ownerSql:(sql:string)=>string;protocol?:PostgresHostedPaymentProtocol}){
 const protocol=input.protocol??'legacy-v1',sourceOriginals=protocol==='source-payment-originals-v1';
 if(protocol!=='legacy-v1'&&!sourceOriginals)throw Error('Hosted qualifier protocol refused');
 const db=new DatabaseSync(':memory:'),baseChannel=createPostgresDomainChannel(input.options,input.identity,input.digest);
 const writersEmpty=()=>{for(const table of ['public.browser_journal_writer','keryx_storage.writer'])assert.equal(input.ownerSql(`SELECT count(*) FROM ${table};`),'0');};
 const channel:PostgresDomainChannel={get closed(){return baseChannel.closed;},close:()=>baseChannel.close(),async call(operation,args){try{return await baseChannel.call(operation,args);}finally{if(operation==='hostedAdmitAuthorization')writersEmpty();}}},native=composePostgresHostedAdmission(channel,input.identity,false,protocol),ledger=composePostgresHostedLedgerTransport(channel,input.identity,protocol),q=(s:string)=>"'"+s.replaceAll("'","''")+"'";
 const pg=(s:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+s+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 let vectors=0,proxy:Awaited<ReturnType<typeof startCommitAckLossProxy>>|undefined,loss:ReturnType<typeof createPostgresDomainChannel>|undefined;
 const previous={json:process.env.KERYX_OPERATING_FEE_POLICY_JSON,digest:process.env.KERYX_OPERATING_FEE_POLICY_DIGEST};
 const previousConfig={baseUrl:config.baseUrl,registryOrigins:config.registryOrigins,registryReadAddress:config.registryReadAddress};
 const fresh=async(role:'public'|'private'='public',caps={lifetime:'100',query:'20'})=>{
  const policy={format:'keryx-hosted-treasury-policy-v1' as const,network:profile.networkId,storageIdentityDigest:storageIdentityDigest(input.identity),origin:'https://keryx.cc',signer:wallet(),lifetimeCapMicroUsdc:caps.lifetime,queryCapMicroUsdc:caps.query,expiresAtSeconds:Math.floor(Date.now()/1000)+3600};
  admitSqliteHostedPolicy(db,policy,input.identity,role);await ledger.admitHostedTreasuryPolicy(policy,role);
  const now=Math.floor(Date.now()/1000),value:HostedAuthorizationAdmission={policy,context:{kind:'fetch',queryId:nonce(),queryBudgetMicroUsdc:caps.query,sourceId:'synthetic-unmanaged-'+nonce(),itemId:null,privateJob:null},
   payload:{domain:{name:'GatewayWalletBatched',version:'1',chainId:profile.chainId,verifyingContract:profile.gatewayWallet},primaryType:'TransferWithAuthorization',types:{TransferWithAuthorization:[{name:'from',type:'address'},{name:'to',type:'address'},{name:'value',type:'uint256'},{name:'validAfter',type:'uint256'},{name:'validBefore',type:'uint256'},{name:'nonce',type:'bytes32'}]},message:{from:policy.signer,to:wallet(),value:'7',validAfter:String(now-600),validBefore:String(now+605000),nonce:nonce()}},
   accounting:{retainedMicroUsdc:'0',confirmedMicroUsdc:'0'},availableMicroUsdc:'100'};
  return value;
 };
 const clock=()=>Number(input.ownerSql('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::text;'));
 const createdOriginals=new Map<string,{wire:string;sha256:string}>();
 const compareCreated=(value:HostedAuthorizationAdmission,before:number,after:number)=>{
  if(!sourceOriginals)return;
  const id='x402:'+String(value.payload.message.nonce).toLowerCase();
  if(value.context.privateJob){assert.equal(input.ownerSql(`SELECT count(*) FROM public.payment_events WHERE id=${q(id)};`),'0');assert.equal(input.ownerSql(`SELECT count(*) FROM keryx_storage.payment_event_originals WHERE payment_id=${q(id)};`),'0');return;}
  const source=captureObservedPaymentFixture(db,id);assert(source);
  const raw=JSON.parse(input.ownerSql(`SELECT json_build_object('identity',identity_digest,'original',original_wire::text,'originalSha',original_sha256,'current',current_wire::text,'currentSha',current_sha256,'coherent',native_projection=to_jsonb(p),'nativeCreated',to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) FROM keryx_storage.payment_event_originals r JOIN public.payment_events p ON p.id=r.payment_id WHERE p.id=${q(id)};`));
  const native=JSON.parse(raw.current);assert.equal(new Date(native.created_at).toISOString(),native.created_at);
  assert(Date.parse(native.created_at)>=before&&Date.parse(native.created_at)<=after,'creation clock must be captured inside actual write bounds');
  assert.deepEqual(native,{...source.row,created_at:native.created_at});assert.equal(raw.nativeCreated,native.created_at);
  assert.equal(raw.identity,storageIdentityDigest(input.identity));assert.equal(raw.coherent,true);
  assert.equal(raw.original,raw.current);assert.equal(raw.originalSha,paymentEventWireSha256(raw.original));assert.equal(raw.currentSha,paymentEventWireSha256(raw.current));
  createdOriginals.set(id,{wire:raw.original,sha256:raw.originalSha});writersEmpty();
 };
 const count=(id:string)=>input.ownerSql(`SELECT count(*) FROM public.hosted_treasury_authorizations WHERE nonce=${q(id)};`);
 const compare=async(value:HostedAuthorizationAdmission,allowed:boolean)=>{
  const id=String(value.payload.message.nonce).toLowerCase();
  if(allowed){const expected=admitSqliteHostedAuthorization(db,value,input.identity),before=clock();assert.equal(await native.admitHostedAuthorization(value),expected);compareCreated(value,before,clock());assert.deepEqual(await ledger.hostedTreasuryAccounting(value.policy.signer),sqliteHostedAccounting(db,value.policy.signer));
   const row=JSON.parse(input.ownerSql(`SELECT to_jsonb(a)::text FROM public.hosted_treasury_authorizations a WHERE nonce=${q(id)};`));const source=db.prepare('SELECT * FROM hosted_treasury_authorizations WHERE nonce=?').get(id)!;
   for(const field of ['nonce','policy_digest','signer','query_id','amount_micro','original','header_hash','submitted'])assert.equal(row[field],source[field]);
  }else{assert.throws(()=>admitSqliteHostedAuthorization(db,value,input.identity));await assert.rejects(native.admitHostedAuthorization(value));assert.equal(count(id),'0');}
  vectors++;
 };
 const sync=(key:string,value:string)=>{db.prepare('INSERT INTO sync_state(key,value,updated_at) VALUES(?,?,?)').run(key,value,new Date().toISOString());pg(`INSERT INTO public.sync_state(key,value,updated_at) VALUES(${q(key)},${q(value)},clock_timestamp());`);};
 const rewrite=(key:string,value:string)=>{db.prepare('UPDATE sync_state SET value=? WHERE key=?').run(value,key);pg(`UPDATE public.sync_state SET value=${q(value)} WHERE key=${q(key)};`);};
 const managed=async(mode:'free'|'citation-only'|'paid'='paid')=>{
  const value=await fresh(),sourceId='synthetic-managed-'+randomBytes(16).toString('hex'),url='https://synthetic-publisher.invalid/'+randomBytes(16).toString('hex'),owner=wallet(),onchainId=nonce(),now=Date.now()-3000;
  db.prepare('INSERT INTO sources(id,name,url,wallet_address,onchain_id,active,verified) VALUES(?,?,?,?,?,1,1)').run(sourceId,sourceId,url,owner,onchainId);
  pg(`INSERT INTO public.sources(id,name,url,wallet_address,onchain_id,active,verified) VALUES(${q(sourceId)},${q(sourceId)},${q(url)},${q(owner)},${q(onchainId)},true,true);`);
  const challenge=issueSqliteSourceClaimChallenge(db,{canonicalUrl:url,wallet:owner,deploymentOrigin:value.policy.origin,network:profile.networkId,now}),verified=verifySqliteSourceClaim(db,{challengeId:challenge.id,wallet:owner,proofDigest:'ee'.repeat(32),now:now+1}),linked=bindSqliteSourceClaim(db,{claimId:verified.id,wallet:owner,expectedRevision:verified.revision,sourceId,onchainId,registryAddress:config.registryReadAddress.toLowerCase(),now:now+2}),claim=updateSqliteSourceClaimPolicy(db,{claimId:linked.id,wallet:owner,expectedRevision:linked.revision,mode,distributionPermission:mode!=='free',now:now+3});
  const keys=['rate:'+owner,'challenge:'+challenge.id,'claim:'+claim.id,'source:'+createHash('sha256').update(sourceId).digest('hex'),'marker:'+createHash('sha256').update(sourceId).digest('hex'),...[1,2,3].map(n=>'history:'+claim.id+':'+String(n).padStart(16,'0'))].map(k=>'keryx:source-claims:v1:'+k);
  for(const key of keys){const raw=String(db.prepare('SELECT value FROM sync_state WHERE key=?').get(key)!.value);pg(`INSERT INTO public.sync_state(key,value,updated_at) VALUES(${q(key)},${q(raw)},clock_timestamp());`);}
  if(value.context.kind==='operating-fee')throw Error('wrong fresh kind');
  value.context.sourceId=sourceId;const {id,revision,effectiveAt,verifiedAt}=claim;value.context.sourceClaim={id,revision,mode,effectiveAt,verifiedAt};value.payload.message.to=owner;
  return {value,claim,challenge,sourceId};
 };
 try{
  Object.assign(config,{baseUrl:'https://keryx.cc',registryOrigins:'',registryReadAddress:'0x'+'88'.repeat(20)});
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
    // Remove this exact isolated fault fixture. The linked identity survives
    // escaped evidence, and its missing binding still refuses new admission.
    db.prepare('DELETE FROM sync_state WHERE key=?').run(key);pg(`DELETE FROM public.sync_state WHERE key=${q(key)};`);
   }
  }
  const unmanagedVectors=vectors;
  // Genuine Source-created synthetic policy/history, with no wallet signatures,
  // facilitator settlement, registry/provider IO or real source-control proof.
  // The production owner's two retained claims are never changed by this suite.
  for(const mode of ['paid','citation-only','free'] as const){const f=await managed(mode);await compare(f.value,mode==='paid');const g=await managed(mode);g.value.context.kind='citation';await compare(g.value,mode!=='free');}
  for(const fault of ['receipt','binding','marker','current','history','proof','inactive','unverified','synthetic','url','onchain','stale','future','registry'] as const){
   const f=await managed(),key='keryx:source-claims:v1:claim:'+f.claim.id,history='keryx:source-claims:v1:history:'+f.claim.id+':0000000000000003';
   const remove=(key:string)=>{db.prepare('DELETE FROM sync_state WHERE key=?').run(key);pg(`DELETE FROM public.sync_state WHERE key=${q(key)};`);};
   const updateClaim=(patch:Record<string,unknown>)=>{const claim={...f.claim,...patch};rewrite(key,canonicalJson(claim));rewrite(history,canonicalJson({claim,action:'policy',at:new Date().toISOString(),evidence:{}}));};
   if(fault==='receipt'&&f.value.context.kind!=='operating-fee')f.value.context.sourceClaim!.revision++;
   if(fault==='binding')remove('keryx:source-claims:v1:source:'+createHash('sha256').update(f.sourceId).digest('hex'));
   if(fault==='marker')rewrite('keryx:source-claims:v1:marker:'+createHash('sha256').update(f.sourceId).digest('hex'),'{}');
   if(fault==='current')remove(key);
   if(fault==='history')remove(history);
   if(fault==='proof')remove('keryx:source-claims:v1:challenge:'+f.challenge.id);
   if(fault==='inactive'||fault==='unverified'){const field=fault==='inactive'?'active':'verified';db.prepare(`UPDATE sources SET ${field}=0 WHERE id=?`).run(f.sourceId);pg(`UPDATE public.sources SET ${field}=false WHERE id=${q(f.sourceId)};`);}
   if(fault==='synthetic'){db.prepare("UPDATE sources SET evidence_provenance='synthetic-demo' WHERE id=?").run(f.sourceId);pg(`UPDATE public.sources SET evidence_provenance='synthetic-demo' WHERE id=${q(f.sourceId)};`);}
   if(fault==='url'||fault==='onchain'){const field=fault==='url'?'url':'onchain_id',bad=fault==='url'?'https://other.invalid/':nonce();db.prepare(`UPDATE sources SET ${field}=? WHERE id=?`).run(bad,f.sourceId);pg(`UPDATE public.sources SET ${field}=${q(bad)} WHERE id=${q(f.sourceId)};`);}
   if(fault==='stale'||fault==='future'){const field=fault==='stale'?'verifiedAt':'effectiveAt',at=new Date(Date.now()+(fault==='stale'?-25*3600000:60000)).toISOString();updateClaim({[field]:at});if(f.value.context.kind!=='operating-fee')f.value.context.sourceClaim![field]=at;}
   if(fault==='registry')updateClaim({registryAddress:wallet()});
   await compare(f.value,false);
  }
  for(const text of ['\0','\ud800','\udc00','\\u0000']){
   const f=await managed(),key='keryx:source-claims:v1:history:'+f.claim.id+':0000000000000003',raw=JSON.parse(String(db.prepare('SELECT value FROM sync_state WHERE key=?').get(key)!.value));raw.evidence={retained:text};const wire=JSON.stringify(raw);rewrite(key,wire);await compare(f.value,true);assert.equal(input.ownerSql(`SELECT value FROM public.sync_state WHERE key=${q(key)};`),wire);
  }
  // The retained per-source registry origin wins over a changed global fallback.
  // These are isolated synthetic allowlist terms, never on-chain attestation.
  const bound=await managed(),missingOrigin=await managed(),foreignOrigin=await managed(),oldRegistry={registryReadAddress:config.registryReadAddress,registryOrigins:config.registryOrigins,networkId:config.networkId},oldOrigins={server:process.env.KERYX_REGISTRY_ORIGINS,public:process.env.NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS};
  const authority={network:profile.networkId,address:oldRegistry.registryReadAddress.toLowerCase(),version:3,codeHash:nonce(),deployBlock:'123'},authorityWire=canonicalJson([authority]);
  for(const f of [bound,foreignOrigin])sync('keryx:source-registry-origin:v1:'+f.claim.onchainId!.toLowerCase(),canonicalJson({format:'keryx-source-registry-origin-v1',onchainId:f.claim.onchainId!.toLowerCase(),authority:f===bound?authority:{...authority,codeHash:nonce()}}));
  try{Object.assign(config,{registryReadAddress:wallet(),registryOrigins:authorityWire,networkId:profile.networkId});process.env.KERYX_REGISTRY_ORIGINS=authorityWire;process.env.NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS=authorityWire;await compare(bound.value,true);await compare(missingOrigin.value,false);await compare(foreignOrigin.value,false);}
  finally{Object.assign(config,oldRegistry);for(const [key,value] of [['KERYX_REGISTRY_ORIGINS',oldOrigins.server],['NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS',oldOrigins.public]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
  const changed=await managed();let capturedArgs:readonly(string|null)[]|undefined;
  const captureChannel:PostgresDomainChannel={get closed(){return channel.closed;},close:()=>channel.close(),async call(operation,args){if(operation==='hostedAdmitAuthorization'){capturedArgs=[...args];throw Error('fixture capture before dispatch');}return channel.call(operation,args);}};
  await assert.rejects(composePostgresHostedAdmission(captureChannel,input.identity,false,protocol).admitHostedAuthorization(changed.value),/fixture capture before dispatch/);assert(capturedArgs);
  db.prepare('UPDATE sources SET active=0 WHERE id=?').run(changed.sourceId);pg(`UPDATE public.sources SET active=false WHERE id=${q(changed.sourceId)};`);
  assert.throws(()=>admitSqliteHostedAuthorization(db,changed.value,input.identity));await assert.rejects(channel.call('hostedAdmitAuthorization',capturedArgs));assert.equal(count(String(changed.value.payload.message.nonce)),'0');vectors++;
  const malformed=await fresh(),malformedKey='keryx:source-claims:v1:history:'+randomBytes(32).toString('hex')+':0000000000000001';sync(malformedKey,'{unsupported malformed retained JSON');try{await assert.rejects(native.admitHostedAuthorization(malformed));assert.equal(count(String(malformed.payload.message.nonce)),'0');vectors++;}finally{db.prepare('DELETE FROM sync_state WHERE key=?').run(malformedKey);pg(`DELETE FROM public.sync_state WHERE key=${q(malformedKey)};`);}
  const sourcePolicyVectors=vectors-unmanagedVectors;
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
  // Stage each write fault after the pure snapshot read, so its read-only
  // COMMIT cannot consume a fault intended for the original authorization.
  const hook=(base:PostgresDomainChannel,beforeWrite:()=>Promise<void>|void):PostgresDomainChannel=>({get closed(){return base.closed;},close:()=>base.close(),async call(operation,args){if(operation==='hostedAdmitAuthorization')await beforeWrite();return base.call(operation,args);}});
  const locked=await fresh();let lockHeld=false;const contended=composePostgresHostedAdmission(hook(channel,async()=>{await input.contentionClient.query('BEGIN');await input.contentionClient.query('SELECT pg_advisory_xact_lock(634781904177022::bigint)');lockHeld=true;}),input.identity,false,protocol);try{await assert.rejects(contended.admitHostedAuthorization(locked),e=>e instanceof PostgresDomainWriteOutcomeUnknown);assert.equal(count(String(locked.payload.message.nonce)),'0');vectors++;}finally{if(lockHeld)await input.contentionClient.query('ROLLBACK');}
  assert(input.options.endpoint.kind==='loopback');proxy=await startCommitAckLossProxy(input.options.endpoint.port);loss=createPostgresDomainChannel({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest);const lost=await fresh();await assert.rejects(composePostgresHostedAdmission(hook(loss,()=>proxy!.arm()),input.identity,false,protocol).admitHostedAuthorization(lost),e=>e instanceof PostgresDomainWriteOutcomeUnknown);assert(proxy.observation().dropped);assert.equal(count(String(lost.payload.message.nonce)),'1');await assert.rejects(native.admitHostedAuthorization(lost));vectors++;
  const reader=createPostgresDomainChannel({...input.options,role:'keryx_reader'},input.identity,input.digest);try{await assert.rejects(composePostgresHostedAdmission(reader,input.identity,true,protocol).admitHostedAuthorization(await fresh()));const raw=await fresh();await assert.rejects(reader.call('hostedAdmitAuthorization',[canonicalJson(raw.policy),'ab'.repeat(32),canonicalJson({context:raw.context,payload:raw.payload}),canonicalJson(raw.accounting),raw.availableMicroUsdc,null]));vectors++;}finally{await reader.close();}
  const held=await fresh();input.ownerSql("UPDATE keryx_storage.control SET mode='held';");try{await assert.rejects(native.admitHostedAuthorization(held));assert.equal(count(String(held.payload.message.nonce)),'0');vectors++;}finally{input.ownerSql("UPDATE keryx_storage.control SET mode='active';");}
  assert.equal(input.ownerSql('SELECT count(*) FROM keryx_storage.writer;'),'0');
  assert.equal(input.ownerSql('SELECT count(*) FROM public.browser_journal_writer;'),'0');
  const priorVectors=vectors-sourcePolicyVectors;assert.equal(priorVectors,42);
  const rawVectorsStart=vectors;
  if(sourceOriginals){
  // Keep every retained original unchanged, even after later writer failures.
  for(const [id,original] of createdOriginals){const got=JSON.parse(input.ownerSql(`SELECT json_build_object('wire',original_wire::text,'sha256',original_sha256) FROM keryx_storage.payment_event_originals WHERE payment_id=${q(id)};`));assert.deepEqual(got,original);}
  const immutableId=createdOriginals.keys().next().value!;
  for(const edit of ["identity_digest=repeat('f',64)","original_wire=(original_wire::text||' ')::json,original_sha256=encode(sha256(convert_to(original_wire::text||' ','UTF8')),'hex')"]){assert.throws(()=>pg(`UPDATE keryx_storage.payment_event_originals SET ${edit} WHERE payment_id=${q(immutableId)};`),/native payment Source original immutable/);vectors++;}
  // Hold the real data lock briefly, then prove the created clock is AFTER its
  // release. A Node timestamp captured before waiting cannot pass this vector.
  const queued=await fresh();let releasedAt=0,releaseWork:Promise<void>|undefined;
  const queuedPort=composePostgresHostedAdmission(hook(channel,async()=>{
   await input.contentionClient.query('BEGIN');await input.contentionClient.query('SELECT pg_advisory_xact_lock(634781904177022::bigint)');
   releaseWork=(async()=>{await new Promise(resolve=>setTimeout(resolve,150));releasedAt=Number((await input.contentionClient.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::text AS ms')).rows[0].ms);await input.contentionClient.query('ROLLBACK');})();
  }),input.identity,false,protocol);
  try{const id=await queuedPort.admitHostedAuthorization(queued);await releaseWork;assert(releasedAt>0);assert.equal(id,admitSqliteHostedAuthorization(db,queued,input.identity));compareCreated(queued,releasedAt,clock());vectors++;}
  finally{await releaseWork;await input.contentionClient.query('ROLLBACK');}
  }
  writersEmpty();const sourceRawVectors=vectors-rawVectorsStart;
  return {vectors,sourceRawVectors,selectedIdentityRaw27Cells:sourceOriginals,creationClockCapturedAfterWriterLock:sourceOriginals,immutablePaymentOriginal:sourceOriginals,currentTxidCapabilitiesCleared:true,priorUnmanagedCasesPreserved:true,priorVectors,sourcePolicyVectors,actualNewOriginalAdmission:true,managedSourceCurrentPolicy:true,managedHistoricalTextPreserved:true,sourcePolicyComparedAfterWriterLock:true,managedStateNeverFallsBack:true,originalFeePolicyAndOnePerQuery:true,privateOriginalExecution:true,atomicRetainedPayment:true,latePaymentFailureRollsBackOriginal:true,actualConcurrentAdmission:true,actualWriterContention:true,actualLostCommitAck:proxy.observation().dropped,automaticWriteRetry:false,fullWriterAdmitted:false};
 }finally{
  Object.assign(config,previousConfig);
  for(const [key,value] of [['KERYX_OPERATING_FEE_POLICY_JSON',previous.json],['KERYX_OPERATING_FEE_POLICY_DIGEST',previous.digest]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  await loss?.close();await proxy?.close();await channel.close();db.close();
 }
}
