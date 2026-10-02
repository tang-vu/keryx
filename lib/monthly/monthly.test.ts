import { ARC_TESTNET_PROFILE } from "../arc-network-profile";
import { afterEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { quoteResearchMonthly } from "./quote";
import { monthlyMessage, monthlyRedemptionJobId } from "./protocol";
import { monthlyPaymentAuthorization, monthlyQuestionDigest, verifyMonthlyProof } from "./service";
import { buyMonthly, submitMonthly } from "./client";
import { authorizationWithNonce, buyerTypedData } from "../buyer/protocol";

const { settings } = vi.hoisted(() => ({ settings: { defaultBudget: .05, a2aMaxBudget: .5, a2aFeeUsdc: .02,
  a2aDeepFeeUsdc: .05, sellerAddress: `0x${"b".repeat(40)}`, networkId: "eip155:5042002" } }));
vi.mock("../config", () => ({ config: { ...settings, get defaultBudget() { return settings.defaultBudget; }, get a2aDeepFeeUsdc() { return settings.a2aDeepFeeUsdc; }, profile: ARC_TESTNET_PROFILE } }));
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
      // Response generated two seconds earlier: ordinary transit must not refuse the exact issued tuple.
      return new Response("{}", { status: 402, headers: { "payment-required": encode({ x402Version: 2, resource: { url: "/api/research/monthly" }, accepts: [requirement] }), "x-keryx-monthly-authorization": JSON.stringify({ ...authorizationWithNonce(buyer.address, requirement, `0x${"2".repeat(64)}`), validAfter: String(Math.floor(Date.now()/1000)-602), validBefore: String(Math.floor(Date.now()/1000)+691198) }), "x-keryx-monthly-expires": String(Math.floor(Date.now()/1000)+598) } });
    });
    const result = await buyMonthly({ quote: quoteResearchMonthly(), payer: buyer.address,
      readWallet: async () => ({ address: buyer.address, chainId: 5042002, gatewayBalanceMicros: "1000000" }),
      sign: async a => { events.push("sign"); return buyer.signTypedData(buyerTypedData(a)); },
      prepare: async () => { events.push("prepare"); }, claim: async () => { events.push("claim"); } }, http);
    expect(result.status).toBe("submission_uncertain"); expect(paid).toBe(1); expect(events).toEqual(["prepare", "sign", "claim", "paid"]);
  });
  it("storage refusal cannot submit payment", async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 402, headers: { "payment-required": encode({ x402Version: 2, resource: { url: "/api/research/monthly" }, accepts: [requirement] }), "x-keryx-monthly-authorization": JSON.stringify({ ...authorizationWithNonce(buyer.address, requirement, `0x${"2".repeat(64)}`), validAfter: String(Math.floor(Date.now()/1000)-600), validBefore: String(Math.floor(Date.now()/1000)+691200) }), "x-keryx-monthly-expires": String(Math.floor(Date.now()/1000)+600) } }));
    const sign = vi.fn();
    await expect(buyMonthly({ quote: quoteResearchMonthly(), payer: buyer.address,
      readWallet: async () => ({ address: buyer.address, chainId: 5042002, gatewayBalanceMicros: "1000000" }),
      sign, prepare: async () => { throw new Error("storage failed"); }, claim: async () => {} }, http)).rejects.toThrow("storage failed");
    expect(sign).not.toHaveBeenCalled(); expect(http).toHaveBeenCalledTimes(1);
  });
  it("refuses an arbitrary challenge authorization before persistence or signing", async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 402, headers: {
      "payment-required": encode({ x402Version: 2, resource: { url: "/api/research/monthly" }, accepts: [requirement] }),
      "x-keryx-monthly-authorization": JSON.stringify({ ...authorizationWithNonce(buyer.address, requirement, `0x${"2".repeat(64)}`), from: settings.sellerAddress }),
      "x-keryx-monthly-expires": String(Math.floor(Date.now()/1000)+600) } }));
    const prepare = vi.fn(), sign = vi.fn();
    await expect(buyMonthly({ quote: quoteResearchMonthly(), payer: buyer.address,
      readWallet: async () => ({ address: buyer.address, chainId: 5042002, gatewayBalanceMicros: "1000000" }),
      sign, prepare, claim: async () => {} }, http)).rejects.toThrow("issued authorization mismatch");
    expect(prepare).not.toHaveBeenCalled(); expect(sign).not.toHaveBeenCalled();
  });
  it("an expired admission challenge cannot request a signature or submit a payment", async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 402, headers: {
      "payment-required": encode({ x402Version: 2, resource: { url: "/api/research/monthly" }, accepts: [requirement] }),
      "x-keryx-monthly-authorization": JSON.stringify(authorizationWithNonce(buyer.address, requirement, `0x${"2".repeat(64)}`)),
      "x-keryx-monthly-expires": String(Math.floor(Date.now()/1000)-1) } }));
    const prepare = vi.fn(), sign = vi.fn(), claim = vi.fn();
    await expect(buyMonthly({ quote: quoteResearchMonthly(), payer: buyer.address,
      readWallet: async () => ({ address: buyer.address, chainId: 5042002, gatewayBalanceMicros: "1000000" }),
      sign, prepare, claim }, http)).rejects.toThrow("issued authorization mismatch");
    expect(prepare).not.toHaveBeenCalled(); expect(sign).not.toHaveBeenCalled(); expect(claim).not.toHaveBeenCalled();
    expect(http).toHaveBeenCalledTimes(1);
  });
});


it("redeem snapshots the exact original question and ID before asynchronous proof work", async () => {
  const original = { monthlyId: `monthly_${"a".repeat(64)}`, requestId: "00000000-0000-4000-8000-000000000001",
    question: "What evidence supports this finding?", payer: buyer.address };
  const mutable = { ...original };
  const http = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ queryId: await monthlyRedemptionJobId(original.monthlyId,original.requestId) }));
  const pending = submitMonthly(mutable, message => buyer.signMessage({ message }), http);
  mutable.question = "A changed question";
  mutable.requestId = "00000000-0000-4000-8000-000000000002";
  await pending;
  const init = http.mock.calls[0][1]!;
  expect(init.redirect).toBe("error"); expect(init.signal).toBeInstanceOf(AbortSignal);
  const body = JSON.parse(String(init.body));
  expect(body).toMatchObject({ monthlyId: original.monthlyId, question: original.question, requestId: original.requestId });
  await expect(verifyMonthlyProof("redeem", { monthlyId: original.monthlyId, requestId: original.requestId,
    questionDigest: monthlyQuestionDigest(original.question) }, body.proof)).resolves.toBe(buyer.address);
});

it("retains the original request when a server returns a different shaped job identity", async () => {
  const original={monthlyId:`monthly_${"a".repeat(64)}`,requestId:"00000000-0000-4000-8000-000000000001",question:"Original question",payer:buyer.address};
  const http=vi.fn<typeof fetch>().mockResolvedValue(Response.json({queryId:`a2a_${"c".repeat(64)}`}));
  await expect(submitMonthly(original,message=>buyer.signMessage({message}),http)).rejects.toThrow("Original Monthly job binding refused");
  expect(http).toHaveBeenCalledTimes(1);
});
