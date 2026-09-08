import { describe, expect, it } from "vitest";
import { buildBuyerReport } from "./report";

const sensitive = "PRIVATE_JOB_QUESTION_QUOTE_WALLET_OR_PATH";
const completed = () => ({
  queryId: sensitive, answer: sensitive, message: sensitive, error: sensitive,
  receiptFile: sensitive, packageFingerprint: sensitive, workspace: sensitive,
  status: "completed",
  payment: { state: "unconfirmed", evidence: { transaction: sensitive, payer: sensitive } },
  pricing: {
    totalPriceUsdc: 0.05, serviceFeeUsdc: 0.02, creatorBudgetUsdc: 0.03,
    settledCreatorSpendUsdc: 0.01, pendingCreatorSpendUsdc: 0.005,
    unusedCreatorReserveUsdc: null, privateField: sensitive,
  },
  serviceReceipt: {
    totalDurationMs: 1234, targetCompletionMs: 180000, targetMet: true,
    quality: { status: "unavailable", groundedClaimRate: null, explanation: sensitive },
    privateField: sensitive,
  },
  serviceStatus: { elapsedMs: 1234, targetCompletionMs: 180000, targetBreached: false, message: sensitive },
  claimCoverage: [{ claimIndex: 0, claim: sensitive, coverage: 0.4, quote: sensitive }],
  evidence: [{ quote: sensitive, sourceName: sensitive }],
  verification: {
    digest: sensitive, integrity: "verified", requestBinding: "verified",
    settlementAuthority: sensitive,
    settlement: {
      mode: "real", ledgerCompleteness: "incomplete", settledCreatorUsdc: 0.01,
      pendingCreatorUsdc: 0.005, simulatedCreatorUsdc: 0, creatorPayments: [{ payee: sensitive }],
    },
  },
});

describe("shareable buyer report", () => {
  it("omits private fields at every nested boundary while preserving pending and unknown values", () => {
    const report = buildBuyerReport(completed());
    expect(JSON.stringify(report)).not.toContain(sensitive);
    expect(report.status).toBe("completed");
    expect(report.payment.state).toBe("unconfirmed");
    expect(report.pricing?.pendingCreatorSpendUsdc).toBe(0.005);
    expect(report.pricing?.unusedCreatorReserveUsdc).toBeNull();
    expect(report.serviceReceipt?.quality).toEqual({ status: "unavailable", groundedClaimRate: null });
    expect(report.targetCoverage).toEqual([{ claimIndex: 0, coverage: 0.4 }]);
    expect(report.receiptVerification?.settlement.ledgerCompleteness).toBe("incomplete");
    expect(report.accountingAgreement).toBe("matches");
    expect(report.authority.creatorSettlement).toContain("not independently verified");
  });

  it.each(["queued", "processing", "review_required", "failed", "not_found_uncertain"])("reports %s without inventing receipt verification or zero accounting", status => {
    const report = buildBuyerReport({ status, payment: { state: "seller_reported_settled", evidence: sensitive }, error: sensitive });
    expect(report.status).toBe(status);
    expect(report.payment.state).toBe("seller_reported_settled");
    expect(report.receiptVerification).toBeNull();
    expect(report.pricing).toBeNull();
    expect(report.targetCoverage).toBeNull();
    expect(report.accountingAgreement).toBe("unavailable");
    expect(JSON.stringify(report)).not.toContain(sensitive);
  });

  it("surfaces disagreement between the job economics and verified receipt instead of choosing a favorable amount", () => {
    const result = completed();
    result.verification.settlement.settledCreatorUsdc = 0.02;
    const report = buildBuyerReport(result);
    expect(report.accountingAgreement).toBe("differs");
    expect(report.pricing?.settledCreatorSpendUsdc).toBe(0.01);
    expect(report.receiptVerification?.settlement.settledCreatorUsdc).toBe(0.02);
  });

  it("requires verification and economics for a completed report", () => {
    expect(() => buildBuyerReport({ ...completed(), verification: undefined })).toThrow();
    expect(() => buildBuyerReport({ ...completed(), pricing: undefined })).toThrow();
  });

  it("refuses malformed allowed fields rather than echoing arbitrary response strings", () => {
    expect(() => buildBuyerReport({ ...completed(), status: sensitive })).toThrow();
    const result = completed();
    result.verification.settlement.ledgerCompleteness = sensitive;
    expect(() => buildBuyerReport(result)).toThrow();
    expect(() => buildBuyerReport({ ...completed(), claimCoverage: [{ claimIndex: 0, coverage: 9 }] })).toThrow();
  });
});
