import { afterEach, expect, it, vi } from "vitest";
import { privateRuntimePolicy } from "./private-runtime-policy";
const address = (digit: string) => `0x${digit.repeat(40)}`;
const context = { network: "eip155:5042002", publicSeller: address("1"), publicTreasurySigners: [address("2")], privateTreasurySigner: address("3") };
const env = { KERYX_PRIVATE_RESEARCH_ENABLED: "1", KERYX_PRIVATE_RESEARCH_PAYEE: address("4"),
  KERYX_PRIVATE_SERVICE_FEE_MICROS: "20000",
  KERYX_PRIVATE_TREASURY_ADDRESS: address("3"), KERYX_PRIVATE_TREASURY_CAPACITY_MICROS: "500000",
  KERYX_PRIVATE_MODEL_ID: "deepseek-flash", KERYX_PRIVATE_PROVIDER: "deepseek", KERYX_PRIVATE_PROVIDER_BASE_URL: "https://synthetic.example/v1",
  KERYX_PRIVATE_PROVIDER_API_KEY: "synthetic-secret-marker", KERYX_PRIVATE_APPROVED_ENDPOINTS: '["https://synthetic.example/v1/chat/completions"]',
  KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES: address("4") };
afterEach(() => vi.unstubAllGlobals());

it("is disabled by default and accepts an explicitly separated testnet configuration without network activity", () => {
  const http = vi.fn(); vi.stubGlobal("fetch", http);
  expect(privateRuntimePolicy({}, context)).toBeNull();
  expect(privateRuntimePolicy({ ...env, KERYX_PRIVATE_RESEARCH_ENABLED: "0" }, context)).toBeNull();
  const policy = privateRuntimePolicy(env, context)!;
  expect(policy.treasury).toEqual({ signer: address("3"), capacityMicros: "500000" });
  expect(policy.disclosure.endpoint).toBe("https://synthetic.example/v1/chat/completions");
  expect(JSON.stringify(policy.disclosure)).not.toContain(env.KERYX_PRIVATE_PROVIDER_API_KEY);
  expect(http).not.toHaveBeenCalled();
});

it("refuses shared authorities, missing reservation, unapproved endpoints, incomplete keys and mainnet context", () => {
  for (const patch of [{ KERYX_PRIVATE_RESEARCH_PAYEE: address("1") }, { KERYX_PRIVATE_RESEARCH_PAYEE: address("2") },
    { KERYX_PRIVATE_TREASURY_ADDRESS: address("2") }, { KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES: address("5") },
    { KERYX_PRIVATE_APPROVED_ENDPOINTS: '["https://other.example/v1/chat/completions"]' },
    { KERYX_PRIVATE_PROVIDER_API_KEY: "" }, { KERYX_PRIVATE_TREASURY_CAPACITY_MICROS: "1.5" },
    { KERYX_PRIVATE_APPROVED_ENDPOINTS: "synthetic-secret-marker-invalid-json" }]) {
    expect(() => privateRuntimePolicy({ ...env, ...patch }, context)).toThrow(/^Private research runtime policy unavailable$/);
  }
  for (const patch of [{ network: "eip155:1" }, { privateTreasurySigner: address("4") }, { publicTreasurySigners: [address("3")] }, { publicTreasurySigners: [] }])
    expect(() => privateRuntimePolicy(env, { ...context, ...patch })).toThrow(/^Private research runtime policy unavailable$/);
  expect(() => privateRuntimePolicy({ ...env, KERYX_PRIVATE_RESEARCH_ENABLED: "true" }, context)).toThrow("enable flag");
});
