/**
 * Supabase adapter (deploy path). Same interface as the SQLite adapter.
 * Metrics/leaderboard aggregate in JS — fine for hackathon volume, no DB functions needed.
 * Requires the tables in supabase/migrations to exist (service-role key used for writes).
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import type {
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
} from "./keryx-db";
import type { LedgerAccount } from "../gateway/settlement-parity";
import { fillDailySeries } from "./daily-series";
import { shortAddress } from "../utils";
import { normalizePreviewDepth } from "../sources/preview-depth";
import { assertPaymentSettlementState } from "../payments/payment-state";
import {
  calculateDashboardMetrics,
  runEvidenceMetrics,
} from "./dashboard-metrics";

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
  private sb: SupabaseClient;

  constructor() {
    this.sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        global: { fetch: throwingSupabaseFetch },
      },
    );
  }

  async init(): Promise<void> {
    /* schema applied via migrations */
  }

  /** Supabase projects commonly cap one PostgREST response at 1,000 rows. Metrics are all-time,
   * so silently accepting the first page would undercount as soon as traction becomes meaningful. */
  private async allRows(
    table: string,
    columns: string,
    orderBy = "id",
  ): Promise<Record<string, unknown>[]> {
    const pageSize = 1_000;
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data } = await this.sb
        .from(table)
        .select(columns)
        .order(orderBy, { ascending: true })
        .range(from, from + pageSize - 1);
      const page = (data ?? []) as unknown as Record<string, unknown>[];
      rows.push(...page);
      if (page.length < pageSize) return rows;
    }
  }

  async upsertSource(s: Source): Promise<void> {
    // active defaults to true for offline/DB-direct rows that predate the flag.
    await this.sb.from("sources").upsert({
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
    });
  }

  async listSources(): Promise<Source[]> {
    // Filter to active=true only — deactivated on-chain sources must not be discovered/cited.
    const { data } = await this.sb
      .from("sources")
      .select("*")
      .eq("active", true)
      .order("created_at");
    return (data ?? []).map(rowToSource);
  }

  async listAllSources(): Promise<Source[]> {
    // Deactivated rows included — owner history only, never discovery. See the interface note.
    const { data } = await this.sb.from("sources").select("*").order("created_at");
    return (data ?? []).map(rowToSource);
  }

  async setSourceMeta(id: string, meta: import("./keryx-db").SourceMeta): Promise<void> {
    await this.sb.from("source_meta").upsert({
      id,
      name: meta.name,
      description: meta.description,
      url: meta.url,
      rss_url: meta.rssUrl ?? null,
      updated_at: new Date().toISOString(),
    });
  }

  async getSourceMeta(id: string): Promise<import("./keryx-db").SourceMeta | null> {
    const { data } = await this.sb
      .from("source_meta")
      .select("name,description,url,rss_url")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    return {
      name: (data.name as string) ?? "",
      description: (data.description as string) ?? "",
      url: (data.url as string) ?? "",
      rssUrl: (data.rss_url as string) || undefined,
    };
  }

  async setSourceNotify(id: string, url: string, secret: string): Promise<void> {
    await this.sb.from("source_notify").upsert({
      source_id: id,
      notify_url: url,
      secret,
      updated_at: new Date().toISOString(),
    });
  }

  async getSourceNotify(id: string): Promise<import("./keryx-db").SourceNotify | null> {
    const { data } = await this.sb
      .from("source_notify")
      .select("notify_url,secret")
      .eq("source_id", id)
      .maybeSingle();
    if (!data) return null;
    return { url: (data.notify_url as string) ?? "", secret: (data.secret as string) ?? "" };
  }

  async deleteSourceNotify(id: string): Promise<void> {
    await this.sb.from("source_notify").delete().eq("source_id", id);
  }

  async setSourceNotifyEmail(id: string, email: string, unsubToken: string): Promise<void> {
    // Fresh save resets last_sent_at — a new address should hear about its next citation promptly.
    await this.sb.from("source_notify_email").upsert({
      source_id: id,
      email,
      unsub_token: unsubToken,
      last_sent_at: null,
      updated_at: new Date().toISOString(),
    });
  }

  async getSourceNotifyEmail(id: string): Promise<import("./keryx-db").SourceNotifyEmail | null> {
    const { data } = await this.sb
      .from("source_notify_email")
      .select("email,unsub_token,last_sent_at")
      .eq("source_id", id)
      .maybeSingle();
    if (!data) return null;
    return {
      email: (data.email as string) ?? "",
      unsubToken: (data.unsub_token as string) ?? "",
      lastSentAt: (data.last_sent_at as string) ?? null,
    };
  }

  async deleteSourceNotifyEmail(id: string): Promise<void> {
    await this.sb.from("source_notify_email").delete().eq("source_id", id);
  }

  async markSourceNotifyEmailSent(id: string, at: string): Promise<void> {
    await this.sb.from("source_notify_email").update({ last_sent_at: at }).eq("source_id", id);
  }

  async setSourcePreviewDepth(id: string, depth: string): Promise<void> {
    await this.sb.from("sources").update({ preview_depth: depth }).eq("id", id);
  }

  async getSource(id: string): Promise<Source | null> {
    const { data } = await this.sb.from("sources").select("*").eq("id", id).maybeSingle();
    return data ? rowToSource(data) : null;
  }

  async getSourceByOnchainId(onchainId: string): Promise<Source | null> {
    const { data } = await this.sb
      .from("sources")
      .select("*")
      .ilike("onchain_id", onchainId)
      .maybeSingle();
    return data ? rowToSource(data) : null;
  }

  async addItems(items: SourceItem[]): Promise<void> {
    if (!items.length) return;
    await this.sb.from("source_items").upsert(
      items.map((i) => ({
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
      })),
    );
  }

  async getItems(sourceId: string): Promise<SourceItem[]> {
    const { data } = await this.sb
      .from("source_items")
      .select("*")
      .eq("source_id", sourceId)
      .order("published_at", { ascending: false });
    return (data ?? []).map((r) => ({
      id: r.id,
      sourceId: r.source_id,
      title: r.title,
      summary: r.summary,
      content: r.content,
      link: r.link,
      publishedAt: r.published_at ?? undefined,
      ipfsCid: r.ipfs_cid ?? undefined,
      itemKeyEnc: r.item_key_enc ?? undefined,
      itemIv: r.item_iv ?? undefined,
      itemAuthTag: r.item_auth_tag ?? undefined,
    }));
  }

  async getItem(sourceId: string, itemId: string): Promise<SourceItem | null> {
    const { data } = await this.sb
      .from("source_items")
      .select("*")
      .eq("source_id", sourceId)
      .eq("id", itemId)
      .maybeSingle();
    return data ? rowToSourceItem(data) : null;
  }

  async getArticleOffer(sourceId: string, itemId: string): Promise<ArticleOffer | null> {
    const { data } = await this.sb
      .from("article_offers")
      .select("*")
      .eq("source_id", sourceId)
      .eq("item_id", itemId)
      .maybeSingle();
    return data ? rowToArticleOffer(data) : null;
  }

  async listArticleOffers(sourceId?: string): Promise<ArticleOffer[]> {
    let query = this.sb.from("article_offers").select("*");
    if (sourceId) query = query.eq("source_id", sourceId);
    const { data } = await query.order("created_at", { ascending: false });
    return (data ?? []).map(rowToArticleOffer);
  }

  async setArticleOffer(offer: ArticleOffer): Promise<void> {
    const { error } = await this.sb.from("article_offers").upsert(
      {
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
      },
      { onConflict: "source_id,item_id" },
    );
    if (error) throw error;
  }

  async deleteArticleOffer(sourceId: string, itemId: string): Promise<void> {
    const { error } = await this.sb
      .from("article_offers")
      .delete()
      .eq("source_id", sourceId)
      .eq("item_id", itemId);
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
    const { data } = await this.sb
      .from("source_items")
      .select("source_id")
      .in("source_id", sourceIds)
      .gt("published_at", sinceIso)
      .lte("published_at", untilIso);
    const counts: Record<string, number> = {};
    for (const r of data ?? []) counts[r.source_id] = (counts[r.source_id] ?? 0) + 1;
    return counts;
  }

  async newestItemDates(sourceIds: string[]): Promise<Record<string, string>> {
    if (sourceIds.length === 0) return {};
    // `not is null` matters here: Postgres sorts NULLs first on a descending order, so without it
    // the first row per source could be an undated one and every source would look dateless.
    const { data } = await this.sb
      .from("source_items")
      .select("source_id, published_at")
      .in("source_id", sourceIds)
      .not("published_at", "is", null)
      .order("published_at", { ascending: false });
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
    const { data } = await this.sb
      .from("gap_intents")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(Math.max(1, Math.min(Math.trunc(limit), 1_000)));
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
    const { data } = await this.sb
      .from("gap_intents")
      .update({
        status: result.status,
        retry_run_id: result.retryRunId,
        coverage: result.coverage,
        reward_usdc: result.rewardUsdc,
        last_error: result.lastError ?? null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "running")
      .select("id")
      .maybeSingle();
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
    await this.sb
      .from("gap_intents")
      .update({
        status: "stale",
        last_error: reason.slice(0, 500),
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "running");
  }

  async isCreatorWallet(addr: string): Promise<boolean> {
    // ilike performs case-insensitive comparison in Postgres — avoids LOWER() on
    // the indexed wallet_address column, which would prevent index use.
    const { data } = await this.sb
      .from("sources")
      .select("id")
      .ilike("wallet_address", addr)
      .limit(1)
      .maybeSingle();
    return data !== null;
  }

  async upsertUser(addr: string, role: string): Promise<{ user: UserRecord; created: boolean }> {
    const wallet = addr.toLowerCase();
    const now = new Date().toISOString();
    const existing = await this.getUser(wallet);
    // Preserve first_seen_at across sign-ins: set it only when the row is new.
    await this.sb.from("users").upsert({
      wallet_address: wallet,
      role,
      display_handle: shortAddress(addr),
      first_seen_at: existing?.firstSeenAt ?? now,
      last_seen_at: now,
    });
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
    const { data } = await this.sb
      .from("users")
      .select("*")
      .ilike("wallet_address", addr)
      .maybeSingle();
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
    const { data } = await this.sb
      .from("cache_items")
      .select("text")
      .eq("source_id", sourceId)
      .maybeSingle();
    return data?.text ?? null;
  }

  async getCachedAt(sourceId: string): Promise<string | null> {
    const { data } = await this.sb
      .from("cache_items")
      .select("updated_at")
      .eq("source_id", sourceId)
      .maybeSingle();
    return (data?.updated_at as string | undefined) ?? null;
  }

  async setCached(sourceId: string, text: string): Promise<void> {
    await this.sb
      .from("cache_items")
      .upsert({ source_id: sourceId, text, updated_at: new Date().toISOString() });
  }

  async saveQueryRun(run: QueryRun): Promise<void> {
    const evidenceTelemetry = runEvidenceMetrics(run);
    await this.sb.from("query_runs").upsert({
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
    });
  }

  async listFollowUps(parentId: string): Promise<QueryRun[]> {
    const { data } = await this.sb
      .from("query_runs")
      .select("data")
      .eq("parent_id", parentId)
      .order("created_at", { ascending: true });
    return (data ?? []).map((r) => r.data as QueryRun);
  }

  async listQueryRunsByAsker(wallet: string, limit: number): Promise<QueryRun[]> {
    const { data } = await this.sb
      .from("query_runs")
      .select("data")
      .eq("asker", wallet.toLowerCase())
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []).map((r) => r.data as QueryRun);
  }

  async getQueryRun(id: string): Promise<QueryRun | null> {
    const { data } = await this.sb.from("query_runs").select("data").eq("id", id).maybeSingle();
    return (data?.data as QueryRun) ?? null;
  }

  async listRecentQueries(limit: number): Promise<QueryRun[]> {
    const { data } = await this.sb
      .from("query_runs")
      .select("data")
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []).map((r) => r.data as QueryRun);
  }

  async recordPayment(p: PaymentRecord): Promise<void> {
    const settlementStatus = assertPaymentSettlementState(p);
    await this.sb.from("payment_events").insert({
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
      origin: p.origin ?? "engine",
      item_id: p.itemId ?? null,
      item_title: p.itemTitle ?? null,
      item_url: p.itemUrl ?? null,
      content_version: p.contentVersion ?? null,
      item_published_at: p.itemPublishedAt ?? null,
      offer_id: p.offerId ?? null,
      list_price_usdc: p.listPriceUsdc ?? null,
    });
  }

  async listPayments(limit: number): Promise<PaymentRecord[]> {
    const { data } = await this.sb
      .from("payment_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []).map(rowToPayment);
  }

  async listPendingPayments(limit: number): Promise<PaymentRecord[]> {
    const { data, error } = await this.sb
      .from("payment_events")
      .select("*")
      .eq("settlement_status", "pending")
      .eq("settled", false)
      .not("authorization_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(rowToPayment);
  }

  async settlePendingPayment(
    id: string,
    authorizationId: string,
    circleTransferId: string,
  ): Promise<boolean> {
    const { data, error } = await this.sb
      .from("payment_events")
      .update({
        settled: true,
        settlement_status: "settled",
        tx_hash: circleTransferId,
      })
      .eq("id", id)
      .eq("authorization_id", authorizationId)
      .eq("settled", false)
      .eq("settlement_status", "pending")
      .select("id");
    if (error) throw error;
    if ((data?.length ?? 0) > 1) {
      throw new Error(`pending payment compare-and-set updated multiple rows for ${id}`);
    }
    return data?.length === 1;
  }

  async listPaymentsByQuery(queryId: string): Promise<PaymentRecord[]> {
    const { data } = await this.sb
      .from("payment_events")
      .select("*")
      .eq("query_id", queryId)
      .eq("kind", "citation")
      .order("created_at", { ascending: true });
    return (data ?? []).map(rowToPayment);
  }

  async listPaymentsBySource(sourceId: string): Promise<PaymentRecord[]> {
    const { data } = await this.sb
      .from("payment_events")
      .select("*")
      .eq("source_id", sourceId)
      .neq("kind", "inbound")
      .order("created_at", { ascending: false });
    return (data ?? []).map(rowToPayment);
  }

  async dailySettled(days: number): Promise<DailyVolume[]> {
    // Bound the scan to the window: only settled rows on/after the oldest day shown.
    const cutoff = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
    const { data } = await this.sb
      .from("payment_events")
      .select("created_at, amount_usdc")
      .eq("settled", true)
      .gte("created_at", cutoff);
    const tally = new Map<string, number>();
    for (const r of data ?? []) {
      const day = String(r.created_at).slice(0, 10);
      tally.set(day, (tally.get(day) ?? 0) + Number(r.amount_usdc ?? 0));
    }
    return fillDailySeries([...tally].map(([day, usdc]) => ({ day, usdc })), days);
  }

  async recordWithdrawal(w: WithdrawalRecord): Promise<void> {
    // tx_hash is the primary key — upsert makes re-recording the same withdraw an idempotent no-op.
    await this.sb.from("withdrawals").upsert({
      tx_hash: w.txHash,
      created_at: w.createdAt,
      label: w.label,
      source_name: w.sourceName ?? null,
      wallet: w.wallet,
      recipient: w.recipient,
      amount_usdc: w.amountUsdc,
      network: w.network,
    });
  }

  async listWithdrawals(limit: number): Promise<WithdrawalRecord[]> {
    const { data } = await this.sb
      .from("withdrawals")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
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

  async settlementLedger(): Promise<LedgerAccount[]> {
    const [{ data: pays }, { data: outs }] = await Promise.all([
      this.sb.from("payment_events").select("payee,source_name,amount_usdc,kind,settled"),
      this.sb.from("withdrawals").select("wallet,amount_usdc"),
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
    const { data } = await this.sb
      .from("sync_state")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    return data?.value ?? null;
  }

  async setSyncState(key: string, value: string): Promise<void> {
    await this.sb
      .from("sync_state")
      .upsert({ key, value, updated_at: new Date().toISOString() });
  }

  // ── session grants ──

  async upsertSessionGrant(grant: Omit<SessionGrantRecord, "spent">): Promise<void> {
    await this.sb.from("session_grants").upsert({
      session_id: grant.sessionId,
      sess_addr: grant.sessAddr,
      owner_addr: grant.ownerAddr,
      cap: grant.cap,
      spent: 0,
      expiry: grant.expiry,
      tx_hash: grant.txHash,
    });
  }

  async getSessionGrant(sessionId: string): Promise<SessionGrantRecord | null> {
    const { data } = await this.sb
      .from("session_grants")
      .select("*")
      .eq("session_id", sessionId)
      .maybeSingle();
    if (!data) return null;
    return {
      sessionId: data.session_id,
      sessAddr: data.sess_addr,
      ownerAddr: data.owner_addr,
      cap: Number(data.cap),
      spent: Number(data.spent),
      expiry: Number(data.expiry),
      txHash: data.tx_hash,
    };
  }

  /** The SQL function reserves only when spent + amount remains under cap. */
  async addSessionGrantSpend(sessionId: string, amount: number): Promise<boolean> {
    const { data, error } = await this.sb.rpc("reserve_session_grant_spend", {
      p_session_id: sessionId,
      p_amount: amount,
      p_now: Date.now(),
    });
    if (error) throw error;
    return data === true;
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

  async releaseSessionGrantSpend(sessionId: string, amount: number): Promise<void> {
    const { error } = await this.sb.rpc("release_session_grant_spend", {
      p_session_id: sessionId,
      p_amount: amount,
    });
    if (error) throw error;
  }

  async deleteSessionGrant(sessionId: string): Promise<void> {
    await this.sb.from("session_grants").delete().eq("session_id", sessionId);
  }

  async deleteExpiredSessionGrants(now: number): Promise<void> {
    await this.sb.from("session_grants").delete().lte("expiry", now);
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
    await this.sb.from("rate_limit_counters").delete().lte("reset_at", now);
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
    const { error } = await this.sb.from("reasoning_circuits").delete().eq("key", key);
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
    await this.sb.from("api_keys").insert({
      id,
      prefix,
      key_hash: keyHash,
      wallet,
      label: label ?? null,
      created_at: new Date().toISOString(),
      scopes: scopes ?? null,
      source_ids: sourceIds ?? null,
    });
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
    const { data } = await this.sb
      .from("api_keys")
      .select("id,key_hash,wallet,scopes,source_ids")
      .eq("prefix", prefix)
      .is("revoked_at", null)
      .maybeSingle();
    if (!data) return null;

    const storedHash = data.key_hash as string;
    if (storedHash.length !== incomingHash.length) return null;
    const match = crypto.timingSafeEqual(
      Buffer.from(storedHash, "hex"),
      Buffer.from(incomingHash, "hex"),
    );
    if (!match) return null;

    // Fire-and-forget last_used_at update.
    void this.sb
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", data.id as string);

    return {
      walletAddress: data.wallet as string,
      keyId: data.id as string,
      scopes: (data.scopes as string) ?? null,
      sourceIds: (data.source_ids as string) ?? null,
    };
  }

  async listApiKeys(wallet: string): Promise<ApiKeyRow[]> {
    const { data } = await this.sb
      .from("api_keys")
      .select("id,prefix,wallet,label,created_at,last_used_at,revoked_at,scopes,source_ids")
      .eq("wallet", wallet)
      .order("created_at", { ascending: false });
    return (data ?? []).map((r) => ({
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
    await this.sb
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("wallet", wallet)
      .is("revoked_at", null);
  }

  async incrementUsage(keyId: string): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    await this.sb.rpc("upsert_api_key_usage", { p_key_id: keyId, p_day: day });
  }

  async getUsage(keyId: string, days = 30): Promise<ApiKeyUsage[]> {
    const { data } = await this.sb
      .from("api_key_usage")
      .select("day,call_count")
      .eq("key_id", keyId)
      .order("day", { ascending: false })
      .limit(days);
    return (data ?? []).map((r) => ({ day: r.day as string, count: r.call_count as number }));
  }

  async saveQueryMemory(entry: QueryMemoryEntry): Promise<void> {
    await this.sb.from("query_memories").insert({
      id: entry.id,
      source_scores: entry.sourceScores, // JSONB column auto-serializes
      sources_read: entry.sourcesRead ?? null,
      topics: entry.topics,
      created_at: entry.createdAt,
    });
  }

  async loadQueryMemories(limit: number): Promise<QueryMemoryEntry[]> {
    const { data } = await this.sb
      .from("query_memories")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []).map((r) => ({
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
    await this.sb.from("answer_feedback").insert({
      id: crypto.randomUUID(),
      query_id: queryId,
      rating,
      comment: comment ?? null,
      created_at: new Date().toISOString(),
    });
  }

  async getFeedbackStats(queryId?: string): Promise<FeedbackStats> {
    let query = this.sb.from("answer_feedback").select("rating");
    if (queryId) query = query.eq("query_id", queryId);
    const { data } = await query;
    const rows = data ?? [];
    const up = rows.filter((r) => r.rating === "up").length;
    const down = rows.filter((r) => r.rating === "down").length;
    const total = rows.length;
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

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
