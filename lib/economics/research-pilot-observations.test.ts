import { describe, expect, it } from "vitest";
import { evaluateResearchPilot, RESEARCH_PILOT_TRACK_IDS, type ResearchPilotInput } from "./research-pilot";
import type { PilotRequesterObservation } from "./research-pilot-observations";
import template from "../../docs/research-pilot-template.json";

// Entirely synthetic entered records. No participant, consent, payment or outcome is real.
const zero = () => ({ status: "documented-zero" as const, currency: "USDC" as const, amount: "0", evidenceId: "ev-zero00001" });
const costs = () => ({ ai: zero(), discovery: zero(), infrastructure: zero(), paymentAndGas: zero(), support: zero(), acquisition: zero(), other: zero() });
const time = (day: number, hour = 0) => `2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`;
const observations = (): NonNullable<PilotRequesterObservation["observations"]> => ({ format: "keryx-recorded-job-observations-v1",
  generationDurationMs: 1000, durationBasis: "recorded-orchestrator-completion", modelCostUsd: { lower: 0.01, upper: 0.02 },
  costBasis: "partial-captured-policy-estimate", recordedCalls: 2, failedCalls: 0, pendingCalls: 0, missingUsageCalls: 0,
  unpricedUsageRecords: 0, usageRecords: 2, excluded: "search-infrastructure-gas-and-unrecorded-provider-charges", invoice: null, profit: null });
function sampleJob(index: number, day = index, groupId = "group-00000001"): ResearchPilotInput["jobs"][number] {
  const code = String(index).padStart(8, "0");
  return { jobId: `job-${code}`, buyerId: `buyer-${code}`, track: "scholarly-literature", initiatedAt: time(day), status: "completed",
    origin: { kind: "buyer-initiated", evidenceId: `ev-origin${code}` },
    payment: { network: "arc-mainnet", status: "settled", funding: "independent-buyer", serviceFeeUsdc: "1", settledAt: time(day),
      receiptEvidenceId: `ev-receipt${code}`, fundingEvidenceId: `ev-funding${code}` },
    refunds: { coverage: "complete", settledUsdc: "0", pendingUsdc: "0", evidenceId: `ev-refund${code}` },
    outcome: { status: "accepted", observedAt: time(day, 1), evidenceId: `ev-outcome${code}` },
    creatorFunds: { collectedUsdc: "0", settledPaymentsUsdc: "0", pendingObligationsUsdc: "0" }, directCosts: costs(),
    willingness: { offeredServiceFeeUsdc: null, response: "unknown", evidenceId: null },
    requesterObservation: { format: "keryx-pilot-requester-observation-v1", consent: { scope: "private-pilot-evaluation", evidenceId: `ev-consent${code}`, recordedAt: time(day) },
      evidenceId: `ev-observation${code}`, observedAt: time(day, 2), choice: "useful", observations: observations(),
      group: { groupId, classification: "outside", evidenceId: `ev-group${code}` },
      fundingWallet: { walletId: `wallet-${groupId.slice(6)}`, evidenceId: `ev-wallet${code}` } } };
}
function cohort(jobs: ResearchPilotInput["jobs"]): ResearchPilotInput {
  return { version: 1, basis: "operator-entered", cohort: { startsAt: time(1), endsAt: "2026-11-01T00:00:00Z", jobCoverage: "complete", evidenceId: "ev-cohort0001" },
    usdConversion: null, tracks: RESEARCH_PILOT_TRACK_IDS.map(id => ({ id, targetContributionUsdcPerPaidJob: null, unassignedDirectCosts: costs() })), jobs };
}
const report = (input: unknown) => evaluateResearchPilot(input).overall.requesterObservations;

describe("consent-backed original requester measurements", () => {
  it("keeps legacy input valid and never infers usefulness from accepted paid work or silence", () => {
    const job = sampleJob(1); delete job.requesterObservation;
    expect(report(cohort([job]))).toMatchObject({ jobs: 1, consentedObservationJobs: 0, jobsWithoutObservation: 1,
      responses: 0, useful: 0, responseRate: null, usefulnessAmongResponses: null,
      recordedDuration: { samples: 0, medianMs: null, p95Ms: null }, partialModelCosts: { bounds: null },
      groups: { independentlyFundedOutsideGroups: 0, acceptedIndependentDeliverables: 0, targetStatus: "not-established" } });
    expect(report(template).groups.targetStatus).toBe("illustrative-no-real-pilot-evidence");
  });

  it("separates explicit opinions, silence, missing duration/costs and each declared funding cohort", () => {
    const jobs = [sampleJob(1), sampleJob(2), sampleJob(3), sampleJob(4), sampleJob(5)];
    jobs[1].payment.funding = "sponsored"; jobs[1].requesterObservation!.choice = "revise";
    Object.assign(jobs[1].requesterObservation!.observations!, { generationDurationMs: 3000, modelCostUsd: null, missingUsageCalls: 1, unpricedUsageRecords: 2 });
    jobs[2].payment.funding = "team"; jobs[2].requesterObservation!.choice = "reject";
    jobs[2].requesterObservation!.group = null;
    Object.assign(jobs[2].requesterObservation!.observations!, { generationDurationMs: null, modelCostUsd: { lower: 0, upper: 0 } });
    jobs[3].payment.funding = "unknown"; jobs[3].requesterObservation!.choice = null; jobs[3].requesterObservation!.observations = null;
    delete jobs[4].requesterObservation;
    const result = report(cohort(jobs));
    expect(result).toMatchObject({ jobs: 5, consentedObservationJobs: 4, jobsWithoutObservation: 1, responses: 3, silence: 1,
      useful: 1, needsRevision: 1, unusable: 1, responseRate: 0.75, usefulnessAmongResponses: 1 / 3,
      recordedDuration: { samples: 2, medianMs: 2000, p95Ms: 3000, missingAmongConsentedJobs: 2 },
      partialModelCosts: { jobsWithBounds: 2, jobsWithoutBoundsAmongConsented: 2, bounds: { lower: 0.01, upper: 0.02 },
        missingUsageCalls: 1, unpricedUsageRecords: 2, invoice: null, profit: null },
      evidencedIndependentMainnet: { jobs: 2, consentedObservationJobs: 1, useful: 1 } });
    expect(result.byDeclaredFunding.map(group => [group.funding, group.responses])).toEqual([
      ["independent-buyer", 1], ["sponsored", 1], ["team", 1], ["unknown", 0],
    ]);
  });

  it("keeps every existing financial result unchanged when partial observation costs are supplied", () => {
    const input = cohort([sampleJob(1), sampleJob(2)]), plain = structuredClone(input);
    for (const job of plain.jobs) delete job.requesterObservation;
    input.jobs[0].requesterObservation!.observations!.modelCostUsd = { lower: 500, upper: 2000 };
    const strip = (value: ReturnType<typeof evaluateResearchPilot>) => {
      const out = structuredClone(value);
      for (const record of [out.overall, ...out.tracks]) Reflect.deleteProperty(record, "requesterObservations");
      return out;
    };
    expect(strip(evaluateResearchPilot(input))).toEqual(strip(evaluateResearchPilot(plain)));
  });

  it("counts distinct entered outside groups and actual second-week group returns, not unique people", () => {
    const jobs = [sampleJob(1, 1), sampleJob(2, 9), sampleJob(3, 10), sampleJob(4, 11),
      sampleJob(5, 2, "group-00000002"), sampleJob(6, 3, "group-00000002"), sampleJob(7, 4, "group-00000002"),
      sampleJob(8, 3, "group-00000003"), sampleJob(9, 4, "group-00000003"), sampleJob(10, 5, "group-00000003")];
    const input = cohort(jobs), result = report(input);
    expect(result.groups).toMatchObject({ reportedOutsideGroups: 3, independentlyFundedOutsideGroups: 3,
      independentlyFundedOutsideWallets: 3, acceptedIndependentDeliverables: 10, secondWeekReturningOutsideGroups: 1,
      targetStatus: "meets-entered-record-targets-not-independently-verified" });
    expect(result.independentlyVerified).toBe(false);
    expect(evaluateResearchPilot(input).overall.outcomes.sameTrackIndependentReturningBuyers).toBe(0);
    for (const job of input.jobs) job.requesterObservation!.fundingWallet!.walletId = "wallet-00000001";
    expect(report(input).groups).toMatchObject({ independentlyFundedOutsideGroups: 3, independentlyFundedOutsideWallets: 1, targetStatus: "not-established" });
    input.basis = "illustrative";
    expect(report(input).groups.targetStatus).toBe("illustrative-no-real-pilot-evidence");
  });

  it.each(["early", "third-week", "prompted", "sponsored", "unknown-group", "before-acceptance", "no-origin-proof", "testnet", "refunded"])(
    "does not turn %s into an independent second-week return", scenario => {
      const first = sampleJob(1, 1), second = sampleJob(2, scenario === "early" ? 5 : scenario === "third-week" ? 15 : 9);
      if (scenario === "prompted") second.origin.kind = "operator-prompted";
      if (scenario === "sponsored") second.payment.funding = "sponsored";
      if (scenario === "unknown-group") first.requesterObservation!.group!.classification = "unknown";
      if (scenario === "before-acceptance") first.outcome.observedAt = time(12);
      if (scenario === "no-origin-proof") second.origin.evidenceId = null;
      if (scenario === "testnet") first.payment.network = "arc-testnet";
      if (scenario === "refunded") first.refunds.settledUsdc = "1";
      expect(report(cohort([first, second])).groups.secondWeekReturningOutsideGroups).toBe(0);
    });

  it("keeps overflowing numeric model estimates unavailable instead of emitting Infinity or zero", () => {
    const jobs = [sampleJob(1), sampleJob(2)];
    for (const job of jobs) job.requesterObservation!.observations!.modelCostUsd = { lower: 1e308, upper: 1e308 };
    expect(report(cohort(jobs)).partialModelCosts).toMatchObject({ bounds: null, aggregateOutOfRange: true });
  });

  it("refuses missing consent, private capability fields, bad dates and reused original observations", () => {
    const input = cohort([sampleJob(1)]), packet = input.jobs[0].requesterObservation!;
    const malformed = [
      { ...packet, consent: { ...packet.consent, evidenceId: null } }, { ...packet, token: "PRIVATE_CAPABILITY" },
      { ...packet, reason: "PRIVATE_REASON" }, { ...packet, observedAt: "2026-09-30T00:00:00Z" },
      { ...packet, observedAt: "2026-11-02T00:00:00Z" },
      { ...packet, consent: { ...packet.consent, recordedAt: time(2) } },
      { ...packet, observations: { ...observations(), generationDurationMs: 1e20 } },
    ];
    for (const requesterObservation of malformed) expect(() => evaluateResearchPilot({ ...input, jobs: [{ ...input.jobs[0], requesterObservation }] })).toThrow();
    const second = sampleJob(2); second.requesterObservation!.evidenceId = packet.evidenceId;
    expect(() => evaluateResearchPilot(cohort([input.jobs[0], second]))).toThrow();
    second.requesterObservation!.evidenceId = "ev-different0002"; second.requesterObservation!.group!.classification = "team";
    expect(() => evaluateResearchPilot(cohort([input.jobs[0], second]))).toThrow();
  });
});
