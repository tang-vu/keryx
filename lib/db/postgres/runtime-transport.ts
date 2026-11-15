import { z } from 'zod';
import { canonicalJson } from '../../canonical-json';
import { validateStorageIdentity,type StorageIdentity } from '../storage-identity';
import { PostgresStorageUnavailable,type PostgresConnectionOptions } from './connection';
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
import { composePostgresResearchPurchases,type PostgresResearchPurchasesPort } from './research-purchases-transport';
import { composePostgresSourceClaims,type PostgresSourceClaimsPort } from './source-claims-transport';
import { composePostgresA2aFulfillment,type PostgresA2aFulfillmentPort } from './a2a-fulfillment-transport';
import { composePostgresPaymentEvents,type PostgresPaymentEventsPort } from './payment-events-transport';
import { composePostgresBrowserJournal,type PostgresBrowserJournalPort } from './browser-journal-transport';
import { composePostgresSourceObservations,type PostgresSourceObservationPort } from './source-observation-transport';
import { composePostgresArticleOffers,type PostgresArticleOfferPort } from './article-offer-transport';
import {composePostgresOperatorWithdrawal,type PostgresOperatorWithdrawalPort} from './operator-withdrawal-transport';
import {composePostgresReferenceArchive,type PostgresReferenceArchivePort} from './reference-archive-transport';

import { composeNativeFinancialApplicationPort,type NativeFinancialApplicationPort } from './native-financial-application-port';
import { composePostgresSourceClaimWrites } from './source-claims-write-transport';
import { composePostgresSourceUpkeep } from './source-upkeep-transport';
import { composePostgresSourceUpsert } from './source-upsert-policy';
import { composePostgresPendingJobOwners } from './pending-owner-transport';
import type { PendingJobOwnersStore } from '../pending-job-owners-sqlite';
import type { AsyncOwnerRunAssignmentsPort } from '../../owner-run-assignments/contracts';
const cacheRow=z.object({sourceId:z.string().min(1).max(256),text:z.string().max(2097152)}).strict();
export interface NativeColdCacheSnapshot {readonly cacheRows:readonly Readonly<{sourceId:string;text:string}>[];readonly cacheRowCount:number;readonly cacheWireBytes:number;}
export interface PostgresRuntimeTransport extends PostgresA2aFulfillmentPort,PostgresUserDomainTransport,PostgresHealthTransport,PostgresUsageTransport,PostgresPublicLedgerTransport,PostgresA2aOriginalsPort,PostgresHostedAdmissionPort,PostgresResearchPurchasesPort {readonly referenceArchive:PostgresReferenceArchivePort;readonly operatorWithdrawal:PostgresOperatorWithdrawalPort;readonly sourceObservations:PostgresSourceObservationPort;readonly articleOffers:PostgresArticleOfferPort;readonly paymentEvents:PostgresPaymentEventsPort;readonly browserJournal:PostgresBrowserJournalPort;readonly financialApplication:NativeFinancialApplicationPort;readonly sourceClaimWrites:ReturnType<typeof composePostgresSourceClaimWrites>;readonly sourceUpkeep:ReturnType<typeof composePostgresSourceUpkeep>;readonly sourceClaims:PostgresSourceClaimsPort;readonly sourceUpsert:ReturnType<typeof composePostgresSourceUpsert>;readonly pendingJobOwners:PendingJobOwnersStore;readonly deliverableAcceptance:DeliverableAcceptanceStore;readonly accountMembership:AccountMembershipStore;readonly chatAccountLinks:ChatAccountLinksStore;readonly publicProfiles:PublicProfilesStore;readonly ownerRunAssignments:AsyncOwnerRunAssignmentsPort;verifyRuntimeAuthority():Promise<void>;readColdCache():Promise<NativeColdCacheSnapshot>;}
/** Actual fixed reads on one native pool. This transport cannot enroll a facade. */
export function createPostgresRuntimeTransport(options:PostgresConnectionOptions,identity:StorageIdentity,digest:string,claimsEnabled=false,privacyActive=false):PostgresRuntimeTransport {
 const expected=validateStorageIdentity(identity);return composePostgresRuntimeTransport(createPostgresDomainChannel(options,expected,digest),expected,digest,options.role!=='keryx_app',claimsEnabled,privacyActive);
}
export function composePostgresRuntimeTransport(channel:PostgresDomainChannel,identity:StorageIdentity,digest:string,readOnly:boolean,claimsEnabled=false,privacyActive=false):PostgresRuntimeTransport {
 const expected=validateStorageIdentity(identity),wire=canonicalJson(expected),unavailable=()=>new PostgresStorageUnavailable(),live=()=>{if(channel.closed)throw unavailable();};
 if(typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest)||typeof readOnly!=='boolean')throw unavailable();
 const authority=z.object({identity:z.unknown(),sourceDigest:z.literal(digest)}).strict();
 const domain=composePostgresUserDomainTransport(channel,expected,readOnly,claimsEnabled),hosted=composePostgresHostedAdmission(channel,expected,readOnly);
 const cold=authority.extend({format:z.literal('keryx-native-storage-cold-read-v1'),cacheRows:z.array(cacheRow).max(512),cacheRowCount:z.number().int().min(0).max(512),cacheWireBytes:z.number().int().min(0).max(8388608)}).strict();
 return Object.freeze({
  ...domain,
  paymentEvents:composePostgresPaymentEvents(channel,readOnly),
  browserJournal:composePostgresBrowserJournal(channel,readOnly),
  sourceObservations:composePostgresSourceObservations(channel,readOnly),
  articleOffers:composePostgresArticleOffers(channel,readOnly),
  operatorWithdrawal:composePostgresOperatorWithdrawal(channel,expected,readOnly),
  referenceArchive:composePostgresReferenceArchive(channel,readOnly),
  financialApplication:composeNativeFinancialApplicationPort({...domain,...hosted},readOnly,()=>channel.closed),
  ...composePostgresA2aOriginals(channel,readOnly,expected),
  ...composePostgresA2aFulfillment(channel,readOnly),
  ...hosted,
  ...composePostgresResearchPurchases(channel,readOnly),
  sourceClaims:composePostgresSourceClaims(channel),
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
