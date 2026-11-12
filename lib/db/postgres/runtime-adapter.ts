import { createHash } from 'node:crypto';
import { ARC_MAINNET_PROFILE } from '../../arc-network-profile';
import { config } from '../../config';
import { canonicalJson } from '../../canonical-json';
import { hasContentKey } from '../../ipfs/content-crypto';
import { openEnrolledCacheText } from '../../sources/enrolled-content-cache';
import type { PrivateProfilesStore } from '../../profiles/private-profile';
import type { ProfileIdentitiesStore } from '../../profiles/verified-identities';
import type { PersonalHistoryStore } from '../../history/personal-history';
import type { RunOwnershipHistoryStore } from '../../run-claims/history';
import { runClaimsEnabled } from '../../run-claims/contracts';
import type { RunPrivacyStore } from '../../run-privacy/contracts';
import type { PrivateBibliographiesStore } from '../../bibliographies/private-bibliography';
import type { TopicWatchesPort,PrivateTopicWatchStore } from '../topic-watches-sqlite';
import type { KeryxDB } from '../keryx-db';
import { readRuntimeStorageDeployment } from '../runtime-storage-config';
import { assembleNativePostgresBusinessCore } from '../supabase-adapter';
import { refuseStorage,type StorageIdentity } from '../storage-identity';
import { createPostgresApplicationDomainAuthority } from './application-domain-authority';
import { readPrivatePostgresCredential } from './private-credential';
import { createPostgresRuntimeTransport } from './runtime-transport';
import { NATIVE_READONLY_RUNTIME_PROFILE } from './runtime-profile';
const facades=new WeakMap<object,{identity:Readonly<StorageIdentity>;guard:()=>Promise<void>;close:()=>Promise<void>;closed:()=>boolean}>();
const keyFingerprint=()=>{if(!hasContentKey())refuseStorage('cache_migration_required');return createHash('sha256').update(process.env.CONTENT_MASTER_KEY!).digest('hex');};
/** Deliberately closed until all writer/current-domain/data gates are qualified. */
export async function createPostgresRuntimeAdapter():Promise<KeryxDB>{
 if(arguments.length)refuseStorage('invalid_operation');
 return refuseStorage('adapter_not_initialized');
}
/** Linux read-only observation profile. It does not admit application writers,
 * signing or the still-unported claim/account writers. */
export async function createReadonlyPostgresRuntimeAdapter():Promise<KeryxDB>{
 if(arguments.length)refuseStorage('invalid_operation');
 const deployment=readRuntimeStorageDeployment();
 if(process.platform!=='linux'||deployment.backend.kind!=='postgres'||config.profile!==ARC_MAINNET_PROFILE
  ||deployment.identity.authorityMode!=='mainnet-real')refuseStorage('identity_mismatch');
 if(deployment.backend.sourceDigest!==NATIVE_READONLY_RUNTIME_PROFILE.catalogSha256)refuseStorage('adapter_not_initialized');
 const selected=deployment.backend,expectedWire=canonicalJson(deployment),credential=readPrivatePostgresCredential(selected.credentialPaths.reader,'keryx_reader'),key=keyFingerprint();
 const claimsEnabled=runClaimsEnabled(process.env),privacyActive=process.env.KERYX_RUN_PRIVACY_ENABLED==='true';
 const transport=createPostgresRuntimeTransport({endpoint:selected.endpoint,database:selected.database,role:'keryx_reader',password:credential.password},deployment.identity,selected.sourceDigest,claimsEnabled);
 let closed=false,closing:Promise<void>|undefined;
 const entry=()=>{
  if(closed)refuseStorage('adapter_not_initialized');
  if(canonicalJson(readRuntimeStorageDeployment())!==expectedWire||keyFingerprint()!==key||runClaimsEnabled(process.env)!==claimsEnabled||(process.env.KERYX_RUN_PRIVACY_ENABLED==='true')!==privacyActive
   ||readPrivatePostgresCredential(selected.credentialPaths.reader,'keryx_reader').fingerprint!==credential.fingerprint)refuseStorage('identity_mismatch');
 };
 const guard=async()=>{entry();await transport.verifyRuntimeAuthority();entry();};
 const core=assembleNativePostgresBusinessCore({identity:deployment.identity,authority:createPostgresApplicationDomainAuthority(transport),assertEntry:entry,verify:guard});
 const close=()=>{closed=true;core.hooks.close();return closing??=transport.close();};
 // Each closed work closure below performs its own fresh guarded native SQL.
 // Invoke it before awaiting so its typed port captures the caller's arguments.
 // A separate fresh guard still checks authority before publishing the result.
 const read=async<T>(work:()=>Promise<T>)=>{entry();const value=await work();await guard();return value;};
 const readonly=async():Promise<never>=>refuseStorage('readonly_operation');
 const profiles:PrivateProfilesStore=Object.freeze({get:(owner,network)=>read(()=>transport.privateProfiles.get(owner,network)),update:readonly,delete:readonly} satisfies PrivateProfilesStore);
 const identities:ProfileIdentitiesStore=Object.freeze({list:owner=>read(()=>transport.profileIdentities.list(owner)),begin:readonly,consume:readonly,complete:readonly,unlink:readonly} satisfies ProfileIdentitiesStore);
 const history:PersonalHistoryStore=Object.freeze({list:(owner,query)=>read(()=>transport.personalHistory.list(owner,query)),receipts:(id,take)=>read(()=>transport.personalHistory.receipts!(id,take))} satisfies PersonalHistoryStore);
 const ownership:RunOwnershipHistoryStore=Object.freeze({list:(owner,query)=>read(()=>transport.runOwnershipHistory.list(owner,query)),read:(owner,binding,id)=>read(()=>transport.runOwnershipHistory.read(owner,binding,id))} satisfies RunOwnershipHistoryStore);
 const privacy:RunPrivacyStore=Object.freeze({
  creationReady:readonly,read:(id,actor)=>read(()=>transport.runPrivacy.read(id,actor)),owner:(id,actor)=>read(()=>transport.runPrivacy.owner(id,actor)),
  list:query=>read(()=>transport.runPrivacy.list(query)),defaults:actor=>read(()=>transport.runPrivacy.defaults(actor)),
  questions:ids=>read(()=>transport.runPrivacy.questions!(ids)),sourceHistory:()=>read(()=>transport.runPrivacy.sourceHistory!()),
  learningPage:query=>read(()=>transport.runPrivacy.learningPage!(query)),archivePage:query=>read(()=>transport.runPrivacy.archivePage!(query)),
  memories:take=>read(()=>transport.runPrivacy.memories(take)),offers:take=>read(()=>transport.runPrivacy.offers(take)),
  settlement:id=>read(()=>transport.runPrivacy.settlement(id)),pending:id=>read(()=>transport.runPrivacy.pending(id)),setDefault:readonly,change:readonly,erase:readonly,export:readonly,
 } satisfies RunPrivacyStore);
 const bibliographies:PrivateBibliographiesStore=Object.freeze({list:owner=>read(()=>transport.privateBibliographies.list(owner)),read:token=>read(()=>transport.privateBibliographies.read(token)),create:readonly,replace:readonly,revoke:readonly} satisfies PrivateBibliographiesStore);
 const watches:TopicWatchesPort=Object.freeze({bindSession(session){entry();const bound=transport.topicWatches.bindSession(session);return Object.freeze({list:()=>read(()=>bound.list()),read:key=>read(()=>bound.read(key)),compareAndSwap:readonly} satisfies PrivateTopicWatchStore);}} satisfies TopicWatchesPort);
 try{
  entry();const cache=await transport.readColdCache();entry();
  for(const row of cache.cacheRows){openEnrolledCacheText(row.text,row.sourceId,deployment.identity);entry();}
  await core.adapter.init();await guard();
  const facade=new Proxy(core.adapter,{
   get(target,property){
    if(property==='then')return undefined;entry();
    if(property==='privateProfiles')return profiles;
    if(property==='profileIdentities')return identities;
    if(property==='personalHistory')return history;
    if(property==='runOwnershipHistory')return ownership;
    if(property==='runPrivacyActive')return privacyActive;
    if(property==='runPrivacy')return privacyActive?privacy:undefined;
    if(property==='privateBibliographies')return bibliographies;
    if(property==='topicWatches')return watches;
    // Only currently qualified bounded observations escape this profile.
    if(property!=='init'&&property!=='metrics')refuseStorage('invalid_operation');
    const method=Reflect.get(target,property) as (...args:unknown[])=>Promise<unknown>;
    return (...args:unknown[])=>read(()=>Reflect.apply(method,target,args));
   },
   ownKeys:()=>[],getOwnPropertyDescriptor:()=>undefined,getPrototypeOf:()=>null,
   setPrototypeOf:()=>false,set:()=>false,defineProperty:()=>false,deleteProperty:()=>false,preventExtensions:()=>false,
  });
  facades.set(facade,{identity:deployment.identity,guard,close,closed:()=>closed});
  await guard();return facade;
 }catch(error){await close().catch(()=>{});throw error;}
}
/** Only the zero-argument factory owns this private installed-facade record. */
export async function assertPostgresRuntimeIdentity(adapter:unknown,access:'read'|'write'='read'):Promise<Readonly<StorageIdentity>>{
 if(!adapter||typeof adapter!=='object'||!['read','write'].includes(access))refuseStorage('invalid_operation');
 const record=facades.get(adapter);if(!record||record.closed())refuseStorage('adapter_not_initialized');
 if(access==='write')refuseStorage('readonly_operation');
 await record.guard();if(record.closed())refuseStorage('adapter_not_initialized');return record.identity;
}
export function closePostgresRuntimeAdapter(adapter:unknown):Promise<void>{
 if(!adapter||typeof adapter!=='object')refuseStorage('invalid_operation');const record=facades.get(adapter);if(!record)refuseStorage('invalid_operation');return record.close();
}
