import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {hostname} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {SERVER1_CUTOVER,Server1CutoverUnavailable,inspectServer1NativeCutover,runServer1NativeCutover,parseServer1CutoverMode,parseServer1CutoverIntent,parseServer1CutoverReceiptTemplate,parseServer1SourceRoles,replaceServer1HashToken,validateServer1WorkerStop} from './server1-native-cutover.mts';
import {snapshotRows,snapshotTables,type SnapshotRow} from './typed-snapshot.mts';

const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64),commit='1'.repeat(40),at='2026-11-15T18:00:00.000Z';
const intent=()=>({format:'keryx-server1-native-cutover-intent-v1',sourceCommit:SERVER1_CUTOVER.sourceCommit,targetCommit:commit,createdAt:at,windowId:'postgres-native-cutover-20261116-0123456789abcdef',baselineSha256:a,rolesSha256:a,reviewSha256:a,oldEnvironmentSha256:a,oldManifestSha256:a,runtimeEnvironmentSha256:a,runtimeManifestSha256:a,receiptTemplateSha256:a,nativeBootSha256:a,snapshotChildSha256:a,cutoverBundleSha256:a});
const template=()=>({format:'keryx-server1-native-cutover-template-v1',sourceCommit:SERVER1_CUTOVER.sourceCommit,targetCommit:commit,sourceManifestSha256:a,runtimeManifestSha256:a,identityDigest:a,sourceSqlSha256:SERVER1_CUTOVER.sourceSqlSha256,catalogSha256:SERVER1_CUTOVER.catalogSha256,publicPolicySha256:SERVER1_CUTOVER.publicPolicySha256,newFunding:false,financialPolicyChanged:false,createdAt:at});
const text=(value:string)=>['text',Buffer.from(value).toString('hex')] as const;
const pid=12345,workerId=hostname()+':'+pid+':01234567-89ab-4cde-8fab-0123456789ab',from=Date.parse(at)+1000,until=from+1000;
const original=()=>({workerId,status:'idle',orderId:null,updatedAt:at});
const stopped=()=>({workerId,status:'stopped',updatedAt:new Date(from+100).toISOString()});
function row(value:unknown,column:string):SnapshotRow{return [text('a2aWorker'),text(JSON.stringify(value)),text(column)];}
const before=()=>row(original(),at),after=()=>row(stopped(),new Date(from+101).toISOString());
const source=readFileSync(new URL('./server1-native-cutover.mts',import.meta.url),'utf8');

describe('fixed server1 cutover input boundary (data only)',()=>{
 it('defaults to readonly preflight and admits only finite fixed selectors',()=>{
  expect(parseServer1CutoverMode([])).toBe('preflight');expect(parseServer1CutoverMode(['--preflight'])).toBe('preflight');expect(parseServer1CutoverMode(['--apply'])).toBe('apply');expect(parseServer1CutoverMode(['--verify-native-only'])).toBe('verify-native-only');expect(parseServer1CutoverMode(['--verify-artifact-only'])).toBe('verify-artifact-only');
  for(const args of [['--apply','1'],['--target','remote'],['--allow-production'],['--force'],['--retry'],['--verify-native-only','identity']])expect(()=>parseServer1CutoverMode(args)).toThrow();
 });
 it('closes both zero-argument entrypoints before caller fields or I/O',async()=>{
  const argument=Object.defineProperty({},'proof',{get(){throw Error('caller getter must not run');}});
  await expect(Reflect.apply(runServer1NativeCutover,undefined,[argument])).rejects.toThrow('arguments');await expect(Reflect.apply(inspectServer1NativeCutover,undefined,[argument])).rejects.toThrow('arguments');
 });
 it('refuses an ordinary test process without a successful/mutated report',async()=>{
  try{await inspectServer1NativeCutover();throw Error('unexpected host admission');}catch(error){expect(error).toBeInstanceOf(Server1CutoverUnavailable);expect((error as Server1CutoverUnavailable).diagnostic).toMatchObject({stage:'preflight',activationOutcome:'not_attempted',sourceSwitchOutcome:'not_attempted',runtimeHbaOutcome:'not_attempted',roleStartOutcome:'not_attempted',maintenanceHeld:false,cleanupFailures:[]});}
 });
 it('captures a finite intent without accepting outcomes, selectors or old receipt hashes',()=>{
  const input=intent(),captured=parseServer1CutoverIntent(input);input.targetCommit='2'.repeat(40);expect(captured.targetCommit).toBe(commit);expect(Object.isFrozen(captured)).toBe(true);
  for(const change of [{targetCommit:SERVER1_CUTOVER.sourceCommit},{sourceCommit:commit},{createdAt:'2026-11-15T18:00:00Z'},{windowId:'other-window'},{baselineSha256:'A'.repeat(64)},{expectedReceiptSha256:a},{activationOutcome:'acknowledged'},{target:'postgres://remote'}])expect(()=>parseServer1CutoverIntent({...intent(),...change})).toThrow();
 });
 it('refuses accessors, symbols and non-data prototypes in controls',()=>{
  let reads=0;const input={...intent()};Object.defineProperty(input,'createdAt',{enumerable:true,get(){reads++;return at;}});expect(()=>parseServer1CutoverIntent(input)).toThrow();expect(reads).toBe(0);expect(()=>parseServer1CutoverIntent(Object.assign(Object.create({}),intent()))).toThrow();expect(()=>parseServer1CutoverIntent({...intent(),[Symbol('authority')]:true})).toThrow();
 });
 it('accepts only a static receipt template, never future witnesses/digests',()=>{
  const i=parseServer1CutoverIntent(intent());expect(Object.isFrozen(parseServer1CutoverReceiptTemplate(template(),i))).toBe(true);
  for(const change of [{phase:'complete'},{targetMode:'active'},{finalSnapshotSha256:a},{sourceWritersNaturallyEnded:true},{newFunding:true},{financialPolicyChanged:true},{createdAt:new Date(from).toISOString()},{sourceSqlSha256:a},{catalogSha256:a},{publicPolicySha256:a}])expect(()=>parseServer1CutoverReceiptTemplate({...template(),...change},i)).toThrow();
 });
});

describe('actual Source SQL heartbeat to stop transition',()=>{
 it('uses the real Source INSERT OR REPLACE SQL, preserving its separate timestamp cell',()=>{
  const adapter=readFileSync(new URL('../../lib/db/sqlite-adapter.ts',import.meta.url),'utf8'),method=adapter.slice(adapter.indexOf('async setSyncState(')),sql=method.match(/`(INSERT OR REPLACE INTO sync_state \(key,value,updated_at\) VALUES \(\?,\?,\?\))`/)?.[1];expect(sql).toBeDefined();
  const worker=readFileSync(new URL('../a2a-research-worker.mts',import.meta.url),'utf8');expect(worker).toContain('`${os.hostname()}:${process.pid}:${crypto.randomUUID()}`');expect(worker).toContain('JSON.stringify({ workerId, status: "stopped", updatedAt: new Date().toISOString() })');
  const db=new DatabaseSync(':memory:');try{
   db.exec('CREATE TABLE sync_state(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)');db.prepare(sql!).run('a2aWorker',JSON.stringify(original()),at);db.exec('BEGIN');const table=snapshotTables(db)[0],old=[...snapshotRows(db,table,['key'])][0];db.exec('COMMIT');
   const finalColumn=new Date(from+101).toISOString();db.prepare(sql!).run('a2aWorker',JSON.stringify(stopped()),finalColumn);db.exec('BEGIN');const next=[...snapshotRows(db,table,['key'])][0];expect(next[2]).toEqual(text(finalColumn));expect(validateServer1WorkerStop(old,next,pid,from,until)).toEqual({before:JSON.stringify(original()),after:JSON.stringify(stopped())});expect(db.prepare('SELECT count(*) n FROM sync_state').get()!.n).toBe(1);db.exec('ROLLBACK');
  }finally{db.close();}
 });
 it.each(['claimed','running','recovery_pending','payment_started','stopped'])('refuses nonquiescent B0 status %s',status=>{expect(()=>validateServer1WorkerStop(row({...original(),status},at),after(),pid,from,until)).toThrow();});
 it('refuses a non-null original, changed worker epoch/PID or extra JSON field',()=>{
  for(const value of [{...original(),orderId:'retained-financial-original'},{...original(),extra:true},{...original(),workerId:workerId.replace(':12345:',':12346:')}])expect(()=>validateServer1WorkerStop(row(value,at),after(),pid,from,until)).toThrow();
  for(const value of [{...stopped(),orderId:null},{...stopped(),extra:true},{...stopped(),workerId:workerId.replace('0123456789ab','1123456789ab')},{...stopped(),status:'idle'}])expect(()=>validateServer1WorkerStop(before(),row(value,new Date(from+101).toISOString()),pid,from,until)).toThrow();
 });
 it('bounds BOTH independent final timestamps to actual signal/exit and their Source call order',()=>{
  for(const time of [from-1,until+1])expect(()=>validateServer1WorkerStop(before(),row({...stopped(),updatedAt:new Date(time).toISOString()},new Date(time).toISOString()),pid,from,until)).toThrow();
  expect(()=>validateServer1WorkerStop(before(),row(stopped(),new Date(from+99).toISOString()),pid,from,until)).toThrow();expect(()=>validateServer1WorkerStop(before(),row(stopped(),new Date(until+1).toISOString()),pid,from,until)).toThrow();expect(()=>validateServer1WorkerStop(row(original(),new Date(from+1).toISOString()),after(),pid,from,until)).toThrow();
 });
 it('refuses wrong key, missing columns, changed storage class, raw NUL/BOM and invalid UTF8',()=>{
  const variants:SnapshotRow[]=[[text('otherWorker'),...after().slice(1)],after().slice(0,2),[after()[0],['blob',(after()[1] as readonly ['text',string])[1]],after()[2]],[after()[0],text('\ufeff'+JSON.stringify(stopped())),after()[2]],[after()[0],text(JSON.stringify(stopped())+'\0'),after()[2]],[after()[0],['text','ff'],after()[2]]];for(const value of variants)expect(()=>validateServer1WorkerStop(before(),value,pid,from,until)).toThrow();
 });
 it('refuses JSON duplicate keys/reordering/whitespace outside the actual producer wire',()=>{
  const duplicate=JSON.stringify(original()).replace('"status":"idle"','"status":"running","status":"idle"');expect(()=>validateServer1WorkerStop([before()[0],text(duplicate),before()[2]],after(),pid,from,until)).toThrow();expect(()=>validateServer1WorkerStop(before(),[after()[0],text(JSON.stringify(stopped(),null,2)),after()[2]],pid,from,until)).toThrow();
 });
});

describe('finite byte-preserving late binding',()=>{
 it('changes only the approved hash token, preserving raw surrounding bytes and unrelated identical hashes',()=>{
  const wire='{\n "other":"'+a+'", "nativeStorage" : { "cutoverReceiptSha256" : "'+a+'" }, "retained":"\\u0000\\ud800"\n}\n',bound=replaceServer1HashToken(wire,'cutoverReceiptSha256',a,b);expect(bound).toBe(wire.replace('"cutoverReceiptSha256" : "'+a+'"','"cutoverReceiptSha256" : "'+b+'"'));expect(JSON.parse(bound).other).toBe(a);expect(JSON.parse(bound).retained).toBe('\0\ud800');
 });
 it('binds the review digest in roles without rewriting app definitions',()=>{
  const wire='{"apps":[{"name":"keryx"}],"release":{"compatibilityReviewSha256":"'+a+'"}}\n',bound=replaceServer1HashToken(wire,'compatibilityReviewSha256',a,c);expect(bound.replace(c,a)).toBe(wire);expect(JSON.parse(bound).apps).toEqual(JSON.parse(wire).apps);
 });
 it('refuses duplicate/missing/stale/encoded hash keys and arbitrary mutation keys',()=>{
  const field='"cutoverReceiptSha256":"'+a+'"';for(const wire of ['{}','{'+field+','+field+'}','{"cutoverReceiptSha256":"'+b+'"}','{"cutoverReceiptSha\\u0032\\u0035\\u0036":"'+a+'"}','{bad}'])expect(()=>replaceServer1HashToken(wire,'cutoverReceiptSha256',a,b)).toThrow();expect(()=>Reflect.apply(replaceServer1HashToken,undefined,['{"x":"'+a+'"}','x',a,b])).toThrow();
 });
});

describe('Source PM2 frame and irreversible ordering',()=>{
 const role=(name:string,id:number)=>({name,pm_id:id,pid:100+id,pm2_env:{status:'online',autorestart:true,kill_timeout:330000,restart_time:id,pm_exec_path:'/usr/bin/env',pm_cwd:'/root/keryx',exec_interpreter:'none',args:['-i','/usr/bin/node','--env-file=/root/keryx/.env.local']}});
 it('requires exactly the two real autorestarting roles before suppression or signals',()=>{
  const rows=[role('keryx',0),role('keryx-a2a-worker',1)];expect(parseServer1SourceRoles(rows).map(r=>r.name)).toEqual(['keryx','keryx-a2a-worker']);for(const value of [[...rows,role('unknown',2)],[rows[0]],rows.map(r=>({...r,pid:100})),rows.map(r=>({...r,pm2_env:{...r.pm2_env,autorestart:false}})),rows.map(r=>({...r,pm2_env:{...r.pm2_env,kill_timeout:100}})),rows.map(r=>({...r,pm2_env:{...r.pm2_env,status:'stopped'}}))])expect(()=>parseServer1SourceRoles(value)).toThrow();
 });
 it('captures role fields and freezes argument references before an await can retarget them',()=>{
  const rows=[role('keryx',0),role('keryx-a2a-worker',1)],captured=parseServer1SourceRoles(rows);rows[0].pid=999;rows[0].pm2_env.args[1]='changed';expect(captured[0].pid).toBe(100);expect((captured[0].args as readonly string[])[1]).toBe('/usr/bin/node');expect(Object.isFrozen(captured)).toBe(true);expect(Object.isFrozen(captured[0])).toBe(true);expect(Object.isFrozen(captured[0].args)).toBe(true);
 });
 it('runs the trusted installed inspector before importing any candidate review code',()=>{
  const child=source.slice(source.indexOf("async function child("),source.indexOf('export class Server1CutoverUnavailable'));expect(child.indexOf("pathToFileURL('/root/keryx/scripts/immutable-release-staging.mjs')")).toBeLessThan(child.indexOf('immutable.verifyImmutableArtifact('));expect(child.indexOf('immutable.verifyImmutableArtifact(')).toBeLessThan(child.indexOf('await releaseModule(commit)'));expect(source).toContain("mode==='verify-native-only'?['--env-file='");expect(source).toContain("immutableInspectorSha256:'f563d99e557aa4d957778dd4667f07c8998ea3c133984c1ad0a8e718df688bc8'");
 });
 it('spells every selected-cohort import as a finite literal edge for the funding graph',()=>{
  const paths=[...source.matchAll(/import\(pathToFileURL\(join\(releaseSource\(commit\),'([^']+)'\)\)\.href\)/g)].map(match=>match[1]);expect(paths.sort()).toEqual(['scripts/redeploy-reviewed-roles.mjs','lib/db/application-storage.ts','lib/config.ts','lib/payments/hosted-treasury-policy.ts','lib/research/research-allowance.ts','lib/db/runtime-storage-config.ts'].sort());expect(source.match(/import\(pathToFileURL\('\/root\/keryx\/scripts\/immutable-release-staging\.mjs'\)\.href\)/g)).toHaveLength(1);expect(source).not.toMatch(/\bimport\(\s*[a-zA-Z_$][\w$]*\s*\)/);
 });
 it('keeps the real lock/census/CAS/retirement/ACK/publication/start sequence explicit',()=>{
  const main=source.slice(source.indexOf('async function cutover(')),ordered=['targetPg.query(target.lock)','typed.compareStagedSnapshotTransaction','publicCells.compareNativeSnapshotTransaction','privateCells.compareNativeProjectionsTransaction',"stage='maintenance'",'drainSource(lease','copyFinal(c','typedInventory(finalDb','UPDATE public.sync_state SET','lateBind(c',"stage='source-retirement'","stage='activation'","activationOutcome='unknown'","targetPg.query('COMMIT')","activationOutcome='acknowledged'","stage='runtime-hba'",'await scram(c',"stage='native-verification'","stage='publication'",'exclusive(SERVER1_CUTOVER.receipt',"stage='role-start'"];let previous=-1;for(const marker of ordered){const next=main.indexOf(marker);expect(next,marker).toBeGreaterThan(previous);previous=next;}
  expect(main).toContain('normalizedDataDigest,b0.dataDigest');expect(main).toContain("UPDATE public.sync_state SET value=$1,updated_at=$2 WHERE key=$3 AND value IS NOT DISTINCT FROM $4 AND updated_at IS NOT DISTINCT FROM $5 RETURNING key,value,updated_at");expect(main.match(/UPDATE public\./g)).toHaveLength(1);expect(main).toContain("await targetPg.query('COMMIT');transactions.delete(targetPg);activationOutcome='acknowledged'");
 });
 it('contains no force-stop/retry/target reopening or receipt-derived authority shortcut',()=>{
  expect(source).not.toMatch(/process\.kill\([^\n]*['"]SIGKILL|\.Client\.start\(|\.connect\(.*PM2|--force|allowProduction|register.*Facade|mint.*Provenance|executeRemote/i);expect(source).toContain("lease.rpc.call('notifyKillPM2',{},()=>{})");expect(source).toContain("sock.set('retry timeout',0);sock.retry=0");expect(source).toContain("new Set<Client>()");expect(source).toContain("assert.equal(sha(canonicalJson({staging,publicCensus,projections})),c.baseline.nativeCensusSha256)"); // No acceptance claim is inferred from this static contract test.
 });
});
