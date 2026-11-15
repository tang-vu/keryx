import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PaidOptions } from "@/lib/x402-server";

const mocks = vi.hoisted(() => ({ feePolicy: vi.fn(), settle: vi.fn(), hostedPolicy: vi.fn(), identity: vi.fn(), local: vi.fn(), currentHosted: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: async () => ({ fixture: true }) }));
vi.mock("@/lib/db/application-storage", () => ({ applicationStorageIdentity: mocks.identity,
  assertApplicationStorageCurrentLocal: mocks.local }));
vi.mock("@/lib/config", async () => ({ config: { profile: (await import("@/lib/arc-network-profile")).ARC_MAINNET_PROFILE, baseUrl: "https://keryx.cc" } }));
vi.mock("@/lib/payments/hosted-treasury-policy", () => ({ configuredHostedTreasuryPolicy: mocks.currentHosted }));
vi.mock("@/lib/payments/mainnet-hosted-gateway", () => ({ mainnetHostedPolicy: mocks.hostedPolicy }));
vi.mock("@/lib/payments/operating-fee-policy", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/payments/operating-fee-policy")>(),
  configuredOperatingFeePolicy: mocks.feePolicy,
}));
vi.mock("@/lib/x402-server", () => ({ settleThenServe: mocks.settle }));

import { POST } from "../../app/api/research/operating-fee/route";
import { operatingFeeEndpointPath, operatingFeePolicyDigest, OPERATING_FEE_SOURCE_ID } from "@/lib/payments/operating-fee-policy";

const queryId = "00000000-0000-4000-8000-000000000001";
const policy = { format: "keryx-operating-fee-policy-v1" as const, network: "eip155:5042" as const,
  origin: "https://keryx.cc", storageIdentityDigest: "a".repeat(64),
  beneficiary: "0x00000000000000000000000000000000000000aa", expiresAtSeconds: 1900000000 };
const fee = { policyDigest: operatingFeePolicyDigest(policy), allocationDigest: "b".repeat(64), amountMicroUsdc: "25000" };
const request = (path = operatingFeeEndpointPath(queryId, fee)) => new NextRequest("https://keryx.cc" + path, { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.feePolicy.mockReset().mockReturnValue(policy);
  const hosted = { origin: policy.origin, signer: "0x00000000000000000000000000000000000000bb", queryCapMicroUsdc: "50000" };
  mocks.hostedPolicy.mockReset().mockResolvedValue(hosted);
  mocks.currentHosted.mockReset().mockReturnValue(hosted);
  mocks.identity.mockReset().mockResolvedValue({ fixture: "dependency-backed Source identity" });
  mocks.local.mockReset();
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0");
  mocks.settle.mockResolvedValue(Response.json({ fixture: "transport only" }));
});

afterEach(() => vi.unstubAllEnvs());

describe("operating fee endpoint authority contract", () => {
  it("binds the canonical resource, protected payee and service kind with one settlement attempt", async () => {
    expect((await POST(request())).status).toBe(200);
    const options = mocks.settle.mock.calls[0][1] as PaidOptions;
    expect(options).toMatchObject({ priceUsdc: 0.025, payTo: policy.beneficiary,
      resourceSourceId: OPERATING_FEE_SOURCE_ID, resourceKind: "operating-fee",
      endpoint: operatingFeeEndpointPath(queryId, fee), singleSettlementAttempt: true });
    expect(await options.beforeSettlementAsync!()).toBeNull();
    expect(options.beforeSettlement!()).toBeNull();
    expect(options.beforeSettlement!()).not.toBeInstanceOf(Promise);
    expect(mocks.identity).toHaveBeenCalledWith(expect.any(Object), "write");
  });
  it.each([
    "/api/research/operating-fee?query=wrong&amount=1&policy=" + fee.policyDigest + "&allocation=" + fee.allocationDigest,
    operatingFeeEndpointPath(queryId, fee) + "&payTo=0x00000000000000000000000000000000000000cc",
    operatingFeeEndpointPath(queryId, fee).replace("amount=25000", "amount=0"),
  ])("rejects malformed or caller-selected terms before settlement: %s", async path => {
    expect((await POST(request(path))).status).toBe(400);
    expect(mocks.settle).not.toHaveBeenCalled();
  });
  it("rejects an amount above the existing half-budget limit", async () => {
    expect((await POST(request(operatingFeeEndpointPath(queryId, { ...fee, amountMicroUsdc: "25001" })))).status).toBe(409);
    expect(mocks.settle).not.toHaveBeenCalled();
  });
  it("rejects changed terms and unavailable reviewed authority before settlement", async () => {
    mocks.feePolicy.mockReturnValue({ ...policy, beneficiary: "0x00000000000000000000000000000000000000cc" });
    expect((await POST(request())).status).toBe(409);
    mocks.feePolicy.mockImplementation(() => { throw new Error("unavailable"); });
    expect((await POST(request())).status).toBe(503);
    expect(mocks.settle).not.toHaveBeenCalled();
  });
  it("rechecks recipient authority at the settlement boundary", async () => {
    await POST(request());
    const check = (mocks.settle.mock.calls[0][1] as PaidOptions).beforeSettlement!;
    mocks.feePolicy.mockReturnValue({ ...policy, beneficiary: "0x00000000000000000000000000000000000000cc" });
    expect((await check())?.status).toBe(409);
    mocks.feePolicy.mockImplementation(() => { throw new Error("expired"); });
    expect((await check())?.status).toBe(503);
  });
});

it("awaits policy provenance before preparing seller terms", async () => {
  let release!: (value: unknown) => void;
  mocks.hostedPolicy.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const pending = POST(request()); await Promise.resolve(); await Promise.resolve();
  expect(mocks.settle).not.toHaveBeenCalled(); expect(mocks.feePolicy).not.toHaveBeenCalled();
  release(mocks.currentHosted()); expect((await pending).status).toBe(200);
});
it("rechecks policy after the final awaited identity and narrows synchronously immediately before settlement", async () => {
  await POST(request()); const opts = mocks.settle.mock.calls[0][1] as PaidOptions;
  mocks.identity.mockImplementationOnce(async () => {
    mocks.feePolicy.mockReturnValue({ ...policy, beneficiary: "0x00000000000000000000000000000000000000cc" });
    return { fixture: "dependency-backed Source identity" };
  });
  expect((await opts.beforeSettlementAsync!())?.status).toBe(409);
  mocks.feePolicy.mockReturnValue(policy); mocks.local.mockImplementation(() => { throw Error("closed or unselected facade"); });
  expect(opts.beforeSettlement!()?.status).toBe(503);
});
it.each(["forged", "readonly", "supabase", "closed"])("holds %s provenance without settlement", async reason => {
  mocks.identity.mockRejectedValueOnce(Error(reason));
  expect((await POST(request())).status).toBe(503); expect(mocks.settle).not.toHaveBeenCalled();
});
