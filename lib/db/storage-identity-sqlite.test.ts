import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync, existsSync, openSync, closeSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { SqliteAdapter } from "./sqlite-adapter";
import { syntheticStorageIdentity, provisionSyntheticStorage } from "./storage-identity-fixture";
import { createSqliteStorage, inspectSqliteEnrollment, enrollSqliteStorage, backupVerifiedSqliteStorage, type ReviewedStorageEnrollment } from "./storage-identity-provision";
import { openVerifiedSqliteStorage } from "./storage-identity-connection";
import { STORAGE_IDENTITY_TABLE, holdStorageTarget } from "./storage-identity-sqlite";
import { assertExclusiveCreatedTarget } from "./storage-identity-provision-core";
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
  it("refuses an ordinary replacement of the exclusively created empty file, or the platform locks it", () => {
    const target=file(), descriptor=openSync(target,'wx',0o600);
    try {
      let locked=false;
      try {renameSync(target,target+'.original');} catch (error) {
        expect(['EPERM','EACCES','EBUSY']).toContain((error as NodeJS.ErrnoException).code); locked=true;
      }
      if(!locked) {
        writeFileSync(target,'');
        const replacement=holdStorageTarget(target);
        try {expect(()=>assertExclusiveCreatedTarget(descriptor,replacement)).toThrow(/target_replaced/);} finally {replacement.close();}
        expect(readFileSync(target)).toEqual(Buffer.alloc(0));
      }
    } finally {closeSync(descriptor);}
  });
  it("copies an exact admitted WAL snapshot to exclusive output without signing resume authority", async () => {
    const {target,identity,db}=await fixture("testnet-real");
    await db.upsertSessionGrant({sessionId:'owner',sessAddr:`0x${'1'.repeat(40)}`,ownerAddr:'owner',cap:1,expiry:Date.now()+60000,txHash:'synthetic',grantEpoch:'retained'});
    const original=await db.getSessionGrant('owner');
    const output=file();
    const receipt=await backupVerifiedSqliteStorage(target,identity,output);
    expect(receipt.signingResumeAuthorized).toBe(false);
    const copy=new SqliteAdapter(output,{expectedIdentity:identity,readOnly:true}); adapters.push(copy);
    expect(await copy.getSessionGrant('owner')).toEqual(original);
    expect(await db.getSessionGrant('owner')).toEqual(original);
    await expect(backupVerifiedSqliteStorage(target,identity,output)).rejects.toThrow();
    await expect(backupVerifiedSqliteStorage(target,{...identity,authorityMode:'testnet-offline'},file())).rejects.toThrow(/identity_mismatch/);
  });
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
  it("rolls back an enrollment transaction when its actual SQLite writer process crashes", async () => {
    const target = file(), raw = new DatabaseSync(target);
    raw.exec("CREATE TABLE source_meta(id INTEGER PRIMARY KEY,payload TEXT); INSERT INTO source_meta VALUES(1,'retained');"); raw.close();
    const identity = syntheticStorageIdentity("testnet-real");
    const moduleUrl = pathToFileURL(join(process.cwd(), "lib/db/storage-identity-sqlite.ts")).href;
    const script = `import {DatabaseSync} from 'node:sqlite'; import {insertStorageIdentity,installStorageFences} from ${JSON.stringify(moduleUrl)};
      const db=new DatabaseSync(${JSON.stringify(target)}); db.exec('BEGIN IMMEDIATE');
      insertStorageIdentity(db,${JSON.stringify(identity)}); installStorageFences(db,${JSON.stringify(identity)});
      process.stdout.write('uncommitted'); setInterval(()=>{},1000);`;
    const require = createRequire(import.meta.url);
    const child = spawn(process.execPath, ["--import", pathToFileURL(require.resolve("tsx")).href, "--input-type=module", "-e", script], { windowsHide:true, stdio:["ignore","pipe","ignore"] });
    await new Promise<void>((resolve,reject) => {
      const timeout=setTimeout(()=>{child.kill("SIGKILL");reject(new Error("synthetic crash writer did not reach transaction"));},5000);
      child.once("error",()=>{clearTimeout(timeout);reject(new Error("synthetic writer unavailable"));});
      child.stdout.once("data",()=>{clearTimeout(timeout); child.kill("SIGKILL");});
      child.once("close",()=>{clearTimeout(timeout);resolve();});
    });
    const reopened=new DatabaseSync(target); rawConnections.push(reopened);
    expect(reopened.prepare("SELECT payload FROM source_meta").get()?.payload).toBe("retained");
    expect(reopened.prepare("SELECT name FROM sqlite_schema WHERE name=?").get(STORAGE_IDENTITY_TABLE)).toBeUndefined();
    expect(reopened.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type='trigger'").get()?.n).toBe(0);
  });
  it("serializes competing exact enrollment and refuses stale full-store evidence without relabeling", async () => {
    const target=file(), raw=new DatabaseSync(target);
    raw.exec("CREATE TABLE source_meta(id INTEGER PRIMARY KEY,payload TEXT); INSERT INTO source_meta VALUES(1,'before');"); raw.close();
    const identity=syntheticStorageIdentity("testnet-real");
    const inspection=await inspectSqliteEnrollment(target,identity);
    const proof: ReviewedStorageEnrollment={format:"keryx-reviewed-storage-enrollment-v1",inspection,provenanceDocumentDigest:identity.provenanceDigest,unknownClassAttestation:inspection.unknownClasses};
    const changed=new DatabaseSync(target); changed.exec("UPDATE source_meta SET payload='after'"); changed.close();
    await expect(enrollSqliteStorage(target,identity,proof)).rejects.toThrow();
    const current=await inspectSqliteEnrollment(target,identity);
    const reordered=Object.fromEntries(Object.entries(current).reverse()) as unknown as typeof current;
    const fresh={...proof,inspection:reordered,unknownClassAttestation:current.unknownClasses};
    const results=await Promise.all([enrollSqliteStorage(target,identity,fresh),enrollSqliteStorage(target,identity,fresh)]);
    expect(results.map(result=>result.status).sort()).toEqual(["already_enrolled","enrolled"]);
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
  it("admits readonly reports without init and refuses damaged marker guards without repair", async () => {
    const {target,identity,db}=await fixture("testnet-offline");
    const readonly=new SqliteAdapter(target,{expectedIdentity:identity,readOnly:true}); adapters.push(readonly);
    expect(readonly.getStorageIdentity()).toEqual(identity);
    expect(await readonly.getSource("absent")).toBeNull();
    readonly.close(); db.close();
    const raw=new DatabaseSync(target);
    raw.exec("DROP TRIGGER storage_identity_no_update; CREATE TRIGGER storage_identity_no_update BEFORE UPDATE ON keryx_storage_identity BEGIN SELECT 1; END"); raw.close();
    const bytes=readFileSync(target);
    expect(()=>new SqliteAdapter(target,{expectedIdentity:identity})).toThrow();
    await expect(enrollSqliteStorage(target,identity,{} as ReviewedStorageEnrollment)).rejects.toThrow();
    expect(readFileSync(target)).toEqual(bytes);
  });
  it("releases native iteration on early break and consumer throw before mutation and close", async () => {
    const {target,identity}=await fixture("testnet-offline");
    const checked=openVerifiedSqliteStorage(target,identity);
    try {
      checked.db.exec("INSERT INTO source_meta(id) VALUES('first'),('second')");
      const statement=checked.db.prepare("SELECT * FROM source_meta");
      for (const row of statement.iterate()) { expect(row.id).toBeTruthy(); break; }
      checked.db.exec("UPDATE source_meta SET rss_url='after-break'");
      expect(()=>{for (const row of statement.iterate()) { if(row.id) throw new Error('consumer'); }}).toThrow('consumer');
      checked.db.exec("UPDATE source_meta SET rss_url='after-throw'");
      expect(checked.db.prepare("SELECT count(*) AS n FROM source_meta WHERE rss_url='after-throw'").get()?.n).toBe(2);
    } finally { checked.close(); }
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
      expect(() => checked.db.exec("INSERT INTO private_treasury_pools(signer,capacity_micros) VALUES('0x1111111111111111111111111111111111111111',100)")).toThrow(/offline storage/);
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
      const data=JSON.stringify({requirement:{network:'eip155:5042',asset:'0x3600000000000000000000000000000000000000'}});
      expect(()=>checked.db.prepare("INSERT INTO private_research_intents(id,payer,data) VALUES(?,?,?)").run(`prv_${'a'.repeat(64)}`,`0x${'1'.repeat(40)}`,data)).toThrow(/serialized authority profile/);
    } finally { checked.close(); }
  });
});
