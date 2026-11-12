/** Synthetic table constraints only; not optional-port or financial authority. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
export function qualifyCurrentTableConstraints(ownerSql:(sql:string)=>string){
 const db=new DatabaseSync(':memory:');let vectors=0;
 const q=(s:string)=>"'"+s.replaceAll("'","''")+"'",wallet='0x'+'a1'.repeat(20),account='acct_'+'12'.repeat(32);
 const check=(statement:string,valid:boolean)=>{
  let sqlite=true;db.exec('SAVEPOINT vector');try{db.exec(statement);}catch{sqlite=false;}finally{db.exec('ROLLBACK TO vector;RELEASE vector');}
  let native=true;try{ownerSql('BEGIN;'+statement+'ROLLBACK;');}catch{native=false;}
  assert.equal(sqlite,valid,`SQLite SOURCE vector ${vectors+1}`);assert.equal(native,sqlite,`Native table constraint parity ${vectors+1}`);vectors++;
 };
 try{
  db.exec('BEGIN');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);db.exec('COMMIT');
  const accountRow=(id=account,revision='0')=>`INSERT INTO account267_accounts(account_id,revision,created_at) VALUES(${q(id)},${revision},0);`;
  check(accountRow(),true);check(accountRow('acct_'+'zz'.repeat(32)),false);check(accountRow(account,'-1'),false);check(accountRow(account,'9007199254740992'),false);check(accountRow(account,'0.5'),false);
  const profile=(handle='reader',links='[]',address=wallet)=>`INSERT INTO private_profiles(wallet,handle,display_name,bio,purpose,links,created_at,updated_at) VALUES(${q(address)},${q(handle)},'Reader','','',${q(links)},'2026-11-12T00:00:00.000Z','2026-11-12T00:00:00.000Z');`;
  check(profile(),true);check(profile('admin'),false);check(profile('Reader'),false);check(profile('1reader'),false);check(profile('reader','{}'),false);check(profile('reader','['),false);
  check(profile('reader',JSON.stringify(Array(7).fill('https://example.test'))),false);check(profile('reader','[]','0x'+'A1'.repeat(20)),false);
  const operation=(value:string)=>`INSERT INTO owner269_operations(request_id,input_digest,event) VALUES('synthetic-op',${q('11'.repeat(32))},${q(value)});`;
  check(operation('{}'),true);check(operation('bad-json'),false);check(operation(JSON.stringify({value:'\u00e9'.repeat(33000)})),false);
  check("INSERT INTO run_privacy(run_id,visibility,updated_at) VALUES('synthetic-run','private','2026-11-12T00:00:00.000Z');",true);
  check("INSERT INTO run_privacy(run_id,visibility,updated_at) VALUES('synthetic-run','unknown','2026-11-12T00:00:00.000Z');",false);
  return {vectors,asciiWalletAndHandleRules:true,integerAndUtf8ByteBounds:true,jsonKindAndArrayLimits:true,productionData:false,applicationBackendSwitched:false};
 }finally{db.close();}
}
