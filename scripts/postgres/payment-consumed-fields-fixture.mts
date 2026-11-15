/** Fresh synthetic Source only. No Vitest, app facade/runtime, PostgreSQL,
 * wallet, provider, signature, caller clock, authority callback or file intake. */
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,existsSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ARC_MAINNET_PROFILE as profile} from '../../lib/arc-network-profile';
import {installMainnetApplicationSchema} from '../../lib/db/mainnet-application-schema';
import {installNativeUserDomainSchema} from '../../lib/db/native-user-domain-schema';
import {insertStorageIdentity,installStorageFences} from '../../lib/db/storage-identity-sqlite';
import {openVerifiedSqliteStorage,assertVerifiedSqliteConnection} from '../../lib/db/storage-identity-connection';
import {supportedSqliteApplicationProfiles} from '../../lib/db/enrolled-sqlite-schema-profile';
import {validateStorageIdentity} from '../../lib/db/storage-identity';
import {prepareBrowserJournal,type BrowserJournalAdmission} from '../../lib/db/browser-authorization-journal';
import {activateSqliteBrowserJournal,admitSqliteBrowserJournalInTransaction,sqliteJournalTransaction,upsertSqliteJournalGrant,transitionSqliteBrowserJournal,terminalSqliteJournalPayment} from '../../lib/db/sqlite-browser-journal';
import {sqliteSessionFundingAccounting} from '../../lib/db/session-funding-accounting';
import {sqliteSessionWithdrawalAccounting} from '../../lib/db/session-withdrawal-journal';
import {sqliteCreatorOwnerAccounting} from '../../lib/db/creator-owner-withdrawal-journal';
import {captureObservedPaymentSource} from './payment-original-source.mts';

export const PAYMENT_CONSUMED_FIXTURE_TABLES=Object.freeze(['browser_journal_control','session_grants','browser_signer_capacity','browser_retained_grants','browser_authorization_intents','browser_journal_bindings'] as const);
export type PaymentConsumedFixtureCase='padded'|'whitespace'|'nul';
export type PaymentConsumedWhitespace='space'|'tab'|'bom'|'ideographic';
export const PAYMENT_CONSUMED_FIXTURE_RECEIPTS=Object.freeze({padded:' \ufeffordinary-receipt\t ',whitespace:'\ufeff',nul:'receipt\0retained'});
export function createPaymentConsumedFieldsFixture(expected:unknown){
 assert.equal(arguments.length,1,'Only the actual fresh synthetic expected identity is accepted');
 const identity=validateStorageIdentity(expected);assert.equal(identity.authorityMode,'mainnet-real');assert.equal(identity.network,profile.networkId);
 const folder=mkdtempSync(join(tmpdir(),'keryx-consumed-payment-')),file=join(folder,'synthetic.sqlite');
 const cases={padded:{signer:'0x'+'22'.repeat(20)},whitespace:{signer:'0x'+'44'.repeat(20)},nul:{signer:'0x'+'66'.repeat(20)}};
 const owner='0x'+'11'.repeat(20),payee='0x'+'33'.repeat(20),prefix='synthetic-consumed-'+randomUUID();
 const records={} as Record<PaymentConsumedFixtureCase,Readonly<{signer:string;owner:string;payee:string;session:string;request:string;epoch:string;nonce:string;id:string}>>;
 let source:ReturnType<typeof openVerifiedSqliteStorage>|undefined,closed=false;
 const cleanup=()=>{source?.close();source=undefined;for(const path of [file,file+'-wal',file+'-shm',file+'-journal'])if(existsSync(path))unlinkSync(path);rmdirSync(folder);};
 try{
  const seed=new DatabaseSync(file);try{
   seed.exec('BEGIN IMMEDIATE');installMainnetApplicationSchema(seed,{publicReferenceArchive:true});installNativeUserDomainSchema(seed);seed.exec('COMMIT');activateSqliteBrowserJournal(seed,profile);
   for(const key of Object.keys(cases) as PaymentConsumedFixtureCase[]){
    const signer=cases[key].signer,session=randomUUID(),request=prefix+'-'+key,epoch=randomUUID();
    // Initial local synthetic grant lifetime only, never a production renewal.
    upsertSqliteJournalGrant(seed,{sessionId:session,sessAddr:signer,ownerAddr:owner,cap:.01,expiry:Date.now()+3600000,txHash:'synthetic-unfunded-fixture',grantEpoch:epoch});
    const input:BrowserJournalAdmission={sessionId:session,signer,grantEpoch:epoch,requestId:request,queryId:prefix+'-'+key,sourceId:prefix+'-source',offerId:null,kind:'fetch',payee,amountMicroUsdc:1,network:profile.networkId,token:profile.usdcAddress,gatewayContract:profile.gatewayWallet,
     requirements:{scheme:'exact',network:profile.networkId,asset:profile.usdcAddress,payTo:payee,amount:'1',maxTimeoutSeconds:691200,extra:{name:'GatewayWalletBatched',version:'1',verifyingContract:profile.gatewayWallet}},
     payment:{kind:'fetch',queryId:prefix+'-'+key,sourceId:prefix+'-source',sourceName:'Synthetic',payer:signer,payee,amountUsdc:.000001,network:profile.networkId,grantEpoch:epoch}};
    const prepared=prepareBrowserJournal(input,profile),result=sqliteJournalTransaction(seed,()=>admitSqliteBrowserJournalInTransaction(seed,input,prepared));assert.equal(result.status,'admitted');if(result.status!=='admitted')throw Error('Synthetic Source journal refused');
    records[key]=Object.freeze({signer,owner,payee,session,request,epoch,nonce:result.journal.nonce,id:'x402:'+result.journal.nonce});
   }
   seed.exec('BEGIN IMMEDIATE');insertStorageIdentity(seed,identity);installStorageFences(seed,identity);seed.exec('COMMIT');
  }finally{seed.close();}
  source=openVerifiedSqliteStorage(file,identity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>{}});
 }catch(error){cleanup();throw error;}
 const live=()=>{assert(!closed&&source,'Synthetic Source fixture closed');assert.deepEqual(assertVerifiedSqliteConnection(source.db),identity);return source.db;};
 const record=(key:PaymentConsumedFixtureCase)=>{assert(Object.hasOwn(records,key));return records[key];};
 const payment=(key:PaymentConsumedFixtureCase)=>{const value=captureObservedPaymentSource(live(),record(key).id);assert(value);return value;};
 const read=(key:PaymentConsumedFixtureCase='padded')=>{const db=live(),signer=record(key).signer,funding=sqliteSessionFundingAccounting(db,signer);return Object.freeze({funding,withdrawal:sqliteSessionWithdrawalAccounting(db,signer),creatorOwner:sqliteCreatorOwnerAccounting(db,signer),confirmed:Number(sqliteSessionFundingAccounting(db,signer).confirmedSpentMicroUsdc)});};
 const expose=(key:PaymentConsumedFixtureCase)=>{const r=record(key);assert.equal(transitionSqliteBrowserJournal(live(),r.session,r.request,'prepared','exposed'),true);};
 const settle=(key:PaymentConsumedFixtureCase,receipt:string)=>{const r=record(key);assert.deepEqual(terminalSqliteJournalPayment(live(),r.id,r.nonce,receipt,false),{resolved:true,reservationReleased:false});};
 return Object.freeze({
  identity,prefix,cases:Object.freeze(records),sourceFile:file,read,payment,
  assertRefused(key:PaymentConsumedFixtureCase){const db=live(),signer=record(key).signer;for(const action of [()=>sqliteSessionFundingAccounting(db,signer),()=>sqliteSessionWithdrawalAccounting(db,signer),()=>sqliteCreatorOwnerAccounting(db,signer),()=>Number(sqliteSessionFundingAccounting(db,signer).confirmedSpentMicroUsdc)])assert.throws(action,/Original settled debit/);},
  addPresentationGaps(){const db=live(),id=records.padded.id;sqliteJournalTransaction(db,()=>db.prepare('UPDATE payment_events SET created_at=?,source_name=?,rationale=?,authorization_expires_at=?,origin=?,item_title=?,item_url=?,content_version=?,item_published_at=? WHERE id=?').run('invalid\0payment-date','\ufeffsource\0lone\ud800','rationale\0','invalid\0expiry','origin\0','title\0','url\0','version\0','published\0',id));return payment('padded');},
  expose,
  settlePadded(){settle('padded',PAYMENT_CONSUMED_FIXTURE_RECEIPTS.padded);},
  settleWhitespace(kind:PaymentConsumedWhitespace='bom'){const values={space:' ',tab:'\t',bom:'\ufeff',ideographic:'\u3000'};assert(Object.hasOwn(values,kind));settle('whitespace',values[kind]);},
  settleNul(){settle('nul',PAYMENT_CONSUMED_FIXTURE_RECEIPTS.nul);},
  snapshot(){const db=live();assert.equal(db.prepare('SELECT count(*) AS n FROM browser_journal_writer').get()!.n,0);return Object.freeze({tables:Object.fromEntries(PAYMENT_CONSUMED_FIXTURE_TABLES.map(table=>[table,db.prepare('SELECT * FROM '+table).all()])) as Record<typeof PAYMENT_CONSUMED_FIXTURE_TABLES[number],Record<string,unknown>[]>,payments:(Object.keys(records) as PaymentConsumedFixtureCase[]).map(key=>payment(key))});},
  changes(){return live().prepare('SELECT total_changes() AS n').get()!.n;},
  close(){if(closed)return;closed=true;cleanup();},
 });
}
