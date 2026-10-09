import type { PaymentRecord } from "../types";
import { decimalMicros, micros } from "./exact-units";
import type { CohortClassification, UsageCohort } from "./usage-cohort";
import { auditArray, auditObject, auditString, auditWallet } from "./input-contract";

export interface AuditUsageRun {
  id: string;
  network: string;
  createdAt: string;
  /** Verified pseudonymous actor only; anonymous runs do not create a person count. */
  actorId?: string;
  classification: CohortClassification;
  accepted?: boolean;
  timeToFirstAnswerMs?: number;
}
const COHORTS: readonly UsageCohort[] = ["outside", "team", "scripted", "unknown"];
function timestamp(value: string): number {
  const number = Date.parse(value);
  if (!Number.isFinite(number) || new Date(number).toISOString() !== value) throw new Error("Canonical UTC timestamp required");
  return number;
}
function validClassification(value: CohortClassification): boolean {
  return value && COHORTS.includes(value.cohort) && ["independent", "sponsored", "team", "unknown"].includes(value.payment)
    && (value.cohort === "outside" || value.payment !== "independent" && value.payment !== "sponsored");
}

/** Explicit complete supplied corpus; never presents a recent/paginated sample as all-time production usage. */
export function summarizeUsage(input: { network: string; since: string; until: string;
  runs: readonly AuditUsageRun[]; payments: readonly PaymentRecord[] }) {
  auditObject(input); auditString(input.network); auditString(input.since); auditString(input.until);
  auditArray(input.runs); auditArray(input.payments);
  if (!/^eip155:[1-9]\d*$/.test(input.network)) throw new Error("Explicit network required");
  const since = timestamp(input.since), until = timestamp(input.until);
  if (since >= until) throw new Error("Invalid period");
  const byId = new Map<string, AuditUsageRun>();
  const seenRuns = new Set<string>();
  for (const run of input.runs) {
    auditObject(run); auditObject(run.classification); auditString(run.id); auditString(run.actorId, true); auditString(run.network); auditString(run.createdAt);
    if (run.accepted !== undefined && typeof run.accepted !== "boolean") throw new Error("Invalid acceptance observation");
    if (run.timeToFirstAnswerMs !== undefined && (!Number.isSafeInteger(run.timeToFirstAnswerMs) || run.timeToFirstAnswerMs < 0)) throw new Error("Invalid latency observation");
    if (!run.id || seenRuns.has(run.id) || !validClassification(run.classification)) throw new Error("Ambiguous usage run");
    seenRuns.add(run.id);
    const created = timestamp(run.createdAt);
    if (run.network === input.network && created >= since && created < until) byId.set(run.id, run);
  }
  const seenPayments = new Map<string, string>();
  let excludedPayments = 0;
  const payments = input.payments.filter(payment => {
    auditObject(payment); auditString(payment.id, true); auditString(payment.queryId); auditString(payment.network);
    if (payment.txHash != null) auditString(payment.txHash);
    if (typeof payment.settled !== "boolean" || typeof payment.amountUsdc !== "number"
      || !["fetch", "citation", "inbound", "operating-fee"].includes(payment.kind)) throw new Error("Invalid payment fields");
    auditWallet(payment.payee);
    if (payment.id) {
      const fingerprint = JSON.stringify([payment.queryId, payment.network, payment.kind, payment.amountUsdc, payment.settled,
        payment.settlementStatus, payment.txHash, payment.payer, payment.payee]);
      const previous = seenPayments.get(payment.id);
      if (previous !== undefined) {
        if (previous !== fingerprint) throw new Error("Conflicting payment identity");
        excludedPayments++; return false;
      }
      seenPayments.set(payment.id, fingerprint);
    }
    const run = byId.get(payment.queryId), amount = decimalMicros(payment.amountUsdc);
    const valid = payment.id && run && payment.network === input.network
      && payment.settled === true && payment.settlementStatus === "settled" && payment.txHash?.trim()
      && amount !== null && micros(amount) > BigInt(0);
    if (!valid) { excludedPayments++; return false; }
    // Run-cohort attribution uses run creation time; payment-settlement timing is not reconstructed.
    return true;
  });
  const columns = COHORTS.map(cohort => {
    const runs = [...byId.values()].filter(run => run.classification.cohort === cohort), ids = new Set(runs.map(run => run.id));
    const paid = payments.filter(payment => ids.has(payment.queryId));
    const payingIds = new Set(paid.map(payment => payment.queryId));
    const latencies = runs.map(run => run.timeToFirstAnswerMs)
      .filter((value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0).sort((a, b) => a - b);
    const middle = Math.floor(latencies.length / 2);
    const median = latencies.length ? latencies.length % 2 ? latencies[middle] : (latencies[middle - 1] + latencies[middle]) / 2 : null;
    return { cohort, people: new Set(runs.map(run => run.actorId).filter(Boolean)).size, researchRuns: runs.length,
      payingRuns: payingIds.size,
      independentPayingRuns: runs.filter(run => payingIds.has(run.id) && run.classification.payment === "independent").length,
      sponsoredPayingRuns: runs.filter(run => payingIds.has(run.id) && run.classification.payment === "sponsored").length,
      teamFundedPayingRuns: runs.filter(run => payingIds.has(run.id) && run.classification.payment === "team").length,
      unknownFundingPayingRuns: runs.filter(run => payingIds.has(run.id) && run.classification.payment === "unknown").length,
      settledPayments: paid.length,
      settledMicros: paid.reduce((sum, payment) => sum + micros(decimalMicros(payment.amountUsdc)!), BigInt(0)).toString(),
      creatorsPaid: new Set(paid.filter(payment => payment.kind === "fetch" || payment.kind === "citation").map(payment => payment.payee.toLowerCase())).size,
      acceptedDeliverables: runs.filter(run => run.accepted === true).length,
      acceptanceSamples: runs.filter(run => typeof run.accepted === "boolean").length,
      medianTimeToFirstAnswerMs: median, timeToFirstAnswerSamples: latencies.length };
  });
  return { basis: "supplied-corpus-not-production-query" as const, network: input.network, since: input.since, until: input.until,
    periodRule: "run-created-at-inclusive-since-exclusive-until; recorded settled rows attributed to those runs",
    personRule: "distinct supplied verified actor IDs; anonymous omitted; one person may appear in several cohorts",
    moneyRule: "deduplicated recorded settled rows with settlement reference; pending/simulated/legacy-unproved excluded; funding shown separately",
    acceptedRule: "explicit recorded acceptance only; no inference from answer completion or feedback",
    columns, excludedPayments };
}
