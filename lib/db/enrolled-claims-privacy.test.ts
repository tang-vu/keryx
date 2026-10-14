/** Synthetic temporary SQLite only. No signature, model, funding or settlement. */
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "../canonical-json";
import type { QueryRun } from "../types";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { insertStorageIdentity, installStorageFences, registerStorageCapability } from "./storage-identity-sqlite";
import { openVerifiedSqliteStorage } from "./storage-identity-connection";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { writeSqliteQueryRun } from "./query-run-record";
import { createEnrolledSqliteRunClaims, createSqliteRunClaims } from "./run-claims-sqlite";
import { createEnrolledSqliteRunOwnershipHistory, createSqliteRunOwnershipHistory } from "./run-ownership-history-sqlite";
import { createEnrolledSqliteRunPrivacy, createSqliteRunPrivacy } from "./run-privacy-sqlite";
import { createEnrolledSqliteAdapter, createReadonlyEnrolledSqliteAdapter } from "./enrolled-sqlite-adapter";

const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const binding = { network: "eip155:5042" as const, origin: "https://synthetic-native-privacy.example" };
const actor = (wallet = alice) => ({ wallet, binding, sessionHash: hash(wallet) });
let folder: string, template: string, identity: StorageIdentity, date: string, index = 0;
const open: Array<{ close(): void }> = [];
function rows(file: string, table: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(); } finally { db.close(); }
}
function money(file: string) { return JSON.stringify(rows(file, "payment_events")); }
function edit(file: string, action: (db: DatabaseSync) => void) {
  const db = new DatabaseSync(file);
  // Explicit isolated setup actor only, never a genuine native port.
  try { registerStorageCapability(db, identity, () => true); action(db); } finally { db.close(); }
}
function native(readOnly = false, runtimeGuard?: () => void) {
  const file = join(folder, `case-${++index}.sqlite`); copyFileSync(template, file);
  const connection = openVerifiedSqliteStorage(file, identity, { readOnly, runtimeGuard,
    applicationProfiles: supportedSqliteApplicationProfiles(true) }); open.push(connection);
  return { file, connection, claims: createEnrolledSqliteRunClaims(connection.db),
    ownership: createEnrolledSqliteRunOwnershipHistory(connection.db), privacy: createEnrolledSqliteRunPrivacy(connection.db) };
}
const issue = (f: ReturnType<typeof native>, id = "anonymous") => f.claims.issue({ runId: id, completedAt: date, tokenHash: hash(id), binding });
const claim = (f: ReturnType<typeof native>, wallet = alice, id = "anonymous") => f.claims.claim({
  tokenHash: hash(id), wallet, sessionHash: hash(wallet), binding });

beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), "keryx-synthetic-native-claims-privacy-")); template = join(folder, "template.sqlite");
  identity = { ...syntheticStorageIdentity("mainnet-real"), format: "keryx-mainnet-storage-identity-v1",
    network: binding.network, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  const now = Date.now(); date = new Date(now - 1000).toISOString();
  const run = (id: string, asker?: string): QueryRun => ({ id, createdAt: date, question: `Synthetic private question ${id}`,
    answer: `Synthetic private answer ${id}`, budget: 0.03, engine: "heuristic", totalSpent: 0.012345,
    totalToCreators: 0.000001, subClaims: [], decisions: [], citations: [], trace: [], paymentMode: "offline", ...(asker ? { asker } : {}) });
  const db = new DatabaseSync(template);
  try {
    db.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(db);
    writeSqliteQueryRun(db, run("historical", alice), false);
    installNativeUserDomainSchema(db);
    for (const [id, owner] of [["owned", alice], ["foreign", bob], ["anonymous", undefined], ["anonymous-two", undefined]] as const)
      writeSqliteQueryRun(db, run(id, owner), false);
    for (const wallet of [alice, bob]) db.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run(hash(wallet), wallet, now - 2000, now + 600000);
    db.prepare("INSERT INTO payment_events(id,query_id,network,settled,settlement_status,amount_usdc,kind,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run("synthetic-pending-original", "owned", binding.network, 0, "pending", 0.005, "fetch", date);
    insertStorageIdentity(db, identity); installStorageFences(db, identity); db.exec("COMMIT");
  } finally { db.close(); }
});
afterEach(() => { for (const connection of open.splice(0)) connection.close(); vi.unstubAllEnvs(); });
afterAll(() => { if (folder) rmSync(folder, { recursive: true, force: true }); });

it("raw authority and custom native options fail, and ordinary guards still reject enrollment", () => {
  const f = native(), raw = new DatabaseSync(f.file); open.push(raw);
  for (const factory of [createEnrolledSqliteRunClaims, createEnrolledSqliteRunOwnershipHistory, createEnrolledSqliteRunPrivacy]) {
    expect(() => factory(raw)).toThrow(); expect(() => Reflect.apply(factory, undefined, [f.connection.db, {}])).toThrow();
  }
  for (const factory of [createSqliteRunClaims, createSqliteRunOwnershipHistory, createSqliteRunPrivacy]) expect(() => factory(raw)).toThrow();
});
it("new private defaults and historical unlisted links do not backfill or publish past activity", async () => {
  const f = native(), before = money(f.file);
  expect((await f.privacy.read("historical")).item?.state.visibility).toBe("unlisted");
  expect((await f.privacy.read("owned")).item).toBeNull();
  expect(await f.privacy.list({ take: 50 })).toEqual([]);
  expect(rows(f.file, "run_privacy").some(row => row.run_id === "historical")).toBe(false); expect(money(f.file)).toBe(before);
});
it("recorded ownership returns only the owner's exact original without public/private leakage", async () => {
  const f = native(); const original = rows(f.file, "query_runs").find(row => row.id === "owned")!;
  expect((await f.ownership.read(alice, binding, "owned"))?.run).toEqual(JSON.parse(String(original.data)));
  expect(await f.ownership.read(bob, binding, "owned")).toBeNull();
  expect((await f.ownership.list(alice, { binding, filters: {}, take: 51 })).map(row => row.id)).toEqual(["owned", "historical"]);
});
it("claims an eligible original exactly once without changing its data or payment owner", async () => {
  const f = native(), original = JSON.stringify(rows(f.file, "query_runs")), before = money(f.file);
  await issue(f); expect(await claim(f)).toMatchObject({ runId: "anonymous", wallet: alice, binding });
  await expect(claim(f, bob)).rejects.toThrow("claim_unavailable");
  expect(JSON.stringify(rows(f.file, "query_runs"))).toBe(original); expect(money(f.file)).toBe(before);
});
it("claimed ownership validates the retained bytes and does not turn the claimant into the payer", async () => {
  const f = native(); await issue(f); await claim(f);
  const detail = await f.ownership.read(alice, binding, "anonymous");
  expect(detail?.ownership.method).toBe("claimed"); expect(detail?.run).not.toHaveProperty("asker");
  expect((await f.ownership.list(bob, { binding, filters: {}, take: 1 })).map(row => row.id)).toEqual(["foreign"]);
});
it("active session is rechecked before any claimed ownership association", async () => {
  const f = native(); await issue(f); edit(f.file, db => db.prepare("DELETE FROM web_sessions WHERE hash=?").run(hash(alice)));
  await expect(claim(f)).rejects.toThrow("claim_unauthenticated");
  expect(rows(f.file, "anonymous_run_claims")[0].claimed_wallet).toBeNull();
});
it("changed retained bytes invalidate an unclaimed ticket", async () => {
  const f = native(); await issue(f);
  edit(f.file, db => db.prepare("UPDATE query_runs SET data=json_set(data,'$.answer','Changed synthetic text') WHERE id='anonymous'").run());
  await expect(claim(f)).rejects.toThrow("claim_unavailable");
  expect(rows(f.file, "anonymous_run_claims")[0].claimed_wallet).toBeNull();
});
it("native bindings refuse another network and origin without an association", async () => {
  const f = native(); await expect(f.claims.issue({ runId: "anonymous", completedAt: date, tokenHash: hash("anonymous"),
    binding: { ...binding, network: "eip155:5042002" } })).rejects.toThrow("claim_unavailable");
  await issue(f); await expect(f.claims.claim({ tokenHash: hash("anonymous"), wallet: alice, sessionHash: hash(alice),
    binding: { ...binding, origin: "https://other.example" } })).rejects.toThrow("claim_unavailable");
  expect(rows(f.file, "anonymous_run_claims")[0].claimed_wallet).toBeNull();
});
it("owner private read excludes a foreign owner and keeps payment state separate", async () => {
  const f = native(), before = money(f.file);
  expect((await f.privacy.read("owned", actor())).item?.run.answer).toContain("Synthetic private answer");
  expect((await f.privacy.owner("owned", actor(bob)))).toBeNull();
  expect((await f.privacy.settlement("owned"))).toMatchObject({ question: "", answer: "", totalSpent: 0.012345 });
  expect(money(f.file)).toBe(before);
});
it("visibility changes require explicit active owner authority and preserve financial records", async () => {
  const f = native(), before = money(f.file);
  await expect(f.privacy.change("owned", actor(bob), { visibility: "public", revision: 0, requestId: randomUUID() })).rejects.toThrow();
  const result = await f.privacy.change("owned", actor(), { visibility: "public", revision: 0, requestId: randomUUID() });
  expect(result.visibility).toBe("public"); expect((await f.privacy.list({ take: 50 })).map(run => run.id)).toEqual(["owned"]);
  expect(money(f.file)).toBe(before);
});
it("erasure retains exact financial amounts, original payment journal and a nonresurrectable tombstone", async () => {
  const f = native(), before = money(f.file); await f.privacy.erase("owned", actor(), { revision: 0, requestId: randomUUID() });
  expect((await f.privacy.read("owned", actor())).item).toBeNull();
  expect((await f.privacy.settlement("owned"))).toMatchObject({ totalSpent: 0.012345, totalToCreators: 0.000001 });
  expect(money(f.file)).toBe(before);
  const row = rows(f.file, "query_runs").find(value => value.id === "owned")!;
  expect(JSON.parse(String(row.data))).toMatchObject({ question: "", answer: "" });
  expect(() => edit(f.file, db => db.prepare("UPDATE query_runs SET answer='Resurrected' WHERE id='owned'").run())).toThrow();
});
it("owner export retains exact stored bytes and does not alter custody or financial state", async () => {
  const f = native(), row = rows(f.file, "query_runs").find(value => value.id === "owned")!, before = money(f.file);
  expect((await f.privacy.export("owned", actor(), randomUUID())).run).toEqual(JSON.parse(String(row.data)));
  expect(money(f.file)).toBe(before); expect(rows(f.file, "run_privacy_audit")).toHaveLength(1);
});
it("readonly native mutations refuse before SQL and leave owner reads healthy", async () => {
  let guards = 0; const f = native(true, () => { guards++; }), before = guards;
  await expect(f.privacy.change("owned", actor(), { visibility: "public", revision: 0, requestId: randomUUID() })).rejects.toThrow("privacy_unavailable");
  await expect(issue(f)).rejects.toThrow("claims_unavailable"); expect(guards).toBe(before);
  expect((await f.privacy.read("owned", actor())).item?.run.id).toBe("owned");
});
it("a real writer lock does not retire claims or the shared ownership reader", async () => {
  const f = native(), blocker = new DatabaseSync(f.file); open.push(blocker); blocker.exec("BEGIN IMMEDIATE");
  await expect(issue(f)).rejects.toThrow("claims_unavailable"); blocker.exec("ROLLBACK");
  await expect(issue(f)).resolves.toMatchObject({ runId: "anonymous" });
  expect((await f.ownership.read(alice, binding, "owned"))?.run.id).toBe("owned");
});
it("an internal native SQL guard failure cannot revive the old privacy port after restoration", async () => {
  let calls = 0, failAt = Infinity; const f = native(false, () => { if (++calls === failAt) throw Error("Synthetic internal guard failure"); });
  failAt = calls + 3; await expect(f.privacy.read("owned", actor())).rejects.toThrow(); failAt = Infinity;
  await expect(f.privacy.read("owned", actor())).rejects.toThrow("privacy_unavailable");
});
it("the actual frozen facade uses captured privacy for public queries and readonly owner access", async () => {
  const file = join(folder, "facade.sqlite"), manifest = join(folder, "deployment.json"); copyFileSync(template, file);
  writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } }));
  vi.stubEnv("KERYX_STORAGE_MANIFEST", manifest); vi.stubEnv("KERYX_SQLITE_PATH", file); vi.stubEnv("KERYX_FORCE_OFFLINE", "0");
  vi.stubEnv("CONTENT_MASTER_KEY", "11".repeat(32)); vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true"); vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "true");
  const writer = await createEnrolledSqliteAdapter(); open.push(writer); const reader = await createReadonlyEnrolledSqliteAdapter(); open.push(reader);
  for (const db of [writer, reader]) {
    expect(Object.isFrozen(db)).toBe(true); expect(db.runPrivacyActive).toBe(true);
    for (const name of ["runClaims", "runOwnershipHistory", "runPrivacy"]) expect(Object.getOwnPropertyDescriptor(db, name)?.enumerable).toBe(false);
  }
  expect(await writer.listRecentQueries(10)).toEqual([]);
  expect((await reader.runPrivacy!.read("owned", actor())).item?.run.id).toBe("owned");
});
