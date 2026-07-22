/**
 * KeryxDB — persistence interface shared by the SQLite (dev) and Supabase (prod) adapters.
 * All amounts are USDC numbers. Metrics are computed only from real rows.
 */

import type {
  DailyVolume,
  DashboardMetrics,
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

/** A single query memory: which sources were cited and how well for a past query. */
export interface QueryMemoryEntry {
  id: string;
  /** Per-source citation data from a past run */
  sourceScores: Record<string, { name: string; weight: number; reward: number }>;
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
  setCached(sourceId: string, text: string): Promise<void>;

  // ── sync state (registry indexer checkpoint) ──
  /** Get a named sync-state value (e.g. "lastSyncedBlock"). Returns null if not set. */
  getSyncState(key: string): Promise<string | null>;
  /** Upsert a named sync-state value. */
  setSyncState(key: string, value: string): Promise<void>;

  // ── browser co-sign session grants (no keys, only caps + accounting) ──
  /** Create or replace the grant for a session id. Resets `spent` — callers re-register with a
   *  cap read from the live Gateway balance, which already nets out earlier spends. */
  upsertSessionGrant(grant: Omit<SessionGrantRecord, "spent">): Promise<void>;
  /** Fetch a grant. Returns null when absent; expiry is the caller's to interpret. */
  getSessionGrant(sessionId: string): Promise<SessionGrantRecord | null>;
  /** Atomically add to `spent`. False when no grant row exists to charge. */
  addSessionGrantSpend(sessionId: string, amount: number): Promise<boolean>;
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

  // ── query runs ──
  saveQueryRun(run: QueryRun): Promise<void>;
  getQueryRun(id: string): Promise<QueryRun | null>;
  listRecentQueries(limit: number): Promise<QueryRun[]>;
  /** Dispatches asked as follow-ups to `parentId`, oldest first. */
  listFollowUps(parentId: string): Promise<QueryRun[]>;

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
  /** Citation payouts for one dispatch, oldest→newest. Carries real settlement
   *  state (settled / tx) so permalinks reflect on-chain truth, not a reconstruction. */
  listPaymentsByQuery(queryId: string): Promise<PaymentRecord[]>;
  /** All earning payouts for one source (newest first), excluding inbound funding.
   *  Full-table — the creator page derives its totals from this so they match the
   *  all-time leaderboard instead of a capped recent-feed slice. */
  listPaymentsBySource(sourceId: string): Promise<PaymentRecord[]>;
  metrics(): Promise<DashboardMetrics>;
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
