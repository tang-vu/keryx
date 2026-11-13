/** Synthetic fixture producer using the actual local-owner CLI as real POSIX
 * uid/euid 0. No patched authorization, network, production data or app owner RPC. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync,readFileSync,writeFileSync,unlinkSync,mkdirSync,rmdirSync } from 'node:fs';
import { join,resolve,dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildSync } from 'esbuild';
import { canonicalJson } from '../../lib/canonical-json';
import { storageIdentityDigest,type StorageIdentity } from '../../lib/db/storage-identity';
import { assignmentDigest } from '../../lib/owner-run-assignments/protocol';
import { receiptSchema,type OwnerAction } from '../../lib/owner-run-assignments/contracts';
const image='node@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c';
export function sourceOwnerAssignment(folder:string,file:string,identity:StorageIdentity,input:OwnerAction){
 const name='keryx-owner269-source-'+randomUUID(),bundle=join(folder,'owner-cli.mts'),manifest=join(folder,'owner-cli-storage.json'),operation=join(folder,'owner-cli-input.json');
 const docker=(args:string[])=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:131072,stdio:['ignore','pipe','pipe']}).trim();
 assert(!existsSync(file+'-wal')&&!existsSync(file+'-shm')&&!existsSync(file+'-journal'),'SOURCE is closed before transfer');
 try{
  mkdirSync(join(folder,'scripts'));
  // Temporary synthetic-only diagnosis of the hosted Linux refusal. Preserve
  // every source auth/storage check; expand only the CLI's caught error output.
  const entry=resolve('scripts/owner-run-assignment.mts'),source=readFileSync(entry,'utf8'),needle='process.stderr.write(canonicalJson({ error:';
  assert.equal(source.split(needle).length,2);
  const diagnostic=source.replace(needle,"process.stderr.write(canonicalJson({ fixtureDiagnostic: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : null, error:");
  buildSync({stdin:{contents:diagnostic,resolveDir:dirname(entry),sourcefile:entry,loader:'ts'},outfile:bundle,bundle:true,platform:'node',target:'node24',format:'esm',banner:{js:"import {createRequire as __fixtureCreateRequire} from 'node:module'; const require=__fixtureCreateRequire(import.meta.url);"},logLevel:'silent'});
  writeFileSync(manifest,canonicalJson({format:'keryx-storage-deployment-v1',identity,backend:{kind:'sqlite',databasePath:'/work/source.sqlite'}}),{flag:'wx',mode:0o600});
  writeFileSync(operation,canonicalJson(input),{flag:'wx',mode:0o600});
  const command=['--no-warnings','scripts/owner-run-assignment.mts',input.action,'--storage-manifest','/work/storage.json','--identity-digest',storageIdentityDigest(identity),'--input','/work/input.json','--approve-operation-digest',assignmentDigest('owner-operation',input)];
  const wrapper="const {execFileSync}=require('node:child_process'),fs=require('node:fs'); const result=execFileSync(process.execPath,JSON.parse(process.argv[1]),{encoding:'utf8',stdio:['ignore','pipe','pipe']}); if(['-wal','-shm','-journal'].some(s=>fs.existsSync('/work/source.sqlite'+s)))throw Error('Unclosed SOURCE companions'); process.stdout.write(result);";
  docker(['create','--name',name,'--label','keryx.owner269-source='+name,'--network','none','--user','0:0','--workdir','/work','--memory','512m','--memory-swap','512m','--cpus','.5','--pids-limit','32','--cap-drop','ALL','--security-opt','no-new-privileges','--ulimit','core=0',image,'node','-e',wrapper,JSON.stringify(command)]);
  // Copy a directory so the canonical relative CLI path is a real file.
  // docker cp creates the last directory when copying an existing directory.
  const scriptDirectory=join(folder,'scripts');
  writeFileSync(join(scriptDirectory,'owner-run-assignment.mts'),readFileSync(bundle));
  docker(['cp',scriptDirectory,name+':/work/scripts']);
  for(const [source,target]of [[file,'source.sqlite'],[manifest,'storage.json'],[operation,'input.json']])docker(['cp',source,name+':/work/'+target]);
  const value=receiptSchema.parse(JSON.parse(docker(['start','--attach',name])));
  assert.equal(docker(['inspect','--format','{{.State.ExitCode}}',name]),'0');
  docker(['cp',name+':/work/source.sqlite',file]);
  // The wrapper checked absent WAL/SHM/journal after the unchanged CLI exited.
  return value;
 }finally{
  try{docker(['rm','--force',name]);}catch{/* Preserve the original check failure. */}
  for(const path of [bundle,manifest,operation,join(folder,'scripts','owner-run-assignment.mts')])if(existsSync(path))unlinkSync(path);
  if(existsSync(join(folder,'scripts')))rmdirSync(join(folder,'scripts'));
 }
}
