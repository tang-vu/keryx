/** Separate development-Docker operator profile. No runtime/factory enrollment. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync,constants,createReadStream,fstatSync,lstatSync,openSync,readFileSync,readdirSync,readlinkSync,realpathSync,chmodSync,readSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { OFFLINE_SNAPSHOT_LIMITS } from '../../lib/db/storage-provenance';
import { checkSnapshotSidecars,checkSnapshotUnchanged,configureSnapshotConnection,validateSnapshotHeader } from '../../lib/db/storage-provenance-snapshot';
import { inventorySnapshot,type InventoryDiagnostic } from './typed-inventory.mts';
import { rehearseSqliteSnapshot } from './rehearse-snapshot.mts';
const diagnostic:InventoryDiagnostic={stage:'containment',table:null,rows:0,wireBytes:0,started:performance.now()};
async function main(){
 assert.equal(process.platform,'linux');assert.equal(process.version,'v24.22.1');assert.equal(process.getuid?.(),0);assert.equal(process.ppid,1);
 const mode=process.argv[2];assert(['pressure','deadline','synthetic','inventory','rehearsal','synthetic-rehearsal'].includes(mode));
 const rehearsal=mode.endsWith('rehearsal'),synthetic=mode==='synthetic'||mode==='synthetic-rehearsal';assert.equal(process.argv.length,mode==='inventory'||mode==='rehearsal'?4:3);
 const kernel=(name:string)=>readFileSync('/sys/fs/cgroup/'+name,'utf8').trim();
 const limits={memoryMax:kernel('memory.max'),swapMax:kernel('memory.swap.max'),cpuMax:kernel('cpu.max'),pidsMax:kernel('pids.max')};
 assert.deepEqual(limits,{memoryMax:'536870912',swapMax:'0',cpuMax:'25000 100000',pidsMax:'32'});
 const status=readFileSync('/proc/self/status','utf8');assert(/^NoNewPrivs:\s+1$/m.test(status));assert(/^CapEff:\s+0+$/m.test(status));
 assert.deepEqual(readdirSync('/sys/class/net'),['lo']);assert.equal(readFileSync('/proc/net/route','utf8').trim().split('\n').length,1);
 assert.equal(readlinkSync('/proc/1/exe'),'/usr/bin/timeout');
 const parent=readFileSync('/proc/1/cmdline','utf8').split('\0').filter(Boolean);
 assert.deepEqual(parent,['/usr/bin/timeout','--signal=KILL',mode==='deadline'?'5s':rehearsal?'1800s':'300s','node','--no-warnings','--max-old-space-size=256','/child.cjs',...process.argv.slice(2)]);
 const mounts=readFileSync('/proc/self/mountinfo','utf8').trim().split('\n').map(line=>line.split(' '));assert(mounts.some(parts=>parts[4]==='/'&&parts[5].split(',').includes('ro')));
 if(mode==='pressure'||mode==='deadline'){
  console.log(JSON.stringify({syntheticOnly:true,actualKernelLimitsVerified:true,limits,deadlineSeconds:mode==='deadline'?5:300,productionDataRead:false}));
  if(mode==='deadline'){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);throw new Error('deadline survived');}
  const db=new DatabaseSync(':memory:');try{db.prepare('SELECT length(randomblob(734003200))').get();throw new Error('native allocation survived');}finally{db.close();}
 }
 let target='/input/snapshot.sqlite',expectedHash=process.argv[3];
 if(synthetic){
  target='/run/keryx-intake/synthetic.sqlite';const db=new DatabaseSync(target);chmodSync(target,0o600);
  try{db.exec('CREATE TABLE fixture(id INTEGER PRIMARY KEY,n INTEGER,r REAL,t TEXT,b BLOB)');db.prepare('INSERT INTO fixture VALUES(1,?,?,?,?)').run(BigInt('9223372036854775807'),.125,'synthetic\0text',Buffer.from([255,0]));}finally{db.close();}
  expectedHash=createHash('sha256').update(readFileSync(target)).digest('hex');
 }else{
  assert(mounts.some(parts=>parts[4]===target&&parts[5].split(',').includes('ro')),'Private input must be an actual read-only file mount');
 }
 // Windows ACL ownership is checked by the operator controller. This explicit
 // read-only bind profile does not claim Linux credential-file POSIX admission.
 assert.match(expectedHash,/^[a-f0-9]{64}$/);assert.equal(realpathSync(target),target);const before=lstatSync(target,{bigint:true});assert(before.isFile()&&!before.isSymbolicLink()&&before.size>BigInt(0)&&before.size<=BigInt(536870912));
 checkSnapshotSidecars(target);const fd=openSync(target,constants.O_RDONLY|constants.O_NOFOLLOW);let db:DatabaseSync|undefined;
 try{
  const opened=fstatSync(fd,{bigint:true});assert.equal(opened.ino,before.ino);assert.equal(opened.dev,before.dev);validateSnapshotHeader(fd);
  diagnostic.stage='file-hash';const hash=createHash('sha256');for await(const chunk of createReadStream(target))hash.update(chunk);assert.equal(hash.digest('hex'),expectedHash);
  db=new DatabaseSync(target,{readOnly:true,allowExtension:false,timeout:1000});configureSnapshotConnection(db,OFFLINE_SNAPSHOT_LIMITS);db.exec('BEGIN');
  if(rehearsal){
   const buffer=Buffer.alloc(2049);let bytes=0;while(bytes<buffer.length){const count=readSync(0,buffer,bytes,buffer.length-bytes,null);if(!count)break;bytes+=count;}assert(bytes<=2048);
   const packet=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,bytes))) as {password:string};assert.deepEqual(Object.keys(packet),['password']);assert.match(packet.password,/^[a-f0-9]{48}$/);
   diagnostic.stage='postgres-rehearsal';const result=await rehearseSqliteSnapshot(db,{endpoint:{kind:'loopback',port:5432},database:'postgres',role:'keryx_rehearsal',password:packet.password});
   db.exec('ROLLBACK');db.close();db=undefined;checkSnapshotUnchanged(target,fd,before.size,before.mtimeNs);
   console.log(JSON.stringify({snapshotSha256:expectedHash,sourceBytes:Number(before.size),...result,limits,hardDeadlineSeconds:1800,elapsedMs:Math.round(performance.now()-diagnostic.started),privatePostgresStagingOnly:true,applicationMaterialized:false,enrollmentAuthorized:false,modeIdentityAccepted:false,paymentActions:0,jobActions:0}));return;
  }
  const inventory=inventorySnapshot(db,diagnostic.started+250000,diagnostic);db.exec('ROLLBACK');db.close();db=undefined;checkSnapshotUnchanged(target,fd,before.size,before.mtimeNs);
  const result={format:'keryx-full-typed-sqlite-snapshot-inventory-v1',fullTypedInventoryComplete:true,profile:'development-docker-offline-v1',snapshotSha256:expectedHash,sourceBytes:Number(before.size),...inventory,limits,hardDeadlineSeconds:300,elapsedMs:Math.round(performance.now()-diagnostic.started),enrollmentAuthorized:false,modeIdentityAccepted:false,applicationBackendSwitched:false,paymentActions:0,jobActions:0};
  const wire=JSON.stringify(result);assert(Buffer.byteLength(wire)<=262144);console.log(wire);
 }finally{try{db?.close();}finally{closeSync(fd);}}
}
void main().catch((error:unknown)=>{console.log(JSON.stringify({fullTypedInventoryComplete:false,reason:'inventory_unavailable',diagnostic:{...diagnostic,started:undefined,elapsedMs:Math.round(performance.now()-diagnostic.started),errorType:error instanceof Error?error.name:'unknown',codecRefused:error instanceof Error&&error.message==='Migration snapshot refused'},enrollmentAuthorized:false,modeIdentityAccepted:false,applicationBackendSwitched:false}));process.exitCode=1;});
