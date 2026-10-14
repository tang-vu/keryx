/** Disposable synthetic mainnet-shaped originals only. No signing, funding or provider calls. */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "../canonical-json";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { syntheticA2aOriginal } from "./a2a-original-fixture";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { insertStorageIdentity, installStorageFences, registerStorageCapability, storageFenceStatements } from "./storage-identity-sqlite";
import { assertVerifiedSqliteConnection, assertVerifiedSqliteNativeUserDomainPolicy, openVerifiedSqliteStorage } from "./storage-identity-connection";
import { inspectStorageDeploymentManifest } from "./runtime-storage-config";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { installPublicReferenceArchive } from "./public-reference-archive";
import { createEnrolledSqliteDecisionReviews, createSqliteDecisionReviews } from "./decision-reviews-sqlite";
import { createEnrolledSqlitePersonalHistory } from "./personal-history-sqlite";
import { createDecisionReviewRoutes } from "../research/decision-review-routes";
import { DecisionReviewError, REVIEW_WAIT_MS, decisionReviewMetricsSchema, type CaptureDecision, type DecisionReviewsStore } from "../research/decision-review-types";
import type { KeryxDB } from "./keryx-db";
import type { QueryRun } from "../types";

const owner = `0x${"1".repeat(40)}`, other = `0x${"2".repeat(40)}`;
const network = "eip155:5042", at = Date.parse("2026-10-09T10:00:00.000Z");
const synthetic = syntheticA2aOriginal(1, ARC_MAINNET_PROFILE);
const financialTables = ["a2a_orders", "payment_events", "research_purchase_authorizations", "research_monthly", "research_monthly_redemptions",
  "browser_authorization_intents", "browser_retained_grants", "browser_signer_capacity", "session_grants", "withdrawals",
  "creator_withdrawal_requests", "private_treasury_pools", "private_treasury_reservations"];
let folder: string, identity: StorageIdentity, index = 0;
const opened: Array<{ close(): void }> = [], retained: Array<{ file: string; originals: string }> = [];

function originals(file: string) {
  const raw = new DatabaseSync(file, { readOnly: true });
  try { return canonicalJson(financialTables.map(table => ({ table, rows: raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() }))); }
  finally { raw.close(); }
}
function schemaRows(file: string) {
  const raw = new DatabaseSync(file, { readOnly: true });
  try { return canonicalJson(raw.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all()); }
  finally { raw.close(); }
}
function journalCount(file: string, table = "decision_review_records") {
  const raw = new DatabaseSync(file, { readOnly: true });
  try { return Number(raw.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n); }
  finally { raw.close(); }
}
function ownerRunRows(file: string) {
  const raw = new DatabaseSync(file, { readOnly: true });
  try { return canonicalJson(["users", "query_runs"].map(table => ({ table, rows: raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() }))); }
  finally { raw.close(); }
}
function edit(file: string, action: (raw: DatabaseSync) => void) {
  const raw = new DatabaseSync(file);
  // Explicit synthetic setup actor, never accepted as the application port.
  try { registerStorageCapability(raw, identity, () => true); action(raw); }
  finally { raw.close(); }
}
function fixture(bundle = true, archive = false) {
  const file = join(folder, `case-${++index}.sqlite`), manifest = `${file}.json`;
  copyFileSync(join(folder, `template-${bundle}-${archive}.sqlite`), file);
  writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } }));
  const pinned = canonicalJson(inspectStorageDeploymentManifest({ KERYX_STORAGE_MANIFEST: manifest }));
  retained.push({ file, originals: originals(file) });
  const open = (readOnly = false, withProfiles = true) => {
    const connection = openVerifiedSqliteStorage(file, identity, { readOnly,
      ...(withProfiles ? { applicationProfiles: supportedSqliteApplicationProfiles(true) } : {}),
      runtimeGuard() {
        if (canonicalJson(inspectStorageDeploymentManifest({ KERYX_STORAGE_MANIFEST: manifest })) !== pinned) throw new Error("Manifest drift");
      } });
    opened.push(connection); return connection;
  };
  return { file, manifest, open };
}
async function facadeFixture(bundle = true, archive = false) {
  const f = fixture(bundle, archive);
  // Each disposable selected deployment gets its own module-lifetime manifest pin.
  vi.resetModules();
  vi.stubEnv("KERYX_NETWORK", "arc"); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arc");
  // Matched synthetic import metadata only; no registry/provider calls or payout authority.
  const registry = `0x${"3".repeat(40)}`;
  vi.stubEnv("KERYX_REGISTRY_ADDRESS", registry); vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS", registry);
  vi.stubEnv("KERYX_REGISTRY_READ_ADDRESS", registry); vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS", registry);
  vi.stubEnv("KERYX_STORAGE_MANIFEST", f.manifest);
  vi.stubEnv("KERYX_SQLITE_PATH", f.file);
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0");
  vi.stubEnv("CONTENT_MASTER_KEY", randomBytes(32).toString("hex"));
  const api = await import("./enrolled-sqlite-adapter");
  const facade = async (readOnly = false) => {
    const adapter = await (readOnly ? api.createReadonlyEnrolledSqliteAdapter() : api.createEnrolledSqliteAdapter());
    opened.push(adapter); return adapter;
  };
  return { ...f, api, facade };
}
function decision(patch: Partial<CaptureDecision> = {}): CaptureDecision {
  return { policyVersion: "captured-owner-decisions-v1", engine: "synthetic", requestedModel: null,
    runId: randomUUID(), round: 0, ordinal: 0, sourceName: "Synthetic source", modelAction: "BUY", codeAction: "BUY", codeRule: "selected",
    reviewFirst: true, cohort: "unknown", cohortEvidence: null,
    terms: { assetId: "item:one", sourceId: "source-one", owned: true, itemId: "one", contentVersion: "exact-version-one",
      network, payTo: other, priceMicroUsdc: "5000", listPriceMicroUsdc: "5000", citationBudgetMicroUsdc: "10000" }, ...patch };
}
async function held(port: DecisionReviewsStore, input = decision(), now = at) {
  const record = await port.capture(owner, input, now); return port.begin(owner, record.id, now);
}
beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), "keryx-synthetic-native-decision-reviews-"));
  identity = { ...syntheticStorageIdentity("mainnet-real"), format: "keryx-mainnet-storage-identity-v1", network,
    profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  for (const bundle of [false, true]) for (const archive of [false, true]) {
    const raw = new DatabaseSync(join(folder, `template-${bundle}-${archive}.sqlite`));
    try {
      raw.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(raw, { publicReferenceArchive: archive });
      if (bundle) installNativeUserDomainSchema(raw);
      const { order, binding } = synthetic;
      raw.prepare(`INSERT INTO a2a_orders(id,query_id,authorization_id,request_hash,payer,payee,
        amount_usdc,creator_budget_usdc,service_fee_usdc,research_mode,package_data,status,transaction_id,
        request_data,response_data,execution_journal_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(order.id, order.id, order.authorizationId, order.requestHash, order.payer, order.payee,
          order.amountUsdc, order.creatorBudgetUsdc, order.serviceFeeUsdc, order.researchMode, JSON.stringify(order.researchPackage),
          "completed", order.transaction, JSON.stringify(order.request), JSON.stringify({ status: "completed", answer: "Synthetic original" }),
          1, order.createdAt, order.updatedAt);
      raw.prepare(`INSERT INTO payment_events(id,query_id,kind,source_id,source_name,payer,payee,amount_usdc,
        network,tx_hash,settled,settlement_status,authorization_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(`inbound_${order.id}`, order.id, "inbound", "a2a", "Synthetic only", order.payer, order.payee,
          order.amountUsdc, binding.network, order.transaction, 1, "settled", order.authorizationId, order.createdAt);
      insertStorageIdentity(raw, identity); installStorageFences(raw, identity); raw.exec("COMMIT");
    } finally { raw.close(); }
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const connection of opened.splice(0)) connection.close();
  for (const snapshot of retained.splice(0)) expect(originals(snapshot.file)).toBe(snapshot.originals);
  vi.unstubAllEnvs();
});
afterAll(() => { if (folder) rmSync(folder, { recursive: true, force: true }); });

describe("genuine selected-native decision reviews", () => {
  it.each([false, true])("both actual BEFORE facades keep decision reviews absent without DDL (archive=%s)", async archive => {
    const f = await facadeFixture(false, archive), before = readFileSync(f.file), schema = schemaRows(f.file);
    for (const readOnly of [false, true]) {
      const adapter = await f.facade(readOnly);
      expect(Object.isFrozen(adapter)).toBe(true);
      expect(Object.hasOwn(adapter, "decisionReviews")).toBe(false);
      expect(adapter.decisionReviews).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(adapter, "decisionReviews")).toBeUndefined();
      expect(f.api.assertEnrolledSqliteAdapter(adapter)).toEqual(identity);
      expect(typeof adapter.personalHistory!.receipts).toBe("function");
      expect(await adapter.personalHistory!.receipts!(synthetic.order.id, 10)).toHaveLength(1);
      await adapter.init();
    }
    expect(readFileSync(f.file)).toEqual(before); expect(schemaRows(f.file)).toBe(schema);
  });

  it.each([false, true])("actual full19 facades share selected metadata, retain originals and keep readonly healthy (archive=%s)", async archive => {
    const f = await facadeFixture(true, archive), schema = schemaRows(f.file), adapter = await f.facade();
    const run: QueryRun = { id: randomUUID(), asker: owner, question: "Synthetic retained owner question", budget: 0.02,
      engine: "synthetic", subClaims: [], decisions: [], citations: [], answer: "Synthetic retained private answer body",
      totalSpent: 0, totalToCreators: 0, trace: [], createdAt: new Date(at).toISOString() };
    const user = (await adapter.upsertUser(owner, "reader")).user;
    await adapter.saveQueryRun(run);
    const rows = ownerRunRows(f.file), port = adapter.decisionReviews!;
    const readonly = await f.facade(true), reader = readonly.decisionReviews!;
    for (const facade of [adapter, readonly]) {
      expect(Object.isFrozen(facade)).toBe(true); expect(Object.isFrozen(facade.decisionReviews)).toBe(true);
      expect(Object.getOwnPropertyDescriptor(facade, "decisionReviews")).toEqual({ value: facade.decisionReviews,
        enumerable: false, writable: false, configurable: false });
      expect(Object.keys(facade).sort()).toEqual(Object.keys(f.api.ENROLLED_SQLITE_METHOD_ACCESS).sort());
      expect(Reflect.get(facade, "db")).toBeUndefined();
      expect(f.api.assertEnrolledSqliteAdapter(facade)).toEqual(identity);
    }
    expect(() => f.api.assertEnrolledSqliteAdapter({ ...adapter })).toThrow();
    expect(() => f.api.assertEnrolledSqliteAdapter(readonly, "write")).toThrow();
    await port.ready();
    const record = await port.capture(owner.toUpperCase(), decision({ runId: run.id, reviewFirst: false }), at);
    expect(record).toMatchObject({ runId: run.id, reviewFirst: false, state: "observed", expiresAt: null, verdict: null });
    // Optional availability is observational; this record cannot begin a human gate.
    await expect(port.begin(owner, record.id, at + 1)).rejects.toThrow("review_conflict");
    await port.observe(owner, record.id, "SKIP", "budget"); await port.cancel(owner, run.id);
    const observed = await reader.read(owner, record.id);
    expect(observed).toMatchObject({ state: "observed", expiresAt: null, verdict: null,
      initialCodeAction: "BUY", initialCodeRule: "selected", codeAction: "SKIP", codeRule: "budget", terms: record.terms });
    expect(await reader.list(owner, run.id)).toEqual([observed]);
    expect(await reader.read(other, record.id)).toBeNull(); expect(await reader.list(other, run.id)).toEqual([]);
    expect(journalCount(f.file)).toBe(1); expect(journalCount(f.file, "decision_review_verdicts")).toBe(0);
    const before = readFileSync(f.file), prepare = vi.spyOn(DatabaseSync.prototype, "prepare"), exec = vi.spyOn(DatabaseSync.prototype, "exec");
    try {
      for (const operation of [() => reader.capture(owner, decision(), at), () => reader.begin(owner, record.id, at),
        () => reader.verdict(owner, { id: record.id, key: randomUUID(), context: "gate", value: "agree" }, at),
        () => reader.consume(owner, record.id, record.terms, at), () => reader.cancel(owner, run.id),
        () => reader.expire(owner, record.id, at), () => reader.observe(owner, record.id, "SKIP", "budget")])
        await expect(operation()).rejects.toThrow("review_unavailable");
      expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
    } finally { prepare.mockRestore(); exec.mockRestore(); }
    await reader.ready(); expect(await reader.read(owner, record.id)).toEqual(observed);
    expect(await reader.list(owner, run.id)).toEqual([observed]);
    const metrics = await reader.metrics(network, "2026-10-09T00:00:00.000Z", "2026-10-10T00:00:00.000Z");
    expect(metrics.cohorts.find(row => row.cohort === "unknown")).toMatchObject({ decisions: 1, agrees: 0, disagrees: 0,
      agreementRate: null, codeRefusals: 1, refusalReasons: { budget: 1 } });
    expect(await readonly.getUser(owner)).toEqual(user); expect(await readonly.getQueryRun(run.id)).toEqual(run);
    expect(typeof readonly.personalHistory!.receipts).toBe("function");
    expect(await readonly.personalHistory!.receipts!(synthetic.order.id, 10)).toHaveLength(1);
    expect(f.api.assertEnrolledSqliteAdapter(readonly)).toEqual(identity);
    expect(ownerRunRows(f.file)).toBe(rows); expect(readFileSync(f.file).equals(before)).toBe(true); expect(schemaRows(f.file)).toBe(schema);
  });

  it("actual facade refuses a partial full19 family without repairing or publishing it", async () => {
    const f = await facadeFixture(); edit(f.file, raw => raw.exec("DROP TABLE decision_review_verdicts"));
    const before = readFileSync(f.file), schema = schemaRows(f.file);
    await expect(f.facade()).rejects.toThrow(); await expect(f.facade(true)).rejects.toThrow();
    expect(readFileSync(f.file)).toEqual(before); expect(schemaRows(f.file)).toBe(schema);
  });

  it.each(["manifest", "provenance", "schema", "fence", "file"] as const)("actual facade %s drift prevents held-file replacement or permanently refuses both ports after restoration", async mode => {
    const f = await facadeFixture(), adapter = await f.facade(), readonly = await f.facade(true), port = adapter.decisionReviews!;
    const record = await port.capture(owner, decision({ reviewFirst: false }), at);
    const manifest = readFileSync(f.manifest), saved = `${f.file}.saved`;
    const fileSnapshot = mode === "file" ? { bytes: readFileSync(f.file), schema: schemaRows(f.file), financial: originals(f.file),
      stat: lstatSync(f.file, { bigint: true }) } : undefined;
    let fence: [string, string] | undefined, fileMoved = false;
    if (mode === "manifest") writeFileSync(f.manifest, "{}");
    if (mode === "provenance") writeFileSync(f.manifest, canonicalJson({ format: "keryx-storage-deployment-v1",
      identity: { ...identity, provenanceDigest: identity.provenanceDigest === "f".repeat(64) ? "e".repeat(64) : "f".repeat(64) },
      backend: { kind: "sqlite", databasePath: f.file } }));
    if (mode === "schema") edit(f.file, raw => raw.exec("CREATE INDEX foreign_review_index ON decision_review_records(wallet)"));
    if (mode === "fence") edit(f.file, raw => {
      fence = Object.entries(storageFenceStatements(raw, identity)).find(([, sql]) => sql.includes(' ON "decision_review_records"'));
      raw.exec(`DROP TRIGGER ${fence![0]}`);
    });
    try {
      if (mode === "file") {
        // One real attempt with both facades and their target descriptors still held.
        try { renameSync(f.file, saved); fileMoved = true; }
        catch (error) {
          expect(process.platform).toBe("win32"); expect(error).toMatchObject({ code: "EBUSY" });
          expect(existsSync(saved)).toBe(false);
          for (const facade of [adapter, readonly]) {
            expect(f.api.assertEnrolledSqliteAdapter(facade)).toEqual(identity);
            await facade.decisionReviews!.ready();
            expect(await facade.decisionReviews!.read(owner, record.id)).toEqual(record);
            expect(await facade.decisionReviews!.list(owner, record.runId)).toEqual([record]);
            expect(await facade.getUser(owner)).toBeNull();
            expect(typeof facade.personalHistory!.receipts).toBe("function");
            expect(await facade.personalHistory!.receipts!(synthetic.order.id, 10)).toHaveLength(1);
          }
          expect(() => f.api.assertEnrolledSqliteAdapter(readonly, "write")).toThrow();
          expect(lstatSync(f.file, { bigint: true })).toMatchObject({ dev: fileSnapshot!.stat.dev,
            ino: fileSnapshot!.stat.ino, birthtimeNs: fileSnapshot!.stat.birthtimeNs });
          expect(readFileSync(f.file).equals(fileSnapshot!.bytes)).toBe(true); expect(schemaRows(f.file)).toBe(fileSnapshot!.schema);
          expect(originals(f.file)).toBe(fileSnapshot!.financial);
          expect(journalCount(f.file)).toBe(1); expect(journalCount(f.file, "decision_review_verdicts")).toBe(0);
          return;
        }
        copyFileSync(saved, f.file);
      }
      await expect(port.read(owner, record.id)).rejects.toThrow("review_unavailable");
      await expect(readonly.decisionReviews!.read(owner, record.id)).rejects.toThrow("review_unavailable");
      if (fileMoved) for (const facade of [adapter, readonly]) {
        expect(() => f.api.assertEnrolledSqliteAdapter(facade)).toThrow();
        expect(() => facade.getUser(owner)).toThrow();
      }
    } finally {
      if (mode === "manifest" || mode === "provenance") writeFileSync(f.manifest, manifest);
      if (mode === "schema") edit(f.file, raw => raw.exec("DROP INDEX foreign_review_index"));
      if (mode === "fence") edit(f.file, raw => raw.exec(fence![1]));
      if (fileMoved) { rmSync(f.file, { force: true }); renameSync(saved, f.file); }
    }
    for (const facade of [adapter, readonly]) {
      await expect(facade.decisionReviews!.ready()).rejects.toThrow("review_unavailable");
      expect(() => f.api.assertEnrolledSqliteAdapter(facade)).toThrow();
      expect(() => facade.getUser(owner)).toThrow();
    }
    const fresh = await f.facade(true);
    expect((await fresh.decisionReviews!.read(owner, record.id))?.state).toBe("observed");
    expect(typeof fresh.personalHistory!.receipts).toBe("function");
    expect(await fresh.personalHistory!.receipts!(synthetic.order.id, 10)).toHaveLength(1);
    expect(journalCount(f.file)).toBe(1); expect(journalCount(f.file, "decision_review_verdicts")).toBe(0);
    if (fileSnapshot) {
      expect(lstatSync(f.file, { bigint: true })).toMatchObject({ dev: fileSnapshot.stat.dev,
        ino: fileSnapshot.stat.ino, birthtimeNs: fileSnapshot.stat.birthtimeNs });
      expect(readFileSync(f.file).equals(fileSnapshot.bytes)).toBe(true); expect(schemaRows(f.file)).toBe(fileSnapshot.schema);
      expect(originals(f.file)).toBe(fileSnapshot.financial);
    }
  });

  it.each([false, true])("exact BEFORE absence stays optional without DDL (archive=%s)", archive => {
    const f = fixture(false, archive), before = schemaRows(f.file), connection = f.open();
    expect(createEnrolledSqliteDecisionReviews(connection.db)).toBeUndefined();
    expect(schemaRows(f.file)).toBe(before); expect(() => assertVerifiedSqliteConnection(connection.db)).not.toThrow();
  });

  it("rejects raw authority, extra arguments and unprofiled complete handles; ordinary still rejects enrollment", () => {
    const f = fixture(), connection = f.open(), raw = new DatabaseSync(f.file); opened.push(raw);
    Object.assign(raw, { foreignKeys: true, busyTimeout: 5000, nativeUserDomainProfile: "invented" });
    expect(() => createEnrolledSqliteDecisionReviews(raw)).toThrow("review_unavailable");
    expect(() => Reflect.apply(createEnrolledSqliteDecisionReviews, undefined, [connection.db, true])).toThrow("review_unavailable");
    expect(() => createSqliteDecisionReviews(connection.db)).toThrow("enrolled storage");
    expect(() => createEnrolledSqliteDecisionReviews(f.open(false, false).db)).toThrow("review_unavailable");
    expect(journalCount(f.file)).toBe(0);
  });

  it.each(["partial", "unknown-index", "unknown-table", "missing-fence"] as const)("refuses %s without repairing it", mode => {
    const f = fixture();
    edit(f.file, raw => {
      if (mode === "partial") raw.exec("DROP TABLE decision_review_verdicts");
      if (mode === "unknown-index") raw.exec("CREATE INDEX foreign_review_index ON decision_review_records(wallet)");
      if (mode === "unknown-table") raw.exec("CREATE TABLE foreign_review_table(x)");
      if (mode === "missing-fence") {
        const fence = Object.entries(storageFenceStatements(raw, identity)).find(([, sql]) => sql.includes(' ON "decision_review_records"'))!;
        raw.exec(`DROP TRIGGER ${fence[0]}`);
      }
    });
    const before = schemaRows(f.file);
    expect(() => createEnrolledSqliteDecisionReviews(f.open(false, false).db)).toThrow();
    expect(schemaRows(f.file)).toBe(before);
  });

  it.each([false, true])("captures, activates, votes and single-consumes exact native terms (archive=%s)", async archive => {
    const f = fixture(true, archive), connection = f.open(), before = schemaRows(f.file), port = createEnrolledSqliteDecisionReviews(connection.db)!;
    expect(Object.isFrozen(port)).toBe(true); expect(() => assertVerifiedSqliteNativeUserDomainPolicy(connection.db)).not.toThrow();
    await port.ready(); const initial = await port.capture(owner.toUpperCase(), decision(), at);
    expect(initial).toMatchObject({ state: "observed", expiresAt: null, initialCodeAction: "BUY", initialCodeRule: "selected" });
    const active = await port.begin(owner, initial.id, at + REVIEW_WAIT_MS * 2);
    expect(active.expiresAt).toBe(new Date(at + REVIEW_WAIT_MS * 3).toISOString());
    await expect(port.begin(owner, initial.id, at + REVIEW_WAIT_MS * 3)).rejects.toThrow("review_conflict");
    expect(await port.read(other, initial.id)).toBeNull(); expect(await port.list(other, initial.runId)).toEqual([]);
    for (const operation of [() => port.begin(other, initial.id, at), () => port.verdict(other, { id: initial.id, key: randomUUID(), context: "gate", value: "agree" }, at)])
      await expect(operation()).rejects.toThrow("review_not_found");
    const intent = { id: initial.id, key: randomUUID(), context: "gate" as const, value: "agree" as const, reason: "Private synthetic reason" };
    expect((await port.verdict(owner, intent, at + REVIEW_WAIT_MS * 2 + 1)).state).toBe("approved");
    await expect(port.consume(other, initial.id, active.terms, at + REVIEW_WAIT_MS * 2 + 2)).rejects.toThrow("review_not_found");
    await expect(port.consume(owner, initial.id, { ...active.terms, priceMicroUsdc: "5001" }, at + REVIEW_WAIT_MS * 2 + 2)).rejects.toThrow("review_conflict");
    expect((await port.consume(owner, initial.id, active.terms, at + REVIEW_WAIT_MS * 2 + 2)).state).toBe("consumed");
    expect((await port.verdict(owner, intent, at + REVIEW_WAIT_MS * 4)).state).toBe("consumed");
    await expect(port.verdict(owner, { ...intent, value: "disagree" }, at + REVIEW_WAIT_MS * 4)).rejects.toThrow("review_conflict");
    await expect(port.consume(owner, initial.id, active.terms, at + REVIEW_WAIT_MS * 2 + 3)).rejects.toThrow("review_conflict");
    expect(journalCount(f.file, "decision_review_verdicts")).toBe(1); expect(connection.db.isTransaction).toBe(false);
    expect(await port.list(owner, initial.runId)).toEqual([await port.read(owner, initial.id)]); expect(schemaRows(f.file)).toBe(before);
  });

  it("rechecks displayed opinion basis atomically while exact-key replay preserves its old basis", async () => {
    const f = fixture(), port = createEnrolledSqliteDecisionReviews(f.open().db)!;
    const record = await port.capture(owner, decision({ reviewFirst: false }), at);
    const intent = { id: record.id, key: randomUUID(), context: "opinion" as const, value: "agree" as const,
      expectedCode: { action: "BUY" as const, rule: "selected" as const } };
    await port.verdict(owner, intent, at + 1); await port.observe(owner, record.id, "SKIP", "budget");
    await expect(port.verdict(owner, { ...intent, key: randomUUID() }, at + 2)).rejects.toThrow("review_conflict");
    expect(await port.verdict(owner, intent, at + 3)).toMatchObject({ state: "observed", codeAction: "SKIP", codeRule: "budget",
      initialCodeAction: "BUY", verdict: { codeAction: "BUY", codeRule: "selected" } });
    await port.verdict(owner, { ...intent, key: randomUUID(), value: "disagree", expectedCode: { action: "SKIP", rule: "budget" } }, at + 4);
    expect(journalCount(f.file, "decision_review_verdicts")).toBe(2);
  });

  it("expiry, decline, cancellation and last-mile refusal never create consumed authority", async () => {
    const f = fixture(), port = createEnrolledSqliteDecisionReviews(f.open().db)!;
    const expired = await held(port);
    await expect(port.verdict(owner, { id: expired.id, key: randomUUID(), context: "gate", value: "agree" }, at + REVIEW_WAIT_MS)).rejects.toThrow("review_expired");
    await expect(port.expire(other, expired.id, at + REVIEW_WAIT_MS)).rejects.toThrow("review_not_found");
    await port.expire(owner, expired.id, at + REVIEW_WAIT_MS - 1); expect((await port.read(owner, expired.id))?.state).toBe("held");
    await port.expire(owner, expired.id, at + REVIEW_WAIT_MS); expect((await port.read(owner, expired.id))?.state).toBe("expired");
    const late = await held(port); await port.verdict(owner, { id: late.id, key: randomUUID(), context: "gate", value: "agree" }, at + 1);
    await expect(port.consume(owner, late.id, late.terms, at + REVIEW_WAIT_MS)).rejects.toThrow("review_expired");
    await port.expire(owner, late.id, at + REVIEW_WAIT_MS);
    const declined = await held(port); await port.verdict(owner, { id: declined.id, key: randomUUID(), context: "gate", value: "disagree" }, at + 1);
    await expect(port.consume(owner, declined.id, declined.terms, at + 2)).rejects.toThrow("review_conflict");
    const changed = await held(port); await port.verdict(owner, { id: changed.id, key: randomUUID(), context: "gate", value: "agree" }, at + 1);
    await port.observe(owner, changed.id, "SKIP", "terms-changed");
    expect(await port.read(owner, changed.id)).toMatchObject({ state: "cancelled", initialCodeAction: "BUY", codeRule: "terms-changed", verdict: { value: "agree" } });
    const queued = await port.capture(owner, decision(), at), unrelated = await port.capture(other, decision({ runId: queued.runId }), at);
    const informational = await port.capture(owner, decision({ runId: queued.runId, ordinal: 1, reviewFirst: false }), at);
    await port.cancel(other, changed.runId); await port.cancel(owner, queued.runId); await port.cancel(owner, queued.runId);
    expect((await port.read(owner, queued.id))?.state).toBe("cancelled");
    expect((await port.read(other, unrelated.id))?.state).toBe("observed"); expect((await port.read(owner, informational.id))?.state).toBe("observed");
    await expect(port.begin(owner, queued.id, at + 1)).rejects.toThrow("review_conflict"); await port.ready();
  });

  it("run cancellation closes held/approved owned gates and preserves consumed, unowned and skipped records", async () => {
    const f = fixture(), port = createEnrolledSqliteDecisionReviews(f.open().db)!, runId = randomUUID();
    const active = await held(port, decision({ runId })), approved = await held(port, decision({ runId, ordinal: 1 }));
    const consumed = await held(port, decision({ runId, ordinal: 2 }));
    await port.verdict(owner, { id: approved.id, key: randomUUID(), context: "gate", value: "agree" }, at + 1);
    await port.verdict(owner, { id: consumed.id, key: randomUUID(), context: "gate", value: "agree" }, at + 1);
    await port.consume(owner, consumed.id, consumed.terms, at + 2);
    const unowned = await port.capture(owner, decision({ runId, ordinal: 3, terms: { ...decision().terms, owned: false } }), at);
    const skipped = await port.capture(owner, decision({ runId, ordinal: 4, codeAction: "SKIP", codeRule: "budget" }), at);
    for (const id of [unowned.id, skipped.id]) await expect(port.begin(owner, id, at)).rejects.toThrow("review_conflict");
    await port.cancel(owner, runId);
    for (const id of [active.id, approved.id]) expect((await port.read(owner, id))?.state).toBe("cancelled");
    expect((await port.read(owner, consumed.id))?.state).toBe("consumed");
    for (const id of [unowned.id, skipped.id]) expect((await port.read(owner, id))?.state).toBe("observed");
    const opinion = await port.verdict(owner, { id: consumed.id, key: randomUUID(), context: "opinion", value: "disagree",
      expectedCode: { action: "BUY", rule: "selected" }, reason: "Synthetic later disagreement" }, at + REVIEW_WAIT_MS * 2);
    expect(opinion).toMatchObject({ state: "consumed", verdict: { value: "disagree", context: "opinion" } });
  });

  it("two genuine native connections serialize competing votes and consumes", async () => {
    const f = fixture(), first = f.open(), second = f.open();
    const a = createEnrolledSqliteDecisionReviews(first.db)!, b = createEnrolledSqliteDecisionReviews(second.db)!, record = await held(a);
    const votes = await Promise.allSettled([a, b].map(port => port.verdict(owner, { id: record.id, key: randomUUID(), context: "gate", value: "agree" }, at + 1)));
    expect(votes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const consumes = await Promise.allSettled([a.consume(owner, record.id, record.terms, at + 2), b.consume(owner, record.id, record.terms, at + 2)]);
    expect(consumes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(journalCount(f.file, "decision_review_verdicts")).toBe(1); expect((await b.read(owner, record.id))?.state).toBe("consumed");
    expect(first.db.isTransaction).toBe(false); expect(second.db.isTransaction).toBe(false);
  });

  it("whole-period native metrics preserve cohorts, privacy and human/code distinctions", async () => {
    const f = fixture(), port = createEnrolledSqliteDecisionReviews(f.open().db)!;
    const active = await held(port); await port.verdict(owner, { id: active.id, key: randomUUID(), context: "gate", value: "disagree", reason: "PRIVATE" }, at + 1);
    const cancelled = await port.capture(owner, decision(), at); await port.cancel(owner, cancelled.runId);
    await port.capture(owner, decision({ modelAction: "BUY", codeAction: "SKIP", codeRule: "portfolio" }), at);
    await port.capture(owner, decision({ modelAction: "SKIP", codeAction: "SKIP", codeRule: "model-skip", cohort: "team", cohortEvidence: "synthetic-team" }), at);
    await port.capture(owner, decision(), Date.parse("2026-10-10T00:00:00.000Z"));
    const metrics = await port.metrics(network, "2026-10-09T00:00:00.000Z", "2026-10-10T00:00:00.000Z");
    expect(decisionReviewMetricsSchema.parse(metrics)).toEqual(metrics);
    expect(metrics.cohorts.find(row => row.cohort === "unknown")).toMatchObject({ decisions: 3, agrees: 0, disagrees: 1,
      agreementRate: 0, codeRefusals: 1, modelCodeDifferences: 1, refusalReasons: { portfolio: 1 } });
    expect(metrics.cohorts.find(row => row.cohort === "outside")).toMatchObject({ decisions: 0, agreementRate: null });
    expect(JSON.stringify(metrics)).not.toMatch(/PRIVATE|0x111|source-one|exact-version-one|runId|wallet/);
    await expect(port.metrics(network, "2026-02-30T00:00:00.000Z", "2026-03-05T00:00:00.000Z")).rejects.toThrow(); await port.ready();
  });

  it("actual readonly denies every writer before SQL and keeps all readers usable", async () => {
    const f = fixture(), writer = createEnrolledSqliteDecisionReviews(f.open().db)!, record = await held(writer);
    const connection = f.open(true), port = createEnrolledSqliteDecisionReviews(connection.db)!, before = readFileSync(f.file);
    const prepare = vi.spyOn(DatabaseSync.prototype, "prepare"), exec = vi.spyOn(DatabaseSync.prototype, "exec");
    try {
      for (const operation of [() => port.capture(owner, decision(), at), () => port.begin(owner, record.id, at),
        () => port.verdict(owner, { id: record.id, key: randomUUID(), context: "gate", value: "agree" }, at),
        () => port.consume(owner, record.id, record.terms, at), () => port.cancel(owner, record.runId),
        () => port.expire(owner, record.id, at), () => port.observe(owner, record.id, "SKIP", "budget")])
        await expect(operation()).rejects.toThrow("review_unavailable");
      expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
    } finally { prepare.mockRestore(); exec.mockRestore(); }
    await port.ready(); expect((await port.read(owner, record.id))?.state).toBe("held");
    expect(await port.list(owner, record.runId)).toHaveLength(1);
    await expect(port.metrics(network, "2026-10-09T00:00:00.000Z", "2026-10-10T00:00:00.000Z")).resolves.toBeDefined();
    expect(connection.db.isTransaction).toBe(false); expect(readFileSync(f.file)).toEqual(before);
  });

  it("real reserved-writer BEGIN contention refuses once with no txn and preserves this port and another reader", async () => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqliteDecisionReviews(connection.db)!;
    const history = createEnrolledSqlitePersonalHistory(connection.db), blocker = new DatabaseSync(f.file), originalExec = DatabaseSync.prototype.exec;
    let observed: unknown;
    blocker.exec("BEGIN IMMEDIATE");
    const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
      try { return Reflect.apply(originalExec, this, [sql]); }
      catch (error) { if (sql === "BEGIN IMMEDIATE") observed = error; throw error; }
    });
    try { await expect(port.capture(owner, decision(), at)).rejects.toThrow("review_unavailable"); }
    finally { spy.mockRestore(); blocker.exec("ROLLBACK"); blocker.close(); }
    expect(observed).toMatchObject({ code: "ERR_SQLITE_ERROR", errcode: 5 }); expect(connection.db.isTransaction).toBe(false);
    expect(journalCount(f.file)).toBe(0); await port.ready();
    expect(typeof history.receipts).toBe("function");
    expect(await history.receipts!(synthetic.order.id, 10)).toHaveLength(1);
    expect((await port.capture(owner, decision(), at)).state).toBe("observed");
  }, 20000);

  it("real EXCLUSIVE guard-read contention releases its guard txn and preserves shared readers", async () => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqliteDecisionReviews(connection.db)!, record = await held(port);
    const blocker = new DatabaseSync(f.file); blocker.exec("BEGIN EXCLUSIVE");
    try { await expect(port.read(owner, record.id)).rejects.toThrow("review_unavailable"); }
    finally { blocker.exec("ROLLBACK"); blocker.close(); }
    expect(connection.db.isTransaction).toBe(false); expect((await port.read(owner, record.id))?.state).toBe("held"); await port.ready();
  }, 20000);

  it("a real COMMIT lock failure never ACKs and permanently revokes even after cleanup", async () => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqliteDecisionReviews(connection.db)!;
    const blocker = new DatabaseSync(f.file), originalExec = DatabaseSync.prototype.exec;
    blocker.exec("BEGIN"); blocker.prepare("SELECT id FROM decision_review_records").all();
    let observed: unknown;
    const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
      try { return Reflect.apply(originalExec, this, [sql]); }
      catch (error) { if (sql === "COMMIT") observed = error; throw error; }
    });
    try { await expect(port.capture(owner, decision(), at)).rejects.toThrow("review_unavailable"); }
    finally { spy.mockRestore(); blocker.exec("ROLLBACK"); blocker.close(); }
    expect(observed).toMatchObject({ code: "ERR_SQLITE_ERROR", errcode: 5 });
    expect(journalCount(f.file)).toBe(0); await expect(port.ready()).rejects.toThrow("review_unavailable");
    expect(() => assertVerifiedSqliteConnection(connection.db)).toThrow();
    await expect(createEnrolledSqliteDecisionReviews(f.open().db)!.ready()).resolves.toBeUndefined();
  }, 20000);

  it.each(["manifest", "schema", "fence", "file"] as const)("observed %s drift prevents held-file replacement or permanently revokes after exact restoration", async mode => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqliteDecisionReviews(connection.db)!, record = await held(port);
    const manifest = readFileSync(f.manifest), saved = `${f.file}.saved`;
    const history = mode === "file" ? createEnrolledSqlitePersonalHistory(connection.db) : undefined;
    const fileSnapshot = mode === "file" ? { bytes: readFileSync(f.file), schema: schemaRows(f.file), financial: originals(f.file),
      stat: lstatSync(f.file, { bigint: true }) } : undefined;
    let fence: [string, string] | undefined, fileMoved = false;
    if (mode === "manifest") writeFileSync(f.manifest, "{}");
    if (mode === "schema") edit(f.file, raw => raw.exec("CREATE INDEX foreign_review_index ON decision_review_records(wallet)"));
    if (mode === "fence") edit(f.file, raw => {
      fence = Object.entries(storageFenceStatements(raw, identity)).find(([, sql]) => sql.includes(' ON "decision_review_records"'));
      raw.exec(`DROP TRIGGER ${fence![0]}`);
    });
    try {
      if (mode === "file") {
        // One real attempt while the original native connection and target are held.
        try { renameSync(f.file, saved); fileMoved = true; }
        catch (error) {
          expect(process.platform).toBe("win32"); expect(error).toMatchObject({ code: "EBUSY" });
          expect(existsSync(saved)).toBe(false);
          expect(assertVerifiedSqliteConnection(connection.db)).toEqual(identity);
          await port.ready(); expect(await port.read(owner, record.id)).toEqual(record);
          expect(await port.list(owner, record.runId)).toEqual([record]);
          expect(typeof history!.receipts).toBe("function");
          expect(await history!.receipts!(synthetic.order.id, 10)).toHaveLength(1);
          expect(connection.db.isTransaction).toBe(false);
          expect(lstatSync(f.file, { bigint: true })).toMatchObject({ dev: fileSnapshot!.stat.dev,
            ino: fileSnapshot!.stat.ino, birthtimeNs: fileSnapshot!.stat.birthtimeNs });
          expect(readFileSync(f.file)).toEqual(fileSnapshot!.bytes); expect(schemaRows(f.file)).toBe(fileSnapshot!.schema);
          expect(originals(f.file)).toBe(fileSnapshot!.financial);
          expect(journalCount(f.file)).toBe(1); expect(journalCount(f.file, "decision_review_verdicts")).toBe(0);
          return;
        }
        copyFileSync(saved, f.file);
      }
      await expect(port.read(owner, record.id)).rejects.toThrow("review_unavailable");
      if (fileMoved) expect(() => assertVerifiedSqliteConnection(connection.db)).toThrow();
    } finally {
      if (mode === "manifest") writeFileSync(f.manifest, manifest);
      if (mode === "schema") edit(f.file, raw => raw.exec("DROP INDEX foreign_review_index"));
      if (mode === "fence") edit(f.file, raw => raw.exec(fence![1]));
      if (fileMoved) { rmSync(f.file, { force: true }); renameSync(saved, f.file); }
    }
    await expect(port.read(owner, record.id)).rejects.toThrow("review_unavailable");
    expect(() => assertVerifiedSqliteConnection(connection.db)).toThrow();
    expect((await createEnrolledSqliteDecisionReviews(f.open().db)!.read(owner, record.id))?.state).toBe("held");
    if (fileSnapshot) {
      expect(lstatSync(f.file, { bigint: true })).toMatchObject({ dev: fileSnapshot.stat.dev,
        ino: fileSnapshot.stat.ino, birthtimeNs: fileSnapshot.stat.birthtimeNs });
      expect(readFileSync(f.file)).toEqual(fileSnapshot.bytes); expect(schemaRows(f.file)).toBe(fileSnapshot.schema);
      expect(originals(f.file)).toBe(fileSnapshot.financial);
      expect(journalCount(f.file)).toBe(1); expect(journalCount(f.file, "decision_review_verdicts")).toBe(0);
    }
  });

  it("alternate supported full19 family still permanently refuses the original opening after restoration", async () => {
    const f = fixture(true, true), connection = f.open(), port = createEnrolledSqliteDecisionReviews(connection.db)!;
    const record = await port.capture(owner, decision({ reviewFirst: false }), at), before = schemaRows(f.file);
    let alternate: ReturnType<typeof f.open> | undefined, alternatePort: DecisionReviewsStore | undefined;
    try {
      // Dropping the genuine archive and its fences leaves the other supported
      // full19 family, with no new objects outside the original exclusion set.
      edit(f.file, raw => raw.exec("DROP TABLE public_reference_article_terms; DROP TABLE public_reference_article_versions; DROP TABLE public_reference_articles"));
      alternate = f.open(true); alternatePort = createEnrolledSqliteDecisionReviews(alternate.db)!;
      expect(() => assertVerifiedSqliteNativeUserDomainPolicy(alternate!.db)).not.toThrow();
      await alternatePort.ready(); expect(await alternatePort.read(owner, record.id)).toEqual(record);
      expect(schemaRows(f.file)).not.toBe(before);
      await expect(port.read(owner, record.id)).rejects.toThrow("review_unavailable");
      expect(() => assertVerifiedSqliteConnection(connection.db)).toThrow();
    } finally {
      edit(f.file, raw => { installPublicReferenceArchive(raw); installStorageFences(raw, identity); });
    }
    expect(schemaRows(f.file)).toBe(before);
    await expect(port.ready()).rejects.toThrow("review_unavailable");
    expect(() => assertVerifiedSqliteConnection(connection.db)).toThrow();
    await expect(alternatePort!.ready()).rejects.toThrow("review_unavailable");
    expect(() => assertVerifiedSqliteConnection(alternate!.db)).toThrow();
    expect(await createEnrolledSqliteDecisionReviews(f.open(true).db)!.read(owner, record.id)).toEqual(record);
    expect(journalCount(f.file)).toBe(1); expect(journalCount(f.file, "decision_review_verdicts")).toBe(0);
  });

  it("an internal runtime guard failure after real mutation rolls back and stays revoked after manifest restoration", async () => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqliteDecisionReviews(connection.db)!, manifest = readFileSync(f.manifest);
    const originalRun = StatementSync.prototype.run;
    const spy = vi.spyOn(StatementSync.prototype, "run").mockImplementation(function (this: StatementSync, ...args) {
      const result = Reflect.apply(originalRun, this, args); writeFileSync(f.manifest, "{}"); return result;
    });
    try { await expect(port.capture(owner, decision(), at)).rejects.toThrow("review_unavailable"); }
    finally { spy.mockRestore(); writeFileSync(f.manifest, manifest); }
    expect(journalCount(f.file)).toBe(0); await expect(port.ready()).rejects.toThrow("review_unavailable");
    expect(() => assertVerifiedSqliteConnection(connection.db)).toThrow();
    expect((await createEnrolledSqliteDecisionReviews(f.open().db)!.capture(owner, decision(), at)).state).toBe("observed");
  });

  it.each([
    new Error("Unclassified native SQL failure"),
    new DecisionReviewError("review_conflict"),
    Object.assign(new Error("SQLite non-contention"), { code: "ERR_SQLITE_ERROR", errcode: 1 }),
    Object.assign(new Error("Nonnumeric busy"), { code: "ERR_SQLITE_ERROR", errcode: "5" }),
    Object.assign(new Error("Wrong busy label"), { code: "SQLITE_BUSY", errcode: 5 }),
  ])("unclassified SQL failure revokes without reviving after restoration: %s", async error => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqliteDecisionReviews(connection.db)!, originalPrepare = DatabaseSync.prototype.prepare;
    const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, sql) {
      if (sql === "INSERT INTO decision_review_records VALUES(?,?,?,?,?,?,?,?,?,?,?)") throw error;
      return Reflect.apply(originalPrepare, this, [sql]);
    });
    try { await expect(port.capture(owner, decision(), at)).rejects.toThrow("review_unavailable"); }
    finally { spy.mockRestore(); }
    expect(journalCount(f.file)).toBe(0); await expect(port.ready()).rejects.toThrow("review_unavailable");
    expect(() => assertVerifiedSqliteConnection(connection.db)).toThrow();
  });

  it("a failure after genuine COMMIT withholds ACK and cannot revive or duplicate the committed record", async () => {
    const f = fixture(), connection = f.open(), port = createEnrolledSqliteDecisionReviews(connection.db)!, originalExec = DatabaseSync.prototype.exec;
    let committed = false;
    const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
      const target = !committed && sql === "COMMIT" && this.isTransaction
        && Number(this.prepare("SELECT count(*) AS n FROM decision_review_records").get()?.n) === 1;
      const result = Reflect.apply(originalExec, this, [sql]);
      if (target) { committed = true; throw new Error("Synthetic lost ACK after actual native COMMIT"); }
      return result;
    });
    try { await expect(port.capture(owner, decision(), at)).rejects.toThrow("review_unavailable"); }
    finally { spy.mockRestore(); }
    expect(committed).toBe(true); expect(journalCount(f.file)).toBe(1);
    await expect(port.capture(owner, decision(), at)).rejects.toThrow("review_unavailable"); expect(journalCount(f.file)).toBe(1);
    expect(() => assertVerifiedSqliteConnection(connection.db)).toThrow();
  });

  it("existing cookie-owner GET accepts the real store contract with private cache and owner checks", async () => {
    const f = fixture(), port = createEnrolledSqliteDecisionReviews(f.open().db)!, record = await port.capture(owner, decision({ reviewFirst: false }), at);
    const db = { decisionReviews: port } as KeryxDB, session = vi.fn(async () => ({ db, wallet: owner, currentId: "synthetic-session" }));
    const routes = createDecisionReviewRoutes(session, "https://keryx.example");
    const request = (wallet = owner, bearer = false) => new Request(`https://keryx.example/api/me/decision-reviews?runId=${record.runId}`, {
      headers: { "X-Keryx-Expected-Wallet": wallet, ...(bearer ? { Authorization: "Bearer synthetic" } : {}) } });
    const response = await routes.GET(request()); expect(response.status).toBe(200);
    expect((await response.json()).reviews).toEqual([record]); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await routes.GET(request(other))).status).toBe(409); session.mockClear();
    expect((await routes.GET(request(owner, true))).status).toBe(401); expect(session).not.toHaveBeenCalled();
  });
});
