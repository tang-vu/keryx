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

export interface KeryxDB {
  init(): Promise<void>;

  // ── sources & content ──
  upsertSource(source: Source): Promise<void>;
  listSources(): Promise<Source[]>;
  getSource(id: string): Promise<Source | null>;
  addItems(items: SourceItem[]): Promise<void>;
  getItems(sourceId: string): Promise<SourceItem[]>;

  // ── cache (skip-repay decisions) ──
  getCached(sourceId: string): Promise<string | null>;
  setCached(sourceId: string, text: string): Promise<void>;

  // ── query runs ──
  saveQueryRun(run: QueryRun): Promise<void>;
  getQueryRun(id: string): Promise<QueryRun | null>;
  listRecentQueries(limit: number): Promise<QueryRun[]>;

  // ── payments ──
  recordPayment(p: PaymentRecord): Promise<void>;
  listPayments(limit: number): Promise<PaymentRecord[]>;
  metrics(): Promise<DashboardMetrics>;
  creatorLeaderboard(): Promise<CreatorEarnings[]>;
}
