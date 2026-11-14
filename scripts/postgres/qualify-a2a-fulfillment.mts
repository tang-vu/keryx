/** Actual verified SQLite Source versus fixed raw-native metadata protocol.
 * All retained originals/financial facts are disposable synthetic fixtures.
 * This never mints installed writer provenance, runs a job or calls a supplier. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,writeFileSync,readFileSync,existsSync,unlinkSync,rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { ARC_MAINNET_PROFILE } from '../../lib/arc-network-profile';
import { canonicalJson } from '../../lib/canonical-json';
import { syntheticFailedOriginal,syntheticFulfilledRun } from '../../lib/db/a2a-fulfillment-fixture';
import { fulfillmentObjectSha256,failedOriginalEvidenceSha256,type A2aFulfillmentClaim,type FulfillmentAuthority,type FulfillmentClaimInput } from '../../lib/a2a/failed-original-fulfillment-protocol';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { insertStorageIdentity,installStorageFences,registerStorageCapability } from '../../lib/db/storage-identity-sqlite';
import { openVerifiedSqliteStorage,assertVerifiedSqliteConnection } from '../../lib/db/storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../../lib/db/enrolled-sqlite-schema-profile';
import { SqliteAdapter } from '../../lib/db/sqlite-adapter';
import { monthlyOrderToRow } from '../../lib/db/research-monthly';
import { validateStorageIdentity,type StorageIdentity } from '../../lib/db/storage-identity';
import { postgresPoolConfiguration,type PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import { createPostgresDomainChannel,PostgresDomainWriteOutcomeUnknown } from '../../lib/db/postgres/domain-channel';
import { composePostgresA2aFulfillment } from '../../lib/db/postgres/a2a-fulfillment-transport';
import { composePostgresA2aOriginals } from '../../lib/db/postgres/a2a-originals-transport';
import { captureNativeA2aCreate } from '../../lib/db/postgres/a2a-create-packet';
import { acceptanceOriginalMetadata } from '../../lib/db/postgres/acceptance-metadata';
import { captureNativeFulfillmentClaim,captureNativeFulfillmentCompletion,nativeFulfillmentClaimPacket,nativeFulfillmentCompletionPacket,readNativeFulfillmentSnapshot } from '../../lib/db/postgres/a2a-fulfillment-packet';
import { sqliteA2aTimeProjection,heldA2aTimeProjectionSql,sqliteA2aOriginalCellProjection,heldA2aOriginalCellProjectionSql } from './a2a-time-projection.mts';
import { sqliteAcceptanceProjection,heldAcceptanceProjectionSql } from './acceptance-projection.mts';
import { startCommitAckLossProxy } from './commit-ack-loss.mts';

export async function qualifyA2aFulfillment(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;contentionClient:Client;ownerSql:(sql:string)=>string}){
 input={...input,identity:validateStorageIdentity(input.identity)};
 const folder=mkdtempSync(join(tmpdir(),'keryx-native-fulfillment-')),file=join(folder,'source.sqlite'),manifestPath=join(folder,'storage.json');
 const manifest=canonicalJson({format:'keryx-storage-deployment-v1',identity:input.identity,backend:{kind:'sqlite',databasePath:file}});
 const q=(value:string)=>"'"+value.replaceAll("'","''")+"'",pg=(sql:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+sql+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 const labels=['valid','missing inbound','creator attempt','wrong failure','offset clocks','submillisecond clocks','rollback','race','lost ack','historical v1','revoked payment','changed original','existing run','contention','wallet private','orphan policy','scalar trace','missing source cells'] as const;
 const fixtures=labels.map((label,index)=>{
  const f=syntheticFailedOriginal(4300+index,ARC_MAINNET_PROFILE),now=Date.now();
  if(label==='valid')Object.assign(f.order.request!,{retainedSourceExtension:'x'.repeat(200000)});
  if(label==='offset clocks'){f.order.createdAt='2026-10-06T10:23:02.000+07:00';f.order.startedAt='2026-10-06T10:24:02.000+07:00';f.order.updatedAt='2026-10-06T10:24:03.000+07:00';}
  if(label==='submillisecond clocks'){f.order.startedAt='2026-10-06T03:24:02.000000001Z';f.order.updatedAt='2026-10-06T03:24:03.000000001Z';}
  f.authority.originalEvidenceSha256=failedOriginalEvidenceSha256(f.order);
  const authority:FulfillmentAuthority=label==='historical v1'?f.authority:{...f.authority,format:'keryx-a2a-failed-original-fulfillment-authority-v2',expiresAt:new Date(now+3600000).toISOString(),supplierWindow:{approvalReceivedAt:new Date(now-10000).toISOString(),expiresAt:new Date(now+3600000).toISOString(),maximumDurationMs:5400000}};
  const capturedInput:FulfillmentClaimInput={...f.input,authority};return {...f,authority,input:capturedInput};
 });
 const ids=fixtures.map(f=>f.order.id),channel=createPostgresDomainChannel(input.options,input.identity,input.digest),native=composePostgresA2aFulfillment(channel,false),originals=composePostgresA2aOriginals(channel,false);
 let source:ReturnType<typeof openVerifiedSqliteStorage>|undefined,core:SqliteAdapter|undefined,proxy:Awaited<ReturnType<typeof startCommitAckLossProxy>>|undefined,loss:ReturnType<typeof createPostgresDomainChannel>|undefined,seeded=false,vectors=0,store='';
 const copy=(table:string,row:Record<string,unknown>)=>{
  assert(['a2a_orders','payment_events','research_purchase_authorizations','a2a_failed_original_fulfillments','run_privacy'].includes(table));const keys=Object.keys(row);assert(keys.every(key=>/^[a-z][a-z0-9_]*$/.test(key)));
  return `INSERT INTO public.${table}(${keys.join(',')}) VALUES(${keys.map(key=>{const value=row[key];if(value===null)return 'NULL';if(key==='settled')return value===1?'true':'false';if(typeof value==='number'||typeof value==='bigint')return String(value);assert(typeof value==='string');return q(value)+(table==='a2a_orders'&&['package_data','request_data','response_data','resolution_data'].includes(key)?'::json':'');}).join(',')});`;
 };
 const sourceOwner=(work:(db:DatabaseSync)=>void)=>{const db=new DatabaseSync(file);try{registerStorageCapability(db,input.identity,()=>true);db.exec('BEGIN IMMEDIATE');work(db);db.exec('COMMIT');}finally{db.close();}};
 const fixture=(label:typeof labels[number])=>fixtures[labels.indexOf(label)];
 const fresh=(f:ReturnType<typeof fixture>)=>{f.input.claimedAt=new Date(Date.now()-1000).toISOString();return f.input;};
 const prepared=(claim:A2aFulfillmentClaim,asker?:string)=>{const result=syntheticFulfilledRun(claim);result.run.createdAt=new Date(Date.parse(claim.claimedAt)+1).toISOString();result.completedAt=new Date(Date.parse(claim.claimedAt)+2).toISOString();if(asker)result.run.asker=asker;result.runSha256=fulfillmentObjectSha256(result.run);return result;};
 const compare=async(id:string)=>{
  assert.deepEqual(await native.getA2aFailedOriginalFulfillment(id),await core!.getA2aFailedOriginalFulfillment(id));assert.deepEqual(await originals.getA2aOrder(id),await core!.getA2aOrder(id));
  const privacy=source!.db.prepare('SELECT * FROM run_privacy WHERE run_id=?').get(id)??null;
  assert.deepEqual(JSON.parse(input.ownerSql(`SELECT coalesce((SELECT to_jsonb(p)::text FROM public.run_privacy p WHERE run_id=${q(id)}),'null');`)),privacy===null?null:JSON.parse(JSON.stringify(privacy)));
  const sourceOrder=source!.db.prepare('SELECT * FROM a2a_orders WHERE id=?').get(id)!;
  const cells=JSON.parse(input.ownerSql(`SELECT row_to_json(c)::text FROM keryx_storage.a2a_original_cell_projection c WHERE order_id=${q(id)};`));
  assert.equal(cells.package_data_wire,sourceOrder.package_data);assert.equal(cells.request_data_wire,sourceOrder.request_data);
  if(sourceOrder.status==='completed'){
   const p=sqliteAcceptanceProjection(source!.db,id),actual=JSON.parse(input.ownerSql(`SELECT row_to_json(p)::text FROM keryx_storage.acceptance_original_projection p WHERE order_id=${q(id)};`));
   const hash=(wire:string)=>fulfillmentObjectSha256({wire});
   assert.equal(hash(actual.source_order_wire),hash(p.orderWire),'Completed raw Source row differs');assert.equal(actual.source_order_sha256,p.orderSha256);
   assert.equal(hash(actual.delivery_token),hash(p.deliveryToken),'Completed raw Source delivery token differs');
   assert.deepEqual(actual.binding,p.binding);assert.deepEqual(actual.health_meta,p.health);
  }
 };
 const claim=async(label:typeof labels[number])=>{const f=fixture(label);fresh(f);const expected=await core!.claimA2aFailedOriginalFulfillment(f.input),actual=await native.claimA2aFailedOriginalFulfillment(f.input);assert.deepEqual(actual,expected);await compare(f.order.id);vectors++;return actual;};
 const financial=()=>input.ownerSql("SELECT encode(sha256(convert_to(jsonb_build_array((SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.payment_events p),(SELECT jsonb_agg(to_jsonb(p) ORDER BY purchase_id) FROM public.research_purchase_authorizations p))::text,'UTF8')),'hex');");
 try{
  assert.equal(input.ownerSql('SELECT count(*) FROM public.a2a_orders;'),'0');assert.equal(input.ownerSql('SELECT count(*) FROM public.deliverable_acceptance_store;'),'0');
  const db=new DatabaseSync(file);try{
   db.exec('BEGIN IMMEDIATE');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);store=String(db.prepare('SELECT id FROM deliverable_acceptance_store').get()!.id);
   for(let index=0;index<fixtures.length;index++){
    const {order:o,binding:b}=fixtures[index],label=labels[index],row=monthlyOrderToRow(o);for(const key of ['package_data','request_data','response_data','resolution_data'])if(row[key]!==null)row[key]=JSON.stringify(row[key]);
    for(const key of ['package_data','request_data'])row[key]=JSON.stringify(JSON.parse(String(row[key])),null,2);
    db.prepare("INSERT INTO research_purchase_authorizations(network,asset,payer,payee,authorization_id,product,purchase_id,request_hash,amount_micros) VALUES(?,?,?,?,?,'a2a',?,?,?)").run(b.network,b.asset,b.payer,b.payee,b.authorizationId,b.id,b.requestHash,Number(b.amountMicroUsdc));
    const keys=Object.keys(row);db.prepare(`INSERT INTO a2a_orders(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(key=>row[key]) as (string|number|null)[]);
    if(label!=='missing inbound')db.prepare("INSERT INTO payment_events(id,query_id,kind,source_id,payer,payee,amount_usdc,network,tx_hash,settled,settlement_status,authorization_id,created_at) VALUES(?,?,'inbound','a2a',?,?,?,?,?,1,'settled',?,?)").run('inbound_'+o.id,o.id,o.payer,o.payee,o.amountUsdc,b.network,o.transaction,o.authorizationId,o.createdAt);
    if(label==='creator attempt')db.prepare("INSERT INTO payment_events(id,query_id,kind,source_id,payer,payee,amount_usdc,network,created_at,settled,settlement_status) VALUES(?,?,'fetch','synthetic',?,?,0.001,?,?,0,'pending')").run('creator_'+o.id,o.id,o.payer,o.payee,b.network,o.createdAt);
    if(label==='wrong failure')db.prepare("UPDATE a2a_orders SET error_code='different_failure' WHERE id=?").run(o.id);
    if(label==='historical v1')db.prepare('INSERT INTO a2a_failed_original_fulfillments VALUES(?,?,?,?,?)').run(o.id,fixtures[index].input.claimId,canonicalJson(fixtures[index].authority),canonicalJson(o),fixtures[index].input.claimedAt);
    if(label==='orphan policy')db.prepare("INSERT INTO run_privacy(run_id,visibility,revision,updated_at) VALUES(?,'private',7,?)").run(o.id,o.createdAt);
   }
   let sql=`INSERT INTO public.deliverable_acceptance_store(singleton,id) VALUES(1,${q(store)});`;
   for(const table of ['research_purchase_authorizations','a2a_orders','payment_events','a2a_failed_original_fulfillments','run_privacy'])for(const row of db.prepare('SELECT * FROM '+table).all())sql+=copy(table,row);
   for(const id of ids){sql+=heldA2aTimeProjectionSql(sqliteA2aTimeProjection(db,id,input.identity));sql+=heldA2aOriginalCellProjectionSql(sqliteA2aOriginalCellProjection(db,id,input.identity));sql+=heldAcceptanceProjectionSql(sqliteAcceptanceProjection(db,id));}
   insertStorageIdentity(db,input.identity);installStorageFences(db,input.identity);db.exec('COMMIT');pg(sql);seeded=true;
  }finally{db.close();}
  writeFileSync(manifestPath,manifest,{mode:0o600});source=openVerifiedSqliteStorage(file,input.identity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>assert.equal(readFileSync(manifestPath,'utf8'),manifest)});
  core=SqliteAdapter.assembleConnectionCore(source.db,input.identity,()=>assert.deepEqual(assertVerifiedSqliteConnection(source!.db),input.identity));
  const before=financial();
  for(const label of ['missing inbound','creator attempt','wrong failure','offset clocks','submillisecond clocks'] as const)assert.equal(await claim(label),null);
  const valid=await claim('valid');assert(valid);const result=prepared(valid);
  assert.equal(await native.claimA2aFailedOriginalFulfillment(fresh(fixture('valid'))),null);assert.equal(await core.claimA2aFailedOriginalFulfillment(fixture('valid').input),null);vectors++;
  assert.equal(await native.completeA2aFailedOriginalFulfillment(result),await core.completeA2aFailedOriginalFulfillment(result));await compare(result.originalId);
  assert.equal(await native.hasA2aFailedOriginalFulfillment(valid.authority),await core.hasA2aFailedOriginalFulfillment(valid.authority));assert.equal(await native.hasA2aFailedOriginalFulfillment(valid.authority),true);
  assert.equal(await native.completeA2aFailedOriginalFulfillment(result),await core.completeA2aFailedOriginalFulfillment(result));await compare(result.originalId);vectors+=3;
  const scalar=await claim('scalar trace');assert(scalar);const scalarResult=prepared(scalar);
  scalarResult.run.trace.push({type:'synthetic-only',detail:'NUL\0 separate-high\ud800 separate-low\udfff'} as never);scalarResult.runSha256=fulfillmentObjectSha256(scalarResult.run);
  // A discarded full-row derivative cannot erase immutable Source TEXT cells.
  pg(`DELETE FROM keryx_storage.acceptance_original_projection WHERE order_id=${q(scalarResult.originalId)};`);
  assert.equal(await native.completeA2aFailedOriginalFulfillment(scalarResult),await core.completeA2aFailedOriginalFulfillment(scalarResult));assert.equal(await native.hasA2aFailedOriginalFulfillment(scalar.authority),true);await compare(scalarResult.originalId);vectors+=2;
  const missing=await claim('missing source cells');assert(missing);
  pg(`DELETE FROM keryx_storage.a2a_original_cell_projection WHERE order_id=${q(missing.authority.original.id)};`);
  await assert.rejects(native.completeA2aFailedOriginalFulfillment(prepared(missing)));
  const old=fixture('missing source cells').order,replay=captureNativeA2aCreate({...old,status:'running',startedAt:null,workerId:null,executionJournalVersion:1,paymentStartedAt:null,resultSavingAt:null,response:null,errorCode:null,resolution:null,updatedAt:old.createdAt});
  await assert.rejects(channel.call('a2aCreate',[old.id,JSON.stringify({binding:replay.binding,rowWire:replay.rowWire,projection:acceptanceOriginalMetadata(replay.row,store)}),old.createdAt]),error=>error instanceof PostgresDomainWriteOutcomeUnknown);
  assert.equal(input.ownerSql(`SELECT count(*) FROM keryx_storage.a2a_original_cell_projection WHERE order_id=${q(old.id)};`),'0');vectors+=2;
  const changed={...result,providerLedgerSha256:'be'.repeat(32)};await assert.rejects(native.completeA2aFailedOriginalFulfillment(changed));await assert.rejects(core.completeA2aFailedOriginalFulfillment(changed));await compare(result.originalId);vectors++;
  const historical=fixture('historical v1'),saved=await native.getA2aFailedOriginalFulfillment(historical.order.id);assert(saved);assert.deepEqual(saved,await core.getA2aFailedOriginalFulfillment(historical.order.id));
  const historicalResult=syntheticFulfilledRun(saved.claim);assert.equal(await native.completeA2aFailedOriginalFulfillment(historicalResult),await core.completeA2aFailedOriginalFulfillment(historicalResult));assert.equal(await native.hasA2aFailedOriginalFulfillment(historical.authority),true);await compare(historical.order.id);vectors++;
  const rollback=await claim('rollback');assert(rollback);const rollbackResult=prepared(rollback),state=readNativeFulfillmentSnapshot(await channel.call('a2aFulfillmentSnapshot',[rollback.authority.original.id]));
  const bad=JSON.parse(nativeFulfillmentCompletionPacket(captureNativeFulfillmentCompletion(rollbackResult),state));bad.projection.orderSha256='00'.repeat(32);
  await assert.rejects(channel.call('a2aFulfillmentComplete',[rollbackResult.originalId,JSON.stringify(bad)]),error=>error instanceof PostgresDomainWriteOutcomeUnknown);
  assert.equal(input.ownerSql(`SELECT count(*) FROM public.query_runs WHERE id=${q(rollbackResult.originalId)};`),'0');await compare(rollbackResult.originalId);vectors++;
  const race=fixture('race');fresh(race);const raced=await Promise.all([native.claimA2aFailedOriginalFulfillment(race.input),native.claimA2aFailedOriginalFulfillment(race.input)]);assert.equal(raced.filter(Boolean).length,1);assert.deepEqual(raced.find(Boolean),await core.claimA2aFailedOriginalFulfillment(race.input));await compare(race.order.id);vectors++;
  const lost=await claim('lost ack');assert(lost);const lostResult=prepared(lost),lostState=readNativeFulfillmentSnapshot(await channel.call('a2aFulfillmentSnapshot',[lostResult.originalId]));
  const lostPacket=nativeFulfillmentCompletionPacket(captureNativeFulfillmentCompletion(lostResult),lostState);
  assert(input.options.endpoint.kind==='loopback');proxy=await startCommitAckLossProxy(input.options.endpoint.port);loss=createPostgresDomainChannel({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest);proxy.arm();
  await assert.rejects(loss.call('a2aFulfillmentComplete',[lostResult.originalId,lostPacket]),error=>error instanceof PostgresDomainWriteOutcomeUnknown);
  assert.deepEqual(proxy.observation(),{dropped:true,commands:1});assert(await core.completeA2aFailedOriginalFulfillment(lostResult));await compare(lostResult.originalId);assert(await native.hasA2aFailedOriginalFulfillment(lost.authority));vectors++;
  for(const label of ['wallet private','orphan policy'] as const){const retained=await claim(label);assert(retained);const completion=prepared(retained,'0x'+'77'.repeat(20));assert.equal(await native.completeA2aFailedOriginalFulfillment(completion),await core.completeA2aFailedOriginalFulfillment(completion));await compare(completion.originalId);assert.equal(source.db.prepare('SELECT visibility FROM run_privacy WHERE run_id=?').get(completion.originalId)?.visibility,'private');vectors++;}
  assert.equal(financial(),before,'Fulfillment metadata operations changed retained financial facts');
  const revoked=await claim('revoked payment');assert(revoked);sourceOwner(db=>db.prepare('DELETE FROM payment_events WHERE query_id=?').run(revoked.authority.original.id));pg(`DELETE FROM public.payment_events WHERE query_id=${q(revoked.authority.original.id)};`);
  const afterExplicitRevocation=financial();
  assert.equal(await native.completeA2aFailedOriginalFulfillment(prepared(revoked)),await core.completeA2aFailedOriginalFulfillment(prepared(revoked)));await compare(revoked.authority.original.id);vectors++;
  const altered=await claim('changed original');assert(altered);sourceOwner(db=>db.prepare("UPDATE a2a_orders SET worker_id='changed_worker' WHERE id=?").run(altered.authority.original.id));pg(`UPDATE public.a2a_orders SET worker_id='changed_worker' WHERE id=${q(altered.authority.original.id)};`);
  assert.equal(await native.completeA2aFailedOriginalFulfillment(prepared(altered)),await core.completeA2aFailedOriginalFulfillment(prepared(altered)));vectors++;
  const occupied=await claim('existing run');assert(occupied);const occupiedResult=prepared(occupied),occupiedState=readNativeFulfillmentSnapshot(await channel.call('a2aFulfillmentSnapshot',[occupiedResult.originalId]));
  const occupiedPacket=nativeFulfillmentCompletionPacket(captureNativeFulfillmentCompletion(occupiedResult),occupiedState),retained='{"syntheticExistingRun":true}';
  sourceOwner(db=>db.prepare('INSERT INTO query_runs(id,created_at,question,budget,total_spent,total_to_creators,data) VALUES(?,?,?,0,0,0,?)').run(occupiedResult.originalId,occupiedResult.run.createdAt,'Synthetic existing run',retained));
  pg(`INSERT INTO public.query_runs(id,created_at,question,budget,total_spent,total_to_creators,data) VALUES(${q(occupiedResult.originalId)},${q(occupiedResult.run.createdAt)},'Synthetic existing run',0,0,0,${q(retained)}::json);`+copy('run_privacy',source.db.prepare('SELECT * FROM run_privacy WHERE run_id=?').get(occupiedResult.originalId)!));
  assert.equal(await channel.call('a2aFulfillmentComplete',[occupiedResult.originalId,occupiedPacket]),false);assert.equal(await core.completeA2aFailedOriginalFulfillment(occupiedResult),false);
  assert.equal(input.ownerSql(`SELECT data::text FROM public.query_runs WHERE id=${q(occupiedResult.originalId)};`),retained);await compare(occupiedResult.originalId);vectors++;
  const contended=fixture('contention');fresh(contended);const contentionPacket=nativeFulfillmentClaimPacket(captureNativeFulfillmentClaim(contended.input),contended.order);assert(contentionPacket);
  await input.contentionClient.query('BEGIN');try{await input.contentionClient.query('SELECT pg_advisory_xact_lock(634781904177022::bigint)');await assert.rejects(channel.call('a2aFulfillmentClaim',[contended.order.id,contentionPacket]),error=>error instanceof PostgresDomainWriteOutcomeUnknown);}finally{await input.contentionClient.query('ROLLBACK');}
  await compare(contended.order.id);vectors++;
  // Bound dispatch and role authority at the actual SQL boundary too.
  const reader=createPostgresDomainChannel({...input.options,role:'keryx_reader'},input.identity,input.digest);try{await assert.rejects(reader.call('a2aFulfillmentClaim',[race.order.id,nativeFulfillmentClaimPacket(captureNativeFulfillmentClaim(fresh(race)),race.order)!]));}finally{await reader.close();}vectors++;
  const direct=new Client(postgresPoolConfiguration(input.options));try{await direct.connect();await assert.rejects(direct.query('SELECT public.storage_a2a_fulfillment($1::jsonb,$2::text,\'caller-function\',$3::text,NULL)',[canonicalJson(input.identity),input.digest,race.order.id]));
   await assert.rejects(direct.query('DELETE FROM public.a2a_failed_original_fulfillments WHERE original_id=$1',[race.order.id]),error=>!!error&&typeof error==='object'&&Reflect.get(error,'code')==='42501');
   await assert.rejects(direct.query('SELECT * FROM keryx_storage.a2a_original_cell_projection'),error=>!!error&&typeof error==='object'&&Reflect.get(error,'code')==='42501');}finally{await direct.end();}vectors+=3;
  assert.equal(input.ownerSql('SELECT count(*) FROM keryx_storage.writer;'),'0');assert.equal(financial(),afterExplicitRevocation);
  return {vectors,genuineVerifiedSqliteSource:true,rawNativeSqlPacketsSynthetic:true,allFourMethodsCompared:true,completedRawSourceFingerprintAndDeliveryCompared:true,permanentRawPackageAndRequestCellsPreserved:true,missingSourceCellsCannotBeBackfilledByReplay:true,discardedAcceptanceProjectionKeepsSourceCells:true,unrelatedNulAndUnpairedTraceScalarsPreserved:true,permanentClaimNoTakeover:true,exactFailedOriginalAndPaidTuple:true,atomicRunReceiptTimesAndCompletion:true,sourceInsertOnlyPrivacyAndOrphanPolicyPreserved:true,historicalAfterExpiryAllowed:true,offsetAndSubmillisecondFailuresKeepSourcePredicateFalse:true,exactReplayNoOverwrite:true,existingRunNeverOverwritten:true,currentPaymentAndCreatorAttemptChecks:true,financialFactsUnchangedByFulfillment:true,concurrentClaimOneWinner:true,actualDataLockContention:true,lostCommitAcknowledgementObservedWithoutRetry:true,readerAndUnknownOpcodeAndDirectTableWritesRefused:true,opaqueNativeProofMinted:false,installedNativeWriterQualified:false,fullOriginalScalarParityQualified:false,productionData:false,paymentActions:0,jobExecutions:0};
 }finally{
  try{await loss?.close();await proxy?.close();await channel.close();source?.close();if(seeded){const selected=ids.map(q).join(',');pg(`ALTER TABLE public.a2a_fulfillment_completions DISABLE TRIGGER native_a2a_completion_retained;ALTER TABLE public.a2a_failed_original_fulfillments DISABLE TRIGGER native_a2a_fulfillment_retained;DELETE FROM public.a2a_fulfillment_completions WHERE original_id IN(${selected});DELETE FROM public.a2a_failed_original_fulfillments WHERE original_id IN(${selected});ALTER TABLE public.a2a_fulfillment_completions ENABLE TRIGGER native_a2a_completion_retained;ALTER TABLE public.a2a_failed_original_fulfillments ENABLE TRIGGER native_a2a_fulfillment_retained;DELETE FROM public.a2a_orders WHERE id IN(${selected});DELETE FROM public.query_runs WHERE id IN(${selected});ALTER TABLE public.run_privacy DISABLE TRIGGER native_privacy_tombstone;DELETE FROM public.run_privacy WHERE run_id IN(${selected});ALTER TABLE public.run_privacy ENABLE TRIGGER native_privacy_tombstone;DELETE FROM public.payment_events WHERE query_id IN(${selected});DELETE FROM public.research_purchase_authorizations WHERE purchase_id IN(${selected});DELETE FROM public.deliverable_acceptance_store WHERE id=${q(store)};`);}}
  finally{for(const path of [file,file+'-wal',file+'-shm',file+'-journal',manifestPath])if(existsSync(path))unlinkSync(path);rmdirSync(folder);}
 }
}
