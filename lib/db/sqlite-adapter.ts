/**
 * SQLite adapter using Node's built-in `node:sqlite` (no native compile).
 * The offline-dev datastore; the deployed app uses the Supabase adapter instead.
 */

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  DashboardMetrics,
  PaymentRecord,
  QueryRun,
  Source,
  SourceItem,
} from "../types";
import type { ApiKeyRow, ApiKeyUsage, CreatorEarnings, KeryxDB, UserRecord } from "./keryx-db";
import { shortAddress } from "../utils";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, name TEXT, url TEXT, description TEXT, rss_url TEXT,
  wallet_address TEXT, fetch_price REAL, tags TEXT, authors TEXT, created_at TEXT,
  ipfs_cid TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  onchain_id TEXT,
  register_tx TEXT
);
CREATE TABLE IF NOT EXISTS source_meta (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS source_items (
  id TEXT PRIMARY KEY, source_id TEXT, title TEXT, summary TEXT, content TEXT,
  link TEXT, published_at TEXT,
  ipfs_cid TEXT, item_key_enc TEXT, item_iv TEXT, item_auth_tag TEXT
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
CREATE TABLE IF NOT EXISTS api_keys (
  id          TEXT PRIMARY KEY,
  prefix      TEXT NOT NULL UNIQUE,
  key_hash    TEXT NOT NULL,
  wallet      TEXT NOT NULL,
  label       TEXT,
  created_at  TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at  TEXT
);
CREATE INDEX IF NOT EXISTS api_keys_prefix ON api_keys(prefix);
CREATE INDEX IF NOT EXISTS api_keys_wallet ON api_keys(wallet);
CREATE TABLE IF NOT EXISTS api_key_usage (
  key_id     TEXT NOT NULL,
  day        TEXT NOT NULL,
  call_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, day)
);
CREATE TABLE IF NOT EXISTS users (
  wallet_address TEXT PRIMARY KEY,   -- lowercased; identity = wallet
  role           TEXT NOT NULL,      -- role snapshot at last sign-in (display only)
  display_handle TEXT NOT NULL,      -- compact "0x….." handle
  first_seen_at  TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL
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
    this.ensureColumns();
  }

  /**
   * Add columns introduced after a database was first created. `CREATE TABLE IF NOT EXISTS`
   * never alters an existing table, so databases that predate the `ipfs_cid` / `active`
   * columns (the local dev DB and the live VPS DB carrying real traction) would otherwise
   * throw "no such column" on listSources/upsert. These ALTERs are idempotent — guarded by
   * the current column set so a fresh DB (where SCHEMA already created them) is untouched.
   */
  private ensureColumns(): void {
    // sources table backfill
    const srcCols = new Set(
      (this.db.prepare(`PRAGMA table_info(sources)`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    if (!srcCols.has("ipfs_cid")) this.db.exec(`ALTER TABLE sources ADD COLUMN ipfs_cid TEXT`);
    if (!srcCols.has("active"))
      this.db.exec(`ALTER TABLE sources ADD COLUMN active INTEGER NOT NULL DEFAULT 1`);
    // On-chain provenance columns: filled when a curated source is registered on SourceRegistry.
    if (!srcCols.has("onchain_id")) this.db.exec(`ALTER TABLE sources ADD COLUMN onchain_id TEXT`);
    if (!srcCols.has("register_tx")) this.db.exec(`ALTER TABLE sources ADD COLUMN register_tx TEXT`);

    // source_items table: encrypted-content columns added in Phase 04.
    // Existing rows have NULL for these; produce() falls back to DB plaintext content.
    const itemCols = new Set(
      (this.db.prepare(`PRAGMA table_info(source_items)`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    if (!itemCols.has("ipfs_cid")) this.db.exec(`ALTER TABLE source_items ADD COLUMN ipfs_cid TEXT`);
    if (!itemCols.has("item_key_enc")) this.db.exec(`ALTER TABLE source_items ADD COLUMN item_key_enc TEXT`);
    if (!itemCols.has("item_iv")) this.db.exec(`ALTER TABLE source_items ADD COLUMN item_iv TEXT`);
    if (!itemCols.has("item_auth_tag")) this.db.exec(`ALTER TABLE source_items ADD COLUMN item_auth_tag TEXT`);

    // payment_events.origin: tags each payment as engine | web | a2a so the dashboard can separate
    // genuine external usage from autonomous engine volume. Pre-existing rows (all engine-generated
    // to date) get NULL, which metrics() treats as engine — backfill them explicitly so the data is
    // unambiguous and the column never overstates external usage.
    const payCols = new Set(
      (this.db.prepare(`PRAGMA table_info(payment_events)`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    if (!payCols.has("origin")) {
      this.db.exec(`ALTER TABLE payment_events ADD COLUMN origin TEXT`);
      this.db.exec(`UPDATE payment_events SET origin='engine' WHERE origin IS NULL`);
    }
  }

  async upsertSource(s: Source): Promise<void> {
    // active defaults to 1 (true) for offline/DB-direct rows that predate the flag.
    const activeInt = s.active === false ? 0 : 1;
    this.db
      .prepare(
        `INSERT INTO sources (id,name,url,description,rss_url,wallet_address,fetch_price,tags,authors,created_at,ipfs_cid,active,onchain_id,register_tx)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,description=excluded.description,
           rss_url=excluded.rss_url,wallet_address=excluded.wallet_address,fetch_price=excluded.fetch_price,
           tags=excluded.tags,authors=excluded.authors,ipfs_cid=excluded.ipfs_cid,active=excluded.active,
           onchain_id=COALESCE(excluded.onchain_id,sources.onchain_id),
           register_tx=COALESCE(excluded.register_tx,sources.register_tx)`,
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
      );
  }

  async listSources(): Promise<Source[]> {
    // Filter to active=1 only — deactivated on-chain sources must not be discovered/cited (H1 fix).
    const rows = this.db.prepare(`SELECT * FROM sources WHERE active = 1 ORDER BY created_at`).all();
    return rows.map(rowToSource);
  }

  async setSourceMeta(id: string, meta: import("./keryx-db").SourceMeta): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO source_meta (id,name,description,url,updated_at) VALUES (?,?,?,?,?)`,
      )
      .run(id, meta.name, meta.description, meta.url, new Date().toISOString());
  }

  async getSourceMeta(id: string): Promise<import("./keryx-db").SourceMeta | null> {
    const row = this.db.prepare(`SELECT name,description,url FROM source_meta WHERE id=?`).get(id);
    if (!row) return null;
    return {
      name: (row.name as string) ?? "",
      description: (row.description as string) ?? "",
      url: (row.url as string) ?? "",
    };
  }

  async getSource(id: string): Promise<Source | null> {
    const row = this.db.prepare(`SELECT * FROM sources WHERE id=?`).get(id);
    return row ? rowToSource(row) : null;
  }

  async addItems(items: SourceItem[]): Promise<void> {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO source_items
         (id,source_id,title,summary,content,link,published_at,ipfs_cid,item_key_enc,item_iv,item_auth_tag)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const i of items)
      stmt.run(
        i.id, i.sourceId, i.title, i.summary, i.content, i.link, i.publishedAt ?? null,
        i.ipfsCid ?? null, i.itemKeyEnc ?? null, i.itemIv ?? null, i.itemAuthTag ?? null,
      );
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
      ipfsCid: (r.ipfs_cid as string) ?? undefined,
      itemKeyEnc: (r.item_key_enc as string) ?? undefined,
      itemIv: (r.item_iv as string) ?? undefined,
      itemAuthTag: (r.item_auth_tag as string) ?? undefined,
    }));
  }

  async isCreatorWallet(addr: string): Promise<boolean> {
    // Case-insensitive match via LOWER() — wallet addresses from SIWE are checksummed
    // but stored addresses in older rows may vary in case.
    const row = this.db
      .prepare(`SELECT 1 FROM sources WHERE LOWER(wallet_address) = LOWER(?) LIMIT 1`)
      .get(addr);
    return row !== undefined;
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

  async getSyncState(key: string): Promise<string | null> {
    const row = this.db.prepare(`SELECT value FROM sync_state WHERE key=?`).get(key);
    return row ? (row.value as string) : null;
  }

  async setSyncState(key: string, value: string): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sync_state (key,value,updated_at) VALUES (?,?,?)`,
      )
      .run(key, value, new Date().toISOString());
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
        `INSERT INTO payment_events (id,created_at,kind,query_id,source_id,source_name,payer,payee,amount_usdc,weight,rationale,tx_hash,network,settled,origin)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
        p.origin ?? "engine",
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
    // Creator payouts exclude inbound A2A fees (those are revenue to the platform, not creators).
    const cp = this.db
      .prepare(
        `SELECT COALESCE(SUM(amount_usdc),0) v, COUNT(DISTINCT source_id) n FROM payment_events WHERE kind != 'inbound'`,
      )
      .get() as { v: number; n: number };
    const q = this.db.prepare(`SELECT COUNT(*) n FROM query_runs`).get() as { n: number };
    const paying = this.db
      .prepare(`SELECT COUNT(DISTINCT query_id) n FROM payment_events WHERE kind != 'inbound'`)
      .get() as { n: number };
    // External usage = web askers + A2A callers. NULL origin (legacy rows) counts as engine, so
    // the external figures never overstate real outside traffic.
    const ext = this.db
      .prepare(
        `SELECT COUNT(*) c, COALESCE(SUM(amount_usdc),0) v FROM payment_events WHERE origin IN ('web','a2a')`,
      )
      .get() as { c: number; v: number };
    return {
      totalPayments: p.c,
      totalVolumeUsdc: round(p.v),
      totalCreatorPayoutsUsdc: round(cp.v),
      creatorsEarning: cp.n,
      avgPaymentUsdc: round(p.a),
      totalQueries: q.n,
      payingQueries: paying.n,
      readerToPayerConversion: q.n ? round(paying.n / q.n) : 0,
      externalPayments: ext.c,
      externalVolumeUsdc: round(ext.v),
      enginePayments: p.c - ext.c,
      engineVolumeUsdc: round(p.v - ext.v),
    };
  }

  // ── api keys ──

  async mintApiKey(
    wallet: string,
    prefix: string,
    keyHash: string,
    label?: string,
  ): Promise<{ rawKey: string; prefix: string; id: string }> {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO api_keys (id,prefix,key_hash,wallet,label,created_at) VALUES (?,?,?,?,?,?)`,
      )
      .run(id, prefix, keyHash, wallet, label ?? null, new Date().toISOString());
    // rawKey is NOT stored; caller reconstructs it from the prefix + suffix they generated.
    // We echo prefix so the caller can display it; rawKey is assembled by the route handler.
    return { rawKey: "", prefix, id };
  }

  async verifyApiKey(
    prefix: string,
    incomingHash: string,
  ): Promise<{ walletAddress: string; keyId: string } | null> {
    const row = this.db
      .prepare(`SELECT id,key_hash,wallet FROM api_keys WHERE prefix=? AND revoked_at IS NULL`)
      .get(prefix) as { id: string; key_hash: string; wallet: string } | undefined;
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

    return { walletAddress: row.wallet, keyId: row.id };
  }

  async listApiKeys(wallet: string): Promise<ApiKeyRow[]> {
    const rows = this.db
      .prepare(`SELECT id,prefix,wallet,label,created_at,last_used_at,revoked_at FROM api_keys WHERE wallet=? ORDER BY created_at DESC`)
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

  async creatorLeaderboard(): Promise<CreatorEarnings[]> {
    const rows = this.db
      .prepare(
        `SELECT source_id, source_name, payee,
                COALESCE(SUM(amount_usdc),0) total, COUNT(*) cnt,
                SUM(CASE WHEN kind='citation' THEN 1 ELSE 0 END) cites
         FROM payment_events WHERE kind != 'inbound' GROUP BY source_id ORDER BY total DESC`,
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
  };
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
    ipfsCid: (r.ipfs_cid as string) ?? undefined,
    // active=null means old row before the column existed — treat as active.
    active: r.active === undefined || r.active === null ? true : Boolean(r.active),
    onchainId: (r.onchain_id as string) ?? undefined,
    registerTx: (r.register_tx as string) ?? undefined,
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
    origin: (r.origin as PaymentRecord["origin"]) ?? undefined,
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
