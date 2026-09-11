import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,chmodSync,readFileSync,writeFileSync,cpSync,renameSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { creatorMintFixture } from './test-fixtures/creator-withdrawal';
import { provisionFreshWithdrawalJournal } from '../lib/gateway/withdrawal-provision';
import { createWithdrawalMintJournal } from '../lib/gateway/withdrawal-mint-journal';
assert.equal(process.platform,'linux');
// Synthetic unfunded keys only. Production CLI entrypoints do not load environment
// files; keep original signatures in the private fixture and out of stdout.
globalThis.fetch = async () => { throw new Error('Network forbidden in restore fixture'); };
async function run(script:string,args:string[]) {
 return new Promise<{code:number|null,stdout:string,stderr:string}>((resolve,reject)=>{
  const child=spawn(process.execPath,['--import','tsx','--no-warnings',script,...args],{stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
  child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));
 });
}
const parent=mkdtempSync('/tmp/keryx-backup-cli-restore-');chmodSync(parent,0o700);
const started=Date.now();
try {
 const f=await creatorMintFixture(),pending=await creatorMintFixture(),signal=new AbortController().signal;
 const source=join(parent,'relay'),snapshot=join(parent,'snapshot'),restored=join(parent,'restored');
 const {policy}=await provisionFreshWithdrawalJournal(source,{format:'creator-mint-journal-v1',chainId:5042002,
 relayer:f.terms.relayer,initialNonce:0,lifetimeGasBudgetWei:'1200000000000000',maxSlots:2},signal);
 const db=new DatabaseSync(join(source,'mint.sqlite'));
 try {
  db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;');
  const journal=createWithdrawalMintJournal(db,policy);
  await journal.admitGas(f.record,'600000000000000',signal);await journal.reserve(f.record,f.response,f.terms);
  await journal.savePrepared(f.record.id,f.raw);await journal.admitGas(pending.record,'600000000000000',signal);
  const result=await run('scripts/withdrawal-backup.mts',['--source',source,'--destination',snapshot]);
  assert.equal(result.code,0,result.stderr);const output=JSON.parse(result.stdout);
  assert.equal(output.state,'verified-backup');assert.match(output.manifestSha256,/^[a-f0-9]{64}$/);
  writeFileSync(join(parent,'trusted-manifest.sha256'),output.manifestSha256,{mode:0o600});
 } finally { db.close(); }
 renameSync(source,join(parent,'original-quarantined'));
 cpSync(snapshot,restored,{recursive:true,errorOnExist:true,force:false});chmodSync(restored,0o700);
 const digest=readFileSync(join(parent,'trusted-manifest.sha256'),'utf8');
 const inspectArgs=['--directory',restored,'--manifest-sha256',digest];
 const inspected=await run('scripts/withdrawal-backup-inspect.mts',inspectArgs);
 assert.equal(inspected.code,0,inspected.stderr);assert.equal(JSON.parse(inspected.stdout).signingResumeAuthorized,false);
 const copy=new DatabaseSync(join(restored,'mint.sqlite'),{readOnly:true});
 try {
  const journal=createWithdrawalMintJournal(copy,policy);
  assert.equal((await journal.getPrepared(f.record.id))?.serializedTransaction,f.raw);
  assert.ok(await journal.getGasAdmission(pending.record.id));
  assert.equal(journal.gasAdmissionSummary().committedRequests,2);
 } finally {copy.close();}
 const manifestPath=join(restored,'manifest.json');const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
 writeFileSync(manifestPath,JSON.stringify({...manifest,capturedAt:'2025-01-01T00:00:00.000Z'}));
 const invalid=await run('scripts/withdrawal-backup-inspect.mts',inspectArgs);assert.equal(invalid.code,1);
 assert.equal(invalid.stdout,'');assert.ok(!invalid.stderr.includes(f.raw));
 console.log(JSON.stringify({state:'passed',elapsedMs:Date.now()-started,checks:['separate-process WAL backup','separately retained digest','original path quarantined','new-directory copy inspected by CLI','exact signed raw and pending admission retained','tampered manifest denied'],livePayment:false,signingResumed:false}));
} finally {assert.ok(parent.startsWith('/tmp/keryx-backup-cli-restore-'));rmSync(parent,{recursive:true,force:true});}
