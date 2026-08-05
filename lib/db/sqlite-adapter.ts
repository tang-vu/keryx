/**
 * SQLite adapter using Node's built-in `node:sqlite` (no native compile).
 * The offline-dev datastore; the deployed app uses the Supabase adapter instead.
 */

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
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

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, name TEXT, url TEXT, description TEXT, rss_url TEXT,
  wallet_address TEXT, fetch_price REAL, tags TEXT, authors TEXT, created_at TEXT,
  ipfs_cid TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  onchain_id TEXT,
  register_tx TEXT,
  verified INTEGER NOT NULL DEFAULT 1,
  preview_depth TEXT
);
CREATE TABLE IF NOT EXISTS source_meta (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  rss_url TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS source_notify (
  source_id  TEXT PRIMARY KEY,
  notify_url TEXT NOT NULL,
  secret     TEXT NOT NULL,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS source_notify_email (
  source_id    TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  unsub_token  TEXT NOT NULL,
  last_sent_at TEXT,
  updated_at   TEXT
);
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS source_items (
  id TEXT PRIMARY KEY, source_id TEXT, title TEXT, summary TEXT, content TEXT,
  link TEXT, published_at TEXT,
  ipfs_cid TEXT, item_key_enc TEXT, item_iv TEXT, item_auth_tag TEXT
);
-- Every read of this table is "one source, newest first" — discovery, the freshness counts, and the
-- ingest dedupe pass. Safe to declare beside the table: both columns are original, so this is not a
-- no-op-plus-failure on a database that predates a later ALTER (cf. query_runs).
CREATE INDEX IF NOT EXISTS source_items_source_published ON source_items(source_id, published_at);
CREATE TABLE IF NOT EXISTS gap_intents (
  id TEXT PRIMARY KEY,
  gap_id TEXT NOT NULL,
  claim TEXT NOT NULL,
  question TEXT NOT NULL,
  failed_query_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_item_link TEXT NOT NULL DEFAULT '',
  owner_wallet TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_expires_at INTEGER,
  retry_run_id TEXT,
  coverage REAL,
  reward_usdc REAL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS gap_intents_offer
  ON gap_intents(gap_id, source_id, source_item_link);
CREATE INDEX IF NOT EXISTS gap_intents_queue
  ON gap_intents(status, created_at);
CREATE TABLE IF NOT EXISTS cache_items (
  source_id TEXT PRIMARY KEY, text TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY, created_at TEXT, kind TEXT, query_id TEXT, source_id TEXT,
  source_name TEXT, payer TEXT, payee TEXT, amount_usdc REAL, weight REAL,
  rationale TEXT, tx_hash TEXT, network TEXT, settled INTEGER,
  settlement_status TEXT NOT NULL DEFAULT 'simulated', authorization_id TEXT,
  item_id TEXT, item_title TEXT, item_url TEXT, content_version TEXT, item_published_at TEXT
);
CREATE TABLE IF NOT EXISTS query_runs (
  id TEXT PRIMARY KEY, created_at TEXT, question TEXT, budget REAL, engine TEXT,
  total_spent REAL, total_to_creators REAL, answer TEXT, data TEXT,
  parent_id TEXT,                       -- the dispatch this one follows up on
  asker TEXT,                           -- lowercased wallet that dispatched it (SIWE-verified)
  origin TEXT,                          -- engine | web | a2a | mcp
  mcp_client TEXT,                      -- self-declared setup channel; telemetry only
  duration_ms INTEGER,
  payment_mode TEXT,
  payment_attempts INTEGER,
  settled_payments INTEGER,
  confidence_level TEXT,
  evidence_claim_count INTEGER,
  grounded_claim_count INTEGER,
  rewarded_citation_count INTEGER
);
-- No index on parent_id here: CREATE TABLE IF NOT EXISTS is a no-op against a database that
-- predates the column, so an index naming it would fail at boot on exactly the databases that
-- carry the real traction. ensureColumns() adds the column first, then the index.
CREATE TABLE IF NOT EXISTS withdrawals (
  tx_hash TEXT PRIMARY KEY, created_at TEXT, label TEXT, source_name TEXT,
  wallet TEXT, recipient TEXT, amount_usdc REAL, network TEXT
);
CREATE TABLE IF NOT EXISTS api_keys (
  id          TEXT PRIMARY KEY,
  prefix      TEXT NOT NULL UNIQUE,
  key_hash    TEXT NOT NULL,
  wallet      TEXT NOT NULL,
  label       TEXT,
  created_at  TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at  TEXT,
  scopes      TEXT,
  source_ids  TEXT
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
CREATE TABLE IF NOT EXISTS answer_feedback (
  id         TEXT PRIMARY KEY,
  query_id   TEXT NOT NULL,
  rating     TEXT NOT NULL,          -- 'up' or 'down'
  comment    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS answer_feedback_query ON answer_feedback(query_id);
CREATE TABLE IF NOT EXISTS query_memories (
  id            TEXT PRIMARY KEY,
  source_scores TEXT NOT NULL,          -- JSON: { sourceId: { name, weight, reward } } — cited only
  sources_read  TEXT,                   -- JSON: string[] — every source the run read, cited or not
  topics        TEXT NOT NULL,          -- JSON: string[]
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session_grants (
  session_id TEXT PRIMARY KEY,          -- lowercased SIWE address; one active grant per wallet
  sess_addr  TEXT NOT NULL,             -- session EOA (public address only — never its key)
  owner_addr TEXT NOT NULL,
  cap        REAL NOT NULL,             -- USDC ceiling, clamped to the real Gateway balance
  spent      REAL NOT NULL DEFAULT 0,
  expiry     INTEGER NOT NULL,          -- unix ms
  tx_hash    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS session_grants_expiry ON session_grants(expiry);
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  bucket   TEXT PRIMARY KEY,           -- "<tier>:<key>", e.g. "treasuryAsk:1.2.3.4"
  count    INTEGER NOT NULL,           -- points spent in the current window
  reset_at INTEGER NOT NULL            -- unix ms the window closes
);
CREATE INDEX IF NOT EXISTS rate_limit_counters_reset ON rate_limit_counters(reset_at);
CREATE TABLE IF NOT EXISTS reasoning_circuits (
  key         TEXT PRIMARY KEY,
  failures    INTEGER NOT NULL,
  open_until  INTEGER NOT NULL,
  probe_until INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
`;

export class SqliteAdapter implements KeryxDB {
  private db: DatabaseSync;

  constructor(file?: string) {
    const dbPath = file ?? path.resolve(process.cwd(), "data", "keryx.sqlite");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
  }

  /** Release the file handle. The long-lived server never calls this; short-lived callers
   *  (tests, one-shot scripts) do, so the OS is not left holding the DB open. */
  close(): void {
    this.db.close();
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
    // Feed-ownership gate. DEFAULT 1 grandfathers every pre-existing row (operator-curated seed +
    // the live VPS traction rows) as verified so the volume engine keeps earning. Only public web
    // submissions registered after this column exists start unverified (set explicitly to 0).
    if (!srcCols.has("verified"))
      this.db.exec(`ALTER TABLE sources ADD COLUMN verified INTEGER NOT NULL DEFAULT 1`);
    // Preview depth: NULL grandfathers every existing row as "full" (rowToSource maps it).
    if (!srcCols.has("preview_depth")) this.db.exec(`ALTER TABLE sources ADD COLUMN preview_depth TEXT`);

    // source_meta.rss_url: the feed an on-chain registrant listed. The indexer has nowhere else to
    // learn it, and /api/sources/verify needs it to check the right document for the ownership token.
    const metaCols = new Set(
      (this.db.prepare(`PRAGMA table_info(source_meta)`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    if (!metaCols.has("rss_url")) this.db.exec(`ALTER TABLE source_meta ADD COLUMN rss_url TEXT`);

    // Explicit payment state: historical settled rows had Circle evidence; historical false rows
    // were offline simulations. New browser co-sign ambiguity is always written as `pending`.
    const paymentCols = new Set(
      (this.db.prepare(`PRAGMA table_info(payment_events)`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    if (!paymentCols.has("origin")) {
      this.db.exec(`ALTER TABLE payment_events ADD COLUMN origin TEXT`);
      this.db.exec(`UPDATE payment_events SET origin='engine' WHERE origin IS NULL`);
    }
    if (!paymentCols.has("settlement_status")) {
      this.db.exec(
        `ALTER TABLE payment_events ADD COLUMN settlement_status TEXT NOT NULL DEFAULT 'simulated'`,
      );
      this.db.exec(
        `UPDATE payment_events SET settlement_status=CASE WHEN settled=1 THEN 'settled' ELSE 'simulated' END`,
      );
    }
    if (!paymentCols.has("authorization_id")) {
      this.db.exec(`ALTER TABLE payment_events ADD COLUMN authorization_id TEXT`);
    }
    for (const column of [
      "item_id",
      "item_title",
      "item_url",
      "content_version",
      "item_published_at",
    ]) {
      if (!paymentCols.has(column)) {
        this.db.exec(`ALTER TABLE payment_events ADD COLUMN ${column} TEXT`);
      }
    }
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS payment_events_pending
         ON payment_events(created_at DESC) WHERE settlement_status='pending'`,
    );

    // api_keys scope columns. NULL on every pre-existing key and read as "all scopes, all owned
    // sources" — narrowing a key that already works in someone's integration would break it.
    const keyCols = new Set(
      (this.db.prepare(`PRAGMA table_info(api_keys)`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    if (!keyCols.has("scopes")) this.db.exec(`ALTER TABLE api_keys ADD COLUMN scopes TEXT`);
    if (!keyCols.has("source_ids")) this.db.exec(`ALTER TABLE api_keys ADD COLUMN source_ids TEXT`);

    // query_runs.parent_id: NULL on every existing dispatch, which is correct — they were all
    // asked standalone. Indexed so a permalink can list its follow-ups without scanning the log.
    const runCols = new Set(
      (this.db.prepare(`PRAGMA table_info(query_runs)`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    if (!runCols.has("parent_id")) this.db.exec(`ALTER TABLE query_runs ADD COLUMN parent_id TEXT`);
    // query_runs.asker: NULL on every dispatch that predates attribution, and on every anonymous,
    // engine, or A2A run — none of those has a signed-in wallet, so they belong to no one's ledger.
    if (!runCols.has("asker")) this.db.exec(`ALTER TABLE query_runs ADD COLUMN asker TEXT`);
    if (!runCols.has("origin")) {
      this.db.exec(`ALTER TABLE query_runs ADD COLUMN origin TEXT`);
      const hasPaymentOrigin = (
        this.db.prepare(`PRAGMA table_info(payment_events)`).all() as { name: string }[]
      ).some((c) => c.name === "origin");
      if (!hasPaymentOrigin) {
        this.db.exec(`ALTER TABLE payment_events ADD COLUMN origin TEXT`);
        this.db.exec(`UPDATE payment_events SET origin='engine' WHERE origin IS NULL`);
      }
      // Historical external rows can be proven from their payment ledger. A zero-payment legacy
      // run has no trustworthy provenance and therefore remains internal.
      this.db.exec(`
        UPDATE query_runs
           SET origin = CASE
             WHEN EXISTS (
               SELECT 1 FROM payment_events p
                WHERE p.query_id=query_runs.id AND p.origin='a2a'
             ) THEN 'a2a'
             WHEN EXISTS (
               SELECT 1 FROM payment_events p
                WHERE p.query_id=query_runs.id AND p.origin='web'
             ) THEN 'web'
             ELSE 'engine'
           END
         WHERE origin IS NULL
      `);
    }
    if (!runCols.has("duration_ms"))
      this.db.exec(`ALTER TABLE query_runs ADD COLUMN duration_ms INTEGER`);
    if (!runCols.has("payment_mode"))
      this.db.exec(`ALTER TABLE query_runs ADD COLUMN payment_mode TEXT`);
    if (!runCols.has("payment_attempts"))
      this.db.exec(`ALTER TABLE query_runs ADD COLUMN payment_attempts INTEGER`);
    if (!runCols.has("settled_payments"))
      this.db.exec(`ALTER TABLE query_runs ADD COLUMN settled_payments INTEGER`);
    if (!runCols.has("confidence_level"))
      this.db.exec(`ALTER TABLE query_runs ADD COLUMN confidence_level TEXT`);
    if (!runCols.has("mcp_client"))
      this.db.exec(`ALTER TABLE query_runs ADD COLUMN mcp_client TEXT`);
    if (!runCols.has("evidence_claim_count"))
      this.db.exec(`ALTER TABLE query_runs ADD COLUMN evidence_claim_count INTEGER`);
    if (!runCols.has("grounded_claim_count"))
      this.db.exec(`ALTER TABLE query_runs ADD COLUMN grounded_claim_count INTEGER`);
    if (!runCols.has("rewarded_citation_count"))
      this.db.exec(`ALTER TABLE query_runs ADD COLUMN rewarded_citation_count INTEGER`);
    // Unconditional: the columns are guaranteed present by the lines above (or by the CREATE TABLE
    // on a fresh database), and both paths need the indexes.
    this.db.exec(`CREATE INDEX IF NOT EXISTS query_runs_parent ON query_runs(parent_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS query_runs_asker ON query_runs(asker, created_at)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS query_runs_origin ON query_runs(origin, created_at)`);
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS query_runs_mcp_client ON query_runs(mcp_client, created_at)`,
    );

    // query_memories.sources_read: NULL on every entry written before the agent recorded what it
    // read. Those entries can prove a citation happened but never that a source was read and passed
    // over, so scoring skips them rather than reading a missing list as an empty one.
    const memCols = new Set(
      (this.db.prepare(`PRAGMA table_info(query_memories)`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    if (!memCols.has("sources_read")) {
      this.db.exec(`ALTER TABLE query_memories ADD COLUMN sources_read TEXT`);
    }

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

  }

  async upsertSource(s: Source): Promise<void> {
    // active/verified default to 1 (true) for offline/DB-direct rows that predate the flags.
    const activeInt = s.active === false ? 0 : 1;
    const verifiedInt = s.verified === false ? 0 : 1;
    this.db
      .prepare(
        `INSERT INTO sources (id,name,url,description,rss_url,wallet_address,fetch_price,tags,authors,created_at,ipfs_cid,active,onchain_id,register_tx,verified,preview_depth)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,description=excluded.description,
           rss_url=excluded.rss_url,wallet_address=excluded.wallet_address,fetch_price=excluded.fetch_price,
           tags=excluded.tags,authors=excluded.authors,ipfs_cid=excluded.ipfs_cid,active=excluded.active,
           onchain_id=COALESCE(excluded.onchain_id,sources.onchain_id),
           register_tx=COALESCE(excluded.register_tx,sources.register_tx),
           verified=excluded.verified,
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
      );
  }

  async setSourcePreviewDepth(id: string, depth: string): Promise<void> {
    this.db.prepare(`UPDATE sources SET preview_depth=? WHERE id=?`).run(depth, id);
  }

  async listSources(): Promise<Source[]> {
    // Filter to active=1 only — deactivated on-chain sources must not be discovered/cited.
    const rows = this.db.prepare(`SELECT * FROM sources WHERE active = 1 ORDER BY created_at`).all();
    return rows.map(rowToSource);
  }

  async listAllSources(): Promise<Source[]> {
    // Deactivated rows included — owner history only, never discovery. See the interface note.
    const rows = this.db.prepare(`SELECT * FROM sources ORDER BY created_at`).all();
    return rows.map(rowToSource);
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
    return row ? rowToSource(row) : null;
  }

  async getSourceByOnchainId(onchainId: string): Promise<Source | null> {
    const row = this.db
      .prepare(`SELECT * FROM sources WHERE lower(onchain_id) = lower(?) LIMIT 1`)
      .get(onchainId);
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

  async getItem(sourceId: string, itemId: string): Promise<SourceItem | null> {
    const row = this.db
      .prepare(`SELECT * FROM source_items WHERE source_id=? AND id=? LIMIT 1`)
      .get(sourceId, itemId);
    return row ? rowToSourceItem(row) : null;
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

  async getCachedAt(sourceId: string): Promise<string | null> {
    const row = this.db
      .prepare(`SELECT updated_at FROM cache_items WHERE source_id=?`)
      .get(sourceId);
    return row ? ((row.updated_at as string) ?? null) : null;
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

  // ── session grants ──

  async upsertSessionGrant(grant: Omit<SessionGrantRecord, "spent">): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO session_grants
           (session_id, sess_addr, owner_addr, cap, spent, expiry, tx_hash)
         VALUES (?,?,?,?,0,?,?)`,
      )
      .run(
        grant.sessionId,
        grant.sessAddr,
        grant.ownerAddr,
        grant.cap,
        grant.expiry,
        grant.txHash,
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
    };
  }

  /** Reserve atomically, including the cap predicate, so concurrent asks cannot both pass. */
  async addSessionGrantSpend(sessionId: string, amount: number): Promise<boolean> {
    const res = this.db
      .prepare(
        `UPDATE session_grants
            SET spent = ROUND(spent + ?, 6)
          WHERE session_id = ?
            AND ROUND(spent + ?, 6) <= cap
            AND expiry > ?`,
      )
      .run(amount, sessionId, amount, Date.now());
    return Number(res.changes) > 0;
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
             owner_wallet,status,attempts,created_at,updated_at
           ) VALUES (?,?,?,?,?,?,?,?, 'pending',0,?,?)`,
        )
        .run(
          id,
          input.gapId,
          input.claim,
          input.question,
          input.failedQueryId,
          input.sourceId,
          input.sourceItemLink,
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
               AND LOWER(s.wallet_address)=LOWER(gi.owner_wallet)
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

  async releaseSessionGrantSpend(sessionId: string, amount: number): Promise<void> {
    this.db
      .prepare(
        `UPDATE session_grants
            SET spent = MAX(0, ROUND(spent - ?, 6))
          WHERE session_id = ?`,
      )
      .run(amount, sessionId);
  }

  async deleteSessionGrant(sessionId: string): Promise<void> {
    this.db.prepare(`DELETE FROM session_grants WHERE session_id = ?`).run(sessionId);
  }

  async deleteExpiredSessionGrants(now: number): Promise<void> {
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
    if (!row) return { allowed: true, msBeforeNext: windowMs };
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

  async saveQueryRun(run: QueryRun): Promise<void> {
    const evidenceTelemetry = runEvidenceMetrics(run);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO query_runs (
           id,created_at,question,budget,engine,total_spent,total_to_creators,answer,data,
           parent_id,asker,origin,duration_ms,payment_mode,payment_attempts,settled_payments,
           confidence_level,mcp_client,evidence_claim_count,grounded_claim_count,
           rewarded_citation_count
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
        run.parentId ?? null,
        run.asker?.toLowerCase() ?? null,
        run.origin ?? "engine",
        run.durationMs ?? null,
        run.paymentMode ?? null,
        run.paymentAttempts ?? null,
        run.settledPayments ?? null,
        run.confidence?.level ?? null,
        run.mcpClient ?? null,
        evidenceTelemetry.evidenceClaimCount,
        evidenceTelemetry.groundedClaimCount,
        evidenceTelemetry.rewardedCitationCount,
      );
  }

  async listFollowUps(parentId: string): Promise<QueryRun[]> {
    const rows = this.db
      .prepare(`SELECT data FROM query_runs WHERE parent_id=? ORDER BY created_at ASC`)
      .all(parentId);
    return rows.map((r) => JSON.parse(r.data as string) as QueryRun);
  }

  async listQueryRunsByAsker(wallet: string, limit: number): Promise<QueryRun[]> {
    const rows = this.db
      .prepare(`SELECT data FROM query_runs WHERE asker=? ORDER BY created_at DESC LIMIT ?`)
      .all(wallet.toLowerCase(), limit);
    return rows.map((r) => JSON.parse(r.data as string) as QueryRun);
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
    const settlementStatus = assertPaymentSettlementState(p);
    this.db
      .prepare(
        `INSERT INTO payment_events (id,created_at,kind,query_id,source_id,source_name,payer,payee,amount_usdc,weight,rationale,tx_hash,network,settled,settlement_status,authorization_id,origin,item_id,item_title,item_url,content_version,item_published_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
        p.origin ?? "engine",
        p.itemId ?? null,
        p.itemTitle ?? null,
        p.itemUrl ?? null,
        p.contentVersion ?? null,
        p.itemPublishedAt ?? null,
      );
  }

  async listPayments(limit: number): Promise<PaymentRecord[]> {
    const rows = this.db
      .prepare(`SELECT * FROM payment_events ORDER BY created_at DESC LIMIT ?`)
      .all(limit);
    return rows.map(rowToPayment);
  }

  async listPaymentsByQuery(queryId: string): Promise<PaymentRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM payment_events WHERE query_id=? AND kind='citation' ORDER BY created_at ASC`,
      )
      .all(queryId);
    return rows.map(rowToPayment);
  }

  async listPaymentsBySource(sourceId: string): Promise<PaymentRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM payment_events WHERE source_id=? AND kind != 'inbound' ORDER BY created_at DESC`,
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
    // tx_hash is the primary key, so re-recording the same withdraw is an idempotent no-op.
    this.db
      .prepare(
        `INSERT OR IGNORE INTO withdrawals (tx_hash,created_at,label,source_name,wallet,recipient,amount_usdc,network)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        w.txHash,
        w.createdAt,
        w.label,
        w.sourceName ?? null,
        w.wallet,
        w.recipient,
        w.amountUsdc,
        w.network,
      );
  }

  async listWithdrawals(limit: number): Promise<WithdrawalRecord[]> {
    const rows = this.db
      .prepare(`SELECT * FROM withdrawals ORDER BY created_at DESC LIMIT ?`)
      .all(limit);
    return rows.map(rowToWithdrawal);
  }

  async metrics(): Promise<DashboardMetrics> {
    const payments = this.db
      .prepare(
        `SELECT amount_usdc,source_id,query_id,kind,origin,settled,settlement_status,payer
           FROM payment_events`,
      )
      .all()
      .map((p) => ({
        amountUsdc: Number(p.amount_usdc),
        sourceId: String(p.source_id ?? ""),
        queryId: String(p.query_id ?? ""),
        kind: p.kind as "fetch" | "citation" | "inbound",
        origin: (p.origin as import("../types").PaymentOrigin | null) ?? null,
        settled: Number(p.settled) === 1,
        settlementStatus:
          (p.settlement_status as import("../types").PaymentSettlementStatus | null) ?? null,
        payer: (p.payer as string | null) ?? null,
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
      .prepare(
        `SELECT gi.status
           FROM gap_intents gi
           JOIN sources s ON s.id=gi.source_id
          WHERE LOWER(s.wallet_address)=LOWER(gi.owner_wallet)`,
      )
      .all()
      .map((intent) => ({
        status: intent.status as import("../types").GapIntentStatus,
      }));
    return calculateDashboardMetrics(payments, runs, feedback, gapIntents);
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
         WHERE kind != 'inbound' AND settled = 1
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
    // verified=null means old row before the column existed — grandfather as verified.
    verified: r.verified === undefined || r.verified === null ? true : Boolean(r.verified),
    // preview_depth=null grandfathers the row as "full"; normalize guards any bad value.
    previewDepth: normalizePreviewDepth(r.preview_depth),
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

function rowToGapIntent(r: Record<string, unknown>): GapIntent {
  return {
    id: String(r.id),
    gapId: String(r.gap_id),
    claim: String(r.claim),
    question: String(r.question),
    failedQueryId: String(r.failed_query_id),
    sourceId: String(r.source_id),
    sourceItemLink: String(r.source_item_link ?? ""),
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
    origin: (r.origin as PaymentRecord["origin"]) ?? undefined,
    itemId: (r.item_id as string) ?? undefined,
    itemTitle: (r.item_title as string) ?? undefined,
    itemUrl: (r.item_url as string) ?? undefined,
    contentVersion: (r.content_version as string) ?? undefined,
    itemPublishedAt: (r.item_published_at as string) ?? undefined,
    createdAt: r.created_at as string,
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
