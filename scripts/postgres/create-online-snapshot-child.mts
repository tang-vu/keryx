/** Privileged operator copy only. Never imports env/config/adapters, enrolls a
 * store or grants payment authority. Native limits are checked before access. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync,constants,createReadStream,existsSync,fstatSync,fsyncSync,lstatSync,openSync,readFileSync,readSync,realpathSync } from 'node:fs';
import { dirname,isAbsolute,parse,relative,resolve,sep } from 'node:path';
import { backup,DatabaseSync } from 'node:sqlite';
import { OFFLINE_SNAPSHOT_LIMITS } from '../../lib/db/storage-provenance';
import { configureSnapshotConnection,validateSnapshotHeader,verifySnapshotContainment } from '../../lib/db/storage-provenance-snapshot';
const maximum=512*1024*1024;
function canonical(path:string){
 assert(typeof path==='string'&&path.length<=2048&&isAbsolute(path)&&resolve(path)===path&&!path.includes('\0'));
 let current=parse(path).root;for(const part of relative(current,path).split(sep)){current=resolve(current,part);assert(!lstatSync(current).isSymbolicLink());}
 assert.equal(realpathSync(path),path);return lstatSync(path,{bigint:true});
}
function privateFile(path:string,maxBytes:number){
 const s=canonical(path);assert(s.isFile()&&s.uid===BigInt(0)&&s.nlink===BigInt(1)&&(s.mode&BigInt(0o077))===BigInt(0)&&s.size>BigInt(0)&&s.size<=BigInt(maxBytes));return s;
}
function manifestWire(path:string){
 const before=privateFile(path,8192),id=(s:typeof before)=>[s.dev,s.ino,s.uid,s.mode,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{assert.equal(id(fstatSync(fd,{bigint:true})),id(before));const bytes=Buffer.alloc(8193);let n=0;
  while(n<bytes.length){const read=readSync(fd,bytes,n,bytes.length-n,n);if(!read)break;n+=read;}
  assert(BigInt(n)===before.size&&n<=8192);assert.equal(id(fstatSync(fd,{bigint:true})),id(before));assert.equal(id(privateFile(path,8192)),id(before));return bytes.subarray(0,n);
 }finally{closeSync(fd);}
}
function schemaDigest(db:DatabaseSync){
 const bound=db.prepare('SELECT count(*) n,coalesce(sum(length(CAST(sql AS BLOB))),0) bytes,coalesce(max(length(CAST(sql AS BLOB))),0) field FROM sqlite_schema').get()!;
 assert(typeof bound.n==='number'&&bound.n<=1024&&typeof bound.bytes==='number'&&bound.bytes<=4194304&&typeof bound.field==='number'&&bound.field<=131072);
 // Hash raw bytes rather than replacing malformed UTF-8 in metadata.
 const rows=db.prepare("SELECT lower(hex(CAST(type AS BLOB))) type,lower(hex(CAST(name AS BLOB))) name,lower(hex(CAST(tbl_name AS BLOB))) parent,CASE WHEN sql IS NULL THEN NULL ELSE lower(hex(CAST(sql AS BLOB))) END sql FROM sqlite_schema ORDER BY type,name COLLATE BINARY").all();
 const wire=JSON.stringify(rows);assert(Buffer.byteLength(wire)<=9437184);return createHash('sha256').update(wire).digest('hex');
}
async function main(){
 assert.equal(process.platform,'linux');assert.equal(process.getuid?.(),0);assert.equal(process.version,'v24.22.1');assert.equal(process.argv.length,6);
 const [manifest,expectedHash,target,unit]=process.argv.slice(2);assert.match(expectedHash,/^[a-f0-9]{64}$/);
 verifySnapshotContainment(unit);
 const cgroup='/sys/fs/cgroup/system.slice/'+unit;
 assert.equal(readFileSync(cgroup+'/cpu.max','utf8').trim(),'50000 100000');
 const runtime=execFileSync('/usr/bin/systemctl',['show',unit,'-p','RuntimeMaxUSec','--value'],{encoding:'utf8',timeout:2000,maxBuffer:4096,env:{NODE_ENV:'production'}}).trim();assert.equal(runtime,'30s');
 const packet=manifestWire(manifest);assert.equal(createHash('sha256').update(packet).digest('hex'),expectedHash);
 const declared:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(packet));assert(declared&&typeof declared==='object');
 const backend=Reflect.get(declared,'backend');assert(backend&&typeof backend==='object'&&Reflect.get(backend,'kind')==='sqlite');
 const source=Reflect.get(backend,'databasePath');assert.equal(typeof source,'string');
 const sourcePath=source as string,sourceBefore=privateFile(sourcePath,maximum),parent=canonical(dirname(target));
 assert(parent.isDirectory()&&parent.uid===BigInt(0)&&(parent.mode&BigInt(0o077))===BigInt(0));assert(isAbsolute(target)&&resolve(target)===target&&target!==sourcePath&&!target.includes('\0')&&!existsSync(target));
 const outputFd=openSync(target,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);closeSync(outputFd);
 const started=performance.now();let input:DatabaseSync|undefined,output:DatabaseSync|undefined;
 try{
  input=new DatabaseSync(sourcePath,{readOnly:true,allowExtension:false,timeout:1000});
  const opened=privateFile(sourcePath,maximum);assert.equal(opened.dev,sourceBefore.dev);assert.equal(opened.ino,sourceBefore.ino);
  configureSnapshotConnection(input,OFFLINE_SNAPSHOT_LIMITS);input.exec('BEGIN');
  const beforeSchema=schemaDigest(input),pageSize=Number(input.prepare('PRAGMA page_size').get()!.page_size),sourcePages=Number(input.prepare('PRAGMA page_count').get()!.page_count);
  assert(Number.isSafeInteger(sourcePages)&&sourcePages>0&&pageSize>=512&&pageSize<=65536&&sourcePages*pageSize<=maximum);
  const pages=await backup(input,target,{rate:128,progress:info=>{assert(performance.now()-started<25000&&info.totalPages*pageSize<=maximum);}});
  assert.equal(pages,sourcePages);assert.equal(schemaDigest(input),beforeSchema);input.exec('ROLLBACK');input.close();input=undefined;
  const after=privateFile(sourcePath,maximum);assert.equal(after.dev,sourceBefore.dev);assert.equal(after.ino,sourceBefore.ino);
  output=new DatabaseSync(target,{allowExtension:false,timeout:1000});output.exec('PRAGMA trusted_schema=OFF;PRAGMA synchronous=FULL;');
  assert.equal(output.prepare('PRAGMA journal_mode=DELETE').get()!.journal_mode,'delete');
  assert.equal(Number(output.prepare('PRAGMA page_count').get()!.page_count),sourcePages);assert.equal(Number(output.prepare('PRAGMA page_size').get()!.page_size),pageSize);assert.equal(schemaDigest(output),beforeSchema);
  output.close();output=undefined;
  for(const suffix of ['-wal','-shm','-journal'])assert(!existsSync(target+suffix));
  const final=privateFile(target,maximum),fd=openSync(target,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{validateSnapshotHeader(fd);fsyncSync(fd);}finally{closeSync(fd);}
  assert.equal(Number(final.size),pages*pageSize);assert(performance.now()-started<27000);
  const hash=createHash('sha256');for await(const chunk of createReadStream(target))hash.update(chunk);
  const stable=privateFile(target,maximum);assert.equal(stable.size,final.size);assert.equal(stable.mtimeNs,final.mtimeNs);assert.equal(stable.ino,final.ino);
  console.log(JSON.stringify({format:'keryx-consistent-online-sqlite-copy-v1',backupComplete:true,enrollmentAuthorized:false,modeIdentityAccepted:false,sourceOpenedReadOnly:true,sourceManifestSha256:expectedHash,sourceFileBytesBefore:Number(sourceBefore.size),schemaSha256:beforeSchema,pages,pageSize,bytes:Number(final.size),sha256:hash.digest('hex'),elapsedMs:Math.round(performance.now()-started),nativeLimits:{memoryMax:268435456,swapMax:0,cpuMax:'50000 100000',pidsMax:32,runtimeMaxSeconds:30,privateNetwork:true},paymentActions:0,jobActions:0}));
 }finally{try{input?.close();}finally{output?.close();}}
}
main().catch(()=>{console.log(JSON.stringify({format:'keryx-consistent-online-sqlite-copy-v1',backupComplete:false,enrollmentAuthorized:false,modeIdentityAccepted:false,reason:'copy_unavailable'}));process.exitCode=1;});
