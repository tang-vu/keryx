import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifyTypedData } from "viem";
import { authorizationWithNonce, buyerTypedData, BUYER_GATEWAY, BUYER_USDC, BUYER_NETWORK } from "./buyer/protocol";

const { settings, verify, settle, insert } = vi.hoisted(() => ({
  settings: { sellerAddress: `0x${"a".repeat(40)}`, privateResearchReservedPayees: "", networkId: "eip155:5042002",
    usdcAddress: "0x3600000000000000000000000000000000000000", gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9", maxTimeoutSeconds: 691200 },
  verify: vi.fn(), settle: vi.fn(), insert: vi.fn(),
}));
vi.mock("./config", () => ({ config: settings }));
vi.mock("@circle-fin/x402-batching/server", () => ({ BatchFacilitatorClient: class { verify = verify; settle = settle; } }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: () => ({ insert }) }) }));
import { challengeResponse, settleThenServe } from "./x402-server";
import { reservedResearchMerchants } from "./payments/public-merchant-guard";

const privatePayee = `0x${"b".repeat(40)}`, retiredPayee = `0x${"c".repeat(40)}`;
const opts = { priceUsdc: 0.05, payTo: settings.sellerAddress, endpoint: "/api/agent/ask" };
const account = privateKeyToAccount(generatePrivateKey()); // Ephemeral, never funded or submitted.
const requirement = { scheme: "exact" as const, network: BUYER_NETWORK as typeof BUYER_NETWORK, asset: BUYER_USDC,
  payTo: privatePayee, amount: "50000", maxTimeoutSeconds: 691200,
  extra: { name: "GatewayWalletBatched" as const, version: "1" as const, verifyingContract: BUYER_GATEWAY } };
const authorization = authorizationWithNonce(account.address, requirement, `0x${"d".repeat(64)}`, 1788912000000);
const signature = await account.signTypedData(buyerTypedData(authorization));
const inner = { authorization, signature };
const full = { x402Version: 2, resource: { url: "/api/agent/private-ask" }, accepted: requirement, payload: inner };
function request(payload: unknown, endpoint = opts.endpoint) {
  return new NextRequest(`https://keryx.test${endpoint}`, { method: "POST", headers: { "payment-signature": Buffer.from(JSON.stringify(payload)).toString("base64") } });
}
beforeEach(() => {
  settings.privateResearchReservedPayees = `${privatePayee},${retiredPayee}`;
  verify.mockReset(); settle.mockReset(); insert.mockReset();
});
beforeAll(() => vi.stubEnv("SELLER_ADDRESS", settings.sellerAddress));
afterAll(() => vi.unstubAllEnvs());

it("blocks full and inner signed authorizations across every active public seller resource", async () => {
  const produce = vi.fn(() => ({ ok: true }));
  for (const endpoint of ["/api/agent/ask", "/api/source/source", "/api/source/source/item/article", "/api/cite/source"]) {
    for (const payload of [inner, full, { ...full, resource: { url: endpoint }, accepted: { ...requirement, payTo: opts.payTo }, extensions: { access: "public" } }]) {
      const result = await settleThenServe(request(payload, endpoint), { ...opts, endpoint, discovery: { path: endpoint } }, produce);
      expect(result.status).toBe(403);
      expect(result.headers.has("PAYMENT-REQUIRED")).toBe(false);
      expect(result.headers.has("PAYMENT-RESPONSE")).toBe(false);
    }
  }
  expect(verify).not.toHaveBeenCalled(); expect(settle).not.toHaveBeenCalled(); expect(produce).not.toHaveBeenCalled();
  expect(await verifyTypedData({ ...buyerTypedData(authorization), address: account.address, signature })).toBe(true);
  expect(await verifyTypedData({ ...buyerTypedData({ ...authorization, to: opts.payTo }), address: account.address, signature })).toBe(false);
});

it("refuses challenges and paid calls whose source-owned payee is current or retired private merchant", async () => {
  for (const payTo of [privatePayee, retiredPayee, `0x${"B".repeat(40)}`]) {
    expect(challengeResponse({ ...opts, payTo }).status).toBe(403);
    expect((await settleThenServe(request(inner), { ...opts, payTo }, () => ({}))).status).toBe(403);
  }
  expect((await settleThenServe(request({ ...inner, authorization: { ...authorization, to: retiredPayee } }), opts, () => ({}))).status).toBe(403);
  expect(verify).not.toHaveBeenCalled(); expect(settle).not.toHaveBeenCalled();
});

it("fails closed on invalid configuration or public/private merchant collision", async () => {
  for (const raw of [",", "bad-address", `${privatePayee},`, settings.sellerAddress, `0x${"0".repeat(40)}`, Array(33).fill(privatePayee).join(",")]) {
    settings.privateResearchReservedPayees = raw;
    expect(challengeResponse(opts).status).toBe(503);
    const response = await settleThenServe(request(inner), opts, () => ({}));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Payment merchant policy unavailable" });
  }
  expect(verify).not.toHaveBeenCalled(); expect(settle).not.toHaveBeenCalled();
});

it("keeps public merchant quotes and confirmed delivery operational", async () => {
  expect(challengeResponse(opts).status).toBe(402);
  verify.mockResolvedValue({ isValid: true, payer: account.address });
  settle.mockResolvedValue({ success: true, payer: account.address, transaction: "synthetic-reference" });
  const publicAuthorization = { ...authorization, to: opts.payTo };
  const publicSignature = await account.signTypedData(buyerTypedData(publicAuthorization));
  expect((await settleThenServe(request({ authorization: publicAuthorization, signature: publicSignature }), opts, () => ({ delivered: true }))).status).toBe(200);
  expect(settle).toHaveBeenCalledTimes(1);
  settings.privateResearchReservedPayees = "";
  expect(challengeResponse({ ...opts, payTo: privatePayee }).status).toBe(402); // No private merchant exists in this configuration.
});

it("normalizes a bounded reserved set and rejects absent public merchant authority when configured", () => {
  expect([...reservedResearchMerchants(` ${privatePayee},0x${"B".repeat(40)} `, opts.payTo)]).toEqual([privatePayee]);
  expect(() => reservedResearchMerchants(privatePayee, "")).toThrow();
  expect(() => reservedResearchMerchants(null, opts.payTo)).toThrow();
});

it("does not forward missing or malformed signed recipient aliases while reservations are active", async () => {
  for (const to of [undefined, null, ` ${privatePayee} `, `0x00${privatePayee.slice(2)}`, { address: privatePayee }]) {
    const payload = { ...inner, authorization: { ...authorization, to } };
    expect((await settleThenServe(request(payload), opts, () => ({}))).status).toBe(400);
  }
  expect(verify).not.toHaveBeenCalled(); expect(settle).not.toHaveBeenCalled();
});

it("also protects the unused legacy seller wrapper before verification, settlement or recording", async () => {
  const { withGateway } = await import("./x402");
  const handler = vi.fn(async () => NextResponse.json({ ok: true }));
  expect((await withGateway(handler, "$0.05", opts.endpoint)(request(full))).status).toBe(403);
  expect(verify).not.toHaveBeenCalled(); expect(settle).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled(); expect(handler).not.toHaveBeenCalled();
});
