import { SqliteAdapter } from "./sqlite-adapter";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { openVerifiedSqliteStorage, assertVerifiedSqliteConnection, assertVerifiedSqliteNativeUserDomainPolicy } from "./storage-identity-connection";
import { readRuntimeStorageDeployment } from "./runtime-storage-config";
import { createEnrolledSqlitePersonalHistory } from "./personal-history-sqlite";
import { createEnrolledSqlitePrivateBibliographies } from "./private-bibliographies-enrolled-sqlite";
import { createEnrolledSqliteDeliverableAcceptance } from "./deliverable-acceptance-sqlite";
import { createEnrolledSqlitePublicProfiles } from "./public-profiles-sqlite";
import { createEnrolledSqliteAccountMembership } from "../accounts/sqlite-store";
import { createEnrolledSqliteChatAccountLinks } from "./chat-accounts-sqlite";
import { createEnrolledSqliteDecisionReviews } from "./decision-reviews-sqlite";
import { createEnrolledSqliteRunClaims } from "./run-claims-sqlite";
import { createEnrolledSqliteRunOwnershipHistory } from "./run-ownership-history-sqlite";
import { createEnrolledSqliteRunPrivacy } from "./run-privacy-sqlite";
import { createEnrolledSqlitePublicUsage } from "./public-usage-sqlite";
import { runClaimsEnabled } from "../run-claims/contracts";
import { withRunReadProjection } from "../run-privacy/projection";
import { projectRecordedEvidenceProvenance } from "../research/evidence-provenance";
import { createEnrolledSqliteProfileIdentities } from "./profile-identities-enrolled-sqlite";
import { canonicalJson } from "../canonical-json";
import type { StorageIdentity } from "./storage-identity";
import { createEnrolledSqlitePrivateProfiles } from "./private-profiles-enrolled-sqlite";
import { createEnrolledSqliteTopicWatches } from "./topic-watches-sqlite";
import { createEnrolledSqlitePendingJobOwners } from "./pending-job-owners-sqlite";
import { createEnrolledSqliteOwnerRunAssignments } from "./owner-run-assignments-sqlite";

/** Explicit behavior inventory, including verifyApiKey's last-used write. New methods require review. */
export const ENROLLED_SQLITE_METHOD_ACCESS = Object.freeze({
  admitRegistrationSponsor: "write",
  getRegistrationSponsor: "read",
  getRegistrationSponsorExecution: "read",
  inspectRegistrationSponsorFunding: "read",
  transitionRegistrationSponsor: "write",
  upsertSource: "write",
  verifySourceIfUnchanged: "write",
  setSourcePreviewDepth: "write",
  listPublicReferences: "read",
  getPublicReference: "read",
  upsertPublicReference: "write",
  archivePublicReferenceItems: "write",
  queryPublicReferenceItems: "read",
  publicReferenceArchiveStats: "read",
  listSources: "read",
  listAllSources: "read",
  setSourceMeta: "write",
  getSourceMeta: "read",
  setSourceNotify: "write",
  getSourceNotify: "read",
  deleteSourceNotify: "write",
  setSourceNotifyEmail: "write",
  getSourceNotifyEmail: "read",
  deleteSourceNotifyEmail: "write",
  markSourceNotifyEmailSent: "write",
  getSource: "read",
  getSourceByOnchainId: "read",
  addItems: "write",
  getItems: "read",
  getItem: "read",
  getSourceItemByLink: "read",
  getArticleOffer: "read",
  listArticleOffers: "read",
  setArticleOffer: "write",
  deleteArticleOffer: "write",
  countItemsPublishedBetween: "read",
  newestItemDates: "read",
  isCreatorWallet: "read",
  createAuthChallenge: "write",
  createWebSession: "write",
  getWebSession: "read",
  revokeWebSession: "write",
  listWebSessions: "read",
  revokeOtherWebSessions: "write",
  consumeAuthChallenge: "write",
  upsertUser: "write",
  getUser: "read",
  getCached: "read",
  getCachedAt: "read",
  setCached: "write",
  getSyncState: "read",
  getSyncStates: "read",
  issueSourceClaimChallenge: "write",
  getSourceClaimChallenge: "read",
  reserveSourceClaimVerification: "write",
  verifySourceClaim: "write",
  getSourceClaim: "read",
  getSourceClaimForSource: "read",
  listSourceClaims: "read",
  bindSourceClaim: "write",
  updateSourceClaimPolicy: "write",
  claimSourceUpkeep: "write",
  finishSourceUpkeep: "write",
  setSyncState: "write",
  upsertSessionGrant: "write",
  issueSessionGrantConsent: "write",
  consumeSessionGrantConsent: "write",
  getSessionGrantConsent: "read",
  getSessionGrant: "read",
  addSessionGrantSpend: "write",
  admitBrowserAuthorization: "write",
  browserJournalActive: "read",
  browserSignerConfirmedSpendMicro: "read",
  browserSignerRetainedSpendMicro: "read",
  sessionFundingAccounting: "read",
  sessionWithdrawalAccounting: "read",
  creatorOwnerWithdrawalAccounting: "read",
  admitCreatorOwnerWithdrawal: "write",
  getCreatorOwnerWithdrawalCompletion: "read",
  completeCreatorOwnerWithdrawal: "write",
  reserveSessionWithdrawal: "write",
  getSessionWithdrawal: "read",
  pendingSessionWithdrawal: "read",
  getSessionWithdrawalSigningPhase: "read",
  authorizeSessionWithdrawal: "write",
  cancelSessionWithdrawal: "write",
  getSessionWithdrawalAbort: "read",
  abortSessionWithdrawal: "write",
  admitHostedTreasuryPolicy: "write",
  hostedTreasuryAccounting: "read",
  admitHostedAuthorization: "write",
  submitHostedAuthorization: "write",
  confirmHostedAuthorization: "write",
  getSessionWithdrawalCompletion: "read",
  completeSessionWithdrawal: "write",
  listSessionWithdrawalPayments: "read",
  activateBrowserJournal: "write",
  admitBrowserJournal: "write",
  getPaperState: "read",
  beginPaperEnrollment: "write",
  getPaperAdmission: "read",
  submitPaper: "write",
  reviewPaper: "write",
  admitBrowserQueryPolicy: "write",
  admitBrowserSigningOriginal: "write",
  admitBrowserSourceSigningOriginal: "write",
  readExposedBrowserSigningSnapshotForSigner: "read",
  readBrowserSigningSnapshot: "read",
  signBrowserSigningOriginal: "write",
  getBrowserJournal: "read",
  exposeBrowserJournal: "write",
  cancelPreparedBrowserJournal: "write",
  signBrowserJournal: "write",
  submitBrowserJournal: "write",
  createGapIntent: "write",
  listGapIntents: "read",
  claimGapIntent: "write",
  finishGapIntent: "write",
  failGapIntent: "write",
  expireGapIntent: "write",
  reserveOnramp: "write",
  releaseOnramp: "write",
  releaseSessionGrantSpend: "write",
  deleteSessionGrant: "write",
  revokeSessionGrant: "write",
  deleteExpiredSessionGrants: "write",
  consumeRateLimit: "write",
  deleteExpiredRateLimits: "write",
  acquireReasoningCircuit: "write",
  recordReasoningCircuitFailure: "write",
  clearReasoningCircuit: "write",
  reservePrivateResearchIntent: "write",
  reservePrivateTreasury: "write",
  getPrivateTreasury: "read",
  getPrivateTreasurySummary: "read",
  releasePrivateTreasury: "write",
  getPrivateResearchInterruption: "read",
  interruptPrivateResearch: "write",
  listPrivateWorkerCandidates: "read",
  listPrivateReconciliationCandidates: "read",
  confirmPrivateCreatorSubmission: "write",
  getPrivateCreatorConfirmation: "read",
  admitPrivateCreatorSubmission: "write",
  listPrivateCreatorSubmissions: "read",
  savePrivateResearchResult: "write",
  getPrivateResearchResult: "read",
  claimPrivateResearchExecution: "write",
  getPrivateResearchExecution: "read",
  claimPrivatePaymentSubmission: "write",
  getPrivatePaymentState: "read",
  confirmPrivatePayment: "write",
  getPrivateResearchIntent: "read",
  listPrivateResearchHistory: "read",
  saveQueryRun: "write",
  listFollowUps: "read",
  listQueryRunsByAsker: "read",
  getQueryRun: "read",
  listRecentQueries: "read",
  iterateRecentQueries: "read",
  recordPayment: "write",
  recordPaymentOnce: "write",
  assertResearchPurchaseAuthority: "mainnet-read",
  claimResearchPurchase: "mainnet-write",
  createResearchMonthly: "mainnet-write",
  getResearchMonthly: "mainnet-read",
  redeemResearchMonthly: "mainnet-write",
  createA2aOrder: "write",
  createOwnedA2aOrder: "write",
  getA2aOrder: "read",
  listA2aOrdersByPayer: "read",
  listUnfinishedA2aOrders: "read", // Private operator observation; grants no claim or resolution authority.
  claimNextA2aOrder: "write", // Includes exact-original binding; readonly cannot start a queued original.
  hasA2aOriginalSettlement: "read", // Native settled proof does not grant a writer/claim capability.
  claimA2aFailedOriginalFulfillment: "mainnet-write",
  getA2aFailedOriginalFulfillment: "mainnet-read",
  completeA2aFailedOriginalFulfillment: "mainnet-write",
  hasA2aFailedOriginalFulfillment: "mainnet-read",
  markA2aOrderPaymentStarted: "write",
  markA2aOrderResultSaving: "write",
  completeA2aOrder: "write",
  failA2aOrder: "write",
  resolveA2aOrder: "write",
  a2aOperationsSnapshot: "read",
  operatorInventory: "read",
  operatorPublicSnapshot: "read",
  listPayments: "read",
  recordActivationEvent: "write",
  activationFunnel: "read",
  listPendingPayments: "read",
  settlePendingPayment: "write",
  failPendingPayment: "write",
  listPaymentsByQuery: "read",
  listCreatorPaymentAttemptsByQuery: "read",
  listPaymentsBySource: "read",
  dailySettled: "read",
  recordWithdrawal: "write",
  reserveCreatorWithdrawal: "write",
  listCreatorWithdrawalHistory: "read",
  getCreatorWithdrawal: "read",
  claimCreatorWithdrawalTransfer: "write",
  getCreatorWithdrawalTransferClaim: "read",
  saveCreatorWithdrawalAttestation: "write",
  getCreatorWithdrawalAttestation: "read",
  listWithdrawals: "read",
  metrics: "read",
  economics: "read",
  settlementLedger: "read",
  mintApiKey: "write",
  verifyApiKey: "write",
  listApiKeys: "read",
  revokeApiKey: "write",
  incrementUsage: "write",
  getUsage: "read",
  saveQueryMemory: "write",
  loadQueryMemories: "read",
  recordFeedback: "write",
  getFeedbackStats: "read",
  creatorLeaderboard: "read",
} as const);

const provenance = new WeakMap<object, { identity: Readonly<StorageIdentity>; readOnly: boolean; assert(): void }>();
export function assertEnrolledSqliteAdapter(value: object, access: "read" | "write" = "read"): Readonly<StorageIdentity> {
  const record = provenance.get(value);
  if (arguments.length > 2 || !record || !["read", "write"].includes(access) || access === "write" && record.readOnly)
    throw new Error("Enrolled SQLite adapter unavailable");
  record.assert();
  return record.identity;
}

export async function createEnrolledSqliteAdapter(): Promise<SqliteAdapter> {
  if (arguments.length) throw new Error("Enrolled SQLite factory accepts no configuration");
  return create(false);
}
export async function createReadonlyEnrolledSqliteAdapter(): Promise<SqliteAdapter> {
  if (arguments.length) throw new Error("Enrolled SQLite factory accepts no configuration");
  return create(true);
}

async function create(readOnly: boolean): Promise<SqliteAdapter> {
  const deployment = readRuntimeStorageDeployment();
  if (deployment.backend.kind !== "sqlite") throw new Error("Enrolled SQLite backend not selected");
  const pinned = canonicalJson(deployment);
  const runtimeGuard = () => {
    if (canonicalJson(readRuntimeStorageDeployment()) !== pinned)
      throw new Error("Enrolled SQLite deployment changed");
  };
  const connection = openVerifiedSqliteStorage(deployment.backend.databasePath, deployment.identity,
    { readOnly, runtimeGuard, applicationProfiles: supportedSqliteApplicationProfiles(deployment.identity.authorityMode === "mainnet-real") });
  try {
    const db = connection.db;
    const assert = () => {
      try { assertVerifiedSqliteConnection(connection.db); }
      catch (error) {
        const contention = error instanceof Error && "code" in error && error.code === "ERR_SQLITE_ERROR"
          && "errcode" in error && (error.errcode === 5 || error.errcode === 6);
        if (!contention) connection.close();
        throw error;
      }
    };
    assert();
    const core = SqliteAdapter.assembleConnectionCore(db, deployment.identity, assert);
    const privacyActive = process.env.KERYX_RUN_PRIVACY_ENABLED === "true", claimsActive = runClaimsEnabled(process.env);
    Object.defineProperty(core, "runPrivacyActive", { value: privacyActive });
    if (privacyActive || claimsActive) {
      assertVerifiedSqliteNativeUserDomainPolicy(db);
      const ownership = createEnrolledSqliteRunOwnershipHistory(db);
      Object.defineProperty(core, "runOwnershipHistory", { value: ownership });
      if (claimsActive) Object.defineProperty(core, "runClaims", { value: createEnrolledSqliteRunClaims(db) });
      if (privacyActive) {
        const privacy = createEnrolledSqliteRunPrivacy(db);
        const projected = withRunReadProjection(privacy, run => projectRecordedEvidenceProvenance(
          async lookup => {
            assert();
            try {
              const result = await Reflect.apply(Reflect.get(core, "readEvidenceProvenance"), core, [lookup]) as ReadonlySet<string>;
              assert(); return result;
            } catch (error) {
              const contention = error instanceof Error && "code" in error && error.code === "ERR_SQLITE_ERROR"
                && "errcode" in error && (error.errcode === 5 || error.errcode === 6);
              if (!contention) connection.close();
              throw error;
            }
          }, run));
        Object.defineProperty(core, "runPrivacy", { value: projected });
      }
    }
    const publicNames = Object.getOwnPropertyNames(SqliteAdapter.prototype).filter(name =>
      !["constructor", "encryptLegacyCacheRows", "insertPayment", "insertA2aOriginal", "assertOrdinaryResearchAuthority", "readEvidenceProvenance", "init", "close"].includes(name));
    const reviewed = Object.keys(ENROLLED_SQLITE_METHOD_ACCESS);
    if (canonicalJson(publicNames.sort()) !== canonicalJson(reviewed.sort()))
      throw new Error("Enrolled SQLite method inventory requires review");
    await core.init();
    assert();
    const facade = Object.create(null) as SqliteAdapter;
    for (const name of reviewed) {
      const access = ENROLLED_SQLITE_METHOD_ACCESS[name as keyof typeof ENROLLED_SQLITE_METHOD_ACCESS];
      Object.defineProperty(facade, name, { enumerable: true, value: (...args: unknown[]) => {
        if (access.startsWith("mainnet-") && deployment.identity.authorityMode !== "mainnet-real") throw new Error("Research purchase authority is unavailable in enrolled storage");
        if (readOnly && (access === "write" || access === "mainnet-write" || name === "assertResearchPurchaseAuthority")) throw new Error("Readonly enrolled SQLite mutation refused");
        assert();
        const result = Reflect.apply(Reflect.get(core, name), core, args);
        if (name === "iterateRecentQueries") {
          return (async function* () {
            const iterator = (result as AsyncIterable<unknown>)[Symbol.asyncIterator]();
            try {
              for (;;) { assert(); const item = await iterator.next(); assert(); if (item.done) return; yield item.value; }
            } finally { await iterator.return?.(); }
          })();
        }
        return Promise.resolve(result).then(
          (value: unknown) => { assert(); return value; },
          (error: unknown) => { assert(); throw error; }
        );
      } });
    }
    Object.defineProperty(facade, "personalHistory", { value: createEnrolledSqlitePersonalHistory(db) });
    const bibliographies = createEnrolledSqlitePrivateBibliographies(db);
    if (bibliographies) Object.defineProperty(facade, "privateBibliographies", { value: bibliographies });
    const topicWatches = createEnrolledSqliteTopicWatches(db);
    if (topicWatches) Object.defineProperty(facade, "topicWatches", { value: topicWatches });
    if (deployment.identity.authorityMode === "mainnet-real") {
      const ownerAssignments = createEnrolledSqliteOwnerRunAssignments(db);
      if (ownerAssignments) Object.defineProperty(facade, "ownerRunAssignments", { value: Object.freeze({
        act: ownerAssignments.act, reply: ownerAssignments.reply,
      }) });
    }
    Object.defineProperty(facade, "runPrivacyActive", { value: privacyActive });
    for (const name of ["runClaims", "runOwnershipHistory", "runPrivacy"] as const) {
      if (core[name]) Object.defineProperty(facade, name, { value: core[name] });
    }
    if (deployment.identity.authorityMode === "mainnet-real") {
      const pendingOwners = createEnrolledSqlitePendingJobOwners(db);
      if (pendingOwners) Object.defineProperty(facade, "pendingJobOwners", { value: pendingOwners });
      const acceptance = createEnrolledSqliteDeliverableAcceptance(db);
      if (acceptance) Object.defineProperty(facade, "deliverableAcceptance", { value: acceptance });
      if (process.env.KERYX_PUBLIC_PROFILES_ENABLED === "true" && privacyActive) {
        const publicProfiles = createEnrolledSqlitePublicProfiles(db);
        if (publicProfiles) Object.defineProperty(facade, "publicProfiles", { value: publicProfiles });
      }
      const accountMembership = createEnrolledSqliteAccountMembership(db);
      if (accountMembership) Object.defineProperty(facade, "accountMembership", { value: accountMembership });
      const chatAccountLinks = createEnrolledSqliteChatAccountLinks(db);
      if (chatAccountLinks) Object.defineProperty(facade, "chatAccountLinks", { value: chatAccountLinks });
      const reviews = createEnrolledSqliteDecisionReviews(db);
      if (reviews) Object.defineProperty(facade, "decisionReviews", { value: reviews });
      Object.defineProperty(facade, "publicUsage", { value: (() => {
        if (privacyActive !== (process.env.KERYX_RUN_PRIVACY_ENABLED === "true")) throw new Error("Enrolled SQLite privacy policy changed during construction");
        return createEnrolledSqlitePublicUsage(db);
      })() });
    }
    const identities = createEnrolledSqliteProfileIdentities(db);
    if (identities) Object.defineProperty(facade, "profileIdentities", { value: identities });
    Object.defineProperty(facade, "init", { value: async () => { assert(); } });
    Object.defineProperty(facade, "close", { value: connection.close });
    const privateProfiles = createEnrolledSqlitePrivateProfiles(db);
    if (privateProfiles) Object.defineProperty(facade, "privateProfiles", { value: privateProfiles });
    Object.freeze(facade);
    provenance.set(facade, { identity: deployment.identity, readOnly, assert });
    return facade;
  } catch (error) { connection.close(); throw error; }
}
