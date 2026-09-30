import { publicReferenceSchema, type PublicReference } from "../public-references/catalog";
/**
 * Supabase adapter (deploy path). Same interface as the SQLite adapter.
 * Metrics/leaderboard aggregate in JS — fine for hackathon volume, no DB functions needed.
 * Requires the tables in supabase/migrations to exist (service-role key used for writes).
 */

import { listSupabaseWithdrawalHistory, type WithdrawalHistoryCursor } from "./creator-withdrawal-history";
import { iterateSupabaseRecentQueries } from "./recent-query-stream";
import { confirmSupabasePrivateCreator, getSupabasePrivateCreatorConfirmation, type PrivateCreatorConfirmation } from "./private-creator-confirmations";
import { reserveSupabasePrivateTreasury, getSupabasePrivateTreasury, type PrivateTreasuryPolicy } from "./private-treasury-capacity";
import { getSupabasePrivateTreasurySummary } from "./private-treasury-summary";
import { releaseSupabasePrivateTreasury } from "./private-treasury-release";
import { getSupabasePrivateInterruption, interruptSupabasePrivateResearch } from "./private-research-interruptions";
import { reserveSupabaseWithdrawalRequest, getSupabaseWithdrawalRequest, claimSupabaseWithdrawalTransfer, getSupabaseWithdrawalTransferClaim } from "./creator-withdrawal-requests";
import type { WithdrawalRequestRecord } from "../gateway/withdrawal-request";
import { saveSupabaseWithdrawalAttestation, getSupabaseWithdrawalAttestation } from "./creator-withdrawal-attestations";
import { listSupabasePrivateWorkerCandidates, listSupabasePrivateReconciliationCandidates } from "./private-worker-candidates";
import { admitSupabasePrivateCreatorSubmission, listSupabasePrivateCreatorSubmissions, type PrivateCreatorSubmission } from "./private-creator-submissions";
import { saveSupabasePrivateResult, getSupabasePrivateResult } from "./private-research-results";
import { claimSupabasePrivateExecution, getSupabasePrivateExecution } from "./private-research-executions";
import { createClient } from "@supabase/supabase-js";
import { SupabaseAuthority } from "./supabase-authority";
import type { StorageIdentity } from "./storage-identity";
import { prepareBrowserAuthorizationIntent, type BrowserAuthorizationIntent, type BrowserAdmissionResult } from "./browser-authorization-admission";
import { prepareBrowserJournal, type BrowserJournalAdmission, type BrowserJournalAdmissionResult, type BrowserAuthorizationJournal, type BrowserSignedMetadata } from "./browser-authorization-journal";
import { recordSupabaseWithdrawal } from "./withdrawal-records";
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
import type { PrivateResearchIntent } from "../a2a/private-research-intent";
import type { PrivatePaymentConfirmation } from "../a2a/private-payment-state";
import { claimSupabasePrivatePayment, getSupabasePrivatePayment, confirmSupabasePrivatePayment } from "./private-research-payments";
import { getSupabasePrivateResearchIntent, reserveSupabasePrivateResearchIntent, listSupabasePrivateResearchHistory, type PrivateHistoryCursor } from "./private-research-intents";
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
  calculateTestnetEconomics,
  economicsRunSample,
  type EconomicsRunSample,
} from "../economics/testnet-economics";
import { activationWindow, emptyActivationCounts } from "../activation";

/**
 * supabase-js normally resolves PostgREST failures as `{ data, error }`. Most adapter methods
 * intentionally return domain data rather than Supabase result objects, so silently ignoring
 * `error` can make a failed ledger write look successful. Making non-2xx responses reject at the
 * transport boundary gives every read/write normal promise semantics and keeps caller catch paths
 * effective.
 */
export async function throwingSupabaseFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);
  if (response.ok) return response;
  const detail = await response.clone().text().catch(() => "");
  throw new Error(
    `Supabase request failed (${response.status})${detail ? `: ${detail.slice(0, 500)}` : ""}`,
  );
}

export class SupabaseAdapter implements KeryxDB {
  private sb: SupabaseAuthority;

  constructor(expectedIdentity: StorageIdentity) {
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        global: { fetch: throwingSupabaseFetch },
      },
    );
    this.sb = new SupabaseAuthority(client, expectedIdentity);
  }

  getStorageIdentity(): Readonly<StorageIdentity> {
    return this.sb.getStorageIdentity();
  }

  async init(): Promise<void> {
    await this.sb.init();
    // Schema is applied via migrations. Seal legacy plaintext caches before accepting traffic;
    // service-role access is required and migration 0033 removes the old public-read policy.
    if (cacheEncryptionRequired(this.sb.expectedIdentity.authorityMode) && !hasContentKey()) {
      throw new Error("CONTENT_MASTER_KEY is required for paid-content cache access in real mode");
    }
    if (hasContentKey()) {
      const rows = await this.allRows("cache_items", "source_id,text", "source_id");
      for (const row of rows) {
        const text = typeof row.text === "string" ? row.text : "";
        const sourceId = typeof row.source_id === "string" ? row.source_id : "";
        if (!sourceId || !text || isEncryptedCacheValue(text)) continue;
        await this.sb.rpc("init", { p_row: { text: sealCacheText(text, this.sb.expectedIdentity.authorityMode) }, p_source_id: sourceId });
      }
    }
  }

  /** Supabase projects commonly cap one PostgREST response at 1,000 rows. Metrics are all-time,
   * so silently accepting the first page would undercount as soon as traction becomes meaningful. */
  private async allRows(
    table: "cache_items" | "payment_events" | "query_runs" | "answer_feedback" | "gap_intents" | "a2a_orders",
    _columns: string,
    _orderBy = "id",
  ): Promise<Record<string, unknown>[]> {
    const pageSize = 1_000;
    const rows: Record<string, unknown>[] = [];
    const scans = { cache_items: "scan_cache_for_encryption", payment_events: "scan_payment_metrics",
      query_runs: "scan_query_metrics", answer_feedback: "scan_feedback_metrics",
      gap_intents: "scan_gap_metrics", a2a_orders: "scan_order_economics" } as const;
    for (let from = 0; from < 200_000; from += pageSize) {
      const { data } = await this.sb.rpc(scans[table], { p_offset: from, p_limit: pageSize });
      const page = (data ?? []) as unknown as Record<string, unknown>[];
      rows.push(...page);
      if (page.length < pageSize) return rows;
    }
    throw new Error("Authority scan exceeds the supported complete snapshot bound");
  }

  async upsertSource(s: Source): Promise<void> {
    if (s.id.startsWith("public:")) throw new Error("Reserved public-reference source ID");
    // active defaults to true for offline/DB-direct rows that predate the flag.
    await this.sb.rpc("upsert_source", { p_row: {
      id: s.id,
      name: s.name,
      url: s.url,
      description: s.description,
      rss_url: s.rssUrl ?? null,
      wallet_address: s.walletAddress,
      fetch_price: s.fetchPrice,
      tags: s.tags,
      authors: s.authors,
      created_at: s.createdAt,
      ipfs_cid: s.ipfsCid ?? null,
      active: s.active !== false, // treat undefined as true
      verified: s.verified !== false, // treat undefined as true (grandfather curated/seed rows)
      preview_depth: s.previewDepth ?? null,
      onchain_id: s.onchainId ?? null,
      register_tx: s.registerTx ?? null,
    } });
  }

  // No public-reference schema is deployed on Supabase. Public catalog writes fail closed;
  // the existing creator catalog keeps its established schema and payment authority.
  async listPublicReferences(): Promise<PublicReference[]> { return []; }
  async getPublicReference(_id: string): Promise<PublicReference | null> { return null; }
  async upsertPublicReference(reference: PublicReference): Promise<void> {
    publicReferenceSchema.parse(reference);
    throw new Error("Public references require the SQLite adapter");
  }
  async listSources(): Promise<Source[]> {
    // Filter to active=true only — deactivated on-chain sources must not be discovered/cited.
    const { data } = await this.sb.rpc("list_sources", { p_active: true });
    return (data ?? []).map(rowToSource);
  }

  async listAllSources(): Promise<Source[]> {
    // Deactivated rows included — owner history only, never discovery. See the interface note.
    const { data } = await this.sb.rpc("list_all_sources", {  });
    return (data ?? []).map(rowToSource);
  }

  async setSourceMeta(id: string, meta: import("./keryx-db").SourceMeta): Promise<void> {
    await this.sb.rpc("set_source_meta", { p_row: {
      id,
      name: meta.name,
      description: meta.description,
      url: meta.url,
      rss_url: meta.rssUrl ?? null,
      updated_at: new Date().toISOString(),
    } });
  }

  async getSourceMeta(id: string): Promise<import("./keryx-db").SourceMeta | null> {
    const { data } = await this.sb.rpc("get_source_meta", { p_id: id });
    if (!data) return null;
    return {
      name: (data.name as string) ?? "",
      description: (data.description as string) ?? "",
      url: (data.url as string) ?? "",
      rssUrl: (data.rss_url as string) || undefined,
    };
  }

  async setSourceNotify(id: string, url: string, secret: string): Promise<void> {
    await this.sb.rpc("set_source_notify", { p_row: {
      source_id: id,
      notify_url: url,
      secret,
      updated_at: new Date().toISOString(),
    } });
  }

  async getSourceNotify(id: string): Promise<import("./keryx-db").SourceNotify | null> {
    const { data } = await this.sb.rpc("get_source_notify", { p_source_id: id });
    if (!data) return null;
    return { url: (data.notify_url as string) ?? "", secret: (data.secret as string) ?? "" };
  }

  async deleteSourceNotify(id: string): Promise<void> {
    await this.sb.rpc("delete_source_notify", { p_source_id: id });
  }

  async setSourceNotifyEmail(id: string, email: string, unsubToken: string): Promise<void> {
    // Fresh save resets last_sent_at — a new address should hear about its next citation promptly.
    await this.sb.rpc("set_source_notify_email", { p_row: {
      source_id: id,
      email,
      unsub_token: unsubToken,
      last_sent_at: null,
      updated_at: new Date().toISOString(),
    } });
  }

  async getSourceNotifyEmail(id: string): Promise<import("./keryx-db").SourceNotifyEmail | null> {
    const { data } = await this.sb.rpc("get_source_notify_email", { p_source_id: id });
    if (!data) return null;
    return {
      email: (data.email as string) ?? "",
      unsubToken: (data.unsub_token as string) ?? "",
      lastSentAt: (data.last_sent_at as string) ?? null,
    };
  }

  async deleteSourceNotifyEmail(id: string): Promise<void> {
    await this.sb.rpc("delete_source_notify_email", { p_source_id: id });
  }

  async markSourceNotifyEmailSent(id: string, at: string): Promise<void> {
    await this.sb.rpc("mark_source_notify_email_sent", { p_row: { last_sent_at: at }, p_source_id: id });
  }

  async setSourcePreviewDepth(id: string, depth: string): Promise<void> {
    await this.sb.rpc("set_source_preview_depth", { p_row: { preview_depth: depth }, p_id: id });
  }

  async getSource(id: string): Promise<Source | null> {
    const { data } = await this.sb.rpc("get_source", { p_id: id });
    return data ? rowToSource(data) : null;
  }

  async getSourceByOnchainId(onchainId: string): Promise<Source | null> {
    const { data } = await this.sb.rpc("get_source_by_onchain_id", { p_onchain_id: onchainId });
    return data ? rowToSource(data) : null;
  }

  async addItems(items: SourceItem[]): Promise<void> {
    if (!items.length) return;
    await this.sb.rpc("add_items", { p_row: items.map((i) => ({
        id: i.id,
        source_id: i.sourceId,
        title: i.title,
        summary: i.summary,
        content: i.content,
        link: i.link,
        published_at: i.publishedAt ?? null,
        ipfs_cid: i.ipfsCid ?? null,
        item_key_enc: i.itemKeyEnc ?? null,
        item_iv: i.itemIv ?? null,
        item_auth_tag: i.itemAuthTag ?? null,
        item_wrap_iv: i.itemWrapIv ?? null,
        delivery_kind: i.deliveryKind ?? null,
        storage_mode: i.storageMode ?? null,
        plaintext_bytes: i.plaintextBytes ?? null,
        body_hash: i.bodyHash ?? null,
        manifest_id: i.manifest?.id ?? null,
        manifest_signer: i.manifest?.signer ?? null,
        manifest_nonce: i.manifest?.nonce ?? null,
        manifest_signature: i.manifest?.signature ?? null,
        manifest_created_at: i.manifest?.createdAt ?? null,
      })) });
  }

  async getItems(sourceId: string): Promise<SourceItem[]> {
    const { data } = await this.sb.rpc("get_items", { p_source_id: sourceId });
    return (data ?? []).map(rowToSourceItem);
  }

  async getItem(sourceId: string, itemId: string): Promise<SourceItem | null> {
    const { data } = await this.sb.rpc("get_item", { p_source_id: sourceId, p_id: itemId });
    return data ? rowToSourceItem(data) : null;
  }

  async getArticleOffer(sourceId: string, itemId: string): Promise<ArticleOffer | null> {
    const { data } = await this.sb.rpc("get_article_offer", { p_source_id: sourceId, p_item_id: itemId });
    return data ? rowToArticleOffer(data) : null;
  }

  async listArticleOffers(sourceId?: string): Promise<ArticleOffer[]> {
    const { data } = await this.sb.rpc("list_article_offers", { p_source_id: sourceId || null });
    return (data ?? []).map(rowToArticleOffer);
  }

  async setArticleOffer(offer: ArticleOffer): Promise<void> {
    const { error } = await this.sb.rpc("set_article_offer", { p_row: {
        source_id: offer.sourceId,
        item_id: offer.itemId,
        id: offer.id,
        content_version: offer.contentVersion,
        price_usdc6: offer.priceUsdc6,
        expires_at: offer.expiresAt,
        signer: offer.signer,
        nonce: offer.nonce,
        signature: offer.signature,
        created_at: offer.createdAt,
      } });
    if (error) throw error;
  }

  async deleteArticleOffer(sourceId: string, itemId: string): Promise<void> {
    const { error } = await this.sb.rpc("delete_article_offer", { p_source_id: sourceId, p_item_id: itemId });
    if (error) throw error;
  }

  /**
   * Counted client-side rather than with a `group by`: PostgREST has no grouped-count form, and the
   * alternative (one `head: true` count request per source) is a round trip per cited source. The
   * window keeps the row set small — posts published since one dispatch, across the handful of
   * sources it cited.
   */
  async countItemsPublishedBetween(
    sourceIds: string[],
    sinceIso: string,
    untilIso: string,
  ): Promise<Record<string, number>> {
    if (sourceIds.length === 0) return {};
    const { data } = await this.sb.rpc("count_items_published_between", { p_source_id: sourceIds, p_published_at: sinceIso, p_published_at_2: untilIso });
    const counts: Record<string, number> = {};
    for (const r of data ?? []) counts[r.source_id] = (counts[r.source_id] ?? 0) + 1;
    return counts;
  }

  async newestItemDates(sourceIds: string[]): Promise<Record<string, string>> {
    if (sourceIds.length === 0) return {};
    // `not is null` matters here: Postgres sorts NULLs first on a descending order, so without it
    // the first row per source could be an undated one and every source would look dateless.
    const { data } = await this.sb.rpc("newest_item_dates", { p_source_id: sourceIds });
    const newest: Record<string, string> = {};
    for (const r of data ?? []) if (!newest[r.source_id]) newest[r.source_id] = r.published_at;
    return newest;
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
    const { data, error } = await this.sb.rpc("create_gap_intent", {
      p_id: crypto.randomUUID(),
      p_gap_id: input.gapId,
      p_claim: input.claim,
      p_question: input.question,
      p_failed_query_id: input.failedQueryId,
      p_source_id: input.sourceId,
      p_source_item_link: input.sourceItemLink,
      p_item_id: input.itemId ?? null,
      p_content_version: input.contentVersion ?? null,
      p_article_offer_id: input.articleOfferId ?? null,
      p_owner_wallet: input.ownerWallet.toLowerCase(),
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("create_gap_intent returned no row");
    return rowToGapIntent(row as Record<string, unknown>);
  }

  async listGapIntents(limit = 200): Promise<GapIntent[]> {
    const { data } = await this.sb.rpc("list_gap_intents", { p_limit: Math.max(1, Math.min(Math.trunc(limit), 1_000)) });
    return (data ?? []).map(rowToGapIntent);
  }

  async claimGapIntent(now: number, leaseMs: number): Promise<GapIntent | null> {
    const { data } = await this.sb.rpc("claim_gap_intent", {
      p_now: now,
      p_lease_ms: Math.max(1_000, leaseMs),
    });
    const row = Array.isArray(data) ? data[0] : data;
    return row ? rowToGapIntent(row as Record<string, unknown>) : null;
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
    const { data } = await this.sb.rpc("finish_gap_intent", { p_row: {
        status: result.status,
        retry_run_id: result.retryRunId,
        coverage: result.coverage,
        reward_usdc: result.rewardUsdc,
        last_error: result.lastError ?? null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      }, p_id: id, p_status: "running" });
    if (!data) throw new Error(`gap intent ${id} is no longer leased`);
  }

  async failGapIntent(id: string, error: string, maxAttempts: number): Promise<void> {
    await this.sb.rpc("fail_gap_intent", {
      p_id: id,
      p_error: error.slice(0, 500),
      p_max_attempts: Math.max(1, Math.trunc(maxAttempts)),
    });
  }

  async expireGapIntent(id: string, reason: string): Promise<void> {
    await this.sb.rpc("expire_gap_intent", { p_row: {
        status: "stale",
        last_error: reason.slice(0, 500),
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      }, p_id: id, p_status: "running" });
  }

  async isCreatorWallet(addr: string): Promise<boolean> {
    // ilike performs case-insensitive comparison in Postgres — avoids LOWER() on
    // the indexed wallet_address column, which would prevent index use.
    const { data } = await this.sb.rpc("is_creator_wallet", { p_wallet_address: addr, p_limit: 1 });
    return data !== null;
  }

  async createAuthChallenge(hash: string, issuedAt: number, expiresAt: number): Promise<void> {
    const { error } = await this.sb.rpc("create_auth_challenge", { p_hash: hash, p_issued_at: issuedAt, p_expires_at: expiresAt });
    if (error) throw error;
  }

  async createWebSession(record: WebSessionRecord): Promise<void> {
    const { error } = await this.sb.rpc("create_web_session", {
      p_hash: record.hash, p_wallet: record.wallet.toLowerCase(), p_issued_at: record.issuedAt, p_expires_at: record.expiresAt,
    });
    if (error) throw error;
  }

  async getWebSession(hash: string): Promise<WebSessionRecord | null> {
    const { data, error } = await this.sb.rpc("get_web_session", { p_hash: hash });
    if (error) throw error;
    return data ? { hash: data.hash, wallet: data.wallet, issuedAt: Number(data.issued_at), expiresAt: Number(data.expires_at) } : null;
  }

  async revokeWebSession(hash: string, wallet: string): Promise<void> {
    const { error } = await this.sb.rpc("revoke_web_session", { p_hash: hash, p_wallet: wallet.toLowerCase() });
    if (error) throw error;
  }

  async listWebSessions(wallet: string, now: number): Promise<WebSessionRecord[]> {
    const { data, error } = await this.sb.rpc("list_web_sessions", { p_wallet: wallet.toLowerCase(), p_issued_at: now, p_expires_at: now, p_limit: 101 });
    if (error) throw error;
    return (data ?? []).map((row: { hash: string; wallet: string; issued_at: number | string; expires_at: number | string }) => ({ hash: row.hash, wallet: row.wallet, issuedAt: Number(row.issued_at), expiresAt: Number(row.expires_at) }));
  }

  async revokeOtherWebSessions(wallet: string, keepHash: string): Promise<void> {
    const { error } = await this.sb.rpc("revoke_other_web_sessions", { p_wallet: wallet.toLowerCase(), p_hash: keepHash });
    if (error) throw error;
  }

  async consumeAuthChallenge(hash: string, now: number): Promise<boolean> {
    const { data, error } = await this.sb.rpc("consume_auth_challenge", { p_hash: hash, p_now: now });
    if (error || typeof data !== "boolean") throw error ?? new Error("Invalid challenge-consumption result");
    return data;
  }

  async upsertUser(addr: string, role: string): Promise<{ user: UserRecord; created: boolean }> {
    const wallet = addr.toLowerCase();
    const now = new Date().toISOString();
    const existing = await this.getUser(wallet);
    // Preserve first_seen_at across sign-ins: set it only when the row is new.
    await this.sb.rpc("upsert_user", { p_row: {
      wallet_address: wallet,
      role,
      display_handle: shortAddress(addr),
      first_seen_at: existing?.firstSeenAt ?? now,
      last_seen_at: now,
    } });
    const user = (await this.getUser(wallet)) ?? {
      walletAddress: wallet,
      role,
      displayHandle: shortAddress(addr),
      firstSeenAt: now,
      lastSeenAt: now,
    };
    return { user, created: existing === null };
  }

  async getUser(addr: string): Promise<UserRecord | null> {
    const { data } = await this.sb.rpc("get_user", { p_wallet_address: addr });
    if (!data) return null;
    return {
      walletAddress: data.wallet_address as string,
      role: data.role as string,
      displayHandle: data.display_handle as string,
      firstSeenAt: data.first_seen_at as string,
      lastSeenAt: data.last_seen_at as string,
    };
  }

  async getCached(sourceId: string): Promise<string | null> {
    const { data } = await this.sb.rpc("get_cached", { p_source_id: sourceId });
    return data?.text ? openCacheText(data.text) : null;
  }

  async getCachedAt(sourceId: string): Promise<string | null> {
    const { data } = await this.sb.rpc("get_cached_at", { p_source_id: sourceId });
    return (data?.updated_at as string | undefined) ?? null;
  }

  async setCached(sourceId: string, text: string): Promise<void> {
    await this.sb.rpc("set_cached", { p_row: {
        source_id: sourceId,
        text: sealCacheText(text, this.sb.expectedIdentity.authorityMode),
        updated_at: new Date().toISOString(),
      } });
  }

  async reservePrivateResearchIntent(intent: PrivateResearchIntent) {
    return reserveSupabasePrivateResearchIntent(this.sb, intent);
  }
  async reservePrivateTreasury(id: string, payer: string, policy: PrivateTreasuryPolicy) {
    return reserveSupabasePrivateTreasury(this.sb, id, payer, policy);
  }
  async getPrivateTreasury(id: string, payer: string) { return getSupabasePrivateTreasury(this.sb, id, payer); }
  async getPrivateTreasurySummary(signer: string) { return getSupabasePrivateTreasurySummary(this.sb, signer); }
  async releasePrivateTreasury(id: string, payer: string, signer: string) { return releaseSupabasePrivateTreasury(this.sb, id, payer, signer); }
  async getPrivateResearchInterruption(id: string, payer: string) { return getSupabasePrivateInterruption(this.sb, id, payer); }
  async interruptPrivateResearch(id: string, payer: string, workerId: string) { return interruptSupabasePrivateResearch(this.sb, id, payer, workerId); }
  async listPrivateWorkerCandidates(signer: string, after?: string) { return listSupabasePrivateWorkerCandidates(this.sb, signer, after); }
  async listPrivateReconciliationCandidates(signer: string, after?: string) { return listSupabasePrivateReconciliationCandidates(this.sb, signer, after); }

  async confirmPrivateCreatorSubmission(id: string, payer: string, workerId: string, confirmation: PrivateCreatorConfirmation) {
    return confirmSupabasePrivateCreator(this.sb, id, payer, workerId, confirmation);
  }
  async getPrivateCreatorConfirmation(id: string, payer: string, authorizationId: string) {
    return getSupabasePrivateCreatorConfirmation(this.sb, id, payer, authorizationId);
  }

  async admitPrivateCreatorSubmission(id: string, payer: string, workerId: string, data: PrivateCreatorSubmission) {
    return admitSupabasePrivateCreatorSubmission(this.sb, id, payer, workerId, data);
  }
  async listPrivateCreatorSubmissions(id: string, payer: string) {
    return listSupabasePrivateCreatorSubmissions(this.sb, id, payer);
  }

  async savePrivateResearchResult(id: string, payer: string, workerId: string, run: QueryRun) {
    return saveSupabasePrivateResult(this.sb, id, payer, workerId, run);
  }
  async getPrivateResearchResult(id: string, payer: string) {
    return getSupabasePrivateResult(this.sb, id, payer);
  }

  async claimPrivateResearchExecution(id: string, payer: string) {
    return claimSupabasePrivateExecution(this.sb, id, payer);
  }
  async getPrivateResearchExecution(id: string, payer: string) {
    return getSupabasePrivateExecution(this.sb, id, payer);
  }

  async claimPrivatePaymentSubmission(id: string, payer: string) {
    return claimSupabasePrivatePayment(this.sb, id, payer);
  }
  async getPrivatePaymentState(id: string, payer: string) {
    return getSupabasePrivatePayment(this.sb, id, payer);
  }
  async confirmPrivatePayment(id: string, payer: string, confirmation: PrivatePaymentConfirmation) {
    return confirmSupabasePrivatePayment(this.sb, id, payer, confirmation);
  }

  async getPrivateResearchIntent(id: string, payer: string) {
    return getSupabasePrivateResearchIntent(this.sb, id, payer);
  }
  async listPrivateResearchHistory(payer: string, before?: PrivateHistoryCursor) {
    return listSupabasePrivateResearchHistory(this.sb, payer, before);
  }

  async saveQueryRun(run: QueryRun): Promise<void> {
    const evidenceTelemetry = runEvidenceMetrics(run);
    await this.sb.rpc("save_query_run", { p_row: {
      id: run.id,
      created_at: run.createdAt,
      question: run.question,
      budget: run.budget,
      engine: run.engine,
      total_spent: run.totalSpent,
      total_to_creators: run.totalToCreators,
      answer: run.answer,
      data: run,
      parent_id: run.parentId ?? null,
      asker: run.asker?.toLowerCase() ?? null,
      origin: run.origin ?? "engine",
      mcp_client: run.mcpClient ?? null,
      duration_ms: run.durationMs ?? null,
      payment_mode: run.paymentMode ?? null,
      payment_attempts: run.paymentAttempts ?? null,
      settled_payments: run.settledPayments ?? null,
      confidence_level: run.confidence?.level ?? null,
      evidence_claim_count: evidenceTelemetry.evidenceClaimCount,
      grounded_claim_count: evidenceTelemetry.groundedClaimCount,
      rewarded_citation_count: evidenceTelemetry.rewardedCitationCount,
      economics_data: economicsRunSample(run),
    } });
  }

  async listFollowUps(parentId: string): Promise<QueryRun[]> {
    const { data } = await this.sb.rpc("list_follow_ups", { p_parent_id: parentId });
    return (data ?? []).map((r: { data: QueryRun }) => r.data);
  }

  async listQueryRunsByAsker(wallet: string, limit: number): Promise<QueryRun[]> {
    const { data } = await this.sb.rpc("list_query_runs_by_asker", { p_asker: wallet.toLowerCase(), p_limit: limit });
    return (data ?? []).map((r: { data: QueryRun }) => r.data);
  }

  async getQueryRun(id: string): Promise<QueryRun | null> {
    const { data } = await this.sb.rpc("get_query_run", { p_id: id });
    return (data?.data as QueryRun) ?? null;
  }

  async listRecentQueries(limit: number): Promise<QueryRun[]> {
    const { data } = await this.sb.rpc("list_recent_queries", { p_limit: limit });
    return (data ?? []).map((r: { data: QueryRun }) => r.data);
  }

  iterateRecentQueries(limit: number): AsyncIterable<QueryRun> {
    return iterateSupabaseRecentQueries(this.sb, limit);
  }

  async recordPayment(p: PaymentRecord): Promise<void> {
    const settlementStatus = assertPaymentSettlementState(p);
    const { error } = await this.sb.rpc("record_payment", { p_row: {
      id: p.id ?? crypto.randomUUID(),
      created_at: p.createdAt,
      kind: p.kind,
      query_id: p.queryId,
      source_id: p.sourceId,
      source_name: p.sourceName,
      payer: p.payer,
      payee: p.payee,
      amount_usdc: p.amountUsdc,
      weight: p.weight ?? null,
      rationale: p.rationale ?? null,
      tx_hash: p.txHash ?? null,
      network: p.network,
      settled: p.settled,
      settlement_status: settlementStatus,
      authorization_id: p.authorizationId ?? null,
      authorization_expires_at: p.authorizationExpiresAt ?? null,
      grant_epoch: p.grantEpoch ?? null,
      origin: p.origin ?? "engine",
      item_id: p.itemId ?? null,
      item_title: p.itemTitle ?? null,
      item_url: p.itemUrl ?? null,
      content_version: p.contentVersion ?? null,
      item_published_at: p.itemPublishedAt ?? null,
      offer_id: p.offerId ?? null,
      list_price_usdc: p.listPriceUsdc ?? null,
    } });
    if (error) throw error;
  }

  async recordPaymentOnce(p: PaymentRecord): Promise<boolean> {
    if (!p.id) throw new Error("recordPaymentOnce requires a deterministic payment id");
    const settlementStatus = assertPaymentSettlementState(p);
    const { data, error } = await this.sb.rpc("record_payment_once", { p_row: {
          id: p.id,
          created_at: p.createdAt,
          kind: p.kind,
          query_id: p.queryId,
          source_id: p.sourceId,
          source_name: p.sourceName,
          payer: p.payer,
          payee: p.payee,
          amount_usdc: p.amountUsdc,
          weight: p.weight ?? null,
          rationale: p.rationale ?? null,
          tx_hash: p.txHash ?? null,
          network: p.network,
          settled: p.settled,
          settlement_status: settlementStatus,
          authorization_id: p.authorizationId ?? null,
          authorization_expires_at: p.authorizationExpiresAt ?? null,
          grant_epoch: p.grantEpoch ?? null,
          origin: p.origin ?? "engine",
        } });
    if (error) throw error;
    return (data ?? []).length === 1;
  }

  async createA2aOrder(order: A2aOrder): Promise<{ created: boolean; order: A2aOrder }> {
    const row = a2aOrderToRow(order);
    try {
      const { data } = await this.sb.rpc("create_a2a_order", { p_row: row });
      if (!data) throw new Error("A2A order insert returned no row");
      return { created: true, order: rowToA2aOrder(data) };
    } catch (error) {
      if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "23505") throw error;
    }
    const { data: existing, error: readError } = await this.sb.rpc("create_a2a_order_2", { p_id: order.id });
    if (readError || !existing) throw readError ?? new Error("A2A order conflict could not be read");
    return { created: false, order: rowToA2aOrder(existing) };
  }

  async getA2aOrder(id: string): Promise<A2aOrder | null> {
    const { data, error } = await this.sb.rpc("get_a2a_order", { p_id: id });
    if (error) throw error;
    return data ? rowToA2aOrder(data) : null;
  }

  async listA2aOrdersByPayer(wallet: string, before?: { createdAt: string; id: string }): Promise<A2aOrder[]> {
    const { data, error } = await this.sb.rpc("list_a2a_orders_for_payer", {
      p_wallet: wallet.toLowerCase(), p_before_created_at: before?.createdAt ?? null, p_before_id: before?.id ?? null,
    });
    if (error) throw error;
    return (data ?? []).map(rowToA2aOrder);
  }

  async claimNextA2aOrder(workerId: string, startedAt: string): Promise<A2aOrder | null> {
    const { data, error } = await this.sb.rpc("claim_a2a_order", {
      p_worker_id: workerId,
      p_started_at: startedAt,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row ? rowToA2aOrder(row as Record<string, unknown>) : null;
  }

  async markA2aOrderPaymentStarted(id: string, startedAt: string): Promise<boolean> {
    const { data, error } = await this.sb.rpc("mark_a2a_payment_started", {
      p_id: id,
      p_started_at: startedAt,
    });
    if (error) throw error;
    return data === true;
  }

  async markA2aOrderResultSaving(id: string, startedAt: string): Promise<boolean> {
    const { data, error } = await this.sb.rpc("mark_a2a_result_saving", {
      p_id: id,
      p_started_at: startedAt,
    });
    if (error) throw error;
    return data === true;
  }

  async completeA2aOrder(
    id: string,
    response: Record<string, unknown>,
    updatedAt: string,
  ): Promise<boolean> {
    const { data, error } = await this.sb.rpc("complete_a2a_order", { p_row: { status: "completed", response_data: response, error_code: null, updated_at: updatedAt }, p_id: id, p_status: "running" });
    if (error) throw error;
    return (data ?? []).length === 1;
  }

  async failA2aOrder(id: string, errorCode: string, updatedAt: string): Promise<boolean> {
    const { data, error } = await this.sb.rpc("fail_a2a_order", { p_row: { status: "failed", error_code: errorCode, updated_at: updatedAt }, p_id: id, p_status: "running" });
    if (error) throw error;
    return (data ?? []).length === 1;
  }

  async resolveA2aOrder(id: string, update: A2aOrderResolutionUpdate): Promise<boolean> {
    const { data, error } = await this.sb.rpc("resolve_a2a_order", {
      p_id: id,
      p_outcome: update.status,
      p_response: update.status === "completed" ? update.response : null,
      p_error_code: update.status === "failed" ? update.errorCode : null,
      p_resolution: update.resolution,
      p_started_before: update.status === "failed" ? update.startedBefore : null,
    });
    if (error) throw error;
    return data === true;
  }

  async a2aOperationsSnapshot(nowMs: number): Promise<A2aOperationsSnapshot> {
    const since = new Date(nowMs - 24 * 60 * 60_000).toISOString();
    const { data, error } = await this.sb.rpc("a2a_operations_snapshot", { p_since: since });
    if (error) throw error;
    const rows = (data ?? []).map((row: Record<string, unknown>) => ({
      status: row.status as A2aOrder["status"],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      startedAt: row.started_at == null ? null : String(row.started_at),
    })) satisfies A2aOperationsRow[];
    return summarizeA2aOperations(rows, nowMs);
  }

  async listPayments(limit: number): Promise<PaymentRecord[]> {
    const { data } = await this.sb.rpc("list_payments", { p_limit: limit });
    return (data ?? []).map(rowToPayment);
  }

  async recordActivationEvent(event: ActivationEvent, day: string): Promise<void> {
    const { data } = await this.sb.rpc("increment_activation_event", {
      p_day: day,
      p_event: event,
    });
    if (data === null) return;
  }

  async activationFunnel(days: number): Promise<ActivationFunnel> {
    const window = activationWindow(days);
    const counts = emptyActivationCounts();
    const { data } = await this.sb.rpc("activation_funnel", { p_day: window.sinceDay });
    for (const row of data ?? []) {
      const event = row.event as ActivationEvent;
      if (Object.hasOwn(counts, event)) counts[event] += Number(row.count);
    }
    return { ...window, counts };
  }

  async listPendingPayments(limit: number): Promise<PaymentRecord[]> {
    const { data, error } = await this.sb.rpc("list_pending_payments", { p_settlement_status: "pending", p_settled: false, p_limit: limit });
    if (error) throw error;
    return (data ?? []).map(rowToPayment);
  }

  async settlePendingPayment(
    id: string,
    authorizationId: string,
    circleTransferId: string,
  ): Promise<boolean> {
    if (await this.browserJournalActive()) {
      return (await this.terminalBrowserJournal(id, authorizationId, circleTransferId, "settled")).resolved;
    }
    const { data, error } = await this.sb.rpc("settle_pending_payment", { p_row: {
        settled: true,
        settlement_status: "settled",
        tx_hash: circleTransferId,
      }, p_id: id, p_authorization_id: authorizationId, p_settled: false, p_settlement_status: "pending" });
    if (error) throw error;
    if ((data?.length ?? 0) > 1) {
      throw new Error(`pending payment compare-and-set updated multiple rows for ${id}`);
    }
    return data?.length === 1;
  }

  async failPendingPayment(
    id: string,
    authorizationId: string,
    circleTransferId: string,
  ): Promise<{ resolved: boolean; reservationReleased: boolean }> {
    if (await this.browserJournalActive()) {
      return this.terminalBrowserJournal(id, authorizationId, circleTransferId, "failed");
    }
    const { data, error } = await this.sb.rpc("fail_pending_payment", {
      p_id: id,
      p_authorization_id: authorizationId,
      p_circle_transfer_id: circleTransferId,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return {
      resolved: row?.resolved === true,
      reservationReleased: row?.reservation_released === true,
    };
  }

  async listPaymentsByQuery(queryId: string): Promise<PaymentRecord[]> {
    const { data } = await this.sb.rpc("list_payments_by_query", { p_query_id: queryId, p_kind: "citation" });
    return (data ?? []).map(rowToPayment);
  }

  async listCreatorPaymentAttemptsByQuery(queryId: string): Promise<PaymentRecord[]> {
    const { data, error } = await this.sb.rpc("list_creator_payment_attempts_by_query", { p_query_id: queryId, p_kind: "inbound" });
    if (error) throw error;
    return (data ?? []).map(rowToPayment);
  }

  async listPaymentsBySource(sourceId: string): Promise<PaymentRecord[]> {
    const { data } = await this.sb.rpc("list_payments_by_source", { p_source_id: sourceId, p_kind: "inbound" });
    return (data ?? []).map(rowToPayment);
  }

  async dailySettled(days: number): Promise<DailyVolume[]> {
    // Bound the scan to the window: only settled rows on/after the oldest day shown.
    const cutoff = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
    const { data } = await this.sb.rpc("daily_settled", { p_settled: true, p_created_at: cutoff });
    const tally = new Map<string, number>();
    for (const r of data ?? []) {
      const day = String(r.created_at).slice(0, 10);
      tally.set(day, (tally.get(day) ?? 0) + Number(r.amount_usdc ?? 0));
    }
    return fillDailySeries([...tally].map(([day, usdc]) => ({ day, usdc })), days);
  }

  async recordWithdrawal(w: WithdrawalRecord): Promise<void> {
    await recordSupabaseWithdrawal(this.sb, w);
  }

  async reserveCreatorWithdrawal(value: WithdrawalRequestRecord) { return reserveSupabaseWithdrawalRequest(this.sb, value); }
  async listCreatorWithdrawalHistory(owner: string, cursor?: WithdrawalHistoryCursor, limit = 25) { return listSupabaseWithdrawalHistory(this.sb, owner, cursor, limit); }
  async getCreatorWithdrawal(id: string, owner: string) { return getSupabaseWithdrawalRequest(this.sb, id, owner); }
  async claimCreatorWithdrawalTransfer(id: string, owner: string) { return claimSupabaseWithdrawalTransfer(this.sb, id, owner); }
  async getCreatorWithdrawalTransferClaim(id: string, owner: string) { return getSupabaseWithdrawalTransferClaim(this.sb, id, owner); }
  async saveCreatorWithdrawalAttestation(id: string, owner: string, claimId: string, value: unknown) { return saveSupabaseWithdrawalAttestation(this.sb, id, owner, claimId, value); }
  async getCreatorWithdrawalAttestation(id: string, owner: string) { return getSupabaseWithdrawalAttestation(this.sb, id, owner); }

  async listWithdrawals(limit: number): Promise<WithdrawalRecord[]> {
    const { data } = await this.sb.rpc("list_withdrawals", { p_limit: limit });
    return (data ?? []).map(rowToWithdrawal);
  }

  async metrics(): Promise<DashboardMetrics> {
    const [paymentRows, runRows, feedbackRows, gapIntentRows] = await Promise.all([
      this.allRows(
        "payment_events",
        "amount_usdc,source_id,query_id,kind,origin,settled,settlement_status,payer",
      ),
      this.allRows(
        "query_runs",
        "id,origin,asker,duration_ms,payment_mode,payment_attempts,settled_payments,confidence_level,mcp_client,evidence_claim_count,grounded_claim_count,rewarded_citation_count",
      ),
      this.allRows("answer_feedback", "query_id,rating"),
      this.allRows("gap_intents", "id,status"),
    ]);
    return calculateDashboardMetrics(
      paymentRows.map((p) => ({
        amountUsdc: Number(p.amount_usdc),
        sourceId: String(p.source_id ?? ""),
        queryId: String(p.query_id ?? ""),
        kind: p.kind as "fetch" | "citation" | "inbound",
        origin: (p.origin as import("../types").PaymentOrigin | null) ?? null,
        settled: Boolean(p.settled),
        settlementStatus:
          (p.settlement_status as import("../types").PaymentSettlementStatus | null) ?? null,
        payer: (p.payer as string | null) ?? null,
      })),
      runRows.map((r) => ({
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
      })),
      feedbackRows.map((f) => ({
        queryId: String(f.query_id),
        rating: f.rating as "up" | "down",
      })),
      gapIntentRows.map((intent) => ({
          status: intent.status as import("../types").GapIntentStatus,
      })),
    );
  }

  async economics() {
    const [runRows, paymentRows, a2aOrderRows] = await Promise.all([
      this.allRows("query_runs", "id,economics_data"),
      this.allRows(
        "payment_events",
        "query_id,kind,amount_usdc,settled,settlement_status,grant_epoch",
      ),
      this.allRows(
        "a2a_orders",
        "query_id,creator_budget_usdc,service_fee_usdc,status,response_data",
      ),
    ]);
    return calculateTestnetEconomics(
      runRows.flatMap((row) => {
        const sample = row.economics_data as EconomicsRunSample | null;
        return sample ? [sample] : [];
      }),
      paymentRows.map((row) => ({
        queryId: String(row.query_id ?? ""),
        kind: row.kind as "fetch" | "citation" | "inbound",
        amountUsdc: Number(row.amount_usdc),
        settled: Boolean(row.settled),
        settlementStatus:
          (row.settlement_status as import("../types").PaymentSettlementStatus | null) ?? null,
        grantEpoch: (row.grant_epoch as string | null) ?? null,
      })),
      new Date(),
      a2aOrderRows.map((row) => ({
        queryId: String(row.query_id),
        creatorBudgetUsdc: Number(row.creator_budget_usdc),
        serviceFeeUsdc: Number(row.service_fee_usdc),
        status: row.status as "running" | "completed" | "failed",
        response: (row.response_data as Record<string, unknown> | null) ?? null,
      })),
    );
  }

  async settlementLedger(): Promise<LedgerAccount[]> {
    const [{ data: pays }, { data: outs }] = await Promise.all([
      this.sb.rpc("settlement_ledger", {  }),
      this.sb.rpc("settlement_ledger_2", {  }),
    ]);

    // Keyed lowercased: the two tables were written by different code paths and disagree on
    // checksum casing. The display address is whichever casing the payment ledger recorded.
    const accounts = new Map<string, LedgerAccount>();
    for (const p of pays ?? []) {
      if (!p.payee || p.kind === "inbound" || !p.settled) continue;
      const key = String(p.payee).toLowerCase();
      const acc = accounts.get(key) ?? {
        address: String(p.payee),
        ...(p.source_name ? { label: String(p.source_name) } : {}),
        paidUsdc: 0,
        paymentCount: 0,
        withdrawnUsdc: 0,
        withdrawCount: 0,
      };
      acc.paidUsdc += Number(p.amount_usdc);
      acc.paymentCount += 1;
      accounts.set(key, acc);
    }
    for (const w of outs ?? []) {
      const acc = accounts.get(String(w.wallet ?? "").toLowerCase());
      if (!acc) continue; // a cash-out from a wallet this ledger never paid is not ours to explain
      acc.withdrawnUsdc += Number(w.amount_usdc);
      acc.withdrawCount += 1;
    }

    return [...accounts.values()].map((a) => ({
      ...a,
      paidUsdc: round(a.paidUsdc),
      withdrawnUsdc: round(a.withdrawnUsdc),
    }));
  }

  async getSyncState(key: string): Promise<string | null> {
    const { data } = await this.sb.rpc("get_sync_state", { p_key: key });
    return data?.value ?? null;
  }

  async setSyncState(key: string, value: string): Promise<void> {
    await this.sb.rpc("set_sync_state", { p_row: { key, value, updated_at: new Date().toISOString() } });
  }

  // ── session grants ──

  async upsertSessionGrant(grant: Omit<SessionGrantRecord, "spent">): Promise<void> {
    const row = {
      session_id: grant.sessionId,
      sess_addr: grant.sessAddr,
      owner_addr: grant.ownerAddr,
      cap: grant.cap,
      spent: 0,
      expiry: grant.expiry,
      tx_hash: grant.txHash,
      grant_epoch: grant.grantEpoch,
    };
    if (await this.browserJournalActive()) {
      const { error } = await this.sb.rpc("upsert_browser_journal_grant", { p_grant: row });
      if (error) throw error;
      return;
    }
    const { error } = await this.sb.rpc("upsert_session_grant", { p_row: row });
    if (error) throw error;
  }

  async getSessionGrant(sessionId: string): Promise<SessionGrantRecord | null> {
    const { data } = await this.sb.rpc("get_session_grant", { p_session_id: sessionId });
    if (!data) return null;
    return {
      sessionId: data.session_id,
      sessAddr: data.sess_addr,
      ownerAddr: data.owner_addr,
      cap: Number(data.cap),
      spent: Number(data.spent),
      expiry: Number(data.expiry),
      txHash: data.tx_hash,
      grantEpoch: data.grant_epoch,
    };
  }

  /** The SQL function reserves only when spent + amount remains under cap. */
  async addSessionGrantSpend(sessionId: string, grantEpoch: string, sessAddr: string, amount: number): Promise<boolean> {
    const { data, error } = await this.sb.rpc("reserve_session_grant_spend", {
      p_session_id: sessionId,
      p_grant_epoch: grantEpoch,
      p_sess_addr: sessAddr,
      p_amount: amount,
      p_now: Date.now(),
    });
    if (error) throw error;
    return data === true;
  }

  async admitBrowserAuthorization(input: BrowserAuthorizationIntent): Promise<BrowserAdmissionResult> {
    const intent = prepareBrowserAuthorizationIntent(input);
    const { data, error } = await this.sb.rpc("admit_browser_authorization", {
      p_intent: {
        nonce: intent.nonce, session_id: intent.sessionId, request_id: intent.requestId,
        query_id: intent.queryId, grant_epoch: intent.grantEpoch, signer: intent.signer,
        network: intent.network, token: intent.token, gateway_contract: intent.gatewayContract,
        source_id: intent.sourceId, offer_id: intent.offerId, kind: intent.kind,
        payee: intent.payee, amount_micro_usdc: intent.amountMicroUsdc, created_at: intent.createdAt,
      },
    });
    if (error) throw error;
    if (data === "grant_or_cap_refused") return { status: "grant_or_cap_refused" };
    if (data !== "admitted") throw new Error(`Unexpected browser admission result: ${String(data)}`);
    return { status: "admitted", intent };
  }

  async browserJournalActive(): Promise<boolean> {
    const { data, error } = await this.sb.rpc("browser_journal_active", { p_id: 1 });
    if (error) throw error;
    if (!data || typeof data.active !== "boolean") throw new Error("Invalid browser journal activation state");
    return data.active;
  }

  async activateBrowserJournal(): Promise<void> {
    const { error } = await this.sb.rpc("activate_browser_journal");
    if (error) throw error;
  }

  async browserSignerConfirmedSpendMicro(signer: string): Promise<number> {
    const { data, error } = await this.sb.rpc("browser_signer_confirmed_spend_micro", { p_signer: signer });
    if (error) throw error;
    const amount = Number(data);
    if (data == null || !Number.isSafeInteger(amount) || amount < 0) throw new Error("Invalid confirmed browser spend");
    return amount;
  }

  async admitBrowserJournal(input: BrowserJournalAdmission): Promise<BrowserJournalAdmissionResult> {
    const journal = prepareBrowserJournal(input);
    const { data, error } = await this.sb.rpc("admit_browser_journal", {
      p_intent: {
        nonce: journal.nonce, session_id: journal.sessionId, request_id: journal.requestId,
        query_id: input.queryId, grant_epoch: journal.grantEpoch, signer: journal.signer,
        network: input.network, token: input.token, gateway_contract: input.gatewayContract,
        source_id: input.sourceId, offer_id: input.offerId, kind: input.kind, payee: input.payee,
        amount_micro_usdc: input.amountMicroUsdc, created_at: journal.payment.createdAt,
      }, p_requirements: journal.requirements, p_payment: journal.payment,
    });
    if (error) throw error;
    if (data === "inactive" || data === "grant_or_cap_refused") return { status: data } as const;
    if (data !== "admitted") throw new Error(`Unexpected browser journal admission: ${String(data)}`);
    return { status: "admitted", journal } as const;
  }

  async getBrowserJournal(sessionId: string, requestId: string): Promise<BrowserAuthorizationJournal | null> {
    const { data, error } = await this.sb.rpc("get_browser_journal", { p_session_id: sessionId, p_request_id: requestId });
    if (error) throw error;
    if (!data) return null;
    const { intent, binding, payment } = data;
    return {
      nonce: intent.nonce, admittedAt: intent.created_at, sessionId: intent.session_id, requestId: intent.request_id,
      grantEpoch: intent.grant_epoch, signer: intent.signer, requirements: binding.requirements,
      phase: payment.authorization_phase, payment: rowToPayment(payment),
      signedValidAfter: binding.valid_after ?? undefined, signedValidBefore: binding.valid_before ?? undefined,
      signedHeaderHash: binding.header_hash ?? undefined,
    };
  }

  private async transitionBrowserJournal(sessionId: string, requestId: string, from: string, to: string): Promise<boolean> {
    const { data, error } = await this.sb.rpc("transition_browser_journal", {
      p_session_id: sessionId, p_request_id: requestId, p_from: from, p_to: to,
    });
    if (error) throw error;
    return data === true;
  }

  async exposeBrowserJournal(sessionId: string, requestId: string): Promise<boolean> {
    return this.transitionBrowserJournal(sessionId, requestId, "prepared", "exposed");
  }

  async submitBrowserJournal(sessionId: string, requestId: string): Promise<boolean> {
    return this.transitionBrowserJournal(sessionId, requestId, "signed", "submission_attempted");
  }

  async signBrowserJournal(sessionId: string, requestId: string, metadata: BrowserSignedMetadata): Promise<boolean> {
    const { data, error } = await this.sb.rpc("sign_browser_journal", {
      p_session_id: sessionId, p_request_id: requestId, p_metadata: metadata,
    });
    if (error) throw error;
    return data === true;
  }

  private async terminalBrowserJournal(id: string, nonce: string, transferId: string | null, mode: string) {
    const { data, error } = await this.sb.rpc("terminal_browser_journal", {
      p_id: id, p_nonce: nonce, p_transfer_id: transferId, p_mode: mode,
    });
    if (error) throw error;
    return { resolved: data?.resolved === true, reservationReleased: data?.reservation_released === true };
  }

  async cancelPreparedBrowserJournal(sessionId: string, requestId: string): Promise<boolean> {
    const journal = await this.getBrowserJournal(sessionId, requestId);
    if (!journal) return false;
    return (await this.terminalBrowserJournal(journal.payment.id!, journal.nonce, null, "cancelled_unexposed")).resolved;
  }

  async reserveOnramp(
    addressKey: string,
    dayKey: string,
    amount: number,
    dailyCap: number,
    now: number,
  ): Promise<OnrampReservation> {
    const { data, error } = await this.sb.rpc("reserve_onramp", {
      p_address_key: addressKey,
      p_day_key: dayKey,
      p_amount: amount,
      p_daily_cap: dailyCap,
      p_now: now,
    });
    if (error) throw error;
    if (data === "reserved" || data === "already-funded" || data === "daily-cap") return data;
    throw new Error(`reserve_onramp returned unexpected result: ${String(data)}`);
  }

  async releaseOnramp(addressKey: string, dayKey: string, amount: number): Promise<void> {
    const { error } = await this.sb.rpc("release_onramp", {
      p_address_key: addressKey,
      p_day_key: dayKey,
      p_amount: amount,
    });
    if (error) throw error;
  }

  async releaseSessionGrantSpend(sessionId: string, grantEpoch: string, sessAddr: string, amount: number): Promise<void> {
    const { error } = await this.sb.rpc("release_session_grant_spend", {
      p_session_id: sessionId,
      p_grant_epoch: grantEpoch,
      p_sess_addr: sessAddr,
      p_amount: amount,
    });
    if (error) throw error;
  }

  async deleteSessionGrant(sessionId: string): Promise<void> {
    if (await this.browserJournalActive()) {
      const { error } = await this.sb.rpc("disable_browser_journal_grant", { p_session_id: sessionId });
      if (error) throw error;
      return;
    }
    const { error } = await this.sb.rpc("delete_session_grant", { p_session_id: sessionId });
    if (error) throw error;
  }

  async deleteExpiredSessionGrants(now: number): Promise<void> {
    if (await this.browserJournalActive()) return;
    const { error } = await this.sb.rpc("delete_expired_session_grants", { p_expiry: now });
    if (error) throw error;
  }

  /** Delegates to a SQL function for the same reason the SQLite adapter uses one statement:
   *  a read-modify-write would admit both of two concurrent requests on an exhausted bucket. */
  async consumeRateLimit(
    bucket: string,
    points: number,
    windowMs: number,
    now: number,
  ): Promise<RateLimitDecision> {
    const { data, error } = await this.sb.rpc("consume_rate_limit", {
      p_bucket: bucket,
      p_points: points,
      p_window_ms: windowMs,
      p_now: now,
    });
    // Surface the failure so the caller can fall back to the in-process limiter rather than
    // silently admitting every request.
    if (error || !data) throw error ?? new Error("consume_rate_limit returned no row");
    const row = Array.isArray(data) ? data[0] : data;
    return {
      allowed: row.allowed === true,
      msBeforeNext: Math.max(0, Number(row.ms_before_next)),
    };
  }

  async deleteExpiredRateLimits(now: number): Promise<void> {
    await this.sb.rpc("delete_expired_rate_limits", { p_reset_at: now });
  }

  async acquireReasoningCircuit(
    key: string,
    now: number,
    probeLeaseMs: number,
  ): Promise<ReasoningCircuitDecision> {
    const { data, error } = await this.sb.rpc("acquire_reasoning_circuit", {
      p_key: key,
      p_now: now,
      p_probe_ms: probeLeaseMs,
    });
    if (error || !data) throw error ?? new Error("acquire_reasoning_circuit returned no row");
    const row = Array.isArray(data) ? data[0] : data;
    return {
      allowed: row.allowed === true,
      retryAfterMs: Math.max(0, Number(row.retry_after_ms)),
    };
  }

  async recordReasoningCircuitFailure(
    key: string,
    transient: boolean,
    now: number,
    failureThreshold: number,
    baseCooldownMs: number,
    maxCooldownMs: number,
  ): Promise<ReasoningCircuitRecord> {
    const { data, error } = await this.sb.rpc("record_reasoning_circuit_failure", {
      p_key: key,
      p_transient: transient,
      p_now: now,
      p_threshold: failureThreshold,
      p_base_cooldown_ms: baseCooldownMs,
      p_max_cooldown_ms: maxCooldownMs,
    });
    if (error || !data) {
      throw error ?? new Error("record_reasoning_circuit_failure returned no row");
    }
    const row = Array.isArray(data) ? data[0] : data;
    return {
      key,
      failures: Number(row.failures),
      openUntil: Number(row.open_until),
      probeUntil: 0,
      updatedAt: now,
    };
  }

  async clearReasoningCircuit(key: string): Promise<void> {
    const { error } = await this.sb.rpc("clear_reasoning_circuit", { p_key: key });
    if (error) throw error;
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
    await this.sb.rpc("mint_api_key", { p_row: {
      id,
      prefix,
      key_hash: keyHash,
      wallet,
      label: label ?? null,
      created_at: new Date().toISOString(),
      scopes: scopes ?? null,
      source_ids: sourceIds ?? null,
    } });
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
    const { data } = await this.sb.rpc("verify_api_key", { p_prefix: prefix });
    if (!data) return null;

    const storedHash = data.key_hash as string;
    if (storedHash.length !== incomingHash.length) return null;
    const match = crypto.timingSafeEqual(
      Buffer.from(storedHash, "hex"),
      Buffer.from(incomingHash, "hex"),
    );
    if (!match) return null;

    // Fire-and-forget last_used_at update.
    void this.sb.rpc("verify_api_key_2", { p_row: { last_used_at: new Date().toISOString() }, p_id: data.id as string });

    return {
      walletAddress: data.wallet as string,
      keyId: data.id as string,
      scopes: (data.scopes as string) ?? null,
      sourceIds: (data.source_ids as string) ?? null,
    };
  }

  async listApiKeys(wallet: string): Promise<ApiKeyRow[]> {
    const { data } = await this.sb.rpc("list_api_keys", { p_wallet: wallet });
    return (data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      prefix: r.prefix as string,
      wallet: r.wallet as string,
      label: (r.label as string) ?? null,
      createdAt: r.created_at as string,
      lastUsedAt: (r.last_used_at as string) ?? null,
      revokedAt: (r.revoked_at as string) ?? null,
      scopes: (r.scopes as string) ?? null,
      sourceIds: (r.source_ids as string) ?? null,
    }));
  }

  async revokeApiKey(id: string, wallet: string): Promise<void> {
    await this.sb.rpc("revoke_api_key", { p_row: { revoked_at: new Date().toISOString() }, p_id: id, p_wallet: wallet });
  }

  async incrementUsage(keyId: string): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    await this.sb.rpc("upsert_api_key_usage", { p_key_id: keyId, p_day: day });
  }

  async getUsage(keyId: string, days = 30): Promise<ApiKeyUsage[]> {
    const { data } = await this.sb.rpc("get_usage", { p_key_id: keyId, p_limit: days });
    return (data ?? []).map((r: { day: string; call_count: number }) => ({ day: r.day, count: r.call_count }));
  }

  async saveQueryMemory(entry: QueryMemoryEntry): Promise<void> {
    await this.sb.rpc("save_query_memory", { p_row: {
      id: entry.id,
      source_scores: entry.sourceScores, // JSONB column auto-serializes
      sources_read: entry.sourcesRead ?? null,
      topics: entry.topics,
      created_at: entry.createdAt,
    } });
  }

  async loadQueryMemories(limit: number): Promise<QueryMemoryEntry[]> {
    const { data } = await this.sb.rpc("load_query_memories", { p_limit: limit });
    return (data ?? []).map((r: { id: string; source_scores: QueryMemoryEntry["sourceScores"]; sources_read: string[] | null; topics: string[]; created_at: string }) => ({
      id: r.id,
      sourceScores: r.source_scores, // JSONB auto-deserializes
      // NULL on rows written before the column existed — see the sqlite adapter for why it stays
      // undefined rather than becoming an empty list.
      sourcesRead: r.sources_read ?? undefined,
      topics: r.topics,
      createdAt: r.created_at,
    }));
  }

  async recordFeedback(queryId: string, rating: "up" | "down", comment?: string): Promise<void> {
    await this.sb.rpc("record_feedback", { p_row: {
      id: crypto.randomUUID(),
      query_id: queryId,
      rating,
      comment: comment ?? null,
      created_at: new Date().toISOString(),
    } });
  }

  async getFeedbackStats(queryId?: string): Promise<FeedbackStats> {
    const { data } = await this.sb.rpc("get_feedback_stats", { p_query_id: queryId ?? null });
    if (!data || !Number.isSafeInteger(data.total) || !Number.isSafeInteger(data.up) || !Number.isSafeInteger(data.down)) {
      throw new Error("Complete feedback statistics unavailable");
    }
    const { up, down, total } = data as { up: number; down: number; total: number };
    return { total, up, down, rate: total > 0 ? round(up / total) : 0 };
  }

  async creatorLeaderboard(): Promise<CreatorEarnings[]> {
    const data = await this.allRows(
      "payment_events",
      "source_id,source_name,payee,amount_usdc,kind,settled",
    );
    const map = new Map<string, CreatorEarnings>();
    for (const r of data) {
      if (r.kind === "inbound" || !r.settled) continue;
      const e =
        map.get(String(r.source_id)) ??
        ({
          sourceId: String(r.source_id),
          sourceName: String(r.source_name),
          walletAddress: String(r.payee),
          totalEarnedUsdc: 0,
          paymentCount: 0,
          citationCount: 0,
        } as CreatorEarnings);
      e.totalEarnedUsdc = round(e.totalEarnedUsdc + Number(r.amount_usdc));
      e.paymentCount += 1;
      if (r.kind === "citation") e.citationCount += 1;
      map.set(String(r.source_id), e);
    }
    return [...map.values()].sort((a, b) => b.totalEarnedUsdc - a.totalEarnedUsdc);
  }
}

function rowToSource(r: Record<string, unknown>): Source {
  return {
    id: r.id as string,
    name: r.name as string,
    url: r.url as string,
    description: r.description as string,
    rssUrl: (r.rss_url as string) ?? undefined,
    walletAddress: r.wallet_address as string,
    fetchPrice: Number(r.fetch_price),
    tags: (r.tags as string[]) ?? [],
    authors: (r.authors as Source["authors"]) ?? [],
    createdAt: r.created_at as string,
    ipfsCid: (r.ipfs_cid as string) ?? undefined,
    // active=null means old row before the column existed — treat as active.
    active: r.active === undefined || r.active === null ? true : Boolean(r.active),
    // verified=null means old row before the column existed — grandfather as verified.
    verified: r.verified === undefined || r.verified === null ? true : Boolean(r.verified),
    // preview_depth=null grandfathers the row as "full".
    previewDepth: normalizePreviewDepth(r.preview_depth),
    onchainId: (r.onchain_id as string) ?? undefined,
    registerTx: (r.register_tx as string) ?? undefined,
  };
}

function rowToSourceItem(r: Record<string, unknown>): SourceItem {
  return {
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

function rowToWithdrawal(r: Record<string, unknown>): WithdrawalRecord {
  return {
    txHash: r.tx_hash as string,
    label: r.label as string,
    sourceName: (r.source_name as string) ?? undefined,
    wallet: r.wallet as string,
    recipient: r.recipient as string,
    amountUsdc: Number(r.amount_usdc),
    network: r.network as string,
    createdAt: r.created_at as string,
  };
}

function rowToPayment(r: Record<string, unknown>): PaymentRecord {
  return {
    id: r.id as string,
    kind: r.kind as PaymentRecord["kind"],
    queryId: r.query_id as string,
    sourceId: r.source_id as string,
    sourceName: r.source_name as string,
    payer: r.payer as string,
    payee: r.payee as string,
    amountUsdc: Number(r.amount_usdc),
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

function a2aOrderToRow(order: A2aOrder) {
  return {
    id: order.id,
    query_id: order.queryId,
    authorization_id: order.authorizationId,
    request_hash: order.requestHash,
    payer: order.payer,
    payee: order.payee,
    amount_usdc: order.amountUsdc,
    creator_budget_usdc: order.creatorBudgetUsdc,
    service_fee_usdc: order.serviceFeeUsdc,
    research_mode: order.researchMode,
    package_data: order.researchPackage,
    status: order.status,
    transaction_id: order.transaction,
    request_data: order.request,
    started_at: order.startedAt,
    worker_id: order.workerId,
    execution_journal_version: order.executionJournalVersion,
    payment_started_at: order.paymentStartedAt,
    result_saving_at: order.resultSavingAt,
    response_data: order.response,
    error_code: order.errorCode,
    resolution_data: order.resolution,
    created_at: order.createdAt,
    updated_at: order.updatedAt,
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
    researchPackage: (r.package_data as A2aOrder["researchPackage"]) ?? null,
    status: r.status as A2aOrder["status"],
    transaction: String(r.transaction_id),
    request: (r.request_data as A2aOrder["request"]) ?? null,
    startedAt: r.started_at == null ? null : String(r.started_at),
    workerId: r.worker_id == null ? null : String(r.worker_id),
    executionJournalVersion: r.execution_journal_version === 1 ? 1 : null,
    paymentStartedAt: r.payment_started_at == null ? null : String(r.payment_started_at),
    resultSavingAt: r.result_saving_at == null ? null : String(r.result_saving_at),
    response: (r.response_data as Record<string, unknown> | null) ?? null,
    errorCode: r.error_code == null ? null : String(r.error_code),
    resolution: (r.resolution_data as A2aOrder["resolution"]) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
