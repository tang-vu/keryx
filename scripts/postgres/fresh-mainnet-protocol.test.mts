/** Actual fresh Node/bootstrap and loopback framing only. No PostgreSQL,
 * Docker, provider, production key, funding or installed proof is involved. */
import { afterEach,expect,it,vi } from 'vitest';
import { createServer,type Socket } from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname,join,resolve,sep } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity } from '../../lib/db/storage-identity';
import { captureFreshMainnetProtocolInput,freshMainnetProtocolEnvironment,qualifyFreshMainnetProtocol } from './fresh-mainnet-protocol.mts';

const folders:string[]=[];
afterEach(()=>{
 vi.unstubAllEnvs();for(const folder of folders.splice(0)){
  if(!resolve(folder).startsWith(resolve(tmpdir())+sep)||!folder.includes('keryx-fresh-mainnet-protocol-'))throw Error('Unsafe probe cleanup');rmSync(folder,{recursive:true,force:true});
 }
});
const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',authorityMode:'mainnet-real',network:'eip155:5042',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,
 deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:'2026-11-15T00:00:00.000Z',provenanceDigest:'ab'.repeat(32)};
const input=(port=5432)=>({mode:'private' as const,options:{endpoint:{kind:'loopback' as const,port},database:'native_target',role:'keryx_app',password:'a1'.repeat(24)},identity:{...identity},digest:'cd'.repeat(32),postgresContainer:'keryx-postgres-consents-'+randomUUID()});
const folder=()=>{const value=mkdtempSync(join(tmpdir(),'keryx-fresh-mainnet-protocol-'));folders.push(value);return value;};
async function probe(raw:unknown,envPatch:NodeJS.ProcessEnv={},args:string[]=['--bootstrap-probe']){
 const target=folder(),env={...freshMainnetProtocolEnvironment(target),...envPatch},loader=pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href;
 const childPath=fileURLToPath(new URL('./fresh-mainnet-protocol-child.mts',import.meta.url));
 return new Promise<{code:number|null;stdout:string;stderr:string}>((done,fail)=>{
  const child=spawn(process.execPath,['--max-old-space-size=512','--import',loader,childPath,...args],{cwd:resolve(dirname(childPath),'../..'),env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='',timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill();},15000);
  child.on('error',fail);child.stdin.on('error',()=>{});child.stdout.on('data',data=>{stdout+=String(data);if(Buffer.byteLength(stdout)>65536)child.kill();});child.stderr.on('data',data=>{stderr+=String(data);if(Buffer.byteLength(stderr)>8192)child.kill();});
  child.on('close',code=>{clearTimeout(timer);timedOut?fail(Error('Bootstrap probe timed out')):done({code,stdout,stderr});});child.stdin.end(JSON.stringify(raw));
 });
}
it('validates and captures only the two fixed modes and exact disposable target before awaiting',()=>{
 const raw=input(),captured=captureFreshMainnetProtocolInput(raw);raw.options.endpoint.port=1;raw.identity.provenanceDigest='ff'.repeat(32);
 expect(captured.options.endpoint.port).toBe(5432);expect(captured.identity.provenanceDigest).toBe('ab'.repeat(32));expect(Object.isFrozen(captured.options.endpoint)).toBe(true);
 for(const changed of [{...input(),mode:'arbitrary-module'},{...input(),postgresContainer:'production'}, {...input(),digest:'invalid'},
  {...input(),options:{...input().options,database:'postgres'}},{...input(),options:{...input().options,role:'postgres'}},
  {...input(),options:{...input().options,endpoint:{kind:'unix',directory:'/run',port:5432}}},{...input(),options:{...input().options,password:'bad\npassword'}},
  {...input(),identity:{...identity,network:'eip155:5042002'}},...['modulePath','childPath','ownerSql','env','timeout'].map(key=>({...input(),[key]:'unselected'}))])expect(()=>captureFreshMainnetProtocolInput(changed)).toThrow();
});
it('refuses injected accessors, configuration and paths before launching a child',async()=>{
 let touched=0;const raw={...input(),get mode(){touched++;throw Error('Caller getter');}};
 expect(()=>captureFreshMainnetProtocolInput(raw)).toThrow();expect(touched).toBe(0);
 await expect(Reflect.apply(qualifyFreshMainnetProtocol,undefined,[input(),()=>true])).rejects.toThrow('Fresh mainnet protocol unavailable');
 await expect(qualifyFreshMainnetProtocol({...input(),childPath:'../../arbitrary.mts'} as never)).rejects.toThrow();
 expect(()=>freshMainnetProtocolEnvironment(resolve(tmpdir(),'unselected-path'))).toThrow();
});
it('scrubs parent preload, credential, RPC and signer variables in the real child environment',()=>{
 for(const name of ['NODE_OPTIONS','NODE_PATH','PGHOST','PGPASSWORD','DOCKER_HOST','HTTP_PROXY','SUPABASE_SERVICE_ROLE_KEY','BUYER_PRIVATE_KEY','KERYX_MAINNET_TREASURY_PRIVATE_KEY','OPENAI_API_KEY'])vi.stubEnv(name,'synthetic-secret-never-child');
 const env=freshMainnetProtocolEnvironment(folder());expect(env.KERYX_NETWORK).toBe('arc');expect(env.NEXT_PUBLIC_KERYX_NETWORK).toBe('arc');expect(env.KERYX_FORCE_OFFLINE).toBe('0');
 for(const name of ['NODE_OPTIONS','NODE_PATH','PGHOST','PGPASSWORD','DOCKER_HOST','HTTP_PROXY'])expect(env[name]).toBeUndefined();
 for(const name of ['SUPABASE_SERVICE_ROLE_KEY','BUYER_PRIVATE_KEY','KERYX_MAINNET_TREASURY_PRIVATE_KEY','OPENAI_API_KEY'])expect(env[name]).toBe('');
 expect(Object.values(env)).not.toContain('synthetic-secret-never-child');
});
it('starts a genuinely fresh mainnet buyer profile and permits only pinned/proven loopback framing',async()=>{
 vi.stubEnv('KERYX_NETWORK','arcTestnet');vi.stubEnv('NEXT_PUBLIC_KERYX_NETWORK','arcTestnet');vi.stubEnv('KERYX_FORCE_OFFLINE','1');
 const stale=await import('../../lib/buyer/protocol');expect(stale.BUYER_NETWORK).toBe('eip155:5042002');
 const peers=new Set<Socket>();let connections=0;
 const server=createServer(peer=>{connections++;peers.add(peer);peer.on('close',()=>peers.delete(peer));peer.on('error',()=>{});peer.once('data',()=>{const complete=Buffer.from('430000000f494e534552542030203100','hex'),idle=Buffer.from('5a0000000549','hex');peer.end(Buffer.concat([complete,idle]));});});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const address=server.address();if(!address||typeof address==='string')throw Error('Probe listener missing');
 try{
  const f=input(address.port),result=await probe(f);expect(result.code,result.stdout).toBe(0);expect(result.stderr).toBe('');
  const report=JSON.parse(result.stdout);expect(report).toMatchObject({format:'keryx-fresh-mainnet-bootstrap-probe-v1',passed:true,buyerNetwork:'eip155:5042',loopbackProbe:true,registeredProxyProbe:true,installedNativeWriterQualified:false,productionData:false});
  expect(report.denied).toBe(9);expect(connections).toBe(2);expect(result.stdout).not.toContain(f.options.password);
 }finally{for(const peer of peers)peer.destroy();await new Promise<void>((done,fail)=>server.close(error=>error?fail(error):done()));}
});
it.each([{KERYX_NETWORK:'arcTestnet'},{NEXT_PUBLIC_KERYX_NETWORK:'arcTestnet'},{KERYX_FORCE_OFFLINE:'1'},{BUYER_PRIVATE_KEY:'synthetic-no-key'},{PGHOST:'unselected.invalid'},{KERYX_REGISTRY_ADDRESS:'0x'+'22'.repeat(20)},{UNSELECTED_SIGNER_PRIVATE_KEY:'synthetic-no-key'}])('refuses a polluted child environment without reading a target (%j)',async env=>{
 const result=await probe(input(),env);expect(result.code).toBe(1);expect(JSON.parse(result.stdout)).toEqual({passed:false,stage:'environment',reason:'fresh-mainnet-protocol-unavailable'});expect(result.stderr).toBe('');expect(result.stdout).not.toContain('synthetic-no-key');
});
it('refuses extra module arguments and oversized/malformed fixture metadata without logging input',async()=>{
 const extra=await probe(input(),{},['--bootstrap-probe','../../arbitrary-module.mts']);expect(extra.code).toBe(1);expect(JSON.parse(extra.stdout).stage).toBe('input');
 const large=await probe({...input(),unselected:'s'.repeat(10000)});expect(large.code).toBe(1);expect(large.stdout).not.toContain('ssss');expect(large.stderr).toBe('');
});
