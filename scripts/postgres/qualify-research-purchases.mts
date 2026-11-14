/** Genuine selected SQLite Source versus closed native Arc purchase protocols.
 * All facts are synthetic: no provider, signature, settlement or job executes. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,writeFileSync,readFileSync,existsSync,unlinkSync,rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from 'pg';
import { ARC_MAINNET_PROFILE } from '../../lib/arc-network-profile';
import { canonicalJson } from '../../lib/canonical-json';
import { syntheticA2aOriginal } from '../../lib/db/a2a-original-fixture';
import { a2aRequestHash,a2aOrderId,type A2aOrder } from '../../lib/a2a/order';
import { monthlyPurchaseId,monthlyOrderId,MONTHLY_TERM_MS,type MonthlyPurchase,type MonthlyRedemptionInput,type ResearchPurchaseClaim } from '../../lib/db/research-monthly';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { insertStorageIdentity,installStorageFences } from '../../lib/db/storage-identity-sqlite';
import { openVerifiedSqliteStorage,assertVerifiedSqliteConnection } from '../../lib/db/storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../../lib/db/enrolled-sqlite-schema-profile';
import { SqliteAdapter } from '../../lib/db/sqlite-adapter';
import { validateStorageIdentity,type StorageIdentity } from '../../lib/db/storage-identity';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import { createPostgresDomainChannel,PostgresDomainWriteOutcomeUnknown } from '../../lib/db/postgres/domain-channel';
import { composePostgresResearchPurchases } from '../../lib/db/postgres/research-purchases-transport';
import { captureResearchMonthlyRedemption } from '../../lib/db/postgres/research-purchases-packet';
import { acceptanceOriginalMetadata } from '../../lib/db/postgres/acceptance-metadata';
import { startCommitAckLossProxy } from './commit-ack-loss.mts';
export async function qualifyResearchPurchases(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;contentionClient:Client;ownerSql:(sql:string)=>string}){
 input={...input,identity:validateStorageIdentity(input.identity)};
 const folder=mkdtempSync(join(tmpdir(),'keryx-native-research-purchases-')),file=join(folder,'source.sqlite'),manifestPath=join(folder,'storage.json'),manifest=canonicalJson({format:'keryx-storage-deployment-v1',identity:input.identity,backend:{kind:'sqlite',databasePath:file}});
 const q=(s:string)=>"'"+s.replaceAll("'","''")+"'",pg=(sql:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+sql+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 const channel=createPostgresDomainChannel(input.options,input.identity,input.digest),native=composePostgresResearchPurchases(channel,false),base=Math.floor(Date.now()/1000),at=new Date(base*1000).toISOString();
 const purchases=Array.from({length:9},(_,i)=>{const {order:o}=syntheticA2aOriginal(2100+i,ARC_MAINNET_PROFILE);return {format:'keryx-research-monthly-purchase-v2',network:ARC_MAINNET_PROFILE.networkId,asset:ARC_MAINNET_PROFILE.usdcAddress.toLowerCase(),gatewayContract:ARC_MAINNET_PROFILE.gatewayWallet.toLowerCase(),id:monthlyPurchaseId({network:ARC_MAINNET_PROFILE.networkId,...o}),payer:o.payer,payee:o.payee,authorizationId:o.authorizationId,transaction:o.transaction,quoteId:'ab'.repeat(32),createdAt:at,expiresAt:new Date(base*1000+MONTHLY_TERM_MS).toISOString(),creatorBudgetMicros:10000,serviceFeeMicros:20000,totalMicros:60000,researchPackage:o.researchPackage!} satisfies MonthlyPurchase;});
 purchases[5].creatorBudgetMicros=5700;purchases[5].totalMicros=42800;
 const issued={validAfter:String(base-60),validBefore:String(base+606000),expiresAt:String(base+600)},claim=(p:MonthlyPurchase)=>({network:ARC_MAINNET_PROFILE.networkId,payer:p.payer,payee:p.payee,authorizationId:p.authorizationId,purpose:'monthly' as const,requestHash:p.quoteId,amountMicros:p.totalMicros,issued});
 const redemption=(p:MonthlyPurchase,requestId:string,now=at):MonthlyRedemptionInput=>{const f=syntheticA2aOriginal(2100,ARC_MAINNET_PROFILE),id=monthlyOrderId(p.id,requestId),o:A2aOrder={...f.order,id,queryId:id,authorizationId:p.authorizationId+':monthly:'+requestId,transaction:p.transaction,amountUsdc:p.totalMicros/4/1e6,creatorBudgetUsdc:p.creatorBudgetMicros/1e6,serviceFeeUsdc:p.serviceFeeMicros/4/1e6,createdAt:now,updatedAt:now,request:{question:'Synthetic prepaid \ufeff\u2028\ud83d\udd12 '+requestId,origin:'a2a',network:ARC_MAINNET_PROFILE.networkId,monthlyId:p.id,model:''}};o.requestHash=a2aRequestHash({...o,...o.request!});return {monthlyId:p.id,payer:p.payer,requestId,now,order:o};};
 let vectors=0,storeId='',source:ReturnType<typeof openVerifiedSqliteStorage>|undefined,loss:ReturnType<typeof createPostgresDomainChannel>|undefined,proxy:Awaited<ReturnType<typeof startCommitAckLossProxy>>|undefined;
 const orderIds:string[]=[],resourceIds:string[]=[],resourcePolicyKeys:string[]=[];
 try{
  assert.equal(input.ownerSql('SELECT count(*) FROM public.research_monthly;'),'0');assert.equal(input.ownerSql('SELECT count(*) FROM public.deliverable_acceptance_store;'),'0');
  const db=new DatabaseSync(file);try{
   db.exec('BEGIN IMMEDIATE');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);storeId=String(db.prepare('SELECT id FROM deliverable_acceptance_store').get()!.id);
   // Expired issued originals are explicit fixture imports. A submitted replay
   // survives expiry; an unsubmitted original never becomes submitted by expiry.
   for(const [index,submitted] of [[7,true],[8,false]] as const){const p=purchases[index],challenge={validAfter:'0',validBefore:'604800',expiresAt:'300',submitted};db.prepare("INSERT INTO research_purchase_authorizations(network,asset,payer,payee,authorization_id,product,purchase_id,request_hash,amount_micros,issued_data) VALUES(?,?,?,?,?,'monthly',?,?,?,?)").run(p.network!,p.asset!,p.payer,p.payee,p.authorizationId,p.id,p.quoteId,p.totalMicros,JSON.stringify(challenge));pg(`INSERT INTO public.research_purchase_authorizations(network,asset,payer,payee,authorization_id,product,purchase_id,request_hash,amount_micros,issued_data) VALUES(${q(p.network!)},${q(p.asset!)},${q(p.payer)},${q(p.payee)},${q(p.authorizationId)},'monthly',${q(p.id)},${q(p.quoteId)},${p.totalMicros},${q(JSON.stringify(challenge))});`);}
   insertStorageIdentity(db,input.identity);installStorageFences(db,input.identity);db.exec('COMMIT');pg(`INSERT INTO public.deliverable_acceptance_store(singleton,id) VALUES(1,${q(storeId)});`);
  }finally{db.close();}
  writeFileSync(manifestPath,manifest,{mode:0o600});source=openVerifiedSqliteStorage(file,input.identity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>assert.equal(readFileSync(manifestPath,'utf8'),manifest)});
  const core=SqliteAdapter.assembleConnectionCore(source.db,input.identity,()=>assert.equal(canonicalJson(assertVerifiedSqliteConnection(source!.db)),canonicalJson(input.identity)));
  const bothReject=async(a:()=>Promise<unknown>,b:()=>Promise<unknown>)=>{await assert.rejects(a());await assert.rejects(b());vectors++;};
  for(const [index,race] of [[2190,false],[2191,true]] as const){
   const {order:o}=syntheticA2aOriginal(index,ARC_MAINNET_PROFILE),resource:ResearchPurchaseClaim={network:ARC_MAINNET_PROFILE.networkId,payer:o.payer,payee:o.payee,authorizationId:o.authorizationId,purpose:'resource',requestHash:o.requestHash,amountMicros:30000,resourceSourceId:'synthetic-purchase-resource',resourceKind:'fetch'},identity={network:resource.network,payer:resource.payer,authorizationId:resource.authorizationId};
   const key='keryx:source-claims:v1:purchase-policy:'+createHash('sha256').update(canonicalJson(identity)).digest('hex');resourceIds.push(a2aOrderId(resource));resourcePolicyKeys.push(key);
   await core.claimResearchPurchase(resource);if(race)await Promise.all([native.claimResearchPurchase(resource),native.claimResearchPurchase(resource)]);else await native.claimResearchPurchase(resource);vectors++;
   const retained=await core.getSyncState(key);assert(retained);assert.equal(input.ownerSql(`SELECT value FROM public.sync_state WHERE key=${q(key)};`),retained);vectors++;
   await core.claimResearchPurchase(resource);await native.claimResearchPurchase(resource);assert.equal(input.ownerSql(`SELECT value FROM public.sync_state WHERE key=${q(key)};`),retained);vectors++;
   for(const edit of [{requestHash:'ff'.repeat(32)},{resourceSourceId:'different-seller'}])await bothReject(()=>native.claimResearchPurchase({...resource,...edit}),()=>core.claimResearchPurchase({...resource,...edit}));
   assert.equal(input.ownerSql(`SELECT value FROM public.sync_state WHERE key=${q(key)};`),retained);
  }
  for(const p of purchases.slice(0,7)){
   await bothReject(()=>native.claimResearchPurchase({...claim(p),requireExisting:true}),()=>core.claimResearchPurchase({...claim(p),requireExisting:true}));
   await core.claimResearchPurchase(claim(p));await native.claimResearchPurchase(claim(p));vectors++;
   await core.claimResearchPurchase(claim(p));await native.claimResearchPurchase(claim(p));vectors++;
   await bothReject(()=>native.createResearchMonthly(p),()=>core.createResearchMonthly(p));
   await core.claimResearchPurchase({...claim(p),requireExisting:true});await native.claimResearchPurchase({...claim(p),requireExisting:true});vectors++;
   assert.deepEqual(await native.createResearchMonthly(p),await core.createResearchMonthly(p));vectors++;
  }
  const p=purchases[0];await bothReject(()=>native.claimResearchPurchase({...claim(p),requestHash:'ff'.repeat(32)}),()=>core.claimResearchPurchase({...claim(p),requestHash:'ff'.repeat(32)}));
  assert.deepEqual(await native.createResearchMonthly(p),await core.createResearchMonthly(p));vectors++;
  await bothReject(()=>native.createResearchMonthly({...p,transaction:'another'}),()=>core.createResearchMonthly({...p,transaction:'another'}));
  for(const [index,submitted] of [[7,true],[8,false]] as const){const old={...claim(purchases[index]),requireExisting:true,issued:{validAfter:'0',validBefore:'604800',expiresAt:'300'}};if(submitted){await native.claimResearchPurchase(old);await core.claimResearchPurchase(old);vectors++;}else await bothReject(()=>native.claimResearchPurchase(old),()=>core.claimResearchPurchase(old));}
  assert.deepEqual(await native.getResearchMonthly(p.id),await core.getResearchMonthly(p.id));vectors++;
  const binary=redemption(purchases[5],'binary-micros');orderIds.push(binary.order.id);assert.deepEqual(await native.redeemResearchMonthly(binary),await core.redeemResearchMonthly(binary));vectors++;
  for(const request of ['first','second']){const r=redemption(p,request);orderIds.push(r.order.id);assert.deepEqual(await native.redeemResearchMonthly(r),await core.redeemResearchMonthly(r));vectors++;}
  const replay=redemption(p,'first');replay.now=new Date(Date.parse(p.expiresAt)+1).toISOString();assert.deepEqual(await native.redeemResearchMonthly(replay),await core.redeemResearchMonthly(replay));vectors++;
  const conflict=redemption(p,'first');conflict.order.request!.question='different original';conflict.order.requestHash=a2aRequestHash({...conflict.order,...conflict.order.request!});await bothReject(()=>native.redeemResearchMonthly(conflict),()=>core.redeemResearchMonthly(conflict));
  const rollback=redemption(p,'rollback'),captured=captureResearchMonthlyRedemption(rollback),projection=acceptanceOriginalMetadata(captured.row,storeId);orderIds.push(rollback.order.id);
  await assert.rejects(channel.call('researchMonthlyRedeem' as Parameters<typeof channel.call>[0],[JSON.stringify({monthlyId:p.id,payer:p.payer,requestId:rollback.requestId,rowWire:captured.rowWire,projection:{...projection,orderSha256:'00'.repeat(32)}}),rollback.now]),e=>e instanceof PostgresDomainWriteOutcomeUnknown);assert.equal((await native.getResearchMonthly(p.id))!.redemptions.length,2);assert.equal(input.ownerSql(`SELECT count(*) FROM public.a2a_orders WHERE id=${q(rollback.order.id)};`),'0');vectors++;
  const race=redemption(p,'same-request');orderIds.push(race.order.id);const same=await Promise.all([native.redeemResearchMonthly(race),native.redeemResearchMonthly(race)]);assert.equal(same.filter(r=>r.created).length,1);const sourceRace=await core.redeemResearchMonthly(race);for(const r of same)assert.deepEqual(r.order,sourceRace.order);vectors++;
  const candidates=['last-a','last-b'].map(r=>redemption(p,r));orderIds.push(...candidates.map(r=>r.order.id));const last=await Promise.allSettled(candidates.map(r=>native.redeemResearchMonthly(r)));assert.equal(last.filter(r=>r.status==='fulfilled').length,1);const winner=last.findIndex(r=>r.status==='fulfilled');assert.deepEqual((last[winner] as PromiseFulfilledResult<unknown>).value,await core.redeemResearchMonthly(candidates[winner]));vectors++;
  const fifth=redemption(p,'fifth');await bothReject(()=>native.redeemResearchMonthly(fifth),()=>core.redeemResearchMonthly(fifth));assert.deepEqual(await native.getResearchMonthly(p.id),await core.getResearchMonthly(p.id));vectors++;
  const expired=redemption(purchases[1],'expired',purchases[1].expiresAt);await bothReject(()=>native.redeemResearchMonthly(expired),()=>core.redeemResearchMonthly(expired));
  const badEconomics=redemption(purchases[1],'wrong-amount');badEconomics.order.amountUsdc+=0.000001;await bothReject(()=>native.redeemResearchMonthly(badEconomics),()=>core.redeemResearchMonthly(badEconomics));
  const held=redemption(purchases[1],'held');input.ownerSql("UPDATE keryx_storage.control SET mode='held';");try{await assert.rejects(native.redeemResearchMonthly(held));vectors++;}finally{input.ownerSql("UPDATE keryx_storage.control SET mode='active';");}
  const reader=createPostgresDomainChannel({...input.options,role:'keryx_reader'},input.identity,input.digest);try{assert.deepEqual(await composePostgresResearchPurchases(reader,true).getResearchMonthly(p.id),await core.getResearchMonthly(p.id));await assert.rejects(reader.call('researchMonthlyRedeem' as Parameters<typeof reader.call>[0],['{}',at]));vectors++;}finally{await reader.close();}
  await input.contentionClient.query('BEGIN');try{await input.contentionClient.query('SELECT pg_advisory_xact_lock(634781904177022::bigint)');await assert.rejects(native.claimResearchPurchase(claim(purchases[2])));vectors++;}finally{await input.contentionClient.query('ROLLBACK');}
  assert(input.options.endpoint.kind==='loopback');proxy=await startCommitAckLossProxy(input.options.endpoint.port);loss=createPostgresDomainChannel({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest);const lost=redemption(purchases[3],'lost-ack');orderIds.push(lost.order.id);const lossy=composePostgresResearchPurchases({get closed(){return loss!.closed;},close:()=>loss!.close(),call:(operation,args)=>{if(String(operation)==='researchMonthlyRedeem')proxy!.arm();return loss!.call(operation,args);}},false);await assert.rejects(lossy.redeemResearchMonthly(lost),e=>e instanceof PostgresDomainWriteOutcomeUnknown);assert(proxy.observation().dropped);assert((await core.redeemResearchMonthly(lost)).created);assert.deepEqual(await native.redeemResearchMonthly(lost),await core.redeemResearchMonthly(lost));vectors++;
  assert.equal(input.ownerSql('SELECT count(*) FROM public.payment_events;'),'0');assert.equal(input.ownerSql('SELECT count(*) FROM keryx_storage.writer;'),'0');
  return {vectors,actualVerifiedSqliteCore:true,mainnetSourceExplicit:true,resourcePolicySidecarMatchesSource:true,concurrentExactResourceReplay:true,exactMicroAccounting:true,immutableIssuedWindowAndSubmittedCas:true,expiredSubmittedReplay:true,unsubmittedExpiryRefused:true,fourSlotCasAndReplay:true,oneLastSlotWinner:true,atomicOrderProjectionRollback:true,actualLostCommitAck:true,readerAndHeldRefused:true,actualWriterContention:true,settlementAuthorityGranted:false,fullWriterQualified:false,productionData:false,paymentActions:0,jobExecutions:0};
 }finally{try{await loss?.close();await proxy?.close();await channel.close();source?.close();const ids=purchases.map(p=>q(p.id)).join(',');pg(`DELETE FROM public.research_monthly_redemptions WHERE monthly_id IN(${ids});`+(orderIds.length?`DELETE FROM public.a2a_orders WHERE id IN(${orderIds.map(q).join(',')});`:'')+`DELETE FROM public.research_monthly WHERE id IN(${ids});DELETE FROM public.research_purchase_authorizations WHERE purchase_id IN(${[...purchases.map(p=>p.id),...resourceIds].map(q).join(',')});`+(resourcePolicyKeys.length?`DELETE FROM public.sync_state WHERE key IN(${resourcePolicyKeys.map(q).join(',')});`:'')+(storeId?`DELETE FROM public.deliverable_acceptance_store WHERE id=${q(storeId)};`:''));}finally{for(const path of [file,file+'-wal',file+'-shm',file+'-journal',manifestPath])if(existsSync(path))unlinkSync(path);rmdirSync(folder);}}
}
