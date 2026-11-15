import { assembleNativePostgresBusinessCore, type NativePostgresBusinessCoreOptions } from '../supabase-adapter';
import type { StorageIdentity } from '../storage-identity';
import { createPostgresApplicationDomainAuthority } from './application-domain-authority';
import { PostgresStorageUnavailable } from './connection';
import type { NativePostgresRuntimeStores } from './runtime-stores';
import type { PostgresRuntimeTransport } from './runtime-transport';

export interface CurrentPostgresCoreAssemblyOptions {
 readonly transport:PostgresRuntimeTransport;
 readonly identity:StorageIdentity;
 readonly runtimeStores:NativePostgresRuntimeStores;
 readonly assertEntry:()=>void;
 readonly verify:()=>Promise<void>;
}

/** Complete internal business-code composition, not a selected application
 * facade or an authority issuer. Core initialization, genuine registration,
 * sponsor binding and final publication remain the zero-argument factory's job. */
export function assembleCurrentPostgresCore(input:CurrentPostgresCoreAssemblyOptions):ReturnType<typeof assembleNativePostgresBusinessCore> {
 const {transport,identity,runtimeStores,assertEntry,verify}=input;
 // Required deliberately covers every optional prepared Core group as well.
 // Adding a new Core option must not silently leave its ordinary path selected.
 const options={
  identity,authority:createPostgresApplicationDomainAuthority(transport),assertEntry,verify,runtimeStores,
  sourceClaims:transport.sourceClaims,
  a2aFulfillment:transport,
  paymentEvents:transport.paymentEvents,
  browserJournal:transport.browserJournal,
  sourceObservations:transport.sourceObservations,
  articleOffers:transport.articleOffers,
  operatorWithdrawal:transport.operatorWithdrawal,
  referenceArchive:transport.referenceArchive,
  paymentObservations:transport.paymentObservations,
  privateResearch:transport.privateResearch,
  onramp:transport.onramp,
  scholarly:transport.scholarly,
  registrationSponsor:transport.registrationSponsor,
  a2aOriginals:transport,
  researchPurchases:transport,
  publication:transport.saveQueryRun,
  financialApplication:transport.financialApplication,
  sourceClaimWrites:transport.sourceClaimWrites,
  sourceUpkeep:transport.sourceUpkeep,
  sourceUpsert:transport.sourceUpsert.upsertSource,
  sourceMetaSetter:transport.sourceUpsert.setSourceMeta,
 } satisfies Required<NativePostgresBusinessCoreOptions>;
 // A malformed internal construction cannot quietly fall through to an
 // omitted optional group. This check grants no role, profile or provenance.
 if(Object.values(options).some(value=>value===undefined||value===null))throw new PostgresStorageUnavailable();
 return assembleNativePostgresBusinessCore(options);
}
