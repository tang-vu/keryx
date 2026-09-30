import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { canonicalJson } from "../canonical-json";
import { syntheticStorageIdentity } from "../db/storage-identity-fixture";
import type { KeryxDB } from "../db/keryx-db";
const calls = vi.hoisted(() => ({ fund: vi.fn(), fetch: vi.fn(), cite: vi.fn(), address: vi.fn(), grant: vi.fn() }));
vi.mock("./offline-gateway", () => ({ OfflineGateway: class {
  mode = "offline"; ensureFunded = calls.fund; payFetch = calls.fetch; payCitation = calls.cite; agentAddress = calls.address;
} }));
vi.mock("./real-gateway", () => ({ RealGateway: class {
  mode = "real"; ensureFunded = calls.fund; payFetch = calls.fetch; payCitation = calls.cite; agentAddress = calls.address;
} }));
vi.mock("./browser-cosign-gateway", () => ({ BrowserCoSignGateway: class {
  mode = "real"; ensureFunded = calls.fund; payFetch = calls.fetch; payCitation = calls.cite; agentAddress = calls.address;
} }));
vi.mock("./session-grants", () => ({ getGrant: calls.grant }));
vi.mock("../config", () => ({ config: { funderKey: "synthetic-unread-transport-key" } }));

it.each(["offline", "treasury", "browser"])("retains %s gateway but refuses changed mode/store/backend or missing target before public operations", async kind => {
  for (const change of ["mode", "store", "backend", "missing"]) {
    vi.resetModules(); vi.clearAllMocks(); calls.grant.mockResolvedValue({ sessAddr: "synthetic", grantEpoch: "synthetic" });
    const directory = mkdtempSync(join(tmpdir(), "keryx-gateway-lifetime-"));
    try {
      const store = join(directory, "a.sqlite"), other = join(directory, "b.sqlite"), manifest = join(directory, "manifest.json");
      writeFileSync(store, "synthetic transport fixture"); writeFileSync(other, "synthetic transport fixture");
      const identity = syntheticStorageIdentity(kind === "offline" ? "testnet-offline" : "testnet-real");
      const original = { format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: store } };
      writeFileSync(manifest, canonicalJson(original));
      vi.stubEnv("KERYX_STORAGE_MANIFEST", manifest); vi.stubEnv("KERYX_SQLITE_PATH", store); vi.stubEnv("KERYX_FORCE_OFFLINE", "0");
      const db = { getStorageIdentity: () => identity } as KeryxDB;
      const { getPaymentGateway } = await import("./payment-gateway");
      const gateway = await getPaymentGateway(db, kind === "browser" ? { sessionId: "selected", requestSignature: vi.fn() } : undefined);
      if (change === "missing") unlinkSync(store);
      else {
        writeFileSync(manifest, canonicalJson({ ...original,
          ...(change === "mode" ? { identity: { ...identity, authorityMode: kind === "offline" ? "testnet-real" : "testnet-offline" } } : {}),
          ...(change === "store" ? { backend: { kind: "sqlite", databasePath: other } } : {}),
          ...(change === "backend" ? { backend: { kind: "supabase", url: "https://synthetic.supabase.co" } } : {}) }));
        if (change === "store") vi.stubEnv("KERYX_SQLITE_PATH", other);
      }
      await expect(gateway.ensureFunded(1)).rejects.toThrow("configuration unavailable");
      await expect(gateway.payFetch({} as Parameters<typeof gateway.payFetch>[0])).rejects.toThrow("configuration unavailable");
      await expect(gateway.payCitation({} as Parameters<typeof gateway.payCitation>[0])).rejects.toThrow("configuration unavailable");
      expect(() => gateway.agentAddress()).toThrow("configuration unavailable"); expect(() => gateway.mode).toThrow("configuration unavailable");
      for (const method of [calls.fund, calls.fetch, calls.cite, calls.address]) expect(method).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); rmSync(directory, { recursive: true }); }
  }
});
