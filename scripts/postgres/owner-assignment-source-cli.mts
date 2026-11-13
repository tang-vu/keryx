/** Synthetic fixture producer using the actual local-owner CLI as real POSIX
 * uid/euid 0. No patched authorization, network, production data or app owner RPC. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync,readFileSync,writeFileSync,unlinkSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildSync } from 'esbuild';
import { canonicalJson } from '../../lib/canonical-json';
import { storageIdentityDigest,type StorageIdentity } from '../../lib/db/storage-identity';
import { assignmentDigest } from '../../lib/owner-run-assignments/protocol';
import { receiptSchema,type OwnerAction } from '../../lib/owner-run-assignments/contracts';
const image='node@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c';
/** Finite synthetic transfer, not a general archive reader/writer. UID/GID 0 and
 * private modes belong to the receiving root fixture, not the host CI account. */
function sourceArchive(files:readonly {name:string;bytes:Buffer;directory?:boolean}[]){
 const chunks:Buffer[]=[];let total=1024;
 for(const file of files){
  assert(['scripts/','scripts/owner-run-assignment.mts','source.sqlite','storage.json','input.json'].includes(file.name));
  const header=Buffer.alloc(512),ascii=(value:string,offset:number,length:number)=>{assert(Buffer.byteLength(value)<=length);header.write(value,offset,length,'ascii');};
  ascii(file.name,0,100);ascii((file.directory?'0000700':'0000600')+'\0',100,8);ascii('0000000\0',108,8);ascii('0000000\0',116,8);
  ascii(file.bytes.length.toString(8).padStart(11,'0')+'\0',124,12);ascii('00000000000\0',136,12);header.fill(32,148,156);ascii(file.directory?'5':'0',156,1);ascii('ustar\0',257,6);ascii('00',263,2);ascii('root',265,32);ascii('root',297,32);
  ascii([...header].reduce((sum,value)=>sum+value,0).toString(8).padStart(6,'0')+'\0 ',148,8);
  const padding=Buffer.alloc((512-file.bytes.length%512)%512);total+=512+file.bytes.length+padding.length;assert(total<=16777216);chunks.push(header,file.bytes,padding);
 }
 return Buffer.concat([...chunks,Buffer.alloc(1024)]);
}
export function sourceOwnerAssignment(folder:string,file:string,identity:StorageIdentity,input:OwnerAction){
 const name='keryx-owner269-source-'+randomUUID(),bundle=join(folder,'owner-cli.mts'),manifest=join(folder,'owner-cli-storage.json'),operation=join(folder,'owner-cli-input.json');
 const docker=(args:string[],wire?:Buffer)=>execFileSync('docker',args,{input:wire,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:131072,stdio:['pipe','pipe','pipe']}).trim();
 assert(!existsSync(file+'-wal')&&!existsSync(file+'-shm')&&!existsSync(file+'-journal'),'SOURCE is closed before transfer');
 try{
  buildSync({entryPoints:[resolve('scripts/owner-run-assignment.mts')],outfile:bundle,bundle:true,platform:'node',target:'node24',format:'esm',banner:{js:"import {createRequire as __fixtureCreateRequire} from 'node:module'; const require=__fixtureCreateRequire(import.meta.url);"},logLevel:'silent'});
  writeFileSync(manifest,canonicalJson({format:'keryx-storage-deployment-v1',identity,backend:{kind:'sqlite',databasePath:'/work/source.sqlite'}}),{flag:'wx',mode:0o600});
  writeFileSync(operation,canonicalJson(input),{flag:'wx',mode:0o600});
  const command=['--no-warnings','scripts/owner-run-assignment.mts',input.action,'--storage-manifest','/work/storage.json','--identity-digest',storageIdentityDigest(identity),'--input','/work/input.json','--approve-operation-digest',assignmentDigest('owner-operation',input)];
  const wrapper="const {execFileSync}=require('node:child_process'),fs=require('node:fs'); if(process.getuid()!==0||process.geteuid()!==0)throw Error('Root fixture required'); for(const name of ['input.json','storage.json','source.sqlite','scripts/owner-run-assignment.mts']){const s=fs.lstatSync('/work/'+name);if(!s.isFile()||s.uid!==0||s.gid!==0||(s.mode&511)!==384)throw Error('Private root fixture ownership required');} const result=execFileSync(process.execPath,JSON.parse(process.argv[1]),{encoding:'utf8',stdio:['ignore','pipe','pipe']}); if(['-wal','-shm','-journal'].some(s=>fs.existsSync('/work/source.sqlite'+s)))throw Error('Unclosed SOURCE companions'); process.stdout.write(result);";
  docker(['create','--name',name,'--label','keryx.owner269-source='+name,'--network','none','--user','0:0','--workdir','/work','--memory','512m','--memory-swap','512m','--cpus','.5','--pids-limit','32','--cap-drop','ALL','--security-opt','no-new-privileges','--ulimit','core=0',image,'node','-e',wrapper,JSON.stringify(command)]);
  // Host CI UID 1001 must not survive as owner of mode-0600 root input files.
  // Explicit archive metadata preserves private permissions and cap-drop ALL.
  docker(['cp','--archive','-',name+':/work'],sourceArchive([{name:'scripts/',bytes:Buffer.alloc(0),directory:true},{name:'scripts/owner-run-assignment.mts',bytes:readFileSync(bundle)},
   {name:'source.sqlite',bytes:readFileSync(file)},{name:'storage.json',bytes:readFileSync(manifest)},{name:'input.json',bytes:readFileSync(operation)}]));
  const value=receiptSchema.parse(JSON.parse(docker(['start','--attach',name])));
  assert.equal(docker(['inspect','--format','{{.State.ExitCode}}',name]),'0');
  docker(['cp',name+':/work/source.sqlite',file]);
  // The wrapper checked absent WAL/SHM/journal after the unchanged CLI exited.
  return value;
 }finally{
  try{docker(['rm','--force',name]);}catch{/* Preserve the original check failure. */}
  for(const path of [bundle,manifest,operation])if(existsSync(path))unlinkSync(path);
 }
}
