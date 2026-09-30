import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteAdapter } from "./sqlite-adapter";
import { syntheticStorageIdentity, provisionSyntheticStorage } from "./storage-identity-fixture";
import { createSqliteStorage, inspectSqliteEnrollment, enrollSqliteStorage, type ReviewedStorageEnrollment } from "./storage-identity-provision";
import { openVerifiedSqliteStorage } from "./storage-identity-connection";
import { STORAGE_IDENTITY_TABLE } from "./storage-identity-sqlite";
import { scanFullStorageSnapshot } from "./storage-identity-snapshot";

const dirs: string[] = [], adapters: SqliteAdapter[] = [], rawConnections: DatabaseSync[] = [];
const file = () => { const dir = mkdtempSync(join(tmpdir(), "keryx-storage-identity-")); dirs.push(dir); return join(dir, "store.sqlite"); };
afterEach(() => { for (const raw of rawConnections.splice(0)) { try { raw.close(); } catch {} } for (const adapter of adapters.splice(0)) adapter.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });
async function fixture(mode: "testnet-real" | "testnet-offline" = "testnet-real") {
  const target = file(), identity = await provisionSyntheticStorage(target, mode);
  vi.stubEnv("CONTENT_MASTER_KEY", "67".repeat(32));
  const db = new SqliteAdapter(target, { expectedIdentity: identity }); adapters.push(db); await db.init();
  return { target, identity, db };
}

describe("SQLite strict identity admission", () => {
  it("refuses malformed raw UTF-8 text without a replacement-character snapshot collision", () => {
    const raw = new DatabaseSync(file()); rawConnections.push(raw);
    raw.exec("CREATE TABLE source_meta(id INTEGER PRIMARY KEY, payload TEXT); INSERT INTO source_meta VALUES(1,CAST(X'FF' AS TEXT));");
    expect(() => scanFullStorageSnapshot(raw)).toThrow(/malformed_text/);
    raw.exec("UPDATE source_meta SET payload=CAST(X'FE' AS TEXT)");
    expect(() => scanFullStorageSnapshot(raw)).toThrow(/malformed_text/);
  });
  it("hashes unselected payload, exact SQL value types and WITHOUT ROWID tables", () => {
    const raw = new DatabaseSync(file()); rawConnections.push(raw);
    raw.exec("CREATE TABLE source_meta(id TEXT PRIMARY KEY,payload) WITHOUT ROWID; INSERT INTO source_meta VALUES('id',1);");
    const first = scanFullStorageSnapshot(raw).snapshotDigest;
    raw.exec("UPDATE source_meta SET payload='1'");
    const text = scanFullStorageSnapshot(raw).snapshotDigest;
    raw.exec("UPDATE source_meta SET payload=X'31'");
    const blob = scanFullStorageSnapshot(raw).snapshotDigest;
    expect(new Set([first,text,blob]).size).toBe(3);
  });
  it("refuses missing expected identity and missing files without creation", async () => {
    const target = file();
    expect(() => new SqliteAdapter(target)).toThrow();
    expect(() => new SqliteAdapter(target, { expectedIdentity: syntheticStorageIdentity("testnet-offline") })).toThrow();
    expect(existsSync(target)).toBe(false);
  });
  it("refuses legacy files before WAL/schema/cache or counter mutation", async () => {
    const target = file(), raw = new DatabaseSync(target);
    raw.exec("CREATE TABLE cache_items(source_id TEXT,text TEXT); INSERT INTO cache_items VALUES('keep','private fixture');"); raw.close();
    const bytes = readFileSync(target);
    expect(() => new SqliteAdapter(target, { expectedIdentity: syntheticStorageIdentity("testnet-real") })).toThrow(/enrollment_required/);
    expect(readFileSync(target)).toEqual(bytes);
    expect(existsSync(target + "-wal")).toBe(false);
  });
  it("refuses a foreign identity before writes and gates authority until init and after close", async () => {
    const target = file(), identity = await provisionSyntheticStorage(target, "testnet-offline");
    const bytes = readFileSync(target);
    expect(() => new SqliteAdapter(target, { expectedIdentity: { ...identity, authorityMode: "testnet-real" } })).toThrow(/identity_mismatch/);
    expect(readFileSync(target)).toEqual(bytes);
    const db = new SqliteAdapter(target, { expectedIdentity: identity }); adapters.push(db);
    for (const operation of [() => db.getSessionGrant("owner"), () => db.getSource("source"), () => db.metrics(), () => db.getWebSession("a".repeat(64))]) {
      await expect(operation()).rejects.toThrow(/not initialized/);
    }
    await db.init(); expect(await db.getSource("source")).toBeNull();
    db.close(); await expect(db.getSource("source")).rejects.toThrow(/not initialized/);
  });
  it("old raw writers, including already-open connections, cannot mutate any application table", async () => {
    const target = file(), old = new DatabaseSync(target); rawConnections.push(old);
    old.exec("CREATE TABLE source_meta(id TEXT PRIMARY KEY,rss_url TEXT); INSERT INTO source_meta VALUES('keep','original');");
    const identity = syntheticStorageIdentity("testnet-real"), inspection = await inspectSqliteEnrollment(target, identity);
    const reviewed: ReviewedStorageEnrollment = { format: "keryx-reviewed-storage-enrollment-v1", inspection,
      provenanceDocumentDigest: identity.provenanceDigest, unknownClassAttestation: inspection.unknownClasses };
    await enrollSqliteStorage(target, identity, reviewed);
    expect(() => old.prepare("UPDATE source_meta SET rss_url='attacker'").run()).toThrow();
    const checked = openVerifiedSqliteStorage(target, identity);
    try {
      checked.db.prepare("UPDATE source_meta SET rss_url=? WHERE id=?").run("compatible", "keep");
      expect(checked.db.prepare("SELECT rss_url FROM source_meta").get()?.rss_url).toBe("compatible");
      expect(() => checked.db.exec(`DROP TRIGGER storage_identity_no_update`)).toThrow();
      expect(() => checked.db.exec(`ATTACH ':memory:' AS alternate`)).toThrow();
      expect(() => checked.db.prepare(`UPDATE ${STORAGE_IDENTITY_TABLE} SET identity='{}'`).run()).toThrow();
    } finally { checked.close(); old.close(); }
  });
});

describe("SQLite mode and row profile", () => {
  it("allows offline simulations but refuses real payments, grants, private reservations and journal activation", async () => {
    const { target, identity } = await fixture("testnet-offline"), checked = openVerifiedSqliteStorage(target, identity);
    try {
      checked.db.exec("INSERT INTO payment_events(id,amount_usdc,network,settled,settlement_status) VALUES('sim',0.1,'eip155:5042002',0,'simulated')");
      expect(() => checked.db.exec("INSERT INTO payment_events(id,amount_usdc,network,settled,settlement_status) VALUES('pending',0.1,'eip155:5042002',0,'pending')")).toThrow();
      expect(() => checked.db.exec("INSERT INTO session_grants(session_id,sess_addr,owner_addr,cap,expiry,tx_hash) VALUES('s','a','b',1,1,'t')")).toThrow();
      expect(() => checked.db.exec("INSERT INTO private_treasury_pools(id) VALUES('p')")).toThrow();
      expect(() => checked.db.exec("UPDATE browser_journal_control SET active=1")).toThrow();
      expect(() => checked.db.exec("DELETE FROM browser_journal_control; INSERT INTO browser_journal_control VALUES(1,1)")).toThrow();
    } finally { checked.close(); }
  });
  it("real storage denies new simulations and cross-network payment/withdrawal/browser authority", async () => {
    const { target, identity } = await fixture(), checked = openVerifiedSqliteStorage(target, identity);
    try {
      expect(() => checked.db.exec("INSERT INTO payment_events(id,amount_usdc,network,settled,settlement_status) VALUES('sim',0.1,'eip155:5042002',0,'simulated')")).toThrow();
      expect(() => checked.db.exec("INSERT INTO payment_events(id,amount_usdc,network,settled,settlement_status) VALUES('foreign',0.1,'eip155:5042',0,'pending')")).toThrow();
      expect(() => checked.db.exec("INSERT INTO withdrawals(tx_hash,network) VALUES('foreign','eip155:5042')")).toThrow();
      checked.db.exec("INSERT INTO payment_events(id,amount_usdc,network,settled,settlement_status) VALUES('pending',0.1,'eip155:5042002',0,'pending')");
      expect(() => checked.db.exec("UPDATE payment_events SET network='eip155:5042' WHERE id='pending'")).toThrow();
    } finally { checked.close(); }
  });
});
