/** Guarded closed store composition only. Injected recordings cannot register
 * installed provenance, issue proofs, select a database or open a writer. */
import type { KeryxDB } from '../keryx-db';
import { refuseStorage,type StorageIdentity } from '../storage-identity';
import { PostgresDomainWriteOutcomeUnknown } from './domain-channel';
import type { PostgresRuntimeTransport } from './runtime-transport';
import type { EvidenceProvenanceLookup } from '../../research/evidence-provenance';
import { projectRecordedEvidenceProvenance } from '../../research/evidence-provenance';
import { z } from 'zod';
import { capturePostgresPendingOwnerSession } from '../../a2a/pending-owner-session';
import type { PendingJobOwnersStore } from '../pending-job-owners-sqlite';
import type { PublicUsageStore } from '../../usage/contracts';
import type { PublicLedgerRunReader } from '../../operator-ledger/native-runs';
import { capturePublicLedgerLimit } from './ledger-transport';
import { acceptanceWallet,networkSchema,deliverableIdSchema,type DeliverableAcceptanceStore } from '../../deliverable-acceptance/contracts';
import { interactiveSessionSchema,bindingSchema as accountBindingSchema,snapshotSchema as accountSnapshotSchema,type AccountMembershipStore } from '../../accounts/contracts';
import { recipientSchema as chatRecipientSchema,type ChatAccountLinksStore } from '../../chat-accounts/contracts';
import { publicHandle,publicProfileActor,type PublicProfilesStore } from '../../profiles/public-profile';
import type { AsyncOwnerRunAssignmentsPort } from '../../owner-run-assignments/contracts';
import { captureOwnerAssignmentReply } from './owner-assignments-transport';
import { digestSchema as accountDigestSchema } from '../../accounts/contracts';
import type { PrivateProfilesStore } from '../../profiles/private-profile';
import type { ProfileIdentitiesStore } from '../../profiles/verified-identities';
import type { PersonalHistoryStore } from '../../history/personal-history';
import type { RunOwnershipHistoryStore } from '../../run-claims/history';
import { runClaimBindingSchema,type RunClaimsStore } from '../../run-claims/contracts';
import { privacyId,privacyWallet,type PrivacyActor,type RunPrivacyStore } from '../../run-privacy/contracts';
import type { PrivateBibliographiesStore } from '../../bibliographies/private-bibliography';
import type { DecisionReviewsStore } from '../../research/decision-review-types';
import type { TopicWatchesPort,PrivateTopicWatchStore } from '../topic-watches-sqlite';
import { postgresSourcePropertyEnabled } from './runtime-surface';
export const POSTGRES_RUNTIME_STORE_NAMES=Object.freeze(['privateProfiles','profileIdentities','personalHistory','runOwnershipHistory','runPrivacy','privateBibliographies','decisionReviews','topicWatches','publicUsage','publicLedgerRuns','deliverableAcceptance','accountMembership','chatAccountLinks','publicProfiles','ownerRunAssignments','pendingJobOwners','runClaims'] as const);
export type NativePostgresRuntimeStores=Readonly<Pick<KeryxDB,typeof POSTGRES_RUNTIME_STORE_NAMES[number]>>;
export interface PostgresRuntimeStoreOptions {
 readonly transport:PostgresRuntimeTransport;readonly identity:StorageIdentity;readonly readOnly:boolean;
 readonly privacyActive:boolean;readonly claimsEnabled:boolean;readonly publicProfilesActive:boolean;
 readonly entry:()=>void;readonly guard:()=>Promise<void>;
 readonly evidence:(lookup:EvidenceProvenanceLookup)=>Promise<ReadonlySet<string>>;
}
export function composePostgresRuntimeStores(options:PostgresRuntimeStoreOptions):NativePostgresRuntimeStores {
 const {transport,identity,readOnly,privacyActive,claimsEnabled,publicProfilesActive,entry,guard,evidence}=options;
 if(typeof readOnly!=='boolean')refuseStorage('invalid_operation');
 const deployment={identity};
 // Invoke the concrete typed port before the first await, so its own fixed
 // parser captures inputs. Its SQL all9/catalog checks remain independent.
 const read=async<T>(work:()=>Promise<T>)=>{entry();let value:T;try{value=await work();}catch(error){entry();throw error;}await guard();entry();return value;};
 const guardedRead=async<T>(work:()=>Promise<T>)=>{await guard();let value:T;try{value=await work();}catch(error){await guard();throw error;}await guard();return value;};
 const mutation=<S,N extends keyof S>(store:S,name:N):S[N]=> (async(...args:unknown[])=>{
  entry();if(readOnly)refuseStorage('readonly_operation');
  let value:unknown;try{const method=store[name];if(typeof method!=='function')refuseStorage('invalid_operation');value=await Reflect.apply(method,store,args);}
  catch(error){if(error instanceof PostgresDomainWriteOutcomeUnknown)throw error;try{entry();}catch{throw new PostgresDomainWriteOutcomeUnknown();}throw error;}
  try{await guard();entry();}catch{throw new PostgresDomainWriteOutcomeUnknown();}return value;
 }) as unknown as S[N];
 const ownerCursor=z.object({createdAt:z.string().max(64).datetime({offset:true}),id:z.string().regex(/^a2a_[a-f0-9]{64}$/)}).strict();
 const pending:PendingJobOwnersStore=Object.freeze({
  assertAdmission(proof){entry();if(readOnly)refuseStorage('readonly_operation');const result=transport.pendingJobOwners.assertAdmission(proof);if(result!==undefined)refuseStorage('invalid_operation');entry();},assertAdmissionAsync:mutation(transport.pendingJobOwners,'assertAdmissionAsync'),
  async list(proof,before,id){
   entry();capturePostgresPendingOwnerSession(proof,deployment.identity,'read');
   const cursor=before===undefined?undefined:ownerCursor.parse(before),selected=id===undefined?undefined:ownerCursor.shape.id.parse(id);
   await guard();const result=await transport.pendingJobOwners.list(proof,cursor,selected);entry();return result;
  },
 } satisfies PendingJobOwnersStore);
 const usage:PublicUsageStore=Object.freeze({
  summary:window=>read(()=>transport.publicUsage.summary(window)),
  async history(window,cohort,limit){const plan=await read(()=>transport.prepareUsageHistory(window,cohort,limit,false));entry();const result=await transport.finishUsageHistory(plan);entry();return result;},
  async publishedHistory(window,cohort,limit){const plan=await read(()=>transport.prepareUsageHistory(window,cohort,limit,true));entry();const result=await transport.finishPublishedUsageHistory(plan);entry();return result;},
 } satisfies PublicUsageStore);
 const ledger:PublicLedgerRunReader=Object.freeze({async read(raw:number){entry();const take=capturePublicLedgerLimit(raw);await guard();const result=await transport.publicLedgerRuns.read(take);entry();return result;}});
 // Capture selectors before the authority await, then read the current original
 // and sharing consent in the final native snapshot. No stale pre-guard result.
 const acceptance:DeliverableAcceptanceStore=Object.freeze({
  async read(owner,network,id){entry();const args=[acceptanceWallet(owner),networkSchema.parse(network),deliverableIdSchema.parse(id)] as const;await guard();const result=await transport.deliverableAcceptance.read(...args);entry();return result;},
  async publicState(network,id){entry();const args=[networkSchema.parse(network),deliverableIdSchema.parse(id)] as const;await guard();const result=await transport.deliverableAcceptance.publicState(...args);entry();return result;},
  async metrics(network){entry();const selected=networkSchema.parse(network);await guard();const result=await transport.deliverableAcceptance.metrics(selected);entry();return result;},
  submit:mutation(transport.deliverableAcceptance,'submit'),
 } satisfies DeliverableAcceptanceStore);
 const accounts:AccountMembershipStore=Object.freeze({
  async offer(raw,b){entry();const session=interactiveSessionSchema.parse(raw),binding=accountBindingSchema.parse(b);await guard();const value=await transport.accountMembership.offer(session,binding);entry();return value;},
  async resolve(raw,b){entry();const session=interactiveSessionSchema.parse(raw),binding=accountBindingSchema.parse(b);await guard();const value=await transport.accountMembership.resolve(session,binding);entry();return value;},
  async assertCurrent(raw){entry();const snapshot=accountSnapshotSchema.parse(raw);await guard();await transport.accountMembership.assertCurrent(snapshot);entry();},
  ...(privacyActive&&transport.accountMembership.prepareAsyncHistoryFence?{async prepareAsyncHistoryFence(raw,observed,deadline){
   entry();const final=await read(()=>transport.accountMembership.prepareAsyncHistoryFence!(raw,observed,deadline));let unused=true;
   return async()=>{if(!unused)refuseStorage('invalid_operation');unused=false;entry();await guard();await final();entry();};
  }}:{}),
  resume:mutation(transport.accountMembership,'resume'),issue:mutation(transport.accountMembership,'issue'),take:mutation(transport.accountMembership,'take'),complete:mutation(transport.accountMembership,'complete'),unlink:mutation(transport.accountMembership,'unlink'),revokeSession:mutation(transport.accountMembership,'revokeSession'),
 } satisfies AccountMembershipStore);
 const chat:ChatAccountLinksStore=Object.freeze({
  async preview(raw,b){entry();const hash=accountDigestSchema.parse(raw),binding=accountBindingSchema.parse(b);await guard();const value=await transport.chatAccountLinks.preview(hash,binding);entry();return value;},
  async lookup(raw,b){entry();const recipient=chatRecipientSchema.parse(raw),binding=accountBindingSchema.parse(b);await guard();const value=await transport.chatAccountLinks.lookup(recipient,binding);entry();return value;},
  async list(raw){entry();const snapshot=accountSnapshotSchema.parse(raw);await guard();const value=await transport.chatAccountLinks.list(snapshot);entry();return value;},
  issue:mutation(transport.chatAccountLinks,'issue'),complete:mutation(transport.chatAccountLinks,'complete'),unlink:mutation(transport.chatAccountLinks,'unlink'),unlinkAccount:mutation(transport.chatAccountLinks,'unlinkAccount'),
 } satisfies ChatAccountLinksStore);
 const publicProfiles:PublicProfilesStore=Object.freeze({
  async read(raw){entry();const handle=publicHandle.parse(raw);await guard();const value=await transport.publicProfiles.read(handle);entry();return value;},
  async settings(raw){entry();const actor=publicProfileActor.parse(raw);await guard();const value=await transport.publicProfiles.settings(actor);entry();return value;},
  async sitemap(raw){entry();const take=z.number().int().min(1).max(1000).parse(raw);await guard();const value=await transport.publicProfiles.sitemap(take);entry();return value;},
  update:mutation(transport.publicProfiles,'update'),unpublish:mutation(transport.publicProfiles,'unpublish'),
 } satisfies PublicProfilesStore);
 const assignments:AsyncOwnerRunAssignmentsPort=Object.freeze({
  mode:'native-postgres-async-v1',act:mutation(transport.ownerRunAssignments,'act'),
  async reply(session,wallet,origin,expected,receipt){
   entry();const args=captureOwnerAssignmentReply(session,wallet,origin,expected,receipt);await guard();
   const response=await transport.ownerRunAssignments.reply(...args);entry();return response;
  },
 } satisfies AsyncOwnerRunAssignmentsPort);
 const profiles:PrivateProfilesStore=Object.freeze({get:(owner,network)=>read(()=>transport.privateProfiles.get(owner,network)),update:mutation(transport.privateProfiles,'update'),delete:mutation(transport.privateProfiles,'delete')} satisfies PrivateProfilesStore);
 const identities:ProfileIdentitiesStore=Object.freeze({list:owner=>read(()=>transport.profileIdentities.list(owner)),begin:mutation(transport.profileIdentities,'begin'),consume:mutation(transport.profileIdentities,'consume'),complete:mutation(transport.profileIdentities,'complete'),unlink:mutation(transport.profileIdentities,'unlink')} satisfies ProfileIdentitiesStore);
 const history:PersonalHistoryStore=Object.freeze({list:(owner,query)=>read(()=>transport.personalHistory.list(owner,query)),receipts:(id,take)=>read(()=>transport.personalHistory.receipts!(id,take))} satisfies PersonalHistoryStore);
 const ownership:RunOwnershipHistoryStore=Object.freeze({list:(owner,query)=>read(()=>transport.runOwnershipHistory.list(owner,query)),read:(owner,binding,id)=>read(()=>transport.runOwnershipHistory.read(owner,binding,id))} satisfies RunOwnershipHistoryStore);
 const privacy:RunPrivacyStore=Object.freeze({
  creationReady:mutation(transport.runPrivacy,'creationReady'),
  async read(rawId,rawActor){
   entry();const id=privacyId.parse(rawId),actor:PrivacyActor|undefined=rawActor?{wallet:privacyWallet.parse(rawActor.wallet),binding:runClaimBindingSchema.parse(rawActor.binding)}:undefined;
   return guardedRead(async()=>{const value=await transport.runPrivacy.read(id,actor);entry();return value.item?{...value,item:{...value.item,run:await projectRecordedEvidenceProvenance(evidence,value.item.run)}}:value;});
  },owner:(id,actor)=>read(()=>transport.runPrivacy.owner(id,actor)),
  list:query=>read(()=>transport.runPrivacy.list(query)),defaults:actor=>read(()=>transport.runPrivacy.defaults(actor)),
  questions:ids=>read(()=>transport.runPrivacy.questions!(ids)),sourceHistory:()=>read(()=>transport.runPrivacy.sourceHistory!()),
  learningPage:query=>read(()=>transport.runPrivacy.learningPage!(query)),archivePage:query=>read(()=>transport.runPrivacy.archivePage!(query)),
  memories:take=>read(()=>transport.runPrivacy.memories(take)),offers:take=>read(()=>transport.runPrivacy.offers(take)),
  settlement:id=>read(()=>transport.runPrivacy.settlement(id)),pending:id=>read(()=>transport.runPrivacy.pending(id)),setDefault:mutation(transport.runPrivacy,'setDefault'),change:mutation(transport.runPrivacy,'change'),erase:mutation(transport.runPrivacy,'erase'),export:mutation(transport.runPrivacy,'export'),
 } satisfies RunPrivacyStore);
 // The Core's public-only list/stream branches consult its own privacy store.
 // Keep owner/export originals exact; only Source's public read is demoted.
 const bibliographies:PrivateBibliographiesStore=Object.freeze({list:owner=>read(()=>transport.privateBibliographies.list(owner)),read:token=>read(()=>transport.privateBibliographies.read(token)),create:mutation(transport.privateBibliographies,'create'),replace:mutation(transport.privateBibliographies,'replace'),revoke:mutation(transport.privateBibliographies,'revoke')} satisfies PrivateBibliographiesStore);
 const reviews:DecisionReviewsStore=Object.freeze({ready:()=>read(()=>transport.decisionReviews.ready()),read:(owner,id)=>read(()=>transport.decisionReviews.read(owner,id)),list:(owner,run)=>read(()=>transport.decisionReviews.list(owner,run)),metrics:(network,since,until)=>read(()=>transport.decisionReviews.metrics(network,since,until)),capture:mutation(transport.decisionReviews,'capture'),begin:mutation(transport.decisionReviews,'begin'),verdict:mutation(transport.decisionReviews,'verdict'),consume:mutation(transport.decisionReviews,'consume'),cancel:mutation(transport.decisionReviews,'cancel'),expire:mutation(transport.decisionReviews,'expire'),observe:mutation(transport.decisionReviews,'observe')} satisfies DecisionReviewsStore);
 const watches:TopicWatchesPort=Object.freeze({bindSession(session){entry();const bound=transport.topicWatches.bindSession(session);return Object.freeze({list:()=>read(()=>bound.list()),read:key=>read(()=>bound.read(key)),compareAndSwap:mutation(bound,'compareAndSwap')} satisfies PrivateTopicWatchStore);}} satisfies TopicWatchesPort);

 const claims:RunClaimsStore=Object.freeze({assertAvailable:()=>read(()=>transport.runClaims.assertAvailable()),issue:mutation(transport.runClaims,'issue'),claim:mutation(transport.runClaims,'claim')});
 const stores:NativePostgresRuntimeStores={privateProfiles:profiles,profileIdentities:identities,personalHistory:history,
  runOwnershipHistory:privacyActive||claimsEnabled?ownership:undefined,runPrivacy:privacyActive?privacy:undefined,runClaims:claimsEnabled?claims:undefined,
  privateBibliographies:bibliographies,decisionReviews:reviews,topicWatches:watches,publicUsage:usage,
  publicLedgerRuns:readOnly&&privacyActive?ledger:undefined,deliverableAcceptance:acceptance,accountMembership:accounts,chatAccountLinks:chat,
  publicProfiles:privacyActive&&publicProfilesActive?publicProfiles:undefined,ownerRunAssignments:assignments,pendingJobOwners:pending,
 };
 const surface={mainnet:identity.authorityMode==='mainnet-real',readOnly,privacyActive,claimsEnabled,publicProfilesActive};
 return Object.freeze(Object.fromEntries(POSTGRES_RUNTIME_STORE_NAMES.filter(name=>postgresSourcePropertyEnabled(name,surface)&&stores[name]!==undefined).map(name=>[name,stores[name]]))) as NativePostgresRuntimeStores;
}
/** Every acquired iterator remains guarded, including return/early-close paths.
 * Cleanup still runs after retirement; no late value may escape that cleanup. */
export function guardPostgresRuntimeIterator<T>(create:()=>AsyncIterator<T>,entry:()=>void,guard:()=>Promise<void>):AsyncGenerator<Awaited<T>>{
 return(async function*(){
  entry();await guard();const iterator=create();
  try{for(;;){entry();await guard();const item=await iterator.next();entry();await guard();if(item.done)return;entry();yield item.value;}}
  finally{let stale:unknown;try{entry();}catch(error){stale=error;}try{await iterator.return?.();}finally{if(stale)throw stale;entry();await guard();}}
 })();
}
