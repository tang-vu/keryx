import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountLocaleKey, configuredLocaleOrigin, createLocalePreferenceRoute, enrolledSqliteLocalePort } from "./locale-preference-route";
import { encodeLocaleValue } from "./locale-preference";
import type { KeryxDB } from "../db/keryx-db";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "../db/storage-identity";

// No DB driver imports or real database calls in these route fixtures.
const storage = vi.hoisted(() => ({ identity: vi.fn(), local: vi.fn() }));
vi.mock("../db/application-storage", () => ({ applicationStorageIdentity: storage.identity, assertApplicationStorageCurrentLocal: storage.local }));
beforeEach(() => { vi.resetAllMocks(); storage.local.mockImplementation(() => { throw new Error("Unproven facade"); }); });
const owner = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`, origin = "https://keryx.test", network = "eip155:5042";
function fixture() {
  const db = {} as KeryxDB, values = new Map<string, string>();
  const session = vi.fn(async () => ({ db, wallet: owner, currentId: "current-session-selector" }));
  const read = vi.fn(async (key: string) => values.get(key) ?? null);
  const write = vi.fn(async (key: string, value: string) => { values.set(key, value); });
  const assertCurrent = vi.fn(), port = vi.fn(async () => ({ read, write, assertCurrent }));
  const handle = createLocalePreferenceRoute({ origin, network, session, port });
  return { handle, db, values, session, read, write, port, assertCurrent };
}
function request(method = "GET", extra: Record<string, string> = {}, body = '{"version":1,"locale":"vi"}') {
  return new Request(`${origin}/api/me/locale-preference`, { method, headers: { "Origin": origin, "Sec-Fetch-Site": "same-origin",
    "X-Keryx-Expected-Wallet": owner, "X-Keryx-Locale-Network": network, "Content-Type": "application/json", ...extra }, ...(method === "PUT" ? { body } : {}) });
}
describe("private locale route", () => {
  it("derives a canonical origin only from a bounded configured base, never request Host", () => {
    expect(configuredLocaleOrigin(`${origin}/`)).toBe(origin);
    for (const base of [`${origin}/path`, `${origin}?query`, "https://user:pass@keryx.test", ` ${origin}`, "file:///private"]) expect(configuredLocaleOrigin(base)).toBeNull();
  });
  it("rejects every Authorization header, bad origin/network and missing expected owner before session/port/body", async () => {
    const cases: Record<string, string>[] = [{ Authorization: "Bearer malformed" }, { Authorization: "" }, { Origin: "https://evil.test" },
      { "Sec-Fetch-Site": "cross-site" }, { "X-Keryx-Expected-Wallet": "" }, { "X-Keryx-Locale-Network": "eip155:5042002" }];
    for (const extra of cases) {
      const f = fixture(), req = request("PUT", extra), body = vi.spyOn(req, "body", "get");
      expect((await f.handle(req)).status).not.toBe(200); expect(f.session).not.toHaveBeenCalled();
      expect(f.port).not.toHaveBeenCalled(); expect(body).not.toHaveBeenCalled();
    }
  });
  it("admits a browser GET without Origin only with exact same-origin Fetch Metadata", async () => {
    const f = fixture(), req = request(); req.headers.delete("origin");
    expect((await f.handle(req)).status).toBe(200);
    req.headers.delete("sec-fetch-site"); expect((await f.handle(req)).status).toBe(403);
  });
  it("does not load a port or private body when authentication/owner binding fails", async () => {
    const f = fixture(); f.session.mockResolvedValueOnce(new Response(null, { status: 401 }) as never);
    const req = request("PUT"), body = vi.spyOn(req, "body", "get");
    expect((await f.handle(req)).status).toBe(401); expect(f.port).not.toHaveBeenCalled(); expect(body).not.toHaveBeenCalled();
    f.session.mockResolvedValueOnce({ db: f.db, wallet: bob, currentId: "other" });
    expect((await f.handle(request("PUT"))).status).toBe(409); expect(f.write).not.toHaveBeenCalled();
  });
  it.each(["vi", "ru", "ar"] as const)("stores %s as a tiny scalar in a locale-only server-owner/network/configured-origin namespace", async locale => {
    const f = fixture(); const response = await f.handle(request("PUT", {}, JSON.stringify({ version: 1, locale })));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const key = accountLocaleKey(origin, network, owner);
    expect(f.write).toHaveBeenCalledWith(key, encodeLocaleValue(locale));
    expect(key).not.toContain("current-session-selector"); expect(key).not.toContain("registry");
    expect(accountLocaleKey(origin, network, bob)).not.toBe(key);
    expect(accountLocaleKey(origin, "eip155:5042002", owner)).not.toBe(key);
    expect(accountLocaleKey("https://other.test", network, owner)).not.toBe(key);
    const retained = await f.handle(request());
    expect(retained.status).toBe(200);
    expect(await retained.json()).toMatchObject({ version: 1, locale, owner, origin, network });
  });
  it("refuses unsupported/sealed/unknown facades without a storage fallback", async () => {
    const f = fixture(); f.port.mockResolvedValueOnce(null as never);
    expect((await f.handle(request("PUT"))).status).toBe(503); expect(f.read).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
    expect(await enrolledSqliteLocalePort({} as KeryxDB, "write", network)).toBeNull();
  });
  it("refuses corrupt values, read failures, thrown writes and unacknowledged writes honestly", async () => {
    const f = fixture(); f.values.set(accountLocaleKey(origin, network, owner), "corrupt");
    expect((await f.handle(request("PUT"))).status).toBe(503); expect(f.write).not.toHaveBeenCalled();
    f.values.clear(); f.read.mockRejectedValueOnce(new Error("private backend detail"));
    const failedRead = await f.handle(request()); expect(failedRead.status).toBe(503); expect(await failedRead.text()).not.toContain("private backend detail");
    f.write.mockRejectedValueOnce(new Error("refused")); expect((await f.handle(request("PUT"))).status).toBe(503);
    f.write.mockImplementationOnce(async () => {}); expect((await f.handle(request("PUT"))).status).toBe(503);
  });
  it("refuses oversized/invalid/extra-owner bodies and a session change before write", async () => {
    for (const body of ['{"version":1,"locale":"vi","owner":"body-owner"}', '{"version":2,"locale":"vi"}', '{"version":1,"locale":"zh-TW"}',
      '{"version":1,"locale":"ru-RU"}', '{"version":1,"locale":"ru-Latn"}', " ".repeat(65)]) {
      const f = fixture(); expect((await f.handle(request("PUT", {}, body))).status).toBe(400); expect(f.write).not.toHaveBeenCalled();
    }
    const f = fixture(); f.session.mockResolvedValueOnce({ db: f.db, wallet: owner, currentId: "old" }).mockResolvedValueOnce({ db: f.db, wallet: owner, currentId: "new" });
    expect((await f.handle(request("PUT"))).status).toBe(409); expect(f.write).not.toHaveBeenCalled();
  });
  it("does not publish a late read/write response after logout or session rotation", async () => {
    const f = fixture(); f.session.mockResolvedValueOnce({ db: f.db, wallet: owner, currentId: "old" }).mockResolvedValueOnce({ db: f.db, wallet: owner, currentId: "old" }).mockResolvedValueOnce(new Response(null, { status: 401 }) as never);
    const response = await f.handle(request("PUT")); expect(f.write).toHaveBeenCalledTimes(1); expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("does not write after retirement while reading the body, or publish after the final session await", async () => {
    const bodyFixture = fixture(), entered = deferred<void>(), gate = deferred<void>();
    const stream = new ReadableStream<Uint8Array>({ async pull(controller) {
      entered.resolve(); await gate.promise; controller.enqueue(new TextEncoder().encode('{"version":1,"locale":"vi"}')); controller.close();
    } }, { highWaterMark: 0 });
    const body = new Request(`${origin}/api/me/locale-preference`, { method: "PUT", headers: request("PUT").headers, body: stream, duplex: "half" } as RequestInit);
    const pending = bodyFixture.handle(body); await entered.promise; expect(bodyFixture.read).toHaveBeenCalledOnce();
    bodyFixture.assertCurrent.mockImplementation(() => { throw new Error("retired"); }); gate.resolve();
    expect((await pending).status).toBe(503); expect(bodyFixture.write).not.toHaveBeenCalled();
    const finalFixture = fixture();
    finalFixture.session.mockImplementationOnce(async () => ({ db: finalFixture.db, wallet: owner, currentId: "current-session-selector" }))
      .mockImplementationOnce(async () => {
        finalFixture.assertCurrent.mockImplementation(() => { throw new Error("retired during final session read"); });
        return { db: finalFixture.db, wallet: owner, currentId: "current-session-selector" };
      });
    expect((await finalFixture.handle(request())).status).toBe(503); expect(finalFixture.read).toHaveBeenCalledOnce();
  });
});

const selectedIdentity: StorageIdentity = { format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real", network,
  profileDigest: STORAGE_MAINNET_PROFILE_DIGEST, deploymentId: "11111111-1111-4111-8111-111111111111", storageId: "22222222-2222-4222-8222-222222222222",
  enrollmentId: "33333333-3333-4333-8333-333333333333", enrolledAt: "2026-10-04T00:00:00.000Z", provenanceDigest: "b".repeat(64) };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function selectedPortFixture() {
  // These are explicit dependency recordings, never installed native proof.
  const values = new Map<string, string>(), read = vi.fn(async (key: string) => values.get(key) ?? null),
    write = vi.fn(async (key: string, value: string) => { values.set(key, value); });
  const db = { getSyncState: read, setSyncState: write } as unknown as KeryxDB;
  storage.local.mockImplementation(() => {}); storage.identity.mockResolvedValue(selectedIdentity);
  return { db, values, read, write, key: accountLocaleKey(origin, network, owner) };
}
describe("selected SQLite/native locale port dependency controls", () => {
  it("awaits selected identity before method inspection, preserves all nine fields, and refreshes around read/write", async () => {
    const f = selectedPortFixture(), gate = deferred<StorageIdentity>(), entered = deferred<void>();
    storage.identity.mockImplementationOnce(() => { entered.resolve(); return gate.promise; });
    let inspected = 0;
    const db = new Proxy(f.db, { get(target, key, receiver) { inspected++; return Reflect.get(target, key, receiver); } });
    const pending = enrolledSqliteLocalePort(db, "write", network); await entered.promise;
    expect(inspected).toBe(0); expect(f.read).not.toHaveBeenCalled(); gate.resolve(selectedIdentity);
    const port = await pending; expect(port).not.toBeNull();
    await port!.write(f.key, encodeLocaleValue("vi")); expect(await port!.read(f.key)).toBe(encodeLocaleValue("vi"));
    expect(storage.identity).toHaveBeenCalledTimes(5); expect(storage.identity.mock.calls.every(call => call[0] === db && call[1] === "write")).toBe(true);
    storage.identity.mockResolvedValueOnce({ ...selectedIdentity, enrollmentId: "44444444-4444-4444-8444-444444444444" });
    await expect(port!.write(f.key, encodeLocaleValue("ru"))).rejects.toThrow("Locale storage realm mismatch");
    expect(f.write).toHaveBeenCalledOnce();
  });
  it("rejects a network mismatch before inspecting selected DB methods", async () => {
    const f = selectedPortFixture(); storage.identity.mockResolvedValue({ ...selectedIdentity, network: "eip155:5042002" });
    const db = new Proxy(f.db, { get() { throw new Error("Methods must remain untouched"); } });
    expect(await enrolledSqliteLocalePort(db, "read", network)).toBeNull();
  });
  it.each(["Supabase", "ordinary", "forged"])("rejects %s locally before async identity/method getters without fallback", async backend => {
    selectedPortFixture(); storage.local.mockImplementation(() => { throw new Error(`${backend} unavailable`); });
    let inspected = 0; const db = new Proxy({}, { get() { inspected++; throw new Error("caller field"); } }) as KeryxDB;
    expect(await enrolledSqliteLocalePort(db, "write", network)).toBeNull(); expect(inspected).toBe(0); expect(storage.identity).not.toHaveBeenCalled();
  });
  it("preserves readonly access without inspecting a writer getter or permitting writes", async () => {
    const f = selectedPortFixture(); Object.defineProperty(f.db, "setSyncState", { get() { throw new Error("Readonly writer getter"); } });
    const port = await enrolledSqliteLocalePort(f.db, "read", network); expect(port).not.toBeNull(); expect(await port!.read(f.key)).toBeNull();
    const calls = storage.identity.mock.calls.length;
    await expect(port!.write(f.key, encodeLocaleValue("vi"))).rejects.toThrow("Invalid locale storage write"); expect(storage.identity).toHaveBeenCalledTimes(calls);
  });
  it("refuses retirement during selected identity admission before any DB field inspection", async () => {
    const f = selectedPortFixture(), gate = deferred<StorageIdentity>(), entered = deferred<void>();
    storage.identity.mockImplementationOnce(() => { entered.resolve(); return gate.promise; });
    const pending = enrolledSqliteLocalePort(f.db, "write", network); await entered.promise;
    storage.local.mockImplementation(() => { throw new Error("retired"); }); gate.resolve(selectedIdentity);
    expect(await pending).toBeNull(); expect(f.read).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
  });
  it.each(["read", "write"] as const)("refuses retirement during a deferred %s without publishing or retrying", async operation => {
    const f = selectedPortFixture(), port = await enrolledSqliteLocalePort(f.db, "write", network), entered = deferred<void>(), gate = deferred<void>();
    if (operation === "read") f.read.mockImplementationOnce(async () => { entered.resolve(); await gate.promise; return null; });
    else f.write.mockImplementationOnce(async () => { entered.resolve(); await gate.promise; });
    const pending = operation === "read" ? port!.read(f.key) : port!.write(f.key, encodeLocaleValue("vi"));
    await entered.promise; storage.local.mockImplementation(() => { throw new Error("retired"); }); gate.resolve();
    await expect(pending).rejects.toThrow("retired"); expect(operation === "read" ? f.read : f.write).toHaveBeenCalledOnce();
  });
  it("refuses invalid namespace/value before async storage access", async () => {
    const f = selectedPortFixture(), port = await enrolledSqliteLocalePort(f.db, "write", network), calls = storage.identity.mock.calls.length;
    await expect(port!.read("other-namespace")).rejects.toThrow("Invalid locale namespace");
    await expect(port!.write(f.key, "corrupt")).rejects.toThrow("Invalid locale storage write");
    expect(storage.identity).toHaveBeenCalledTimes(calls); expect(f.read).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
  });
});
