import { describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { buyBrowserResearch, resumeBrowserResearch, type BrowserBuyerStorage, type BrowserBuyerWallet } from "./browser-client";
import { buyerFetch } from "./transport";
import { BUYER_ENDPOINT, BUYER_NETWORK, BUYER_USDC, BUYER_GATEWAY, buyerTypedData, type BuyerIntentEnvelope, type BuyerRequest, type BuyerRequirement } from "./protocol";
import type { BrowserJournal } from "./browser-journal";
import { a2aResearchPackageForVersion } from "../a2a/research-package-definition";
import { researchReceiptDigest, sha256 } from "../research-receipt-integrity";
import { RESEARCH_RECEIPT_SCHEMA, RESEARCH_RECEIPT_CANONICALIZATION } from "../research-receipt-types";

// Synthetic, unfunded signer used only with injected HTTP. Never reaches a network.
const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const wrongAccount = privateKeyToAccount(`0x${"2".repeat(64)}`);
const payee = `0x${"b".repeat(40)}`;
const request: BuyerRequest = { question: "Explain durable recovery", budget: 0.03, researchMode: "quick", packageVersion: "1.0.0", responseMode: "async" };
const requirement: BuyerRequirement = { scheme: "exact", network: BUYER_NETWORK, asset: BUYER_USDC, amount: "50000", payTo: payee, maxTimeoutSeconds: 691200, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: BUYER_GATEWAY } };
const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");
const quote = (patch = {}) => new Response("{}", { status: 402, headers: { "payment-required": encode({ x402Version: 2, resource: { url: "/api/agent/ask" }, accepts: [{ ...requirement, ...patch }] }) } });
const acknowledgement = { success: true, payer: account.address, network: BUYER_NETWORK, transaction: "synthetic-acknowledgement" };

function setup() {
  let row: BrowserJournal;
  const storage: BrowserBuyerStorage = {
    create: vi.fn(async intent => { row = { schema: "keryx-browser-job-v1", queryId: intent.queryId, intent: structuredClone(intent), origin: "created", submission: "prepared", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; return row; }),
    claim: vi.fn(async () => { if (row.submission !== "prepared") return false; row.submission = "submission_possible"; return true; }),
    read: vi.fn(async () => structuredClone(row)),
    acknowledge: vi.fn(async (_intent, value) => { row.acknowledgement = value; }),
  };
  const input = { request, payee, payer: account.address, acceptedTotalMicros: "50000",
    readWallet: vi.fn(async (): Promise<BrowserBuyerWallet> => ({ address: account.address, chainId: 5042002, gatewayBalanceMicros: "50000" })),
    sign: vi.fn((a: Parameters<typeof buyerTypedData>[0]) => account.signTypedData(buyerTypedData(a))),
    onPrepared: vi.fn((_intent: BuyerIntentEnvelope) => {}),
  };
  const http = vi.fn<typeof fetch>().mockResolvedValueOnce(quote()).mockResolvedValueOnce(new Response("{}", { headers: { "payment-response": encode(acknowledgement) } }));
  return { storage, input, http };
}

describe("one-shot browser buyer", () => {
  it.each([{ amount: "49999" }, { amount: "50001" }, { network: "eip155:1" }, { payTo: account.address }])("refuses a changed quote before storage/signing: %j", async patch => {
    const { input, storage } = setup();
    await expect(buyBrowserResearch(input, { storage, http: vi.fn<typeof fetch>().mockResolvedValue(quote(patch)) })).rejects.toThrow();
    expect(input.sign).not.toHaveBeenCalled(); expect(storage.create).not.toHaveBeenCalled();
  });

  it("persists before prompting, commits the submission gate before POST, and never stores a signature", async () => {
    const { input, storage, http } = setup();
    input.sign.mockImplementation(async a => {
      expect(input.onPrepared).toHaveBeenCalledOnce();
      expect((await storage.read(input.onPrepared.mock.calls[0][0].queryId)).submission).toBe("prepared");
      return account.signTypedData(buyerTypedData(a));
    });
    http.mockReset().mockResolvedValueOnce(quote()).mockImplementationOnce(async (_url, init) => {
      expect(storage.claim).toHaveBeenCalledOnce();
      expect((await storage.read(input.onPrepared.mock.calls[0][0].queryId)).submission).toBe("submission_possible");
      expect(new Headers(init?.headers).has("payment-signature")).toBe(true);
      return new Response("{}", { headers: { "payment-response": encode(acknowledgement) } });
    });
    expect(await buyBrowserResearch(input, { storage, http })).toMatchObject({ status: "submitted", acknowledgementPersisted: true });
    expect(input.readWallet).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(await storage.read(input.onPrepared.mock.calls[0][0].queryId))).not.toContain('"signature"');
  });

  it.each(["storage", "export", "wallet", "balance", "chain", "signature", "rejection", "claim", "abort"])("prevents signed POST on %s failure", async failure => {
    const { input, storage, http } = setup();
    const abort = new AbortController();
    if (failure === "storage") vi.mocked(storage.create).mockRejectedValue(new Error("quota"));
    if (failure === "export") input.onPrepared.mockImplementation(() => { throw new Error("download failed"); });
    if (failure === "wallet") input.readWallet.mockResolvedValueOnce({ address: payee, chainId: 5042002, gatewayBalanceMicros: "50000" });
    if (failure === "balance") input.readWallet.mockResolvedValueOnce({ address: account.address, chainId: 5042002, gatewayBalanceMicros: "49999" });
    if (failure === "chain") input.readWallet.mockResolvedValueOnce({ address: account.address, chainId: 1, gatewayBalanceMicros: "50000" } as unknown as BrowserBuyerWallet);
    if (failure === "signature") input.sign.mockImplementation(a => wrongAccount.signTypedData(buyerTypedData(a)));
    if (failure === "rejection") input.sign.mockRejectedValue(new Error("user rejected"));
    if (failure === "claim") vi.mocked(storage.claim).mockResolvedValue(false);
    if (failure === "abort") input.onPrepared.mockImplementation(() => { abort.abort(); });
    await expect(buyBrowserResearch({ ...input, signal: abort.signal }, { storage, http })).rejects.toThrow();
    expect(http).toHaveBeenCalledTimes(1);
    expect(new Headers(http.mock.calls[0][1]?.headers).has("payment-signature")).toBe(false);
  });

  it("refuses an account switch while the wallet prompt is open", async () => {
    const { input, storage, http } = setup();
    input.sign.mockImplementation(async a => {
      input.readWallet.mockResolvedValue({ address: payee, chainId: 5042002, gatewayBalanceMicros: "50000" });
      return account.signTypedData(buyerTypedData(a));
    });
    await expect(buyBrowserResearch(input, { storage, http })).rejects.toThrow("wallet changed");
    expect(storage.claim).not.toHaveBeenCalled(); expect(http).toHaveBeenCalledTimes(1);
  });

  it.each(["network", "ack-storage", "http-500", "no-ack"])("keeps %s uncertain and recovers by GET only", async failure => {
    const { input, storage, http } = setup();
    http.mockReset().mockResolvedValueOnce(quote());
    if (failure === "network") http.mockRejectedValueOnce(new Error("response lost"));
    else http.mockResolvedValueOnce(new Response("broken", { status: failure === "http-500" ? 500 : 200,
      headers: failure === "no-ack" ? {} : { "payment-response": encode(acknowledgement) } }));
    if (failure === "ack-storage") vi.mocked(storage.acknowledge).mockRejectedValue(new Error("disk full"));
    const result = await buyBrowserResearch(input, { storage, http });
    expect(result.status).toBe("submission_uncertain");
    expect(result.evidence !== null).toBe(["ack-storage", "http-500"].includes(failure));
    const recovery = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 404 }));
    const resumed = await resumeBrowserResearch(result.queryId, { storage, http: recovery });
    expect(resumed.status).toBe("not_found_uncertain");
    expect(resumed.payment.state).toBe(failure === "http-500" ? "seller_reported_settled" : "unconfirmed");
    expect(recovery).toHaveBeenCalledWith(`${BUYER_ENDPOINT}?queryId=${result.queryId}`, expect.objectContaining({ method: "GET", headers: { accept: "application/json" } }));
    expect(input.sign).toHaveBeenCalledOnce(); expect(http).toHaveBeenCalledTimes(2);
  });

  it("verifies completed recovery against the original intent and refuses receipt substitution", async () => {
    const { input, storage, http } = setup();
    const bought = await buyBrowserResearch(input, { storage, http });
    const answer = "Synthetic answer";
    const job = { status: "completed", queryId: bought.queryId, answer, researchPackage: a2aResearchPackageForVersion("quick", "1.0.0"), pricing: { totalPriceUsdc: 0.05, serviceFeeUsdc: 0.02, creatorBudgetUsdc: 0.03, settledCreatorSpendUsdc: 0.01, pendingCreatorSpendUsdc: 0.005, unusedCreatorReserveUsdc: 0.015 } };
    const payload = { schema: RESEARCH_RECEIPT_SCHEMA, dispatch: { id: bought.queryId, question: request.question, answer, answerSha256: sha256(answer), budgetUsdc: request.budget, researchMode: "quick" }, settlement: { mode: "real", ledgerCompleteness: "complete", settledCreatorUsdc: 0.01, pendingCreatorUsdc: 0.005, simulatedCreatorUsdc: 0 } };
    const receipt = { payload, integrity: { algorithm: "sha256", canonicalization: RESEARCH_RECEIPT_CANONICALIZATION, scope: "payload", digest: researchReceiptDigest(payload) } };
    const recovery = () => vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(job)).mockResolvedValueOnce(Response.json(receipt, { headers: { "x-keryx-receipt-digest": receipt.integrity.digest } }));
    const lookup = recovery();
    expect(await resumeBrowserResearch(bought.queryId, { storage, http: lookup })).toMatchObject({ status: "completed", verification: { requestBinding: "verified", integrity: "verified" } });
    for (const [, init] of lookup.mock.calls) { expect(init?.method).toBe("GET"); expect(new Headers(init?.headers).has("payment-signature")).toBe(false); }
    payload.dispatch.question = "Substituted question";
    receipt.integrity.digest = researchReceiptDigest(payload);
    await expect(resumeBrowserResearch(bought.queryId, { storage, http: recovery() })).rejects.toThrow("bind");
  });

  it("pins transport, rejects redirect credentials, and preserves caller cancellation", async () => {
    const http = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    try {
      for (const url of ["https://other.test/", "http://keryx.cc/api/agent/ask", "https://user:pass@keryx.cc/api/agent/ask"]) await expect(buyerFetch(url)).rejects.toThrow("Untrusted");
      expect(http).not.toHaveBeenCalled();
      const abort = new AbortController();
      await buyerFetch(BUYER_ENDPOINT, { signal: abort.signal, redirect: "follow", credentials: "include" });
      const init = http.mock.calls[0][1]!;
      expect(init).toMatchObject({ redirect: "error", credentials: "omit", cache: "no-store" });
      abort.abort(); expect(init.signal?.aborted).toBe(true);
    } finally { http.mockRestore(); }
  });
});
