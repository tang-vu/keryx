import {expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,existsSync,unlinkSync,rmdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ARC_MAINNET_PROFILE as profile} from '../../lib/arc-network-profile';
import {installMainnetApplicationSchema} from '../../lib/db/mainnet-application-schema';
import {installNativeUserDomainSchema} from '../../lib/db/native-user-domain-schema';
import {insertStorageIdentity,installStorageFences} from '../../lib/db/storage-identity-sqlite';
import {openVerifiedSqliteStorage,assertVerifiedSqliteConnection} from '../../lib/db/storage-identity-connection';
import {supportedSqliteApplicationProfiles} from '../../lib/db/enrolled-sqlite-schema-profile';
import {STORAGE_MAINNET_PROFILE_DIGEST,validateStorageIdentity} from '../../lib/db/storage-identity';
import {SqliteAdapter} from '../../lib/db/sqlite-adapter';
import {prepareBrowserJournal,type BrowserJournalAdmission} from '../../lib/db/browser-authorization-journal';
import {activateSqliteBrowserJournal,admitSqliteBrowserJournalInTransaction,sqliteJournalTransaction,upsertSqliteJournalGrant,transitionSqliteBrowserJournal,terminalSqliteJournalPayment} from '../../lib/db/sqlite-browser-journal';
import {PAYMENT_EVENT_FIELDS} from '../../lib/db/postgres/payment-events-packet';
import {captureObservedPaymentSource} from './payment-original-source.mts';
import {LEGACY_PAYMENT_CONSUMED_FIELDS,KNOWN_PAYMENT_UNPROJECTED_FIELDS} from './payment-browser-source.mts';

const expectedColumns=['id','network','authorization_id','grant_epoch','payer','payee','amount_usdc','settled','settlement_status','authorization_phase','tx_hash'];
it('binds each finite mapping to the existing transitive financial helper columns',()=>{
 const read=(name:string)=>readFileSync(new URL('../../ops/keryx-postgres/'+name,import.meta.url),'utf8');
 const funding=read('session-funding.sql').match(/CREATE FUNCTION keryx_storage\.session_funding_totals[\s\S]*?END;\s*\$\$;/)![0];
 expect([...new Set([...funding.matchAll(/\bp\.([a-z0-9_]+)/g)].map(m=>m[1]))].sort()).toEqual([...expectedColumns].sort());
 expect(funding).not.toContain('p.created_at');expect(funding).toContain('SELECT i.*,');expect(funding).toContain('r.created_at::timestamptz>baseline');
 const hosted=read('hosted-ledger.sql').match(/CREATE FUNCTION keryx_storage\.hosted_totals[\s\S]*?END;\s*\$\$;/)![0];
 const hostedPaymentFields=[...new Set([...hosted.matchAll(/\br\.([a-z0-9_]+)/g)].map(m=>m[1]))].filter(name=>(PAYMENT_EVENT_FIELDS as readonly string[]).includes(name));
 expect(hostedPaymentFields.sort()).toEqual(['id','network','authorization_id','payer','payee','amount_usdc','settled','settlement_status','tx_hash'].sort());
 const withdrawals=read('session-withdrawals.sql'),owner=read('owner-withdrawals.sql');
 expect(withdrawals).toContain('funding:=keryx_storage.session_funding_totals(signer,NULL)');
 expect(owner).toContain('session:=keryx_storage.session_funding_totals(owner_addr,NULL);hosted:=keryx_storage.hosted_totals(owner_addr,NULL)');
 for(const fields of Object.values(LEGACY_PAYMENT_CONSUMED_FIELDS))expect(fields).toEqual(expectedColumns);
 expect(Object.isFrozen(LEGACY_PAYMENT_CONSUMED_FIELDS)).toBe(true);expect(Object.isFrozen(KNOWN_PAYMENT_UNPROJECTED_FIELDS)).toBe(true);
 for(const unsupported of ['future_field','amount_usdc','weight','settled','id','kind','query_id',null])expect(KNOWN_PAYMENT_UNPROJECTED_FIELDS).not.toContain(unsupported);
 const guard=read('payment-observation.sql'),trim=guard.match(/btrim\(p\.tx_hash,U&'([^']+)'\)/)![1];
 const whitespace=[...trim.matchAll(/\\([0-9A-F]{4})/g)].map(m=>Number.parseInt(m[1],16));
 const sourceSet:number[]=[];for(let n=0;n<=0x10ffff;n++)if(String.fromCodePoint(n).trim()==='')sourceSet.push(n);
 expect(whitespace).toEqual(sourceSet);expect(whitespace).toHaveLength(25);
});

// Real, fresh verified Source fixture with genuine plain-journal producers.
// This supplies neither Native installed provenance nor actual funding/signing.
async function sourceFixture(run:(core:SqliteAdapter,db:DatabaseSync,id:string,nonce:string,session:string,request:string,signer:string)=>Promise<void>){
 const folder=mkdtempSync(join(tmpdir(),'keryx-consumed-payment-')),file=join(folder,'synthetic.sqlite');
 const signer='0x'+'22'.repeat(20),owner='0x'+'11'.repeat(20),payee='0x'+'33'.repeat(20),epoch=randomUUID(),session='synthetic-consumed-fields',request='synthetic-request';
 const identity=validateStorageIdentity({format:'keryx-mainnet-storage-identity-v1',authorityMode:'mainnet-real',network:profile.networkId,profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:new Date().toISOString(),provenanceDigest:'71'.repeat(32)});
 let source:ReturnType<typeof openVerifiedSqliteStorage>|undefined,nonce='';
 try{
  const seed=new DatabaseSync(file);try{
   seed.exec('BEGIN IMMEDIATE');installMainnetApplicationSchema(seed,{publicReferenceArchive:true});installNativeUserDomainSchema(seed);seed.exec('COMMIT');activateSqliteBrowserJournal(seed,profile);
   upsertSqliteJournalGrant(seed,{sessionId:session,sessAddr:signer,ownerAddr:owner,cap:.01,expiry:Date.now()+60000,txHash:'synthetic-unfunded-fixture',grantEpoch:epoch});
   const input:BrowserJournalAdmission={sessionId:session,signer,grantEpoch:epoch,requestId:request,queryId:'synthetic-query',sourceId:'synthetic-source',offerId:null,kind:'fetch',payee,amountMicroUsdc:1,network:profile.networkId,token:profile.usdcAddress,gatewayContract:profile.gatewayWallet,
    requirements:{scheme:'exact',network:profile.networkId,asset:profile.usdcAddress,payTo:payee,amount:'1',maxTimeoutSeconds:691200,extra:{name:'GatewayWalletBatched',version:'1',verifyingContract:profile.gatewayWallet}},
    payment:{kind:'fetch',queryId:'synthetic-query',sourceId:'synthetic-source',sourceName:'Synthetic',payer:signer,payee,amountUsdc:.000001,network:profile.networkId,grantEpoch:epoch}};
   const prepared=prepareBrowserJournal(input,profile),result=sqliteJournalTransaction(seed,()=>admitSqliteBrowserJournalInTransaction(seed,input,prepared));if(result.status!=='admitted')throw Error('Synthetic Source journal refused');nonce=result.journal.nonce;
   seed.exec('BEGIN IMMEDIATE');insertStorageIdentity(seed,identity);installStorageFences(seed,identity);seed.exec('COMMIT');
  }finally{seed.close();}
  source=openVerifiedSqliteStorage(file,identity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>{}});
  const core=SqliteAdapter.assembleConnectionCore(source.db,identity,()=>expect(assertVerifiedSqliteConnection(source!.db)).toEqual(identity));await run(core,source.db,'x402:'+nonce,nonce,session,request,signer);
 }finally{source?.close();for(const path of [file,file+'-wal',file+'-shm',file+'-journal'])if(existsSync(path))unlinkSync(path);rmdirSync(folder);}
}
it('proves Source ignores payment presentation/date gaps but requires actual original receipt evidence',async()=>sourceFixture(async(core,db,id,nonce,session,request,signer)=>{
 const read=async()=>({funding:await core.sessionFundingAccounting(signer),confirmed:await core.browserSignerConfirmedSpendMicro(signer),withdrawal:await core.sessionWithdrawalAccounting(signer),owner:await core.creatorOwnerWithdrawalAccounting(signer)});
 const baseline=await read();
 sqliteJournalTransaction(db,()=>db.prepare('UPDATE payment_events SET created_at=?,source_name=?,rationale=?,authorization_expires_at=?,origin=?,item_title=?,item_url=?,content_version=?,item_published_at=? WHERE id=?').run('invalid\0payment-date','\ufeffsource\0lone\ud800','rationale\0','invalid\0expiry','origin\0','title\0','url\0','version\0','published\0',id));
 const packet=captureObservedPaymentSource(db,id)!;
 expect(packet.unprojectedFields).toEqual(['authorization_expires_at','content_version','created_at','item_published_at','item_title','item_url','origin','rationale','source_name']);
 expect(packet.row.source_name).toBe('\ufeffsource\0lone\ufffd');expect(packet.row.created_at).toBe('invalid\0payment-date');
 expect(await read()).toEqual(baseline);const changes=db.prepare('SELECT total_changes() AS n').get()!.n;await read();expect(db.prepare('SELECT total_changes() AS n').get()!.n).toBe(changes);
 expect(transitionSqliteBrowserJournal(db,session,request,'prepared','exposed')).toBe(true);expect(terminalSqliteJournalPayment(db,id,nonce,'receipt\0retained',false)).toEqual({resolved:true,reservationReleased:false});
 const confirmed=await read();expect(confirmed.funding.confirmedSpentMicroUsdc).toBe('1');expect(confirmed.confirmed).toBe(1);
 const receipt=captureObservedPaymentSource(db,id)!;expect(receipt.unprojectedFields).toContain('tx_hash');expect(receipt.projection.tx_hash).toBeNull();expect(receipt.row.tx_hash).toBe('receipt\0retained');
 // Source counts this exact NUL receipt; using the NULL native projection
 // would lose its evidence. Every finite operation must keep tx_hash held.
 for(const fields of Object.values(LEGACY_PAYMENT_CONSUMED_FIELDS))expect(fields).toContain('tx_hash');
 for(const blank of [' ','\t','\ufeff','\u3000']){
  sqliteJournalTransaction(db,()=>db.prepare('UPDATE payment_events SET tx_hash=? WHERE id=?').run(blank,id));
  // Representable text is not itself receipt evidence: every JS-trim-empty
  // class still has to refuse. This is not a new SUM/value equivalence claim.
  expect(captureObservedPaymentSource(db,id)!.unprojectedFields).not.toContain('tx_hash');
  await expect(core.sessionFundingAccounting(signer)).rejects.toThrow('Original settled debit');await expect(core.browserSignerConfirmedSpendMicro(signer)).rejects.toThrow('Original settled debit');await expect(core.sessionWithdrawalAccounting(signer)).rejects.toThrow('Original settled debit');await expect(core.creatorOwnerWithdrawalAccounting(signer)).rejects.toThrow('Original settled debit');
 }
 sqliteJournalTransaction(db,()=>db.prepare('UPDATE payment_events SET tx_hash=? WHERE id=?').run(' \ufeffordinary-receipt\t ',id));
 expect((await read()).funding.confirmedSpentMicroUsdc).toBe('1');expect(captureObservedPaymentSource(db,id)!.unprojectedFields).not.toContain('tx_hash');
}));
