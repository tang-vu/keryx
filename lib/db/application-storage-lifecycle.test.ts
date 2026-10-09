import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { KeryxDB } from "./keryx-db";

const mocks = vi.hoisted(() => ({ deployment: vi.fn(), sqlite: vi.fn(), supabase: vi.fn(), terminal: vi.fn() }));
vi.mock("../config", async () => ({ config: { profile: (await import("../arc-network-profile")).ARC_TESTNET_PROFILE } }));
vi.mock("./runtime-storage-config", () => ({ readRuntimeStorageDeployment: mocks.deployment }));
vi.mock("./enrolled-sqlite-adapter", () => ({ createReadonlyEnrolledSqliteAdapter: mocks.sqlite }));
vi.mock("./enrolled-supabase-adapter", () => ({ createReadonlyEnrolledSupabaseAdapter: mocks.supabase, closeEnrolledSupabaseAdapter: mocks.terminal }));
import { createReadonlyApplicationStorage, closeReadonlyApplicationStorage } from "./application-storage";

beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("KERYX_STORAGE_MANIFEST", "own-disposable-fixture");
});
afterEach(() => vi.unstubAllEnvs());

it("pins SQLite terminal disposal at construction and can close after configuration revocation", async () => {
  const close = vi.fn(), native = { close } as unknown as KeryxDB; mocks.sqlite.mockResolvedValue(native);
  // The profile helper requires an exact network/id pair; use the existing synthetic identity shape.
  const { syntheticStorageIdentity } = await import("./storage-identity-fixture");
  mocks.deployment.mockReturnValue({ identity: syntheticStorageIdentity("testnet-offline"), backend: { kind: "sqlite" } });
  const reader = await createReadonlyApplicationStorage(); expect(reader).toBe(native);
  mocks.deployment.mockImplementation(() => { throw new Error("Revoked selected deployment"); });
  closeReadonlyApplicationStorage(reader!); expect(close).toHaveBeenCalledOnce();
  expect(() => closeReadonlyApplicationStorage(reader!)).toThrow();
});

it("closes the registered Supabase facade without touching an undeclared close property", async () => {
  const { syntheticStorageIdentity } = await import("./storage-identity-fixture");
  mocks.deployment.mockReturnValue({ identity: syntheticStorageIdentity("testnet-offline"), backend: { kind: "supabase" } });
  const native = new Proxy({}, { get(_target, property) { if (property === "then") return undefined; throw new Error("Undeclared native property"); } }) as KeryxDB;
  mocks.supabase.mockResolvedValue(native);
  const reader = await createReadonlyApplicationStorage(); expect(reader).toBe(native);
  closeReadonlyApplicationStorage(reader!); expect(mocks.terminal).toHaveBeenCalledWith(native);
});

it("refuses unrelated/caller-selected/ordinary facades without invoking their close field", () => {
  const close = vi.fn(); expect(() => closeReadonlyApplicationStorage({ close } as unknown as KeryxDB)).toThrow();
  expect(close).not.toHaveBeenCalled(); expect(mocks.terminal).not.toHaveBeenCalled();
});
