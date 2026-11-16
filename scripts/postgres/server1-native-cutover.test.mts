import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {hostname} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {EventEmitter} from 'node:events';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import type {Client} from 'pg';
import ts from 'typescript';
import {createOwnerSessionHeartbeat} from './owner-session-heartbeat.mts';
import {SERVER1_CUTOVER,Server1CutoverUnavailable,inspectServer1NativeCutover,runServer1NativeCutover,parseServer1CutoverMode,parseServer1CutoverIntent,parseServer1CutoverReceiptTemplate,parseServer1SourceRoles,replaceServer1HashToken,validateServer1WorkerStop,validateServer1OperatorClock} from './server1-native-cutover.mts';
import {snapshotRows,snapshotTables,snapshotRowWire,type SnapshotRow} from './typed-snapshot.mts';
import {publishOperatorHeartbeat} from '../../lib/business-operator/status';
import {canonicalJson} from '../../lib/canonical-json';
import {nativeMaterializationValueKey,nativeMaterializationCell} from './native-materialization-codec.mts';

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
// Execute the private integration's actual Source bytes with the real helper.
// These are mechanical owned-client recordings, never host/native admission.
const sessionSource=source.slice(source.indexOf('function cutoverOwnerSessions('),source.indexOf('export class Server1CutoverUnavailable'));
const sessionWire=ts.transpileModule(sessionSource,{compilerOptions:{target:ts.ScriptTarget.ES2017,module:ts.ModuleKind.None}}).outputText;
type CutoverSessions={readonly failure:unknown;start():void;pauseAndDrain(client:Client):Promise<void>;resume(client:Client):void;beginLocked(client:Client,lock:string):Promise<void>;dispose():Promise<void>};
const composeSessions=new Function('createOwnerSessionHeartbeat',sessionWire+';return cutoverOwnerSessions;')(createOwnerSessionHeartbeat) as (clients:readonly Client[],transactions:Set<Client>,cleanup:string[])=>CutoverSessions;
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
class RecordingOwner extends EventEmitter{
 readonly sql:string[]=[];readonly gates=new Map<string,ReturnType<typeof deferred>>();readonly errors=new Map<string,Error>();ended=0;endGate:ReturnType<typeof deferred>|undefined;endError:Error|undefined;activePings=0;maxActivePings=0;
 constructor(){super();this.on('error',()=>{});}
 gate(sql:string){const gate=deferred();this.gates.set(sql,gate);return gate;}
 release(){for(const gate of this.gates.values())gate.resolve();this.endGate?.resolve();}
 async query(sql:string){this.sql.push(sql);if(sql==='SELECT 1'){this.activePings++;this.maxActivePings=Math.max(this.maxActivePings,this.activePings);}try{await this.gates.get(sql)?.promise;const error=this.errors.get(sql);if(error)throw error;return {rowCount:0,rows:[]};}finally{if(sql==='SELECT 1')this.activePings--;}}
 async end(){this.ended++;await this.endGate?.promise;if(this.endError)throw this.endError;}
 client(){return this as unknown as Client;}
}
function recordingSessions(){const first=new RecordingOwner(),second=new RecordingOwner(),transactions=new Set<Client>(),cleanup:string[]=[];const sessions=composeSessions([first.client(),second.client()],transactions,cleanup);sessions.start();return {first,second,transactions,cleanup,sessions};}
const operatorDecision=()=>({action:'hold' as const,reason:'acceptance-paused' as const,liquidity:'not-needed' as const,observedAt:at});
const operatorValue=(observedAt=at,decisionObservedAt=at)=>({version:1,network:'eip155:5042',observedAt,decision:{...operatorDecision(),observedAt:decisionObservedAt},auditRecorded:true,state:'held'});
function operatorRow(value:unknown,column=at):SnapshotRow{return [text('businessOperator'),text(JSON.stringify(value)),text(column)];}
// Exercise the exact private inventory implementation on real SQLite cells.
// This is data-only coverage, never a host/target/factory qualification.
const inventorySource=source.slice(source.indexOf('type TypedTable='),source.indexOf("const cutoverUnit="));
const scalarSource=source.slice(source.indexOf('function scalarText('),source.indexOf('function sourceIdleWorker('));
const shaSource=source.slice(source.indexOf('const sha='),source.indexOf('function releaseSource('));
const inventoryWire=ts.transpileModule(shaSource+scalarSource+inventorySource,{compilerOptions:{target:ts.ScriptTarget.ES2017,module:ts.ModuleKind.None}}).outputText;
type DataInventory={schemaSha256:string;dataDigest:string;normalizedDataDigest:string;syncSemanticDigest:string;worker:SnapshotRow;operatorClock:SnapshotRow;tables:unknown[];rows:number};
const inspectInventory=new Function('assert','createHash','snapshotTables','snapshotRows','snapshotRowWire','canonicalJson','nativeMaterializationValueKey','nativeMaterializationCell','validateServer1WorkerStop','validateServer1OperatorClock',inventoryWire+';return typedInventory;')(assert,createHash,snapshotTables,snapshotRows,snapshotRowWire,canonicalJson,nativeMaterializationValueKey,nativeMaterializationCell,validateServer1WorkerStop,validateServer1OperatorClock) as (db:DatabaseSync,frame:()=>void,stop?:{baseline:DataInventory;pid:number;from:number;until:number})=>Promise<DataInventory>;

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

describe('narrow Source businessOperator clock',()=>{
 it('accepts a fresh genuine Source decision observation and independent publisher/SQLite clocks',async()=>{
  const adapter=readFileSync(new URL('../../lib/db/sqlite-adapter.ts',import.meta.url),'utf8'),sql=adapter.slice(adapter.indexOf('async setSyncState(')).match(/`(INSERT OR REPLACE INTO sync_state \(key,value,updated_at\) VALUES \(\?,\?,\?\))`/)?.[1];expect(sql).toBeDefined();const db=new DatabaseSync(':memory:');vi.useFakeTimers();
  try{db.exec('CREATE TABLE sync_state(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)');const port={async setSyncState(key:string,value:string){db.prepare(sql!).run(key,value,new Date().toISOString());}};const take=()=>{db.exec('BEGIN');try{return [...snapshotRows(db,snapshotTables(db)[0],['key'])][0];}finally{db.exec('ROLLBACK');}};
   vi.setSystemTime(new Date(from-500));await publishOperatorHeartbeat(port,'eip155:5042',operatorDecision(),'decision');const old=take();const refreshed={...operatorDecision(),observedAt:new Date(from+50).toISOString()};vi.setSystemTime(new Date(from+100));await publishOperatorHeartbeat(port,'eip155:5042',refreshed,'decision');const next=take();
   expect(validateServer1OperatorClock(old,next,from,until)).toEqual({before:Buffer.from((old[1] as readonly ['text',string])[1],'hex').toString(),after:Buffer.from((next[1] as readonly ['text',string])[1],'hex').toString()});expect(JSON.parse(Buffer.from((next[1] as readonly ['text',string])[1],'hex').toString()).decision).toEqual(refreshed);
  }finally{vi.useRealTimers();db.close();}
 });
 it('allows the last heartbeat before SIGINT, equal clocks, and independent later timestamp column',()=>{
  const old=operatorRow(operatorValue()),observed=new Date(from-10).toISOString(),next=operatorRow(operatorValue(observed),new Date(from-9).toISOString());expect(()=>validateServer1OperatorClock(old,next,from,until)).not.toThrow();expect(()=>validateServer1OperatorClock(old,old,from,until)).not.toThrow();
  const nested=new Date(from-20).toISOString();expect(()=>validateServer1OperatorClock(old,operatorRow(operatorValue(observed,nested),new Date(from-9).toISOString()),from,until)).not.toThrow();
 });
 it.each([{version:2},{network:'eip155:5042002'},{auditRecorded:false},{state:'working'},{state:'unknown'},{extra:true}])('refuses malformed/working/private-envelope mutations %j',change=>{
  const bad=operatorRow({...operatorValue(),...change});expect(()=>validateServer1OperatorClock(bad,bad,from,until)).toThrow();
 });
 it('refuses admitted/review decisions, unknown fields/enums and changed decision authority or state',()=>{
  for(const change of [{action:'run-next'},{action:'review'},{reason:'unknown'},{liquidity:'infinite'},{extra:true}]){const bad=operatorRow({...operatorValue(),decision:{...operatorDecision(),...change}});expect(()=>validateServer1OperatorClock(bad,bad,from,until)).toThrow();}
  for(const change of [{reason:'policy-cap'},{liquidity:'covered'},{action:'idle'}]){const next=operatorRow({...operatorValue(new Date(from+100).toISOString()),decision:{...operatorDecision(),...change}},new Date(from+101).toISOString());expect(()=>validateServer1OperatorClock(operatorRow(operatorValue()),next,from,until)).toThrow();}
  expect(()=>validateServer1OperatorClock(operatorRow(operatorValue()),operatorRow({...operatorValue(new Date(from+100).toISOString()),state:'idle'},new Date(from+101).toISOString()),from,until)).toThrow();
 });
 it('bounds B0 and both final clocks; refuses backwards clocks, offsets and changed key/null/blob cells',()=>{
  const old=operatorRow(operatorValue()),later=new Date(from+100).toISOString();for(const next of [operatorRow(operatorValue(new Date(Date.parse(at)-1).toISOString()),at),operatorRow(operatorValue(later),new Date(from+99).toISOString()),operatorRow(operatorValue(later),new Date(until+1).toISOString()),operatorRow(operatorValue(later),later.replace('Z','+00:00'))])expect(()=>validateServer1OperatorClock(old,next,from,until)).toThrow();
  expect(()=>validateServer1OperatorClock(operatorRow(operatorValue(),new Date(from+1).toISOString()),operatorRow(operatorValue(later),later),from,until)).toThrow();
  for(const next of [[text('other'),old[1],old[2]],[old[0],['null'],old[2]],[old[0],['blob',(old[1] as readonly ['text',string])[1]],old[2]],[old[0],['text','ff'],old[2]],old.slice(0,2)] as SnapshotRow[])expect(()=>validateServer1OperatorClock(old,next,from,until)).toThrow();
 });
 it('independently bounds nested time, preserves its ordering and refuses noncanonical/future/backwards clocks',()=>{
  const old=operatorRow(operatorValue()),top=new Date(from+100).toISOString(),column=new Date(from+101).toISOString();
  for(const decisionTime of [new Date(Date.parse(at)-1).toISOString(),new Date(until+1).toISOString(),new Date(from+101).toISOString(),top.replace('Z','+00:00'),top.replace('.100Z','.1000Z'),'not-a-time'])expect(()=>validateServer1OperatorClock(old,operatorRow(operatorValue(top,decisionTime),column),from,until)).toThrow();
  const nested=new Date(from+50).toISOString(),later=operatorRow(operatorValue(top,nested),column);expect(()=>validateServer1OperatorClock(old,later,from,until)).not.toThrow();expect(()=>validateServer1OperatorClock(later,operatorRow(operatorValue(top,new Date(from+49).toISOString()),column),from+200,until)).toThrow();
 });
 it('normalizes only the approved inventory hash while actual B1 sync cells/digest remain available for CAS',async()=>{
  const db=new DatabaseSync(':memory:');try{
   db.exec('CREATE TABLE sync_state(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);CREATE TABLE retained_data(id TEXT PRIMARY KEY,value TEXT)');for(let i=0;i<92;i++)db.exec('CREATE TABLE empty_'+i+'(id TEXT PRIMARY KEY)');db.prepare('INSERT INTO retained_data VALUES (?,?)').run('raw','retained\0body');
   const set=db.prepare('INSERT OR REPLACE INTO sync_state VALUES(?,?,?)');set.run('a2aWorker',JSON.stringify(original()),at);set.run('businessOperator',JSON.stringify(operatorValue()),at);db.exec('PRAGMA query_only=ON;BEGIN');const b0=await inspectInventory(db,()=>{});db.exec('COMMIT;PRAGMA query_only=OFF');
   const nested=new Date(from+50).toISOString(),top=new Date(from+100).toISOString(),column=new Date(from+102).toISOString();set.run('a2aWorker',JSON.stringify(stopped()),new Date(from+101).toISOString());set.run('businessOperator',JSON.stringify(operatorValue(top,nested)),column);db.exec('PRAGMA query_only=ON;BEGIN');
   const b1=await inspectInventory(db,()=>{},{baseline:b0,pid,from,until}),raw=await inspectInventory(db,()=>{});expect(b1.tables).toHaveLength(94);expect(b1.normalizedDataDigest).toBe(b0.dataDigest);expect(b1.dataDigest).not.toBe(b0.dataDigest);expect(b1.dataDigest).toBe(raw.dataDigest);expect(b1.syncSemanticDigest).toBe(raw.syncSemanticDigest);expect(b1.syncSemanticDigest).not.toBe(b0.syncSemanticDigest);expect(b1.operatorClock).toEqual(operatorRow(operatorValue(top,nested),column));expect(b1.worker).toEqual(after());db.exec('COMMIT;PRAGMA query_only=OFF');
   db.prepare('UPDATE retained_data SET value=? WHERE id=?').run('changed protected bytes','raw');db.exec('PRAGMA query_only=ON;BEGIN');await expect(inspectInventory(db,()=>{},{baseline:b0,pid,from,until})).rejects.toThrow();db.exec('ROLLBACK');
  }finally{db.close();}
 });
 it('refuses duplicate fields, escaped/reordered producer wire, NUL/BOM and nested duplicate decisions',()=>{
  const old=operatorRow(operatorValue()),wire=JSON.stringify(operatorValue()),bad=[wire.replace('"version":1','"version":2,"version":1'),wire.replace('"action":"hold"','"action":"idle","action":"hold"'),wire.replace('"held"','"he\\u006cd"'),JSON.stringify(operatorValue(),null,2),'\ufeff'+wire,wire+'\0'];for(const value of bad)expect(()=>validateServer1OperatorClock(old,[old[0],text(value),old[2]],from,until)).toThrow();
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
  const main=source.slice(source.indexOf('async function cutover(')),ordered=['sessions.beginLocked(targetPg,target.lock)','typed.compareStagedSnapshotTransaction','publicCells.compareNativeSnapshotTransaction','privateCells.compareNativeProjectionsTransaction',"stage='maintenance'",'drainSource(lease','copyFinal(c','typedInventory(finalDb','UPDATE public.sync_state SET','lateBind(c',"stage='source-retirement'","stage='activation'","activationOutcome='unknown'","targetPg.query('COMMIT')","activationOutcome='acknowledged'","stage='runtime-hba'",'await scram(c',"stage='native-verification'","stage='publication'",'exclusive(SERVER1_CUTOVER.receipt',"stage='role-start'"];let previous=-1;for(const marker of ordered){const next=main.indexOf(marker);expect(next,marker).toBeGreaterThan(previous);previous=next;}
  expect(main).toContain('normalizedDataDigest,b0.dataDigest');for(const key of ['a2aWorker','businessOperator'])expect(main).toContain("UPDATE public.sync_state SET value=$1,updated_at=$2 WHERE key='"+key+"' AND value IS NOT DISTINCT FROM $3 AND updated_at IS NOT DISTINCT FROM $4 RETURNING key,value,updated_at");expect(main.match(/UPDATE public\./g)).toHaveLength(2);expect(main).toContain('sourceOperatorClock(b0.operatorClock)');expect(source).toContain('assert(worker&&operatorClock)');expect(main).toContain("sourceDelta:'a2aWorker-stop-and-businessOperator-clock-only'");expect(main).toContain("await targetPg.query('COMMIT');transactions.delete(targetPg);activationOutcome='acknowledged'");
 });
 it('checks predecessor boot readiness with its installed TypeScript loader before maintenance',()=>{
  const main=source.slice(source.indexOf('async function cutover(')),argv="['--env-file='+SERVER1_CUTOVER.activeEnvironment,'--import',releaseSource(SERVER1_CUTOVER.sourceCommit)+'/node_modules/tsx/dist/loader.mjs',SERVER1_CUTOVER.oldBootstrap,'--verify-only']";
  expect(main).toContain(argv);expect(main.indexOf(argv)).toBeLessThan(main.indexOf("stage='maintenance'"));
 });
 it('keeps the qualified snapshot argv able to inspect PID1 namespace while retaining outer Cap0',async()=>{
  const raw=source.slice(source.indexOf('async function copyFinal('),source.indexOf('function journal(')),wire=ts.transpileModule(raw,{compilerOptions:{target:ts.ScriptTarget.ES2017,module:ts.ModuleKind.None}}).outputText;
  const stop=Error('recording stops before any snapshot/I/O');let recorded:unknown[]|undefined;
  const copy=new Function('assert','sha','SERVER1_CUTOVER','existsSync','command',wire+';return copyFinal;')(assert,(s:string)=>createHash('sha256').update(s).digest('hex'),SERVER1_CUTOVER,()=>false,async(...args:unknown[])=>{recorded=args;throw stop;}) as (c:unknown,frame:()=>void)=>Promise<unknown>;
  await expect(copy({intent:{windowId:intent().windowId}},()=>{})).rejects.toBe(stop);expect(recorded?.[0]).toBe('/usr/bin/systemd-run');const argv=recorded?.[1] as string[];
  for(const flag of ['--property=MemoryMax=256M','--property=MemorySwapMax=0','--property=CPUQuota=50%','--property=TasksMax=32','--property=RuntimeMaxSec=30s','--property=PrivateNetwork=yes','--property=NoNewPrivileges=yes'])expect(argv).toContain(flag);
  expect(argv).not.toContain('--property=CapabilityBoundingSet=');expect(argv).toContain(SERVER1_CUTOVER.snapshotChild);expect(argv).toContain(SERVER1_CUTOVER.activeManifest);expect(argv).toContain(SERVER1_CUTOVER.finalSnapshot);expect(recorded?.slice(2)).toEqual([65536,35000]);
  const outer=source.slice(source.indexOf('function containment('),source.indexOf('const serviceProperties='));expect(outer).toContain('/^CapEff:\\s+0+$/m.test(status)&&/^NoNewPrivs:\\s+1$/m.test(status)');
 });
 it('contains no force-stop/retry/target reopening or receipt-derived authority shortcut',()=>{
  expect(source).not.toMatch(/process\.kill\([^\n]*['"]SIGKILL|\.Client\.start\(|\.connect\(.*PM2|--force|allowProduction|register.*Facade|mint.*Provenance|executeRemote/i);expect(source).toContain("lease.rpc.call('notifyKillPM2',{},()=>{})");expect(source).toContain("sock.set('retry timeout',0);sock.retry=0");expect(source).toContain("new Set<Client>()");expect(source).toContain("assert.equal(sha(canonicalJson({staging,publicCensus,projections})),c.baseline.nativeCensusSha256)"); // No acceptance claim is inferred from this static contract test.
 });
});

describe('actual private cutover owner-session integration (recording only)',()=>{
 it('keeps a healthy owner pulsing while its sibling probe is stalled, without overlapping that probe',async()=>{
  vi.useFakeTimers();const r=recordingSessions();r.second.gate('SELECT 1');
  try{await vi.advanceTimersByTimeAsync(4000);expect(r.first.sql).toEqual(Array(4).fill('SELECT 1'));expect(r.second.sql).toEqual(['SELECT 1']);expect(r.second.maxActivePings).toBe(1);expect(r.sessions.failure).toBeUndefined();}
  finally{r.first.release();r.second.release();await r.sessions.dispose();vi.useRealTimers();}
  expect(r.first.listenerCount('error')).toBe(1);expect(r.second.listenerCount('error')).toBe(1);
 });
 it('drains only the transitioning owner and sends first LOCK before any RR heartbeat or snapshot query',async()=>{
  vi.useFakeTimers();const r=recordingSessions(),probe=r.second.gate('SELECT 1'),begin=r.second.gate('BEGIN ISOLATION LEVEL REPEATABLE READ'),lock=r.second.gate('LOCK TABLE owned IN SHARE MODE');let transition:Promise<void>|undefined;
  try{
   await vi.advanceTimersByTimeAsync(1000);transition=r.sessions.beginLocked(r.second.client(),'LOCK TABLE owned IN SHARE MODE');await vi.advanceTimersByTimeAsync(2000);
   expect(r.second.sql).toEqual(['SELECT 1']);expect(r.first.sql).toHaveLength(3);probe.resolve();await vi.advanceTimersByTimeAsync(0);
   expect(r.transactions.has(r.second.client())).toBe(true);expect(r.second.sql).toEqual(['SELECT 1','BEGIN ISOLATION LEVEL REPEATABLE READ']);await vi.advanceTimersByTimeAsync(2000);expect(r.first.sql).toHaveLength(5);expect(r.second.sql).toHaveLength(2);
   begin.resolve();await vi.advanceTimersByTimeAsync(0);expect(r.second.sql).toEqual(['SELECT 1','BEGIN ISOLATION LEVEL REPEATABLE READ','LOCK TABLE owned IN SHARE MODE']);await vi.advanceTimersByTimeAsync(2000);expect(r.first.sql).toHaveLength(7);expect(r.second.sql).toHaveLength(3);
   lock.resolve();await transition;await vi.advanceTimersByTimeAsync(1000);expect(r.second.sql.at(-1)).toBe('SELECT 1');
  }finally{r.first.release();r.second.release();await transition;await r.sessions.dispose();vi.useRealTimers();}
  expect(r.second.sql.indexOf('ROLLBACK')).toBeGreaterThan(r.second.sql.indexOf('LOCK TABLE owned IN SHARE MODE'));expect(r.cleanup).toEqual([]);
 });
 it('keeps the sibling alive across a paused COMMIT and preserves its transaction until its own disposal',async()=>{
  vi.useFakeTimers();const r=recordingSessions(),commit=r.second.gate('COMMIT');let submitted:Promise<unknown>|undefined;
  try{await r.sessions.beginLocked(r.first.client(),'LOCK TABLE source IN SHARE MODE');await r.sessions.beginLocked(r.second.client(),'LOCK TABLE target IN SHARE ROW EXCLUSIVE MODE');await r.sessions.pauseAndDrain(r.second.client());submitted=r.second.query('COMMIT');await vi.advanceTimersByTimeAsync(4000);expect(r.first.sql.filter(v=>v==='SELECT 1')).toHaveLength(4);expect(r.second.sql.filter(v=>v==='SELECT 1')).toHaveLength(0);expect(r.transactions.size).toBe(2);commit.resolve();await submitted;r.transactions.delete(r.second.client());r.sessions.resume(r.second.client());}
  finally{r.first.release();r.second.release();await submitted;await r.sessions.dispose();vi.useRealTimers();}
  expect(r.first.sql.filter(v=>v==='ROLLBACK')).toHaveLength(1);expect(r.second.sql.filter(v=>v==='ROLLBACK')).toHaveLength(0);
 });
 it('tracks an unacknowledged BEGIN for rollback and never resumes a client whose first LOCK failed',async()=>{
  vi.useFakeTimers();const r=recordingSessions();r.first.errors.set('BEGIN ISOLATION LEVEL REPEATABLE READ',Object.assign(new Error('begin acknowledgement lost'),{code:'08006'}));r.second.errors.set('LOCK TABLE target IN SHARE MODE',Object.assign(new Error('lock timeout'),{code:'55P03'}));
  try{await expect(r.sessions.beginLocked(r.first.client(),'LOCK TABLE source IN SHARE MODE')).rejects.toMatchObject({code:'08006'});await expect(r.sessions.beginLocked(r.second.client(),'LOCK TABLE target IN SHARE MODE')).rejects.toMatchObject({code:'55P03'});expect(r.transactions.size).toBe(2);await vi.advanceTimersByTimeAsync(2000);expect(r.first.sql).not.toContain('SELECT 1');expect(r.second.sql).not.toContain('SELECT 1');}
  finally{r.first.release();r.second.release();await r.sessions.dispose();vi.useRealTimers();}
  expect(r.first.sql).toEqual(['BEGIN ISOLATION LEVEL REPEATABLE READ','ROLLBACK']);expect(r.second.sql).toEqual(['BEGIN ISOLATION LEVEL REPEATABLE READ','LOCK TABLE target IN SHARE MODE','ROLLBACK']);expect(r.cleanup).toEqual([]);
 });
 it('keeps the second owner alive through first rollback/end and attempts BOTH rollback/end failures before stopping listeners',async()=>{
  vi.useFakeTimers();const r=recordingSessions();r.transactions.add(r.first.client());r.transactions.add(r.second.client());const rollback=r.first.gate('ROLLBACK'),end=deferred();r.first.endGate=end;for(const pg of [r.first,r.second]){pg.errors.set('ROLLBACK',new Error('rollback failed'));pg.endError=new Error('close failed');}let disposal:Promise<void>|undefined;
  try{disposal=r.sessions.dispose();await vi.advanceTimersByTimeAsync(2000);expect(r.first.sql).toEqual(['ROLLBACK']);expect(r.first.ended).toBe(0);expect(r.second.sql).toEqual(['SELECT 1','SELECT 1']);rollback.resolve();await vi.advanceTimersByTimeAsync(2000);expect(r.first.ended).toBe(1);expect(r.second.sql).toEqual(Array(4).fill('SELECT 1'));end.resolve();await disposal;expect(r.first.ended).toBe(1);expect(r.second.ended).toBe(1);expect(r.second.sql.at(-1)).toBe('ROLLBACK');expect(r.cleanup).toEqual(['transaction-disposal','postgres-close','transaction-disposal','postgres-close']);const counts=[r.first.sql.length,r.second.sql.length];await vi.advanceTimersByTimeAsync(2000);expect([r.first.sql.length,r.second.sql.length]).toEqual(counts);expect(r.first.listenerCount('error')).toBe(1);expect(r.second.listenerCount('error')).toBe(1);}
  finally{r.first.release();r.second.release();await disposal;vi.useRealTimers();}
 });
});
