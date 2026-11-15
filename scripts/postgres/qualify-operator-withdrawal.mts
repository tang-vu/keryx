/** Genuine selected SQLite facade versus fixed native protocols. Synthetic
 * report/obligation metadata only; no transfer, provider, signature or job IO. */
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,writeFileSync,existsSync,unlinkSync,rmdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import type {Client} from 'pg';
import {canonicalJson} from '../../lib/canonical-json';
import {installMainnetApplicationSchema} from '../../lib/db/mainnet-application-schema';
import {installNativeUserDomainSchema} from '../../lib/db/native-user-domain-schema';
import {insertStorageIdentity,installStorageFences} from '../../lib/db/storage-identity-sqlite';
import {createEnrolledSqliteAdapter,assertEnrolledSqliteAdapter} from '../../lib/db/enrolled-sqlite-adapter';
import type {StorageIdentity} from '../../lib/db/storage-identity';
import type {WithdrawalRecord} from '../../lib/types';
import type {PostgresConnectionOptions} from '../../lib/db/postgres/connection';
import {createPostgresDomainChannel,PostgresDomainWriteOutcomeUnknown} from '../../lib/db/postgres/domain-channel';
import {composePostgresOperatorWithdrawal} from '../../lib/db/postgres/operator-withdrawal-transport';
import {captureWithdrawalSource,heldWithdrawalSourceFixture,sourceCellText} from '../../lib/db/postgres/operator-withdrawal-packet';
import {startCommitAckLossProxy} from './commit-ack-loss.mts';

export async function qualifyOperatorWithdrawal(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;ownerSql:(sql:string)=>string;contentionClient?:Client}){
 // Root's current Source prerequisites, used only by the actual PG qualifier.
 const {sqliteA2aTimeProjection,heldA2aTimeProjectionSql,sqliteA2aOriginalCellProjection,heldA2aOriginalCellProjectionSql}=await import('./a2a-time-projection.mts');
 const {sqliteAcceptanceProjection,heldAcceptanceProjectionSql}=await import('./acceptance-projection.mts');
 const root=process.platform==='linux'?resolve('.local/tmp/postgres-mainnet-migration-20261111/os-tmp'):resolve('D:/repos/server/Github/Hackathon/keryx/.local/tmp/postgres-mainnet-migration-20261111/agents/managed_policy');mkdirSync(root,{recursive:true});
 const folder=mkdtempSync(join(root,'operator-withdrawal-')),file=join(folder,'source.sqlite'),manifestPath=join(folder,'storage.json');
 const envNames=['KERYX_STORAGE_MANIFEST','KERYX_SQLITE_PATH','KERYX_FORCE_OFFLINE','CONTENT_MASTER_KEY'] as const,previous=Object.fromEntries(envNames.map(name=>[name,process.env[name]]));
 const channel=createPostgresDomainChannel(input.options,input.identity,input.digest),native=composePostgresOperatorWithdrawal(channel,input.identity,false),readerChannel=createPostgresDomainChannel({...input.options,role:'keryx_reader'},input.identity,input.digest),reader=composePostgresOperatorWithdrawal(readerChannel,input.identity,true);
 let source:Awaited<ReturnType<typeof createEnrolledSqliteAdapter>>|undefined,owner:DatabaseSync|undefined,vectors=0,seeded=false;
 const wallet='0x'+'a9'.repeat(20),other='0x'+'b8'.repeat(20),date='2026-11-15T12:00:00.000Z',now=Date.parse(date),ids:string[]=[],txs:string[]=[],monthlyId='synthetic-operator-'+randomUUID();
 const q=(value:string)=>"'"+value.replaceAll("'","''")+"'",pg=(sql:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+sql+"UPDATE keryx_storage.control SET mode='active';COMMIT;"),outcome=async(work:()=>unknown|Promise<unknown>)=>{try{return {ok:true as const,value:await work()};}catch{return {ok:false as const};}};
 const same=async(a:()=>unknown|Promise<unknown>,b:()=>unknown|Promise<unknown>)=>{assert.deepEqual(await outcome(a),await outcome(b));assert.deepEqual(assertEnrolledSqliteAdapter(source!),input.identity);vectors++;};
 const value=(label:string):WithdrawalRecord=>({txHash:'0x'+createHash('sha256').update(label+folder).digest('hex'),wallet,recipient:other,amountUsdc:.30000000000000004,network:input.identity.network,createdAt:'2026-11-15T19:00:00.123456789+07:00',label,sourceName:'Synthetic \ufeff metadata'});
 const copy=(table:'a2a_orders'|'research_purchase_authorizations'|'research_monthly',row:Record<string,unknown>)=>{const keys=Object.keys(row);assert(keys.every(key=>/^[a-z][a-z0-9_]*$/.test(key)));return `INSERT INTO public.${table}(${keys.join(',')}) VALUES(${keys.map(key=>row[key]===null?'NULL':typeof row[key]==='number'||typeof row[key]==='bigint'?String(row[key]):q(row[key] as string)+(table==='a2a_orders'&&['request_data','package_data','response_data','resolution_data'].includes(key)?'::jsonb':'')).join(',')});`;};
 try{
  assert.equal(input.identity.authorityMode,'mainnet-real');
  for(const table of ['withdrawals','a2a_orders','research_monthly','sources','deliverable_acceptance_store'])assert.equal(input.ownerSql('SELECT count(*) FROM public.'+table+';'),'0','Operator qualification needs an isolated empty namespace: '+table);
  // Explicit separate fixture owner, before selected enrollment/fences. All
  // ordinary Source admission triggers remain installed and are exercised.
  owner=new DatabaseSync(file);owner.exec('BEGIN IMMEDIATE');installMainnetApplicationSchema(owner,{publicReferenceArchive:true});installNativeUserDomainSchema(owner);
  for(let n=0;n<5;n++){
   const id='a2a_'+randomBytes(32).toString('hex');ids.push(id);
   owner.prepare(`INSERT INTO a2a_orders(id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,service_fee_usdc,research_mode,status,transaction_id,request_data,started_at,created_at,updated_at) VALUES(?,?,?,?,?,?,1,.8,.2,'quick',?,'synthetic',?,?,?,?)`).run(id,id,'0x'+randomBytes(32).toString('hex'),randomBytes(32).toString('hex'),wallet,wallet,n===4?'completed':'running',JSON.stringify({network:input.identity.network}),n===0||n===4?null:n===1?'2026-11-15T11:45:00.0004999Z':n===2?'2026-11-15T11:45:00.0009999Z':'2026-11-15T12:00:01Z',n===4?'2026-11-14T00:00:00Z':date,n===4?'2026-11-14T07:30:00.000-07:00':date);
  }
  const authorization='0x'+randomBytes(32).toString('hex'),quote=randomBytes(32).toString('hex'),monthly={format:'keryx-research-monthly-purchase-v2',network:input.identity.network,asset:'0x3600000000000000000000000000000000000000',gatewayContract:'0x0077777d7eba4688bdef3e311b846f25870a19b9',payer:wallet,payee:wallet,authorizationId:authorization,quoteId:quote,totalMicros:4000000,creatorBudgetMicros:800000,createdAt:'2026-11-14T19:00:00.123456789+07:00',expiresAt:'2026-11-16T12:00:00Z',transaction:'synthetic-monthly'};
  owner.prepare(`INSERT INTO research_purchase_authorizations(network,asset,payer,payee,authorization_id,product,purchase_id,request_hash,amount_micros,issued_data) VALUES(?,?,?,?,?,'monthly',?,?,?,'{"submitted":true}')`).run(input.identity.network,monthly.asset,wallet,wallet,authorization,monthlyId,quote,monthly.totalMicros);
  owner.prepare('INSERT INTO research_monthly VALUES(?,?,?)').run(monthlyId,wallet,JSON.stringify(monthly));
  insertStorageIdentity(owner,input.identity);installStorageFences(owner,input.identity);owner.exec('COMMIT');
  let seed=`INSERT INTO public.deliverable_acceptance_store(singleton,id) VALUES(1,${q(String(owner.prepare('SELECT id FROM deliverable_acceptance_store').get()!.id))});`;
  for(const table of ['research_purchase_authorizations','research_monthly','a2a_orders'] as const)for(const row of owner.prepare('SELECT * FROM '+table).all())seed+=copy(table,row);
  for(const id of ids)seed+=heldA2aTimeProjectionSql(sqliteA2aTimeProjection(owner,id,input.identity))+heldA2aOriginalCellProjectionSql(sqliteA2aOriginalCellProjection(owner,id,input.identity))+heldAcceptanceProjectionSql(sqliteAcceptanceProjection(owner,id));
  pg(seed);seeded=true;
  writeFileSync(manifestPath,canonicalJson({format:'keryx-storage-deployment-v1',identity:input.identity,backend:{kind:'sqlite',databasePath:file}}),{flag:'wx',mode:0o600});
  process.env.KERYX_STORAGE_MANIFEST=manifestPath;process.env.KERYX_SQLITE_PATH=file;process.env.KERYX_FORCE_OFFLINE='0';process.env.CONTENT_MASTER_KEY=randomBytes(32).toString('hex');
  source=await createEnrolledSqliteAdapter();assert.deepEqual(assertEnrolledSqliteAdapter(source,'write'),input.identity);
  const request={network:input.identity.network,payee:wallet,nowMs:now};
  for(const t of [now,now+1,now-1])await same(()=>reader.operatorInventory({...request,nowMs:t}),()=>source!.operatorInventory({...request,nowMs:t}));
  await same(()=>reader.operatorPublicSnapshot(now),()=>source!.operatorPublicSnapshot(now));
  const first=ids[0];pg(`DELETE FROM keryx_storage.a2a_original_time_projection WHERE order_id=${q(first)};`);await assert.rejects(reader.operatorInventory(request));pg(heldA2aTimeProjectionSql(sqliteA2aTimeProjection(owner,first,input.identity)));vectors++;
  for(const label of ['plain','embedded\0NUL','lone\ud800 surrogate','\ufeffBOM']){const w=value(label);txs.push(w.txHash);await same(()=>native.recordWithdrawal(w),()=>source!.recordWithdrawal(w));await same(()=>native.recordWithdrawal({...w,label:'ignored replay',createdAt:date,wallet:wallet.toUpperCase().replace('0X','0x')}),()=>source!.recordWithdrawal({...w,label:'ignored replay',createdAt:date,wallet:wallet.toUpperCase().replace('0X','0x')}));await same(()=>native.recordWithdrawal({...w,amountUsdc:.4}),()=>source!.recordWithdrawal({...w,amountUsdc:.4}));}
  const foreign=value('foreign-network'),before=input.ownerSql('SELECT count(*) FROM public.withdrawals;');await same(()=>native.recordWithdrawal({...foreign,network:'foreign\0\ud800'}),()=>source!.recordWithdrawal({...foreign,network:'foreign\0\ud800'}));assert.equal(input.ownerSql('SELECT count(*) FROM public.withdrawals;'),before);
  await assert.rejects(reader.recordWithdrawal(value('readonly')));vectors++;
  await assert.rejects(readerChannel.call('withdrawalSourceRecord' as Parameters<typeof readerChannel.call>[0],[captureWithdrawalSource(value('direct-reader-sql')).wire]));vectors++;
  // Fixed SQL cannot accept a self-asserted cells/original mismatch or foreign
  // network merely because a caller can construct a JSON packet.
  const packet=JSON.parse(captureWithdrawalSource(value('malicious')).wire);packet.cells.network=Buffer.from('foreign').toString('hex');await assert.rejects(channel.call('withdrawalSourceRecord' as Parameters<typeof channel.call>[0],[JSON.stringify(packet)]));vectors++;
  assert.equal(input.ownerSql("SELECT count(*) FROM pg_proc WHERE oid IN('keryx_storage.write_fence()'::regprocedure,'keryx_storage.require_operation(jsonb,text,text)'::regprocedure,'public.storage_application_operational_write(jsonb,text,text,jsonb)'::regprocedure,'public.storage_application_read_group_8(jsonb,text,text,jsonb)'::regprocedure) AND (octet_length(pg_get_functiondef(oid))>32768 OR octet_length(to_jsonb(pg_get_functiondef(oid))::text)>32768);"),'0');vectors++;
  // The old scalar observer must fail as a whole on unprojected display cells.
  await assert.rejects(channel.call('app_list_withdrawals',[JSON.stringify({p_limit:100})]));vectors++;
  const firstTx=txs[0],savedOriginal=input.ownerSql('SELECT original_sha256 FROM keryx_storage.withdrawal_source_originals WHERE tx_hash='+q(firstTx)+';');assert.throws(()=>pg('UPDATE keryx_storage.withdrawal_source_originals SET original=original||\' \' WHERE tx_hash='+q(firstTx)+';'));assert.equal(input.ownerSql('SELECT original_sha256 FROM keryx_storage.withdrawal_source_originals WHERE tx_hash='+q(firstTx)+';'),savedOriginal);vectors++;
  const intake=value('independent-raw-cell-intake');await source.recordWithdrawal(intake);const observed=owner.prepare('SELECT * FROM withdrawals WHERE tx_hash=?').get(intake.txHash)!,correct=heldWithdrawalSourceFixture(observed,input.identity),wrong=heldWithdrawalSourceFixture({...observed,label:'unrelated original cells'},input.identity);
  assert.throws(()=>pg(correct.physicalSql+wrong.scalarSql));assert.equal(input.ownerSql('SELECT count(*) FROM public.withdrawals WHERE tx_hash='+q(intake.txHash)+';'),'0');vectors++;
  if(input.contentionClient){const holder=input.contentionClient;await holder.query('BEGIN');await holder.query('SELECT pg_advisory_xact_lock(634781904177022::bigint)');try{const waiting=reader.operatorInventory(request);await holder.query('COMMIT');assert.deepEqual(await waiting,await source.operatorInventory(request));vectors++;}finally{await holder.query('ROLLBACK');}}
  assert(input.options.endpoint.kind==='loopback');const proxy=await startCommitAckLossProxy(input.options.endpoint.port),loss=createPostgresDomainChannel({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest);try{const port=composePostgresOperatorWithdrawal(loss,input.identity,false),w=value('lost-ack');txs.push(w.txHash);proxy.arm();await assert.rejects(port.recordWithdrawal(w),e=>e instanceof PostgresDomainWriteOutcomeUnknown);assert.equal(input.ownerSql('SELECT count(*) FROM public.withdrawals WHERE tx_hash='+q(w.txHash)+';'),'1');await port.recordWithdrawal(w);await source.recordWithdrawal(w);vectors++;}finally{await loss.close();await proxy.close();}
  assert.equal(input.ownerSql('SELECT count(*) FROM keryx_storage.writer;'),'0');
  return {vectors,genuineSelectedSourceFacade:true,sourceProfileFencesPreserved:true,wholeInventory:true,identifierFreeOperators:true,sourceJulianDayRounding:true,firstReportWins:true,actualLostCommitAck:true,functionGrowth:0,fullFactoryQualified:false,nativeFacadeProvenanceQualified:false,writerFactoryOpened:false,limitations:['Dynamic SQLite now/subsec/subsecond date strings, unsafe individual micro-cap integers and unsupported Source time/JSON/native representations refuse complete observations.','Legacy withdrawal observers refuse unprojected originals; raw-aware list/settlement facade acceptance remains required.','Protocol composition cannot issue installed storage/funding/transfer authority.']};
 }finally{
  source?.close();owner?.close();await channel.close();await readerChannel.close();
  for(const name of envNames){const value=previous[name];if(value===undefined)delete process.env[name];else process.env[name]=value;}
  try{if(seeded)pg(`DELETE FROM public.withdrawals WHERE tx_hash IN(${txs.map(q).join(',')||"''"});DELETE FROM keryx_storage.withdrawal_source_originals WHERE tx_hash IN(${txs.map(q).join(',')||"''"});DELETE FROM keryx_storage.acceptance_original_projection WHERE order_id IN(${ids.map(q).join(',')});DELETE FROM public.a2a_orders WHERE id IN(${ids.map(q).join(',')});DELETE FROM public.research_monthly WHERE id=${q(monthlyId)};DELETE FROM public.research_purchase_authorizations WHERE purchase_id=${q(monthlyId)} OR purchase_id IN(${ids.map(q).join(',')});DELETE FROM public.deliverable_acceptance_store;`);}
  finally{for(const path of [file,file+'-wal',file+'-shm',file+'-journal',manifestPath]){assert.equal(dirname(resolve(path)),resolve(folder));if(existsSync(path))unlinkSync(path);}assert.equal(dirname(resolve(folder)),resolve(root));rmdirSync(folder);}
 }
}

/** Standalone genuine Source preflight, also runnable without PostgreSQL.
 * It uses the existing enrolled factory and real manifest/identity/fences;
 * no Object.create facade, registered fake proof or Node callback authority. */
export async function qualifyOperatorWithdrawalSourceOnly(identity:StorageIdentity){
 const root=process.platform==='linux'?resolve('.local/tmp/postgres-mainnet-migration-20261111/os-tmp'):resolve('D:/repos/server/Github/Hackathon/keryx/.local/tmp/postgres-mainnet-migration-20261111/agents/managed_policy');mkdirSync(root,{recursive:true});
 const folder=mkdtempSync(join(root,'operator-source-only-')),file=join(folder,'source.sqlite'),manifestPath=join(folder,'storage.json'),manifest=canonicalJson({format:'keryx-storage-deployment-v1',identity,backend:{kind:'sqlite',databasePath:file}}),names=['KERYX_STORAGE_MANIFEST','KERYX_SQLITE_PATH','KERYX_FORCE_OFFLINE','CONTENT_MASTER_KEY'] as const,previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 let source:Awaited<ReturnType<typeof createEnrolledSqliteAdapter>>|undefined,owner:DatabaseSync|undefined,vectors=0;
 try{
  owner=new DatabaseSync(file);owner.exec('BEGIN IMMEDIATE');installMainnetApplicationSchema(owner,{publicReferenceArchive:true});installNativeUserDomainSchema(owner);
  const seedWallet='0x'+'a9'.repeat(20);for(const [status,started,created,updated] of [['running','2026-11-15T11:45:00.0009999Z','2026-11-15T11:30:00Z','2026-11-15T12:00:00Z'],['completed',null,'2026-11-14T00:00:00Z','2026-11-14T07:30:00.000-07:00']] as const){const id='a2a_'+randomBytes(32).toString('hex');owner.prepare(`INSERT INTO a2a_orders(id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,service_fee_usdc,research_mode,status,transaction_id,request_data,started_at,created_at,updated_at) VALUES(?,?,?,?,?,?,1,.8,.2,'quick',?,'synthetic',?,?,?,?)`).run(id,id,'0x'+randomBytes(32).toString('hex'),randomBytes(32).toString('hex'),seedWallet,seedWallet,status,JSON.stringify({network:identity.network}),started,created,updated);}
  insertStorageIdentity(owner,identity);installStorageFences(owner,identity);owner.exec('COMMIT');
  writeFileSync(manifestPath,manifest,{flag:'wx',mode:0o600});process.env.KERYX_STORAGE_MANIFEST=manifestPath;process.env.KERYX_SQLITE_PATH=file;process.env.KERYX_FORCE_OFFLINE='0';process.env.CONTENT_MASTER_KEY=randomBytes(32).toString('hex');
  source=await createEnrolledSqliteAdapter();assert.deepEqual(assertEnrolledSqliteAdapter(source,'write'),identity);vectors++;
  const wallet='0x'+'a9'.repeat(20),nowMs=Date.parse('2026-11-15T12:00:00Z'),inventory=await source.operatorInventory({network:identity.network,payee:wallet,nowMs});assert.equal(inventory.invalidJobs,0);assert.equal(inventory.processingJobs,1);assert.deepEqual(assertEnrolledSqliteAdapter(source),identity);vectors++;
  const snapshot=await source.operatorPublicSnapshot(nowMs);assert.equal(snapshot.creatorCatalog.registered,0);assert.equal(snapshot.jobs?.completionLatencyCohorts?.ordinary.completed,0);assert.equal(snapshot.jobs?.reviewRequired,1);assert.equal(snapshot.jobs?.completedLast24h,0);vectors++;
  const w:WithdrawalRecord={txHash:'0x'+'b8'.repeat(32),wallet,recipient:wallet,amountUsdc:.30000000000000004,network:identity.network,createdAt:'2026-11-15T19:00:00.123456789+07:00',label:'NUL\0lone\ud800',sourceName:'\ufeffsource'};
  await source.recordWithdrawal(w);const row=owner.prepare('SELECT * FROM withdrawals').get()!,held=heldWithdrawalSourceFixture(row,identity);assert.equal(sourceCellText(held.cells.label),row.label);assert.equal(sourceCellText(held.cells.created_at),w.createdAt);assert.deepEqual(held.unprojected,['label']);vectors++;
  await source.recordWithdrawal({...w,label:'ignored display replay',createdAt:'2026-11-15T12:00:00.000Z'});assert.equal(owner.prepare('SELECT label FROM withdrawals').get()?.label,row.label);vectors++;
  await assert.rejects(source.recordWithdrawal({...w,amountUsdc:.4}));assert.equal(owner.prepare('SELECT count(*) n FROM withdrawals').get()?.n,1);vectors++;
  await assert.rejects(source.recordWithdrawal({...w,txHash:'0x'+'c7'.repeat(32),network:'foreign\0\ud800'}));assert.equal(owner.prepare('SELECT count(*) n FROM withdrawals').get()?.n,1);vectors++;
  writeFileSync(manifestPath,canonicalJson({format:'keryx-storage-deployment-v1',identity:{...identity,enrollmentId:randomUUID()},backend:{kind:'sqlite',databasePath:file}}));await assert.rejects(async()=>source!.operatorInventory({network:identity.network,payee:wallet,nowMs}));writeFileSync(manifestPath,manifest);assert.throws(()=>assertEnrolledSqliteAdapter(source!));vectors++;
  return {vectors,genuineSelectedSourceFacade:true,sourceProfileFence:true,exactSourceScalarBindings:true,firstReportWins:true,changedManifestRetiresFacade:true,sqliteVersion:owner.prepare('SELECT sqlite_version() version').get()?.version,rssMiB:Math.ceil(process.memoryUsage().rss/1048576),fullNativeFactoryQualified:false};
 }finally{
  try{source?.close();}finally{owner?.close();for(const name of names){const value=previous[name];if(value===undefined)delete process.env[name];else process.env[name]=value;}for(const path of [file,file+'-wal',file+'-shm',file+'-journal',manifestPath]){assert.equal(dirname(resolve(path)),resolve(folder));if(existsSync(path))unlinkSync(path);}assert.equal(dirname(resolve(folder)),resolve(root));rmdirSync(folder);}
 }
}
