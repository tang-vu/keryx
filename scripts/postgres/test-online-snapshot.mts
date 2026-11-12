/** Hermetic Linux operator acceptance. Synthetic files only; no env or adapters. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash,randomUUID } from 'node:crypto';
import { chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmdirSync,unlinkSync,writeFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { buildSync } from 'esbuild';
import { cleanupSnapshotUnit } from '../../lib/db/storage-provenance-containment';
assert.equal(process.platform,'linux');assert.equal(process.getuid?.(),0);assert.equal(process.version,'v24.22.1');
const parent=resolve('.local/tmp');mkdirSync(parent,{recursive:true});const folder=mkdtempSync(join(parent,'online-snapshot-acceptance-'));chmodSync(folder,0o700);
const units=new Set<string>(),source=join(folder,'source.sqlite'),target=join(folder,'copy.sqlite'),manifest=join(folder,'storage.json');let db:DatabaseSync|undefined,writer:ReturnType<typeof setInterval>|undefined;
async function command(executable:string,args:string[]){
 return await new Promise<{code:number|null;stdout:string}>(resolveResult=>{
  const child=spawn(executable,args,{stdio:['ignore','pipe','ignore'],env:{NODE_ENV:'production'}});let stdout='',done=false;
  const timer=setTimeout(()=>child.kill('SIGKILL'),40000);
  child.stdout.on('data',(b:Buffer)=>{stdout+=b.toString('utf8');if(Buffer.byteLength(stdout)>16384)child.kill('SIGKILL');});
  const finish=(code:number|null)=>{if(done)return;done=true;clearTimeout(timer);resolveResult({code,stdout});};child.once('error',()=>finish(null));child.once('close',finish);
 });
}
async function run(name:'copy'|'pressure'|'inventory',args:string[]){
 const unit='keryx-provenance-'+randomUUID()+'.service';units.add(unit);
 try{
  const result=await command('/usr/bin/systemd-run',['--quiet','--wait','--pipe','--unit='+unit,'--property=MemoryMax=268435456','--property=MemorySwapMax=0','--property=CPUQuota=50%','--property=TasksMax=32','--property=RuntimeMaxSec=30','--property=KillMode=control-group','--property=NoNewPrivileges=yes','--property=PrivateNetwork=yes','--property=LimitCORE=0','--','/usr/bin/env','-i','NODE_ENV=production',process.execPath,'--no-warnings','--max-old-space-size=128',join(folder,name+'.cjs'),...args,unit]);
  const values=result.stdout.split(/\r?\n/).filter(s=>s.startsWith('{')).map(s=>JSON.parse(s) as Record<string,unknown>);
  const state=await command('/usr/bin/systemctl',['show',unit,'-p','Result','--value']);return {...result,values,state:state.stdout.trim()};
 }finally{const cleanup=await cleanupSnapshotUnit(unit);assert(cleanup.cleaned,'Only the captured test unit must be removed');units.delete(unit);}
}
try{
 for(const [name,entry] of [['copy','create-online-snapshot-child.mts'],['pressure','qualify-online-snapshot-pressure-child.mts'],['inventory','inspect-typed-snapshot-child.mts']] as const){
  buildSync({entryPoints:[fileURLToPath(new URL('./'+entry,import.meta.url))],outfile:join(folder,name+'.cjs'),bundle:true,platform:'node',target:'node24',format:'cjs',treeShaking:true,logLevel:'silent'});
 }
 const pressure=await run('pressure',[]);assert.notEqual(pressure.code,0);assert.equal(pressure.state,'oom-kill');assert.equal(pressure.values[0]?.actualKernelLimitsVerified,true);
 db=new DatabaseSync(source);chmodSync(source,0o600);db.exec('PRAGMA journal_mode=WAL;CREATE TABLE fixture(id INTEGER PRIMARY KEY,n INTEGER,r REAL,t TEXT,b BLOB);');
 db.prepare('INSERT INTO fixture VALUES(1,?,?,?,?)').run(BigInt('9223372036854775807'),.125,'synthetic\0text',Buffer.from([255,0]));
 db.exec('CREATE TABLE padding(payload BLOB);WITH RECURSIVE n(x) AS(VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<4096) INSERT INTO padding SELECT zeroblob(1024) FROM n;');
 const packet=JSON.stringify({backend:{kind:'sqlite',databasePath:source}});writeFileSync(manifest,packet,{mode:0o600});
 const digest=createHash('sha256').update(packet).digest('hex'),outside=join(folder,'outside.sqlite');
 const refused=await command(process.execPath,['--no-warnings',join(folder,'copy.cjs'),manifest,digest,outside,'keryx-provenance-'+randomUUID()+'.service']);assert.notEqual(refused.code,0);assert(!existsSync(outside));
 let counter=2;writer=setInterval(()=>db!.prepare('INSERT INTO fixture VALUES(?,?,?,?,?)').run(counter,counter++,.25,'synthetic concurrent',Buffer.from([0])),1);
 const copied=await run('copy',[manifest,digest,target]);clearInterval(writer);writer=undefined;
 assert.equal(copied.code,0);assert.equal(copied.state,'success');assert.equal(copied.values[0]?.backupComplete,true);assert.equal(copied.values[0]?.enrollmentAuthorized,false);assert.equal(copied.values[0]?.modeIdentityAccepted,false);assert(counter>2,'A second connection wrote while the readonly backup ran');
 const check=new DatabaseSync(target,{readOnly:true});let expectedRows=0;
 try{assert.deepEqual({...check.prepare("SELECT typeof(n) kind,CAST(n AS TEXT) n,r,hex(CAST(t AS BLOB)) t,hex(b) b FROM fixture WHERE id=1").get()!},{kind:'integer',n:'9223372036854775807',r:.125,t:'73796E7468657469630074657874',b:'FF00'});assert.equal(check.prepare('PRAGMA journal_mode').get()!.journal_mode,'delete');expectedRows=Number(check.prepare('SELECT count(*) n FROM fixture').get()!.n);}finally{check.close();}
 const before=createHash('sha256').update(readFileSync(target)).digest('hex');assert.equal(before,copied.values[0]?.sha256);
 const inventory=await run('inventory',[target,before]);assert.equal(inventory.code,0);assert.equal(inventory.values[0]?.fullTypedInventoryComplete,true);assert.equal(inventory.values[0]?.totalRows,expectedRows+4096);assert.equal(inventory.values[0]?.enrollmentAuthorized,false);
 const overwrite=await run('copy',[manifest,digest,target]);assert.notEqual(overwrite.code,0);assert.equal(overwrite.values[0]?.backupComplete,false);assert.equal(createHash('sha256').update(readFileSync(target)).digest('hex'),before);
 console.log('PASS: native SQLite OOM containment, concurrent WAL readonly backup, exact int64/real/NUL-text/blob, outside-unit refusal, existing-output retention and owned unit cleanup (synthetic only).');
}finally{
 if(writer)clearInterval(writer);db?.close();for(const unit of units)assert((await cleanupSnapshotUnit(unit)).cleaned);
 const owned=new Set(['copy.cjs','pressure.cjs','inventory.cjs','storage.json','source.sqlite','source.sqlite-wal','source.sqlite-shm','source.sqlite-journal','copy.sqlite','copy.sqlite-wal','copy.sqlite-shm','copy.sqlite-journal','outside.sqlite']);
 for(const name of readdirSync(folder)){assert(owned.has(name),'Refuse cleanup of an unowned test file');unlinkSync(join(folder,name));}rmdirSync(folder);
}
