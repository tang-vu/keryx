import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ selector: vi.fn(), sqlite: vi.fn(), supabase: vi.fn() }));
vi.mock("./runtime-storage-config", () => ({ readRuntimeStorageDeployment: mocks.selector }));
vi.mock("./sqlite-adapter", () => ({ SqliteAdapter: mocks.sqlite }));
vi.mock("./supabase-adapter", () => ({ SupabaseAdapter: mocks.supabase }));

const identity = { format: "keryx-storage-identity-v1", deploymentId: "11111111-1111-4111-8111-111111111111",
  storageId: "22222222-2222-4222-8222-222222222222", enrollmentId: "33333333-3333-4333-8333-333333333333",
  network: "eip155:5042002", authorityMode: "testnet-real", profileDigest: "aa".repeat(32),
  provenanceDigest: "bb".repeat(32), enrolledAt: "2026-10-01T00:00:00.000Z" };
const deployment = (supabase: boolean) => ({ identity, backend: supabase ? { kind: "supabase", url: "https://synthetic.supabase.co" }
  : { kind: "sqlite", databasePath: "explicit-synthetic.sqlite" } });

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => { vi.resetModules(); vi.resetAllMocks(); });

describe.each([false, true])("getDb initialization (Supabase: %s)", (useSupabase) => {
  it("holds every concurrent caller until the single selected adapter is ready", async () => {
    const gate = deferred(), started = deferred();
    const adapter = { init: vi.fn(() => { started.resolve(); return gate.promise; }) };
    const selected = useSupabase ? mocks.supabase : mocks.sqlite;
    const unused = useSupabase ? mocks.sqlite : mocks.supabase;
    mocks.selector.mockReturnValue(deployment(useSupabase));
    selected.mockImplementation(function () { return adapter; });
    const { getDb } = await import("./index");
    const first = getDb();
    await started.promise;
    // Every caller revalidates the pinned manifest, while initialization remains single-flight.
    mocks.selector.mockReturnValue(deployment(useSupabase));
    const second = getDb(), third = getDb();
    let returned = 0;
    for (const pending of [first, second, third]) void pending.then(() => { returned++; });
    await Promise.resolve();
    await Promise.resolve();
    expect(returned).toBe(0);
    expect(selected).toHaveBeenCalledTimes(1);
    expect(unused).not.toHaveBeenCalled();
    expect(selected).toHaveBeenCalledWith(...(useSupabase ? [identity] : ["explicit-synthetic.sqlite", { expectedIdentity: identity }]));
    expect(mocks.selector).toHaveBeenCalledTimes(3);
    gate.resolve();
    expect(await Promise.all([first, second, third])).toEqual([adapter, adapter, adapter]);
    expect(await getDb()).toBe(adapter);
    expect(adapter.init).toHaveBeenCalledTimes(1);
    expect(mocks.selector).toHaveBeenCalledTimes(4);
  });

  it("rejects all waiting callers and retries with a fresh adapter after init failure", async () => {
    const gate = deferred(), started = deferred();
    const failure = new Error("initialization failed");
    const close = vi.fn();
    const partial = { init: vi.fn(() => { started.resolve(); return gate.promise; }),
      ...(!useSupabase ? { close } : {}) };
    const ready = { init: vi.fn(async () => {}) };
    const selected = useSupabase ? mocks.supabase : mocks.sqlite;
    mocks.selector.mockReturnValue(deployment(useSupabase));
    selected.mockImplementationOnce(function () { return partial; }).mockImplementation(function () { return ready; });
    const { getDb } = await import("./index");
    const first = getDb();
    await started.promise;
    const second = getDb();
    const outcomes = Promise.allSettled([first, second]);
    gate.reject(failure);
    expect(await outcomes).toEqual([{ status: "rejected", reason: failure }, { status: "rejected", reason: failure }]);
    expect(selected).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(useSupabase ? 0 : 1);
    expect(await getDb()).toBe(ready);
    expect(await getDb()).toBe(ready);
    expect(selected).toHaveBeenCalledTimes(2);
    expect(ready.init).toHaveBeenCalledTimes(1);
  });

  it("does not cache a constructor failure", async () => {
    const failure = new Error("construction failed");
    const ready = { init: vi.fn(async () => {}) };
    const selected = useSupabase ? mocks.supabase : mocks.sqlite;
    mocks.selector.mockReturnValue(deployment(useSupabase));
    selected.mockImplementationOnce(function () { throw failure; }).mockImplementation(function () { return ready; });
    const { getDb } = await import("./index");
    await expect(getDb()).rejects.toBe(failure);
    expect(await getDb()).toBe(ready);
  });
});

it("preserves init failure and allows fresh retry even when SQLite cleanup throws", async () => {
  const failure = new Error("init failure");
  const close = vi.fn(() => { throw new Error("close failure"); });
  const partial = { init: vi.fn(async () => { throw failure; }), close };
  const ready = { init: vi.fn(async () => {}) };
  mocks.selector.mockReturnValue(deployment(false));
  mocks.sqlite.mockImplementationOnce(function () { return partial; }).mockImplementation(function () { return ready; });
  const { getDb } = await import("./index");
  await expect(getDb()).rejects.toBe(failure);
  expect(close).toHaveBeenCalledTimes(1);
  expect(await getDb()).toBe(ready);
});

it("refuses changed or unavailable runtime configuration before returning a cached adapter", async () => {
  const ready = { init: vi.fn(async () => {}), listPayments: vi.fn() };
  mocks.selector.mockReturnValue(deployment(false)); mocks.sqlite.mockImplementation(function () { return ready; });
  const { getDb } = await import("./index"); expect(await getDb()).toBe(ready);
  const refusal = new Error("Storage deployment configuration unavailable");
  mocks.selector.mockImplementation(() => { throw refusal; });
  await expect(getDb()).rejects.toBe(refusal); expect(mocks.sqlite).toHaveBeenCalledTimes(1);
  expect(ready.listPayments).not.toHaveBeenCalled();
});
