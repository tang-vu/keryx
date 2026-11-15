import { afterEach,expect,it,vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync,mkdtempSync,unlinkSync,rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';
import { ARC_MAINNET_PROFILE as mainnet,ARC_TESTNET_PROFILE as testnet } from '../../arc-network-profile';
import { browserQueryPolicyTypedData,verifyBrowserQueryPolicy,type BrowserQueryPolicy } from '../../payments/browser-query-policy';
import { prepareBrowserJournal,type BrowserJournalAdmission } from '../browser-authorization-journal';
import { prepareBrowserSigningOriginal } from '../../payments/browser-signing-original';
import { installMainnetApplicationSchema } from '../mainnet-application-schema';
import { installNativeUserDomainSchema } from '../native-user-domain-schema';
import { insertStorageIdentity,installStorageFences } from '../storage-identity-sqlite';
import { openVerifiedSqliteStorage,assertVerifiedSqliteConnection } from '../storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../enrolled-sqlite-schema-profile';
import { STORAGE_MAINNET_PROFILE_DIGEST,validateStorageIdentity } from '../storage-identity';
import { SqliteAdapter } from '../sqlite-adapter';
import { sqliteJournalTransaction } from '../sqlite-browser-journal';
import { canonicalJson } from '../../canonical-json';
import { config } from '../../config';
import { issueSqliteSourceClaimChallenge,verifySqliteSourceClaim,bindSqliteSourceClaim,updateSqliteSourceClaimPolicy } from '../public-source-claims';
import { captureBrowserJournalAdmission,captureBrowserJournalSelector,captureBrowserAuthorizationIntent,captureBrowserJournalGrant,decodeBrowserJournal,browserSigningSnapshot,captureBrowserWithdrawalHistory,decodeBrowserWithdrawalHistory,browserJournalSha256,type BrowserJournalStoredRow } from './browser-journal-packet';
import { composePostgresBrowserJournal } from './browser-journal-transport';
import type { PostgresDomainChannel } from './domain-channel';
import type { SessionGrantRecord } from '../keryx-db';

// Public, unfunded test-only keys sign only the Source historical query policy.
// No configured key, live wallet, RPC, transaction, provider or payment is used.
const owner=privateKeyToAccount(`0x${'13'.repeat(32)}`),signer=privateKeyToAccount(`0x${'14'.repeat(32)}`),payee=`0x${'15'.repeat(20)}`,epoch=randomUUID();
afterEach(()=>{vi.useRealTimers();});
function admission(profile:typeof mainnet|typeof testnet=mainnet,requestId=randomUUID()):BrowserJournalAdmission{
 const queryId=randomUUID();return {sessionId:'synthetic-browser-session',requestId,queryId,grantEpoch:epoch,signer:signer.address,network:profile.networkId,token:profile.usdcAddress,gatewayContract:profile.gatewayWallet,sourceId:'synthetic-browser-source',offerId:null,kind:'fetch',payee,amountMicroUsdc:15700,
 requirements:{scheme:'exact',network:profile.networkId,asset:profile.usdcAddress,payTo:payee,amount:'15700',maxTimeoutSeconds:604900,extra:{name:'GatewayWalletBatched',version:'1',verifyingContract:profile.gatewayWallet}},
 payment:{kind:'fetch',queryId,sourceId:'synthetic-browser-source',sourceName:'retained\ud800source',payer:signer.address,payee,amountUsdc:0.0157,network:profile.networkId,grantEpoch:epoch,rationale:'raw\0metadata\udfff'},paymentContext:{note:'raw\0context\ud800'} as never};
}
async function fixture(run:(core:SqliteAdapter,db:DatabaseSync)=>Promise<void>,v2=false,seed?:(db:DatabaseSync)=>void,active=true){
 const folder=mkdtempSync(join(tmpdir(),'keryx-browser-source-')),file=join(folder,'source.sqlite'),identity=validateStorageIdentity({format:'keryx-mainnet-storage-identity-v1',authorityMode:'mainnet-real',network:mainnet.networkId,profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:new Date().toISOString(),provenanceDigest:'12'.repeat(32)});
 let selected:ReturnType<typeof openVerifiedSqliteStorage>|undefined;
 try{const db=new DatabaseSync(file);try{
  db.exec('BEGIN IMMEDIATE');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);
  // Declared synthetic retained control/capacity/grant originals. This does not
  // activate a production feature, fund a signer or qualify grant admission.
  db.prepare('INSERT INTO browser_signer_capacity(signer,spent_micro) VALUES(?,0)').run(signer.address.toLowerCase());
  db.prepare('INSERT INTO browser_retained_grants(grant_epoch,session_id,signer,spent_micro) VALUES(?,?,?,0)').run(epoch,'synthetic-browser-session',signer.address.toLowerCase());
  db.prepare('INSERT INTO session_grants(session_id,sess_addr,owner_addr,cap,spent,expiry,tx_hash,grant_epoch) VALUES(?,?,?,0.1,0,?,?,?)').run('synthetic-browser-session',signer.address,owner.address,Date.now()+3600000,'synthetic-unfunded-original',epoch);
  if(seed){db.exec('INSERT INTO browser_journal_writer VALUES(1)');try{seed(db);}finally{db.exec('DELETE FROM browser_journal_writer');}}
  db.prepare('UPDATE browser_journal_control SET active=? WHERE id=1').run(Number(active));if(v2)db.prepare('UPDATE browser_signing_v2_control SET active=1 WHERE id=1').run();
  insertStorageIdentity(db,identity);installStorageFences(db,identity);db.exec('COMMIT');
 }finally{db.close();}
 selected=openVerifiedSqliteStorage(file,identity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>{}});
 const core=SqliteAdapter.assembleConnectionCore(selected.db,identity,()=>expect(assertVerifiedSqliteConnection(selected!.db)).toEqual(identity));await run(core,selected.db);
 }finally{selected?.close();for(const path of [file,file+'-wal',file+'-shm',file+'-journal'])if(existsSync(path))unlinkSync(path);rmdirSync(folder);}
}
function stored(db:DatabaseSync,input:BrowserJournalAdmission):BrowserJournalStoredRow|null{return db.prepare(`SELECT i.nonce,i.created_at,i.grant_epoch,i.signer,b.requirements,b.payment_metadata,b.payment_context,b.valid_after,b.valid_before,b.header_hash,p.authorization_phase,p.settlement_status,p.tx_hash,p.authorization_expires_at FROM browser_authorization_intents i JOIN browser_journal_bindings b USING(nonce) JOIN payment_events p ON p.id='x402:'||i.nonce WHERE i.session_id=? AND i.request_id=?`).get(input.sessionId,input.requestId) as unknown as BrowserJournalStoredRow|null;}
it('captures one mainnet nonce before awaits and preserves serialized metadata separately from scalar Source columns',()=>{
 const input=admission(),packet=captureBrowserJournalAdmission(input);input.payment.rationale='mutated';expect(packet.journal.nonce).toMatch(/^0x[0-9a-f]{64}$/);expect(packet.intent.network).toBe(mainnet.networkId);expect(JSON.parse(packet.paymentMetadataWire).rationale).toBe('raw\0metadata\udfff');expect(packet.payment.row.rationale).toBe('raw\0metadata\ufffd');expect(packet.payment.row.source_name).toBe('retained\ufffdsource');expect(packet.payment.unprojectedFields).toEqual(['rationale']);expect(packet.payment.projection.rationale).toBeNull();expect(packet.payment.row.origin).toBe('web');
});
it('keeps legacy intent return originals distinct from Source-bound scalar projection',()=>{
 const input={...admission(),sessionId:'session\ud800'},captured=captureBrowserAuthorizationIntent(input);expect(captured.intent.sessionId).toBe('session\ud800');expect(captured.projection.sessionId).toBe('session\ufffd');expect(captured.projection).not.toHaveProperty('payment');const grant=captureBrowserJournalGrant({sessionId:'session\ud800',sessAddr:signer.address,ownerAddr:owner.address,cap:.1,expiry:Date.now()+60000,txHash:'receipt\ud800',grantEpoch:epoch});expect(grant.grant.sessionId).toBe('session\ufffd');expect(grant.grant.txHash).toBe('receipt\ufffd');
});
it.each([false,true])('binds the same seven Source grant cells with journal active=%s, ignoring caller toJSON before a delayed native write',async(active)=>{
 await fixture(async(core)=>{
  const cells:Omit<SessionGrantRecord,'spent'>={sessionId:'source-grant-session',sessAddr:signer.address,ownerAddr:owner.address,cap:.25,expiry:Date.now()+60000,txHash:'original-source-receipt',grantEpoch:randomUUID()};
  const toJSON=vi.fn(()=>({...cells,sessionId:'toJSON-substituted-session',ownerAddr:payee,cap:99})),ignored=vi.fn(()=>{throw Error('Source does not read extra properties');});
  const raw=Object.defineProperties({...cells},{toJSON:{value:toJSON},ignored:{enumerable:true,get:ignored}});
  let finish!:(value:boolean)=>void;const pendingReply=new Promise<boolean>(resolve=>{finish=resolve;}),call=vi.fn<PostgresDomainChannel['call']>(()=>pendingReply);
  // Test-only fixed transport boundary; this supplies no native facade proof.
  const port=composePostgresBrowserJournal({closed:false,call,async close(){}},false),pending=port.upsertSessionGrant(raw);
  await core.upsertSessionGrant(raw);const saved=await core.getSessionGrant(cells.sessionId);expect(saved).toEqual({...cells,spent:0});expect(await core.getSessionGrant('toJSON-substituted-session')).toBeNull();
  expect(call).toHaveBeenCalledOnce();expect(call.mock.calls[0][0]).toBe('browserJournalAction');expect(call.mock.calls[0][1][0]).toBe('grant');
  const packet=JSON.parse(call.mock.calls[0][1][1]!);expect(packet).toEqual({grant:cells,capMicros:'250000'});expect({...packet.grant,spent:0}).toEqual(saved);
  raw.sessionId='changed-after-capture';raw.cap=9;raw.txHash='changed-after-capture';finish(true);await pending;
  expect(toJSON).not.toHaveBeenCalled();expect(ignored).not.toHaveBeenCalled();expect(JSON.parse(call.mock.calls[0][1][1]!).grant).toEqual(cells);
 },false,undefined,active);
});
it('reads each named grant getter once in Source binding order and ignores serialization hooks',async()=>{
 await fixture(async(core)=>{
  const values:Omit<SessionGrantRecord,'spent'>={sessionId:'getter-source-session',sessAddr:signer.address,ownerAddr:owner.address,cap:.1,expiry:Date.now()+60000,txHash:'source-receipt',grantEpoch:randomUUID()},reads:string[]=[];
  const raw={} as Omit<SessionGrantRecord,'spent'>;
  for(const name of ['sessionId','sessAddr','ownerAddr','cap','expiry','txHash','grantEpoch'] as const)Object.defineProperty(raw,name,{enumerable:true,get(){reads.push(name);return values[name];}});
  const ignored=vi.fn(()=>{throw Error('serialization hook inspected');});Object.defineProperties(raw,{toJSON:{get:ignored},unrelated:{enumerable:true,get:ignored}});
  const captured=captureBrowserJournalGrant(raw);expect(reads).toEqual(['sessionId','sessAddr','ownerAddr','cap','expiry','txHash','grantEpoch']);reads.length=0;
  await core.upsertSessionGrant(raw);expect(reads).toEqual(['sessionId','sessAddr','ownerAddr','cap','expiry','txHash','grantEpoch']);
  expect(await core.getSessionGrant(values.sessionId)).toEqual({...captured.grant,spent:0});expect(ignored).not.toHaveBeenCalled();
 },false,undefined,false);
});
it('reproduces genuine selected mainnet plain journal reads with NUL and escaped lone UTF-16 originals',async()=>{
 await fixture(async(core,db)=>{const input=admission(),result=await core.admitBrowserJournal(input);expect(result.status).toBe('admitted');const actual=await core.getBrowserJournal(input.sessionId,input.requestId);expect(decodeBrowserJournal(stored(db,input),captureBrowserJournalSelector(input.sessionId,input.requestId))).toEqual(actual);expect(actual!.payment.rationale).toBe('raw\0metadata\udfff');expect(db.prepare('SELECT rationale FROM payment_events').get()!.rationale).toBe('raw\0metadata\ufffd');expect(JSON.parse(String(db.prepare('SELECT payment_context FROM browser_journal_bindings').get()!.payment_context)).note).toBe('raw\0context\ud800');});
});
it('uses the item managed receipt when the direct Source context claim is explicitly null',async()=>{
 const previous={baseUrl:config.baseUrl,registryReadAddress:config.registryReadAddress,registryOrigins:config.registryOrigins};Object.assign(config,{baseUrl:'https://keryx.cc',registryReadAddress:`0x${'37'.repeat(20)}`,registryOrigins:''});
 try{await fixture(async(core,db)=>{
  const input=admission(),wallet=payee,url='https://synthetic-browser-claim.invalid/article',onchain=`0x${'35'.repeat(32)}`,at=Date.now()-3000;
  db.prepare('INSERT INTO sources(id,name,url,wallet_address,onchain_id,active,verified) VALUES(?,?,?,?,?,1,1)').run(input.sourceId,input.sourceId,url,wallet,onchain);
  // Genuine Source history producers over declared synthetic control evidence;
  // no verifier request, signature, provider or funding authority is exercised.
  const challenge=issueSqliteSourceClaimChallenge(db,{canonicalUrl:url,wallet,deploymentOrigin:'https://keryx.cc',network:mainnet.networkId,now:at}),verified=verifySqliteSourceClaim(db,{challengeId:challenge.id,wallet,proofDigest:'36'.repeat(32),now:at+1}),linked=bindSqliteSourceClaim(db,{claimId:verified.id,wallet,expectedRevision:verified.revision,sourceId:input.sourceId,onchainId:onchain,registryAddress:config.registryReadAddress.toLowerCase(),now:at+2}),paid=updateSqliteSourceClaimPolicy(db,{claimId:linked.id,wallet,expectedRevision:linked.revision,mode:'paid',distributionPermission:true,now:at+3});
  const receipt={id:paid.id,revision:paid.revision,mode:paid.mode,effectiveAt:paid.effectiveAt,verifiedAt:paid.verifiedAt};input.payment.sourceClaim=receipt;input.paymentContext={sourceClaim:null,item:{sourceClaim:receipt}} as never;
  expect(captureBrowserJournalAdmission(input).contextConflict).toBe(false);expect((await core.admitBrowserJournal(input)).status).toBe('admitted');
  const retained=await core.getBrowserJournal(input.sessionId,input.requestId);expect(retained!.payment.sourceClaim).toEqual(receipt);expect(retained!.paymentContext).toEqual({sourceClaim:null,item:{sourceClaim:receipt}});
 });}finally{Object.assign(config,previous);}
});
it('retains original epochs and alias signer consumption, and only prepared cancellation releases once',async()=>{
 await fixture(async(core,db)=>{const input=admission(),result=await core.admitBrowserJournal(input);expect(result.status).toBe('admitted');const oldSpent=db.prepare('SELECT spent_micro FROM browser_signer_capacity').get()!.spent_micro;expect(oldSpent).toBe(15700);
  sqliteJournalTransaction(db,()=>db.prepare('UPDATE session_grants SET expiry=0 WHERE session_id=?').run(input.sessionId));
  // The low-level Source CAS has no fresh grant check; the actual consumer must
  // recheck its captured grant at its last authority boundary before exposure.
  expect(await core.exposeBrowserJournal(input.sessionId,input.requestId)).toBe(true);expect(await core.cancelPreparedBrowserJournal(input.sessionId,input.requestId)).toBe(false);expect(db.prepare('SELECT spent_micro FROM browser_signer_capacity').get()!.spent_micro).toBe(15700);
  expect(await core.submitBrowserJournal(input.sessionId,input.requestId)).toBe(false);
 });
 await fixture(async(core,db)=>{const input=admission();await core.admitBrowserJournal(input);expect(await core.cancelPreparedBrowserJournal(input.sessionId,input.requestId)).toBe(true);expect(await core.cancelPreparedBrowserJournal(input.sessionId,input.requestId)).toBe(false);expect(db.prepare('SELECT spent_micro FROM browser_signer_capacity').get()!.spent_micro).toBe(0);expect(db.prepare('SELECT spent_micro FROM browser_retained_grants').get()!.spent_micro).toBe(0);});
});
it('preserves Source active grant update refusals, retained expiry-zero revocation and expired cleanup no-op',async()=>{
 await fixture(async(core,db)=>{
  const id='synthetic-browser-session',before=await core.getSessionGrant(id);expect(before!.spent).toBe(0);
  expect(await core.addSessionGrantSpend('missing',epoch,signer.address,.01)).toBe(false);await core.releaseSessionGrantSpend('missing',epoch,signer.address,.01);
  await expect(core.addSessionGrantSpend(id,epoch,signer.address,.01)).rejects.toThrow('browser journal writer required');await expect(core.releaseSessionGrantSpend(id,epoch,signer.address,.01)).rejects.toThrow('browser journal writer required');
  await core.deleteExpiredSessionGrants(Number.POSITIVE_INFINITY);expect(await core.getSessionGrant(id)).toEqual(before);
  expect(await core.revokeSessionGrant(id,'wrong',signer.address)).toBe(false);expect(await core.revokeSessionGrant(id,epoch,signer.address)).toBe(true);expect(await core.revokeSessionGrant(id,epoch,signer.address)).toBe(true);
  expect((await core.getSessionGrant(id))!.expiry).toBe(0);await core.deleteSessionGrant(id);expect((await core.getSessionGrant(id))!.expiry).toBe(0);
  expect(db.prepare('SELECT count(*) n FROM browser_retained_grants').get()!.n).toBe(1);expect(db.prepare('SELECT spent_micro FROM browser_signer_capacity').get()!.spent_micro).toBe(0);
 });
});
it('uses Source inactive binary64 ROUND(x,6), exact cap predicate and actual row deletion',async()=>{
 await fixture(async(core,db)=>{
  const id='synthetic-browser-session',fresh=()=>core.getSessionGrant(id);
  for(const [amount,spent] of [[.0000005,0],[.0000015,.000002],[.01,.010002],[-.000002,.01]] as const){expect(await core.addSessionGrantSpend(id,epoch,signer.address,amount)).toBe(true);expect((await fresh())!.spent).toBe(spent);}
  expect(await core.addSessionGrantSpend(id,epoch,signer.address,.1)).toBe(false);await core.releaseSessionGrantSpend(id,epoch,signer.address,.05);expect((await fresh())!.spent).toBe(0);
  expect(db.prepare('SELECT round(?,6) r').get(123456789.1234565)!.r).toBe(123456789.123456);
  await core.deleteExpiredSessionGrants(Date.now()-1);expect(await fresh()).not.toBeNull();expect(await core.revokeSessionGrant(id,epoch,signer.address)).toBe(true);expect(await fresh()).toBeNull();
 },false,undefined,false);
});
it('matches genuine Source bounded withdrawal history, raw payment overlays and strict signer/cursor inputs',async()=>{
 await fixture(async(core,db)=>{
  for(let n=0;n<3;n++)expect((await core.admitBrowserJournal(admission())).status).toBe('admitted');
  const selector=captureBrowserWithdrawalHistory(signer.address.toLowerCase(),'',2),expected=await core.listSessionWithdrawalPayments(selector.signer,'',2);
  const rows=db.prepare('SELECT * FROM browser_authorization_intents WHERE lower(signer)=? ORDER BY nonce LIMIT 2').all(selector.signer).map(i=>({selector:captureBrowserJournalSelector(String(i.session_id),String(i.request_id)),intent:i,binding:db.prepare('SELECT * FROM browser_journal_bindings WHERE nonce=?').get(i.nonce),paymentWire:JSON.stringify(db.prepare("SELECT * FROM payment_events WHERE id='x402:'||?").get(i.nonce))}));
  const wire=JSON.stringify({selector,rows,hasMore:true}),decoded=decodeBrowserWithdrawalHistory({wire,sha256:browserJournalSha256(wire)},selector);expect(decoded).toEqual(expected);expect(decoded.payments[0].payment.rationale).toBe('raw\0metadata\udfff');
  expect((await core.listSessionWithdrawalPayments(selector.signer,expected.nextCursor!,2)).payments).toHaveLength(1);await expect(core.listSessionWithdrawalPayments(signer.address,'',2)).rejects.toThrow('Withdrawal payment history unavailable');
  expect(()=>decodeBrowserWithdrawalHistory({wire,sha256:'00'.repeat(32)},selector)).toThrow('history unavailable');
 });
});
it('derives duplicate-epoch activation from actual Source full-table rowid scan order, not key order',async()=>{
 for(const ids of [['z-first','a-last'],['a-first','z-last']])await fixture(async(core,db)=>{
  const plan=db.prepare('EXPLAIN QUERY PLAN SELECT * FROM session_grants').all();expect(plan.some(p=>String(p.detail)==='SCAN session_grants')).toBe(true);
  const rows=db.prepare('SELECT rowid,session_id,spent FROM session_grants').all();expect(rows.map(r=>r.session_id)).toEqual(ids);
  expect(db.prepare('PRAGMA table_info(session_grants)').all().map(c=>c.name)).toEqual(['session_id','sess_addr','owner_addr','cap','spent','expiry','tx_hash','grant_epoch']);
  await core.activateBrowserJournal();expect(db.prepare('SELECT session_id,spent_micro FROM browser_retained_grants WHERE grant_epoch=?').get(epoch)).toEqual({session_id:ids[1],spent_micro:30000});
 },false,db=>{
  db.exec('DELETE FROM session_grants;DELETE FROM browser_retained_grants;DELETE FROM browser_signer_capacity');
  for(const [n,id] of ids.entries())db.prepare('INSERT INTO session_grants VALUES(?,?,?,?,?,?,?,?)').run(id,signer.address,owner.address,.1,n===0?.02:.03,Date.now()+3600000,'synthetic-row-order',epoch);
 },false);
});
it('proves Source signed metadata replay uses caller strings before SQLite scalar binding',async()=>{
 await fixture(async(core,db)=>{const input=admission();await core.admitBrowserJournal(input);await core.exposeBrowserJournal(input.sessionId,input.requestId);
  const metadata={validAfter:'',validBefore:'0x10',headerHash:'raw\ud800'};expect(await core.signBrowserJournal(input.sessionId,input.requestId,metadata)).toBe(true);
  expect(db.prepare('SELECT header_hash,valid_after FROM browser_journal_bindings').get()).toEqual({header_hash:'raw\ufffd',valid_after:''});expect(await core.signBrowserJournal(input.sessionId,input.requestId,metadata)).toBe(false);expect(await core.signBrowserJournal(input.sessionId,input.requestId,{...metadata,headerHash:'raw\ufffd'})).toBe(true);expect((await core.getBrowserJournal(input.sessionId,input.requestId))!.payment.authorizationExpiresAt).toBe('1970-01-01T00:00:16.000Z');
 });
});
it('retains Source expanded expiry dates and NUL scalar metadata without treating them as absence',async()=>{
 await fixture(async(core,db)=>{const input=admission();await core.admitBrowserJournal(input);await core.exposeBrowserJournal(input.sessionId,input.requestId);const metadata={validAfter:'source\0scalar',validBefore:'253402300800',headerHash:'synthetic-metadata-only'};expect(await core.signBrowserJournal(input.sessionId,input.requestId,metadata)).toBe(true);expect(db.prepare('SELECT valid_after FROM browser_journal_bindings').get()!.valid_after).toBe('source\0scalar');expect((await core.getBrowserJournal(input.sessionId,input.requestId))!.payment.authorizationExpiresAt).toBe('+010000-01-01T00:00:00.000Z');
  // Source accepts this low-level metadata observation. Native scalar NUL must
  // remain an explicit compatibility hold, never a sanitized/NULL authority.
 });
});
it('preserves actual mainnet Source query-policy admission as historical proof and blind replay after expiry',async()=>{
 await fixture(async(core,db)=>{
  const p:BrowserQueryPolicy={protocol:'durable-v2',service:'https://keryx.cc',owner:owner.address,signer:signer.address,policyId:`0x${'16'.repeat(32)}`,grantEpoch:epoch,requestNonce:`0x${'17'.repeat(32)}`,queryId:randomUUID(),questionDigest:`0x${'18'.repeat(32)}`,queryCeilingMicros:'15700',lifetimeCeilingMicros:'100000',jobLimit:2,expiresAt:Date.now()+60000},proof={policy:p,signature:await owner.signTypedData(browserQueryPolicyTypedData(p))},verified=await verifyBrowserQueryPolicy(proof);
  expect(await core.admitBrowserQueryPolicy(proof,'synthetic-browser-session')).toEqual({status:'admitted',namespace:verified.namespace,queryId:p.queryId});
  expect(db.prepare('SELECT network FROM browser_signing_namespaces').get()!.network).toBe(testnet.networkId);
  expect(String(db.prepare('SELECT proof FROM browser_signing_queries').get()!.proof)).toBe(canonicalJson({policy:verified.policy,signature:verified.signature}));
  sqliteJournalTransaction(db,()=>db.prepare('UPDATE session_grants SET expiry=0 WHERE session_id=?').run('synthetic-browser-session'));
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(p.expiresAt+1);
  expect(await core.admitBrowserQueryPolicy(proof,'synthetic-browser-session')).toEqual({status:'admitted',namespace:verified.namespace,queryId:p.queryId});expect(db.prepare('SELECT allocated_micro FROM browser_signing_namespaces').get()!.allocated_micro).toBe(15700);
 },true);
});
it('proves fresh durable originals remain closed by actual selected mainnet Source profile guards',async()=>{
 await fixture(async(core,db)=>{
  const input=admission(),body={queryNamespace:`0x${'19'.repeat(32)}`,queryId:input.queryId,journal:input};await expect(core.admitBrowserSigningOriginal(body)).rejects.toThrow('Invalid browser authorization intent');expect(db.prepare('SELECT count(*) n FROM browser_authorization_intents').get()!.n).toBe(0);
  const historical=admission(testnet),namespace=`0x${'1a'.repeat(32)}`,policy={owner:owner.address.toLowerCase(),signer:signer.address.toLowerCase(),grantEpoch:epoch,expiresAt:Date.now()+60000};
  // Imported historical policy facts are not a signed proof or an activation.
  // They permit reaching the real new-intent profile guard; it must roll back.
  db.prepare('INSERT INTO browser_signing_namespaces VALUES(?,?,?,?,?,?,?,?,?,?)').run(namespace,policy.owner,policy.signer,'https://keryx.cc',testnet.networkId,100000,2,15700,1,JSON.stringify({policy}));
  db.prepare('INSERT INTO browser_signing_queries VALUES(?,?,?,?,?,?,?,?,?,0)').run(historical.queryId,namespace,'policy','request',historical.sessionId,epoch,JSON.stringify({policy}),'digest',15700);
  expect(prepareBrowserSigningOriginal(prepareBrowserJournal(historical),namespace).domain.chainId).toBe(testnet.chainId);
  await expect(core.admitBrowserSigningOriginal({queryNamespace:namespace,queryId:historical.queryId,journal:historical})).rejects.toThrow('storage authority profile mismatch');
  expect(db.prepare('SELECT count(*) n FROM browser_authorization_intents').get()!.n).toBe(0);expect(db.prepare('SELECT spent_micro FROM browser_signing_queries').get()!.spent_micro).toBe(0);expect(db.prepare('SELECT count(*) n FROM browser_signing_originals').get()!.n).toBe(0);expect(db.prepare('SELECT count(*) n FROM browser_journal_writer').get()!.n).toBe(0);
 },true);
});
it('retains Source-accepted nonempty historical original observations separately from fresh mainnet authority',async()=>{
 const input=admission(),captured=captureBrowserJournalAdmission(input),p:BrowserQueryPolicy={protocol:'durable-v2',service:'https://keryx.cc',owner:owner.address,signer:signer.address,policyId:`0x${'21'.repeat(32)}`,grantEpoch:epoch,requestNonce:`0x${'22'.repeat(32)}`,queryId:input.queryId,questionDigest:`0x${'23'.repeat(32)}`,queryCeilingMicros:'15700',lifetimeCeilingMicros:'100000',jobLimit:2,expiresAt:Date.now()+60000},proof={policy:p,signature:await owner.signTypedData(browserQueryPolicyTypedData(p))},verified=await verifyBrowserQueryPolicy(proof),original=prepareBrowserSigningOriginal(captured.journal,verified.namespace),originalWire=canonicalJson(original);
 const historical={...input,network:testnet.networkId,token:testnet.usdcAddress,gatewayContract:testnet.gatewayWallet,requirements:{...input.requirements,network:testnet.networkId,asset:testnet.usdcAddress,extra:{...input.requirements.extra,verifyingContract:testnet.gatewayWallet}},payment:{...input.payment,network:testnet.networkId}},replay={queryNamespace:verified.namespace,queryId:input.queryId,journal:historical},inputWire=canonicalJson(replay);
 await fixture(async(core,db)=>{const snapshot=await core.readBrowserSigningSnapshot(owner.address,input.sessionId,input.requestId);expect(snapshot!.original).toEqual(original);expect(snapshot!.original.domain.chainId).toBe(5042002);expect(snapshot!.journal.payment.network).toBe(mainnet.networkId);expect(snapshot!.namespace.network).toBe(testnet.networkId);
  expect(await browserSigningSnapshot({selector:captureBrowserJournalSelector(input.sessionId,input.requestId),intent:db.prepare('SELECT * FROM browser_authorization_intents').get()!,binding:db.prepare('SELECT * FROM browser_journal_bindings').get()!,paymentWire:JSON.stringify(db.prepare('SELECT * FROM payment_events').get()),original:db.prepare('SELECT * FROM browser_signing_originals').get()!,query:db.prepare('SELECT * FROM browser_signing_queries').get()!,namespace:db.prepare('SELECT * FROM browser_signing_namespaces').get()!,grant:db.prepare('SELECT * FROM session_grants').get()!,signerSpent:'15700',epochSpent:'15700',controls:{journalActive:true,signingActive:true,floor:2,ever:1}},{owner:owner.address.toLowerCase()})).toEqual(snapshot);
  expect((await core.admitBrowserSigningOriginal(replay)).status).toBe('admitted');expect(db.prepare('SELECT original,input FROM browser_signing_originals').get()).toEqual({original:originalWire,input:inputWire});expect(db.prepare('SELECT spent_micro FROM browser_signing_queries').get()!.spent_micro).toBe(15700);},true,db=>{
  const intent=captured.intent,keys=Object.keys(intent);db.prepare(`INSERT INTO browser_authorization_intents(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(intent));db.prepare('INSERT INTO browser_journal_bindings(nonce,requirements,payment_metadata,payment_context) VALUES(?,?,?,?)').run(captured.journal.nonce,captured.requirementsWire,captured.paymentMetadataWire,captured.paymentContextWire);const row=captured.payment.row,cols=Object.keys(row);db.prepare(`INSERT INTO payment_events(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).run(...Object.values(row));
  db.prepare('INSERT INTO browser_signing_namespaces VALUES(?,?,?,?,?,?,?,?,?,?)').run(verified.namespace,verified.policy.owner,verified.policy.signer,'https://keryx.cc',testnet.networkId,100000,2,15700,1,canonicalJson({policy:verified.policy,signature:verified.signature}));db.prepare('INSERT INTO browser_signing_queries VALUES(?,?,?,?,?,?,?,?,?,?)').run(input.queryId,verified.namespace,p.policyId,p.requestNonce,input.sessionId,epoch,canonicalJson({policy:verified.policy,signature:verified.signature}),verified.proofDigest,15700,15700);db.prepare('INSERT INTO browser_signing_originals VALUES(?,?,?,?)').run(captured.journal.nonce,input.queryId,originalWire,inputWire);db.prepare('UPDATE browser_signer_capacity SET spent_micro=15700').run();db.prepare('UPDATE browser_retained_grants SET spent_micro=15700').run();db.prepare('UPDATE session_grants SET spent=.0157').run();
 });
});
