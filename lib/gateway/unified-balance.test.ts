import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ARC_MAINNET_PROFILE, type ArcNetworkProfile } from "../arc-network-profile";
import { STORAGE_MAINNET_PROFILE_DIGEST, STORAGE_TESTNET_PROFILE_DIGEST, storageIdentityDigest, type StorageIdentity } from "../db/storage-identity";
import { canonicalJson } from "../canonical-json";
import { hostedTreasuryPolicyDigest, type HostedTreasuryPolicy } from "../payments/hosted-treasury-policy";

const state = vi.hoisted(() => ({ profile: undefined as ArcNetworkProfile | undefined, baseUrl: "https://keryx.cc",
  readFile: vi.fn(), kit: vi.fn(), context: vi.fn(), storage: vi.fn(), identity: vi.fn(), accounting: vi.fn() }));
vi.mock("../config", () => ({ config: { get profile() { return state.profile; }, get baseUrl() { return state.baseUrl; } } }));
vi.mock("node:fs", () => ({ default: { readFileSync: state.readFile } }));
vi.mock("@circle-fin/unified-balance-kit", () => ({ getBalances: state.kit, createUnifiedBalanceKitContext: state.context }));
vi.mock("../db/application-storage", () => ({ createReadonlyApplicationStorage: state.storage, applicationSqliteIdentity: state.identity }));

const publicAddress = "0x9e88d16c3ecb07b9e84df13ef38dd6b673bd285c";
const legacyAddress = `0x${"a".repeat(40)}`;
let identity: StorageIdentity, policy: HostedTreasuryPolicy;
function configure(value: HostedTreasuryPolicy) {
  vi.stubEnv("KERYX_MAINNET_TREASURY_POLICY_JSON", canonicalJson(value));
  vi.stubEnv("KERYX_MAINNET_TREASURY_POLICY_DIGEST", hostedTreasuryPolicyDigest(value));
}
function row(balance = "5.000000", depositor = publicAddress, domain = 26) {
  return { token: "USDC", balances: [{ depositor, domain, balance }] };
}
beforeEach(async () => {
  vi.resetModules(); vi.resetAllMocks(); state.profile = (await import("../arc-network-profile")).ARC_MAINNET_PROFILE; state.baseUrl = "https://keryx.cc";
  vi.stubEnv("KERYX_NETWORK", "arc"); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arc");
  identity = { format: "keryx-mainnet-storage-identity-v1", network: "eip155:5042", authorityMode: "mainnet-real",
    deploymentId: "8e6833f4-fcde-4241-a6a6-bd6071567296", storageId: "9e6833f4-fcde-4241-a6a6-bd6071567296",
    enrollmentId: "ae6833f4-fcde-4241-a6a6-bd6071567296", enrolledAt: "2026-10-02T00:00:00.000Z",
    provenanceDigest: "a".repeat(64), profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  policy = { format: "keryx-hosted-treasury-policy-v1", network: "eip155:5042", storageIdentityDigest: storageIdentityDigest(identity),
    origin: state.baseUrl, signer: publicAddress, lifetimeCapMicroUsdc: "5000000", queryCapMicroUsdc: "500000",
    expiresAtSeconds: Math.floor(Date.now() / 1000) + 3600 };
  configure(policy); state.identity.mockImplementation(() => identity);
  state.storage.mockResolvedValue({ hostedTreasuryAccounting: state.accounting }); state.accounting.mockResolvedValue({});
  state.readFile.mockReturnValue(JSON.stringify({ address: legacyAddress }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("observes only the admitted mainnet public address without reading the legacy wallet or constructing kit custody", async () => {
  const http = vi.fn(async () => Response.json(row())); vi.stubGlobal("fetch", http);
  const { getMainnetTreasuryObservation, getAgentUnifiedBalance } = await import("./unified-balance");
  expect(await getMainnetTreasuryObservation()).toMatchObject({ address: publicAddress, network: "eip155:5042",
    availableUsdc: "5", storageIdentityDigest: policy.storageIdentityDigest, policyDigest: hostedTreasuryPolicyDigest(policy), paymentReadiness: "not-probed" });
  expect(http).toHaveBeenCalledExactlyOnceWith(`${ARC_MAINNET_PROFILE.gatewayApiUrl}/v1/balances`, expect.objectContaining({
    body: JSON.stringify({ token: "USDC", sources: [{ depositor: publicAddress, domain: 26 }] }), redirect: "error", cache: "no-store" }));
  expect(state.accounting).toHaveBeenCalledWith(publicAddress, "public");
  expect(state.identity).toHaveBeenCalledWith(expect.any(Object), "read");
  await expect(getAgentUnifiedBalance()).rejects.toThrow("Legacy treasury observation refused");
  expect(state.readFile).not.toHaveBeenCalled(); expect(state.context).not.toHaveBeenCalled(); expect(state.kit).not.toHaveBeenCalled();
});
it.each([[row("0"), "0"], [row("5", legacyAddress), null], [row("5", publicAddress, 1), null], [{ token: "USDC", balances: [] }, null],
  [row("NaN"), null], [{ token: "EURC", balances: row().balances }, null]])("keeps missing/foreign/malformed Circle rows unknown and accepts only explicit bound zero %#", async (value, expected) => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(value)));
  const { getMainnetTreasuryObservation } = await import("./unified-balance");
  expect((await getMainnetTreasuryObservation()).availableUsdc).toBe(expected);
});
it("returns unknown for a transport outage rather than zero", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network unavailable"); }));
  expect((await (await import("./unified-balance")).getMainnetTreasuryObservation()).availableUsdc).toBeNull();
});
it.each(["testnet", "private-role", "missing-policy", "expired-policy", "wrong-origin", "unavailable-store"])("refuses %s before Circle observation", async reason => {
  const http = vi.fn(); vi.stubGlobal("fetch", http);
  if (reason === "testnet") identity = { ...identity, format: "keryx-storage-identity-v1", authorityMode: "testnet-real", network: "eip155:5042002", profileDigest: STORAGE_TESTNET_PROFILE_DIGEST };
  if (reason === "private-role") state.accounting.mockRejectedValue(new Error("Historical hosted custody role cannot change"));
  if (reason === "missing-policy") vi.stubEnv("KERYX_MAINNET_TREASURY_POLICY_JSON", undefined);
  if (reason === "expired-policy") configure({ ...policy, expiresAtSeconds: Math.floor(Date.now() / 1000) });
  if (reason === "wrong-origin") configure({ ...policy, origin: "https://other.example" });
  if (reason === "unavailable-store") state.storage.mockRejectedValue(new Error("unavailable"));
  await expect((await import("./unified-balance")).getMainnetTreasuryObservation()).rejects.toThrow();
  expect(http).not.toHaveBeenCalled(); expect(state.readFile).not.toHaveBeenCalled();
});
it.each(["rotation", "expiry", "identity"])("does not publish a balance if %s changes while the read awaits", async reason => {
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (reason === "rotation") configure({ ...policy, signer: legacyAddress });
    if (reason === "expiry") configure({ ...policy, expiresAtSeconds: Math.floor(Date.now() / 1000) });
    if (reason === "identity") identity = { ...identity, provenanceDigest: "b".repeat(64) };
    return Response.json(row());
  }));
  await expect((await import("./unified-balance")).getMainnetTreasuryObservation()).rejects.toThrow();
});
it("keeps the legacy testnet kit address/chains/shape unchanged", async () => {
  state.profile = (await import("../arc-network-profile")).ARC_TESTNET_PROFILE; vi.stubEnv("KERYX_NETWORK", "arcTestnet"); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arcTestnet");
  state.kit.mockResolvedValue({ totalConfirmedBalance: "1.000000", totalPendingBalance: "0.100000",
    breakdown: [{ breakdown: [{ chain: "Arc_Testnet", confirmedBalance: "1.000000", pendingBalance: "0.100000" }] }] });
  const { getAgentUnifiedBalance } = await import("./unified-balance");
  expect(await getAgentUnifiedBalance()).toMatchObject({ address: legacyAddress, totalConfirmedUsdc: "1.000000", totalPendingUsdc: "0.100000",
    perChain: [{ chain: "Arc_Testnet", confirmed: "1.000000", pending: "0.100000" }] });
  expect(state.kit).toHaveBeenCalledWith(state.context.mock.results[0].value, {
    sources: { address: legacyAddress, chains: ["Arc_Testnet", "Base_Sepolia", "Ethereum_Sepolia", "Avalanche_Fuji"] }, includePending: true });
  expect(state.storage).not.toHaveBeenCalled();
});
it("mainnet API bypasses the legacy cache, keeps unknown explicit, and redacts policy refusal", async () => {
  const http = vi.fn(async () => Response.json(row())); vi.stubGlobal("fetch", http);
  const { GET } = await import("../../app/api/treasury/route");
  const known = await GET(); expect(known.headers.get("Cache-Control")).toBe("no-store");
  expect(await known.json()).toMatchObject({ available: true, via: "circle-gateway-api", unifiedBalance: null, observation: { availableUsdc: "5" } });
  http.mockResolvedValue(Response.json({ token: "USDC", balances: [] }));
  const unknown = await GET(); expect(await unknown.json()).toMatchObject({ available: false, unifiedBalance: null, observation: { availableUsdc: null } });
  vi.stubEnv("KERYX_MAINNET_TREASURY_POLICY_JSON", "secret-invalid-input");
  const refused = await GET(); expect(refused.status).toBe(503);
  expect(await refused.json()).toEqual({ available: false, via: "circle-gateway-api", unifiedBalance: null,
    observation: null, error: "Mainnet public treasury observation unavailable" });
  expect(http).toHaveBeenCalledTimes(2);
});
