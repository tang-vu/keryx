import { afterEach, expect, it, onTestFailed, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { requirePrivateProfiles } from "../profiles/private-profile";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, renameSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "../canonical-json";
import { randomBytes, createHash } from "node:crypto";
import { installSqliteApplicationSchema } from "./sqlite-application-schema";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { inspectSqliteEnrollment, enrollSqliteStorage } from "./storage-identity-provision";
import type { SqliteAdapter } from "./sqlite-adapter";
import type { QueryRun } from "../types";
import { sealEnrolledCacheText } from "../sources/enrolled-content-cache";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { GATEWAY_FUNDING_SCHEMA, GATEWAY_FUNDING_INDEXES } from "./gateway-funding-sqlite-schema";
import { createServer } from "node:http";
import { once } from "node:events";
import { encodeFunctionResult } from "viem";
import { REGISTRY_ABI } from "../registry/registry-abi";
import { browserSourceRegistryId } from "../payments/browser-original-source-context";
import type { BrowserSourceOriginalAdmission } from "./browser-signing-originals";
import type { BrowserQueryPolicy } from "../payments/browser-query-policy";

function fixtureDiagnostics(label?: string) {
  const started = performance.now();
  return (phase: string) => {
    if (label && process.env.KERYX_ENROLLED_TEST_DIAGNOSTICS === "1")
      console.error(JSON.stringify({ fixtureTiming: label, phase, elapsedMs: Math.round(performance.now() - started),
        rssMiB: Math.round(process.memoryUsage().rss / 1048576) }));
  };
}
const fixtures: { folder: string; adapters: SqliteAdapter[]; phase: (name: string) => void }[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.phase("cleanup:start");
    for (const adapter of fixture.adapters) adapter.close();
    rmSync(fixture.folder, { recursive: true, force: true });
    fixture.phase("cleanup:end");
  }
  vi.unstubAllEnvs();
});
async function fixture(mode: "testnet-real" | "testnet-offline" = "testnet-real", funding = false, diagnosticLabel?: string) {
  const phase = fixtureDiagnostics(diagnosticLabel);
  phase("fixture:start");
  vi.resetModules();
  const folder = mkdtempSync(join(tmpdir(), "keryx-enrolled-adapter-"));
  const file = join(folder, "synthetic.sqlite");
  const manifestPath = join(folder, "deployment.json");
  const identity = syntheticStorageIdentity(mode);
  const adapters: SqliteAdapter[] = [];
  fixtures.push({ folder, adapters, phase });
  phase("schema:start");
  const native = new DatabaseSync(file);
  try {
    // Batch the actual fresh schema DDL in one native commit. Browser installers
    // retain their own savepoints when the caller already owns a transaction.
    native.exec("BEGIN IMMEDIATE");
    installSqliteApplicationSchema(native);
    if (funding) {
      for (const sql of Object.values(GATEWAY_FUNDING_SCHEMA)) native.exec(sql);
      for (const sql of Object.values(GATEWAY_FUNDING_INDEXES)) native.exec(sql);
    }
    native.exec("COMMIT");
  } catch (error) {
    if (native.isTransaction) native.exec("ROLLBACK");
    throw error;
  } finally { native.close(); }
  phase("schema:end");
  phase("inspection:start");
  const inspection = await inspectSqliteEnrollment(file, identity);
  phase("inspection:end");
  phase("enrollment:start");
  await enrollSqliteStorage(file, identity, {
    format: "keryx-reviewed-storage-enrollment-v1", inspection,
    provenanceDocumentDigest: identity.provenanceDigest,
    unknownClassAttestation: inspection.unknownClasses,
  });
  phase("enrollment:end");
  const manifest = { format: "keryx-storage-deployment-v1", identity,
    backend: { kind: "sqlite", databasePath: file } };
  writeFileSync(manifestPath, canonicalJson(manifest));
  vi.stubEnv("KERYX_STORAGE_MANIFEST", manifestPath);
  vi.stubEnv("KERYX_SQLITE_PATH", file);
  vi.stubEnv("KERYX_FORCE_OFFLINE", mode === "testnet-offline" ? "1" : "0");
  vi.stubEnv("CONTENT_MASTER_KEY", randomBytes(32).toString("hex"));
  phase("import:start");
  const api = await import("./enrolled-sqlite-adapter");
  phase("import:end");
  return { file, manifestPath, manifest, identity, adapters, api, phase };
}

it("private-profile capability is absent on the actual enrolled facade and refuses before native or manifest guard I/O", async () => {
  const f = await fixture("testnet-offline");
  const adapter = await f.api.createEnrolledSqliteAdapter(); f.adapters.push(adapter);
  writeFileSync(f.manifestPath, "{}", "utf8");
  const prepare = vi.spyOn(DatabaseSync.prototype, "prepare"), exec = vi.spyOn(DatabaseSync.prototype, "exec");
  try {
    expect(Object.hasOwn(adapter, "privateProfiles")).toBe(false);
    expect(() => requirePrivateProfiles(adapter)).toThrow("profile_unavailable");
    expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
  } finally { prepare.mockRestore(); exec.mockRestore(); }
});

it("uses the exact installed application schema without startup migration and retains enrolled provenance", async () => {
  const f = await fixture("testnet-real", false, "exact-schema");
  const before = readFileSync(f.file);
  f.phase("open:start");
  const adapter = await f.api.createEnrolledSqliteAdapter();
  f.phase("open:end");
  f.adapters.push(adapter);
  expect(f.api.assertEnrolledSqliteAdapter(adapter)).toEqual(f.identity);
  expect(() => f.api.assertEnrolledSqliteAdapter({})).toThrow();
  expect(Reflect.get(adapter, "db")).toBeUndefined();
  expect(Reflect.get(adapter, "fromVerifiedConnection")).toBeUndefined();
  expect(Reflect.get(adapter, "assembleConnectionCore")).toBeUndefined();
  for (const method of ["claimResearchPurchase", "createResearchMonthly", "getResearchMonthly", "redeemResearchMonthly"] as const) {
    expect(f.api.ENROLLED_SQLITE_METHOD_ACCESS[method]).toMatch(/^mainnet-/);
    expect(() => Reflect.apply(adapter[method], adapter, [])).toThrow("unavailable in enrolled storage");
  }
  f.phase("guard:start");
  await adapter.init();
  expect(await adapter.listSources()).toEqual([]);
  expect(await adapter.getSessionGrant("missing")).toBeNull();
  expect(readFileSync(f.file)).toEqual(before);
  await adapter.setSyncState("native", "retained");
  expect(await adapter.getSyncState("native")).toBe("retained");
  const raw = new DatabaseSync(f.file);
  try {
    expect(() => raw.prepare("UPDATE sync_state SET value='bypass' WHERE key='native'").run()).toThrow();
    expect(raw.prepare("SELECT value FROM sync_state WHERE key='native'").get()?.value).toBe("retained");
  } finally { raw.close(); }
  f.phase("guard:end");
});

it("refuses every explicitly reviewed readonly mutator before invocation, including reads that write usage", async () => {
  const f = await fixture();
  const adapter = await f.api.createReadonlyEnrolledSqliteAdapter();
  f.adapters.push(adapter);
  const before = readFileSync(f.file);
  expect(f.api.assertEnrolledSqliteAdapter(adapter, "read")).toEqual(f.identity);
  expect(() => f.api.assertEnrolledSqliteAdapter(adapter, "write")).toThrow();
  expect(() => Reflect.apply(f.api.assertEnrolledSqliteAdapter, null, [adapter, "unknown"])).toThrow();
  expect(() => Reflect.apply(f.api.assertEnrolledSqliteAdapter, null, [adapter, "read", "extra"])).toThrow();
  for (const [name, access] of Object.entries(f.api.ENROLLED_SQLITE_METHOD_ACCESS)) {
    if (access === "write") expect(() => Reflect.apply(Reflect.get(adapter, name), adapter, [])).toThrow("mutation refused");
    if (access.startsWith("mainnet-")) expect(() => Reflect.apply(Reflect.get(adapter, name), adapter, [])).toThrow("unavailable in enrolled storage");
  }
  expect(await adapter.listSources()).toEqual([]);
  expect(readFileSync(f.file)).toEqual(before);
});

it("guards verified-only source CAS and projects item provenance without exposing internal metadata lookup", async () => {
  const f = await fixture();
  const adapter = await f.api.createEnrolledSqliteAdapter();
  f.adapters.push(adapter);
  const wallet = `0x${"aB".repeat(20)}`, feed = "https://publisher.test/feed";
  const source = { id: "mixed", name: "Mixed publisher", url: "https://publisher.test/", rssUrl: feed,
    description: "Fixture", walletAddress: wallet, fetchPrice: 0.019, active: false, verified: false,
    tags: [], authors: [], createdAt: new Date().toISOString() };
  await adapter.upsertSource(source);
  await adapter.addItems([{ id: "demo", sourceId: source.id, title: "Synthetic item", summary: "Demo",
    content: "Unread ciphertext", link: "https://publisher.test/demo", evidenceProvenance: "synthetic-demo" }]);
  expect(f.api.ENROLLED_SQLITE_METHOD_ACCESS.verifySourceIfUnchanged).toBe("write");
  expect(Reflect.get(adapter, "readEvidenceProvenance")).toBeUndefined();
  expect(await adapter.verifySourceIfUnchanged({ sourceId: source.id, walletAddress: wallet.toLowerCase(), feedUrl: feed })).toBe(true);
  expect(await adapter.getSource(source.id)).toMatchObject({ verified: true, active: false, fetchPrice: 0.019, authors: [] });
  expect(await adapter.verifySourceIfUnchanged({ sourceId: source.id, walletAddress: wallet, feedUrl: "https://changed.test/feed" })).toBe(false);
  const run: QueryRun = { id: crypto.randomUUID(), question: "Synthetic question", budget: 0.02,
    engine: "fixture", subClaims: [], decisions: [], citations: [{ marker: "S1", sourceId: source.id,
      sourceName: source.name, itemId: "demo", weight: 1, reward: 0.003, rationale: "Historical fixture" }],
    answer: "Historical illustrative fact [S1]", totalSpent: 0.003, totalToCreators: 0.003, trace: [], createdAt: new Date().toISOString() };
  await adapter.saveQueryRun(run);
  const readonly = await f.api.createReadonlyEnrolledSqliteAdapter();
  f.adapters.push(readonly);
  const before = readFileSync(f.file);
  expect(() => readonly.verifySourceIfUnchanged({ sourceId: source.id, walletAddress: wallet, feedUrl: feed })).toThrow("mutation refused");
  const projected = await readonly.getQueryRun(run.id);
  expect(projected?.citations[0].evidenceProvenance).toBe("synthetic-demo");
  expect(projected?.answer).toContain("Illustrative demo content");
  expect(projected?.totalSpent).toBe(run.totalSpent);
  expect(readFileSync(f.file)).toEqual(before);
  writeFileSync(f.manifestPath, canonicalJson({ ...f.manifest, identity: { ...f.identity, storageId: crypto.randomUUID() } }));
  expect(() => adapter.verifySourceIfUnchanged({ sourceId: source.id, walletAddress: wallet, feedUrl: feed })).toThrow();
  expect(readFileSync(f.file)).toEqual(before);
});

it("refuses schema drift rather than repairing it and keeps close usable after manifest drift", async () => {
  const f = await fixture();
  const adapter = await f.api.createEnrolledSqliteAdapter();
  f.adapters.push(adapter);
  const raw = new DatabaseSync(f.file);
  try { raw.exec("DROP INDEX query_runs_parent"); } finally { raw.close(); }
  const before = readFileSync(f.file);
  expect(() => adapter.getSource("missing")).toThrow("schema migration required");
  expect(readFileSync(f.file)).toEqual(before);
  writeFileSync(f.manifestPath, canonicalJson({ ...f.manifest,
    identity: { ...f.identity, storageId: crypto.randomUUID() } }));
  expect(() => adapter.listSources()).toThrow();
  adapter.close();
  expect(() => f.api.assertEnrolledSqliteAdapter(adapter)).toThrow();
});

it("rejects a new unreviewed public method before publishing an adapter", async () => {
  const f = await fixture();
  const { SqliteAdapter: Core } = await import("./sqlite-adapter");
  Object.defineProperty(Core.prototype, "futureAuthorityMethod", { configurable: true, value: () => true });
  try { await expect(f.api.createEnrolledSqliteAdapter()).rejects.toThrow("inventory requires review"); }
  finally { Reflect.deleteProperty(Core.prototype, "futureAuthorityMethod"); }
});

it("rejects cloned facades and verified cores as runtime provenance and refuses malformed or missing readiness keys", async () => {
  const f = await fixture();
  const adapter = await f.api.createEnrolledSqliteAdapter();
  f.adapters.push(adapter);
  expect(() => f.api.assertEnrolledSqliteAdapter({ ...adapter })).toThrow();
  const { openVerifiedSqliteStorage } = await import("./storage-identity-connection");
  const { SqliteAdapter: Core } = await import("./sqlite-adapter");
  const verified = openVerifiedSqliteStorage(f.file, f.identity);
  try {
    expect(() => f.api.assertEnrolledSqliteAdapter(Core.assembleConnectionCore(verified.db, f.identity, () => {}))).toThrow();
  } finally { verified.close(); }
  const before = readFileSync(f.file);
  for (const key of ["", "invalid"]) {
    vi.stubEnv("CONTENT_MASTER_KEY", key);
    await expect(f.api.createEnrolledSqliteAdapter()).rejects.toThrow("key unavailable");
    expect(readFileSync(f.file)).toEqual(before);
  }
});

function fixtureFailureStages() {
  const started = performance.now();
  const stages: { stage: string; elapsedMs: number }[] = [];
  onTestFailed(() => {
    console.error("Enrolled adapter fixture stages", JSON.stringify(stages));
  });
  return (stage: string) => {
    if (stages.length >= 12) throw new Error("Adapter fixture stage bound exceeded");
    stages.push({ stage, elapsedMs: Math.round(performance.now() - started) });
  };
}

it("enforces real cache AEAD on reads and readiness without rewriting bad rows", async () => {
  const stage = fixtureFailureStages();
  stage("fixture-start");
  const f = await fixture();
  stage("factory-start");
  const adapter = await f.api.createEnrolledSqliteAdapter();
  f.adapters.push(adapter);
  stage("cache-roundtrip");
  await adapter.setCached("source", "Synthetic cached body");
  expect(await adapter.getCached("source")).toBe("Synthetic cached body");
  stage("owner-open");
  const { openVerifiedSqliteStorage } = await import("./storage-identity-connection");
  const owner = openVerifiedSqliteStorage(f.file, f.identity);
  try {
    owner.db.prepare("UPDATE cache_items SET source_id='other' WHERE source_id='source'").run();
    const before = owner.db.prepare("SELECT * FROM cache_items").all();
    stage("wrong-aad-read");
    await expect(adapter.getCached("other")).rejects.toThrow("unavailable");
    stage("wrong-aad-readiness");
    await expect(f.api.createEnrolledSqliteAdapter()).rejects.toThrow("unavailable");
    expect(owner.db.prepare("SELECT * FROM cache_items").all()).toEqual(before);
  } finally { stage("owner-close"); owner.close(); }
  stage("complete");
});

it("refuses plaintext real cache readiness without rewriting the retained row", async () => {
  const stage = fixtureFailureStages();
  stage("fixture-start");
  const f = await fixture();
  stage("factory-start");
  const adapter = await f.api.createEnrolledSqliteAdapter();
  f.adapters.push(adapter);
  stage("cache-write");
  await adapter.setCached("source", "Synthetic cached body");
  stage("owner-open");
  const { openVerifiedSqliteStorage } = await import("./storage-identity-connection");
  const owner = openVerifiedSqliteStorage(f.file, f.identity);
  try {
    owner.db.prepare("UPDATE cache_items SET text='plain:v1:legacy' WHERE source_id='source'").run();
    const legacy = owner.db.prepare("SELECT * FROM cache_items").all();
    stage("plaintext-readiness");
    await expect(f.api.createEnrolledSqliteAdapter()).rejects.toThrow("unavailable");
    expect(owner.db.prepare("SELECT * FROM cache_items").all()).toEqual(legacy);
  } finally { stage("owner-close"); owner.close(); }
  stage("complete");
});

it("retains the exact cache row quota atomically and permits replacement without new startup failure", async () => {
  const f = await fixture();
  const adapter = await f.api.createEnrolledSqliteAdapter();
  f.adapters.push(adapter);
  const { openVerifiedSqliteStorage } = await import("./storage-identity-connection");
  const owner = openVerifiedSqliteStorage(f.file, f.identity);
  try {
    const values = Array.from({ length: 511 }, (_, index) => {
      const id = `slot-${index}`;
      const encoded = sealEnrolledCacheText("Synthetic body", id, f.identity);
      return `('${id}','${encoded}','synthetic')`;
    });
    owner.db.exec(`INSERT INTO cache_items(source_id,text,updated_at) VALUES ${values.join(",")}`);
    await adapter.setCached("last", "Last allowed body");
    const before = owner.db.prepare("SELECT * FROM cache_items ORDER BY source_id").all();
    await expect(adapter.setCached("overflow", "Refused body")).rejects.toThrow("inspection limit");
    expect(owner.db.prepare("SELECT * FROM cache_items ORDER BY source_id").all()).toEqual(before);
    await adapter.setCached("last", "Replacement body");
    expect(await adapter.getCached("last")).toBe("Replacement body");
    const reopened = await f.api.createEnrolledSqliteAdapter();
    f.adapters.push(reopened);
    expect(await reopened.getCached("last")).toBe("Replacement body");
  } finally { owner.close(); }
});

it("guards early computed results and iterator publication after actual runtime mode drift", async () => {
  const f = await fixture();
  const adapter = await f.api.createEnrolledSqliteAdapter();
  f.adapters.push(adapter);
  const run: QueryRun = { id: crypto.randomUUID(), question: "Synthetic question", budget: 0,
    engine: "fixture", subClaims: [], decisions: [], citations: [], answer: "Synthetic answer",
    totalSpent: 0, totalToCreators: 0, trace: [], createdAt: new Date().toISOString() };
  await adapter.saveQueryRun(run);
  const iterator = adapter.iterateRecentQueries(2)[Symbol.asyncIterator]();
  expect((await iterator.next()).value).toEqual(run);
  vi.stubEnv("KERYX_FORCE_OFFLINE", "1");
  await expect(iterator.next()).rejects.toThrow();
  expect(() => adapter.newestItemDates([])).toThrow();
  expect(() => f.api.assertEnrolledSqliteAdapter(adapter)).toThrow();
});

it("refuses post-write async publication after manifest drift without claiming the committed write rolled back", async () => {
  const f = await fixture();
  const { SqliteAdapter: Core } = await import("./sqlite-adapter");
  const original = Core.prototype.setSyncState;
  Core.prototype.setSyncState = async function (key, value) {
    await original.call(this, key, value);
    writeFileSync(f.manifestPath, canonicalJson({ ...f.manifest,
      identity: { ...f.identity, storageId: crypto.randomUUID() } }));
  };
  try {
    const adapter = await f.api.createEnrolledSqliteAdapter();
    f.adapters.push(adapter);
    await expect(adapter.setSyncState("committed", "retained")).rejects.toThrow();
    const raw = new DatabaseSync(f.file);
    try { expect(raw.prepare("SELECT value FROM sync_state WHERE key='committed'").get()?.value).toBe("retained"); }
    finally { raw.close(); }
  } finally { Core.prototype.setSyncState = original; }
});

it("uses native authentication, immutable private intent and exact private treasury helpers through the same enrolled core", async () => {
  const f = await fixture("testnet-real", false, "native-private-authority");
  f.phase("open:start");
  const adapter = await f.api.createEnrolledSqliteAdapter();
  f.phase("open:end");
  f.adapters.push(adapter);
  f.phase("guard:start");
  const payer = privateKeyToAccount(generatePrivateKey());
  const challenge = createHash("sha256").update("synthetic-challenge").digest("hex");
  await adapter.createAuthChallenge(challenge, Date.now(), Date.now() + 60000);
  expect(await adapter.consumeAuthChallenge(challenge, Date.now())).toBe(true);
  expect(await adapter.consumeAuthChallenge(challenge, Date.now())).toBe(false);
  const { createPrivateAuthorization } = await import("../buyer/private-request-commitment");
  const { preparePrivateResearchIntent } = await import("../a2a/private-research-intent");
  const { BUYER_GATEWAY, BUYER_NETWORK, BUYER_USDC, buyerTypedData } = await import("../buyer/protocol");
  const merchants = { privatePayee: `0x${"ab".repeat(20)}`, publicResearchPayee: `0x${"cd".repeat(20)}` };
  const requirement = { scheme: "exact", network: BUYER_NETWORK, asset: BUYER_USDC,
    amount: "50000", payTo: merchants.privatePayee, maxTimeoutSeconds: 604860,
    extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: BUYER_GATEWAY } };
  const request = { question: "Synthetic private question", budget: 0.03,
    researchMode: "quick", packageVersion: "1.0.0", responseMode: "async", access: "payer-private-v1", model: null };
  const fresh = await createPrivateAuthorization(request, requirement, payer.address, merchants, Date.now());
  const submission = { request: fresh.request, salt: fresh.salt,
    payment: { authorization: fresh.authorization, signature: await payer.signTypedData(buyerTypedData(fresh.authorization)) } };
  const intent = await preparePrivateResearchIntent(submission, requirement, merchants);
  expect(await adapter.reservePrivateResearchIntent(intent)).toEqual(intent);
  expect(await adapter.reservePrivateResearchIntent(intent)).toEqual(intent);
  expect(await adapter.getPrivateResearchIntent(intent.id, payer.address)).toEqual(intent);
  const policy = { signer: payer.address, capacityMicros: "100000" };
  const reserved = await adapter.reservePrivateTreasury(intent.id, payer.address, policy);
  expect(await adapter.reservePrivateTreasury(intent.id, payer.address, policy)).toEqual(reserved);
  expect(await adapter.getPrivateTreasury(intent.id, payer.address)).toEqual({ signer: payer.address.toLowerCase(), amountMicros: "30000" });
  const raw = new DatabaseSync(f.file);
  try {
    expect(raw.prepare("SELECT count(*) AS n FROM private_treasury_reservations").get()?.n).toBe(1);
    expect(() => raw.prepare("DELETE FROM private_research_intents WHERE id=?").run(intent.id)).toThrow();
  } finally { raw.close(); }
  f.phase("guard:end");
});

it("refuses Supabase selection without SQLite fallback and refuses foreign identity before application mutation", async () => {
  const f = await fixture();
  const before = readFileSync(f.file);
  writeFileSync(f.manifestPath, canonicalJson({ ...f.manifest,
    backend: { kind: "supabase", url: "https://synthetic.invalid" } }));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.invalid");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-noncredential");
  await expect(f.api.createEnrolledSqliteAdapter()).rejects.toThrow("backend not selected");
  expect(readFileSync(f.file)).toEqual(before);
  vi.resetModules();
  const fresh = await import("./enrolled-sqlite-adapter");
  writeFileSync(f.manifestPath, canonicalJson({ ...f.manifest,
    identity: { ...f.identity, storageId: crypto.randomUUID() } }));
  await expect(fresh.createEnrolledSqliteAdapter()).rejects.toThrow("identity_mismatch");
  expect(readFileSync(f.file)).toEqual(before);
});

it("holds the actual target across replacement and keeps close usable after refusal", async () => {
  const f = await fixture();
  const adapter = await f.api.createEnrolledSqliteAdapter();
  f.adapters.push(adapter);
  await adapter.setSyncState("retained", "native value");
  const before = readFileSync(f.file);
  if (process.platform === "win32") {
    try { renameSync(f.file, f.file + ".old"); throw new Error("Fixture unexpectedly renamed held target"); }
    catch (error) { expect((error as NodeJS.ErrnoException).code).toBe("EBUSY"); }
    expect(await adapter.getSyncState("retained")).toBe("native value");
  } else {
    renameSync(f.file, f.file + ".old");
    copyFileSync(f.file + ".old", f.file);
    expect(() => adapter.getSyncState("retained")).toThrow("target_replaced");
  }
  expect(readFileSync(f.file)).toEqual(before);
  adapter.close();
  expect(() => f.api.assertEnrolledSqliteAdapter(adapter)).toThrow();
});

it("guards actual stale statements and native iterators with captured runtime configuration", async () => {
  const f = await fixture();
  const adapter = await f.api.createEnrolledSqliteAdapter();
  f.adapters.push(adapter);
  await adapter.setSyncState("retained", "native value");
  const { openVerifiedSqliteStorage } = await import("./storage-identity-connection");
  const options = { readOnly: true, runtimeGuard: () => { f.api.assertEnrolledSqliteAdapter(adapter); } };
  const verified = openVerifiedSqliteStorage(f.file, f.identity, options);
  try {
    const statement = verified.db.prepare("SELECT value FROM sync_state WHERE key='retained'");
    const iterator = statement.iterate();
    expect(statement.get()?.value).toBe("native value");
    options.runtimeGuard = () => {};
    vi.stubEnv("KERYX_FORCE_OFFLINE", "1");
    expect(() => statement.get()).toThrow();
    expect(() => iterator.next()).toThrow();
  } finally { verified.close(); }
});

it("composes the exact complete installed funding domain without granting its separate writer authority", async () => {
  const stage = fixtureFailureStages();
  stage("fixture-start");
  const f = await fixture("testnet-real", true);
  stage("factory-start");
  const adapter = await f.api.createEnrolledSqliteAdapter();
  f.adapters.push(adapter);
  stage("application-roundtrip");
  await adapter.setSyncState("full-domain", "retained");
  expect(await adapter.getSyncState("full-domain")).toBe("retained");
  const { openVerifiedSqliteStorage } = await import("./storage-identity-connection");
  stage("owner-open");
  const owner = openVerifiedSqliteStorage(f.file, f.identity);
  try {
    stage("funding-read-and-writer-refusal");
    expect(owner.db.prepare("SELECT count(*) AS n FROM gateway_funding_operations").get()?.n).toBe(0);
    expect(() => owner.db.prepare("INSERT INTO gateway_funding_namespaces(sender,data) VALUES('synthetic','{}')").run()).toThrow("no such function: keryx_funding_capability");
  } finally { stage("owner-close"); owner.close(); }
  stage("complete");
});

it("refuses a tampered complete funding index without rewriting data or retaining a failed-open handle", async () => {
  const stage = fixtureFailureStages();
  stage("fixture-start");
  const f = await fixture("testnet-real", true);
  stage("factory-start");
  const adapter = await f.api.createEnrolledSqliteAdapter();
  f.adapters.push(adapter);
  stage("application-seed");
  await adapter.setSyncState("full-domain", "retained");
  stage("index-tamper");
  const raw = new DatabaseSync(f.file);
  try { raw.exec("DROP INDEX gateway_funding_observations_slot_kind"); }
  finally { raw.close(); }
  const before = readFileSync(f.file);
  stage("existing-adapter-refusal");
  expect(() => adapter.listSources()).toThrow();
  stage("readiness-refusal");
  await expect(f.api.createEnrolledSqliteAdapter()).rejects.toThrow();
  expect(readFileSync(f.file)).toEqual(before);
  renameSync(f.file, f.file + ".closed");
  renameSync(f.file + ".closed", f.file);
  expect(readFileSync(f.file)).toEqual(before);
  stage("complete");
});

it("refuses an oversized raw cache value inserted after readiness before publishing its body", async () => {
  const f = await fixture("testnet-real", false, "oversized-cache");
  f.phase("open:start");
  const adapter = await f.api.createEnrolledSqliteAdapter();
  f.phase("open:end");
  f.adapters.push(adapter);
  const { openVerifiedSqliteStorage } = await import("./storage-identity-connection");
  f.phase("owner-open:start");
  const owner = openVerifiedSqliteStorage(f.file, f.identity);
  f.phase("owner-open:end");
  try {
    f.phase("oversized-write:start");
    owner.db.prepare("INSERT INTO cache_items(source_id,text) VALUES('oversized',?)").run("x".repeat(2 * 1024 * 1024 + 1));
    const before = owner.db.prepare("SELECT length(CAST(text AS BLOB)) AS bytes FROM cache_items WHERE source_id='oversized'").get();
    f.phase("oversized-write:end");
    f.phase("guard:start");
    await expect(adapter.getCached("oversized")).rejects.toThrow("unavailable");
    expect(owner.db.prepare("SELECT length(CAST(text AS BLOB)) AS bytes FROM cache_items WHERE source_id='oversized'").get()).toEqual(before);
    f.phase("guard:end");
  } finally { f.phase("owner-close:start"); owner.close(); f.phase("owner-close:end"); }
});

it("uses explicit offline cache without a content key and preserves the offline financial fence", async () => {
  const f = await fixture("testnet-offline");
  vi.stubEnv("CONTENT_MASTER_KEY", "");
  vi.stubEnv("NODE_ENV", "production");
  const adapter = await f.api.createEnrolledSqliteAdapter();
  f.adapters.push(adapter);
  await adapter.setCached("offline", "Synthetic offline content");
  expect(await adapter.getCached("offline")).toBe("Synthetic offline content");
  await expect(adapter.activateBrowserJournal()).rejects.toThrow("offline storage denies journal activation");
  expect(await adapter.browserJournalActive()).toBe(false);
});

it.each([
  "DROP TABLE gateway_funding_observations",
  "DROP TRIGGER funding_terminal_observer_required",
  "CREATE INDEX unreviewed_source_index ON sources(name)",
])("refuses a partial or unreviewed installed profile without repair: %s", async sql => {
  const f = await fixture("testnet-real", true);
  const raw = new DatabaseSync(f.file);
  try { raw.exec(sql); } finally { raw.close(); }
  const before = readFileSync(f.file);
  await expect(f.api.createEnrolledSqliteAdapter()).rejects.toThrow();
  expect(readFileSync(f.file)).toEqual(before);
});

it("bounds schema drift metadata before loading an oversized DDL string", async () => {
  const f = await fixture();
  const adapter = await f.api.createEnrolledSqliteAdapter();
  f.adapters.push(adapter);
  const raw = new DatabaseSync(f.file);
  try { raw.exec(`CREATE INDEX oversized_schema_index ON sources(name) /*${"x".repeat(131073)}*/`); }
  finally { raw.close(); }
  const before = readFileSync(f.file);
  expect(() => adapter.listSources()).toThrow();
  expect(readFileSync(f.file)).toEqual(before);
  await expect(f.api.createEnrolledSqliteAdapter()).rejects.toThrow();
  renameSync(f.file, f.file + ".closed");
  renameSync(f.file + ".closed", f.file);
  expect(readFileSync(f.file)).toEqual(before);
});

it("preserves the same aggregate byte quota on native writes and subsequent readiness", async () => {
  const f = await fixture("testnet-offline");
  const { openVerifiedSqliteStorage } = await import("./storage-identity-connection");
  const owner = openVerifiedSqliteStorage(f.file, f.identity);
  const maximum = 8 * 1024 * 1024;
  const full = "plain:v1:" + "x".repeat(1024 * 1024);
  const remaining = maximum - 7 * Buffer.byteLength(full);
  try {
    owner.db.exec("BEGIN IMMEDIATE");
    for (let i = 0; i < 7; i++)
      owner.db.prepare("INSERT INTO cache_items(source_id,text) VALUES(?,?)").run(`seed-${i}`, full);
    owner.db.exec("COMMIT");
  } finally { owner.close(); }
  const adapter = await f.api.createEnrolledSqliteAdapter();
  f.adapters.push(adapter);
  await adapter.setCached("last", "y".repeat(remaining - Buffer.byteLength("plain:v1:")));
  const raw = new DatabaseSync(f.file);
  try {
    const snapshot = () => raw.prepare("SELECT source_id,length(CAST(text AS BLOB)) AS bytes FROM cache_items ORDER BY source_id").all();
    const before = snapshot();
    expect(before.reduce((sum, row) => sum + Number(row.bytes), 0)).toBe(maximum);
    await expect(adapter.setCached("last", "y".repeat(remaining - 8))).rejects.toThrow();
    expect(snapshot()).toEqual(before);
    const reopened = await f.api.createEnrolledSqliteAdapter();
    f.adapters.push(reopened);
    expect((await reopened.getCached("last"))?.length).toBe(remaining - 9);
  } finally { raw.close(); }
});

it("admits, exposes and canonically acknowledges a real v3 original through the closed factory and native localhost registry", async () => {
  const owner = privateKeyToAccount(generatePrivateKey());
  const signer = privateKeyToAccount(generatePrivateKey());
  const creator = privateKeyToAccount(generatePrivateKey());
  const payout = "0x2222222222222222222222222222222222222222";
  const registry = "0x3333333333333333333333333333333333333333";
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const result = payload.method === "eth_chainId" ? "0x4cef52"
      : payload.method === "eth_call" ? encodeFunctionResult({ abi: REGISTRY_ABI, functionName: "get",
        result: { creator: creator.address, payoutWallet: payout, authors: [], fetchPriceUsdc6: BigInt(1000),
          contentCid: "", tags: "", active: true } })
      : { number: "0x1", hash: `0x${"77".repeat(32)}`, timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}` };
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  vi.stubEnv("KERYX_RPC_URL", `http://127.0.0.1:${port}`);
  vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS", registry);
  try {
    const f = await fixture(); const adapter = await f.api.createEnrolledSqliteAdapter();
    f.adapters.push(adapter);
    const { browserQueryPolicyTypedData } = await import("../payments/browser-query-policy");
    const { browserSigningTypedData, serializeBrowserSigningHeader } = await import("../payments/browser-signing-original");
    const { sourceItemContentVersion } = await import("../sources/source-item-asset");
    const { openVerifiedSqliteStorage } = await import("./storage-identity-connection");
    const privileged = openVerifiedSqliteStorage(f.file, f.identity);
    try { privileged.db.exec("UPDATE browser_signing_v2_control SET active=1,min_original_version=3 WHERE id=1"); }
    finally { privileged.close(); }
    await adapter.activateBrowserJournal(); const epoch = crypto.randomUUID();
    const sessionId = owner.address.toLowerCase();
    await adapter.upsertSessionGrant({ sessionId, sessAddr: signer.address, ownerAddr: owner.address,
      cap: 1, expiry: Date.now() + 120000, txHash: "synthetic", grantEpoch: epoch });
    await adapter.upsertSource({ id: "source", name: "Synthetic source", url: "https://source.example/",
      description: "fixture", walletAddress: payout, fetchPrice: 0.001, tags: [], authors: [],
      createdAt: new Date().toISOString(), active: true, verified: true,
      onchainId: browserSourceRegistryId(creator.address, "https://source.example/") });
    await adapter.addItems([{ id: "item", sourceId: "source", title: "Fixture item", summary: "Preview",
      content: "Synthetic body", link: "https://source.example/item" }]);
    const item = await adapter.getItem("source", "item");
    if (!item) throw new Error("Synthetic item missing");
    const policy: BrowserQueryPolicy = { protocol: "durable-v2", service: "https://keryx.cc",
      owner: owner.address, signer: signer.address, policyId: `0x${"44".repeat(32)}`, grantEpoch: epoch,
      requestNonce: `0x${"55".repeat(32)}`, queryId: crypto.randomUUID(), questionDigest: `0x${"66".repeat(32)}`,
      queryCeilingMicros: "2000", lifetimeCeilingMicros: "4000", jobLimit: 2, expiresAt: Date.now() + 60000 };
    const admitted = await adapter.admitBrowserQueryPolicy({ policy,
      signature: await owner.signTypedData(browserQueryPolicyTypedData(policy)) }, sessionId);
    if (admitted.status !== "admitted") throw new Error("Synthetic query refused");
    const requestId = crypto.randomUUID();
    const input: BrowserSourceOriginalAdmission = { protocol: "durable-v3", queryNamespace: admitted.namespace, queryId: admitted.queryId,
      source: { sourceId: "source", itemId: "item", contentVersion: sourceItemContentVersion(item), offerId: null },
      journal: { sessionId, requestId, queryId: admitted.queryId, grantEpoch: epoch, signer: signer.address,
        network: "eip155:5042002", token: "0x3600000000000000000000000000000000000000",
        gatewayContract: "0x0077777d7eba4688bdef3e311b846f25870a19b9", sourceId: "source", offerId: null,
        payee: payout, amountMicroUsdc: 1000, kind: "fetch",
        requirements: { scheme: "exact", network: "eip155:5042002",
          asset: "0x3600000000000000000000000000000000000000", amount: "1000", payTo: payout,
          maxTimeoutSeconds: 691200, extra: { name: "GatewayWalletBatched", version: "1",
            verifyingContract: "0x0077777d7eba4688bdef3e311b846f25870a19b9" } },
        payment: { kind: "fetch", queryId: admitted.queryId, sourceId: "source", sourceName: "Synthetic source",
          payer: signer.address, payee: payout, amountUsdc: 0.001, network: "eip155:5042002", grantEpoch: epoch,
          itemId: "item", contentVersion: sourceItemContentVersion(item) } } };
    const original = await adapter.admitBrowserSourceSigningOriginal(input); if (original.status !== "admitted") throw new Error("Synthetic original refused");
    expect(await adapter.readExposedBrowserSigningSnapshotForSigner(signer.address, sessionId, requestId)).toBeNull();
    expect(await adapter.exposeBrowserJournal(sessionId, requestId)).toBe(true);
    const header = serializeBrowserSigningHeader(original.original,
      await signer.signTypedData(browserSigningTypedData(original.original)));
    expect(await adapter.signBrowserSigningOriginal(sessionId, requestId, header)).toBe(true);
    expect(await adapter.signBrowserSigningOriginal(sessionId, requestId, header)).toBe(true);
    expect((await adapter.readExposedBrowserSigningSnapshotForSigner(signer.address, sessionId, requestId))?.original).toEqual(original.original);
    expect(await adapter.browserSignerConfirmedSpendMicro(signer.address)).toBe(0);
    const raw = new DatabaseSync(f.file);
    try {
      expect(raw.prepare("SELECT count(*) AS n FROM browser_signing_originals").get()?.n).toBe(1);
      expect(raw.prepare("SELECT spent_micro FROM browser_signing_queries").get()?.spent_micro).toBe(1000);
      expect(() => raw.prepare("UPDATE browser_signing_queries SET spent_micro=0").run()).toThrow();
    } finally { raw.close(); }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
