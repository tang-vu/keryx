/** Dependency recordings only; no installed native provenance is manufactured. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
const r=vi.hoisted(()=>({files:new Map<string,Buffer>(),fds:new Map<number,string>(),next:20,closed:0,steps:[] as string[],expired:false,base:'https://keryx.cc',backend:'postgres',privateActive:false,identityFailure:false,promiseLocal:false,keyChanged:false,readyFailures:0,readyCalls:0,factoryCalls:0,identityCalls:0,accountingCalls:0,closeCalls:0,pm2Calls:[] as string[][],
 factoryGate:undefined as Promise<void>|undefined,identityGate:undefined as Promise<void>|undefined,accountingGate:undefined as Promise<void>|undefined,closeGate:undefined as Promise<void>|undefined,rows:[] as unknown[],identity:{} as Record<string,unknown>,roles:{} as any,artifact:{} as any,review:{} as any,env:{} as Record<string,string>,identityDigest:'',signer:'0x'+'ab'.repeat(20)}));
const commit='c'.repeat(40),rolesFile='/root/.local/share/native-release/roles.json',envFile='/root/keryx/.env.local';
vi.mock('node:path',async original=>{const real=await original<typeof import('node:path')>();return {...real,...real.posix,default:real.posix};});
vi.mock('node:url',async original=>({...await original<typeof import('node:url')>(),fileURLToPath:()=>'/root/.local/share/keryx-releases/'+'c'.repeat(40)+'/source/scripts/postgres/server1-native-bootstrap.mts'}));
vi.mock('node:crypto',async original=>{
 const real=await original<typeof import('node:crypto')>();return {...real,createHash:(algorithm:string)=>{const data:Buffer[]=[];return {update(v:string|Buffer){data.push(Buffer.from(v));return this;},digest(encoding:'hex'){const bytes=Buffer.concat(data);if(bytes.toString().startsWith('{"format":"keryx-single-writer-host-transfer-v1"'))return 'e9212277066c6774ea5959914823ce59125892ed1da9706725a50597e56ddb68';if(bytes.toString()==='recorded-machine\n')return 'a9baadf374fdfbacaa7ac7d7562109b32111821b583170a94d423de4ef4e65eb';return real.createHash(algorithm).update(bytes).digest(encoding);}};}};
});
vi.mock('node:fs',async original=>{
 const real=await original<typeof import('node:fs')>();
 const path=(value:number|string)=>typeof value==='number'?r.fds.get(value)!:value;
 const stat=(p:string,big=false)=>{const file=r.files.has(p),socket=p==='/run/postgresql-keryx/.s.PGSQL.5432',pg=p.startsWith('/run/postgresql-keryx')||p==='/proc/42',mode=file?0o100600:socket?0o140770:p==='/run/postgresql-keryx'?0o40750:0o40700;const value={dev:1,ino:p.length+100,uid:pg?123:0,gid:0,mode,nlink:1,size:r.files.get(p)?.length??0,mtimeNs:1,ctimeNs:1};return {...Object.fromEntries(Object.entries(value).map(([k,v])=>[k,big?BigInt(v):v])),isFile:()=>file,isDirectory:()=>!file&&!socket,isSocket:()=>socket,isSymbolicLink:()=>false};};
 return {...real,lstatSync:(p:string,o?:{bigint?:boolean})=>stat(p,o?.bigint),realpathSync:(p:string)=>p,
  openSync:(p:string)=>{const fd=r.next++;r.fds.set(fd,p);return fd;},fstatSync:(fd:number,o?:{bigint?:boolean})=>stat(path(fd),o?.bigint),closeSync:(fd:number)=>{r.closed++;r.fds.delete(fd);},
  readSync:(fd:number,buffer:Buffer,offset:number,length:number,position:number)=>{const bytes=r.files.get(path(fd))!.subarray(position,position+length);bytes.copy(buffer,offset);return bytes.length;},
  readFileSync:(p:number|string,encoding?:string)=>{if(path(p)==='/root/.pm2/pm2.pid')return '42';const value=r.files.get(path(p));if(!value)throw Error('Unreviewed file');return encoding?value.toString():value;}};
});
vi.mock('node:child_process',()=>({execFileSync:(_bin:string,args:string[])=>{
 if(_bin.endsWith('/pg_isready')){r.readyCalls++;if(r.readyFailures-->0)throw {status:1};return '';}
 if(args.includes('keryx-private-worker.service'))return `ActiveState=${r.privateActive?'active':'inactive'}\nUnitFileState=disabled\n`;
 if(args.includes('postgresql@17-keryx.service'))return 'ActiveState=active\nMainPID=42\nUser=postgres\nGroup=root\n';
 r.pm2Calls.push([...args]);if(args[0]==='jlist')return JSON.stringify(r.rows);if(args[0]==='start'){r.rows=r.roles.apps.map((a:any,i:number)=>({name:a.name,pid:100+i,pm2_env:{status:'online',pm_exec_path:a.script,pm_cwd:a.cwd,exec_interpreter:a.interpreter,args:a.args,autorestart:a.autorestart,kill_timeout:a.kill_timeout}}));}return '';
}}));
vi.mock('viem/accounts',()=>({privateKeyToAddress:()=>r.signer}));
vi.mock('../../lib/config',()=>({config:{get profile(){return {name:'arc'};},get baseUrl(){return r.base;},networkId:'eip155:5042'}}));
vi.mock('../../lib/research/research-allowance',()=>({configuredResearchAllowance:()=>null}));
vi.mock('../../lib/payments/hosted-treasury-policy',()=>({configuredHostedTreasuryPolicy:(_identity:unknown,origin:string,role:string)=>{expect(origin).toBe('https://keryx.cc');expect(role).toBe('public');if(r.expired)throw Error('expired');return {signer:r.signer,lifetimeCapMicroUsdc:'100000',expiresAtSeconds:1900000000};},hostedTreasuryPolicyDigest:()=> 'c70be6ac6ca452b15ef1a8caac96654aa181a025ed0638b8e138569c7b62f422'}));
vi.mock('../../lib/db/runtime-storage-config',()=>({readRuntimeStorageDeployment:()=>({identity:r.identity,backend:{kind:r.backend,database:'keryx_mainnet'}})}));
vi.mock('../../lib/db/application-storage',()=>({
 createReadonlyApplicationStorage:async()=>{r.steps.push('factory');r.factoryCalls++;await r.factoryGate;return Object.defineProperty({},'hostedTreasuryAccounting',{get(){r.steps.push('accounting-getter');return async(_signer:string,role:string)=>{expect(role).toBe('public');r.accountingCalls++;await r.accountingGate;return {retainedMicroUsdc:'60000'};};}});},
 applicationStorageIdentity:async(_db:unknown,access:string)=>{expect(access).toBe('read');r.steps.push('identity');r.identityCalls++;await r.identityGate;if(r.identityFailure)throw Error('genuine authority refused');return r.identity;},
 assertApplicationStorageCurrentLocal:()=>{r.steps.push('local');if(r.promiseLocal)return Promise.resolve();},
 closeReadonlyApplicationStorage:async()=>{r.steps.push('close');r.closeCalls++;await r.closeGate;},
}));
vi.mock('../immutable-release-staging.mjs',()=>({verifyImmutableArtifact:()=>r.artifact}));
vi.mock('../redeploy-reviewed-roles.mjs',()=>({
 SERVER1_NATIVE_RELEASE:{sourceCommit:'3654cf66bd3541a90d9c621eb72d57556e306dd6',manifest:'/root/.local/share/keryx-mainnet-runtime/production-v2/storage.json',publicPolicySha256:'c70be6ac6ca452b15ef1a8caac96654aa181a025ed0638b8e138569c7b62f422'},
 releaseSource:(value:string)=>'/root/.local/share/keryx-releases/'+value+'/source',readReviewedRoles:()=>r.roles,verifyReleaseReview:()=>r.review,readProtectedDeploymentJson:()=>r.review,
}));
import { bootstrapServer1NativeRoles } from './server1-native-bootstrap.mts';
beforeEach(async()=>{
 r.files.clear();r.fds.clear();Object.assign(r,{next:20,closed:0,steps:[],expired:false,base:'https://keryx.cc',backend:'postgres',privateActive:false,identityFailure:false,promiseLocal:false,keyChanged:false,readyFailures:0,readyCalls:0,factoryCalls:0,identityCalls:0,accountingCalls:0,closeCalls:0,pm2Calls:[],factoryGate:undefined,identityGate:undefined,accountingGate:undefined,closeGate:undefined,rows:[]});
 const {STORAGE_MAINNET_PROFILE_DIGEST,storageIdentityDigest}=await import('../../lib/db/storage-identity');
 r.identity={format:'keryx-mainnet-storage-identity-v1',deploymentId:'11111111-1111-4111-8111-111111111111',storageId:'22222222-2222-4222-8222-222222222222',network:'eip155:5042',authorityMode:'mainnet-real',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,enrollmentId:'33333333-3333-4333-8333-333333333333',enrolledAt:'2026-11-11T00:00:00.000Z',provenanceDigest:'a'.repeat(64)};r.identityDigest=storageIdentityDigest(r.identity);
 r.env={KERYX_STORAGE_MANIFEST:'/root/.local/share/keryx-mainnet-runtime/production-v2/storage.json',KERYX_NETWORK:'arc',NEXT_PUBLIC_KERYX_NETWORK:'arc',KERYX_FORCE_OFFLINE:'0',BASE_URL:'https://keryx.cc',KERYX_MAINNET_TREASURY_POLICY_JSON:'recorded-public-policy',KERYX_MAINNET_TREASURY_POLICY_DIGEST:'c70be6ac6ca452b15ef1a8caac96654aa181a025ed0638b8e138569c7b62f422',KERYX_MAINNET_TREASURY_PRIVATE_KEY:'0x'+'11'.repeat(32)};
 const env=Object.entries(r.env).map(([k,v])=>`${k}=${v}`).join('\n');r.files.set(envFile,Buffer.from(env));
 r.files.set('/root/keryx-migration/authority-transfer.json',Buffer.from(JSON.stringify({format:'keryx-single-writer-host-transfer-v1',source:'3654cf66bd3541a90d9c621eb72d57556e306dd6',sourceWritersNaturallyEnded:true,targetStartupAuthorized:true,financialPolicyChanged:false,newFunding:false})));
 r.files.set('/root/keryx-migration/source-machine-id',Buffer.from('recorded-machine\n'));r.files.set('/etc/machine-id',Buffer.from('recorded-machine\n'));
 r.roles={release:{commit,runtimeEnvironmentSha256:createHash('sha256').update(env).digest('hex')},apps:['keryx','keryx-a2a-worker'].map(name=>({name,script:'/usr/bin/env',cwd:'/root/keryx',interpreter:'none',args:['recorded-immutable-'+commit],autorestart:false,kill_timeout:330000}))};r.artifact={commit,buildId:'recorded-build'};r.review={format:'keryx-reviewed-native-release-compatibility-v1',storageIdentityDigest:r.identityDigest};
 const actual=globalThis.process;vi.stubGlobal('process',new Proxy(actual,{get(target,key){if(key==='platform')return 'linux';if(key==='getuid')return ()=>0;if(key==='version')return 'v24.22.1';if(key==='cwd')return ()=>'/root/keryx';if(key==='argv')return ['node','vitest'];if(key==='kill')return ()=>true;if(key==='env')return r.env;return Reflect.get(target,key,target);}}));
});
afterEach(()=>vi.unstubAllGlobals());
const call=(verifyOnly=true)=>bootstrapServer1NativeRoles(rolesFile,'a'.repeat(64),verifyOnly);
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};};

describe('server1 native public bootstrap dependency recordings',()=>{
 it('refuses unprotected role paths and arbitrary hash before control reads or a reader',async()=>{await expect(bootstrapServer1NativeRoles('/tmp/roles.json','a'.repeat(64),true)).rejects.toThrow();await expect(bootstrapServer1NativeRoles(rolesFile,'caller-proof',true)).rejects.toThrow();expect(r.fds.size).toBe(0);expect(r.factoryCalls).toBe(0);expect(r.pm2Calls).toHaveLength(0);});
 it('awaits the selected identity boundary twice and closes before any start/save (recording)',async()=>{
  const result=await call(false) as {accepted:boolean;rolesStarted:boolean};expect(result).toMatchObject({accepted:true,rolesStarted:true});expect(r.identityCalls).toBe(2);expect(r.closeCalls).toBe(1);expect(r.accountingCalls).toBe(1);expect(r.steps.indexOf('identity')).toBeLessThan(r.steps.indexOf('accounting-getter'));expect(r.pm2Calls.filter(x=>x[0]==='start')).toEqual([['start',rolesFile]]);expect(r.fds.size).toBe(0);
 });
 it('verify-only retains transfer/machine checks and never starts or saves roles',async()=>{expect(await call()).toMatchObject({accepted:true,verifyOnly:true,rolesStarted:false});expect(r.pm2Calls.every(x=>x[0]==='jlist')).toBe(true);});
 it.each(['sqlite','supabase'])('refuses %s before native reader construction',async backend=>{r.backend=backend;await expect(call()).rejects.toThrow('boot refused');expect(r.factoryCalls).toBe(0);});
 it('does not inspect accounting methods when native admission refuses',async()=>{r.identityFailure=true;await expect(call()).rejects.toThrow();expect(r.steps).not.toContain('accounting-getter');expect(r.closeCalls).toBe(1);expect(r.pm2Calls).toHaveLength(0);});
 it('rejects Promise-returning local narrowing instead of treating it as proof',async()=>{r.promiseLocal=true;await expect(call()).rejects.toThrow();expect(r.accountingCalls).toBe(0);expect(r.closeCalls).toBe(1);});
 it.each(['factory','identity','accounting','close'])('rechecks expiry while %s await is delayed and drains reader',async phase=>{
  const d=deferred();if(phase==='factory')r.factoryGate=d.promise;if(phase==='identity')r.identityGate=d.promise;if(phase==='accounting')r.accountingGate=d.promise;if(phase==='close')r.closeGate=d.promise;
  const task=call(false);await vi.waitFor(()=>expect(phase==='factory'?r.factoryCalls:phase==='identity'?r.identityCalls:phase==='accounting'?r.accountingCalls:r.closeCalls).toBeGreaterThan(0));r.expired=true;d.resolve();await expect(task).rejects.toThrow();expect(r.closeCalls).toBe(1);expect(r.pm2Calls).toHaveLength(0);
 });
 it('rechecks origin and selected manifest after accounting await',async()=>{const d=deferred();r.accountingGate=d.promise;const task=call(false);await vi.waitFor(()=>expect(r.accountingCalls).toBe(1));r.base='https://other.invalid';d.resolve();await expect(task).rejects.toThrow();expect(r.closeCalls).toBe(1);expect(r.pm2Calls).toHaveLength(0);});
 it('rejects an all9 identity mismatch before inspecting accounting',async()=>{const d=deferred();r.identityGate=d.promise;const task=call(false);await vi.waitFor(()=>expect(r.identityCalls).toBe(1));r.identity={...r.identity,provenanceDigest:'f'.repeat(64)};d.resolve();await expect(task).rejects.toThrow();expect(r.accountingCalls).toBe(0);expect(r.closeCalls).toBe(1);});
 it('rejects backend mutation while identity is awaited without selecting a fallback',async()=>{const d=deferred();r.identityGate=d.promise;const task=call(false);await vi.waitFor(()=>expect(r.identityCalls).toBe(1));r.backend='sqlite';d.resolve();await expect(task).rejects.toThrow();expect(r.factoryCalls).toBe(1);expect(r.accountingCalls).toBe(0);expect(r.closeCalls).toBe(1);});
 it('rechecks the captured role key after the final reader-close await',async()=>{const d=deferred();r.closeGate=d.promise;const task=call(false);await vi.waitFor(()=>expect(r.closeCalls).toBe(1));r.env.KERYX_MAINNET_TREASURY_PRIVATE_KEY='0x'+'22'.repeat(32);d.resolve();await expect(task).rejects.toThrow();expect(r.pm2Calls).toHaveLength(0);});
 it('refuses live private worker without renewing policy or constructing a reader',async()=>{r.privateActive=true;await expect(call()).rejects.toThrow();expect(r.factoryCalls).toBe(0);expect(r.pm2Calls).toHaveLength(0);});
 it('waits only for local PostgreSQL startup, then performs one selected admission attempt',async()=>{r.readyFailures=2;await call();expect(r.readyCalls).toBe(3);expect(r.factoryCalls).toBe(1);r.identityFailure=true;await expect(call()).rejects.toThrow();expect(r.factoryCalls).toBe(2);expect(r.identityCalls).toBe(3);});
 it('does not accept readiness that completes after the fixed30s deadline',async()=>{const clock=vi.spyOn(performance,'now').mockReturnValueOnce(0).mockReturnValueOnce(1).mockReturnValueOnce(2).mockReturnValue(30001);try{await expect(call()).rejects.toThrow();expect(r.readyCalls).toBe(1);expect(r.factoryCalls).toBe(0);}finally{clock.mockRestore();}});
 it('refuses existing predecessor online definitions and never restarts/deletes them',async()=>{r.rows=[{name:'keryx',pid:88,pm2_env:{status:'online'}},{name:'keryx-a2a-worker',pid:89,pm2_env:{status:'online'}}];await expect(call(false)).rejects.toThrow();expect(r.pm2Calls.every(x=>x[0]==='jlist')).toBe(true);});
});
