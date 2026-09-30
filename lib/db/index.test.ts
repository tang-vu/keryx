import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ selector: vi.fn(), sqlite: vi.fn(), supabase: vi.fn() }));
vi.mock("../config", () => ({ hasSupabase: mocks.selector }));
vi.mock("./sqlite-adapter", () => ({ SqliteAdapter: mocks.sqlite }));
vi.mock("./supabase-adapter", () => ({ SupabaseAdapter: mocks.supabase }));

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
    mocks.selector.mockReturnValue(useSupabase);
    selected.mockImplementation(function () { return adapter; });
    const { getDb } = await import("./index");
    const first = getDb();
    await started.promise;
    // Changing the selector mid-initialization must not create another adapter.
    mocks.selector.mockReturnValue(!useSupabase);
    const second = getDb(), third = getDb();
    let returned = 0;
    for (const pending of [first, second, third]) void pending.then(() => { returned++; });
    await Promise.resolve();
    await Promise.resolve();
    expect(returned).toBe(0);
    expect(selected).toHaveBeenCalledTimes(1);
    expect(unused).not.toHaveBeenCalled();
    expect(mocks.selector).toHaveBeenCalledTimes(1);
    gate.resolve();
    expect(await Promise.all([first, second, third])).toEqual([adapter, adapter, adapter]);
    expect(await getDb()).toBe(adapter);
    expect(adapter.init).toHaveBeenCalledTimes(1);
    expect(mocks.selector).toHaveBeenCalledTimes(1);
  });

  it("rejects all waiting callers and retries with a fresh adapter after init failure", async () => {
    const gate = deferred(), started = deferred();
    const failure = new Error("initialization failed");
    const close = vi.fn();
    const partial = { init: vi.fn(() => { started.resolve(); return gate.promise; }),
      ...(!useSupabase ? { close } : {}) };
    const ready = { init: vi.fn(async () => {}) };
    const selected = useSupabase ? mocks.supabase : mocks.sqlite;
    mocks.selector.mockReturnValue(useSupabase);
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
    mocks.selector.mockReturnValue(useSupabase);
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
  mocks.selector.mockReturnValue(false);
  mocks.sqlite.mockImplementationOnce(function () { return partial; }).mockImplementation(function () { return ready; });
  const { getDb } = await import("./index");
  await expect(getDb()).rejects.toBe(failure);
  expect(close).toHaveBeenCalledTimes(1);
  expect(await getDb()).toBe(ready);
});
