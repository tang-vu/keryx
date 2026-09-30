import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { inspectStorageProvenance, STORAGE_PROVENANCE_LIMITS } from "./storage-provenance";
import { scanStorageProvenance } from "./storage-provenance-scan";
import { provisionSyntheticStorage } from "./storage-identity-fixture";

const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture(sql = "") {
  const directory = mkdtempSync(join(tmpdir(), "keryx-provenance-")); directories.push(directory);
  const file = join(directory, "synthetic.sqlite");
  const db = new DatabaseSync(file); db.exec(sql || "CREATE TABLE payment_events(network TEXT,settlement_status TEXT,amount_usdc REAL);"); db.close();
  return { directory, file };
}
const requirements = { network: "eip155:5042002", scheme: "exact", amount: "2000", asset: "0x3600000000000000000000000000000000000000",
  payTo: `0x${"12".repeat(20)}`, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" } } as const;
function insertJson(file: string, table: string, column: string, value: unknown) {
  const db = new DatabaseSync(file); db.prepare(`INSERT INTO ${table}(${column}) VALUES(?)`).run(JSON.stringify(value)); db.close();
}
describe("keyless SQLite provenance intake", () => {
  it("inspects the actual adapter-created schema with retained journal and persisted private/withdrawal shapes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "keryx-provenance-actual-")); directories.push(directory);
    const f = { directory, file: join(directory, "synthetic.sqlite") };
    const identity = await provisionSyntheticStorage(f.file, "testnet-real");
    vi.stubEnv("CONTENT_MASTER_KEY", "67".repeat(32));
    const { SqliteAdapter } = await import("./sqlite-adapter");
    const adapter = new SqliteAdapter(f.file, { expectedIdentity: identity }); await adapter.init();
    const signer = `0x${"22".repeat(20)}`;
    await adapter.upsertSessionGrant({ sessionId: "synthetic-owner", ownerAddr: signer, sessAddr: signer,
      cap: 0.05, expiry: Date.now() + 60000, txHash: "synthetic", grantEpoch: "retained-epoch" });
    await adapter.activateBrowserJournal();
    await adapter.admitBrowserJournal({ sessionId: "synthetic-owner", requestId: "synthetic-request", queryId: "query",
      grantEpoch: "retained-epoch", signer, network: requirements.network, token: requirements.asset,
      gatewayContract: requirements.extra.verifyingContract, sourceId: "source", offerId: null, kind: "fetch", payee: requirements.payTo,
      amountMicroUsdc: 2000, requirements: { ...requirements, maxTimeoutSeconds: 691200 },
      payment: { kind: "fetch", queryId: "query", sourceId: "source", sourceName: "Synthetic", payer: signer,
        payee: requirements.payTo, amountUsdc: 0.002, network: requirements.network, grantEpoch: "retained-epoch" } });
    adapter.close();
    const raw = new DatabaseSync(f.file);
    // Manufacture a legacy fixture from the actual adapter's application schema
    // and journal data. Only this fresh synthetic file is stripped of identity
    // infrastructure, so malformed historical envelopes can be inspected.
    for (const row of raw.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND name LIKE 'storage_%'").all()) {
      const name = String(row.name); if (!/^storage_[a-z0-9_]+$/.test(name)) throw new Error("Unexpected synthetic trigger");
      raw.exec(`DROP TRIGGER "${name}"`);
    }
    raw.exec("DROP TABLE keryx_storage_identity");
    const privateIntent = { id: `prv_${"ab".repeat(32)}`, requirement: requirements,
      submission: { request: { question: "private synthetic prompt" }, salt: "private-salt", payment: {
        authorization: { from: signer, to: requirements.payTo, value: "2000", nonce: `0x${"ab".repeat(32)}` }, signature: "secret-signature" } } };
    raw.prepare("INSERT INTO private_research_intents(id,payer,data) VALUES(?,?,?)")
      .run(privateIntent.id, signer, JSON.stringify(privateIntent));
    const pad = (address: string) => `0x${"0".repeat(24)}${address.slice(2)}`;
    const withdrawal = { format: "creator-withdrawal-request-v1", network: requirements.network, owner: signer,
      policy: { domain: 26, gatewayWallet: requirements.extra.verifyingContract,
        gatewayMinter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B", asset: requirements.asset },
      request: { burnIntent: { spec: { version: 1, sourceDomain: 26, destinationDomain: 26,
        sourceContract: pad(requirements.extra.verifyingContract), destinationContract: pad("0x0022222ABE238Cc2C7Bb1f21003F0a260052475B"),
        sourceToken: pad(requirements.asset), destinationToken: pad(requirements.asset), value: "2000" } }, signature: "secret-signature" } };
    raw.prepare("INSERT INTO creator_withdrawal_requests(id,owner,data) VALUES(?,?,?)")
      .run(`0x${"cd".repeat(32)}`, signer, JSON.stringify(withdrawal));
    const snapshots = () => ["payment_events", "browser_authorization_intents", "session_grants", "browser_signer_capacity",
      "browser_retained_grants", "browser_journal_bindings", "browser_journal_control", "private_research_intents", "creator_withdrawal_requests"]
      .map(table => raw.prepare(`SELECT * FROM ${table}`).all());
    const before = snapshots();
    try {
      const report = await inspectStorageProvenance(f.file);
      expect(report.status).toBe("intake_only"); expect(report.evidence?.journalActivation).toBe("active");
      expect(JSON.stringify(report)).not.toMatch(/private synthetic prompt|secret-signature|private-salt|retained-epoch/);
      expect(snapshots()).toEqual(before);
      raw.prepare("INSERT INTO private_research_intents(id,payer,data) VALUES(?,?,?)").run(`prv_${"ef".repeat(32)}`, signer,
        JSON.stringify({ ...privateIntent, submission: { ...privateIntent.submission, payment: {
          ...privateIntent.submission.payment, authorization: { ...privateIntent.submission.payment.authorization, value: "malformed" } } } }));
      expect(await inspectStorageProvenance(f.file)).toMatchObject({ status: "refused", reason: "malformed_authority" });
    } finally { raw.close(); }
  });
  it("uses actual read-only SQLite and preserves main-file bytes/schema/logical authority", async () => {
    const f = fixture(`CREATE TABLE payment_events(network TEXT,settlement_status TEXT,amount_usdc REAL,authorization_id TEXT,grant_epoch TEXT);
      INSERT INTO payment_events VALUES('eip155:5042002','pending',0.002,'0x${"11".repeat(32)}','original-epoch');
      CREATE TABLE session_grants(sess_addr TEXT,grant_epoch TEXT,cap REAL,spent REAL);
      INSERT INTO session_grants VALUES('0x${"22".repeat(20)}','original-epoch',0.05,0.002);
      CREATE TABLE browser_journal_control(id INTEGER,active INTEGER); INSERT INTO browser_journal_control VALUES(1,1);
      CREATE TABLE paid_content(text TEXT); INSERT INTO paid_content VALUES('paid plaintext SECRET');`);
    const bytes = readFileSync(f.file);
    const before = new DatabaseSync(f.file, { readOnly: true });
    const contents = before.prepare("SELECT * FROM payment_events").all(), schema = before.prepare("SELECT * FROM sqlite_schema").all(); before.close();
    const report = await inspectStorageProvenance(f.file);
    expect(report).toMatchObject({ status: "intake_only", origin: "unknown_legacy", enrollmentAuthorized: false, modeIdentityAccepted: false, snapshotComplete: true });
    expect(report.evidence).toMatchObject({ scannedRows: 3, uninspectedTables: 1, journalActivation: "active", classifications: { pending_retained: 1 } });
    expect(readFileSync(f.file)).toEqual(bytes);
    const after = new DatabaseSync(f.file, { readOnly: true });
    expect(after.prepare("SELECT * FROM payment_events").all()).toEqual(contents);
    expect(after.prepare("SELECT * FROM sqlite_schema").all()).toEqual(schema); after.close();
    expect(readdirSync(f.directory)).toEqual(["synthetic.sqlite"]);
    expect(JSON.stringify(report)).not.toMatch(/original-epoch|paid plaintext|SECRET|22222222|11111111/);
  });
  it("refuses relative/missing/nonregular targets without creating a store", async () => {
    const f = fixture();
    expect(await inspectStorageProvenance("relative.sqlite")).toMatchObject({ status: "refused", reason: "absolute_target_required" });
    const missing = join(f.directory, "missing.sqlite");
    expect(await inspectStorageProvenance(missing)).toMatchObject({ status: "refused" });
    expect(await inspectStorageProvenance(f.directory)).toMatchObject({ status: "refused" });
    expect(readdirSync(f.directory)).toEqual(["synthetic.sqlite"]);
  });
  it("refuses a symlink ancestor", async () => {
    const f = fixture();
    const { symlinkSync } = await import("node:fs");
    const alias = join(f.directory, "linked"); symlinkSync(f.directory, alias, process.platform === "win32" ? "junction" : "dir");
    expect(await inspectStorageProvenance(join(alias, "synthetic.sqlite"))).toMatchObject({ status: "refused", reason: "unsafe_target" });
  });
  it.each(["eip155:5042", "eip155:1"])("refuses a known foreign network %s", async network => {
    const f = fixture(); const db = new DatabaseSync(f.file); db.prepare("INSERT INTO payment_events VALUES(?,'pending',0.002)").run(network); db.close();
    expect(await inspectStorageProvenance(f.file)).toMatchObject({ status: "refused", reason: "foreign_authority", snapshotComplete: false });
  });
  it("inspects serialized requirements without disclosing bearer/private payloads", async () => {
    const f = fixture("CREATE TABLE browser_journal_bindings(requirements TEXT);");
    insertJson(f.file, "browser_journal_bindings", "requirements", { ...requirements, bearerHeader: "secret-payment-header", question: "private prompt" });
    const report = await inspectStorageProvenance(f.file);
    expect(report.status).toBe("intake_only"); expect(JSON.stringify(report)).not.toMatch(/secret-payment-header|private prompt|payTo|verifyingContract/);
    const db = new DatabaseSync(f.file); db.exec("DELETE FROM browser_journal_bindings"); db.close();
    insertJson(f.file, "browser_journal_bindings", "requirements", { ...requirements, extra: { ...requirements.extra, verifyingContract: `0x${"77".repeat(20)}` } });
    expect(await inspectStorageProvenance(f.file)).toMatchObject({ status: "refused", reason: "foreign_authority" });
  });
  it.each([{ ...requirements, asset: `0x${"33".repeat(20)}` }, {}, { ...requirements, amount: "bad" }])("refuses malformed/foreign serialized authority", async value => {
    const f = fixture("CREATE TABLE browser_journal_bindings(requirements TEXT);"); insertJson(f.file, "browser_journal_bindings", "requirements", value);
    expect((await inspectStorageProvenance(f.file)).status).toBe("refused");
  });
  it("finds foreign domains/contracts inside serialized withdrawal and private envelopes", async () => {
    for (const value of [{ request: { burnIntent: { spec: { sourceDomain: 27 } } } },
      { requirement: { network: "eip155:5042" } }, { submission: { asset: `0x${"44".repeat(20)}` } }]) {
      const f = fixture("CREATE TABLE private_research_intents(data TEXT);"); insertJson(f.file, "private_research_intents", "data", value);
      expect(await inspectStorageProvenance(f.file)).toMatchObject({ status: "refused", reason: "foreign_authority" });
    }
  });
  it("refuses malformed JSON, numeric authority and journal state", async () => {
    for (const sql of ["CREATE TABLE private_research_intents(data TEXT); INSERT INTO private_research_intents VALUES('{bad');",
      "CREATE TABLE session_grants(cap REAL,spent REAL); INSERT INTO session_grants VALUES(0.001,0.002);",
      "CREATE TABLE browser_journal_control(id INTEGER,active INTEGER); INSERT INTO browser_journal_control VALUES(2,1);"]) {
      const f = fixture(sql); expect(await inspectStorageProvenance(f.file)).toMatchObject({ status: "refused", reason: "malformed_authority" });
    }
  });
  it("refuses views masquerading as authority tables without executing them", async () => {
    const f = fixture("CREATE VIEW payment_events AS SELECT 'eip155:5042002' network;");
    expect(await inspectStorageProvenance(f.file)).toMatchObject({ status: "refused", reason: "schema_refused" });
  });
  it("refuses virtual authority tables and excessive column metadata", async () => {
    const f = fixture("CREATE VIRTUAL TABLE payment_events USING fts5(network);");
    expect(await inspectStorageProvenance(f.file)).toMatchObject({ reason: "schema_refused" });
    const g = fixture("CREATE TABLE payment_events(network TEXT, additional TEXT);");
    expect(await inspectStorageProvenance(g.file, { columns: 1 })).toMatchObject({ reason: "schema_limit" });
  });
  it("rejects oversized selected blobs before returning their bytes", async () => {
    const f = fixture("CREATE TABLE payment_events(network BLOB); INSERT INTO payment_events VALUES(zeroblob(1048576));");
    expect(await inspectStorageProvenance(f.file)).toMatchObject({ status: "refused", reason: "field_limit" });
  });
  it("bounds rows, field bytes, selected bytes, schema and file size", async () => {
    const f = fixture("CREATE TABLE payment_events(network TEXT); INSERT INTO payment_events VALUES('eip155:5042002'),('eip155:5042002');");
    for (const [limits, reason] of [[{ rows: 1 }, "row_limit"], [{ fieldBytes: 4 }, "field_limit"], [{ selectedBytes: 4 }, "byte_limit"],
      [{ fileBytes: 1 }, "file_limit"]] as const) expect(await inspectStorageProvenance(f.file, limits)).toMatchObject({ status: "refused", reason });
    const g = fixture("CREATE TABLE payment_events(network TEXT); CREATE TABLE unrelated(value TEXT);");
    expect(await inspectStorageProvenance(g.file, { schemaObjects: 1 })).toMatchObject({ reason: "schema_limit" });
    expect(await inspectStorageProvenance(g.file, { rows: STORAGE_PROVENANCE_LIMITS.rows + 1 })).toMatchObject({ reason: "invalid_limits" });
    expect(await inspectStorageProvenance(g.file, JSON.parse('{"toString":1}'))).toMatchObject({ reason: "invalid_limits" });
  });
  it("reports an independent child deadline rather than completed evidence", async () => {
    const f = fixture(); expect(await inspectStorageProvenance(f.file, { deadlineMs: 1 })).toMatchObject({ status: "refused", reason: "deadline_exceeded", snapshotComplete: false });
  });
  it("detects target replacement or verifies the platform blocks replacement during the read snapshot", () => {
    const f = fixture(); const replacement = fixture();
    let calls = 0, blocked = false; const realNow = Date.now;
    vi.spyOn(Date, "now").mockImplementation(() => {
      if (++calls === 3) { try { renameSync(f.file, join(f.directory, "original.sqlite")); renameSync(replacement.file, f.file); } catch { blocked = true; } }
      return realNow();
    });
    const report = scanStorageProvenance(f.file, STORAGE_PROVENANCE_LIMITS);
    if (process.platform === "win32" && blocked) expect(report.status).toBe("intake_only");
    else expect(report).toMatchObject({ status: "refused", reason: "target_replaced" });
  });
  it("reads a committed WAL snapshot and reports coordination sidecar presence honestly", async () => {
    const f = fixture(); const writer = new DatabaseSync(f.file); writer.exec("PRAGMA journal_mode=WAL; INSERT INTO payment_events VALUES('eip155:5042002','pending',0.002);");
    const before = writer.prepare("SELECT * FROM payment_events").all();
    try {
      const report = await inspectStorageProvenance(f.file);
      expect(report.status).toBe("intake_only"); expect(report.evidence?.tables.payment_events.rows).toBe(1);
      expect(report.evidence?.sidecars.walBefore).toBe(true);
      expect(writer.prepare("SELECT * FROM payment_events").all()).toEqual(before);
    } finally { writer.close(); }
  });
  it("keeps CLI error output secret-free and does not echo arbitrary target paths", () => {
    const f = fixture(); const secret = join(f.directory, "credential-secret.sqlite"); writeFileSync(secret, "not sqlite");
    try { execFileSync(process.execPath, ["--import", "tsx", "scripts/inspect-storage-provenance.mts", secret], { encoding: "utf8" }); expect.fail("CLI accepted a non-SQLite file"); }
    catch (error) { const result = error as { stdout: string; stderr: string }; expect(result.stdout).toContain('"status": "refused"'); expect(result.stdout + result.stderr).not.toContain("credential-secret"); }
  });
});
