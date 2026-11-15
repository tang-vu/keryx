import {DatabaseSync} from 'node:sqlite';
import {describe,it,expect} from 'vitest';
import {installSqliteApplicationSchema} from '../sqlite-application-schema';
import {initializeSqliteResearchMonthly} from '../research-monthly';
import {readSqliteOperatorInventory} from '../../business-operator/inventory';
import {recordSqliteWithdrawal} from '../withdrawal-records';
import {captureOperatorInventory,captureOperatorPublic,captureWithdrawalSource,heldWithdrawalSourceFixture,reduceOperatorInventory,reduceOperatorPublic,sourceCellText,sourceJulianDay} from './operator-withdrawal-packet';
import {STORAGE_MAINNET_PROFILE_DIGEST,validateStorageIdentity} from '../storage-identity';
const wallet='0x'+'ab'.repeat(20),network='eip155:5042002',at='2026-11-15T12:00:00.000Z',nowMs=Date.parse(at),input=()=>captureOperatorInventory({network,payee:wallet,nowMs},network);
// Actual ordinary Source schema/helper oracle. This does not register an
// enrolled/native facade or use copied identity as financial authority.
function source(){const db=new DatabaseSync(':memory:');installSqliteApplicationSchema(db);initializeSqliteResearchMonthly(db);return db;}
function order(db:DatabaseSync,id:string){db.prepare(`INSERT INTO a2a_orders(id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,service_fee_usdc,research_mode,status,transaction_id,request_data,created_at,updated_at) VALUES(?,?,?,?,?,?,1,.8,.2,'quick','running','synthetic',?,?,?)`).run(id,id,'0x'+id.padEnd(64,'a'),'hash-'+id,wallet,wallet,JSON.stringify({network}),at,at);}
function snapshot(db:DatabaseSync){return {format:'keryx-source-operator-inventory-v1',orders:db.prepare("SELECT payee,creator_budget_usdc budget,started_at started,transaction_id AS 'transaction',request_data request FROM a2a_orders WHERE status='running'").all(),monthly:db.prepare('SELECT data wire,(SELECT count(*) FROM research_monthly_redemptions r WHERE r.monthly_id=m.id) used FROM research_monthly m').all()};}
describe('Source operator and withdrawal scalar protocols',()=>{
 it.each(['2026-11-15','2026-11-15T12:00:00.0004999Z','2026-11-15T12:00:00.0005Z','2026-11-15T19:00:00.123456789+07:00','2026-11-15 12:00','12:34','12:34:56.123','2024-02-30','2026-01-01T24:59:59Z','2026-11-15TT  T12:00:00Z','2026-11-15T12:00:00z','2026-11-15T12:00:00+14:59','2026-11-15T12:00:00+15:00','2000-01-01T00:00:00Z\0ignored','2451545','-1','garbage','','2026-13-01','2026-11-15T12:60:00Z',null,2451545,5373484.499999999,0,-0,'-4713-11-24T12:00:00Z'])('uses genuine SQLite julianday arithmetic for %s',value=>{
  const db=new DatabaseSync(':memory:');try{expect(sourceJulianDay(value)).toBe(db.prepare('SELECT julianday(?) n').get(value)?.n);}finally{db.close();}
 });
 it('explicitly refuses non-deterministic Source clock tokens rather than inventing a timestamp',()=>{for(const token of ['now','subsec','subsecond','SUBSEC'])expect(()=>sourceJulianDay(token)).toThrow();});
 it.each(['2026-11-15t12:00:00Z','2026-11-1512:00:00Z','2026-11-15\t12:00:00Z','2026-11-15T','2026-11-15Z','2026-11-15 Z','2026-11-15T12:00:00Z\u00a0','\u00a02451545',' 2026-11-15','2026-11-15  '])('retains SQLite date separators/ASCII whitespace for %s',value=>{const db=new DatabaseSync(':memory:');try{expect(sourceJulianDay(value)).toBe(db.prepare('SELECT julianday(?) n').get(value)?.n);}finally{db.close();}});
 it('matches ALL obligations, invalid rows, byte casefold, first duplicate JSON members and microsecond clock thresholds',()=>{
  const db=source();try{
   for(let i=0;i<8;i++)order(db,String(i));
   db.prepare('UPDATE a2a_orders SET started_at=? WHERE id=?').run('2026-11-15T11:45:00.0004999Z','1');
   db.prepare('UPDATE a2a_orders SET started_at=? WHERE id=?').run('bad date','2');
   db.prepare('UPDATE a2a_orders SET started_at=? WHERE id=?').run('2026-11-15T12:00:01Z','3');
   db.prepare('UPDATE a2a_orders SET transaction_id=? WHERE id=?').run('   ','4');
   db.prepare('UPDATE a2a_orders SET request_data=? WHERE id=?').run('{"network":"'+network+'","network":"foreign"}','5');
   db.prepare('UPDATE a2a_orders SET request_data=? WHERE id=?').run('{"network":"'+network+'\\u0000foreign"}','6');
   db.prepare('UPDATE a2a_orders SET payee=? WHERE id=?').run('İ'+wallet,'7');
   const monthly={payee:wallet,network,creatorBudgetMicros:800000,createdAt:'2026-11-14T12:00:00.123456789Z',expiresAt:'2026-11-16T12:00:00Z',transaction:'synthetic'};
   db.prepare('INSERT INTO research_monthly VALUES(?,?,?)').run('m',wallet,JSON.stringify(monthly));
   db.prepare('INSERT INTO research_monthly VALUES(?,?,?)').run('bad',wallet,JSON.stringify({...monthly,transaction:' ',creatorBudgetMicros:1.5}));
   const expected=readSqliteOperatorInventory(db,input(),network);expect(reduceOperatorInventory(snapshot(db),input())).toEqual(expected);expect(expected.invalidJobs).toBeGreaterThan(0);expect(expected.queuedJobs+expected.processingJobs+expected.reviewRequiredJobs).toBe(8);
  }finally{db.close();}
 });
 it.each(['{"network\\u0000suffix":"foreign"}','{"\\u006eetwork":"foreign","network":"'+network+'"}','{"network":"'+network+'","\\u006eetwork":"foreign"}','{"network":"'+network+'","deep":'+ '['.repeat(1000)+'0'+']'.repeat(1000)+'}'])('uses actual JSON1 key/validity rules for %s',wire=>{const db=source();try{order(db,'0');db.prepare('UPDATE a2a_orders SET request_data=? WHERE id=?').run(wire,'0');expect(reduceOperatorInventory(snapshot(db),input())).toEqual(readSqliteOperatorInventory(db,input(),network));}finally{db.close();}});
 it.each(['null','[]','broken','{"payee":null}','{"payee":"'+wallet+'","network":null,"creatorBudgetMicros":1,"createdAt":"2026-11-14","expiresAt":"2026-11-16","transaction":"x"}','{"payee":"'+wallet+'","network":"'+network+'","creatorBudgetMicros":1e0,"createdAt":"2026-11-14","expiresAt":"2026-11-16","transaction":"x"}'])('retains Source malformed/prepaid semantics for %s',wire=>{
  const db=source();try{db.prepare('INSERT INTO research_monthly VALUES(?,?,?)').run('m',wallet,wire);let expected:unknown,error:unknown;try{expected=readSqliteOperatorInventory(db,input(),network);}catch(e){error=e;}if(error)expect(()=>reduceOperatorInventory(snapshot(db),input())).toThrow();else expect(reduceOperatorInventory(snapshot(db),input())).toEqual(expected);}finally{db.close();}
 });
 it.each(['1','0001','1.0','1e3','Infinity','10garbage',null,true,{},[]])('preserves SQL numeric coercion and storage-class MAX for invalid cap %s',cap=>{
  const db=source();try{db.prepare('INSERT INTO research_monthly VALUES(?,?,?)').run('m',wallet,JSON.stringify({payee:wallet,network,creatorBudgetMicros:cap,createdAt:'2026-11-14',expiresAt:'2026-11-16',transaction:'synthetic'}));let expected:unknown,error:unknown;try{expected=readSqliteOperatorInventory(db,input(),network);}catch(e){error=e;}if(error)expect(()=>reduceOperatorInventory(snapshot(db),input())).toThrow();else expect(reduceOperatorInventory(snapshot(db),input())).toEqual(expected);}finally{db.close();}
 });
 it('captures actual node:sqlite scalar bindings and keeps first reporting metadata on replay',async()=>{
  const db=source();try{const value={txHash:'0x'+'cd'.repeat(32),createdAt:'2026-11-15T19:00:00.123456789+07:00',label:'label\0\ud800',sourceName:'\ufeffsource',wallet,recipient:wallet,amountUsdc:.30000000000000004,network:'network\0\udc00'};
   const captured=captureWithdrawalSource(value);await expect(recordSqliteWithdrawal(db,value)).rejects.toThrow('conflicting');value.label='changed';await expect(recordSqliteWithdrawal(db,value)).rejects.toThrow('conflicting');const saved=db.prepare('SELECT * FROM withdrawals').get()!;
   expect(sourceCellText(captured.cells.label)).toBe(saved.label);expect(sourceCellText(captured.cells.source_name)).toBe(saved.source_name);expect(sourceCellText(captured.cells.network)).toBe(saved.network);expect(sourceCellText(captured.cells.created_at)).toBe(saved.created_at);
   await expect(recordSqliteWithdrawal(db,{...value,amountUsdc:.4})).rejects.toThrow('conflicting');expect(saved.label).toContain('\0');
  }finally{db.close();}
 });
 it('returns identifier-free public Source cohort/counter schemas and refuses extra roots or overflow',()=>{
  const raw={format:'keryx-source-operator-public-v1',registered:3,rows:[{status:'completed',createdAt:'2026-11-15T11:00:00Z',updatedAt:'2026-11-15T11:01:00Z',startedAt:null,completionCohort:'recovered'}]};
  const result=reduceOperatorPublic(raw,nowMs);expect(result.jobs?.completionLatencyCohorts?.recovered.completed).toBe(1);expect(JSON.stringify(result)).not.toMatch(/wallet|payer|sourceId/);expect(()=>reduceOperatorPublic({...raw,owner:wallet},nowMs)).toThrow();
  expect(()=>reduceOperatorPublic({...raw,rows:Array(1001).fill(raw.rows[0])},nowMs)).toThrow();
 });
 it('refuses wrong network, incomplete rows and complete collections beyond the finite envelope',()=>{
  expect(()=>captureOperatorInventory({network:'eip155:5042',payee:wallet,nowMs},network)).toThrow('network mismatch');expect(()=>captureOperatorPublic(Number.NaN)).toThrow();
  expect(()=>reduceOperatorInventory({format:'keryx-source-operator-inventory-v1',orders:[{}],monthly:[]},input())).toThrow();expect(()=>reduceOperatorInventory({format:'keryx-source-operator-inventory-v1',orders:Array(1001).fill({}),monthly:[]},input())).toThrow();
  expect(()=>reduceOperatorInventory({format:'keryx-source-operator-inventory-v1',orders:[],monthly:[{wire:'x'.repeat(4194304),used:0}]},input())).toThrow();expect(captureOperatorPublic(.5).nowMs).toBe(.5);
 });
 it('retains independently observed held NULL/display/date cells and refuses missing columns',()=>{
  const identity=validateStorageIdentity({format:'keryx-mainnet-storage-identity-v1',deploymentId:'11111111-1111-4111-8111-111111111111',storageId:'22222222-2222-4222-8222-222222222222',network:'eip155:5042',authorityMode:'mainnet-real',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,enrollmentId:'33333333-3333-4333-8333-333333333333',enrolledAt:'2026-11-14T00:00:00.000Z',provenanceDigest:'ee'.repeat(32)}),raw={tx_hash:'0x'+'ab'.repeat(32),created_at:'2026-11-15T19:00:00.123456789+07:00',label:'display\0byte',source_name:null,wallet,recipient:wallet,amount_usdc:.1,network:identity.network},held=heldWithdrawalSourceFixture(raw,identity);
  expect(held.cells.source_name).toBeNull();expect(held.unprojected).toEqual(['label']);expect(held.physicalSql).toContain('NULL');expect(sourceCellText(held.cells.created_at)).toBe(raw.created_at);expect(held.scalarSql).toContain('identity_digest');expect(()=>heldWithdrawalSourceFixture({...raw,created_at:undefined},identity)).toThrow();
 });
});
