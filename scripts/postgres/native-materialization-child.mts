/** Contained development child; actual retained data is mounted read-only and
 * never enters the generic image or an application credential. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync,closeSync,constants,createReadStream,lstatSync,openSync,readFileSync,readSync,readlinkSync,realpathSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { syntheticStorageIdentity } from '../../lib/db/storage-identity-fixture';
import { STORAGE_MAINNET_PROFILE_DIGEST } from '../../lib/db/storage-identity';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { insertStorageIdentity,installStorageFences } from '../../lib/db/storage-identity-sqlite';
import { checkSnapshotSidecars,checkSnapshotUnchanged,configureSnapshotConnection,validateSnapshotHeader } from '../../lib/db/storage-provenance-snapshot';
import { OFFLINE_SNAPSHOT_LIMITS } from '../../lib/db/storage-provenance';
import { rehearseSqliteSnapshot } from './rehearse-snapshot.mts';
import { materializeNativeSnapshot,NativeMaterializationUnavailable } from './materialize-native-snapshot.mts';
let stage='containment';
let stagingSummary:{tables:number;rows:number}|undefined;
function synthetic(){
 const target='/run/keryx-intake/synthetic.sqlite',db=new DatabaseSync(target),date='2026-11-14T00:00:00.000Z';chmodSync(target,0o600);
 const identity={...syntheticStorageIdentity('mainnet-real'),format:'keryx-mainnet-storage-identity-v1' as const,network:'eip155:5042' as const,profileDigest:STORAGE_MAINNET_PROFILE_DIGEST};
 try{
  db.exec('BEGIN IMMEDIATE');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);
  const id='synthetic-native-materialized-run',wire=' '+JSON.stringify({id,createdAt:date,question:'Synthetic native materialization',answer:'Original\0answer\ud800',budget:0,engine:'heuristic',totalSpent:0,totalToCreators:0,subClaims:[],decisions:[],citations:[],trace:[],paymentMode:'offline',uninterpreted:{keep:'exact original'}})+'\n';
  db.prepare('INSERT INTO query_runs(id,created_at,question,budget,total_spent,total_to_creators,data) VALUES(?,?,?,0,0,0,?)').run(id,date,'Synthetic native materialization',wire);
  db.prepare('INSERT INTO query_memories(id,source_scores,sources_read,topics,created_at) VALUES(?,?,?,?,?)').run(id,' {"z":{"weight":0.30000000000000004},"a":{"weight":0.1}} ','["synthetic"]','["café","metadata"]',date);
  db.prepare('INSERT INTO source_items(id,source_id,title,content) VALUES(?,?,?,?)').run('synthetic-materialized-orphan','synthetic-missing-source','Historical item','Retained original metadata');
  insertStorageIdentity(db,identity);installStorageFences(db,identity);db.exec('COMMIT');
 }finally{db.close();}return target;
}
async function main(){
 assert.equal(process.platform,'linux');assert.equal(process.version,'v24.22.1');assert.equal(process.getuid!(),0);assert.equal(process.ppid,1);assert.deepEqual(process.argv.slice(2),['--materialize']);
 const kernel=(name:string)=>readFileSync('/sys/fs/cgroup/'+name,'utf8').trim(),limits={memoryMax:kernel('memory.max'),swapMax:kernel('memory.swap.max'),cpuMax:kernel('cpu.max'),pidsMax:kernel('pids.max')};
 assert.deepEqual(limits,{memoryMax:'536870912',swapMax:'0',cpuMax:'25000 100000',pidsMax:'32'});
 const status=readFileSync('/proc/self/status','utf8');assert(/^NoNewPrivs:\s+1$/m.test(status)&&/^CapEff:\s+0+$/m.test(status));assert.equal(readFileSync('/proc/net/route','utf8').trim().split('\n').length,1);assert.equal(readlinkSync('/proc/1/exe'),'/usr/bin/timeout');
 assert.deepEqual(readFileSync('/proc/1/cmdline','utf8').split('\0').filter(Boolean),['/usr/bin/timeout','--signal=KILL','1800s','node','--no-warnings','--max-old-space-size=256','/child.cjs','--materialize']);
 const mounts=readFileSync('/proc/self/mountinfo','utf8').trim().split('\n').map(s=>s.split(' '));assert(mounts.some(p=>p[4]==='/'&&p[5].split(',').includes('ro')));
 const buffer=Buffer.alloc(8388609);let bytes=0;for(;;){const n=readSync(0,buffer,bytes,buffer.length-bytes,null);if(!n)break;bytes+=n;assert(bytes<buffer.length);}
 const packet=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(buffer.subarray(0,bytes))) as {mode:string;password:string;referenceWire:string;expectedHash?:string};buffer.fill(0);
 assert(['synthetic','retained'].includes(packet.mode));assert.deepEqual(Object.keys(packet).sort(),(packet.mode==='retained'?['mode','password','referenceWire','expectedHash']:['mode','password','referenceWire']).sort());assert(/^[a-f0-9]{48}$/.test(packet.password));
 stage='snapshot-bootstrap';const target=packet.mode==='synthetic'?synthetic():'/input/snapshot.sqlite';if(packet.mode==='retained')assert(mounts.some(p=>p[4]===target&&p[5].split(',').includes('ro')));
 assert.equal(realpathSync(target),target);checkSnapshotSidecars(target);const before=lstatSync(target,{bigint:true});assert(before.isFile()&&!before.isSymbolicLink()&&before.size>BigInt(0)&&before.size<=BigInt(536870912));
 const descriptor=openSync(target,constants.O_RDONLY|constants.O_NOFOLLOW);let db:DatabaseSync|undefined;
 try{
  stage='snapshot-validation';validateSnapshotHeader(descriptor);const hash=createHash('sha256');for await(const chunk of createReadStream(target))hash.update(chunk);const snapshotSha256=hash.digest('hex');
  if(packet.mode==='retained'){assert(typeof packet.expectedHash==='string'&&/^[a-f0-9]{64}$/.test(packet.expectedHash));assert.equal(snapshotSha256,packet.expectedHash);}
  db=new DatabaseSync(target,{readOnly:true,allowExtension:false,timeout:1000});configureSnapshotConnection(db,OFFLINE_SNAPSHOT_LIMITS);db.exec('BEGIN');
  const options={endpoint:{kind:'loopback' as const,port:5432},database:'native_materialized',role:'postgres',password:packet.password};
  stage='typed-staging';const staging=await rehearseSqliteSnapshot(db,{...options,database:'native_staging'});assert(staging.verified);stagingSummary={tables:staging.tables.length,rows:staging.totalRows};
  stage='native-public-materialization';const materialization=await materializeNativeSnapshot(db,options,packet.referenceWire);
  stage='existing-target-refusal';await assert.rejects(materializeNativeSnapshot(db,options,packet.referenceWire),error=>error instanceof NativeMaterializationUnavailable&&error.diagnostic.stage==='pristine-catalog'&&error.diagnostic.commitOutcome==='not_attempted');
  db.exec('ROLLBACK');db.close();db=undefined;checkSnapshotUnchanged(target,descriptor,before.size,before.mtimeNs);
  console.log(JSON.stringify({format:'keryx-native-materialization-development-rehearsal-v1',passed:true,mode:packet.mode,snapshotSha256,sourceBytes:Number(before.size),staging,materialization,existingTargetReadoptionRefused:true,limits,sourceUnchanged:true,hardDeadlineSeconds:1800,retainedProductionSnapshotRead:packet.mode==='retained',liveProductionRead:false,productionChanged:false,applicationBackendSwitched:false,paymentActions:0,jobActions:0}));
 }finally{try{db?.close();}finally{closeSync(descriptor);}}
}
void main().catch((error:unknown)=>{
 const rawCode=error&&typeof error==='object'?Reflect.get(error,'code'):null,code=typeof rawCode==='string'&&/^[a-zA-Z0-9_]{1,64}$/.test(rawCode)?rawCode:null;
 console.log(JSON.stringify({format:'keryx-native-materialization-development-rehearsal-v1',passed:false,reason:'native_materialization_unavailable',stage,errorType:error instanceof Error?error.name:'unknown',code,stagingSummary,...(error instanceof NativeMaterializationUnavailable?{diagnostic:error.diagnostic}:{}),productionChanged:false,applicationBackendSwitched:false}));process.exitCode=1;
});
