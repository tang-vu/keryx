import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../canonical-json";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { CHAT_ACCOUNT_TABLES } from "./chat-accounts-schema";
import { NATIVE_USER_DOMAIN_TABLES } from "./native-user-domain-schema-data";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { privateProfilesMigrationProfiles } from "./private-profiles-storage-migration";
import { HISTORICAL_NATIVE_USER_DOMAIN_TABLES, snapshotTopicWatchesStorage, topicWatchesMigrationProfiles } from "./topic-watches-storage-migration";
import { assertStorageFences, insertStorageIdentity, installStorageFences, registerStorageCapability,
  storageFenceStatements } from "./storage-identity-sqlite";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { inspectPrivateProfileStorage, runPrivateProfileStorageCli } from "../../scripts/private-profile-storage-migrate.mjs";

const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const addedTables = [...CHAT_ACCOUNT_TABLES, "topic_watches"] as const;
function fixture(archive = false, historical = true, topicOnly = false) {
  const directory = mkdtempSync(join(tmpdir(), "keryx-native-metadata-")); directories.push(directory);
  const file = join(directory, "historical19.sqlite"), manifest = join(directory, "deployment.json");
  const identity: StorageIdentity = { ...syntheticStorageIdentity("testnet-real"), format: "keryx-mainnet-storage-identity-v1",
    authorityMode: "mainnet-real", network: "eip155:5042", profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  const db = new DatabaseSync(file);
  try {
    db.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(db, { publicReferenceArchive: archive }); installNativeUserDomainSchema(db);
    // Explicit disposable full19; never a production downgrade. Current source keeps all three.
    if (historical) for (const table of addedTables) db.exec(`DROP TABLE "${table}"`);
    else if (topicOnly) for (const table of CHAT_ACCOUNT_TABLES) db.exec(`DROP TABLE "${table}"`);
    if (topicOnly) db.prepare("INSERT INTO topic_watches(wallet,id,revision,state) VALUES(?,?,?,?)")
      .run(`0x${"a".repeat(40)}`, "retained-watch", 7, '{"retained":true}');
    db.exec("INSERT INTO sync_state(key,value,updated_at) VALUES('raw-text',CAST(X'fffe00c3' AS TEXT),NULL)");
    db.exec("INSERT INTO query_runs(id,question,budget,duration_ms,data,created_at) VALUES('original','Retained',0.03125,9007199254740993,'{}','2026-10-01T00:00:00.000Z')");
    db.prepare(`INSERT INTO payment_events(id,query_id,network,settled,settlement_status,amount_usdc,kind,rationale,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run("pending-original", "original", identity.network, 0, "pending", 0.005, "fetch", Buffer.from([0, 255, 128]), "2026-10-01T00:00:00.000Z");
    db.prepare("INSERT INTO private_profiles VALUES(?,?,'Retained reader','','','[]',?,?)")
      .run(`0x${"a".repeat(40)}`, "retained", "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z");
    insertStorageIdentity(db, identity); installStorageFences(db, identity); db.exec("COMMIT");
  } finally { db.close(); }
  writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } }));
  const snapshot = (target = file) => {
    const connection = new DatabaseSync(target, { readOnly: true });
    try { return snapshotTopicWatchesStorage(connection, identity, topicWatchesMigrationProfiles().flat()); }
    finally { connection.close(); }
  };
  const options = (suffix = "") => {
    const inspected = inspectPrivateProfileStorage(manifest);
    return ["migrate", "--manifest", manifest, "--expected-manifest", inspected.manifestDigest,
      "--expected-identity", inspected.identityDigest, "--backup", join(directory, `backup${suffix}.sqlite`),
      "--receipt", join(directory, `receipt${suffix}.jsonl`), "--writers-stopped"];
  };
  return { directory, file, manifest, identity, snapshot, options };
}
function schema(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all(); }
  finally { db.close(); }
}

describe("stock protected command: historical full19 to compiled full22", () => {
  it("adds migration-only references without widening the four runtime profiles", () => {
    expect(HISTORICAL_NATIVE_USER_DOMAIN_TABLES).toHaveLength(19);
    expect(NATIVE_USER_DOMAIN_TABLES).toHaveLength(22);
    expect([...NATIVE_USER_DOMAIN_TABLES].sort()).toEqual([...HISTORICAL_NATIVE_USER_DOMAIN_TABLES, ...addedTables].sort());
    const runtime = supportedSqliteApplicationProfiles(true);
    expect(runtime).toHaveLength(4);
    expect(new Set(runtime)).toEqual(new Set(privateProfilesMigrationProfiles().flat()));
    for (const [before, current] of topicWatchesMigrationProfiles()) {
      expect(runtime).not.toContain(before); expect(runtime).toContain(current);
    }
  });

  it.each([false, true])("uses the existing CLI and verified backup, retaining all old typed cells/schema (archive=%s)", async archive => {
    const f = fixture(archive), before = f.snapshot(), oldSchema = schema(f.file), args = f.options();
    const result = await runPrivateProfileStorageCli(args);
    expect(result).toMatchObject({ phase: "migration-verified", status: "migrated", originalRowsPreserved: true, signingResumeAuthorized: false });
    expect(f.snapshot(args[8])).toEqual(before);
    const after = f.snapshot(), retained = { ...after.tables };
    for (const table of addedTables) { expect(retained[table].rows).toBe(0); delete retained[table]; }
    expect(retained).toEqual(before.tables);
    const names = new Set(oldSchema.map(row => row.name));
    expect(schema(f.file).filter(row => names.has(row.name))).toEqual(oldSchema);
    const added = schema(f.file).filter(row => !names.has(row.name));
    expect(added.filter(row => row.type === "table").map(row => row.name)).toEqual([...addedTables].sort());
    expect(added.every(row => addedTables.some(table => table === row.tbl_name))).toBe(true);
    expect(added.filter(row => row.type === "trigger")).toHaveLength(9);
    const db = new DatabaseSync(f.file, { readOnly: true });
    try {
      assertStorageFences(db, f.identity);
      for (const table of addedTables)
        expect(Object.values(storageFenceStatements(db, f.identity)).filter(sql => sql.includes(`ON "${table}"`))).toHaveLength(3);
      expect(db.prepare("SELECT settled,settlement_status,amount_usdc,hex(rationale) AS blob FROM payment_events").get())
        .toMatchObject({ settled: 0, settlement_status: "pending", amount_usdc: 0.005, blob: "00FF80" });
      expect(db.prepare("SELECT id FROM deliverable_acceptance_store WHERE singleton=1").get()!.id).toBeTypeOf("string");
    } finally { db.close(); }
    const receipts = readFileSync(args[10], "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(receipts.map(row => row.phase)).toEqual(["backup-verified", "migration-verified"]);
    expect(receipts[0].beforeSnapshotDigest).toBe(createHash("sha256").update(canonicalJson(before)).digest("hex"));
    const backupHash = digest(args[8]);
    await expect(runPrivateProfileStorageCli(args)).rejects.toThrow();
    expect(digest(args[8])).toBe(backupHash); expect(f.snapshot()).toEqual(after);
  });

  it.each([false, true])("migrates installed full20 with populated topics to exact compiled22 (archive=%s)", async archive => {
    const f = fixture(archive, false, true), before = f.snapshot(), oldSchema = schema(f.file), args = f.options();
    expect(before.tables.topic_watches.rows).toBe(1);
    const result = await runPrivateProfileStorageCli(args);
    expect(result).toMatchObject({ phase: "migration-verified", status: "migrated", originalRowsPreserved: true, signingResumeAuthorized: false });
    expect(f.snapshot(args[8])).toEqual(before);
    const after = f.snapshot(), retained = { ...after.tables };
    for (const table of CHAT_ACCOUNT_TABLES) { expect(retained[table].rows).toBe(0); delete retained[table]; }
    expect(retained).toEqual(before.tables);
    const names = new Set(oldSchema.map(row => row.name));
    expect(schema(f.file).filter(row => names.has(row.name))).toEqual(oldSchema);
    const added = schema(f.file).filter(row => !names.has(row.name));
    expect(added.filter(row => row.type === "table").map(row => row.name)).toEqual([...CHAT_ACCOUNT_TABLES].sort());
    expect(added.every(row => CHAT_ACCOUNT_TABLES.some(table => table === row.tbl_name))).toBe(true);
    expect(added.filter(row => row.type === "trigger")).toHaveLength(6);
    const db = new DatabaseSync(f.file, { readOnly: true });
    try {
      assertStorageFences(db, f.identity);
      expect(db.prepare("SELECT id,revision,state FROM topic_watches").get())
        .toEqual({ id: "retained-watch", revision: 7, state: '{"retained":true}' });
      for (const table of CHAT_ACCOUNT_TABLES)
        expect(Object.values(storageFenceStatements(db, f.identity)).filter(sql => sql.includes('ON "' + table + '"'))).toHaveLength(3);
      expect(db.prepare("SELECT settled,settlement_status,amount_usdc,hex(rationale) AS blob FROM payment_events").get())
        .toMatchObject({ settled: 0, settlement_status: "pending", amount_usdc: 0.005, blob: "00FF80" });
    } finally { db.close(); }
    expect(readFileSync(args[10], "utf8").trim().split("\n").map(line => JSON.parse(line).phase))
      .toEqual(["backup-verified", "migration-verified"]);
  });

  it("already-current preserves populated metadata and private domains", async () => {
    const f = fixture(); await runPrivateProfileStorageCli(f.options());
    const db = new DatabaseSync(f.file);
    try {
      registerStorageCapability(db, f.identity, () => true); db.exec("BEGIN");
      db.prepare("INSERT INTO topic_watches(wallet,id,revision,state) VALUES(?,?,?,?)").run(`0x${"a".repeat(40)}`, "kept", 1, "{}");
      db.prepare(`INSERT INTO chat263_links(platform,scope,user_id,channel,origin,network,account_id,wallet,member_generation,linked_at)
        VALUES('telegram','synthetic','7','7','https://keryx.example',?,?,?,?,?)`)
        .run(f.identity.network, `acct_${"b".repeat(64)}`, `0x${"a".repeat(40)}`, "c".repeat(64), 1);
      db.prepare(`INSERT INTO chat263_tokens(token_hash,purpose,platform,scope,user_id,channel,origin,network,issued_at,expires_at,consumed_at)
        VALUES(?,'chat-account-link-v1','telegram','synthetic','7','7','https://keryx.example',?,0,300000,NULL)`)
        .run("d".repeat(64), f.identity.network);
      db.exec("COMMIT");
    } finally { db.close(); }
    const before = f.snapshot(), result = await runPrivateProfileStorageCli(f.options("-current"));
    for (const table of addedTables) expect(before.tables[table].rows).toBe(1);
    expect(result).toMatchObject({ status: "already-current", signingResumeAuthorized: false });
    expect(f.snapshot()).toEqual(before);
  });

  it.each([false, true])("middle new-fence refusal retains genuine backup and typed source (installed20=%s)", async topicOnly => {
    const f = fixture(false, !topicOnly, topicOnly), before = f.snapshot(), oldSchema = schema(f.file), args = f.options();
    const original = DatabaseSync.prototype.exec; let fences = 0;
    const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
      if (sql.startsWith("CREATE TRIGGER storage_fence_") && sql.includes('ON "' + (topicOnly ? "chat263_links" : "topic_watches") + '"') && ++fences === 2)
        throw new Error("Injected middle metadata fence refusal");
      return Reflect.apply(original, this, [sql]);
    });
    try { await expect(runPrivateProfileStorageCli(args)).rejects.toThrow("Injected middle metadata fence refusal"); }
    finally { spy.mockRestore(); }
    expect(fences).toBe(2); expect(f.snapshot()).toEqual(before); expect(schema(f.file)).toEqual(oldSchema);
    expect(f.snapshot(args[8])).toEqual(before);
    expect(readFileSync(args[10], "utf8").trim().split("\n").map(line => JSON.parse(line).phase)).toEqual(["backup-verified"]);
  });

  it.each(["CREATE INDEX unreviewed ON query_runs(asker)", "DROP TABLE private_profiles"])("refuses unknown or partial schema before backup: %s", async sql => {
    const f = fixture(), args = f.options(), db = new DatabaseSync(f.file);
    try { if (sql === "DROP TABLE private_profiles") registerStorageCapability(db, f.identity, () => true); db.exec(sql); } finally { db.close(); }
    const before = digest(f.file);
    await expect(runPrivateProfileStorageCli(args)).rejects.toThrow();
    expect(digest(f.file)).toBe(before); expect(existsSync(args[8])).toBe(false); expect(existsSync(args[10])).toBe(false);
  });

  it.each([
    { shape: "half chat: links only", drop: ["chat263_tokens", "topic_watches"] },
    { shape: "half chat: tokens only", drop: ["chat263_links", "topic_watches"] },
    { shape: "full21: chat pair only", drop: ["topic_watches"] },
    { shape: "full21: topic and chat links", drop: ["chat263_tokens"] },
    { shape: "full21: topic and chat tokens", drop: ["chat263_links"] },
  ])("refuses $shape without repair or partial DDL", async ({ drop }) => {
    const f = fixture(false, false), args = f.options(), db = new DatabaseSync(f.file);
    try {
      registerStorageCapability(db, f.identity, () => true); db.exec("BEGIN");
      for (const table of drop) db.exec(`DROP TABLE "${table}"`);
      db.exec("COMMIT");
    } finally { db.close(); }
    const before = digest(f.file), oldSchema = schema(f.file);
    expect(() => inspectPrivateProfileStorage(f.manifest)).toThrow();
    await expect(runPrivateProfileStorageCli(args)).rejects.toThrow();
    expect(digest(f.file)).toBe(before); expect(schema(f.file)).toEqual(oldSchema);
    expect(existsSync(args[8])).toBe(false); expect(existsSync(args[10])).toBe(false);
  });

  it("refuses absent writer-stop and changed manifest/identity bindings without creating backup", async () => {
    const f = fixture(), args = f.options(), before = digest(f.file);
    await expect(runPrivateProfileStorageCli(args.slice(0, -1))).rejects.toThrow();
    for (const index of [4, 6]) {
      const wrong = [...args]; wrong[index] = "0".repeat(64);
      await expect(runPrivateProfileStorageCli(wrong)).rejects.toThrow();
    }
    expect(digest(f.file)).toBe(before); expect(existsSync(args[8])).toBe(false); expect(existsSync(args[10])).toBe(false);
  });

  it.each([false, true])("post-COMMIT uncertainty retains backup and stopped-writer authority (installed20=%s)", async topicOnly => {
    const f = fixture(false, !topicOnly, topicOnly), before = f.snapshot(), args = f.options();
    const original = DatabaseSync.prototype.exec; let target: DatabaseSync | undefined, committed = false;
    const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
      if (sql.includes("BEGIN EXCLUSIVE")) target = this;
      if (this === target && sql === "BEGIN" && committed) throw new Error("Injected metadata acknowledgement uncertainty");
      const result = Reflect.apply(original, this, [sql]);
      if (this === target && sql === "COMMIT") committed = true;
      return result;
    });
    try { await expect(runPrivateProfileStorageCli(args)).rejects.toThrow("Injected metadata acknowledgement uncertainty"); }
    finally { spy.mockRestore(); }
    expect(committed).toBe(true); expect(f.snapshot(args[8])).toEqual(before);
    const after = f.snapshot(), retained = { ...after.tables };
    for (const table of topicOnly ? CHAT_ACCOUNT_TABLES : addedTables) { expect(retained[table].rows).toBe(0); delete retained[table]; }
    expect(retained).toEqual(before.tables);
    expect(readFileSync(args[10], "utf8").trim().split("\n").map(line => JSON.parse(line).phase)).toEqual(["backup-verified"]);
  });
});
