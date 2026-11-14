import type { PrivateProfilesStore } from '../../profiles/private-profile';
import { validateStorageIdentity,type StorageIdentity } from '../storage-identity';
import type { PostgresConnectionOptions } from './connection';
import { createPostgresDomainChannel,type PostgresDomainChannel } from './domain-channel';
import { composePostgresPrivateProfiles } from './private-profiles-transport';
import { composePostgresApplicationDomainTransport,type PostgresApplicationDomainTransport } from './application-domain-transport';
import { composePostgresProfileIdentities } from './profile-identities-transport';
import type { ProfileIdentitiesStore } from '../../profiles/verified-identities';
import { composePostgresPersonalHistory } from './personal-history-transport';
import type { PersonalHistoryStore } from '../../history/personal-history';
import { composePostgresRunClaims } from './claims-transport';
import type { RunClaimsStore } from '../../run-claims/contracts';
import { composePostgresOwnershipHistory } from './ownership-history-transport';
import type { RunOwnershipHistoryStore } from '../../run-claims/history';
import { composePostgresPrivacy } from './privacy-transport';
import type { RunPrivacyStore } from '../../run-privacy/contracts';
import { composePostgresPublication } from './publication-transport';
import { composePostgresBibliographies } from './bibliographies-transport';
import { composePostgresWatches } from './watches-transport';
import { composePostgresDecisionReviews } from './reviews-transport';
export interface PostgresUserDomainTransport extends PostgresApplicationDomainTransport {
 readonly privateProfiles:PrivateProfilesStore;
 readonly profileIdentities:ProfileIdentitiesStore;
 readonly personalHistory:PersonalHistoryStore;
 readonly runClaims:RunClaimsStore;
 readonly runOwnershipHistory:RunOwnershipHistoryStore;
 readonly runPrivacy:RunPrivacyStore;
 readonly saveQueryRun:ReturnType<typeof composePostgresPublication>;
 readonly privateBibliographies:ReturnType<typeof composePostgresBibliographies>;
 readonly topicWatches:ReturnType<typeof composePostgresWatches>;
 readonly decisionReviews:ReturnType<typeof composePostgresDecisionReviews>;
}
/** Same native pool/identity; a protocol composition confers no installed
 * factory provenance, authenticated web session or another owner's authority. */
export function createPostgresUserDomainTransport(options:PostgresConnectionOptions,identity:StorageIdentity,digest:string,claimsEnabled=true):PostgresUserDomainTransport {
 const expected=validateStorageIdentity(identity);
 return composePostgresUserDomainTransport(createPostgresDomainChannel(options,expected,digest),expected,options.role!=='keryx_app',claimsEnabled);
}
export function composePostgresUserDomainTransport(channel:PostgresDomainChannel,identity:StorageIdentity,readOnly:boolean,claimsEnabled=true):PostgresUserDomainTransport {
 const expected=validateStorageIdentity(identity);
 if(typeof claimsEnabled!=='boolean')throw Error('Native profile composition refused');
 const privateProfiles=composePostgresPrivateProfiles(channel,expected,readOnly);
 return Object.freeze({...composePostgresApplicationDomainTransport(channel,expected),privateProfiles,profileIdentities:composePostgresProfileIdentities(channel,readOnly),personalHistory:composePostgresPersonalHistory(channel),runClaims:composePostgresRunClaims(channel,expected.network,readOnly),runOwnershipHistory:composePostgresOwnershipHistory(channel,expected.network),runPrivacy:composePostgresPrivacy(channel,expected.network,readOnly,claimsEnabled),saveQueryRun:composePostgresPublication(channel,readOnly),privateBibliographies:composePostgresBibliographies(channel,readOnly),topicWatches:composePostgresWatches(channel,readOnly),decisionReviews:composePostgresDecisionReviews(channel,readOnly)});
}
