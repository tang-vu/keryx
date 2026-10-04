import { SqliteAdapter } from "./sqlite-adapter";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { openVerifiedSqliteStorage, assertVerifiedSqliteConnection } from "./storage-identity-connection";
import { readRuntimeStorageDeployment } from "./runtime-storage-config";
import { canonicalJson } from "../canonical-json";
import type { StorageIdentity } from "./storage-identity";

/** Explicit behavior inventory, including verifyApiKey's last-used write. New methods require review. */
export const ENROLLED_SQLITE_METHOD_ACCESS = Object.freeze({
  upsertSource: "write",
  verifySourceIfUnchanged: "write",
  setSourcePreviewDepth: "write",
  listPublicReferences: "read",
  getPublicReference: "read",
  upsertPublicReference: "write",
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
  getA2aOrder: "read",
  listA2aOrdersByPayer: "read",
  claimNextA2aOrder: "write",
  markA2aOrderPaymentStarted: "write",
  markA2aOrderResultSaving: "write",
  completeA2aOrder: "write",
  failA2aOrder: "write",
  resolveA2aOrder: "write",
  a2aOperationsSnapshot: "read",
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
      catch (error) { connection.close(); throw error; }
    };
    assert();
    const core = SqliteAdapter.assembleConnectionCore(db, deployment.identity, assert);
    const publicNames = Object.getOwnPropertyNames(SqliteAdapter.prototype).filter(name =>
      !["constructor", "encryptLegacyCacheRows", "insertPayment", "assertOrdinaryResearchAuthority", "readEvidenceProvenance", "init", "close"].includes(name));
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
    Object.defineProperty(facade, "init", { value: async () => { assert(); } });
    Object.defineProperty(facade, "close", { value: connection.close });
    Object.freeze(facade);
    provenance.set(facade, { identity: deployment.identity, readOnly, assert });
    return facade;
  } catch (error) { connection.close(); throw error; }
}
