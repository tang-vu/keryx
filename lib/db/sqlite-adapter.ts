/**
 * SQLite adapter using Node's built-in `node:sqlite` (no native compile).
 * The offline-dev datastore; the deployed app uses the Supabase adapter instead.
 */

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type {
  DashboardMetrics,
  PaymentRecord,
  QueryRun,
  Source,
  SourceItem,
} from "../types";
import type { CreatorEarnings, KeryxDB } from "./keryx-db";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, name TEXT, url TEXT, description TEXT, rss_url TEXT,
  wallet_address TEXT, fetch_price REAL, tags TEXT, authors TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS source_items (
  id TEXT PRIMARY KEY, source_id TEXT, title TEXT, summary TEXT, content TEXT,
  link TEXT, published_at TEXT
);
CREATE TABLE IF NOT EXISTS cache_items (
  source_id TEXT PRIMARY KEY, text TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY, created_at TEXT, kind TEXT, query_id TEXT, source_id TEXT,
  source_name TEXT, payer TEXT, payee TEXT, amount_usdc REAL, weight REAL,
  rationale TEXT, tx_hash TEXT, network TEXT, settled INTEGER
);
CREATE TABLE IF NOT EXISTS query_runs (
  id TEXT PRIMARY KEY, created_at TEXT, question TEXT, budget REAL, engine TEXT,
  total_spent REAL, total_to_creators REAL, answer TEXT, data TEXT
);
`;

export class SqliteAdapter implements KeryxDB {
  private db: DatabaseSync;

  constructor(file?: string) {
    const dbPath = file ?? path.resolve(process.cwd(), "data", "keryx.sqlite");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
  }

  async init(): Promise<void> {
    // WAL + busy timeout so the dev server, volume engine, and CLI can share the file safely.
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA);
  }

  async upsertSource(s: Source): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO sources (id,name,url,description,rss_url,wallet_address,fetch_price,tags,authors,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,description=excluded.description,
           rss_url=excluded.rss_url,wallet_address=excluded.wallet_address,fetch_price=excluded.fetch_price,
           tags=excluded.tags,authors=excluded.authors`,
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
      );
  }

  async listSources(): Promise<Source[]> {
    const rows = this.db.prepare(`SELECT * FROM sources ORDER BY created_at`).all();
    return rows.map(rowToSource);
  }

  async getSource(id: string): Promise<Source | null> {
    const row = this.db.prepare(`SELECT * FROM sources WHERE id=?`).get(id);
    return row ? rowToSource(row) : null;
  }

  async addItems(items: SourceItem[]): Promise<void> {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO source_items (id,source_id,title,summary,content,link,published_at)
       VALUES (?,?,?,?,?,?,?)`,
    );
    for (const i of items)
      stmt.run(i.id, i.sourceId, i.title, i.summary, i.content, i.link, i.publishedAt ?? null);
  }

  async getItems(sourceId: string): Promise<SourceItem[]> {
    const rows = this.db
      .prepare(`SELECT * FROM source_items WHERE source_id=? ORDER BY published_at DESC`)
      .all(sourceId);
    return rows.map((r) => ({
      id: r.id as string,
      sourceId: r.source_id as string,
      title: r.title as string,
      summary: r.summary as string,
      content: r.content as string,
      link: r.link as string,
      publishedAt: (r.published_at as string) ?? undefined,
    }));
  }

  async getCached(sourceId: string): Promise<string | null> {
    const row = this.db.prepare(`SELECT text FROM cache_items WHERE source_id=?`).get(sourceId);
    return row ? (row.text as string) : null;
  }

  async setCached(sourceId: string, text: string): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO cache_items (source_id,text,updated_at) VALUES (?,?,?)`,
      )
      .run(sourceId, text, new Date().toISOString());
  }

  async saveQueryRun(run: QueryRun): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO query_runs (id,created_at,question,budget,engine,total_spent,total_to_creators,answer,data)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        run.id,
        run.createdAt,
        run.question,
        run.budget,
        run.engine,
        run.totalSpent,
        run.totalToCreators,
        run.answer,
        JSON.stringify(run),
      );
  }

  async getQueryRun(id: string): Promise<QueryRun | null> {
    const row = this.db.prepare(`SELECT data FROM query_runs WHERE id=?`).get(id);
    return row ? (JSON.parse(row.data as string) as QueryRun) : null;
  }

  async listRecentQueries(limit: number): Promise<QueryRun[]> {
    const rows = this.db
      .prepare(`SELECT data FROM query_runs ORDER BY created_at DESC LIMIT ?`)
      .all(limit);
    return rows.map((r) => JSON.parse(r.data as string) as QueryRun);
  }

  async recordPayment(p: PaymentRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO payment_events (id,created_at,kind,query_id,source_id,source_name,payer,payee,amount_usdc,weight,rationale,tx_hash,network,settled)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
      );
  }

  async listPayments(limit: number): Promise<PaymentRecord[]> {
    const rows = this.db
      .prepare(`SELECT * FROM payment_events ORDER BY created_at DESC LIMIT ?`)
      .all(limit);
    return rows.map(rowToPayment);
  }

  async metrics(): Promise<DashboardMetrics> {
    const p = this.db
      .prepare(
        `SELECT COUNT(*) c, COALESCE(SUM(amount_usdc),0) v, COALESCE(AVG(amount_usdc),0) a FROM payment_events`,
      )
      .get() as { c: number; v: number; a: number };
    const creators = this.db
      .prepare(`SELECT COUNT(DISTINCT source_id) n FROM payment_events`)
      .get() as { n: number };
    const q = this.db.prepare(`SELECT COUNT(*) n FROM query_runs`).get() as { n: number };
    const paying = this.db
      .prepare(`SELECT COUNT(DISTINCT query_id) n FROM payment_events`)
      .get() as { n: number };
    return {
      totalPayments: p.c,
      totalVolumeUsdc: round(p.v),
      totalCreatorPayoutsUsdc: round(p.v),
      creatorsEarning: creators.n,
      avgPaymentUsdc: round(p.a),
      totalQueries: q.n,
      payingQueries: paying.n,
      readerToPayerConversion: q.n ? round(paying.n / q.n) : 0,
    };
  }

  async creatorLeaderboard(): Promise<CreatorEarnings[]> {
    const rows = this.db
      .prepare(
        `SELECT source_id, source_name, payee,
                COALESCE(SUM(amount_usdc),0) total, COUNT(*) cnt,
                SUM(CASE WHEN kind='citation' THEN 1 ELSE 0 END) cites
         FROM payment_events GROUP BY source_id ORDER BY total DESC`,
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

function rowToSource(r: Record<string, unknown>): Source {
  return {
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
    amountUsdc: r.amount_usdc as number,
    weight: (r.weight as number) ?? undefined,
    rationale: (r.rationale as string) ?? undefined,
    txHash: (r.tx_hash as string) ?? null,
    network: r.network as string,
    settled: Boolean(r.settled),
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
