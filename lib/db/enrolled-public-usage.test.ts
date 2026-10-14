/** UNRUN by the source author. Genuine disposable native SQLite and real selector/routes.
 * Every observation is synthetic; no provider, signature, spending or live settlement. */
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { canonicalJson } from "../canonical-json";
import type { QueryRun } from "../types";
import { createTrustedUsageContext, newRunUsage, type RunUsage } from "../research/usage-provenance";
import { MAX_USAGE_BYTES, MAX_USAGE_PAYMENTS, MAX_USAGE_RUNS, UsageUnavailable, usageWindow } from "../usage/contracts";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { insertStorageIdentity, installStorageFences, registerStorageCapability } from "./storage-identity-sqlite";
import { openVerifiedSqliteStorage } from "./storage-identity-connection";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { inspectStorageDeploymentManifest } from "./runtime-storage-config";
import { createEnrolledSqlitePublicUsage, createSqlitePublicUsage } from "./public-usage-sqlite";
import { writeSqliteQueryRun } from "./query-run-record";

const network = "eip155:5042", wallet = `0x${"a".repeat(40)}`, payee = `0x${"b".repeat(40)}`;
const date = "2026-10-10T00:00:00.000Z";
const window = usageWindow(new URLSearchParams(), network, new Date("2026-10-15T00:00:00.000Z"));
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
let folder: string, before: string, full: string, serial = 0;
const opened: Array<{ close(): void }> = [];

// These hashes bind explicit synthetic fixture facts. They are never positive
// ownership, production actor evidence or proof of an actual transfer.
function run(id: string, cohort: RunUsage["cohort"] = "unknown", createdAt = date): QueryRun {
  const facts = { actor: cohort === "outside" ? "outside" as const : cohort === "team" ? "team" as const : "unknown" as const,
    funding: cohort === "outside" ? "independent" as const : cohort === "team" ? "team" as const : "unknown" as const,
    scripted: cohort === "scripted" };
  const usageContext = createTrustedUsageContext(network, { ...facts,
    actorEvidenceSha256: hash(canonicalJson({ syntheticFixture: id, actor: facts.actor })),
    fundingEvidenceSha256: hash(canonicalJson({ syntheticFixture: id, funding: facts.funding })) });
  return { id, createdAt, asker: wallet, question: `Synthetic private question ${id}`, answer: `Synthetic body ${id}`,
    budget: 0, engine: "heuristic", totalSpent: 0, totalToCreators: 0, paymentMode: "offline",
    subClaims: [], decisions: [], citations: [], trace: [],
    usage: newRunUsage({ usageContext }, network, []), provenance: { version: 1, surface: "api", ownershipMethod: "unknown" } };
}
function save(db: DatabaseSync, id: string, cohort: RunUsage["cohort"] = "unknown", visibility = "public", createdAt = date) {
  writeSqliteQueryRun(db, run(id, cohort, createdAt), false);
  if (db.prepare("SELECT 1 FROM sqlite_schema WHERE name='run_privacy'").get())
    db.prepare("UPDATE run_privacy SET visibility=? WHERE run_id=?").run(visibility, id);
}
function payment(db: DatabaseSync, id: string, queryId: string, amount = 0.000003,
  status = "settled", reference: string | null = "synthetic-recorded-reference", rail: string = network, settled = 1) {
  db.prepare(`INSERT INTO payment_events(id,query_id,network,kind,amount_usdc,settled,settlement_status,tx_hash,payee,created_at)
    VALUES(?,?,?,'fetch',?,?,?,?,?,?)`).run(id, queryId, rail, amount, settled, status, reference, payee, date);
}
beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), "keryx-synthetic-native-usage-"));
  before = join(folder, "before.sqlite"); full = join(folder, "full19.sqlite");
  for (const [file, bundle] of [[before, false], [full, true]] as const) {
    const db = new DatabaseSync(file);
    try { db.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(db);
      if (bundle) installNativeUserDomainSchema(db); db.exec("COMMIT");
    } finally { db.close(); }
  }
  supportedSqliteApplicationProfiles(true); // Source reference warmup, outside observation windows.
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const connection of opened.splice(0).reverse()) connection.close();
  vi.unstubAllEnvs();
});
afterAll(() => {
  if (folder) {
    if (!resolve(folder).startsWith(resolve(tmpdir()) + sep) || !folder.includes("keryx-synthetic-native-usage-")) throw Error("Unsafe fixture cleanup");
    rmSync(folder, { recursive: true, force: true });
  }
});
function fixture(seed: (db: DatabaseSync) => void = () => {}, bundle = true, wal = false) {
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "false"); vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "false");
  const file = join(folder, `case-${++serial}.sqlite`), manifestPath = join(folder, `case-${serial}.json`);
  copyFileSync(bundle ? full : before, file);
  const identity: StorageIdentity = { ...syntheticStorageIdentity("mainnet-real"), format: "keryx-mainnet-storage-identity-v1",
    network, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  const db = new DatabaseSync(file);
  try {
    if (wal) db.exec("PRAGMA journal_mode=WAL");
    db.exec("BEGIN IMMEDIATE"); seed(db); insertStorageIdentity(db, identity); installStorageFences(db, identity); db.exec("COMMIT");
  } finally { db.close(); }
  const manifest = canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } });
  writeFileSync(manifestPath, manifest);
  const edit = (action: (raw: DatabaseSync) => void) => {
    const raw = new DatabaseSync(file);
    try { registerStorageCapability(raw, identity, () => true); action(raw); } finally { raw.close(); }
  };
  const native = (readOnly = true, runtimeGuard?: () => void) => {
    const connection = openVerifiedSqliteStorage(file, identity, { readOnly,
      runtimeGuard: () => {
        if (canonicalJson(inspectStorageDeploymentManifest({ KERYX_STORAGE_MANIFEST: manifestPath })) !== manifest)
          throw Error("Synthetic manifest guard changed");
        runtimeGuard?.();
      }, applicationProfiles: supportedSqliteApplicationProfiles(true) });
    opened.push(connection);
    return { connection, port: createEnrolledSqlitePublicUsage(connection.db) };
  };
  return { file, identity, manifestPath, manifest, edit, native };
}
function originals(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return canonicalJson({ schema: db.prepare("SELECT name,type,tbl_name,sql FROM sqlite_schema ORDER BY name").all(),
    runs: db.prepare("SELECT * FROM query_runs ORDER BY id").all(), money: db.prepare("SELECT * FROM payment_events ORDER BY id").all() });
  } finally { db.close(); }
}
async function select(f: ReturnType<typeof fixture>, active = false) {
  vi.resetModules();
  vi.stubEnv("KERYX_NETWORK", "arc"); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arc");
  vi.stubEnv("KERYX_STORAGE_MANIFEST", f.manifestPath); vi.stubEnv("KERYX_SQLITE_PATH", f.file);
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0"); vi.stubEnv("CONTENT_MASTER_KEY", "11".repeat(32));
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", active ? "true" : "false");
  (await import("./enrolled-sqlite-schema-profile")).supportedSqliteApplicationProfiles(true);
  const api = await import("./enrolled-sqlite-adapter");
  return { api, db: await import("./index"), figures: await import("../../app/api/usage/route"), history: await import("../../app/api/runs/route") };
}
function observeSql() {
  // Spies delegate every call to the real DatabaseSync methods. No output or
  // authority is mocked; compare constructor/request calls to mutation verbs.
  const exec = vi.spyOn(DatabaseSync.prototype, "exec"), prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
  const writes = () => [...exec.mock.calls, ...prepare.mock.calls].map(call => call[0])
    .filter(sql => /(?:^|;)\s*(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE|VACUUM|REINDEX|ATTACH|DETACH)\b/i.test(sql));
  return { exec, prepare, writes };
}
function afterPublicSelection(effect: () => void) {
  let scheduled = false;
  const original = DatabaseSync.prototype.prepare;
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, query: string) {
    const statement = Reflect.apply(original, this, [query]);
    if (!/SELECT q\.data FROM query_runs q JOIN run_privacy p/.test(query)) return statement;
    return new Proxy(statement, { get(target, key) {
      if (key === "all") return (...args: unknown[]) => {
        const rows = Reflect.apply(target.all, target, args);
        if (rows.length && !scheduled) { scheduled = true; queueMicrotask(effect); }
        return rows;
      };
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
  });
  return () => scheduled;
}

it("rejects raw/spoof/extra configuration without invoking spoof callbacks and keeps ordinary enrolled refusal", () => {
  const f = fixture(), { connection } = f.native(), raw = new DatabaseSync(f.file); opened.push(raw);
  const close = vi.fn(); expect(() => createEnrolledSqlitePublicUsage({ close } as unknown as DatabaseSync)).toThrow(UsageUnavailable);
  expect(close).not.toHaveBeenCalled(); expect(() => createEnrolledSqlitePublicUsage(raw)).toThrow(UsageUnavailable);
  expect(() => Reflect.apply(createEnrolledSqlitePublicUsage, undefined, [connection.db, { privacy: false }])).toThrow(UsageUnavailable);
  expect(() => createSqlitePublicUsage(raw)).toThrow(); expect(() => createSqlitePublicUsage(connection.db)).toThrow();
});
it("restores the actual selected writable/readonly frozen facade and API200 without DDL/DML or original byte changes", async () => {
  const f = fixture(db => { save(db, "outside", "outside"); payment(db, "recorded", "outside"); });
  const actual = await select(f), bytes = readFileSync(f.file), original = originals(f.file), sql = observeSql();
  const writer = await actual.db.getDb(); opened.push({ close: () => { if ("close" in writer && typeof writer.close === "function") writer.close(); } });
  const reader = await actual.api.createReadonlyEnrolledSqliteAdapter(); opened.push(reader);
  expect(actual.api.assertEnrolledSqliteAdapter(writer)).toEqual(f.identity);
  for (const db of [writer, reader]) {
    expect(Object.isFrozen(db)).toBe(true); expect(Object.isFrozen(db.publicUsage)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(db, "publicUsage")).toMatchObject({ enumerable: false, writable: false, configurable: false });
    expect(Reflect.get(db.publicUsage!, "db")).toBeUndefined();
    expect((await db.publicUsage!.summary(window)).columns[0].settledMicros).toBe("3");
    expect((await db.publicUsage!.history(window, "outside", 1)).map(row => row.id)).toEqual(["outside"]);
  }
  const figures = await actual.figures.GET(new Request("https://synthetic.example/api/usage"));
  expect(figures.status).toBe(200); expect(await figures.json()).toMatchObject({ complete: true, basis: "complete-bounded-database-window" });
  const history = await actual.history.GET(new Request("https://synthetic.example/api/runs?cohort=outside"));
  expect(history.status).toBe(200); expect((await history.json()).map((row: { id: string }) => row.id)).toEqual(["outside"]);
  expect((await actual.figures.GET(new Request("https://synthetic.example/api/usage?network=invalid"))).status).toBe(400);
  expect((await actual.history.GET(new Request("https://synthetic.example/api/runs?cohort=invalid"))).status).toBe(400);
  expect(sql.writes()).toEqual([]); sql.exec.mockRestore(); sql.prepare.mockRestore();
  expect(originals(f.file)).toBe(original); expect(readFileSync(f.file)).toEqual(bytes);
});
it("accounts for all four privacy cohorts with exact micros and excludes pending/unproved/nonpositive records and private identifiers", async () => {
  const f = fixture(db => {
    for (const [id, cohort, visibility] of [["outside", "outside", "private"], ["team", "team", "public"],
      ["script", "scripted", "unlisted"], ["unknown", "unknown", "private"]] as const) {
      save(db, id, cohort, visibility); payment(db, `settled-${id}`, id);
    }
    db.prepare("UPDATE run_privacy SET erased=1 WHERE run_id='unknown'").run();
    payment(db, "pending", "outside", 99, "pending", "synthetic-pending", network, 0);
    payment(db, "unproved", "outside", 99, "settled", null); payment(db, "wrong-status", "outside", 99, "simulated");
    payment(db, "zero", "outside", 0); payment(db, "negative", "outside", -1);
  });
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true");
  const saved = originals(f.file), { port } = f.native(), result = await port.summary(window);
  expect(result.columns.map(row => row.researchRuns)).toEqual([1, 1, 1, 1]);
  expect(result.columns.map(row => row.settledMicros)).toEqual(["3", "3", "3", "3"]);
  expect(result.columns[0].independentPayingRuns).toBe(1); expect(result.columns[1].teamFundedPayingRuns).toBe(1);
  expect(result.columns.every(row => row.people === 0 && row.acceptedDeliverables === null && row.medianTimeToFirstAnswerMs === null)).toBe(true);
  expect(result.excludedPayments).toBe(5); expect(JSON.stringify(result)).not.toContain(wallet);
  expect(JSON.stringify(result)).not.toContain("Synthetic private question"); expect(originals(f.file)).toBe(saved);
});
it("keeps legacy networks unattributed unless every payment agrees, and malformed provenance never creates people", async () => {
  const f = fixture(db => {
    for (const id of ["legacy-one", "legacy-mixed", "legacy-unpaid", "testnet", "bad-provenance"]) save(db, id);
    db.prepare("UPDATE query_runs SET data=json_remove(data,'$.usage') WHERE id LIKE 'legacy-%'").run();
    db.prepare("UPDATE query_runs SET data=json_set(data,'$.usage.network','eip155:5042002') WHERE id='testnet'").run();
    db.prepare("UPDATE query_runs SET data=json_set(data,'$.provenance',json(?)) WHERE id='bad-provenance'").run('{"version":999,"ownershipMethod":"siwe"}');
    payment(db, "one", "legacy-one"); payment(db, "mixed-a", "legacy-mixed");
    payment(db, "mixed-b", "legacy-mixed", 0.000003, "settled", "synthetic-testnet-reference", "eip155:5042002");
  });
  const saved = originals(f.file), { port } = f.native();
  const result = await port.summary(window); expect(result.unattributedNetworkRuns).toBe(2);
  expect(result.columns.map(row => row.researchRuns)).toEqual([0, 0, 0, 2]); expect(result.columns[3].settledMicros).toBe("3");
  expect(result.columns.every(row => row.people === 0)).toBe(true);
  expect((await port.summary({ ...window, network: "eip155:5042002" })).columns[3].researchRuns).toBe(1);
  expect(originals(f.file)).toBe(saved);
});
it("classifies the complete window before page selection, including older outside rows behind scripts", async () => {
  const f = fixture(db => {
    save(db, "outside-old", "outside", "public", "2026-10-01T00:00:00.000Z");
    for (let i = 0; i < 101; i++) save(db, `script-${i}`, "scripted"); save(db, "unknown");
  });
  const { port } = f.native(); expect((await port.history(window, "outside", 1)).map(row => row.id)).toEqual(["outside-old"]);
  expect((await port.history(window, "default", 2)).map(row => row.id)).toEqual(["unknown", "outside-old"]);
  expect((await port.summary(window)).columns.map(row => row.researchRuns)).toEqual([1, 0, 101, 1]);
});
it("uses public-only native privacy on readonly history and never selects an OFF reader after ENVfalse", async () => {
  const f = fixture(db => {
    for (const visibility of ["public", "private", "unlisted"]) save(db, visibility, "outside", visibility);
    save(db, "erased", "outside"); db.prepare("UPDATE run_privacy SET erased=1 WHERE run_id='erased'").run();
  });
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true"); const { port } = f.native();
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "false"); const saved = originals(f.file), bytes = readFileSync(f.file), sql = observeSql();
  expect((await port.history(window, "outside", 100)).map(row => row.id)).toEqual(["public"]);
  expect(await port.publishedHistory!(window, "outside", 100)).toMatchObject({ windowRuns: 1 });
  expect((await port.summary(window)).columns[0].researchRuns).toBe(4);
  const bodyReads = sql.prepare.mock.calls.map(call => call[0]).filter(query => /SELECT q\.data\b/.test(query));
  expect(bodyReads.length).toBeGreaterThan(0);
  expect(bodyReads.every(query => /p\.visibility='public'/.test(query))).toBe(true);
  expect(sql.writes()).toEqual([]); sql.exec.mockRestore(); sql.prepare.mockRestore();
  expect(originals(f.file)).toBe(saved); expect(readFileSync(f.file)).toEqual(bytes);
});
it("counts the full published population beyond100 using genuine readonly privacy and preserves originals", async () => {
  const f = fixture(db => {
    for (let i = 0; i < 105; i++) save(db, `public-${String(i).padStart(3, "0")}`, "outside");
    save(db, "hidden", "outside", "private"); payment(db, "private-money", "hidden");
  });
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true"); const { port } = f.native(), saved = originals(f.file), bytes = readFileSync(f.file);
  const result = await port.publishedHistory!(window, "outside", 3);
  expect(result.windowRuns).toBe(105); expect(result.runs.map(row => row.id)).toEqual(["public-104", "public-103", "public-102"]);
  expect((await port.summary(window)).columns[0]).toMatchObject({ researchRuns: 106, settledMicros: "3" });
  expect(originals(f.file)).toBe(saved); expect(readFileSync(f.file)).toEqual(bytes);
});
it.each(["history", "publishedHistory"] as const)("%s rechecks a real WAL revocation after awaited public selection", async method => {
  const f = fixture(db => save(db, "candidate", "outside"), true, true);
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true"); const { port } = f.native();
  const revoked = afterPublicSelection(() => f.edit(db => db.prepare("UPDATE run_privacy SET visibility='private',revision=revision+1 WHERE run_id='candidate'").run()));
  const result = await port[method]!(window, "outside", 1); expect(revoked()).toBe(true);
  expect(result).toEqual(method === "history" ? [] : { windowRuns: 0, runs: [] });
  expect((await port.summary(window)).columns[0].researchRuns).toBe(1);
});
it.each(["createdAt", "cohort"] as const)("refuses a real %s change after awaited public selection", async field => {
  const f = fixture(db => save(db, "candidate", "outside"), true, true);
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true"); const { port } = f.native();
  const changed = afterPublicSelection(() => f.edit(db => {
    if (field === "createdAt") db.prepare("UPDATE query_runs SET data=json_set(data,'$.createdAt',?) WHERE id='candidate'").run("2026-10-09T00:00:00.000Z");
    else db.prepare("UPDATE query_runs SET data=json_set(data,'$.usage.cohort','unknown','$.usage.payment','unknown') WHERE id='candidate'").run();
  }));
  await expect(port.publishedHistory!(window, "outside", 1)).rejects.toThrow(UsageUnavailable); expect(changed()).toBe(true);
  await expect(port.summary(window)).rejects.toThrow(UsageUnavailable);
});
it("admits an empty full19 public window but refuses active BEFORE history even when empty", async () => {
  const complete = fixture(); vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true"); const fullPort = complete.native().port;
  expect(await fullPort.publishedHistory!(window, "outside", 1)).toEqual({ windowRuns: 0, runs: [] });
  expect(await fullPort.history(window, "outside", 1)).toEqual([]);
  const absent = fixture(() => {}, false); vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true"); const absentPort = absent.native().port;
  expect((await absentPort.summary(window)).complete).toBe(true);
  await expect(absentPort.publishedHistory!(window, "outside", 1)).rejects.toThrow(UsageUnavailable);
  await expect(absentPort.summary(window)).rejects.toThrow(UsageUnavailable);
});
it("an OFF native history port refuses later activation instead of selecting stale broad bodies", async () => {
  const f = fixture(db => save(db, "private", "outside", "private")), { port } = f.native();
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true"); await expect(port.history(window, "outside", 1)).rejects.toThrow(UsageUnavailable);
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "false"); await expect(port.history(window, "outside", 1)).rejects.toThrow(UsageUnavailable);
});
it("the actual privacy facade retains captured policy for classified API history after ENVfalse", async () => {
  const f = fixture(db => { save(db, "public", "outside"); save(db, "private", "outside", "private"); });
  const actual = await select(f, true), selected = await actual.db.getDb();
  opened.push({ close: () => { if ("close" in selected && typeof selected.close === "function") selected.close(); } });
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "false"); expect(selected.runPrivacyActive).toBe(true);
  const response = await actual.history.GET(new Request("https://synthetic.example/api/runs?cohort=outside"));
  expect(response.status).toBe(200); expect((await response.json()).map((row: { id: string }) => row.id)).toEqual(["public"]);
});
it("the genuine classified port also restores the existing purchase-outcomes API without inferred settlement", async () => {
  const f = fixture(db => { save(db, "outside", "outside"); save(db, "hidden", "outside", "private"); });
  const actual = await select(f, true), selected = await actual.db.getDb();
  opened.push({ close: () => { if ("close" in selected && typeof selected.close === "function") selected.close(); } });
  const route = await import("../../app/api/purchase-outcomes/route");
  const response = await route.GET(new Request("https://synthetic.example/api/purchase-outcomes"));
  expect(response.status).toBe(200);
  const body = await response.json(); expect(JSON.stringify(body)).not.toContain("Synthetic private question");
  expect(JSON.stringify(body)).not.toContain(wallet); expect(JSON.stringify(body)).not.toContain("hidden");
  expect((await route.GET(new Request("https://synthetic.example/api/purchase-outcomes?network=invalid"))).status).toBe(400);
});
it("concurrent readonly privacy requests share one genuine connection without overlapping snapshot transactions", async () => {
  const f = fixture(db => save(db, "public", "outside")); vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true"); const { port } = f.native();
  const [history, published, summary] = await Promise.all([port.history(window, "outside", 1),
    port.publishedHistory!(window, "outside", 1), port.summary(window)]);
  expect(history.map(row => row.id)).toEqual(["public"]); expect(published).toMatchObject({ windowRuns: 1 });
  expect(summary.columns[0].researchRuns).toBe(1); expect((await port.summary(window)).complete).toBe(true);
});
it("the actual facade refuses a privacy policy change during its awaited initialization", async () => {
  const f = fixture(), actual = await select(f, true), { SqliteAdapter } = await import("./sqlite-adapter");
  const original = SqliteAdapter.prototype.init;
  vi.spyOn(SqliteAdapter.prototype, "init").mockImplementation(async function (this: InstanceType<typeof SqliteAdapter>) {
    await Reflect.apply(original, this, []); vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "false");
  });
  await expect(actual.api.createReadonlyEnrolledSqliteAdapter()).rejects.toThrow("privacy policy changed during construction");
});
it("a real SQLITE_BUSY exclusive file lock refuses one readonly request and the next guard recovers", async () => {
  const f = fixture(db => save(db, "one")), { port } = f.native(), lock = new DatabaseSync(f.file); opened.push(lock);
  lock.exec("BEGIN EXCLUSIVE");
  try { await expect(port.summary(window)).rejects.toThrow(UsageUnavailable); } finally { lock.exec("ROLLBACK"); }
  expect((await port.summary(window)).columns[3].researchRuns).toBe(1);
});
it("preserves actual SQLITE_LOCKED numeric6 from a genuine disposable SQLite guard and recovers", async () => {
  const f = fixture(db => save(db, "one")), locked = new DatabaseSync(":memory:"); opened.push(locked);
  locked.exec("CREATE TABLE locked(value TEXT); INSERT INTO locked VALUES('synthetic'),('other')");
  const iterator = locked.prepare("SELECT * FROM locked").iterate(); iterator.next(); let block = false, nativeCode: unknown;
  const { port } = f.native(true, () => { if (block) {
    try { locked.exec("DROP TABLE locked"); } catch (error) { nativeCode = error instanceof Error && "errcode" in error ? error.errcode : undefined; throw error; }
  } });
  block = true; await expect(port.summary(window)).rejects.toThrow(UsageUnavailable); expect(nativeCode).toBe(6);
  block = false; iterator.return?.(); expect((await port.summary(window)).columns[3].researchRuns).toBe(1);
});
it("permanently retires an internal guard failure even after its source is restored", async () => {
  const f = fixture(), guard = { calls: 0, failAt: Infinity };
  const { port } = f.native(true, () => { if (++guard.calls === guard.failAt) throw Error("Synthetic internal guard failure"); });
  guard.failAt = guard.calls + 3; await expect(port.summary(window)).rejects.toThrow(UsageUnavailable);
  guard.failAt = Infinity; const calls = guard.calls; await expect(port.summary(window)).rejects.toThrow(UsageUnavailable); expect(guard.calls).toBe(calls);
});
it("permanently retires uncertain snapshot cleanup when the rollback guard also fails", async () => {
  const f = fixture(db => save(db, "original")), saved = originals(f.file), guard = { calls: 0, failAt: Infinity };
  const { port } = f.native(true, () => { if (++guard.calls >= guard.failAt) throw Error("Synthetic persistent cleanup guard failure"); });
  const close = vi.spyOn(DatabaseSync.prototype, "close"); guard.failAt = guard.calls + 5;
  await expect(port.summary(window)).rejects.toThrow(UsageUnavailable); expect(close).toHaveBeenCalled();
  guard.failAt = Infinity; const calls = guard.calls; await expect(port.summary(window)).rejects.toThrow(UsageUnavailable);
  expect(guard.calls).toBe(calls); expect(originals(f.file)).toBe(saved);
});
it.each(["identity", "fence"] as const)("permanently refuses %s drift after exact restoration", async domain => {
  const f = fixture(db => { save(db, "one"); payment(db, "original", "one"); }), { port } = f.native(), saved = originals(f.file);
  let trigger = "", marker = "";
  f.edit(db => {
    marker = String(db.prepare("SELECT identity FROM keryx_storage_identity WHERE id=1").get()?.identity);
    const name = domain === "identity" ? "storage_identity_no_update"
      : String(db.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND name LIKE 'storage_fence_%' ORDER BY name LIMIT 1").get()?.name);
    trigger = String(db.prepare("SELECT sql FROM sqlite_schema WHERE name=?").get(name)?.sql);
    expect(trigger).toMatch(/^CREATE TRIGGER/i); db.exec(`DROP TRIGGER "${name}"`);
    if (domain === "identity") db.prepare("UPDATE keryx_storage_identity SET identity=json_set(identity,'$.provenanceDigest',?) WHERE id=1").run("22".repeat(32));
  });
  await expect(port.summary(window)).rejects.toThrow(UsageUnavailable);
  f.edit(db => { if (domain === "identity") db.prepare("UPDATE keryx_storage_identity SET identity=? WHERE id=1").run(marker); db.exec(trigger); });
  await expect(port.summary(window)).rejects.toThrow(UsageUnavailable); expect(originals(f.file)).toBe(saved);
});
it("permanently retires full schema drift after restoration and preserves original economics", async () => {
  const f = fixture(db => { save(db, "one"); payment(db, "original", "one"); }), { port } = f.native(), original = originals(f.file);
  f.edit(db => db.exec("CREATE TABLE unreviewed_usage(value TEXT)")); await expect(port.summary(window)).rejects.toThrow(UsageUnavailable);
  f.edit(db => db.exec("DROP TABLE unreviewed_usage")); await expect(port.summary(window)).rejects.toThrow(UsageUnavailable); expect(originals(f.file)).toBe(original);
});
it("permanently retires file replacement even if the exact original file is restored", async () => {
  const f = fixture(), { port } = f.native();
  const saved = `${f.file}.original`, replacement = `${f.file}.replacement`; copyFileSync(f.file, replacement);
  renameSync(f.file, saved); renameSync(replacement, f.file);
  await expect(port.summary(window)).rejects.toThrow(UsageUnavailable);
  renameSync(f.file, replacement); renameSync(saved, f.file); await expect(port.summary(window)).rejects.toThrow(UsageUnavailable);
});
it("selected API503 gives no fabricated figures and manifest restoration cannot revive the old native port", async () => {
  const f = fixture(db => save(db, "one")), actual = await select(f), selected = await actual.db.getDb();
  opened.push({ close: () => { if ("close" in selected && typeof selected.close === "function") selected.close(); } });
  writeFileSync(f.manifestPath, "{}"); const response = await actual.figures.GET(new Request("https://synthetic.example/api/usage"));
  expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ complete: false, figures: null, error: "usage_unavailable" });
  writeFileSync(f.manifestPath, f.manifest); await expect(selected.publicUsage!.summary(window)).rejects.toThrow(UsageUnavailable);
  expect((await actual.history.GET(new Request("https://synthetic.example/api/runs?cohort=outside"))).status).toBe(503);
});
it("a genuine malformed metadata corpus yields API503 complete:false/figures:null without partial history", async () => {
  const f = fixture(db => { save(db, "malformed", "outside");
    db.prepare("UPDATE query_runs SET created_at='2026-10-10T00:00:00Z' WHERE id='malformed'").run(); });
  const actual = await select(f), selected = await actual.db.getDb(), saved = originals(f.file);
  opened.push({ close: () => { if ("close" in selected && typeof selected.close === "function") selected.close(); } });
  const response = await actual.figures.GET(new Request("https://synthetic.example/api/usage"));
  expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ complete: false, figures: null });
  expect((await actual.history.GET(new Request("https://synthetic.example/api/runs?cohort=outside"))).status).toBe(503);
  expect(originals(f.file)).toBe(saved);
});
it("refuses ambiguous retained body identity without returning a partial page", async () => {
  const f = fixture(db => { save(db, "valid", "outside"); save(db, "ambiguous", "outside");
    db.prepare("UPDATE query_runs SET data=json_set(data,'$.id','valid') WHERE id='ambiguous'").run(); });
  const { port } = f.native(); await expect(port.history(window, "outside", 100)).rejects.toThrow(UsageUnavailable);
  await expect(port.summary(window)).rejects.toThrow(UsageUnavailable);
});
it.each([0, 101, 1.5])("refuses invalid page limit %s", async limit => {
  const f = fixture(), { port } = f.native(); await expect(port.history(window, "outside", limit)).rejects.toThrow(UsageUnavailable);
});
it("refuses run overflow at the original10000 cap", async () => {
  const f = fixture(db => { const value = run("overflow"), insert = db.prepare("INSERT INTO query_runs(id,created_at,asker,data) VALUES(?,?,?,?)");
    for (let i = 0; i <= MAX_USAGE_RUNS; i++) { const id = `r-${i}`; insert.run(id, date, wallet, JSON.stringify({ ...value, id })); }
  }, false);
  const { port } = f.native(); await expect(port.summary(window)).rejects.toThrow(UsageUnavailable);
});
it("refuses payment overflow at the original50000 cap", async () => {
  const f = fixture(db => { save(db, "one"); const insert = db.prepare("INSERT INTO payment_events(id,query_id,network,kind,payee) VALUES(?,'one',?,'fetch',?)");
    for (let i = 0; i <= MAX_USAGE_PAYMENTS; i++) insert.run(`p-${i}`, network, payee);
  }, false);
  const { port } = f.native(); await expect(port.summary(window)).rejects.toThrow(UsageUnavailable);
});
it("refuses the original8MiB metadata cap below the row caps", async () => {
  expect(MAX_USAGE_BYTES).toBe(8 * 1024 * 1024);
  const f = fixture(db => { save(db, "one");
    const insert = db.prepare("INSERT INTO payment_events(id,query_id,network,kind,payee,tx_hash) VALUES(?,'one',?,'fetch',?,?)");
    for (let i = 0; i < 24000; i++) insert.run(`p-${i}`, network, payee, "x".repeat(256));
  }, false);
  const { port } = f.native(); await expect(port.summary(window)).rejects.toThrow(UsageUnavailable);
});
