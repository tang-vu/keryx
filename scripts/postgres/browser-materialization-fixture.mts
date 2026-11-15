/** Fixed disposable Source corpus. Historical public test-key query signatures
 * are metadata conformance only, never mainnet payment/funding authority. */
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Client } from 'pg';
import { privateKeyToAccount } from 'viem/accounts';
import { ARC_MAINNET_PROFILE as mainnet,ARC_TESTNET_PROFILE as historical } from '../../lib/arc-network-profile';
import { canonicalJson } from '../../lib/canonical-json';
import { browserQueryPolicyTypedData,verifyBrowserQueryPolicy,type BrowserQueryPolicy } from '../../lib/payments/browser-query-policy';
import { prepareBrowserSigningOriginal } from '../../lib/payments/browser-signing-original';
import type { BrowserJournalAdmission } from '../../lib/db/browser-authorization-journal';
import { captureBrowserJournalAdmission } from '../../lib/db/postgres/browser-journal-packet';
import { capturePaymentEvent } from '../../lib/db/postgres/payment-events-packet';

const permanent=['browser_signing_namespaces','browser_signing_queries','browser_signing_originals'] as const;
const writers=['browser_journal_writer','browser_signing_v2_writer','browser_signing_v3_writer'] as const;
export async function seedBrowserMaterializationFixture(db:DatabaseSync){
 assert(db.isTransaction);assert.equal(db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='keryx_storage_identity'").get()!.n,0);
 for(const table of [...permanent,...writers,'payment_events','browser_authorization_intents','browser_journal_bindings','session_grants','browser_retained_grants','browser_signer_capacity'])assert.equal(db.prepare('SELECT count(*) n FROM '+table).get()!.n,0);
 const owner=privateKeyToAccount(`0x${'43'.repeat(32)}`),signer=privateKeyToAccount(`0x${'44'.repeat(32)}`),payee=`0x${'45'.repeat(20)}`,sessionId='synthetic-materialization-browser-session',grantEpoch=randomUUID(),queryId=randomUUID(),now=Date.now();
 const input:BrowserJournalAdmission={sessionId,requestId:'synthetic-materialization-browser-request',queryId,grantEpoch,signer:signer.address,network:mainnet.networkId,token:mainnet.usdcAddress,gatewayContract:mainnet.gatewayWallet,sourceId:'synthetic-materialization-browser-source',offerId:null,kind:'fetch',payee,amountMicroUsdc:15000,
  requirements:{scheme:'exact',network:mainnet.networkId,asset:mainnet.usdcAddress,payTo:payee,amount:'15000',maxTimeoutSeconds:604900,extra:{name:'GatewayWalletBatched',version:'1',verifyingContract:mainnet.gatewayWallet}},
  payment:{kind:'fetch',queryId,sourceId:'synthetic-materialization-browser-source',sourceName:'\uFEFFSynthetic Source',payer:signer.address,payee,amountUsdc:.015,network:mainnet.networkId,grantEpoch,rationale:'retained\0metadata\ud800-high\udfff'},paymentContext:{note:'Source JSON\0\ud800-high\udfff'} as never};
 const captured=captureBrowserJournalAdmission(input),policy:BrowserQueryPolicy={protocol:'durable-v2',service:'https://keryx.cc',owner:owner.address,signer:signer.address,policyId:`0x${'46'.repeat(32)}`,grantEpoch,requestNonce:`0x${'47'.repeat(32)}`,queryId,questionDigest:`0x${'48'.repeat(32)}`,queryCeilingMicros:'30000',lifetimeCeilingMicros:'1000000',jobLimit:10,expiresAt:now+600000};
 const proof={policy,signature:await owner.signTypedData(browserQueryPolicyTypedData(policy))},verified=await verifyBrowserQueryPolicy(proof);
 const historicalInput={...input,network:historical.networkId,token:historical.usdcAddress,gatewayContract:historical.gatewayWallet,requirements:{...input.requirements,network:historical.networkId,asset:historical.usdcAddress,extra:{...input.requirements.extra,verifyingContract:historical.gatewayWallet}},payment:{...input.payment,network:historical.networkId}};
 const originalWire=' \n'+canonicalJson(prepareBrowserSigningOriginal(captured.journal,verified.namespace))+'\n',inputWire=' \n'+canonicalJson({queryNamespace:verified.namespace,queryId,journal:historicalInput})+'\n',proofWire=' '+canonicalJson({policy:verified.policy,signature:verified.signature})+'\n';
 db.prepare('INSERT INTO session_grants VALUES(?,?,?,?,?,?,?,?)').run(sessionId,signer.address,owner.address,1,.015,now+3600000,'synthetic-unfunded',grantEpoch);
 db.prepare('INSERT INTO browser_signer_capacity VALUES(?,15000)').run(signer.address.toLowerCase());db.prepare('INSERT INTO browser_retained_grants VALUES(?,?,?,15000)').run(grantEpoch,sessionId,signer.address.toLowerCase());
 // Declared retained Source records precede enrollment. These rows do not
 // claim acceptance by a fresh mainnet durable-original producer.
 db.exec('INSERT INTO browser_journal_writer VALUES(1)');try{
  const intent=captured.intent,keys=Object.keys(intent);db.prepare(`INSERT INTO browser_authorization_intents(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(intent));
  db.prepare('INSERT INTO browser_journal_bindings(nonce,requirements,payment_metadata,payment_context) VALUES(?,?,?,?)').run(captured.journal.nonce,captured.requirementsWire,captured.paymentMetadataWire,captured.paymentContextWire);
  const p=captured.payment.row,paymentKeys=Object.keys(p);db.prepare(`INSERT INTO payment_events(${paymentKeys.join(',')}) VALUES(${paymentKeys.map(()=>'?').join(',')})`).run(...Object.values(p));
  db.prepare('INSERT INTO browser_signing_namespaces VALUES(?,?,?,?,?,?,?,?,?,?)').run(verified.namespace,verified.policy.owner,verified.policy.signer,'https://keryx.cc',historical.networkId,1000000,10,30000,1,proofWire);
  db.prepare('INSERT INTO browser_signing_queries VALUES(?,?,?,?,?,?,?,?,?,?)').run(queryId,verified.namespace,verified.policy.policyId,verified.policy.requestNonce,sessionId,grantEpoch,proofWire,verified.proofDigest,30000,15000);
  db.prepare('INSERT INTO browser_signing_originals VALUES(?,?,?,?)').run(captured.journal.nonce,queryId,originalWire,inputWire);
 }finally{db.exec('DELETE FROM browser_journal_writer');}
 for(const [id,date,sourceName,rationale] of [['canonical','2026-11-14T00:00:00.000Z','\uFEFFsynthetic Source',null],['raw','2026-11-14T07:00:00.123456789+07:00','metadata\0Source','null']] as const){
  const p=capturePaymentEvent({id:'synthetic-materialization-payment-'+id,createdAt:date,kind:'citation',queryId:'synthetic-materialization-query',sourceId:'synthetic-materialization-source',sourceName,payer:signer.address,payee,amountUsdc:.005,network:mainnet.networkId,settled:false,settlementStatus:'pending',...(rationale===null?{}:{rationale})}).row,keys=Object.keys(p);
  db.prepare(`INSERT INTO payment_events(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(p));
 }
 db.exec('UPDATE browser_journal_control SET active=1 WHERE id=1;UPDATE browser_signing_v2_control SET active=1 WHERE id=1');
 for(const table of writers)assert.equal(db.prepare('SELECT count(*) n FROM '+table).get()!.n,0);
 assert.equal(db.prepare("SELECT count(*) n FROM payment_events WHERE settled<>0 OR settlement_status<>'pending'").get()!.n,0);
 return {permanentBrowserTables:3,pendingPayments:3,historicalQueryDomain:5042002,mainnetFundingProof:false,providerActions:0,jobActions:0};
}

/** Fixed public raw-cell readback. No JSON parsing/reserialization of retained
 * proof/original/input strings and no caller table/SQL selector. */
export async function assertBrowserMaterializationFixture(db:DatabaseSync,client:Client){
 assert(db.isTransaction&&db.prepare('PRAGMA query_only').get()?.query_only===1);let rows=0;const hash=createHash('sha256');
 for(const name of permanent){
  const columns=db.prepare('PRAGMA table_info('+name+')').all().map(c=>String(c.name));assert(columns.every(c=>/^[a-z_]+$/.test(c)));const key=name==='browser_signing_namespaces'?'namespace':name==='browser_signing_queries'?'query_id':'nonce';
  const source=db.prepare('SELECT * FROM '+name+' ORDER BY '+key+' COLLATE BINARY').all();assert(source.length>0&&source.length<=100);
  const native=await client.query('SELECT '+columns.map(c=>'"'+c+'"::text AS "'+c+'"').join(',')+' FROM public.'+name+' ORDER BY '+key+' COLLATE "C"');assert.equal(native.rowCount,source.length);
  for(const [index,row] of source.entries()){const expected=Object.fromEntries(columns.map(c=>[c,row[c]===null?null:String(row[c])]));assert(canonicalJson(native.rows[index])===canonicalJson(expected),'Browser Source raw cells changed');hash.update(canonicalJson(expected)).update('\n');rows++;}
 }
 for(const table of writers){assert.equal(db.prepare('SELECT count(*) n FROM '+table).get()!.n,0);assert.equal((await client.query('SELECT count(*)::text n FROM public.'+table)).rows[0].n,'0');}
 return {rawBrowserRows:rows,rawBrowserSha256:hash.digest('hex'),sourceWriterRowsCopied:0};
}
