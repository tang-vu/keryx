/** Recording fixed protocol only, never an installed writer or payment proof.
 * EOA data signatures use a public test key, fake merchants and no network. */
import { beforeAll,afterAll,expect,it,vi } from 'vitest';
// Match the genuine mainnet Source validators before any sticky import while
// keeping every network request trapped and spending keys absent.
const fetchTrap=vi.hoisted(()=>{
 vi.stubEnv('KERYX_NETWORK','arc');vi.stubEnv('NEXT_PUBLIC_KERYX_NETWORK','arc');vi.stubEnv('KERYX_FORCE_OFFLINE','0');
 for(const key of ['KERYX_REGISTRY_ADDRESS','NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS','KERYX_REGISTRY_READ_ADDRESS','NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS'])vi.stubEnv(key,'0x'+'ef'.repeat(20));
 for(const key of ['AGENT_FUNDER_PRIVATE_KEY','BUYER_PRIVATE_KEY','DEPLOYER_PRIVATE_KEY','KERYX_PRIVATE_TREASURY_PRIVATE_KEY','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','CONTENT_MASTER_KEY','KERYX_REGISTRY_ORIGINS','NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS'])vi.stubEnv(key,'');
 for(const key of ['KERYX_STORAGE_MANIFEST','KERYX_SQLITE_PATH','KERYX_USDC_ADDRESS','KERYX_GATEWAY_WALLET','KERYX_GATEWAY_MINTER','KERYX_MAX_TIMEOUT_SECONDS'])vi.stubEnv(key,undefined);
 const fetch=vi.fn(()=>{throw Error('Network forbidden in private Source fixture');});vi.stubGlobal('fetch',fetch);vi.resetModules();return fetch;
});
import { ARC_MAINNET_PROFILE } from '../../arc-network-profile';
import type { PostgresDomainChannel } from './domain-channel';
import type { QueryRun } from '../../types';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,writeFileSync,unlinkSync,existsSync,rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
let transport:typeof import('./private-research-transport'),packets:typeof import('./private-research-packet'),fixture:Awaited<ReturnType<typeof signedFixture>>,Unknown:typeof import('./domain-channel').PostgresDomainWriteOutcomeUnknown;
async function signedFixture(question='Synthetic offline private storage protocol; no supplier or settlement'){
 const {privateKeyToAccount}=await import('viem/accounts'),{createPrivateAuthorization}=await import('../../buyer/private-request-commitment'),{buyerTypedData}=await import('../../buyer/protocol'),{preparePrivateResearchIntent}=await import('../../a2a/private-research-intent');
 const owner=privateKeyToAccount(`0x${'11'.repeat(32)}`),merchants={privatePayee:'0x'+'ab'.repeat(20),publicResearchPayee:'0x'+'cd'.repeat(20)},profile=ARC_MAINNET_PROFILE;
 const requirement={scheme:'exact',network:profile.networkId,asset:profile.usdcAddress,amount:'50000',payTo:merchants.privatePayee,maxTimeoutSeconds:691200,extra:{name:'GatewayWalletBatched',version:'1',verifyingContract:profile.gatewayWallet}};
 const request={question,budget:.03,researchMode:'quick',packageVersion:'1.0.0',responseMode:'async',access:'payer-private-v1',model:null};
 const fresh=await createPrivateAuthorization(request,requirement,owner.address,merchants,1788912000000),signature=await owner.signTypedData(buyerTypedData(fresh.authorization));
 const intent=await preparePrivateResearchIntent({request:fresh.request,salt:fresh.salt,payment:{authorization:fresh.authorization,signature}},requirement,merchants);
 return {intent,payer:owner.address.toLowerCase(),confirmation:{source:'circle-facilitator-success' as const,transaction:'synthetic-no-payment-observation',network:profile.networkId,payer:owner.address.toLowerCase(),payee:merchants.privatePayee,amountMicros:'50000',authorizationId:fresh.authorization.nonce}};
}
beforeAll(async()=>{
 vi.resetModules();transport=await import('./private-research-transport');packets=await import('./private-research-packet');Unknown=(await import('./domain-channel')).PostgresDomainWriteOutcomeUnknown;fixture=await signedFixture();
 // Prepare cold Source imports in setup, outside each bounded fixture's work.
 // Each enrolled case still resets modules and opens its own verified store.
 await import('../enrolled-sqlite-adapter');
});
afterAll(()=>{try{expect(fetchTrap).not.toHaveBeenCalled();}finally{vi.unstubAllEnvs();vi.unstubAllGlobals();}});
const setup=()=>{
 const intent=structuredClone(fixture.intent),id=intent.id,payer=fixture.payer,workerId='f3a21383-c192-411b-8dd9-34a96d01b32b',at='2026-09-09T07:00:00.123+07:00';
 const wire={intentRowWire:JSON.stringify({id,payer,data:JSON.stringify(intent),created_at:at}),paymentRowWire:JSON.stringify({id,started_at:at,confirmation:JSON.stringify(fixture.confirmation),settled_at:at}),executionRowWire:JSON.stringify({id,worker_id:workerId,started_at:at}) as string|null,resultRowWire:null as string|null,interruptionRowWire:null as string|null,reservationRowWire:null as string|null,releaseRowWire:null as string|null,submissionsWire:'[]',confirmationsWire:'[]'};
 const state={closed:false},call=vi.fn<PostgresDomainChannel['call']>().mockResolvedValue(wire),channel:PostgresDomainChannel={get closed(){return state.closed;},call,async close(){state.closed=true;}};
 return {id,payer,workerId,intent,wire,state,call,channel,port:transport.composePostgresPrivateResearch(channel,false)};
};
it('refuses all readonly mutations before getters and rejects provenance callbacks',async()=>{
 const f=setup(),reader=transport.composePostgresPrivateResearch(f.channel,true);let inspected=0;const value={get submission(){inspected++;throw Error('untrusted');}} as never;
 await expect(reader.reservePrivateResearchIntent(value)).rejects.toThrow();await expect(reader.reservePrivateTreasury(f.id,f.payer,value)).rejects.toThrow();await expect(reader.savePrivateResearchResult(f.id,f.payer,f.workerId,value)).rejects.toThrow();
 expect(inspected).toBe(0);expect(f.call).not.toHaveBeenCalled();expect(()=>Reflect.apply(transport.composePostgresPrivateResearch,undefined,[f.channel,false,()=>true])).toThrow();
});
it('verifies genuine signed Source intent and preserves first authorization signature bytes',async()=>{
 const f=setup();f.call.mockImplementation(async operation=>operation==='privateResearchSnapshot'?f.wire:{created:false,snapshot:f.wire});
 const actual=await f.port.reservePrivateResearchIntent(f.intent);expect(packets.privateResearchSha(JSON.stringify(actual))).toBe(packets.privateResearchSha(JSON.stringify(f.intent)));expect(f.call.mock.calls.map(c=>c[0])).toEqual(['privateResearchSnapshot','privateResearchReserveIntent']);
 const packet=JSON.parse(f.call.mock.calls[1][1][1]!);expect(packet.expected.intent).toBe(packets.privateResearchSha(f.wire.intentRowWire));expect(packets.privateResearchSha(packet.valueWire)).toBe(packets.privateResearchSha(JSON.stringify(f.intent)));
 expect(vi.mocked(fetch)).not.toHaveBeenCalled();
});
it('captures result before await and retains raw escaped text without ordinary publication',async()=>{
 const f=setup(),run={id:f.id,question:f.intent.submission.request.question,budget:.03,researchMode:'quick',answer:'Synthetic private\0\ud800',nested:{source:'original'}} as unknown as QueryRun;
 f.call.mockImplementation(async(operation,args)=>{if(operation==='privateResearchSnapshot')return f.wire;const packet=JSON.parse(args[1]!),value=JSON.parse(packet.valueWire) as {serializedRun:string;identity:{runSha256:string}};expect(value.identity.runSha256).toBe(packets.privateResearchSha(value.serializedRun));f.wire.resultRowWire=JSON.stringify({id:f.id,serialized_run:value.serializedRun,saved_at:'2026-09-09T00:00:01.000Z'});return {created:true,snapshot:f.wire};});
 const saved=f.port.savePrivateResearchResult(f.id,f.payer,f.workerId,run);run.answer='caller mutation';expect(JSON.parse((await saved).serializedRun).answer).toBe('Synthetic private\0\ud800');
 expect(f.call.mock.calls.map(c=>c[0])).toEqual(['privateResearchSnapshot','privateResearchSaveResult']);
});
it('only a fresh execution insert returns a worker and unknown acknowledgement is never retried',async()=>{
 const f=setup();f.wire.executionRowWire=null;
 f.call.mockImplementation(async(operation,args)=>{if(operation==='privateResearchSnapshot')return f.wire;const packet=JSON.parse(args[1]!);f.wire.executionRowWire=JSON.stringify({id:f.id,worker_id:JSON.parse(packet.valueWire),started_at:'2026-09-09T00:00:01.000Z'});return {created:true,snapshot:f.wire};});
 const claim=await f.port.claimPrivateResearchExecution(f.id,f.payer);expect(claim?.workerId).toMatch(/^[a-f0-9-]{36}$/);
 f.call.mockClear();f.call.mockImplementation(async operation=>operation==='privateResearchSnapshot'?f.wire:{created:false,snapshot:f.wire});expect(await f.port.claimPrivateResearchExecution(f.id,f.payer)).toBeNull();
 f.call.mockClear();f.call.mockImplementation(async operation=>{if(operation==='privateResearchSnapshot')return f.wire;throw new (await import('./domain-channel')).PostgresDomainWriteOutcomeUnknown();});
 await expect(f.port.claimPrivatePaymentSubmission(f.id,f.payer)).rejects.toBeInstanceOf(Unknown);expect(f.call.mock.calls.map(c=>c[0])).toEqual(['privateResearchSnapshot','privateResearchClaimPayment']);
});
it('treats closure after a submitted private write as unknown and never retries or falls back',async()=>{
 const f=setup();f.call.mockImplementation(async operation=>{if(operation==='privateResearchSnapshot')return f.wire;f.state.closed=true;return {created:false,snapshot:f.wire};});
 await expect(f.port.claimPrivatePaymentSubmission(f.id,f.payer)).rejects.toBeInstanceOf(Unknown);expect(f.call.mock.calls.map(c=>c[0])).toEqual(['privateResearchSnapshot','privateResearchClaimPayment']);
});
it('keeps only the documented committed reservation conflict as a strict refusal envelope',async()=>{
 const f=setup();f.call.mockImplementation(async operation=>operation==='privateResearchSnapshot'?f.wire:{refusal:'treasury-reservation-conflict'});
 await expect(f.port.reservePrivateTreasury(f.id,f.payer,{signer:'0x'+'44'.repeat(20),capacityMicros:'50000'})).rejects.toThrow('Private treasury reservation conflict');
 f.call.mockClear();f.call.mockImplementation(async operation=>operation==='privateResearchSnapshot'?f.wire:{refusal:'catch-all-SQL-error'});
 await expect(f.port.reservePrivateTreasury(f.id,f.payer,{signer:'0x'+'44'.repeat(20),capacityMicros:'50000'})).rejects.toBeInstanceOf(Unknown);expect(f.call.mock.calls).toHaveLength(2);
});
it('retains the original worker after interruption and does not treat metadata as payment or retry authority',async()=>{
 const f=setup();f.wire.interruptionRowWire=JSON.stringify({id:f.id,worker_id:f.workerId,reason:'worker-interrupted',recorded_at:'2026-09-09T00:00:01.000Z'});
 f.call.mockImplementation(async operation=>operation==='privateResearchSnapshot'?f.wire:{created:false,snapshot:f.wire});
 expect(await f.port.interruptPrivateResearch(f.id,f.payer,f.workerId)).toEqual({reason:'worker-interrupted',recordedAt:'2026-09-09T00:00:01.000Z'});
 f.call.mockClear();await expect(f.port.savePrivateResearchResult(f.id,f.payer,'aa1bf6d7-a7df-4b22-81b5-c73fdbda98e4',{id:f.id} as QueryRun)).rejects.toThrow('authority');expect(f.call.mock.calls).toHaveLength(1);
});
it('does not replace genuine intent verification with accepted metadata or a changed signed question',async()=>{
 const f=setup(),changed=structuredClone(f.intent);changed.submission.request.question='Changed after signing';
 await expect(f.port.reservePrivateResearchIntent(changed)).rejects.toThrow('Invalid stored private research intent');expect(f.call).not.toHaveBeenCalled();
 await expect(f.port.reservePrivateResearchIntent({accepted:true,...changed} as never)).rejects.toThrow('Invalid stored private research intent');expect(f.call).not.toHaveBeenCalled();
});
it('rejects wrong payment/result identities and a confirmation with no admitted creator before writes',async()=>{
 const f=setup();await expect(f.port.confirmPrivatePayment(f.id,f.payer,{...fixture.confirmation,amountMicros:'50001'})).rejects.toThrow('confirmation mismatch');
 await expect(f.port.savePrivateResearchResult(f.id,f.payer,f.workerId,{id:f.id,question:'Different signed question',budget:.03,researchMode:'quick',answer:'Synthetic'} as QueryRun)).rejects.toThrow('result mismatch');
 const confirmation={source:'circle-facilitator-success',transaction:'synthetic-no-paid-receipt',submission:{authorizationId:'0x'+'af'.repeat(32),authorizationExpiresAt:'2020-01-01T00:00:00Z',payer:'0x'+'44'.repeat(20),payee:'0x'+'55'.repeat(20),amountMicros:'1',network:ARC_MAINNET_PROFILE.networkId,asset:ARC_MAINNET_PROFILE.usdcAddress.toLowerCase()}} as const;
 await expect(f.port.confirmPrivateCreatorSubmission(f.id,f.payer,f.workerId,confirmation)).rejects.toThrow('submission unavailable');expect(f.call.mock.calls.every(c=>c[0]==='privateResearchSnapshot')).toBe(true);
});
it('pins immutable capacity before await and makes disposal terminal before submission',async()=>{
 const f=setup(),policy={signer:'0x'+'44'.repeat(20),capacityMicros:'50000'};
 f.call.mockImplementation(async(operation,args)=>{if(operation==='privateResearchSnapshot')return f.wire;const value=JSON.parse(JSON.parse(args[1]!).valueWire);f.wire.reservationRowWire=JSON.stringify({job_id:f.id,signer:value.signer,amount_micros:30000});return {created:true,snapshot:f.wire};});
 const pending=f.port.reservePrivateTreasury(f.id,f.payer,policy);policy.capacityMicros='90000';expect(await pending).toBe(true);expect(JSON.parse(JSON.parse(f.call.mock.calls[1][1][1]!).valueWire).capacityMicros).toBe('50000');
 f.call.mockClear();f.call.mockImplementation(async()=>{f.state.closed=true;return f.wire;});await expect(f.port.claimPrivatePaymentSubmission(f.id,f.payer)).rejects.toThrow();expect(f.call.mock.calls.map(c=>c[0])).toEqual(['privateResearchSnapshot']);
});
it('derives result identity from genuine Source validation state and rejects a forged DTO as proof',async()=>{
 const f=setup(),state=await packets.readPrivateResearchSnapshot(f.wire,packets.privateResearchLookup(f.id,f.payer)),wire=JSON.stringify({id:f.id,question:f.intent.submission.request.question,budget:.03,researchMode:'quick',answer:'Raw private\0\ud800'});
 const captured=packets.privateResearchResultIdentity(wire,state);expect(captured).toMatchObject({id:f.id,runSha256:packets.privateResearchSha(wire),owner:f.payer,budgetMicros:'30000',researchMode:'quick'});
 expect(()=>packets.privateResearchResultIdentity(wire,{...state})).toThrow();expect(()=>packets.privateResearchResultIdentity(JSON.stringify({...JSON.parse(wire),question:'Different question'}),state)).toThrow('result mismatch');
});
it('uses the same mandatory raw snapshot on all eight readonly point/ledger reads',async()=>{
 const f=setup(),reader=transport.composePostgresPrivateResearch(f.channel,true),run={id:f.id,question:f.intent.submission.request.question,budget:.03,researchMode:'quick',answer:'Raw private\0\ud800'};
 f.wire.resultRowWire=JSON.stringify({id:f.id,serialized_run:JSON.stringify(run),saved_at:'2026-09-09T07:00:00.123+07:00'});
 expect((await reader.getPrivateResearchResult(f.id,f.payer))?.serializedRun).toBe(JSON.stringify(run));expect((await reader.getPrivateResearchExecution(f.id,f.payer))?.workerId).toBe(f.workerId);
 await reader.getPrivateResearchIntent(f.id,f.payer);await reader.getPrivatePaymentState(f.id,f.payer);await reader.getPrivateResearchInterruption(f.id,f.payer);await reader.getPrivateTreasury(f.id,f.payer);await reader.listPrivateCreatorSubmissions(f.id,f.payer);await reader.getPrivateCreatorConfirmation(f.id,f.payer,'0x'+'aa'.repeat(32));
 expect(f.call.mock.calls).toHaveLength(8);expect(f.call.mock.calls.every(c=>c[0]==='privateResearchSnapshot')).toBe(true);
});
it('captures exact TEXT history cursors and accepts the26-row sentinel through real Source crypto',async()=>{
 const f=setup(),reader=transport.composePostgresPrivateResearch(f.channel,true),before={createdAt:'2026-09-09T07:00:00.123456+07:00',id:f.id};
 f.call.mockResolvedValue(Array.from({length:26},()=>({id:f.id,data:JSON.stringify(f.intent),created_at:'2026-09-09T07:00:00.123+07:00'})));
 const pending=reader.listPrivateResearchHistory(f.payer,before);before.createdAt='changed';const rows=await pending;expect(rows).toHaveLength(26);expect(rows[0].createdAt).toBe('2026-09-09T07:00:00.123+07:00');
 expect(f.call.mock.calls[0][0]).toBe('privateResearchHistory');expect(JSON.parse(f.call.mock.calls[0][1][1]!).before.createdAt).toBe('2026-09-09T07:00:00.123456+07:00');
 f.call.mockClear();await expect(reader.listPrivateResearchHistory(f.payer,{id:f.id,createdAt:'invalid'})).rejects.toThrow();expect(f.call).not.toHaveBeenCalled();
});
it('keeps25/1 candidate hints distinct from execution and reports accounting without balance authority',async()=>{
 const f=setup(),reader=transport.composePostgresPrivateResearch(f.channel,true),after=f.id;
 f.call.mockImplementation(async operation=>operation==='privateResearchSummary'?{capacity:'100000',reservations:[{amount:'30000',released:'10000'}],legs:[]}:[{id:f.id,payer:f.payer}]);
 expect(await reader.listPrivateWorkerCandidates(f.payer,after)).toEqual([{id:f.id,payer:f.payer}]);expect(await reader.listPrivateReconciliationCandidates(f.payer)).toEqual([{id:f.id,payer:f.payer}]);
 expect(await reader.getPrivateTreasurySummary(f.payer)).toMatchObject({capacityMicros:'100000',allocatedMicros:'20000',confirmedMicros:'0',chainFinalityVerified:false,observation:'database-recorded'});
 expect(f.call.mock.calls.map(c=>c[0])).toEqual(['privateResearchWorkers','privateResearchReconciliation','privateResearchSummary']);
 f.call.mockClear();f.call.mockResolvedValue([{id:f.id,payer:f.payer},{id:f.id,payer:f.payer}]);await expect(reader.listPrivateReconciliationCandidates(f.payer)).rejects.toThrow();
});
it.each(['Synthetic\0\ud800 high','Synthetic\udfff low','Synthetic\uFEFF\u2028\u2029\ud83d\ude80 pair'])('derives raw identities from the actual enrolled Source with trimmed/escaped question %s',async question=>{
 vi.resetModules();
 const f=await signedFixture(question),{syntheticStorageIdentity}=await import('../storage-identity-fixture'),{STORAGE_MAINNET_PROFILE_DIGEST}=await import('../storage-identity'),{canonicalJson}=await import('../../canonical-json');
 const {installMainnetApplicationSchema}=await import('../mainnet-application-schema'),{installNativeUserDomainSchema}=await import('../native-user-domain-schema'),{insertStorageIdentity,installStorageFences}=await import('../storage-identity-sqlite');
 const {createEnrolledSqliteAdapter,assertEnrolledSqliteAdapter}=await import('../enrolled-sqlite-adapter');
 const folder=mkdtempSync(join(tmpdir(),'keryx-private-raw-source-')),file=resolve(folder,'source.sqlite'),manifest=resolve(folder,'manifest.json'),identity={...syntheticStorageIdentity('mainnet-real'),format:'keryx-mainnet-storage-identity-v1' as const,network:'eip155:5042' as const,profileDigest:STORAGE_MAINNET_PROFILE_DIGEST};
 const raw=JSON.stringify(f.intent).replace('"question":'+JSON.stringify(f.intent.submission.request.question),'"\\u0071uestion":'+JSON.stringify(' \uFEFF'+question+'\t\uFEFF ')).replace('"budget":0.03','"budget":3e-2').replace('Synthetic','\\u0053ynthetic');
 let source:Awaited<ReturnType<typeof createEnrolledSqliteAdapter>>|undefined;
 try{
  const seed=new DatabaseSync(file);try{seed.exec('BEGIN');installMainnetApplicationSchema(seed,{publicReferenceArchive:true});installNativeUserDomainSchema(seed);seed.prepare('INSERT INTO private_research_intents VALUES(?,?,?,?)').run(f.intent.id,f.payer,raw,'2026-09-09T07:00:00.123456789+07:00');insertStorageIdentity(seed,identity);installStorageFences(seed,identity);seed.exec('COMMIT');}finally{seed.close();}
  writeFileSync(manifest,canonicalJson({format:'keryx-storage-deployment-v1',identity,backend:{kind:'sqlite',databasePath:file}}));vi.stubEnv('KERYX_STORAGE_MANIFEST',manifest);vi.stubEnv('KERYX_SQLITE_PATH',file);vi.stubEnv('CONTENT_MASTER_KEY','11'.repeat(32));
  source=await createEnrolledSqliteAdapter();expect(assertEnrolledSqliteAdapter(source)).toEqual(identity);
  expect((await source.reservePrivateResearchIntent(f.intent)).submission.request.question).toBe(question);
  expect(await source.reservePrivateTreasury(f.intent.id,f.payer,{signer:'0x'+'44'.repeat(20),capacityMicros:'100000'})).toBe(true);
  await source.claimPrivatePaymentSubmission(f.intent.id,f.payer);await source.confirmPrivatePayment(f.intent.id,f.payer,f.confirmation);const claim=await source.claimPrivateResearchExecution(f.intent.id,f.payer);expect(claim).not.toBeNull();
  const leg={kind:'citation' as const,sourceId:'Source\0\ud800\udfff\uFEFF',itemId:'Item\udfff',submission:{authorizationId:'0x'+'af'.repeat(32),authorizationExpiresAt:'2020-01-01T07:00:00+07:00',payer:'0x'+'44'.repeat(20),payee:'0x'+'55'.repeat(20),amountMicros:'10000',network:ARC_MAINNET_PROFILE.networkId,asset:ARC_MAINNET_PROFILE.usdcAddress.toLowerCase()}};
  expect(await source.admitPrivateCreatorSubmission(f.intent.id,f.payer,claim!.workerId,leg)).toBe(true);expect((await source.listPrivateCreatorSubmissions(f.intent.id,f.payer))[0].legId).toBe(packets.privateCreatorLegId(leg as never));
  const run={id:f.intent.id,question,budget:.03,researchMode:'quick',answer:'Unrelated\0\ud800\udfff',trace:[{extension:'Raw\0\ud800\udfff'}]} as unknown as QueryRun;
  await expect(source.savePrivateResearchResult(f.intent.id,f.payer,claim!.workerId,{...run,question:' '+question})).rejects.toThrow('result mismatch');
  const saved=await source.savePrivateResearchResult(f.intent.id,f.payer,claim!.workerId,run),read=new DatabaseSync(file,{readOnly:true});try{
   expect(read.prepare('SELECT data FROM private_research_intents WHERE id=?').get(f.intent.id)!.data).toBe(raw);
   const one=(table:string)=>JSON.stringify(read.prepare('SELECT * FROM '+table+' WHERE id=?').get(f.intent.id));
   const state=await packets.readPrivateResearchSnapshot({intentRowWire:one('private_research_intents'),paymentRowWire:one('private_research_payment_attempts'),executionRowWire:one('private_research_executions'),resultRowWire:one('private_research_results'),interruptionRowWire:null,reservationRowWire:null,releaseRowWire:null,submissionsWire:'[]',confirmationsWire:'[]'},packets.privateResearchLookup(f.intent.id,f.payer));
   const capture=packets.privateResearchResultIdentity(saved.serializedRun,state);expect(capture.questionSha256).toBe(packets.privateResearchSha(JSON.stringify(question)));expect(capture.intentSha256).toBe(packets.privateResearchSha(raw));expect(capture.questionSha256).not.toBe(packets.privateResearchSha(JSON.stringify(' \uFEFF'+question+'\t\uFEFF ')));
  }finally{read.close();}
  expect(vi.mocked(fetch)).not.toHaveBeenCalled();
 }finally{source?.close();vi.stubEnv('KERYX_STORAGE_MANIFEST',undefined);vi.stubEnv('KERYX_SQLITE_PATH',undefined);for(const path of [file,file+'-wal',file+'-shm',file+'-journal',manifest])if(existsSync(path))unlinkSync(path);rmdirSync(folder);}
});
