import { describe, expect, it } from "vitest";
import { evaluateResearchPilot, RESEARCH_PILOT_TRACK_IDS, type ResearchPilotInput } from "./research-pilot";
import template from "../../docs/research-pilot-template.json";

const knownZero = () => ({ status: "documented-zero" as const, currency: "USDC" as const,
  amount: "0", evidenceId: "ev-zero0001" });
const knownCosts = () => ({ ai: knownZero(), discovery: knownZero(), infrastructure: knownZero(),
  paymentAndGas: knownZero(), support: knownZero(), acquisition: knownZero(), other: knownZero() });

function sampleJob(index: number, track: ResearchPilotInput["jobs"][number]["track"] = "api-platform"):
ResearchPilotInput["jobs"][number] {
  const code = String(index).padStart(8, "0");
  return {
    jobId: `job-${code}`, buyerId: "buyer-00000001", track,
    initiatedAt: `2026-10-${index === 1 ? "02" : "05"}T00:00:00Z`, status: "completed",
    origin: { kind: "buyer-initiated", evidenceId: `ev-origin${code}` },
    payment: { network: "arc-mainnet", status: "settled", funding: "independent-buyer", serviceFeeUsdc: "10",
      settledAt: `2026-10-${index === 1 ? "02" : "05"}T01:00:00Z`,
      receiptEvidenceId: `ev-receipt${code}`, fundingEvidenceId: `ev-funding${code}` },
    refunds: { coverage: "complete", settledUsdc: "0", pendingUsdc: "0", evidenceId: `ev-refund${code}` },
    outcome: { status: "accepted", observedAt: `2026-10-${index === 1 ? "03" : "06"}T00:00:00Z`, evidenceId: `ev-accepted${code}` },
    creatorFunds: { collectedUsdc: "5", settledPaymentsUsdc: "1", pendingObligationsUsdc: "2" },
    directCosts: { ...knownCosts(), ai: { status: "invoice-reconciled", currency: "USDC", amount: "1", evidenceId: `ev-invoice${code}` } },
    willingness: { offeredServiceFeeUsdc: "15", response: "would-pay", evidenceId: `ev-response${code}` },
  };
}

function cohort(): ResearchPilotInput {
  return {
    version: 1, basis: "operator-entered",
    cohort: { startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z", jobCoverage: "complete", evidenceId: "ev-cohort0001" },
    usdConversion: null,
    tracks: RESEARCH_PILOT_TRACK_IDS.map(id => ({ id, targetContributionUsdcPerPaidJob: "2", unassignedDirectCosts: knownCosts() })),
    jobs: [sampleJob(1), sampleJob(2)],
  };
}

const apiTrack = (input: unknown) => evaluateResearchPilot(input).tracks[0];

describe("private specialist research cohort evidence", () => {
  it("reports service fee contribution, same-track acceptance/return, and a cohort price floor separately", () => {
    const result = apiTrack(cohort());
    expect(result.independentMainnetPayments).toMatchObject({ settledJobs: 2, buyers: 1,
      grossServiceFeesUsdc: "20.000000", netSettledServiceFeesUsdc: "20.000000" });
    expect(result.outcomes).toMatchObject({ acceptedIndependentPaidJobs: 2, sameTrackIndependentReturningBuyers: 1 });
    expect(result.serviceFeeOnlyContribution).toMatchObject({ status: "positive-on-entered-evidence", amountUsdcOnDeclaredBasis: "18.000000" });
    expect(result.pricePlanning).toMatchObject({ requiredRetainedServiceFeeUsdc: "3.000000", chargeableJobsInDenominator: 2 });
    expect(result.evidence).toMatchObject({ status: "meets-entered-evidence-conditions", independentlyVerified: false });
    expect(result.creatorFundsExcludedFromServiceRevenue).toMatchObject({ network: "arc-mainnet", collectedUsdc: "10.000000",
      settledSourceAndCreatorPaymentsUsdc: "2.000000", pendingSourceAndCreatorObligationsUsdc: "4.000000",
      unusedReserveRecognizedAsServiceRevenue: false });
  });

  it("never treats a strong single track as establishment of all three", () => {
    const result = evaluateResearchPilot(cohort());
    expect(result.tracks[0].evidence.status).toBe("meets-entered-evidence-conditions");
    expect(result.overall.evidence.status).toBe("not-established");
    expect(result.tracks[1].pricePlanning!.requiredRetainedServiceFeeUsdc).toBeNull();
  });

  it("counts a cross-track buyer as separate demand without inventing niche retention", () => {
    const input = cohort();
    input.jobs[1].track = "saas-competition";
    const result = evaluateResearchPilot(input);
    expect(result.overall.independentMainnetPayments.buyers).toBe(1);
    expect(result.overall.outcomes.sameTrackIndependentReturningBuyers).toBe(0);
    expect(result.tracks.every(track => track.outcomes.sameTrackIndependentReturningBuyers === 0)).toBe(true);
    expect(result.overall.evidence.missingConditions).toContain("no-evidenced-same-track-independent-return");
  });

  it.each(["arc-testnet", "simulation", "unknown"] as const)("does not monetize %s evidence", network => {
    const input = cohort();
    input.jobs.forEach(item => { item.payment.network = network; });
    const result = apiTrack(input);
    expect(result.independentMainnetPayments.settledJobs).toBe(0);
    expect(result.independentMainnetPayments.grossServiceFeesUsdc).toBe("0.000000");
    expect(result.serviceFeeOnlyContribution.amountUsdcOnDeclaredBasis).toBe("-2.000000");
    expect(result.pricePlanning!.requiredRetainedServiceFeeUsdc).toBeNull();
  });

  it.each(["sponsored", "team", "unknown"] as const)("excludes %s funding while keeping its costs", funding => {
    const input = cohort();
    input.jobs.forEach(item => { item.payment.funding = funding; });
    const result = apiTrack(input);
    expect(result.independentMainnetPayments.buyers).toBe(0);
    expect(result.serviceFeeOnlyContribution.amountUsdcOnDeclaredBasis).toBe("-2.000000");
    expect(result.outcomes.acceptedJobsAll).toBe(2);
    expect(result.outcomes.acceptedIndependentPaidJobs).toBe(0);
  });

  it("requires independent funding evidence beyond a buyer-initiated request", () => {
    const input = cohort();
    input.jobs[1].payment.fundingEvidenceId = null;
    const result = apiTrack(input);
    expect(result.independentMainnetPayments.settledJobs).toBe(1);
    expect(result.outcomes.sameTrackIndependentReturningBuyers).toBe(0);
  });

  it.each(["operator-prompted", "sponsored-invite", "unknown"] as const)("does not treat a %s return as retention", kind => {
    const input = cohort();
    input.jobs[1].origin.kind = kind;
    const result = apiTrack(input);
    expect(result.independentMainnetPayments.settledJobs).toBe(2);
    expect(result.outcomes.sameTrackIndependentReturningBuyers).toBe(0);
  });

  it("requires separate request-origin evidence and a request after prior acceptance", () => {
    const input = cohort();
    input.jobs[1].origin.evidenceId = null;
    expect(apiTrack(input).outcomes.sameTrackIndependentReturningBuyers).toBe(0);
    input.jobs[1].origin.evidenceId = "ev-origin0002";
    input.jobs[1].initiatedAt = input.jobs[0].outcome.observedAt!;
    expect(apiTrack(input).outcomes.sameTrackIndependentReturningBuyers).toBe(0);
  });

  it("rejects reused origin/payment evidence, pre-request settlement and known creator funding deficits", () => {
    const input = cohort();
    input.jobs[1].origin.evidenceId = input.jobs[0].origin.evidenceId;
    expect(() => evaluateResearchPilot(input)).toThrow();
    input.jobs[1].origin.evidenceId = input.jobs[1].payment.receiptEvidenceId;
    expect(() => evaluateResearchPilot(input)).toThrow();
    input.jobs[1] = sampleJob(2);
    input.jobs[1].payment.settledAt = "2026-10-04T00:00:00Z";
    expect(() => evaluateResearchPilot(input)).toThrow();
    input.jobs[1] = sampleJob(2);
    input.jobs[1].creatorFunds.collectedUsdc = "2";
    expect(() => evaluateResearchPilot(input)).toThrow();
  });

  it("keeps unknown creator obligations unknown and distinct network balances separate", () => {
    const input = cohort();
    input.jobs[0].creatorFunds.pendingObligationsUsdc = null;
    input.jobs[1].payment.network = "arc-testnet";
    input.jobs[1].creatorFunds.collectedUsdc = "99";
    const result = apiTrack(input);
    expect(result.creatorFundsExcludedFromServiceRevenue).toMatchObject({ network: "arc-mainnet",
      collectedUsdc: "5.000000", pendingSourceAndCreatorObligationsUsdc: null });
    expect(result.creatorFundsExcludedFromServiceRevenue.otherNetworks[0]).toMatchObject({ network: "arc-testnet", collectedUsdc: "99.000000" });
    expect(result.creatorFundsExcludedFromServiceRevenue.unusedReserveRecognizedAsServiceRevenue).toBe(false);
    expect(result.serviceFeeOnlyContribution.amountUsdcOnDeclaredBasis).toBe("8.000000");
  });

  it("deducts refunds and excludes fully refunded jobs from accepted paid outcomes and pricing denominator", () => {
    const input = cohort();
    input.jobs[0].refunds.settledUsdc = "10";
    input.jobs[1].refunds.settledUsdc = "3";
    const result = apiTrack(input);
    expect(result.independentMainnetPayments).toMatchObject({ settledJobs: 2, retainedPaidJobs: 1,
      settledServiceRefundsUsdc: "13.000000", netSettledServiceFeesUsdc: "7.000000" });
    expect(result.outcomes).toMatchObject({ acceptedIndependentPaidJobs: 1, sameTrackIndependentReturningBuyers: 0 });
    expect(result.serviceFeeOnlyContribution.amountUsdcOnDeclaredBasis).toBe("5.000000");
    expect(result.pricePlanning!.requiredRetainedServiceFeeUsdc).toBe("4.000000");
  });

  it("cannot claim positive contribution with pending refunds or unearned unfinished work", () => {
    const input = cohort();
    input.jobs[1].refunds = { coverage: "pending", settledUsdc: "0", pendingUsdc: "2", evidenceId: "ev-pending0001" };
    expect(apiTrack(input).serviceFeeOnlyContribution.status).toBe("unknown");
    expect(apiTrack(input).pricePlanning!.requiredRetainedServiceFeeUsdc).toBeNull();
    input.jobs[1] = { ...sampleJob(2), status: "pending", outcome: { status: "not-reviewed", observedAt: null, evidenceId: null } };
    const result = apiTrack(input);
    expect(result.serviceFeeOnlyContribution.status).toBe("unknown");
    expect(result.evidence.missingConditions).toContain("unfinished-cohort-jobs");
  });

  it("includes failed jobs, sponsored trials and allocated acquisition costs in cost recovery", () => {
    const input = cohort();
    const failed = sampleJob(3);
    failed.status = "failed";
    failed.payment.funding = "sponsored";
    failed.outcome = { status: "unknown", observedAt: null, evidenceId: null };
    failed.directCosts.ai.amount = "20";
    input.jobs.push(failed);
    input.tracks[0].unassignedDirectCosts.acquisition = { status: "documented-direct", currency: "USDC", amount: "1", evidenceId: "ev-acquire0001" };
    const result = apiTrack(input);
    expect(result.jobs).toMatchObject({ total: 3, failedOrCancelled: 1, sponsoredOrTeam: 1 });
    expect(result.directCostCoverage.totalUsdcOnDeclaredBasis).toBe("23.000000");
    expect(result.serviceFeeOnlyContribution.amountUsdcOnDeclaredBasis).toBe("-3.000000");
    expect(result.pricePlanning!.requiredRetainedServiceFeeUsdc).toBe("13.500000");
  });

  it.each(["failed", "cancelled"] as const)("holds unrefunded paid %s work despite two accepted returning jobs", status => {
    const input = cohort();
    const unresolved = sampleJob(3);
    unresolved.status = status;
    unresolved.payment.serviceFeeUsdc = "1000";
    unresolved.outcome = { status: "unknown", observedAt: null, evidenceId: null };
    input.jobs.push(unresolved);
    const result = apiTrack(input);
    expect(result.independentMainnetPayments).toMatchObject({ settledJobs: 3, retainedPaidJobs: 2,
      unresolvedPaidDeliveryJobs: 1, netSettledServiceFeesUsdc: "1020.000000" });
    expect(result.directCostCoverage.totalUsdcOnDeclaredBasis).toBe("3.000000");
    expect(result.outcomes).toMatchObject({ acceptedIndependentPaidJobs: 2, sameTrackIndependentReturningBuyers: 1 });
    expect(result.serviceFeeOnlyContribution).toMatchObject({ status: "unknown", amountUsdcOnDeclaredBasis: null });
    expect(result.pricePlanning).toMatchObject({ status: "unknown", chargeableJobsInDenominator: 2,
      requiredRetainedServiceFeeUsdc: null });
    expect(result.evidence.status).toBe("not-established");
    expect(result.evidence.missingConditions).toContain("paid-delivery-remedy-unresolved");

    unresolved.refunds.settledUsdc = "999";
    expect(apiTrack(input).serviceFeeOnlyContribution.status).toBe("unknown");
  });

  it.each(["failed", "cancelled"] as const)("keeps fully refunded paid %s work in costs and out of retained jobs", status => {
    const input = cohort();
    const refunded = sampleJob(3);
    refunded.status = status;
    refunded.payment.serviceFeeUsdc = "1000";
    refunded.refunds.settledUsdc = "1000";
    refunded.outcome = { status: "unknown", observedAt: null, evidenceId: null };
    input.jobs.push(refunded);
    const result = apiTrack(input);
    expect(result.independentMainnetPayments).toMatchObject({ retainedPaidJobs: 2, unresolvedPaidDeliveryJobs: 0,
      netSettledServiceFeesUsdc: "20.000000" });
    expect(result.directCostCoverage.totalUsdcOnDeclaredBasis).toBe("3.000000");
    expect(result.serviceFeeOnlyContribution.amountUsdcOnDeclaredBasis).toBe("17.000000");
    expect(result.pricePlanning).toMatchObject({ requiredRetainedServiceFeeUsdc: "3.500000", chargeableJobsInDenominator: 2 });
    expect(result.evidence.status).toBe("meets-entered-evidence-conditions");
  });

  it("reports required retained fees after refunds without inventing a gross charge or refund forecast", () => {
    const input = cohort();
    input.jobs.forEach(item => { item.refunds.settledUsdc = "9"; });
    const result = apiTrack(input);
    expect(result.independentMainnetPayments.netSettledServiceFeesUsdc).toBe("2.000000");
    expect(result.serviceFeeOnlyContribution.amountUsdcOnDeclaredBasis).toBe("0.000000");
    expect(result.pricePlanning).toMatchObject({ requiredRetainedServiceFeeUsdc: "3.000000",
      grossChargePricing: { status: "unavailable", reason: "future-refund-loss-assumptions-and-terms-not-supplied" } });
    expect(result.pricePlanning).not.toHaveProperty("minimumServiceFeeUsdc");
  });

  it.each(["unknown", "pending", "estimate"] as const)("leaves %s costs unknown even when a price estimate is entered", status => {
    const input = cohort();
    input.jobs[1].directCosts.ai = { status, currency: "USDC", amount: "0.01", evidenceId: "ev-estimate0001" };
    const result = apiTrack(input);
    expect(result.directCostCoverage).toMatchObject({ status: "incomplete", unresolvedEntries: 1, totalUsdcOnDeclaredBasis: null });
    expect(result.serviceFeeOnlyContribution.status).toBe("unknown");
    expect(result.pricePlanning!.requiredRetainedServiceFeeUsdc).toBeNull();
  });

  it("refuses implicit USD/USDC parity and rounds declared conversion costs conservatively", () => {
    const input = cohort();
    input.jobs[0].directCosts.ai.currency = "USD";
    input.jobs[0].directCosts.ai.amount = "0.000001";
    const unresolved = apiTrack(input);
    expect(unresolved.directCostCoverage.usdEntriesWithoutConversion).toBe(1);
    expect(unresolved.serviceFeeOnlyContribution.status).toBe("unknown");
    input.usdConversion = { numerator: "2", denominator: "3", basis: "operator-assumption", observedAt: "2026-10-01T00:00:00Z", evidenceId: "ev-rate00001" };
    const resolved = apiTrack(input);
    expect(resolved.directCostCoverage.totalUsdcOnDeclaredBasis).toBe("1.000001");
    expect(resolved.serviceFeeOnlyContribution.amountUsdcOnDeclaredBasis).toBe("18.999999");
    expect(resolved.pricePlanning!.costRecoveryUsdcPerRetainedIndependentPaidJob).toBe("0.500001");
    expect(resolved.pricePlanning!.requiredRetainedServiceFeeUsdc).toBe("2.500001");
  });

  it("does not turn unknown/unfinished cohort coverage or a missing contribution target into a price", () => {
    const input = cohort();
    input.cohort.jobCoverage = "partial";
    expect(apiTrack(input).serviceFeeOnlyContribution.status).toBe("unknown");
    input.cohort.jobCoverage = "complete";
    input.tracks[0].targetContributionUsdcPerPaidJob = null;
    expect(apiTrack(input).pricePlanning!.requiredRetainedServiceFeeUsdc).toBeNull();
    expect(apiTrack(input).serviceFeeOnlyContribution.status).toBe("positive-on-entered-evidence");
  });

  it("keeps offers/willingness and pending creator obligations separate from receipts", () => {
    const input = cohort();
    input.jobs.forEach(item => { item.payment.status = "pending"; });
    const result = apiTrack(input);
    expect(result.willingness.evidencedWouldPayResponses).toBe(2);
    expect(result.independentMainnetPayments.grossServiceFeesUsdc).toBe("0.000000");
    expect(result.creatorFundsExcludedFromServiceRevenue.pendingSourceAndCreatorObligationsUsdc).toBe("4.000000");
    expect(result.serviceFeeOnlyContribution.amountUsdcOnDeclaredBasis).toBe("-2.000000");
  });

  it("keeps illustrative empty cohorts unknown and strips all opaque IDs from output", () => {
    const empty = evaluateResearchPilot(template);
    expect(empty.basis).toBe("illustrative");
    expect(empty.tracks.every(track => track.serviceFeeOnlyContribution.status === "unknown")).toBe(true);
    const rendered = JSON.stringify(evaluateResearchPilot(cohort()));
    expect(rendered).not.toContain("buyer-00000001");
    expect(rendered).not.toContain("job-00000001");
    expect(rendered).not.toContain("ev-");
    expect(rendered).not.toContain("receiptEvidenceId");
  });

  it("refuses duplicate jobs, duplicate receipt evidence and missing track coverage", () => {
    const input = cohort();
    input.jobs[1].jobId = input.jobs[0].jobId;
    expect(() => evaluateResearchPilot(input)).toThrow();
    input.jobs[1].jobId = "job-00000002";
    input.jobs[1].payment.receiptEvidenceId = input.jobs[0].payment.receiptEvidenceId;
    expect(() => evaluateResearchPilot(input)).toThrow();
    input.jobs[1].payment.receiptEvidenceId = "ev-distinct0001";
    input.tracks[1].id = "api-platform";
    expect(() => evaluateResearchPilot(input)).toThrow();
  });

  it.each(["-1", "1e3", "1.0000001", "1000000000", "NaN"])("refuses non-bounded exact money %s", invalid => {
    const input = cohort();
    input.jobs[0].payment.serviceFeeUsdc = invalid;
    expect(() => evaluateResearchPilot(input)).toThrow();
  });

  it("refuses omitted cost categories, extra private fields, inconsistent zero, refunds and acceptance", () => {
    const input = cohort();
    expect(() => evaluateResearchPilot({ ...input, customerEmail: "private@example.invalid" })).toThrow();
    expect(() => evaluateResearchPilot({ ...input, jobs: [{ ...input.jobs[0], question: "private question" }] })).toThrow();
    const incomplete = { ...knownCosts(), support: undefined };
    expect(() => evaluateResearchPilot({ ...input, jobs: [{ ...input.jobs[0], directCosts: incomplete }] })).toThrow();
    input.jobs[0].directCosts.support.amount = "1";
    expect(() => evaluateResearchPilot(input)).toThrow();
    input.jobs[0].directCosts.support = knownZero();
    input.jobs[0].refunds.settledUsdc = "11";
    expect(() => evaluateResearchPilot(input)).toThrow();
    input.jobs[0].refunds.settledUsdc = "0";
    input.jobs[0].outcome.evidenceId = null;
    expect(() => evaluateResearchPilot(input)).toThrow();
  });

  it("refuses outside-period jobs/settlements and records beyond bounded size", () => {
    const input = cohort();
    input.jobs[0].initiatedAt = "2026-09-30T23:59:59Z";
    expect(() => evaluateResearchPilot(input)).toThrow();
    input.jobs[0] = sampleJob(1);
    input.jobs[0].payment.settledAt = "2026-11-01T00:00:00Z";
    expect(() => evaluateResearchPilot(input)).toThrow();
    expect(() => evaluateResearchPilot({ ...input, jobs: Array.from({ length: 10_001 }, () => sampleJob(1)) })).toThrow();
  });
});
