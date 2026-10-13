import { z } from "zod";

const ZERO = BigInt(0);
const ONE = BigInt(1);
const SCALE = BigInt(1_000_000);
export const RESEARCH_PILOT_TRACK_IDS = ["api-platform", "saas-competition", "scholarly-literature"] as const;
export const RESEARCH_PILOT_COST_CATEGORIES = [
  "ai", "discovery", "infrastructure", "paymentAndGas", "support", "acquisition", "other",
] as const;

const money = z.string().regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/);
const evidenceId = z.string().regex(/^ev-[A-Za-z0-9_-]{8,60}$/).nullable();
const date = z.string().max(40).datetime({ offset: true });
const cost = z.object({
  status: z.enum(["invoice-reconciled", "documented-direct", "documented-zero", "estimate", "pending", "unknown"]),
  currency: z.enum(["USDC", "USD"]),
  amount: money.nullable(),
  evidenceId,
}).strict().superRefine((value, context) => {
  if (["invoice-reconciled", "documented-direct", "documented-zero"].includes(value.status)
      && (value.amount === null || value.evidenceId === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Recorded cost needs an amount and evidence reference" });
  }
  if (value.status === "documented-zero" && value.amount !== null && micros(value.amount) !== ZERO) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Documented zero must be zero" });
  }
});
const costs = z.object({ ai: cost, discovery: cost, infrastructure: cost, paymentAndGas: cost,
  support: cost, acquisition: cost, other: cost }).strict();

const job = z.object({
  jobId: z.string().regex(/^job-[A-Za-z0-9_-]{8,60}$/),
  buyerId: z.string().regex(/^buyer-[A-Za-z0-9_-]{8,60}$/).nullable(),
  track: z.enum(RESEARCH_PILOT_TRACK_IDS),
  initiatedAt: date,
  status: z.enum(["completed", "failed", "cancelled", "pending"]),
  origin: z.object({ kind: z.enum(["buyer-initiated", "operator-prompted", "sponsored-invite", "unknown"]), evidenceId }).strict(),
  payment: z.object({
    network: z.enum(["arc-mainnet", "arc-testnet", "simulation", "unknown"]),
    status: z.enum(["settled", "pending", "failed", "none"]),
    funding: z.enum(["independent-buyer", "sponsored", "team", "unknown"]),
    serviceFeeUsdc: money.nullable(),
    settledAt: date.nullable(),
    receiptEvidenceId: evidenceId,
    fundingEvidenceId: evidenceId,
  }).strict(),
  refunds: z.object({
    coverage: z.enum(["complete", "pending", "unknown"]),
    settledUsdc: money.nullable(), pendingUsdc: money.nullable(), evidenceId,
  }).strict(),
  outcome: z.object({
    status: z.enum(["accepted", "rejected", "not-reviewed", "unknown"]),
    observedAt: date.nullable(), evidenceId,
  }).strict(),
  creatorFunds: z.object({
    collectedUsdc: money.nullable(), settledPaymentsUsdc: money.nullable(),
    pendingObligationsUsdc: money.nullable(),
  }).strict(),
  directCosts: costs,
  willingness: z.object({
    offeredServiceFeeUsdc: money.nullable(),
    response: z.enum(["would-pay", "declined", "unknown"]), evidenceId,
  }).strict(),
}).strict().superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
  if (value.payment.status === "settled"
      && (value.payment.serviceFeeUsdc === null || value.payment.settledAt === null || value.payment.receiptEvidenceId === null)) {
    issue("Settled payment needs recorded amount, time and receipt reference");
  }
  if (value.payment.settledAt !== null && Date.parse(value.payment.settledAt) < Date.parse(value.initiatedAt)) {
    issue("Settlement cannot precede the job request");
  }
  if (value.origin.evidenceId !== null && [value.payment.receiptEvidenceId, value.payment.fundingEvidenceId].includes(value.origin.evidenceId)) {
    issue("Request origin requires evidence separate from payment and funding evidence");
  }
  if (value.refunds.coverage === "complete"
      && (value.refunds.settledUsdc === null || value.refunds.pendingUsdc === null
        || micros(value.refunds.pendingUsdc) !== ZERO || value.refunds.evidenceId === null)) {
    issue("Complete refunds need evidence, an explicit settled amount and no pending refund");
  }
  if (value.payment.serviceFeeUsdc !== null && value.refunds.settledUsdc !== null
      && micros(value.refunds.settledUsdc) > micros(value.payment.serviceFeeUsdc)) {
    issue("Settled service refund exceeds service fee");
  }
  if (value.outcome.status === "accepted"
      && (value.status !== "completed" || value.outcome.observedAt === null || value.outcome.evidenceId === null)) {
    issue("Accepted outcome needs completed work and recorded acceptance evidence");
  }
  if (value.outcome.observedAt !== null && Date.parse(value.outcome.observedAt) < Date.parse(value.initiatedAt)) {
    issue("Outcome cannot precede the request");
  }
  if (value.willingness.response !== "unknown"
      && (value.willingness.offeredServiceFeeUsdc === null || value.willingness.evidenceId === null)) {
    issue("Recorded willingness needs an offer and response evidence");
  }
  const creator = value.creatorFunds;
  if (creator.collectedUsdc !== null && creator.settledPaymentsUsdc !== null && creator.pendingObligationsUsdc !== null
      && micros(creator.settledPaymentsUsdc) + micros(creator.pendingObligationsUsdc) > micros(creator.collectedUsdc)) {
    issue("Known creator liabilities exceed collected reserve; reconcile source funding and operating loss before evaluation");
  }
});

export const researchPilotSchema = z.object({
  version: z.literal(1),
  basis: z.enum(["illustrative", "operator-entered"]),
  cohort: z.object({
    startsAt: date, endsAt: date,
    jobCoverage: z.enum(["complete", "partial", "unknown"]), evidenceId,
  }).strict(),
  usdConversion: z.object({
    // USDC per USD as an explicitly declared rational number, never implicit parity.
    numerator: z.string().regex(/^[1-9]\d{0,11}$/),
    denominator: z.string().regex(/^[1-9]\d{0,11}$/),
    basis: z.enum(["operator-assumption", "observed-rate"]),
    observedAt: date, evidenceId: z.string().regex(/^ev-[A-Za-z0-9_-]{8,60}$/),
  }).strict().nullable(),
  tracks: z.array(z.object({
    id: z.enum(RESEARCH_PILOT_TRACK_IDS),
    targetContributionUsdcPerPaidJob: money.nullable(),
    // Allocated direct costs not included in any job, including trial/acquisition costs.
    unassignedDirectCosts: costs,
  }).strict()).length(3),
  jobs: z.array(job).max(10_000),
}).strict().superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
  const start = Date.parse(value.cohort.startsAt);
  const end = Date.parse(value.cohort.endsAt);
  if (start >= end) issue("Reporting period needs a positive duration");
  if (value.cohort.jobCoverage === "complete" && value.cohort.evidenceId === null) {
    issue("Complete cohort needs a coverage evidence reference");
  }
  if (new Set(value.tracks.map(track => track.id)).size !== 3) issue("Each track must appear exactly once");
  if (new Set(value.jobs.map(item => item.jobId)).size !== value.jobs.length) issue("Duplicate jobs are refused");
  const receipts = value.jobs.flatMap(item => item.payment.receiptEvidenceId === null ? [] : [item.payment.receiptEvidenceId]);
  if (new Set(receipts).size !== receipts.length) issue("A receipt cannot fund several cohort jobs");
  const origins = value.jobs.flatMap(item => item.origin.evidenceId === null ? [] : [item.origin.evidenceId]);
  if (new Set(origins).size !== origins.length) issue("Request-origin evidence cannot represent several distinct jobs");
  for (const item of value.jobs) {
    const initiated = Date.parse(item.initiatedAt);
    if (initiated < start || initiated >= end) issue("All listed jobs must originate within the reporting period");
    if (item.payment.settledAt !== null
        && (Date.parse(item.payment.settledAt) < start || Date.parse(item.payment.settledAt) >= end)) {
      issue("A settlement outside the reporting period cannot be included");
    }
    if (item.outcome.observedAt !== null && Date.parse(item.outcome.observedAt) >= end) {
      issue("An outcome outside the reporting period cannot be included");
    }
  }
});

export type ResearchPilotInput = z.infer<typeof researchPilotSchema>;
type PilotJob = ResearchPilotInput["jobs"][number];
type Cost = z.infer<typeof cost>;

function micros(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
}

function amount(value: bigint | null): string | null {
  if (value === null) return null;
  const absolute = value < ZERO ? -value : value;
  return `${value < ZERO ? "-" : ""}${absolute / SCALE}.${String(absolute % SCALE).padStart(6, "0")}`;
}

function sumNullable(values: (string | null)[]): bigint | null {
  return values.some(value => value === null) ? null
    : values.reduce<bigint>((total, value) => total + micros(value!), ZERO);
}

function independentPayment(item: PilotJob): boolean {
  return item.buyerId !== null && item.payment.network === "arc-mainnet"
    && item.payment.status === "settled" && item.payment.funding === "independent-buyer"
    && item.payment.fundingEvidenceId !== null && item.payment.serviceFeeUsdc !== null
    && micros(item.payment.serviceFeeUsdc) > ZERO;
}

function retainedPayment(item: PilotJob): boolean {
  return item.status === "completed" && independentPayment(item) && item.refunds.coverage === "complete"
    && micros(item.payment.serviceFeeUsdc!) > micros(item.refunds.settledUsdc!);
}

function qualifyingOutcome(item: PilotJob): boolean {
  return retainedPayment(item) && item.outcome.status === "accepted";
}

function returningBuyers(jobs: PilotJob[]): Set<string> {
  const grouped = new Map<string, PilotJob[]>();
  for (const item of jobs.filter(qualifyingOutcome)) {
    const key = `${item.track}:${item.buyerId!}`;
    const existing = grouped.get(key) ?? [];
    existing.push(item);
    grouped.set(key, existing);
  }
  const returning = new Set<string>();
  for (const items of grouped.values()) {
    items.sort((first, second) => Date.parse(first.initiatedAt) - Date.parse(second.initiatedAt));
    let earliestAcceptance = Infinity;
    for (const current of items) {
      if (current.origin.kind === "buyer-initiated" && current.origin.evidenceId !== null
          && earliestAcceptance < Date.parse(current.initiatedAt)) returning.add(current.buyerId!);
      earliestAcceptance = Math.min(earliestAcceptance, Date.parse(current.outcome.observedAt!));
    }
  }
  return returning;
}

function costCoverage(entries: Cost[], conversion: ResearchPilotInput["usdConversion"]) {
  let total = ZERO;
  let invoice = 0;
  let direct = 0;
  let zero = 0;
  let unresolved = 0;
  let unconverted = 0;
  let usesUsdConversion = false;
  for (const entry of entries) {
    const recorded = entry.amount !== null && entry.evidenceId !== null
      && ["invoice-reconciled", "documented-direct", "documented-zero"].includes(entry.status);
    if (!recorded) { unresolved++; continue; }
    if (entry.status === "invoice-reconciled") invoice++;
    else if (entry.status === "documented-direct") direct++;
    else zero++;
    const raw = micros(entry.amount!);
    if (entry.currency === "USD" && raw > ZERO) {
      if (conversion === null) { unconverted++; continue; }
      usesUsdConversion = true;
      const numerator = BigInt(conversion.numerator);
      const denominator = BigInt(conversion.denominator);
      // Round costs up to a USDC micro, never improve the margin by truncation.
      total += (raw * numerator + denominator - ONE) / denominator;
    } else total += raw;
  }
  return {
    allCostsKnown: unresolved === 0 && unconverted === 0,
    totalUsdc: unresolved === 0 && unconverted === 0 ? total : null,
    entries: entries.length, invoice, direct, zero, unresolved, unconverted, usesUsdConversion,
  };
}

function summarize(input: ResearchPilotInput, trackId?: typeof RESEARCH_PILOT_TRACK_IDS[number]) {
  const jobs = input.jobs.filter(item => trackId === undefined || item.track === trackId);
  const trackInputs = input.tracks.filter(track => trackId === undefined || track.id === trackId);
  const independent = jobs.filter(independentPayment);
  const retained = jobs.filter(retainedPayment);
  const accepted = jobs.filter(qualifyingOutcome);
  const invoiceCosts = costCoverage([
    ...jobs.flatMap(item => Object.values(item.directCosts)),
    ...trackInputs.flatMap(track => Object.values(track.unassignedDirectCosts)),
  ], input.usdConversion);
  const refundsKnown = independent.every(item => item.refunds.coverage === "complete");
  const grossFees = independent.reduce((total, item) => total + micros(item.payment.serviceFeeUsdc!), ZERO);
  const settledRefunds = sumNullable(independent.map(item => item.refunds.settledUsdc));
  const pendingRefunds = sumNullable(independent.map(item => item.refunds.pendingUsdc));
  const netFees = settledRefunds === null ? null : grossFees - settledRefunds;
  const completeCohort = input.cohort.jobCoverage === "complete";
  const unfinishedJobs = jobs.some(item => item.status === "pending");
  const unresolvedPaidDelivery = independent.filter(item => ["failed", "cancelled"].includes(item.status)
    && (item.refunds.settledUsdc === null || micros(item.refunds.settledUsdc) < micros(item.payment.serviceFeeUsdc!)));
  const canCalculate = completeCohort && invoiceCosts.allCostsKnown && refundsKnown && netFees !== null
    && !unfinishedJobs && unresolvedPaidDelivery.length === 0;
  const contribution = canCalculate ? netFees! - invoiceCosts.totalUsdc! : null;
  const returnBuyers = returningBuyers(jobs);
  const independentBuyers = new Set(independent.map(item => item.buyerId!));
  const acceptanceBuyers = new Set(accepted.map(item => item.buyerId!));
  const reasons = [
    ...(!completeCohort ? ["cohort-job-coverage-incomplete"] : []),
    ...(invoiceCosts.unresolved > 0 ? ["direct-cost-evidence-incomplete"] : []),
    ...(invoiceCosts.unconverted > 0 ? ["usd-conversion-not-declared"] : []),
    ...(!refundsKnown ? ["service-refunds-unresolved"] : []),
    ...(unfinishedJobs ? ["unfinished-cohort-jobs"] : []),
    ...(unresolvedPaidDelivery.length > 0 ? ["paid-delivery-remedy-unresolved"] : []),
    ...(retained.length === 0 ? ["no-retained-independently-funded-mainnet-job"] : []),
    ...(accepted.length === 0 ? ["no-accepted-independent-paid-outcome"] : []),
    ...(returnBuyers.size === 0 ? ["no-evidenced-same-track-independent-return"] : []),
    ...(contribution !== null && contribution <= ZERO ? ["service-fee-contribution-not-positive"] : []),
  ];
  const track = trackId === undefined ? undefined : trackInputs[0];
  const requiredRetainedFee = track?.targetContributionUsdcPerPaidJob !== null
    && track !== undefined && canCalculate && retained.length > 0
    ? (invoiceCosts.totalUsdc! + BigInt(retained.length) - ONE) / BigInt(retained.length)
      + micros(track.targetContributionUsdcPerPaidJob!) : null;
  const baseCost = canCalculate && retained.length > 0
    ? (invoiceCosts.totalUsdc! + BigInt(retained.length) - ONE) / BigInt(retained.length) : null;
  const creatorAmounts = (network: PilotJob["payment"]["network"]) => {
    const matching = jobs.filter(item => item.payment.network === network);
    return { network, jobs: matching.length,
      collectedUsdc: amount(sumNullable(matching.map(item => item.creatorFunds.collectedUsdc))),
      settledSourceAndCreatorPaymentsUsdc: amount(sumNullable(matching.map(item => item.creatorFunds.settledPaymentsUsdc))),
      pendingSourceAndCreatorObligationsUsdc: amount(sumNullable(matching.map(item => item.creatorFunds.pendingObligationsUsdc))),
    };
  };
  return {
    jobs: { total: jobs.length, failedOrCancelled: jobs.filter(item => ["failed", "cancelled"].includes(item.status)).length,
      pending: jobs.filter(item => item.status === "pending").length,
      sponsoredOrTeam: jobs.filter(item => ["sponsored", "team"].includes(item.payment.funding)).length },
    independentMainnetPayments: { settledJobs: independent.length, retainedPaidJobs: retained.length,
      unresolvedPaidDeliveryJobs: unresolvedPaidDelivery.length,
      buyers: independentBuyers.size, grossServiceFeesUsdc: amount(grossFees),
      settledServiceRefundsUsdc: amount(settledRefunds), pendingServiceRefundsUsdc: amount(pendingRefunds),
      netSettledServiceFeesUsdc: amount(netFees), refundCoverageComplete: refundsKnown },
    outcomes: { acceptedJobsAll: jobs.filter(item => item.outcome.status === "accepted").length,
      acceptedIndependentPaidJobs: accepted.length, acceptedIndependentPaidBuyers: acceptanceBuyers.size,
      sameTrackIndependentReturningBuyers: returnBuyers.size },
    willingness: { evidencedWouldPayResponses: jobs.filter(item => item.willingness.response === "would-pay").length,
      evidencedDeclinedResponses: jobs.filter(item => item.willingness.response === "declined").length,
      label: "declared-willingness-is-not-payment" },
    directCostCoverage: { status: invoiceCosts.allCostsKnown && completeCohort ? "operator-declared-complete" : "incomplete",
      requiredEntries: invoiceCosts.entries, invoiceReconciledEntries: invoiceCosts.invoice,
      documentedDirectEntries: invoiceCosts.direct, documentedZeroEntries: invoiceCosts.zero,
      unresolvedEntries: invoiceCosts.unresolved, usdEntriesWithoutConversion: invoiceCosts.unconverted,
      usdConversionUsed: invoiceCosts.usesUsdConversion, totalUsdcOnDeclaredBasis: amount(invoiceCosts.totalUsdc) },
    serviceFeeOnlyContribution: { status: contribution === null ? "unknown" : contribution > ZERO ? "positive-on-entered-evidence" : "non-positive-on-entered-evidence",
      amountUsdcOnDeclaredBasis: amount(contribution), label: "direct-contribution-not-realized-profit" },
    creatorFundsExcludedFromServiceRevenue: {
      ...creatorAmounts("arc-mainnet"),
      otherNetworks: (["arc-testnet", "simulation", "unknown"] as const).map(creatorAmounts),
      unusedReserveRecognizedAsServiceRevenue: false,
    },
    ...(track === undefined ? {} : { pricePlanning: {
      status: requiredRetainedFee === null ? "unknown" : "calculated-from-entered-cohort",
      costRecoveryUsdcPerRetainedIndependentPaidJob: amount(baseCost),
      operatorTargetContributionUsdcPerPaidJob: track.targetContributionUsdcPerPaidJob,
      requiredRetainedServiceFeeUsdc: amount(requiredRetainedFee), chargeableJobsInDenominator: retained.length,
      grossChargePricing: { status: "unavailable", reason: "future-refund-loss-assumptions-and-terms-not-supplied" },
      label: "cohort-cost-recovery-after-refunds-not-gross-price-or-demand-validation",
    } }),
    evidence: { status: reasons.length > 0 ? "not-established" : "meets-entered-evidence-conditions",
      missingConditions: reasons, independentlyVerified: false },
  };
}

/** Pure local aggregation of entered assertions. No verification, I/O, settlement or price change. */
export function evaluateResearchPilot(value: unknown) {
  const input = researchPilotSchema.parse(value);
  const tracks = RESEARCH_PILOT_TRACK_IDS.map(id => ({ id, ...summarize(input, id) }));
  const overall = summarize(input);
  // A buyer spanning niches is never evidence of retention inside any one niche.
  const sameTrackReturns = new Set(RESEARCH_PILOT_TRACK_IDS.flatMap(id =>
    [...returningBuyers(input.jobs.filter(item => item.track === id))]));
  overall.outcomes.sameTrackIndependentReturningBuyers = sameTrackReturns.size;
  overall.evidence.status = tracks.every(track => track.evidence.status === "meets-entered-evidence-conditions")
    ? "meets-entered-evidence-conditions" : "not-established";
  if (overall.evidence.status === "not-established") {
    overall.evidence.missingConditions.push("track-evidence-conditions-incomplete");
  }
  return {
    schema: "keryx-research-pilot-report-v1", basis: input.basis,
    label: "private-operator-entered-evidence-not-a-sustainability-or-profit-certification",
    period: { startsAt: input.cohort.startsAt, endsAt: input.cohort.endsAt, jobCoverage: input.cohort.jobCoverage },
    evidenceVerification: "none-offline-assertions-only",
    usdConversion: input.usdConversion === null ? null : {
      numerator: input.usdConversion.numerator, denominator: input.usdConversion.denominator,
      basis: input.usdConversion.basis, observedAt: input.usdConversion.observedAt,
    },
    tracks, overall,
    notes: [
      "Amounts and evidence references are entered assertions, never independently verified receipts or invoices. Keep input and aggregate output private.",
      "Every failed, cancelled, pending, sponsored and team job belongs in its complete cost cohort; do not select only successful paid work. Allocate shared direct costs once.",
      "Independently paid failed/cancelled work with any unrefunded service fee remains an unresolved delivery/remedy liability. It cannot enter the retained-job denominator and suppresses contribution and retained-fee planning until fully refunded.",
      "Only independently funded, evidenced Arc mainnet settled service fees enter receipts. Testnet, simulation, sponsored funds, creator reserve and willingness answers do not.",
      "Source/creator funds are grouped by network and held entirely outside service contribution. Unknown creator obligations remain unknown; no reserve is released or recognized as profit. Known reserve deficits must be reconciled before evaluation.",
      "Return counts require two accepted, retained paid jobs in the same track and a separately evidenced buyer-initiated request after the earlier acceptance, within this period.",
      "Cost recovery divides all cohort direct costs by completed retained independent paid jobs. Required retained service fee is the amount needed after refunds; a gross charge cannot be calculated without future refund/loss assumptions and terms. It includes no forecast, tax, financing or complete fixed-cost operating-profit assessment.",
      "USD costs use only the explicitly declared USDC-per-USD rational basis and round up to micro-USDC. A conversion assumption does not establish realized exchange value.",
      "No price, payment, funding, refund, customer outreach or autonomous schedule is authorized by this report.",
    ],
  };
}
