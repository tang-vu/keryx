import { beforeAll,afterAll,expect,it,vi } from 'vitest';
import type { QueryRun } from '../../types';
import { ARC_MAINNET_PROFILE } from '../../arc-network-profile';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
let p:typeof import('./private-research-packet');
beforeAll(async()=>{vi.stubEnv('KERYX_NETWORK','arc');vi.stubEnv('NEXT_PUBLIC_KERYX_NETWORK','arc');vi.resetModules();p=await import('./private-research-packet');});
afterAll(()=>vi.unstubAllEnvs());
it('captures private result JSON exactly before an asynchronous owner lookup',()=>{
 const run={id:'prv_'+'11'.repeat(32),question:'Synthetic private\0\ud800',budget:.03,researchMode:'quick',answer:'Private answer\0\udfff',nested:{value:'retained'}} as unknown as QueryRun;
 const captured=p.capturePrivateResearchValue('save-result',run) as string;run.question='changed';(run as unknown as {nested:{value:string}}).nested.value='changed';
 expect(JSON.parse(captured)).toMatchObject({question:'Synthetic private\0\ud800',answer:'Private answer\0\udfff',nested:{value:'retained'}});
});
it('captures normalized creator scalars without inventing fresh expiry or a payment proof',()=>{
 const raw={kind:'citation',sourceId:'Synthetic source\0\ud800',itemId:null,submission:{authorizationId:'0x'+'AB'.repeat(32),authorizationExpiresAt:'2020-01-01T07:00:00+07:00',payer:'0x'+'AB'.repeat(20),payee:'0x'+'CD'.repeat(20),amountMicros:'1',network:'eip155:5042',asset:ARC_MAINNET_PROFILE.usdcAddress.toLowerCase()}};
 const captured=p.capturePrivateResearchValue('admit-creator',raw) as typeof raw;raw.sourceId='changed';expect(captured.sourceId).toBe('Synthetic source\0\ud800');expect(captured.submission.authorizationExpiresAt).toBe('2020-01-01T07:00:00+07:00');
 expect(captured.submission.authorizationId).toBe('0x'+'ab'.repeat(32));expect(Object.isFrozen(captured.submission)).toBe(true);expect(p.privateCreatorLegId(captured as never)).toMatch(/^[a-f0-9]{64}$/);
});
it('rejects invalid policy/lookup input and keeps immutable policy capacity exact',()=>{
 expect(()=>p.privateResearchLookup('public-job','0x'+'11'.repeat(20))).toThrow();expect(()=>p.privateResearchLookup('prv_'+'11'.repeat(32),'')).toThrow();
 for(const capacityMicros of ['0','01','1000000000000'])expect(()=>p.capturePrivateResearchValue('reserve-treasury',{signer:'0x'+'11'.repeat(20),capacityMicros})).toThrow();
 expect(p.capturePrivateResearchValue('reserve-treasury',{signer:'0x'+'AB'.repeat(20),capacityMicros:'999999999999'})).toEqual({signer:'0x'+'ab'.repeat(20),capacityMicros:'999999999999'});
});
it('rejects leaked foreign-owner rows and metadata presented as a signed intent',async()=>{
 const key=p.privateResearchLookup('prv_'+'11'.repeat(32),'0x'+'11'.repeat(20)),wire={intentRowWire:null,paymentRowWire:null,executionRowWire:null,resultRowWire:null,interruptionRowWire:null,reservationRowWire:null,releaseRowWire:null,submissionsWire:'[]',confirmationsWire:'[]'};
 await expect(p.readPrivateResearchSnapshot({...wire,resultRowWire:'{}'},key)).rejects.toThrow();
 await expect(p.readPrivateResearchSnapshot({...wire,intentRowWire:JSON.stringify({id:key.id,payer:key.payer,data:'{"accepted":true}'})},key)).rejects.toThrow(/Invalid stored private research intent/);
 expect((await p.readPrivateResearchSnapshot(wire,key)).intent).toBeNull();
});
it('matches actual SQLite accounting types, first duplicate keys and exact compact fragments',async()=>{
 const {getSqlitePrivateTreasurySummary}=await import('../private-treasury-summary'),db=new DatabaseSync(':memory:'),signer='0x'+'44'.repeat(20);
 db.exec('CREATE TABLE private_treasury_pools(signer TEXT PRIMARY KEY,capacity_micros INTEGER);CREATE TABLE private_treasury_reservations(job_id TEXT PRIMARY KEY,signer TEXT,amount_micros INTEGER);CREATE TABLE private_treasury_releases(job_id TEXT PRIMARY KEY,amount_micros INTEGER);CREATE TABLE private_creator_submissions(job_id TEXT,authorization_id TEXT UNIQUE,amount_micros INTEGER,data TEXT);CREATE TABLE private_creator_confirmations(authorization_id TEXT PRIMARY KEY,data TEXT);');
 const frame=()=>({capacity:(db.prepare('SELECT CAST(capacity_micros AS TEXT) n FROM private_treasury_pools WHERE signer=?').get(signer)?.n??null) as string|null,
  reservations:db.prepare('SELECT CAST(r.amount_micros AS TEXT) amount,CAST(x.amount_micros AS TEXT) released FROM private_treasury_reservations r LEFT JOIN private_treasury_releases x ON x.job_id=r.job_id WHERE r.signer=?').all(signer),
  legs:db.prepare('SELECT CAST(s.amount_micros AS TEXT) amount,r.signer,s.data,c.authorization_id confirmation_id,c.data confirmation_data FROM private_treasury_reservations r JOIN private_creator_submissions s ON s.job_id=r.job_id LEFT JOIN private_creator_confirmations c ON c.authorization_id=s.authorization_id WHERE r.signer=?').all(signer)});
 try{
  expect(p.readPrivateTreasurySummary(frame())).toBe(await getSqlitePrivateTreasurySummary(db,signer));db.prepare('INSERT INTO private_treasury_pools VALUES(?,100000)').run(signer);db.prepare('INSERT INTO private_treasury_reservations VALUES(?,?,60000)').run('one',signer);db.prepare('INSERT INTO private_treasury_releases VALUES(?,10000)').run('one');
  const submission=JSON.stringify({amountMicros:'10000',payer:signer}),leg=`{"unrelated":"\\ud800\\u0000","submission":${submission},"submission":{"amountMicros":"999"}}`;
  db.prepare('INSERT INTO private_creator_submissions VALUES(?,?,10000,?)').run('one','nonce',leg);
  const check=async()=>{let expected;try{expected=await getSqlitePrivateTreasurySummary(db,signer);}catch{expect(()=>p.readPrivateTreasurySummary(frame())).toThrow();return;}expect(p.readPrivateTreasurySummary(frame())).toEqual(expected);};
  await check();for(const stage of ['received','batched','confirmed','completed']){db.prepare('INSERT OR REPLACE INTO private_creator_confirmations VALUES(?,?)').run('nonce',`{"submission":${submission},"source":"circle-transfer-search","transferStatus":"${stage}"}`);await check();expect(p.readPrivateTreasurySummary(frame())?.confirmedMicros).toBe(['confirmed','completed'].includes(stage)?'10000':'0');}
  for(const fragment of [submission,`{ "amountMicros" : "10000", "payer" : "${signer}" }`,JSON.stringify(submission),`{"payer":"${signer}","amountMicros":"10000"}`]){
   db.prepare('UPDATE private_creator_confirmations SET data=?').run(`{"submission":${fragment},"source":"circle-facilitator-success","source":"invalid"}`);await check();
  }
  for(const bad of [`{"submission":{"amountMicros":10000,"payer":"${signer}"}}`,'not-json','null']){db.prepare('UPDATE private_creator_submissions SET data=?').run(bad);await check();}
 }finally{db.close();}
});
it('keeps two bounded fixed SQL identities without raw original JSON getters or public helper grants',()=>{
 const sql=readFileSync(new URL('../../../ops/keryx-postgres/private-research.sql',import.meta.url),'utf8').replaceAll('\r\n','\n').replaceAll('{{USDC_ADDRESS}}',ARC_MAINNET_PROFILE.usdcAddress.toLowerCase());
 const raw=readFileSync(new URL('../../../ops/keryx-postgres/private-research-raw.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
 for(const part of [sql,raw]){expect(Buffer.byteLength(part)).toBeLessThanOrEqual(32768);expect(Buffer.byteLength(JSON.stringify(part))).toBeLessThanOrEqual(32768);expect([...part.matchAll(/CREATE FUNCTION /g)]).toHaveLength(1);}
 expect(sql).toContain("'history','summary','workers','reconciliation'");expect(sql).not.toMatch(/\b(?:i|s|c|private_creator_confirmations)\.data::json/);expect(sql).not.toContain('intent_data json;');
 expect(raw).toContain("WHEN 'intent' THEN ARRAY['id','submission','requirement','merchants']");expect(raw).toContain("IF field IS NULL AND kind NOT IN('run','first-submission','first-request') THEN RAISE");expect(raw).not.toMatch(/\bEXECUTE\b|\bpublic\.|GRANT EXECUTE/);expect(raw).toContain("source_scalar_text(token,'js-string')");expect(raw).toContain("source_scalar_text(budget_token,'json1-value')");
 expect(sql).toContain('private_research_result_identity');expect(sql).not.toContain('PERFORM keryx_storage.enter_operation');
});
it('keeps genuine SQLite first numeric budgets separate from JS-last validated values and compact CAS bytes',()=>{
 const db=new DatabaseSync(':memory:');try{
  for(const [wire,expected] of [['{"submission":{"request":{"budget":2e-2,"budget":0.03}}}',20000],['{"submission":{"request":{"budget":0.03}},"submission":{"request":{"budget":0.04}}}',30000],['{"submission":{"request":{"budget":"0.02 trailing","budget":0.03}}}',20000],['{"submission":null,"submission":{"request":{"budget":0.03}}}',null],['{"submission":{"request":{"budget\\u0000suffix":0.02}},"submission":{"request":{"budget":0.03}}}',20000]] as const){
   expect(db.prepare("SELECT CAST(round(json_extract(?,'$.submission.request.budget')*1000000) AS INTEGER) n").get(wire)!.n).toBe(expected);expect(Math.round(JSON.parse(wire).submission.request.budget*1e6)).not.toBe(expected);
  }
  const first='{"amountMicros":"10000","payer":"one"}',other='{ "payer":"one", "amountMicros":"10000" }',a=String(db.prepare("SELECT json_extract(?,'$.submission') v").get('{"submission":'+first+'}')!.v),b=String(db.prepare("SELECT json_extract(?,'$.submission') v").get('{"submission":'+other+'}')!.v);
  expect(a).toBe(first);expect(b).toBe('{"payer":"one","amountMicros":"10000"}');expect(a).not.toBe(b);expect(JSON.parse(a)).toEqual(JSON.parse(b));
 }finally{db.close();}
});
