import { afterEach, describe, expect, it, vi } from "vitest";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";
import { gatewayNetworkProfile } from "./gateway-network";

const address = `0x${"a".repeat(40)}`;
const response = () => Response.json({ token: "USDC", balances: [
  { depositor: address, domain: 26, balance: "0.050001", pendingBatch: "0.000001" },
] });

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

describe("deployment-bound Gateway balance reads", () => {
  it.each([ARC_TESTNET_PROFILE, ARC_MAINNET_PROFILE])("uses the captured $name service for grant and watchdog reads", async profile => {
    vi.stubEnv("KERYX_NETWORK", profile.name); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", profile.name);
    vi.resetModules();
    const balance = await import("./gateway-balance");
    // A later configuration mutation cannot silently switch one running service.
    const other = profile.testnet ? ARC_MAINNET_PROFILE : ARC_TESTNET_PROFILE;
    vi.stubEnv("KERYX_NETWORK", other.name); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", other.name);
    const http = vi.fn(async () => response());
    vi.stubGlobal("fetch", http);
    expect(await balance.getGatewayAvailableAtomic(address)).toBe(BigInt(50001));
    expect((await balance.getGatewayHeldUsdc([address])).get(address)).toBeCloseTo(0.050002);
    expect(http).toHaveBeenCalledTimes(2);
    for (const call of http.mock.calls as unknown as [string, RequestInit][]) {
      expect(call[0]).toBe(`${profile.gatewayApiUrl}/v1/balances`);
      expect(call[1]).toMatchObject({ redirect: "error", cache: "no-store", signal: expect.any(AbortSignal) });
      expect(JSON.parse(String(call[1].body))).toEqual({ token: "USDC", sources: [{ depositor: address, domain: 26 }] });
    }
  });

  it.each(["eip155:1", "arc", "arcTestnet", "eip155:5042 ", "", undefined])("refuses noncanonical deployment network %s without HTTP", async network => {
    const http = vi.fn();
    vi.stubGlobal("fetch", http);
    expect(() => gatewayNetworkProfile(network as string)).toThrow(/unsupported Gateway payment network/);
    expect(http).not.toHaveBeenCalled();
  });

  it("refuses mismatched server/public deployment labels before HTTP", async () => {
    vi.stubEnv("KERYX_NETWORK", "arc"); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arcTestnet"); vi.resetModules();
    const http = vi.fn(); vi.stubGlobal("fetch", http);
    await expect(import("./gateway-balance")).rejects.toThrow(/must match/);
    expect(http).not.toHaveBeenCalled();
  });

  it("maps only the exact canonical retained networks to immutable pins", () => {
    expect(gatewayNetworkProfile("eip155:5042002")).toBe(ARC_TESTNET_PROFILE);
    expect(gatewayNetworkProfile("eip155:5042")).toBe(ARC_MAINNET_PROFILE);
  });
});
