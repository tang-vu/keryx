import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { installMainnetApplicationSchema } from "../mainnet-application-schema";
import { sqliteJournalTransaction } from "../sqlite-browser-journal";
import { admitSqliteHostedPolicy,confirmSqliteHostedAuthorization,sqliteHostedAccounting } from "../hosted-treasury-journal";
import { canonicalJson } from "../../canonical-json";
import { ARC_MAINNET_PROFILE as profile } from "../../arc-network-profile";
import { randomUUID } from "node:crypto";
import { STORAGE_MAINNET_PROFILE_DIGEST,storageIdentityDigest,type StorageIdentity } from "../storage-identity";
import { hostedTreasuryPolicyDigest,type HostedTreasuryPolicy } from "../../payments/hosted-treasury-policy";
const state=vi.hoisted(()=>({query:vi.fn(),connect:vi.fn(),release:vi.fn(),poolQuery:vi.fn(),end:vi.fn(),pools:0}));
vi.mock('pg',()=>({Pool:class{constructor(){state.pools++;}query(...a:unknown[]){return state.poolQuery(...a);}connect(){return state.connect();}end(){return state.end();}on(){}},types:{getTypeParser:()=>(s:string)=>s}}));
import { createPostgresHostedLedgerTransport,HOSTED_PAYMENT_SOURCE_RECEIPT_PREFIX } from './hosted-ledger-transport';
import { PostgresDomainWriteOutcomeUnknown } from './domain-channel';
import { PostgresStorageUnavailable } from './connection';
const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',network:'eip155:5042',authorityMode:'mainnet-real',deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),
  enrolledAt:'2026-11-12T00:00:00.000Z',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,provenanceDigest:'11'.repeat(32)};
const options={endpoint:{kind:'loopback' as const,port:5432},database:'synthetic',role:'keryx_app',password:'synthetic-not-a-live-secret'},signer=`0x${'aa'.repeat(20)}`,nonce=`0x${'bb'.repeat(32)}`;
const policy=():HostedTreasuryPolicy=>({format:'keryx-hosted-treasury-policy-v1',network:'eip155:5042',storageIdentityDigest:storageIdentityDigest(identity),origin:'https://keryx.cc',signer,
  lifetimeCapMicroUsdc:'100',queryCapMicroUsdc:'10',expiresAtSeconds:Math.floor(Date.now()/1000)+60});
const response=(v:unknown)=>({rows:[[v===null?null:JSON.stringify(v)]],fields:[{name:'result',dataTypeID:3802}]});
const make=(protocol:'legacy-v1'|'source-payment-originals-v1'='legacy-v1')=>createPostgresHostedLedgerTransport(options,identity,'22'.repeat(32),protocol);
beforeEach(()=>{vi.clearAllMocks(); state.connect.mockResolvedValue({query:state.query,release:state.release});state.pools=0;state.end.mockResolvedValue(undefined);state.query.mockResolvedValue(response(null));});
describe('closed native hosted ledger',()=>{
  it('binds policy identity/digest and composes one bounded pool',async()=>{
    const t=make(),p=policy();expect(await t.admitHostedTreasuryPolicy(p,'public')).toBe(hostedTreasuryPolicyDigest(p));expect(state.pools).toBe(1);
    const q=state.query.mock.calls[0][0];expect(q.text).toContain('storage_hosted_admit_policy');expect(JSON.parse(q.values[2])).toEqual(p);expect(q.values.slice(3)).toEqual([hostedTreasuryPolicyDigest(p),'public']);await t.close();
  });
  it('refuses expired/foreign policy before any write dispatch',async()=>{
    const t=make();await expect(t.admitHostedTreasuryPolicy({...policy(),expiresAtSeconds:1},'public')).rejects.toThrow();
    await expect(t.admitHostedTreasuryPolicy({...policy(),storageIdentityDigest:'00'.repeat(32)},'private')).rejects.toThrow();expect(state.query).not.toHaveBeenCalled();await t.close();
  });
  it.each([null,{},[],{retainedMicroUsdc:'1',confirmedMicroUsdc:'2'},{retainedMicroUsdc:'9007199254740992',confirmedMicroUsdc:'0'},{retainedMicroUsdc:1,confirmedMicroUsdc:'0'}].map(v=>({v})))(
    'rejects invalid or manufactured accounting $v',async({v})=>{const t=make();state.query.mockResolvedValue(response(v));await expect(t.hostedTreasuryAccounting(signer)).rejects.toThrow(PostgresStorageUnavailable);await t.close();});
  it('does not turn a failed reader into zero retained exposure or another attempt',async()=>{
    const t=make();state.query.mockRejectedValue(new Error('private database detail'));await expect(t.hostedTreasuryAccounting(signer,'public')).rejects.toThrow(/^PostgreSQL storage unavailable$/);
    expect(state.query).toHaveBeenCalledTimes(1);await t.close();
  });
  it('marks a lost confirmation acknowledgement unknown without retry',async()=>{
    const t=make();state.query.mockRejectedValue(new Error('private detail'));await expect(t.confirmHostedAuthorization(signer,nonce,'synthetic-confirmed')).rejects.toThrow(PostgresDomainWriteOutcomeUnknown);
    expect(state.query).toHaveBeenCalledTimes(1);await t.close();
  });
  it('suppresses policy authority when disposed after native dispatch',async()=>{
    let finish!:(v:unknown)=>void;state.query.mockReturnValue(new Promise(resolve=>{finish=resolve;}));const t=make(),request=t.admitHostedTreasuryPolicy(policy(),'public');
    const outcome=expect(request).rejects.toThrow(PostgresDomainWriteOutcomeUnknown);await vi.waitFor(()=>expect(state.query).toHaveBeenCalledTimes(1));const closing=t.close();finish(response(null));await outcome;await closing;
  });
});

describe('Source hosted receipt binding',()=>{
 it.each(['\0','\u00e9'.repeat(256),'\ud83d\ude00'.repeat(128),'\ud800'])('captures caller UTF-16 without a native scalar bind: %j',async(receipt)=>{
  const t=make('source-payment-originals-v1');try{await t.confirmHostedAuthorization(signer,nonce,receipt);
   const q=state.query.mock.calls[0][0];expect(q.values[4]).toBe(HOSTED_PAYMENT_SOURCE_RECEIPT_PREFIX+JSON.stringify(receipt));expect(Buffer.byteLength(q.values[4])).toBeGreaterThan(256);
   expect(JSON.parse(q.values[4].slice(HOSTED_PAYMENT_SOURCE_RECEIPT_PREFIX.length))).toBe(receipt);expect(state.query).toHaveBeenCalledTimes(1);
  }finally{await t.close();}
 });
 it.each(['','a'.repeat(257),'\ud83d\ude00'.repeat(129)])('refuses Source length violations before dispatch: %j',async(receipt)=>{
  const t=make('source-payment-originals-v1');try{await expect(t.confirmHostedAuthorization(signer,nonce,receipt)).rejects.toThrow();expect(state.query).not.toHaveBeenCalled();}finally{await t.close();}
 });
 it('uses the genuine SQLite scalar bind distinction without changing retained JSON',()=>{
  const db=new DatabaseSync(':memory:');try{
   db.exec('CREATE TABLE receipt(v TEXT,wire TEXT)');
   for(const receipt of ['\0','\ud800','\u00e9'.repeat(256),'\ud83d\ude00'.repeat(128)]){
    db.prepare('INSERT INTO receipt(v,wire) VALUES(?,?)').run(receipt,JSON.stringify(receipt));
    const row=db.prepare('SELECT v,wire,hex(v) AS hex FROM receipt ORDER BY rowid DESC LIMIT 1').get()!;
    expect(JSON.parse(String(row.wire))).toBe(receipt);
    expect(row.v).toBe(Buffer.from(receipt).toString('utf8'));
    if(receipt==='\0')expect(row.hex).toBe('00');
    if(receipt==='\ud800')expect(row.hex).toBe('EFBFBD');
   }
  }finally{db.close();}
 });
});

describe('genuine Source private serialized receipts',()=>{
 it.each(['\0','\u00e9'.repeat(256),'\ud83d\ude00'.repeat(128),'\ud800'])('matches retained JSON independently of scalar binding: %j',(receipt)=>{
  const db=new DatabaseSync(':memory:');try{
   installMainnetApplicationSchema(db);const p=policy();admitSqliteHostedPolicy(db,p,identity,'private');
   const jobId='prv_'+'12'.repeat(32),workerId='44444444-4444-4444-8444-444444444444',owner='0x'+'cc'.repeat(20),payee='0x'+'dd'.repeat(20),expires=String(Math.floor(Date.now()/1000)+605000);
   const context={kind:'fetch',queryId:jobId,queryBudgetMicroUsdc:'10',sourceId:'synthetic-source',itemId:null,privateJob:{id:jobId,workerId,owner}};
   const payload={domain:{name:'GatewayWalletBatched',version:'1',chainId:profile.chainId,verifyingContract:profile.gatewayWallet},primaryType:'TransferWithAuthorization',types:{TransferWithAuthorization:[{name:'from',type:'address'},{name:'to',type:'address'},{name:'value',type:'uint256'},{name:'validAfter',type:'uint256'},{name:'validBefore',type:'uint256'},{name:'nonce',type:'bytes32'}]},message:{from:signer,to:payee,value:'7',validAfter:String(Math.floor(Date.now()/1000)-600),validBefore:expires,nonce}};
   const submission={authorizationId:nonce,authorizationExpiresAt:new Date(Number(expires)*1000).toISOString(),payer:signer,payee,amountMicros:'7',network:profile.networkId,asset:profile.usdcAddress.toLowerCase()};
   sqliteJournalTransaction(db,()=>{
    db.prepare('INSERT INTO hosted_treasury_authorizations(nonce,policy_digest,signer,query_id,amount_micro,original,submitted) VALUES(?,?,?,?,?,?,1)').run(nonce,hostedTreasuryPolicyDigest(p),signer,jobId,7,canonicalJson({context,payload}));
    db.prepare('INSERT INTO private_research_intents(id,payer,data) VALUES(?,?,?)').run(jobId,owner,'{}');
    db.prepare('INSERT INTO private_research_payment_attempts(id) VALUES(?)').run(jobId);
    db.prepare('INSERT INTO private_research_executions(id,worker_id) VALUES(?,?)').run(jobId,workerId);
    db.prepare('INSERT INTO private_creator_submissions(job_id,leg_id,worker_id,authorization_id,amount_micros,data) VALUES(?,?,?,?,?,?)').run(jobId,'synthetic-leg',workerId,nonce,7,JSON.stringify({kind:'fetch',sourceId:context.sourceId,itemId:null,submission}));
    db.prepare('INSERT INTO private_creator_confirmations(authorization_id,data) VALUES(?,?)').run(nonce,JSON.stringify({transaction:receipt,submission}));
   });
   confirmSqliteHostedAuthorization(db,signer,nonce,receipt);confirmSqliteHostedAuthorization(db,signer,nonce,receipt);
   expect(sqliteHostedAccounting(db,signer,'private')).toEqual({retainedMicroUsdc:'7',confirmedMicroUsdc:'7'});
   expect(db.prepare('SELECT count(*) AS n FROM payment_events').get()?.n).toBe(0);
   expect(db.prepare('SELECT count(*) AS n FROM browser_journal_writer').get()?.n).toBe(0);
  }finally{db.close();}
 });
});

describe('finite hosted protocol selection',()=>{
 it('keeps legacy confirmation bytes and legacy input bounds by default',async()=>{
  const t=make();try{await t.confirmHostedAuthorization(signer,nonce,'synthetic-confirmed');expect(state.query.mock.calls[0][0].values[4]).toBe('synthetic-confirmed');
   state.query.mockClear();await expect(t.confirmHostedAuthorization(signer,nonce,'\u00e9'.repeat(256))).rejects.toThrow();expect(state.query).not.toHaveBeenCalled();
  }finally{await t.close();}
 });
 it('refuses an unknown selection before allocating a pool',()=>{
  expect(()=>make('other' as never)).toThrow('PostgreSQL storage unavailable');expect(state.pools).toBe(0);
 });
 it.each(['legacy-v1','source-payment-originals-v1'] as const)('binds the exact selected submit shape: %s',async(protocol)=>{
  const t=make(protocol);try{
   const submission={authorizationId:nonce,authorizationExpiresAt:'2026-11-22T00:00:00.000Z',payer:signer,payee:'0x'+'cc'.repeat(20),amountMicros:'7',network:profile.networkId,asset:profile.usdcAddress.toLowerCase()};
   await t.submitHostedAuthorization(signer,submission,'0x'+'dd'.repeat(32));const wire=state.query.mock.calls[0][0].values[3];
   expect(JSON.parse(wire)).toEqual(protocol==='legacy-v1'?submission:{format:protocol,submissionWire:canonicalJson(submission)});
  }finally{await t.close();}
 });
 it('does not retry an ambiguous explicitly selected Source write',async()=>{
  const t=make('source-payment-originals-v1');state.query.mockRejectedValue(new Error('synthetic lost ACK'));
  try{await expect(t.confirmHostedAuthorization(signer,nonce,'\0')).rejects.toThrow(PostgresDomainWriteOutcomeUnknown);expect(state.query).toHaveBeenCalledTimes(1);}finally{await t.close();}
 });
});

afterEach(()=>{
 expect(state.poolQuery).not.toHaveBeenCalled();
 expect(state.release).toHaveBeenCalledTimes(state.connect.mock.calls.length);
 for(const [destroy] of state.release.mock.calls)expect(typeof destroy).toBe("boolean");
});
