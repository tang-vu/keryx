/**
 * KeryxDB — persistence interface shared by the SQLite (dev) and Supabase (prod) adapters.
 * All amounts are USDC numbers. Metrics are computed only from real rows.
 */

import type {
  DashboardMetrics,
  PaymentRecord,
  QueryRun,
  Source,
  SourceItem,
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
 *  without clobbering payment-critical chain data (H2 fix). */
export interface SourceMeta {
  name: string;
  description: string;
  url: string;
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

  // ── payments ──
  recordPayment(p: PaymentRecord): Promise<void>;
  listPayments(limit: number): Promise<PaymentRecord[]>;
  metrics(): Promise<DashboardMetrics>;
  creatorLeaderboard(): Promise<CreatorEarnings[]>;
}
