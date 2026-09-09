import { describe, expect, it } from "vitest";
import { a2aResearchPackage, a2aResearchPackageFingerprint } from "../a2a/research-package";
import { a2aPackageFingerprintInput, a2aResearchPackageForVersion, acceptsA2aPackageVersion } from "../a2a/research-package-definition";
import { browserSha256 } from "../browser-receipt-integrity";
import { researchReceiptDigest, sha256 } from "../research-receipt-integrity";
import { authorizationWithNonce, buyerIntentEnvelopeSchema } from "./protocol";
import { buyerJobId } from "./policy";
import { verifyBuyerJob, verifyBuyerReceipt } from "./verify-result";
import { verifyBrowserBuyerJob, verifyBrowserBuyerReceipt, verifyBrowserIntent } from "./browser-result";

function fixture() {
  const payer = `0x${"a".repeat(40)}`, payee = `0x${"b".repeat(40)}`;
  const requirement = { scheme: "exact" as const, network: "eip155:5042002" as const, asset: "0x3600000000000000000000000000000000000000", amount: "50000", payTo: payee, maxTimeoutSeconds: 691200, extra: { name: "GatewayWalletBatched" as const, version: "1" as const, verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" } };
  const authorization = authorizationWithNonce(payer, requirement, `0x${"01".repeat(32)}`, 1_789_000_000_000);
  const intent = buyerIntentEnvelopeSchema.parse({ schema: "keryx-buyer-intent-v1", request: { question: "Explain receipt recovery", budget: 0.03, researchMode: "quick", packageVersion: "1.0.0", responseMode: "async" }, requirement, authorization, queryId: buyerJobId(authorization) });
  const answer = "Keep the journal and recover the same job.";
  const job = { queryId: intent.queryId, status: "completed", answer, researchPackage: a2aResearchPackage("quick"), pricing: { serviceFeeUsdc: 0.02, creatorBudgetUsdc: 0.03, totalPriceUsdc: 0.05, settledCreatorSpendUsdc: 0.01, pendingCreatorSpendUsdc: 0.005, unusedCreatorReserveUsdc: 0.015 } };
  const payload = { schema: "urn:keryx:research-receipt:1", dispatch: { id: intent.queryId, question: intent.request.question, answer, answerSha256: sha256(answer), budgetUsdc: 0.03, researchMode: "quick" }, settlement: { mode: "real", ledgerCompleteness: "complete", settledCreatorUsdc: 0.01, pendingCreatorUsdc: 0.005, simulatedCreatorUsdc: 0 } };
  const receipt = { payload, integrity: { algorithm: "sha256", scope: "payload", canonicalization: "keryx-json-v1", digest: researchReceiptDigest(payload) } };
  return { intent, job, receipt, answer };
}

describe("portable buyer result verification", () => {
  it.each(["__proto__", "constructor", "toString", "2.0.0"])("refuses unregistered package version %s", version => {
    expect(acceptsA2aPackageVersion(version)).toBe(false);
    expect(a2aResearchPackageForVersion("quick", version)).toBeNull();
  });
  it.each([
    ["quick", "97d169ee73d9bab3034b139d438a51e77cfedca976f1ffb649c148a3d7f2d89a"],
    ["deep", "3bbbf0c9954c8c7d8a075eb028a71a88819ace0d9230cbc4cd83cc33f0fa65ea"],
  ] as const)("preserves the pre-refactor %s package fingerprint", async (mode, expected) => {
    const contract = a2aResearchPackage(mode);
    expect(a2aResearchPackageFingerprint(contract)).toBe(expected);
    expect(await browserSha256(a2aPackageFingerprintInput(contract))).toBe(`sha256:${expected}`);
  });

  it("preserves Node results, including pending accounting and evidence authority", async () => {
    const { intent, job, receipt, answer } = fixture();
    expect(await verifyBrowserIntent(intent)).toEqual(intent);
    expect(await verifyBrowserBuyerJob(job, intent)).toEqual(verifyBuyerJob(job, intent));
    expect(await verifyBrowserBuyerReceipt(receipt, receipt.integrity.digest, intent, answer)).toEqual(verifyBuyerReceipt(receipt, receipt.integrity.digest, intent, answer));
  });

  it("refuses a corrupted or signature-bearing imported journal", async () => {
    const { intent } = fixture();
    for (const value of [{ ...intent, queryId: `a2a_${"c".repeat(64)}` }, { ...intent, signature: "must never be stored" }, { ...intent, authorization: { ...intent.authorization, value: "60000" } }, { ...intent, authorization: { ...intent.authorization, to: intent.authorization.from } }]) {
      await expect(verifyBrowserIntent(value)).rejects.toThrow();
    }
  });

  it("rejects changes to completed job economics and package contract", async () => {
    const { intent, job } = fixture();
    for (const value of [{ ...job, researchPackage: a2aResearchPackage("deep") }, { ...job, pricing: { ...job.pricing, totalPriceUsdc: 0.06 } }, { ...job, pricing: undefined }, { ...job, pricing: { ...job.pricing, pendingCreatorSpendUsdc: 0.03 } }]) {
      await expect(verifyBrowserBuyerJob(value, intent)).rejects.toThrow();
      expect(() => verifyBuyerJob(value, intent)).toThrow();
    }
  });

  it.each(["question", "answer", "budgetUsdc", "researchMode", "id"])("refuses a rehashed receipt with changed %s", async field => {
    const { intent, receipt, answer } = fixture();
    const dispatch = receipt.payload.dispatch as Record<string, unknown>;
    dispatch[field] = field === "budgetUsdc" ? 0.04 : "Changed";
    receipt.integrity.digest = researchReceiptDigest(receipt.payload);
    await expect(verifyBrowserBuyerReceipt(receipt, receipt.integrity.digest, intent, answer)).rejects.toThrow();
  });

  it("rejects unverified, simulated or out-of-cap settlement projections", async () => {
    for (const patch of [{ mode: "offline" }, { simulatedCreatorUsdc: 0.01 }, { pendingCreatorUsdc: 0.03 }]) {
      const { intent, receipt, answer } = fixture();
      Object.assign(receipt.payload.settlement, patch);receipt.integrity.digest = researchReceiptDigest(receipt.payload);
      await expect(verifyBrowserBuyerReceipt(receipt, receipt.integrity.digest, intent, answer)).rejects.toThrow();
    }
    const { intent, receipt, answer } = fixture();
    await expect(verifyBrowserBuyerReceipt(receipt, null, intent, answer)).rejects.toThrow();
  });
});
