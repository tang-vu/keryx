import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import { buyerTypedData } from "@/lib/buyer/protocol";

const state = vi.hoisted(() => ({ claims: new Map<string, string>(), claim: vi.fn(), authority: vi.fn(), settle: vi.fn(), settings: {
  networkId: "eip155:5042002", sellerAddress: `0x${"b".repeat(40)}`, funderKey: "synthetic", defaultBudget: .05,
  a2aMaxBudget: .5, a2aFeeUsdc: .02, a2aDeepFeeUsdc: .05, maxTimeoutSeconds: 691200 } }));
vi.mock("@/lib/config", async () => ({ config: { ...state.settings,
  profile: (await import("@/lib/arc-network-profile")).ARC_TESTNET_PROFILE } }));
vi.mock("@/lib/db", () => ({ getDb: async () => ({ claimResearchPurchase: state.claim,
  assertResearchPurchaseAuthority: state.authority }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => null, clientIp: () => "synthetic" }));
vi.mock("@/lib/x402-server", () => ({ settleThenServe: state.settle }));
import { POST } from "../../app/api/research/monthly/route";
import { quoteResearchMonthly } from "@/lib/monthly/quote";

const owner = privateKeyToAccount(`0x${"1".repeat(64)}`);
beforeEach(() => {
  vi.stubEnv("KERYX_MONTHLY_ENABLED", "1"); state.claims.clear(); state.claim.mockReset(); state.settle.mockReset();
  state.authority.mockReset().mockResolvedValue(undefined);
  state.claim.mockImplementation(async (claim: { authorizationId: string; requireExisting: boolean; issued: unknown }) => {
    const { requireExisting, ...binding } = claim; const expected = JSON.stringify(binding);
    if (requireExisting && state.claims.get(claim.authorizationId) !== expected) throw new Error("Unissued or changed authorization");
    if (!requireExisting) state.claims.set(claim.authorizationId, expected);
  });
  state.settle.mockResolvedValue(new Response("{}", { status: 402 }));
});
afterEach(() => vi.unstubAllEnvs());
function request(signature?: string, payer = owner.address, expiresAt = String(Math.floor(Date.now()/1000)+600)) {
  return new NextRequest("https://keryx.cc/api/research/monthly", { method: "POST", headers: {
    "content-type": "application/json", "x-keryx-monthly-payer": payer, "x-keryx-monthly-expires": expiresAt, ...(signature ? { "payment-signature": signature } : {}) },
    body: JSON.stringify(quoteResearchMonthly()) });
}
async function signed(authorization: Parameters<typeof buyerTypedData>[0]) {
  return Buffer.from(JSON.stringify({ authorization, signature: await owner.signTypedData(buyerTypedData(authorization)) })).toString("base64");
}
it("rejects an unlogged historical settled authorization before any Circle helper call", async () => {
  const now = Math.floor(Date.now()/1000);
  const header = await signed({ from: owner.address, to: state.settings.sellerAddress, value: "360000",
    nonce: `0x${"2".repeat(64)}`, validAfter: String(now-600), validBefore: String(now+691200) });
  expect((await POST(request(header))).status).toBe(400);
  expect(state.settle).not.toHaveBeenCalled(); expect(state.claims.size).toBe(0);
});
it("durably binds a fresh server nonce before challenge exposure and accepts only that exact contract", async () => {
  const challenge = await POST(request()); expect(challenge.status).toBe(402);
  expect(state.authority).toHaveBeenCalledWith("eip155:5042002");
  const authorization = JSON.parse(challenge.headers.get("x-keryx-monthly-authorization")!);
  expect(state.claims.has(authorization.nonce)).toBe(true);
  expect(Number(authorization.validBefore)-Number(authorization.validAfter)).toBe(691800);
  const expiresAt = challenge.headers.get("x-keryx-monthly-expires")!;
  state.settle.mockClear(); await POST(request(await signed(authorization), owner.address, expiresAt));
  expect(state.settle).toHaveBeenCalledTimes(1);
  state.settle.mockClear(); await POST(request(await signed({ ...authorization, validBefore: String(Number(authorization.validBefore)+1) }), owner.address, expiresAt));
  expect(state.settle).not.toHaveBeenCalled();
});
it("a failed durable issuance never exposes an authorization or invokes Circle", async () => {
  state.claim.mockRejectedValueOnce(new Error("Unavailable")); const result = await POST(request());
  expect(result.status).toBe(400); expect(result.headers.has("x-keryx-monthly-authorization")).toBe(false);
  expect(state.settle).not.toHaveBeenCalled();
});
