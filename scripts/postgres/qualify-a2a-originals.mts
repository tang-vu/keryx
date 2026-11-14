/** Actual verified SQLite connection/core versus independently admitted native
 * ports. Synthetic retained facts only; no provider, payment or worker executes. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,writeFileSync,readFileSync,existsSync,unlinkSync,rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ARC_MAINNET_PROFILE } from '../../lib/arc-network-profile';
import { canonicalJson } from '../../lib/canonical-json';
import { syntheticA2aOriginal } from '../../lib/db/a2a-original-fixture';
import { a2aRequestHash,type A2aOrderResolutionUpdate } from '../../lib/a2a/order';
import { a2aResearchPackageFingerprint } from '../../lib/a2a/research-package';
import { a2aResearchPackage } from '../../lib/a2a/research-package-definition';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { insertStorageIdentity,installStorageFences } from '../../lib/db/storage-identity-sqlite';
import { openVerifiedSqliteStorage,assertVerifiedSqliteConnection } from '../../lib/db/storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../../lib/db/enrolled-sqlite-schema-profile';
import { SqliteAdapter } from '../../lib/db/sqlite-adapter';
import { monthlyPurchaseId,validateMonthlyPurchase,MONTHLY_TERM_MS } from '../../lib/db/research-monthly';
import { validateStorageIdentity,type StorageIdentity } from '../../lib/db/storage-identity';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import { createPostgresDomainChannel,PostgresDomainWriteOutcomeUnknown } from '../../lib/db/postgres/domain-channel';
import { composePostgresA2aOriginals } from '../../lib/db/postgres/a2a-originals-transport';
import { startCommitAckLossProxy } from './commit-ack-loss.mts';
import { sqliteAcceptanceProjection,heldAcceptanceProjectionSql } from './acceptance-projection.mts';
import { acceptanceOriginalMetadata } from '../../lib/db/postgres/acceptance-metadata';
import { composePostgresHealth } from '../../lib/db/postgres/health-transport';
import type { Client } from 'pg';
type Case={label:string;withoutPurchaseProof?:boolean;fixture?:(value:ReturnType<typeof syntheticA2aOriginal>)=>void;change?:(db:DatabaseSync,id:string)=>void;settled:boolean;claimable:boolean};
export async function qualifyA2aOriginals(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;contentionClient:Client;ownerSql:(sql:string)=>string;rawResponses?:boolean;recovery?:boolean}){
 input={...input,identity:validateStorageIdentity(input.identity)};
 const folder=mkdtempSync(join(tmpdir(),'keryx-native-a2a-originals-')),file=join(folder,'source.sqlite'),manifestPath=join(folder,'storage.json'),manifest=canonicalJson({format:'keryx-storage-deployment-v1',identity:input.identity,backend:{kind:'sqlite',databasePath:file}}),at='2026-11-14T00:00:00.000Z';
 const q=(s:string)=>"'"+s.replaceAll("'","''")+"'",pg=(sql:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+sql+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 const channel=createPostgresDomainChannel(input.options,input.identity,input.digest),native=composePostgresA2aOriginals(channel,false),fixtures:ReturnType<typeof syntheticA2aOriginal>[]=[],ids:string[]=[];
 let vectors=0,monthlyId:string|undefined,source:ReturnType<typeof openVerifiedSqliteStorage>|undefined,loss:ReturnType<typeof createPostgresDomainChannel>|undefined,proxy:Awaited<ReturnType<typeof startCommitAckLossProxy>>|undefined;
 const cases:Case[]=[{label:'valid',settled:true,claimable:true},
  {label:'binary micro round trip',fixture:value=>{value.order.amountUsdc=0.0157;value.order.creatorBudgetUsdc=0.0057;value.order.serviceFeeUsdc=0.01;value.binding.amountMicroUsdc='15700';value.binding.creatorBudgetMicroUsdc='5700';value.binding.serviceFeeMicroUsdc='10000';},settled:true,claimable:true},
  {label:'deep package absent model',fixture:value=>{value.order.researchMode='deep';value.order.researchPackage=a2aResearchPackage('deep');delete value.order.request!.model;},settled:true,claimable:true},
  {label:'Unicode hash preimage',fixture:value=>{value.order.request!.question='\ufeff Unicode \u2028\u2029 \ud83c\udf0d\n\b\f\r\t\\" / quote\' ';},settled:true,claimable:true},
  {label:'retained response JSON null',change:(db,id)=>{db.prepare("UPDATE a2a_orders SET response_data='null' WHERE id=?").run(id);},settled:true,claimable:true},
  {label:'retained resolution JSON null',change:(db,id)=>{db.prepare("UPDATE a2a_orders SET resolution_data='null' WHERE id=?").run(id);},settled:true,claimable:true},
  {label:'retained false response',change:(db,id)=>{db.prepare("UPDATE a2a_orders SET response_data='false' WHERE id=?").run(id);},settled:true,claimable:false},
  {label:'missing inbound',change:(db,id)=>{db.prepare('DELETE FROM payment_events WHERE query_id=?').run(id);},settled:false,claimable:false},
  ...['payer','payee','authorization_id','tx_hash','source_id','network'].map(field=>({label:'wrong inbound '+field,change:(db:DatabaseSync,id:string)=>{const value=field==='payer'||field==='payee'?'0x'+'33'.repeat(20):field==='network'?'eip155:5042002':'synthetic-conflict';db.prepare('UPDATE payment_events SET '+field+'=? WHERE query_id=?').run(value,id);},settled:false,claimable:false})),
  {label:'pending inbound',change:(db,id)=>{db.prepare("UPDATE payment_events SET settled=0,settlement_status='pending' WHERE query_id=?").run(id);},settled:false,claimable:false},
  {label:'inbound amount',change:(db,id)=>{db.prepare('UPDATE payment_events SET amount_usdc=0.031 WHERE query_id=?').run(id);},settled:false,claimable:false},
  {label:'request body',change:(db,id)=>{db.prepare("UPDATE a2a_orders SET request_data=json_set(request_data,'$.question','changed') WHERE id=?").run(id);},settled:false,claimable:false},
  {label:'monthly body',change:(db,id)=>{db.prepare("UPDATE a2a_orders SET request_data=json_set(request_data,'$.monthlyId','synthetic-monthly') WHERE id=?").run(id);},settled:false,claimable:false},
  {label:'unsupported package',change:(db,id)=>{db.prepare("UPDATE a2a_orders SET package_data=json_set(package_data,'$.version','unsupported') WHERE id=?").run(id);},settled:false,claimable:false},
  {label:'existing worker',change:(db,id)=>{db.prepare("UPDATE a2a_orders SET worker_id='synthetic-prior-worker' WHERE id=?").run(id);},settled:true,claimable:false},
  {label:'payment boundary',change:(db,id)=>{db.prepare('UPDATE a2a_orders SET payment_started_at=? WHERE id=?').run(at,id);},settled:true,claimable:false},
  {label:'save boundary',change:(db,id)=>{db.prepare('UPDATE a2a_orders SET result_saving_at=? WHERE id=?').run(at,id);},settled:true,claimable:false},
  {label:'historical version',change:(db,id)=>{db.prepare('UPDATE a2a_orders SET execution_journal_version=NULL WHERE id=?').run(id);},settled:true,claimable:false},
  {label:'completed original',change:(db,id)=>{db.prepare("UPDATE a2a_orders SET status='completed' WHERE id=?").run(id);},settled:true,claimable:false},
  {label:'failed original',change:(db,id)=>{db.prepare("UPDATE a2a_orders SET status='failed' WHERE id=?").run(id);},settled:true,claimable:false},
  {label:'missing purchase proof',withoutPurchaseProof:true,settled:false,claimable:false},
  {label:'saved original',change:(db,id)=>{const created='2026-10-06T03:23:02.000Z';db.prepare('INSERT INTO query_runs(id,created_at,question,budget,total_spent,total_to_creators,data) VALUES(?,?,?,0,0,0,?)').run(id,created,'Synthetic saved original',JSON.stringify({id,createdAt:created,question:'Synthetic saved original',answer:'Synthetic already saved'}));},settled:true,claimable:false},
  {label:'creator attempt',change:(db,id)=>{db.prepare("INSERT INTO payment_events(id,query_id,kind,source_id,payer,payee,amount_usdc,network,created_at,settled,settlement_status) SELECT ?||'_prior',query_id,'fetch','synthetic-source',payer,payee,0.001,network,created_at,0,'pending' FROM payment_events WHERE query_id=?").run(id,id);},settled:true,claimable:false},
  {label:'monthly redemption',change:(db,id)=>{
   const payer='0x'+'11'.repeat(20),payee='0x'+'22'.repeat(20),authorizationId='0x'+'ef'.repeat(32),profile=ARC_MAINNET_PROFILE,createdAt='2026-10-06T03:23:02.000Z',base=Date.parse(createdAt)/1000;
   const purchase=validateMonthlyPurchase({format:'keryx-research-monthly-purchase-v2',network:profile.networkId,asset:profile.usdcAddress.toLowerCase(),gatewayContract:profile.gatewayWallet.toLowerCase(),id:monthlyPurchaseId({network:profile.networkId,payer,payee,authorizationId}),payer,payee,authorizationId,transaction:'synthetic-retained-monthly-no-vendor',quoteId:'ae'.repeat(32),createdAt,expiresAt:new Date(Date.parse(createdAt)+MONTHLY_TERM_MS).toISOString(),creatorBudgetMicros:10000,serviceFeeMicros:40000,totalMicros:80000,researchPackage:a2aResearchPackage('quick')},profile);monthlyId=purchase.id;
   // Declared historical fixture facts only. Keep the actual submitted-original
   // guard and valid stored challenge shape; no issuance/submission/provider runs.
   db.prepare("INSERT INTO research_purchase_authorizations(network,asset,payer,payee,authorization_id,product,purchase_id,request_hash,amount_micros,issued_data) VALUES(?,?,?,?,?,'monthly',?,?,?,?)").run(profile.networkId,profile.usdcAddress.toLowerCase(),payer,payee,authorizationId,purchase.id,purchase.quoteId,purchase.totalMicros,JSON.stringify({validAfter:String(base),validBefore:String(base+604800),expiresAt:String(base+3600),submitted:true}));
   db.prepare('INSERT INTO research_monthly(id,payer,data) VALUES(?,?,?)').run(purchase.id,payer,JSON.stringify(purchase));db.prepare('INSERT INTO research_monthly_redemptions(monthly_id,request_id,order_id,request_hash,created_at,slot) SELECT ?,?,id,request_hash,created_at,0 FROM a2a_orders WHERE id=?').run(purchase.id,'synthetic-monthly-slot',id);
  },settled:false,claimable:false},
  {label:'lock wait',settled:true,claimable:true},{label:'race',settled:true,claimable:true},{label:'lost ack',settled:true,claimable:true}];
 const recoveries:{label:string;status:'completed'|'failed';expected:boolean;setup?:(db:DatabaseSync,id:string)=>void;edit?:(update:A2aOrderResolutionUpdate)=>void}[]=[
  {label:'repair saved real run',status:'completed',expected:true},
  {label:'repair missing run',status:'completed',expected:false,setup:(db,id)=>{db.prepare('DELETE FROM query_runs WHERE id=?').run(id);}},
  {label:'repair offline run',status:'completed',expected:false,setup:(db,id)=>{db.prepare("UPDATE query_runs SET payment_mode='offline' WHERE id=?").run(id);}},
  {label:'repair unstarted',status:'completed',expected:false,setup:(db,id)=>{db.prepare('UPDATE a2a_orders SET started_at=NULL WHERE id=?').run(id);}},
  {label:'repair retained legacy journal',status:'completed',expected:true,setup:(db,id)=>{db.prepare('UPDATE a2a_orders SET execution_journal_version=NULL WHERE id=?').run(id);},edit:u=>{u.resolution.evidence.executionJournalVersion=null;}},
  {label:'repair wrong journal',status:'completed',expected:false,edit:u=>{u.resolution.evidence.executionJournalVersion=null;}},
  {label:'repair changed payment boundary',status:'completed',expected:false,edit:u=>{u.resolution.evidence.paymentBoundaryCrossed=true;}},
  {label:'repair changed saving boundary',status:'completed',expected:false,edit:u=>{u.resolution.evidence.resultSaveBoundaryCrossed=true;}},
  {label:'repair wrong attempt count',status:'completed',expected:false,edit:u=>{u.resolution.evidence.creatorAttempts=1;}},
  {label:'repair SQL simulated evidence',status:'completed',expected:false,setup:(db,id)=>{db.prepare("INSERT INTO payment_events(id,query_id,kind,source_id,payer,payee,amount_usdc,network,created_at,settled,settlement_status) SELECT id||'_simulation',id,'citation','synthetic',payer,payee,0.001,'eip155:5042',created_at,0,'simulated' FROM a2a_orders WHERE id=?").run(id);}},
  {label:'repair mixed current evidence',status:'completed',expected:true,setup:(db,id)=>{for(const [suffix,amount,status,settled] of [['settled',0.001,'settled',1],['pending',0.0005,'pending',0],['failed',0.0007,'failed',0]] as const)db.prepare("INSERT INTO payment_events(id,query_id,kind,source_id,payer,payee,amount_usdc,network,created_at,settled,settlement_status) SELECT id||?,id,'citation','synthetic',payer,payee,?,'eip155:5042',created_at,?,? FROM a2a_orders WHERE id=?").run('_'+suffix,amount,settled,status,id);},edit:u=>{Object.assign(u.resolution.evidence,{creatorAttempts:3,settledCreatorMicros:1000,pendingCreatorMicros:500,failedCreatorMicros:700});}},
  {label:'repair over creator budget',status:'completed',expected:false,setup:(db,id)=>{db.prepare("INSERT INTO payment_events(id,query_id,kind,source_id,payer,payee,amount_usdc,network,created_at,settled,settlement_status) SELECT id||'_over',id,'citation','synthetic',payer,payee,1,'eip155:5042',created_at,1,'settled' FROM a2a_orders WHERE id=?").run(id);},edit:u=>{Object.assign(u.resolution.evidence,{creatorAttempts:1,settledCreatorMicros:1000000});}},
  {label:'repair SQL half micro round',status:'completed',expected:true,setup:(db,id)=>{db.prepare("INSERT INTO payment_events(id,query_id,kind,source_id,payer,payee,amount_usdc,network,created_at,settled,settlement_status) SELECT id||'_half',id,'citation','synthetic',payer,payee,0.0000005,'eip155:5042',created_at,1,'settled' FROM a2a_orders WHERE id=?").run(id);},edit:u=>{Object.assign(u.resolution.evidence,{creatorAttempts:1,settledCreatorMicros:1});}},
  {label:'close creator attempt',status:'failed',expected:false,setup:(db,id)=>{db.prepare("INSERT INTO payment_events(id,query_id,kind,source_id,payer,payee,amount_usdc,network,created_at,settled,settlement_status) SELECT id||'_pending',id,'citation','synthetic',payer,payee,0.001,'eip155:5042',created_at,0,'pending' FROM a2a_orders WHERE id=?").run(id);}},
  {label:'close no execution boundary',status:'failed',expected:true},
  {label:'close too recent',status:'failed',expected:false,edit:u=>{if(u.status==='failed')u.startedBefore='2026-11-13T23:59:59.999Z';}},
  {label:'close saved run',status:'failed',expected:false,setup:(db,id)=>{db.prepare("INSERT INTO query_runs(id,created_at,question,budget,total_spent,total_to_creators,data,payment_mode) SELECT id,created_at,'Synthetic',0,0,0,'{}','offline' FROM a2a_orders WHERE id=?").run(id);}},
  {label:'close payment boundary',status:'failed',expected:false,setup:(db,id)=>{db.prepare('UPDATE a2a_orders SET payment_started_at=started_at WHERE id=?').run(id);}},
  {label:'close saving boundary',status:'failed',expected:false,setup:(db,id)=>{db.prepare('UPDATE a2a_orders SET result_saving_at=started_at WHERE id=?').run(id);}},
  {label:'close historical journal',status:'failed',expected:false,setup:(db,id)=>{db.prepare('UPDATE a2a_orders SET execution_journal_version=NULL WHERE id=?').run(id);}},
  {label:'close unstarted',status:'failed',expected:false,setup:(db,id)=>{db.prepare('UPDATE a2a_orders SET started_at=NULL WHERE id=?').run(id);}},
  {label:'repair lost ack',status:'completed',expected:true},
  {label:'repair atomic rollback',status:'completed',expected:true},
 ];
 if(input.recovery)for(const spec of recoveries)cases.splice(cases.length-3,0,{label:spec.label,settled:true,claimable:false,change:(db,id)=>{
  db.prepare("UPDATE a2a_orders SET started_at=?,worker_id='synthetic-recovery' WHERE id=?").run(at,id);
  if(spec.status==='completed')db.prepare("INSERT INTO query_runs(id,created_at,question,budget,total_spent,total_to_creators,data,payment_mode) SELECT id,created_at,'Synthetic',0,0,0,'{}','real' FROM a2a_orders WHERE id=?").run(id);
  spec.setup?.(db,id);
 }});
 if(input.rawResponses)for(const value of ['nul\0answer','unpaired\ud800answer','literal\\u0000 and \\ud800'])cases.splice(cases.length-3,0,{label:'raw response '+cases.length,change:(db,id)=>{db.prepare('UPDATE a2a_orders SET response_data=? WHERE id=?').run(JSON.stringify({answer:value}),id);},settled:true,claimable:false});
 if(input.rawResponses)cases.splice(cases.length-3,0,{label:'raw resolution escapes',change:(db,id)=>{db.prepare('UPDATE a2a_orders SET resolution_data=? WHERE id=?').run(JSON.stringify({note:'nul\0 and unpaired\ud800'}),id);},settled:true,claimable:false});
 const copy=(table:string,row:Record<string,unknown>)=>{const keys=Object.keys(row);assert(['a2a_orders','payment_events','research_purchase_authorizations','query_runs','research_monthly','research_monthly_redemptions'].includes(table)&&keys.every(k=>/^[a-z][a-z0-9_]*$/.test(k)));return `INSERT INTO public.${table}(${keys.join(',')}) VALUES(${keys.map(key=>{const v=row[key];if(v===null)return 'NULL';if(key==='settled')return v===1?'true':'false';if(typeof v==='number'||typeof v==='bigint')return String(v);assert(typeof v==='string');return q(v)+(table==='a2a_orders'&&['request_data','package_data','response_data','resolution_data'].includes(key)?input.rawResponses&&['response_data','resolution_data'].includes(key)?'::json':'::jsonb':'');}).join(',')});`;};
 try{
  assert.equal(input.ownerSql('SELECT count(*) FROM public.a2a_orders;'),'0');
  const db=new DatabaseSync(file);try{
   db.exec('BEGIN IMMEDIATE');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);
   for(let i=0;i<cases.length;i++){
    const fixture=syntheticA2aOriginal(910+i,ARC_MAINNET_PROFILE);cases[i].fixture?.(fixture);const {order:o,binding:b}=fixture;
    o.requestHash=a2aRequestHash({...o,question:o.request!.question,model:o.request!.model});b.requestHash=o.requestHash;b.packageFingerprint=a2aResearchPackageFingerprint(o.researchPackage);fixtures.push(fixture);ids.push(o.id);
    const originalTrigger=db.prepare("SELECT sql FROM sqlite_schema WHERE name='a2a_purchase_authorization'").get()?.sql;assert(typeof originalTrigger==='string');
    if(cases[i].withoutPurchaseProof)db.exec('DROP TRIGGER a2a_purchase_authorization');
    try{db.prepare("INSERT INTO a2a_orders(id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,service_fee_usdc,research_mode,package_data,status,transaction_id,request_data,execution_journal_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'running',?,?,1,?,?)").run(o.id,o.queryId,o.authorizationId,o.requestHash,o.payer,o.payee,o.amountUsdc,o.creatorBudgetUsdc,o.serviceFeeUsdc,o.researchMode,JSON.stringify(o.researchPackage),o.transaction,JSON.stringify(o.request),o.createdAt,o.updatedAt);}
    finally{if(cases[i].withoutPurchaseProof){db.exec(originalTrigger);assert.equal(db.prepare("SELECT sql FROM sqlite_schema WHERE name='a2a_purchase_authorization'").get()?.sql,originalTrigger);}}
    db.prepare("INSERT INTO payment_events(id,query_id,kind,source_id,payer,payee,amount_usdc,network,tx_hash,settled,settlement_status,authorization_id,created_at) VALUES(?,?,'inbound','a2a',?,?,?,?,?,1,'settled',?,?)").run('inbound_'+o.id,o.id,o.payer,o.payee,o.amountUsdc,b.network,o.transaction,o.authorizationId,o.createdAt);
    cases[i].change?.(db,o.id);
   }
   insertStorageIdentity(db,input.identity);installStorageFences(db,input.identity);db.exec('COMMIT');
   let sql=input.rawResponses?`INSERT INTO public.deliverable_acceptance_store(singleton,id) VALUES(1,${q(String(db.prepare('SELECT id FROM deliverable_acceptance_store').get()!.id))});`:'';for(const table of ['research_purchase_authorizations','research_monthly','a2a_orders','payment_events','query_runs','research_monthly_redemptions'])for(const row of db.prepare('SELECT * FROM '+table).all())sql+=copy(table,row);if(input.rawResponses)for(const id of ids)sql+=heldAcceptanceProjectionSql(sqliteAcceptanceProjection(db,id));pg(sql);
  }finally{db.close();}
  writeFileSync(manifestPath,manifest,{mode:0o600});source=openVerifiedSqliteStorage(file,input.identity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>assert.equal(readFileSync(manifestPath,'utf8'),manifest)});
  const core=SqliteAdapter.assembleConnectionCore(source.db,input.identity,()=>{assert.equal(canonicalJson(assertVerifiedSqliteConnection(source!.db)),canonicalJson(input.identity));});
  const proofDigest=()=>input.ownerSql("SELECT encode(sha256(convert_to(jsonb_build_array((SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]'::jsonb) FROM public.payment_events p),(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY purchase_id),'[]'::jsonb) FROM public.research_purchase_authorizations c))::text,'UTF8')),'hex');"),financial=proofDigest();
  for(let i=0;i<cases.length;i++){
   const expected=fixtures[i].binding,a=await native.hasA2aOriginalSettlement(expected),b=await core.hasA2aOriginalSettlement(expected);assert.equal(a,b,cases[i].label);assert.equal(a,cases[i].settled,cases[i].label);vectors++;
   if(['race','lost ack','lock wait'].includes(cases[i].label))continue;
   const result=await native.claimA2aOriginal(expected,'synthetic-original-worker',at),oracle=await core.claimNextA2aOrder('synthetic-original-worker',at,expected);assert.deepEqual(result,oracle,cases[i].label);assert.equal(result!==null,cases[i].claimable,cases[i].label);vectors++;
   process.stderr.write(JSON.stringify({a2aOriginalFixtureCase:i+1,vectors,casePassed:true})+'\n');
  }
  for(const take of [1,5,500]){assert.deepEqual(await native.listUnfinishedA2aOrders(take),await core.listUnfinishedA2aOrders(take));vectors++;}
  const waiting=fixtures.at(-3)!;
  for(const field of ['requestHash','packageFingerprint'] as const){const wrong={...waiting.binding,[field]:'ab'.repeat(32)};assert.equal(await native.hasA2aOriginalSettlement(wrong),await core.hasA2aOriginalSettlement(wrong));assert.equal(await native.hasA2aOriginalSettlement(wrong),false);assert.equal(await native.claimA2aOriginal(wrong,'synthetic-wrong-binding',at),null);assert.equal(await core.claimNextA2aOrder('synthetic-wrong-binding',at,wrong),null);vectors++;}
  await input.contentionClient.query('BEGIN');try{await input.contentionClient.query('SELECT pg_advisory_xact_lock(634781904177022::bigint)');await assert.rejects(native.claimA2aOriginal(waiting.binding,'synthetic-lock-wait',at),error=>error instanceof PostgresDomainWriteOutcomeUnknown);vectors++;}finally{await input.contentionClient.query('ROLLBACK');}
  const stillQueued=(await native.listUnfinishedA2aOrders(500)).orders.find(o=>o.id===waiting.order.id);assert(stillQueued&&stillQueued.startedAt===null&&stillQueued.workerId===null);assert.deepEqual(await native.claimA2aOriginal(waiting.binding,'synthetic-after-observed-rollback',at),await core.claimNextA2aOrder('synthetic-after-observed-rollback',at,waiting.binding));vectors++;
  const race=fixtures.at(-2)!,results=await Promise.all([native.claimA2aOriginal(race.binding,'synthetic-race-a',at),native.claimA2aOriginal(race.binding,'synthetic-race-b',at)]);assert.equal(results.filter(Boolean).length,1);const winner=results.find(Boolean)!;assert.deepEqual(await core.claimNextA2aOrder(winner.workerId!,at,race.binding),winner);assert.equal(await native.claimA2aOriginal(race.binding,'synthetic-race-c',at),null);vectors++;
  assert(input.options.endpoint.kind==='loopback');proxy=await startCommitAckLossProxy(input.options.endpoint.port);loss=createPostgresDomainChannel({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest);const lost=fixtures.at(-1)!,lossy=composePostgresA2aOriginals(loss,false);proxy.arm();
  await assert.rejects(lossy.claimA2aOriginal(lost.binding,'synthetic-ack-worker',at),error=>error instanceof PostgresDomainWriteOutcomeUnknown);assert(proxy.observation().dropped);assert.equal(await native.claimA2aOriginal(lost.binding,'synthetic-ack-worker',at),null);assert(await core.claimNextA2aOrder('synthetic-ack-worker',at,lost.binding));vectors++;
  const reader=createPostgresDomainChannel({...input.options,role:'keryx_reader'},input.identity,input.digest);try{const port=composePostgresA2aOriginals(reader,true);assert.equal(await port.hasA2aOriginalSettlement(fixtures[0].binding),true);await assert.rejects(port.claimA2aOriginal(fixtures[0].binding,'synthetic-reader',at));await assert.rejects(reader.call('a2aOriginalClaim',[canonicalJson(fixtures[0].binding),'synthetic-reader',at]));vectors++;}finally{await reader.close();}
  for(const limit of [0,501,1.5,NaN]){await assert.rejects(native.listUnfinishedA2aOrders(limit));vectors++;}
  const boundedReadError=async(pattern:RegExp)=>{await input.contentionClient.query('BEGIN READ ONLY');try{await assert.rejects(input.contentionClient.query('SELECT public.storage_a2a_original_unfinished($1::jsonb,$2::text,500)',[canonicalJson(input.identity),input.digest]),pattern);}finally{await input.contentionClient.query('ROLLBACK');}await assert.rejects(native.listUnfinishedA2aOrders(500));vectors++;};
  try{
   pg(`UPDATE public.a2a_orders SET response_data=jsonb_build_object('synthetic',repeat('x',4000001)) WHERE id=${q(ids[0])};`);await boundedReadError(/native original row bound/);
  }finally{pg(`UPDATE public.a2a_orders SET response_data=NULL WHERE id=${q(ids[0])};`);}
  try{
   pg(`UPDATE public.a2a_orders SET response_data=jsonb_build_object('synthetic',repeat('x',2100000)) WHERE id IN(${q(ids[0])},${q(ids[1])});`);await boundedReadError(/native unfinished response bound/);
  }finally{pg(`UPDATE public.a2a_orders SET response_data=NULL WHERE id IN(${q(ids[0])},${q(ids[1])});`);}
  let checkpointVectors=0;
  const checkpoint=(label:string)=>fixtures[cases.findIndex(c=>c.label===label)].order.id;
  const stamp=(second:number)=>`2026-11-14T00:00:${String(second).padStart(2,'0')}.000Z`;
  const state=async(id:string)=>{if(input.rawResponses){assert.deepEqual(await native.getA2aOrder(id),await core.getA2aOrder(id));return;}const rows=await native.listUnfinishedA2aOrders(500);assert.deepEqual(rows.orders.find(o=>o.id===id)??null,await core.getA2aOrder(id));};
  const pay=async(id:string,at:string)=>{const expected=await core.markA2aOrderPaymentStarted(id,at);assert.equal(await native.markA2aOrderPaymentStarted(id,at),expected);checkpointVectors++;return expected;};
  const save=async(id:string,at:string)=>{const expected=await core.markA2aOrderResultSaving(id,at);assert.equal(await native.markA2aOrderResultSaving(id,at),expected);checkpointVectors++;return expected;};
  const fail=async(id:string,code:string,at:string)=>{const expected=await core.failA2aOrder(id,code,at);assert.equal(await native.failA2aOrder(id,code,at),expected);checkpointVectors++;return expected;};
  const active=checkpoint('valid');assert(await pay(active,stamp(1)));assert(await pay(active,stamp(2)));assert(await save(active,stamp(3)));assert(await save(active,stamp(4)));await state(active);
  const preserved=await core.getA2aOrder(active);assert.equal(preserved?.paymentStartedAt,stamp(1));assert.equal(preserved?.resultSavingAt,stamp(3));assert.equal(preserved?.updatedAt,stamp(4));
  assert(await fail(active,'research_failed',stamp(5)));assert.equal(await fail(active,'changed-error',stamp(6)),false);assert.equal(await pay(active,stamp(7)),false);assert.equal(await save(active,stamp(8)),false);await state(active);
  for(const label of ['existing worker','historical version','completed original','failed original']){assert.equal(await pay(checkpoint(label),stamp(10)),false);assert.equal(await save(checkpoint(label),stamp(10)),false);}
  const unstarted=checkpoint('existing worker');assert(await fail(unstarted,'invalid_order_data',stamp(11)));await state(unstarted);
  const absent='a2a_'+'ff'.repeat(32);assert.equal(await pay(absent,stamp(12)),false);assert.equal(await save(absent,stamp(12)),false);assert.equal(await fail(absent,'missing',stamp(12)),false);
  const locked=fixtures[cases.findIndex(c=>c.label==='binary micro round trip')];assert(locked);
  await input.contentionClient.query('BEGIN');try{await input.contentionClient.query('SELECT pg_advisory_xact_lock(634781904177022::bigint)');await assert.rejects(native.markA2aOrderPaymentStarted(locked.order.id,stamp(20)),e=>e instanceof PostgresDomainWriteOutcomeUnknown);checkpointVectors++;}finally{await input.contentionClient.query('ROLLBACK');}await state(locked.order.id);
  await loss?.close();await proxy?.close();loss=undefined;proxy=undefined;
  proxy=await startCommitAckLossProxy(input.options.endpoint.port);loss=createPostgresDomainChannel({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest);const lossyCheckpoint=composePostgresA2aOriginals(loss,false),ack=checkpoint('deep package absent model');proxy.arm();
  await assert.rejects(lossyCheckpoint.markA2aOrderResultSaving(ack,stamp(21)),e=>e instanceof PostgresDomainWriteOutcomeUnknown);assert(proxy.observation().dropped);assert(await core.markA2aOrderResultSaving(ack,stamp(21)));await state(ack);checkpointVectors++;
  const checkpointReader=createPostgresDomainChannel({...input.options,role:'keryx_reader'},input.identity,input.digest);try{const port=composePostgresA2aOriginals(checkpointReader,true);await assert.rejects(port.markA2aOrderPaymentStarted(locked.order.id,stamp(22)));await assert.rejects(port.markA2aOrderResultSaving(locked.order.id,stamp(22)));await assert.rejects(port.failA2aOrder(locked.order.id,'readonly',stamp(22)));await assert.rejects(checkpointReader.call('a2aFail',[locked.order.id,'readonly',stamp(22)]));checkpointVectors++;}finally{await checkpointReader.close();}
  await assert.rejects(input.contentionClient.query("SELECT public.storage_a2a_original_execution($1::jsonb,$2::text,'unreviewed',$3::text,NULL,$4::text)",[canonicalJson(input.identity),input.digest,locked.order.id,stamp(23)]),/native original execution refused/);checkpointVectors++;
  let completionVectors=0;
  if(input.rawResponses){
   const complete=async(id:string,response:Record<string,unknown>,at:string)=>{const expected=await core.completeA2aOrder(id,response,at);assert.equal(await native.completeA2aOrder(id,response,at),expected);assert.deepEqual(await native.getA2aOrder(id),await core.getA2aOrder(id));completionVectors++;return expected;};
   for(const label of cases.filter(c=>c.label.startsWith('raw ')).map(c=>c.label)){
    const id=checkpoint(label);assert.deepEqual(await native.getA2aOrder(id),await core.getA2aOrder(id));completionVectors++;
    const response={status:'completed',queryId:id,answer:'paid answer\0 unpaired\ud800 literal\\u0000',serviceReceipt:{unrecognized:true}};
    assert(await complete(id,response,stamp(30)));assert.equal(await complete(id,{answer:'do not replace'},stamp(31)),false);
    const p=sqliteAcceptanceProjection(source!.db,id),actual=input.ownerSql(`SELECT source_order_wire FROM keryx_storage.acceptance_original_projection WHERE order_id=${q(id)};`);
    // New native originals use the same explicit column order and raw JSON cell
    // representation as Source. Existing accepted originals retain intake bytes.
    assert.equal(actual,p.orderWire);completionVectors++;
   }
   for(const id of [active,checkpoint('completed original'),absent])assert.equal(await complete(id,{answer:'unchanged'},stamp(32)),false);
   const rollbackId=locked.order.id,before=await channel.call('a2aOriginalSnapshot',[rollbackId]) as {orderWire:string;storeId:string},beforeRow=JSON.parse(before.orderWire),responseWire=JSON.stringify({answer:'rollback\0'}),projection=acceptanceOriginalMetadata({...beforeRow,status:'completed',response_data:responseWire,error_code:null,updated_at:stamp(33)},before.storeId);
   await assert.rejects(channel.call('a2aComplete',[rollbackId,JSON.stringify({beforeWire:before.orderWire,responseWire,projection:{...projection,orderSha256:'00'.repeat(32)}}),stamp(33)]),e=>e instanceof PostgresDomainWriteOutcomeUnknown);
   assert.deepEqual(await native.getA2aOrder(rollbackId),await core.getA2aOrder(rollbackId));completionVectors++;
   await input.contentionClient.query('BEGIN');try{await input.contentionClient.query('SELECT pg_advisory_xact_lock(634781904177022::bigint)');await assert.rejects(native.completeA2aOrder(rollbackId,{answer:'blocked'},stamp(34)));completionVectors++;}finally{await input.contentionClient.query('ROLLBACK');}
   assert.deepEqual(await native.getA2aOrder(rollbackId),await core.getA2aOrder(rollbackId));
   const raceId=checkpoint('Unicode hash preimage'),raced=await Promise.all([native.completeA2aOrder(raceId,{answer:'first'},stamp(35)),native.completeA2aOrder(raceId,{answer:'second'},stamp(35))]);assert.equal(raced.filter(Boolean).length,1);const raceResult=await native.getA2aOrder(raceId);assert(raceResult?.response);assert(await core.completeA2aOrder(raceId,raceResult.response,stamp(35)));completionVectors++;
   await loss?.close();await proxy?.close();loss=undefined;proxy=undefined;
   proxy=await startCommitAckLossProxy(input.options.endpoint.port);loss=createPostgresDomainChannel({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest);const lossPort=composePostgresA2aOriginals(loss,false),lossId=ack;
   // Prime the read before dropping the write's implicit-commit acknowledgement.
   const directLoss={get closed(){return loss!.closed;},close:()=>loss!.close(),call:async(operation:Parameters<typeof channel.call>[0],args:readonly(string|null)[])=>{if(operation==='a2aComplete')proxy!.arm();return loss!.call(operation,args);}};const lostComplete=composePostgresA2aOriginals(directLoss,false);
   await assert.rejects(lostComplete.completeA2aOrder(lossId,{answer:'retained\0 after lost ACK'},stamp(36)),e=>e instanceof PostgresDomainWriteOutcomeUnknown);assert(proxy.observation().dropped);assert(await core.completeA2aOrder(lossId,{answer:'retained\0 after lost ACK'},stamp(36)));assert.deepEqual(await native.getA2aOrder(lossId),await core.getA2aOrder(lossId));assert.equal(await native.completeA2aOrder(lossId,{answer:'never retry'},stamp(37)),false);completionVectors++;
   const reader=createPostgresDomainChannel({...input.options,role:'keryx_reader'},input.identity,input.digest);try{const port=composePostgresA2aOriginals(reader,true);assert.deepEqual(await port.getA2aOrder(lossId),await core.getA2aOrder(lossId));await assert.rejects(port.completeA2aOrder(rollbackId,{answer:'reader'},stamp(38)));await assert.rejects(reader.call('a2aComplete',[rollbackId,'{}',stamp(38)]));completionVectors++;}finally{await reader.close();}
   assert.deepEqual(await composePostgresHealth(channel).currentA2aOperationsSnapshot(Date.parse(stamp(40))),await core.a2aOperationsSnapshot(Date.parse(stamp(40))));completionVectors++;
   const staleWire=before.orderWire;assert(await complete(rollbackId,{answer:'actual final'},stamp(39)));assert.equal(await channel.call('a2aComplete',[rollbackId,JSON.stringify({beforeWire:staleWire,responseWire,projection}),stamp(39)]),false);
   assert.equal((await native.getA2aOrder(rollbackId))?.response?.answer,'actual final');completionVectors++;
  }
  let recoveryVectors=0;
  if(input.recovery){
   const update=(spec:typeof recoveries[number],id:string):A2aOrderResolutionUpdate=>{
    const resolution={action:spec.status==='completed'?'repair_completed' as const:'close_failed' as const,actor:'automatic-poll' as const,reason:spec.status==='completed'?'saved_real_query_run' as const:'no_saved_run_before_execution_boundaries' as const,evidence:{executionJournalVersion:1 as const,paymentBoundaryCrossed:false,resultSaveBoundaryCrossed:false,creatorAttempts:0,settledCreatorMicros:0,pendingCreatorMicros:0,failedCreatorMicros:0,simulatedCreatorMicros:0,queryRunFound:spec.status==='completed'},resolvedAt:stamp(45)};
    const value:A2aOrderResolutionUpdate=spec.status==='completed'?{status:'completed',response:{status:'completed',queryId:id,answer:'Recovered original\0\ud800'},resolution}:{status:'failed',errorCode:'operator_reviewed_no_result',startedBefore:at,resolution};spec.edit?.(value);return value;
   };
   for(const spec of recoveries){
    const id=checkpoint(spec.label),value=update(spec,id);
    if(spec.label==='repair lost ack'){
     await loss?.close();await proxy?.close();loss=undefined;proxy=undefined;proxy=await startCommitAckLossProxy(input.options.endpoint.port);loss=createPostgresDomainChannel({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest);
     const lossy=composePostgresA2aOriginals({get closed(){return loss!.closed;},close:()=>loss!.close(),call:(operation,args)=>{if(operation==='a2aResolveCompleted')proxy!.arm();return loss!.call(operation,args);}},false);
     await assert.rejects(lossy.resolveA2aOrder(id,value),e=>e instanceof PostgresDomainWriteOutcomeUnknown);assert(proxy.observation().dropped);assert(await core.resolveA2aOrder(id,value));assert.deepEqual(await native.getA2aOrder(id),await core.getA2aOrder(id));assert.equal(await native.resolveA2aOrder(id,value),false);recoveryVectors++;continue;
    }
    if(spec.label==='repair atomic rollback'){
     const before=await channel.call('a2aOriginalSnapshot',[id]) as {orderWire:string;storeId:string};assert(value.status==='completed');const responseWire=JSON.stringify(value.response),resolutionWire=JSON.stringify(value.resolution),projection=acceptanceOriginalMetadata({...JSON.parse(before.orderWire),status:'completed',response_data:responseWire,error_code:null,resolution_data:resolutionWire,updated_at:value.resolution.resolvedAt},before.storeId);
     await assert.rejects(channel.call('a2aResolveCompleted',[id,JSON.stringify({beforeWire:before.orderWire,responseWire,resolutionWire,projection:{...projection,orderSha256:'00'.repeat(32)}}),value.resolution.resolvedAt]),e=>e instanceof PostgresDomainWriteOutcomeUnknown);assert.deepEqual(await native.getA2aOrder(id),await core.getA2aOrder(id));recoveryVectors++;
    }
    const expected=await core.resolveA2aOrder(id,value);assert.equal(expected,spec.expected,spec.label);assert.equal(await native.resolveA2aOrder(id,value),expected,spec.label);assert.deepEqual(await native.getA2aOrder(id),await core.getA2aOrder(id),spec.label);recoveryVectors++;
   }
   assert.deepEqual(await composePostgresHealth(channel).currentA2aOperationsSnapshot(Date.parse(stamp(50))),await core.a2aOperationsSnapshot(Date.parse(stamp(50))));recoveryVectors++;
  }
  vectors+=recoveryVectors;
  vectors+=completionVectors;
  vectors+=checkpointVectors;
  input.ownerSql("UPDATE keryx_storage.control SET mode='held';");try{await assert.rejects(native.hasA2aOriginalSettlement(fixtures[0].binding));await assert.rejects(native.listUnfinishedA2aOrders(1));await assert.rejects(native.markA2aOrderPaymentStarted(locked.order.id,stamp(24)));await assert.rejects(native.markA2aOrderResultSaving(locked.order.id,stamp(24)));await assert.rejects(native.failA2aOrder(locked.order.id,'held',stamp(24)));if(input.rawResponses)await assert.rejects(native.completeA2aOrder(locked.order.id,{answer:'held'},stamp(24)));checkpointVectors++;vectors+=2;}finally{input.ownerSql("UPDATE keryx_storage.control SET mode='active';");}await state(locked.order.id);
  assert.equal(proofDigest(),financial);assert.equal(input.ownerSql('SELECT count(*) FROM keryx_storage.writer;'),'0');await channel.close();await assert.rejects(native.hasA2aOriginalSettlement(fixtures[0].binding));vectors++;
  return {vectors,...(input.recovery?{recovery:{vectors:recoveryVectors,currentCreatorEvidence:true,offlineRunRefused:true,boundaryAndJournalCas:true,overspendRefused:true,sourceHalfMicroRounding:true,actualLostCommitAck:true,atomicProjectionRollback:true}}:{}),...(input.rawResponses?{completion:{vectors:completionVectors,rawJsonPreserved:true,originalProjectionAtomic:true,actualRollback:true,oneConcurrentWinner:true,actualLostCommitAck:true,healthMatchesSource:true}}:{}),executionCheckpoints:{vectors:checkpointVectors,firstTimestampPreserved:true,failedOrFinishedNotReopened:true,unstartedFailureMatchesSource:true,actualLostCommitAck:true,actualWriterContention:true,readerMutationRefused:true,heldMutationRefused:true,unreviewedOpcodeRefused:true},cases:cases.map(c=>c.label),genuineSelectedSqliteConnectionAndActualCore:true,sourceOriginalTriggerRestoredBeforeReads:true,exactOriginalTupleAndRequestHash:true,exactMicroRoundTrip:true,missingPurchaseAndMonthlyRedemptionRefused:true,savedOriginalAndCreatorAttemptNotReexecuted:true,oldestQueueWithTruncation:true,individualAndCompleteResponseBoundsBeforeAggregation:true,oneConcurrentClaimWinner:true,actualLostCommitAck:true,actualWriterContention:true,noAutomaticWriteRetry:true,readerMutationRefused:true,financialProofsUnchanged:true,fullWriterQualified:false,productionData:false,paymentActions:0,jobExecutions:0};
 }finally{
  try{await loss?.close();await proxy?.close();await channel.close();source?.close();if(ids.length){const selected=ids.map(q).join(',');pg(`DELETE FROM public.research_monthly_redemptions WHERE order_id IN(${selected});`+(monthlyId?`DELETE FROM public.research_monthly WHERE id=${q(monthlyId)};DELETE FROM public.research_purchase_authorizations WHERE purchase_id=${q(monthlyId)};`:'')+`DELETE FROM public.payment_events WHERE query_id IN(${selected});DELETE FROM public.research_purchase_authorizations WHERE purchase_id IN(${selected});DELETE FROM public.a2a_orders WHERE id IN(${selected});DELETE FROM public.query_runs WHERE id IN(${selected});`+(input.rawResponses?'DELETE FROM public.deliverable_acceptance_store;':''));}}
  finally{for(const path of [file,file+'-wal',file+'-shm',file+'-journal',manifestPath])if(existsSync(path))unlinkSync(path);rmdirSync(folder);}
 }
}
