/** Full bounded typed inventory of an operator-held offline copy. No row data,
 * credentials, enrollment, signing or application adapters leave this child. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync,constants,createReadStream,fstatSync,lstatSync,openSync,readFileSync,realpathSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { OFFLINE_SNAPSHOT_LIMITS } from '../../lib/db/storage-provenance';
import { checkSnapshotSidecars,checkSnapshotUnchanged,configureSnapshotConnection,validateSnapshotHeader,verifySnapshotContainment } from '../../lib/db/storage-provenance-snapshot';
import { inventorySnapshot } from './typed-inventory.mts';
const diagnostic:{stage:string;table:string|null;rows:number;wireBytes:number;started:number}={stage:'admission',table:null,rows:0,wireBytes:0,started:performance.now()};
async function main(){
 assert.equal(process.platform,'linux');assert.equal(process.getuid?.(),0);assert.equal(process.version,'v24.22.1');assert.equal(process.argv.length,5);
 const [target,expectedHash,unit]=process.argv.slice(2);assert.match(expectedHash,/^[a-f0-9]{64}$/);verifySnapshotContainment(unit);
 const cg='/sys/fs/cgroup/system.slice/'+unit;assert.equal(readFileSync(cg+'/cpu.max','utf8').trim(),'50000 100000');
 assert.equal(execFileSync('/usr/bin/systemctl',['show',unit,'-p','RuntimeMaxUSec','--value'],{encoding:'utf8',timeout:2000,maxBuffer:4096,env:{NODE_ENV:'production'}}).trim(),'30s');
 assert.equal(realpathSync(target),target);const before=lstatSync(target,{bigint:true});assert(before.isFile()&&!before.isSymbolicLink()&&before.uid===BigInt(0)&&before.nlink===BigInt(1)&&(before.mode&BigInt(0o077))===BigInt(0)&&before.size>BigInt(0)&&before.size<=BigInt(536870912));
 checkSnapshotSidecars(target);const fd=openSync(target,constants.O_RDONLY|constants.O_NOFOLLOW),started=performance.now();let db:DatabaseSync|undefined;
 try{
  const opened=fstatSync(fd,{bigint:true});assert.equal(opened.ino,before.ino);assert.equal(opened.dev,before.dev);validateSnapshotHeader(fd);
  diagnostic.stage='file-hash';const fileHash=createHash('sha256');for await(const chunk of createReadStream(target))fileHash.update(chunk);assert.equal(fileHash.digest('hex'),expectedHash);
  db=new DatabaseSync(target,{readOnly:true,allowExtension:false,timeout:1000});configureSnapshotConnection(db,OFFLINE_SNAPSHOT_LIMITS);db.exec('BEGIN');
  const inventory=inventorySnapshot(db,started+25000,diagnostic,1000000);
  diagnostic.stage='verify';db.exec('ROLLBACK');db.close();db=undefined;checkSnapshotUnchanged(target,fd,before.size,before.mtimeNs);
  const result={format:'keryx-full-typed-sqlite-snapshot-inventory-v1',fullTypedInventoryComplete:true,snapshotSha256:expectedHash,sourceBytes:Number(before.size),...inventory,elapsedMs:Math.round(performance.now()-started),enrollmentAuthorized:false,modeIdentityAccepted:false,applicationBackendSwitched:false,paymentActions:0,jobActions:0};
  const wire=JSON.stringify(result);assert(Buffer.byteLength(wire)<=262144);console.log(wire);
 }finally{try{db?.close();}finally{closeSync(fd);}}
}
main().catch((error:unknown)=>{console.log(JSON.stringify({format:'keryx-full-typed-sqlite-snapshot-inventory-v1',fullTypedInventoryComplete:false,reason:'inventory_unavailable',diagnostic:{stage:diagnostic.stage,table:diagnostic.table,completedRows:diagnostic.rows,wireBytes:diagnostic.wireBytes,elapsedMs:Math.round(performance.now()-diagnostic.started),errorType:error instanceof Error?error.name:'unknown',codecRefused:error instanceof Error&&error.message==='Migration snapshot refused'},enrollmentAuthorized:false,modeIdentityAccepted:false,applicationBackendSwitched:false}));process.exitCode=1;});
