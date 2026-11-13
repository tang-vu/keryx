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
import { insertStorageIdentity,installStorageFences,readStorageIdentity } from '../../lib/db/storage-identity-sqlite';
import { sealEnrolledCacheText } from '../../lib/sources/enrolled-content-cache';
import { auditCache } from './audit-cache.mts';
import { materializeNativeProjections } from './materialize-native-projections.mts';
import { canonicalJson } from '../../lib/canonical-json';
import { createTopicWatch,type TopicWatchState } from '../../lib/research/topic-watches';
import { syntheticA2aOriginal } from '../../lib/db/a2a-original-fixture';
import { ARC_MAINNET_PROFILE } from '../../lib/arc-network-profile';
import { Client } from 'pg';
import { postgresPoolConfiguration } from '../../lib/db/postgres/connection';
import { checkSnapshotSidecars,checkSnapshotUnchanged,configureSnapshotConnection,validateSnapshotHeader } from '../../lib/db/storage-provenance-snapshot';
import { OFFLINE_SNAPSHOT_LIMITS } from '../../lib/db/storage-provenance';
import { rehearseSqliteSnapshot } from './rehearse-snapshot.mts';
import { materializeNativeSnapshot,NativeMaterializationUnavailable } from './materialize-native-snapshot.mts';
let stage='containment';
let stagingSummary:{tables:number;rows:number}|undefined;
async function synthetic(){
 const target='/run/keryx-intake/synthetic.sqlite',db=new DatabaseSync(target),date='2026-11-14T00:00:00.000Z';chmodSync(target,0o600);
 const identity={...syntheticStorageIdentity('mainnet-real'),format:'keryx-mainnet-storage-identity-v1' as const,network:'eip155:5042' as const,profileDigest:STORAGE_MAINNET_PROFILE_DIGEST};
 try{
  db.exec('BEGIN IMMEDIATE');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);
  const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa14',wire=' '+JSON.stringify({id,createdAt:date,question:'Synthetic native materialization',answer:'Original\0answer\ud800',budget:0,engine:'heuristic',totalSpent:0,totalToCreators:0,subClaims:[],decisions:[],citations:[],trace:[],paymentMode:'offline',uninterpreted:{keep:'exact original'}})+'\n';
  db.prepare('INSERT INTO query_runs(id,created_at,question,budget,total_spent,total_to_creators,data) VALUES(?,?,?,0,0,0,?)').run(id,date,'Synthetic native materialization',wire);
  db.prepare('INSERT INTO query_memories(id,source_scores,sources_read,topics,created_at) VALUES(?,?,?,?,?)').run(id,' {"z":{"weight":0.30000000000000004},"a":{"weight":0.1}} ','["synthetic"]','["café","metadata"]',date);
  db.prepare('INSERT INTO source_items(id,source_id,title,content) VALUES(?,?,?,?)').run('synthetic-materialized-orphan','synthetic-missing-source','Historical item','Retained original metadata');
  db.prepare('INSERT INTO cache_items(source_id,text,updated_at) VALUES(?,?,?)').run('synthetic-materialized-cache',sealEnrolledCacheText('Synthetic cold cache; no payment','synthetic-materialized-cache',identity),date);
  const owner='0x'+'a8'.repeat(20),review={policyVersion:'captured-owner-decisions-v1',engine:'heuristic',requestedModel:null,runId:id,round:0,ordinal:0,sourceName:'Synthetic\0source',modelAction:null,codeAction:'SKIP',codeRule:'zero-budget',terms:{assetId:'synthetic-asset',sourceId:'synthetic-source',owned:false,network:'eip155:5042',priceMicroUsdc:'0',citationBudgetMicroUsdc:'0',listPriceMicroUsdc:'0'},reviewFirst:false,cohort:'unknown',cohortEvidence:null};
  db.prepare("INSERT INTO decision_review_records(id,wallet,run_id,network,created_at,input_json,state,code_action,code_rule) VALUES(?,?,?,'eip155:5042',?,?,'observed','SKIP','zero-budget')").run('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa15',owner,id,date,JSON.stringify(review));
  let watch:TopicWatchState|undefined;const now=Date.parse(date);
  const created=await createTopicWatch({store:{async read(){return null;},async compareAndSwap(_key,_revision,next){watch=next;return true;}},now:()=>now,isOwnerCurrent:wallet=>wallet===owner,metadata:{async read(){throw Error('Synthetic metadata only');}}},owner,{watchId:'synthetic-materialized-watch',question:'Synthetic metadata',keywords:['term'],authors:[],venues:[],cadenceMs:60000,periodMs:86400000,maximumChecksPerPeriod:4,maximumRowsPerCheck:32,maximumDigestItems:16,expiresAtMs:now+86400000,requestedCaps:{perCheckMicroUsdc:0,perPeriodMicroUsdc:0},consent:{manualMetadata:true,emptyHeartbeat:false}});assert.equal(created.status,'created');assert(watch);
  db.prepare('INSERT INTO topic_watches(wallet,id,revision,state) VALUES(?,?,?,?)').run(owner,watch.key.watchId,watch.revision,canonicalJson(watch));
  const {order}=syntheticA2aOriginal(740,ARC_MAINNET_PROFILE);
  db.prepare("INSERT INTO a2a_orders(id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,service_fee_usdc,research_mode,package_data,status,transaction_id,request_data,response_data,execution_journal_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'completed',?,?,?,1,?,?)").run(order.id,order.id,order.authorizationId,order.requestHash,order.payer,order.payee,order.amountUsdc,order.creatorBudgetUsdc,order.serviceFeeUsdc,order.researchMode,JSON.stringify(order.researchPackage),order.transaction,JSON.stringify(order.request),JSON.stringify({status:'completed',queryId:order.id,answer:'Synthetic delivery',researchPackage:order.researchPackage}),order.createdAt,order.updatedAt);
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
 const packet=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(buffer.subarray(0,bytes))) as {mode:string;password:string;referenceWire:string;key:string;expectedHash?:string};buffer.fill(0);
 assert(['synthetic','retained'].includes(packet.mode));assert.deepEqual(Object.keys(packet).sort(),(packet.mode==='retained'?['mode','password','referenceWire','key','expectedHash']:['mode','password','referenceWire','key']).sort());assert(/^[a-f0-9]{48}$/.test(packet.password));assert(/^[a-fA-F0-9]{64}$/.test(packet.key));process.env.CONTENT_MASTER_KEY=packet.key;
 stage='snapshot-bootstrap';const target=packet.mode==='synthetic'?await synthetic():'/input/snapshot.sqlite';if(packet.mode==='retained')assert(mounts.some(p=>p[4]===target&&p[5].split(',').includes('ro')));
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
  let partialProjectionRollbackQualified=false;
  if(packet.mode==='synthetic'){
   stage='synthetic-original-binding-rollback';const owner=new Client(postgresPoolConfiguration(options));owner.on('error',()=>{});
   try{
    await owner.connect();const source=db.prepare('SELECT id,input_json FROM decision_review_records LIMIT 1').get();assert(source&&typeof source.id==='string'&&typeof source.input_json==='string');
    try{
     assert.equal((await owner.query("UPDATE public.decision_review_records SET input_json=input_json||' ' WHERE id=$1",[source.id])).rowCount,1);
     await assert.rejects(materializeNativeProjections(db,options),error=>error instanceof NativeMaterializationUnavailable&&error.diagnostic.stage==='projection-copy'&&error.diagnostic.table==='review_projection'&&error.diagnostic.pgCode==='P0001'&&error.diagnostic.commitOutcome==='not_attempted');
     for(const table of ['run_history_projection','run_ownership_projection','run_privacy_projection','usage_projection','public_ledger_projection','review_projection','topic_watch_projection','acceptance_original_projection'])assert.equal((await owner.query('SELECT count(*)::text n FROM keryx_storage.'+table)).rows[0].n,'0');
     partialProjectionRollbackQualified=true;
    }finally{assert.equal((await owner.query('UPDATE public.decision_review_records SET input_json=$1 WHERE id=$2',[source.input_json,source.id])).rowCount,1);assert.equal((await owner.query('SELECT input_json FROM public.decision_review_records WHERE id=$1',[source.id])).rows[0].input_json,source.input_json);}
   }finally{await owner.end();}
  }
  stage='source-projections';const projections=await materializeNativeProjections(db,options);
  if(packet.mode==='synthetic')assert(projections.domains.every(domain=>domain.rows===1));
  stage='existing-projection-refusal';await assert.rejects(materializeNativeProjections(db,options),error=>error instanceof NativeMaterializationUnavailable&&error.diagnostic.stage==='projection-entry'&&error.diagnostic.commitOutcome==='not_attempted');
  stage='source-cache-authentication';const cache=auditCache(db,performance.now()+60000),identity=readStorageIdentity(db);assert(cache.authenticatedRows>0);assert.equal(cache.nullRows,0);
  delete process.env.CONTENT_MASTER_KEY;packet.key='';
  db.exec('ROLLBACK');db.close();db=undefined;checkSnapshotUnchanged(target,descriptor,before.size,before.mtimeNs);
  console.log(JSON.stringify({format:'keryx-native-materialization-development-rehearsal-v1',passed:true,mode:packet.mode,snapshotSha256,sourceBytes:Number(before.size),staging,materialization,projections,cache,sourceIdentityForColdChild:identity,existingTargetReadoptionRefused:true,existingProjectionReadoptionRefused:true,partialProjectionRollbackQualified,limits,sourceUnchanged:true,hardDeadlineSeconds:1800,retainedProductionSnapshotRead:packet.mode==='retained',liveProductionRead:false,productionChanged:false,applicationBackendSwitched:false,paymentActions:0,jobActions:0}));
 }finally{try{db?.close();}finally{closeSync(descriptor);}}
}
void main().catch((error:unknown)=>{
 const rawCode=error&&typeof error==='object'?Reflect.get(error,'code'):null,code=typeof rawCode==='string'&&/^[a-zA-Z0-9_]{1,64}$/.test(rawCode)?rawCode:null;
 console.log(JSON.stringify({format:'keryx-native-materialization-development-rehearsal-v1',passed:false,reason:'native_materialization_unavailable',stage,errorType:error instanceof Error?error.name:'unknown',code,stagingSummary,...(error instanceof NativeMaterializationUnavailable?{diagnostic:error.diagnostic}:{}),productionChanged:false,applicationBackendSwitched:false}));process.exitCode=1;
});
