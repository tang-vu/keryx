/** A real compiled Linux process, native permissions and selected read facade.
 * Same bounded PostgreSQL fixture; never a caller-injected facade or guard. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { mkdirSync,mkdtempSync,readFileSync,realpathSync,rmdirSync,unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { sealEnrolledCacheText } from '../../lib/sources/enrolled-content-cache';
import type { StorageIdentity } from '../../lib/db/storage-identity';
import { heldHistoryProjectionSql } from './run-history-projection.mts';
import { heldOwnershipHistoryProjectionSql,sqliteOwnershipHistoryProjection } from './ownership-history-projection.mts';
import { DatabaseSync } from 'node:sqlite';
import { heldPrivacyProjectionSql,sqlitePrivacyProjection } from './privacy-projection.mts';
import { createTopicWatch,type TopicWatchState } from '../../lib/research/topic-watches';
import { topicWatchProjection } from '../../lib/db/postgres/watch-packet';
import { heldWatchProjectionSql } from './watch-projection.mts';
import { canonicalJson } from '../../lib/canonical-json';
export async function qualifyNativeRuntime(input:{postgresContainer:string;password:string;identity:StorageIdentity;digest:string;ownerSql:(sql:string)=>string}){
 assert.match(input.postgresContainer,/^keryx-postgres-consents-[a-f0-9-]{36}$/);
 const docker=(args:string[],wire?:string)=>execFileSync('docker',args,{input:wire,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:131072,stdio:['pipe','pipe','pipe']}).trim();
 // Keep the single compiled artifact in task-owned temporary storage. Windows
 // already has the task TEMP; Linux CI uses its canonical checkout's .local.
 const fixtureRoot=process.platform==='linux'?resolve('.local/tmp/postgres-mainnet-migration-20261111/os-tmp'):tmpdir();
 mkdirSync(fixtureRoot,{recursive:true});
 const folder=mkdtempSync(join(fixtureRoot,'keryx-native-runtime-')),bundle=join(folder,'child.cjs'),key=randomBytes(32).toString('hex'),owner='0x'+'a8'.repeat(20),cacheId='synthetic-runtime-cache';
 const q=(s:string)=>"'"+s.replaceAll("'","''")+"'",pg=(s:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+s+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 const image=docker(['image','inspect','node:24.22.1-bookworm-slim','--format','{{.Id}}']),containers=new Set<string>();let vectors=0;
 const staging='keryx-postgres-runtime-'+randomUUID();let candidateImage:string|undefined;
 const seal=(id:string,identity:StorageIdentity)=>{const previous=process.env.CONTENT_MASTER_KEY;try{process.env.CONTENT_MASTER_KEY=key;return sealEnrolledCacheText('Synthetic cached text; no payment',id,identity);}finally{if(previous===undefined)delete process.env.CONTENT_MASTER_KEY;else process.env.CONTENT_MASTER_KEY=previous;}};
 const envelope=seal(cacheId,input.identity);
 const now=Date.now(),session={hash:'ab'.repeat(32),wallet:owner,issuedAt:now-1000,expiresAt:now+86400000},bibliographyId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',bibliographyToken='a9'.repeat(32);
 let watch:TopicWatchState|undefined;
 const created=await createTopicWatch({store:{async read(){return null;},async compareAndSwap(_key,_revision,next){watch=next;return true;}},now:()=>now,isOwnerCurrent:wallet=>wallet===owner,metadata:{async read(){throw new Error('Synthetic native factory does not run metadata checks');}}},owner,{watchId:'synthetic-runtime-watch',question:'Synthetic metadata',keywords:['term'],authors:[],venues:[],cadenceMs:60000,periodMs:86400000,maximumChecksPerPeriod:4,maximumRowsPerCheck:32,maximumDigestItems:16,expiresAtMs:now+86400000,requestedCaps:{perCheckMicroUsdc:0,perPeriodMicroUsdc:0},consent:{manualMetadata:true,emptyHeartbeat:false}});
 assert.equal(created.status,'created');assert(watch);const watchWire=canonicalJson(watch);
 const run=(mode:string)=>{
  const name='keryx-postgres-runtime-'+randomUUID();containers.add(name);
  try{
   const result=JSON.parse(docker(['run','-i','--rm','--name',name,'--user','0:0','--read-only','--memory','512m','--memory-swap','512m','--cpus','1','--pids-limit','64','--cap-drop','ALL','--security-opt','no-new-privileges',
    '--network','container:'+input.postgresContainer,'--tmpfs','/run/keryx-runtime:rw,nosuid,noexec,mode=0700,size=16m',
    '-e','KERYX_NETWORK=arc','-e','NEXT_PUBLIC_KERYX_NETWORK=arc','-e','KERYX_FORCE_OFFLINE=0','-e','BASE_URL=https://keryx.cc',
    '-e','KERYX_REGISTRY_ADDRESS=0x5555555555555555555555555555555555555555','-e','NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS=0x5555555555555555555555555555555555555555',
    candidateImage!,'node','--max-old-space-size=256','/child.cjs'],JSON.stringify({mode,identity:input.identity,digest:input.digest,password:input.password,key,owner,session})));
   assert.equal(result.passed,true);assert.equal(result.outbound,0);assert.equal(result.selectedApplicationWriter,false);vectors+=result.checks;return result;
  }finally{
   const remaining=docker(['ps','-aq','--filter',`name=^/${name}$`]);if(remaining)docker(['rm','-f',name]);assert.equal(docker(['ps','-aq','--filter',`name=^/${name}$`]),'');containers.delete(name);
  }
 };
 try{
  // Transfer through the daemon archive API instead of assuming host bind paths
  // share the runner namespace. Bundle JS dependencies; optional native PG is
  // deliberately unavailable (this profile uses the qualified pure JS driver).
  buildSync({entryPoints:[fileURLToPath(new URL('./native-runtime-child.mts',import.meta.url))],outfile:bundle,bundle:true,platform:'node',target:'node24',format:'cjs',external:['pg-native'],logLevel:'silent'});
  assert(readFileSync(bundle).byteLength>0&&readFileSync(bundle).byteLength<=16777216,'Compiled native child byte bound');
  containers.add(staging);
  docker(['create','--name',staging,'--network','none','--label','keryx.native-runtime-fixture='+staging,image,'node','--version']);
  docker(['cp',bundle,staging+':/child.cjs']);
  candidateImage=docker(['commit','--change','LABEL keryx.native-runtime-fixture='+staging,staging]);
  assert.match(candidateImage,/^sha256:[a-f0-9]{64}$/);
  docker(['rm',staging]);containers.delete(staging);
  const original=JSON.stringify({id:'synthetic-runtime-run',createdAt:'2026-01-02T03:04:05.000Z',question:'Original',answer:'Original answer',budget:0,engine:'heuristic',subClaims:[],decisions:[],citations:[],trace:[],asker:owner,totalSpent:0,totalToCreators:0,paymentMode:'offline',uninterpreted:'\0\ud800'});
  const oracle=new DatabaseSync(':memory:');let ownershipProjection:string,privacyProjection:string;
  try{oracle.exec('CREATE TABLE query_runs(id TEXT,created_at TEXT,asker TEXT,data TEXT)');oracle.prepare('INSERT INTO query_runs VALUES(?,?,?,?)').run('synthetic-runtime-run','2026-01-02T03:04:05.000Z',owner,original);ownershipProjection=heldOwnershipHistoryProjectionSql('synthetic-runtime-run',sqliteOwnershipHistoryProjection(oracle,'synthetic-runtime-run'));privacyProjection=heldPrivacyProjectionSql('synthetic-runtime-run',sqlitePrivacyProjection(oracle,'synthetic-runtime-run'));}finally{oracle.close();}
  pg(`INSERT INTO public.query_runs(id,created_at,question,budget,data,asker,engine,total_spent,total_to_creators,answer) VALUES('synthetic-runtime-run','2026-01-02T03:04:05.000Z','Original',0,${q(original)}::json,${q(owner)},'heuristic',0,0,'Original answer');INSERT INTO public.run_privacy(run_id,visibility,updated_at) VALUES('synthetic-runtime-run','public','2026-01-02T03:04:05.000Z');`+
   heldHistoryProjectionSql('synthetic-runtime-run',{sha256:createHash('sha256').update(original).digest('hex'),recordedOwner:owner,ownerInvalid:false,funded:false,provenance:null})+ownershipProjection+privacyProjection+`INSERT INTO public.cache_items(source_id,text) VALUES(${q(cacheId)},${q(envelope)});
   INSERT INTO public.private_bibliographies(id,wallet,token_hash,title,content,reference_count,revision,created_at,updated_at) VALUES(${q(bibliographyId)},${q(owner)},${q(createHash('sha256').update('keryx-private-bib-v1:'+bibliographyToken).digest('hex'))},'Synthetic bibliography','Synthetic bibliography content',0,1,'2026-01-02T03:04:05.000Z','2026-01-02T03:04:05.000Z');
   INSERT INTO public.web_sessions(hash,wallet,issued_at,expires_at) VALUES(${q(session.hash)},${q(owner)},${session.issuedAt},${session.expiresAt});
   INSERT INTO public.topic_watches(wallet,id,revision,state) VALUES(${q(owner)},'synthetic-runtime-watch',1,${q(watchWire)});`+heldWatchProjectionSql(topicWatchProjection(watchWire)));
  const baseline=input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),success=run('success');
  assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),baseline);
  for(const mode of ['wrong-identity','wrong-source','wrong-key','missing-key','wrong-credential-role']){run(mode);assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),baseline);}
  const beforeCrypto=run('held-before-cache-crypto');assert.equal(beforeCrypto.asyncAuthorityBeforeCacheCrypto,true);assert(beforeCrypto.positiveControlDecryptionCalls>0);assert.equal(beforeCrypto.decipherCalls,0);assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),baseline);
  pg(`UPDATE public.cache_items SET text=${q(seal(cacheId,{...input.identity,storageId:randomUUID()}))} WHERE source_id=${q(cacheId)};`);run('foreign-cache-identity');
  pg(`UPDATE public.cache_items SET text=${q(seal(cacheId+'-foreign',input.identity))} WHERE source_id=${q(cacheId)};`);run('foreign-cache-source');
  pg(`UPDATE public.cache_items SET text='unbound legacy plaintext' WHERE source_id=${q(cacheId)};`);run('plaintext-cache');
  pg(`UPDATE public.cache_items SET text=repeat('x',2097153) WHERE source_id=${q(cacheId)};`);run('oversized-cache');
  pg(`UPDATE public.cache_items SET text=${q(envelope)} WHERE source_id=${q(cacheId)};`);run('success');assert.equal(input.ownerSql("SELECT count(*) FROM pg_stat_activity WHERE usename='keryx_reader';"),baseline);
  return {vectors,image,compiledDependenciesInOwnedImage:true,genuineLinuxCompiledFactory:true,actualPrivateFilePermissions:true,sourceAndIdentityPinned:true,cacheCiphertextAuthenticated:true,cacheSourceAndIdentityBound:true,asyncAuthorityBeforeCacheCrypto:true,actualCommittedColdReadThenAuthorityHold:true,heldBeforeCrypto:beforeCrypto,missingAndWrongKeysRefused:true,plaintextAndOversizedCacheRefused:true,validColdFactoryRestored:true,actualReaderConnectionsDrained:true,noFallback:true,observation:success,selectedApplicationWriter:false,productionData:false,paidOperations:0};
 }finally{
  for(const name of containers){try{docker(['rm','-f',name]);}catch{}}
  if(candidateImage){assert.equal(docker(['image','inspect',candidateImage,'--format','{{index .Config.Labels "keryx.native-runtime-fixture"}}']),staging);docker(['image','rm',candidateImage]);assert.equal(docker(['image','ls','-q','--filter','label=keryx.native-runtime-fixture='+staging]),'');}
  pg(`DELETE FROM public.cache_items WHERE source_id=${q(cacheId)};DELETE FROM public.query_runs WHERE id='synthetic-runtime-run';DELETE FROM keryx_storage.topic_watch_projection WHERE wallet=${q(owner)} AND id='synthetic-runtime-watch';DELETE FROM public.topic_watches WHERE wallet=${q(owner)} AND id='synthetic-runtime-watch';DELETE FROM public.private_bibliographies WHERE id=${q(bibliographyId)};DELETE FROM public.web_sessions WHERE hash=${q(session.hash)};`);
  // Only this fixture's one generated bundle, then its empty unique directory.
  assert.equal(realpathSync(folder).toLowerCase(),resolve(folder).toLowerCase());assert.equal(dirname(folder).toLowerCase(),resolve(fixtureRoot).toLowerCase());
  try{unlinkSync(bundle);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}rmdirSync(folder);
 }
}
