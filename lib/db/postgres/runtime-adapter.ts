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
import type { DecisionReviewsStore } from '../../research/decision-review-types';
import type { TopicWatchesPort,PrivateTopicWatchStore } from '../topic-watches-sqlite';
import type { KeryxDB } from '../keryx-db';
import { readRuntimeStorageDeployment } from '../runtime-storage-config';
import { assembleNativePostgresBusinessCore } from '../supabase-adapter';
import { refuseStorage,type StorageIdentity } from '../storage-identity';
import { createPostgresApplicationDomainAuthority } from './application-domain-authority';
import { readPrivatePostgresCredential } from './private-credential';
import { createPostgresRuntimeTransport } from './runtime-transport';
import { NATIVE_READONLY_RUNTIME_PROFILE } from './runtime-profile';
import { composeNativeFinancialObservation } from './financial-observation';
import type { PublicUsageStore } from '../../usage/contracts';
import type { PublicLedgerRunReader } from '../../operator-ledger/native-runs';
import { capturePublicLedgerLimit } from './ledger-transport';
import { z } from 'zod';
import { interactiveSessionSchema,bindingSchema as accountBindingSchema,snapshotSchema as accountSnapshotSchema,digestSchema as accountDigestSchema,type AccountMembershipStore } from '../../accounts/contracts';
import { recipientSchema as chatRecipientSchema,type ChatAccountLinksStore } from '../../chat-accounts/contracts';
import { publicProfilesEnabled,publicHandle,publicProfileActor,type PublicProfilesStore } from '../../profiles/public-profile';
import type { AsyncOwnerRunAssignmentsPort } from '../../owner-run-assignments/contracts';
import { captureOwnerAssignmentReply } from './owner-assignments-transport';
import { acceptanceWallet,networkSchema,deliverableIdSchema,type DeliverableAcceptanceStore } from '../../deliverable-acceptance/contracts';
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
 const transport=createPostgresRuntimeTransport({endpoint:selected.endpoint,database:selected.database,role:'keryx_reader',password:credential.password},deployment.identity,selected.sourceDigest,claimsEnabled,privacyActive);
 let closed=false,closing:Promise<void>|undefined;
 const entry=()=>{
  if(closed)refuseStorage('adapter_not_initialized');
  if(canonicalJson(readRuntimeStorageDeployment())!==expectedWire||keyFingerprint()!==key||runClaimsEnabled(process.env)!==claimsEnabled||(process.env.KERYX_RUN_PRIVACY_ENABLED==='true')!==privacyActive||publicProfilesEnabled(process.env)!==publicProfilesActive
   ||readPrivatePostgresCredential(selected.credentialPaths.reader,'keryx_reader').fingerprint!==credential.fingerprint)refuseStorage('identity_mismatch');
 };
 const guard=async()=>{entry();await transport.verifyRuntimeAuthority();entry();};
 const core=assembleNativePostgresBusinessCore({identity:deployment.identity,authority:createPostgresApplicationDomainAuthority(transport),assertEntry:entry,verify:guard});
 const close=()=>{closed=true;core.hooks.close();return closing??=transport.close();};
 // Each closed work closure below performs its own fresh guarded native SQL.
 // Invoke it before awaiting so its typed port captures the caller's arguments.
 // A separate fresh guard still checks authority before publishing the result.
 const read=async<T>(work:()=>Promise<T>)=>{entry();const value=await work();await guard();return value;};
 const financial=composeNativeFinancialObservation(transport);
 const usage:PublicUsageStore=Object.freeze({
  summary:window=>read(()=>transport.publicUsage.summary(window)),
  async history(window,cohort,limit){const plan=await read(()=>transport.prepareUsageHistory(window,cohort,limit,false));entry();const result=await transport.finishUsageHistory(plan);entry();return result;},
  async publishedHistory(window,cohort,limit){const plan=await read(()=>transport.prepareUsageHistory(window,cohort,limit,true));entry();const result=await transport.finishPublishedUsageHistory(plan);entry();return result;},
 } satisfies PublicUsageStore);
 const ledger:PublicLedgerRunReader=Object.freeze({async read(raw:number){entry();const take=capturePublicLedgerLimit(raw);await guard();const result=await transport.publicLedgerRuns.read(take);entry();return result;}});
 const readonly=async():Promise<never>=>refuseStorage('readonly_operation');
 // Capture selectors before the authority await, then read the current original
 // and sharing consent in the final native snapshot. No stale pre-guard result.
 const acceptance:DeliverableAcceptanceStore=Object.freeze({
  async read(owner,network,id){entry();const args=[acceptanceWallet(owner),networkSchema.parse(network),deliverableIdSchema.parse(id)] as const;await guard();const result=await transport.deliverableAcceptance.read(...args);entry();return result;},
  async publicState(network,id){entry();const args=[networkSchema.parse(network),deliverableIdSchema.parse(id)] as const;await guard();const result=await transport.deliverableAcceptance.publicState(...args);entry();return result;},
  async metrics(network){entry();const selected=networkSchema.parse(network);await guard();const result=await transport.deliverableAcceptance.metrics(selected);entry();return result;},
  submit:readonly,
 } satisfies DeliverableAcceptanceStore);
 const accounts:AccountMembershipStore=Object.freeze({
  async offer(raw,b){entry();const session=interactiveSessionSchema.parse(raw),binding=accountBindingSchema.parse(b);await guard();const value=await transport.accountMembership.offer(session,binding);entry();return value;},
  async resolve(raw,b){entry();const session=interactiveSessionSchema.parse(raw),binding=accountBindingSchema.parse(b);await guard();const value=await transport.accountMembership.resolve(session,binding);entry();return value;},
  async assertCurrent(raw){entry();const snapshot=accountSnapshotSchema.parse(raw);await guard();await transport.accountMembership.assertCurrent(snapshot);entry();},
  ...(privacyActive&&transport.accountMembership.prepareAsyncHistoryFence?{async prepareAsyncHistoryFence(raw,observed,deadline){
   entry();const final=await read(()=>transport.accountMembership.prepareAsyncHistoryFence!(raw,observed,deadline));let unused=true;
   return async()=>{if(!unused)refuseStorage('invalid_operation');unused=false;entry();await guard();await final();entry();};
  }}:{}),
  resume:readonly,issue:readonly,take:readonly,complete:readonly,unlink:readonly,revokeSession:readonly,
 } satisfies AccountMembershipStore);
 Object.defineProperty(core.adapter,'accountMembership',{value:accounts,enumerable:false,writable:false,configurable:true});
 const chat:ChatAccountLinksStore=Object.freeze({
  async preview(raw,b){entry();const hash=accountDigestSchema.parse(raw),binding=accountBindingSchema.parse(b);await guard();const value=await transport.chatAccountLinks.preview(hash,binding);entry();return value;},
  async lookup(raw,b){entry();const recipient=chatRecipientSchema.parse(raw),binding=accountBindingSchema.parse(b);await guard();const value=await transport.chatAccountLinks.lookup(recipient,binding);entry();return value;},
  async list(raw){entry();const snapshot=accountSnapshotSchema.parse(raw);await guard();const value=await transport.chatAccountLinks.list(snapshot);entry();return value;},
  issue:readonly,complete:readonly,unlink:readonly,unlinkAccount:readonly,
 } satisfies ChatAccountLinksStore);
 Object.defineProperty(core.adapter,'chatAccountLinks',{value:chat,enumerable:false,writable:false,configurable:true});
 const publicProfiles:PublicProfilesStore=Object.freeze({
  async read(raw){entry();const handle=publicHandle.parse(raw);await guard();const value=await transport.publicProfiles.read(handle);entry();return value;},
  async settings(raw){entry();const actor=publicProfileActor.parse(raw);await guard();const value=await transport.publicProfiles.settings(actor);entry();return value;},
  async sitemap(raw){entry();const take=z.number().int().min(1).max(1000).parse(raw);await guard();const value=await transport.publicProfiles.sitemap(take);entry();return value;},
  update:readonly,unpublish:readonly,
 } satisfies PublicProfilesStore);
 if(publicProfilesActive)Object.defineProperty(core.adapter,'publicProfiles',{value:publicProfiles,enumerable:false,writable:false,configurable:true});
 const assignments:AsyncOwnerRunAssignmentsPort=Object.freeze({
  mode:'native-postgres-async-v1',act:readonly,
  async reply(session,wallet,origin,expected,receipt){
   entry();const args=captureOwnerAssignmentReply(session,wallet,origin,expected,receipt);await guard();
   const response=await transport.ownerRunAssignments.reply(...args);entry();return response;
  },
 } satisfies AsyncOwnerRunAssignmentsPort);
 Object.defineProperty(core.adapter,'ownerRunAssignments',{value:assignments,enumerable:false,writable:false,configurable:true});
 const sessionRow=z.object({hash:accountDigestSchema,wallet:z.string().regex(/^0x[a-fA-F0-9]{40}$/),issued_at:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),expires_at:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)}).strict().refine(row=>row.expires_at>row.issued_at&&row.expires_at-row.issued_at<=604800000);
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
 const reviews:DecisionReviewsStore=Object.freeze({ready:()=>read(()=>transport.decisionReviews.ready()),read:(owner,id)=>read(()=>transport.decisionReviews.read(owner,id)),list:(owner,run)=>read(()=>transport.decisionReviews.list(owner,run)),metrics:(network,since,until)=>read(()=>transport.decisionReviews.metrics(network,since,until)),capture:readonly,begin:readonly,verdict:readonly,consume:readonly,cancel:readonly,expire:readonly,observe:readonly} satisfies DecisionReviewsStore);
 const watches:TopicWatchesPort=Object.freeze({bindSession(session){entry();const bound=transport.topicWatches.bindSession(session);return Object.freeze({list:()=>read(()=>bound.list()),read:key=>read(()=>bound.read(key)),compareAndSwap:readonly} satisfies PrivateTopicWatchStore);}} satisfies TopicWatchesPort);
 try{
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
   ownKeys:()=>[...(privacyActive?['publicLedgerRuns']:[]),'accountMembership','chatAccountLinks','ownerRunAssignments',...(publicProfilesActive?['publicProfiles']:[])],getOwnPropertyDescriptor(_target,property){entry();if(property==='ownerRunAssignments')return {value:assignments,enumerable:false,writable:false,configurable:true};if(publicProfilesActive&&property==='publicProfiles')return {value:publicProfiles,enumerable:false,writable:false,configurable:true};if(property==='accountMembership')return {value:accounts,enumerable:false,writable:false,configurable:true};if(property==='chatAccountLinks')return {value:chat,enumerable:false,writable:false,configurable:true};return privacyActive&&property==='publicLedgerRuns'?{value:ledger,enumerable:true,writable:false,configurable:true}:undefined;},getPrototypeOf:()=>null,
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
