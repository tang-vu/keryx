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
import { HISTORICAL_NATIVE_USER_DOMAIN_TABLES, PRE_OWNER_NATIVE_USER_DOMAIN_TABLES, snapshotTopicWatchesStorage,
  topicWatchesMigrationProfiles, ownerRunAssignmentsMigrationProfiles } from "./topic-watches-storage-migration";
import { OWNER269_OCCUPANCY_PROPOSAL } from "../owner-run-assignments/occupancy-proposal";
import { OWNER_RUN_ASSIGNMENTS_SQL } from "../owner-run-assignments/schema";
import { assertStorageFences, insertStorageIdentity, installStorageFences, registerStorageCapability,
  storageFenceStatements } from "./storage-identity-sqlite";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { inspectPrivateProfileStorage, runPrivateProfileStorageCli } from "../../scripts/private-profile-storage-migrate.mjs";

const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
function seedChatRows(db: DatabaseSync, identity: StorageIdentity) {
  // Schema-valid disposable historical cells, not a live bot/account consent proof.
  const account = `acct_${"b".repeat(64)}`, wallet = `0x${"a".repeat(40)}`;
  db.prepare("INSERT INTO account267_accounts(account_id,revision,created_at) VALUES(?,1,0)").run(account);
  db.prepare("INSERT INTO account267_members(wallet,account_id,generation,consent_hash,linked_at) VALUES(?,?,?,?,1)")
    .run(wallet, account, "c".repeat(64), "e".repeat(64));
  db.prepare("INSERT INTO account267_credentials(wallet,account_id,member_generation,generation,login_after,active) VALUES(?,?,?,?,0,1)")
    .run(wallet, account, "c".repeat(64), "f".repeat(64));
  db.prepare(`INSERT INTO chat263_links(platform,scope,user_id,channel,origin,network,account_id,wallet,member_generation,linked_at)
    VALUES('telegram','synthetic','7','7','https://keryx.example',?,?,?,?,1)`)
    .run(identity.network, account, wallet, "c".repeat(64));
  db.prepare(`INSERT INTO chat263_tokens(token_hash,purpose,platform,scope,user_id,channel,origin,network,issued_at,expires_at,consumed_at)
    VALUES(?,'chat-account-link-v1','telegram','synthetic','7','7','https://keryx.example',?,0,300000,NULL)`)
    .run("d".repeat(64), identity.network);
}
const metadataTables = ["topic_watches", ...CHAT_ACCOUNT_TABLES, "owner269_operations", "owner269_associations"] as const;
function fixture(archive = false, oldFamily: 19 | 20 | 22 | 24 = 20) {
  const directory = mkdtempSync(join(tmpdir(), "keryx-native-metadata-")); directories.push(directory);
  const file = join(directory, "historical19.sqlite"), manifest = join(directory, "deployment.json");
  const identity: StorageIdentity = { ...syntheticStorageIdentity("testnet-real"), format: "keryx-mainnet-storage-identity-v1",
    authorityMode: "mainnet-real", network: "eip155:5042", profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  const db = new DatabaseSync(file);
  try {
    db.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(db, { publicReferenceArchive: archive }); installNativeUserDomainSchema(db);
    // Source-built exact predecessor families; current24 is only for corruption controls.
    if (oldFamily !== 24) {
      for (const guard of OWNER269_OCCUPANCY_PROPOSAL) db.exec(`DROP TRIGGER "${guard.name}"`);
      db.exec("DROP TABLE owner269_associations; DROP TABLE owner269_operations");
      if (oldFamily !== 22) for (const table of [...CHAT_ACCOUNT_TABLES].reverse()) db.exec(`DROP TABLE "${table}"`);
      if (oldFamily === 19) db.exec("DROP TABLE topic_watches");
    }
    if (oldFamily === 22 || oldFamily === 24) seedChatRows(db, identity);
    if (oldFamily === 20 || oldFamily === 22) db.prepare("INSERT INTO topic_watches(wallet,id,revision,state) VALUES(?,?,?,?)")
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
    try { return snapshotTopicWatchesStorage(connection, identity, [...topicWatchesMigrationProfiles(), ...ownerRunAssignmentsMigrationProfiles()].flat()); }
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

function retainedOld(after: ReturnType<ReturnType<typeof fixture>["snapshot"]>, before: ReturnType<ReturnType<typeof fixture>["snapshot"]>) {
  const retained = { ...after.tables };
  for (const table of metadataTables) if (!(table in before.tables)) {
    expect(retained[table].rows).toBe(0); delete retained[table];
  }
  expect(retained).toEqual(before.tables);
}

describe("stock protected command: exact old19/old20/pre-owner chat22 to compiled24 (UNRUN)", () => {
  it("adds migration-only references without widening the four runtime profiles", () => {
    expect(PRE_OWNER_NATIVE_USER_DOMAIN_TABLES).toEqual([...HISTORICAL_NATIVE_USER_DOMAIN_TABLES, "topic_watches"]);
    expect([...NATIVE_USER_DOMAIN_TABLES].sort()).toEqual([...PRE_OWNER_NATIVE_USER_DOMAIN_TABLES, ...CHAT_ACCOUNT_TABLES, "owner269_operations", "owner269_associations"].sort());
    const runtime = supportedSqliteApplicationProfiles(true);
    expect(runtime).toHaveLength(4);
    expect(new Set(runtime)).toEqual(new Set(privateProfilesMigrationProfiles().flat()));
    for (const [before, current] of [...topicWatchesMigrationProfiles(), ...ownerRunAssignmentsMigrationProfiles()]) {
      expect(runtime).not.toContain(before); expect(runtime).toContain(current);
    }
  });

  it.each([[false, 19], [true, 19], [false, 20], [true, 20], [false, 22], [true, 22]] as const)("uses the existing CLI and verified backup, retaining all old typed cells/schema (archive=%s, oldFamily=%s)", async (archive, oldFamily) => {
    const f = fixture(archive, oldFamily), before = f.snapshot(), oldSchema = schema(f.file), args = f.options();
    if (oldFamily !== 19) expect(before.tables.topic_watches.rows).toBe(1);
    if (oldFamily === 22) for (const table of CHAT_ACCOUNT_TABLES) expect(before.tables[table].rows).toBe(1);
    const result = await runPrivateProfileStorageCli(args);
    expect(result).toMatchObject({ phase: "migration-verified", status: "migrated", originalRowsPreserved: true, signingResumeAuthorized: false });
    expect(f.snapshot(args[8])).toEqual(before);
    const after = f.snapshot(); retainedOld(after, before);
    const names = new Set(oldSchema.map(row => row.name));
    expect(schema(f.file).filter(row => names.has(row.name))).toEqual(oldSchema);
    const added = schema(f.file).filter(row => !names.has(row.name));
    expect(added.filter(row => row.type === "table").map(row => row.name).sort())
      .toEqual([...(oldFamily === 19 ? ["topic_watches"] : []), ...(oldFamily === 22 ? [] : CHAT_ACCOUNT_TABLES), "owner269_associations", "owner269_operations"].sort());
    expect(added.every(row => metadataTables.some(table => table === row.tbl_name)
      || row.type === "trigger" && OWNER269_OCCUPANCY_PROPOSAL.some(guard => guard.name === row.name && guard.sql === row.sql))).toBe(true);
    for (const guard of OWNER269_OCCUPANCY_PROPOSAL)
      expect(added).toContainEqual({ type: "trigger", name: guard.name, tbl_name: guard.sql.match(/ ON ([a-z0-9_]+)\n/)![1], sql: guard.sql });
    expect(added.filter(row => OWNER269_OCCUPANCY_PROPOSAL.some(guard => guard.name === row.name))).toHaveLength(6);
    const db = new DatabaseSync(f.file, { readOnly: true });
    try {
      assertStorageFences(db, f.identity);
      for (const table of metadataTables)
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

  it("already-current preserves populated metadata and private domains", async () => {
    const f = fixture(); await runPrivateProfileStorageCli(f.options());
    const db = new DatabaseSync(f.file);
    try {
      registerStorageCapability(db, f.identity, () => true); db.exec("BEGIN");
      db.prepare("INSERT INTO topic_watches(wallet,id,revision,state) VALUES(?,?,?,?)").run(`0x${"a".repeat(40)}`, "kept", 1, "{}");
      seedChatRows(db, f.identity);
      db.exec("COMMIT");
    } finally { db.close(); }
    const before = f.snapshot(), result = await runPrivateProfileStorageCli(f.options("-current"));
    for (const table of ["topic_watches", ...CHAT_ACCOUNT_TABLES]) expect(before.tables[table].rows).toBe(1);
    expect(result).toMatchObject({ status: "already-current", signingResumeAuthorized: false });
    expect(f.snapshot()).toEqual(before);
  });

  it("middle new-fence refusal rolls back all new DDL; keeps the genuine backup and old typed source", async () => {
    const f = fixture(), before = f.snapshot(), oldSchema = schema(f.file), args = f.options();
    const original = DatabaseSync.prototype.exec; let fences = 0;
    const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
      if (sql.startsWith("CREATE TRIGGER storage_fence_") && sql.includes('ON "owner269_associations"') && ++fences === 2)
        throw new Error("Injected middle metadata fence refusal");
      return Reflect.apply(original, this, [sql]);
    });
    try { await expect(runPrivateProfileStorageCli(args)).rejects.toThrow("Injected middle metadata fence refusal"); }
    finally { spy.mockRestore(); }
    expect(fences).toBe(2); expect(f.snapshot()).toEqual(before); expect(schema(f.file)).toEqual(oldSchema);
    expect(f.snapshot(args[8])).toEqual(before);
    expect(readFileSync(args[10], "utf8").trim().split("\n").map(line => JSON.parse(line).phase)).toEqual(["backup-verified"]);
  });

  it.each(["CREATE INDEX unreviewed ON query_runs(asker)", "DROP TABLE private_profiles",
    "CREATE TABLE owner269_operations(request_id TEXT PRIMARY KEY,input_digest TEXT,event TEXT)",
    "CREATE TABLE owner269_associations(assignment_id TEXT PRIMARY KEY)",
    "CREATE TABLE chat263_links(value TEXT); CREATE TABLE chat263_tokens(value TEXT)",
    "CREATE TABLE pending_job_owners(value TEXT)",
    "DROP TRIGGER storage_mode_payment_insert"])("refuses unknown/full21/partial/future family or missing fence before backup: %s", async sql => {
    const f = fixture(), args = f.options(), db = new DatabaseSync(f.file);
    try { if (sql === "DROP TABLE private_profiles") registerStorageCapability(db, f.identity, () => true); db.exec(sql); } finally { db.close(); }
    const before = digest(f.file);
    await expect(runPrivateProfileStorageCli(args)).rejects.toThrow();
    expect(digest(f.file)).toBe(before); expect(existsSync(args[8])).toBe(false); expect(existsSync(args[10])).toBe(false);
  });

  it.each([
    { mode: "partial-owner21", family: 20, completeOwner: false, shared: false },
    { mode: "partial-owner23", family: 22, completeOwner: false, shared: false },
    { mode: "count-equivalent owner22 without chat", family: 20, completeOwner: true, shared: true },
    { mode: "full24 missing shared guards", family: 22, completeOwner: true, shared: false },
  ] as const)("refuses $mode even with all its identity fences", async ({ family, completeOwner, shared }) => {
    const f = fixture(false, family), args = f.options(), db = new DatabaseSync(f.file);
    try {
      db.exec("BEGIN IMMEDIATE"); registerStorageCapability(db, f.identity, () => true);
      db.exec(completeOwner ? OWNER_RUN_ASSIGNMENTS_SQL : OWNER_RUN_ASSIGNMENTS_SQL.split("CREATE TABLE owner269_associations")[0]);
      if (shared) for (const guard of OWNER269_OCCUPANCY_PROPOSAL) db.exec(guard.sql);
      installStorageFences(db, f.identity); db.exec("COMMIT");
    } finally { db.close(); }
    const before = digest(f.file);
    await expect(runPrivateProfileStorageCli(args)).rejects.toThrow();
    expect(digest(f.file)).toBe(before); expect(existsSync(args[8])).toBe(false); expect(existsSync(args[10])).toBe(false);
  });

  it("rolls back the table pair and earlier shared guards when a middle fixed guard cannot install", async () => {
    const f = fixture(), before = f.snapshot(), oldSchema = schema(f.file), args = f.options();
    const original = DatabaseSync.prototype.exec; let target: DatabaseSync | undefined, refused = false;
    const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
      if (sql.includes("BEGIN EXCLUSIVE")) target = this;
      if (this === target && sql.startsWith("CREATE TRIGGER owner269_original_update")) {
        refused = true; throw new Error("Injected shared occupancy guard refusal");
      }
      return Reflect.apply(original, this, [sql]);
    });
    try { await expect(runPrivateProfileStorageCli(args)).rejects.toThrow("Injected shared occupancy guard refusal"); }
    finally { spy.mockRestore(); }
    expect(refused).toBe(true); expect(f.snapshot()).toEqual(before); expect(schema(f.file)).toEqual(oldSchema);
    expect(f.snapshot(args[8])).toEqual(before);
    expect(readFileSync(args[10], "utf8").trim().split("\n").map(line => JSON.parse(line).phase)).toEqual(["backup-verified"]);
  });

  it.each([
    { shape: "half chat: links only", family: 22, drop: ["chat263_tokens", "topic_watches"] },
    { shape: "half chat: tokens only", family: 22, drop: ["chat263_links", "topic_watches"] },
    { shape: "chat pair without topic", family: 22, drop: ["topic_watches"] },
    { shape: "topic and chat links", family: 22, drop: ["chat263_tokens"] },
    { shape: "topic and chat tokens", family: 22, drop: ["chat263_links"] },
    { shape: "current owner family without chat token table", family: 24, drop: ["chat263_tokens"] },
  ] as const)("refuses $shape without repair or partial DDL", async ({ family, drop }) => {
    const f = fixture(false, family), args = f.options(), db = new DatabaseSync(f.file);
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

  it("post-COMMIT acknowledgement refusal never restores the retained old backup over the new source", async () => {
    const f = fixture(), before = f.snapshot(), args = f.options();
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
    const after = f.snapshot(); retainedOld(after, before);
    expect(readFileSync(args[10], "utf8").trim().split("\n").map(line => JSON.parse(line).phase)).toEqual(["backup-verified"]);
  });
});
