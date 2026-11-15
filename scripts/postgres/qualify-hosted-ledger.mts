/** Retained ledger qualification only. Originals/dependency rows below are
 * synthetic fixture imports, not accepted authorization/private-job admission. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomBytes,randomUUID } from "node:crypto";
import { ARC_MAINNET_PROFILE as profile } from "../../lib/arc-network-profile";
import { canonicalJson } from "../../lib/canonical-json";
import { installMainnetApplicationSchema } from "../../lib/db/mainnet-application-schema";
import { sqliteJournalTransaction } from "../../lib/db/sqlite-browser-journal";
import { sqliteHostedAccounting,admitSqliteHostedPolicy,submitSqliteHostedAuthorization,confirmSqliteHostedAuthorization } from "../../lib/db/hosted-treasury-journal";
import { hostedTreasuryPolicyDigest,type HostedTreasuryPolicy } from "../../lib/payments/hosted-treasury-policy";
import { storageIdentityDigest,type StorageIdentity } from "../../lib/db/storage-identity";
import type { PostgresConnectionOptions } from "../../lib/db/postgres/connection";
import { createPostgresHostedLedgerTransport,type PostgresHostedLedgerTransport,type PostgresHostedPaymentProtocol,HOSTED_PAYMENT_SOURCE_RECEIPT_PREFIX } from "../../lib/db/postgres/hosted-ledger-transport";
import { PostgresDomainWriteOutcomeUnknown } from "../../lib/db/postgres/domain-channel";
import { startCommitAckLossProxy } from "./commit-ack-loss.mts";
import { captureObservedPaymentFixture } from "./qualify-payment-events.mts";
import { paymentEventWireSha256 } from "../../lib/db/postgres/payment-events-packet";

type Row=Record<string,string|number|null>;
const wallet=()=>`0x${randomBytes(20).toString('hex')}`,nonce=()=>`0x${randomBytes(32).toString('hex')}`;
const expiry=String(Math.floor(Date.now()/1000)+605000),payee=wallet();
function policy(identity:StorageIdentity,signer=wallet()):HostedTreasuryPolicy{
  return{format:'keryx-hosted-treasury-policy-v1',network:profile.networkId,storageIdentityDigest:storageIdentityDigest(identity),origin:'https://keryx.cc',signer,
    lifetimeCapMicroUsdc:'1000000',queryCapMicroUsdc:'100000',expiresAtSeconds:Math.floor(Date.now()/1000)+3600};
}
function original(p:HostedTreasuryPolicy,privateJob=false){
  const id=nonce(),jobId=`prv_${randomBytes(32).toString('hex')}`,workerId=randomUUID();
  const context={kind:'fetch',queryId:jobId,queryBudgetMicroUsdc:'20',sourceId:'synthetic-source',itemId:null,privateJob:privateJob?{id:jobId,owner:wallet(),workerId}:null};
  const payload={domain:{name:'GatewayWalletBatched',version:'1',chainId:profile.chainId,verifyingContract:profile.gatewayWallet},primaryType:'TransferWithAuthorization',
    types:{TransferWithAuthorization:[{name:'from',type:'address'},{name:'to',type:'address'},{name:'value',type:'uint256'},{name:'validAfter',type:'uint256'},{name:'validBefore',type:'uint256'},{name:'nonce',type:'bytes32'}]},
    message:{from:p.signer,to:payee,value:'7',validAfter:String(Math.floor(Date.now()/1000)-600),validBefore:expiry,nonce:id}};
  const submission={authorizationId:id,authorizationExpiresAt:new Date(Number(expiry)*1000).toISOString(),payer:p.signer,payee,amountMicros:'7',network:profile.networkId,asset:profile.usdcAddress.toLowerCase()};
  const payment:Row={id:'x402:'+id,created_at:new Date().toISOString(),kind:'fetch',query_id:jobId,source_id:'synthetic-source',payer:p.signer,payee,amount_usdc:0.000007,network:profile.networkId,
    settled:0,settlement_status:'pending',authorization_id:id,authorization_expires_at:submission.authorizationExpiresAt,authorization_phase:'prepared'};
  const authorization:Row={nonce:id,policy_digest:hostedTreasuryPolicyDigest(p),signer:p.signer,query_id:jobId,amount_micro:7,original:canonicalJson({context,payload}),submitted:0};
  return{authorization,payment,context,payload,submission,jobId,workerId};
}
export async function qualifyHostedLedger(input:{transport:PostgresHostedLedgerTransport;options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;ownerSql:(s:string)=>string;applicationTableReference?:boolean;protocol?:PostgresHostedPaymentProtocol}){
  const protocol=input.protocol??'legacy-v1',sourceOriginals=protocol==='source-payment-originals-v1';
  if(protocol!=='legacy-v1'&&!sourceOriginals)throw Error('Hosted qualifier protocol refused');
  const db=new DatabaseSync(':memory:'),q=(v:string|number|null)=>v===null?'NULL':typeof v==='number'?String(v):`'${v.replaceAll("'","''")}'`;let vectors=0,sourceImportRefusals=0;
  const originals=new Map<string,{rowWire:string;sha256:string}>();
  const writersEmpty=()=>{for(const table of sourceOriginals?['public.browser_journal_writer','keryx_storage.writer']:['keryx_storage.writer'])assert.equal(input.ownerSql(`SELECT count(*) FROM ${table};`),'0');};
  const t=new Proxy(input.transport,{get(target,key,receiver){const value=Reflect.get(target,key,receiver);if(typeof value!=='function'||!['admitHostedTreasuryPolicy','submitHostedAuthorization','confirmHostedAuthorization'].includes(String(key)))return value;return async(...args:unknown[])=>{try{return await Reflect.apply(value,target,args);}finally{writersEmpty();}};}});
  const retain=(id:string)=>{
    const captured=captureObservedPaymentFixture(db,id);assert(captured);originals.set(id,{rowWire:captured.rowWire,sha256:captured.sha256});
    return captured;
  };
  const rawEqual=(id:string)=>{
    if(!sourceOriginals)return;
    const captured=captureObservedPaymentFixture(db,id),original=originals.get(id);assert(captured&&original);
    const got=JSON.parse(input.ownerSql(`SELECT json_build_object('identity',identity_digest,'original',original_wire::text,'originalSha',original_sha256,'current',current_wire::text,'currentSha',current_sha256) FROM keryx_storage.payment_event_originals WHERE payment_id=${q(id)};`));
    assert.deepEqual(got,{identity:storageIdentityDigest(input.identity),original:original.rowWire,originalSha:original.sha256,current:captured.rowWire,currentSha:captured.sha256});
    assert.equal(paymentEventWireSha256(got.current),got.currentSha);
  };
  const insert=(table:string,row:Row)=>{
    const cols=Object.keys(row);assert(/^[a-z_]+$/.test(table)&&cols.every(c=>/^[a-z_]+$/.test(c)));
    db.prepare(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).run(...cols.map(c=>row[c]));
    if(sourceOriginals&&table==='payment_events'){
      const captured=retain(String(row.id)),physical=captured.projection,keys=Object.keys(physical);
      const value=(key:string)=>key==='settled'?(physical[key as keyof typeof physical]===1?'true':'false'):q(physical[key as keyof typeof physical]);
      return `INSERT INTO public.payment_events(${keys.join(',')}) VALUES(${keys.map(value).join(',')});`+
        `INSERT INTO keryx_storage.payment_event_originals(payment_id,identity_digest,original_wire,original_sha256,current_wire,current_sha256,native_projection,unprojected_fields) SELECT id,${q(storageIdentityDigest(input.identity))},${q(captured.rowWire)}::json,${q(captured.sha256)},${q(captured.rowWire)}::json,${q(captured.sha256)},to_jsonb(p),ARRAY[${captured.unprojectedFields.map(q).join(',')}]::text[] FROM public.payment_events p WHERE id=${q(String(row.id))};`;
    }
    return`INSERT INTO public.${table}(${cols.join(',')}) VALUES(${cols.map(c=>table==='payment_events'&&c==='settled'&&input.applicationTableReference?(row[c]===1?'true':'false'):q(row[c])).join(',')});`;
  };
  const compare=async(signer:string,role?:'public'|'private')=>{
    let expected:ReturnType<typeof sqliteHostedAccounting>|undefined;try{expected=sqliteHostedAccounting(db,signer,role);}catch{}
    if(expected===undefined)await assert.rejects(t.hostedTreasuryAccounting(signer,role));else assert.deepEqual(await t.hostedTreasuryAccounting(signer,role),expected);
    for(const row of db.prepare('SELECT id FROM payment_events WHERE payer=?').all(signer))if(originals.has(String(row.id)))rawEqual(String(row.id));writersEmpty();vectors++;
  };
  const admit=async(p:HostedTreasuryPolicy,role:'public'|'private')=>{
    assert.equal(await t.admitHostedTreasuryPolicy(p,role),admitSqliteHostedPolicy(db,p,input.identity,role));vectors++;
  };
  const seed=(o:ReturnType<typeof original>,options:{payment?:boolean;proof?:boolean;confirmation?:boolean;foreignProof?:boolean;changedConfirmation?:boolean;refuseImport?:string;receipt?:string}={})=>{
    let sql="UPDATE keryx_storage.control SET mode='held';";
    sqliteJournalTransaction(db,()=>{
      sql+=insert('hosted_treasury_authorizations',o.authorization);
      if(options.payment!==false)sql+=insert('payment_events',o.payment);
      if(options.proof||options.confirmation){
        sql+=insert('private_research_intents',{id:o.jobId,payer:o.context.privateJob!.owner,data:'{}'});
        sql+=insert('private_research_payment_attempts',{id:o.jobId});
        sql+=insert('private_research_executions',{id:o.jobId,worker_id:o.workerId});
        const submission={...o.submission,...(options.foreignProof?{network:'eip155:5042002'}:{})};
        sql+=insert('private_creator_submissions',{job_id:o.jobId,leg_id:randomUUID(),worker_id:o.workerId,authorization_id:String(o.authorization.nonce),amount_micros:7,
          data:JSON.stringify({kind:'fetch',sourceId:'synthetic-source',itemId:null,submission})});
        if(options.confirmation)sql+=insert('private_creator_confirmations',{authorization_id:String(o.authorization.nonce),data:JSON.stringify({transaction:options.receipt??'synthetic-private-confirmed',submission:{...submission,...(options.changedConfirmation?{amountMicros:'6'}:{})}})});
      }
    });const statement='BEGIN;'+sql+"UPDATE keryx_storage.control SET mode='active';COMMIT;";
    if(options.refuseImport){
      assert.throws(()=>input.ownerSql(statement),new RegExp(options.refuseImport));
      assert.throws(()=>sqliteHostedAccounting(db,String(o.authorization.signer)));
      assert.equal(input.ownerSql("SELECT mode FROM keryx_storage.control WHERE singleton;"),'active');
      assert.equal(input.ownerSql(`SELECT count(*) FROM public.hosted_treasury_authorizations WHERE nonce=${q(o.authorization.nonce)};`),'0');
      originals.delete(String(o.payment.id));sourceImportRefusals++;return false;
    }
    input.ownerSql(statement);return true;
  };
  try{
    db.exec('BEGIN');installMainnetApplicationSchema(db);db.exec('COMMIT');await compare(wallet());
    const p=policy(input.identity);await admit(p,'public');await admit(p,'public');
    await assert.rejects(t.admitHostedTreasuryPolicy(p,'private'));assert.throws(()=>admitSqliteHostedPolicy(db,p,input.identity,'private'));
    await assert.rejects(t.admitHostedTreasuryPolicy({...p,expiresAtSeconds:1},'public'));
    const o=original(p);seed(o);await compare(p.signer,'public');
    await assert.rejects(t.confirmHostedAuthorization(p.signer,o.submission.authorizationId,'synthetic-confirmed'));assert.throws(()=>confirmSqliteHostedAuthorization(db,p.signer,o.submission.authorizationId,'synthetic-confirmed'));
    const header=nonce();await assert.rejects(t.submitHostedAuthorization(p.signer,{...o.submission,payee:wallet()},header));
    await t.submitHostedAuthorization(p.signer,o.submission,header);submitSqliteHostedAuthorization(db,p.signer,o.submission,header);await compare(p.signer,'public');rawEqual(String(o.payment.id));
    await assert.rejects(t.submitHostedAuthorization(p.signer,o.submission,header));assert.throws(()=>submitSqliteHostedAuthorization(db,p.signer,o.submission,header));
    await t.confirmHostedAuthorization(p.signer,o.submission.authorizationId,'synthetic-confirmed');confirmSqliteHostedAuthorization(db,p.signer,o.submission.authorizationId,'synthetic-confirmed');await compare(p.signer);
    await t.confirmHostedAuthorization(p.signer,o.submission.authorizationId,'synthetic-confirmed');
    await assert.rejects(t.confirmHostedAuthorization(p.signer,o.submission.authorizationId,'different'));assert.throws(()=>confirmSqliteHostedAuthorization(db,p.signer,o.submission.authorizationId,'different'));

    for(const kind of ['pending','failed','missing-payment','wrong-amount','wrong-network','settled-label','settled-flag','missing-receipt','wrong-original-value'] as const){
      const p=policy(input.identity);await admit(p,'public');const o=original(p);
      if(kind==='failed')Object.assign(o.payment,{settlement_status:'failed',authorization_phase:'failed'});
      if(kind==='wrong-amount')o.payment.amount_usdc=0.000006;if(kind==='wrong-network')o.payment.network='eip155:5042002';
      if(kind==='settled-label')o.payment.settlement_status='settled';if(kind==='settled-flag')o.payment.settled=1;
      if(kind==='missing-receipt')Object.assign(o.payment,{settled:1,settlement_status:'settled',tx_hash:null});
      if(kind==='wrong-original-value'){o.payload.message.value='6';o.authorization.original=canonicalJson({context:o.context,payload:o.payload});}
      const rejected=input.applicationTableReference&&['settled-label','settled-flag'].includes(kind);
      if(seed(o,{payment:kind!=='missing-payment',...(rejected?{refuseImport:'payment_events_settlement_status_check'}:{})}))await compare(p.signer);
      else assert.deepEqual(await t.hostedTreasuryAccounting(p.signer),{retainedMicroUsdc:'0',confirmedMicroUsdc:'0'});
    }
    for(const kind of ['prepared','missing-proof','submitted','foreign-proof','confirmed','changed-confirmation','public-leak'] as const){
      const p=policy(input.identity);await admit(p,'private');const o=original(p,true);if(kind!=='prepared')o.authorization.submitted=1;
      seed(o,{payment:kind==='public-leak',proof:['submitted','foreign-proof','public-leak'].includes(kind),confirmation:['confirmed','changed-confirmation'].includes(kind),
        foreignProof:kind==='foreign-proof',changedConfirmation:kind==='changed-confirmation'});await compare(p.signer,'private');
    }
    if(sourceOriginals){
    // A legacy receipt shape cannot be interpreted by the new body. Assert
    // the actual semantic refusal, then restore the fixture session and tokens.
    try{assert.throws(()=>input.ownerSql('BEGIN;SET LOCAL SESSION AUTHORIZATION keryx_app;'+`SELECT public.storage_hosted_confirm(${q(canonicalJson(input.identity))}::jsonb,${q(input.digest)},${q(p.signer)},${q(o.submission.authorizationId)},'synthetic-confirmed');`+'ROLLBACK;'),/hosted payment protocol mismatch/);}
    finally{input.ownerSql('ROLLBACK;RESET SESSION AUTHORIZATION;');}
    rawEqual(String(o.payment.id));writersEmpty();vectors++;
    // Source public receipts use scalar binding plus strict caller readback;
    // private receipts compare serialized proof strings without scalar binding.
    for(const receipt of ['\0','\u00e9'.repeat(256),'\ud83d\ude00'.repeat(128),'\ud800']){
      const p=policy(input.identity);await admit(p,'public');const o=original(p);seed(o);
      const receiptHeader=nonce();await t.submitHostedAuthorization(p.signer,o.submission,receiptHeader);submitSqliteHostedAuthorization(db,p.signer,o.submission,receiptHeader);
      if(receipt==='\ud800'){
        assert.throws(()=>confirmSqliteHostedAuthorization(db,p.signer,o.submission.authorizationId,receipt));await assert.rejects(t.confirmHostedAuthorization(p.signer,o.submission.authorizationId,receipt));rawEqual(String(o.payment.id));
      }else{
        confirmSqliteHostedAuthorization(db,p.signer,o.submission.authorizationId,receipt);await t.confirmHostedAuthorization(p.signer,o.submission.authorizationId,receipt);rawEqual(String(o.payment.id));
        await t.confirmHostedAuthorization(p.signer,o.submission.authorizationId,receipt);rawEqual(String(o.payment.id));await compare(p.signer);
      }
      const privatePolicy=policy(input.identity);await admit(privatePolicy,'private');const privateOriginal=original(privatePolicy,true);privateOriginal.authorization.submitted=1;
      seed(privateOriginal,{payment:false,confirmation:true,receipt});
      confirmSqliteHostedAuthorization(db,privatePolicy.signer,privateOriginal.submission.authorizationId,receipt);await t.confirmHostedAuthorization(privatePolicy.signer,privateOriginal.submission.authorizationId,receipt);
      assert.equal(input.ownerSql(`SELECT count(*) FROM public.payment_events WHERE id=${q(String(privateOriginal.payment.id))};`),'0');
      assert.equal(input.ownerSql(`SELECT count(*) FROM keryx_storage.payment_event_originals WHERE payment_id=${q(String(privateOriginal.payment.id))};`),'0');
      await compare(privatePolicy.signer);vectors++;
    }
    // The actual Source submit helper permits an absent public row, too.
    const absentPolicy=policy(input.identity);await admit(absentPolicy,'public');const absent=original(absentPolicy);seed(absent,{payment:false});
    const absentHeader=nonce();submitSqliteHostedAuthorization(db,absentPolicy.signer,absent.submission,absentHeader);await t.submitHostedAuthorization(absentPolicy.signer,absent.submission,absentHeader);
    assert.equal(input.ownerSql(`SELECT submitted FROM public.hosted_treasury_authorizations WHERE nonce=${q(absent.submission.authorizationId)};`),'1');
    assert.equal(input.ownerSql(`SELECT count(*) FROM keryx_storage.payment_event_originals WHERE payment_id=${q(String(absent.payment.id))};`),'0');vectors++;
    // Execute the REAL fixed RPCs as the fixture application session inside a
    // rollback-only owner intake window. Missing originals are never adopted,
    // retained originals are never deleted, and the target remains reusable.
    for(const fault of ['missing','stale'] as const){
      const p=policy(input.identity);await admit(p,'public');const o=original(p);o.authorization.submitted=1;
      let authorizationSql='',paymentSql='';sqliteJournalTransaction(db,()=>{authorizationSql=insert('hosted_treasury_authorizations',o.authorization);paymentSql=insert('payment_events',o.payment);});
      const publicOnly=paymentSql.slice(0,paymentSql.indexOf('INSERT INTO keryx_storage.payment_event_originals'));
      const intake=authorizationSql+(fault==='missing'?publicOnly:paymentSql+`UPDATE public.payment_events SET source_name='synthetic-stale-projection' WHERE id=${q(String(o.payment.id))};`);
      const expected=q(canonicalJson(input.identity))+'::jsonb',digest=q(input.digest);
      const captured=captureObservedPaymentFixture(db,String(o.payment.id));assert(captured);
      const envelope=canonicalJson({originalWire:o.authorization.original,paymentTemplateWire:JSON.stringify({...captured.row,created_at:null})});
      const calls=[
        `SELECT public.storage_hosted_admit_authorization(${expected},${digest},${q(canonicalJson(p))},${q(hostedTreasuryPolicyDigest(p))},${q(envelope)},${q('{"retainedMicroUsdc":"0","confirmedMicroUsdc":"0"}')},'100',NULL);`,
        `SELECT public.storage_hosted_submit(${expected},${digest},${q(p.signer)},${q(canonicalJson({format:protocol,submissionWire:canonicalJson(o.submission)}))},${q(nonce())});`,
        `SELECT public.storage_hosted_confirm(${expected},${digest},${q(p.signer)},${q(o.submission.authorizationId)},${q(HOSTED_PAYMENT_SOURCE_RECEIPT_PREFIX+JSON.stringify('synthetic-confirmed'))});`,
      ];
      for(const call of calls){
        try{assert.throws(()=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+intake+"UPDATE keryx_storage.control SET mode='active';SET LOCAL SESSION AUTHORIZATION keryx_app;"+call+'ROLLBACK;'),/native payment raw original coverage or projection unavailable|native hosted payment original unavailable or changed/);}
        finally{input.ownerSql('ROLLBACK;RESET SESSION AUTHORIZATION;');}
        assert.equal(input.ownerSql('SELECT mode FROM keryx_storage.control WHERE singleton;'),'active');
        assert.equal(input.ownerSql(`SELECT count(*) FROM public.hosted_treasury_authorizations WHERE nonce=${q(o.submission.authorizationId)};`),'0');
        assert.equal(input.ownerSql(`SELECT count(*) FROM public.payment_events WHERE id=${q(String(o.payment.id))};`),'0');
        writersEmpty();vectors++;
      }
      originals.delete(String(o.payment.id));
    }
    // The selected identity is enforced independently during trusted held intake.
    {
      const p=policy(input.identity);await admit(p,'public');const o=original(p);let intake='';
      sqliteJournalTransaction(db,()=>{intake=insert('hosted_treasury_authorizations',o.authorization)+insert('payment_events',o.payment);});
      intake=intake.replace(q(storageIdentityDigest(input.identity)),q('f'.repeat(64)));
      try{assert.throws(()=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+intake+'ROLLBACK;'),/native payment Source identity refused/);}
      finally{input.ownerSql('ROLLBACK;');}
      assert.equal(input.ownerSql(`SELECT count(*) FROM public.payment_events WHERE id=${q(String(o.payment.id))};`),'0');originals.delete(String(o.payment.id));writersEmpty();vectors++;
    }
    }
    const lost=policy(input.identity);await admit(lost,'public');const pending=original(lost);seed(pending);
    assert.equal(input.options.endpoint.kind,'loopback');const proxy=await startCommitAckLossProxy(input.options.endpoint.port);
    const broken=createPostgresHostedLedgerTransport({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest,protocol);
    try{
      proxy.arm();await assert.rejects(broken.submitHostedAuthorization(lost.signer,pending.submission,header),PostgresDomainWriteOutcomeUnknown);
      assert.deepEqual(proxy.observation(),{dropped:true,commands:1});submitSqliteHostedAuthorization(db,lost.signer,pending.submission,header);await compare(lost.signer);
      await assert.rejects(t.submitHostedAuthorization(lost.signer,pending.submission,header));
    }finally{await broken.close();await proxy.close();}
    writersEmpty();
    return{vectors,sourceImportRefusals,selectedIdentityRaw27Cells:sourceOriginals,immutableOriginalAcrossTransitions:sourceOriginals,sourceUtf16Receipts:sourceOriginals,privateSerializedReceiptDistinction:sourceOriginals,absentPublicSubmitPreserved:sourceOriginals,rollbackScopedRawRefusals:sourceOriginals,foreignOriginalIdentityRefused:sourceOriginals,legacyWireOnNewBodyRefused:sourceOriginals,currentTxidCapabilitiesCleared:sourceOriginals,policyIdentityAndHistoricalRole:true,publicAndPrivateRetainedAccounting:true,singleOriginalSubmission:true,actualLostSubmissionCommitAck:true,
      noAutomaticRetry:true,paidOperations:0,vendorRequests:0,authorizationAdmissionQualified:false,privateExecutionQualified:false};
  }finally{db.close();}
}
