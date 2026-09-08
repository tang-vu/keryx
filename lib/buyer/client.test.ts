import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { buyResearch, quoteBuyer, resumeResearch } from "./client";
import { reportResearch } from "./report";
import { BUYER_ENDPOINT, BUYER_NETWORK, BUYER_USDC, BUYER_GATEWAY, buyerTypedData, chooseRequirement, type BuyerRequest } from "./policy";
import { readBuyerJournal } from "./journal";
import { a2aResearchPackage } from "../a2a/research-package";
import { researchReceiptDigest, sha256 } from "../research-receipt-integrity";
import { RESEARCH_RECEIPT_SCHEMA, RESEARCH_RECEIPT_CANONICALIZATION } from "../research-receipt-types";
import { verifyBuyerReceipt, verifyBuyerJob, sellerPaymentEvidence } from "./verify-result";

// Deterministic test-only signer; never funded or used against a network.
const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const payee = `0x${"2".repeat(40)}`;
const request: BuyerRequest = { question: "Test research?", budget: 0.03, researchMode: "quick", packageVersion: "1.0.0", responseMode: "async" };
const requirement = { scheme: "exact", network: BUYER_NETWORK, asset: BUYER_USDC, amount: "50000", payTo: payee, maxTimeoutSeconds: 691200, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: BUYER_GATEWAY } };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");
const challenge = (r: unknown = requirement) => encode({ x402Version: 2, resource: { url: "/api/agent/ask" }, accepts: [r] });
const quoteResponse = () => new Response("{}", { status: 402, headers: { "payment-required": challenge() } });
const directories: string[] = [];
async function directory() { const root = await mkdtemp(join(tmpdir(), "keryx-buyer-")); directories.push(root); return join(root, "job"); }
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); vi.restoreAllMocks(); });
const sign = (a: Parameters<typeof buyerTypedData>[0]) => account.signTypedData(buyerTypedData(a));

describe("bounded buyer", () => {
  it.each([
    { network: "eip155:1" }, { scheme: "upto" }, { asset: payee }, { payTo: account.address },
    { amount: "100001" }, { amount: "30000" }, { amount: "-1" }, { amount: "0.05" },
    { maxTimeoutSeconds: 999999999 }, { maxTimeoutSeconds: 600 },
    { extra: { ...requirement.extra, verifyingContract: payee } },
    { extra: { ...requirement.extra, name: "USDC" } },
  ])("refuses unsafe payment requirements before signing: %j", (patch) => {
    expect(() => chooseRequirement(challenge({ ...requirement, ...patch }), request, payee, "100000")).toThrow();
  });
  it("quotes with no signer or payment header", async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(quoteResponse());
    expect((await quoteBuyer(request, payee, "100000", http)).amount).toBe("50000");
    expect(http.mock.calls[0][1]?.headers).toEqual({ "content-type": "application/json" });
  });
  it("persists nonce/job before signing and submission before sending; restarts never pay again", async () => {
    const path = await directory();
    const signer = vi.fn(async (a: Parameters<typeof sign>[0]) => {
      expect((await readBuyerJournal(path)).authorization.nonce).toBe(a.nonce);
      return sign(a);
    });
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(quoteResponse()).mockImplementationOnce(async (_url, init) => {
      expect(JSON.parse(await readFile(join(path, "submission.json"), "utf8")).state).toBe("submission_possible");
      const payment = JSON.parse(Buffer.from((init!.headers as Record<string, string>)["payment-signature"], "base64").toString());
      expect(await recoverTypedDataAddress({ ...buyerTypedData(payment.authorization), signature: payment.signature })).toBe(account.address);
      throw new Error("Network lost after submission");
    });
    const result = await buyResearch({ request, payee, maxTotalMicros: "100000", payer: account.address, directory: path, sign: signer }, http);
    expect(result.status).toBe("submission_uncertain");
    const recovery = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 404 }));
    expect((await resumeResearch(path, recovery)).status).toBe("not_found_uncertain");
    expect(recovery.mock.calls[0][0]).toBe(`${BUYER_ENDPOINT}?queryId=${result.queryId}`);
    expect(recovery.mock.calls[0][1]?.method).toBeUndefined();
    await expect(buyResearch({ request, payee, maxTotalMicros: "100000", payer: account.address, directory: path, sign: signer }, vi.fn<typeof fetch>().mockResolvedValue(quoteResponse()))).rejects.toThrow();
    expect(signer).toHaveBeenCalledTimes(1);
    for (const name of await readdir(path)) {
      const file = await readFile(join(path, name), "utf8");
      expect(file).not.toContain('"signature"'); expect(file).not.toContain("1".repeat(64));
    }
  });
  it("preserves a successful PAYMENT-RESPONSE on HTTP 500 without marking delivery completed", async () => {
    const path = await directory();
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(quoteResponse()).mockResolvedValueOnce(new Response("broken", { status: 500, headers: { "payment-response": encode({ success: true, payer: account.address, network: BUYER_NETWORK, transaction: "circle-test-evidence" }) } }));
    await buyResearch({ request, payee, maxTotalMicros: "100000", payer: account.address, directory: path, sign }, http);
    const recovered = await resumeResearch(path, vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 404 })));
    expect(recovered.payment.state).toBe("seller_reported_settled");
    expect(recovered.payment.evidence?.independentlyVerified).toBe(false);
    expect(recovered.status).toBe("not_found_uncertain");
    const intent = await readBuyerJournal(path);
    expect(sellerPaymentEvidence(encode({ success: true, payer: payee, network: BUYER_NETWORK, transaction: "wrong-payer" }), intent)).toBeNull();
    expect(sellerPaymentEvidence(encode({ success: true, payer: account.address, network: "eip155:1", transaction: "wrong-chain" }), intent)).toBeNull();
    expect(sellerPaymentEvidence(encode({ success: false, payer: account.address, network: BUYER_NETWORK, transaction: "failed" }), intent)).toBeNull();
  });
  it("only one concurrent buyer can own a state directory", async () => {
    const path = await directory(); const signer = vi.fn(sign);
    const http = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => (init?.headers as Record<string, string>)["payment-signature"] ? new Response("{}") : quoteResponse());
    const input = { request, payee, maxTotalMicros: "100000", payer: account.address, directory: path, sign: signer };
    const results = await Promise.allSettled([buyResearch(input, http), buyResearch(input, http)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(signer).toHaveBeenCalledTimes(1);
  });
  it("verifies the accepted package and receipt binding, and archives completed receipts", async () => {
    const path = await directory();
    await buyResearch({ request, payee, maxTotalMicros: "100000", payer: account.address, directory: path, sign }, vi.fn<typeof fetch>().mockResolvedValueOnce(quoteResponse()).mockResolvedValueOnce(new Response("{}")));
    const intent = await readBuyerJournal(path);
    const answer = "Test answer";
    const job = { status: "completed", queryId: intent.queryId, answer, researchPackage: a2aResearchPackage("quick"), pricing: { totalPriceUsdc: 0.05, serviceFeeUsdc: 0.02, creatorBudgetUsdc: 0.03, settledCreatorSpendUsdc: 0.01, pendingCreatorSpendUsdc: 0.005, unusedCreatorReserveUsdc: 0.015 } };
    const payload = { schema: RESEARCH_RECEIPT_SCHEMA, dispatch: { id: intent.queryId, question: request.question, answer, answerSha256: sha256(answer), budgetUsdc: request.budget, researchMode: "quick" }, settlement: { mode: "real", ledgerCompleteness: "complete", settledCreatorUsdc: 0.01, pendingCreatorUsdc: 0.005, simulatedCreatorUsdc: 0 } };
    const receipt = { payload, integrity: { algorithm: "sha256", canonicalization: RESEARCH_RECEIPT_CANONICALIZATION, scope: "payload", digest: researchReceiptDigest(payload) } };
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(job)).mockResolvedValueOnce(Response.json(receipt, { headers: { "x-keryx-receipt-digest": receipt.integrity.digest } }));
    const result = await resumeResearch(path, http);
    expect(result.status).toBe("completed");
    expect(result).toHaveProperty("verification.requestBinding", "verified");
    expect(result.payment.state).toBe("unconfirmed");
    const reportHttp = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(job)).mockResolvedValueOnce(Response.json(receipt, { headers: { "x-keryx-receipt-digest": receipt.integrity.digest } }));
    const report = await reportResearch(path, reportHttp);
    expect(report.status).toBe("completed");
    expect(report.receiptVerification?.integrity).toBe("verified");
    expect(JSON.stringify(report)).not.toContain(intent.queryId);
    for (const [, init] of reportHttp.mock.calls) {
      expect(init?.method ?? "GET").toBe("GET");
      expect(init?.headers).toEqual({ accept: "application/json" });
    }
    const tampered = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(job)).mockResolvedValueOnce(Response.json(receipt, { headers: { "x-keryx-receipt-digest": "sha256:wrong" } }));
    await expect(reportResearch(path, tampered)).rejects.toThrow("digest mismatch");
    expect(await readdir(path)).toContain(`receipt-${receipt.integrity.digest.slice(7)}.json`);
    const receiptPath = join(path, `receipt-${receipt.integrity.digest.slice(7)}.json`);
    await writeFile(receiptPath, '{"partial":');
    const retry = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(job)).mockResolvedValueOnce(Response.json(receipt, { headers: { "x-keryx-receipt-digest": receipt.integrity.digest } }));
    await resumeResearch(path, retry);
    expect(JSON.parse(await readFile(receiptPath, "utf8"))).toEqual(receipt);
    expect(() => verifyBuyerJob({ ...job, researchPackage: a2aResearchPackage("deep") }, intent)).toThrow();
    expect(() => verifyBuyerReceipt(receipt, receipt.integrity.digest, { ...intent, request: { ...request, question: "Different question" } }, answer)).toThrow();
    expect(() => verifyBuyerReceipt(receipt, "sha256:wrong", intent, answer)).toThrow();
    expect(() => verifyBuyerReceipt({ ...receipt, payload: { ...payload, dispatch: { ...payload.dispatch, answer: "edited" } } }, receipt.integrity.digest, intent, answer)).toThrow();
    const substituted = { ...payload, dispatch: { ...payload.dispatch, question: "Wrong paid question" } };
    const digest = researchReceiptDigest(substituted);
    expect(() => verifyBuyerReceipt({ payload: substituted, integrity: { ...receipt.integrity, digest } }, digest, intent, answer)).toThrow("bind");
  });
});
