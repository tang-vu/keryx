import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { access,chmod,link,lstat,mkdtemp,mkdir,readFile,rename,rm,symlink,writeFile } from "node:fs/promises";
import { readFileSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename,dirname,isAbsolute,join,relative,resolve,sep } from "node:path";
import { randomUUID,createHash } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import type { StorageDeploymentManifest } from "../db/runtime-storage-config";
import { STORAGE_MAINNET_PROFILE_DIGEST } from "../db/storage-identity";
const selection=vi.hoisted(()=>({read:vi.fn(),credentials:vi.fn(),realpath:vi.fn(),originalRealpath:undefined as typeof import("node:fs/promises")["realpath"]|undefined}));
vi.mock("node:fs/promises",async(importOriginal)=>{const actual=await importOriginal<typeof import("node:fs/promises")>();selection.originalRealpath=actual.realpath;return {...actual,realpath:selection.realpath};});
vi.mock('../db/runtime-storage-config',()=>({readRuntimeStorageDeployment:selection.read}));
vi.mock('../db/postgres/private-credential',()=>({readPrivatePostgresCredential:selection.credentials}));
import { operatorAuditDirectory,prepareOperatorAuditDirectory,writeOperatorAudit } from "./journal";
import { withPrivateWorkerLock } from "../a2a/private-worker-lock";
import { inventory,liquidity,NOW } from "./fixtures.test-support";
import { decideOperatorCycle } from "./decision";
const roots:string[]=[];
beforeEach(()=>{vi.clearAllMocks();selection.read.mockReset();selection.credentials.mockReset();selection.realpath.mockImplementation(selection.originalRealpath!);});
afterEach(async()=>{
  vi.unstubAllEnvs();
  for(const root of roots.splice(0)){
    const absolute=resolve(root),base=resolve(tmpdir()),inside=relative(base,absolute);
    expect(isAbsolute(absolute)&&inside!==""&&inside!==".."&&!inside.startsWith(".."+sep)&&!isAbsolute(inside)).toBe(true);
    expect(basename(absolute).startsWith("keryx-business-audit-")).toBe(true);expect((await lstat(absolute)).isSymbolicLink()).toBe(false);
    await rm(absolute,{recursive:true,force:true});
  }
});
async function directory(){const root=await mkdtemp(join(tmpdir(),"keryx-business-audit-"));roots.push(root);return join(root,"audit");}
it("durably retains unique audit records and refuses to overwrite the original",async()=>{
  const dir=await directory(); const event={version:1 as const,cycleId:randomUUID(),phase:"decision" as const,inventory,liquidity,
    decision:decideOperatorCycle({inventory,liquidity,nowMs:NOW})};
  await writeOperatorAudit(dir,event);
  const record=JSON.parse(await readFile(join(dir,`${event.cycleId}-decision.json`),"utf8"));
  expect(record.digest).toBe(createHash("sha256").update(canonicalJson(record.event)).digest("hex"));
  await expect(writeOperatorAudit(dir,event)).rejects.toThrow();
  expect(JSON.parse(await readFile(join(dir,`${event.cycleId}-decision.json`),"utf8"))).toEqual(record);
});
it("refuses relative paths and a symlink audit destination",async()=>{
  await expect(prepareOperatorAuditDirectory("relative-audit")).rejects.toThrow();
  const dir=await directory(); await symlink(roots[0],dir,process.platform==="win32"?"junction":"dir");
  await expect(prepareOperatorAuditDirectory(dir)).rejects.toThrow();
});
it("a concurrent worker cannot claim while the original worker owns its private lock",async()=>{
  const dir=await directory(); await prepareOperatorAuditDirectory(dir);
  let entered!:()=>void,finish!:()=>void;
  const ready=new Promise<void>(resolve=>{entered=resolve;}); const done=new Promise<void>(resolve=>{finish=resolve;});
  const original=withPrivateWorkerLock(dir,async()=>{entered();await done;}); await ready;
  let secondRan=false;
  await expect(withPrivateWorkerLock(dir,async()=>{secondRan=true;})).rejects.toThrow(); expect(secondRan).toBe(false);
  finish();await original;
  await expect(withPrivateWorkerLock(dir,async()=>"clean restart")).resolves.toBe("clean restart");
});


const roleWire=(role:string,password='synthetic-audit-role-password')=>canonicalJson({format:'keryx-postgres-role-credential-v1',role,password});
async function nativeFixture(){
  const root=dirname(await directory()),application=join(root,'application.json'),reader=join(root,'reader.json'),target=join(root,'.business-operator-audit');
  await writeFile(application,roleWire('keryx_app'),{mode:0o600});await writeFile(reader,roleWire('keryx_reader'),{mode:0o600});
  const deployment:StorageDeploymentManifest={format:'keryx-storage-deployment-v1',identity:{format:'keryx-mainnet-storage-identity-v1',authorityMode:'mainnet-real',network:'eip155:5042',deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:'2026-11-15T00:00:00.000Z',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,provenanceDigest:'ab'.repeat(32)},backend:{kind:'postgres',database:'native_target',sourceDigest:'cd'.repeat(32),endpoint:{kind:'loopback',port:5432},credentialPaths:{application,reader}}};
  selection.read.mockReturnValue(deployment);
  // Recording boundary for portable directory tests only. The production
  // private-role validator remains unchanged; Linux cases below use it directly.
  const roles=new Map([[application,'keryx_app'],[reader,'keryx_reader']]);
  const fingerprint=(path:string,role:string)=>{
    if(roles.get(path)!==role)throw Error('Unselected private role');
    return {password:'synthetic-audit-role-password',fingerprint:createHash('sha256').update(readFileSync(path)).digest('hex')};
  };
  selection.credentials.mockImplementation(fingerprint);
  return {root,application,reader,target,deployment,fingerprint};
}
it('retains the SQLite sibling selection without reading PostgreSQL credentials',async()=>{
  const f=await nativeFixture();selection.read.mockReturnValue({...f.deployment,backend:{kind:'sqlite',databasePath:join(f.root,'selected.sqlite')}});selection.credentials.mockClear();
  expect(await operatorAuditDirectory()).toBe(f.target);expect(selection.credentials).not.toHaveBeenCalled();
});
it('reuses the selected native private sibling and preserves every existing audit byte',async()=>{
  const f=await nativeFixture(),retained=Buffer.from([0xef,0xbb,0xbf,0,123,125]);await prepareOperatorAuditDirectory(f.target);const original=join(f.target,'retained-original.json');await writeFile(original,retained,{mode:0o600});
  vi.stubEnv('KERYX_OPERATOR_AUDIT_DIR',join(f.root,'unselected'));vi.stubEnv('BUSINESS_OPERATOR_AUDIT_DIR',join(f.root,'another-unselected'));
  expect(await operatorAuditDirectory()).toBe(f.target);expect(await readFile(original)).toEqual(retained);expect(selection.credentials.mock.calls).toEqual([[f.application,'keryx_app'],[f.reader,'keryx_reader'],[f.application,'keryx_app'],[f.reader,'keryx_reader']]);await expect(access(join(f.root,'unselected'))).rejects.toThrow();
});
it('refuses Supabase instead of selecting an environment or fallback audit directory',async()=>{
  const f=await nativeFixture();selection.read.mockReturnValue({...f.deployment,backend:{kind:'supabase',url:'https://synthetic.invalid'}});vi.stubEnv('KERYX_OPERATOR_AUDIT_DIR',f.target);
  await expect(operatorAuditDirectory()).rejects.toThrow('Operator audit storage unavailable');expect(selection.credentials).not.toHaveBeenCalled();await expect(access(f.target)).rejects.toThrow();
});
it('refuses split or identical credential paths before preparing an audit root',async()=>{
  const f=await nativeFixture(),other=dirname(await directory());
  for(const reader of [f.application,join(other,'reader.json')]){
    selection.read.mockReturnValue({...f.deployment,backend:{...f.deployment.backend,credentialPaths:{application:f.application,reader}}});await expect(operatorAuditDirectory()).rejects.toThrow('Operator audit storage unavailable');
  }
  expect(selection.credentials).not.toHaveBeenCalled();await expect(access(f.target)).rejects.toThrow();
});
it('refuses a symlink private parent or audit child using actual filesystem checks',async()=>{
  const f=await nativeFixture(),alias=join(f.root,'alias');await symlink(f.root,alias,process.platform==='win32'?'junction':'dir');
  const linked={...f.deployment,backend:{...f.deployment.backend,credentialPaths:{application:join(alias,'application.json'),reader:join(alias,'reader.json')}}};selection.read.mockReturnValue(linked);selection.credentials.mockImplementation(()=>({password:'synthetic-audit-role-password',fingerprint:'ab'.repeat(32)}));
  await expect(operatorAuditDirectory()).rejects.toThrow('Operator audit directory refused');await expect(access(f.target)).rejects.toThrow();selection.read.mockReturnValue(f.deployment);await symlink(f.root,f.target,process.platform==='win32'?'junction':'dir');await expect(operatorAuditDirectory()).rejects.toThrow('Operator audit directory refused');
});
it('refuses a changed protected selection after asynchronous directory preparation',async()=>{
  const f=await nativeFixture();selection.read.mockReturnValueOnce(f.deployment).mockReturnValue({...f.deployment,identity:{...f.deployment.identity,storageId:randomUUID()}});
  await expect(operatorAuditDirectory()).rejects.toThrow('Operator audit storage unavailable');expect(selection.read).toHaveBeenCalledTimes(2);
});
it('refuses a changed private credential fingerprint after preparation',async()=>{
  const f=await nativeFixture();let calls=0;selection.credentials.mockImplementation((path:string,role:string)=>{if(++calls===3)writeFileSync(f.application,roleWire('keryx_app','synthetic-rotated-audit-password'));return f.fingerprint(path,role);});
  await expect(operatorAuditDirectory()).rejects.toThrow('Operator audit storage unavailable');expect(selection.credentials).toHaveBeenCalledTimes(4);
});
it('refuses a replaced private root after the final realpath await even with the same credential inodes',async()=>{
  const f=await nativeFixture(),moved=f.root+'-moved',originalRealpath=selection.originalRealpath!;let rootReads=0,replaced=false;
  expect(dirname(resolve(moved))).toBe(dirname(resolve(f.root)));const inside=relative(resolve(tmpdir()),resolve(moved));expect(inside!==''&&inside!=='..'&&!inside.startsWith('..'+sep)&&!isAbsolute(inside)).toBe(true);
  selection.realpath.mockImplementation(async(...args:Parameters<NonNullable<typeof selection.originalRealpath>>)=>{
    const result=await originalRealpath(...args);
    if(args[0]===f.root&&++rootReads===2){
      const beforeApp=await lstat(f.application,{bigint:true}),beforeReader=await lstat(f.reader,{bigint:true});
      await rename(f.root,moved);roots.push(moved);await mkdir(f.root,{mode:0o700});
      await rename(join(moved,'application.json'),f.application);await rename(join(moved,'reader.json'),f.reader);await rename(join(moved,'.business-operator-audit'),f.target);
      expect((await lstat(f.application,{bigint:true})).ino).toBe(beforeApp.ino);expect((await lstat(f.reader,{bigint:true})).ino).toBe(beforeReader.ino);replaced=true;
    }
    return result;
  });
  await expect(operatorAuditDirectory()).rejects.toThrow('Operator audit storage unavailable');expect(replaced).toBe(true);
});
it('never prepares an audit root when either selected private role validation fails',async()=>{
  const f=await nativeFixture();selection.credentials.mockImplementation((path:string,role:string)=>{if(role==='keryx_reader')throw Error('Private credential refused');return f.fingerprint(path,role);});
  await expect(operatorAuditDirectory()).rejects.toThrow('Private credential refused');await expect(access(f.target)).rejects.toThrow();
});

// These exercise the genuine POSIX/private-file contract on Linux CI. Portable
// recording cases above do not claim that Windows validates native role files.
it.runIf(process.platform==='linux')('validates both actual canonical private role files',async()=>{
  const f=await nativeFixture(),actual=await vi.importActual<typeof import('../db/postgres/private-credential')>('../db/postgres/private-credential');selection.credentials.mockImplementation(actual.readPrivatePostgresCredential);
  expect(await operatorAuditDirectory()).toBe(f.target);await chmod(f.reader,0o644);await expect(operatorAuditDirectory()).rejects.toThrow('PostgreSQL storage unavailable');
});
it.runIf(process.platform==='linux')('refuses an actual foreign role and a hard-linked credential',async()=>{
  const f=await nativeFixture(),actual=await vi.importActual<typeof import('../db/postgres/private-credential')>('../db/postgres/private-credential');selection.credentials.mockImplementation(actual.readPrivatePostgresCredential);
  await writeFile(f.reader,roleWire('keryx_app'));await expect(operatorAuditDirectory()).rejects.toThrow('PostgreSQL storage unavailable');await writeFile(f.reader,roleWire('keryx_reader'));await link(f.reader,join(f.root,'reader-copy.json'));await expect(operatorAuditDirectory()).rejects.toThrow('PostgreSQL storage unavailable');await expect(access(f.target)).rejects.toThrow();
});
it.runIf(process.platform==='linux')('refuses an actual symlink credential and an unprivate native parent',async()=>{
  const f=await nativeFixture(),actual=await vi.importActual<typeof import('../db/postgres/private-credential')>('../db/postgres/private-credential');selection.credentials.mockImplementation(actual.readPrivatePostgresCredential);
  const original=join(f.root,'reader-original.json');await rename(f.reader,original);await symlink(original,f.reader);await expect(operatorAuditDirectory()).rejects.toThrow('PostgreSQL storage unavailable');await rm(f.reader);await rename(original,f.reader);await chmod(f.root,0o755);await expect(operatorAuditDirectory()).rejects.toThrow('Operator audit directory refused');await expect(access(f.target)).rejects.toThrow();
});
it.runIf(process.platform==='linux')('refuses existing audit directory permissions without changing its retained records',async()=>{
  const f=await nativeFixture(),actual=await vi.importActual<typeof import('../db/postgres/private-credential')>('../db/postgres/private-credential');selection.credentials.mockImplementation(actual.readPrivatePostgresCredential);await mkdir(f.target,{mode:0o700});const original=join(f.target,'retained.json'),bytes=Buffer.from('retained original');await writeFile(original,bytes,{mode:0o600});await chmod(f.target,0o755);await expect(operatorAuditDirectory()).rejects.toThrow('Operator audit directory refused');expect(await readFile(original)).toEqual(bytes);
});
