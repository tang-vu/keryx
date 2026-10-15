/** All SQLite files, identities and amounts are synthetic;
 * Supabase mocks prove dispatch only, never PostgreSQL acceptance. */
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { QueryRun } from "../types";
import type { RunVisibility } from "../run-privacy/contracts";
import { PrivacyError } from "../run-privacy/contracts";
import { canonicalJson } from "../canonical-json";
import { recordedRunProvenance } from "../research/run-provenance";
import { SqliteAdapter } from "./sqlite-adapter";
import { SupabaseAdapter } from "./supabase-adapter";
import { RUN_PRIVACY_SQL } from "./run-privacy-sqlite";
import { writeSqliteQueryRun } from "./query-run-record";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema, NATIVE_USER_DOMAIN_TABLES } from "./native-user-domain-schema";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { insertStorageIdentity, installStorageFences, registerStorageCapability } from "./storage-identity-sqlite";

const supabase = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: supabase.client }));
const wallet = `0x${"a".repeat(40)}`, date = "2026-10-15T00:00:00.000Z";
const modes = ["public", "private", "unlisted"] as const;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const run = (id: string, asker?: string): QueryRun => ({ id, createdAt: date, question: `Synthetic question ${id}`,
  answer: `Synthetic answer ${id}`, budget: 0.030001, engine: "heuristic", totalSpent: 0.012345,
  totalToCreators: 0.000001, subClaims: [], decisions: [], citations: [], trace: [], paymentMode: "offline",
  provenance: { version: 1, surface: "web", ownershipMethod: asker ? "session" : "unknown" },
  ...(asker ? { asker } : {}) });
let folder: string, template: string, serial = 0;
const opened: Array<{ close(): void }> = [];
beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), "keryx-atomic-publication-")); template = join(folder, "full20.sqlite");
  const db = new DatabaseSync(template);
  try {
    db.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(db);
    writeSqliteQueryRun(db, run("legacy", wallet), false);
    installNativeUserDomainSchema(db); db.exec("COMMIT");
  } finally { db.close(); }
  supportedSqliteApplicationProfiles(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const item of opened.splice(0).reverse()) item.close();
  vi.unstubAllEnvs(); supabase.client.mockReset();
});
afterAll(() => {
  if (folder) {
    if (!resolve(folder).startsWith(resolve(tmpdir()) + sep) || !folder.includes("keryx-atomic-publication-"))
      throw Error("Unsafe fixture cleanup");
    rmSync(folder, { recursive: true, force: true });
  }
});
const rawOf = (adapter: SqliteAdapter) => (adapter as unknown as { db: DatabaseSync }).db;
const row = (db: DatabaseSync, id: string) => db.prepare("SELECT * FROM run_privacy WHERE run_id=?").get(id);
const original = (db: DatabaseSync, id: string) => db.prepare("SELECT data FROM query_runs WHERE id=?").get(id)?.data;
function snapshot(db: DatabaseSync) {
  const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all();
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return canonicalJson({ schema, records: tables.map(({ name }) => [name,
    db.prepare(`SELECT * FROM "${String(name).replaceAll('"', '""')}"`).all()]) });
}
function otherDomains(db: DatabaseSync) {
  const tables = db.prepare(`SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'
    AND name NOT IN ('query_runs','run_privacy') ORDER BY name`).all();
  return canonicalJson(tables.map(({ name }) => [name,
    db.prepare(`SELECT * FROM "${String(name).replaceAll('"', '""')}"`).all()]));
}
async function ordinary(active = true, admitted = true, disk = false) {
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", active ? "true" : "false");
  vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "false");
  const file = disk ? join(folder, `ordinary-${++serial}.sqlite`) : ":memory:";
  const adapter = new SqliteAdapter(file); opened.push(adapter); await adapter.init();
  const db = rawOf(adapter); writeSqliteQueryRun(db, run("legacy", wallet), false);
  if (admitted) { db.exec(RUN_PRIVACY_SQL); await adapter.init(); }
  return { adapter, db, file };
}
async function native() {
  // A deployment is pinned for one real module/process lifetime. Each independent
  // fixture gets a fresh lifetime; the changed-manifest control below retains it.
  vi.resetModules();
  const { createEnrolledSqliteAdapter, createReadonlyEnrolledSqliteAdapter } = await import("./enrolled-sqlite-adapter");
  const file = join(folder, `native-${++serial}.sqlite`), manifest = join(folder, `manifest-${serial}.json`);
  copyFileSync(template, file);
  const identity: StorageIdentity = { ...syntheticStorageIdentity("mainnet-real"), format: "keryx-mainnet-storage-identity-v1",
    network: "eip155:5042", profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  const edit = (action: (db: DatabaseSync) => void) => {
    const db = new DatabaseSync(file);
    try { registerStorageCapability(db, identity, () => true); action(db); } finally { db.close(); }
  };
  edit(db => {
    db.exec("BEGIN IMMEDIATE"); insertStorageIdentity(db, identity); installStorageFences(db, identity);
    db.prepare(`INSERT INTO payment_events(id,query_id,network,settled,settlement_status,amount_usdc,kind,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run("synthetic-pending", "legacy", identity.network, 0, "pending", 0.000003, "fetch", date);
    db.exec("COMMIT");
  });
  writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity,
    backend: { kind: "sqlite", databasePath: file } }));
  vi.stubEnv("KERYX_STORAGE_MANIFEST", manifest); vi.stubEnv("KERYX_SQLITE_PATH", file);
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0"); vi.stubEnv("CONTENT_MASTER_KEY", "11".repeat(32));
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true"); vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "false");
  const adapter = await createEnrolledSqliteAdapter(); opened.push(adapter);
  const db = new DatabaseSync(file, { readOnly: true }); opened.push(db);
  return { adapter, db, file, manifest, edit, identity, createReadonlyEnrolledSqliteAdapter };
}

it.each(modes)("creates explicit %s atomically with the unchanged original and financial/domain state", async visibility => {
  const f = await ordinary(), value = run("explicit", wallet), input = JSON.stringify(value), domains = otherDomains(f.db);
  f.db.prepare("INSERT INTO run_privacy_defaults VALUES(?,?)").run(wallet, visibility === "private" ? "public" : "private");
  const before = otherDomains(f.db);
  await f.adapter.saveQueryRun(value, { visibility });
  expect(row(f.db, value.id)).toMatchObject({ visibility, revision: 0, erased: 0 });
  expect(original(f.db, value.id)).toBe(JSON.stringify(recordedRunProvenance(value)));
  expect(hash(String(original(f.db, value.id)))).toBe(hash(input)); expect(JSON.stringify(value)).toBe(input);
  expect(otherDomains(f.db)).toBe(before); expect(domains).not.toBe(before);
  expect((await f.adapter.listRecentQueries(10)).map(item => item.id)).toEqual(visibility === "public" ? [value.id] : []);
});
it.each(modes)("uses the recorded %s default only for new runs when no option is supplied", async visibility => {
  const f = await ordinary(); f.db.prepare("INSERT INTO run_privacy_defaults VALUES(?,?)").run(wallet, visibility);
  const before = otherDomains(f.db);
  await f.adapter.saveQueryRun(run("default", wallet.toUpperCase().replace("0X", "0x")));
  expect(row(f.db, "default")?.visibility).toBe(visibility); expect(otherDomains(f.db)).toBe(before);
});
it("defaults new signed and anonymous ordinary runs to public without startup/historical backfill", async () => {
  const f = await ordinary(); expect(row(f.db, "legacy")).toBeUndefined();
  for (const [id, asker] of [["signed", wallet], ["anonymous", undefined]] as const) {
    await f.adapter.saveQueryRun(run(id, asker)); expect(row(f.db, id)?.visibility).toBe("public");
    expect(original(f.db, id)).toBe(JSON.stringify(run(id, asker)));
  }
  expect(row(f.db, "legacy")).toBeUndefined();
});
it.each([null, {}, [], "private", { visibility: "PUBLIC" }, { visibility: null }, { visibility: "private", extra: true }]
  .map(input => ({ input })))("rejects malformed publication $input before any write", async ({ input }) => {
    const f = await ordinary(), before = snapshot(f.db);
    await expect(f.adapter.saveQueryRun(run("invalid"), input as unknown as { visibility: RunVisibility })).rejects.toThrow();
    expect(snapshot(f.db)).toBe(before);
  });
it.each([[false, false], [false, true], [true, false]])(
  "rejects requested modes when active=%s admitted=%s without writing", async (active, admitted) => {
    const f = await ordinary(active, admitted), before = snapshot(f.db);
    for (const visibility of modes) await expect(f.adapter.saveQueryRun(run(`unavailable-${visibility}`), { visibility }))
      .rejects.toBeInstanceOf(PrivacyError);
    if (active) await expect(f.adapter.saveQueryRun(run("unavailable-default"))).rejects.toThrow("privacy_unavailable");
    expect(snapshot(f.db)).toBe(before);
  });
it("preserves the captured OFF legacy writer and cannot activate publication by changing the environment", async () => {
  const f = await ordinary(false, false); vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true");
  await f.adapter.saveQueryRun(run("legacy-lane"));
  expect(original(f.db, "legacy-lane")).toBe(JSON.stringify(run("legacy-lane")));
  await expect(f.adapter.saveQueryRun(run("refused"), { visibility: "private" })).rejects.toThrow("privacy_unavailable");
});
it("refuses drifted ordinary schema before inserting an original", async () => {
  const f = await ordinary(); f.db.exec("CREATE TRIGGER unexpected_publication AFTER INSERT ON query_runs BEGIN SELECT 1; END");
  const before = snapshot(f.db);
  await expect(f.adapter.saveQueryRun(run("drift"), { visibility: "public" })).rejects.toThrow("privacy_unavailable");
  expect(snapshot(f.db)).toBe(before);
});
it.each(["private", "unlisted"] as const)("never exposes a new %s run to a second reader before commit", async visibility => {
  const f = await ordinary(true, true, true), reader = new DatabaseSync(f.file, { readOnly: true }); opened.push(reader);
  f.db.prepare("INSERT INTO run_privacy_defaults VALUES(?,?)").run(wallet, "public");
  const prepare = DatabaseSync.prototype.prepare; let observed = 0;
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, sql: string) {
    const statement = prepare.call(this, sql);
    if (!sql.startsWith("UPDATE run_privacy SET visibility=?")) return statement;
    return new Proxy(statement, { get(target, key) {
      if (key === "run") return (...args: Parameters<typeof target.run>) => {
        expect(prepare.call(reader, "SELECT 1 FROM query_runs WHERE id='atomic'").get()).toBeUndefined();
        const result = target.run(...args);
        expect(prepare.call(reader, "SELECT 1 FROM run_privacy WHERE run_id='atomic'").get()).toBeUndefined();
        observed++; return result;
      };
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
  });
  await f.adapter.saveQueryRun(run("atomic", wallet), { visibility }); expect(observed).toBe(1);
  expect(row(reader, "atomic")?.visibility).toBe(visibility);
});
it.each([false, true])("rolls back original plus sidecar on failure, preserving outer transaction=%s", async nested => {
  const f = await ordinary(); if (nested) f.db.exec("BEGIN IMMEDIATE");
  const before = snapshot(f.db), prepare = DatabaseSync.prototype.prepare;
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, sql: string) {
    const statement = prepare.call(this, sql);
    if (!sql.startsWith("UPDATE run_privacy SET visibility=?")) return statement;
    return new Proxy(statement, { get(target, key) {
      if (key === "run") return (...args: Parameters<typeof target.run>) => { target.run(...args); throw Error("Synthetic post-sidecar failure"); };
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
  });
  await expect(f.adapter.saveQueryRun(run("rolled-back"), { visibility: "public" })).rejects.toThrow("Synthetic post-sidecar failure");
  expect(snapshot(f.db)).toBe(before); expect(f.db.isTransaction).toBe(nested);
  if (nested) f.db.exec("ROLLBACK");
});
it.each(modes)("resaving an existing %s run never republishes or changes its sidecar/audit", async visibility => {
  const f = await ordinary(); await f.adapter.saveQueryRun(run("existing", wallet), { visibility });
  f.db.prepare("UPDATE run_privacy SET revision=7 WHERE run_id='existing'").run();
  const retained = canonicalJson(row(f.db, "existing")), before = otherDomains(f.db);
  for (const publication of [{ visibility: "public" as const }, undefined]) {
    await f.adapter.saveQueryRun({ ...run("existing", wallet), answer: "Resaved original" }, publication);
    expect(canonicalJson(row(f.db, "existing"))).toBe(retained); expect(otherDomains(f.db)).toBe(before);
  }
});
it("resaves historical missing metadata as unlisted and preserves a retained orphan sidecar", async () => {
  const f = await ordinary(); await f.adapter.saveQueryRun(run("legacy", wallet), { visibility: "public" });
  expect(row(f.db, "legacy")?.visibility).toBe("unlisted");
  f.db.prepare("INSERT INTO run_privacy(run_id,visibility,revision,updated_at) VALUES('orphan','private',9,?)").run(date);
  const retained = canonicalJson(row(f.db, "orphan"));
  await f.adapter.saveQueryRun(run("orphan"), { visibility: "public" });
  expect(canonicalJson(row(f.db, "orphan"))).toBe(retained);
});
it("never resurrects an erased original or an erased ID tombstone", async () => {
  const f = await ordinary(); await f.adapter.saveQueryRun(run("erased", wallet), { visibility: "private" });
  f.db.prepare("UPDATE run_privacy SET erased=1,revision=1 WHERE run_id='erased'").run();
  f.db.prepare("INSERT INTO run_privacy(run_id,visibility,erased,updated_at) VALUES('tombstone','private',1,?)").run(date);
  const before = snapshot(f.db);
  for (const id of ["erased", "tombstone"]) for (const publication of [{ visibility: "public" as const }, undefined])
    await expect(f.adapter.saveQueryRun(run(id), publication)).rejects.toThrow("privacy_erased");
  expect(snapshot(f.db)).toBe(before);
});
it("keeps insert-only internal recovery on the existing trigger/default policy and refuses duplicate insertion", async () => {
  const f = await ordinary();
  writeSqliteQueryRun(f.db, run("recovered-owned", wallet), false);
  writeSqliteQueryRun(f.db, run("recovered-anonymous"), false);
  expect(row(f.db, "recovered-owned")?.visibility).toBe("private");
  expect(row(f.db, "recovered-anonymous")?.visibility).toBe("unlisted");
  const before = snapshot(f.db); expect(() => writeSqliteQueryRun(f.db, run("recovered-owned", wallet), false)).toThrow();
  expect(snapshot(f.db)).toBe(before);
});

it("uses the genuine frozen native full20 facade for explicit/default modes without schema, fence or other-domain mutation", async () => {
  const f = await native(); expect(Object.isFrozen(f.adapter)).toBe(true); expect(NATIVE_USER_DOMAIN_TABLES).toHaveLength(20);
  const schema = canonicalJson(f.db.prepare("SELECT * FROM sqlite_schema ORDER BY type,name").all());
  expect(row(f.db, "legacy")).toBeUndefined();
  for (const visibility of modes) {
    f.edit(db => db.prepare("INSERT INTO run_privacy_defaults VALUES(?,?) ON CONFLICT(wallet) DO UPDATE SET visibility=excluded.visibility")
      .run(wallet, visibility));
    const before = otherDomains(f.db);
    await f.adapter.saveQueryRun(run(`native-explicit-${visibility}`, wallet), { visibility });
    await f.adapter.saveQueryRun(run(`native-default-${visibility}`, wallet));
    for (const id of [`native-explicit-${visibility}`, `native-default-${visibility}`]) {
      expect(row(f.db, id)).toMatchObject({ visibility, revision: 0, erased: 0 });
      expect(original(f.db, id)).toBe(JSON.stringify(run(id, wallet)));
    }
    expect(otherDomains(f.db)).toBe(before);
  }
  f.edit(db => db.prepare("DELETE FROM run_privacy_defaults WHERE wallet=?").run(wallet));
  const before = otherDomains(f.db);
  for (const [id, asker] of [["native-signed", wallet], ["native-anonymous", undefined]] as const) {
    await f.adapter.saveQueryRun(run(id, asker)); expect(row(f.db, id)?.visibility).toBe("public");
    expect(original(f.db, id)).toBe(JSON.stringify(run(id, asker)));
  }
  expect(row(f.db, "legacy")).toBeUndefined(); expect(otherDomains(f.db)).toBe(before);
  expect(canonicalJson(f.db.prepare("SELECT * FROM sqlite_schema ORDER BY type,name").all())).toBe(schema);
  expect(f.adapter.runPrivacyActive).toBe(true);
});
it("native malformed selection and post-insert failure retain the complete original store", async () => {
  const f = await native(), before = snapshot(f.db);
  for (const input of [null, {}, [], { visibility: "invalid" }, { visibility: "public", extra: true }])
    await expect(f.adapter.saveQueryRun(run("invalid-native"), input as unknown as { visibility: RunVisibility })).rejects.toThrow();
  expect(snapshot(f.db)).toBe(before);
  const prepare = DatabaseSync.prototype.prepare;
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, sql: string) {
    const statement = prepare.call(this, sql);
    if (!sql.startsWith("UPDATE run_privacy SET visibility=?")) return statement;
    return new Proxy(statement, { get(target, key) {
      if (key === "run") return (...args: Parameters<typeof target.run>) => {
        target.run(...args); throw Error("Synthetic native post-sidecar failure");
      };
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
  });
  await expect(f.adapter.saveQueryRun(run("rolled-back-native"), { visibility: "public" }))
    .rejects.toThrow("Synthetic native post-sidecar failure");
  expect(snapshot(f.db)).toBe(before);
});
it("native resaves keep hidden/legacy/erased policy and all retained financial records", async () => {
  const f = await native();
  await f.adapter.saveQueryRun(run("hidden", wallet), { visibility: "private" });
  await f.adapter.saveQueryRun(run("erased", wallet), { visibility: "private" });
  f.edit(db => db.prepare("UPDATE run_privacy SET erased=1,revision=3 WHERE run_id='erased'").run());
  const hidden = canonicalJson(row(f.db, "hidden")), erased = String(original(f.db, "erased")), before = otherDomains(f.db);
  await f.adapter.saveQueryRun(run("hidden", wallet), { visibility: "public" });
  await f.adapter.saveQueryRun(run("legacy", wallet), { visibility: "public" });
  await expect(f.adapter.saveQueryRun(run("erased", wallet), { visibility: "public" })).rejects.toThrow("privacy_erased");
  expect(canonicalJson(row(f.db, "hidden"))).toBe(hidden); expect(row(f.db, "legacy")?.visibility).toBe("unlisted");
  expect(original(f.db, "erased")).toBe(erased); expect(otherDomains(f.db)).toBe(before);
});
it("native readonly and changed deployment refuse before creation; raw assembly cannot grant full20 authority", async () => {
  const f = await native(), reader = await f.createReadonlyEnrolledSqliteAdapter(); opened.push(reader);
  const before = snapshot(f.db);
  await expect(Promise.resolve().then(() => reader.saveQueryRun(run("readonly"), { visibility: "public" }))).rejects.toThrow();
  const raw = new DatabaseSync(f.file); opened.push(raw);
  const forged = SqliteAdapter.assembleConnectionCore(raw, f.identity, () => {});
  Object.defineProperties(forged, { runPrivacyActive: { value: true }, runPrivacy: { value: f.adapter.runPrivacy } });
  await expect(forged.saveQueryRun(run("forged"), { visibility: "public" })).rejects.toThrow();
  writeFileSync(f.manifest, "{}");
  await expect(Promise.resolve().then(() => f.adapter.saveQueryRun(run("changed"), { visibility: "public" }))).rejects.toThrow();
  expect(snapshot(f.db)).toBe(before);
});
it("native schema drift refuses instead of selecting ordinary authority or repairing the store", async () => {
  const f = await native(); f.edit(db => db.exec("CREATE INDEX unreviewed_publication ON query_runs(created_at)"));
  const before = snapshot(f.db);
  await expect(Promise.resolve().then(() => f.adapter.saveQueryRun(run("drifted-native"), { visibility: "public" }))).rejects.toThrow();
  expect(snapshot(f.db)).toBe(before);
});

it("inactive Supabase refuses explicit publication before any RPC/table write", async () => {
  const from = vi.fn(() => { throw Error("Unexpected REST access"); }), rpc = vi.fn(() => { throw Error("Unexpected RPC access"); });
  supabase.client.mockReturnValue({ from, rpc }); vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "false");
  vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "false"); const db = new SupabaseAdapter();
  for (const input of [...modes.map(visibility => ({ visibility })), null, {}, { visibility: "invalid" }])
    await expect(db.saveQueryRun(run("supabase"), input as { visibility: RunVisibility })).rejects.toThrow("privacy_unavailable");
  expect(from).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
});
it("ordinary active Supabase sends one atomic publication RPC and preserves original input", async () => {
  const from = vi.fn(() => { throw Error("Unexpected REST access"); });
  const rpc = vi.fn((_name: string, args: { p_action: string; p_input: { row: { id: string } } }) => ({
    abortSignal: async () => ({ data: { version: 1, action: args.p_action, id: args.p_input.row.id, result: { saved: true } }, error: null }),
  }));
  supabase.client.mockReturnValue({ from, rpc }); vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true");
  vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "false"); const db = new SupabaseAdapter();
  for (const visibility of modes) {
    const value = run(`supabase-${visibility}`, wallet), before = JSON.stringify(value);
    await db.saveQueryRun(value, { visibility });
    expect(rpc).toHaveBeenLastCalledWith("research_publication_v1", { p_action: "save", p_input: {
      row: expect.objectContaining({ id: value.id, asker: wallet, data: value }), publication: { visibility },
    } });
    expect(JSON.stringify(value)).toBe(before);
  }
  await db.saveQueryRun(run("supabase-default"));
  expect(rpc.mock.calls.at(-1)?.[1].p_input).not.toHaveProperty("publication");
  expect(rpc).toHaveBeenCalledTimes(4); expect(from).not.toHaveBeenCalled();
});
it("active Supabase refuses malformed intent and never falls back after atomic RPC failure", async () => {
  const from = vi.fn(() => { throw Error("Unexpected REST access"); });
  const rpc = vi.fn(() => ({ abortSignal: async () => ({ data: null, error: { message: "privacy_unavailable" } }) }));
  supabase.client.mockReturnValue({ from, rpc }); vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true");
  vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "false"); const db = new SupabaseAdapter();
  for (const input of [null, {}, { visibility: "invalid" }])
    await expect(db.saveQueryRun(run("invalid"), input as { visibility: RunVisibility })).rejects.toThrow("privacy_unavailable");
  expect(rpc).not.toHaveBeenCalled();
  await expect(db.saveQueryRun(run("refused"), { visibility: "public" })).rejects.toThrow("privacy_unavailable");
  expect(rpc).toHaveBeenCalledOnce(); expect(from).not.toHaveBeenCalled();
});
it("keeps Supabase's captured OFF omitted-option mapping without inventing a publication RPC", async () => {
  const upsert = vi.fn(async () => ({ data: null, error: null })), from = vi.fn(() => ({ upsert })), rpc = vi.fn();
  supabase.client.mockReturnValue({ from, rpc }); vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "false");
  vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "false"); const db = new SupabaseAdapter();
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true"); const value = run("legacy-supabase", wallet), before = JSON.stringify(value);
  await db.saveQueryRun(value); expect(from).toHaveBeenCalledWith("query_runs");
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ id: value.id, asker: wallet, data: value,
    budget: value.budget, total_spent: value.totalSpent, total_to_creators: value.totalToCreators }));
  expect(JSON.stringify(value)).toBe(before); expect(rpc).not.toHaveBeenCalled();
});
