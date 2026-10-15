import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { insertStorageIdentity, installStorageFences, registerStorageCapability } from "./storage-identity-sqlite";
import { openVerifiedSqliteStorage } from "./storage-identity-connection";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { createEnrolledSqliteTopicWatches, type TopicWatchSession } from "./topic-watches-sqlite";
import { controlTopicWatch, createTopicWatch, runTopicWatchCheck, type TopicWatchDependencies, type TopicWatchState } from "../research/topic-watches";

const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
const directories: string[] = [], connections: { close(): void }[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const connection of connections.splice(0)) connection.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture(present = true) {
  const directory = mkdtempSync(join(tmpdir(), "keryx-native-watch-")); directories.push(directory);
  const file = join(directory, "native.sqlite");
  const identity: StorageIdentity = { ...syntheticStorageIdentity("testnet-real"), format: "keryx-mainnet-storage-identity-v1",
    authorityMode: "mainnet-real", network: "eip155:5042", profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  const issuedAt = Date.now() - 1000, expiresAt = issuedAt + 86_400_000;
  const session: TopicWatchSession = { hash: "c".repeat(64), wallet: alice, issuedAt, expiresAt };
  const raw = new DatabaseSync(file);
  raw.exec("BEGIN"); installMainnetApplicationSchema(raw); if (present) installNativeUserDomainSchema(raw);
  raw.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run(session.hash, session.wallet, issuedAt, expiresAt);
  raw.prepare("INSERT INTO sync_state(key,value,updated_at) VALUES('retained',CAST(X'fffe00' AS TEXT),NULL)").run();
  insertStorageIdentity(raw, identity); installStorageFences(raw, identity); raw.exec("COMMIT"); raw.close();
  const open = (readOnly = false) => {
    const connection = openVerifiedSqliteStorage(file, identity, { readOnly, runtimeGuard() {}, applicationProfiles: supportedSqliteApplicationProfiles(true) });
    connections.push(connection); return connection;
  };
  const mutate = (operation: (db: DatabaseSync) => void) => {
    const db = new DatabaseSync(file); try { registerStorageCapability(db, identity, () => true); operation(db); } finally { db.close(); }
  };
  const bind = (readOnly = false, authority = session) => createEnrolledSqliteTopicWatches(open(readOnly).db)!.bindSession(authority);
  const spec = { watchId: "watch", question: "Local metadata", keywords: ["transformer"], authors: [], venues: [],
    cadenceMs: 60_000, periodMs: 86_400_000, maximumChecksPerPeriod: 4, maximumRowsPerCheck: 32, maximumDigestItems: 16,
    expiresAtMs: Date.now() + 86_400_000, requestedCaps: { perCheckMicroUsdc: 0, perPeriodMicroUsdc: 0 },
    consent: { manualMetadata: true as const, emptyHeartbeat: false } };
  const key = { ownerWallet: alice, watchId: spec.watchId };
  const deps = (store = bind()): TopicWatchDependencies => ({ store, now: Date.now, isOwnerCurrent: owner => owner === alice,
    metadata: { read: async () => ({ version: 1, scope: "metadata-only", status: "empty", complete: true, rows: [] }) } });
  return { file, session, open, mutate, bind, spec, key, deps };
}
describe("selected native private watches (authored, UNRUN)", () => {
  it("uses two genuine connections for overlapping claim/CAS, not a mock or a private Map", async () => {
    const f = fixture(), first = f.bind(), second = f.bind(), a = f.deps(first), b = f.deps(second);
    expect(await createTopicWatch(a, alice, f.spec)).toMatchObject({ status: "created" });
    let entered!: () => void, finish!: (value: unknown) => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    a.metadata.read = () => { entered(); return new Promise(resolve => { finish = resolve; }); };
    const running = runTopicWatchCheck(a, f.key); await waiting;
    expect(await runTopicWatchCheck(b, f.key)).toMatchObject({ status: "overlap" });
    const claimed = await second.read(f.key) as TopicWatchState;
    expect(await second.compareAndSwap(f.key, claimed.revision - 1, { ...claimed, revision: claimed.revision }, Date.now() + 1000)).toBe(false);
    finish({ version: 1, scope: "metadata-only", status: "empty", complete: true, rows: [] });
    expect(await running).toMatchObject({ status: "unchanged", paidRequests: 0 });
    expect((await first.read(f.key) as TopicWatchState).history).toHaveLength(1);
  });
  it("compares trusted store time strictly before the CAS deadline and retains complete state", async () => {
    const f = fixture(), store = f.bind(); await createTopicWatch(f.deps(store), alice, f.spec);
    const before = await store.read(f.key) as TopicWatchState;
    expect(await store.compareAndSwap(f.key, before.revision, { ...before, revision: before.revision + 1, status: "paused" }, Date.now() - 1)).toBe(false);
    expect(await store.read(f.key)).toEqual(before);
    expect(await store.compareAndSwap(f.key, before.revision, { ...before, revision: before.revision + 1, status: "paused" }, Date.now() + 30_000)).toBe(true);
    expect(await store.read(f.key)).toEqual({ ...before, revision: before.revision + 1, status: "paused" });
  });
  it("admits exactly one of two real connection CAS writes from the same revision", async () => {
    const f = fixture(), first = f.bind(), second = f.bind(); await createTopicWatch(f.deps(first), alice, f.spec);
    const state = await first.read(f.key) as TopicWatchState;
    const outcomes = await Promise.all([first, second].map(store => store.compareAndSwap(f.key, 1,
      { ...state, revision: 2, status: "paused" }, Date.now() + 30_000)));
    expect(outcomes.filter(Boolean)).toHaveLength(1); expect((await second.read(f.key) as TopicWatchState).revision).toBe(2);
  });
  it("a genuine native BUSY refuses once, then remains usable after the competing transaction rolls back", async () => {
    const f = fixture(), store = f.bind(); await createTopicWatch(f.deps(store), alice, f.spec);
    const state = await store.read(f.key) as TopicWatchState;
    const competitor = new DatabaseSync(f.file);
    try {
      competitor.exec("BEGIN IMMEDIATE");
      await expect(store.compareAndSwap(f.key, 1, { ...state, revision: 2, status: "paused" }, Date.now() + 30_000)).rejects.toThrow();
      competitor.exec("ROLLBACK");
      expect(await store.compareAndSwap(f.key, 1, { ...state, revision: 2, status: "paused" }, Date.now() + 30_000)).toBe(true);
    } finally { competitor.close(); }
  }, 15000);
  it("never restores admitted capacity, terminal history or watermark through a complete-state replacement", async () => {
    const f = fixture(), store = f.bind(), deps = f.deps(store); await createTopicWatch(deps, alice, f.spec); await runTopicWatchCheck(deps, f.key);
    const state = await store.read(f.key) as TopicWatchState;
    // This would be a valid fresh-state shape, but is not a valid transition.
    const reset = { ...state, revision: state.revision + 1, nextSlot: 0, history: [], watermark: [], period: { index: 0, attempts: 0 } };
    expect(await store.compareAndSwap(f.key, state.revision, reset, Date.now() + 30_000)).toBe(false);
    expect(await store.read(f.key)).toEqual(state);
  });
  it.each(["pause", "cancel", "revoke", "replace", "expire"] as const)("suppresses completion after %s during awaited metadata", async mode => {
    const f = fixture(), store = f.bind(), a = f.deps(store), b = f.deps(f.bind());
    let clock = Date.now(); a.now = () => clock;
    await createTopicWatch(a, alice, f.spec);
    let entered!: () => void, finish!: (value: unknown) => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    a.metadata.read = () => { entered(); return new Promise(resolve => { finish = resolve; }); };
    const running = runTopicWatchCheck(a, f.key); await waiting;
    if (mode === "pause" || mode === "cancel") await controlTopicWatch(b, f.key, mode === "pause" ? "paused" : "cancelled");
    if (mode === "expire") clock = f.spec.expiresAtMs;
    if (mode === "revoke") f.mutate(db => { db.prepare("DELETE FROM web_sessions WHERE hash=?").run(f.session.hash); });
    if (mode === "replace") f.mutate(db => { db.prepare("UPDATE web_sessions SET issued_at=issued_at+1 WHERE hash=?").run(f.session.hash); });
    finish({ version: 1, scope: "metadata-only", status: "empty", complete: true, rows: [] });
    const output = await running;
    expect(["interrupted", "refused"]).toContain(output.status); expect(output.digest).toBeUndefined(); expect(output.paidRequests).toBe(0);
  });
  it("retains cancellation tombstones across both connections; pause/resume never rewinds history", async () => {
    const f = fixture(), a = f.deps(), b = f.deps(); await createTopicWatch(a, alice, f.spec);
    expect(await controlTopicWatch(a, f.key, "paused")).toMatchObject({ status: "controlled" });
    expect(await runTopicWatchCheck(b, f.key)).toMatchObject({ status: "refused", code: "paused" });
    expect(await controlTopicWatch(b, f.key, "active")).toMatchObject({ status: "controlled" });
    await runTopicWatchCheck(a, f.key);
    expect(await controlTopicWatch(b, f.key, "cancelled")).toMatchObject({ status: "controlled" });
    expect(await controlTopicWatch(a, f.key, "active")).toMatchObject({ status: "refused", code: "cancelled" });
    expect(await createTopicWatch(a, alice, f.spec)).toMatchObject({ status: "conflict" });
    expect((await a.store.read(f.key) as TopicWatchState).history).toHaveLength(1);
  });
  it("rejects cross-owner reads/writes and expired original sessions", async () => {
    const f = fixture(), store = f.bind(); await createTopicWatch(f.deps(store), alice, f.spec);
    await expect(store.read({ ...f.key, ownerWallet: bob })).rejects.toThrow("watch_session_changed");
    await expect(f.bind(false, { ...f.session, wallet: bob }).list()).rejects.toThrow("watch_session_changed");
    f.mutate(db => { db.prepare("UPDATE web_sessions SET issued_at=?,expires_at=? WHERE hash=?").run(Date.now() - 2000, Date.now() - 1, f.session.hash); });
    await expect(store.read(f.key)).rejects.toThrow("watch_session_changed");
  });
  it("refuses a readonly writer before SQL and preserves the healthy reader", async () => {
    const f = fixture(), a = f.deps(); await createTopicWatch(a, alice, f.spec);
    const readonly = f.bind(true), before = await readonly.read(f.key) as TopicWatchState;
    const prepare = vi.spyOn(DatabaseSync.prototype, "prepare"), exec = vi.spyOn(DatabaseSync.prototype, "exec");
    await expect(readonly.compareAndSwap(f.key, before.revision, { ...before, revision: 2 }, Date.now() + 1000)).rejects.toThrow();
    expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
    prepare.mockRestore(); exec.mockRestore(); expect(await readonly.read(f.key)).toEqual(before);
  });
  it("refuses ordinary/missing/unknown shapes without constructor DDL or fallback", () => {
    const ordinary = new DatabaseSync(":memory:"); expect(() => createEnrolledSqliteTopicWatches(ordinary)).toThrow();
    const legacy = fixture(false); expect(createEnrolledSqliteTopicWatches(legacy.open().db)).toBeUndefined();
    const unknown = fixture(); unknown.mutate(db => db.exec("CREATE TABLE unexpected(x)")); expect(() => unknown.open()).toThrow();
  });
  it("permanently revokes on schema drift even if the alien table is later removed", async () => {
    const f = fixture(), store = f.bind(); f.mutate(db => db.exec("CREATE TABLE unexpected(x)"));
    await expect(store.list()).rejects.toThrow(); f.mutate(db => db.exec("DROP TABLE unexpected")); await expect(store.list()).rejects.toThrow();
  });
  it("permanently revokes uncertain commit acknowledgements without a second write", async () => {
    const f = fixture(), store = f.bind(), original = DatabaseSync.prototype.exec;
    let throwOnce = true;
    const spy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
      Reflect.apply(original, this, [sql]);
      if (sql === "COMMIT" && throwOnce) { throwOnce = false; throw new Error("acknowledgement lost"); }
    });
    await expect(store.list()).rejects.toThrow(); spy.mockRestore(); await expect(store.list()).rejects.toThrow();
  });
});
