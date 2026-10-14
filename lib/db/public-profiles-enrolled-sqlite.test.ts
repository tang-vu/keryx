import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
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
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { inspectStorageDeploymentManifest } from "./runtime-storage-config";
import { openVerifiedSqliteStorage } from "./storage-identity-connection";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { insertStorageIdentity, installStorageFences, storageFenceStatements } from "./storage-identity-sqlite";

const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
const hash = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const binding = { network: "eip155:5042" as const, origin: "https://native-profile-fixture.example" };
const actor: PublicProfileActor = { wallet: alice, sessionHash: hash(alice), binding };
const input = (runIds: string[] = [], fields: PublicProfileInput["fields"] = ["displayName"], revision = 0): PublicProfileInput =>
  ({ published: true, fields, runIds, revision });
const directories: string[] = [], connections: Array<{ close(): void }> = [];
afterEach(() => {
  vi.restoreAllMocks();
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
const held = () => {
  let entered!: () => void, release!: () => void;
  const observed = new Promise<void>(done => { entered = done; }), pending = new Promise<void>(done => { release = done; });
  return { observed, release, async wait() { entered(); await pending; } };
};

function fixture(options: { archive?: boolean; before?: boolean; malformed?: "partial" | "session" | "publication" } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "keryx-native-public-profiles-")); directories.push(directory);
  const file = join(directory, "native.sqlite"), manifest = join(directory, "deployment.json");
  const identity: StorageIdentity = { ...syntheticStorageIdentity("mainnet-real"), format: "keryx-mainnet-storage-identity-v1",
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
    db.exec("BEGIN"); installMainnetApplicationSchema(db, { publicReferenceArchive: options.archive ?? false });
    saveRaw("historical"); // Pre-bundle historical missing sidecar stays unlisted.
    if (!options.before) installNativeUserDomainSchema(db);
    for (const wallet of [alice, bob]) db.prepare("INSERT INTO web_sessions(hash,wallet,issued_at,expires_at) VALUES(?,?,?,?)")
      .run(hash(wallet), wallet, now - 60_000, now + 3_600_000);
    if (!options.before) {
      for (const [id, wallet] of [["public", alice], ["private", alice], ["unlisted", alice], ["foreign", bob], ["anonymous", null]] as const) saveRaw(id, wallet);
      saveRaw("reader", alice, { paymentMode: "real", fundingOwner: "browser" });
      saveRaw("sponsored", alice, { paymentMode: "real", fundingOwner: "treasury" });
      const payment = (id: string, query: string, amount: number, status = "settled", settled = 1, tx: string | null = "synthetic-fixture-receipt", kind = "citation") =>
        db.prepare("INSERT INTO payment_events(id,query_id,kind,payer,payee,network,amount_usdc,settled,settlement_status,tx_hash) VALUES(?,?,?,?,?,?,?,?,?,?)")
          .run(id, query, kind, alice, bob, binding.network, amount, settled, status, tx);
      payment("micro", "reader", 0.000001); payment("six-decimals", "reader", 1000.000001);
      payment("pending", "reader", 99, "pending", 0); payment("proofless", "reader", 99, "settled", 1, null);
      payment("fee", "reader", 99, "settled", 1, "synthetic-fee", "operating-fee"); payment("treasury", "sponsored", 0.5);
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
      ...(fullGuard ? { applicationProfiles: supportedSqliteApplicationProfiles(true) } : {}),
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
  const port = createEnrolledSqlitePublicProfiles(connection.db, privacy, identities, history)!;
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

describe("#264 genuine Full19 native publication (dependency composition required; no execution claim)", () => {
  it.each([false, true])("exact BEFORE absence and Full19 no-profile/no-publication do not install or activate (archive=%s)", async archive => {
    const before = fixture({ before: true, archive }), connection = before.open(), bytes = hash(readFileSync(before.file));
    // BEFORE needs no invented dependency. Missing ports are never used in this exact absence case.
    expect(createEnrolledSqlitePublicProfiles(connection.db, undefined!, undefined!)).toBeUndefined();
    expect(hash(readFileSync(before.file))).toBe(bytes);
    expect(connection.db.prepare("SELECT 1 FROM query_runs WHERE id='historical'").get()).toBeDefined();
    const f = fixture({ archive }), native = f.open();
    const privacy = createEnrolledSqliteRunPrivacy(native.db), identities = createEnrolledSqliteProfileIdentities(native.db)!;
    const original = originals(f.file), port = createEnrolledSqlitePublicProfiles(native.db, privacy, identities)!;
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
    expect(() => createEnrolledSqlitePublicProfiles(connection.db, undefined!, undefined!)).toThrow("public_profile_unavailable");
    expect(hash(readFileSync(f.file))).toBe(bytes);
    expect(() => connection.db.prepare("SELECT 1").get()).toThrow();
  });

  it("cannot qualify raw storage, an unsealed Full19 opening, or an ordinary constructor on native", async () => {
    const f = fixture(), rawDb = new DatabaseSync(f.file);
    try { expect(() => createEnrolledSqlitePublicProfiles(rawDb, undefined!, undefined!)).toThrow("public_profile_unavailable"); }
    finally { rawDb.close(); }
    const unsealed = f.open(false, false);
    expect(() => createEnrolledSqlitePublicProfiles(unsealed.db, undefined!, undefined!)).toThrow("public_profile_unavailable");
    const savedFixture = await saved(), before = originals(savedFixture.file);
    expect(() => createSqlitePublicProfiles(savedFixture.connection.db, savedFixture.privacy, savedFixture.identities, savedFixture.history)).toThrow("public_profile_unavailable");
    expect(originals(savedFixture.file)).toBe(before); expect(await savedFixture.port.read("alice")).toBeNull();
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

  it("revision0 tombstone survives reconstruction and rejects a pending first publication", async () => {
    const f = await saved(), gate = held(), before = originals(f.file);
    const port = createEnrolledSqlitePublicProfiles(f.connection.db, { ...f.privacy, async owner(id, who) {
      const result = await f.privacy.owner(id, who); await gate.wait(); return result;
    } }, f.identities, f.history)!;
    const pending = port.update(actor, input(["private"], ["about", "purpose"])); await gate.observed;
    await f.port.unpublish(actor); gate.release(); await expect(pending).rejects.toMatchObject({ code: "conflict" });
    const rebuilt = createEnrolledSqlitePublicProfiles(f.connection.db, f.privacy, f.identities, f.history)!;
    expect(await rebuilt.settings(actor)).toMatchObject({ published: false, revision: 1, fields: [], runIds: [] });
    expect(await rebuilt.read("alice")).toBeNull(); expect(await rebuilt.sitemap(1000)).toEqual([]); expect(originals(f.file)).toBe(before);
  });

  it.each(["expired", "revoked"] as const)("fresh session check after genuine asynchronous ownership refuses %s", async mode => {
    const f = await saved(), before = financialOriginals(f.file);
    const port = createEnrolledSqlitePublicProfiles(f.connection.db, { ...f.privacy, async owner(id, who) {
      const result = await f.privacy.owner(id, who);
      if (mode === "expired") f.connection.db.prepare("UPDATE web_sessions SET expires_at=? WHERE hash=?").run(Date.now() - 1, actor.sessionHash);
      else f.connection.db.prepare("DELETE FROM web_sessions WHERE hash=?").run(actor.sessionHash);
      return result;
    } }, f.identities, f.history)!;
    await expect(port.update(actor, input(["private"]))).rejects.toMatchObject({ code: "unauthenticated" });
    expect(await f.port.read("alice")).toBeNull(); expect(await f.port.sitemap(1000)).toEqual([]); expect(financialOriginals(f.file)).toBe(before);
  });

  it("changed original during a second ownership await conflicts without publishing stale text", async () => {
    const f = await saved(), gate = held();
    const port = createEnrolledSqlitePublicProfiles(f.connection.db, { ...f.privacy, async owner(id, who) {
      const result = await f.privacy.owner(id, who); if (id === "private") await gate.wait(); return result;
    } }, f.identities, f.history)!;
    const pending = port.update(actor, input(["public", "private"])); await gate.observed;
    const original = f.connection.db.prepare("SELECT data FROM query_runs WHERE id='public'").get()!.data;
    f.connection.db.prepare("UPDATE query_runs SET data=? WHERE id='public'").run(JSON.stringify({ ...JSON.parse(String(original)), question: "Changed original" }));
    const afterPeer = originals(f.file); gate.release(); await expect(pending).rejects.toMatchObject({ code: "conflict" });
    expect(await f.port.read("alice")).toBeNull(); expect(originals(f.file)).toBe(afterPeer);
  });

  it.each(["unpublish", "profile", "identity", "visibility", "original"] as const)("read suppresses stale %s after genuine asynchronous identity read", async mutation => {
    const f = await saved(), verified = await f.verify(); await f.change("public", "public");
    await f.port.update(actor, input(["public"], ["verifiedLinks", "displayName"])); const gate = held();
    const port = createEnrolledSqlitePublicProfiles(f.connection.db, f.privacy, { ...f.identities, async list(wallet) {
      const result = await f.identities.list(wallet); await gate.wait(); return result;
    } }, f.history)!;
    const pending = port.read("alice"); await gate.observed;
    if (mutation === "unpublish") await f.port.unpublish(actor);
    if (mutation === "profile") await f.profiles.update(alice, { ...f.record, displayName: "Changed" });
    if (mutation === "identity") await f.identities.unlink(alice, "github");
    if (mutation === "visibility") await f.change("public", "private", 1);
    if (mutation === "original") {
      const row = f.connection.db.prepare("SELECT data FROM query_runs WHERE id='public'").get()!;
      f.connection.db.prepare("UPDATE query_runs SET data=? WHERE id='public'").run(JSON.stringify({ ...JSON.parse(String(row.data)), question: "Changed" }));
    }
    const afterPeer = originals(f.file); gate.release(); const result = await pending;
    if (["unpublish", "profile", "identity"].includes(mutation)) expect(result).toBeNull(); else expect(result?.runs).toEqual([]);
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
    const gate = held(), port = createEnrolledSqlitePublicProfiles(f.connection.db, f.privacy, f.identities, { ...f.history, async read(wallet, scope, id) {
      const proof = await f.history.read(wallet, scope, id); await gate.wait(); return proof;
    } })!;
    const pending = port.read("alice"); await gate.observed;
    f.connection.db.prepare("UPDATE query_runs SET data=? WHERE id=?").run(JSON.stringify({ ...run, question: "Changed" }), run.id);
    const afterPeer = originals(f.file); gate.release(); expect((await pending)?.runs).toEqual([]); expect(originals(f.file)).toBe(afterPeer);
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
    const f = await saved(); await f.port.update(actor, input()); const reader = f.open(true);
    const privacy = createEnrolledSqliteRunPrivacy(reader.db), identities = createEnrolledSqliteProfileIdentities(reader.db)!;
    const port = createEnrolledSqlitePublicProfiles(reader.db, privacy, identities)!;
    const guards = f.state.guards, bytes = hash(readFileSync(f.file)), prepare = vi.spyOn(DatabaseSync.prototype, "prepare"), exec = vi.spyOn(DatabaseSync.prototype, "exec");
    await expect(port.update(actor, input([], ["displayName"], 1))).rejects.toMatchObject({ code: "public_profile_unavailable" });
    await expect(port.unpublish(actor)).rejects.toMatchObject({ code: "public_profile_unavailable" });
    expect(f.state.guards).toBe(guards); expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
    prepare.mockRestore(); exec.mockRestore(); expect(hash(readFileSync(f.file))).toBe(bytes);
    expect((await port.read("alice"))?.displayName).toBe("Alice"); expect((await port.sitemap(1000)).map(row => row.handle)).toEqual(["alice"]);
  });

  it("leaves the fixed ROOT settled-micros aggregate gate unavailable; never registers on or exposes native", async () => {
    const f = await saved(), original = originals(f.file), aggregate = vi.spyOn(DatabaseSync.prototype, "aggregate");
    expect(createEnrolledSqlitePublicProfiles(f.connection.db, f.privacy, f.identities, f.history)).toBeDefined();
    await expect(f.port.update(actor, input([], ["ledgers"]))).rejects.toMatchObject({ code: "public_profile_unavailable" });
    expect(aggregate).not.toHaveBeenCalled(); expect(originals(f.file)).toBe(original);
    await f.port.update(actor, input()); expect((await f.port.read("alice"))?.ledgers).toBeUndefined();
    f.connection.db.prepare("UPDATE public_researcher_profiles SET fields=? WHERE wallet=?").run(JSON.stringify(["ledgers"]), alice);
    await expect(f.port.read("alice")).rejects.toMatchObject({ code: "public_profile_unavailable" });
    expect(aggregate).not.toHaveBeenCalled(); expect(originals(f.file)).toBe(original);
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

  it("runtime drift after an awaited genuine identity result refuses and latches revocation", async () => {
    const f = await saved(); await f.port.update(actor, input([], ["verifiedLinks"]));
    const gate = held(), port = createEnrolledSqlitePublicProfiles(f.connection.db, f.privacy, { ...f.identities, async list(wallet) {
      const value = await f.identities.list(wallet); await gate.wait(); return value;
    } }, f.history)!;
    const pending = port.read("alice"); await gate.observed; f.state.drift = true; gate.release();
    await expect(pending).rejects.toMatchObject({ code: "public_profile_unavailable" }); f.state.drift = false;
    await expect(port.read("alice")).rejects.toMatchObject({ code: "public_profile_unavailable" });
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

  it("source-known construction executes no target DDL or aggregate registration and rejects a missing required port", async () => {
    const f = await saved(), before = originals(f.file), exec = vi.spyOn(DatabaseSync.prototype, "exec"), aggregate = vi.spyOn(DatabaseSync.prototype, "aggregate");
    const rebuilt = createEnrolledSqlitePublicProfiles(f.connection.db, f.privacy, f.identities, f.history)!;
    expect(exec.mock.calls.some(([sql]) => /\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/i.test(sql))).toBe(false);
    expect(aggregate).not.toHaveBeenCalled(); exec.mockRestore(); aggregate.mockRestore();
    expect(await rebuilt.read("alice")).toBeNull(); expect(originals(f.file)).toBe(before);
    const missing = fixture(), native = missing.open(), bytes = hash(readFileSync(missing.file));
    expect(() => createEnrolledSqlitePublicProfiles(native.db, undefined!, undefined!)).toThrow("public_profile_unavailable");
    expect(hash(readFileSync(missing.file))).toBe(bytes);
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
    const f = await saved(); await f.port.update(actor, input()); const before = originals(f.file);
    const replacement = join(f.directory, "replacement.sqlite"), retained = join(f.directory, "retained-original.sqlite"); copyFileSync(f.file, replacement);
    try { renameSync(f.file, retained); }
    catch (error) {
      if (process.platform !== "win32") throw error;
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
