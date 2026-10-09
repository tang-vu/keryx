import { projectRecordedEvidenceProvenanceList, projectRecordedEvidenceProvenance, type EvidenceProvenanceLookup } from "../research/evidence-provenance";
import { createSqlitePrivateProfiles } from "./private-profiles-sqlite";
import { createSqlitePrivateBibliographies } from "./private-bibliographies-sqlite";
import { PrivateBibliographyError, type PrivateBibliographiesStore } from "../bibliographies/private-bibliography";
import { createSqlitePersonalHistory } from "./personal-history-sqlite";
import type { PersonalHistoryStore } from "../history/personal-history";
import { PrivateProfileError, type PrivateProfilesStore } from "../profiles/private-profile";
import { readSqliteOperatorInventory, type OperatorInventoryInput } from "../business-operator/inventory";
import { installOrdinarySqliteApplicationSchema } from "./sqlite-application-schema";
import { sqliteSessionFundingAccounting } from "./session-funding-accounting";
import { sqliteCreatorOwnerAccounting, admitSqliteCreatorOwnerWithdrawal, readSqliteCreatorOwnerCompletion, completeSqliteCreatorOwnerWithdrawal } from "./creator-owner-withdrawal-journal";
import type { CreatorOwnerWithdrawalAccounting, CreatorOwnerWithdrawalCompletion } from "../gateway/creator-owner-withdrawal-protocol";
import { admitSqliteHostedPolicy, sqliteHostedAccounting, admitSqliteHostedAuthorization, submitSqliteHostedAuthorization,
 confirmSqliteHostedAuthorization, terminalSqliteHostedAuthorization, type HostedAuthorizationAdmission } from "./hosted-treasury-journal";
import type { HostedTreasuryPolicy } from "../payments/hosted-treasury-policy";
import { sqliteSessionWithdrawalAccounting, reserveSqliteSessionWithdrawal, readSqliteSessionWithdrawal, pendingSqliteSessionWithdrawal, listSqliteSessionWithdrawalPayments,
  readSqliteSessionWithdrawalCompletion, completeSqliteSessionWithdrawal, readSqliteSessionWithdrawalPhase,
  exposeSqliteSessionWithdrawal, cancelSqliteSessionWithdrawal } from "./session-withdrawal-journal";
import type { SessionWithdrawalPreparation } from "../gateway/session-withdrawal-protocol";
import { abortSqliteSessionWithdrawal, readSqliteSessionWithdrawalAbort } from "./session-withdrawal-abort";
import { issueSqliteSessionGrantConsent, consumeSqliteSessionGrantConsent, readSqliteSessionGrantConsent } from "./session-grant-consents";
import type { SessionGrantConsent } from "../payments/session-grant-consent";
import { hasScholarlyRights, assertNoOrphanedPaperMarker } from "./scholarly-capability";
import { storagePaymentProfile, type StorageIdentity } from "./storage-identity";
import { ARC_TESTNET_PROFILE, type ArcNetworkProfile } from "../arc-network-profile";
import { openEnrolledCacheText, sealEnrolledCacheText } from "../sources/enrolled-content-cache";
import { publicReferenceSchema, type PublicReference } from "../public-references/catalog";
import { issueSqliteSourceClaimChallenge, getSqliteSourceClaimChallenge, reserveSqliteSourceClaimVerification,
  verifySqliteSourceClaim, getSqliteSourceClaim, getSqliteSourceClaimForSource, listSqliteSourceClaims,
  bindSqliteSourceClaim, updateSqliteSourceClaimPolicy, getRetainedSourceClaimMarker } from "./public-source-claims";
import { canonicalSourceUrl, type IssueSourceClaimChallenge, type VerifySourceClaim,
  type BindSourceClaim, type UpdateSourceClaimPolicy } from "../sources/public-source-claim";
/**
 * SQLite adapter using Node's built-in `node:sqlite` (no native compile).
 * The offline-dev datastore; the deployed app uses the Supabase adapter instead.
 */

import { listSqliteWithdrawalHistory, type WithdrawalHistoryCursor } from "./creator-withdrawal-history";
import { assertSqliteResearchAuthority, assertOrdinarySqliteResearchAuthority, claimSqliteResearchPurchase, createSqliteResearchMonthly, getSqliteResearchMonthly, redeemSqliteResearchMonthly, type MonthlyPurchase, type MonthlyRedemptionInput, type ResearchPurchaseClaim } from "./research-monthly";
import { confirmSqlitePrivateCreator, getSqlitePrivateCreatorConfirmation, type PrivateCreatorConfirmation } from "./private-creator-confirmations";
import { admitSqlitePrivateCreatorSubmission, listSqlitePrivateCreatorSubmissions, type PrivateCreatorSubmission } from "./private-creator-submissions";
import { saveSqlitePrivateResult, getSqlitePrivateResult } from "./private-research-results";
import { reserveSqlitePrivateTreasury, getSqlitePrivateTreasury, type PrivateTreasuryPolicy } from "./private-treasury-capacity";
import { claimSqlitePrivateExecution, getSqlitePrivateExecution } from "./private-research-executions";
import { DatabaseSync } from "node:sqlite";
import { sqliteJournalActive, sqliteJournalTransaction, activateSqliteBrowserJournal, upsertSqliteJournalGrant, admitSqliteBrowserJournal, getSqliteBrowserJournal, transitionSqliteBrowserJournal, signSqliteBrowserJournal, cancelSqlitePreparedJournal, terminalSqliteJournalPayment } from "./sqlite-browser-journal";
import type { BrowserJournalAdmission, BrowserSignedMetadata } from "./browser-authorization-journal";
import { admitSqliteBrowserQueryPolicy, admitSqliteBrowserSigningOriginal, readSqliteBrowserSigningSnapshot, readExposedSqliteBrowserSigningSnapshotForSigner, signSqliteBrowserSigningOriginal } from "./sqlite-browser-signing-originals";
import { admitSqliteBrowserSourceSigningOriginal } from "./sqlite-browser-source-context";
import { createBrowserOriginalSourceAuthority } from "../payments/browser-original-source-authority";
import type { BrowserQueryPolicyProof } from "../payments/browser-query-policy";
import type { BrowserOriginalAdmission } from "./browser-signing-originals";
import { claimSqliteSourceUpkeep, finishSqliteSourceUpkeep, type SourceUpkeepClaim, type SourceUpkeepSummary } from "./source-upkeep";
import { prepareBrowserAuthorizationIntent, type BrowserAuthorizationIntent, type BrowserAdmissionResult } from "./browser-authorization-admission";
import { recordSqliteWithdrawal } from "./withdrawal-records";
import { reserveSqliteWithdrawalRequest, getSqliteWithdrawalRequest, claimSqliteWithdrawalTransfer, getSqliteWithdrawalTransferClaim } from "./creator-withdrawal-requests";
import type { WithdrawalRequestRecord } from "../gateway/withdrawal-request";
import { saveSqliteWithdrawalAttestation, getSqliteWithdrawalAttestation } from "./creator-withdrawal-attestations";
import { getSqlitePrivateTreasurySummary } from "./private-treasury-summary";
import { releaseSqlitePrivateTreasury } from "./private-treasury-release";
import { getSqlitePrivateInterruption, interruptSqlitePrivateResearch } from "./private-research-interruptions";
import { listSqlitePrivateWorkerCandidates, listSqlitePrivateReconciliationCandidates } from "./private-worker-candidates";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  ActivationEvent,
  ActivationFunnel,
  ArticleOffer,
  DailyVolume,
  DashboardMetrics,
  GapIntent,
  PaymentRecord,
  QueryRun,
  Source,
  SourceItem,
  WithdrawalRecord,
} from "../types";
import type {
  ApiKeyRow,
  ApiKeyUsage,
  CreatorEarnings,
  FeedbackStats,
  KeryxDB,
  OnrampReservation,
  QueryMemoryEntry,
  RateLimitDecision,
  ReasoningCircuitDecision,
  ReasoningCircuitRecord,
  SessionGrantRecord,
  UserRecord,
  WebSessionRecord,
} from "./keryx-db";
import type { LedgerAccount } from "../gateway/settlement-parity";
import type { A2aOrder, A2aOrderResolutionUpdate } from "../a2a/order";
import type { A2aOriginalClaim } from "../a2a/original-claim";
import { claimSqliteA2aOriginal, hasSqliteA2aOriginalSettlement } from "./a2a-original-claim";
import { claimSqliteA2aFulfillment, getSqliteA2aFulfillment, completeSqliteA2aFulfillment, hasSqliteA2aFulfillment } from "./a2a-failed-original-fulfillment";
import type { FulfillmentClaimInput, A2aFulfillmentCompletion, FulfillmentAuthority } from "../a2a/failed-original-fulfillment-protocol";
import type { FulfillmentEvidenceCapability } from "../a2a/fulfillment-supplement-evidence";
import { writeSqliteQueryRun } from "./query-run-record";
import type { PrivateResearchIntent } from "../a2a/private-research-intent";
import type { PrivatePaymentConfirmation } from "../a2a/private-payment-state";
import { claimSqlitePrivatePayment, getSqlitePrivatePayment, confirmSqlitePrivatePayment } from "./private-research-payments";
import { getSqlitePrivateResearchIntent, reserveSqlitePrivateResearchIntent, listSqlitePrivateResearchHistory, type PrivateHistoryCursor } from "./private-research-intents";
import {
  summarizeA2aOperations,
  type A2aOperationsRow,
  type A2aOperationsSnapshot,
} from "../a2a/operations";
import { fillDailySeries } from "./daily-series";
import { shortAddress } from "../utils";
import { normalizePreviewDepth } from "../sources/preview-depth";
import { assertPaymentSettlementState } from "../payments/payment-state";
import { hasContentKey } from "../ipfs/content-crypto";
import {
  cacheEncryptionRequired,
  isEncryptedCacheValue,
  openCacheText,
  sealCacheText,
} from "../sources/content-cache";
import {
  calculateDashboardMetrics,
  runEvidenceMetrics,
} from "./dashboard-metrics";
import {
  calculateEconomics,
  economicsRunSample,
  type EconomicsRunSample,
} from "../economics/testnet-economics";
import { activationWindow, emptyActivationCounts } from "../activation";



export class SqliteAdapter implements KeryxDB {
  declare readonly privateProfiles?: PrivateProfilesStore;
  declare readonly privateBibliographies?: PrivateBibliographiesStore;
  declare readonly personalHistory?: PersonalHistoryStore;
  private db: DatabaseSync;
  private enrolledMode?: StorageIdentity["authorityMode"];
  private enrolledIdentity?: Readonly<StorageIdentity>;
  private enrolledGuard?: () => void;
  private paymentProfile: ArcNetworkProfile = ARC_TESTNET_PROFILE;
  private readOnly = false;

  /** Core assembly only: the caller owns the connection; this issues no runtime provenance. */
  static assembleConnectionCore(db: DatabaseSync, identity: Readonly<StorageIdentity>, guard: () => void): SqliteAdapter {
    const adapter = Object.create(SqliteAdapter.prototype) as SqliteAdapter;
    adapter.db = db;
    adapter.enrolledMode = identity.authorityMode;
    adapter.enrolledIdentity = identity;
    adapter.enrolledGuard = guard;
    adapter.paymentProfile = storagePaymentProfile(identity);
    return adapter;
  }

  constructor(file?: string, options: { readOnly?: boolean } = {}) {
    const dbPath = file ?? path.resolve(process.cwd(), "data", "keryx.sqlite");
    if (!options.readOnly) fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath, { readOnly: options.readOnly ?? false });
    this.readOnly = options.readOnly ?? false;
  }

  /** Release the file handle. The long-lived server never calls this; short-lived callers
   *  (tests, one-shot scripts) do, so the OS is not left holding the DB open. */
  close(): void {
    this.db.close();
  }

  async init(): Promise<void> {
    if (this.enrolledMode) {
      this.enrolledGuard!();
      if (this.enrolledMode !== "testnet-offline" && !hasContentKey())
        throw new Error("Enrolled content cache key unavailable");
      this.db.exec("BEGIN");
      try {
        const size = this.db.prepare(`SELECT count(*) AS rows,
          COALESCE(sum(length(CAST(text AS BLOB))),0) AS bytes,
          COALESCE(max(CASE WHEN typeof(text)!='text' OR typeof(source_id)!='text'
            OR length(CAST(source_id AS BLOB))>512 OR length(CAST(text AS BLOB))>2097152
            THEN 1 ELSE 0 END),0) AS oversized FROM cache_items WHERE text IS NOT NULL`).get();
        if (!size || Number(size.rows) > 512 || Number(size.bytes) > 8 * 1024 * 1024 || size.oversized !== 0)
          throw new Error("Enrolled cache inspection limit exceeded");
        const rows = this.db.prepare("SELECT source_id,text FROM cache_items WHERE text IS NOT NULL").all();
        for (const row of rows) {
          if (typeof row.source_id !== "string") throw new Error("Enrolled content cache unavailable");
          openEnrolledCacheText(row.text as string, row.source_id, this.enrolledIdentity!);
        }
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
      return;
    }
    // WAL + busy timeout so the dev server and CLI can share the file safely.
    assertOrdinarySqliteResearchAuthority(this.db);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
    installOrdinarySqliteApplicationSchema(this.db);
    if (!this.privateBibliographies) {
      try { Object.defineProperty(this, "privateBibliographies", { value: createSqlitePrivateBibliographies(this.db) }); }
      catch (error) { if (!(error instanceof PrivateBibliographyError && error.code === "bibliography_unavailable")) throw error; }
    }
    if (!this.personalHistory) Object.defineProperty(this, "personalHistory", { value: createSqlitePersonalHistory(this.db) });
    if (!this.privateProfiles) {
      try { Object.defineProperty(this, "privateProfiles", { value: createSqlitePrivateProfiles(this.db) }); }
      catch (error) {
        // An unknown optional profile schema disables that domain without repairing it
        // or taking existing ordinary research/account/payment reads offline.
        if (!(error instanceof PrivateProfileError && error.code === "profile_unavailable")) throw error;
      }
    }
    // Releases before 2026-08-22 keyed two authenticated routes by the raw `kx_live_...` bearer
    // value before verification. Remove those legacy counters during every startup so the live DB
    // and every restored snapshot converge back to the documented hash-only secret invariant.
    this.db.exec(`DELETE FROM rate_limit_counters WHERE bucket GLOB 'ask:kx_live_*'`);
    if (cacheEncryptionRequired() && !hasContentKey()) {
      throw new Error("CONTENT_MASTER_KEY is required for paid-content cache access in real mode");
    }
    this.encryptLegacyCacheRows();
  }

  /** Seal every pre-v1 plaintext cache row in one transaction before the server accepts traffic. */
  private encryptLegacyCacheRows(): void {
    if (!hasContentKey()) return;
    const rows = this.db.prepare(`SELECT source_id,text FROM cache_items`).all() as {
      source_id: string;
      text: string | null;
    }[];
    const legacy = rows.filter((row) => row.text && !isEncryptedCacheValue(row.text));
    if (legacy.length === 0) return;
    const update = this.db.prepare(`UPDATE cache_items SET text=? WHERE source_id=?`);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of legacy) update.run(sealCacheText(row.text!), row.source_id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async upsertSource(s: Source): Promise<void> {
    const claim = getSqliteSourceClaimForSource(this.db, s.id);
    if (s.sourceClaimId && s.sourceClaimId !== claim?.id) throw new Error("Managed source import requires its original source claim history");
    if (claim && (canonicalSourceUrl(s.url) !== claim.canonicalUrl || s.onchainId?.toLowerCase() !== claim.onchainId?.toLowerCase()
      || claim.rssUrl && s.rssUrl !== claim.rssUrl)) throw new Error("Managed source identity differs from its retained claim");
    if (s.scholarlyEnrolled && (this.enrolledIdentity || !hasScholarlyRights(this.db) || !this.db.prepare("SELECT 1 FROM scholarly_enrollments WHERE source_id=?").get(s.id)))
      throw new Error("Marked scholarly sources require the original persisted rights history; standalone catalog import is refused");
    if (s.id.startsWith("public:")) throw new Error("Reserved public-reference source ID");
    // active/verified default to 1 (true) for offline/DB-direct rows that predate the flags.
    const activeInt = s.active === false ? 0 : 1;
    const verifiedInt = s.verified === false ? 0 : 1;
    this.db
      .prepare(
        `INSERT INTO sources (id,name,url,description,rss_url,wallet_address,fetch_price,tags,authors,created_at,ipfs_cid,active,onchain_id,register_tx,verified,preview_depth,evidence_provenance)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,COALESCE((SELECT evidence_provenance FROM sources WHERE id=?),?))
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,description=excluded.description,
           rss_url=excluded.rss_url,wallet_address=excluded.wallet_address,fetch_price=excluded.fetch_price,
           tags=excluded.tags,authors=excluded.authors,ipfs_cid=excluded.ipfs_cid,active=excluded.active,
           onchain_id=COALESCE(excluded.onchain_id,sources.onchain_id),
           register_tx=COALESCE(excluded.register_tx,sources.register_tx),
           verified=excluded.verified,
           evidence_provenance=COALESCE(sources.evidence_provenance,excluded.evidence_provenance),
           preview_depth=COALESCE(excluded.preview_depth,sources.preview_depth)`,
      )
      .run(
        s.id,
        s.name,
        s.url,
        s.description,
        s.rssUrl ?? null,
        s.walletAddress,
        s.fetchPrice,
        JSON.stringify(s.tags),
        JSON.stringify(s.authors),
        s.createdAt,
        s.ipfsCid ?? null,
        activeInt,
        s.onchainId ?? null,
        s.registerTx ?? null,
        verifiedInt,
        s.previewDepth ?? null,
        s.id, s.evidenceProvenance ?? null,
      );
  }

  async verifySourceIfUnchanged(input: { sourceId: string; walletAddress: string; feedUrl: string }): Promise<boolean> {
    if (!input.sourceId || input.sourceId.length > 256 || !/^0x[0-9a-f]{40}$/i.test(input.walletAddress) || !input.feedUrl || input.feedUrl.length > 4096)
      throw new Error("Invalid source verification identity");
    const result = this.db.prepare(`UPDATE sources SET verified=1 WHERE id=? AND lower(wallet_address)=?
      AND COALESCE(NULLIF(rss_url,''),url)=?`).run(input.sourceId, input.walletAddress.toLowerCase(), input.feedUrl);
    return result.changes === 1;
  }

  async setSourcePreviewDepth(id: string, depth: string): Promise<void> {
    this.db.prepare(`UPDATE sources SET preview_depth=? WHERE id=?`).run(depth, id);
  }

  async listPublicReferences(): Promise<PublicReference[]> {
    return this.db.prepare("SELECT snapshot FROM public_references WHERE active=1 ORDER BY id").all()
      .map((row) => publicReferenceSchema.parse(JSON.parse(String(row.snapshot))));
  }
  async getPublicReference(id: string): Promise<PublicReference | null> {
    const row = this.db.prepare("SELECT snapshot FROM public_references WHERE id=?").get(id);
    return row ? publicReferenceSchema.parse(JSON.parse(String(row.snapshot))) : null;
  }
  async upsertPublicReference(reference: PublicReference): Promise<void> {
    const value = publicReferenceSchema.parse(reference);
    this.db.prepare(`INSERT INTO public_references(id,active,rss_url,snapshot) VALUES (?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET active=excluded.active,rss_url=excluded.rss_url,snapshot=excluded.snapshot`)
      .run(value.id, Number(value.active), value.rssUrl, JSON.stringify(value));
  }
  async listSources(): Promise<Source[]> {
    // Filter to active=1 only — deactivated on-chain sources must not be discovered/cited.
    const rows = this.db.prepare(`SELECT * FROM sources WHERE active = 1 ORDER BY created_at`).all();
    return rows.map(row => rowToSourceWithClaim(this.db, row));
  }

  async listAllSources(): Promise<Source[]> {
    // Deactivated rows included — owner history only, never discovery. See the interface note.
    const rows = this.db.prepare(`SELECT * FROM sources ORDER BY created_at`).all();
    return rows.map(row => rowToSourceWithClaim(this.db, row));
  }

  async setSourceMeta(id: string, meta: import("./keryx-db").SourceMeta): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO source_meta (id,name,description,url,rss_url,updated_at) VALUES (?,?,?,?,?,?)`,
      )
      .run(id, meta.name, meta.description, meta.url, meta.rssUrl ?? null, new Date().toISOString());
  }

  async getSourceMeta(id: string): Promise<import("./keryx-db").SourceMeta | null> {
    const row = this.db
      .prepare(`SELECT name,description,url,rss_url FROM source_meta WHERE id=?`)
      .get(id);
    if (!row) return null;
    return {
      name: (row.name as string) ?? "",
      description: (row.description as string) ?? "",
      url: (row.url as string) ?? "",
      rssUrl: (row.rss_url as string) || undefined,
    };
  }

  async setSourceNotify(id: string, url: string, secret: string): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO source_notify (source_id,notify_url,secret,updated_at) VALUES (?,?,?,?)`,
      )
      .run(id, url, secret, new Date().toISOString());
  }

  async getSourceNotify(id: string): Promise<import("./keryx-db").SourceNotify | null> {
    const row = this.db.prepare(`SELECT notify_url,secret FROM source_notify WHERE source_id=?`).get(id);
    if (!row) return null;
    return { url: row.notify_url as string, secret: row.secret as string };
  }

  async deleteSourceNotify(id: string): Promise<void> {
    this.db.prepare(`DELETE FROM source_notify WHERE source_id=?`).run(id);
  }

  async setSourceNotifyEmail(id: string, email: string, unsubToken: string): Promise<void> {
    // Fresh save resets last_sent_at — a new address should hear about its next citation promptly.
    this.db
      .prepare(
        `INSERT OR REPLACE INTO source_notify_email (source_id,email,unsub_token,last_sent_at,updated_at) VALUES (?,?,?,NULL,?)`,
      )
      .run(id, email, unsubToken, new Date().toISOString());
  }

  async getSourceNotifyEmail(id: string): Promise<import("./keryx-db").SourceNotifyEmail | null> {
    const row = this.db
      .prepare(`SELECT email,unsub_token,last_sent_at FROM source_notify_email WHERE source_id=?`)
      .get(id);
    if (!row) return null;
    return {
      email: row.email as string,
      unsubToken: row.unsub_token as string,
      lastSentAt: (row.last_sent_at as string) ?? null,
    };
  }

  async deleteSourceNotifyEmail(id: string): Promise<void> {
    this.db.prepare(`DELETE FROM source_notify_email WHERE source_id=?`).run(id);
  }

  async markSourceNotifyEmailSent(id: string, at: string): Promise<void> {
    this.db.prepare(`UPDATE source_notify_email SET last_sent_at=? WHERE source_id=?`).run(at, id);
  }

  async getSource(id: string): Promise<Source | null> {
    const row = this.db.prepare(`SELECT * FROM sources WHERE id=?`).get(id);
    return row ? rowToSourceWithClaim(this.db, row) : null;
  }

  async getSourceByOnchainId(onchainId: string): Promise<Source | null> {
    const row = this.db
      .prepare(`SELECT * FROM sources WHERE lower(onchain_id) = lower(?) LIMIT 1`)
      .get(onchainId);
    return row ? rowToSourceWithClaim(this.db, row) : null;
  }

  async addItems(items: SourceItem[]): Promise<void> {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO source_items
         (id,source_id,title,summary,content,link,published_at,ipfs_cid,item_key_enc,item_iv,item_auth_tag,
          item_wrap_iv,delivery_kind,storage_mode,plaintext_bytes,body_hash,manifest_id,manifest_signer,
          manifest_nonce,manifest_signature,manifest_created_at,evidence_provenance)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,COALESCE((SELECT evidence_provenance FROM source_items WHERE id=?),?,(SELECT evidence_provenance FROM sources WHERE id=?)))`,
    );
    for (const i of items)
      stmt.run(
        i.id, i.sourceId, i.title, i.summary, i.content, i.link, i.publishedAt ?? null,
        i.ipfsCid ?? null, i.itemKeyEnc ?? null, i.itemIv ?? null, i.itemAuthTag ?? null,
        i.itemWrapIv ?? null, i.deliveryKind ?? null, i.storageMode ?? null,
        i.plaintextBytes ?? null, i.bodyHash ?? null, i.manifest?.id ?? null,
        i.manifest?.signer ?? null, i.manifest?.nonce ?? null, i.manifest?.signature ?? null,
        i.manifest?.createdAt ?? null,
        i.id, i.evidenceProvenance ?? null, i.sourceId,
      );
  }

  async getItems(sourceId: string): Promise<SourceItem[]> {
    const rows = this.db
      .prepare(`SELECT * FROM source_items WHERE source_id=? ORDER BY published_at DESC`)
      .all(sourceId);
    return rows.map((r) => ({
      evidenceProvenance: r.evidence_provenance === "synthetic-demo" ? "synthetic-demo" : undefined,
      id: r.id as string,
      sourceId: r.source_id as string,
      title: r.title as string,
      summary: r.summary as string,
      content: r.content as string,
      link: r.link as string,
      publishedAt: (r.published_at as string) ?? undefined,
      ipfsCid: (r.ipfs_cid as string) ?? undefined,
      itemKeyEnc: (r.item_key_enc as string) ?? undefined,
      itemIv: (r.item_iv as string) ?? undefined,
      itemAuthTag: (r.item_auth_tag as string) ?? undefined,
      itemWrapIv: (r.item_wrap_iv as string) ?? undefined,
      deliveryKind: (r.delivery_kind as SourceItem["deliveryKind"]) ?? undefined,
      storageMode: (r.storage_mode as SourceItem["storageMode"]) ?? undefined,
      plaintextBytes:
        r.plaintext_bytes === null || r.plaintext_bytes === undefined
          ? undefined
          : Number(r.plaintext_bytes),
      bodyHash: (r.body_hash as string) ?? undefined,
      manifest: rowToArticleContentManifest(r),
    }));
  }

  async getItem(sourceId: string, itemId: string): Promise<SourceItem | null> {
    const row = this.db
      .prepare(`SELECT * FROM source_items WHERE source_id=? AND id=? LIMIT 1`)
      .get(sourceId, itemId);
    return row ? rowToSourceItem(row) : null;
  }

  async getSourceItemByLink(sourceId: string, exactItemUrl: string): Promise<SourceItem | null> {
    const rows = this.db.prepare(`SELECT * FROM source_items WHERE source_id=? AND link=? LIMIT 2`).all(sourceId, exactItemUrl);
    if (rows.length > 1) throw new Error("Ambiguous exact source article membership");
    return rows.length ? rowToSourceItem(rows[0]) : null;
  }

  async getArticleOffer(sourceId: string, itemId: string): Promise<ArticleOffer | null> {
    const row = this.db
      .prepare(`SELECT * FROM article_offers WHERE source_id=? AND item_id=? LIMIT 1`)
      .get(sourceId, itemId);
    return row ? rowToArticleOffer(row) : null;
  }

  async listArticleOffers(sourceId?: string): Promise<ArticleOffer[]> {
    const rows = sourceId
      ? this.db
          .prepare(`SELECT * FROM article_offers WHERE source_id=? ORDER BY created_at DESC`)
          .all(sourceId)
      : this.db.prepare(`SELECT * FROM article_offers ORDER BY created_at DESC`).all();
    return rows.map(rowToArticleOffer);
  }

  async setArticleOffer(offer: ArticleOffer): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO article_offers
           (source_id,item_id,id,content_version,price_usdc6,expires_at,signer,nonce,signature,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(source_id,item_id) DO UPDATE SET
           id=excluded.id,content_version=excluded.content_version,
           price_usdc6=excluded.price_usdc6,expires_at=excluded.expires_at,
           signer=excluded.signer,nonce=excluded.nonce,signature=excluded.signature,
           created_at=excluded.created_at`,
      )
      .run(
        offer.sourceId,
        offer.itemId,
        offer.id,
        offer.contentVersion,
        offer.priceUsdc6,
        offer.expiresAt,
        offer.signer,
        offer.nonce,
        offer.signature,
        offer.createdAt,
      );
  }

  async deleteArticleOffer(sourceId: string, itemId: string): Promise<void> {
    this.db
      .prepare(`DELETE FROM article_offers WHERE source_id=? AND item_id=?`)
      .run(sourceId, itemId);
  }

  /**
   * The `published_at LIKE` guard is not decoration: the column holds whatever the feed said, and
   * these comparisons are lexicographic. An RFC-822 date ("Wed, 02 Oct …") sorts above every ISO
   * string, so one badly-dated row would read as newer than any answer. Only ISO-shaped values are
   * allowed to prove recency; ingest normalises new rows to ISO (see lib/ingest/rss.ts).
   */
  async countItemsPublishedBetween(
    sourceIds: string[],
    sinceIso: string,
    untilIso: string,
  ): Promise<Record<string, number>> {
    if (sourceIds.length === 0) return {};
    const holes = sourceIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT source_id, COUNT(*) AS n FROM source_items
          WHERE source_id IN (${holes})
            AND published_at LIKE '____-__-__%'
            AND published_at > ? AND published_at <= ?
          GROUP BY source_id`,
      )
      .all(...sourceIds, sinceIso, untilIso);
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.source_id as string] = Number(r.n);
    return counts;
  }

  async newestItemDates(sourceIds: string[]): Promise<Record<string, string>> {
    if (sourceIds.length === 0) return {};
    const holes = sourceIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT source_id, MAX(published_at) AS newest FROM source_items
          WHERE source_id IN (${holes}) AND published_at LIKE '____-__-__%'
          GROUP BY source_id`,
      )
      .all(...sourceIds);
    const newest: Record<string, string> = {};
    for (const r of rows) if (r.newest) newest[r.source_id as string] = r.newest as string;
    return newest;
  }

  async isCreatorWallet(addr: string): Promise<boolean> {
    // Case-insensitive match via LOWER() — wallet addresses from SIWE are checksummed
    // but stored addresses in older rows may vary in case.
    const row = this.db
      .prepare(`SELECT 1 FROM sources WHERE LOWER(wallet_address) = LOWER(?) LIMIT 1`)
      .get(addr);
    return row !== undefined;
  }

  async createAuthChallenge(hash: string, issuedAt: number, expiresAt: number): Promise<void> {
    this.db.prepare("DELETE FROM auth_challenges WHERE expires_at <= ?").run(issuedAt);
    this.db.prepare("INSERT INTO auth_challenges (hash, issued_at, expires_at) VALUES (?, ?, ?)").run(hash, issuedAt, expiresAt);
  }

  async createWebSession(record: WebSessionRecord): Promise<void> {
    this.db.prepare("DELETE FROM web_sessions WHERE expires_at <= ?").run(record.issuedAt);
    this.db.prepare("INSERT INTO web_sessions (hash,wallet,issued_at,expires_at) VALUES (?,?,?,?)")
      .run(record.hash, record.wallet.toLowerCase(), record.issuedAt, record.expiresAt);
  }

  async getWebSession(hash: string): Promise<WebSessionRecord | null> {
    const row = this.db.prepare("SELECT hash,wallet,issued_at,expires_at FROM web_sessions WHERE hash = ?").get(hash);
    return row ? { hash: String(row.hash), wallet: String(row.wallet), issuedAt: Number(row.issued_at), expiresAt: Number(row.expires_at) } : null;
  }

  async revokeWebSession(hash: string, wallet: string): Promise<void> {
    this.db.prepare("DELETE FROM web_sessions WHERE hash = ? AND wallet = LOWER(?)").run(hash, wallet);
  }

  async listWebSessions(wallet: string, now: number): Promise<WebSessionRecord[]> {
    return this.db.prepare("SELECT hash,wallet,issued_at,expires_at FROM web_sessions WHERE wallet = LOWER(?) AND issued_at <= ? AND expires_at > ? ORDER BY issued_at DESC, hash ASC LIMIT 101")
      .all(wallet, now, now).map(row => ({ hash: String(row.hash), wallet: String(row.wallet), issuedAt: Number(row.issued_at), expiresAt: Number(row.expires_at) }));
  }

  async revokeOtherWebSessions(wallet: string, keepHash: string): Promise<void> {
    this.db.prepare("DELETE FROM web_sessions WHERE wallet = LOWER(?) AND hash != ?").run(wallet, keepHash);
  }

  async consumeAuthChallenge(hash: string, now: number): Promise<boolean> {
    const result = this.db.prepare("DELETE FROM auth_challenges WHERE hash = ? AND issued_at <= ? AND expires_at > ?")
      .run(hash, now, now);
    return Number(result.changes) === 1;
  }

  async upsertUser(addr: string, role: string): Promise<{ user: UserRecord; created: boolean }> {
    const wallet = addr.toLowerCase();
    const now = new Date().toISOString();
    const existing = (await this.getUser(wallet)) !== null;
    // first_seen_at is preserved on conflict; only role + last_seen_at refresh.
    this.db
      .prepare(
        `INSERT INTO users (wallet_address,role,display_handle,first_seen_at,last_seen_at)
         VALUES (?,?,?,?,?)
         ON CONFLICT(wallet_address) DO UPDATE SET role=excluded.role, last_seen_at=excluded.last_seen_at`,
      )
      .run(wallet, role, shortAddress(addr), now, now);
    const user = (await this.getUser(wallet))!;
    return { user, created: !existing };
  }

  async getUser(addr: string): Promise<UserRecord | null> {
    const row = this.db
      .prepare(`SELECT * FROM users WHERE wallet_address = LOWER(?)`)
      .get(addr) as Record<string, unknown> | undefined;
    return row ? rowToUser(row) : null;
  }

  async getCached(sourceId: string): Promise<string | null> {
    if (this.enrolledIdentity) {
      const row = this.db.prepare(`SELECT CASE WHEN text IS NULL OR
        (typeof(text)='text' AND length(CAST(text AS BLOB))<=2097152) THEN text ELSE NULL END AS text,
        CASE WHEN text IS NULL OR (typeof(text)='text' AND length(CAST(text AS BLOB))<=2097152)
          THEN 0 ELSE 1 END AS oversized FROM cache_items WHERE source_id=?`).get(sourceId);
      if (row?.oversized === 1) throw new Error("Enrolled content cache unavailable");
      return row ? openEnrolledCacheText(row.text as string, sourceId, this.enrolledIdentity) : null;
    }
    const row = this.db.prepare(`SELECT text FROM cache_items WHERE source_id=?`).get(sourceId);
    return row ? openCacheText(row.text as string) : null;
  }

  async getCachedAt(sourceId: string): Promise<string | null> {
    const row = this.db
      .prepare(`SELECT updated_at FROM cache_items WHERE source_id=?`)
      .get(sourceId);
    return row ? ((row.updated_at as string) ?? null) : null;
  }

  async setCached(sourceId: string, text: string): Promise<void> {
    if (this.enrolledIdentity) {
      const encoded = sealEnrolledCacheText(text, sourceId, this.enrolledIdentity);
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const size = this.db.prepare(`SELECT count(*) AS rows,
          COALESCE(sum(length(CAST(text AS BLOB))),0) AS bytes FROM cache_items
          WHERE source_id IS NOT ? AND text IS NOT NULL`).get(sourceId);
        if (!size || Number(size.rows) + 1 > 512 || Number(size.bytes) + Buffer.byteLength(encoded) > 8 * 1024 * 1024)
          throw new Error("Enrolled cache inspection limit exceeded");
        this.db.prepare("INSERT OR REPLACE INTO cache_items(source_id,text,updated_at) VALUES(?,?,?)")
          .run(sourceId, encoded, new Date().toISOString());
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
      return;
    }
    this.db
      .prepare(
        `INSERT OR REPLACE INTO cache_items (source_id,text,updated_at) VALUES (?,?,?)`,
      )
      .run(sourceId, this.enrolledIdentity ? sealEnrolledCacheText(text, sourceId, this.enrolledIdentity) : sealCacheText(text), new Date().toISOString());
  }

  async getSyncState(key: string): Promise<string | null> {
    const row = this.db.prepare(`SELECT value FROM sync_state WHERE key=?`).get(key);
    return row ? (row.value as string) : null;
  }
  async issueSourceClaimChallenge(input: IssueSourceClaimChallenge) { return issueSqliteSourceClaimChallenge(this.db, input); }
  async getSourceClaimChallenge(id: string) { return getSqliteSourceClaimChallenge(this.db, id); }
  async reserveSourceClaimVerification(challengeId: string, wallet: string, now?: number) { return reserveSqliteSourceClaimVerification(this.db, challengeId, wallet, now); }
  async verifySourceClaim(input: VerifySourceClaim) { return verifySqliteSourceClaim(this.db, input); }
  async getSourceClaim(id: string) { return getSqliteSourceClaim(this.db, id); }
  async getSourceClaimForSource(id: string) { return getSqliteSourceClaimForSource(this.db, id); }
  async listSourceClaims(wallet?: string) { return listSqliteSourceClaims(this.db, wallet); }
  async bindSourceClaim(input: BindSourceClaim) { return bindSqliteSourceClaim(this.db, input); }
  async updateSourceClaimPolicy(input: UpdateSourceClaimPolicy) { return updateSqliteSourceClaimPolicy(this.db, input); }

  async claimSourceUpkeep(now: number): Promise<SourceUpkeepClaim | null> {
    return claimSqliteSourceUpkeep(this.db, now);
  }

  async finishSourceUpkeep(claim: SourceUpkeepClaim, summary: SourceUpkeepSummary, now: number): Promise<void> {
    finishSqliteSourceUpkeep(this.db, claim, summary, now);
  }

  async setSyncState(key: string, value: string): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sync_state (key,value,updated_at) VALUES (?,?,?)`,
      )
      .run(key, value, new Date().toISOString());
  }

  // ── session grants ──

  async issueSessionGrantConsent(consent: SessionGrantConsent): Promise<void> {
    if (this.enrolledMode !== "mainnet-real") throw new Error("Owner-signed consent requires admitted mainnet storage");
    issueSqliteSessionGrantConsent(this.db, consent, this.paymentProfile);
  }
  async browserSignerRetainedSpendMicro(signer: string): Promise<number> {
    if (!sqliteJournalActive(this.db) || !/^0x[0-9a-f]{40}$/i.test(signer)) throw new Error("Retained signer capacity unavailable");
    const spent = Number(this.db.prepare("SELECT spent_micro FROM browser_signer_capacity WHERE signer=?").get(signer.toLowerCase())?.spent_micro ?? 0);
    if (!Number.isSafeInteger(spent) || spent < 0) throw new Error("Retained signer capacity unavailable");
    return spent;
  }
  async sessionFundingAccounting(signer: string, after?: string) {
    if (this.enrolledMode !== "mainnet-real") throw new Error("Session funding accounting requires admitted mainnet storage");
    return sqliteSessionFundingAccounting(this.db, signer, after);
  }
  async admitHostedTreasuryPolicy(policy: HostedTreasuryPolicy,role:"public"|"private") {
    if (this.enrolledMode !== "mainnet-real") throw new Error("Hosted authority requires admitted mainnet storage");
    return admitSqliteHostedPolicy(this.db, policy, this.enrolledIdentity!,role);
  }
  async hostedTreasuryAccounting(signer: string,role?:"public"|"private") {
    if (this.enrolledMode !== "mainnet-real") throw new Error("Hosted authority requires admitted mainnet storage");
    return sqliteHostedAccounting(this.db, signer,role);
  }
  async admitHostedAuthorization(input: HostedAuthorizationAdmission) {
    if (this.enrolledMode !== "mainnet-real") throw new Error("Hosted authority requires admitted mainnet storage");
    return admitSqliteHostedAuthorization(this.db, input, this.enrolledIdentity!);
  }
  async submitHostedAuthorization(signer: string, submission: Readonly<import("../payments/server-x402-client").ServerX402Submission>, headerHash: string) {
    if (this.enrolledMode !== "mainnet-real") throw new Error("Hosted authority requires admitted mainnet storage");
    return submitSqliteHostedAuthorization(this.db, signer, submission, headerHash);
  }
  async confirmHostedAuthorization(signer: string, nonce: string, transaction: string) {
    if (this.enrolledMode !== "mainnet-real") throw new Error("Hosted authority requires admitted mainnet storage");
    return confirmSqliteHostedAuthorization(this.db, signer, nonce, transaction);
  }
  async sessionWithdrawalAccounting(signer: string) {
    if (this.enrolledMode !== "mainnet-real") throw new Error("Session withdrawal requires admitted mainnet storage");
    return sqliteSessionWithdrawalAccounting(this.db, signer);
  }
  async creatorOwnerWithdrawalAccounting(owner:string) {
    if(this.enrolledMode!=="mainnet-real") throw new Error("Owner withdrawal requires admitted mainnet storage");
    return sqliteCreatorOwnerAccounting(this.db,owner);
  }
  async admitCreatorOwnerWithdrawal(record:WithdrawalRequestRecord,accounting:CreatorOwnerWithdrawalAccounting,availableMicroUsdc:string) {
    if(this.enrolledMode!=="mainnet-real") throw new Error("Owner withdrawal requires admitted mainnet storage");
    return admitSqliteCreatorOwnerWithdrawal(this.db,record,accounting,availableMicroUsdc);
  }
  async getCreatorOwnerWithdrawalCompletion(id:string,owner:string) {
    if(this.enrolledMode!=="mainnet-real") throw new Error("Owner withdrawal requires admitted mainnet storage");
    return readSqliteCreatorOwnerCompletion(this.db,id,owner);
  }
  async completeCreatorOwnerWithdrawal(completion:CreatorOwnerWithdrawalCompletion) {
    if(this.enrolledMode!=="mainnet-real") throw new Error("Owner withdrawal requires admitted mainnet storage");
    return completeSqliteCreatorOwnerWithdrawal(this.db,completion);
  }
  async reserveSessionWithdrawal(preparation: SessionWithdrawalPreparation) {
    if (this.enrolledMode !== "mainnet-real") throw new Error("Session withdrawal requires admitted mainnet storage");
    return reserveSqliteSessionWithdrawal(this.db, preparation);
  }
  async getSessionWithdrawal(id: string, owner: string) {
    if (this.enrolledMode !== "mainnet-real") throw new Error("Session withdrawal requires admitted mainnet storage");
    return readSqliteSessionWithdrawal(this.db, id, owner);
  }
  async pendingSessionWithdrawal(owner: string, signer: string) {
    if (this.enrolledMode !== "mainnet-real") throw new Error("Session withdrawal requires admitted mainnet storage");
    return pendingSqliteSessionWithdrawal(this.db, owner, signer);
  }
  async getSessionWithdrawalCompletion(id: string, owner: string) {
    if (this.enrolledMode !== "mainnet-real") throw new Error("Session withdrawal requires admitted mainnet storage");
    return readSqliteSessionWithdrawalCompletion(this.db, id, owner);
  }
  async getSessionWithdrawalSigningPhase(id: string, owner: string) {
    if (this.enrolledMode !== "mainnet-real") throw new Error("Session withdrawal requires admitted mainnet storage");
    return readSqliteSessionWithdrawalPhase(this.db, id, owner);
  }
  async authorizeSessionWithdrawal(id: string, owner: string) {
    if (this.enrolledMode !== "mainnet-real") throw new Error("Session withdrawal requires admitted mainnet storage");
    return exposeSqliteSessionWithdrawal(this.db, id, owner);
  }
  async cancelSessionWithdrawal(id: string, owner: string) {
    if (this.enrolledMode !== "mainnet-real") throw new Error("Session withdrawal requires admitted mainnet storage");
    return cancelSqliteSessionWithdrawal(this.db, id, owner);
  }
  async getSessionWithdrawalAbort(id: string, owner: string) {
    if (this.enrolledMode !== "mainnet-real") throw new Error("Session withdrawal requires admitted mainnet storage");
    return readSqliteSessionWithdrawalAbort(this.db, id, owner);
  }
  async abortSessionWithdrawal(id: string, owner: string, proof: import("../gateway/session-withdrawal-abort").SessionWithdrawalAbort) {
    if (this.enrolledMode !== "mainnet-real") throw new Error("Session withdrawal requires admitted mainnet storage");
    return abortSqliteSessionWithdrawal(this.db, id, owner, proof);
  }
  async completeSessionWithdrawal(id: string, owner: string, outcome: import("../gateway/session-withdrawal-completion").SessionWithdrawalCompletion) {
    if (this.enrolledMode !== "mainnet-real") throw new Error("Session withdrawal requires admitted mainnet storage");
    return completeSqliteSessionWithdrawal(this.db, id, owner, outcome);
  }
  async listSessionWithdrawalPayments(signer: string, afterNonce?: string, limit?: number) {
    if (this.enrolledMode !== "mainnet-real") throw new Error("Session withdrawal requires admitted mainnet storage");
    return listSqliteSessionWithdrawalPayments(this.db, signer, afterNonce, limit);
  }
  async consumeSessionGrantConsent(consent: SessionGrantConsent, signature: string, sessionSignature: string): Promise<void> {
    if (this.enrolledMode !== "mainnet-real") throw new Error("Owner-signed consent requires admitted mainnet storage");
    consumeSqliteSessionGrantConsent(this.db, consent, signature, sessionSignature, this.paymentProfile);
  }
  async getSessionGrantConsent(owner: string, epoch: string) {
    if (this.enrolledMode !== "mainnet-real") throw new Error("Owner-signed consent requires admitted mainnet storage");
    return readSqliteSessionGrantConsent(this.db, owner, epoch, this.paymentProfile);
  }

  async upsertSessionGrant(grant: Omit<SessionGrantRecord, "spent">): Promise<void> {
    if (sqliteJournalActive(this.db)) return upsertSqliteJournalGrant(this.db, grant);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO session_grants
           (session_id, sess_addr, owner_addr, cap, spent, expiry, tx_hash, grant_epoch)
         VALUES (?,?,?,?,0,?,?,?)`,
      )
      .run(
        grant.sessionId,
        grant.sessAddr,
        grant.ownerAddr,
        grant.cap,
        grant.expiry,
        grant.txHash,
        grant.grantEpoch,
      );
  }

  async getSessionGrant(sessionId: string): Promise<SessionGrantRecord | null> {
    const r = this.db
      .prepare(`SELECT * FROM session_grants WHERE session_id = ?`)
      .get(sessionId) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      sessionId: r.session_id as string,
      sessAddr: r.sess_addr as string,
      ownerAddr: r.owner_addr as string,
      cap: r.cap as number,
      spent: r.spent as number,
      expiry: Number(r.expiry),
      txHash: r.tx_hash as string,
      grantEpoch: r.grant_epoch as string,
    };
  }

  /** Reserve atomically, including the cap predicate, so concurrent asks cannot both pass. */
  async addSessionGrantSpend(sessionId: string, grantEpoch: string, sessAddr: string, amount: number): Promise<boolean> {
    const res = this.db
      .prepare(
        `UPDATE session_grants
            SET spent = ROUND(spent + ?, 6)
          WHERE session_id = ?
            AND grant_epoch = ?
            AND LOWER(sess_addr) = LOWER(?)
            AND ROUND(spent + ?, 6) <= cap
            AND expiry > ?`,
      )
      .run(amount, sessionId, grantEpoch, sessAddr, amount, Date.now());
    return Number(res.changes) > 0;
  }

  async admitBrowserAuthorization(input: BrowserAuthorizationIntent): Promise<BrowserAdmissionResult> {
    const intent = prepareBrowserAuthorizationIntent(input, this.paymentProfile);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const updated = this.db.prepare(`UPDATE session_grants
        SET spent = (ROUND(spent * 1000000) + ?) / 1000000.0
        WHERE session_id = ? AND grant_epoch = ? AND LOWER(sess_addr) = LOWER(?)
          AND expiry > ?
          AND ABS(cap * 1000000 - ROUND(cap * 1000000)) < 0.000001
          AND ABS(spent * 1000000 - ROUND(spent * 1000000)) < 0.000001
          AND ROUND(spent * 1000000) + ? <= ROUND(cap * 1000000)`)
        .run(intent.amountMicroUsdc, intent.sessionId, intent.grantEpoch, intent.signer, Date.now(), intent.amountMicroUsdc);
      if (!updated.changes) {
        this.db.exec("ROLLBACK");
        return { status: "grant_or_cap_refused" };
      }
      this.db.prepare(`INSERT INTO browser_authorization_intents
        (nonce,session_id,request_id,query_id,grant_epoch,signer,network,token,gateway_contract,
         source_id,offer_id,kind,payee,amount_micro_usdc,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(intent.nonce, intent.sessionId, intent.requestId, intent.queryId, intent.grantEpoch,
          intent.signer, intent.network, intent.token, intent.gatewayContract, intent.sourceId,
          intent.offerId, intent.kind, intent.payee, intent.amountMicroUsdc, intent.createdAt);
      this.db.exec("COMMIT");
      return { status: "admitted", intent };
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* SQLite already rolled back */ }
      throw error;
    }
  }

  async browserJournalActive() {
    return sqliteJournalActive(this.db);
  }
  async browserSignerConfirmedSpendMicro(signer: string): Promise<number> {
    if (this.enrolledMode === "mainnet-real") return Number(sqliteSessionFundingAccounting(this.db, signer.toLowerCase()).confirmedSpentMicroUsdc);
    const rows = this.db
      .prepare(
        "SELECT * FROM payment_events WHERE lower(payer)=lower(?) AND grant_epoch IS NOT NULL AND settled=1 AND settlement_status='settled' AND network=?"
      )
      .all(signer, this.paymentProfile.networkId);
    const seen = new Map<string, string>();
    let total = 0;
    for (const row of rows) {
      if (
        !/^0x[0-9a-f]{64}$/i.test(String(row.authorization_id)) ||
        !String(row.tx_hash ?? "").trim()
      )
        continue;
      if (
        !/^0x[0-9a-f]{40}$/i.test(signer) ||
        !/^0x[0-9a-f]{40}$/i.test(String(row.payee))
      )
        throw new Error("Invalid historical settled identity");
      const nonce = String(row.authorization_id).toLowerCase(),
        tuple = JSON.stringify([
          String(row.payee).toLowerCase(),
          row.amount_usdc,
          row.network,
          row.grant_epoch,
          row.source_id,
          row.query_id,
          row.kind,
          row.offer_id,
        ]);
      if (seen.has(nonce)) {
        if (seen.get(nonce) !== tuple)
          throw new Error("Conflicting historical authorization evidence");
        continue;
      }
      seen.set(nonce, tuple);
      const amount = Math.round(Number(row.amount_usdc) * 1e6);
      if (
        !Number.isSafeInteger(amount) ||
        amount <= 0 ||
        Math.abs(Number(row.amount_usdc) * 1e6 - amount) >= 0.000001
      )
        throw new Error("Invalid historical settled amount");
      total += amount;
      if (!Number.isSafeInteger(total))
        throw new Error("Historical settled amount exceeds safe capacity");
    }
    return total;
  }
  async activateBrowserJournal() {
    activateSqliteBrowserJournal(this.db, this.paymentProfile);
  }
  async admitBrowserJournal(input: BrowserJournalAdmission) {
    if (this.enrolledIdentity) return admitSqliteBrowserJournal(this.db, input, undefined, this.paymentProfile);
    if (!hasScholarlyRights(this.db)) {
      assertNoOrphanedPaperMarker(this.db, input.sourceId);
      return admitSqliteBrowserJournal(this.db, input);
    }
    const { admitSqlitePaperJournal } = await import("./scholarly-rights");
    return admitSqlitePaperJournal(this.db, this, input);
  }
  async getPaperState(sourceId: string) {
    if (this.enrolledIdentity) {
      if ((await this.getSource(sourceId))?.scholarlyEnrolled) throw new Error("Scholarly rights are unsupported on enrolled native storage");
      return null;
    }
    if (!hasScholarlyRights(this.db)) { assertNoOrphanedPaperMarker(this.db, sourceId); return null; }
    const { getSqlitePaperState } = await import("./scholarly-rights");
    return getSqlitePaperState(this.db, sourceId);
  }
  async beginPaperEnrollment(sourceId: string, creator: string) {
    if (this.enrolledIdentity) throw new Error("Scholarly enrollment is unsupported on enrolled native storage");
    const source = await this.getSource(sourceId);
    if (!source) throw new Error("Registered source is required");
    const { sourceFetchTerms } = await import("../registry/source-fetch-payto");
    const terms = await sourceFetchTerms(source, { refresh: true });
    if (terms.authority !== "onchain" || terms.stale || terms.creator.toLowerCase() !== creator.toLowerCase())
      throw new Error("Fresh registered creator is required");
    const { beginSqlitePaper } = await import("./scholarly-rights");
    beginSqlitePaper(this.db, sourceId, creator);
  }
  async submitPaper(input: import("../scholarly/rights-protocol").SignedPaperDeclaration) {
    if (this.enrolledIdentity) throw new Error("Scholarly enrollment is unsupported on enrolled native storage");
    const { submitSqlitePaper } = await import("./scholarly-rights");
    return submitSqlitePaper(this.db, this, input);
  }
  async reviewPaper(input: import("../scholarly/rights-protocol").SignedPaperDecision) {
    if (this.enrolledIdentity) throw new Error("Scholarly review is unsupported on enrolled native storage");
    const { reviewSqlitePaper } = await import("./scholarly-rights");
    return reviewSqlitePaper(this.db, this, input);
  }
  async getPaperAdmission(nonce: string) {
    if (this.enrolledIdentity || !hasScholarlyRights(this.db)) return null;
    const { getSqlitePaperAdmission } = await import("./scholarly-rights");
    return getSqlitePaperAdmission(this.db, nonce);
  }
  async admitBrowserQueryPolicy(proof:BrowserQueryPolicyProof,sessionId:string) {return admitSqliteBrowserQueryPolicy(this.db,proof,sessionId);}
  async admitBrowserSigningOriginal(input:BrowserOriginalAdmission) {return admitSqliteBrowserSigningOriginal(this.db,input);}
  async admitBrowserSourceSigningOriginal(input:import("./browser-signing-originals").BrowserSourceOriginalAdmission) {
    return admitSqliteBrowserSourceSigningOriginal(this.db, input, createBrowserOriginalSourceAuthority(this));
  }
  async readExposedBrowserSigningSnapshotForSigner(signer:string,sessionId:string,requestId:string) {return readExposedSqliteBrowserSigningSnapshotForSigner(this.db,signer,sessionId,requestId);}
  async readBrowserSigningSnapshot(owner:string,sessionId:string,requestId:string) {return readSqliteBrowserSigningSnapshot(this.db,owner,sessionId,requestId);}
  async signBrowserSigningOriginal(sessionId:string,requestId:string,header:string) {return signSqliteBrowserSigningOriginal(this.db,sessionId,requestId,header);}
  async getBrowserJournal(sessionId: string, requestId: string) {
    return getSqliteBrowserJournal(this.db, sessionId, requestId);
  }
  async exposeBrowserJournal(sessionId: string, requestId: string) {
    return transitionSqliteBrowserJournal(
      this.db,
      sessionId,
      requestId,
      "prepared",
      "exposed"
    );
  }
  async cancelPreparedBrowserJournal(sessionId: string, requestId: string) {
    return cancelSqlitePreparedJournal(this.db, sessionId, requestId);
  }
  async signBrowserJournal(
    sessionId: string,
    requestId: string,
    metadata: BrowserSignedMetadata
  ) {
    return signSqliteBrowserJournal(this.db, sessionId, requestId, metadata);
  }
  async submitBrowserJournal(sessionId: string, requestId: string) {
    return transitionSqliteBrowserJournal(
      this.db,
      sessionId,
      requestId,
      "signed",
      "submission_attempted"
    );
  }

  async createGapIntent(
    input: Omit<
      GapIntent,
      | "id"
      | "status"
      | "attempts"
      | "leaseExpiresAt"
      | "retryRunId"
      | "coverage"
      | "rewardUsdc"
      | "lastError"
      | "createdAt"
      | "updatedAt"
    >,
  ): Promise<GapIntent> {
    const now = new Date().toISOString();
    const owner = input.ownerWallet.toLowerCase();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db
        .prepare(
          `SELECT * FROM gap_intents
            WHERE gap_id=? AND LOWER(owner_wallet)=?
            ORDER BY created_at ASC
            LIMIT 1`,
        )
        .get(input.gapId, owner);
      if (existing) {
        this.db.exec("COMMIT");
        return rowToGapIntent(existing as Record<string, unknown>);
      }

      const id = crypto.randomUUID();
      this.db
        .prepare(
          `INSERT INTO gap_intents (
             id,gap_id,claim,question,failed_query_id,source_id,source_item_link,
             item_id,content_version,article_offer_id,owner_wallet,status,attempts,created_at,updated_at
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?, 'pending',0,?,?)`,
        )
        .run(
          id,
          input.gapId,
          input.claim,
          input.question,
          input.failedQueryId,
          input.sourceId,
          input.sourceItemLink,
          input.itemId ?? null,
          input.contentVersion ?? null,
          input.articleOfferId ?? null,
          owner,
          now,
          now,
        );
      const row = this.db
        .prepare(`SELECT * FROM gap_intents WHERE id=?`)
        .get(id);
      this.db.exec("COMMIT");
      return rowToGapIntent(row as Record<string, unknown>);
    } catch (err) {
      try { this.db.exec("ROLLBACK"); } catch { /* transaction already closed */ }
      throw err;
    }
  }

  async listGapIntents(limit = 200): Promise<GapIntent[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM gap_intents
          ORDER BY created_at DESC
          LIMIT ?`,
      )
      .all(Math.max(1, Math.min(Math.trunc(limit), 1_000)));
    return rows.map((row) =>
      rowToGapIntent(row as Record<string, unknown>),
    );
  }

  async claimGapIntent(
    now: number,
    leaseMs: number,
  ): Promise<GapIntent | null> {
    this.db
      .prepare(
        `UPDATE gap_intents
            SET status='failed',
                last_error=COALESCE(last_error,'retry lease expired'),
                lease_expires_at=NULL,
                updated_at=?
          WHERE status='running'
            AND lease_expires_at<=?
            AND attempts>=3`,
      )
      .run(new Date(now).toISOString(), now);
    const row = this.db
      .prepare(
        `UPDATE gap_intents
            SET status='running',
                attempts=attempts+1,
                lease_expires_at=?,
                last_error=NULL,
                updated_at=?
          WHERE id=(
            SELECT gi.id
              FROM gap_intents gi
              JOIN sources s ON s.id=gi.source_id
             WHERE (
               gi.status='pending'
               OR (gi.status='running' AND gi.lease_expires_at<=?)
             )
               AND gi.attempts<3
               AND s.active=1
               AND s.verified=1
             ORDER BY gi.created_at ASC
             LIMIT 1
          )
          RETURNING *`,
      )
      .get(
        now + Math.max(1_000, leaseMs),
        new Date(now).toISOString(),
        now,
      );
    return row
      ? rowToGapIntent(row as Record<string, unknown>)
      : null;
  }

  async finishGapIntent(
    id: string,
    result: {
      status: "filled" | "missed" | "unpaid";
      retryRunId: string;
      coverage: number;
      rewardUsdc: number;
      lastError?: string;
    },
  ): Promise<void> {
    const update = this.db
      .prepare(
        `UPDATE gap_intents
            SET status=?,
                retry_run_id=?,
                coverage=?,
                reward_usdc=?,
                last_error=?,
                lease_expires_at=NULL,
                updated_at=?
          WHERE id=? AND status='running'`,
      )
      .run(
        result.status,
        result.retryRunId,
        result.coverage,
        result.rewardUsdc,
        result.lastError ?? null,
        new Date().toISOString(),
        id,
      );
    if (Number(update.changes) !== 1) {
      throw new Error(`gap intent ${id} is no longer leased`);
    }
  }

  async failGapIntent(
    id: string,
    error: string,
    maxAttempts: number,
  ): Promise<void> {
    this.db
      .prepare(
        `UPDATE gap_intents
            SET status=CASE WHEN attempts>=? THEN 'failed' ELSE 'pending' END,
                last_error=?,
                lease_expires_at=NULL,
                updated_at=?
          WHERE id=? AND status='running'`,
      )
      .run(
        Math.max(1, Math.trunc(maxAttempts)),
        error.slice(0, 500),
        new Date().toISOString(),
        id,
      );
  }

  async expireGapIntent(id: string, reason: string): Promise<void> {
    this.db
      .prepare(
        `UPDATE gap_intents
            SET status='stale',
                last_error=?,
                lease_expires_at=NULL,
                updated_at=?
          WHERE id=? AND status='running'`,
      )
      .run(reason.slice(0, 500), new Date().toISOString(), id);
  }

  async reserveOnramp(
    addressKey: string,
    dayKey: string,
    amount: number,
    dailyCap: number,
    now: number,
  ): Promise<OnrampReservation> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const claimed = this.db
        .prepare(`SELECT 1 FROM sync_state WHERE key = ?`)
        .get(addressKey);
      if (claimed) {
        this.db.exec("ROLLBACK");
        return "already-funded";
      }
      const row = this.db
        .prepare(`SELECT value FROM sync_state WHERE key = ?`)
        .get(dayKey) as { value: string } | undefined;
      const total = Number.parseFloat(row?.value ?? "0") || 0;
      if (total + amount > dailyCap + 1e-9) {
        this.db.exec("ROLLBACK");
        return "daily-cap";
      }
      const updatedAt = new Date(now).toISOString();
      this.db
        .prepare(`INSERT INTO sync_state (key,value,updated_at) VALUES (?,?,?)`)
        .run(addressKey, String(now), updatedAt);
      this.db
        .prepare(
          `INSERT INTO sync_state (key,value,updated_at) VALUES (?,?,?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
        )
        .run(dayKey, String(total + amount), updatedAt);
      this.db.exec("COMMIT");
      return "reserved";
    } catch (err) {
      try { this.db.exec("ROLLBACK"); } catch { /* transaction already closed */ }
      throw err;
    }
  }

  async releaseOnramp(addressKey: string, dayKey: string, amount: number): Promise<void> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`DELETE FROM sync_state WHERE key = ?`).run(addressKey);
      const row = this.db
        .prepare(`SELECT value FROM sync_state WHERE key = ?`)
        .get(dayKey) as { value: string } | undefined;
      const total = Math.max(0, (Number.parseFloat(row?.value ?? "0") || 0) - amount);
      this.db
        .prepare(`UPDATE sync_state SET value=?, updated_at=? WHERE key=?`)
        .run(String(total), new Date().toISOString(), dayKey);
      this.db.exec("COMMIT");
    } catch (err) {
      try { this.db.exec("ROLLBACK"); } catch { /* transaction already closed */ }
      throw err;
    }
  }

  async releaseSessionGrantSpend(sessionId: string, grantEpoch: string, sessAddr: string, amount: number): Promise<void> {
    this.db
      .prepare(
        `UPDATE session_grants
            SET spent = MAX(0, ROUND(spent - ?, 6))
          WHERE session_id = ? AND grant_epoch = ? AND LOWER(sess_addr) = LOWER(?)`,
      )
      .run(amount, sessionId, grantEpoch, sessAddr);
  }

  async deleteSessionGrant(sessionId: string): Promise<void> {
    if (sqliteJournalActive(this.db)) {
      sqliteJournalTransaction(this.db,()=>{this.db.prepare('UPDATE session_grants SET expiry=0 WHERE session_id=?').run(sessionId);});
      return;
    }
    this.db.prepare(`DELETE FROM session_grants WHERE session_id = ?`).run(sessionId);
  }

  async revokeSessionGrant(sessionId: string, grantEpoch: string, sessAddr: string): Promise<boolean> {
    if (sqliteJournalActive(this.db)) {
      return sqliteJournalTransaction(this.db, () => this.db.prepare(
        'UPDATE session_grants SET expiry=0 WHERE session_id=? AND grant_epoch=? AND lower(sess_addr)=lower(?)'
      ).run(sessionId, grantEpoch, sessAddr).changes === 1);
    }
    return this.db.prepare(
      'DELETE FROM session_grants WHERE session_id=? AND grant_epoch=? AND lower(sess_addr)=lower(?)'
    ).run(sessionId, grantEpoch, sessAddr).changes === 1;
  }

  async deleteExpiredSessionGrants(now: number): Promise<void> {
    if (sqliteJournalActive(this.db)) return;
    this.db.prepare(`DELETE FROM session_grants WHERE expiry <= ?`).run(now);
  }

  /** One statement, so two concurrent requests on the same bucket can never both read the same
   *  count and both be admitted. The CASE arms roll the window over in place: a lapsed row is
   *  reused rather than deleted, which keeps this a single upsert. */
  async consumeRateLimit(
    bucket: string,
    points: number,
    windowMs: number,
    now: number,
  ): Promise<RateLimitDecision> {
    const resetAt = now + windowMs;
    const row = this.db
      .prepare(
        `INSERT INTO rate_limit_counters (bucket, count, reset_at) VALUES (?, 1, ?)
         ON CONFLICT(bucket) DO UPDATE SET
           count    = CASE WHEN reset_at <= ? THEN 1 ELSE count + 1 END,
           reset_at = CASE WHEN reset_at <= ? THEN ? ELSE reset_at END
         RETURNING count, reset_at`,
      )
      .get(bucket, resetAt, now, now, resetAt) as
      | { count: number; reset_at: number }
      | undefined;
    if (!row) throw new Error("Rate-limit counter readback unavailable");
    return {
      allowed: Number(row.count) <= points,
      msBeforeNext: Math.max(0, Number(row.reset_at) - now),
    };
  }

  async deleteExpiredRateLimits(now: number): Promise<void> {
    this.db.prepare(`DELETE FROM rate_limit_counters WHERE reset_at <= ?`).run(now);
  }

  async acquireReasoningCircuit(
    key: string,
    now: number,
    probeLeaseMs: number,
  ): Promise<ReasoningCircuitDecision> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare(`SELECT open_until, probe_until FROM reasoning_circuits WHERE key = ?`)
        .get(key) as { open_until: number; probe_until: number } | undefined;

      if (!row || (Number(row.open_until) === 0 && Number(row.probe_until) <= now)) {
        this.db.exec("COMMIT");
        return { allowed: true, retryAfterMs: 0 };
      }

      const openUntil = Number(row.open_until);
      const probeUntil = Number(row.probe_until);
      if (openUntil > now || probeUntil > now) {
        this.db.exec("COMMIT");
        return {
          allowed: false,
          retryAfterMs: Math.max(0, Math.max(openUntil, probeUntil) - now),
        };
      }

      const leasedUntil = now + probeLeaseMs;
      this.db
        .prepare(`UPDATE reasoning_circuits SET probe_until = ?, updated_at = ? WHERE key = ?`)
        .run(leasedUntil, now, key);
      this.db.exec("COMMIT");
      return { allowed: true, retryAfterMs: 0 };
    } catch (err) {
      try { this.db.exec("ROLLBACK"); } catch { /* transaction already closed */ }
      throw err;
    }
  }

  async recordReasoningCircuitFailure(
    key: string,
    transient: boolean,
    now: number,
    failureThreshold: number,
    baseCooldownMs: number,
    maxCooldownMs: number,
  ): Promise<ReasoningCircuitRecord> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare(`SELECT failures FROM reasoning_circuits WHERE key = ?`)
        .get(key) as { failures: number } | undefined;
      const previous = Number(row?.failures ?? 0);
      const failures = transient
        ? previous + 1
        : Math.max(previous + 1, failureThreshold);
      const exponent = Math.max(0, Math.min(20, failures - failureThreshold));
      const cooldown = Math.min(
        Math.max(baseCooldownMs, maxCooldownMs),
        baseCooldownMs * 2 ** exponent,
      );
      const record: ReasoningCircuitRecord = {
        key,
        failures,
        openUntil: failures >= failureThreshold ? now + cooldown : 0,
        probeUntil: 0,
        updatedAt: now,
      };
      this.db
        .prepare(
          `INSERT INTO reasoning_circuits
             (key, failures, open_until, probe_until, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             failures=excluded.failures,
             open_until=excluded.open_until,
             probe_until=excluded.probe_until,
             updated_at=excluded.updated_at`,
        )
        .run(
          record.key,
          record.failures,
          record.openUntil,
          record.probeUntil,
          record.updatedAt,
        );
      this.db.exec("COMMIT");
      return record;
    } catch (err) {
      try { this.db.exec("ROLLBACK"); } catch { /* transaction already closed */ }
      throw err;
    }
  }

  async clearReasoningCircuit(key: string): Promise<void> {
    this.db.prepare(`DELETE FROM reasoning_circuits WHERE key = ?`).run(key);
  }

  async reservePrivateResearchIntent(intent: PrivateResearchIntent) {
    return reserveSqlitePrivateResearchIntent(this.db, intent);
  }
  async reservePrivateTreasury(id: string, payer: string, policy: PrivateTreasuryPolicy) {
    return reserveSqlitePrivateTreasury(this.db, id, payer, policy);
  }
  async getPrivateTreasury(id: string, payer: string) { return getSqlitePrivateTreasury(this.db, id, payer); }
  async getPrivateTreasurySummary(signer: string) { return getSqlitePrivateTreasurySummary(this.db, signer); }
  async releasePrivateTreasury(id: string, payer: string, signer: string) { return releaseSqlitePrivateTreasury(this.db, id, payer, signer); }
  async getPrivateResearchInterruption(id: string, payer: string) { return getSqlitePrivateInterruption(this.db, id, payer); }
  async interruptPrivateResearch(id: string, payer: string, workerId: string) { return interruptSqlitePrivateResearch(this.db, id, payer, workerId); }
  async listPrivateWorkerCandidates(signer: string, after?: string) { return listSqlitePrivateWorkerCandidates(this.db, signer, after); }
  async listPrivateReconciliationCandidates(signer: string, after?: string) { return listSqlitePrivateReconciliationCandidates(this.db, signer, after); }

  async confirmPrivateCreatorSubmission(id: string, payer: string, workerId: string, confirmation: PrivateCreatorConfirmation) {
    return confirmSqlitePrivateCreator(this.db, id, payer, workerId, confirmation);
  }
  async getPrivateCreatorConfirmation(id: string, payer: string, authorizationId: string) {
    return getSqlitePrivateCreatorConfirmation(this.db, id, payer, authorizationId);
  }

  async admitPrivateCreatorSubmission(id: string, payer: string, workerId: string, data: PrivateCreatorSubmission) {
    return admitSqlitePrivateCreatorSubmission(this.db, id, payer, workerId, data);
  }
  async listPrivateCreatorSubmissions(id: string, payer: string) {
    return listSqlitePrivateCreatorSubmissions(this.db, id, payer);
  }

  async savePrivateResearchResult(id: string, payer: string, workerId: string, run: QueryRun) {
    return saveSqlitePrivateResult(this.db, id, payer, workerId, run);
  }
  async getPrivateResearchResult(id: string, payer: string) {
    return getSqlitePrivateResult(this.db, id, payer);
  }

  async claimPrivateResearchExecution(id: string, payer: string) {
    return claimSqlitePrivateExecution(this.db, id, payer);
  }
  async getPrivateResearchExecution(id: string, payer: string) {
    return getSqlitePrivateExecution(this.db, id, payer);
  }

  async claimPrivatePaymentSubmission(id: string, payer: string) {
    return claimSqlitePrivatePayment(this.db, id, payer);
  }
  async getPrivatePaymentState(id: string, payer: string) {
    return getSqlitePrivatePayment(this.db, id, payer);
  }
  async confirmPrivatePayment(id: string, payer: string, confirmation: PrivatePaymentConfirmation) {
    return confirmSqlitePrivatePayment(this.db, id, payer, confirmation);
  }

  async getPrivateResearchIntent(id: string, payer: string) {
    return getSqlitePrivateResearchIntent(this.db, id, payer);
  }
  async listPrivateResearchHistory(payer: string, before?: PrivateHistoryCursor) {
    return listSqlitePrivateResearchHistory(this.db, payer, before);
  }

  async saveQueryRun(run: QueryRun): Promise<void> {
    writeSqliteQueryRun(this.db, run, true);
  }

  private async readEvidenceProvenance(lookup: EvidenceProvenanceLookup): Promise<ReadonlySet<string>> {
    const flags = new Set<string>();
    for (const [table, ids] of [["sources", lookup.sourceIds], ["source_items", lookup.itemIds]] as const) {
      for (let offset = 0; offset < ids.length; offset += 500) {
        const batch = ids.slice(offset, offset + 500);
        if (batch.some(id => id.length > 256)) throw new Error("Invalid provenance lookup identity");
        const rows = this.db.prepare(`SELECT id${table === "source_items" ? ",source_id" : ""} FROM ${table} WHERE evidence_provenance='synthetic-demo' AND id IN (${batch.map(() => "?").join(",")})`).all(...batch);
        for (const row of rows) flags.add(table === "sources" ? `source:${row.id}` : `item:${row.source_id}:${row.id}`);
      }
    }
    return flags;
  }

  async listFollowUps(parentId: string): Promise<QueryRun[]> {
    const rows = this.db
      .prepare(`SELECT data FROM query_runs WHERE parent_id=? ORDER BY created_at ASC`)
      .all(parentId);
    return projectRecordedEvidenceProvenanceList(lookup => this.readEvidenceProvenance(lookup), rows.map((r) => JSON.parse(r.data as string) as QueryRun));
  }

  async listQueryRunsByAsker(wallet: string, limit: number): Promise<QueryRun[]> {
    const rows = this.db
      .prepare(`SELECT data FROM query_runs WHERE asker=? ORDER BY created_at DESC LIMIT ?`)
      .all(wallet.toLowerCase(), limit);
    return projectRecordedEvidenceProvenanceList(lookup => this.readEvidenceProvenance(lookup), rows.map((r) => JSON.parse(r.data as string) as QueryRun));
  }

  async getQueryRun(id: string): Promise<QueryRun | null> {
    const row = this.db.prepare(`SELECT data FROM query_runs WHERE id=?`).get(id);
    return row ? projectRecordedEvidenceProvenance(lookup => this.readEvidenceProvenance(lookup), JSON.parse(row.data as string) as QueryRun) : null;
  }

  async listRecentQueries(limit: number): Promise<QueryRun[]> {
    const rows = this.db
      .prepare(`SELECT data FROM query_runs ORDER BY created_at DESC LIMIT ?`)
      .all(limit);
    return projectRecordedEvidenceProvenanceList(lookup => this.readEvidenceProvenance(lookup), rows.map((r) => JSON.parse(r.data as string) as QueryRun));
  }

  async *iterateRecentQueries(limit: number): AsyncIterable<QueryRun> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2500) throw new Error("Invalid query scan limit");
    // The live statement holds one SQLite read snapshot; iterator return/throw
    // closes it. Do not materialize raw JSON strings with .all() here.
    // Sort only identifiers: without a matching index SQLite would otherwise
    // materialize every large data value in its temporary sorter before yielding.
    const rows = this.db.prepare(`SELECT id FROM query_runs ORDER BY created_at DESC, id DESC LIMIT ?`).iterate(limit);
    const read = this.db.prepare(`SELECT data FROM query_runs WHERE id = ?`);
    for (const row of rows) {
      const record = read.get(row.id);
      if (!record) throw new Error("Query scan row unavailable");
      yield await projectRecordedEvidenceProvenance(lookup => this.readEvidenceProvenance(lookup), JSON.parse(record.data as string) as QueryRun);
    }
  }

  async recordPayment(p: PaymentRecord): Promise<void> {
    this.insertPayment(p, false);
  }

  async recordPaymentOnce(p: PaymentRecord): Promise<boolean> {
    return this.insertPayment(p, true);
  }

  private insertPayment(p: PaymentRecord, ignoreDuplicate: boolean): boolean {
    const settlementStatus = assertPaymentSettlementState(p);
    const result = this.db
      .prepare(
        `${ignoreDuplicate ? "INSERT OR IGNORE" : "INSERT"} INTO payment_events (id,created_at,kind,query_id,source_id,source_name,payer,payee,amount_usdc,weight,rationale,tx_hash,network,settled,settlement_status,authorization_id,authorization_expires_at,grant_epoch,origin,item_id,item_title,item_url,content_version,item_published_at,offer_id,list_price_usdc)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        p.id ?? crypto.randomUUID(),
        p.createdAt,
        p.kind,
        p.queryId,
        p.sourceId,
        p.sourceName,
        p.payer,
        p.payee,
        p.amountUsdc,
        p.weight ?? null,
        p.rationale ?? null,
        p.txHash ?? null,
        p.network,
        p.settled ? 1 : 0,
        settlementStatus,
        p.authorizationId ?? null,
        p.authorizationExpiresAt ?? null,
        p.grantEpoch ?? null,
        p.origin ?? "engine",
        p.itemId ?? null,
        p.itemTitle ?? null,
        p.itemUrl ?? null,
        p.contentVersion ?? null,
        p.itemPublishedAt ?? null,
        p.offerId ?? null,
        p.listPriceUsdc ?? null,
      );
    return result.changes === 1;
  }

  private assertOrdinaryResearchAuthority(): void {
    if (this.enrolledMode && this.enrolledMode !== "mainnet-real") throw new Error("Research purchase authority is unavailable in enrolled storage");
  }
  async assertResearchPurchaseAuthority(network: string): Promise<void> {
    this.assertOrdinaryResearchAuthority();
    if (network !== this.paymentProfile.networkId) throw new Error("Research purchase profile mismatch");
    assertSqliteResearchAuthority(this.db,this.paymentProfile,true);
  }
  async claimResearchPurchase(input: ResearchPurchaseClaim): Promise<void> { this.assertOrdinaryResearchAuthority(); claimSqliteResearchPurchase(this.db, input,this.paymentProfile); }
  async createResearchMonthly(purchase: MonthlyPurchase) { this.assertOrdinaryResearchAuthority(); return createSqliteResearchMonthly(this.db, purchase,this.paymentProfile); }
  async getResearchMonthly(id: string) { this.assertOrdinaryResearchAuthority(); return getSqliteResearchMonthly(this.db, id,this.paymentProfile); }
  async redeemResearchMonthly(input: MonthlyRedemptionInput) { this.assertOrdinaryResearchAuthority(); return redeemSqliteResearchMonthly(this.db, input, rowToA2aOrder,this.paymentProfile); }

  async createA2aOrder(order: A2aOrder): Promise<{ created: boolean; order: A2aOrder }> {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO a2a_orders
         (id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,
          service_fee_usdc,research_mode,package_data,status,transaction_id,request_data,started_at,worker_id,
          execution_journal_version,payment_started_at,result_saving_at,response_data,error_code,resolution_data,
          created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        order.id,
        order.queryId,
        order.authorizationId,
        order.requestHash,
        order.payer,
        order.payee,
        order.amountUsdc,
        order.creatorBudgetUsdc,
        order.serviceFeeUsdc,
        order.researchMode,
        order.researchPackage ? JSON.stringify(order.researchPackage) : null,
        order.status,
        order.transaction,
        order.request ? JSON.stringify(order.request) : null,
        order.startedAt,
        order.workerId,
        order.executionJournalVersion,
        order.paymentStartedAt,
        order.resultSavingAt,
        order.response ? JSON.stringify(order.response) : null,
        order.errorCode,
        order.resolution ? JSON.stringify(order.resolution) : null,
        order.createdAt,
        order.updatedAt,
      );
    const row = this.db.prepare(`SELECT * FROM a2a_orders WHERE id=?`).get(order.id);
    if (!row) throw new Error("A2A order insert could not be read back");
    return { created: result.changes === 1, order: rowToA2aOrder(row) };
  }

  async getA2aOrder(id: string): Promise<A2aOrder | null> {
    const row = this.db.prepare(`SELECT * FROM a2a_orders WHERE id=?`).get(id);
    return row ? rowToA2aOrder(row) : null;
  }

  async listA2aOrdersByPayer(wallet: string, before?: { createdAt: string; id: string }): Promise<A2aOrder[]> {
    const rows = before
      ? this.db.prepare("SELECT * FROM a2a_orders WHERE LOWER(payer) = LOWER(?) AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT 26").all(wallet, before.createdAt, before.createdAt, before.id)
      : this.db.prepare("SELECT * FROM a2a_orders WHERE LOWER(payer) = LOWER(?) ORDER BY created_at DESC, id DESC LIMIT 26").all(wallet);
    return rows.map(rowToA2aOrder);
  }

  async hasA2aOriginalSettlement(expected: A2aOriginalClaim): Promise<boolean> {
    return hasSqliteA2aOriginalSettlement(this.db, expected, this.paymentProfile, rowToA2aOrder);
  }

  async claimA2aFailedOriginalFulfillment(input: FulfillmentClaimInput) {
    if (this.readOnly) throw new Error("Readonly fulfillment mutation refused");
    return claimSqliteA2aFulfillment(this.db, input, this.paymentProfile, rowToA2aOrder);
  }
  async getA2aFailedOriginalFulfillment(originalId: string) {
    return getSqliteA2aFulfillment(this.db, originalId, this.paymentProfile);
  }
  async completeA2aFailedOriginalFulfillment(input: A2aFulfillmentCompletion, evidenceCapability?: FulfillmentEvidenceCapability): Promise<boolean> {
    if (this.readOnly) throw new Error("Readonly fulfillment mutation refused");
    return completeSqliteA2aFulfillment(this.db, input, this.paymentProfile, rowToA2aOrder, evidenceCapability);
  }
  async hasA2aFailedOriginalFulfillment(authority: FulfillmentAuthority, evidenceCapability?: FulfillmentEvidenceCapability): Promise<boolean> {
    return hasSqliteA2aFulfillment(this.db, authority, this.paymentProfile, rowToA2aOrder, evidenceCapability);
  }

  async claimNextA2aOrder(workerId: string, startedAt: string, expectedOriginal?: A2aOriginalClaim): Promise<A2aOrder | null> {
    if (expectedOriginal !== undefined) return claimSqliteA2aOriginal(this.db, expectedOriginal, workerId, startedAt, this.paymentProfile, rowToA2aOrder);
    const row = this.db
      .prepare(
        `UPDATE a2a_orders SET started_at=?,worker_id=?,updated_at=?
         WHERE id=(
           SELECT id FROM a2a_orders
            WHERE status='running' AND started_at IS NULL AND request_data IS NOT NULL
            ORDER BY created_at,id LIMIT 1
         ) AND status='running' AND started_at IS NULL
         RETURNING *`,
      )
      .get(startedAt, workerId, startedAt) as Record<string, unknown> | undefined;
    return row ? rowToA2aOrder(row) : null;
  }

  async markA2aOrderPaymentStarted(id: string, startedAt: string): Promise<boolean> {
    const result = this.db
      .prepare(
        `UPDATE a2a_orders
            SET payment_started_at=COALESCE(payment_started_at,?),updated_at=?
          WHERE id=? AND status='running' AND started_at IS NOT NULL
            AND execution_journal_version=1`,
      )
      .run(startedAt, startedAt, id);
    return result.changes === 1;
  }

  async markA2aOrderResultSaving(id: string, startedAt: string): Promise<boolean> {
    const result = this.db
      .prepare(
        `UPDATE a2a_orders
            SET result_saving_at=COALESCE(result_saving_at,?),updated_at=?
          WHERE id=? AND status='running' AND started_at IS NOT NULL
            AND execution_journal_version=1`,
      )
      .run(startedAt, startedAt, id);
    return result.changes === 1;
  }

  async completeA2aOrder(
    id: string,
    response: Record<string, unknown>,
    updatedAt: string,
  ): Promise<boolean> {
    const result = this.db
      .prepare(
        `UPDATE a2a_orders SET status='completed',response_data=?,error_code=NULL,updated_at=?
         WHERE id=? AND status='running'`,
      )
      .run(JSON.stringify(response), updatedAt, id);
    return result.changes === 1;
  }

  async failA2aOrder(id: string, errorCode: string, updatedAt: string): Promise<boolean> {
    const result = this.db
      .prepare(
        `UPDATE a2a_orders SET status='failed',error_code=?,updated_at=?
         WHERE id=? AND status='running'`,
      )
      .run(errorCode, updatedAt, id);
    return result.changes === 1;
  }

  async resolveA2aOrder(id: string, update: A2aOrderResolutionUpdate): Promise<boolean> {
    const resolution = JSON.stringify(update.resolution);
    const evidence = update.resolution.evidence;
    if (update.status === "completed") {
      if (
        update.resolution.action !== "repair_completed" ||
        !evidence.queryRunFound ||
        evidence.simulatedCreatorMicros > 0
      ) {
        return false;
      }
      const result = this.db
        .prepare(
          `WITH normalized AS (
             SELECT ROUND(amount_usdc*1000000) micros,
                    COALESCE(
                      settlement_status,
                      CASE WHEN settled=1 THEN 'settled' ELSE 'simulated' END
                    ) evidence_status
               FROM payment_events
              WHERE query_id=(SELECT query_id FROM a2a_orders WHERE id=?) AND kind!='inbound'
           ), creator_evidence AS (
             SELECT COUNT(*) attempts,
                    COALESCE(SUM(CASE WHEN evidence_status='settled' THEN micros ELSE 0 END),0) settled,
                    COALESCE(SUM(CASE WHEN evidence_status='pending' THEN micros ELSE 0 END),0) pending,
                    COALESCE(SUM(CASE WHEN evidence_status='failed' THEN micros ELSE 0 END),0) failed,
                    COALESCE(SUM(CASE WHEN evidence_status='simulated' THEN micros ELSE 0 END),0) simulated
               FROM normalized
           )
           UPDATE a2a_orders
              SET status='completed',response_data=?,error_code=NULL,resolution_data=?,updated_at=?
            WHERE id=? AND status='running' AND started_at IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM query_runs
                 WHERE query_runs.id=a2a_orders.query_id AND payment_mode='real'
              )
              AND (SELECT attempts FROM creator_evidence)=?
              AND (SELECT settled FROM creator_evidence)=?
              AND (SELECT pending FROM creator_evidence)=?
              AND (SELECT failed FROM creator_evidence)=?
              AND (SELECT simulated FROM creator_evidence)=?
              AND (SELECT simulated FROM creator_evidence)=0
              AND COALESCE(execution_journal_version,0)=?
              AND (payment_started_at IS NOT NULL)=?
              AND (result_saving_at IS NOT NULL)=?
              AND (SELECT settled+pending FROM creator_evidence)
                    <=ROUND(creator_budget_usdc*1000000)`,
        )
        .run(
          id,
          JSON.stringify(update.response),
          resolution,
          update.resolution.resolvedAt,
          id,
          evidence.creatorAttempts,
          evidence.settledCreatorMicros,
          evidence.pendingCreatorMicros,
          evidence.failedCreatorMicros,
          evidence.simulatedCreatorMicros,
          evidence.executionJournalVersion ?? 0,
          evidence.paymentBoundaryCrossed ? 1 : 0,
          evidence.resultSaveBoundaryCrossed ? 1 : 0,
        );
      return result.changes === 1;
    }

    if (
      update.resolution.action !== "close_failed" ||
      evidence.queryRunFound ||
      evidence.executionJournalVersion !== 1 ||
      evidence.paymentBoundaryCrossed ||
      evidence.resultSaveBoundaryCrossed ||
      evidence.creatorAttempts > 0
    ) {
      return false;
    }

    const result = this.db
      .prepare(
        `WITH normalized AS (
           SELECT ROUND(amount_usdc*1000000) micros,
                  COALESCE(
                    settlement_status,
                    CASE WHEN settled=1 THEN 'settled' ELSE 'simulated' END
                  ) evidence_status
             FROM payment_events
            WHERE query_id=(SELECT query_id FROM a2a_orders WHERE id=?) AND kind!='inbound'
         ), creator_evidence AS (
           SELECT COUNT(*) attempts,
                  COALESCE(SUM(CASE WHEN evidence_status='settled' THEN micros ELSE 0 END),0) settled,
                  COALESCE(SUM(CASE WHEN evidence_status='pending' THEN micros ELSE 0 END),0) pending,
                  COALESCE(SUM(CASE WHEN evidence_status='failed' THEN micros ELSE 0 END),0) failed,
                  COALESCE(SUM(CASE WHEN evidence_status='simulated' THEN micros ELSE 0 END),0) simulated
             FROM normalized
         )
         UPDATE a2a_orders
            SET status='failed',response_data=NULL,error_code=?,resolution_data=?,updated_at=?
          WHERE id=? AND status='running' AND started_at IS NOT NULL AND started_at<=?
            AND execution_journal_version=1 AND payment_started_at IS NULL
            AND result_saving_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM query_runs WHERE query_runs.id=a2a_orders.query_id)
            AND (SELECT attempts FROM creator_evidence)=?
            AND (SELECT settled FROM creator_evidence)=?
            AND (SELECT pending FROM creator_evidence)=?
            AND (SELECT failed FROM creator_evidence)=?
            AND (SELECT simulated FROM creator_evidence)=?
            AND (SELECT attempts FROM creator_evidence)=0
            AND (SELECT settled+pending FROM creator_evidence)
                  <=ROUND(creator_budget_usdc*1000000)`,
      )
      .run(
        id,
        update.errorCode,
        resolution,
        update.resolution.resolvedAt,
        id,
        update.startedBefore,
        evidence.creatorAttempts,
        evidence.settledCreatorMicros,
        evidence.pendingCreatorMicros,
        evidence.failedCreatorMicros,
        evidence.simulatedCreatorMicros,
      );
    return result.changes === 1;
  }

  async a2aOperationsSnapshot(nowMs: number): Promise<A2aOperationsSnapshot> {
    const since = new Date(nowMs - 24 * 60 * 60_000).toISOString();
    const rows = this.db
      .prepare(
        `SELECT status,created_at,updated_at,started_at,execution_journal_version,
          CASE WHEN json_valid(package_data) THEN package_data END AS latency_package,
          CASE WHEN json_valid(response_data) THEN CASE WHEN json_type(response_data,'$.serviceReceipt')='object'
            THEN json_extract(response_data,'$.serviceReceipt') END END AS latency_receipt,
          CASE WHEN resolution_data IS NULL THEN 'null'
            WHEN json_valid(resolution_data) THEN resolution_data ELSE '{}' END AS latency_resolution
          FROM a2a_orders
          WHERE status='running' OR updated_at>=?`,
      )
      .all(since)
      .map((row) => ({
        status: row.status as A2aOrder["status"],
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        startedAt: row.started_at == null ? null : String(row.started_at),
        executionJournalVersion: row.execution_journal_version,
        researchPackage: row.latency_package == null ? undefined : JSON.parse(String(row.latency_package)),
        serviceReceipt: row.latency_receipt == null ? undefined : JSON.parse(String(row.latency_receipt)),
        resolution: JSON.parse(String(row.latency_resolution)),
      })) satisfies A2aOperationsRow[];
    return summarizeA2aOperations(rows, nowMs, true);
  }

  async operatorInventory(input: OperatorInventoryInput) {
    return readSqliteOperatorInventory(this.db, input, this.paymentProfile.networkId);
  }
  async operatorPublicSnapshot(nowMs: number) {
    const { operatorPublicSnapshotSchema } = await import("../business-operator/contracts");
    return operatorPublicSnapshotSchema.parse({ jobs: await this.a2aOperationsSnapshot(nowMs),
      creatorCatalog: { registered: Number(this.db.prepare("SELECT COUNT(*) count FROM sources WHERE active=1").get()?.count) } });
  }

  async listPayments(limit: number): Promise<PaymentRecord[]> {
    const rows = this.db
      .prepare(`SELECT * FROM payment_events WHERE authorization_phase IS NULL OR authorization_phase NOT IN ('prepared','cancelled_unexposed') ORDER BY created_at DESC LIMIT ?`)
      .all(limit);
    return rows.map(rowToPayment);
  }

  async recordActivationEvent(event: ActivationEvent, day: string): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO activation_events (day,event,count) VALUES (?,?,1)
         ON CONFLICT(day,event) DO UPDATE SET count=count+1`,
      )
      .run(day, event);
  }

  async activationFunnel(days: number): Promise<ActivationFunnel> {
    const window = activationWindow(days);
    const counts = emptyActivationCounts();
    const rows = this.db
      .prepare(
        `SELECT event, SUM(count) AS count FROM activation_events
          WHERE day >= ? GROUP BY event`,
      )
      .all(window.sinceDay) as Array<{ event: ActivationEvent; count: number }>;
    for (const row of rows) {
      if (Object.hasOwn(counts, row.event)) counts[row.event] = Number(row.count);
    }
    return { ...window, counts };
  }

  async listPendingPayments(limit: number): Promise<PaymentRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM payment_events
         WHERE settlement_status='pending' AND settled=0 AND authorization_id IS NOT NULL
           AND (authorization_phase IS NULL OR authorization_phase NOT IN ('prepared','cancelled_unexposed'))
         ORDER BY created_at ASC LIMIT ?`,
      )
      .all(limit);
    return rows.map(rowToPayment);
  }

  async settlePendingPayment(
    id: string,
    authorizationId: string,
    circleTransferId: string,
  ): Promise<boolean> {
    if (this.enrolledMode === "mainnet-real") {
      const hosted = terminalSqliteHostedAuthorization(this.db, id, authorizationId, circleTransferId, false);
      if (hosted) return hosted.resolved;
    }
    if (sqliteJournalActive(this.db)) {
      return terminalSqliteJournalPayment(this.db,id,authorizationId,circleTransferId,false).resolved;
    }
    const result = this.db
      .prepare(
        `UPDATE payment_events
         SET settled=1, settlement_status='settled', tx_hash=?
         WHERE id=? AND authorization_id=? AND settled=0 AND settlement_status='pending'`,
      )
      .run(circleTransferId, id, authorizationId);
    return result.changes === 1;
  }

  async failPendingPayment(
    id: string,
    authorizationId: string,
    circleTransferId: string,
  ): Promise<{ resolved: boolean; reservationReleased: boolean }> {
    if (this.enrolledMode === "mainnet-real") {
      const hosted = terminalSqliteHostedAuthorization(this.db, id, authorizationId, circleTransferId, true);
      if (hosted) return hosted;
    }
    if (sqliteJournalActive(this.db)) {
      return terminalSqliteJournalPayment(this.db,id,authorizationId,circleTransferId,true);
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const payment = this.db
        .prepare(
          `SELECT payer, amount_usdc, grant_epoch FROM payment_events
           WHERE id=? AND authorization_id=? AND settled=0 AND settlement_status='pending'`,
        )
        .get(id, authorizationId) as
          | { payer: string; amount_usdc: number; grant_epoch: string | null }
          | undefined;
      if (!payment) {
        this.db.exec("ROLLBACK");
        return { resolved: false, reservationReleased: false };
      }

      this.db
        .prepare(
          `UPDATE payment_events SET settlement_status='failed', tx_hash=?
           WHERE id=? AND authorization_id=? AND settled=0 AND settlement_status='pending'`,
        )
        .run(circleTransferId, id, authorizationId);

      let reservationReleased = false;
      if (payment.grant_epoch) {
        const released = this.db
          .prepare(
            `UPDATE session_grants
             SET spent=MAX(0, ROUND(spent - ?, 6))
             WHERE grant_epoch=? AND lower(sess_addr)=lower(?)`,
          )
          .run(payment.amount_usdc, payment.grant_epoch, payment.payer);
        reservationReleased = released.changes === 1;
      }
      this.db.exec("COMMIT");
      return { resolved: true, reservationReleased };
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* transaction already closed */ }
      throw error;
    }
  }

  async listPaymentsByQuery(queryId: string): Promise<PaymentRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM payment_events WHERE query_id=? AND kind='citation' AND (authorization_phase IS NULL OR authorization_phase NOT IN ('prepared','cancelled_unexposed')) ORDER BY created_at ASC`,
      )
      .all(queryId);
    return rows.map(rowToPayment);
  }

  async listCreatorPaymentAttemptsByQuery(queryId: string): Promise<PaymentRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM payment_events
         WHERE query_id=? AND kind!='inbound' AND (authorization_phase IS NULL OR authorization_phase NOT IN ('prepared','cancelled_unexposed')) ORDER BY created_at ASC`,
      )
      .all(queryId);
    return rows.map(rowToPayment);
  }

  async listPaymentsBySource(sourceId: string): Promise<PaymentRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM payment_events WHERE source_id=? AND kind != 'inbound' AND (authorization_phase IS NULL OR authorization_phase NOT IN ('prepared','cancelled_unexposed')) ORDER BY created_at DESC`,
      )
      .all(sourceId);
    return rows.map(rowToPayment);
  }

  async dailySettled(days: number): Promise<DailyVolume[]> {
    // created_at is an ISO-UTC string; its first 10 chars are the UTC YYYY-MM-DD day.
    const rows = this.db
      .prepare(
        `SELECT substr(created_at, 1, 10) day, COALESCE(SUM(amount_usdc), 0) usdc
         FROM payment_events WHERE settled = 1 GROUP BY day`,
      )
      .all() as { day: string; usdc: number }[];
    return fillDailySeries(rows, days);
  }

  async recordWithdrawal(w: WithdrawalRecord): Promise<void> {
    await recordSqliteWithdrawal(this.db, w);
  }

  async reserveCreatorWithdrawal(value: WithdrawalRequestRecord) {
    if(this.enrolledMode==="mainnet-real" && !this.db.prepare("SELECT 1 FROM creator_withdrawal_requests WHERE id=?").get(value.id)
      && !this.db.prepare("SELECT 1 FROM session_withdrawal_preparations WHERE request_id=?").get(value.id))
      throw new Error("Mainnet withdrawal requires original capacity admission");
    return reserveSqliteWithdrawalRequest(this.db, value);
  }
  async listCreatorWithdrawalHistory(owner: string, cursor?: WithdrawalHistoryCursor, limit = 25) { return listSqliteWithdrawalHistory(this.db, owner, cursor, limit); }
  async getCreatorWithdrawal(id: string, owner: string) { return getSqliteWithdrawalRequest(this.db, id, owner); }
  async claimCreatorWithdrawalTransfer(id: string, owner: string) { return claimSqliteWithdrawalTransfer(this.db, id, owner); }
  async getCreatorWithdrawalTransferClaim(id: string, owner: string) { return getSqliteWithdrawalTransferClaim(this.db, id, owner); }
  async saveCreatorWithdrawalAttestation(id: string, owner: string, claimId: string, value: unknown) { return saveSqliteWithdrawalAttestation(this.db, id, owner, claimId, value); }
  async getCreatorWithdrawalAttestation(id: string, owner: string) { return getSqliteWithdrawalAttestation(this.db, id, owner); }

  async listWithdrawals(limit: number): Promise<WithdrawalRecord[]> {
    const rows = this.db
      .prepare(`SELECT * FROM withdrawals ORDER BY created_at DESC LIMIT ?`)
      .all(limit);
    return rows.map(rowToWithdrawal);
  }

  async metrics(): Promise<DashboardMetrics> {
    const payments = this.db
      .prepare(
        `SELECT amount_usdc,source_id,query_id,kind,origin,settled,settlement_status,payer,tx_hash
           FROM payment_events`,
      )
      .all()
      .map((p) => ({
        amountUsdc: Number(p.amount_usdc),
        sourceId: String(p.source_id ?? ""),
        queryId: String(p.query_id ?? ""),
        kind: p.kind as PaymentRecord["kind"],
        origin: (p.origin as import("../types").PaymentOrigin | null) ?? null,
        settled: Number(p.settled) === 1,
        settlementStatus:
          (p.settlement_status as import("../types").PaymentSettlementStatus | null) ?? null,
        payer: (p.payer as string | null) ?? null,
        txHash: (p.tx_hash as string | null) ?? null,
      }));
    const runs = this.db
      .prepare(
        `SELECT id,origin,asker,duration_ms,payment_mode,payment_attempts,settled_payments,
                confidence_level,mcp_client,evidence_claim_count,grounded_claim_count,
                rewarded_citation_count
           FROM query_runs`,
      )
      .all()
      .map((r) => ({
        id: String(r.id),
        origin: (r.origin as import("../types").PaymentOrigin | null) ?? null,
        asker: (r.asker as string | null) ?? null,
        durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
        paymentMode: (r.payment_mode as "real" | "offline" | null) ?? null,
        paymentAttempts: r.payment_attempts == null ? null : Number(r.payment_attempts),
        settledPayments: r.settled_payments == null ? null : Number(r.settled_payments),
        confidenceLevel:
          (r.confidence_level as "High" | "Moderate" | "Low" | null) ?? null,
        mcpClient:
          (r.mcp_client as import("../types").McpClientChannel | null) ?? null,
        evidenceClaimCount:
          r.evidence_claim_count == null
            ? null
            : Number(r.evidence_claim_count),
        groundedClaimCount:
          r.grounded_claim_count == null
            ? null
            : Number(r.grounded_claim_count),
        rewardedCitationCount:
          r.rewarded_citation_count == null
            ? null
            : Number(r.rewarded_citation_count),
      }));
    const feedback = this.db
      .prepare(`SELECT query_id,rating FROM answer_feedback`)
      .all()
      .map((f) => ({
        queryId: String(f.query_id),
        rating: f.rating as "up" | "down",
      }));
    const gapIntents = this.db
      .prepare(`SELECT status FROM gap_intents`)
      .all()
      .map((intent) => ({
        status: intent.status as import("../types").GapIntentStatus,
      }));
    let recordedAccounts: number | null = null;
    try {
      // Aggregate inside SQLite: account addresses never enter the public projection.
      // Older manually indexed casing is one account; malformed rows are excluded.
      const row = this.db.prepare(`SELECT COUNT(DISTINCT LOWER(wallet_address)) AS n FROM users
        WHERE typeof(wallet_address)='text' AND length(wallet_address)=42
          AND lower(substr(wallet_address,1,2))='0x'
          AND substr(wallet_address,3) NOT GLOB '*[^0-9a-fA-F]*'`).get();
      const count = row?.n;
      if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) recordedAccounts = count;
    } catch { /* Account-index availability is independent from research/payment metrics. */ }
    return { ...calculateDashboardMetrics(payments, runs, feedback, gapIntents), recordedAccounts };
  }

  async economics() {
    const identity = this.enrolledIdentity;
    const profile = identity ? storagePaymentProfile(identity) : ARC_TESTNET_PROFILE;
    const runs = this.db
      .prepare(`SELECT economics_data FROM query_runs WHERE economics_data IS NOT NULL`)
      .all()
      .flatMap((row) => {
        try {
          const sample = JSON.parse(String(row.economics_data)) as EconomicsRunSample | null;
          return sample ? [sample] : [];
        } catch {
          return [];
        }
      });
    const payments = this.db
      .prepare(
        `SELECT query_id,kind,amount_usdc,settled,settlement_status,grant_epoch${profile.testnet ? "" : ",network,tx_hash"} FROM payment_events`,
      )
      .all()
      .map((row) => ({
        queryId: String(row.query_id ?? ""),
        ...(!profile.testnet ? { network: String(row.network), txHash: typeof row.tx_hash === "string" ? row.tx_hash : null } : {}),
        kind: row.kind as PaymentRecord["kind"],
        amountUsdc: Number(row.amount_usdc),
        settled: Number(row.settled) === 1,
        settlementStatus:
          (row.settlement_status as import("../types").PaymentSettlementStatus | null) ?? null,
        grantEpoch: (row.grant_epoch as string | null) ?? null,
      }));
    const a2aOrders = this.db
      .prepare(
        `SELECT query_id,creator_budget_usdc,service_fee_usdc,status,response_data FROM a2a_orders`,
      )
      .all()
      .map((row) => ({
        queryId: String(row.query_id),
        creatorBudgetUsdc: Number(row.creator_budget_usdc),
        serviceFeeUsdc: Number(row.service_fee_usdc),
        status: row.status as "running" | "completed" | "failed",
        response: row.response_data
          ? (JSON.parse(String(row.response_data)) as Record<string, unknown>)
          : null,
      }));
    return calculateEconomics(profile, runs, payments, new Date(), a2aOrders);
  }

  async settlementLedger(): Promise<LedgerAccount[]> {
    // Addresses are compared lowercased (the two tables were written by different code paths and
    // disagree on checksum casing) but displayed as the payment ledger recorded them.
    const rows = this.db
      .prepare(
        `SELECT MIN(p.payee) address,
                MAX(p.source_name) label,
                COALESCE(SUM(p.amount_usdc),0) paid,
                COUNT(*) n,
                COALESCE((SELECT SUM(w.amount_usdc) FROM withdrawals w
                          WHERE LOWER(w.wallet) = LOWER(p.payee)),0) out,
                COALESCE((SELECT COUNT(*) FROM withdrawals w
                          WHERE LOWER(w.wallet) = LOWER(p.payee)),0) outn
           FROM payment_events p
          WHERE p.settled = 1 AND p.kind != 'inbound' AND p.payee IS NOT NULL
          GROUP BY LOWER(p.payee)`,
      )
      .all() as { address: string; label: string | null; paid: number; n: number; out: number; outn: number }[];

    return rows.map((r) => ({
      address: r.address,
      ...(r.label ? { label: r.label } : {}),
      paidUsdc: round(r.paid),
      paymentCount: r.n,
      withdrawnUsdc: round(r.out),
      withdrawCount: r.outn,
    }));
  }

  // ── api keys ──

  async mintApiKey(
    wallet: string,
    prefix: string,
    keyHash: string,
    label?: string,
    scopes?: string,
    sourceIds?: string | null,
  ): Promise<{ rawKey: string; prefix: string; id: string }> {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO api_keys (id,prefix,key_hash,wallet,label,created_at,scopes,source_ids)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        prefix,
        keyHash,
        wallet,
        label ?? null,
        new Date().toISOString(),
        scopes ?? null,
        sourceIds ?? null,
      );
    // rawKey is NOT stored; caller reconstructs it from the prefix + suffix they generated.
    // We echo prefix so the caller can display it; rawKey is assembled by the route handler.
    return { rawKey: "", prefix, id };
  }

  async verifyApiKey(
    prefix: string,
    incomingHash: string,
  ): Promise<{
    walletAddress: string;
    keyId: string;
    scopes: string | null;
    sourceIds: string | null;
  } | null> {
    const row = this.db
      .prepare(
        `SELECT id,key_hash,wallet,scopes,source_ids FROM api_keys
         WHERE prefix=? AND revoked_at IS NULL`,
      )
      .get(prefix) as
      | { id: string; key_hash: string; wallet: string; scopes: string | null; source_ids: string | null }
      | undefined;
    if (!row) return null;

    // Timing-safe compare on fixed-length SHA-256 hex (always 64 chars).
    if (row.key_hash.length !== incomingHash.length) return null;
    const match = crypto.timingSafeEqual(
      Buffer.from(row.key_hash, "hex"),
      Buffer.from(incomingHash, "hex"),
    );
    if (!match) return null;

    // Update last_used_at asynchronously — don't await so it's fire-and-forget.
    this.db
      .prepare(`UPDATE api_keys SET last_used_at=? WHERE id=?`)
      .run(new Date().toISOString(), row.id);

    return {
      walletAddress: row.wallet,
      keyId: row.id,
      scopes: row.scopes ?? null,
      sourceIds: row.source_ids ?? null,
    };
  }

  async listApiKeys(wallet: string): Promise<ApiKeyRow[]> {
    const rows = this.db
      .prepare(`SELECT id,prefix,wallet,label,created_at,last_used_at,revoked_at,scopes,source_ids FROM api_keys WHERE wallet=? ORDER BY created_at DESC`)
      .all(wallet) as Record<string, unknown>[];
    return rows.map(rowToApiKey);
  }

  async revokeApiKey(id: string, wallet: string): Promise<void> {
    // Only revoke if the key belongs to this wallet (ownership check).
    this.db
      .prepare(`UPDATE api_keys SET revoked_at=? WHERE id=? AND wallet=? AND revoked_at IS NULL`)
      .run(new Date().toISOString(), id, wallet);
  }

  async incrementUsage(keyId: string): Promise<void> {
    const day = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    this.db
      .prepare(
        `INSERT INTO api_key_usage (key_id,day,call_count) VALUES (?,?,1)
         ON CONFLICT(key_id,day) DO UPDATE SET call_count=call_count+1`,
      )
      .run(keyId, day);
  }

  async getUsage(keyId: string, days = 30): Promise<ApiKeyUsage[]> {
    const rows = this.db
      .prepare(
        `SELECT day, call_count FROM api_key_usage WHERE key_id=? ORDER BY day DESC LIMIT ?`,
      )
      .all(keyId, days) as { day: string; call_count: number }[];
    return rows.map((r) => ({ day: r.day, count: r.call_count }));
  }

  async saveQueryMemory(entry: QueryMemoryEntry): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO query_memories (id,source_scores,sources_read,topics,created_at) VALUES (?,?,?,?,?)`,
      )
      .run(
        entry.id,
        JSON.stringify(entry.sourceScores),
        entry.sourcesRead ? JSON.stringify(entry.sourcesRead) : null,
        JSON.stringify(entry.topics),
        entry.createdAt,
      );
  }

  async loadQueryMemories(limit: number): Promise<QueryMemoryEntry[]> {
    const rows = this.db
      .prepare(`SELECT * FROM query_memories ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as {
      id: string;
      source_scores: string;
      sources_read: string | null;
      topics: string;
      created_at: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      sourceScores: JSON.parse(r.source_scores),
      // NULL on entries written before the column existed — left undefined so scoring can tell
      // "the run read nothing" apart from "we never recorded what it read".
      sourcesRead: r.sources_read ? JSON.parse(r.sources_read) : undefined,
      topics: JSON.parse(r.topics),
      createdAt: r.created_at,
    }));
  }

  async recordFeedback(queryId: string, rating: "up" | "down", comment?: string): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO answer_feedback (id,query_id,rating,comment,created_at) VALUES (?,?,?,?,?)`,
      )
      .run(crypto.randomUUID(), queryId, rating, comment ?? null, new Date().toISOString());
  }

  async getFeedbackStats(queryId?: string): Promise<FeedbackStats> {
    const row = queryId
      ? (this.db
          .prepare(
            `SELECT COUNT(*) total, SUM(CASE WHEN rating='up' THEN 1 ELSE 0 END) up, SUM(CASE WHEN rating='down' THEN 1 ELSE 0 END) down FROM answer_feedback WHERE query_id=?`,
          )
          .get(queryId) as { total: number; up: number; down: number })
      : (this.db
          .prepare(
            `SELECT COUNT(*) total, SUM(CASE WHEN rating='up' THEN 1 ELSE 0 END) up, SUM(CASE WHEN rating='down' THEN 1 ELSE 0 END) down FROM answer_feedback`,
          )
          .get() as { total: number; up: number; down: number });
    const total = row?.total ?? 0;
    const up = row?.up ?? 0;
    const down = row?.down ?? 0;
    return { total, up, down, rate: total > 0 ? round(up / total) : 0 };
  }

  async creatorLeaderboard(): Promise<CreatorEarnings[]> {
    const rows = this.db
      .prepare(
        `SELECT source_id, source_name, payee,
                COALESCE(SUM(amount_usdc),0) total, COUNT(*) cnt,
                SUM(CASE WHEN kind='citation' THEN 1 ELSE 0 END) cites
         FROM payment_events
         WHERE kind IN ('fetch','citation') AND settled = 1
         GROUP BY source_id ORDER BY total DESC`,
      )
      .all();
    return rows.map((r) => ({
      sourceId: r.source_id as string,
      sourceName: r.source_name as string,
      walletAddress: r.payee as string,
      totalEarnedUsdc: round(r.total as number),
      paymentCount: r.cnt as number,
      citationCount: r.cites as number,
    }));
  }
}

function rowToUser(r: Record<string, unknown>): UserRecord {
  return {
    walletAddress: r.wallet_address as string,
    role: r.role as string,
    displayHandle: r.display_handle as string,
    firstSeenAt: r.first_seen_at as string,
    lastSeenAt: r.last_seen_at as string,
  };
}

function rowToApiKey(r: Record<string, unknown>): ApiKeyRow {
  return {
    id: r.id as string,
    prefix: r.prefix as string,
    wallet: r.wallet as string,
    label: (r.label as string) ?? null,
    createdAt: r.created_at as string,
    lastUsedAt: (r.last_used_at as string) ?? null,
    revokedAt: (r.revoked_at as string) ?? null,
    scopes: (r.scopes as string) ?? null,
    sourceIds: (r.source_ids as string) ?? null,
  };
}

function rowToSourceWithClaim(db: DatabaseSync, row: Record<string, unknown>): Source {
  const source = rowToSource(row), marker = getRetainedSourceClaimMarker(db, source.id);
  return marker ? { ...source, sourceClaimId: marker } : source;
}
function rowToSource(r: Record<string, unknown>): Source {
  return {
    ...(r.scholarly_enrolled === 1 ? { scholarlyEnrolled: true } : {}),
    evidenceProvenance: r.evidence_provenance === "synthetic-demo" ? "synthetic-demo" : undefined,
    id: r.id as string,
    name: r.name as string,
    url: r.url as string,
    description: r.description as string,
    rssUrl: (r.rss_url as string) ?? undefined,
    walletAddress: r.wallet_address as string,
    fetchPrice: r.fetch_price as number,
    tags: safeParse(r.tags as string, []),
    authors: safeParse(r.authors as string, []),
    createdAt: r.created_at as string,
    ipfsCid: (r.ipfs_cid as string) ?? undefined,
    // active=null means old row before the column existed — treat as active.
    active: r.active === undefined || r.active === null ? true : Boolean(r.active),
    onchainId: (r.onchain_id as string) ?? undefined,
    registerTx: (r.register_tx as string) ?? undefined,
    // verified=null means old row before the column existed — grandfather as verified.
    verified: r.verified === undefined || r.verified === null ? true : Boolean(r.verified),
    // preview_depth=null grandfathers the row as "full"; normalize guards any bad value.
    previewDepth: normalizePreviewDepth(r.preview_depth),
  };
}

function rowToSourceItem(r: Record<string, unknown>): SourceItem {
  return {
    evidenceProvenance: r.evidence_provenance === "synthetic-demo" ? "synthetic-demo" : undefined,
    id: r.id as string,
    sourceId: r.source_id as string,
    title: r.title as string,
    summary: r.summary as string,
    content: r.content as string,
    link: r.link as string,
    publishedAt: (r.published_at as string) ?? undefined,
    ipfsCid: (r.ipfs_cid as string) ?? undefined,
    itemKeyEnc: (r.item_key_enc as string) ?? undefined,
    itemIv: (r.item_iv as string) ?? undefined,
    itemAuthTag: (r.item_auth_tag as string) ?? undefined,
    itemWrapIv: (r.item_wrap_iv as string) ?? undefined,
    deliveryKind: (r.delivery_kind as SourceItem["deliveryKind"]) ?? undefined,
    storageMode: (r.storage_mode as SourceItem["storageMode"]) ?? undefined,
    plaintextBytes:
      r.plaintext_bytes === null || r.plaintext_bytes === undefined
        ? undefined
        : Number(r.plaintext_bytes),
    bodyHash: (r.body_hash as string) ?? undefined,
    manifest: rowToArticleContentManifest(r),
  };
}

function rowToArticleContentManifest(
  r: Record<string, unknown>,
): SourceItem["manifest"] {
  if (!r.manifest_id || !r.manifest_signature || !r.manifest_signer) return undefined;
  return {
    id: String(r.manifest_id),
    sourceId: String(r.source_id),
    itemId: String(r.id),
    canonicalUrl: String(r.link ?? ""),
    bodyHash: String(r.body_hash ?? ""),
    plaintextBytes: Number(r.plaintext_bytes ?? 0),
    deliveryKind: (r.delivery_kind as NonNullable<SourceItem["deliveryKind"]>) ?? "abstract",
    signer: String(r.manifest_signer),
    nonce: String(r.manifest_nonce ?? ""),
    signature: String(r.manifest_signature),
    createdAt: String(r.manifest_created_at ?? ""),
  };
}

function rowToArticleOffer(r: Record<string, unknown>): ArticleOffer {
  return {
    id: r.id as string,
    sourceId: r.source_id as string,
    itemId: r.item_id as string,
    contentVersion: r.content_version as string,
    priceUsdc6: Number(r.price_usdc6),
    expiresAt: Number(r.expires_at),
    signer: r.signer as string,
    nonce: r.nonce as string,
    signature: r.signature as string,
    createdAt: r.created_at as string,
  };
}

function rowToGapIntent(r: Record<string, unknown>): GapIntent {
  return {
    id: String(r.id),
    gapId: String(r.gap_id),
    claim: String(r.claim),
    question: String(r.question),
    failedQueryId: String(r.failed_query_id),
    sourceId: String(r.source_id),
    sourceItemLink: String(r.source_item_link ?? ""),
    ...(r.item_id ? { itemId: String(r.item_id) } : {}),
    ...(r.content_version ? { contentVersion: String(r.content_version) } : {}),
    ...(r.article_offer_id ? { articleOfferId: String(r.article_offer_id) } : {}),
    ownerWallet: String(r.owner_wallet).toLowerCase(),
    status: r.status as GapIntent["status"],
    attempts: Number(r.attempts ?? 0),
    ...(r.lease_expires_at === null || r.lease_expires_at === undefined
      ? {}
      : { leaseExpiresAt: Number(r.lease_expires_at) }),
    ...(r.retry_run_id ? { retryRunId: String(r.retry_run_id) } : {}),
    ...(r.coverage === null || r.coverage === undefined
      ? {}
      : { coverage: Number(r.coverage) }),
    ...(r.reward_usdc === null || r.reward_usdc === undefined
      ? {}
      : { rewardUsdc: Number(r.reward_usdc) }),
    ...(r.last_error ? { lastError: String(r.last_error) } : {}),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function rowToPayment(r: Record<string, unknown>): PaymentRecord {
  return {
    ...(r.scholarly_declaration_id ? { scholarlyDeclarationId: String(r.scholarly_declaration_id) } : {}),
    ...(r.scholarly_approval_id ? { scholarlyApprovalId: String(r.scholarly_approval_id) } : {}),
    id: r.id as string,
    kind: r.kind as PaymentRecord["kind"],
    queryId: r.query_id as string,
    sourceId: r.source_id as string,
    sourceName: r.source_name as string,
    payer: r.payer as string,
    payee: r.payee as string,
    amountUsdc: r.amount_usdc as number,
    weight: (r.weight as number) ?? undefined,
    rationale: (r.rationale as string) ?? undefined,
    txHash: (r.tx_hash as string) ?? null,
    network: r.network as string,
    settled: Boolean(r.settled),
    settlementStatus:
      (r.settlement_status as PaymentRecord["settlementStatus"]) ??
      (Boolean(r.settled) ? "settled" : "simulated"),
    authorizationId: (r.authorization_id as string) ?? undefined,
    authorizationPhase: (r.authorization_phase as PaymentRecord["authorizationPhase"]) ?? undefined,
    authorizationExpiresAt: (r.authorization_expires_at as string) ?? undefined,
    grantEpoch: (r.grant_epoch as string) ?? undefined,
    origin: (r.origin as PaymentRecord["origin"]) ?? undefined,
    itemId: (r.item_id as string) ?? undefined,
    itemTitle: (r.item_title as string) ?? undefined,
    itemUrl: (r.item_url as string) ?? undefined,
    contentVersion: (r.content_version as string) ?? undefined,
    itemPublishedAt: (r.item_published_at as string) ?? undefined,
    offerId: (r.offer_id as string) ?? undefined,
    listPriceUsdc:
      r.list_price_usdc === null || r.list_price_usdc === undefined
        ? undefined
        : Number(r.list_price_usdc),
    createdAt: r.created_at as string,
  };
}

function rowToA2aOrder(r: Record<string, unknown>): A2aOrder {
  return {
    id: String(r.id),
    queryId: String(r.query_id),
    authorizationId: String(r.authorization_id),
    requestHash: String(r.request_hash),
    payer: String(r.payer),
    payee: String(r.payee),
    amountUsdc: Number(r.amount_usdc),
    creatorBudgetUsdc: Number(r.creator_budget_usdc),
    serviceFeeUsdc: Number(r.service_fee_usdc),
    researchMode: r.research_mode === "quick" ? "quick" : "deep",
    researchPackage: r.package_data
      ? (JSON.parse(String(r.package_data)) as A2aOrder["researchPackage"])
      : null,
    status: r.status as A2aOrder["status"],
    transaction: String(r.transaction_id),
    request: r.request_data
      ? (JSON.parse(String(r.request_data)) as A2aOrder["request"])
      : null,
    startedAt: r.started_at == null ? null : String(r.started_at),
    workerId: r.worker_id == null ? null : String(r.worker_id),
    executionJournalVersion: r.execution_journal_version === 1 ? 1 : null,
    paymentStartedAt: r.payment_started_at == null ? null : String(r.payment_started_at),
    resultSavingAt: r.result_saving_at == null ? null : String(r.result_saving_at),
    response: r.response_data
      ? (JSON.parse(String(r.response_data)) as Record<string, unknown>)
      : null,
    errorCode: r.error_code == null ? null : String(r.error_code),
    resolution: r.resolution_data
      ? (JSON.parse(String(r.resolution_data)) as A2aOrder["resolution"])
      : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function rowToWithdrawal(r: Record<string, unknown>): WithdrawalRecord {
  return {
    txHash: r.tx_hash as string,
    label: r.label as string,
    sourceName: (r.source_name as string) ?? undefined,
    wallet: r.wallet as string,
    recipient: r.recipient as string,
    amountUsdc: r.amount_usdc as number,
    network: r.network as string,
    createdAt: r.created_at as string,
  };
}

function safeParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
