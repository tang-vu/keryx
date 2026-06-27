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
}

/** Daily usage aggregate for a single key. */
export interface ApiKeyUsage {
  day: string;   // ISO date "YYYY-MM-DD"
  count: number;
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
  getSource(id: string): Promise<Source | null>;
  /** Store off-chain human-readable metadata keyed by source id.
   *  Called by POST /api/sources at register time so the indexer can merge
   *  name/description/url into the on-chain cache row. */
  setSourceMeta(id: string, meta: SourceMeta): Promise<void>;
  /** Retrieve off-chain metadata for a source. Returns null if not set. */
  getSourceMeta(id: string): Promise<SourceMeta | null>;
  addItems(items: SourceItem[]): Promise<void>;
  getItems(sourceId: string): Promise<SourceItem[]>;

  // ── cache (skip-repay decisions) ──
  getCached(sourceId: string): Promise<string | null>;
  setCached(sourceId: string, text: string): Promise<void>;

  // ── sync state (registry indexer checkpoint) ──
  /** Get a named sync-state value (e.g. "lastSyncedBlock"). Returns null if not set. */
  getSyncState(key: string): Promise<string | null>;
  /** Upsert a named sync-state value. */
  setSyncState(key: string, value: string): Promise<void>;

  // ── query runs ──
  saveQueryRun(run: QueryRun): Promise<void>;
  getQueryRun(id: string): Promise<QueryRun | null>;
  listRecentQueries(limit: number): Promise<QueryRun[]>;

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
  /** Insert a new key row. Returns { rawKey (echoed once), prefix, id }. */
  mintApiKey(
    wallet: string,
    prefix: string,
    keyHash: string,
    label?: string,
  ): Promise<{ rawKey: string; prefix: string; id: string }>;
  /** Prefix-lookup + timing-safe hash compare. Returns identity context or null. */
  verifyApiKey(
    prefix: string,
    incomingHash: string,
  ): Promise<{ walletAddress: string; keyId: string } | null>;
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
