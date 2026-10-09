import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTestnetArchive, type TestnetArchiveStore } from "./testnet-archive";
import { SEED_EVIDENCE_FINGERPRINTS } from "../research/seed-evidence-fingerprints";
import { SYNTHETIC_EVIDENCE_NOTICE } from "../research/evidence-provenance";
import type { QueryRun } from "../types";

const ALICE = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BOB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const IDS = [
  "3a43c6c2-fddf-40ce-98a1-701a2a58b439",
  "fe7c06fd-65da-41a6-867c-0597a63304df",
  "2405a2ea-7ee3-4f0d-88b9-f221df791070",
];
const directories: string[] = [];
const opened: TestnetArchiveStore[] = [];
const writers = new Set<DatabaseSync>();

function hash(path: string): string { return createHash("sha256").update(readFileSync(path)).digest("hex"); }

function query(id: string, index: number, overrides: Partial<QueryRun> = {}): QueryRun {
  return { id, question: `Original question ${index}`, answer: `Original answer ${index}`,
    budget: 0.05, engine: "historical", subClaims: [], decisions: [], citations: [], trace: [],
    totalSpent: 0.03, totalToCreators: 0.03, createdAt: `2026-09-0${index + 1}T12:00:00.000Z`, ...overrides };
}

function fixture(options: { network?: string; legacyStatus?: boolean; synthetic?: boolean; metadata?: "flags" | "legacy" } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "keryx-public-testnet-archive-"));
  directories.push(directory);
  const database = join(directory, "history.sqlite");
  const manifestPath = join(directory, "manifest.json");
  const writer = new DatabaseSync(database);
  writers.add(writer);
  // Native historical schema, never initialized through the application adapter.
  // Source tables/provenance are optional to cover older frozen snapshots too.
  writer.exec(`CREATE TABLE query_runs(id TEXT PRIMARY KEY, created_at TEXT, asker TEXT, parent_id TEXT, origin TEXT, data TEXT);
    CREATE TABLE payment_events(id TEXT PRIMARY KEY, created_at TEXT, kind TEXT, query_id TEXT, source_id TEXT,
      source_name TEXT, payer TEXT, payee TEXT, amount_usdc REAL, weight REAL, rationale TEXT, tx_hash TEXT,
      network TEXT, settled INTEGER, ${options.legacyStatus ? "" : "settlement_status TEXT,"}
      authorization_id TEXT, authorization_phase TEXT, authorization_expires_at TEXT, grant_epoch TEXT,
      origin TEXT, item_id TEXT, item_title TEXT, item_url TEXT, content_version TEXT, item_published_at TEXT,
      offer_id TEXT, list_price_usdc REAL, private_key TEXT);
    CREATE TABLE sessions(secret TEXT); INSERT INTO sessions VALUES('private-session-fixture');
    CREATE TABLE api_keys(secret TEXT); INSERT INTO api_keys VALUES('private-api-fixture');`);
  if (options.metadata) {
    writer.exec(`CREATE TABLE sources(id TEXT PRIMARY KEY, ${options.metadata === "flags" ? "evidence_provenance TEXT," : ""} content TEXT, pay_to TEXT);
      CREATE TABLE source_items(id TEXT PRIMARY KEY, source_id TEXT, ${options.metadata === "flags" ? "evidence_provenance TEXT," : ""} content TEXT, item_key_enc TEXT);`);
    if (options.metadata === "flags") {
      writer.exec(`INSERT INTO sources VALUES('flagged-source','synthetic-demo','paid-private-source-body-fixture','private-payout-fixture');
        INSERT INTO source_items VALUES('flagged-item','item-parent','synthetic-demo','paid-private-item-body-fixture','private-decryption-fixture');`);
    }
  }
  const queries = IDS.map((id, index) => query(id, index, { asker: index === 2 ? BOB : ALICE, origin: index === 2 ? "mcp" : "web" }));
  queries.push(query("child", 3, { parentId: IDS[0], asker: ALICE, origin: "web" }));
  if (options.synthetic) {
    const seed = SEED_EVIDENCE_FINGERPRINTS[0];
    queries[0].citations = [{ sourceId: "seed-source", sourceName: "Seed", marker: "[1]", weight: 1,
      reward: 0.01, rationale: "Recorded fixture citation", itemTitle: seed.itemTitle, itemUrl: seed.itemUrl,
      contentReceipt: { bodyHash: seed.bodyHash, deliveryKind: "abstract", storageMode: "db_encrypted", plaintextBytes: 123 } }];
  }
  if (options.metadata === "flags") {
    const legacyCitation = { sourceId: "flagged-source", sourceName: "Legacy seed", marker: "S1", weight: 1,
      reward: 0.01, rationale: "Recorded legacy citation without any item identity" };
    queries[0].citations = [{ ...legacyCitation }];
    queries[1].citations = [{ ...legacyCitation, sourceId: "item-parent", itemId: "flagged-item" }];
    // Matching an item ID from a different source must not mark this citation.
    queries[2].citations = [{ ...legacyCitation, sourceId: "other-parent", itemId: "flagged-item" }];
    queries[3].citations = [{ ...legacyCitation }];
  }
  const insertQuery = writer.prepare("INSERT INTO query_runs VALUES(?,?,?,?,?,?)");
  for (const run of queries) insertQuery.run(run.id, run.createdAt, run.asker ?? null, run.parentId ?? null, run.origin ?? null, JSON.stringify(run));
  const payments = [
    { id: "citation-settled", kind: "citation", amount: 0.100001, settled: 1, status: "settled", tx: "circle-settlement-1" },
    { id: "fetch-settled", kind: "fetch", amount: 0.000002, settled: 1, status: "settled", tx: "circle-settlement-2" },
    { id: "citation-pending", kind: "citation", amount: 0.000003, settled: 0, status: "pending", tx: null },
    { id: "citation-simulated", kind: "citation", amount: 0.000004, settled: 0, status: "simulated", tx: null },
    { id: "citation-failed", kind: "citation", amount: 0.000005, settled: 0, status: "failed", tx: null },
    { id: "inbound", kind: "inbound", amount: 0.5, settled: 1, status: "settled", tx: "circle-inbound" },
    { id: "operating", kind: "operating-fee", amount: 0.01, settled: 1, status: "settled", tx: "circle-operating" },
    { id: "prepared", kind: "citation", amount: 0.2, settled: 0, status: "pending", tx: null, phase: "prepared" },
    { id: "cancelled", kind: "citation", amount: 0.2, settled: 0, status: "failed", tx: null, phase: "cancelled_unexposed" },
  ];
  for (const payment of payments) {
    writer.prepare(`INSERT INTO payment_events(id,created_at,kind,query_id,source_id,source_name,payer,payee,amount_usdc,
      network,settled,${options.legacyStatus ? "" : "settlement_status,"}tx_hash,authorization_id,authorization_phase,
      authorization_expires_at,grant_epoch,private_key)
      VALUES(${Array.from({ length: options.legacyStatus ? 17 : 18 }, () => "?").join(",")})`).run(
      payment.id, "2026-09-01T12:01:00.000Z", payment.kind, IDS[0], "source-a", "Creator", ALICE, BOB,
      payment.amount, options.network ?? "eip155:5042002", payment.settled,
      ...(options.legacyStatus ? [] : [payment.status]), payment.tx, "private-nonce-fixture",
      payment.phase ?? null, "2026-09-01T12:02:00.000Z", "private-grant-fixture", "private-key-fixture",
    );
  }
  writer.close();
  writers.delete(writer);
  const manifest = { version: 1, network: "eip155:5042002", capturedAt: "2026-10-03T00:00:00.000Z",
    sourceCommit: "f9dca8d04f4657abbf0153175feec65728ba6a99", database, databaseSha256: hash(database) };
  function writeManifest(overrides: Record<string, unknown> = {}) {
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, ...overrides }));
  }
  writeManifest();
  vi.stubEnv("KERYX_TESTNET_ARCHIVE_MANIFEST", manifestPath);
  return { database, directory, manifestPath, manifest, queries, writeManifest };
}

async function open(): Promise<TestnetArchiveStore> {
  const store = await getTestnetArchive();
  expect(store).not.toBeNull();
  opened.push(store!);
  return store!;
}

function revise(f: ReturnType<typeof fixture>, change: (writer: DatabaseSync) => void): void {
  const writer = new DatabaseSync(f.database);
  writers.add(writer);
  try { change(writer); }
  finally { writer.close(); writers.delete(writer); }
  f.writeManifest({ databaseSha256: hash(f.database) });
}

afterEach(() => {
  for (const archive of opened.splice(0)) archive.close();
  for (const writer of writers) writer.close();
  writers.clear();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("read-only historical testnet archive", () => {
  it("distinguishes an unconfigured archive from missing or invalid configured evidence", async () => {
    vi.stubEnv("KERYX_TESTNET_ARCHIVE_MANIFEST", "");
    expect(await getTestnetArchive()).toBeNull();
    const f = fixture();
    rmSync(f.manifestPath);
    await expect(getTestnetArchive()).rejects.toThrow(/^Historical testnet archive unavailable$/);
    f.writeManifest({ database: "relative.sqlite" });
    await expect(getTestnetArchive()).rejects.toThrow(/^Historical testnet archive unavailable$/);
    f.writeManifest({ database: join(f.directory, "missing.sqlite") });
    await expect(getTestnetArchive()).rejects.toThrow(/^Historical testnet archive unavailable$/);
    expect(existsSync(join(f.directory, "missing.sqlite"))).toBe(false);
  });

  it("recovers all three original dispatch IDs, answers and timestamps without changing archive bytes", async () => {
    const f = fixture();
    const before = readFileSync(f.database);
    vi.stubEnv("KERYX_NETWORK", "arc");
    vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arc");
    const archive = await open();
    expect(archive.info).toEqual({ network: "eip155:5042002", label: "Arc testnet",
      capturedAt: f.manifest.capturedAt, sourceCommit: f.manifest.sourceCommit, databaseSha256: f.manifest.databaseSha256 });
    for (let index = 0; index < IDS.length; index++) expect(await archive.getQueryRun(IDS[index])).toEqual(f.queries[index]);
    expect(await archive.getQueryRun("missing")).toBeNull();
    expect(await archive.listFollowUps(IDS[0])).toEqual([f.queries[3]]);
    expect(await archive.listFollowUps(IDS[1])).toEqual([]);
    expect(await getTestnetArchive()).toBe(archive);
    expect(readFileSync(f.database)).toEqual(before);
    expect(hash(f.database)).toBe(f.manifest.databaseSha256);
    for (const suffix of ["-wal", "-shm", "-journal"]) expect(existsSync(f.database + suffix)).toBe(false);
    const inspection = new DatabaseSync(f.database, { readOnly: true });
    try {
      expect(inspection.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name))
        .toEqual(["api_keys", "payment_events", "query_runs", "sessions"]);
      expect(() => inspection.exec("DELETE FROM query_runs")).toThrow();
    } finally { inspection.close(); }
    expect(Object.keys(archive)).toEqual(["info"]);
    expect("init" in archive || "recordPayment" in archive || "saveQueryRun" in archive || "db" in archive).toBe(false);
  });

  it("keeps wallet history isolated and lowercases only the already-verified caller filter", async () => {
    fixture();
    const archive = await open();
    expect((await archive.listQueryRunsByAsker(ALICE.toUpperCase(), 10)).map(run => run.id)).toEqual(["child", IDS[1], IDS[0]]);
    expect((await archive.listQueryRunsByAsker(BOB, 10)).map(run => run.id)).toEqual([IDS[2]]);
    expect(await archive.listQueryRunsByAsker("0xcccccccccccccccccccccccccccccccccccccccc", 10)).toEqual([]);
    await expect(archive.listQueryRunsByAsker("unverified-input", 10)).rejects.toThrow("Invalid archive wallet");
    expect(await archive.getQueryRun("x'; DELETE FROM query_runs; --")).toBeNull();
    expect(await archive.listRecentQueries(10)).toHaveLength(4);
  });

  it("preserves settlement states, excludes unexposed attempts and projects no nonce, grant or secrets", async () => {
    fixture();
    const archive = await open();
    const citations = await archive.listPaymentsByQuery(IDS[0]);
    expect(citations.map(payment => payment.id)).toEqual(["citation-failed", "citation-pending", "citation-settled", "citation-simulated"]);
    expect(citations.find(payment => payment.id === "citation-settled")).toMatchObject({
      settled: true, settlementStatus: "settled", txHash: "circle-settlement-1", amountUsdc: 0.100001, network: "eip155:5042002",
    });
    expect(citations.find(payment => payment.id === "citation-pending")).toMatchObject({ settled: false, settlementStatus: "pending", txHash: null });
    expect(citations.find(payment => payment.id === "citation-failed")).toMatchObject({ settled: false, settlementStatus: "failed" });
    expect(citations.find(payment => payment.id === "citation-simulated")).toMatchObject({ settled: false, settlementStatus: "simulated" });
    expect((await archive.listCreatorPaymentAttemptsByQuery(IDS[0])).map(payment => payment.id))
      .toEqual(["citation-failed", "citation-pending", "citation-settled", "citation-simulated", "fetch-settled", "operating"]);
    expect(JSON.stringify(citations)).not.toMatch(/private-|authorization|grantEpoch/);
    expect(await archive.listCreatorPaymentAttemptsByQuery("missing")).toEqual([]);
    const summary = await archive.summary();
    expect(summary).toMatchObject({ totalQueryRuns: 4, walletAttributedQueryRuns: 4, settledCreatorCount: 1,
      settledCreatorPaymentCount: 2, settledCreatorMicroUsdc: 100003,
      payments: { settled: { count: 4, amountMicroUsdc: 610003 }, pending: { count: 1, amountMicroUsdc: 3 },
        simulated: { count: 1, amountMicroUsdc: 4 }, failed: { count: 1, amountMicroUsdc: 5 } },
      earliestQueryAt: "2026-09-01T12:00:00.000Z", latestQueryAt: "2026-09-04T12:00:00.000Z",
      origins: [{ origin: "mcp", count: 1 }, { origin: "web", count: 3 }],
    });
    expect(summary.paymentKinds.find(kind => kind.kind === "inbound")).toEqual({ kind: "inbound", count: 1, settledMicroUsdc: 500000 });
  });

  it("projects legacy settlement rows and known seed provenance without querying current source columns", async () => {
    const f = fixture({ legacyStatus: true, synthetic: true });
    const before = hash(f.database);
    const archive = await open();
    const run = (await archive.getQueryRun(IDS[0]))!;
    expect(run.answer).toBe(`${SYNTHETIC_EVIDENCE_NOTICE}\n\n${f.queries[0].answer}`);
    expect(run.citations[0].evidenceProvenance).toBe("synthetic-demo");
    expect((await archive.listPaymentsByQuery(IDS[0])).find(payment => payment.id === "citation-settled")?.settlementStatus).toBe("settled");
    expect((await archive.listPaymentsByQuery(IDS[0])).find(payment => payment.id === "citation-pending")?.settlementStatus).toBe("simulated");
    expect(hash(f.database)).toBe(before);
  });

  it("reports only visible, evidence-backed creator payments without importing private data", async () => {
    const f = fixture();
    revise(f, writer => {
      writer.exec(`UPDATE payment_events SET settled=1,settlement_status='settled',tx_hash='unexposed-settlement'
        WHERE id IN ('prepared','cancelled');
        UPDATE payment_events SET source_name='Unsettled name' WHERE settled=0;`);
    });
    const before = readFileSync(f.database);
    const archive = await open();
    const creators = await archive.creatorLeaderboard();
    expect(creators).toEqual([{ sourceId: "source-a", sourceName: "Creator", walletAddress: BOB,
      totalEarnedMicroUsdc: 100003, paymentCount: 2, citationCount: 1 }]);
    const summary = await archive.summary();
    expect(creators.reduce((sum, creator) => sum + creator.totalEarnedMicroUsdc, 0)).toBe(summary.settledCreatorMicroUsdc);
    expect(creators.reduce((sum, creator) => sum + creator.paymentCount, 0)).toBe(summary.settledCreatorPaymentCount);
    expect(JSON.stringify(creators)).not.toMatch(/private-|authorization|grant|payer|content|txHash|operating|inbound/);
    expect(readFileSync(f.database)).toEqual(before);
    expect(Object.keys(creators[0]).sort()).toEqual(["citationCount", "paymentCount", "sourceId", "sourceName", "totalEarnedMicroUsdc", "walletAddress"]);
    for (const suffix of ["-wal", "-shm", "-journal"]) expect(existsSync(f.database + suffix)).toBe(false);
  });

  it("preserves split recipients, deduplicates wallet case and orders tied earnings deterministically", async () => {
    const f = fixture();
    revise(f, writer => {
      writer.prepare("UPDATE payment_events SET payee=?,source_name='Latest recorded creator' WHERE id='fetch-settled'").run(BOB.toUpperCase());
      const insert = writer.prepare(`INSERT INTO payment_events(id,created_at,kind,source_id,source_name,payee,amount_usdc,network,settled,settlement_status,tx_hash)
        VALUES(?,?,'citation',?,?,?,?, 'eip155:5042002',1,'settled','original-evidence')`);
      insert.run("different-recipient", "2026-09-01T12:02:00.000Z", "source-a", "Recipient's recorded name", ALICE, 0.100003);
      insert.run("different-source", "2026-09-01T12:03:00.000Z", "source-b", "Another source", ALICE, 0.100003);
    });
    const archive = await open();
    expect(await archive.creatorLeaderboard()).toEqual([
      { sourceId: "source-a", sourceName: "Recipient's recorded name", walletAddress: ALICE, totalEarnedMicroUsdc: 100003, paymentCount: 1, citationCount: 1 },
      { sourceId: "source-a", sourceName: "Latest recorded creator", walletAddress: BOB, totalEarnedMicroUsdc: 100003, paymentCount: 2, citationCount: 1 },
      { sourceId: "source-b", sourceName: "Another source", walletAddress: ALICE, totalEarnedMicroUsdc: 100003, paymentCount: 1, citationCount: 1 },
    ]);
    expect((await archive.summary()).settledCreatorCount).toBe(2);
  });

  it("reads complete creator history beyond query paging limits and sums integer units exactly", async () => {
    const f = fixture();
    revise(f, writer => {
      const insert = writer.prepare(`INSERT INTO payment_events(id,created_at,kind,source_id,source_name,payee,amount_usdc,network,settled,settlement_status,tx_hash)
        VALUES(?,'2026-09-01T12:00:00.000Z','fetch',?,'Historical source',?,0.000001,'eip155:5042002',1,'settled','original-evidence')`);
      for (let index = 0; index < 2601; index++) insert.run(`old-${index}`, `old-source-${index}`, BOB);
    });
    const archive = await open();
    const creators = await archive.creatorLeaderboard();
    expect(creators).toHaveLength(2602);
    expect(creators[0].totalEarnedMicroUsdc).toBe(100003);
    expect(creators.slice(1).every(creator => creator.totalEarnedMicroUsdc === 1 && creator.paymentCount === 1 && creator.citationCount === 0)).toBe(true);
    expect(creators.reduce((sum, creator) => sum + creator.totalEarnedMicroUsdc, 0)).toBe(102604);
    expect((await archive.summary()).settledCreatorMicroUsdc).toBe(102604);
  });

  it.each([undefined, "legacy"] as const)("keeps creator names usable with optional source schema %s", async metadata => {
    const f = fixture({ metadata, legacyStatus: true });
    revise(f, writer => writer.exec("UPDATE payment_events SET source_name=source_id WHERE id='fetch-settled'"));
    const archive = await open();
    expect(await archive.creatorLeaderboard()).toEqual([{ sourceId: "source-a", sourceName: "Creator", walletAddress: BOB,
      totalEarnedMicroUsdc: 100003, paymentCount: 2, citationCount: 1 }]);
  });

  it("uses immutable source name metadata only for missing recorded names, without reading payout or content", async () => {
    const f = fixture({ metadata: "legacy" });
    revise(f, writer => {
      writer.exec(`ALTER TABLE sources ADD COLUMN name TEXT;
        INSERT INTO sources(id,name,content,pay_to) VALUES('source-a','Archived creator name','paid-private-source-body-fixture','private-payout-fixture');
        UPDATE payment_events SET source_name=CASE WHEN id='fetch-settled' THEN '' ELSE source_id END;
        INSERT INTO payment_events(id,created_at,kind,source_id,source_name,payee,amount_usdc,network,settled,settlement_status,tx_hash)
          VALUES('named','2026-09-01T12:00:00.000Z','fetch','source-b','Recorded payment name','${ALICE}',0.000001,'eip155:5042002',1,'settled','original-evidence');
        INSERT INTO sources(id,name,content,pay_to) VALUES('source-b','Other metadata name','private-body','private-payout');`);
    });
    const before = readFileSync(f.database);
    const statements: string[] = [];
    const nativePrepare = DatabaseSync.prototype.prepare;
    vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, sql: string) {
      statements.push(sql);
      return nativePrepare.call(this, sql);
    });
    const archive = await open();
    const creators = await archive.creatorLeaderboard();
    expect(creators.map(creator => creator.sourceName)).toEqual(["Archived creator name", "Recorded payment name"]);
    const metadataReads = statements.filter(sql => /\bFROM\s+sources\b/i.test(sql));
    expect(metadataReads).toHaveLength(1);
    expect(metadataReads[0]).toMatch(/^SELECT id, name FROM sources WHERE id IN/);
    expect(JSON.stringify(creators)).not.toMatch(/paid-private-|private-payout|private-body/);
    expect(readFileSync(f.database)).toEqual(before);
  });

  it("falls back to the original source ID when no name is retained", async () => {
    const f = fixture();
    revise(f, writer => writer.exec("UPDATE payment_events SET source_name=NULL"));
    expect((await (await open()).creatorLeaderboard())[0].sourceName).toBe("source-a");
  });

  it("refuses unsafe cumulative creator amounts with a sanitized error", async () => {
    const f = fixture();
    revise(f, writer => writer.exec("UPDATE payment_events SET amount_usdc=5000000000 WHERE id IN ('citation-settled','fetch-settled')"));
    const archive = await open();
    await expect(archive.creatorLeaderboard()).rejects.toThrow(/^Historical testnet archive unavailable$/);
  });

  it("rechecks archive integrity before exposing a creator leaderboard", async () => {
    const f = fixture();
    const archive = await open();
    expect(await archive.creatorLeaderboard()).toHaveLength(1);
    f.writeManifest({ capturedAt: "2026-10-03T00:00:01.000Z" });
    await expect(archive.creatorLeaderboard()).rejects.toThrow(/^Historical testnet archive unavailable$/);
  });

  it("projects frozen source/item flags for legacy citations across every history read using metadata only", async () => {
    const f = fixture({ metadata: "flags" });
    const before = readFileSync(f.database);
    const statements: string[] = [];
    const nativePrepare = DatabaseSync.prototype.prepare;
    vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, sql: string) {
      statements.push(sql);
      return nativePrepare.call(this, sql);
    });
    const archive = await open();
    const run = (await archive.getQueryRun(IDS[0]))!;
    expect(run.answer).toBe(`${SYNTHETIC_EVIDENCE_NOTICE}\n\n${f.queries[0].answer}`);
    expect(run.confidence?.level).toBe("Low");
    expect(run.citations[0]).toMatchObject({ sourceId: "flagged-source", evidenceProvenance: "synthetic-demo" });
    expect(run.citations[0].itemTitle).toBeUndefined();
    expect(run.citations[0].contentReceipt).toBeUndefined();
    expect(run).toMatchObject({ id: IDS[0], createdAt: f.queries[0].createdAt, totalSpent: f.queries[0].totalSpent,
      totalToCreators: f.queries[0].totalToCreators });
    const recent = await archive.listRecentQueries(4);
    expect(recent.find(item => item.id === IDS[1])?.citations[0].evidenceProvenance).toBe("synthetic-demo");
    expect(recent.find(item => item.id === IDS[2])?.answer).toBe(f.queries[2].answer);
    expect(recent.find(item => item.id === IDS[2])?.citations[0].evidenceProvenance).toBeUndefined();
    expect((await archive.listQueryRunsByAsker(ALICE, 4)).every(item => item.answer.startsWith(SYNTHETIC_EVIDENCE_NOTICE))).toBe(true);
    expect((await archive.listFollowUps(IDS[0]))[0].answer).toBe(`${SYNTHETIC_EVIDENCE_NOTICE}\n\n${f.queries[3].answer}`);
    const iterated: QueryRun[] = [];
    for await (const item of archive.iterateRecentQueries(4)) iterated.push(item);
    expect(iterated).toEqual(recent);
    expect(readFileSync(f.database)).toEqual(before);
    expect(hash(f.database)).toBe(f.manifest.databaseSha256);
    const metadataReads = statements.filter(sql => /\bFROM\s+(sources|source_items)\b/i.test(sql));
    expect(metadataReads.length).toBeGreaterThan(0);
    expect(metadataReads.every(sql => /^SELECT id(?:,source_id)? FROM (sources|source_items)\s+WHERE evidence_provenance=/i.test(sql))).toBe(true);
    expect(JSON.stringify(recent)).not.toMatch(/paid-private-|private-payout-|private-decryption-/);
    expect((await archive.listPaymentsByQuery(IDS[0])).find(payment => payment.id === "citation-settled"))
      .toMatchObject({ settled: true, settlementStatus: "settled", txHash: "circle-settlement-1" });
  });

  it("falls back to checked fingerprints when frozen source tables predate provenance columns", async () => {
    const f = fixture({ synthetic: true, metadata: "legacy" });
    const archive = await open();
    expect((await archive.getQueryRun(IDS[0]))?.citations[0].evidenceProvenance).toBe("synthetic-demo");
    expect((await archive.listRecentQueries(4)).find(run => run.id === IDS[0])?.answer)
      .toBe(`${SYNTHETIC_EVIDENCE_NOTICE}\n\n${f.queries[0].answer}`);
    expect(hash(f.database)).toBe(f.manifest.databaseSha256);
  });

  it.each(["eip155:5042", "eip155:1", "arcTestnet", ""])("refuses foreign payment network %s even under a testnet manifest", async network => {
    fixture({ network });
    await expect(getTestnetArchive()).rejects.toThrow(/^Historical testnet archive unavailable$/);
  });

  it.each([
    { settled: 1, status: "settled", evidence: null },
    { settled: 1, status: "settled", evidence: " " },
    { settled: 0, status: "settled", evidence: "claimed-settlement" },
    { settled: 1, status: "pending", evidence: "claimed-settlement" },
    { settled: 1, status: "simulated", evidence: "claimed-settlement" },
    { settled: 1, status: "failed", evidence: "claimed-settlement" },
  ])("refuses fabricated or contradictory settled flags %j before they become reported money", async payment => {
    const f = fixture();
    const writer = new DatabaseSync(f.database);
    writer.prepare("UPDATE payment_events SET settled=?,settlement_status=?,tx_hash=? WHERE id='citation-settled'")
      .run(payment.settled, payment.status, payment.evidence);
    writer.close();
    f.writeManifest({ databaseSha256: hash(f.database) });
    await expect(getTestnetArchive()).rejects.toThrow(/^Historical testnet archive unavailable$/);
  });

  it.each([
    { network: "eip155:5042" }, { version: 2 }, { sourceCommit: "f9dca8d" },
    { databaseSha256: "0".repeat(64) }, { capturedAt: "yesterday" }, { custody: "should-not-be-imported" },
  ])("refuses an invalid manifest %j with a sanitized error", async override => {
    const f = fixture();
    f.writeManifest(override);
    await expect(getTestnetArchive()).rejects.toThrow(/^Historical testnet archive unavailable$/);
  });

  it("refuses corrupt query data while keeping a missing query distinguishable", async () => {
    const f = fixture();
    const writer = new DatabaseSync(f.database);
    writer.prepare("UPDATE query_runs SET data='{' WHERE id=?").run(IDS[0]);
    writer.close();
    f.writeManifest({ databaseSha256: hash(f.database) });
    const archive = await open();
    await expect(archive.getQueryRun(IDS[0])).rejects.toThrow(/^Historical testnet archive unavailable$/);
    expect(await archive.getQueryRun("missing")).toBeNull();
    await expect((async () => { for await (const run of archive.iterateRecentQueries(4)) void run; })()).rejects.toThrow(/^Historical testnet archive unavailable$/);
  });

  it("refuses a manifest replaced with identical bytes, including between iterator yields", async () => {
    const f = fixture();
    const archive = await open();
    const iterator = archive.iterateRecentQueries(4)[Symbol.asyncIterator]();
    expect((await iterator.next()).value?.id).toBe("child");
    const bytes = readFileSync(f.manifestPath);
    renameSync(f.manifestPath, f.manifestPath + ".original");
    writeFileSync(f.manifestPath, bytes);
    await expect(iterator.next()).rejects.toThrow(/^Historical testnet archive unavailable$/);
    await expect(archive.getQueryRun(IDS[0])).rejects.toThrow(/^Historical testnet archive unavailable$/);
    await expect(getTestnetArchive()).rejects.toThrow(/^Historical testnet archive unavailable$/);
  });

  it("refuses changed database identity without accepting the already-cached checksum", async () => {
    const f = fixture();
    const archive = await open();
    utimesSync(f.database, new Date("2026-10-01T00:00:00.000Z"), new Date("2026-10-01T00:00:00.000Z"));
    expect(hash(f.database)).toBe(f.manifest.databaseSha256);
    await expect(archive.getQueryRun(IDS[0])).rejects.toThrow(/^Historical testnet archive unavailable$/);
  });

  // Native SQLite on Windows locks the open file against replacement. Linux
  // production allows it, and the archive must refuse rebinding there as well.
  it.runIf(process.platform !== "win32")("refuses a database replaced with identical bytes", async () => {
    const f = fixture();
    const archive = await open();
    const bytes = readFileSync(f.database);
    renameSync(f.database, f.database + ".original");
    writeFileSync(f.database, bytes);
    await expect(archive.getQueryRun(IDS[0])).rejects.toThrow(/^Historical testnet archive unavailable$/);
  });

  it("refuses manifest edits and newly appearing journals without changing their bytes", async () => {
    const f = fixture();
    const archive = await open();
    writeFileSync(f.database + "-wal", "external-live-wal");
    await expect(archive.listRecentQueries(4)).rejects.toThrow(/^Historical testnet archive unavailable$/);
    expect(readFileSync(f.database + "-wal", "utf8")).toBe("external-live-wal");
    rmSync(f.database + "-wal");
    f.writeManifest({ capturedAt: "2026-10-03T00:00:01.000Z" });
    await expect(archive.summary()).rejects.toThrow(/^Historical testnet archive unavailable$/);
    expect(hash(f.database)).toBe(f.manifest.databaseSha256);
  });

  it.each(["-wal", "-shm", "-journal"])("refuses pre-existing %s sidecars", async suffix => {
    const f = fixture();
    writeFileSync(f.database + suffix, "external-journal-fixture");
    await expect(getTestnetArchive()).rejects.toThrow(/^Historical testnet archive unavailable$/);
    expect(readFileSync(f.database + suffix, "utf8")).toBe("external-journal-fixture");
  });

  it("refuses WAL-format archives before native SQLite can create any sidecar", async () => {
    const f = fixture();
    const writer = new DatabaseSync(f.database);
    writer.exec("PRAGMA journal_mode=WAL");
    writer.close();
    f.writeManifest({ databaseSha256: hash(f.database) });
    await expect(getTestnetArchive()).rejects.toThrow(/^Historical testnet archive unavailable$/);
    expect(existsSync(f.database + "-wal") || existsSync(f.database + "-shm")).toBe(false);
  });

  it("pages equal timestamps by ID without losing or repeating dispatches", async () => {
    const f = fixture();
    const writer = new DatabaseSync(f.database);
    for (const id of IDS) {
      const run = query(id, 0);
      writer.prepare("UPDATE query_runs SET created_at=?, data=? WHERE id=?").run(run.createdAt, JSON.stringify(run), id);
    }
    writer.close();
    f.writeManifest({ databaseSha256: hash(f.database) });
    const archive = await open();
    const first = await archive.listRecentQueries(2);
    const second = await archive.listRecentQueries(2, { createdAt: first[1].createdAt, id: first[1].id });
    expect([...first, ...second].map(run => run.id)).toEqual(["child", ...[...IDS].sort().reverse()]);
    expect(await archive.listRecentQueries(2, { createdAt: second[1].createdAt, id: second[1].id })).toEqual([]);
    const iterated: string[] = [];
    for await (const run of archive.iterateRecentQueries(4)) iterated.push(run.id);
    expect(iterated).toEqual([...first, ...second].map(run => run.id));
  });

  it.each([0, -1, 2501, 1.5, NaN])("bounds native archive scans at limit %s", async limit => {
    fixture();
    const archive = await open();
    await expect(archive.listRecentQueries(limit)).rejects.toThrow("Invalid archive query limit");
    await expect(archive.listQueryRunsByAsker(ALICE, limit)).rejects.toThrow("Invalid archive query limit");
    await expect((async () => { for await (const run of archive.iterateRecentQueries(limit)) void run; })()).rejects.toThrow("Invalid archive query limit");
  });
});
