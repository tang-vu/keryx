/** Private sealed DATA only. No target client, SQL apply, target verification,
 * enrollment, first-original adoption or application/factory authority. The
 * operator supplies a private directory under the canonical task .local tree.
 * Native <=512 MiB/deadline containment remains an independent requirement. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdtempSync, openSync, readSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeSync } from 'node:fs';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../../lib/canonical-json';
import { storageIdentityDigest } from '../../lib/db/storage-identity';
import { assertStorageFences, readStorageIdentity, storageFenceStatements, STORAGE_IDENTITY_TABLE } from '../../lib/db/storage-identity-sqlite';
import { assertSqliteApplicationSchemaProfile } from '../../lib/db/sqlite-application-schema-profile';
import { supportedSqliteApplicationProfiles } from '../../lib/db/enrolled-sqlite-schema-profile';
import { checkSnapshotSidecars, configureSnapshotConnection, validateSnapshotHeader } from '../../lib/db/storage-provenance-snapshot';
import { OFFLINE_SNAPSHOT_LIMITS } from '../../lib/db/storage-provenance';
import { nativeMaterializationProfile } from '../../lib/db/postgres/runtime-profile';
import { captureNativeProjectionSource,NATIVE_PROJECTION_SOURCE_DOMAINS, type NativeProjectionSelector } from './materialize-native-projections.mts';
import { articleOfferSourceOrder } from './materialize-native-snapshot.mts';
import { snapshotRows, snapshotRowWire, snapshotTables,type SnapshotRow } from './typed-snapshot.mts';
import { streamTypedSnapshotDelta, TypedSnapshotDeltaRefused, TYPED_SNAPSHOT_DELTA_LIMITS, type TypedDeltaRequest, type TypedDeltaSnapshot } from './typed-snapshot-delta.mts';

const MiB=1048576;
export const HELD_CATCHUP_INPUT_LIMITS=Object.freeze({spoolBytes:64*MiB,changeFrameBytes:24*MiB,projectionFrameBytes:8*MiB});
type Limits={-readonly [K in keyof typeof HELD_CATCHUP_INPUT_LIMITS]:number};
type DeltaCompletion=ReturnType<typeof streamTypedSnapshotDelta> extends AsyncGenerator<unknown,infer R,unknown>?R:never;
export class HeldCatchupInputRefused extends Error{constructor(readonly code:string){super('Held catchup input refused: '+code);}}
const refuse=(code:string):never=>{throw new HeldCatchupInputRefused(code);};
function plain(value:unknown,depth=0):void{
 if(typeof value==='string'&&(value.length>8192||Buffer.byteLength(value)>8192)||typeof value==='number'&&!Number.isFinite(value))refuse('invalid_request');
 if(depth>8||value===undefined||typeof value==='function'||typeof value==='symbol'||typeof value==='bigint')refuse('invalid_request');
 if(value&&typeof value==='object'){
  if(Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.getOwnPropertySymbols(value).length||Object.keys(value).length>16)refuse('invalid_request');
  for(const d of Object.values(Object.getOwnPropertyDescriptors(value))){if(!d.enumerable||!('value'in d))refuse('invalid_request');plain(d.value,depth+1);}
 }
}
function safeDirectory(path:string){
 if(typeof path!=='string'||path.length>2048||!isAbsolute(path)||resolve(path)!==path||path.includes('\0'))refuse('spool_directory');
 let part=parse(path).root;for(const leaf of relative(part,path).split(sep)){part=resolve(part,leaf);if(lstatSync(part).isSymbolicLink())refuse('unsafe_path');}
 const real=realpathSync(path);if(process.platform==='win32'?real.toLowerCase()!==path.toLowerCase():real!==path)refuse('unsafe_path');
 const s=lstatSync(path);if(!s.isDirectory()||process.platform!=='win32'&&(s.uid!==process.getuid!()||(s.mode&0o077)!==0))refuse('spool_directory');
}
function protectNewDirectory(path:string){
 if(process.platform==='win32')execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`
$ErrorActionPreference='Stop';$id=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;
$a=New-Object System.Security.AccessControl.DirectorySecurity;$a.SetOwner($id);$a.SetAccessRuleProtection($true,$false);
$r=New-Object System.Security.AccessControl.FileSystemAccessRule($id,'FullControl','ContainerInherit,ObjectInherit','None','Allow');
$a.AddAccessRule($r);Set-Acl -LiteralPath $env:KERYX_CATCHUP_NEW_DIRECTORY -AclObject $a;
$v=Get-Acl -LiteralPath $env:KERYX_CATCHUP_NEW_DIRECTORY;if(!$v.AreAccessRulesProtected -or $v.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $id.Value){throw 'Private directory unavailable'};
foreach($x in $v.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])){if($x.IdentityReference.Value -ne $id.Value -or $x.AccessControlType -ne 'Allow'){throw 'Private directory unavailable'}}
`],{windowsHide:true,timeout:5000,stdio:'ignore',env:{...process.env,KERYX_CATCHUP_NEW_DIRECTORY:path}});
 // mkdtemp is 0700 on Unix. Never chmod/repair an existing caller directory.
 safeDirectory(path);
}
function pin(source:TypedDeltaSnapshot,check:()=>void){
 const path=source.path;if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path||typeof source.sha256!=='string'||!/^[a-f0-9]{64}$/.test(source.sha256))refuse('invalid_snapshot');
 let part=parse(path).root;for(const leaf of relative(part,path).split(sep)){part=resolve(part,leaf);if(lstatSync(part).isSymbolicLink())refuse('unsafe_path');}
 const real=realpathSync(path);if(process.platform==='win32'?real.toLowerCase()!==path.toLowerCase():real!==path)refuse('unsafe_path');
 const initial=lstatSync(path,{bigint:true}),token=(s:typeof initial)=>[s.dev,s.ino,s.nlink,s.size,s.mode,s.mtimeNs,s.ctimeNs].join(':');
 if(!initial.isFile()||initial.nlink!==BigInt(1)||initial.size<BigInt(100)||initial.size>BigInt(TYPED_SNAPSHOT_DELTA_LIMITS.snapshotBytes)||process.platform!=='win32'&&(initial.uid!==BigInt(process.getuid!())||(initial.mode&BigInt(0o077))!==BigInt(0)))refuse('unsafe_path');
 const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));let db:DatabaseSync|undefined;
 const verify=()=>{check();checkSnapshotSidecars(path);if(token(fstatSync(fd,{bigint:true}))!==token(initial)||token(lstatSync(path,{bigint:true}))!==token(initial))refuse('snapshot_changed');};
 const hash=()=>{verify();const h=createHash('sha256'),buffer=Buffer.alloc(MiB);for(let offset=0;;){const n=readSync(fd,buffer,0,buffer.length,offset);if(!n)break;offset+=n;h.update(buffer.subarray(0,n));check();}verify();if(h.digest('hex')!==source.sha256)refuse('snapshot_hash');};
 try{
  validateSnapshotHeader(fd);hash();db=new DatabaseSync(path,{readOnly:true,allowExtension:false,timeout:1000});configureSnapshotConnection(db,OFFLINE_SNAPSHOT_LIMITS);db.exec('BEGIN');
  const identity=readStorageIdentity(db);if(identity.authorityMode!=='mainnet-real')refuse('source_profile');assertStorageFences(db,identity);
  const excluded=new Set([STORAGE_IDENTITY_TABLE,'storage_identity_no_update','storage_identity_no_delete','storage_identity_no_insert',...Object.keys(storageFenceStatements(db,identity))]);
  assertSqliteApplicationSchemaProfile(db,excluded,supportedSqliteApplicationProfiles(true).filter((_profile,index)=>index%2===1));
  const identityWire=canonicalJson(identity),native=db;
  const current=()=>{verify();if(!native.isTransaction||native.prepare('PRAGMA query_only').get()?.query_only!==1||canonicalJson(readStorageIdentity(native))!==identityWire)refuse('source_changed');};current();
  return {db,identity,verify:current,hash,close(){try{if(native.isTransaction)native.exec('ROLLBACK');}finally{try{native.close();}finally{closeSync(fd);}}}};
 }catch(error){try{db?.close();}finally{closeSync(fd);}throw error;}
}
const families=[['run','query_runs',['id'],10000],['review','decision_review_records',['id'],100000],['watch','topic_watches',['wallet','id'],10000],['a2a','a2a_orders',['id'],10000],['payment','payment_events',['id'],100000],['private-result','private_research_results',['id'],10000]] as const;
function* selectors(db:DatabaseSync){
 for(const [family,table,keys,maximum] of families){
  let count=0;const sql='SELECT '+keys.flatMap((k,i)=>[k,`typeof(${k}) kind${i}`,`lower(hex(CAST(${k} AS BLOB))) hex${i}`]).join(',')+' FROM '+table+' ORDER BY '+keys.map(k=>k+' COLLATE BINARY').join(',');
  for(const row of db.prepare(sql).iterate()){
   if(++count>maximum)refuse('projection_count_bound');
   for(const [i,key] of keys.entries())if(row['kind'+i]!=='text'||typeof row[key]!=='string'||Buffer.from(row[key] as string).toString('hex')!==row['hex'+i])refuse('projection_key');
   yield Object.freeze({family,id:row.id as string,...(family==='watch'?{wallet:row.wallet as string}:{})}) as NativeProjectionSelector;
  }
 }
}
function compareSelector(a:NativeProjectionSelector,b:NativeProjectionSelector){
 const rank=(x:NativeProjectionSelector)=>families.findIndex(f=>f[0]===x.family);if(a.family!==b.family)return rank(a)-rank(b);
 if(a.family==='watch'&&b.family==='watch'){const v=Buffer.compare(Buffer.from(a.wallet),Buffer.from(b.wallet));if(v)return v;}
 return Buffer.compare(Buffer.from(a.id),Buffer.from(b.id));
}
function census(){
 const h=createHash('sha256'),domains=new Map<string,{rows:number;digest:ReturnType<typeof createHash>}>(NATIVE_PROJECTION_SOURCE_DOMAINS.map(name=>[name,{rows:0,digest:createHash('sha256')}]));let packets=0;
 return {add(packet:Awaited<ReturnType<typeof captureNativeProjectionSource>>){h.update(canonicalJson(packet)).update('\n');packets++;
  const add=(name:string,row:unknown)=>{let d=domains.get(name);if(!d){d={rows:0,digest:createHash('sha256')};domains.set(name,d);}d.rows++;d.digest.update(canonicalJson(row)).update('\n');};
  for(const row of packet.rows)add(row.table,row.row);
  if(packet.payment)add('payment_event_source_observation',packet.payment);
  if(packet.privateResult)add('private_research_result_identity',packet.privateResult.metadata);
 },finish(){return {packets,digest:h.digest('hex'),domains:[...domains].map(([table,d])=>({table,rows:d.rows,digest:d.digest.digest('hex')}))};}};
}
type Request=Readonly<{delta:TypedDeltaRequest;spoolDirectory:string;limits?:Partial<Limits>}>;
/** Captures all caller data before the first await. A returned descriptor is
 * DATA metadata, not a reusable target receipt or permission to apply it. */
export function prepareHeldNativeCatchupInput(input:Request){
 plain(input);if(!input||typeof input!=='object')refuse('invalid_request');if(Object.keys(input).sort().join(',')!==(input.limits?'delta,limits,spoolDirectory':'delta,spoolDirectory'))refuse('invalid_request');
 const request=JSON.parse(JSON.stringify(input)) as Request,cap={...HELD_CATCHUP_INPUT_LIMITS};
 for(const [name,value] of Object.entries(request.limits??{})){if(!Object.hasOwn(cap,name)||!Number.isSafeInteger(value)||typeof value!=='number'||value<1||value>cap[name as keyof Limits])refuse('invalid_limits');cap[name as keyof Limits]=value;}
 const stream=streamTypedSnapshotDelta(request.delta); // Existing strict capture/checksum/PK contract before parsing the bounded wire.
 const prior=JSON.parse(request.delta.priorTarget.wire),profile=nativeMaterializationProfile('development-current510-data-only');
 if(prior.profileMode!=='development-current510-data-only'||prior.catalogSha256!==profile.catalogSha256)refuse('prior_profile');
 return prepare(request,cap,stream);
}
async function prepare(request:Request,cap:Limits,stream:ReturnType<typeof streamTypedSnapshotDelta>){
 const started=performance.now(),check=()=>{if(performance.now()-started>TYPED_SNAPSHOT_DELTA_LIMITS.elapsedMs)refuse('elapsed_bound');};
 let stage='source-before';
 let before:ReturnType<typeof pin>|undefined,after:ReturnType<typeof pin>|undefined,folder:string|undefined,file:string|undefined,fd:number|undefined,bytes=0,frames=0,finished=false;
 const fileHash=createHash('sha256'),contentHash=createHash('sha256'),holds=new Set<string>();
 const write=(frame:unknown,bound:number,sealing=false)=>{check();const wire=JSON.stringify(frame)+'\n',size=Buffer.byteLength(wire);if(size>bound)refuse('frame_bound');if(bytes+size>cap.spoolBytes)refuse('spool_bound');
  const data=Buffer.from(wire);let n=0;while(n<data.length){const written=writeSync(fd!,data,n,data.length-n);if(written<1)refuse('spool_write');n+=written;}fileHash.update(data);if(!sealing)contentHash.update(data);bytes+=size;frames++;};
 try{
  before=pin(request.delta.before,check);stage='source-after';after=pin(request.delta.after,check);if(canonicalJson(before.identity)!==canonicalJson(after.identity))refuse('identity_changed');
  stage='spool-setup';safeDirectory(request.spoolDirectory);folder=mkdtempSync(join(request.spoolDirectory,'held-catchup-'));protectNewDirectory(folder);const partial=join(folder,'input.ndjson.partial');fd=openSync(partial,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);file=partial;
  write({format:'keryx-held-native-catchup-header-v1',provisional:true,profileMode:'development-current510-data-only',catalogSha256:nativeMaterializationProfile('development-current510-data-only').catalogSha256,
   identity:before.identity,identityDigest:storageIdentityDigest(before.identity),beforeSnapshotSha256:request.delta.before.sha256,afterSnapshotSha256:request.delta.after.sha256,priorTargetReceiptSha256:request.delta.priorTarget.expectedSha256,priorTargetMetadataWire:request.delta.priorTarget.wire,
   limits:cap,changeByteFormat:'unchanged-typed-batch-json-plus-lf',targetVerified:false,applicationAuthority:false,nativeFactoryQualified:false},cap.projectionFrameBytes);
  stage='delta';let completion:DeltaCompletion|undefined;
  for(;;){const part=await stream.next();before.verify();after.verify();if(part.done){completion=part.value;break;}
   // Preserve the actual typed batch wire/digest; do not add an outer frame allowance.
   write(part.value,cap.changeFrameBytes);
   for(const change of part.value.changes){if(change.table==='payment_events'&&change.before!==null)holds.add('immutable-payment-first-wire');if(change.table.startsWith('private_'))holds.add('private-result-dependencies');if(/^(browser_|session_)/.test(change.table))holds.add('browser-custody-dependencies');if(change.table==='deliverable_acceptance_store')holds.add('acceptance-store-identity');}
  }
  if(!completion||completion.format!=='keryx-typed-snapshot-delta-completion-v1')refuse('delta_incomplete');
  stage='projections';const oldCensus=census(),newCensus=census(),left=selectors(before.db),right=selectors(after.db);let x=left.next(),y=right.next(),affectedProjectionPackets=0;
  try{while(!x.done||!y.done){before.verify();after.verify();const order=x.done?1:y.done?-1:compareSelector(x.value,y.value);
   const old=order<=0&&!x.done?await captureNativeProjectionSource(before.db,x.value):null;before.verify();after.verify();
   const next=order>=0&&!y.done?await captureNativeProjectionSource(after.db,y.value):null;before.verify();after.verify();
   if(old)oldCensus.add(old);if(next)newCensus.add(next);
   if(canonicalJson(old)!==canonicalJson(next)){write({format:'keryx-held-native-catchup-projection-v1',provisional:true,before:old,after:next},cap.projectionFrameBytes);affectedProjectionPackets++;}
   if(order<=0)x=left.next();if(order>=0)y=right.next();
  }}finally{left.return();right.return();}
  // rowid is a separately observed offer-order derivative, NEVER a typed PK.
  stage='offer-order';const oldOffers=createHash('sha256'),newOffers=createHash('sha256'),offerTable= snapshotTables(before.db).find(t=>t.name==='article_offers')!;
  const a=snapshotRows(before.db,offerTable,['source_id','item_id']),b=snapshotRows(after.db,offerTable,['source_id','item_id']);let u=a.next(),v=b.next(),affectedOfferOrders=0;
  const key=(row:SnapshotRow)=>['source_id','item_id'].map(k=>{const c=row[offerTable.columns.indexOf(k)];if(c[0]!=='text')refuse('offer_key');return c;});
  try{while(!u.done||!v.done){before.verify();after.verify();const ku=u.done?null:key(u.value),kv=v.done?null:key(v.value);let order=ku===null?1:kv===null?-1:0;
   if(ku&&kv)for(let i=0;i<2&&!order;i++)order=Buffer.compare(Buffer.from(ku[i][1],'hex'),Buffer.from(kv[i][1],'hex'));
   const old=order<=0&&!u.done?{key:ku,sourceOrder:articleOfferSourceOrder(before.db,offerTable,u.value)}:null,next=order>=0&&!v.done?{key:kv,sourceOrder:articleOfferSourceOrder(after.db,offerTable,v.value)}:null;
   if(old)oldOffers.update(canonicalJson(old)).update('\n');if(next)newOffers.update(canonicalJson(next)).update('\n');
   if(canonicalJson(old)!==canonicalJson(next)||!u.done&&!v.done&&order===0&&snapshotRowWire(u.value)!==snapshotRowWire(v.value)){write({format:'keryx-held-native-catchup-offer-order-v1',provisional:true,before:old,after:next},cap.projectionFrameBytes);affectedOfferOrders++;}
   if(order<=0)u=a.next();if(order>=0)v=b.next();
  }}finally{a.return();b.return();}
  stage='seal';before.hash();after.hash();before.verify();after.verify();
  const result={format:'keryx-held-native-catchup-completion-v1',sealedData:true,delta:completion,beforeProjectionCensus:oldCensus.finish(),afterProjectionCensus:newCensus.finish(),beforeOfferOrderDigest:oldOffers.digest('hex'),afterOfferOrderDigest:newOffers.digest('hex'),affectedProjectionPackets,affectedOfferOrders,
   holds:[...holds].sort(),independentApplierQualificationRequired:true,contentSha256:contentHash.digest('hex'),framesBeforeCompletion:frames,bytesBeforeCompletion:bytes,targetVerified:false,applicationAuthority:false,nativeFactoryQualified:false,targetWrites:0};
  write(result,cap.projectionFrameBytes,true);fsyncSync(fd);closeSync(fd);fd=undefined;const sealed=join(folder,'input.ndjson');renameSync(file,sealed);file=sealed;
  if(process.platform!=='win32'){const directory=openSync(folder,constants.O_RDONLY);try{fsyncSync(directory);}finally{closeSync(directory);}}
  before.verify();after.verify();const expected=fileHash.digest('hex'),readFd=openSync(sealed,constants.O_RDONLY|(constants.O_NOFOLLOW??0)),actual=createHash('sha256');try{const st=fstatSync(readFd);if(!st.isFile()||st.nlink!==1||st.size!==bytes)refuse('spool_readback');const chunk=Buffer.alloc(MiB);for(let offset=0;;){check();const n=readSync(readFd,chunk,0,chunk.length,offset);if(!n)break;offset+=n;actual.update(chunk.subarray(0,n));}if(actual.digest('hex')!==expected)refuse('spool_readback');}finally{closeSync(readFd);}before.verify();after.verify();before.close();before=undefined;after.close();after=undefined;finished=true;return Object.freeze({format:'keryx-held-native-catchup-input-data-v1',path:sealed,sha256:expected,bytes,frames,completion:result,targetVerified:false,applicationAuthority:false,nativeFactoryQualified:false,targetWrites:0});
 }catch(error){if(error instanceof HeldCatchupInputRefused)throw error;if(error instanceof TypedSnapshotDeltaRefused)throw error;refuse('input_unavailable_'+stage);}
  finally{
   let disposeFailed=false;try{await stream.return(undefined as never);}catch{disposeFailed=true;}
   for(const source of [before,after])try{source?.close();}catch{disposeFailed=true;}
   if(fd!==undefined)try{closeSync(fd);}catch{disposeFailed=true;}
   if(!finished||disposeFailed){if(file)try{unlinkSync(file);}catch{disposeFailed=true;}if(folder)try{rmdirSync(folder);}catch{disposeFailed=true;}}
   if(disposeFailed)refuse('dispose');
  }
}
