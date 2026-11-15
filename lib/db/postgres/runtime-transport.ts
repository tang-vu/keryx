import { z } from 'zod';
import { canonicalJson } from '../../canonical-json';
import { validateStorageIdentity,type StorageIdentity } from '../storage-identity';
import { PostgresStorageUnavailable,postgresPoolConfiguration,type PostgresConnectionOptions } from './connection';
import { createPostgresDomainChannel,type PostgresDomainChannel } from './domain-channel';
import { composePostgresUserDomainTransport,type PostgresUserDomainTransport } from './user-domain-transport';
import { composePostgresHealth,type PostgresHealthTransport } from './health-transport';
import { composePostgresUsage,type PostgresUsageTransport } from './usage-transport';
import { composePostgresPublicLedger,type PostgresPublicLedgerTransport } from './ledger-transport';
import { composePostgresAcceptance } from './acceptance-transport';
import type { DeliverableAcceptanceStore } from '../../deliverable-acceptance/contracts';
import type { AccountMembershipStore } from '../../accounts/contracts';
import { composePostgresAccounts } from './accounts-transport';
import { composePostgresAccountHistory } from './account-history-transport';
import { composePostgresChatLinks } from './chat-links-transport';
import type { ChatAccountLinksStore } from '../../chat-accounts/contracts';
import type { PublicProfilesStore } from '../../profiles/public-profile';
import { composePostgresPublicProfiles } from './public-profiles-transport';
import { composePostgresOwnerAssignments } from './owner-assignments-transport';
import { composePostgresA2aOriginals,type PostgresA2aOriginalsPort } from './a2a-originals-transport';
import { composePostgresHostedAdmission,type PostgresHostedAdmissionPort } from './hosted-admission-transport';
import {composePostgresHostedLedgerTransport} from './hosted-ledger-transport';
import {NATIVE_CURRENT_DATA_INTAKE_PROFILE} from './runtime-profile';
import { composePostgresResearchPurchases,type PostgresResearchPurchasesPort } from './research-purchases-transport';
import { composePostgresSourceClaims,type PostgresSourceClaimsPort } from './source-claims-transport';
import { composePostgresA2aFulfillment,type PostgresA2aFulfillmentPort } from './a2a-fulfillment-transport';
import { composePostgresPaymentEvents,type PostgresPaymentEventsPort } from './payment-events-transport';
import { composePostgresBrowserJournal,type PostgresBrowserJournalPort } from './browser-journal-transport';
import { composePostgresSourceObservations,type PostgresSourceObservationPort } from './source-observation-transport';
import { composePostgresArticleOffers,type PostgresArticleOfferPort } from './article-offer-transport';
import {composePostgresOperatorWithdrawal,type PostgresOperatorWithdrawalPort} from './operator-withdrawal-transport';
import {composePostgresReferenceArchive,type PostgresReferenceArchivePort} from './reference-archive-transport';
import {composePostgresPaymentObservations,type PostgresPaymentObservationPort} from './payment-observation-transport';
import {composePostgresPrivateResearch,type PostgresPrivateResearchPort} from './private-research-transport';
import {composePostgresOnramp,type PostgresOnrampPort} from './onramp-transport';
import {composePostgresScholarly,type PostgresScholarlyPort} from './scholarly-transport';
import {composePostgresRegistrationSponsor,type PostgresRegistrationSponsorPort} from './registration-sponsor-transport';
import type { KeryxDB } from '../keryx-db';

import { composeNativeFinancialApplicationPort,type NativeFinancialApplicationPort } from './native-financial-application-port';
import { composePostgresSourceClaimWrites } from './source-claims-write-transport';
import { composePostgresSourceUpkeep } from './source-upkeep-transport';
import { composePostgresSourceUpsert } from './source-upsert-policy';
import { composePostgresPendingJobOwners } from './pending-owner-transport';
import type { PendingJobOwnersStore } from '../pending-job-owners-sqlite';
import type { AsyncOwnerRunAssignmentsPort } from '../../owner-run-assignments/contracts';
const cacheRow=z.object({sourceId:z.string().min(1).max(256),text:z.string().max(2097152)}).strict();
export interface NativeColdCacheSnapshot {readonly cacheRows:readonly Readonly<{sourceId:string;text:string}>[];readonly cacheRowCount:number;readonly cacheWireBytes:number;}
export interface PostgresRuntimeTransport extends PostgresA2aFulfillmentPort,PostgresUserDomainTransport,PostgresHealthTransport,PostgresUsageTransport,PostgresPublicLedgerTransport,PostgresA2aOriginalsPort,PostgresHostedAdmissionPort,PostgresResearchPurchasesPort {
 readonly closed:boolean;
 readonly privateResearch:PostgresPrivateResearchPort;
 readonly onramp:PostgresOnrampPort;
 readonly scholarly:PostgresScholarlyPort;
 readonly registrationSponsor:PostgresRegistrationSponsorPort;
 bindRegistrationSponsor(facade:KeryxDB):Promise<void>;
 readonly paymentObservations:PostgresPaymentObservationPort;
 readonly referenceArchive:PostgresReferenceArchivePort;
 readonly operatorWithdrawal:PostgresOperatorWithdrawalPort;
 readonly sourceObservations:PostgresSourceObservationPort;
 readonly articleOffers:PostgresArticleOfferPort;
 readonly paymentEvents:PostgresPaymentEventsPort;
 readonly browserJournal:PostgresBrowserJournalPort;
 readonly financialApplication:NativeFinancialApplicationPort;
 readonly sourceClaimWrites:ReturnType<typeof composePostgresSourceClaimWrites>;
 readonly sourceUpkeep:ReturnType<typeof composePostgresSourceUpkeep>;
 readonly sourceClaims:PostgresSourceClaimsPort;
 readonly sourceUpsert:ReturnType<typeof composePostgresSourceUpsert>;
 readonly pendingJobOwners:PendingJobOwnersStore;
 readonly deliverableAcceptance:DeliverableAcceptanceStore;
 readonly accountMembership:AccountMembershipStore;
 readonly chatAccountLinks:ChatAccountLinksStore;
 readonly publicProfiles:PublicProfilesStore;
 readonly ownerRunAssignments:AsyncOwnerRunAssignmentsPort;
 verifyRuntimeAuthority():Promise<void>;
 readColdCache():Promise<NativeColdCacheSnapshot>;
}
// Actual role capture belongs only to this channel construction, not to a
// caller's readOnly flag. It registers no facade or funding/storage provenance.
const connectionRoles=new WeakMap<PostgresDomainChannel,PostgresConnectionOptions['role']>();
/** Actual fixed reads on one native pool. This transport cannot enroll a facade. */
export function createPostgresRuntimeTransport(options:PostgresConnectionOptions,identity:StorageIdentity,digest:string,claimsEnabled=false,privacyActive=false,assertCurrentContext?:()=>void):PostgresRuntimeTransport {
 const expected=validateStorageIdentity(identity),configured=postgresPoolConfiguration(options);
 // Copy the validated connection values into a fixed record. A caller getter or
 // later mutation cannot make the scope differ from the actual pool's role.
 const host=configured.host,port=configured.port,role=configured.user,database=configured.database,password=configured.password;
 if(typeof host!=='string'||typeof port!=='number'||typeof role!=='string'||typeof database!=='string'||typeof password!=='string')throw new PostgresStorageUnavailable();
 const endpoint=Object.freeze(host==='127.0.0.1'?{kind:'loopback' as const,port}:{kind:'unix' as const,directory:host,port});
 const captured=Object.freeze({endpoint,database,role,password});
 const channel=createPostgresDomainChannel(captured,expected,digest,assertCurrentContext);connectionRoles.set(channel,role);
 return composePostgresRuntimeTransport(channel,expected,digest,role!=='keryx_app',claimsEnabled,privacyActive);
}
export function composePostgresRuntimeTransport(channel:PostgresDomainChannel,identity:StorageIdentity,digest:string,readOnly:boolean,claimsEnabled=false,privacyActive=false):PostgresRuntimeTransport {
 const expected=validateStorageIdentity(identity),wire=canonicalJson(expected),unavailable=()=>new PostgresStorageUnavailable(),live=()=>{if(channel.closed)throw unavailable();};
 if(typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest)||typeof readOnly!=='boolean')throw unavailable();
 const authority=z.object({identity:z.unknown(),sourceDigest:z.literal(digest)}).strict();
 // Only the independently pinned current DATA catalogue selects the prepared
 // Source27 hosted protocol. This does not admit that profile to either factory.
 const hostedProtocol=digest===NATIVE_CURRENT_DATA_INTAKE_PROFILE.catalogSha256?'source-payment-originals-v1':'legacy-v1';
 const ledger=composePostgresHostedLedgerTransport(channel,expected,hostedProtocol);
 const domain=Object.freeze({...composePostgresUserDomainTransport(channel,expected,readOnly,claimsEnabled),
  admitHostedTreasuryPolicy:ledger.admitHostedTreasuryPolicy,hostedTreasuryAccounting:ledger.hostedTreasuryAccounting,
  submitHostedAuthorization:ledger.submitHostedAuthorization,confirmHostedAuthorization:ledger.confirmHostedAuthorization});
 const hosted=composePostgresHostedAdmission(channel,expected,readOnly,hostedProtocol);
 const sourceClaims=composePostgresSourceClaims(channel);
 let sponsor:PostgresRegistrationSponsorPort|undefined,sponsorFacade:KeryxDB|undefined,bindingSponsor=false;
 const sponsorMethod=<N extends keyof PostgresRegistrationSponsorPort>(name:N,write:boolean)=>(async(...args:Parameters<PostgresRegistrationSponsorPort[N]>)=>{
  live();if(write&&readOnly||!sponsor)throw unavailable();
  return Reflect.apply(sponsor[name],sponsor,args);
 }) as PostgresRegistrationSponsorPort[N];
 const registrationSponsor=Object.freeze({
  admitRegistrationSponsor:sponsorMethod('admitRegistrationSponsor',true),getRegistrationSponsor:sponsorMethod('getRegistrationSponsor',false),
  getRegistrationSponsorExecution:sponsorMethod('getRegistrationSponsorExecution',false),inspectRegistrationSponsorFunding:sponsorMethod('inspectRegistrationSponsorFunding',false),
  transitionRegistrationSponsor:sponsorMethod('transitionRegistrationSponsor',true),
 });
 const cold=authority.extend({format:z.literal('keryx-native-storage-cold-read-v1'),cacheRows:z.array(cacheRow).max(512),cacheRowCount:z.number().int().min(0).max(512),cacheWireBytes:z.number().int().min(0).max(8388608)}).strict();
 return Object.freeze({
  ...domain,
  get closed(){return channel.closed;},
  privateResearch:composePostgresPrivateResearch(channel,readOnly),
  onramp:composePostgresOnramp(channel,readOnly),
  scholarly:composePostgresScholarly(channel,expected,digest,sourceClaims),
  registrationSponsor,
  async bindRegistrationSponsor(facade:KeryxDB){
   live();if(bindingSponsor||sponsorFacade!==undefined&&sponsorFacade!==facade)throw unavailable();bindingSponsor=true;
   try{
    // Only the existing factory-owned WeakMap can qualify this exact facade.
    // This slot does not register a facade or issue funding observations.
    const {assertPostgresRuntimeIdentity}=await import('./runtime-adapter');live();
    const actual=await assertPostgresRuntimeIdentity(facade,readOnly?'read':'write');live();
    if(canonicalJson(actual)!==wire)throw unavailable();
    sponsor=composePostgresRegistrationSponsor(channel,facade,readOnly);sponsorFacade=facade;
   }catch{throw unavailable();}finally{bindingSponsor=false;}
  },
  paymentEvents:composePostgresPaymentEvents(channel,readOnly),
  browserJournal:composePostgresBrowserJournal(channel,readOnly),
  sourceObservations:composePostgresSourceObservations(channel,readOnly),
  articleOffers:composePostgresArticleOffers(channel,readOnly),
  operatorWithdrawal:composePostgresOperatorWithdrawal(channel,expected,readOnly),
  referenceArchive:composePostgresReferenceArchive(channel,readOnly),
  paymentObservations:composePostgresPaymentObservations(channel),
  financialApplication:composeNativeFinancialApplicationPort({...domain,...hosted},readOnly,()=>channel.closed),
  ...composePostgresA2aOriginals(channel,readOnly,expected),
  ...composePostgresA2aFulfillment(channel,readOnly),
  ...hosted,
  ...composePostgresResearchPurchases(channel,readOnly,connectionRoles.has(channel)?{identity:expected,role:connectionRoles.get(channel)!}:undefined),
  sourceClaims,
  sourceClaimWrites:composePostgresSourceClaimWrites(channel,readOnly),
  sourceUpkeep:composePostgresSourceUpkeep(channel,readOnly),
  sourceUpsert:composePostgresSourceUpsert(channel,readOnly),
  pendingJobOwners:composePostgresPendingJobOwners(channel,expected,readOnly),
  ...composePostgresHealth(channel),
  ...composePostgresUsage(channel,privacyActive),
  ...composePostgresPublicLedger(channel,privacyActive),
  deliverableAcceptance:composePostgresAcceptance(channel,readOnly),
  accountMembership:Object.freeze({...composePostgresAccounts(channel,readOnly),...(privacyActive?composePostgresAccountHistory(channel):{})}),
  chatAccountLinks:composePostgresChatLinks(channel,readOnly),
  // Consumed associations survive the separate new-claim issuance flag.
  publicProfiles:composePostgresPublicProfiles(channel,readOnly),
  ownerRunAssignments:composePostgresOwnerAssignments(channel,readOnly),
  async verifyRuntimeAuthority(){
   live();try{const value=authority.parse(await channel.call('nativeRuntimeAuthority',[]));live();if(canonicalJson(validateStorageIdentity(value.identity))!==wire)throw unavailable();}
   catch{throw unavailable();}
  },
  async readColdCache(){
   live();try{
    const value=cold.parse(await channel.call('nativeRuntimeColdRead',[]));live();if(canonicalJson(validateStorageIdentity(value.identity))!==wire)throw unavailable();
    let bytes=0;const names=new Set<string>();
    for(const row of value.cacheRows){bytes+=Buffer.byteLength(row.text);if(bytes>8388608||Buffer.byteLength(row.sourceId)>512||Buffer.byteLength(row.text)>2097152||names.has(row.sourceId))throw unavailable();names.add(row.sourceId);}
    if(value.cacheRowCount!==value.cacheRows.length||value.cacheWireBytes!==bytes)throw unavailable();
    return Object.freeze({cacheRows:Object.freeze(value.cacheRows.map(row=>Object.freeze(row))),cacheRowCount:value.cacheRowCount,cacheWireBytes:value.cacheWireBytes});
   }catch{throw unavailable();}
  },
 });
}
