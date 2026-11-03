import { z } from "zod";
import { feedbackChoiceSchema, jobObservationsSchema } from "../research-feedback/contracts";

const evidence = z.string().regex(/^ev-[A-Za-z0-9_-]{8,60}$/);
const date = z.string().max(40).datetime({ offset: true });
export const pilotRequesterObservationSchema = z.object({
  format: z.literal("keryx-pilot-requester-observation-v1"),
  consent: z.object({ scope: z.literal("private-pilot-evaluation"), evidenceId: evidence, recordedAt: date }).strict(),
  observedAt: date, evidenceId: evidence, choice: feedbackChoiceSchema.nullable(),
  observations: jobObservationsSchema.refine(value => value.generationDurationMs === null || Number.isSafeInteger(value.generationDurationMs)).nullable(),
  group: z.object({ groupId: z.string().regex(/^group-[A-Za-z0-9_-]{8,60}$/),
    classification: z.enum(["outside", "team", "unknown"]), evidenceId: evidence }).strict().nullable(),
  fundingWallet: z.object({ walletId: z.string().regex(/^wallet-[A-Za-z0-9_-]{8,60}$/), evidenceId: evidence }).strict().nullable(),
}).strict().refine(value => Date.parse(value.consent.recordedAt) <= Date.parse(value.observedAt), "Consent cannot follow the observation");
export type PilotRequesterObservation = z.infer<typeof pilotRequesterObservationSchema>;

interface ObservationJob {
  initiatedAt: string;
  payment: { funding: string; network: string };
  origin: { kind: string; evidenceId: string | null };
  outcome: { observedAt: string | null };
  requesterObservation?: PilotRequesterObservation;
}

function summary(jobs: readonly ObservationJob[]) {
  const packets = jobs.flatMap(job => job.requesterObservation ? [job.requesterObservation] : []);
  const opinions = packets.flatMap(packet => packet.choice === null ? [] : [packet.choice]);
  const observations = packets.flatMap(packet => packet.observations ? [packet.observations] : []);
  const durations = observations.flatMap(item => item.generationDurationMs === null ? [] : [item.generationDurationMs]).sort((a, b) => a - b);
  const bounds = observations.flatMap(item => item.modelCostUsd ? [item.modelCostUsd] : []);
  const lower = bounds.reduce((total, item) => total + item.lower, 0), upper = bounds.reduce((total, item) => total + item.upper, 0);
  const sum = (field: "recordedCalls" | "failedCalls" | "pendingCalls" | "missingUsageCalls" | "unpricedUsageRecords") => {
    const value = observations.reduce((total, item) => total + item[field], 0);
    if (!Number.isSafeInteger(value)) throw new Error("Observation count limit");
    return value;
  };
  const useful = opinions.filter(choice => choice === "useful").length;
  const middle = Math.floor(durations.length / 2);
  return { jobs: jobs.length, consentedObservationJobs: packets.length, jobsWithoutObservation: jobs.length - packets.length,
    responses: opinions.length, silence: packets.length - opinions.length,
    useful, needsRevision: opinions.filter(choice => choice === "revise").length, unusable: opinions.filter(choice => choice === "reject").length,
    responseRate: packets.length ? opinions.length / packets.length : null,
    usefulnessAmongResponses: opinions.length ? useful / opinions.length : null,
    recordedDuration: { samples: durations.length, missingAmongConsentedJobs: packets.length - durations.length,
      basis: "recorded-orchestrator-completion", medianMs: durations.length ? durations.length % 2 ? durations[middle]
        : durations[middle - 1] + (durations[middle] - durations[middle - 1]) / 2 : null,
      p95Ms: durations.length ? durations[Math.ceil(durations.length * 0.95) - 1] : null },
    partialModelCosts: { basis: "partial-captured-policy-estimate", currency: "USD", jobsWithBounds: bounds.length,
      jobsWithoutBoundsAmongConsented: packets.length - bounds.length,
      bounds: bounds.length && Number.isFinite(lower) && Number.isFinite(upper) ? { lower, upper } : null,
      aggregateOutOfRange: bounds.length > 0 && (!Number.isFinite(lower) || !Number.isFinite(upper)),
      recordedCalls: sum("recordedCalls"), failedCalls: sum("failedCalls"), pendingCalls: sum("pendingCalls"),
      missingUsageCalls: sum("missingUsageCalls"), unpricedUsageRecords: sum("unpricedUsageRecords"),
      excluded: "search-infrastructure-gas-and-unrecorded-provider-charges", invoice: null, profit: null },
    declaredNetworks: Object.fromEntries(["arc-mainnet", "arc-testnet", "simulation", "unknown"].map(network =>
      [network, jobs.filter(job => job.payment.network === network).length])) };
}

/** Original financial predicates are supplied by the existing evaluator, never recreated here. */
export function summarizePilotRequesterObservations<T extends ObservationJob>(jobs: readonly T[],
  independentlyPaid: (job: T) => boolean, acceptedIndependentOutcome: (job: T) => boolean, basis: "illustrative" | "operator-entered") {
  const outside = jobs.filter(job => job.requesterObservation?.group?.classification === "outside");
  const independentlyFundedGroups = new Set(outside.filter(independentlyPaid).map(job => job.requesterObservation!.group!.groupId));
  const independentlyFundedWallets = new Set(outside.filter(independentlyPaid).flatMap(job =>
    job.requesterObservation!.fundingWallet ? [job.requesterObservation!.fundingWallet!.walletId] : []));
  const accepted = outside.filter(acceptedIndependentOutcome);
  const groups = new Map<string, T[]>();
  for (const job of accepted) {
    const id = job.requesterObservation!.group!.groupId;
    groups.set(id, [...(groups.get(id) ?? []), job]);
  }
  let returningGroups = 0;
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => Date.parse(a.initiatedAt) - Date.parse(b.initiatedAt));
    const firstRequest = Date.parse(sorted[0].initiatedAt);
    let earliestAcceptance = Infinity, returned = false;
    for (const job of sorted) {
      const started = Date.parse(job.initiatedAt);
      if (started >= firstRequest + 7 * 86_400_000 && started < firstRequest + 14 * 86_400_000 && started > earliestAcceptance &&
        job.origin.kind === "buyer-initiated" && job.origin.evidenceId !== null) returned = true;
      earliestAcceptance = Math.min(earliestAcceptance, Date.parse(job.outcome.observedAt!));
    }
    if (returned) returningGroups++;
  }
  return { basis: "entered-consented-original-requester-sample", independentlyVerified: false,
    ...summary(jobs),
    byDeclaredFunding: ["independent-buyer", "sponsored", "team", "unknown"].map(funding =>
      ({ funding, ...summary(jobs.filter(job => job.payment.funding === funding)) })),
    evidencedIndependentMainnet: summary(jobs.filter(independentlyPaid)),
    groups: { classification: "operator-entered-association-not-verified-human-identity",
      reportedOutsideGroups: new Set(outside.map(job => job.requesterObservation!.group!.groupId)).size,
      independentlyFundedOutsideGroups: independentlyFundedGroups.size, acceptedIndependentDeliverables: accepted.length,
      independentlyFundedOutsideWallets: independentlyFundedWallets.size,
      secondWeekReturningOutsideGroups: returningGroups,
      targets: { independentlyFundedOutsideGroups: 3, independentlyFundedOutsideWallets: 3, acceptedIndependentDeliverables: 10, secondWeekReturningOutsideGroups: 1 },
      targetStatus: basis === "illustrative" ? "illustrative-no-real-pilot-evidence" : independentlyFundedGroups.size >= 3 && independentlyFundedWallets.size >= 3 && accepted.length >= 10 && returningGroups >= 1
        ? "meets-entered-record-targets-not-independently-verified" : "not-established" } };
}
