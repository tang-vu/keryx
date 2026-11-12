import { createHash } from 'node:crypto';
import { closeSync,constants,fstatSync,lstatSync,openSync,readSync,realpathSync } from 'node:fs';
import { isAbsolute,parse,relative,resolve,sep } from 'node:path';
import { canonicalJson } from '../../canonical-json';
import { PostgresStorageUnavailable } from './connection';
export type PostgresRuntimeRole='keryx_app'|'keryx_reader';
const maximum=4096;
/** Linux server credential intake only. It confers no storage/factory authority. */
export function readPrivatePostgresCredential(target:string,role:PostgresRuntimeRole):Readonly<{password:string;fingerprint:string}>{
 let descriptor:number|undefined;
 try{
  if(arguments.length!==2||process.platform!=='linux'||!process.getuid||!['keryx_app','keryx_reader'].includes(role)
   ||typeof target!=='string'||target.length>2048||!isAbsolute(target)||resolve(target)!==target||target.includes('\0'))throw new Error();
  const inspect=()=>{
   const root=parse(target).root;let current=root;
   for(const part of relative(root,target).split(sep)){current=resolve(current,part);if(lstatSync(current).isSymbolicLink())throw new Error();}
   const stat=lstatSync(target,{bigint:true});
   if(!stat.isFile()||stat.uid!==BigInt(process.getuid!())||stat.nlink!==BigInt(1)||(stat.mode&BigInt(0o077))!==BigInt(0)||stat.size<BigInt(1)||stat.size>BigInt(maximum)||realpathSync(target)!==target)throw new Error();
   return stat;
  };
  const identity=(s:ReturnType<typeof inspect>)=>[s.dev,s.ino,s.uid,s.mode,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');
  const initial=inspect(),before=identity(initial);descriptor=openSync(target,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  if(identity(fstatSync(descriptor,{bigint:true}))!==before)throw new Error();
  const buffer=Buffer.alloc(maximum+1);let bytes=0;
  while(bytes<buffer.length){const count=readSync(descriptor,buffer,bytes,buffer.length-bytes,bytes);if(!count)break;bytes+=count;}
  if(bytes>maximum||BigInt(bytes)!==initial.size||identity(fstatSync(descriptor,{bigint:true}))!==before||identity(inspect())!==before)throw new Error();
  const decoded=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer.subarray(0,bytes)),wire=decoded.endsWith('\n')?decoded.slice(0,-1):decoded,value:unknown=JSON.parse(wire);
  if(canonicalJson(value)!==wire||!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='format,password,role')throw new Error();
  const credential=value as Record<string,unknown>;
  if(credential.format!=='keryx-postgres-role-credential-v1'||credential.role!==role||typeof credential.password!=='string'
   ||credential.password.length<16||credential.password.length>1024||/[\u0000\r\n]/.test(credential.password))throw new Error();
  return Object.freeze({password:credential.password,fingerprint:createHash('sha256').update(buffer.subarray(0,bytes)).digest('hex')});
 }catch{throw new PostgresStorageUnavailable();}
 finally{if(descriptor!==undefined)try{closeSync(descriptor);}catch{}}
}
