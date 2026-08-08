/**
 * KeryxDB — persistence interface shared by the SQLite (dev) and Supabase (prod) adapters.
 * All amounts are USDC numbers. Metrics are computed only from real rows.
 */

import type { LedgerAccount } from "../gateway/settlement-parity";
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

export interface CreatorEarnings {
  sourceId: string;
  sourceName: string;
  walletAddress: string;
  totalEarnedUsdc: number;
  paymentCount: number;
  citationCount: number;
}

/** Human-readable off-chain metadata for a source (name, description, url).
 *  Stored separately from the on-chain record so the indexer can merge them
 *  without clobbering payment-critical chain data. */
export interface SourceMeta {
  name: string;
  description: string;
  url: string;
  /** The feed the creator listed, when it differs from `url`. Not on-chain, and the only place a
   *  freshly-indexed source can learn it: without it, feed-ownership verification would run
   *  against the site's homepage and never find the token the creator put in the feed. */
  rssUrl?: string;
}

/** A source's notify-on-citation webhook: the URL Keryx POSTs when the source is cited+paid,
 *  plus the per-source HMAC secret used to sign `X-Keryx-Signature`. Private off-chain config —
 *  never returned in public source listings; the secret is echoed to the owner only at set time. */
export interface SourceNotify {
  url: string;
  secret: string;
}

/** A source's citation email alert: the human channel beside the webhook. `unsubToken` is the
 *  per-row secret embedded in every mail's unsubscribe link (unauthenticated by design — the
 *  recipient must always be able to stop delivery); `lastSentAt` rate-caps sends per source. */
export interface SourceNotifyEmail {
  email: string;
  unsubToken: string;
  lastSentAt: string | null;
}

/** A browser co-sign spending session: the user funded a session EOA and authorised Keryx to
 *  request signatures from it up to `cap` USDC. Persisted so a deploy or crash does not strand a
 *  funded session, and — more importantly — so `spent` survives a restart: an in-memory counter
 *  reset the cap accounting every time the process bounced. There is no private key here; the key
 *  lives only in the browser tab that derived it. */
export interface SessionGrantRecord {
  /** Lowercased SIWE address of the owner; one active grant per wallet. */
  sessionId: string;
  /** The session EOA whose Gateway balance backs these payments. */
  sessAddr: string;
  ownerAddr: string;
  /** Total USDC the user funded — the hard spending ceiling. */
  cap: number;
  /** USDC spent so far under this grant (monotonically increasing). */
  spent: number;
  /** Unix ms at which this grant lapses. */
  expiry: number;
  /** On-chain tx that funded the session EOA, or "recovered". Record-keeping only. */
  txHash: string;
}

/** A row from api_keys (safe to return to the owner — no hash, no raw key). */
export interface ApiKeyRow {
  id: string;
  prefix: string;
  wallet: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  /** Comma-separated operations this key may perform. Null on keys minted before scopes
   *  existed, which means every scope — see lib/api-key-scopes.ts. */
  scopes: string | null;
  /** Comma-separated source ids this key is pinned to. Null = every source the wallet owns. */
  sourceIds: string | null;
}

/** Daily usage aggregate for a single key. */
export interface ApiKeyUsage {
  day: string;   // ISO date "YYYY-MM-DD"
  count: number;
}

/** Outcome of consuming one point from a fixed-window rate-limit bucket. */
export interface RateLimitDecision {
  /** False when the bucket is exhausted for the current window. */
  allowed: boolean;
  /** Milliseconds until the window resets — the Retry-After the caller should advertise. */
  msBeforeNext: number;
}

/** Durable health for one `(provider, reasoning step)` circuit. No prompt, response, or key data
 * is stored; only bounded failure counters and unix-ms scheduling state. */
export interface ReasoningCircuitRecord {
  key: string;
  failures: number;
  openUntil: number;
  probeUntil: number;
  updatedAt: number;
}

/** Result of atomically checking an open circuit or leasing its single half-open probe. */
export interface ReasoningCircuitDecision {
  allowed: boolean;
  retryAfterMs: number;
}

export type OnrampReservation = "reserved" | "already-funded" | "daily-cap";

/** A user account, keyed by wallet address (lowercased). Created on first SIWE
 *  sign-in. Non-custodial: an identity/profile index only — no funds, no keys,
 *  no credentials. Access control still re-derives the role live (see resolveRole). */
export interface UserRecord {
  walletAddress: string;
  /** Role snapshot at last sign-in (asker|creator|dev). For display only. */
  role: string;
  /** Compact display handle, e.g. "0x3844…97cd". */
  displayHandle: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** A single query memory: which sources a past run could have cited, and which it did. */
export interface QueryMemoryEntry {
  id: string;
  /** Per-source citation data from a past run — cited sources only. */
  sourceScores: Record<string, { name: string; weight: number; reward: number }>;
  /**
   * Every source the run actually read, cited or not — the denominator behind any claim about how
   * often a source earns its toll. Deliberately not "every source that was listed": a source the
   * agent skipped was never given the chance to be cited, and counting that as a miss would let one
   * skip justify the next. Absent on entries written before it was recorded.
   */
  sourcesRead?: string[];
  /** Topic keywords extracted from the question */
  topics: string[];
  createdAt: string;
}

/** Aggregated feedback for a query (or all queries). */
export interface FeedbackStats {
  total: number;
  up: number;
  down: number;
  rate: number; // up / total, 0 when no feedback
}

export interface KeryxDB {
  init(): Promise<void>;

  // ── sources & content ──
  upsertSource(source: Source): Promise<void>;
  listSources(): Promise<Source[]>;
  /** Every source row, including ones deactivated on-chain. Discovery must NEVER use this —
   *  it exists for owner-facing history (an audit export of what a wallet earned must still
   *  account for a source the creator has since retired). */
  listAllSources(): Promise<Source[]>;
  getSource(id: string): Promise<Source | null>;
  /** Look up a source by its on-chain registry id (bytes32). The indexer uses this to update the
   *  row a source already has, instead of minting a second one keyed by the hash. */
  getSourceByOnchainId(onchainId: string): Promise<Source | null>;
  /** Store off-chain human-readable metadata keyed by source id.
   *  Called by POST /api/sources at register time so the indexer can merge
   *  name/description/url into the on-chain cache row. */
  setSourceMeta(id: string, meta: SourceMeta): Promise<void>;
  /** Retrieve off-chain metadata for a source. Returns null if not set. */
  getSourceMeta(id: string): Promise<SourceMeta | null>;
  addItems(items: SourceItem[]): Promise<void>;
  getItems(sourceId: string): Promise<SourceItem[]>;
  /** Resolve one article only within its owning registry source. */
  getItem(sourceId: string, itemId: string): Promise<SourceItem | null>;
  /** Current immutable offer revision for one article, if the creator has published one. */
  getArticleOffer(sourceId: string, itemId: string): Promise<ArticleOffer | null>;
  /** Current offer revisions. Passing no source id returns the public marketplace book. */
  listArticleOffers(sourceId?: string): Promise<ArticleOffer[]>;
  /** Atomically replaces the current revision for `(sourceId,itemId)`. */
  setArticleOffer(offer: ArticleOffer): Promise<void>;
  /** Revoke the current offer for one article. No-op when none exists. */
  deleteArticleOffer(sourceId: string, itemId: string): Promise<void>;
  /** Posts each of `sourceIds` published inside (`sinceIso`, `untilIso`], keyed by source id;
   *  sources with none are absent rather than zero. Backs the freshness note on a dispatch —
   *  "what have these sources published since this answer settled". Undated rows never count
   *  (they cannot prove they are new) and `untilIso` exists so a feed with a future-dated post
   *  cannot pin an answer to "stale" forever. */
  countItemsPublishedBetween(
    sourceIds: string[],
    sinceIso: string,
    untilIso: string,
  ): Promise<Record<string, number>>;
  /** Newest publication date per source, for the sources that have one. One round trip for a whole
   *  list of dispatches — a ledger of 50 rows must not cost 50 count queries. */
  newestItemDates(sourceIds: string[]): Promise<Record<string, string>>;

  // ── creator offers against demand-board gaps ──
  /** Atomically admit at most one treasury-retry offer per measured gap and owner wallet. */
  createGapIntent(
    intent: Omit<
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
  ): Promise<GapIntent>;
  /** Public coordination view; contains no secrets or payout authority. */
  listGapIntents(limit?: number): Promise<GapIntent[]>;
  /** Atomically lease one pending intent whose source is active + verified. */
  claimGapIntent(now: number, leaseMs: number): Promise<GapIntent | null>;
  /** Complete a leased intent after its bounded treasury retry finishes. */
  finishGapIntent(
    id: string,
    result: {
      status: Extract<GapIntent["status"], "filled" | "missed" | "unpaid">;
      retryRunId: string;
      coverage: number;
      rewardUsdc: number;
      lastError?: string;
    },
  ): Promise<void>;
  /** Release a failed lease for bounded retry, or make it terminal after max attempts. */
  failGapIntent(id: string, error: string, maxAttempts: number): Promise<void>;
  /** Close a leased offer without spending because its demand gap is no longer open. */
  expireGapIntent(id: string, reason: string): Promise<void>;

  // ── notify-on-citation webhooks (off-chain, private to the source owner) ──
  /** Set or rotate a source's citation webhook (url + HMAC secret). Upsert keyed by source id. */
  setSourceNotify(id: string, url: string, secret: string): Promise<void>;
  /** Get a source's notify config, or null if none set. Carries the secret — owner-only path. */
  getSourceNotify(id: string): Promise<SourceNotify | null>;
  /** Remove a source's notify config (disable notifications). No-op if none set. */
  deleteSourceNotify(id: string): Promise<void>;

  // ── citation email alerts (off-chain, private to the source owner) ──
  /** Set or replace a source's alert email + unsubscribe token. Upsert keyed by source id. */
  setSourceNotifyEmail(id: string, email: string, unsubToken: string): Promise<void>;
  /** Get a source's email-alert config, or null if none set. Owner/dispatcher-only path. */
  getSourceNotifyEmail(id: string): Promise<SourceNotifyEmail | null>;
  /** Remove a source's email-alert config (unsubscribe / disable). No-op if none set. */
  deleteSourceNotifyEmail(id: string): Promise<void>;
  /** Record a successful delivery so the per-source rate cap has a reference point. */
  markSourceNotifyEmailSent(id: string, at: string): Promise<void>;

  /** Set a source's free-preview depth ("full" | "excerpt" | "locked"). Owner-gated by callers. */
  setSourcePreviewDepth(id: string, depth: string): Promise<void>;

  // ── cache (skip-repay decisions) ──
  getCached(sourceId: string): Promise<string | null>;
  /** When the cached copy was taken, or null if nothing is cached. The agent compares this against
   *  the source's newest post: a copy the source has published past is not a free read of it any
   *  more, it is a stale one (see lib/agent/cache-freshness.ts). */
  getCachedAt(sourceId: string): Promise<string | null>;
  setCached(sourceId: string, text: string): Promise<void>;

  // ── sync state (registry indexer checkpoint) ──
  /** Get a named sync-state value (e.g. "lastSyncedBlock"). Returns null if not set. */
  getSyncState(key: string): Promise<string | null>;
  /** Upsert a named sync-state value. */
  setSyncState(key: string, value: string): Promise<void>;
  /** Atomically reserve one address claim and increment the shared daily faucet total. */
  reserveOnramp(
    addressKey: string,
    dayKey: string,
    amount: number,
    dailyCap: number,
    now: number,
  ): Promise<OnrampReservation>;
  /** Undo a reservation when the chain transfer definitely failed. */
  releaseOnramp(addressKey: string, dayKey: string, amount: number): Promise<void>;

  // ── browser co-sign session grants (no keys, only caps + accounting) ──
  /** Create or replace the grant for a session id. Resets `spent` — callers re-register with a
   *  cap read from the live Gateway balance, which already nets out earlier spends. */
  upsertSessionGrant(grant: Omit<SessionGrantRecord, "spent">): Promise<void>;
  /** Fetch a grant. Returns null when absent; expiry is the caller's to interpret. */
  getSessionGrant(sessionId: string): Promise<SessionGrantRecord | null>;
  /** Atomically reserve against `spent` only when the live grant has enough cap. */
  addSessionGrantSpend(sessionId: string, amount: number): Promise<boolean>;
  /** Release a reservation after signing fails before an authorization is submitted. */
  releaseSessionGrantSpend(sessionId: string, amount: number): Promise<void>;
  deleteSessionGrant(sessionId: string): Promise<void>;
  /** Drop every grant that lapsed at or before `now` (unix ms). */
  deleteExpiredSessionGrants(now: number): Promise<void>;

  // ── rate-limit counters (durable, shared across processes) ──
  /** Atomically consume one point from `bucket`, opening a fresh `windowMs` window when the
   *  stored one has lapsed at `now` (unix ms). Must be a single statement: two callers hitting
   *  the same bucket concurrently is the normal case, and a read-modify-write would let both
   *  through. `allowed` is false once the window's `points` are spent. */
  consumeRateLimit(
    bucket: string,
    points: number,
    windowMs: number,
    now: number,
  ): Promise<RateLimitDecision>;
  /** Drop every counter whose window closed at or before `now` (unix ms). */
  deleteExpiredRateLimits(now: number): Promise<void>;

  // Reasoning-provider circuits: durable and shared across processes.
  /** Allow normal calls while closed; after a cooldown, atomically lease one half-open probe so
   *  the web process and short-lived volume workers do not all retry the same unhealthy tier. */
  acquireReasoningCircuit(
    key: string,
    now: number,
    probeLeaseMs: number,
  ): Promise<ReasoningCircuitDecision>;
  /** Retain the failure streak across cooldowns and reopen with exponential backoff. */
  recordReasoningCircuitFailure(
    key: string,
    transient: boolean,
    now: number,
    failureThreshold: number,
    baseCooldownMs: number,
    maxCooldownMs: number,
  ): Promise<ReasoningCircuitRecord>;
  /** A real provider success is the only event that closes and forgets the circuit. */
  clearReasoningCircuit(key: string): Promise<void>;

  // ── query runs ──
  saveQueryRun(run: QueryRun): Promise<void>;
  getQueryRun(id: string): Promise<QueryRun | null>;
  listRecentQueries(limit: number): Promise<QueryRun[]>;
  /** Dispatches asked as follow-ups to `parentId`, oldest first. */
  listFollowUps(parentId: string): Promise<QueryRun[]>;
  /** Dispatches a wallet ran while signed in, newest first. Address match is case-insensitive:
   *  runs are stamped lowercased, but callers hand over whatever casing the session carries. */
  listQueryRunsByAsker(wallet: string, limit: number): Promise<QueryRun[]>;

  // ── auth helpers ──
  /** True when any source in the registry has this wallet address (case-insensitive). */
  isCreatorWallet(addr: string): Promise<boolean>;

  // ── users (account index; non-custodial identity, no funds) ──
  /** Create the account on first sign-in, else refresh role + last_seen. Returns
   *  the stored record and whether it was newly created (true on first sign-in). */
  upsertUser(addr: string, role: string): Promise<{ user: UserRecord; created: boolean }>;
  /** Fetch a user by wallet (case-insensitive). Null if the wallet never signed in. */
  getUser(addr: string): Promise<UserRecord | null>;

  // ── api keys (identity + rate-limit; no fund custody) ──
  /** Insert a new key row. Returns { rawKey (echoed once), prefix, id }.
   *  `scopes` is stored comma-separated; `sourceIds` null means "every source the wallet owns". */
  mintApiKey(
    wallet: string,
    prefix: string,
    keyHash: string,
    label?: string,
    scopes?: string,
    sourceIds?: string | null,
  ): Promise<{ rawKey: string; prefix: string; id: string }>;
  /** Prefix-lookup + timing-safe hash compare. Returns identity context or null.
   *  `scopes`/`sourceIds` come back raw (null on pre-scopes keys) — see lib/api-key-scopes.ts. */
  verifyApiKey(
    prefix: string,
    incomingHash: string,
  ): Promise<{
    walletAddress: string;
    keyId: string;
    scopes: string | null;
    sourceIds: string | null;
  } | null>;
  /** List all non-revoked (and revoked) keys for a wallet. */
  listApiKeys(wallet: string): Promise<ApiKeyRow[]>;
  /** Soft-delete: set revoked_at. No-op if key already revoked or not owned by wallet. */
  revokeApiKey(id: string, wallet: string): Promise<void>;
  /** Increment daily call counter for a key (fire-and-forget). */
  incrementUsage(keyId: string): Promise<void>;
  /** Return per-day call counts for a key over the last N days (default 30). */
  getUsage(keyId: string, days?: number): Promise<ApiKeyUsage[]>;

  // ── payments ──
  recordPayment(p: PaymentRecord): Promise<void>;
  listPayments(limit: number): Promise<PaymentRecord[]>;
  /** Real authorizations that crossed the submission boundary without a Circle receipt. */
  listPendingPayments(limit: number): Promise<PaymentRecord[]>;
  /**
   * Promote exactly one still-pending authorization after Circle's transfer API independently
   * confirms its nonce, payer, payee, amount, and network. Compare-and-set semantics make the
   * operation idempotent and prevent a late reconciler from overwriting newer state.
   */
  settlePendingPayment(
    id: string,
    authorizationId: string,
    circleTransferId: string,
  ): Promise<boolean>;
  /** Citation payouts for one dispatch, oldest→newest. Carries real settlement
   *  state (settled / tx) so permalinks reflect on-chain truth, not a reconstruction. */
  listPaymentsByQuery(queryId: string): Promise<PaymentRecord[]>;
  /** All earning payouts for one source (newest first), excluding inbound funding.
   *  Full-table — the creator page derives its totals from this so they match the
   *  all-time leaderboard instead of a capped recent-feed slice. */
  listPaymentsBySource(sourceId: string): Promise<PaymentRecord[]>;
  metrics(): Promise<DashboardMetrics>;
  /** Per payee wallet: settled USDC in, recorded cash-outs out. The settlement-parity watchdog
   *  reconciles these against what Circle's Gateway says it holds for the same address, so both
   *  sides must be all-time totals — a capped slice would read as a shortfall. Inbound platform
   *  fees are excluded: they are revenue, not a balance held for a creator. */
  settlementLedger(): Promise<LedgerAccount[]>;
  /** Settled USDC per UTC day over the last `days` days, zero-filled, oldest→today. Full-table
   *  aggregation — independent of the capped live feed, so older days aren't undercounted. */
  dailySettled(days: number): Promise<DailyVolume[]>;
  creatorLeaderboard(): Promise<CreatorEarnings[]>;

  // ── query memory (cross-query learning — agent remembers which sources work) ──
  /** Save a query memory entry after a successful run. */
  saveQueryMemory(entry: QueryMemoryEntry): Promise<void>;
  /** Load recent query memories (newest first). The agent uses these to learn source quality. */
  loadQueryMemories(limit: number): Promise<QueryMemoryEntry[]>;

  // ── answer feedback (thumbs up/down on completed dispatches) ──
  /** Record a thumbs-up or thumbs-down vote for a dispatch. Optional free-text comment. */
  recordFeedback(queryId: string, rating: "up" | "down", comment?: string): Promise<void>;
  /** Aggregate feedback counts. Pass queryId for per-dispatch stats; omit for global. */
  getFeedbackStats(queryId?: string): Promise<FeedbackStats>;

  // ── creator cash-outs (on-chain Gateway withdraws) ──
  /** Persist a settled withdraw. Keyed by EVM tx hash, so re-recording the same tx is a no-op. */
  recordWithdrawal(w: WithdrawalRecord): Promise<void>;
  /** Recent cash-outs, newest first — each carries a real /tx/-resolvable EVM hash. */
  listWithdrawals(limit: number): Promise<WithdrawalRecord[]>;
}
