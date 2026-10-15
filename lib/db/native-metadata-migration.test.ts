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
import { PENDING_JOB_OWNERS_SQL } from "./pending-job-owners-schema";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { privateProfilesMigrationProfiles } from "./private-profiles-storage-migration";
import { HISTORICAL_NATIVE_USER_DOMAIN_TABLES, PRE_OWNER_NATIVE_USER_DOMAIN_TABLES,
  PRE_PENDING_JOB_OWNERS_NATIVE_USER_DOMAIN_TABLES, snapshotTopicWatchesStorage,
  topicWatchesMigrationProfiles, ownerRunAssignmentsMigrationProfiles, pendingJobOwnersMigrationProfiles } from "./topic-watches-storage-migration";
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
function seedRetainedPendingRow(db: DatabaseSync, identity: StorageIdentity) {
  // Typed expired synthetic retention cells only, not a session/admission proof,
  // successful payment, historical owner inference or live pending-job claim.
  const wallet = `0x${"a".repeat(40)}`, requestHash = "d".repeat(64), date = "2026-10-01T00:00:00.000Z";
  db.prepare(`INSERT INTO a2a_orders(id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,
    service_fee_usdc,research_mode,status,transaction_id,request_data,created_at,updated_at)
    VALUES('original','original','synthetic-retained-authorization',?,?,?,0.000001,0,0.000001,'quick','failed','synthetic',?,?,?)`)
    .run(requestHash, wallet, `0x${"9".repeat(40)}`, canonicalJson({ network: identity.network }), date, date);
  db.prepare(`INSERT INTO pending_job_owners(job_id,query_id,request_hash,network,wallet,session_hash,issued_at,expires_at,admitted_at)
    VALUES('original','original',?,?,?,?,1,2,?)`)
    .run(requestHash, identity.network, wallet, "e".repeat(64), date);
}
const metadataTables = ["topic_watches", ...CHAT_ACCOUNT_TABLES, "owner269_operations", "owner269_associations", "pending_job_owners"] as const;
function fixture(archive = false, oldFamily: 19 | 20 | 22 | 24 = 20) {
  const directory = mkdtempSync(join(tmpdir(), "keryx-native-metadata-")); directories.push(directory);
  const file = join(directory, "historical19.sqlite"), manifest = join(directory, "deployment.json");
  const identity: StorageIdentity = { ...syntheticStorageIdentity("testnet-real"), format: "keryx-mainnet-storage-identity-v1",
    authorityMode: "mainnet-real", network: "eip155:5042", profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  const db = new DatabaseSync(file);
  try {
    db.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(db, { publicReferenceArchive: archive }); installNativeUserDomainSchema(db);
    // Fixed synthetic setup actor only; strip pending ownership before installing fences.
    registerStorageCapability(db, identity, () => true); db.exec("DROP TABLE pending_job_owners");
    // Source-built exact old19/old20/chat22/pre-pending24 predecessor families.
    if (oldFamily !== 24) {
      for (const guard of OWNER269_OCCUPANCY_PROPOSAL) db.exec(`DROP TRIGGER "${guard.name}"`);
      db.exec("DROP TABLE owner269_associations; DROP TABLE owner269_operations");
      if (oldFamily !== 22) for (const table of [...CHAT_ACCOUNT_TABLES].reverse()) db.exec(`DROP TABLE "${table}"`);
      if (oldFamily === 19) db.exec("DROP TABLE topic_watches");
    }
    if (oldFamily === 22 || oldFamily === 24) seedChatRows(db, identity);
    if (oldFamily !== 19) db.prepare("INSERT INTO topic_watches(wallet,id,revision,state) VALUES(?,?,?,?)")
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
    try { return snapshotTopicWatchesStorage(connection, identity,
      [...topicWatchesMigrationProfiles(), ...ownerRunAssignmentsMigrationProfiles(), ...pendingJobOwnersMigrationProfiles()].flat()); }
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

describe("stock protected command: exact old19/old20/pre-owner chat22/pre-pending24 to compiled25 (UNRUN)", () => {
  it("adds migration-only references without widening the four runtime profiles", () => {
    expect(PRE_OWNER_NATIVE_USER_DOMAIN_TABLES).toEqual([...HISTORICAL_NATIVE_USER_DOMAIN_TABLES, "topic_watches"]);
    expect(PRE_PENDING_JOB_OWNERS_NATIVE_USER_DOMAIN_TABLES).toEqual([...PRE_OWNER_NATIVE_USER_DOMAIN_TABLES, ...CHAT_ACCOUNT_TABLES, "owner269_operations", "owner269_associations"]);
    expect([...NATIVE_USER_DOMAIN_TABLES].sort()).toEqual([...PRE_PENDING_JOB_OWNERS_NATIVE_USER_DOMAIN_TABLES, "pending_job_owners"].sort());
    const runtime = supportedSqliteApplicationProfiles(true);
    expect(runtime).toHaveLength(4);
    expect(new Set(runtime)).toEqual(new Set(privateProfilesMigrationProfiles().flat()));
    const pairs = [...topicWatchesMigrationProfiles(), ...ownerRunAssignmentsMigrationProfiles(), ...pendingJobOwnersMigrationProfiles()];
    expect(pairs).toHaveLength(8); expect(pendingJobOwnersMigrationProfiles()).toHaveLength(2);
    for (const [before, current] of pairs) {
      expect(runtime).not.toContain(before); expect(runtime).toContain(current);
    }
  });

  it.each([[false, 19], [true, 19], [false, 20], [true, 20], [false, 22], [true, 22], [false, 24], [true, 24]] as const)("uses the existing CLI and verified backup, retaining all old typed cells/schema (archive=%s, oldFamily=%s)", async (archive, oldFamily) => {
    const f = fixture(archive, oldFamily), before = f.snapshot(), oldSchema = schema(f.file), args = f.options();
    if (oldFamily !== 19) expect(before.tables.topic_watches.rows).toBe(1);
    if (oldFamily === 22 || oldFamily === 24) for (const table of CHAT_ACCOUNT_TABLES) expect(before.tables[table].rows).toBe(1);
    expect(before.tables.pending_job_owners).toBeUndefined();
    const result = await runPrivateProfileStorageCli(args);
    expect(result).toMatchObject({ phase: "migration-verified", status: "migrated", originalRowsPreserved: true, signingResumeAuthorized: false });
    expect(f.snapshot(args[8])).toEqual(before);
    const after = f.snapshot(); retainedOld(after, before);
    expect(after.tables.pending_job_owners.rows).toBe(0);
    const names = new Set(oldSchema.map(row => row.name));
    expect(schema(f.file).filter(row => names.has(row.name))).toEqual(oldSchema);
    const added = schema(f.file).filter(row => !names.has(row.name));
    expect(added.filter(row => row.type === "table").map(row => row.name).sort())
      .toEqual([...(oldFamily === 24 ? [] : [...(oldFamily === 19 ? ["topic_watches"] : []),
        ...(oldFamily === 22 ? [] : CHAT_ACCOUNT_TABLES), "owner269_associations", "owner269_operations"]), "pending_job_owners"].sort());
    expect(added.every(row => metadataTables.some(table => table === row.tbl_name)
      || row.type === "trigger" && OWNER269_OCCUPANCY_PROPOSAL.some(guard => guard.name === row.name && guard.sql === row.sql))).toBe(true);
    for (const guard of oldFamily === 24 ? [] : OWNER269_OCCUPANCY_PROPOSAL)
      expect(added).toContainEqual({ type: "trigger", name: guard.name, tbl_name: guard.sql.match(/ ON ([a-z0-9_]+)\n/)![1], sql: guard.sql });
    expect(added.filter(row => OWNER269_OCCUPANCY_PROPOSAL.some(guard => guard.name === row.name))).toHaveLength(oldFamily === 24 ? 0 : 6);
    if (oldFamily === 24) expect(added.every(row => row.tbl_name === "pending_job_owners")).toBe(true);
    expect(added.filter(row => row.type === "trigger" && ["pending_job_owners_no_update", "pending_job_owners_no_delete"].includes(String(row.name))))
      .toHaveLength(2);
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

  it.each([false, true])("already-current preserves populated metadata, retained pending cells and private domains (archive=%s)", async archive => {
    const f = fixture(archive); await runPrivateProfileStorageCli(f.options());
    const db = new DatabaseSync(f.file);
    try {
      registerStorageCapability(db, f.identity, () => true); db.exec("BEGIN");
      // The populated historical topic row is already retained by the migration.
      seedChatRows(db, f.identity);
      seedRetainedPendingRow(db, f.identity);
      db.exec("COMMIT");
    } finally { db.close(); }
    const before = f.snapshot(), result = await runPrivateProfileStorageCli(f.options("-current"));
    for (const table of ["topic_watches", ...CHAT_ACCOUNT_TABLES]) expect(before.tables[table].rows).toBe(1);
    expect(before.tables.pending_job_owners.rows).toBe(1);
    expect(result).toMatchObject({ status: "already-current", signingResumeAuthorized: false });
    expect(f.snapshot()).toEqual(before);
  });

  it.each(["missing index", "missing immutable trigger", "wrong columns"] as const)("refuses partial/count-equivalent pending25 with complete identity fences: %s", async shape => {
    const f = fixture(false, 24), args = f.options(), db = new DatabaseSync(f.file);
    try {
      registerStorageCapability(db, f.identity, () => true); db.exec("BEGIN IMMEDIATE");
      db.exec(shape === "wrong columns" ? "CREATE TABLE pending_job_owners(value TEXT)" : PENDING_JOB_OWNERS_SQL);
      if (shape === "missing index") db.exec("DROP INDEX pending_job_owners_wallet");
      if (shape === "missing immutable trigger") db.exec("DROP TRIGGER pending_job_owners_no_update");
      installStorageFences(db, f.identity); db.exec("COMMIT");
    } finally { db.close(); }
    const before = digest(f.file), oldSchema = schema(f.file);
    expect(() => inspectPrivateProfileStorage(f.manifest)).toThrow();
    await expect(runPrivateProfileStorageCli(args)).rejects.toThrow();
    expect(digest(f.file)).toBe(before); expect(schema(f.file)).toEqual(oldSchema);
    expect(existsSync(args[8])).toBe(false); expect(existsSync(args[10])).toBe(false);
  });

  it("old24 pending-fence refusal rolls back only the new domain and retains the verified backup", async () => {
    const f = fixture(false, 24), before = f.snapshot(), oldSchema = schema(f.file), args = f.options();
    const original = DatabaseSync.prototype.exec; let target: DatabaseSync | undefined, fences = 0;
    const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
      if (sql.includes("BEGIN EXCLUSIVE")) target = this;
      if (this === target && sql.startsWith("CREATE TRIGGER storage_fence_") && sql.includes('ON "pending_job_owners"') && ++fences === 2)
        throw new Error("Injected middle pending fence refusal");
      return Reflect.apply(original, this, [sql]);
    });
    try { await expect(runPrivateProfileStorageCli(args)).rejects.toThrow("Injected middle pending fence refusal"); }
    finally { spy.mockRestore(); }
    expect(fences).toBe(2); expect(f.snapshot()).toEqual(before); expect(schema(f.file)).toEqual(oldSchema);
    expect(f.snapshot(args[8])).toEqual(before);
    expect(readFileSync(args[10], "utf8").trim().split("\n").map(line => JSON.parse(line).phase)).toEqual(["backup-verified"]);
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

  it.each([20, 24] as const)("post-COMMIT acknowledgement refusal never restores the retained old backup over the new source (oldFamily=%s)", async oldFamily => {
    const f = fixture(false, oldFamily), before = f.snapshot(), args = f.options();
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
