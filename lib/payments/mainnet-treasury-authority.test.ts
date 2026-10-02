import { afterEach, expect, it, vi } from "vitest";
import type { KeryxDB } from "../db/keryx-db";
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules(); });
function mainnet() {
  vi.resetModules(); vi.stubEnv("KERYX_NETWORK", "arc"); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arc");
  vi.stubEnv("KERYX_REGISTRY_ADDRESS", `0x${"55".repeat(20)}`); vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS", `0x${"55".repeat(20)}`);
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0");
}
it("refuses unfunded mainnet treasury requests without inventing offline settlement", async () => {
  mainnet(); vi.stubEnv("AGENT_FUNDER_PRIVATE_KEY", ""); vi.stubEnv("KERYX_FUNDER_PRIVATE_KEY", "");
  const { getPaymentGateway } = await import("./payment-gateway");
  await expect(getPaymentGateway({} as KeryxDB)).rejects.toThrow("Enrolled SQLite adapter unavailable");
});
it("refuses accidental legacy treasury keys before opening the persistent wallet or constructing a signer", async () => {
  mainnet(); vi.stubEnv("AGENT_FUNDER_PRIVATE_KEY", `0x${"11".repeat(32)}`);
  const persistent = await import("./persistent-treasury-wallet");
  const load = vi.spyOn(persistent, "loadPersistentTreasuryWallet");
  const { RealGateway } = await import("./real-gateway");
  expect(() => new RealGateway()).toThrow("Mainnet treasury authority requires reviewed funding and custody admission");
  const { getPaymentGateway } = await import("./payment-gateway");
  await expect(getPaymentGateway({} as KeryxDB)).rejects.toThrow("Enrolled SQLite adapter unavailable");
  expect(load).not.toHaveBeenCalled();
});
