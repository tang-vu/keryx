import { composePostgresRuntimeStores,guardPostgresRuntimeIterator } from './runtime-stores';
import type { PostgresSourceMethod } from './runtime-surface';
import { createHash } from 'node:crypto';
import { ARC_MAINNET_PROFILE } from '../../arc-network-profile';
import { config } from '../../config';
import { canonicalJson } from '../../canonical-json';
import { hasContentKey } from '../../ipfs/content-crypto';
import { openEnrolledCacheText } from '../../sources/enrolled-content-cache';
import { runClaimsEnabled } from '../../run-claims/contracts';
import type { EvidenceProvenanceLookup } from '../../research/evidence-provenance';
import type { KeryxDB } from '../keryx-db';
import { readRuntimeStorageDeployment } from '../runtime-storage-config';
import { assembleNativePostgresBusinessCore } from '../supabase-adapter';
import { refuseStorage,type StorageIdentity } from '../storage-identity';
import { createPostgresApplicationDomainAuthority } from './application-domain-authority';
import { readPrivatePostgresCredential } from './private-credential';
import { createPostgresRuntimeTransport } from './runtime-transport';
import { NATIVE_READONLY_RUNTIME_PROFILE } from './runtime-profile';
import { composeNativeFinancialObservation } from './financial-observation';
import { z } from 'zod';
import { digestSchema as accountDigestSchema } from '../../accounts/contracts';
import { publicProfilesEnabled } from '../../profiles/public-profile';
const facades=new WeakMap<object,{identity:Readonly<StorageIdentity>;guard:()=>Promise<void>;close:()=>Promise<void>;closed:()=>boolean}>();
const keyFingerprint=()=>{if(!hasContentKey())refuseStorage('cache_migration_required');return createHash('sha256').update(process.env.CONTENT_MASTER_KEY!).digest('hex');};
/** Deliberately closed until all writer/current-domain/data gates are qualified. */
export async function createPostgresRuntimeAdapter():Promise<KeryxDB>{
 if(arguments.length)refuseStorage('invalid_operation');
 return refuseStorage('adapter_not_initialized');
}
/** Linux read-only observation profile. It does not admit application writers,
 * signing or the complete application writer. */
export async function createReadonlyPostgresRuntimeAdapter():Promise<KeryxDB>{
 if(arguments.length)refuseStorage('invalid_operation');
 const deployment=readRuntimeStorageDeployment();
 if(process.platform!=='linux'||deployment.backend.kind!=='postgres'||config.profile!==ARC_MAINNET_PROFILE
  ||deployment.identity.authorityMode!=='mainnet-real')refuseStorage('identity_mismatch');
 if(deployment.backend.sourceDigest!==NATIVE_READONLY_RUNTIME_PROFILE.catalogSha256)refuseStorage('adapter_not_initialized');
 const selected=deployment.backend,expectedWire=canonicalJson(deployment),credential=readPrivatePostgresCredential(selected.credentialPaths.reader,'keryx_reader'),key=keyFingerprint();
 const claimsEnabled=runClaimsEnabled(process.env),privacyActive=process.env.KERYX_RUN_PRIVACY_ENABLED==='true',publicProfilesActive=publicProfilesEnabled(process.env);
 const transport=createPostgresRuntimeTransport({endpoint:selected.endpoint,database:selected.database,role:'keryx_reader',password:credential.password},deployment.identity,selected.sourceDigest,claimsEnabled,privacyActive,()=>entry());
 let closed=false,closing:Promise<void>|undefined;
 const entry=()=>{
  if(closed)refuseStorage('adapter_not_initialized');
  if(canonicalJson(readRuntimeStorageDeployment())!==expectedWire||keyFingerprint()!==key||runClaimsEnabled(process.env)!==claimsEnabled||(process.env.KERYX_RUN_PRIVACY_ENABLED==='true')!==privacyActive||publicProfilesEnabled(process.env)!==publicProfilesActive
   ||readPrivatePostgresCredential(selected.credentialPaths.reader,'keryx_reader').fingerprint!==credential.fingerprint)refuseStorage('identity_mismatch');
 };
 const guard=async()=>{entry();await transport.verifyRuntimeAuthority();entry();};
 let retireCore=()=>{};
 const close=()=>{closed=true;retireCore();return closing??=transport.close();};
 try{
 // Each closed work closure below performs its own fresh guarded native SQL.
 // Invoke it before awaiting so its typed port captures the caller's arguments.
 // A separate fresh guard still checks authority before publishing the result.
 const read=async<T>(work:()=>Promise<T>)=>{entry();const value=await work();await guard();return value;};
 const guardedRead=async<T>(work:()=>Promise<T>)=>{
  await guard();
  let value:T;try{value=await work();}catch(error){await guard();throw error;}
  await guard();return value;
 };
 const evidence=async(lookup:EvidenceProvenanceLookup)=>{
  entry();const sources=[...lookup.sourceIds],items=[...lookup.itemIds],flags=new Set<string>();
  for(let offset=0;offset<Math.max(sources.length,items.length);offset+=500){
   const batch={sourceIds:sources.slice(offset,offset+500),itemIds:items.slice(offset,offset+500)};
   const values=await guardedRead(()=>transport.sourceObservations.readEvidenceProvenanceBatch(batch));
   for(const flag of values)flags.add(flag);
  }
  return flags;
 };
 const sourceNames=['getSource','getSourceByOnchainId','listSources','listAllSources','getSourceMeta','getSourceClaim','getSourceClaimForSource','getSourceClaimChallenge','listSourceClaims'] as const satisfies readonly PostgresSourceMethod[];
 const sourceReads=Object.freeze(Object.fromEntries(sourceNames.map(name=>[name,(...args:unknown[])=>read(()=>Reflect.apply(transport.sourceClaims[name],transport.sourceClaims,args))])));
 const stores=composePostgresRuntimeStores({transport,identity:deployment.identity,readOnly:true,privacyActive,claimsEnabled,publicProfilesActive,entry,guard,evidence});
 const {privateProfiles:profiles,profileIdentities:identities,personalHistory:history,runOwnershipHistory:ownership,runPrivacy:privacy,privateBibliographies:bibliographies,decisionReviews:reviews,topicWatches:watches,publicUsage:usage,publicLedgerRuns:ledger,deliverableAcceptance:acceptance,accountMembership:accounts,chatAccountLinks:chat,publicProfiles,ownerRunAssignments:assignments,pendingJobOwners:pending}=stores;
 const core=assembleNativePostgresBusinessCore({identity:deployment.identity,authority:createPostgresApplicationDomainAuthority(transport),assertEntry:entry,verify:guard,runtimeStores:stores,sourceClaims:transport.sourceClaims,sourceUpsert:transport.sourceUpsert.upsertSource,sourceMetaSetter:transport.sourceUpsert.setSourceMeta,sourceObservations:transport.sourceObservations});
 retireCore=core.hooks.close;
 const financial=composeNativeFinancialObservation(transport);
 const sessionRow=z.object({hash:accountDigestSchema,wallet:z.string().regex(/^0x[a-fA-F0-9]{40}$/),issued_at:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),expires_at:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)}).strict().refine(row=>row.expires_at>row.issued_at&&row.expires_at-row.issued_at<=604800000);
 const queryNames=['getQueryRun','listRecentQueries','listQueryRunsByAsker','listFollowUps','iterateRecentQueries'] as const satisfies readonly PostgresSourceMethod[];
 const text=(value:string)=>{entry();if(typeof value!=='string')refuseStorage('invalid_operation');return value;};
 const count=(value:number)=>{entry();if(typeof value!=='number')refuseStorage('invalid_operation');return value;};
 const queries=Object.freeze({
  async getQueryRun(raw:string){const id=text(raw);return guardedRead(()=>core.adapter.getQueryRun(id));},
  async listRecentQueries(raw:number){const limit=count(raw);return guardedRead(()=>core.adapter.listRecentQueries(limit));},
  async listQueryRunsByAsker(raw:string,take:number){const wallet=text(raw),limit=count(take);return guardedRead(()=>core.adapter.listQueryRunsByAsker(wallet,limit));},
  async listFollowUps(raw:string){const id=text(raw);return guardedRead(()=>core.adapter.listFollowUps(id));},
  iterateRecentQueries(raw:number){
   const limit=count(raw);
   return guardPostgresRuntimeIterator(()=>core.adapter.iterateRecentQueries(limit)[Symbol.asyncIterator](),entry,guard);
  },
 } satisfies Pick<KeryxDB,typeof queryNames[number]>);
  entry();const cache=await transport.readColdCache();await guard();entry();
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
    if(property==='decisionReviews')return reviews;
    if(property==='topicWatches')return watches;
    if(property==='publicUsage')return usage;
    if(property==='publicLedgerRuns')return privacyActive?ledger:undefined;
    if(property==='deliverableAcceptance')return acceptance;
    if(property==='accountMembership')return accounts;
    if(property==='chatAccountLinks')return chat;
    if(property==='publicProfiles')return publicProfilesActive?publicProfiles:undefined;
    if(property==='ownerRunAssignments')return assignments;
    if(property==='pendingJobOwners')return pending;
    if(typeof property==='string'&&Object.hasOwn(sourceReads,property))return sourceReads[property];
    if(typeof property==='string'&&Object.hasOwn(queries,property))return Reflect.get(queries,property);
    if(property==='getWebSession')return async(raw:string)=>{
     entry();const hash=accountDigestSchema.parse(raw);await guard();const value=await transport.applicationRead('get_web_session',{p_hash:hash});entry();if(value===null)return null;
     const row=sessionRow.parse(value);if(row.hash!==hash)refuseStorage('invalid_operation');return {hash:row.hash,wallet:row.wallet,issuedAt:row.issued_at,expiresAt:row.expires_at};
    };
    if(typeof property==='string'&&Object.hasOwn(financial,property)){
     const method=Reflect.get(financial,property) as (...args:unknown[])=>Promise<unknown>;
     return(...args:unknown[])=>read(()=>method(...args));
    }
    if(property==='getSyncStates')return(keys:readonly string[])=>read(()=>transport.getSyncStates(keys));
    if(property==='a2aOperationsSnapshot')return(nowMs:number)=>read(()=>transport.currentA2aOperationsSnapshot(nowMs));
    if(property==='readPublicHealthSnapshot')return(...args:unknown[])=>{
     entry();if(args.length!==2||typeof args[0]!=='number'||!Number.isSafeInteger(args[0])||args[0]< -8640000000000000+86400000||args[0]>8640000000000000||typeof args[1]!=='boolean')refuseStorage('invalid_operation');
     const now=args[0] as number,registry=args[1] as boolean;
     return (async()=>{try{return await read(()=>transport.readPublicHealthSnapshot(now,registry));}catch{await guard();return undefined;}})();
    };
    // Only currently qualified bounded observations escape this profile.
    if(property!=='init'&&property!=='metrics')refuseStorage('invalid_operation');
    const method=Reflect.get(target,property) as (...args:unknown[])=>Promise<unknown>;
    return (...args:unknown[])=>read(()=>Reflect.apply(method,target,args));
   },
   ownKeys:()=>[...sourceNames,...queryNames,'pendingJobOwners',...(privacyActive?['publicLedgerRuns']:[]),'accountMembership','chatAccountLinks','ownerRunAssignments',...(publicProfilesActive?['publicProfiles']:[])],getOwnPropertyDescriptor(_target,property){entry();if(property==='pendingJobOwners')return {value:pending,enumerable:false,writable:false,configurable:true};if(typeof property==='string'&&Object.hasOwn(sourceReads,property))return {value:sourceReads[property],enumerable:false,writable:false,configurable:true};if(typeof property==='string'&&Object.hasOwn(queries,property))return {value:Reflect.get(queries,property),enumerable:false,writable:false,configurable:true};if(property==='ownerRunAssignments')return {value:assignments,enumerable:false,writable:false,configurable:true};if(publicProfilesActive&&property==='publicProfiles')return {value:publicProfiles,enumerable:false,writable:false,configurable:true};if(property==='accountMembership')return {value:accounts,enumerable:false,writable:false,configurable:true};if(property==='chatAccountLinks')return {value:chat,enumerable:false,writable:false,configurable:true};return privacyActive&&property==='publicLedgerRuns'?{value:ledger,enumerable:true,writable:false,configurable:true}:undefined;},getPrototypeOf:()=>null,
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
