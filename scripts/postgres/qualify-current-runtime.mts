/** Synthetic current510 actual canonical factory smoke and failure boundaries.
 * No Original, live credentials, custody, signed payment or production changes. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmdirSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';
import {sealEnrolledCacheText} from '../../lib/sources/enrolled-content-cache';
import {validateStorageIdentity,type StorageIdentity} from '../../lib/db/storage-identity';
import {NATIVE_CURRENT_RUNTIME_CANDIDATE_PROFILE} from '../../lib/db/postgres/runtime-profile';
import type {CurrentRuntimeMode} from './native-current-runtime-child.mts';
export async function qualifyCurrentRuntime(input:{postgresContainer:string;password:string;identity:StorageIdentity;digest:string;ownerSql:(sql:string)=>string}){
 const identity=validateStorageIdentity(input.identity);assert.equal(input.digest,NATIVE_CURRENT_RUNTIME_CANDIDATE_PROFILE.catalogSha256);assert.match(input.postgresContainer,/^keryx-postgres-consents-[a-f0-9-]{36}$/);
 const docker=(args:string[],wire?:string)=>execFileSync('docker',args,{input:wire,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:131072,stdio:['pipe','pipe','pipe']}).trim();
 const root=process.platform==='linux'?resolve('.local/tmp/postgres-mainnet-migration-20261111/os-tmp'):tmpdir();mkdirSync(root,{recursive:true});const folder=mkdtempSync(join(root,'keryx-current-runtime-')),bundle=join(folder,'child.cjs');
 const fixture='keryx-postgres-current-'+randomUUID(),containers=new Set<string>(),key=randomBytes(32).toString('hex'),q=(s:string)=>"'"+s.replaceAll("'","''")+"'";
 let image:string|undefined,rowsOwned=false;const pg=(sql:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+sql+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 const previousKey=process.env.CONTENT_MASTER_KEY;let envelope:string;
 try{process.env.CONTENT_MASTER_KEY=key;envelope=sealEnrolledCacheText('Synthetic current-profile encrypted cache','synthetic-current-cache',identity);}finally{if(previousKey===undefined)delete process.env.CONTENT_MASTER_KEY;else process.env.CONTENT_MASTER_KEY=previousKey;}
 const baseline=input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND usename IN('keryx_reader','keryx_app');");
 const reports:unknown[]=[];
 try{
  assert.equal(input.ownerSql("SELECT (SELECT count(*) FROM public.cache_items WHERE source_id IN('synthetic-current-cache','synthetic-current-written-cache'))+(SELECT count(*) FROM public.sync_state WHERE key='synthetic-current-key')+(SELECT count(*) FROM public.web_sessions WHERE hash='"+'e1'.repeat(32)+"')+(SELECT count(*) FROM public.users WHERE wallet_address IN("+['e1','e2','e3'].map(x=>q('0x'+x.repeat(20))).join(',')+"));"),'0','Every exact synthetic namespace must be empty before ownership');rowsOwned=true;
  pg(`INSERT INTO public.cache_items(source_id,text) VALUES('synthetic-current-cache',${q(envelope)});`);
  buildSync({entryPoints:[fileURLToPath(new URL('./native-current-runtime-child.mts',import.meta.url))],outfile:bundle,bundle:true,platform:'node',target:'node24',format:'cjs',external:['pg-native'],logLevel:'silent'});assert(readFileSync(bundle).byteLength<=16777216);
  const base=docker(['image','inspect','node:24.22.1-bookworm-slim','--format','{{.Id}}']);containers.add(fixture);docker(['create','--name',fixture,'--network','none','--label','keryx.current-runtime-fixture='+fixture,base,'node','--version']);docker(['cp',bundle,fixture+':/child.cjs']);image=docker(['commit','--change','LABEL keryx.current-runtime-fixture='+fixture,fixture]);assert.match(image,/^sha256:[a-f0-9]{64}$/);docker(['rm',fixture]);containers.delete(fixture);
  for(const mode of ['success','readonly','wrong-identity','wrong-source','wrong-key','credential-change','committed-context-loss','held-target'] as CurrentRuntimeMode[]){
   const name='keryx-postgres-current-'+randomUUID();containers.add(name);const started=performance.now();process.stderr.write(JSON.stringify({fixtureMode:mode,event:'started'})+'\n');
   try{
    if(mode==='held-target')input.ownerSql("UPDATE keryx_storage.control SET mode='held';");
    const wire=JSON.stringify({mode,identity,digest:input.digest,password:input.password,key});assert(Buffer.byteLength(wire)<=8192);
    let output:string;
    try{output=docker(['run','-i','--rm','--name',name,'--user','0:0','--read-only','--memory','512m','--memory-swap','512m','--cpus','1','--pids-limit','64','--cap-drop','ALL','--security-opt','no-new-privileges','--network','container:'+input.postgresContainer,'--tmpfs','/run/keryx-runtime:rw,nosuid,noexec,mode=0700,size=16m','-e','KERYX_NETWORK=arc','-e','NEXT_PUBLIC_KERYX_NETWORK=arc','-e','KERYX_FORCE_OFFLINE=0','-e','BASE_URL=https://keryx.cc','-e','KERYX_REGISTRY_ADDRESS=0x5555555555555555555555555555555555555555','-e','NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS=0x5555555555555555555555555555555555555555',image,'node','--max-old-space-size=256','/child.cjs'],wire);}catch(error){const stdout=error&&typeof error==='object'?Reflect.get(error,'stdout'):undefined;if(typeof stdout==='string')process.stderr.write(stdout);throw Error('Synthetic current child failed: '+mode);}
    const report=JSON.parse(output);assert.equal(report.passed,true);assert.equal(report.genuineFactory,true);assert.equal(report.outbound,0);reports.push(report);process.stderr.write(JSON.stringify({fixtureMode:mode,event:'passed',checks:report.checks,elapsedMs:Math.round(performance.now()-started)})+'\n');
   }finally{if(docker(['ps','-aq','--filter','name=^/'+name+'$']))docker(['rm','-f',name]);containers.delete(name);if(mode==='held-target')input.ownerSql("UPDATE keryx_storage.control SET mode='active';");}
   assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND usename IN('keryx_reader','keryx_app');"),baseline,'Every actual factory must drain');
  }
  assert.equal(input.ownerSql(`SELECT count(*) FROM public.users WHERE wallet_address=${q('0x'+'e3'.repeat(20))};`),'1','Unknown result retained its real committed write');
  return {passed:true,reports,sourceProfile:'current510',genuineCanonicalFactorySmoke:true,completeApplicationQualification:false,realCommittedContextLossQualified:true,productionChanged:false,applicationBackendSwitched:false};
 }finally{
  for(const name of containers)try{docker(['rm','-f',name]);}catch{}
  if(image){assert.equal(docker(['image','inspect',image,'--format','{{index .Config.Labels "keryx.current-runtime-fixture"}}']),fixture);docker(['image','rm',image]);}
  if(rowsOwned)pg("DELETE FROM public.cache_items WHERE source_id IN('synthetic-current-cache','synthetic-current-written-cache');DELETE FROM public.sync_state WHERE key='synthetic-current-key';DELETE FROM public.web_sessions WHERE hash='"+'e1'.repeat(32)+"';DELETE FROM public.users WHERE wallet_address IN("+['e1','e2','e3'].map(x=>q('0x'+x.repeat(20))).join(',')+");");
  if(existsSync(bundle))unlinkSync(bundle);rmdirSync(folder);
 }
}
