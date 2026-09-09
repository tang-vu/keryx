import { afterEach, describe, expect, it, vi } from "vitest";
import { a2aOrderId } from "../a2a/order";
import { browserBuyerJobId, browserNewAuthorization, encodeBrowserPayment } from "./browser-policy";
import { authorizationWithNonce, BUYER_GATEWAY, BUYER_NETWORK, BUYER_USDC, buyerTypedData, chooseRequirement, decodeHeader, type BuyerRequest, type BuyerRequirement } from "./protocol";
import { newAuthorization } from "./policy";

const payer = `0x${"A".repeat(40)}`;
const payee = `0x${"b".repeat(40)}`;
const nonce = `0x${"01".repeat(32)}`;
const now = 1_789_000_000_000;
const request: BuyerRequest = { question: "Research recovery", budget: 0.03, researchMode: "quick", packageVersion: "1.0.0", responseMode: "async" };
const requirement: BuyerRequirement = { scheme: "exact", network: BUYER_NETWORK, asset: BUYER_USDC, amount: "50000", payTo: payee, maxTimeoutSeconds: 691200, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: BUYER_GATEWAY } };
const header = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64");
const challenge = (option: unknown = requirement) => header({ x402Version: 2, resource: { url: "/api/agent/ask" }, accepts: [option] });
afterEach(() => vi.unstubAllGlobals());

describe("portable buyer policy", () => {
  it("keeps the pre-refactor v2 order ID vector across runtimes and wallet casing", async () => {
    const a = authorizationWithNonce(payer, requirement, nonce, now);
    const expected = "a2a_4e42439bf25ec35565be14377644250f8cbca513f209f681023375b32f6f70ed";
    expect(await browserBuyerJobId(a)).toBe(expected);
    expect(a2aOrderId({ network: BUYER_NETWORK, payer, payee, authorizationId: nonce })).toBe(expected);
    expect(await browserBuyerJobId({ ...a, from: payer.toLowerCase() })).toBe(expected);
    expect(await browserBuyerJobId({ ...a, nonce: `0x${"02".repeat(32)}` })).not.toBe(expected);
  });

  it("preserves signed validity, value and pinned EIP-712 domain", () => {
    const a = authorizationWithNonce(payer, requirement, nonce, now);
    expect(a).toEqual({ from: payer, to: payee, value: "50000", validAfter: "1788999400", validBefore: "1789691200", nonce });
    expect(buyerTypedData(a).domain).toEqual({ name: "GatewayWalletBatched", version: "1", chainId: 5042002, verifyingContract: BUYER_GATEWAY });
    expect(buyerTypedData(a).message.value).toBe(BigInt(50000));
    expect(newAuthorization(payer, requirement, now)).toMatchObject({ ...a, nonce: expect.stringMatching(/^0x[a-f0-9]{64}$/) });
    expect(browserNewAuthorization(payer, requirement, now)).toMatchObject({ ...a, nonce: expect.stringMatching(/^0x[a-f0-9]{64}$/) });
  });

  it("uses no insecure randomness fallback", () => {
    vi.stubGlobal("crypto", undefined);
    expect(() => browserNewAuthorization(payer, requirement)).toThrow();
  });

  it("decodes UTF-8 headers and encodes the same payment bytes as the Node client", () => {
    const value = { error: "Evidence: café 🧾", amount: "50000" };
    expect(decodeHeader(header(value))).toEqual(value);
    const payment = { signature: `0x${"ab".repeat(65)}`, authorization: authorizationWithNonce(payer, requirement, nonce, now) };
    expect(encodeBrowserPayment(payment)).toBe(header(payment));
    expect(() => encodeBrowserPayment({ ...payment, signature: "not a signature" })).toThrow();
  });

  it.each([null, "x", "====", "e30===", "!!!!", "a".repeat(65537)])("rejects invalid bounded headers %#", value => {
    expect(() => decodeHeader(value)).toThrow();
  });

  it("enforces request, total-price, network, payee and domain at the shared boundary", () => {
    expect(chooseRequirement(challenge(), request, payee, "50000")).toEqual(requirement);
    expect(() => chooseRequirement(challenge(), request, payee, "49999")).toThrow();
    expect(() => chooseRequirement(challenge(), { ...request, budget: 0.6 }, payee, "1000000")).toThrow();
    expect(() => chooseRequirement(challenge(), request, payer, "50000")).toThrow();
    for (const patch of [{ network: "eip155:1" }, { asset: payer }, { extra: { ...requirement.extra, verifyingContract: payer } }]) {
      expect(() => chooseRequirement(challenge({ ...requirement, ...patch }), request, payee, "50000")).toThrow();
    }
    expect(() => authorizationWithNonce(payer, requirement, "0x00", now)).toThrow();
    expect(() => authorizationWithNonce(payer, requirement, nonce, NaN)).toThrow();
  });
});
