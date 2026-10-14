import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { canonicalJson } from "../canonical-json";
import { createIdentityRoutes } from "../profiles/identity-route";
import { requireProfileIdentities, type IdentityChallenge, type ProviderIdentity } from "../profiles/verified-identities";
import type { PrivateProfileInput } from "../profiles/private-profile";
import type { KeryxDB } from "./keryx-db";
import { createEnrolledSqliteProfileIdentities } from "./profile-identities-enrolled-sqlite";
import { createSqliteProfileIdentities } from "./profile-identities-sqlite";
import { createEnrolledSqlitePrivateProfiles } from "./private-profiles-enrolled-sqlite";
import { PRIVATE_PROFILES_SQL } from "./private-profiles-sqlite";
import { PROFILE_IDENTITIES_SQL, PROFILE_IDENTITIES_STORAGE_DOMAIN, PROFILE_IDENTITY_SCHEMA } from "./profile-identities-storage-domain";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { sqliteApplicationSchemaProfile } from "./sqlite-application-schema-profile";
import { inspectStorageDeploymentManifest } from "./runtime-storage-config";
import { openVerifiedSqliteStorage, assertVerifiedSqliteForeignKeys } from "./storage-identity-connection";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { assertStorageIdentity, insertStorageIdentity, installStorageFences } from "./storage-identity-sqlite";

// Actual ROOT-reviewed four-profile full19 family; no profile generator replacement.
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`, stranger = `0x${"c".repeat(40)}`;
const network = "eip155:5042";
const profile: PrivateProfileInput = { displayName: "Alice", handle: "", bio: "Reader", purpose: "Papers", links: [{ kind: "github", url: "https://github.com/asserted" }] };
const hash = (name: string) => createHash("sha256").update(name).digest("hex");
const github: ProviderIdentity = { provider: "github", externalId: "12345", label: "Alice" };
const orcid: ProviderIdentity = { provider: "orcid", externalId: "0000-0002-1825-0097", label: "Alice Researcher" };
const directories: string[] = [], connections: { close(): void }[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const connection of connections.splice(0)) connection.close();
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep) || !directory.includes("keryx-native-identities-")) throw new Error("Unsafe fixture cleanup");
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(options: { archive?: boolean; shape?: "present" | "absent" | "partial" | "missing-profile" | "changed-session";
  expired?: "pending" | "consumed" } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "keryx-native-identities-")); directories.push(directory);
  const file = join(directory, "native.sqlite"), manifest = join(directory, "deployment.json");
  const identity: StorageIdentity = { ...syntheticStorageIdentity("testnet-real"), format: "keryx-mainnet-storage-identity-v1",
    authorityMode: "mainnet-real", network, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  const db = new DatabaseSync(file);
  let initialNow = 0;
  const shape = options.shape ?? "present";
  try {
    db.exec("BEGIN IMMEDIATE");
    installMainnetApplicationSchema(db, { publicReferenceArchive: options.archive ?? false });
    initialNow = Number(db.prepare("SELECT CAST(unixepoch('subsec')*1000 AS INTEGER) AS now").get()!.now);
    // Historical synthetic originals are fixture input seeded before enrollment.
    // Nothing here claims a real payment, login, owner session or provider exchange.
    db.prepare("INSERT INTO query_runs(id,asker,origin,data) VALUES(?,?,?,?)").run("original", alice, "web", '{"question":"retain original"}');
    db.prepare("INSERT INTO payment_events(id,query_id,payee,kind,network,settled,settlement_status,tx_hash,amount_usdc) VALUES(?,?,?,?,?,?,?,?,?)")
      .run("original-payment", "original", bob, "citation", network, 1, "settled", "synthetic-fixture-reference", 0.005);
    for (const wallet of [alice, bob]) db.prepare("INSERT INTO web_sessions(hash,wallet,issued_at,expires_at) VALUES(?,?,?,?)")
      .run(hash(wallet), wallet, initialNow - 60_000, initialNow + 3_600_000);
    if (shape !== "absent") {
      installNativeUserDomainSchema(db);
      if (shape === "missing-profile") db.exec("DROP TABLE private_profiles");
      if (shape === "partial") db.exec("DROP TABLE profile_identity_challenges");
    }
    if (shape === "changed-session") db.exec("DROP INDEX web_sessions_wallet");
    if (options.expired) {
      db.prepare("INSERT INTO private_profiles VALUES(?,?,?,?,?,?,?,?)").run(alice, null, "Alice", "", "", "[]", new Date(initialNow).toISOString(), new Date(initialNow).toISOString());
      db.prepare("INSERT INTO profile_verified_identities(wallet,provider,current_state_hash) VALUES(?,?,?)").run(alice, "github", hash("expired"));
      db.prepare("INSERT INTO profile_identity_challenges VALUES(?,?,?,?,?,?)").run(hash("expired"), alice, "github", hash(alice), initialNow - 10_000, options.expired);
    }
    insertStorageIdentity(db, identity); installStorageFences(db, identity); db.exec("COMMIT");
  } finally { db.close(); }
  writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } }));
  const pinned = canonicalJson(inspectStorageDeploymentManifest({ KERYX_STORAGE_MANIFEST: manifest }));
  const open = (readOnly = false, fullGuard = true) => {
    const connection = openVerifiedSqliteStorage(file, identity, { readOnly,
      ...(fullGuard ? { applicationProfiles: supportedSqliteApplicationProfiles(true) } : {}),
      runtimeGuard() { if (canonicalJson(inspectStorageDeploymentManifest({ KERYX_STORAGE_MANIFEST: manifest })) !== pinned) throw new Error("Manifest drift"); } });
    connections.push(connection); return connection;
  };
  const challenge = (name: string, wallet = alice, provider: IdentityChallenge["provider"] = "github"): IdentityChallenge => ({
    wallet, provider, stateHash: hash(name), sessionHash: hash(wallet), expiresAt: new Date(initialNow + 600_000).toISOString(),
  });
  return { directory, file, manifest, identity, open, challenge, initialNow };
}
const rawRead = <T>(file: string, read: (db: DatabaseSync) => T): T => {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return read(db); } finally { db.close(); }
};
const rows = (file: string, table: string) => rawRead(file, db => db.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}" ORDER BY rowid`).all());
function originals(file: string) {
  return rawRead(file, db => {
    const tables = db.prepare(`SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'
      AND name NOT IN ('private_profiles','profile_verified_identities','profile_identity_challenges') ORDER BY name`).all();
    return canonicalJson(tables.map(row => ({ table: row.name, rows: db.prepare(`SELECT * FROM "${String(row.name).replaceAll('"', '""')}" ORDER BY rowid`).all() })));
  });
}
async function saved(options: Parameters<typeof fixture>[0] = {}) {
  const f = fixture(options), connection = f.open(), profiles = createEnrolledSqlitePrivateProfiles(connection.db)!;
  const port = createEnrolledSqliteProfileIdentities(connection.db)!;
  for (const wallet of [alice, bob]) await profiles.update(wallet, { ...profile, displayName: wallet === alice ? "Alice" : "Bob" });
  const verify = async (challenge: IdentityChallenge, value = github, store = port) => {
    await store.begin(challenge); await store.consume(challenge); return store.complete(challenge, value);
  };
  return { ...f, connection, profiles, port, verify };
}

async function selectedFacade(f: ReturnType<typeof fixture>) {
  // Reset only the module cache between disposable selected deployments. Native
  // provenance is issued by the actual factory, never supplied by a test double.
  vi.resetModules();
  vi.stubEnv("KERYX_STORAGE_MANIFEST", f.manifest);
  vi.stubEnv("KERYX_SQLITE_PATH", f.file);
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0");
  vi.stubEnv("CONTENT_MASTER_KEY", "41".repeat(32));
  const api = await import("./enrolled-sqlite-adapter");
  const facade = await api.createEnrolledSqliteAdapter();
  connections.push(facade);
  return { api, facade };
}

async function savedFacadeFixture(options: Parameters<typeof fixture>[0] = {}) {
  const f = fixture(options), connection = f.open();
  // The separate #260 selected binding is not composed in this source yet.
  // Save through its actual declared native helper on this same file; do not
  // fabricate a privateProfiles property or use the ordinary constructor.
  const profiles = createEnrolledSqlitePrivateProfiles(connection.db)!;
  for (const wallet of [alice, bob]) await profiles.update(wallet, { ...profile, displayName: wallet === alice ? "Alice" : "Bob" });
  connection.close();
  return f;
}

async function facadeIdentityGet(facade: KeryxDB, wallet = alice, expected = wallet) {
  const routes = createIdentityRoutes({
    session: async () => {
      const session = await facade.getWebSession(hash(wallet));
      if (!session || session.wallet !== wallet || session.expiresAt <= Date.now()) return new Response(null, { status: 401 });
      return { db: facade, wallet: session.wallet, currentId: session.hash };
    },
    key: async () => { throw new Error("Cookie LIST must not use bearer authority"); },
    db: async () => facade,
    provider: () => { throw new Error("LIST must not select a provider"); },
    exchange: async () => { throw new Error("LIST must not exchange provider credentials"); },
    applicationOrigin: "https://keryx.invalid", secret: "synthetic-fixture-secret-".repeat(2),
  });
  return routes.GET(new Request("https://keryx.invalid/api/me/profile/identities", {
    headers: { "X-Keryx-Expected-Wallet": expected },
  }));
}

const wholeSchema = (file: string) => rawRead(file, db => canonicalJson(db.prepare(
  "SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all()));

describe("genuine full19 native profile identities (not deployed acceptance)", () => {
  it.each([false, true])("exact declaration, lifecycle, owner isolation and DB verification time (archive=%s)", async archive => {
    const f = await saved({ archive }), before = originals(f.file);
    expect(supportedSqliteApplicationProfiles(true)).toHaveLength(4);
    expect(Object.isFrozen(f.port)).toBe(true);
    expect(PROFILE_IDENTITIES_STORAGE_DOMAIN.sql).toBe(PROFILE_IDENTITIES_SQL);
    expect(PROFILE_IDENTITIES_STORAGE_DOMAIN.fenceOperations).toEqual(["INSERT", "UPDATE", "DELETE"]);
    const shape = rawRead(f.file, db => db.prepare(`SELECT type,name,tbl_name,substr(sql,1,16385) AS sql FROM sqlite_schema
      WHERE tbl_name IN ('private_profiles','web_sessions','profile_verified_identities','profile_identity_challenges')
      AND name NOT LIKE 'storage_fence_%' ORDER BY type,name`).all());
    expect(canonicalJson(shape)).toBe(canonicalJson(PROFILE_IDENTITY_SCHEMA));
    expect(await f.port.list(alice)).toEqual({ wallet: alice, identities: [] });
    // Asserted profile links never become verified labels; begin/consume don't either.
    const c = f.challenge("first"); await f.port.begin(c); await f.port.consume(c);
    expect((await f.port.list(alice)).identities).toEqual([]);
    const lower = Number(f.connection.db.prepare("SELECT CAST(unixepoch('subsec')*1000 AS INTEGER) AS now").get()!.now);
    const clock = vi.spyOn(Date, "now").mockReturnValue(0);
    let record;
    try { record = await f.port.complete(c, github); } finally { clock.mockRestore(); }
    const upper = Number(f.connection.db.prepare("SELECT CAST(unixepoch('subsec')*1000 AS INTEGER) AS now").get()!.now);
    expect(Date.parse(record.verifiedAt)).toBeGreaterThanOrEqual(lower);
    expect(Date.parse(record.verifiedAt)).toBeLessThanOrEqual(upper);
    expect(record).toMatchObject({ wallet: alice, ...github });
    const replacement = f.challenge("replacement"); await f.port.begin(replacement);
    expect((await f.port.list(alice)).identities).toEqual([record]);
    expect((await f.port.list(bob)).identities).toEqual([]);
    await f.port.consume(replacement); await f.port.complete(replacement, { ...github, externalId: "67890", label: "Alice-new" });
    await f.verify(f.challenge("orcid", alice, "orcid"), orcid);
    expect((await f.port.list(alice.toUpperCase().replace("0X", "0x"))).identities).toHaveLength(2);
    expect(Object.keys(rows(f.file, "profile_identity_challenges")[0])).toEqual(["state_hash", "wallet", "provider", "session_hash", "expires_at", "status"]);
    expect(originals(f.file)).toBe(before);
  });

  it("single consume/successful complete and replaced current nonce lineage are enforced across native connections", async () => {
    const f = await saved(), second = createEnrolledSqliteProfileIdentities(f.open().db)!, c = f.challenge("one-use");
    await f.port.begin(c);
    await expect(second.complete(c, github)).rejects.toThrow("identity_expired");
    await expect(second.begin(c)).rejects.toThrow("identity_expired");
    await second.consume(c); await expect(f.port.consume(c)).rejects.toThrow("identity_expired");
    await second.complete(c, github); await expect(f.port.complete(c, github)).rejects.toThrow("identity_expired");
    await expect(f.port.begin(c)).rejects.toThrow("identity_expired");
    const old = f.challenge("old-consumed"); await f.port.begin(old); await f.port.consume(old);
    for (let n = 0; n < 8; n++) await second.begin(f.challenge(`bounded-${n}`));
    expect(rows(f.file, "profile_identity_challenges")).toHaveLength(1);
    await expect(f.port.consume(old)).rejects.toThrow("identity_expired");
    await expect(f.port.complete(old, github)).rejects.toThrow("identity_expired");
    expect((await f.port.list(alice)).identities[0].externalId).toBe(github.externalId);
  });

  it.each(["list", "begin"] as const)("genuine pre-transaction EXCLUSIVE contention refuses %s without retiring the same native port", async operation => {
    const f = await saved(), record = await f.verify(f.challenge("exclusive-original"));
    const pending = f.challenge("exclusive-preserved"); await f.port.begin(pending);
    const actor = new DatabaseSync(f.file);
    try {
      // A separate disposable fixture actor holds the actual enrolled file;
      // identity admission and every shared port still use the genuine factory.
      assertStorageIdentity(actor, f.identity);
      const snapshot = () => canonicalJson({
        schema: actor.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all(),
        tables: actor.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
          .map(row => ({ table: row.name, rows: actor.prepare(`SELECT * FROM "${String(row.name).replaceAll('"', '""')}" ORDER BY rowid`).all() })),
      });
      const before = snapshot(), bytes = readFileSync(f.file), manifest = readFileSync(f.manifest);
      actor.exec("BEGIN EXCLUSIVE");
      // Observation only: these spies execute the real native methods unchanged.
      const prepare = vi.spyOn(DatabaseSync.prototype, "prepare"), get = vi.spyOn(StatementSync.prototype, "get");
      const all = vi.spyOn(StatementSync.prototype, "all"), exec = vi.spyOn(DatabaseSync.prototype, "exec");
      const close = vi.spyOn(DatabaseSync.prototype, "close"), started = performance.now();
      try {
        await expect(operation === "list" ? f.port.list(alice) : f.port.begin(f.challenge("exclusive-refused")))
          .rejects.toThrow("identity_unavailable");
        expect(performance.now() - started).toBeGreaterThanOrEqual(5000);
        const failures = [...prepare.mock.results, ...get.mock.results, ...all.mock.results].filter(result => result.type === "throw");
        expect(failures).toHaveLength(1);
        expect(failures[0].value).toBeInstanceOf(Error);
        expect(failures[0].value).toMatchObject({ code: "ERR_SQLITE_ERROR", errcode: 5 });
        // Only the full guard's read transaction ran; no identity transaction or
        // logical write reached SQLite, and the borrowed connection stayed open.
        expect(exec.mock.calls.map(call => call[0])).toEqual(["BEGIN", "ROLLBACK"]);
        expect(prepare.mock.calls.some(call => /^(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(call[0].trim()))).toBe(false);
        expect(close).not.toHaveBeenCalled(); expect(actor.isTransaction).toBe(true);
      } finally {
        prepare.mockRestore(); get.mockRestore(); all.mockRestore(); exec.mockRestore(); close.mockRestore();
      }
      // Read through the lock-owning fixture actor, including all profile,
      // session, challenge, identity, owner and financial original rows.
      expect(snapshot()).toBe(before); expect(readFileSync(f.file).equals(bytes)).toBe(true);
      actor.exec("ROLLBACK");
      expect(f.connection.db.isTransaction).toBe(false);
      expect((await f.port.list(alice)).identities).toEqual([record]);
      expect((await f.port.list(bob)).identities).toEqual([]);
      expect((await f.profiles.get(alice, network)).profile?.displayName).toBe("Alice");
      expect((await f.profiles.get(bob, network)).profile?.displayName).toBe("Bob");
      expect(f.connection.db.prepare("SELECT data FROM query_runs WHERE id=?").get("original")?.data).toBe('{"question":"retain original"}');
      expect(snapshot()).toBe(before); expect(readFileSync(f.file).equals(bytes)).toBe(true);
      expect(readFileSync(f.manifest)).toEqual(manifest);
    } finally {
      if (actor.isTransaction) actor.exec("ROLLBACK");
      actor.close();
    }
  });

  it("a genuine writer held beyond native 5000 ms refuses BEGIN without losing identity/profile/core readers", async () => {
    const f = await saved(), record = await f.verify(f.challenge("before-writer-lock"));
    const before = originals(f.file), pending = rows(f.file, "profile_identity_challenges"), writer = f.open();
    writer.db.exec("BEGIN IMMEDIATE");
    const exec = vi.spyOn(DatabaseSync.prototype, "exec"), close = vi.spyOn(DatabaseSync.prototype, "close");
    const c = f.challenge("writer-blocked"), started = performance.now();
    try {
      await expect(f.port.begin(c)).rejects.toThrow("identity_unavailable");
      expect(performance.now() - started).toBeGreaterThanOrEqual(5000);
      const failures = exec.mock.results.filter((result, index) => result.type === "throw"
        && exec.mock.calls[index][0] === "BEGIN IMMEDIATE");
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ type: "throw", value: { code: "ERR_SQLITE_ERROR", errcode: 5 } });
      expect(writer.db.isTransaction).toBe(true); expect(f.connection.db.isTransaction).toBe(false);
      expect(exec.mock.calls.some(call => call[0] === "ROLLBACK")).toBe(false);
      expect(close).not.toHaveBeenCalled();
      expect((await f.port.list(alice)).identities).toEqual([record]);
    } finally {
      exec.mockRestore(); close.mockRestore(); writer.db.exec("ROLLBACK"); writer.close();
    }
    expect(rows(f.file, "profile_identity_challenges")).toEqual(pending);
    expect((await f.port.list(alice)).identities).toEqual([record]);
    expect((await f.profiles.get(alice, network)).profile?.displayName).toBe("Alice");
    expect(f.connection.db.prepare("SELECT data FROM query_runs WHERE id=?").get("original")?.data).toBe('{"question":"retain original"}');
    await f.port.begin(c); await f.port.consume(c);
    await expect(f.port.consume(c)).rejects.toThrow("identity_expired");
    await f.port.complete(c, github); expect(originals(f.file)).toBe(before);
  }, 15_000); // Test allowance only; the native busy timeout is unchanged.

  it("a genuine held reader blocks COMMIT; guarded rollback retains pending consume and the shared ports", async () => {
    const f = await saved(), c = f.challenge("reader-blocked"), before = originals(f.file);
    await f.port.begin(c);
    const reader = f.open(true); reader.db.exec("BEGIN");
    expect(reader.db.prepare("SELECT count(*) AS n FROM profile_identity_challenges").get()?.n).toBe(1);
    const exec = vi.spyOn(DatabaseSync.prototype, "exec"), close = vi.spyOn(DatabaseSync.prototype, "close");
    try {
      await expect(f.port.consume(c)).rejects.toThrow("identity_unavailable");
      const failures = exec.mock.results.filter((result, index) => result.type === "throw" && exec.mock.calls[index][0] === "COMMIT");
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ type: "throw", value: { code: "ERR_SQLITE_ERROR", errcode: 5 } });
      expect(exec.mock.calls.filter(call => call[0] === "BEGIN IMMEDIATE")).toHaveLength(1);
      expect(exec.mock.calls.filter(call => call[0] === "ROLLBACK")).toHaveLength(1);
      expect(reader.db.isTransaction).toBe(true); expect(f.connection.db.isTransaction).toBe(false);
      expect(close).not.toHaveBeenCalled();
    } finally {
      exec.mockRestore(); close.mockRestore(); reader.db.exec("ROLLBACK"); reader.close();
    }
    expect(rows(f.file, "profile_identity_challenges")[0].status).toBe("pending");
    expect((await f.port.list(alice)).identities).toEqual([]);
    expect((await f.profiles.get(alice, network)).profile?.displayName).toBe("Alice");
    expect(f.connection.db.prepare("SELECT data FROM query_runs WHERE id=?").get("original")?.data).toBe('{"question":"retain original"}');
    await f.port.consume(c); await expect(f.port.consume(c)).rejects.toThrow("identity_expired");
    const record = await f.port.complete(c, github);
    await expect(f.port.complete(c, github)).rejects.toThrow("identity_expired");
    expect((await f.port.list(alice)).identities).toEqual([record]); expect(originals(f.file)).toBe(before);
  }, 15_000);

  it("genuine contention never masks manifest guard failure or revives the old shared connection after repair", async () => {
    const f = await saved(), manifest = readFileSync(f.manifest), writer = f.open();
    writer.db.exec("BEGIN IMMEDIATE");
    const originalExec = DatabaseSync.prototype.exec;
    let contended = false;
    const exec = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, statement: string) {
      try { return originalExec.call(this, statement); }
      catch (error) {
        if (statement === "BEGIN IMMEDIATE") {
          expect(error).toMatchObject({ code: "ERR_SQLITE_ERROR", errcode: 5 }); contended = true;
          writeFileSync(f.manifest, canonicalJson({ format: "keryx-storage-deployment-v1",
            identity: { ...f.identity, deploymentId: "d".repeat(36) }, backend: { kind: "sqlite", databasePath: f.file } }));
        }
        throw error;
      }
    });
    try { await expect(f.port.begin(f.challenge("contention-drift"))).rejects.toThrow("identity_unavailable"); expect(contended).toBe(true); }
    finally { exec.mockRestore(); writeFileSync(f.manifest, manifest); writer.db.exec("ROLLBACK"); writer.close(); }
    await expect(f.port.list(alice)).rejects.toThrow("identity_unavailable");
    await expect(f.profiles.get(alice, network)).rejects.toThrow();
    expect(() => f.connection.db.prepare("SELECT 1")).toThrow();
  }, 15_000);

  it.each([
    ["generic", "BEGIN IMMEDIATE", {}],
    ["caller-flags", "BEGIN IMMEDIATE", { busy: true, transient: true }],
    ["wrong-code", "BEGIN IMMEDIATE", { code: "SQLITE_BUSY", errcode: 5 }],
    ["string-errcode", "BEGIN IMMEDIATE", { code: "ERR_SQLITE_ERROR", errcode: "5" }],
    ["other-native-code", "BEGIN IMMEDIATE", { code: "ERR_SQLITE_ERROR", errcode: 1 }],
    ["generic-after-acquisition", "COMMIT", {}],
    ["generic-unique-message", "COMMIT", {}],
  ] as const)("unclassified %s failures permanently revoke even when cleanup succeeds", async (kind, sql, fields) => {
    const f = await saved(), originalExec = DatabaseSync.prototype.exec;
    const message = kind === "generic-unique-message"
      ? "UNIQUE constraint failed: profile_verified_identities.provider, profile_verified_identities.external_id" : "database is locked";
    const error = Object.assign(new Error(message), fields);
    let acquired = false, injected = false;
    const exec = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, statement: string) {
      if (!injected && statement === sql && (sql === "BEGIN IMMEDIATE" || acquired)) { injected = true; throw error; }
      const result = originalExec.call(this, statement);
      if (statement === "BEGIN IMMEDIATE") acquired = true;
      return result;
    });
    try { await expect(f.port.begin(f.challenge(kind))).rejects.toThrow("identity_unavailable"); expect(injected).toBe(true); }
    finally { exec.mockRestore(); }
    await expect(f.port.list(alice)).rejects.toThrow("identity_unavailable");
    await expect(f.profiles.get(alice, network)).rejects.toThrow();
    expect(() => f.connection.db.prepare("SELECT 1")).toThrow();
    expect(rows(f.file, "profile_identity_challenges")).toEqual([]);
  });

  it("failed guarded rollback permanently revokes instead of retaining an acquired transaction", async () => {
    const f = await saved(), originalExec = DatabaseSync.prototype.exec;
    const exec = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, statement: string) {
      if (statement === "ROLLBACK") throw new Error("cleanup failed");
      return originalExec.call(this, statement);
    });
    try {
      await expect(f.port.begin({ ...f.challenge("cleanup"), sessionHash: hash("absent-session") })).rejects.toThrow("identity_unavailable");
      expect(exec.mock.calls.some(call => call[0] === "ROLLBACK")).toBe(true);
    } finally { exec.mockRestore(); }
    await expect(f.port.list(alice)).rejects.toThrow("identity_unavailable");
    await expect(f.profiles.get(alice, network)).rejects.toThrow();
    expect(() => f.connection.db.prepare("SELECT 1")).toThrow();
    expect(rows(f.file, "profile_identity_challenges")).toEqual([]);
  });

  it("wrong wallet/session/state/provider/deadline cannot consume or complete the exact original", async () => {
    const f = await saved(), c = f.challenge("bound"); await f.port.begin(c);
    const changes = [{ wallet: bob, sessionHash: hash(bob) }, { sessionHash: hash(bob) }, { stateHash: hash("wrong-state") },
      { provider: "orcid" as const }, { expiresAt: new Date(Date.parse(c.expiresAt) + 1).toISOString() }];
    for (const change of changes) await expect(f.port.consume({ ...c, ...change })).rejects.toThrow("identity_expired");
    await f.port.consume(c);
    for (const change of changes) await expect(f.port.complete({ ...c, ...change }, github)).rejects.toThrow("identity_expired");
    await expect(f.port.complete(c, orcid)).rejects.toThrow("identity_expired");
    await f.port.complete(c, github);
    expect((await f.port.list(bob)).identities).toEqual([]);
  });

  it("missing profile, wrong-wallet/revoked/future/expired session and overlong deadline fail inside begin", async () => {
    const f = await saved(), c = f.challenge("session-required");
    await f.profiles.delete(alice); await expect(f.port.begin(c)).rejects.toThrow("profile_required");
    await f.profiles.update(alice, profile);
    for (const sessionHash of [hash("missing"), hash(bob)]) await expect(f.port.begin({ ...c, sessionHash })).rejects.toThrow("identity_expired");
    await expect(f.port.begin({ ...c, expiresAt: new Date(f.initialNow - 1).toISOString() })).rejects.toThrow("identity_expired");
    await expect(f.port.begin({ ...c, expiresAt: new Date(f.initialNow + 3_600_001).toISOString() })).rejects.toThrow("identity_expired");
    f.connection.db.prepare("UPDATE web_sessions SET issued_at=?,expires_at=? WHERE hash=?")
      .run(f.initialNow + 3_600_000, f.initialNow + 7_200_000, c.sessionHash);
    await expect(f.port.begin(c)).rejects.toThrow("identity_expired");
    f.connection.db.prepare("UPDATE web_sessions SET issued_at=?,expires_at=? WHERE hash=?")
      .run(f.initialNow - 60_000, f.initialNow - 1, c.sessionHash);
    await expect(f.port.begin(c)).rejects.toThrow("identity_expired");
    f.connection.db.prepare("DELETE FROM web_sessions WHERE hash=?").run(c.sessionHash);
    await expect(f.port.begin(c)).rejects.toThrow("identity_expired");
    expect(rows(f.file, "profile_identity_challenges")).toEqual([]);
  });

  it.each([
    ["consume", "revoke"], ["complete", "revoke"], ["consume", "wallet"], ["complete", "wallet"],
    ["consume", "shortened-deadline"], ["complete", "shortened-deadline"],
  ] as const)("live session %s/%s after begin/consume rejects without verification", async (operation, fault) => {
    const f = await saved(), c = f.challenge(`revoked-${operation}`); await f.port.begin(c);
    if (operation === "complete") await f.port.consume(c);
    if (fault === "revoke") f.connection.db.prepare("DELETE FROM web_sessions WHERE hash=?").run(c.sessionHash);
    if (fault === "wallet") f.connection.db.prepare("UPDATE web_sessions SET wallet=? WHERE hash=?").run(bob, c.sessionHash);
    if (fault === "shortened-deadline") f.connection.db.prepare("UPDATE web_sessions SET expires_at=? WHERE hash=?").run(Date.parse(c.expiresAt) - 1, c.sessionHash);
    await expect(operation === "consume" ? f.port.consume(c) : f.port.complete(c, github)).rejects.toThrow("identity_expired");
    expect((await f.port.list(alice)).identities).toEqual([]);
  });

  it.each(["pending", "consumed"] as const)("DB clock rejects expired seeded %s lineage with no fixture clock/function", async expired => {
    const f = fixture({ expired }), port = createEnrolledSqliteProfileIdentities(f.open().db)!;
    const c = { ...f.challenge("expired"), expiresAt: new Date(f.initialNow - 10_000).toISOString() };
    const clock = vi.spyOn(Date, "now").mockReturnValue(0);
    try { await expect(expired === "pending" ? port.consume(c) : port.complete(c, github)).rejects.toThrow("identity_expired"); }
    finally { clock.mockRestore(); }
    expect(rows(f.file, "profile_identity_challenges")[0].status).toBe(expired);
    expect((await port.list(alice)).identities).toEqual([]);
  });

  it.each(["consume", "complete"] as const)("deleted owner profile rejects in-flight %s inside the write", async operation => {
    const f = await saved(), c = f.challenge(`deleted-${operation}`); await f.port.begin(c);
    if (operation === "complete") await f.port.consume(c);
    await f.profiles.delete(alice);
    await expect(operation === "consume" ? f.port.consume(c) : f.port.complete(c, github)).rejects.toThrow("profile_required");
    expect((await f.port.list(alice)).identities).toEqual([]);
  });

  it("duplicate external ID preserves the loser's old verification and remains retryable after owner unlink", async () => {
    const f = await saved(), second = createEnrolledSqliteProfileIdentities(f.open().db)!;
    await f.verify(f.challenge("winner"));
    const previous = await f.verify(f.challenge("bob-original", bob), { ...github, externalId: "99999", label: "Bob" }, second);
    const loser = f.challenge("loser", bob); await second.begin(loser); await second.consume(loser);
    await expect(second.complete(loser, github)).rejects.toThrow("identity_conflict");
    expect((await second.list(bob)).identities).toEqual([previous]);
    await f.port.unlink(alice, "github"); await second.complete(loser, github);
    expect((await second.list(bob)).identities[0].externalId).toBe(github.externalId);
  });

  it.each(["unlink", "profile-delete", "replacement"] as const)("%s invalidates consumed callbacks, preserving other owners and original authority", async action => {
    const f = await saved(), before = originals(f.file), c = f.challenge("in-flight");
    const bobRecord = await f.verify(f.challenge("bob", bob), { ...github, externalId: "99999", label: "Bob" });
    await f.port.begin(c); await f.port.consume(c);
    if (action === "unlink") await f.port.unlink(alice, "github");
    if (action === "profile-delete") { await f.profiles.delete(alice); await f.profiles.update(alice, profile); }
    if (action === "replacement") await f.port.begin(f.challenge("next"));
    await expect(f.port.complete(c, github)).rejects.toThrow("identity_expired");
    expect((await f.port.list(alice)).identities).toEqual([]);
    expect((await f.port.list(bob)).identities).toEqual([bobRecord]);
    if (action !== "replacement") expect(rows(f.file, "profile_identity_challenges").filter(row => row.wallet === alice)).toEqual([]);
    expect(originals(f.file)).toBe(before);
  });

  it("genuine positive default FK and sealed configuration enforce both deletion cascades", async () => {
    const defaults = new DatabaseSync(":memory:"), disabled = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
    try {
      expect(defaults.prepare("PRAGMA foreign_keys").get()?.foreign_keys).toBe(1);
      expect(disabled.prepare("PRAGMA foreign_keys").get()?.foreign_keys).toBe(0);
      expect(() => assertVerifiedSqliteForeignKeys(defaults)).toThrow();
      expect(() => assertVerifiedSqliteForeignKeys(disabled)).toThrow();
      expect(() => createEnrolledSqliteProfileIdentities(disabled)).toThrow("identity_unavailable");
    } finally { defaults.close(); disabled.close(); }
    const f = await saved(), before = originals(f.file);
    expect(() => assertVerifiedSqliteForeignKeys(f.connection.db)).not.toThrow();
    expect(() => f.connection.db.exec("PRAGMA foreign_keys=OFF")).toThrow();
    expect(() => f.connection.db.prepare("PRAGMA foreign_keys")).toThrow();
    for (const name of ["function", "aggregate", "setAuthorizer", "open", "loadExtension"]) expect(() => Reflect.get(f.connection.db, name)).toThrow();
    await f.verify(f.challenge("alice")); await f.port.begin(f.challenge("alice-orcid", alice, "orcid"));
    const bobRecord = await f.verify(f.challenge("bob", bob), { ...github, externalId: "99999", label: "Bob" });
    await f.profiles.delete(alice);
    expect(rows(f.file, "profile_verified_identities").filter(row => row.wallet === alice)).toEqual([]);
    expect(rows(f.file, "profile_identity_challenges").filter(row => row.wallet === alice)).toEqual([]);
    expect((await f.port.list(bob)).identities).toEqual([bobRecord]);
    await f.port.unlink(bob, "github");
    expect(rows(f.file, "profile_identity_challenges")).toEqual([]);
    expect(originals(f.file)).toBe(before);
  });

  it("actual readonly LIST uses read transactions; all four mutations refuse before SQL and leave reader usable", async () => {
    const f = await saved(), record = await f.verify(f.challenge("readonly")), readonly = f.open(true);
    const port = createEnrolledSqliteProfileIdentities(readonly.db)!, before = readFileSync(f.file), c = f.challenge("denied");
    const prepare = vi.spyOn(DatabaseSync.prototype, "prepare"), exec = vi.spyOn(DatabaseSync.prototype, "exec");
    try {
      await expect(port.begin(c)).rejects.toThrow("identity_unavailable");
      await expect(port.consume(c)).rejects.toThrow("identity_unavailable");
      await expect(port.complete(c, github)).rejects.toThrow("identity_unavailable");
      await expect(port.unlink(stranger, "github")).rejects.toThrow("identity_unavailable");
      await expect(port.begin(null as unknown as IdentityChallenge)).rejects.toThrow("identity_unavailable");
      expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
      expect((await port.list(alice)).identities).toEqual([record]);
      expect(exec.mock.calls.some(call => call[0] === "BEGIN")).toBe(true);
      expect(exec.mock.calls.some(call => call[0] === "BEGIN IMMEDIATE")).toBe(false);
    } finally { prepare.mockRestore(); exec.mockRestore(); }
    expect(readFileSync(f.file)).toEqual(before);
  });

  it("mounted identity GET reads the genuine port without any provider call", async () => {
    const f = await saved(), record = await f.verify(f.challenge("mounted"));
    const facade = Object.create(null) as KeryxDB;
    Object.defineProperty(facade, "profileIdentities", { value: f.port });
    const provider = vi.fn(() => null), exchange = vi.fn(async () => github);
    const routes = createIdentityRoutes({ session: async () => ({ db: facade, wallet: alice, currentId: hash(alice) }),
      key: async () => null, db: async () => facade, provider, exchange, applicationOrigin: "https://keryx.invalid", secret: "synthetic-fixture-secret-".repeat(2) });
    expect(requireProfileIdentities(facade)).toBe(f.port); expect(Object.keys(facade)).not.toContain("profileIdentities");
    const response = await routes.GET(new Request("https://keryx.invalid/api/me/profile/identities"));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ wallet: alice, identities: [record] });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(provider).not.toHaveBeenCalled(); expect(exchange).not.toHaveBeenCalled();
  });

  it("absent domain stays absent with zero constructor DDL; raw/ordinary/fake/callback inputs cannot qualify", () => {
    const f = fixture({ shape: "absent" }), connection = f.open(), before = readFileSync(f.file);
    const exec = vi.spyOn(DatabaseSync.prototype, "exec");
    try {
      expect(createEnrolledSqliteProfileIdentities(connection.db)).toBeUndefined();
      expect(exec.mock.calls.every(call => ["BEGIN", "COMMIT", "ROLLBACK"].includes(call[0]))).toBe(true);
    } finally { exec.mockRestore(); }
    const raw = new DatabaseSync(f.file), ordinary = new DatabaseSync(":memory:");
    try {
      expect(() => createEnrolledSqliteProfileIdentities(raw)).toThrow("identity_unavailable");
      expect(() => createSqliteProfileIdentities(raw)).toThrow("identity_unavailable");
      expect(() => createEnrolledSqliteProfileIdentities(ordinary)).toThrow("identity_unavailable");
      expect(() => createEnrolledSqliteProfileIdentities({} as DatabaseSync)).toThrow("identity_unavailable");
      expect(() => Reflect.apply(createEnrolledSqliteProfileIdentities, null, [connection.db, () => {}])).toThrow("identity_unavailable");
      expect(raw.prepare("SELECT name FROM sqlite_schema WHERE name='profile_identity_challenges'").get()).toBeUndefined();
    } finally { raw.close(); ordinary.close(); }
    expect(readFileSync(f.file)).toEqual(before);
  });

  it("present constructor only validates the same native database and performs no DDL or seed", () => {
    const f = fixture(), connection = f.open(), before = readFileSync(f.file);
    const exec = vi.spyOn(DatabaseSync.prototype, "exec");
    try {
      expect(createEnrolledSqliteProfileIdentities(connection.db)).toBeDefined();
      expect(exec.mock.calls.every(call => ["BEGIN", "COMMIT", "ROLLBACK"].includes(call[0]))).toBe(true);
    } finally { exec.mockRestore(); }
    expect(rows(f.file, "profile_verified_identities")).toEqual([]);
    expect(rows(f.file, "profile_identity_challenges")).toEqual([]); expect(readFileSync(f.file)).toEqual(before);
  });

  it.each(["partial", "missing-profile", "changed-session"] as const)("%s schema refuses even on a genuine connection without its own full-profile guard", shape => {
    const f = fixture({ shape }), connection = f.open(false, false), before = readFileSync(f.file);
    expect(() => createEnrolledSqliteProfileIdentities(connection.db)).toThrow("identity_unavailable");
    expect(readFileSync(f.file)).toEqual(before);
  });

  it.each(PROFILE_IDENTITIES_STORAGE_DOMAIN.tables.flatMap(table => PROFILE_IDENTITIES_STORAGE_DOMAIN.fenceOperations.map(operation =>
    [table, operation] as const)))("missing %s/%s native writer fence refuses admission without repair", (table, operation) => {
    const f = fixture(), raw = new DatabaseSync(f.file);
    try { raw.exec(`DROP TRIGGER storage_fence_${hash(table).slice(0, 16)}_${operation.toLowerCase()}`); } finally { raw.close(); }
    const before = readFileSync(f.file);
    expect(() => f.open()).toThrow(); expect(readFileSync(f.file)).toEqual(before);
  });

  it.each(["begin", "consume", "complete", "unlink"] as const)("%s as the FIRST call after drift revokes the capability", async operation => {
    const f = await saved(), c = f.challenge("first-operation"); await f.port.begin(c); await f.port.consume(c);
    const raw = new DatabaseSync(f.file);
    try { raw.exec("CREATE INDEX first_call_drift ON profile_identity_challenges(session_hash)"); } finally { raw.close(); }
    const before = readFileSync(f.file);
    const call = operation === "begin" ? f.port.begin(f.challenge("new-first")) : operation === "consume" ? f.port.consume(c)
      : operation === "complete" ? f.port.complete(c, github) : f.port.unlink(alice, "github");
    await expect(call).rejects.toThrow("identity_unavailable");
    await expect(f.port.list(alice)).rejects.toThrow("identity_unavailable"); expect(readFileSync(f.file)).toEqual(before);
  });

  const identityFence = `storage_fence_${hash("profile_identity_challenges").slice(0, 16)}_update`;
  it.each([
    "CREATE INDEX unreviewed_identity_index ON profile_verified_identities(label)",
    "CREATE TRIGGER unreviewed_identity_trigger AFTER DELETE ON profile_verified_identities BEGIN DELETE FROM private_profiles; END",
    "ALTER TABLE private_profiles ADD COLUMN drift TEXT",
    "DROP INDEX web_sessions_wallet",
    `DROP TRIGGER ${identityFence}`,
    "DROP TRIGGER storage_identity_no_update",
    "DROP TABLE profile_identity_challenges",
  ])("WRITE-FIRST drift revokes old port without changes or repair: %s", async sql => {
    const f = await saved(), c = f.challenge("drift"); await f.port.begin(c); await f.port.consume(c);
    const raw = new DatabaseSync(f.file);
    try { raw.exec(sql); } finally { raw.close(); }
    const before = readFileSync(f.file), evidence = originals(f.file);
    const calls = [() => f.port.begin(f.challenge("write-first")), () => f.port.consume(c), () => f.port.complete(c, github),
      () => f.port.unlink(alice, "github"), () => f.port.list(alice)];
    for (const call of calls) await expect(call()).rejects.toThrow("identity_unavailable");
    expect(originals(f.file)).toBe(evidence); expect(readFileSync(f.file)).toEqual(before);
  });

  it("repairing a temporary drift after refusal never revives the old port", async () => {
    const f = await saved();
    const drift = new DatabaseSync(f.file);
    try { drift.exec("CREATE INDEX temporary_drift ON profile_verified_identities(label)"); } finally { drift.close(); }
    await expect(f.port.unlink(alice, "github")).rejects.toThrow("identity_unavailable");
    const repair = new DatabaseSync(f.file);
    try { repair.exec("DROP INDEX temporary_drift"); } finally { repair.close(); }
    await expect(f.port.list(alice)).rejects.toThrow("identity_unavailable");
    await expect(f.port.begin(f.challenge("still-revoked"))).rejects.toThrow("identity_unavailable");
    expect((await createEnrolledSqliteProfileIdentities(f.open().db)!.list(alice)).identities).toEqual([]);
  });

  it("a complete bundle without trusted full-profile admission cannot qualify", () => {
    const f = fixture(), connection = f.open(false, false), before = readFileSync(f.file);
    expect(() => createEnrolledSqliteProfileIdentities(connection.db)).toThrow("identity_unavailable");
    expect(readFileSync(f.file)).toEqual(before);
  });

  it("held file replacement is prevented on Windows or permanently revokes the old port", async () => {
    const f = await saved(), before = originals(f.file);
    const retained = join(f.directory, "retained-original.sqlite");
    if (process.platform === "win32") {
      // Native SQLite holds a Windows handle without delete sharing. The OS
      // prevents replacement; prove that protection and continued guarded reads.
      expect(() => renameSync(f.file, retained)).toThrow(expect.objectContaining({ code: "EBUSY" }));
      expect((await f.port.list(alice)).identities).toEqual([]);
    } else {
      renameSync(f.file, retained); copyFileSync(retained, f.file);
      await expect(f.port.begin(f.challenge("write-first"))).rejects.toThrow("identity_unavailable");
      await expect(f.port.list(alice)).rejects.toThrow("identity_unavailable");
      await expect(f.port.unlink(alice, "github")).rejects.toThrow("identity_unavailable");
    }
    expect(originals(f.file)).toBe(before);
  });

  it.each(["manifest", "close"] as const)("%s change revokes WRITE-FIRST old capability permanently", async fault => {
    const f = await saved(), before = originals(f.file);
    if (fault === "manifest") {
      writeFileSync(f.manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity: { ...f.identity, deploymentId: "d".repeat(36) }, backend: { kind: "sqlite", databasePath: f.file } }));
    }
    if (fault === "close") f.connection.close();
    await expect(f.port.begin(f.challenge("write-first"))).rejects.toThrow("identity_unavailable");
    await expect(f.port.list(alice)).rejects.toThrow("identity_unavailable");
    await expect(f.port.unlink(alice, "github")).rejects.toThrow("identity_unavailable");
    expect(originals(f.file)).toBe(before);
  });
});

describe("selected enrolled facade profile identities (source controls, not production acceptance)", () => {
  it.each([false, true])("exact BEFORE keeps writer/readonly port absent and authenticated LIST unavailable (archive=%s)", async archive => {
    const f = fixture({ archive, shape: "absent" }), before = readFileSync(f.file), original = originals(f.file);
    const { api, facade } = await selectedFacade(f);
    const readonly = await api.createReadonlyEnrolledSqliteAdapter(); connections.push(readonly);
    for (const selected of [facade, readonly]) {
      expect(api.assertEnrolledSqliteAdapter(selected)).toEqual(f.identity);
      expect(selected.profileIdentities).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(selected, "profileIdentities")).toBeUndefined();
      expect(() => requireProfileIdentities(selected)).toThrow("identity_unavailable");
      const response = await facadeIdentityGet(selected);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "identity_unavailable" });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(originals(f.file)).toBe(original); expect(readFileSync(f.file)).toEqual(before);
  });

  it.each([false, true])("full19 exposes a hidden frozen same-store port and saved-owner LIST lifecycle (archive=%s)", async archive => {
    const f = await savedFacadeFixture({ archive }), before = readFileSync(f.file), schema = wholeSchema(f.file);
    const original = originals(f.file), profiles = rows(f.file, "private_profiles"), manifest = readFileSync(f.manifest);
    const { api, facade } = await selectedFacade(f), port = requireProfileIdentities(facade);
    expect(api.assertEnrolledSqliteAdapter(facade, "write")).toEqual(f.identity);
    expect(Object.getPrototypeOf(facade)).toBeNull(); expect(Object.isFrozen(facade)).toBe(true);
    expect(Object.isFrozen(port)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(facade, "profileIdentities")).toEqual({
      value: port, enumerable: false, writable: false, configurable: false,
    });
    expect(Object.keys(facade)).not.toContain("profileIdentities");
    expect(readFileSync(f.file)).toEqual(before); // Factory performs no DDL, seed or ordinary initialization.
    const empty = await facadeIdentityGet(facade);
    expect(empty.status).toBe(200); expect(await empty.json()).toEqual({ wallet: alice, identities: [] });
    const c = f.challenge("selected-lifecycle"); await port.begin(c); await port.consume(c);
    const pending = await facadeIdentityGet(facade);
    expect(pending.status).toBe(200); expect(await pending.json()).toEqual({ wallet: alice, identities: [] });
    await expect(port.consume(c)).rejects.toThrow("identity_expired");
    const record = await port.complete(c, github);
    expect(record).toMatchObject({ wallet: alice, ...github });
    const response = await facadeIdentityGet(facade);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ wallet: alice, identities: [record] });
    const other = await facadeIdentityGet(facade, bob);
    expect(other.status).toBe(200); expect(await other.json()).toEqual({ wallet: bob, identities: [] });
    expect((await facadeIdentityGet(facade, alice, bob)).status).toBe(409);
    expect(await facade.getWebSession(hash(alice))).toMatchObject({ hash: hash(alice), wallet: alice });
    expect((await facade.listPaymentsByQuery("original")).map(payment => payment.id)).toEqual(["original-payment"]);
    expect(rows(f.file, "private_profiles")).toEqual(profiles); expect(originals(f.file)).toBe(original);
    expect(wholeSchema(f.file)).toBe(schema); expect(readFileSync(f.manifest)).toEqual(manifest);
  });

  it("healthy readonly selected port refuses all mutations before SQL and preserves authenticated GET and file bytes", async () => {
    const f = await savedFacadeFixture(), { api, facade } = await selectedFacade(f), writer = requireProfileIdentities(facade);
    const c = f.challenge("selected-readonly"); await writer.begin(c); await writer.consume(c);
    const record = await writer.complete(c, github);
    const readonly = await api.createReadonlyEnrolledSqliteAdapter(); connections.push(readonly);
    const port = requireProfileIdentities(readonly), before = readFileSync(f.file);
    expect(api.assertEnrolledSqliteAdapter(readonly)).toEqual(f.identity);
    expect(() => api.assertEnrolledSqliteAdapter(readonly, "write")).toThrow("Enrolled SQLite adapter unavailable");
    expect(Object.getOwnPropertyDescriptor(readonly, "profileIdentities")).toEqual({
      value: port, enumerable: false, writable: false, configurable: false,
    });
    expect(Object.isFrozen(port)).toBe(true);
    const prepare = vi.spyOn(DatabaseSync.prototype, "prepare"), exec = vi.spyOn(DatabaseSync.prototype, "exec");
    try {
      await expect(port.begin(f.challenge("readonly-denied"))).rejects.toThrow("identity_unavailable");
      await expect(port.consume(c)).rejects.toThrow("identity_unavailable");
      await expect(port.complete(c, github)).rejects.toThrow("identity_unavailable");
      await expect(port.unlink(alice, "github")).rejects.toThrow("identity_unavailable");
      expect(() => readonly.revokeWebSession(hash(alice), alice)).toThrow("Readonly enrolled SQLite mutation refused");
      expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
      const response = await facadeIdentityGet(readonly);
      expect(response.status).toBe(200); expect(await response.json()).toEqual({ wallet: alice, identities: [record] });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(exec.mock.calls.some(call => call[0] === "BEGIN")).toBe(true);
      expect(exec.mock.calls.some(call => call[0] === "BEGIN IMMEDIATE")).toBe(false);
    } finally { prepare.mockRestore(); exec.mockRestore(); }
    expect(readFileSync(f.file)).toEqual(before);
  });

  it.each(["partial", "missing-profile", "changed-session", "unknown"] as const)("selected factory refuses %s schema without repair or fallback", async shape => {
    const f = fixture({ shape: shape === "unknown" ? "present" : shape });
    if (shape === "unknown") {
      const raw = new DatabaseSync(f.file);
      try { raw.exec("CREATE INDEX unreviewed_facade_index ON profile_verified_identities(label)"); } finally { raw.close(); }
    }
    const before = readFileSync(f.file), original = originals(f.file), schema = wholeSchema(f.file);
    await expect(selectedFacade(f)).rejects.toThrow();
    expect(readFileSync(f.file)).toEqual(before); expect(originals(f.file)).toBe(original); expect(wholeSchema(f.file)).toBe(schema);
  });

  it.each(["manifest", "schema", "closed-provenance"] as const)("selected port revokes WRITE-FIRST on %s drift and authenticated LIST refuses", async fault => {
    const f = await savedFacadeFixture(), { api, facade } = await selectedFacade(f), port = requireProfileIdentities(facade);
    const original = originals(f.file), profiles = rows(f.file, "private_profiles"), manifest = readFileSync(f.manifest);
    if (fault === "manifest") writeFileSync(f.manifest, canonicalJson({ format: "keryx-storage-deployment-v1",
      identity: { ...f.identity, deploymentId: "d".repeat(36) }, backend: { kind: "sqlite", databasePath: f.file } }));
    if (fault === "schema") {
      const raw = new DatabaseSync(f.file);
      try { raw.exec("CREATE INDEX selected_facade_drift ON profile_verified_identities(label)"); } finally { raw.close(); }
    }
    if (fault === "closed-provenance") facade.close();
    const beforeRefusal = readFileSync(f.file);
    await expect(port.begin(f.challenge("selected-write-first"))).rejects.toThrow("identity_unavailable");
    await expect(port.list(alice)).rejects.toThrow("identity_unavailable");
    expect(() => api.assertEnrolledSqliteAdapter(facade)).toThrow();
    const response = await facadeIdentityGet(facade);
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "identity_unavailable" });
    expect(readFileSync(f.file)).toEqual(beforeRefusal);
    expect(originals(f.file)).toBe(original); expect(rows(f.file, "private_profiles")).toEqual(profiles);
    if (fault === "manifest") writeFileSync(f.manifest, manifest);
    if (fault === "schema") {
      const raw = new DatabaseSync(f.file);
      try { raw.exec("DROP INDEX selected_facade_drift"); } finally { raw.close(); }
    }
    await expect(port.list(alice)).rejects.toThrow("identity_unavailable");
    expect((await facadeIdentityGet(facade)).status).toBe(503);
  });

  it("selected held file prevents replacement on Windows or refuses the replaced file and authenticated LIST", async () => {
    const f = await savedFacadeFixture(), { facade } = await selectedFacade(f), port = requireProfileIdentities(facade);
    const original = originals(f.file), profiles = rows(f.file, "private_profiles"), before = readFileSync(f.file);
    const retained = join(f.directory, "selected-retained-original.sqlite");
    if (process.platform === "win32") {
      expect(() => renameSync(f.file, retained)).toThrow(expect.objectContaining({ code: "EBUSY" }));
      const response = await facadeIdentityGet(facade);
      expect(response.status).toBe(200); expect(await response.json()).toEqual({ wallet: alice, identities: [] });
    } else {
      renameSync(f.file, retained); copyFileSync(retained, f.file);
      await expect(port.begin(f.challenge("selected-file-drift"))).rejects.toThrow("identity_unavailable");
      await expect(port.list(alice)).rejects.toThrow("identity_unavailable");
      expect((await facadeIdentityGet(facade)).status).toBe(503);
    }
    expect(readFileSync(f.file)).toEqual(before);
    expect(originals(f.file)).toBe(original); expect(rows(f.file, "private_profiles")).toEqual(profiles);
  });
});
