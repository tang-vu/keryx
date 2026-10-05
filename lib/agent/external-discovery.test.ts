import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";

const state = vi.hoisted(() => ({ marketplace: vi.fn(), config: {
  networkId: "eip155:5042", externalDiscovery: true, externalDiscoveryLimit: 10, embeddingApiKey: "",
} }));
vi.mock("../config", () => ({ config: state.config }));
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return { exec: Object.assign(vi.fn(), { [promisify.custom]: state.marketplace }) };
});

function marketplaceItems() {
  return [ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE].map(profile => ({
    name: `${profile.name} weather`, resource: `https://${profile.name}.example/weather`,
    description: "Weather data", accepts: [{ network: profile.networkId, amount: "2000", payTo: `${profile.name}-payee` }],
  }));
}

beforeEach(() => {
  vi.resetModules();
  state.marketplace.mockReset().mockResolvedValue({ stdout: JSON.stringify({ data: { items: marketplaceItems() } }) });
  state.config.externalDiscovery = true;
});
afterEach(() => vi.unstubAllGlobals());

describe("external marketplace selected-network metadata", () => {
  it.each([ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE])("matches $name without accepting the other network as compatible", async (profile) => {
    state.config.networkId = profile.networkId;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { discoverExternalCandidates } = await import("./external-discovery");
    const candidates = await discoverExternalCandidates("weather", []);
    expect(candidates).toHaveLength(2);
    for (const candidate of candidates) {
      const matches = candidate.name.startsWith(profile.name + " ");
      expect(candidate.external?.onArc).toBe(matches);
      expect(candidate.id).toBe(`ext:${candidate.external?.resource}`);
      expect(candidate.fetchPrice).toBe(0.002);
      expect(candidate.description).toContain(matches ? "— includes Keryx's selected network" : "— does not include Keryx's selected network");
      expect(candidate.description).toContain("Discovery-only: evaluated but never purchased by Keryx");
      expect(candidate.external?.payTo).toBe(`${candidate.name.split(" ")[0]}-payee`);
    }
    expect(candidates[0].external?.chains).toEqual(["Arc mainnet"]);
    expect(candidates[1].external?.chains).toEqual(["Arc testnet"]);
    expect(state.marketplace).toHaveBeenCalledExactlyOnceWith("circle services search --output json --limit 200",
      expect.objectContaining({ timeout: 15000, windowsHide: true }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps an unknown advertised network distinct and discovery-only", async () => {
    state.config.networkId = ARC_MAINNET_PROFILE.networkId;
    state.marketplace.mockResolvedValue({ stdout: JSON.stringify({ data: { items: [{ name: "Weather service",
      resource: "https://other.example/weather", accepts: [{ network: "eip155:9999", amount: "2000" }] }] } }) });
    const { discoverExternalCandidates } = await import("./external-discovery");
    const [candidate] = await discoverExternalCandidates("weather", []);
    expect(candidate.external).toMatchObject({ onArc: false, chains: ["eip155:9999"] });
    expect(candidate.description).toContain("Advertises payment acceptance on eip155:9999");
  });

  it("degrades to no candidates on unavailable marketplace and caches the failure", async () => {
    state.marketplace.mockRejectedValue(new Error("Circle CLI unavailable"));
    const { discoverExternalCandidates } = await import("./external-discovery");
    expect(await discoverExternalCandidates("weather", [])).toEqual([]);
    expect(await discoverExternalCandidates("weather", [])).toEqual([]);
    expect(state.marketplace).toHaveBeenCalledOnce();
  });

  it("does not probe when external discovery is disabled", async () => {
    state.config.externalDiscovery = false;
    const { discoverExternalCandidates } = await import("./external-discovery");
    expect(await discoverExternalCandidates("weather", [])).toEqual([]);
    expect(state.marketplace).not.toHaveBeenCalled();
  });
});
