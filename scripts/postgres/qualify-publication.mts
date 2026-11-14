/** Synthetic fixed-protocol qualification against the genuine SQLite writer.
 * The pure DTO builder is not an installed facade or capture admission. No
 * provider, registry, payment, funding, signature or scheduler is invoked.
 */
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync,writeFileSync,existsSync,unlinkSync,rmdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import type {Client} from 'pg';
import type {QueryRun} from '../../lib/types';
import {validateStorageIdentity,type StorageIdentity} from '../../lib/db/storage-identity';
import type {PostgresConnectionOptions} from '../../lib/db/postgres/connection';
import {canonicalJson} from '../../lib/canonical-json';
import {installMainnetApplicationSchema} from '../../lib/db/mainnet-application-schema';
import {installNativeUserDomainSchema} from '../../lib/db/native-user-domain-schema';
import {writeSqliteQueryRun} from '../../lib/db/query-run-record';
import {createEnrolledSqliteRunPrivacy} from '../../lib/db/run-privacy-sqlite';
import {createEnrolledSqliteRunOwnershipHistory} from '../../lib/db/run-ownership-history-sqlite';
import {createEnrolledSqlitePersonalHistory} from '../../lib/db/personal-history-sqlite';
import {createEnrolledSqlitePrivateProfiles} from '../../lib/db/private-profiles-enrolled-sqlite';
import {insertStorageIdentity,installStorageFences} from '../../lib/db/storage-identity-sqlite';
import {openVerifiedSqliteStorage} from '../../lib/db/storage-identity-connection';
import {supportedSqliteApplicationProfiles} from '../../lib/db/enrolled-sqlite-schema-profile';
import {inspectStorageDeploymentManifest} from '../../lib/db/runtime-storage-config';
import {SQLITE_DASHBOARD_INPUT_ROWS,dashboardMetricsFromSqliteRows} from '../../lib/db/dashboard-metric-rows';
import {capturePublicationSourcePacket,capturePostgresPublication} from '../../lib/db/postgres/publication-packet';
import {publicationScalarText} from '../../lib/db/postgres/publication-scalar-text';
import {createPostgresDomainChannel,PostgresDomainWriteOutcomeUnknown} from '../../lib/db/postgres/domain-channel';
import {composePostgresUserDomainTransport} from '../../lib/db/postgres/user-domain-transport';
import {PRIVACY_CALLS} from '../../lib/db/postgres/privacy-calls';
import {startCommitAckLossProxy} from './commit-ack-loss.mts';

export async function qualifyPublication(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;contentionClient:Client;ownerSql:(sql:string)=>string}){
 const tempRoot=process.platform==='linux'?resolve('.local/tmp/postgres-mainnet-migration-20261111/os-tmp'):resolve('D:/repos/server/Github/Hackathon/keryx/.local/tmp/postgres-mainnet-migration-20261111/agents/managed_policy');mkdirSync(tempRoot,{recursive:true});
 const sourceIdentity=validateStorageIdentity(input.identity),folder=mkdtempSync(join(tempRoot,'publication-source-')),file=join(folder,'source.sqlite'),manifestPath=join(folder,'storage.json'),manifest=canonicalJson({format:'keryx-storage-deployment-v1',identity:sourceIdentity,backend:{kind:'sqlite',databasePath:file}});
 const db=new DatabaseSync(file),channel=createPostgresDomainChannel(input.options,input.identity,input.digest),native=composePostgresUserDomainTransport(channel,input.identity,false,true);
 const owner='0x'+randomBytes(20).toString('hex'),other='0x'+randomBytes(20).toString('hex'),session=randomBytes(32).toString('hex'),binding={network:input.identity.network,origin:'https://keryx.cc'},actor={wallet:owner,sessionHash:session,binding},date=new Date().toISOString(),prefix='synthetic-publication-'+randomBytes(5).toString('hex')+'-';
 const q=(s:string)=>"'"+s.replaceAll("'","''")+"'",pg=(sql:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+sql+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 let source:ReturnType<typeof openVerifiedSqliteStorage>|undefined;let vectors=0;const writeTimes:number[]=[],ids:string[]=[];
 const outcome=async(work:()=>unknown|Promise<unknown>)=>{try{return {ok:true as const,value:await work()};}catch{return {ok:false as const};}};
 const same=async(a:()=>unknown|Promise<unknown>,b:()=>unknown|Promise<unknown>)=>{assert.deepEqual(await outcome(a),await outcome(b));vectors++;};
 const base=(suffix:string):QueryRun=>({id:prefix+suffix,createdAt:date,question:suffix+' question',answer:'PAID_BODY_'+suffix,engine:'heuristic',budget:1,totalSpent:0.1,totalToCreators:0,subClaims:[],decisions:[],citations:[],trace:[],asker:owner,paymentMode:'offline'});
 try{
  assert.equal(input.ownerSql('SELECT count(*) FROM public.query_runs;'),'0','Publication requires an isolated empty QueryRun namespace');
  for(const table of ['payment_events','answer_feedback','gap_intents'])assert.equal(input.ownerSql('SELECT count(*) FROM public.'+table+';'),'0','Publication metric oracle requires its empty namespace');
  // This connection is explicitly the fixture owner, never an application
  // facade or a registered proof. Bootstrap schema/identity/fences before open.
  db.exec('PRAGMA foreign_keys=ON;BEGIN IMMEDIATE');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);
  db.prepare('INSERT INTO web_sessions(hash,wallet,issued_at,expires_at) VALUES(?,?,?,?)').run(session,owner,Date.now()-10000,Date.now()+3600000);
  insertStorageIdentity(db,sourceIdentity);installStorageFences(db,sourceIdentity);db.exec('COMMIT');
  writeFileSync(manifestPath,manifest,{flag:'wx',mode:0o600});
  source=openVerifiedSqliteStorage(file,sourceIdentity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>assert.equal(canonicalJson(inspectStorageDeploymentManifest({KERYX_STORAGE_MANIFEST:manifestPath})),manifest)});
  const ownership=createEnrolledSqliteRunOwnershipHistory(source.db),privacy=createEnrolledSqliteRunPrivacy(source.db),history=createEnrolledSqlitePersonalHistory(source.db),profiles=createEnrolledSqlitePrivateProfiles(source.db);assert(profiles);
  const creation={privacy:{runPrivacy:privacy,runPrivacyActive:true},enrolled:true};
  pg(`INSERT INTO public.web_sessions(hash,wallet,issued_at,expires_at) VALUES(${q(session)},${q(owner)},${Date.now()-10000},${Date.now()+3600000});`);
  const protocolSave=async(run:QueryRun,visibility:'public'|'private'|'unlisted'='public')=>{
   const packet=capturePublicationSourcePacket(run,{visibility}),sha=createHash('sha256').update(Buffer.from(JSON.parse(packet.wire).originalHex,'hex')).digest('hex'),started=performance.now(),result=await channel.call('publicationSave',[packet.wire]);writeTimes.push(performance.now()-started);
   assert.deepEqual(result,{id:run.id,originalSha256:sha});writeSqliteQueryRun(source!.db,run,true,{...creation,publication:{visibility}});ids.push(run.id);
   assert.equal(input.ownerSql(`SELECT data::text FROM public.query_runs WHERE id=${q(run.id)};`),db.prepare('SELECT data FROM query_runs WHERE id=?').get(run.id)!.data);vectors++;
   return packet;
  };
  // Exercise the shared lexer itself, including string boundaries at4096 bytes,
  // opaque keys and invalid UTF-8 emitted only by SQLite JSON extraction.
  for(const value of ['', 'a\0b','a\ud800b','a\udc00b','a\ud800\udc00b','\\u0000','quote"\\tail','x'.repeat(4094)+'\\"tail','x'.repeat(4095)+'\0tail']){
   const wire=JSON.stringify(value),sqlWire=`convert_from(decode(${q(Buffer.from(wire).toString('hex'))},'hex'),'UTF8')`,actual=JSON.parse(input.ownerSql(`SELECT keryx_storage.source_scalar_text(${sqlWire},'scalar')::text;`));
   const expected=db.prepare("SELECT lower(hex(CAST(? AS BLOB))) scalar,lower(hex(CAST(json_extract(?,'$') AS BLOB))) extracted").get(value,wire)!;
   assert.equal(actual.sourceHex,expected.scalar);assert.equal(actual.jsonHex,expected.extracted);const bound=publicationScalarText(value);assert.equal(value.includes('\0')?JSON.parse(actual.shadow):actual.shadow,JSON.parse(bound.sourceJsonWire));vectors++;
  }
  const rawRoot='{"\\u0063laim":{"id":"first"},"evidence":"\\u0000\\ud800","claim":{"id":"last"},"\\ud800":1,"":2}',root=JSON.parse(input.ownerSql(`SELECT keryx_storage.source_scalar_text(convert_from(decode(${q(Buffer.from(rawRoot).toString('hex'))},'hex'),'UTF8'),'tokens')::text;`));
  assert.equal(root.claim,'{"id":"last"}');assert.equal(root.evidence,'"\\u0000\\ud800"');assert.deepEqual(root._rootKeys,['636c61696d','65766964656e6365','636c61696d','eda080','']);vectors++;
  const cases:QueryRun[]=[base('plain'),{...base('nul'),question:'nul before\0after-nul',answer:'PAID_BODY_NUL\0\ud800',retained:{wire:'\0\udc00'}} as unknown as QueryRun,
   {...base('high'),question:'high \ud800 after-high',answer:'PAID_BODY_HIGH\udc00'}, {...base('low'),question:'low \udc00 after-low'},
   {...base('replacement'),question:'literal \ufffd'}, {...base('engine'),engine:'engine\0\ud800'},
   {...base('owner'),asker:'\u0130'}, {...base('nonnull-owner'),asker:'0xBAD\0owner'}, {...base('client'),origin:'mcp',mcpClient:'custom\0\ud800'} as unknown as QueryRun,
   {...base('origin'),origin:'web\0tail'} as unknown as QueryRun];
  for(const run of cases){
   await protocolSave(run);await same(()=>native.runPrivacy.read(run.id,actor),()=>privacy.read(run.id,actor));await same(()=>native.runPrivacy.owner(run.id,actor),()=>privacy.owner(run.id,actor));await same(()=>native.runPrivacy.owner(run.id,{...actor,wallet:other}),()=>privacy.owner(run.id,{...actor,wallet:other}));
   await same(()=>native.runPrivacy.settlement(run.id),()=>privacy.settlement(run.id));await same(()=>native.runPrivacy.questions!([run.id]),()=>privacy.questions!([run.id]));
   const fields=['question','answer','engine','asker','parent_id','origin','mcp_client','payment_mode','confidence_level'];
   const observed=db.prepare('SELECT * FROM query_runs WHERE id=?').get(run.id)!;
   const stored=JSON.parse(input.ownerSql(`SELECT jsonb_build_object('cells',scalar_cells,'answer',encode(answer_scalar,'hex'),'identity',scalar_identity_sha256)::text FROM keryx_storage.run_privacy_projection WHERE run_id=${q(run.id)};`));
   for(const field of fields)assert.equal(field==='answer'?stored.answer:stored.cells[field].boundHex,observed[field]===null?null:Buffer.from(observed[field] as string).toString('hex'));
   assert(!Object.hasOwn(stored.cells,'answer'));assert.equal(stored.identity,input.ownerSql('SELECT identity_digest FROM keryx_storage.identity;'));vectors++;
  }
  for(const search of ['after-nul','after-high','after-low','\ufffd','not-present'])await same(()=>native.personalHistory.list(owner,{filters:{search},take:51}),()=>history.list(owner,{filters:{search},take:51}));
  await same(()=>native.runOwnershipHistory.list(owner,{binding,filters:{search:'\ufffd'},take:51}),()=>ownership.list(owner,{binding,filters:{search:'\ufffd'},take:51}));
  await same(()=>native.runPrivacy.sourceHistory!(),()=>privacy.sourceHistory!());await same(()=>native.runPrivacy.learningPage!({take:32}),()=>privacy.learningPage!({take:32}));await same(()=>native.runPrivacy.archivePage!({take:32}),()=>privacy.archivePage!({take:32}));
  const metricStatement=db.prepare(SQLITE_DASHBOARD_INPUT_ROWS);metricStatement.setReturnArrays(true);const expectedDashboard=dashboardMetricsFromSqliteRows(metricStatement.all() as never),actualDashboard=await native.dashboardMetrics();
  assert.deepEqual({...actualDashboard,recordedAccounts:undefined},{...expectedDashboard,recordedAccounts:undefined});vectors++;
  const sourceMetrics=db.prepare('SELECT id,origin,asker,duration_ms,payment_mode,payment_attempts,settled_payments,confidence_level,mcp_client,evidence_claim_count,grounded_claim_count,rewarded_citation_count,economics_data FROM query_runs ORDER BY id').all().map(row=>({...row}));
  assert.deepEqual(await native.applicationRead('scan_query_metrics',{p_offset:0,p_limit:1000}),sourceMetrics);vectors++;
  for(const operation of ['get_query_run','list_query_runs_by_asker','list_follow_ups','list_recent_queries'] as const){
   const args=operation==='get_query_run'?{p_id:cases[1].id}:operation==='list_query_runs_by_asker'?{p_asker:owner,p_limit:1000}:operation==='list_follow_ups'?{p_parent_id:'missing-parent'}:{p_limit:1000};
   const expected=operation==='get_query_run'?{data:JSON.parse(String(db.prepare('SELECT data FROM query_runs WHERE id=?').get(cases[1].id)!.data))}:operation==='list_follow_ups'?[]:db.prepare('SELECT data FROM query_runs'+(operation==='list_query_runs_by_asker'?' WHERE asker=?':'')+' ORDER BY created_at DESC').all(...(operation==='list_query_runs_by_asker'?[owner]:[])).map(row=>({data:JSON.parse(String(row.data))}));
   const value=await native.applicationRead(operation,args);if(Array.isArray(value)&&Array.isArray(expected)){const order=(rows:{data:unknown}[])=>rows.slice().sort((a,b)=>String(Reflect.get(a.data as object,'id')).localeCompare(String(Reflect.get(b.data as object,'id'))));assert.deepEqual(order(value as {data:unknown}[]),order(expected));}else assert.deepEqual(value,expected);vectors++;
  }
  // Valid Source dates are TEXT, so offsets and sub-millisecond precision
  // affect byte ordering even when their parsed native instants compare apart
  // or collapse. Raw scalar dates and their privacy clocks must remain exact.
  const dateWires=['2099-11-15T00:00:00.000Z','2099-11-15T01:00:00.000+02:00','2099-11-15T00:00:00.000100Z','2099-11-15T00:00:00.000900Z','2099-11-15T00:00:00.123456789Z'],dateParent=prefix+'date-parent',dateRuns:QueryRun[]=[];
  for(const [index,createdAt] of dateWires.entries()){
   const run={...base('date-'+index),createdAt,asker:other,parentId:dateParent};dateRuns.push(run);await protocolSave(run);
   const observed=db.prepare('SELECT created_at FROM query_runs WHERE id=?').get(run.id)!;
   assert.equal(input.ownerSql(`SELECT convert_from(decode(s.scalar_cells->'created_at'->>'boundHex','hex'),'UTF8') FROM keryx_storage.run_privacy_projection s WHERE run_id=${q(run.id)};`),observed.created_at);
   assert.equal(input.ownerSql(`SELECT updated_at FROM public.run_privacy WHERE run_id=${q(run.id)};`),createdAt);
   await same(()=>native.runPrivacy.read(run.id),()=>privacy.read(run.id));await same(()=>native.runPrivacy.settlement(run.id),()=>privacy.settlement(run.id));vectors++;
  }
  for(const [operation,args,ascending] of [
   ['list_query_runs_by_asker',{p_asker:other,p_limit:1000},false],['list_follow_ups',{p_parent_id:dateParent},true],['list_recent_queries',{p_limit:dateRuns.length},false],
  ] as const){
   const expected=db.prepare('SELECT data FROM query_runs WHERE asker=? ORDER BY created_at '+(ascending?'ASC':'DESC')).all(other).map(row=>({data:JSON.parse(String(row.data))}));
   assert.deepEqual(await native.applicationRead(operation,args),expected);vectors++;
  }
  await same(()=>native.runPrivacy.list({parentId:dateParent,take:32}),()=>privacy.list({parentId:dateParent,take:32}));
  await same(()=>native.runPrivacy.list({parentId:dateParent,before:{id:dateRuns[0].id,createdAt:dateWires[0]},take:32}),()=>privacy.list({parentId:dateParent,before:{id:dateRuns[0].id,createdAt:dateWires[0]},take:32}));
  // Source's strict history output schemas reject these noncanonical dates;
  // do not silently normalize them to manufacture valid history cursors.
  assert(!(await outcome(()=>history.list(other,{filters:{},take:51}))).ok);await same(()=>native.personalHistory.list(other,{filters:{},take:51}),()=>history.list(other,{filters:{},take:51}));
  await same(()=>native.runOwnershipHistory.list(other,{binding,filters:{},take:51}),()=>ownership.list(other,{binding,filters:{},take:51}));
  const privateRun=base('private');await protocolSave(privateRun,'private');assert.deepEqual(await native.runPrivacy.questions!([privateRun.id]),[]);assert.equal((await native.runPrivacy.read(privateRun.id)).item,null);vectors++;
  for(const source of [cases[6],cases[7]])assert.throws(()=>input.ownerSql(`SELECT keryx_storage.claim_original(${q(source.id)},${q(date)});`),/claim_unavailable/);
  // A caller cannot turn malformed non-null Source ownership into a valid
  // wallet/absence, nor submit a purported prevalidated body scalar.
  for(const fault of ['wallet','absence','body'] as const){
   const run={...cases[6],id:prefix+'forged-'+fault},packet=JSON.parse(capturePublicationSourcePacket(run).wire);
   if(fault==='body')packet.privacy.scalarCells.question={rawKind:'string',boundHex:'00'};
   else{packet.row.asker=fault==='wallet'?owner:null;packet.privacy.scalarCells.asker.boundHex=fault==='wallet'?Buffer.from(owner).toString('hex'):null;packet.history.anonymousClaimEligible=true;}
   const result=await outcome(()=>channel.call('publicationSave',[JSON.stringify(packet)]));assert(!result.ok||Boolean((result.value as {error?:unknown})?.error));assert.equal(input.ownerSql(`SELECT count(*) FROM public.query_runs WHERE id=${q(run.id)};`),'0');vectors++;
  }
  for(const field of ['question','answer','retainedOriginal'] as const){
   const run={...base('large-'+field),[field]:''},small=JSON.parse(capturePublicationSourcePacket(run).wire),overhead=Buffer.from(small.originalHex,'hex').length;Object.assign(run,{[field]:'x'.repeat(4000000-overhead)});
   const packet=await protocolSave(run);assert.equal(Buffer.from(JSON.parse(packet.wire).originalHex,'hex').length,4000000);assert(writeTimes.at(-1)!<5000,'actual large publication exceeds5s');
   await same(()=>native.runPrivacy.read(run.id,actor),()=>privacy.read(run.id,actor));await same(()=>native.applicationRead('get_query_run',{p_id:run.id}),()=>({data:JSON.parse(String(db.prepare('SELECT data FROM query_runs WHERE id=?').get(run.id)!.data))}));
   assert.throws(()=>capturePublicationSourcePacket({...run,[field]:'x'.repeat(4000001-overhead)}));vectors++;
  }
  // Additional complete originals exceed32MiB in HEX as a collection. Refuse
  // the whole requested result, while every individually bounded original stays.
  for(let i=0;i<2;i++){const run={...base('collection-'+i),retainedOriginal:'x'.repeat(3900000)};await protocolSave(run);}
  await assert.rejects(native.applicationRead('list_recent_queries',{p_limit:1000}));vectors++;
  const stale=cases[0].id;pg(`UPDATE public.query_runs SET question='changed Source scalar' WHERE id=${q(stale)};`);assert.equal(input.ownerSql(`SELECT count(*) FROM keryx_storage.run_privacy_projection WHERE run_id=${q(stale)};`),'0');
  await assert.rejects(native.personalHistory.list(owner,{filters:{search:'plain'},take:51}));await assert.rejects(native.runPrivacy.settlement(stale));vectors++;
  // Restore through the same fixed protocol, not by inventing a derivative.
  await protocolSave(cases[0]);
  const race=base('erase-race');await protocolSave(race);const replacement={...race,answer:'PAID_BODY_NEW\0\ud800'},packet=capturePublicationSourcePacket(replacement),requestId=randomUUID();let held=false,pending:Promise<unknown>|undefined;
  try{
   await input.contentionClient.query('BEGIN');held=true;await input.contentionClient.query('SELECT pg_advisory_xact_lock(634781904177022::bigint)');pending=channel.call('publicationSave',[packet.wire]);
   let blocked=false;for(let attempt=0;attempt<30;attempt++){const seen=await input.contentionClient.query('SELECT count(*) n FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND pg_backend_pid()=ANY(pg_blocking_pids(pid))');if(Number(seen.rows[0].n)>0){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}assert(blocked,'publication must wait behind the genuine writer lock');
   const erased=await input.contentionClient.query(PRIVACY_CALLS.privacyErase.sql,[canonicalJson(input.identity),input.digest,race.id,JSON.stringify(actor),JSON.stringify({revision:0,requestId}),true]);const raw=erased.rows[0].result,value=typeof raw==='string'?JSON.parse(raw):raw;assert.equal(value.state.erased,true);await input.contentionClient.query('COMMIT');held=false;
   assert.deepEqual(await pending,{error:'privacy_unavailable'});pending=undefined;await privacy.erase(race.id,actor,{revision:0,requestId});assert.throws(()=>writeSqliteQueryRun(source!.db,replacement,true,{...creation,publication:{visibility:'public'}}));await same(()=>native.runPrivacy.read(race.id,actor),()=>privacy.read(race.id,actor));vectors++;
  }finally{if(held)await input.contentionClient.query('ROLLBACK');if(pending)await pending.catch(()=>{});}
  assert(input.options.endpoint.kind==='loopback');const proxy=await startCommitAckLossProxy(input.options.endpoint.port),loss=createPostgresDomainChannel({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest);
  try{const run={...base('lost-ack'),answer:'PAID_BODY_LOST_ACK\0\udc00'},packet=capturePublicationSourcePacket(run);proxy.arm();await assert.rejects(loss.call('publicationSave',[packet.wire]),PostgresDomainWriteOutcomeUnknown);assert(proxy.observation().dropped);assert.equal(input.ownerSql(`SELECT data::text FROM public.query_runs WHERE id=${q(run.id)};`),Buffer.from(JSON.parse(packet.wire).originalHex,'hex').toString());vectors++;}finally{await loss.close();await proxy.close();}
  const reader=createPostgresDomainChannel({...input.options,role:'keryx_reader'},input.identity,input.digest);try{await assert.rejects(reader.call('publicationSave',[capturePublicationSourcePacket(base('reader')).wire]));vectors++;}finally{await reader.close();}
  // The invalid non-null Source origin is a strict private-profile surface
  // refusal. Its enrolled port deliberately retires the shared verified Source
  // connection on that unclassified failure, so exercise it LAST. Earlier page
  // readers must compare live Source rows, not a connection already closed by a
  // different expected negative. Native installed-facade retirement is still a
  // separate full-factory blocker; a successful fixed protocol is not that proof.
  await same(()=>native.privateProfiles.get(owner,input.identity.network),()=>profiles.get(owner,input.identity.network));
  assert.throws(()=>source!.db.prepare('SELECT count(*) FROM query_runs').get(),/Verified storage connection closed/);vectors++;
  assert.throws(()=>capturePostgresPublication(cases[1]));assert.throws(()=>capturePostgresPublication(cases[2]));assert.equal(input.ownerSql('SELECT count(*) FROM keryx_storage.writer;'),'0');
  return {vectors,genuineSqliteOracle:true,verifiedEnrolledSqlite:true,rawSourceDateOrder:true,offsetAndSubmillisecondDates:true,strictHistoryDateRefusal:true,pureFixedProtocol:true,rawScalarVsJsonExtraction:true,rawOriginalPreserved:true,metadataExcludesPaidAnswer:true,unicodeJsOwnerBoundary:true,noNullOwnerFallback:true,staleScalarRefused:true,erasureAfterWriterWaitRefused:true,largeOriginalBytes:4000000,completeCollectionBytes:33554432,largeWriteMaximumMs:Math.max(...writeTimes),lostAckUnknownNoRetry:true,readerRefused:true,unsafeCaptureStillClosed:true,compiled512MiBQualified:false,sourceProfileRefusalRetiresConnection:true,nativeFacadeTerminalRetirementQualified:false,fullFactoryBlockers:['native-private-profile-terminal-retirement'],fullFactoryQualified:false,retainedSyntheticRows:Number(input.ownerSql('SELECT count(*) FROM public.query_runs;')),providerCalls:0,paymentActions:0,schedulesCreated:0};
 }finally{
  try{await channel.close();}finally{try{source?.close();}finally{db.close();}}
  // Only this uniquely created canonical TEMP fixture, with resolved path checks.
  for(const path of [file,file+'-wal',file+'-shm',file+'-journal',manifestPath]){assert.equal(dirname(resolve(path)),resolve(folder));if(existsSync(path))unlinkSync(path);}assert.equal(dirname(resolve(folder)),resolve(tempRoot));rmdirSync(folder);
 }
}
