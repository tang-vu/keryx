/** Genuine disposable selected native SQLite. All runs are offline and every
 * payment is simulated; no fabricated real-mode settlement, provider or signing. */
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { canonicalJson } from "../canonical-json";
import { ledgerRun, LEDGER_FIXTURE_TIME } from "../operator-ledger/test-fixture";
import { captureLedgerRun } from "../operator-ledger/capture";
import { readOperatorLedger } from "../operator-ledger/read";
import { createEnrolledSqliteRunPrivacy } from "./run-privacy-sqlite";
import { projectRecordedEvidenceProvenanceList } from "../research/evidence-provenance";
import { SEED_EVIDENCE_FINGERPRINTS } from "../research/seed-evidence-fingerprints";
import { createEnrolledSqlitePublicLedgerRuns } from "./public-ledger-sqlite";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { insertStorageIdentity, installStorageFences, registerStorageCapability } from "./storage-identity-sqlite";
import { openVerifiedSqliteStorage } from "./storage-identity-connection";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { inspectStorageDeploymentManifest } from "./runtime-storage-config";
import { writeSqliteQueryRun } from "./query-run-record";

let folder: string, template: string, serial = 0;
const opened: Array<{ close(): void }> = [];
const network = "eip155:5042";
beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), "keryx-public-ledger-pages-"));template = join(folder, "full-user-template.sqlite");
  const db = new DatabaseSync(template);
  try { db.exec("BEGIN IMMEDIATE");installMainnetApplicationSchema(db);installNativeUserDomainSchema(db);db.exec("COMMIT"); }
  finally { db.close(); }
  supportedSqliteApplicationProfiles(true);
});
afterEach(() => { vi.restoreAllMocks();for (const connection of opened.splice(0).reverse()) { try { connection.close(); } catch { /* already retired */ } } vi.unstubAllEnvs(); });
afterAll(() => {
  if (!resolve(folder).startsWith(resolve(tmpdir()) + sep) || !folder.includes("keryx-public-ledger-pages-")) throw Error("Unsafe fixture cleanup");
  rmSync(folder, { recursive: true, force: true });
});
function fixture(seed: (db: DatabaseSync) => void = () => {}) {
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "false");vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "false");
  const file = join(folder, `case-${++serial}.sqlite`), manifestPath = join(folder, `case-${serial}.json`);
  copyFileSync(template, file);
  const identity: StorageIdentity = { ...syntheticStorageIdentity("mainnet-real"), format: "keryx-mainnet-storage-identity-v1", network, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  const db = new DatabaseSync(file);
  try { db.exec("BEGIN IMMEDIATE");seed(db);insertStorageIdentity(db, identity);installStorageFences(db, identity);db.exec("COMMIT"); }
  finally { db.close(); }
  const manifest = canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } });
  writeFileSync(manifestPath, manifest);
  const runtimeGuard = () => { if (canonicalJson(inspectStorageDeploymentManifest({ KERYX_STORAGE_MANIFEST: manifestPath })) !== manifest) throw Error("Synthetic manifest changed"); };
  const open = (selected = true) => {
    vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true");
    const connection = openVerifiedSqliteStorage(file, identity, { readOnly: true, applicationProfiles: supportedSqliteApplicationProfiles(true), ...(selected ? { runtimeGuard } : {}) });
    opened.push(connection);return connection;
  };
  const edit = (action: (db: DatabaseSync) => void) => {
    const db = new DatabaseSync(file);try { registerStorageCapability(db, identity, () => true);action(db); } finally { db.close(); }
  };
  return { file, manifestPath, manifest, open, edit };
}
function add(db: DatabaseSync, id: string, visibility = "public", overrides: Parameters<typeof ledgerRun>[0] = {}) {
  const run = ledgerRun({ id, paymentMode: "offline", fundingOwner: "offline", settledPayments: 0, ...overrides });
  writeSqliteQueryRun(db, run, false);
  db.prepare("UPDATE run_privacy SET visibility=? WHERE run_id=?").run(visibility, id);return run;
}

it("refuses raw, spoofed, unselected and extra configuration without invoking caller callbacks", () => {
  const f = fixture(), connection = f.open(), raw = new DatabaseSync(f.file);opened.push(raw);
  const callback = vi.fn();expect(() => createEnrolledSqlitePublicLedgerRuns({ prepare: callback } as unknown as DatabaseSync)).toThrow();expect(callback).not.toHaveBeenCalled();
  expect(() => createEnrolledSqlitePublicLedgerRuns(raw)).toThrow();
  expect(() => Reflect.apply(createEnrolledSqlitePublicLedgerRuns, null, [connection.db, callback])).toThrow();expect(callback).not.toHaveBeenCalled();
  const unselected = f.open(false);expect(() => createEnrolledSqlitePublicLedgerRuns(unselected.db)).toThrow();
});

it("sorts bounded public metadata, counts excluded positions and retains no original bodies", () => {
  const f = fixture(db => {
    for (const id of ["a", "b", "c"]) add(db, id);
    add(db, "d", "public", { originalFulfillment: null } as unknown as Parameters<typeof ledgerRun>[0]);
    add(db, "z-private", "private");add(db, "z-unlisted", "unlisted");
    add(db, "z-erased");db.prepare("UPDATE run_privacy SET erased=1 WHERE run_id='z-erased'").run();
  });
  const before = readFileSync(f.file), port = createEnrolledSqlitePublicLedgerRuns(f.open().db);
  expect(Object.isFrozen(port)).toBe(true);expect(Object.keys(port)).toEqual(["read"]);
  const first = port.read(2);expect(first.map(s => s?.id ?? null)).toEqual([null, "c"]);
  const second = port.read(4);expect(second.map(s => s?.id ?? null)).toEqual([null, "c", "b", "a"]);
  expect(port.read(10)).toHaveLength(4);
  const serialized = JSON.stringify([first, second]);expect(serialized).not.toMatch(/PRIVATE-|z-private|z-unlisted|z-erased|question|answer|rationale|trace|asker/);
  expect(readFileSync(f.file)).toEqual(before);
});

it("matches the existing full privacy/provenance projection, including stored flags and seed fingerprints", async () => {
  const expected: ReturnType<typeof ledgerRun>[] = [];
  const f = fixture(db => {
    db.prepare("INSERT INTO sources(id,name,url,tags,fetch_price,evidence_provenance) VALUES(?,?,?,?,?,?)")
      .run("creator-one", "Synthetic source", "https://fixture.example/source", "[]", 0, "synthetic-demo");
    db.prepare("INSERT INTO source_items(id,source_id,title,link,evidence_provenance) VALUES(?,?,?,?,?)")
      .run("item-one", "other-creator", "Synthetic item", "https://fixture.example/item", "synthetic-demo");
    expected.push(add(db, "source-flag"));
    expected.push(add(db, "item-flag", "public", { decisions: [{ ...ledgerRun().decisions[0], sourceId: "other-creator", itemId: "item-one" }] }));
    const seed = SEED_EVIDENCE_FINGERPRINTS[0];
    expected.push(add(db, "fingerprint", "public", { decisions: [{ ...ledgerRun().decisions[0], sourceId: "seed-source", itemTitle: seed.itemTitle, itemUrl: seed.itemUrl,
      contentReceipt: { bodyHash: seed.bodyHash, deliveryKind: "full_text", storageMode: "db_plaintext", plaintextBytes: 100 } }] }));
  });
  const connection = f.open(), privacy = createEnrolledSqliteRunPrivacy(connection.db);
  const full = await projectRecordedEvidenceProvenanceList(async () => new Set(["source:creator-one", "item:other-creator:item-one"]), await privacy.list({ take: 32 }));
  const page = createEnrolledSqlitePublicLedgerRuns(connection.db).read(251);
  expect(page).toEqual(full.map(captureLedgerRun));
  expect(page.every(s => s!.references[0].synthetic)).toBe(true);
  expect(expected).toHaveLength(3);
});

it("bounds actual native body allocations at four byte-guarded originals without a data sorter", () => {
  const f = fixture(db => { for (let n = 0; n < 17; n++) add(db, `large-${String(n).padStart(2, "0")}`, "public", { answer: "PRIVATE-LARGE-BODY".repeat(50_000), trace: [] }); });
  const connection = f.open(), port = createEnrolledSqlitePublicLedgerRuns(connection.db), original = DatabaseSync.prototype.prepare;
  let bodies = 0, batches = 0;
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function(this: DatabaseSync, sql: string) {
    const statement = Reflect.apply(original, this, [sql]);
    if (!sql.includes("THEN q.data END AS data FROM query_runs")) return statement;
    expect(sql).not.toMatch(/ORDER BY/);
    expect(sql).toContain("length(CAST(q.data AS BLOB))<=4000000");
    return new Proxy(statement, { get(target, key) {
      if (key === "all") return (...args: unknown[]) => {
        const rows = Reflect.apply(target.all, target, args);batches++;bodies += rows.length;
        expect(rows.length).toBeLessThanOrEqual(4);
        expect(rows.reduce((sum: number, row: { data: unknown }) => sum + Buffer.byteLength(String(row.data)), 0)).toBeLessThanOrEqual(16_000_000);return rows;
      };
      const value = Reflect.get(target, key, target);return typeof value === "function" ? value.bind(target) : value;
    } });
  });
  const page = port.read(251);expect(page).toHaveLength(17);expect(bodies).toBe(17);expect(batches).toBe(5);
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(16_000);expect(JSON.stringify(page)).not.toContain("PRIVATE-LARGE-BODY");
});

it("sees withdrawal between captures and permanently refuses a changed runtime manifest", () => {
  const f = fixture(db => { add(db, "a");add(db, "b"); }), port = createEnrolledSqlitePublicLedgerRuns(f.open().db);
  const first = port.read(1);expect(first[0]?.id).toBe("b");
  f.edit(db => db.prepare("UPDATE run_privacy SET visibility='private' WHERE run_id='a'").run());
  expect(port.read(2).map(s => s?.id)).toEqual(["b"]);
  writeFileSync(f.manifestPath, "{}");expect(() => port.read(1)).toThrow();
  writeFileSync(f.manifestPath, f.manifest);expect(() => port.read(1)).toThrow();
});

it("refuses a privacy-policy change rather than downgrading to an ordinary reader", () => {
  const f = fixture(db => add(db, "a")), port = createEnrolledSqlitePublicLedgerRuns(f.open().db);
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "false");expect(() => port.read(1)).toThrow();
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true");expect(() => port.read(1)).toThrow();
});

it("rejects a changed manifest during the real body read before metadata escapes", () => {
  const f = fixture(db => add(db, "a")), port = createEnrolledSqlitePublicLedgerRuns(f.open().db), original = DatabaseSync.prototype.prepare;
  let observed = false;
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function(this: DatabaseSync, sql: string) {
    const statement = Reflect.apply(original, this, [sql]);
    if (!sql.includes("THEN q.data END AS data FROM query_runs")) return statement;
    return new Proxy(statement, { get(target, key) {
      if (key === "all") return (...args: unknown[]) => { const rows = Reflect.apply(target.all, target, args);observed = true;writeFileSync(f.manifestPath, "{}");return rows; };
      const value = Reflect.get(target, key, target);return typeof value === "function" ? value.bind(target) : value;
    } });
  });
  expect(() => port.read(1)).toThrow();expect(observed).toBe(true);
});

it("drops metadata withdrawn by a real writer at snapshot commit", () => {
  const f = fixture(db => add(db, "a")), port = createEnrolledSqlitePublicLedgerRuns(f.open().db);
  const prepare = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec;let selected = false, withdrawn = false;
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function(this: DatabaseSync, sql: string) {
    if (sql.includes("THEN q.data END AS data FROM query_runs")) selected = true;
    return Reflect.apply(prepare, this, [sql]);
  });
  vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function(this: DatabaseSync, sql: string) {
    const result = Reflect.apply(exec, this, [sql]);
    if (selected && !withdrawn && sql === "COMMIT" && this.location("main") === f.file) {
      withdrawn = true;f.edit(db => db.prepare("UPDATE run_privacy SET visibility='private' WHERE run_id='a'").run());
    }
    return result;
  });
  expect(port.read(1)).toEqual([null]);expect(withdrawn).toBe(true);
});

it("refuses newly unknown schema between captures without repair or fallback", () => {
  const f = fixture(db => { add(db, "a");add(db, "b"); }), port = createEnrolledSqlitePublicLedgerRuns(f.open().db);
  port.read(1);
  f.edit(db => db.exec("CREATE TABLE unreviewed_ledger_test(id TEXT)"));
  expect(() => port.read(1)).toThrow();
});

it.each([0, 252, 1.5])("refuses an invalid capture bound %s", take => {
  const f = fixture(), port = createEnrolledSqlitePublicLedgerRuns(f.open().db);
  expect(() => port.read(take)).toThrow();
});

it("refuses malformed or misbound original data without emitting metadata", () => {
  for (const data of ['{"id":"a"}', JSON.stringify(ledgerRun({ id: "other", paymentMode: "offline", fundingOwner: "offline" }))]) {
    const f = fixture(db => { add(db, "a");db.prepare("UPDATE query_runs SET data=? WHERE id='a'").run(data); });
    const port = createEnrolledSqlitePublicLedgerRuns(f.open().db);expect(() => port.read(1)).toThrow();
  }
});

it("refuses oversized raw JSON in SQL before allocating its original body", () => {
  const f = fixture(db => {
    const run = add(db, "a");db.prepare("UPDATE query_runs SET data=? WHERE id='a'").run(" ".repeat(4_000_000) + JSON.stringify(run));
  });
  const port = createEnrolledSqlitePublicLedgerRuns(f.open().db), prepare = DatabaseSync.prototype.prepare;let observed = false;
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function(this: DatabaseSync, sql: string) {
    const statement = Reflect.apply(prepare, this, [sql]);
    if (!sql.includes("THEN q.data END AS data FROM query_runs")) return statement;
    return new Proxy(statement, { get(target, key) {
      if (key === "all") return (...args: unknown[]) => {
        const rows = Reflect.apply(target.all, target, args);observed = true;expect(rows).toHaveLength(1);expect(rows[0].data).toBeNull();return rows;
      };
      const value = Reflect.get(target, key, target);return typeof value === "function" ? value.bind(target) : value;
    } });
  });
  expect(() => port.read(1)).toThrow();expect(observed).toBe(true);
});

it("exposes metadata only through the genuine selected native facade and keeps the legacy ledger output exact", async () => {
  const f = fixture(db => {
    db.prepare("INSERT INTO sources(id,name,url,tags,fetch_price,evidence_provenance) VALUES(?,?,?,?,?,?)")
      .run("creator-one", "Synthetic source", "https://fixture.example/source", "[]", 0, "synthetic-demo");
    add(db, "a");add(db, "b");add(db, "hidden", "private");
    db.prepare(`INSERT INTO payment_events(id,created_at,kind,query_id,source_id,source_name,payer,payee,amount_usdc,network,settled,settlement_status,origin)
      VALUES('simulated-one',?,'fetch','a','creator-one','Synthetic',?,?,0.000003,?,0,'simulated','web')`)
      .run(LEDGER_FIXTURE_TIME, `0x${"a".repeat(40)}`, `0x${"b".repeat(40)}`, network);
  });
  vi.resetModules();vi.stubEnv("KERYX_NETWORK", "arc");vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arc");vi.stubEnv("KERYX_FORCE_OFFLINE", "0");
  vi.stubEnv("KERYX_REGISTRY_ADDRESS", `0x${"3".repeat(40)}`);vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS", `0x${"3".repeat(40)}`);
  vi.stubEnv("KERYX_STORAGE_MANIFEST", f.manifestPath);vi.stubEnv("KERYX_SQLITE_PATH", f.file);vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true");
  vi.stubEnv("CONTENT_MASTER_KEY", "11".repeat(32));
  const { createReadonlyApplicationStorage, closeReadonlyApplicationStorage } = await import("./application-storage");
  const reader = await createReadonlyApplicationStorage();expect(reader).toBeDefined();
  try {
    expect(Object.getOwnPropertyDescriptor(reader!, "publicLedgerRuns")?.enumerable).toBe(false);
    const before = readFileSync(f.file);
    const legacy = await readOperatorLedger({ iterateRecentQueries: reader!.iterateRecentQueries.bind(reader), listPayments: reader!.listPayments.bind(reader) }, network, 7, () => LEDGER_FIXTURE_TIME);
    const native = await readOperatorLedger(reader!, network, 7, () => LEDGER_FIXTURE_TIME);
    expect(native).toEqual(legacy);expect(native.payload.jobs).toHaveLength(2);expect(native.payload.entries).toEqual([]);
    expect(native.payload.jobs.flatMap(j => j.legs).every(l => l.state === "uncertain" && l.reason === "synthetic-demo")).toBe(true);expect(readFileSync(f.file)).toEqual(before);
  } finally { if (reader) closeReadonlyApplicationStorage(reader); }
}, 30_000);

it("serves the actual HTTP JSON and CSV routes through selected native metadata without generic hydration", async () => {
  const f = fixture(db => add(db, "http-native", "public", { createdAt: new Date().toISOString() }));
  vi.resetModules();vi.stubEnv("KERYX_NETWORK", "arc");vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arc");vi.stubEnv("KERYX_FORCE_OFFLINE", "0");
  vi.stubEnv("KERYX_REGISTRY_ADDRESS", `0x${"3".repeat(40)}`);vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS", `0x${"3".repeat(40)}`);
  vi.stubEnv("KERYX_STORAGE_MANIFEST", f.manifestPath);vi.stubEnv("KERYX_SQLITE_PATH", f.file);vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true");vi.stubEnv("CONTENT_MASTER_KEY", "11".repeat(32));
  const outbound = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw Error("Native HTTP fixture network denied"); });
  const { SqliteAdapter } = await import("./sqlite-adapter");
  const generic = vi.spyOn(SqliteAdapter.prototype, "iterateRecentQueries");
  const json = await import("../../app/api/operator/ledger/route");
  const before = readFileSync(f.file);
  const response = await json.GET(new Request("http://fixture.local/api/operator/ledger?days=7"));
  expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toContain("no-store");
  const body = await response.json();expect(body.payload.jobs.map((j: {id:string}) => j.id)).toEqual(["http-native"]);expect(body.payload.entries).toEqual([]);
  expect(JSON.stringify(body)).not.toMatch(/PRIVATE-|question|answer|rationale|trace/);
  const exported = await json.GET(new Request("http://fixture.local/api/operator/ledger?days=7&format=csv"));
  expect(exported.status).toBe(200);expect(exported.headers.get("cache-control")).toContain("no-store");
  expect(await exported.text()).not.toMatch(/PRIVATE-/);expect(generic).not.toHaveBeenCalled();expect(outbound).not.toHaveBeenCalled();expect(readFileSync(f.file)).toEqual(before);
}, 30_000);
