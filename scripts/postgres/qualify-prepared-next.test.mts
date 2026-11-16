import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,join,resolve,sep} from 'node:path';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {STORAGE_MAINNET_PROFILE_DIGEST} from '../../lib/db/storage-identity';
import {NATIVE_CURRENT_RUNTIME_CANDIDATE_PROFILE} from '../../lib/db/postgres/runtime-profile';
import {PREPARED_NEXT_PUBLIC_KEYS} from './prepared-next-child.mts';
import {PREPARED_NEXT_NODE_IMAGE,PREPARED_NEXT_POSTGRES_IMAGE,preparedNextRecords,qualifyPreparedNext} from './qualify-prepared-next.mts';

const mocks=vi.hoisted(()=>({exec:vi.fn(),spawn:vi.fn(),build:vi.fn()}));
vi.mock('node:child_process',()=>({execFileSync:mocks.exec,spawn:mocks.spawn}));
vi.mock('esbuild',()=>({buildSync:mocks.build}));

const runtime='sha256:'+'a'.repeat(64),derived='sha256:'+'b'.repeat(64),pgImage='sha256:'+'c'.repeat(64);
const pgName='keryx-postgres-consents-11111111-1111-4111-8111-111111111111',password='d'.repeat(48),port=12345;
const label='keryx.prepared-next-owner';
let directory:string;
beforeEach(()=>{vi.clearAllMocks();directory=mkdtempSync(join(tmpdir(),'keryx-parent-retention-'));});
afterEach(()=>{const target=resolve(directory),parent=resolve(tmpdir());if(!target.startsWith(parent+sep)||!basename(target).startsWith('keryx-parent-retention-'))throw Error('Fixture cleanup boundary');rmSync(target,{recursive:true,force:true});});

/** Model Docker's documented default: removing an untagged child also prunes its
 * untagged parent unless --no-prune is supplied. This is a lifecycle regression,
 * not a recording test pretending to qualify a real native factory. */
function dockerFixture(ownerChangesAfterEnumeration=false){
 let owner='',runtimePresent=true,derivedPresent=false;
 const removals:string[]=[],containers=new Map<string,any>();
 const postgres={Id:'pg-container-id',Name:'/'+pgName,Image:pgImage,State:{Running:true,Paused:false,OOMKilled:false},Config:{User:'postgres',Env:['POSTGRES_PASSWORD='+password]},HostConfig:{NetworkMode:'bridge'},Mounts:[{Type:'tmpfs'}],NetworkSettings:{Networks:{bridge:{}},Ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:String(port)}]}}};
 mocks.build.mockImplementation((options:{outfile:string})=>writeFileSync(options.outfile,'synthetic child only'));
 mocks.exec.mockImplementation((command:string,args:string[])=>{
  if(command==='git')return join(directory,'.git');
  if(command!=='docker')throw Error('Unexpected command');
  if(args[0]==='image'&&args[1]==='inspect'){
   if(args[2]===PREPARED_NEXT_POSTGRES_IMAGE)return pgImage;
   if(args[2]===PREPARED_NEXT_NODE_IMAGE)return JSON.stringify([{RootFS:{Layers:['node-base']}}]);
   if(args[2]===runtime){if(!runtimePresent)throw Error('Prepared parent was pruned');return JSON.stringify([{Id:runtime,Config:{Env:[]},RootFS:{Layers:['node-base','prepared-runtime']}}]);}
   if(args[2]===derived)return ownerChangesAfterEnumeration?'another-owner':owner;
  }
  if(args[0]==='image'&&args[1]==='ls')return derivedPresent?derived:'';
  if(args[0]==='image'&&args[1]==='rm'){
   const id=args.at(-1)!;if(id!==derived)throw Error('Unowned image removal');removals.push(id);derivedPresent=false;
   if(!args.includes('--no-prune'))runtimePresent=false;
   return '';
  }
  if(args[0]==='inspect'){
   if(args[1]===pgName)return JSON.stringify([postgres]);
   const container=containers.get(args[1]);if(!container)throw Error('Unknown container');return JSON.stringify([container]);
  }
  if(args[0]==='create'){
   const name=args[args.indexOf('--name')+1],value=args[args.indexOf('--label')+1];owner=value.slice(value.indexOf('=')+1);
   containers.set(name,{Id:name,Name:'/'+name,Image:derived,Config:{User:'0:0',Labels:{[label]:owner}},HostConfig:{Memory:536870912,MemorySwap:536870912,NanoCpus:1000000000,PidsLimit:64,ReadonlyRootfs:true,NetworkMode:'container:'+pgName,CapDrop:['ALL'],SecurityOpt:['no-new-privileges']},Mounts:[],State:{Running:false,OOMKilled:false,ExitCode:1}});return name;
  }
  if(args[0]==='commit'){derivedPresent=true;return derived;}
  if(args[0]==='cp')return '';
  if(args[0]==='rm'){containers.delete(args[1]);return '';}
  if(args[0]==='ps')return '';
  if(args[0]==='network'&&args[1]==='disconnect'){postgres.NetworkSettings.Networks={} as typeof postgres.NetworkSettings.Networks;return '';}
  if(args[0]==='exec')return '0';
  throw Error('Unexpected Docker operation '+args.slice(0,2).join(' '));
 });
 mocks.spawn.mockImplementation(()=>{
  const child=new EventEmitter() as EventEmitter&{stdout:EventEmitter;stderr:EventEmitter;stdin:EventEmitter&{end:(wire:string)=>void};kill:()=>void};
  child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
  child.stdin=Object.assign(new EventEmitter(),{end:()=>queueMicrotask(()=>{child.stdout.emit('data',Buffer.from(JSON.stringify({started:true,mode:'verify',limitsVerified:true,namespaceVerified:true})+'\n'+JSON.stringify({passed:false,refusal:'prepared_next_refused'})+'\n'));child.emit('close',1);})});return child;
 });
 return{runtimePresent:()=>runtimePresent,derivedPresent:()=>derivedPresent,removals,containerCount:()=>containers.size};
}

function input(){return{preparedImage:runtime,candidate:'/work/releases/'+'e'.repeat(40),sourceManifestSha256:'1'.repeat(64),artifactInspectionSha256:'2'.repeat(64),preparationSha256:'3'.repeat(64),publicBuildControls:Object.fromEntries(PREPARED_NEXT_PUBLIC_KEYS.map(key=>[key,'public fixture'])),options:{endpoint:{kind:'loopback' as const,port},database:'native_target',role:'keryx_app' as const,password},identity:{format:'keryx-mainnet-storage-identity-v1' as const,deploymentId:'11111111-1111-4111-8111-111111111111',storageId:'22222222-2222-4222-8222-222222222222',network:'eip155:5042' as const,authorityMode:'mainnet-real' as const,profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,enrollmentId:'33333333-3333-4333-8333-333333333333',enrolledAt:'2026-11-16T00:00:00.000Z',provenanceDigest:'4'.repeat(64)},digest:NATIVE_CURRENT_RUNTIME_CANDIDATE_PROFILE.catalogSha256,postgresContainer:pgName};}

it('removes its derived helper after a failed child while retaining the untagged prepared runtime parent',async()=>{
 const fixture=dockerFixture();await expect(qualifyPreparedNext(input())).rejects.toThrow();
 expect(fixture.removals).toEqual([derived]);expect(fixture.derivedPresent()).toBe(false);expect(fixture.runtimePresent()).toBe(true);expect(fixture.containerCount()).toBe(0);
});

it('refuses image removal when ownership changes after enumeration and still preserves the caller runtime',async()=>{
 const fixture=dockerFixture(true);await expect(qualifyPreparedNext(input())).rejects.toThrow('owned cleanup refused');
 expect(fixture.removals).toEqual([]);expect(fixture.derivedPresent()).toBe(true);expect(fixture.runtimePresent()).toBe(true);expect(fixture.containerCount()).toBe(0);
});

it('accepts only finite instrumentation report metadata, never error/body strings',()=>{
 expect(preparedNextRecords(JSON.stringify({mode:'wrong-identity',refusalAt:'instrumentation',pinnedStartupRefusal:true})+'\n')).toEqual([{mode:'wrong-identity',refusalAt:'instrumentation',pinnedStartupRefusal:true}]);
 for(const report of [{refusalAt:'unknown'},{pinnedStartupRefusal:'true'},{error:'private data'},{body:'private data'}])expect(()=>preparedNextRecords(JSON.stringify(report)+'\n')).toThrow();
});
