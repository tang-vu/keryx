import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { getAddress } from "viem";
import { writeSqliteQueryRun } from "./query-run-record";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { canonicalJson } from "../canonical-json";
import type { QueryRun } from "../types";
import type { PublicProfileActor, PublicProfileInput } from "../profiles/public-profile";
import { publicProfilesEnabled } from "../profiles/public-profile";
import { createEnrolledSqlitePublicProfiles, createSqlitePublicProfiles } from "./public-profiles-sqlite";
// Genuine dependencies owned elsewhere. Compose the reviewed factories first;
// these imports are deliberately not mocked, copied, skipped or replaced.
import { createEnrolledSqlitePrivateProfiles } from "./private-profiles-enrolled-sqlite";
import { createEnrolledSqliteProfileIdentities } from "./profile-identities-enrolled-sqlite";
import { createEnrolledSqliteRunPrivacy } from "./run-privacy-sqlite";
import { createEnrolledSqliteRunOwnershipHistory } from "./run-ownership-history-sqlite";
import { createEnrolledSqliteRunClaims } from "./run-claims-sqlite";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installSqliteApplicationSchema } from "./sqlite-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { inspectStorageDeploymentManifest } from "./runtime-storage-config";
import { assertVerifiedSqliteNativeUserDomainPolicy, openVerifiedSqliteStorage } from "./storage-identity-connection";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { assertStorageFences, insertStorageIdentity, installStorageFences, storageFenceStatements, STORAGE_IDENTITY_TABLE } from "./storage-identity-sqlite";
import { PUBLIC_REFERENCE_ARCHIVE_SQL } from "./public-reference-archive";
import { sqliteApplicationSchemaProfile } from "./sqlite-application-schema-profile";

const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
const hash = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const binding = { network: "eip155:5042" as const, origin: "https://native-profile-fixture.example" };
const actor: PublicProfileActor = { wallet: alice, sessionHash: hash(alice), binding };
const input = (runIds: string[] = [], fields: PublicProfileInput["fields"] = ["displayName"], revision = 0): PublicProfileInput =>
  ({ published: true, fields, runIds, revision });
const directories: string[] = [], connections: Array<{ close(): void }> = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const connection of connections.splice(0)) connection.close();
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep) || !directory.includes("keryx-native-public-profiles-")) throw new Error("Unsafe fixture cleanup");
    rmSync(directory, { recursive: true, force: true });
  }
});
const raw = <T>(file: string, operation: (db: DatabaseSync) => T, readOnly = true): T => {
  const db = new DatabaseSync(file, { readOnly });
  try { return operation(db); } finally { db.close(); }
};
const originals = (file: string) => raw(file, db => hash(canonicalJson(
  db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='public_researcher_profiles' ORDER BY name").all()
    .map(row => ({ name: row.name, rows: db.prepare(`SELECT * FROM "${String(row.name).replaceAll('"', '""')}" ORDER BY rowid`).all() }))
)));
const financialOriginals = (file: string) => raw(file, db => hash(canonicalJson(
  ["query_runs", "payment_events", "browser_authorization_intents", "browser_journal_bindings", "browser_retained_grants",
    "browser_signer_capacity", "session_grants", "withdrawals", "a2a_orders", "research_purchase_authorizations", "research_monthly"]
    .map(name => ({ name, rows: db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all() }))
)));
// Observe an actual native result without replacing any dependency or result.
// Resolving here lets the peer act at the next genuine ownership await.
const originalRead = (id: string) => {
  let entered!: () => void;
  const observed = new Promise<void>(done => { entered = done; });
  const queries = new WeakMap<StatementSync, string>(), prepare = DatabaseSync.prototype.prepare, get = StatementSync.prototype.get, all = StatementSync.prototype.all;
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, sql) {
    const statement = prepare.call(this, sql); queries.set(statement, sql); return statement;
  });
  vi.spyOn(StatementSync.prototype, "get").mockImplementation(function (this: StatementSync, ...args) {
    const result = Reflect.apply(get, this, args);
    if (queries.get(this) === "SELECT data,asker FROM query_runs WHERE id=?" && typeof args[0] === "string" && args[0] === id) entered();
    return result;
  });
  vi.spyOn(StatementSync.prototype, "all").mockImplementation(function (this: StatementSync, ...args) {
    const result = Reflect.apply(all, this, args);
    if (queries.get(this) === "SELECT id,data,asker FROM query_runs WHERE id IN (SELECT value FROM json_each(?)) LIMIT 50"
      && result.some(row => row.id === id)) entered();
    return result;
  });
  return observed;
};

function fixture(options: { archive?: boolean; before?: boolean; malformed?: "partial" | "session" | "publication";
  ledger?: "guards" | "invalid" | "overflow"; foreignAuthority?: boolean; bulk?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "keryx-native-public-profiles-")); directories.push(directory);
  const file = join(directory, "native.sqlite"), manifest = join(directory, "deployment.json");
  const identity: StorageIdentity = options.foreignAuthority ? syntheticStorageIdentity("testnet-real")
    : { ...syntheticStorageIdentity("mainnet-real"), format: "keryx-mainnet-storage-identity-v1",
      authorityMode: "mainnet-real", network: binding.network, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  const db = new DatabaseSync(file), now = Date.now();
  const run = (id: string, wallet: string | null = alice, extra: Partial<QueryRun> = {}): QueryRun => ({
    id, question: `Question ${id}`, createdAt: new Date(now - 1000).toISOString(), answer: "PRIVATE answer",
    subClaims: ["PRIVATE claim"], citations: [], decisions: [], trace: [], engine: "heuristic", budget: 1,
    totalSpent: 0, totalToCreators: 0, origin: "web", ...(wallet ? { asker: wallet } : {}), ...extra,
  });
  const saveRaw = (id: string, wallet: string | null = alice, extra: Partial<QueryRun> = {}) => {
    const value = run(id, wallet, extra);
    db.prepare("INSERT INTO query_runs(id,created_at,question,answer,asker,origin,data) VALUES(?,?,?,?,?,?,?)")
      .run(id, value.createdAt, value.question, value.answer, wallet, "web", JSON.stringify(value));
  };
  try {
    db.exec("BEGIN");
    if (options.foreignAuthority) installSqliteApplicationSchema(db, { publicReferenceArchive: options.archive ?? false });
    else installMainnetApplicationSchema(db, { publicReferenceArchive: options.archive ?? false });
    saveRaw("historical"); // Pre-bundle historical missing sidecar stays unlisted.
    if (!options.before && !options.foreignAuthority) installNativeUserDomainSchema(db);
    for (const wallet of [alice, bob]) db.prepare("INSERT INTO web_sessions(hash,wallet,issued_at,expires_at) VALUES(?,?,?,?)")
      .run(hash(wallet), wallet, now - 60_000, now + 3_600_000);
    if (!options.before && !options.foreignAuthority) {
      for (const [id, wallet] of [["public", alice], ["private", alice], ["unlisted", alice], ["foreign", bob], ["anonymous", null]] as const) saveRaw(id, wallet);
      saveRaw("reader", alice, { paymentMode: "real", fundingOwner: "browser" });
      saveRaw("sponsored", alice, { paymentMode: "real", fundingOwner: "treasury" });
      const payment = (id: string, query: string, amount: number | string | null, status = "settled", settled = 1,
        tx: string | null = "synthetic-fixture-receipt", kind = "citation", payer = alice, payee = bob, network = binding.network as string) =>
        db.prepare("INSERT INTO payment_events(id,query_id,kind,payer,payee,network,amount_usdc,settled,settlement_status,tx_hash) VALUES(?,?,?,?,?,?,?,?,?,?)")
          .run(id, query, kind, payer, payee, network, amount, settled, status, tx);
      payment("micro", "reader", 0.000001); payment("six-decimals", "reader", 1000.000001);
      payment("pending", "reader", 99, "pending", 0); payment("proofless", "reader", 99, "settled", 1, null);
      payment("fee", "reader", 99, "settled", 1, "synthetic-fee", "operating-fee"); payment("treasury", "sponsored", 0.5);
      if (options.ledger === "guards") {
        saveRaw("simulation", alice, { paymentMode: "offline", fundingOwner: "browser" });
        saveRaw("offline-funded", alice, { paymentMode: "real", fundingOwner: "offline" });
        payment("simulation", "simulation", 99); payment("offline-funded", "offline-funded", 99);
        payment("settled-bit-missing", "reader", 99, "settled", 0);
        payment("pending-with-bit", "reader", 99, "pending", 1); payment("simulated-with-bit", "reader", 99, "simulated", 1);
        payment("empty-proof", "reader", 99, "settled", 1, ""); payment("blank-proof", "reader", 99, "settled", 1, "   ");
        payment("zero", "reader", 0); payment("negative", "reader", -1); payment("missing-amount", "reader", null);
        payment("unknown-kind", "reader", 99, "settled", 1, "synthetic-proof", "unknown");
        payment("unknown-network", "reader", 99, "settled", 1, "synthetic-proof", "fetch", alice, bob, "eip155:1");
        payment("foreign-wallet", "foreign", 99, "settled", 1, "synthetic-proof", "fetch", bob, bob);
        payment("creator-mainnet", "reader", 0.000002, "settled", 1, "synthetic-proof", "fetch", bob, alice);
        payment("creator-testnet", "reader", 0.000003, "settled", 1, "synthetic-proof", "citation", bob, alice, "eip155:5042002");
      }
      if (options.ledger === "invalid") {
        payment("invalid-fraction", "reader", 0.0000001);
        payment("after-invalid", "reader", 0.000001);
      }
      if (options.ledger === "overflow") {
        payment("large-a", "reader", 9_000_000_000_000);
        payment("large-b", "reader", 9_000_000_000_000);
      }
      if (options.bulk) for (let index = 0; index < 50; index++) {
        const id = `bulk-${String(index).padStart(2, "0")}`; saveRaw(id);
        db.prepare("UPDATE run_privacy SET visibility='public' WHERE run_id=?").run(id);
      }
    }
    if (options.malformed === "partial") db.exec("DROP TABLE public_researcher_profiles");
    if (options.malformed === "session") db.exec("DROP INDEX web_sessions_wallet");
    if (options.malformed === "publication") db.exec("CREATE TRIGGER unknown_publication AFTER UPDATE ON public_researcher_profiles BEGIN SELECT 1; END");
    insertStorageIdentity(db, identity); installStorageFences(db, identity); db.exec("COMMIT");
  } finally { db.close(); }
  writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } }));
  const pinned = canonicalJson(inspectStorageDeploymentManifest({ KERYX_STORAGE_MANIFEST: manifest }));
  const state = { guards: 0, drift: false };
  const open = (readOnly = false, fullGuard = true) => {
    const connection = openVerifiedSqliteStorage(file, identity, { readOnly,
      ...(fullGuard ? { applicationProfiles: supportedSqliteApplicationProfiles(!options.foreignAuthority) } : {}),
      runtimeGuard() {
        state.guards++;
        if (state.drift || canonicalJson(inspectStorageDeploymentManifest({ KERYX_STORAGE_MANIFEST: manifest })) !== pinned) throw new Error("Manifest drift");
      } });
    connections.push(connection); return connection;
  };
  return { directory, file, manifest, identity, open, state };
}
async function saved(options: Parameters<typeof fixture>[0] = {}) {
  const f = fixture(options), connection = f.open();
  const profiles = createEnrolledSqlitePrivateProfiles(connection.db)!, identities = createEnrolledSqliteProfileIdentities(connection.db)!;
  const privacy = createEnrolledSqliteRunPrivacy(connection.db), history = createEnrolledSqliteRunOwnershipHistory(connection.db);
  const port = createEnrolledSqlitePublicProfiles(connection.db)!;
  const record = { handle: "alice", displayName: "Alice", bio: "PRIVATE bio", purpose: "PRIVATE purpose", links: [{ kind: "website" as const, url: "https://example.org/unverified" }] };
  await profiles.update(alice, record); await profiles.update(bob, { ...record, handle: "bobby", displayName: "Bob" });
  const change = (id: string, visibility: "private" | "public" | "unlisted", revision = 0, wallet = alice) =>
    privacy.change(id, { ...actor, wallet, sessionHash: hash(wallet) }, { visibility, revision, requestId: randomUUID() });
  const verify = async () => {
    const challenge = { wallet: alice, provider: "github" as const, stateHash: hash(randomUUID()), sessionHash: actor.sessionHash,
      expiresAt: new Date(Date.now() + 600_000).toISOString() };
    await identities.begin(challenge); await identities.consume(challenge);
    return identities.complete(challenge, { provider: "github", externalId: "12345", label: "Alice" });
  };
  return { ...f, connection, profiles, identities, privacy, history, port, record, change, verify };
}

// Only disposable fixture configuration, installed before importing the selected
// application boundary. No runtime flag toggle, provider call or proof replacement.
async function selectedFacade(f: ReturnType<typeof fixture>, privacyActive = true, publicActive = true) {
  vi.resetModules();
  const registry = `0x${"12".repeat(20)}`;
  for (const [key, value] of Object.entries({
    KERYX_NETWORK: "arc", NEXT_PUBLIC_KERYX_NETWORK: "arc", KERYX_FORCE_OFFLINE: "0",
    KERYX_USDC_ADDRESS: "0x3600000000000000000000000000000000000000",
    KERYX_GATEWAY_WALLET: "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE",
    KERYX_GATEWAY_MINTER: "0x2222222d7164433c4C09B0b0D809a9b52C04C205",
    KERYX_REGISTRY_ADDRESS: registry, NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS: registry,
    KERYX_REGISTRY_READ_ADDRESS: registry, NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS: registry,
    KERYX_MAX_TIMEOUT_SECONDS: "691200", KERYX_STORAGE_MANIFEST: f.manifest, KERYX_SQLITE_PATH: f.file,
    CONTENT_MASTER_KEY: "11".repeat(32), KERYX_RUN_PRIVACY_ENABLED: String(privacyActive),
    KERYX_PUBLIC_PROFILES_ENABLED: String(publicActive), KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED: "false",
  })) vi.stubEnv(key, value);
  const application = await import("./application-storage"), api = await import("./enrolled-sqlite-adapter");
  const writer = await application.createApplicationStorage();
  if (!writer || !("close" in writer) || typeof writer.close !== "function") throw new Error("Selected native writer required");
  const closeWriter = writer.close;
  connections.push({ close: () => { closeWriter(); } });
  const reader = await application.createReadonlyApplicationStorage();
  if (!reader) throw new Error("Selected native reader required");
  let readerClosed = false;
  const closeReader = () => { if (!readerClosed) { application.closeReadonlyApplicationStorage(reader); readerClosed = true; } };
  connections.push({ close: closeReader });
  return { writer, reader, closeReader, api, application };
}

describe("#264 actual selected application publicProfiles facade (authored; UNRUN)", () => {
  it.each([false, true])("BEFORE stays absent on both selected facades without activation or migration (archive=%s)", async archive => {
    const f = fixture({ before: true, archive }), bytes = hash(readFileSync(f.file)), before = originals(f.file);
    const selected = await selectedFacade(f, false, true);
    for (const db of [selected.writer, selected.reader]) {
      expect(Object.isFrozen(db)).toBe(true); expect(db.runPrivacyActive).toBe(false);
      expect(db.publicProfiles).toBeUndefined(); expect(Object.hasOwn(db, "publicProfiles")).toBe(false);
      expect(selected.application.applicationSqliteIdentity(db)).toEqual(f.identity);
      expect((await db.getQueryRun("historical"))?.id).toBe("historical");
    }
    expect(hash(readFileSync(f.file))).toBe(bytes); expect(originals(f.file)).toBe(before);
  });

  it.each([[false, true], [true, false]])("Full19 with captured privacy=%s/public=%s leaves publication absent", async (privacyActive, publicActive) => {
    const f = fixture(), bytes = hash(readFileSync(f.file)), before = originals(f.file);
    const selected = await selectedFacade(f, privacyActive, publicActive);
    for (const db of [selected.writer, selected.reader]) {
      expect(db.runPrivacyActive).toBe(privacyActive);
      expect(db.publicProfiles).toBeUndefined(); expect(Object.hasOwn(db, "publicProfiles")).toBe(false);
      await db.init(); expect(db.publicProfiles).toBeUndefined();
      expect(selected.api.assertEnrolledSqliteAdapter(db)).toEqual(f.identity);
    }
    expect(hash(readFileSync(f.file))).toBe(bytes); expect(originals(f.file)).toBe(before);
  });

  describe.each([false, true])("Full19 attaches hidden frozen ports on the selected store and preserves public-only owner/revision projection (archive=%s)", archive => {
    let f: Awaited<ReturnType<typeof saved>>;
    let before: string, financial: string, selected: Awaited<ReturnType<typeof selectedFacade>>;
    // Independent real fixture setup and selected application construction retain
    // the canonical hook deadline. The complete assertion journey stays one test.
    beforeEach(async () => {
      f = await saved({ archive }); await f.change("public", "public"); await f.change("unlisted", "unlisted");
      await f.change("foreign", "public", 0, bob); await f.verify();
    });
    beforeEach(async () => {
      before = originals(f.file); financial = financialOriginals(f.file); selected = await selectedFacade(f);
    });
    it("preserves the complete public-only owner and revision journey", async () => {
    for (const db of [selected.writer, selected.reader]) {
      expect(Object.isFrozen(db)).toBe(true); expect(db.runPrivacyActive).toBe(true);
      expect(Object.getOwnPropertyDescriptor(db, "publicProfiles")).toEqual({
        value: db.publicProfiles, writable: false, enumerable: false, configurable: false,
      });
      expect(Object.keys(db)).not.toContain("publicProfiles"); expect(Object.isFrozen(db.publicProfiles)).toBe(true);
      expect(Object.keys(db.publicProfiles!).sort()).toEqual(["read", "settings", "sitemap", "unpublish", "update"]);
      expect(selected.application.applicationSqliteIdentity(db)).toEqual(f.identity);
      expect(Reflect.get(db, "db")).toBeUndefined(); expect(Reflect.get(db, "assembleConnectionCore")).toBeUndefined();
      expect(await db.publicProfiles!.read("alice")).toBeNull(); expect(await db.publicProfiles!.sitemap(1000)).toEqual([]);
      expect(await db.publicProfiles!.settings(actor)).toMatchObject({ published: false, revision: 0 });
    }
    const port = selected.writer.publicProfiles!;
    await expect(port.update({ ...actor, wallet: bob }, input())).rejects.toMatchObject({ code: "unauthenticated" });
    for (const id of ["foreign", "anonymous", "absent"]) await expect(port.update(actor, input([id]))).rejects.toMatchObject({ code: "not_owned" });
    expect(await selected.reader.publicProfiles!.settings({ ...actor, wallet: bob, sessionHash: hash(bob) }))
      .toMatchObject({ handle: "bobby", published: false, revision: 0 });
    const published = await port.update(actor, input(["public", "private", "unlisted", "historical"], ["displayName", "verifiedLinks", "ledgers"]));
    expect(published).toMatchObject({ published: true, revision: 1 });
    await expect(port.update(actor, input())).rejects.toMatchObject({ code: "conflict" });
    const result = (await selected.reader.publicProfiles!.read("alice"))!;
    expect(result.runs.map(run => run.id)).toEqual(["public"]); expect(result.displayName).toBe("Alice");
    expect(result.about).toBeUndefined(); expect(result.purpose).toBeUndefined();
    expect(result.verifiedLinks).toHaveLength(1); expect(result.verifiedLinks?.[0]).toMatchObject({ provider: "github", label: "Alice" });
    expect(result.ledgers?.[0]).toMatchObject({ readerPaidMicros: "1000000002", sponsoredCreatorPaymentsMicros: "500000" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE"); expect(JSON.stringify(result)).not.toContain(alice);
    expect(JSON.stringify(result)).not.toContain(actor.sessionHash); expect(JSON.stringify(result)).not.toContain("unverified");
    expect(await f.port.read("alice")).toEqual(result); // Genuine peer sees the same publication, never a second catalog.
    expect((await selected.reader.publicProfiles!.settings(actor)).revision).toBe(1);
    expect(originals(f.file)).toBe(before); expect(financialOriginals(f.file)).toBe(financial);
    await f.identities.unlink(alice, "github"); const afterUnlink = originals(f.file);
    expect((await selected.reader.publicProfiles!.read("alice"))?.verifiedLinks).toEqual([]);
    expect(originals(f.file)).toBe(afterUnlink);
    await port.unpublish(actor); const afterWithdrawal = originals(f.file);
    expect(await selected.reader.publicProfiles!.read("alice")).toBeNull(); expect(await f.port.read("alice")).toBeNull();
    expect(await selected.reader.publicProfiles!.sitemap(1000)).toEqual([]);
    await expect(port.update(actor, input([], ["displayName"], 1))).rejects.toMatchObject({ code: "conflict" });
    expect((await port.settings(actor)).revision).toBe(2); expect(originals(f.file)).toBe(afterWithdrawal);
    expect(financialOriginals(f.file)).toBe(financial);
    });
  });

  it("selected readonly genuine ports refuse mutations before SQL and retain healthy publication/owner readers through visibility and erasure", async () => {
    const f = await saved(); await f.change("public", "public"); await f.change("reader", "public");
    await f.port.update(actor, input(["public", "reader", "private"], ["displayName", "ledgers"]));
    const selected = await selectedFacade(f), reader = selected.reader, before = originals(f.file), financial = financialOriginals(f.file);
    const bytes = hash(readFileSync(f.file)), prepare = vi.spyOn(DatabaseSync.prototype, "prepare"), exec = vi.spyOn(DatabaseSync.prototype, "exec");
    await expect(reader.publicProfiles!.update(actor, input([], ["ledgers"], 1))).rejects.toMatchObject({ code: "public_profile_unavailable" });
    await expect(reader.publicProfiles!.unpublish(actor)).rejects.toMatchObject({ code: "public_profile_unavailable" });
    await expect(reader.runPrivacy!.change("public", actor, { visibility: "private", revision: 1, requestId: randomUUID() }))
      .rejects.toMatchObject({ code: "privacy_unavailable" });
    await expect(reader.runPrivacy!.erase("public", actor, { revision: 1, requestId: randomUUID() }))
      .rejects.toMatchObject({ code: "privacy_unavailable" });
    expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled(); prepare.mockRestore(); exec.mockRestore();
    expect(hash(readFileSync(f.file))).toBe(bytes); expect(originals(f.file)).toBe(before); expect(financialOriginals(f.file)).toBe(financial);
    expect(selected.api.assertEnrolledSqliteAdapter(reader)).toEqual(f.identity);
    expect(() => selected.api.assertEnrolledSqliteAdapter(reader, "write")).toThrow();
    expect((await reader.runOwnershipHistory!.read(alice, binding, "public"))?.run.id).toBe("public");
    expect((await reader.runPrivacy!.read("private", actor)).item?.run.id).toBe("private");
    expect(new Set((await reader.publicProfiles!.read("alice"))?.runs.map(run => run.id))).toEqual(new Set(["public", "reader"]));
    await f.change("public", "private", 1); const afterVisibility = originals(f.file);
    expect((await reader.publicProfiles!.read("alice"))?.runs.map(run => run.id)).toEqual(["reader"]);
    expect(originals(f.file)).toBe(afterVisibility); expect(financialOriginals(f.file)).toBe(financial);
    const payments = raw(f.file, db => db.prepare("SELECT * FROM payment_events ORDER BY id").all());
    await f.privacy.erase("reader", actor, { revision: 1, requestId: randomUUID() }); const afterErase = originals(f.file);
    expect((await reader.publicProfiles!.read("alice"))?.runs).toEqual([]);
    expect((await reader.runPrivacy!.read("reader", actor)).item).toBeNull();
    expect((await reader.runPrivacy!.settlement("reader"))?.totalSpent).toBe(0);
    expect(originals(f.file)).toBe(afterErase);
    expect(raw(f.file, db => db.prepare("SELECT * FROM payment_events ORDER BY id").all())).toEqual(payments);
    expect(selected.application.applicationSqliteIdentity(reader)).toEqual(f.identity);
  });

  it.each(["unpublish", "selection", "profile"] as const)("selected facade retains strict null after genuine synchronous %s at the final native yield", async mutation => {
    const f = await saved(); await f.change("public", "public");
    await f.port.update(actor, input(["public"], ["displayName", "about", "purpose", "ledgers"]));
    const selected = await selectedFacade(f), port = selected.reader.publicProfiles!;
    expect((await port.read("alice"))?.runs.map(run => run.id)).toEqual(["public"]);
    const before = originals(f.file), financial = financialOriginals(f.file), pending = port.read("alice");
    let withdrawal: Promise<void> | undefined;
    if (mutation === "unpublish") withdrawal = f.port.unpublish(actor);
    if (mutation === "selection") f.connection.db.prepare("UPDATE public_researcher_profiles SET fields='[]',run_ids='[]',revision=revision+1 WHERE wallet=?").run(alice);
    if (mutation === "profile") f.connection.db.prepare("UPDATE private_profiles SET display_name='Changed at selected final yield' WHERE wallet=?").run(alice);
    const afterPeer = originals(f.file); if (withdrawal) await withdrawal;
    expect(await pending).toBeNull(); expect(originals(f.file)).toBe(afterPeer); expect(financialOriginals(f.file)).toBe(financial);
    if (mutation !== "profile") expect(afterPeer).toBe(before);
  });

  it("selected facade uses genuine immutable claims and suppresses changed ownership originals after its native await", async () => {
    const f = await saved(), claims = createEnrolledSqliteRunClaims(f.connection.db);
    const run = JSON.parse(String(f.connection.db.prepare("SELECT data FROM query_runs WHERE id='anonymous'").get()!.data)) as QueryRun;
    await claims.issue({ runId: run.id, completedAt: run.createdAt, binding, tokenHash: hash("selected-isolated-claim") });
    await claims.claim({ ...actor, tokenHash: hash("selected-isolated-claim") });
    const selected = await selectedFacade(f), port = selected.writer.publicProfiles!, before = originals(f.file), financial = financialOriginals(f.file);
    await port.update(actor, input([run.id])); expect((await selected.reader.publicProfiles!.read("alice"))?.runs).toEqual([]);
    expect(originals(f.file)).toBe(before); expect(financialOriginals(f.file)).toBe(financial);
    await f.change(run.id, "public"); const afterVisibility = originals(f.file);
    const result = (await selected.reader.publicProfiles!.read("alice"))!;
    expect(result.runs[0]).toMatchObject({ id: run.id, ownership: "claimed", funding: "unknown" });
    expect(JSON.stringify(result)).not.toContain(hash("selected-isolated-claim")); expect(JSON.stringify(result)).not.toContain(alice);
    expect(originals(f.file)).toBe(afterVisibility); expect(financialOriginals(f.file)).toBe(financial);
    const pending = selected.reader.publicProfiles!.read("alice");
    f.connection.db.prepare("UPDATE query_runs SET data=? WHERE id=?").run(JSON.stringify({ ...run, question: "Changed claimed original" }), run.id);
    const afterPeer = originals(f.file); expect((await pending)?.runs).toEqual([]); expect(originals(f.file)).toBe(afterPeer);
  });

  it("selected facade suppresses withdrawn verified identity after a genuine identity await", async () => {
    const f = await saved(); await f.verify(); await f.port.update(actor, input([], ["displayName", "verifiedLinks"]));
    const selected = await selectedFacade(f), financial = financialOriginals(f.file), pending = selected.reader.publicProfiles!.read("alice");
    await f.identities.unlink(alice, "github"); const afterPeer = originals(f.file);
    expect(await pending).toBeNull(); expect(originals(f.file)).toBe(afterPeer); expect(financialOriginals(f.file)).toBe(financial);
    expect((await selected.reader.publicProfiles!.read("alice"))?.verifiedLinks).toEqual([]);
  });

  it.each(["manifest", "schema", "fence", "digest", "closed"] as const)("selected %s provenance refusal remains permanent after restoration", async drift => {
    const f = await saved(); await f.port.update(actor, input()); const selected = await selectedFacade(f), port = selected.reader.publicProfiles!;
    const manifest = readFileSync(f.manifest), before = originals(f.file), financial = financialOriginals(f.file);
    const fence = raw(f.file, db => Object.keys(storageFenceStatements(db, f.identity)).find(name => name.startsWith("storage_fence_") && name.endsWith("_update"))!);
    const fenceSql = raw(f.file, db => String(db.prepare("SELECT sql FROM sqlite_schema WHERE name=?").get(fence)!.sql));
    if (drift === "manifest") writeFileSync(f.manifest, "{}");
    if (drift === "digest") {
      const changed = JSON.parse(manifest.toString("utf8")); changed.identity.profileDigest = "00".repeat(32);
      writeFileSync(f.manifest, canonicalJson(changed));
    }
    if (drift === "schema") raw(f.file, db => db.exec("CREATE INDEX unexpected_selected_public_index ON public_researcher_profiles(handle)"), false);
    if (drift === "fence") raw(f.file, db => db.exec(`DROP TRIGGER "${fence}"`), false);
    if (drift === "closed") selected.closeReader();
    await expect(port.read("alice")).rejects.toMatchObject({ code: "public_profile_unavailable" });
    writeFileSync(f.manifest, manifest);
    if (drift === "schema") raw(f.file, db => db.exec("DROP INDEX unexpected_selected_public_index"), false);
    if (drift === "fence") raw(f.file, db => db.exec(fenceSql), false);
    await expect(port.sitemap(1000)).rejects.toMatchObject({ code: "public_profile_unavailable" });
    await expect(port.read("alice")).rejects.toMatchObject({ code: "public_profile_unavailable" });
    expect(() => selected.api.assertEnrolledSqliteAdapter(selected.reader)).toThrow();
    expect(originals(f.file)).toBe(before); expect(financialOriginals(f.file)).toBe(financial);
  });

  it("selected held-file EBUSY prevents replacement with unchanged bytes; successful replacement permanently refuses", async () => {
    const f = await saved(); await f.port.update(actor, input()); const selected = await selectedFacade(f), port = selected.reader.publicProfiles!;
    const before = originals(f.file), bytes = hash(readFileSync(f.file)), replacement = join(f.directory, "selected-replacement.sqlite"), retained = join(f.directory, "selected-retained.sqlite");
    copyFileSync(f.file, replacement);
    try { renameSync(f.file, retained); }
    catch (error) {
      if (process.platform !== "win32") throw error;
      expect(error).toMatchObject({ code: "EBUSY" }); expect(hash(readFileSync(f.file))).toBe(bytes);
      expect(selected.application.applicationSqliteIdentity(selected.reader)).toEqual(f.identity);
      expect((await port.read("alice"))?.displayName).toBe("Alice"); expect(originals(f.file)).toBe(before); return;
    }
    renameSync(replacement, f.file);
    await expect(port.read("alice")).rejects.toMatchObject({ code: "public_profile_unavailable" });
    renameSync(f.file, replacement); renameSync(retained, f.file);
    await expect(port.sitemap(1000)).rejects.toMatchObject({ code: "public_profile_unavailable" });
    expect(() => selected.application.applicationSqliteIdentity(selected.reader)).toThrow();
    expect(originals(f.file)).toBe(before);
  });
});

describe("#264 genuine Full19 native publication (dependency composition required; no execution claim)", () => {
  it.each([false, true])("exact BEFORE absence and Full19 no-profile/no-publication do not install or activate (archive=%s)", async archive => {
    const before = fixture({ before: true, archive }), connection = before.open(), bytes = hash(readFileSync(before.file));
    // BEFORE is absent before any internal user-domain dependency is composed.
    expect(createEnrolledSqlitePublicProfiles(connection.db)).toBeUndefined();
    expect(() => assertVerifiedSqliteNativeUserDomainPolicy(connection.db)).toThrow();
    expect(hash(readFileSync(before.file))).toBe(bytes);
    expect(connection.db.prepare("SELECT 1 FROM query_runs WHERE id='historical'").get()).toBeDefined();
    const f = fixture({ archive }), native = f.open();
    expect(() => assertVerifiedSqliteNativeUserDomainPolicy(native.db)).not.toThrow();
    const original = originals(f.file), port = createEnrolledSqlitePublicProfiles(native.db)!;
    expect(Object.isFrozen(port)).toBe(true); expect(Object.keys(port).sort()).toEqual(["read", "settings", "sitemap", "unpublish", "update"]);
    expect(await port.settings(actor)).toMatchObject({ handle: "", published: false, revision: 0 });
    expect(await port.read("alice")).toBeNull(); expect(await port.read("unknown_handle")).toBeNull(); expect(await port.sitemap(1000)).toEqual([]);
    await expect(port.update(actor, input())).rejects.toMatchObject({ code: "profile_required" });
    await expect(port.unpublish(actor)).rejects.toMatchObject({ code: "profile_required" });
    expect(originals(f.file)).toBe(original); expect(publicProfilesEnabled({})).toBe(false);
    expect(publicProfilesEnabled({ KERYX_PUBLIC_PROFILES_ENABLED: "true" })).toBe(false);
    expect(publicProfilesEnabled({ KERYX_PUBLIC_PROFILES_ENABLED: "true", KERYX_RUN_PRIVACY_ENABLED: "true" })).toBe(true);
  });

  it.each(["partial", "session", "publication"] as const)("refuses %s even through a native opening without a full-profile option", malformed => {
    const f = fixture({ malformed }), connection = f.open(false, false), bytes = hash(readFileSync(f.file));
    expect(() => createEnrolledSqlitePublicProfiles(connection.db)).toThrow("public_profile_unavailable");
    expect(hash(readFileSync(f.file))).toBe(bytes);
    expect(() => connection.db.prepare("SELECT 1").get()).toThrow();
  });

  it("cannot qualify raw storage, an unsealed Full19 opening, or an ordinary constructor on native", async () => {
    const f = fixture(), rawDb = new DatabaseSync(f.file);
    try { expect(() => createEnrolledSqlitePublicProfiles(rawDb)).toThrow("public_profile_unavailable"); }
    finally { rawDb.close(); }
    const unsealed = f.open(false, false);
    expect(() => createEnrolledSqlitePublicProfiles(unsealed.db)).toThrow("public_profile_unavailable");
    const savedFixture = await saved(), before = originals(savedFixture.file);
    expect(() => createSqlitePublicProfiles(savedFixture.connection.db, savedFixture.privacy, savedFixture.identities, savedFixture.history)).toThrow("public_profile_unavailable");
    expect(originals(savedFixture.file)).toBe(before); expect(await savedFixture.port.read("alice")).toBeNull();
  });

  it("foreign authority and closed openings refuse the ledger policy and publication reads/selections", async () => {
    const foreign = fixture({ foreignAuthority: true }), bytes = hash(readFileSync(foreign.file));
    const aggregate = vi.spyOn(DatabaseSync.prototype, "aggregate"), connection = foreign.open();
    expect(aggregate).not.toHaveBeenCalled(); aggregate.mockRestore();
    expect(() => assertVerifiedSqliteNativeUserDomainPolicy(connection.db)).toThrow();
    expect(() => createEnrolledSqlitePublicProfiles(connection.db)).toThrow("public_profile_unavailable");
    expect(hash(readFileSync(foreign.file))).toBe(bytes);
    const f = await saved(); await f.port.update(actor, input([], ["ledgers"])); f.connection.close();
    const prepare = vi.spyOn(DatabaseSync.prototype, "prepare"), exec = vi.spyOn(DatabaseSync.prototype, "exec");
    expect(() => assertVerifiedSqliteNativeUserDomainPolicy(f.connection.db)).toThrow();
    expect(() => createEnrolledSqlitePublicProfiles(f.connection.db)).toThrow("public_profile_unavailable");
    await expect(f.port.read("alice")).rejects.toMatchObject({ code: "public_profile_unavailable" });
    await expect(f.port.update(actor, input([], ["ledgers"], 1))).rejects.toMatchObject({ code: "public_profile_unavailable" });
    expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
  });

  it("only explicitly selected fields and current owned PUBLIC runs leave the port; originals and custody hashes stay exact", async () => {
    const f = await saved(); await f.change("public", "public"); await f.change("unlisted", "unlisted"); await f.change("foreign", "public", 0, bob);
    expect(await f.port.read("alice")).toBeNull(); const before = originals(f.file), financial = financialOriginals(f.file);
    await f.port.update(actor, input(["public", "private", "unlisted", "historical"]));
    const result = (await f.port.read("alice"))!;
    expect(result.displayName).toBe("Alice"); expect(result.runs.map(run => run.id)).toEqual(["public"]);
    expect(result.about).toBeUndefined(); expect(result.purpose).toBeUndefined(); expect(result.verifiedLinks).toBeUndefined(); expect(result.ledgers).toBeUndefined();
    expect(result.runs[0]).toMatchObject({ reportPath: "/dispatch/public", receiptsPath: "/api/dispatch/public/receipt" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE"); expect(JSON.stringify(result)).not.toContain(alice); expect(JSON.stringify(result)).not.toContain("unverified");
    expect((await f.port.sitemap(1000)).map(row => row.handle)).toEqual(["alice"]);
    expect(originals(f.file)).toBe(before); expect(financialOriginals(f.file)).toBe(financial);
    for (const id of ["foreign", "anonymous", "absent"]) await expect(f.port.update(actor, input([id], ["displayName"], 1))).rejects.toMatchObject({ code: "not_owned" });
    expect(originals(f.file)).toBe(before);
    await f.port.unpublish(actor); expect(await f.port.read("alice")).toBeNull(); expect(await f.port.sitemap(1000)).toEqual([]);
    await expect(f.port.update(actor, input([], ["displayName"], 1))).rejects.toMatchObject({ code: "conflict" });
    expect((await f.port.settings(actor)).revision).toBe(2); expect(financialOriginals(f.file)).toBe(financial);
  });

  describe("full fifty-run native publication journey", () => {
    let f: Awaited<ReturnType<typeof saved>>;
    beforeEach(async () => { f = await saved({ bulk: true }); });
  it("keeps the full 50-run cap, strict input, owner/session checks and erasure filtering without changing originals", async () => {
    const ids = Array.from({ length: 50 }, (_, index) => `bulk-${String(index).padStart(2, "0")}`);
    const original = originals(f.file), financial = financialOriginals(f.file);
    const payments = raw(f.file, db => db.prepare("SELECT * FROM payment_events ORDER BY id").all());
    for (const invalid of [input([...ids, "private"]), input(["public", "public"]), input([], ["ledgers", "ledgers"]),
      { ...input(), extraAuthority: true }, { ...input(), revision: 2147483647 }]) {
      await expect(f.port.update(actor, invalid)).rejects.toThrow();
    }
    await expect(f.port.update({ ...actor, wallet: bob }, input(ids))).rejects.toMatchObject({ code: "unauthenticated" });
    expect(originals(f.file)).toBe(original); expect(await f.port.read("alice")).toBeNull();
    await f.port.update(actor, input(ids, ["displayName", "verifiedLinks", "ledgers"]));
    const published = (await f.port.read("alice"))!;
    expect(published.runs).toHaveLength(50); expect(new Set(published.runs.map(run => run.id))).toEqual(new Set(ids));
    expect(published.verifiedLinks).toEqual([]); expect(JSON.stringify(published)).not.toContain("PRIVATE");
    expect(originals(f.file)).toBe(original); expect(financialOriginals(f.file)).toBe(financial);
    await f.privacy.erase(ids[0], actor, { revision: 0, requestId: randomUUID() });
    const afterErase = originals(f.file); const result = (await f.port.read("alice"))!;
    expect(result.runs).toHaveLength(49); expect(result.runs.some(run => run.id === ids[0])).toBe(false);
    expect(originals(f.file)).toBe(afterErase);
    expect(raw(f.file, db => db.prepare("SELECT * FROM payment_events ORDER BY id").all())).toEqual(payments);
  });
  });

  it("revision0 tombstone survives reconstruction and rejects a pending first publication", async () => {
    const f = await saved(), before = originals(f.file);
    const pending = f.port.update(actor, input(["private"], ["about", "purpose"]));
    await f.port.unpublish(actor); await expect(pending).rejects.toMatchObject({ code: "conflict" });
    const rebuilt = createEnrolledSqlitePublicProfiles(f.connection.db)!;
    expect(await rebuilt.settings(actor)).toMatchObject({ published: false, revision: 1, fields: [], runIds: [] });
    expect(await rebuilt.read("alice")).toBeNull(); expect(await rebuilt.sitemap(1000)).toEqual([]); expect(originals(f.file)).toBe(before);
  });

  it.each(["expired", "revoked"] as const)("fresh session check after genuine asynchronous ownership refuses %s", async mode => {
    const f = await saved(), before = financialOriginals(f.file);
    const pending = f.port.update(actor, input(["private"]));
    if (mode === "expired") f.connection.db.prepare("UPDATE web_sessions SET expires_at=? WHERE hash=?").run(Date.now() - 1, actor.sessionHash);
    else f.connection.db.prepare("DELETE FROM web_sessions WHERE hash=?").run(actor.sessionHash);
    await expect(pending).rejects.toMatchObject({ code: "unauthenticated" });
    expect(await f.port.read("alice")).toBeNull(); expect(await f.port.sitemap(1000)).toEqual([]); expect(financialOriginals(f.file)).toBe(before);
  });

  it.each(["uppercase", "checksum"] as const)("native capture preserves genuine recorded %s JSON asker with exact lowercase SQL ownership", async mode => {
    const f = await saved();
    const jsonAsker = mode === "uppercase" ? alice.toUpperCase() : getAddress(alice);
    for (const id of ["public", "private"]) {
      const run = JSON.parse(String(f.connection.db.prepare("SELECT data FROM query_runs WHERE id=?").get(id)!.data)) as QueryRun;
      writeSqliteQueryRun(f.connection.db, { ...run, asker: jsonAsker }, true);
      const stored = f.connection.db.prepare("SELECT data,asker FROM query_runs WHERE id=?").get(id)!;
      expect(stored.asker).toBe(alice); expect(JSON.parse(String(stored.data)).asker).toBe(jsonAsker);
    }
    await f.change("public", "public"); await f.change("private", "public");
    const before = originals(f.file), financial = financialOriginals(f.file);
    // Covers both the first genuine owner await and a subsequent recorded owner.
    await f.port.update(actor, input(["public", "private"]));
    expect((await f.port.read("alice"))?.runs.map(run => run.id).sort()).toEqual(["private", "public"]);
    expect((await f.port.settings(actor)).published).toBe(true);
    expect(() => assertVerifiedSqliteNativeUserDomainPolicy(f.connection.db)).not.toThrow();
    expect(originals(f.file)).toBe(before); expect(financialOriginals(f.file)).toBe(financial);
  });

  it.each([null, undefined])("native capture preserves optional JSON asker %s without lending it SQL owner authority", async jsonAsker => {
    const f = await saved();
    const run = JSON.parse(String(f.connection.db.prepare("SELECT data FROM query_runs WHERE id='public'").get()!.data));
    f.connection.db.prepare("UPDATE query_runs SET data=? WHERE id='public'").run(JSON.stringify({ ...run, asker: jsonAsker }));
    expect(f.connection.db.prepare("SELECT asker FROM query_runs WHERE id='public'").get()?.asker).toBe(alice);
    await f.change("public", "public"); const before = originals(f.file), financial = financialOriginals(f.file);
    await f.port.update(actor, input(["public"])); expect((await f.port.read("alice"))?.runs.map(item => item.id)).toEqual(["public"]);
    expect(originals(f.file)).toBe(before); expect(financialOriginals(f.file)).toBe(financial);
  });

  it("foreign JSON asker cannot borrow exact recorded SQL ownership and retires only the malformed capability", async () => {
    const f = await saved();
    const run = JSON.parse(String(f.connection.db.prepare("SELECT data FROM query_runs WHERE id='private'").get()!.data));
    f.connection.db.prepare("UPDATE query_runs SET data=? WHERE id='private'").run(JSON.stringify({ ...run, asker: getAddress(bob) }));
    expect(f.connection.db.prepare("SELECT asker FROM query_runs WHERE id='private'").get()?.asker).toBe(alice);
    const before = originals(f.file), financial = financialOriginals(f.file);
    await expect(f.port.update(actor, input(["public", "private"]))).rejects.toMatchObject({ code: "public_profile_unavailable" });
    await expect(f.port.settings(actor)).rejects.toMatchObject({ code: "public_profile_unavailable" });
    expect(raw(f.file, db => db.prepare("SELECT count(*) n FROM public_researcher_profiles").get()?.n)).toBe(0);
    expect(originals(f.file)).toBe(before); expect(financialOriginals(f.file)).toBe(financial);
  });

  it.each(["original", "asker", "delete", "erasure", "visibility", "malformed-privacy", "malformed-original"] as const)("captured direct originals refuse current %s changes at a genuine owner await", async mutation => {
    const f = await saved(), observed = originalRead("private");
    const pending = f.port.update(actor, input(["public", "private"])); await observed;
    const row = f.connection.db.prepare("SELECT data FROM query_runs WHERE id='private'").get()!;
    if (mutation === "original") f.connection.db.prepare("UPDATE query_runs SET data=? WHERE id='private'")
      .run(JSON.stringify({ ...JSON.parse(String(row.data)), question: "Changed captured original" }));
    if (mutation === "asker") f.connection.db.prepare("UPDATE query_runs SET asker=? WHERE id='private'").run(bob);
    if (mutation === "delete") f.connection.db.prepare("DELETE FROM query_runs WHERE id='private'").run();
    if (mutation === "erasure") f.connection.db.prepare("UPDATE run_privacy SET erased=1,visibility='private',revision=revision+1 WHERE run_id='private'").run();
    if (mutation === "visibility") f.connection.db.prepare("UPDATE run_privacy SET visibility='public',revision=revision+1 WHERE run_id='private'").run();
    if (mutation === "malformed-privacy") f.connection.db.prepare("UPDATE run_privacy SET revision=? WHERE run_id='private'").run("invalid");
    if (mutation === "malformed-original") f.connection.db.prepare("UPDATE query_runs SET data='{}' WHERE id='private'").run();
    const afterPeer = originals(f.file), financial = financialOriginals(f.file);
    const code = mutation === "erasure" ? "not_owned" : mutation === "malformed-privacy" ? "public_profile_unavailable" : "conflict";
    await expect(pending).rejects.toMatchObject({ code });
    expect(raw(f.file, db => db.prepare("SELECT count(*) n FROM public_researcher_profiles").get()?.n)).toBe(0);
    expect(originals(f.file)).toBe(afterPeer); expect(financialOriginals(f.file)).toBe(financial);
  });

  it.each(["expired", "revoked", "future"] as const)("capture observer cannot lend a %s session publication authority", async mode => {
    const f = await saved(), observed = originalRead("private");
    const pending = f.port.update(actor, input(["public", "private"])); await observed;
    if (mode === "expired") f.connection.db.prepare("UPDATE web_sessions SET expires_at=? WHERE hash=?").run(Date.now() - 1, actor.sessionHash);
    if (mode === "future") {
      const issuedAt = Date.now() + 3_600_000;
      f.connection.db.prepare("UPDATE web_sessions SET issued_at=?,expires_at=? WHERE hash=?").run(issuedAt, issuedAt + 3_600_000, actor.sessionHash);
    }
    if (mode === "revoked") f.connection.db.prepare("DELETE FROM web_sessions WHERE hash=?").run(actor.sessionHash);
    const afterPeer = originals(f.file), financial = financialOriginals(f.file);
    await expect(pending).rejects.toMatchObject({ code: "unauthenticated" });
    expect(await f.port.read("alice")).toBeNull(); expect(originals(f.file)).toBe(afterPeer); expect(financialOriginals(f.file)).toBe(financial);
  });

  it.each(["unchanged", "changed", "asker", "erased", "foreign-binding"] as const)("genuine immutable claimed fallback remains authoritative (%s)", async mutation => {
    const f = await saved(), claims = createEnrolledSqliteRunClaims(f.connection.db);
    const run = JSON.parse(String(f.connection.db.prepare("SELECT data FROM query_runs WHERE id='anonymous'").get()!.data)) as QueryRun;
    await claims.issue({ runId: run.id, completedAt: run.createdAt, binding, tokenHash: hash("capture-claim") });
    await claims.claim({ ...actor, tokenHash: hash("capture-claim") }); await f.change(run.id, "public");
    const observed = originalRead(run.id);
    const who = mutation === "foreign-binding" ? { ...actor, binding: { ...binding, origin: "https://foreign.example" } } : actor;
    const pending = f.port.update(who, input([run.id, "public"])); await observed;
    if (mutation === "changed") f.connection.db.prepare("UPDATE query_runs SET data=? WHERE id=?").run(JSON.stringify({ ...run, question: "Changed claim original" }), run.id);
    if (mutation === "asker") f.connection.db.prepare("UPDATE query_runs SET asker=? WHERE id=?").run(alice, run.id);
    if (mutation === "erased") f.connection.db.prepare("UPDATE run_privacy SET erased=1,revision=revision+1 WHERE run_id=?").run(run.id);
    const afterPeer = originals(f.file), financial = financialOriginals(f.file);
    if (mutation === "unchanged") {
      await pending;
      const result = (await f.port.read("alice"))!;
      expect(result.runs).toHaveLength(1); expect(result.runs[0]).toMatchObject({ id: run.id, ownership: "claimed", funding: "unknown" });
      expect(JSON.stringify(result)).not.toContain(hash("capture-claim")); expect(JSON.stringify(result)).not.toContain(alice);
    } else {
      await expect(pending).rejects.toMatchObject({ code: mutation === "erased" || mutation === "foreign-binding" ? "not_owned" : "conflict" });
      expect(await f.port.read("alice")).toBeNull();
    }
    expect(originals(f.file)).toBe(afterPeer); expect(financialOriginals(f.file)).toBe(financial);
  });

  it("genuine claimed fallback refuses a previously changed original instead of refreshing its immutable proof", async () => {
    const f = await saved(), claims = createEnrolledSqliteRunClaims(f.connection.db);
    const run = JSON.parse(String(f.connection.db.prepare("SELECT data FROM query_runs WHERE id='anonymous'").get()!.data)) as QueryRun;
    await claims.issue({ runId: run.id, completedAt: run.createdAt, binding, tokenHash: hash("capture-stale-claim") });
    await claims.claim({ ...actor, tokenHash: hash("capture-stale-claim") });
    f.connection.db.prepare("UPDATE query_runs SET data=? WHERE id=?").run(JSON.stringify({ ...run, question: "Changed before capture" }), run.id);
    const before = originals(f.file), financial = financialOriginals(f.file);
    expect(await f.privacy.owner(run.id, actor)).toBeNull();
    await expect(f.port.update(actor, input(["public", run.id]))).rejects.toMatchObject({ code: "not_owned" });
    expect(await f.port.read("alice")).toBeNull(); expect(originals(f.file)).toBe(before); expect(financialOriginals(f.file)).toBe(financial);
  });

  it("stored JSON asker and recorded payer cannot replace an exact stored owner or immutable claim", async () => {
    const f = await saved();
    const anonymous = JSON.parse(String(f.connection.db.prepare("SELECT data FROM query_runs WHERE id='anonymous'").get()!.data));
    f.connection.db.prepare("UPDATE query_runs SET data=? WHERE id='anonymous'").run(JSON.stringify({ ...anonymous, asker: alice }));
    f.connection.db.prepare("INSERT INTO payment_events(id,query_id,kind,payer,payee,network,amount_usdc,settled,settlement_status,tx_hash) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run("capture-payer", "anonymous", "fetch", alice, bob, binding.network, 0.000001, 1, "settled", "synthetic-fixture-receipt");
    const before = originals(f.file), financial = financialOriginals(f.file);
    for (const id of ["anonymous", "foreign", "absent"]) await expect(f.port.update(actor, input(["public", id]))).rejects.toMatchObject({ code: "not_owned" });
    expect(await f.port.read("alice")).toBeNull(); expect(originals(f.file)).toBe(before); expect(financialOriginals(f.file)).toBe(financial);
  });

  it("changed original during the genuine capture ownership await conflicts without publishing stale text", async () => {
    const f = await saved(), observed = originalRead("public");
    const pending = f.port.update(actor, input(["public", "private"])); await observed;
    const original = f.connection.db.prepare("SELECT data FROM query_runs WHERE id='public'").get()!.data;
    f.connection.db.prepare("UPDATE query_runs SET data=? WHERE id='public'").run(JSON.stringify({ ...JSON.parse(String(original)), question: "Changed original" }));
    const afterPeer = originals(f.file); await expect(pending).rejects.toMatchObject({ code: "conflict" });
    expect(await f.port.read("alice")).toBeNull(); expect(originals(f.file)).toBe(afterPeer);
  });

  it.each(["unpublish", "selection", "profile"] as const)("no-inner-await read returns strictly null after synchronous %s at the final native yield", async mutation => {
    const f = await saved(); await f.change("public", "public");
    // This owned run requires no claim await; verifiedLinks is deliberately absent.
    await f.port.update(actor, input(["public"], ["displayName", "about", "purpose", "ledgers"]));
    const published = (await f.port.read("alice"))!;
    expect(published).toMatchObject({ displayName: "Alice", about: f.record.bio, purpose: f.record.purpose });
    expect(published.runs.map(run => run.id)).toEqual(["public"]); expect(published.verifiedLinks).toBeUndefined();
    expect(published.ledgers).toHaveLength(2);
    const before = originals(f.file), financial = financialOriginals(f.file);
    const pending = f.port.read("alice");
    let withdrawal: Promise<void> | undefined;
    if (mutation === "unpublish") {
      // The genuine same-store transaction commits synchronously before its wrapper yields.
      withdrawal = f.port.unpublish(actor);
      expect(f.connection.db.prepare("SELECT published,revision FROM public_researcher_profiles WHERE wallet=?").get(alice))
        .toMatchObject({ published: 0, revision: 2 });
    }
    if (mutation === "selection") f.connection.db.prepare("UPDATE public_researcher_profiles SET fields='[]',run_ids='[]',revision=revision+1 WHERE wallet=?").run(alice);
    if (mutation === "profile") f.connection.db.prepare("UPDATE private_profiles SET display_name='Changed at final yield' WHERE wallet=?").run(alice);
    const afterPeer = originals(f.file);
    if (withdrawal) await withdrawal;
    expect(await pending).toBeNull();
    expect(originals(f.file)).toBe(afterPeer); expect(financialOriginals(f.file)).toBe(financial);
    if (mutation !== "profile") expect(afterPeer).toBe(before);
    if (mutation === "unpublish") expect(await f.port.sitemap(1000)).toEqual([]);
  });

  it.each(["unpublish", "selection", "profile", "identity", "visibility", "original"] as const)("read suppresses stale %s after genuine asynchronous identity read", async mutation => {
    const f = await saved(), verified = await f.verify(); await f.change("public", "public");
    await f.port.update(actor, input(["public"], ["verifiedLinks", "displayName", "ledgers"]));
    const pending = f.port.read("alice");
    if (mutation === "unpublish") await f.port.unpublish(actor);
    if (mutation === "selection") await f.port.update(actor, input([], ["displayName"], 1));
    if (mutation === "profile") await f.profiles.update(alice, { ...f.record, displayName: "Changed" });
    if (mutation === "identity") await f.identities.unlink(alice, "github");
    if (mutation === "visibility") f.connection.db.prepare("UPDATE run_privacy SET visibility='private',revision=revision+1 WHERE run_id='public'").run();
    if (mutation === "original") {
      const row = f.connection.db.prepare("SELECT data FROM query_runs WHERE id='public'").get()!;
      f.connection.db.prepare("UPDATE query_runs SET data=? WHERE id='public'").run(JSON.stringify({ ...JSON.parse(String(row.data)), question: "Changed" }));
    }
    const afterPeer = originals(f.file); const result = await pending;
    if (["unpublish", "selection", "profile", "identity"].includes(mutation)) expect(result).toBeNull(); else expect(result?.runs).toEqual([]);
    expect(originals(f.file)).toBe(afterPeer);
    if (mutation === "identity") expect((await f.port.read("alice"))?.verifiedLinks).toEqual([]);
    if (mutation === "unpublish") expect(await f.port.sitemap(1000)).toEqual([]);
    expect(verified.wallet).toBe(alice);
  });

  it("uses ROOT's genuine immutable claim proof and rechecks the original after an awaited ownership read", async () => {
    const f = await saved(), claims = createEnrolledSqliteRunClaims(f.connection.db);
    const run = JSON.parse(String(f.connection.db.prepare("SELECT data FROM query_runs WHERE id='anonymous'").get()!.data)) as QueryRun;
    await claims.issue({ runId: run.id, completedAt: run.createdAt, binding, tokenHash: hash("isolated-claim") });
    await claims.claim({ ...actor, tokenHash: hash("isolated-claim") }); await f.change(run.id, "public");
    const original = originals(f.file); await f.port.update(actor, input([run.id]));
    const result = (await f.port.read("alice"))!; expect(result.runs[0]).toMatchObject({ ownership: "claimed", funding: "unknown" });
    expect(JSON.stringify(result)).not.toContain(hash("isolated-claim")); expect(originals(f.file)).toBe(original);
    const pending = f.port.read("alice");
    f.connection.db.prepare("UPDATE query_runs SET data=? WHERE id=?").run(JSON.stringify({ ...run, question: "Changed" }), run.id);
    const afterPeer = originals(f.file); expect((await pending)?.runs).toEqual([]); expect(originals(f.file)).toBe(afterPeer);
  });

  it("rename requires republishing; deletion cascades under genuine positive FK policy", async () => {
    const f = await saved(), financial = financialOriginals(f.file); await f.port.update(actor, input());
    await f.profiles.update(alice, { ...f.record, handle: "renamed" });
    expect(await f.port.read("alice")).toBeNull(); expect(await f.port.read("renamed")).toBeNull(); expect(await f.port.sitemap(1000)).toEqual([]);
    await f.port.update(actor, input([], ["displayName"], 1)); expect((await f.port.read("renamed"))?.displayName).toBe("Alice");
    await f.profiles.delete(alice); expect(await f.port.read("renamed")).toBeNull();
    expect(raw(f.file, db => db.prepare("SELECT count(*) n FROM public_researcher_profiles").get()?.n)).toBe(0);
    expect(financialOriginals(f.file)).toBe(financial);
  });

  it("readonly write-first refusal issues no runtime/SQL and keeps publication readers healthy", async () => {
    const f = await saved(); await f.port.update(actor, input([], ["displayName", "ledgers"])); const reader = f.open(true);
    const port = createEnrolledSqlitePublicProfiles(reader.db)!;
    const guards = f.state.guards, bytes = hash(readFileSync(f.file)), prepare = vi.spyOn(DatabaseSync.prototype, "prepare"), exec = vi.spyOn(DatabaseSync.prototype, "exec");
    await expect(port.update(actor, input([], ["ledgers"], 1))).rejects.toMatchObject({ code: "public_profile_unavailable" });
    await expect(port.unpublish(actor)).rejects.toMatchObject({ code: "public_profile_unavailable" });
    expect(f.state.guards).toBe(guards); expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
    prepare.mockRestore(); exec.mockRestore(); expect(hash(readFileSync(f.file))).toBe(bytes);
    expect((await port.read("alice"))?.displayName).toBe("Alice"); expect((await port.sitemap(1000)).map(row => row.handle)).toEqual(["alice"]);
    expect((await port.read("alice"))?.ledgers?.[0].readerPaidMicros).toBe("1000000002");
  });

  it.each([false, true])("trusted Full19 projects selected exact settled ledgers with no registration escape (archive=%s)", async archive => {
    const f = await saved({ archive, ledger: "guards" }), original = originals(f.file), financial = financialOriginals(f.file);
    const aggregate = vi.spyOn(DatabaseSync.prototype, "aggregate"), functions = vi.spyOn(DatabaseSync.prototype, "function");
    expect(() => assertVerifiedSqliteNativeUserDomainPolicy(f.connection.db)).not.toThrow();
    expect(createEnrolledSqlitePublicProfiles(f.connection.db)).toBeDefined();
    await f.port.update(actor, input()); expect((await f.port.read("alice"))?.ledgers).toBeUndefined();
    await f.port.update(actor, input([], ["ledgers"], 1));
    const result = (await f.port.read("alice"))!;
    expect(result).toMatchObject({ ledgerBasis: "wallet-wide-recorded-settled-creator-events", runs: [], ledgers: [
      { network: "eip155:5042", readerPaidMicros: "1000000002", creatorEarnedMicros: "2", sponsoredCreatorPaymentsMicros: "500000" },
      { network: "eip155:5042002", readerPaidMicros: "0", creatorEarnedMicros: "3", sponsoredCreatorPaymentsMicros: "0" },
    ] });
    expect(result.displayName).toBeUndefined(); expect(result.verifiedLinks).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(alice); expect(JSON.stringify(result)).not.toContain(bob);
    expect(JSON.stringify(result)).not.toContain("synthetic-proof"); expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(() => f.connection.db.aggregate).toThrow(); expect(() => f.connection.db.function).toThrow();
    expect(aggregate).not.toHaveBeenCalled(); expect(functions).not.toHaveBeenCalled();
    expect(originals(f.file)).toBe(original); expect(financialOriginals(f.file)).toBe(financial);
    await f.port.unpublish(actor); expect(await f.port.read("alice")).toBeNull(); expect(await f.port.sitemap(1000)).toEqual([]);
    expect(originals(f.file)).toBe(original);
  });

  it("eligible fractional-micro data poisons only its ledger total and never rounds into credit", async () => {
    const f = await saved({ ledger: "invalid" }), original = originals(f.file);
    await f.port.update(actor, input([], ["ledgers"]));
    expect((await f.port.read("alice"))?.ledgers).toEqual([
      { network: "eip155:5042", readerPaidMicros: null, creatorEarnedMicros: "0", sponsoredCreatorPaymentsMicros: "500000" },
      { network: "eip155:5042002", readerPaidMicros: "0", creatorEarnedMicros: "0", sponsoredCreatorPaymentsMicros: "0" },
    ]);
    expect(originals(f.file)).toBe(original); await f.port.unpublish(actor); expect(await f.port.read("alice")).toBeNull();
  });

  it.each([null, 0, -1, 0.0000001, 0.0000011, 0.1 + 0.2, Infinity, "not-a-number", "0.000001"])("actual aggregate keeps invalid %s null even alongside valid micros", async invalid => {
    const f = await saved(), original = originals(f.file);
    for (const values of [[invalid, 0.000001], [0.000001, invalid]]) {
      expect(f.connection.db.prepare("SELECT keryx_public_profile_micros(value) AS total FROM (SELECT ? AS value UNION ALL SELECT ? AS value)")
        .get(...values)?.total).toBeNull();
    }
    expect(originals(f.file)).toBe(original);
  });

  it("BigInt total exceeds safe Number and signed64 micros without overflow or rounding", async () => {
    const f = await saved({ ledger: "overflow" }), original = originals(f.file);
    await f.port.update(actor, input([], ["ledgers"]));
    expect((await f.port.read("alice"))?.ledgers?.[0].readerPaidMicros).toBe("18000000001000000002");
    expect(originals(f.file)).toBe(original);
  });

  it("installer failure closes the raw opening and issues no positive capability", () => {
    const f = fixture(), bytes = hash(readFileSync(f.file)); let attempted: DatabaseSync | undefined;
    const aggregate = vi.spyOn(DatabaseSync.prototype, "aggregate").mockImplementation(function (this: DatabaseSync) {
      attempted = this; throw new Error("Fixture installer failure");
    });
    expect(() => f.open()).toThrow(); expect(aggregate).toHaveBeenCalledTimes(1); aggregate.mockRestore();
    expect(attempted).toBeDefined(); expect(() => assertVerifiedSqliteNativeUserDomainPolicy(attempted!)).toThrow();
    expect(() => attempted!.prepare("SELECT 1").get()).toThrow(); expect(hash(readFileSync(f.file))).toBe(bytes);
    const reopened = f.open(); expect(() => assertVerifiedSqliteNativeUserDomainPolicy(reopened.db)).not.toThrow();
    expect(reopened.db.prepare("SELECT keryx_public_profile_micros(0.000001) AS total").get()?.total).toBe("1");
  });

  it.each(["runtime", "manifest", "schema", "fence"] as const)("unclassified %s drift permanently revokes the old connection after repair", async drift => {
    const f = await saved(); await f.port.update(actor, input());
    const manifest = readFileSync(f.manifest);
    const fence = raw(f.file, db => Object.keys(storageFenceStatements(db, f.identity)).find(name => name.startsWith("storage_fence_") && name.endsWith("_update"))!);
    const fenceSql = raw(f.file, db => String(db.prepare("SELECT sql FROM sqlite_schema WHERE name=?").get(fence)!.sql));
    if (drift === "runtime") f.state.drift = true;
    if (drift === "manifest") writeFileSync(f.manifest, "{}");
    if (drift === "schema") raw(f.file, db => db.exec("CREATE INDEX unexpected_public_index ON public_researcher_profiles(handle)"), false);
    if (drift === "fence") raw(f.file, db => db.exec(`DROP TRIGGER "${fence}"`), false);
    await expect(f.port.read("alice")).rejects.toMatchObject({ code: "public_profile_unavailable" });
    f.state.drift = false; writeFileSync(f.manifest, manifest);
    if (drift === "schema") raw(f.file, db => db.exec("DROP INDEX unexpected_public_index"), false);
    if (drift === "fence") raw(f.file, db => db.exec(fenceSql), false);
    await expect(f.port.sitemap(1000)).rejects.toMatchObject({ code: "public_profile_unavailable" });
    expect(() => f.connection.db.prepare("SELECT 1").get()).toThrow();
  });

  it.each([false, true])("a genuine alternate supported Full19 family permanently retires the opening even after restoration (archive=%s)", async archive => {
    const f = await saved({ archive }); await f.port.update(actor, input());
    const before = originals(f.file), financial = financialOriginals(f.file), manifest = readFileSync(f.manifest);
    const tables = ["public_reference_article_terms", "public_reference_article_versions", "public_reference_articles"];
    const archiveSql = raw(f.file, db => db.prepare(`SELECT sql FROM sqlite_schema
      WHERE tbl_name IN (?,?,?) AND sql IS NOT NULL
      ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,name`).all(...tables).map(row => String(row.sql)));
    raw(f.file, db => {
      db.exec("BEGIN IMMEDIATE");
      try {
        if (archive) for (const table of tables) db.exec(`DROP TABLE "${table}"`);
        else { db.exec(PUBLIC_REFERENCE_ARCHIVE_SQL); installStorageFences(db, f.identity); }
        assertStorageFences(db, f.identity);
        const excluded = new Set([STORAGE_IDENTITY_TABLE, "storage_identity_no_update", "storage_identity_no_delete",
          "storage_identity_no_insert", ...Object.keys(storageFenceStatements(db, f.identity))]);
        expect(sqliteApplicationSchemaProfile(db, excluded)).toBe(supportedSqliteApplicationProfiles(true)[archive ? 1 : 3]);
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    }, false);
    try {
      // The alternate is source-supported, but the old port is bound to its own opening.
      await expect(f.port.read("alice")).rejects.toMatchObject({ code: "public_profile_unavailable" });
    } finally {
      raw(f.file, db => {
        db.exec("BEGIN IMMEDIATE");
        try {
          if (archive) for (const sql of archiveSql) db.exec(sql);
          else for (const table of tables) db.exec(`DROP TABLE "${table}"`);
          assertStorageFences(db, f.identity); db.exec("COMMIT");
        } catch (error) { db.exec("ROLLBACK"); throw error; }
      }, false);
    }
    expect(readFileSync(f.manifest)).toEqual(manifest);
    expect(originals(f.file)).toBe(before); expect(financialOriginals(f.file)).toBe(financial);
    await expect(f.port.sitemap(1000)).rejects.toMatchObject({ code: "public_profile_unavailable" });
    expect(() => assertVerifiedSqliteNativeUserDomainPolicy(f.connection.db)).toThrow();
    expect(() => f.connection.db.prepare("SELECT 1").get()).toThrow();
    const fresh = f.open(), rebuilt = createEnrolledSqlitePublicProfiles(fresh.db)!;
    expect((await rebuilt.read("alice"))?.displayName).toBe("Alice");
    expect(originals(f.file)).toBe(before); expect(financialOriginals(f.file)).toBe(financial);
  });

  it("runtime drift after an awaited genuine identity result refuses and latches revocation", async () => {
    const f = await saved(); await f.port.update(actor, input([], ["verifiedLinks"]));
    const pending = f.port.read("alice"); f.state.drift = true;
    await expect(pending).rejects.toMatchObject({ code: "public_profile_unavailable" }); f.state.drift = false;
    await expect(f.port.read("alice")).rejects.toMatchObject({ code: "public_profile_unavailable" });
  });

  it("genuine native5 busy BEGIN cleans up and preserves healthy readers without retrying publication", async () => {
    const f = await saved(), writer = f.open(), before = originals(f.file);
    writer.db.exec("BEGIN IMMEDIATE"); const exec = vi.spyOn(DatabaseSync.prototype, "exec"), close = vi.spyOn(DatabaseSync.prototype, "close");
    try {
      await expect(f.port.update(actor, input())).rejects.toMatchObject({ code: "public_profile_unavailable" });
      const failures = exec.mock.results.filter((result, index) => result.type === "throw" && exec.mock.calls[index][0] === "BEGIN IMMEDIATE");
      expect(failures).toHaveLength(1); expect(failures[0]).toMatchObject({ value: { code: "ERR_SQLITE_ERROR", errcode: 5 } });
      expect(f.connection.db.isTransaction).toBe(false); expect(writer.db.isTransaction).toBe(true); expect(close).not.toHaveBeenCalled();
      expect(await f.port.read("alice")).toBeNull();
    } finally { exec.mockRestore(); close.mockRestore(); writer.db.exec("ROLLBACK"); writer.close(); }
    expect(originals(f.file)).toBe(before); await f.port.update(actor, input()); expect((await f.port.read("alice"))?.displayName).toBe("Alice");
  }, 15_000);

  it("source-owned construction executes no target DDL/registration and rejects caller dependencies before SQL", async () => {
    const f = await saved(), before = originals(f.file), exec = vi.spyOn(DatabaseSync.prototype, "exec"), aggregate = vi.spyOn(DatabaseSync.prototype, "aggregate");
    const rebuilt = createEnrolledSqlitePublicProfiles(f.connection.db)!;
    expect(exec.mock.calls.some(([sql]) => /\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/i.test(sql))).toBe(false);
    expect(aggregate).not.toHaveBeenCalled(); exec.mockRestore(); aggregate.mockRestore();
    expect(await rebuilt.read("alice")).toBeNull(); expect(originals(f.file)).toBe(before);
    const foreign = await saved(), bytes = hash(readFileSync(f.file)), guards = f.state.guards;
    const prepare = vi.spyOn(DatabaseSync.prototype, "prepare"), writes = vi.spyOn(DatabaseSync.prototype, "exec");
    for (const dependencies of [[undefined, undefined], [f.privacy, f.identities, f.history],
      [foreign.privacy, foreign.identities, foreign.history], [{ owner: () => null }, { list: () => ({ identities: [] }) }],
      [{ runtimeGuard: () => undefined }]]) {
      expect(() => Reflect.apply(createEnrolledSqlitePublicProfiles, undefined, [f.connection.db, ...dependencies])).toThrow("public_profile_unavailable");
    }
    expect(prepare).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled(); expect(f.state.guards).toBe(guards);
    prepare.mockRestore(); writes.mockRestore(); expect(hash(readFileSync(f.file))).toBe(bytes);
    await f.port.update(actor, input([], ["ledgers"])); expect((await f.port.read("alice"))?.ledgers?.[0].readerPaidMicros).toBe("1000000002");
  });

  it("a foreign network binding cannot create native publication or lend claims authority", async () => {
    const f = await saved(), before = originals(f.file), foreign = { ...actor, binding: { ...binding, network: "eip155:5042002" as const } };
    await expect(f.port.update(foreign, input())).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(f.port.unpublish(foreign)).rejects.toMatchObject({ code: "unauthenticated" });
    expect(await f.port.read("alice")).toBeNull(); expect(originals(f.file)).toBe(before);
    await f.port.update(actor, input()); expect((await f.port.settings(actor)).published).toBe(true);
  });

  it("actual marker drift and repair never revive the old native publication capability", async () => {
    const f = await saved(); await f.port.update(actor, input());
    const marker = raw(f.file, db => String(db.prepare("SELECT identity FROM keryx_storage_identity WHERE id=1").get()!.identity));
    const trigger = raw(f.file, db => String(db.prepare("SELECT sql FROM sqlite_schema WHERE name='storage_identity_no_update'").get()!.sql));
    const writeMarker = (value: string) => raw(f.file, db => {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec("DROP TRIGGER storage_identity_no_update");
        db.prepare("UPDATE keryx_storage_identity SET identity=? WHERE id=1").run(value); db.exec(trigger); db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    }, false);
    writeMarker(JSON.stringify({ ...JSON.parse(marker), storageId: randomUUID() }));
    await expect(f.port.read("alice")).rejects.toMatchObject({ code: "public_profile_unavailable" });
    writeMarker(marker); await expect(f.port.read("alice")).rejects.toMatchObject({ code: "public_profile_unavailable" });
    expect(() => f.connection.db.prepare("SELECT 1").get()).toThrow();
  });

  it("actual file replacement is either held by Windows or detected; no synthetic replacement guard", async () => {
    const f = await saved(); await f.port.update(actor, input()); const before = originals(f.file), bytes = hash(readFileSync(f.file));
    const replacement = join(f.directory, "replacement.sqlite"), retained = join(f.directory, "retained-original.sqlite"); copyFileSync(f.file, replacement);
    try { renameSync(f.file, retained); }
    catch (error) {
      if (process.platform !== "win32") throw error;
      expect(error).toMatchObject({ code: "EBUSY" });
      expect(hash(readFileSync(f.file))).toBe(bytes);
      expect(() => assertVerifiedSqliteNativeUserDomainPolicy(f.connection.db)).not.toThrow();
      expect(raw(f.file, db => db.prepare("SELECT 1 FROM query_runs WHERE id='public'").get())).toBeDefined();
      expect((await f.port.read("alice"))?.displayName).toBe("Alice"); expect(originals(f.file)).toBe(before); return;
    }
    renameSync(replacement, f.file);
    await expect(f.port.read("alice")).rejects.toMatchObject({ code: "public_profile_unavailable" });
    renameSync(f.file, replacement); renameSync(retained, f.file);
    await expect(f.port.sitemap(1000)).rejects.toMatchObject({ code: "public_profile_unavailable" }); expect(originals(f.file)).toBe(before);
  });

  it("genuine native5 busy COMMIT rolls back the owned write and preserves publication readers", async () => {
    const f = await saved(), reader = f.open(true), before = originals(f.file);
    reader.db.exec("BEGIN"); expect(reader.db.prepare("SELECT count(*) n FROM public_researcher_profiles").get()?.n).toBe(0);
    const exec = vi.spyOn(DatabaseSync.prototype, "exec"), close = vi.spyOn(DatabaseSync.prototype, "close");
    try {
      await expect(f.port.update(actor, input())).rejects.toMatchObject({ code: "public_profile_unavailable" });
      const failures = exec.mock.results.filter((result, index) => result.type === "throw" && exec.mock.calls[index][0] === "COMMIT");
      expect(failures).toHaveLength(1); expect(failures[0]).toMatchObject({ value: { code: "ERR_SQLITE_ERROR", errcode: 5 } });
      expect(exec.mock.calls.filter(([sql]) => sql === "ROLLBACK")).toHaveLength(1); expect(close).not.toHaveBeenCalled();
      expect(f.connection.db.isTransaction).toBe(false); expect(reader.db.isTransaction).toBe(true); expect(await f.port.read("alice")).toBeNull();
    } finally { exec.mockRestore(); close.mockRestore(); reader.db.exec("ROLLBACK"); reader.close(); }
    expect(raw(f.file, db => db.prepare("SELECT count(*) n FROM public_researcher_profiles").get()?.n)).toBe(0);
    expect(originals(f.file)).toBe(before); await f.port.update(actor, input()); expect((await f.port.read("alice"))?.displayName).toBe("Alice");
  }, 15_000);
});
