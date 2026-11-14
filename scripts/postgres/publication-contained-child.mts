/** Compiled Linux-only publication oracle; fixed stdin protocol, no factory. */
import {readFileSync,readSync} from 'node:fs';
import {networkInterfaces} from 'node:os';
import {Worker} from 'node:worker_threads';
import {Client} from 'pg';
import {PUBLICATION_SHARED_BYTES,PUBLICATION_HEADER_BYTES,PUBLICATION_INPUT_BYTES,PUBLICATION_REPORT_BYTES,PUBLICATION_STATE,parsePublicationChildInput,assertPublicationLimits,assertPublicationNamespace,validatePublicationObservation,publicationRefused,type PublicationLimits} from './publication-owner-sql-worker.mts';

let reportBytes=0;
function report(value:unknown){const wire=JSON.stringify(value);reportBytes+=Buffer.byteLength(wire)+1;if(reportBytes>PUBLICATION_REPORT_BYTES)publicationRefused();process.stdout.write(wire+'\n');}
async function main(){
 const buffer=Buffer.alloc(PUBLICATION_INPUT_BYTES+1);let length=0;while(length<buffer.length){const n=readSync(0,buffer,length,buffer.length-length,null);if(!n)break;length+=n;}if(length>PUBLICATION_INPUT_BYTES)publicationRefused();
 const input=parsePublicationChildInput(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,length))));
 if(process.platform!=='linux'||process.version!=='v24.22.1'||process.getuid?.()!==0||!process.execArgv.includes('--max-old-space-size=256'))publicationRefused();
 const limits:PublicationLimits={memoryMax:readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),swapMax:readFileSync('/sys/fs/cgroup/memory.swap.max','utf8').trim(),cpuMax:readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim(),pidsMax:readFileSync('/sys/fs/cgroup/pids.max','utf8').trim()};
 try{assertPublicationLimits(limits);}catch{report({passed:false,refusal:'limits_refused',observedMemoryBytes:Number(limits.memoryMax)});process.exitCode=2;return;}
 const status=readFileSync('/proc/self/status','utf8');if(!/^CapEff:\s+0+$/m.test(status)||!/^NoNewPrivs:\s+1$/m.test(status))publicationRefused();
 let ipv6='';try{ipv6=readFileSync('/proc/net/ipv6_route','utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 assertPublicationNamespace(Object.keys(networkInterfaces()).sort(),readFileSync('/proc/net/route','utf8'),ipv6);
 report({started:true,mode:input.mode,limitsVerified:true,namespaceVerified:true});
 if(input.mode==='limits')publicationRefused();
 if(input.mode==='oom'){const retained:Buffer[]=[];for(;;)retained.push(Buffer.alloc(16*1024*1024,0x73));}
 if(input.mode==='hang'){await new Promise<void>(()=>{setInterval(()=>{},1000);});publicationRefused();}
 // No negative control imports the application qualifier or obtains SQL ports.
 process.env.KERYX_NETWORK='arcTestnet';process.env.NEXT_PUBLIC_KERYX_NETWORK='arcTestnet';process.env.KERYX_FORCE_OFFLINE='1';
 globalThis.fetch=async()=>{throw Error('Contained publication external request refused');};
 const shared=new SharedArrayBuffer(PUBLICATION_SHARED_BYTES),header=new Int32Array(shared,0,PUBLICATION_HEADER_BYTES/4);
 const worker=new Worker('/publication-owner-worker.cjs',{workerData:{shared,input},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16,stackSizeMb:4}});
 worker.on('error',()=>{Atomics.store(header,1,0);Atomics.store(header,0,PUBLICATION_STATE.failed);Atomics.notify(header,0);});
 const wait=(state:number)=>{const deadline=performance.now()+10000;while(Atomics.load(header,0)===state){const remaining=deadline-performance.now();if(remaining<=0||Atomics.wait(header,0,state,remaining)==='timed-out')throw Error('Publication owner SQL deadline');}return Atomics.load(header,0);};
 const text=()=>{const length=Atomics.load(header,1);if(length<0||length>PUBLICATION_SHARED_BYTES-PUBLICATION_HEADER_BYTES)publicationRefused();return new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(shared,PUBLICATION_HEADER_BYTES,length));};
 const failure=()=>{let code='XXXXX',semantic=false;try{const value=JSON.parse(text());if(/^[A-Z0-9]{5}$/.test(value.code))code=value.code;semantic=value.semantic==='claim_unavailable';}catch{}return Error(semantic?'claim_unavailable':'Publication owner SQL unavailable ('+code+')');};
 const ownerSql=(sql:string):string=>{
  if(Atomics.load(header,0)!==PUBLICATION_STATE.ready||typeof sql!=='string'||!sql||Buffer.byteLength(sql)>PUBLICATION_SHARED_BYTES-PUBLICATION_HEADER_BYTES||sql.includes('\0'))publicationRefused();
  Atomics.store(header,1,0);Atomics.store(header,0,PUBLICATION_STATE.busy);worker.postMessage({sql});const state=wait(PUBLICATION_STATE.busy),result=text();
  if(state!==PUBLICATION_STATE.done){const error=failure();Atomics.store(header,0,PUBLICATION_STATE.ready);throw error;}Atomics.store(header,0,PUBLICATION_STATE.ready);return result;
 };
 let contention:Client|undefined;
 try{
  if(worker.resourceLimits.maxOldGenerationSizeMb!==128)publicationRefused();
  if(wait(PUBLICATION_STATE.initial)!==PUBLICATION_STATE.ready)throw failure();
  contention=new Client({host:'127.0.0.1',port:5432,database:'native_target',user:'keryx_app',password:input.password,ssl:false,connectionTimeoutMillis:1000,query_timeout:6000,options:'-c statement_timeout=5000 -c lock_timeout=1000 -c timezone=UTC',application_name:'keryx-contained-publication-contention'});
  contention.on('error',()=>{});await contention.connect();
  // Literal import is resolved by the parent's coherent esbuild bundle. This
  // owned worktree intentionally does not copy a peer's qualifier source.
  const {qualifyPublication}=await import('./qualify-publication.mts');
  // The shared validator also reconstructs the one approved factory-blocker
  // literal; no arbitrary Source strings/arrays can enter the child report.
  const publication=validatePublicationObservation(await qualifyPublication({options:{endpoint:{kind:'loopback',port:5432},database:'native_target',role:'keryx_app',password:input.password},identity:input.identity,digest:input.digest,contentionClient:contention,ownerSql}));
  report({passed:true,mode:'qualify',limitsVerified:true,namespaceVerified:true,ownerWorker128:true,sqlAsserted:true,publication});
 }finally{await contention?.end().catch(()=>{});await worker.terminate();}
}
if(process.argv[1]==='/publication-child.cjs')void main().catch(()=>{report({passed:false,refusal:'publication_refused'});process.exitCode=1;});
