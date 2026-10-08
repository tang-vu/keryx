import { createHash } from "node:crypto";
import { closeSync, createReadStream, existsSync, lstatSync, openSync, readFileSync, readSync, type BigIntStats } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { projectRecordedEvidenceProvenanceList, type EvidenceProvenanceLookup } from "../research/evidence-provenance";
import type { PaymentRecord, PaymentSettlementStatus, QueryRun } from "../types";

const NETWORK = "eip155:5042002" as const;
const UNAVAILABLE = "Historical testnet archive unavailable";
const MAX_QUERIES = 2500;

export interface TestnetArchiveInfo {
  readonly network: typeof NETWORK;
  readonly label: "Arc testnet";
  readonly capturedAt: string;
  readonly sourceCommit: string;
  readonly databaseSha256: string;
}

export interface TestnetArchiveSummary {
  totalQueryRuns: number;
  earliestQueryAt: string | null;
  latestQueryAt: string | null;
  /** Recorded wallet attribution, never a count of independent people. */
  walletAttributedQueryRuns: number;
  settledCreatorCount: number;
  settledCreatorPaymentCount: number;
  settledCreatorMicroUsdc: number;
  payments: Record<PaymentSettlementStatus, { count: number; amountMicroUsdc: number }>;
  paymentKinds: Array<{ kind: PaymentRecord["kind"]; count: number; settledMicroUsdc: number }>;
  origins: Array<{ origin: string | null; count: number }>;
}

/** Public history only: no writer, authentication, session, nonce or custody methods. */
export interface TestnetArchiveStore {
  readonly info: TestnetArchiveInfo;
  getQueryRun(id: string): Promise<QueryRun | null>;
  listRecentQueries(limit: number, before?: { createdAt: string; id: string }): Promise<QueryRun[]>;
  iterateRecentQueries(limit: number): AsyncIterable<QueryRun>;
  /** The caller must verify the wallet's current authenticated session. */
  listQueryRunsByAsker(wallet: string, limit: number): Promise<QueryRun[]>;
  listFollowUps(id: string): Promise<QueryRun[]>;
  listPaymentsByQuery(id: string): Promise<PaymentRecord[]>;
  listCreatorPaymentAttemptsByQuery(id: string): Promise<PaymentRecord[]>;
  summary(): Promise<TestnetArchiveSummary>;
  close(): void;
}

interface ArchiveManifest {
  version: 1;
  network: typeof NETWORK;
  capturedAt: string;
  sourceCommit: string;
  database: string;
  databaseSha256: string;
}

function unavailable(): Error { return new Error(UNAVAILABLE); }

function identity(path: string): BigIntStats {
  const value = lstatSync(path, { bigint: true });
  if (!value.isFile()) throw unavailable();
  return value;
}

function sameIdentity(expected: BigIntStats, actual: BigIntStats): boolean {
  return (["dev", "ino", "size", "mtimeNs", "ctimeNs", "mode"] as const)
    .every(field => expected[field] === actual[field]);
}

function assertStandalone(database: string): void {
  // A closed, immutable snapshot must have no active journal. Opening a WAL-mode
  // database can itself create sidecars, even through a read-only SQLite handle.
  if (["-wal", "-shm", "-journal"].some(suffix => existsSync(database + suffix))) throw unavailable();
}

function parseManifest(value: unknown): ArchiveManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
  const manifest = value as Record<string, unknown>;
  const keys = ["version", "network", "capturedAt", "sourceCommit", "database", "databaseSha256"];
  if (Object.keys(manifest).length !== keys.length || keys.some(key => !(key in manifest)) ||
      manifest.version !== 1 || manifest.network !== NETWORK ||
      typeof manifest.capturedAt !== "string" || !Number.isFinite(Date.parse(manifest.capturedAt)) ||
      new Date(manifest.capturedAt).toISOString() !== manifest.capturedAt ||
      typeof manifest.sourceCommit !== "string" || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit) ||
      typeof manifest.databaseSha256 !== "string" || !/^[a-f0-9]{64}$/.test(manifest.databaseSha256) ||
      typeof manifest.database !== "string" || !isAbsolute(manifest.database)) throw unavailable();
  return manifest as unknown as ArchiveManifest;
}

async function verifyDatabase(database: string, expectedHash: string): Promise<void> {
  const fd = openSync(database, "r");
  try {
    const header = Buffer.alloc(100);
    if (readSync(fd, header, 0, header.length, 0) !== header.length ||
        header.subarray(0, 16).toString("binary") !== "SQLite format 3\0" ||
        header[18] !== 1 || header[19] !== 1) throw unavailable();
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(database, { fd, autoClose: false, start: 0 })) hash.update(chunk);
    if (hash.digest("hex") !== expectedHash) throw unavailable();
  } finally {
    closeSync(fd);
  }
}

const PUBLIC_PAYMENT_COLUMNS = [
  "id", "kind", "query_id", "source_id", "source_name", "payer", "payee", "amount_usdc",
  "weight", "rationale", "tx_hash", "network", "settled", "settlement_status", "origin",
  "item_id", "item_title", "item_url", "content_version", "item_published_at", "offer_id", "list_price_usdc", "created_at",
] as const;

function assertLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_QUERIES) throw new Error("Invalid archive query limit");
}

function assertId(id: string): void {
  if (typeof id !== "string" || !id.length || id.length > 256) throw new Error("Invalid archive query identity");
}

function safeCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw unavailable();
  return value;
}

function paymentStatus(row: Record<string, unknown>): PaymentSettlementStatus {
  const status = row.settlement_status ?? (Boolean(row.settled) ? "settled" : "simulated");
  if (!["settled", "pending", "simulated", "failed"].includes(String(status))) throw unavailable();
  return status as PaymentSettlementStatus;
}

function publicPayment(row: Record<string, unknown>): PaymentRecord {
  return {
    id: row.id as string,
    kind: row.kind as PaymentRecord["kind"],
    queryId: row.query_id as string,
    sourceId: row.source_id as string,
    sourceName: row.source_name as string,
    payer: row.payer as string,
    payee: row.payee as string,
    amountUsdc: row.amount_usdc as number,
    weight: (row.weight as number) ?? undefined,
    rationale: (row.rationale as string) ?? undefined,
    txHash: (row.tx_hash as string) ?? null,
    network: row.network as string,
    settled: Boolean(row.settled),
    settlementStatus: paymentStatus(row),
    origin: (row.origin as PaymentRecord["origin"]) ?? undefined,
    itemId: (row.item_id as string) ?? undefined,
    itemTitle: (row.item_title as string) ?? undefined,
    itemUrl: (row.item_url as string) ?? undefined,
    contentVersion: (row.content_version as string) ?? undefined,
    itemPublishedAt: (row.item_published_at as string) ?? undefined,
    offerId: (row.offer_id as string) ?? undefined,
    listPriceUsdc: row.list_price_usdc == null ? undefined : Number(row.list_price_usdc),
    createdAt: row.created_at as string,
  };
}

class ReadonlyTestnetArchive implements TestnetArchiveStore {
  readonly info: TestnetArchiveInfo;
  readonly #db: DatabaseSync;
  readonly #database: string;
  readonly #manifest: string;
  readonly #databaseIdentity: BigIntStats;
  readonly #manifestIdentity: BigIntStats;
  readonly #paymentColumns: string;
  readonly #visiblePayment: string;
  readonly #statusExpression: string;
  readonly #settledEvidence: string;
  readonly #queryOrigin: string;
  readonly #sourceProvenance: boolean;
  readonly #itemProvenance: boolean;
  #closed = false;

  constructor(manifestPath: string, manifest: ArchiveManifest, databaseIdentity: BigIntStats, manifestIdentity: BigIntStats) {
    this.#manifest = manifestPath;
    this.#database = manifest.database;
    this.#databaseIdentity = databaseIdentity;
    this.#manifestIdentity = manifestIdentity;
    this.info = Object.freeze({ network: NETWORK, label: "Arc testnet", capturedAt: manifest.capturedAt,
      sourceCommit: manifest.sourceCommit, databaseSha256: manifest.databaseSha256 });
    this.#db = new DatabaseSync(manifest.database, { readOnly: true });
    try {
      this.assertIdentity();
      for (const table of ["query_runs", "payment_events"]) {
        if (!this.#db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw unavailable();
      }
      const queryColumns = this.columns("query_runs");
      const paymentColumns = this.columns("payment_events");
      if (["id", "created_at", "data", "asker", "parent_id"].some(column => !queryColumns.has(column)) ||
          ["id", "kind", "query_id", "source_id", "source_name", "payer", "payee", "amount_usdc", "tx_hash", "network", "settled", "created_at"]
            .some(column => !paymentColumns.has(column))) throw unavailable();
      this.#paymentColumns = PUBLIC_PAYMENT_COLUMNS.filter(column => paymentColumns.has(column)).join(", ");
      this.#visiblePayment = paymentColumns.has("authorization_phase")
        ? "(authorization_phase IS NULL OR authorization_phase NOT IN ('prepared','cancelled_unexposed'))" : "1=1";
      this.#statusExpression = paymentColumns.has("settlement_status")
        ? "COALESCE(settlement_status, CASE WHEN settled=1 THEN 'settled' ELSE 'simulated' END)"
        : "CASE WHEN settled=1 THEN 'settled' ELSE 'simulated' END";
      this.#settledEvidence = `settled=1 AND ${this.#statusExpression}='settled' AND tx_hash IS NOT NULL AND LENGTH(TRIM(tx_hash))>0`;
      this.#queryOrigin = queryColumns.has("origin") ? "origin" : "NULL";
      const sourceColumns = this.optionalColumns("sources");
      const itemColumns = this.optionalColumns("source_items");
      this.#sourceProvenance = ["id", "evidence_provenance"].every(column => sourceColumns.has(column));
      this.#itemProvenance = ["id", "source_id", "evidence_provenance"].every(column => itemColumns.has(column));
      // Network checking covers every row, including receipts excluded from the public projection.
      if (this.#db.prepare("SELECT 1 FROM payment_events WHERE network IS NULL OR network != ? LIMIT 1").get(NETWORK) ||
          this.#db.prepare(`SELECT 1 FROM payment_events WHERE amount_usdc IS NULL OR amount_usdc < 0 OR amount_usdc > ? OR
            kind NOT IN ('fetch','citation','inbound','operating-fee') OR kind IS NULL OR
            settled IS NULL OR settled NOT IN (0,1) OR ${this.#statusExpression} NOT IN ('settled','pending','simulated','failed') OR
            (settled=1 AND NOT (${this.#settledEvidence})) OR (settled=0 AND ${this.#statusExpression}='settled') LIMIT 1`)
            .get(Number.MAX_SAFE_INTEGER / 1_000_000)) throw unavailable();
      this.assertIdentity();
    } catch {
      this.#db.close();
      throw unavailable();
    }
  }

  private columns(table: "query_runs" | "payment_events" | "sources" | "source_items"): Set<string> {
    return new Set(this.#db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name)));
  }

  private optionalColumns(table: "sources" | "source_items"): Set<string> {
    return this.#db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
      ? this.columns(table) : new Set<string>();
  }

  assertIdentity(): void {
    try {
      if (this.#closed || !sameIdentity(this.#manifestIdentity, identity(this.#manifest)) ||
          !sameIdentity(this.#databaseIdentity, identity(this.#database))) throw unavailable();
      assertStandalone(this.#database);
    } catch { throw unavailable(); }
  }

  private read<T>(operation: () => T): T {
    try {
      this.assertIdentity();
      const result = operation();
      this.assertIdentity();
      return result;
    } catch { throw unavailable(); }
  }

  private query(row: Record<string, unknown>): QueryRun {
    const value: unknown = JSON.parse(row.data as string);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
    const run = value as QueryRun;
    if (run.id !== row.id || run.createdAt !== row.created_at || typeof run.answer !== "string" || typeof run.question !== "string") throw unavailable();
    // Current private continuation packets are not public historical query content.
    const { originalFulfillment: _privateContinuation, ...publicRun } = run;
    return publicRun;
  }

  private provenance(lookup: EvidenceProvenanceLookup): ReadonlySet<string> {
    return this.read(() => {
      const flags = new Set<string>();
      for (const [table, ids, supported] of [
        ["sources", lookup.sourceIds, this.#sourceProvenance],
        ["source_items", lookup.itemIds, this.#itemProvenance],
      ] as const) {
        if (!supported) continue;
        for (let offset = 0; offset < ids.length; offset += 500) {
          const batch = ids.slice(offset, offset + 500);
          if (batch.some(id => typeof id !== "string" || id.length > 256)) throw unavailable();
          // These immutable flags demote factual authority only. No source body,
          // payout address, offer, key or live registry state is read or imported.
          const rows = this.#db.prepare(`SELECT id${table === "source_items" ? ",source_id" : ""} FROM ${table}
            WHERE evidence_provenance='synthetic-demo' AND id IN (${batch.map(() => "?").join(",")})`).all(...batch);
          for (const row of rows) flags.add(table === "sources" ? `source:${row.id}` : `item:${row.source_id}:${row.id}`);
        }
      }
      return flags;
    });
  }

  private async project(runs: QueryRun[]): Promise<QueryRun[]> {
    try {
      this.assertIdentity();
      const projected = await projectRecordedEvidenceProvenanceList(async lookup => this.provenance(lookup), runs);
      this.assertIdentity();
      return projected;
    } catch { throw unavailable(); }
  }

  async getQueryRun(id: string): Promise<QueryRun | null> {
    assertId(id);
    const run = this.read(() => {
      const row = this.#db.prepare("SELECT id, created_at, data FROM query_runs WHERE id=?").get(id);
      return row ? this.query(row) : null;
    });
    return run ? (await this.project([run]))[0] : null;
  }

  async listRecentQueries(limit: number, before?: { createdAt: string; id: string }): Promise<QueryRun[]> {
    assertLimit(limit);
    if (before) {
      assertId(before.id);
      if (typeof before.createdAt !== "string" || !Number.isFinite(Date.parse(before.createdAt)) || before.createdAt.length > 64) {
        throw new Error("Invalid archive query cursor");
      }
    }
    return this.project(this.read(() => this.#db.prepare(`SELECT id, created_at, data FROM query_runs
      ${before ? "WHERE created_at < ? OR (created_at = ? AND id < ?)" : ""} ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(...(before ? [before.createdAt, before.createdAt, before.id, limit] : [limit])).map(row => this.query(row))));
  }

  async *iterateRecentQueries(limit: number): AsyncIterable<QueryRun> {
    assertLimit(limit);
    const rows = this.read(() => this.#db.prepare("SELECT id FROM query_runs ORDER BY created_at DESC, id DESC LIMIT ?").iterate(limit));
    const lookup = this.read(() => this.#db.prepare("SELECT id, created_at, data FROM query_runs WHERE id=?"));
    try {
      for (const row of rows) {
        const run = this.read(() => {
          const record = lookup.get(row.id);
          if (!record) throw unavailable();
          return this.query(record);
        });
        yield (await this.project([run]))[0];
      }
    } catch { throw unavailable(); }
  }

  async listQueryRunsByAsker(wallet: string, limit: number): Promise<QueryRun[]> {
    assertLimit(limit);
    if (typeof wallet !== "string" || !/^0x[a-fA-F0-9]{40}$/i.test(wallet)) throw new Error("Invalid archive wallet");
    return this.project(this.read(() => this.#db.prepare("SELECT id, created_at, data FROM query_runs WHERE LOWER(asker)=? ORDER BY created_at DESC, id DESC LIMIT ?")
      .all(wallet.toLowerCase(), limit).map(row => this.query(row))));
  }

  async listFollowUps(id: string): Promise<QueryRun[]> {
    assertId(id);
    return this.project(this.read(() => this.#db.prepare("SELECT id, created_at, data FROM query_runs WHERE parent_id=? ORDER BY created_at ASC, id ASC LIMIT ?")
      .all(id, MAX_QUERIES).map(row => this.query(row))));
  }

  private payments(id: string, kinds: string): PaymentRecord[] {
    return this.read(() => this.#db.prepare(`SELECT ${this.#paymentColumns} FROM payment_events WHERE query_id=? AND ${kinds}
      AND ${this.#visiblePayment} ORDER BY created_at ASC, id ASC`).all(id).map(publicPayment));
  }

  async listPaymentsByQuery(id: string): Promise<PaymentRecord[]> {
    assertId(id);
    return this.payments(id, "kind='citation'");
  }

  async listCreatorPaymentAttemptsByQuery(id: string): Promise<PaymentRecord[]> {
    assertId(id);
    return this.payments(id, "kind!='inbound'");
  }

  async summary(): Promise<TestnetArchiveSummary> {
    return this.read(() => {
      const queries = this.#db.prepare(`SELECT COUNT(*) AS count, MIN(created_at) AS earliest, MAX(created_at) AS latest,
        COUNT(NULLIF(asker,'')) AS attributed FROM query_runs`).get()!;
      const payments: TestnetArchiveSummary["payments"] = {
        settled: { count: 0, amountMicroUsdc: 0 }, pending: { count: 0, amountMicroUsdc: 0 },
        simulated: { count: 0, amountMicroUsdc: 0 }, failed: { count: 0, amountMicroUsdc: 0 },
      };
      for (const row of this.#db.prepare(`SELECT ${this.#statusExpression} AS status, COUNT(*) AS count,
        SUM(CAST(ROUND(amount_usdc*1000000) AS INTEGER)) AS micro FROM payment_events WHERE ${this.#visiblePayment}
        AND (${this.#statusExpression}!='settled' OR (${this.#settledEvidence})) GROUP BY status`).all()) {
        payments[row.status as PaymentSettlementStatus] = { count: safeCount(row.count), amountMicroUsdc: safeCount(row.micro) };
      }
      const creators = this.#db.prepare(`SELECT COUNT(DISTINCT LOWER(payee)) AS count, COUNT(*) AS payments,
        COALESCE(SUM(CAST(ROUND(amount_usdc*1000000) AS INTEGER)),0) AS micro FROM payment_events
        WHERE ${this.#visiblePayment} AND kind IN ('fetch','citation') AND ${this.#settledEvidence}`).get()!;
      return {
        totalQueryRuns: safeCount(queries.count), earliestQueryAt: (queries.earliest as string) ?? null,
        latestQueryAt: (queries.latest as string) ?? null, walletAttributedQueryRuns: safeCount(queries.attributed),
        settledCreatorCount: safeCount(creators.count), settledCreatorPaymentCount: safeCount(creators.payments),
        settledCreatorMicroUsdc: safeCount(creators.micro), payments,
        paymentKinds: this.#db.prepare(`SELECT kind, COUNT(*) AS count,
          SUM(CASE WHEN ${this.#settledEvidence} THEN CAST(ROUND(amount_usdc*1000000) AS INTEGER) ELSE 0 END) AS micro
          FROM payment_events WHERE ${this.#visiblePayment} GROUP BY kind ORDER BY kind`).all()
          .map(row => ({ kind: row.kind as PaymentRecord["kind"], count: safeCount(row.count), settledMicroUsdc: safeCount(row.micro) })),
        origins: this.#db.prepare(`SELECT ${this.#queryOrigin} AS origin, COUNT(*) AS count FROM query_runs GROUP BY origin ORDER BY origin`).all()
          .map(row => ({ origin: (row.origin as string) ?? null, count: safeCount(row.count) })),
      };
    });
  }

  close(): void {
    if (!this.#closed) { this.#db.close(); this.#closed = true; }
  }
}

const archives = new Map<string, Promise<ReadonlyTestnetArchive>>();

/** Missing configuration is distinct from a configured archive failing its integrity gate. */
export async function getTestnetArchive(): Promise<TestnetArchiveStore | null> {
  const configured = process.env.KERYX_TESTNET_ARCHIVE_MANIFEST?.trim();
  if (!configured) return null;
  if (!isAbsolute(configured)) throw unavailable();
  const manifestPath = resolve(configured);
  let pending = archives.get(manifestPath);
  if (!pending) {
    pending = (async () => {
      try {
        const manifestIdentity = identity(manifestPath);
        if (manifestIdentity.size > BigInt(65536)) throw unavailable();
        const manifest = parseManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
        const databaseIdentity = identity(manifest.database);
        assertStandalone(manifest.database);
        await verifyDatabase(manifest.database, manifest.databaseSha256);
        if (!sameIdentity(manifestIdentity, identity(manifestPath)) || !sameIdentity(databaseIdentity, identity(manifest.database))) throw unavailable();
        return new ReadonlyTestnetArchive(manifestPath, manifest, databaseIdentity, manifestIdentity);
      } catch { throw unavailable(); }
    })();
    archives.set(manifestPath, pending);
    pending.catch(() => { if (archives.get(manifestPath) === pending) archives.delete(manifestPath); });
  }
  const archive = await pending;
  archive.assertIdentity();
  return archive;
}
