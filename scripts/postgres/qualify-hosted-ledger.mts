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
import { createPostgresHostedLedgerTransport,type PostgresHostedLedgerTransport } from "../../lib/db/postgres/hosted-ledger-transport";
import { PostgresDomainWriteOutcomeUnknown } from "../../lib/db/postgres/domain-channel";
import { startCommitAckLossProxy } from "./commit-ack-loss.mts";

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
export async function qualifyHostedLedger(input:{transport:PostgresHostedLedgerTransport;options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;ownerSql:(s:string)=>string}){
  const db=new DatabaseSync(':memory:'),t=input.transport,q=(v:string|number|null)=>v===null?'NULL':typeof v==='number'?String(v):`'${v.replaceAll("'","''")}'`;let vectors=0;
  const insert=(table:string,row:Row)=>{
    const cols=Object.keys(row);assert(/^[a-z_]+$/.test(table)&&cols.every(c=>/^[a-z_]+$/.test(c)));
    db.prepare(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`).run(...cols.map(c=>row[c]));
    return`INSERT INTO public.${table}(${cols.join(',')}) VALUES(${cols.map(c=>q(row[c])).join(',')});`;
  };
  const compare=async(signer:string,role?:'public'|'private')=>{
    let expected:ReturnType<typeof sqliteHostedAccounting>|undefined;try{expected=sqliteHostedAccounting(db,signer,role);}catch{}
    if(expected===undefined)await assert.rejects(t.hostedTreasuryAccounting(signer,role));else assert.deepEqual(await t.hostedTreasuryAccounting(signer,role),expected);vectors++;
  };
  const admit=async(p:HostedTreasuryPolicy,role:'public'|'private')=>{
    assert.equal(await t.admitHostedTreasuryPolicy(p,role),admitSqliteHostedPolicy(db,p,input.identity,role));vectors++;
  };
  const seed=(o:ReturnType<typeof original>,options:{payment?:boolean;proof?:boolean;confirmation?:boolean;foreignProof?:boolean;changedConfirmation?:boolean}={})=>{
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
        if(options.confirmation)sql+=insert('private_creator_confirmations',{authorization_id:String(o.authorization.nonce),data:JSON.stringify({transaction:'synthetic-private-confirmed',submission:{...submission,...(options.changedConfirmation?{amountMicros:'6'}:{})}})});
      }
    });input.ownerSql(sql+"UPDATE keryx_storage.control SET mode='active';");
  };
  try{
    db.exec('BEGIN');installMainnetApplicationSchema(db);db.exec('COMMIT');await compare(wallet());
    const p=policy(input.identity);await admit(p,'public');await admit(p,'public');
    await assert.rejects(t.admitHostedTreasuryPolicy(p,'private'));assert.throws(()=>admitSqliteHostedPolicy(db,p,input.identity,'private'));
    await assert.rejects(t.admitHostedTreasuryPolicy({...p,expiresAtSeconds:1},'public'));
    const o=original(p);seed(o);await compare(p.signer,'public');
    await assert.rejects(t.confirmHostedAuthorization(p.signer,o.submission.authorizationId,'synthetic-confirmed'));assert.throws(()=>confirmSqliteHostedAuthorization(db,p.signer,o.submission.authorizationId,'synthetic-confirmed'));
    const header=nonce();await assert.rejects(t.submitHostedAuthorization(p.signer,{...o.submission,payee:wallet()},header));
    await t.submitHostedAuthorization(p.signer,o.submission,header);submitSqliteHostedAuthorization(db,p.signer,o.submission,header);await compare(p.signer,'public');
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
      seed(o,{payment:kind!=='missing-payment'});await compare(p.signer);
    }
    for(const kind of ['prepared','missing-proof','submitted','foreign-proof','confirmed','changed-confirmation','public-leak'] as const){
      const p=policy(input.identity);await admit(p,'private');const o=original(p,true);if(kind!=='prepared')o.authorization.submitted=1;
      seed(o,{payment:kind==='public-leak',proof:['submitted','foreign-proof','public-leak'].includes(kind),confirmation:['confirmed','changed-confirmation'].includes(kind),
        foreignProof:kind==='foreign-proof',changedConfirmation:kind==='changed-confirmation'});await compare(p.signer,'private');
    }
    const lost=policy(input.identity);await admit(lost,'public');const pending=original(lost);seed(pending);
    assert.equal(input.options.endpoint.kind,'loopback');const proxy=await startCommitAckLossProxy(input.options.endpoint.port);
    const broken=createPostgresHostedLedgerTransport({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest);
    try{
      proxy.arm();await assert.rejects(broken.submitHostedAuthorization(lost.signer,pending.submission,header),PostgresDomainWriteOutcomeUnknown);
      assert.deepEqual(proxy.observation(),{dropped:true,commands:1});submitSqliteHostedAuthorization(db,lost.signer,pending.submission,header);await compare(lost.signer);
      await assert.rejects(t.submitHostedAuthorization(lost.signer,pending.submission,header));
    }finally{await broken.close();await proxy.close();}
    assert.equal(input.ownerSql('SELECT count(*) FROM keryx_storage.writer;'),'0');
    return{vectors,policyIdentityAndHistoricalRole:true,publicAndPrivateRetainedAccounting:true,singleOriginalSubmission:true,actualLostSubmissionCommitAck:true,
      noAutomaticRetry:true,paidOperations:0,vendorRequests:0,authorizationAdmissionQualified:false,privateExecutionQualified:false};
  }finally{db.close();}
}
