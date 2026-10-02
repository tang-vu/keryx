import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE, type ArcNetworkProfile } from "../arc-network-profile";
import { STORAGE_MAINNET_PROFILE_DIGEST, STORAGE_TESTNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";

const state = vi.hoisted(() => ({ profile: undefined as ArcNetworkProfile | undefined,
  deployment: vi.fn(), sqliteRead: vi.fn(), supabaseRead: vi.fn(), sqliteWrite: vi.fn(), supabaseWrite: vi.fn() }));
vi.mock("../config", () => ({ config: { get profile() { return state.profile; } } }));
vi.mock("./runtime-storage-config", () => ({ readRuntimeStorageDeployment: state.deployment }));
vi.mock("./enrolled-sqlite-adapter", () => ({ createEnrolledSqliteAdapter: state.sqliteWrite,
  createReadonlyEnrolledSqliteAdapter: state.sqliteRead, assertEnrolledSqliteAdapter: vi.fn() }));
vi.mock("./enrolled-supabase-adapter", () => ({ createEnrolledSupabaseAdapter: state.supabaseWrite,
  createReadonlyEnrolledSupabaseAdapter: state.supabaseRead }));
import { createReadonlyApplicationStorage } from "./application-storage";

function identity(mainnet: boolean): StorageIdentity {
  return { format: mainnet ? "keryx-mainnet-storage-identity-v1" : "keryx-storage-identity-v1",
    network: mainnet ? "eip155:5042" : "eip155:5042002", authorityMode: mainnet ? "mainnet-real" : "testnet-real",
    profileDigest: mainnet ? STORAGE_MAINNET_PROFILE_DIGEST : STORAGE_TESTNET_PROFILE_DIGEST,
    deploymentId: "8e6833f4-fcde-4241-a6a6-bd6071567296", storageId: "9e6833f4-fcde-4241-a6a6-bd6071567296",
    enrollmentId: "ae6833f4-fcde-4241-a6a6-bd6071567296", enrolledAt: "2026-10-02T00:00:00.000Z", provenanceDigest: "a".repeat(64) };
}
beforeEach(() => { vi.resetAllMocks(); state.profile = ARC_MAINNET_PROFILE; });
afterEach(() => { vi.unstubAllEnvs(); expect(state.sqliteWrite).not.toHaveBeenCalled(); expect(state.supabaseWrite).not.toHaveBeenCalled(); });

it.each(["sqlite", "supabase"])("uses only the sealed %s read-only facade without ordinary initialization", async kind => {
  const facade = { init: vi.fn() };
  state.deployment.mockReturnValue({ identity: identity(true), backend: { kind } });
  const selected = kind === "sqlite" ? state.sqliteRead : state.supabaseRead;
  selected.mockResolvedValue(facade);
  await expect(createReadonlyApplicationStorage()).resolves.toBe(facade);
  expect(selected).toHaveBeenCalledExactlyOnceWith();
  expect(kind === "sqlite" ? state.supabaseRead : state.sqliteRead).not.toHaveBeenCalled();
  expect(facade.init).not.toHaveBeenCalled();
});
it("refuses a historical testnet store under mainnet before constructing either facade", async () => {
  state.deployment.mockReturnValue({ identity: identity(false), backend: { kind: "sqlite" } });
  await expect(createReadonlyApplicationStorage()).rejects.toThrow("identity_mismatch");
  expect(state.sqliteRead).not.toHaveBeenCalled(); expect(state.supabaseRead).not.toHaveBeenCalled();
});
it("keeps undeclared testnet on its legacy read-only caller path", async () => {
  state.profile = ARC_TESTNET_PROFILE; vi.stubEnv("KERYX_STORAGE_MANIFEST", undefined);
  await expect(createReadonlyApplicationStorage()).resolves.toBeUndefined(); expect(state.deployment).not.toHaveBeenCalled();
});
it("never falls back from unavailable sealed mainnet storage", async () => {
  state.deployment.mockImplementation(() => { throw new Error("Storage unavailable"); });
  await expect(createReadonlyApplicationStorage()).rejects.toThrow("Storage unavailable");
  expect(state.sqliteRead).not.toHaveBeenCalled(); expect(state.supabaseRead).not.toHaveBeenCalled();
});
