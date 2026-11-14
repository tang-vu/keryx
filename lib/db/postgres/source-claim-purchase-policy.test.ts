import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { config } from '../../config';
import { canonicalJson } from '../../canonical-json';
import { issueSqliteSourceClaimChallenge,verifySqliteSourceClaim,bindSqliteSourceClaim,updateSqliteSourceClaimPolicy,admitSqliteSourceClaimPurchasePolicy } from '../public-source-claims';
import { captureSourceClaimPurchasePolicy,captureHostedSourceClaimPolicy,sourceClaimPolicySelector,decodeSourceClaimPolicySnapshot,type SourceClaimPurchasePolicyInput,type SourceClaimPolicyRuntime } from './source-claim-purchase-policy';
import { operatingFeePolicyDigest,operatingFeeRequestHash,OPERATING_FEE_SOURCE_ID,OPERATING_FEE_POLICY_KEY_PREFIX } from '../../payments/operating-fee-policy';
const owner='0x'+'11'.repeat(20),payee='0x'+'22'.repeat(20),registry='0x'+'88'.repeat(20),onchain='0x'+'cc'.repeat(32),nonce='0x'+'ab'.repeat(32),origin='https://keryx.cc',network='eip155:5042',prefix='keryx:source-claims:v1:';
const runtime:SourceClaimPolicyRuntime={deploymentOrigin:origin,fallbackAddress:registry,authorities:[]};
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const originalSettings={baseUrl:config.baseUrl,registryReadAddress:config.registryReadAddress,registryOrigins:config.registryOrigins};
const open:DatabaseSync[]=[];
beforeEach(()=>Object.assign(config,{baseUrl:origin,registryReadAddress:registry,registryOrigins:''}));
afterEach(()=>{for(const db of open.splice(0))db.close();Object.assign(config,originalSettings);vi.unstubAllEnvs();});
function fixture(mode:'paid'|'citation-only'|'free'='paid'){
 const db=new DatabaseSync(':memory:');open.push(db);db.exec(`CREATE TABLE sync_state(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
 CREATE TABLE sources(id TEXT PRIMARY KEY,url TEXT,onchain_id TEXT,active INTEGER,verified INTEGER,scholarly_enrolled INTEGER,evidence_provenance TEXT,rss_url TEXT,source_claim_id TEXT);
 CREATE TABLE browser_authorization_intents(nonce TEXT PRIMARY KEY,network TEXT,signer TEXT,source_id TEXT,kind TEXT,payee TEXT,amount_micro_usdc INTEGER);
 CREATE TABLE browser_journal_bindings(nonce TEXT PRIMARY KEY,payment_metadata TEXT,payment_context TEXT);
 CREATE TABLE hosted_treasury_authorizations(nonce TEXT PRIMARY KEY,signer TEXT,original TEXT,policy_digest TEXT,submitted INTEGER,header_hash TEXT);
 CREATE TABLE hosted_treasury_policies(digest TEXT PRIMARY KEY,data TEXT,role TEXT);
 CREATE TABLE research_purchase_authorizations(network TEXT,payer TEXT,authorization_id TEXT);`);
 const now=Date.now()-1000,sourceId='managed-source',url='https://publisher.example/Case?a=1';
 db.prepare('INSERT INTO sources(id,url,onchain_id,active,verified) VALUES(?,?,?,1,1)').run(sourceId,url,onchain);
 const challenge=issueSqliteSourceClaimChallenge(db,{wallet:owner,canonicalUrl:url,deploymentOrigin:origin,network,now}),verified=verifySqliteSourceClaim(db,{challengeId:challenge.id,wallet:owner,proofDigest:'dd'.repeat(32),now:now+1}),linked=bindSqliteSourceClaim(db,{claimId:verified.id,wallet:owner,expectedRevision:1,sourceId,onchainId:onchain,registryAddress:registry,now:now+2}),claim=updateSqliteSourceClaimPolicy(db,{claimId:linked.id,wallet:owner,expectedRevision:2,mode,distributionPermission:mode!=='free',now:now+3});
 const {id,revision,effectiveAt,verifiedAt}=claim,receipt={id,revision,effectiveAt,verifiedAt,mode};
 const input:SourceClaimPurchasePolicyInput={identity:{network,payer:owner,authorizationId:nonce},existing:false,sourceId,receipt,kind:'fetch',payee,amountMicros:7,requestHash:'ef'.repeat(32)};
 return {db,input,claim,sourceId};
}
function envelope(db:DatabaseSync,input:SourceClaimPurchasePolicyInput,hosted=false){
 const selector=sourceClaimPolicySelector({sourceId:input.sourceId??null,identity:hosted?null:input.identity}),selection=JSON.parse(selector),id=input.identity.authorizationId;
 const intent=db.prepare('SELECT * FROM browser_authorization_intents WHERE nonce=?').get(id),binding=db.prepare('SELECT * FROM browser_journal_bindings WHERE nonce=?').get(id),authorization=db.prepare('SELECT * FROM hosted_treasury_authorizations WHERE nonce=?').get(id),policy=authorization?db.prepare('SELECT * FROM hosted_treasury_policies WHERE digest=?').get(String(authorization.policy_digest)):null;
 const snapshot={selector:selection,source:input.sourceId?db.prepare('SELECT * FROM sources WHERE id=?').get(input.sourceId)??null:null,rows:db.prepare('SELECT key,value FROM sync_state ORDER BY key').all(),browser:hosted?null:intent?{intent,binding:binding??null}:null,hosted:hosted?null:authorization?{authorization,policy:policy??null}:null,purchase:hosted?null:db.prepare('SELECT * FROM research_purchase_authorizations WHERE authorization_id=?').get(id)??null};
 const wire=JSON.stringify(snapshot);return {wire,sha256:sha(wire)};
}
function source(db:DatabaseSync,input:SourceClaimPurchasePolicyInput){db.exec('BEGIN');try{admitSqliteSourceClaimPurchasePolicy(db,input);db.exec('COMMIT');return true;}catch{db.exec('ROLLBACK');return false;}}
function compare(f:ReturnType<typeof fixture>,allowed:boolean){const native=()=>captureSourceClaimPurchasePolicy(envelope(f.db,f.input),f.input,runtime);if(allowed)expect(native()).toMatchObject({policySnapshot:{sourceId:f.input.sourceId,receipt:f.input.receipt??null,kind:f.input.kind}});else expect(native).toThrow();expect(source(f.db,f.input)).toBe(allowed);}
describe('SOURCE managed purchase policy projection',()=>{
 it.each(['paid','citation-only','free'] as const)('preserves %s fetch and citation eligibility',mode=>{const f=fixture(mode);compare(f,mode==='paid');const g=fixture(mode);g.input.kind='citation';compare(g,mode!=='free');});
 it('preserves canonical URL normalization and literal escape text',()=>{const f=fixture();f.db.prepare('UPDATE sources SET url=?').run('https://PUBLISHER.example/Case?a=1#fragment');compare(f,true);});
 it.each(['missing-receipt','revision','effective','verified','id','network','origin','registry','inactive','unverified','scholarly','synthetic','url','onchain','rss','marker','binding','current','first-history','last-history','proof','future','stale'] as const)('refuses %s with the actual Source oracle',kind=>{
  const f=fixture(),key=prefix+'claim:'+f.claim.id,update=(patch:Record<string,unknown>)=>{const c={...f.claim,...patch};f.db.prepare('UPDATE sync_state SET value=? WHERE key=?').run(canonicalJson(c),key);f.db.prepare('UPDATE sync_state SET value=? WHERE key=?').run(canonicalJson({claim:c,action:'policy',at:new Date().toISOString(),evidence:{}}),prefix+'history:'+f.claim.id+':0000000000000003');};
  if(kind==='missing-receipt')delete f.input.receipt;
  if(kind==='revision')f.input.receipt!.revision++;
  if(kind==='effective')f.input.receipt!.effectiveAt=new Date().toISOString();
  if(kind==='verified')f.input.receipt!.verifiedAt=new Date().toISOString();
  if(kind==='id')f.input.receipt!.id='ff'.repeat(32);
  if(kind==='network')f.input.identity.network='eip155:5042002';
  if(kind==='origin')update({deploymentOrigin:'https://other.example'});
  if(kind==='registry')update({registryAddress:payee});
  if(kind==='inactive')f.db.exec('UPDATE sources SET active=0');
  if(kind==='unverified')f.db.exec('UPDATE sources SET verified=0');
  if(kind==='scholarly')f.db.exec('UPDATE sources SET scholarly_enrolled=1');
  if(kind==='synthetic')f.db.exec("UPDATE sources SET evidence_provenance='synthetic-demo'");
  if(kind==='url')f.db.exec("UPDATE sources SET url='https://other.example/'");
  if(kind==='onchain')f.db.exec("UPDATE sources SET onchain_id='wrong'");
  if(kind==='rss')update({rssUrl:'https://publisher.example/feed'});
  if(kind==='marker')f.db.prepare('UPDATE sync_state SET value=? WHERE key=?').run('{}',prefix+'marker:'+sha(f.sourceId));
  if(kind==='binding')f.db.prepare('DELETE FROM sync_state WHERE key=?').run(prefix+'source:'+sha(f.sourceId));
  if(kind==='current')f.db.prepare('DELETE FROM sync_state WHERE key=?').run(key);
  if(kind==='first-history')f.db.prepare('DELETE FROM sync_state WHERE key=?').run(prefix+'history:'+f.claim.id+':0000000000000001');
  if(kind==='last-history')f.db.prepare('DELETE FROM sync_state WHERE key=?').run(prefix+'history:'+f.claim.id+':0000000000000003');
  if(kind==='proof')f.db.exec("DELETE FROM sync_state WHERE key LIKE '%challenge:%'");
  if(kind==='future'){const at=new Date(Date.now()+60000).toISOString();update({effectiveAt:at});f.input.receipt!.effectiveAt=at;}
  if(kind==='stale'){const at=new Date(Date.now()-25*3600000).toISOString();update({verifiedAt:at});f.input.receipt!.verifiedAt=at;}
  compare(f,false);
 });
 it.each(['\0','\ud800','\udc00','\\u0000'])('retains arbitrary latest-history evidence %j without losing managed identity',text=>{const f=fixture(),key=prefix+'history:'+f.claim.id+':0000000000000003',history=JSON.parse(String(f.db.prepare('SELECT value FROM sync_state WHERE key=?').get(key)!.value));history.evidence={retained:text};f.db.prepare('UPDATE sync_state SET value=? WHERE key=?').run(JSON.stringify(history),key);compare(f,true);});
 it('never treats malformed or escaped retained managed history as unmanaged absence',()=>{const f=fixture();delete f.input.receipt;f.db.prepare('DELETE FROM sync_state WHERE key IN(?,?)').run(prefix+'source:'+sha(f.sourceId),prefix+'marker:'+sha(f.sourceId));expect(()=>captureSourceClaimPurchasePolicy(envelope(f.db,f.input),f.input,runtime)).toThrow();f.db.exec("DELETE FROM sync_state;INSERT INTO sync_state VALUES('keryx:source-claims:v1:history:broken','{broken','now')");expect(()=>captureSourceClaimPurchasePolicy(envelope(f.db,f.input),f.input,runtime)).toThrow();});
 it('preserves existing receipt history after policy disables earnings',()=>{const f=fixture();compare(f,true);f.db.prepare('INSERT INTO research_purchase_authorizations VALUES(?,?,?)').run(network,owner,nonce);f.input.existing=true;updateSqliteSourceClaimPolicy(f.db,{claimId:f.claim.id,wallet:owner,expectedRevision:3,mode:'free',distributionPermission:false});compare(f,true);f.input.receipt!.revision++;compare(f,false);});
 it.each(['browser','hosted'] as const)('binds a linked %s original economic tuple and policy',kind=>{const f=fixture();if(kind==='browser'){f.db.prepare('INSERT INTO browser_authorization_intents VALUES(?,?,?,?,?,?,?)').run(nonce,network,owner,f.sourceId,'fetch',payee,7);f.db.prepare('INSERT INTO browser_journal_bindings VALUES(?,?,?)').run(nonce,JSON.stringify({sourceClaim:f.input.receipt}),JSON.stringify({item:{sourceClaim:f.input.receipt}}));}else f.db.prepare('INSERT INTO hosted_treasury_authorizations VALUES(?,?,?,?,?,?)').run(nonce,owner,JSON.stringify({context:{sourceId:f.sourceId,kind:'fetch',sourceClaim:f.input.receipt},payload:{message:{to:payee,value:'7'}}}),'policy',0,null);compare(f,true);const g={...f,input:{...f.input,amountMicros:8,existing:true}};f.db.prepare('INSERT INTO research_purchase_authorizations VALUES(?,?,?)').run(network,owner,nonce);compare(g,false);});
 it('refuses unavailable operating fee originals and missing browser binding',()=>{const f=fixture();f.input.kind='operating-fee';compare(f,false);const g=fixture();g.db.prepare('INSERT INTO browser_authorization_intents VALUES(?,?,?,?,?,?,?)').run(nonce,network,owner,g.sourceId,'fetch',payee,7);compare(g,false);});
 it.each(['valid','unsubmitted','header','retained-policy','request','payee','amount','source','private-role'] as const)('preserves %s operating seller original binding',kind=>{
  const f=fixture(),policy={format:'keryx-operating-fee-policy-v1' as const,network,origin,storageIdentityDigest:'ee'.repeat(32),beneficiary:payee,expiresAtSeconds:Math.floor(Date.now()/1000)+3600},fee={policyDigest:operatingFeePolicyDigest(policy),allocationDigest:'aa'.repeat(32),amountMicroUsdc:'7',sourceUrls:['https://publisher.example/unclaimed']};
  const context={queryId:'fee-query',queryBudgetMicroUsdc:'20',sourceId:OPERATING_FEE_SOURCE_ID,kind:'operating-fee',itemId:null,privateJob:null,operatingFee:fee},treasury={format:'keryx-hosted-treasury-policy-v1',network,origin,storageIdentityDigest:policy.storageIdentityDigest,signer:owner,lifetimeCapMicroUsdc:'100',queryCapMicroUsdc:'20',expiresAtSeconds:policy.expiresAtSeconds};
  Object.assign(f.input,{sourceId:OPERATING_FEE_SOURCE_ID,kind:'operating-fee',receipt:undefined,requestHash:operatingFeeRequestHash(context.queryId,fee)});
  f.db.prepare('INSERT INTO hosted_treasury_policies VALUES(?,?,?)').run('fee-policy',canonicalJson(treasury),kind==='private-role'?'private':'public');
  f.db.prepare('INSERT INTO hosted_treasury_authorizations VALUES(?,?,?,?,?,?)').run(nonce,owner,JSON.stringify({context,payload:{message:{to:payee,value:'7'}}}),'fee-policy',kind==='unsubmitted'?0:1,kind==='header'?null:'0x'+'ff'.repeat(32));
  if(kind!=='retained-policy')f.db.prepare('INSERT INTO sync_state VALUES(?,?,?)').run(OPERATING_FEE_POLICY_KEY_PREFIX+fee.policyDigest,canonicalJson(policy),'now');
  if(kind==='request')f.input.requestHash='bb'.repeat(32);if(kind==='payee')f.input.payee=registry;if(kind==='amount')f.input.amountMicros=8;if(kind==='source')f.input.sourceId='different';
  compare(f,kind==='valid');
 });
 it('keeps the immutable registry sidecar authoritative over the changed global selection',()=>{
  const f=fixture(),authority={network,address:registry,version:3 as const,codeHash:'0x'+'dd'.repeat(32),deployBlock:'123'},text=canonicalJson([authority]),oldNetwork=config.networkId;
  try{Object.assign(config,{networkId:network,registryReadAddress:payee,registryOrigins:text});vi.stubEnv('KERYX_REGISTRY_ORIGINS',text);vi.stubEnv('NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS',text);
   f.db.prepare('INSERT INTO sync_state VALUES(?,?,?)').run('keryx:source-registry-origin:v1:'+onchain,canonicalJson({format:'keryx-source-registry-origin-v1',onchainId:onchain,authority}),'now');
   const settings={deploymentOrigin:origin,fallbackAddress:payee,authorities:[authority]};expect(()=>captureSourceClaimPurchasePolicy(envelope(f.db,f.input),f.input,settings)).not.toThrow();expect(source(f.db,f.input)).toBe(true);
   f.db.prepare('DELETE FROM sync_state WHERE key=?').run(prefix+'purchase-policy:'+sha(canonicalJson(f.input.identity)));f.db.prepare('DELETE FROM sync_state WHERE key=?').run('keryx:source-registry-origin:v1:'+onchain);
   expect(()=>captureSourceClaimPurchasePolicy(envelope(f.db,f.input),f.input,settings)).toThrow();expect(source(f.db,f.input)).toBe(false);
  }finally{Object.assign(config,{networkId:oldNetwork});}
 });
 it('rejects altered projection bytes, wrong selector and duplicate retained rows',()=>{const f=fixture(),raw=envelope(f.db,f.input),selector=sourceClaimPolicySelector({sourceId:f.sourceId,identity:f.input.identity});expect(()=>decodeSourceClaimPolicySnapshot({...raw,sha256:'aa'.repeat(32)},selector)).toThrow();expect(()=>decodeSourceClaimPolicySnapshot(raw,sourceClaimPolicySelector({sourceId:'other',identity:f.input.identity}))).toThrow();const parsed=JSON.parse(raw.wire);parsed.rows.push(parsed.rows[0]);const wire=JSON.stringify(parsed);expect(()=>decodeSourceClaimPolicySnapshot({wire,sha256:sha(wire)},selector)).toThrow();});
 it('captures hosted current policy without minting a purchase or settlement receipt',()=>{const f=fixture(),capture=captureHostedSourceClaimPolicy(envelope(f.db,f.input,true),{sourceId:f.sourceId,expected:f.input.receipt,kind:'fetch',network},runtime);expect(capture).toMatchObject({existing:false,policySnapshot:{sourceId:f.sourceId,receipt:f.input.receipt}});expect(f.db.prepare('SELECT count(*) n FROM research_purchase_authorizations').get()!.n).toBe(0);});
});
