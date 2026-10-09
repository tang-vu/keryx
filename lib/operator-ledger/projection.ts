import { createHash } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { recordedUsdcMicros } from "../display/recorded-usdc";
import { captureLedgerPayment, closedIdentity, iso, type LedgerRunSnapshot } from "./capture";
import { LEDGER_PAYMENT_LIMIT, LEDGER_RUN_LIMIT, ledgerNetworkSchema, operatorLedgerPayloadSchema,
  type LedgerEntry, type LedgerFunding, type LedgerJob, type LedgerLeg, type OperatorLedger } from "./contracts";

const zero = () => ({ accessMicroUsdc: "0", rewardMicroUsdc: "0", sponsoredFeeMicroUsdc: "0" });
const address = /^0x[0-9a-fA-F]{40}$/;
const reference = /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|0x[0-9a-fA-F]{64})$/;
export function ledgerDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
function add(target: ReturnType<typeof zero>, kind: NonNullable<LedgerLeg["kind"]>, amount: string) {
  const key = kind === "fetch" ? "accessMicroUsdc" : kind === "citation" ? "rewardMicroUsdc" : "sponsoredFeeMicroUsdc";
  target[key] = (BigInt(target[key]) + BigInt(amount)).toString();
}

function projectLeg(p: Record<string, unknown>, run: LedgerRunSnapshot, network: string, conflict: boolean, sharedReference: boolean): LedgerLeg {
  const original = closedIdentity(p.id) ? p.id : ledgerDigest(p);
  const amount = recordedUsdcMicros(p.amountUsdc);
  const kind = ["fetch", "citation", "operating-fee"].includes(String(p.kind)) ? p.kind as NonNullable<LedgerLeg["kind"]> : null;
  const matches = run.references.filter(r => r.sourceId === p.sourceId && r.itemId === (p.itemId ?? null) && r.contentVersion === (p.contentVersion ?? null));
  const feeMatch = kind === "operating-fee" && p.sourceId === "keryx:operating-fee" && run.funding === "treasury" &&
    run.fee && p.id === run.fee.paymentId && typeof p.payee === "string" && p.payee.toLowerCase() === run.fee.beneficiary && amount?.toString() === run.fee.amount;
  const leg: LedgerLeg = { id: ledgerDigest([network, p.network ?? null, original, run.id]), kind,
    sourceId: closedIdentity(p.sourceId) ? p.sourceId : null, amountMicroUsdc: amount?.toString() ?? null,
    createdAt: iso(p.createdAt) ? p.createdAt : null, state: "uncertain", reason: null, settlementReference: null };
  const refuse = (reason: NonNullable<LedgerLeg["reason"]>, hide = false) => {
    leg.reason = reason;
    if (hide) { leg.amountMicroUsdc = null; leg.sourceId = null; leg.kind = null; leg.createdAt = null; }
    return leg;
  };
  if (conflict) return refuse("conflicting-identity", true);
  if (p.network !== network) return refuse("foreign-network", true);
  if (!kind) return refuse("invalid-record", true);
  if (!closedIdentity(p.id)) return refuse("missing-identity");
  if (amount === null || amount <= BigInt(0)) return refuse("invalid-amount");
  if (!kind || !closedIdentity(p.sourceId) || !iso(p.createdAt) || typeof p.payer !== "string" || typeof p.payee !== "string" ||
    !address.test(p.payer) || !address.test(p.payee) || /^0x0{40}$/i.test(p.payer) || /^0x0{40}$/i.test(p.payee) ||
    p.authorizationId !== undefined && !closedIdentity(p.authorizationId)) return refuse("invalid-record");
  if (p.evidenceProvenance === "synthetic-demo" || matches.some(r => r.synthetic)) return refuse("synthetic-demo");
  if (kind === "operating-fee" ? !feeMatch : matches.length === 0) return refuse("source-binding", true);
  if (p.authorizationPhase === "prepared" || p.authorizationPhase === "cancelled_unexposed") return refuse("inconsistent-state");
  const status = p.settlementStatus;
  if (!(["settled", "pending", "failed", "simulated"] as unknown[]).includes(status) ||
    p.settled !== (status === "settled")) return refuse("inconsistent-state");
  if (status === "simulated") { leg.state = "simulated"; leg.reason = "simulated"; return leg; }
  if (run.offline) return refuse("offline-funding");
  if (status === "pending" || status === "failed") { leg.state = status; leg.reason = status; return leg; }
  if (typeof p.txHash !== "string" || !reference.test(p.txHash)) return refuse("missing-settlement-evidence");
  if (sharedReference) return refuse("shared-settlement-reference");
  leg.state = "settled"; leg.settlementReference = p.txHash;
  return leg;
}

export interface LedgerProjectionInput {
  network: string; days: number; readStartedAt: string; readCompletedAt: string;
  runs: LedgerRunSnapshot[]; payments: Record<string, unknown>[]; runLimitReached: boolean; paymentLimitReached: boolean;
}

/** The caller is the protected selected public-store reader, never request-supplied JSON.
 * Known settled legs survive unrelated uncertainties; all-business/margin authority is absent. */
export function projectOperatorLedger(input: LedgerProjectionInput): OperatorLedger {
  const network = ledgerNetworkSchema.parse(input.network);
  if (!Number.isSafeInteger(input.days) || input.days < 1 || input.days > 31 || !iso(input.readStartedAt) || !iso(input.readCompletedAt) ||
    input.readCompletedAt < input.readStartedAt || input.runs.length > LEDGER_RUN_LIMIT || input.payments.length > LEDGER_PAYMENT_LIMIT)
    throw new Error("Ledger projection unavailable");
  const from = new Date(Date.parse(input.readStartedAt) - input.days * 86_400_000).toISOString();
  const runs = new Map<string, LedgerRunSnapshot>(), runConflicts = new Set<string>();
  for (const run of input.runs) {
    const previous = runs.get(run.id);
    if (previous && canonicalJson(previous) !== canonicalJson(run)) runConflicts.add(run.id);
    runs.set(run.id, run);
  }
  for (const id of runConflicts) runs.delete(id);
  const payments = input.payments.map(captureLedgerPayment);
  const identities = new Map<string, string>();
  const conflicts = new Set<string>();
  const sharedReferences = new Set<string>();
  const originalKey = (p: Record<string, unknown>) => canonicalJson([p.network, closedIdentity(p.id) ? p.id : ledgerDigest(p)]);
  // Full bounded payment slice participates, including rows not eligible for public delivery.
  // A conflicting private original can quarantine a public leg without exposing that original.
  const unique = new Map<string, Record<string, unknown>>();
  for (const payment of payments) {
    const key = originalKey(payment), fingerprint = canonicalJson(payment);
    if (identities.has(key) && identities.get(key) !== fingerprint) conflicts.add(key);
    identities.set(key, fingerprint);
    unique.set(`${key}:${fingerprint}`, payment);
  }
  for (const field of ["authorizationId", "txHash"] as const) {
    const claims = new Map<string, Set<string>>();
    for (const payment of unique.values()) {
      const value = payment[field];
      if (typeof value !== "string" || !value || payment.network !== network ||
        field === "txHash" && (payment.settlementStatus !== "settled" || !reference.test(value))) continue;
      const key = `${payment.network}:${value.toLowerCase()}`;
      const originals = claims.get(key) ?? new Set<string>(); originals.add(originalKey(payment)); claims.set(key, originals);
    }
    for (const originals of claims.values()) if (originals.size > 1) for (const original of originals)
      (field === "txHash" ? sharedReferences : conflicts).add(original);
  }
  const byRun = new Map<string, Map<string, LedgerLeg>>();
  for (const payment of unique.values()) {
    if (typeof payment.queryId !== "string") continue;
    const run = runs.get(payment.queryId);
    if (!run || run.createdAt > input.readStartedAt) continue;
    if (iso(payment.createdAt) ? payment.createdAt < from || payment.createdAt > input.readStartedAt : run.createdAt < from) continue;
    const leg = projectLeg(payment, run, network, conflicts.has(originalKey(payment)), sharedReferences.has(originalKey(payment)));
    const rows = byRun.get(run.id) ?? new Map<string, LedgerLeg>();
    rows.set(leg.id, leg); byRun.set(run.id, rows);
  }
  const totals: Record<LedgerFunding, ReturnType<typeof zero>> = { browser: zero(), treasury: zero(), unknown: zero(), offline: zero() };
  const jobs: LedgerJob[] = [], entries: LedgerEntry[] = [];
  let debit = BigInt(0), credit = BigInt(0);
  for (const run of [...runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))) {
    const legs = [...(byRun.get(run.id)?.values() ?? [])].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id));
    if (run.createdAt > input.readStartedAt || run.createdAt < from && legs.length === 0) continue;
    const uncertain = legs.filter(l => l.state === "uncertain").length, pending = legs.filter(l => l.state === "pending").length;
    const job: LedgerJob = { id: run.id, createdAt: run.createdAt, funding: run.funding, customerCohort: "unknown",
      evidencePath: `/api/dispatch/${run.id}/receipt`, decisionPath: `/dispatch/${run.id}`,
      legCoverage: uncertain || pending ? "incomplete" : run.expected === null ? "unknown" :
        legs.filter(l => l.state !== "simulated" && l.state !== "failed").length === run.expected ? "matched-finish-count" : "incomplete",
      expectedRecordedLegs: run.expected, settled: zero(), uncertainLegs: uncertain, pendingLegs: pending,
      purchasePriceMicroUsdc: null, confirmedNetMicroUsdc: null, marginMicroUsdc: null, legs };
    for (const leg of legs) {
      if (leg.state !== "settled" || !leg.kind || !leg.amountMicroUsdc || !leg.settlementReference || run.funding === "offline") continue;
      add(job.settled, leg.kind, leg.amountMicroUsdc); add(totals[run.funding], leg.kind, leg.amountMicroUsdc);
      const common = { voucherId: leg.id, jobId: job.id, funding: run.funding, settlementReference: leg.settlementReference, evidencePath: job.evidencePath };
      const recipient = leg.kind === "fetch" ? "recipient:access" : leg.kind === "citation" ? "recipient:reward" : "recipient:sponsored-fee";
      entries.push({ ...common, account: recipient, debitMicroUsdc: leg.amountMicroUsdc, creditMicroUsdc: "0" },
        { ...common, account: `sender:${run.funding}`, debitMicroUsdc: "0", creditMicroUsdc: leg.amountMicroUsdc });
      debit += BigInt(leg.amountMicroUsdc); credit += BigInt(leg.amountMicroUsdc);
    }
    jobs.push(job);
  }
  const payload = operatorLedgerPayloadSchema.parse({ schema: "keryx-public-job-transfer-ledger-v1", network,
    window: { days: input.days, from, readStartedAt: input.readStartedAt, readCompletedAt: input.readCompletedAt },
    scope: { cohort: "persisted-public-web-dispatches", coverage: "partial", consistency: "separate-read-snapshots",
      runLimit: LEDGER_RUN_LIMIT, paymentLimit: LEDGER_PAYMENT_LIMIT, runLimitReached: input.runLimitReached,
      paymentLimitReached: input.paymentLimitReached, allBusinessBooks: false },
    position: { balanceMicroUsdc: null, obligationsMicroUsdc: null, overlapMicroUsdc: null, safeSpendMicroUsdc: "0", status: "unknown" },
    business: { outsideRevenueMicroUsdc: null, refundsMicroUsdc: null, providerCostMicroUsdc: null, invoiceCostMicroUsdc: null, profitMicroUsdc: null },
    settledByFunding: totals, jobs, entries, trialBalance: { debitMicroUsdc: debit.toString(), creditMicroUsdc: credit.toString(), balanced: true } });
  return { payload, integrity: { algorithm: "sha256", canonicalization: "sorted-json-v1", scope: "payload", digest: ledgerDigest(payload) } };
}
