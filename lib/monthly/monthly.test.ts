import { afterEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { quoteResearchMonthly } from "./quote";
import { monthlyMessage } from "./protocol";
import { monthlyPaymentAuthorization, monthlyQuestionDigest, verifyMonthlyProof } from "./service";
import { buyMonthly } from "./client";
import { authorizationWithNonce, buyerTypedData } from "../buyer/protocol";

const { settings } = vi.hoisted(() => ({ settings: { defaultBudget: .05, a2aMaxBudget: .5, a2aFeeUsdc: .02,
  a2aDeepFeeUsdc: .05, sellerAddress: `0x${"b".repeat(40)}`, networkId: "eip155:5042002" } }));
vi.mock("../config", () => ({ config: settings }));
const buyer = privateKeyToAccount(`0x${"1".repeat(64)}`);
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");
const requirement = { scheme: "exact", network: "eip155:5042002", asset: "0x3600000000000000000000000000000000000000",
  amount: "360000", payTo: settings.sellerAddress, maxTimeoutSeconds: 691200,
  extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" } } as const;
afterEach(() => { settings.defaultBudget = .05; settings.a2aDeepFeeUsdc = .05; });

describe("Monthly economics and proof authority", () => {
  it("discounts total by ten percent without reducing creator allocations", () => {
    expect(quoteResearchMonthly()).toMatchObject({ totalMicros: 360000, separateTotalMicros: 400000,
      creatorBudgetMicros: 50000, serviceFeeMicros: 160000, roundingMicros: 0 });
  });
  it("rounds equal allocations upward and refuses creator-subsidized configurations", () => {
    settings.defaultBudget = .050003;
    const quote = quoteResearchMonthly();
    expect(quote.totalMicros % 4).toBe(0); expect(quote.totalMicros).toBeGreaterThanOrEqual(quote.separateTotalMicros * .9);
    settings.defaultBudget = .5; settings.a2aDeepFeeUsdc = .01;
    expect(() => quoteResearchMonthly()).toThrow();
  });
  it("binds owner, action, question digest, request and short validity", async () => {
    const timestamp = Date.now(); const payload = { monthlyId: `monthly_${"a".repeat(64)}`, requestId: crypto.randomUUID(), questionDigest: monthlyQuestionDigest("What evidence exists?") };
    const proof = { payer: buyer.address, timestamp, signature: await buyer.signMessage({ message: monthlyMessage("redeem", payload, timestamp) }) };
    expect(await verifyMonthlyProof("redeem", payload, proof, timestamp)).toBe(buyer.address);
    await expect(verifyMonthlyProof("status", payload, proof, timestamp)).rejects.toThrow();
    await expect(verifyMonthlyProof("redeem", { ...payload, questionDigest: monthlyQuestionDigest("Changed") }, proof, timestamp)).rejects.toThrow();
    await expect(verifyMonthlyProof("redeem", payload, proof, timestamp + 300001)).rejects.toThrow();
    await expect(verifyMonthlyProof("redeem", payload, { ...proof, payer: settings.sellerAddress }, timestamp)).rejects.toThrow();
  });
  it("requires exact signed debit amount and merchant", async () => {
    const authorization = authorizationWithNonce(buyer.address, requirement, `0x${"1".repeat(64)}`);
    const signature = await buyer.signTypedData(buyerTypedData(authorization));
    expect(await monthlyPaymentAuthorization(encode({ authorization, signature }), settings.sellerAddress, 360000)).toEqual(authorization);
    await expect(monthlyPaymentAuthorization(encode({ authorization, signature }), settings.sellerAddress, 359999)).rejects.toThrow();
    await expect(monthlyPaymentAuthorization(encode({ authorization, signature }), buyer.address, 360000)).rejects.toThrow();
  });
  it("persists recovery and submission before one paid request; loss is uncertain with no retry", async () => {
    const events: string[] = []; let paid = 0;
    const http = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      if ((options?.headers as Record<string, string>)?.["payment-signature"]) { events.push("paid"); paid++; throw new Error("lost response"); }
      return new Response("{}", { status: 402, headers: { "payment-required": encode({ x402Version: 2, resource: { url: "/api/research/monthly" }, accepts: [requirement] }) } });
    });
    const result = await buyMonthly({ quote: quoteResearchMonthly(), payer: buyer.address,
      readWallet: async () => ({ address: buyer.address, chainId: 5042002, gatewayBalanceMicros: "1000000" }),
      sign: async a => { events.push("sign"); return buyer.signTypedData(buyerTypedData(a)); },
      prepare: async () => { events.push("prepare"); }, claim: async () => { events.push("claim"); } }, http);
    expect(result.status).toBe("submission_uncertain"); expect(paid).toBe(1); expect(events).toEqual(["prepare", "sign", "claim", "paid"]);
  });
  it("storage refusal cannot submit payment", async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 402, headers: { "payment-required": encode({ x402Version: 2, resource: { url: "/api/research/monthly" }, accepts: [requirement] }) } }));
    const sign = vi.fn();
    await expect(buyMonthly({ quote: quoteResearchMonthly(), payer: buyer.address,
      readWallet: async () => ({ address: buyer.address, chainId: 5042002, gatewayBalanceMicros: "1000000" }),
      sign, prepare: async () => { throw new Error("storage failed"); }, claim: async () => {} }, http)).rejects.toThrow("storage failed");
    expect(sign).not.toHaveBeenCalled(); expect(http).toHaveBeenCalledTimes(1);
  });
});
