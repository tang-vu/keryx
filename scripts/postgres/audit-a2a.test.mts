import { afterEach,expect,it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { ARC_MAINNET_PROFILE } from '../../lib/arc-network-profile';
import { a2aOrderId } from '../../lib/a2a/order';
import { auditA2a } from './audit-a2a.mts';
const opened:DatabaseSync[]=[];afterEach(()=>{for(const db of opened.splice(0))db.close();});
function fixture(){
 const db=new DatabaseSync(':memory:');opened.push(db);
 db.exec(`CREATE TABLE a2a_orders(id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,service_fee_usdc,transaction_id,request_data);
 CREATE TABLE research_purchase_authorizations(network,asset,payer,payee,authorization_id,request_hash,amount_micros,product,purchase_id);
 CREATE TABLE payment_events(id,query_id,network,payer,payee,authorization_id,amount_usdc,settled,settlement_status,tx_hash,kind,source_id);`);
 const network=ARC_MAINNET_PROFILE.networkId,payer='0x'+'a1'.repeat(20),payee='0x'+'b2'.repeat(20),authorizationId='0x'+'c3'.repeat(32),id=a2aOrderId({network,payer,payee,authorizationId}),hash='d4'.repeat(32);
 db.prepare('INSERT INTO a2a_orders VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,id,authorizationId,hash,payer,payee,.0157,.0107,.005,'retained-transaction',JSON.stringify({network,origin:'a2a',question:'Private original'}));
 db.prepare('INSERT INTO research_purchase_authorizations VALUES(?,?,?,?,?,?,?,?,?)').run(network,ARC_MAINNET_PROFILE.usdcAddress.toLowerCase(),payer,payee,authorizationId,hash,15700,'a2a',id);
 db.prepare('INSERT INTO payment_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('inbound_'+id,id,network,payer,payee,authorizationId,.0157,1,'settled','retained-transaction','inbound','a2a');db.exec('BEGIN');
 return {db,id,audit:()=>auditA2a(db,performance.now()+10000)};
}
it('retains exact micro-USDC and recorded tuple consistency without claiming authenticity or authority',()=>{
 const {audit}=fixture(),r=audit();expect(r).toMatchObject({orders:1,invalidAmounts:0,splitMismatches:0,mainnetRequests:1,canonicalOrderIds:1,purchaseTuples:1,inboundTuples:1,originalsModified:false,settlementAuthenticityVerified:false,enrollmentAuthorized:false,executionAuthorized:false});expect(JSON.stringify(r)).not.toMatch(/Private original|retained-transaction|0xa1a1/);expect(audit().projectionDigest).toBe(r.projectionDigest);
});
it('refuses rounding unsafe or fractional micro-USDC into import-compatible amounts',()=>{
 for(const value of [.0000001,.015700000001,Number.MAX_SAFE_INTEGER]){const {db,audit}=fixture();db.prepare('UPDATE a2a_orders SET amount_usdc=?').run(value);expect(audit()).toMatchObject({invalidAmounts:1,purchaseTuples:0,inboundTuples:0});}
 const {db,audit}=fixture();db.exec('UPDATE a2a_orders SET creator_budget_usdc=.0106');expect(audit()).toMatchObject({invalidAmounts:0,splitMismatches:1,purchaseTuples:0,inboundTuples:0});
});
it('requires the complete inbound tuple and refuses ambiguous purchase lineage',()=>{
 const {db,audit}=fixture();const before=audit();db.exec("UPDATE payment_events SET tx_hash='different'");expect(audit()).toMatchObject({purchaseTuples:1,inboundTuples:0});expect(audit().projectionDigest).not.toBe(before.projectionDigest);
 db.exec('INSERT INTO research_purchase_authorizations SELECT * FROM research_purchase_authorizations');expect(audit()).toMatchObject({purchaseTuples:0,inboundTuples:0});
});
it('keeps absent, malformed, monthly and noncanonical original networks distinct',()=>{
 for(const request of ['not-json','{}',JSON.stringify({network:'arc'})]){const {db,audit}=fixture();db.prepare('UPDATE a2a_orders SET request_data=?').run(request);expect(audit()).toMatchObject({unknownNetworkRequests:1,purchaseTuples:0,inboundTuples:0});}
 const {db,audit}=fixture();db.prepare('UPDATE a2a_orders SET request_data=?').run(JSON.stringify({network:ARC_MAINNET_PROFILE.networkId,monthlyId:'retained-monthly'}));expect(audit()).toMatchObject({mainnetRequests:1,monthlyOrders:1,purchaseTuples:0,inboundTuples:0});
});
it('requires a held snapshot and retains finite deadline and original-byte bounds',()=>{
 const {db,audit}=fixture();expect(()=>auditA2a(db,performance.now()-1)).toThrow();db.prepare('UPDATE a2a_orders SET request_data=?').run('x'.repeat(262145));expect(audit()).toMatchObject({oversizeOriginals:1,unknownNetworkRequests:1});db.exec('ROLLBACK');expect(audit).toThrow();
});
