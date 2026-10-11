import { decimalMicros, micros } from "./exact-units";
import { auditArray, auditObject, auditString } from "./input-contract";

/**
 * Bounded counterfactual sample of skipped sources, paid only from a separate fixed
 * evaluation allowance.
 *
 * This module has no user budget, session grant, gateway or creator-reward imports. The
 * injected reader receives only an evaluation reservation; the reservation is accounting,
 * not a payment authorization. A real reader must separately enforce evaluation funding
 * without retaining a user signer or reward capability. This helper is not wired
 * into the agent or any schedule; running it against real sources needs separately
 * authorized evaluation funding. Results are evaluation observations, never purchases.
 */
export const COUNTERFACTUAL_POLICY = "bounded-skip-sample-v1" as const;
export const MAX_COUNTERFACTUAL_SAMPLE = 8;

export interface CounterfactualCandidate { sourceId: string; itemId: string; contentVersion: string; quotedPriceMicros: string }
export interface CounterfactualDecision {
  action: "BUY" | "SKIP" | "CACHE"; sourceId: string; itemId?: string; contentVersion?: string; price: number; external?: boolean;
}
export interface CounterfactualPlan {
  policy: typeof COUNTERFACTUAL_POLICY;
  runId: string;
  allowanceMicros: string;
  sampleLimit: number;
  /** Skips with a complete identity and exact price that the run did not also read. */
  eligibleSkips: number;
  /** Eligible skips passed over because their quote did not fit the remaining allowance. */
  omittedForAllowance: number;
  sample: CounterfactualCandidate[];
  plannedMicros: string;
}
const identity = (row: { sourceId: string; itemId?: string; contentVersion?: string }) =>
  row.itemId && row.contentVersion ? JSON.stringify([row.sourceId, row.itemId, row.contentVersion]) : null;
function exactFields(value: unknown, fields: readonly string[]) {
  auditObject(value);
  if (Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field)))
    throw new Error("Invalid counterfactual fields");
}

async function order(seed: string, runId: string, key: string): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([seed, runId, key])));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Choose which skipped sources would be read. The order is a digest of the seed, run and exact
 * identity, so neither the model, the price nor the predicted value picks the sample. The plan
 * never exceeds the sample limit or the allowance. A cheaper skip can be taken after a dearer
 * one was omitted, so the sample leans cheap whenever the allowance binds; the count is reported.
 */
export async function planCounterfactualSample(input: {
  runId: string; seed: string; decisions: readonly CounterfactualDecision[]; allowanceMicros: string; sampleLimit: number;
}): Promise<CounterfactualPlan> {
  exactFields(input, ["runId", "seed", "decisions", "allowanceMicros", "sampleLimit"]);
  auditString(input.runId); auditString(input.seed); auditArray(input.decisions);
  const { runId, seed, sampleLimit } = input;
  const allowance = micros(input.allowanceMicros);
  if (!Number.isSafeInteger(input.sampleLimit) || input.sampleLimit < 1 || input.sampleLimit > MAX_COUNTERFACTUAL_SAMPLE)
    throw new Error("Invalid counterfactual sample limit");
  const read = new Set<string>(), skipped = new Map<string, CounterfactualCandidate | null>();
  for (const decision of input.decisions) {
    auditObject(decision); auditString(decision.sourceId); auditString(decision.itemId, true); auditString(decision.contentVersion, true);
    if (!["BUY", "SKIP", "CACHE"].includes(decision.action)) throw new Error("Invalid recorded action");
    if (decision.external !== undefined && typeof decision.external !== "boolean") throw new Error("Invalid external classification");
    const key = identity(decision);
    if (!key) continue;
    if (decision.action !== "SKIP") { read.add(key); continue; }
    const price = decision.external ? null : decimalMicros(decision.price);
    // A repeated skip with a different quote is ambiguous: it stays out rather than choosing a price.
    const previous = skipped.get(key);
    skipped.set(key, price === null || previous === null || previous && previous.quotedPriceMicros !== price ? null
      : { sourceId: decision.sourceId, itemId: decision.itemId!, contentVersion: decision.contentVersion!, quotedPriceMicros: price });
  }
  const eligible: Array<{ rank: string; candidate: CounterfactualCandidate }> = [];
  for (const [key, candidate] of skipped)
    if (candidate && !read.has(key)) eligible.push({ rank: await order(seed, runId, key), candidate });
  eligible.sort((a, b) => a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0);
  const sample: CounterfactualCandidate[] = [];
  let planned = BigInt(0), omittedForAllowance = 0;
  for (const { candidate } of eligible) {
    if (sample.length >= sampleLimit) break;
    const price = micros(candidate.quotedPriceMicros);
    if (planned + price > allowance) { omittedForAllowance++; continue; }
    sample.push(candidate); planned += price;
  }
  return { policy: COUNTERFACTUAL_POLICY, runId, allowanceMicros: allowance.toString(), sampleLimit,
    eligibleSkips: eligible.length, omittedForAllowance, sample, plannedMicros: planned.toString() };
}

export interface EvaluationReservation { readonly funding: "evaluation"; readonly reservedMicros: string }

/** A fixed pool: unused reservations may return, but there is no top-up or transfer from another budget. */
export class EvaluationAllowance {
  readonly totalMicros: string;
  #remaining: bigint;
  #spent = BigInt(0);
  readonly #open = new Map<EvaluationReservation, bigint>();
  constructor(totalMicros: string) {
    this.#remaining = micros(totalMicros); this.totalMicros = this.#remaining.toString();
    Object.freeze(this);
  }

  /** Atomic check-and-reserve. Null means the allowance cannot cover this read; nothing else may pay for it. */
  reserve(amountMicros: string): EvaluationReservation | null {
    const amount = micros(amountMicros);
    if (amount > this.#remaining) return null;
    this.#remaining -= amount;
    const reservation: EvaluationReservation = Object.freeze({ funding: "evaluation", reservedMicros: amount.toString() });
    this.#open.set(reservation, amount);
    return reservation;
  }
  /** Single use. A charge above the reservation refuses and consumes the whole reservation. */
  settle(reservation: EvaluationReservation, chargedMicros: string): void {
    const reserved = this.#open.get(reservation);
    if (reserved === undefined) throw new Error("Unknown or already used evaluation reservation");
    this.#open.delete(reservation);
    let charged: bigint;
    try { charged = micros(chargedMicros); } catch { this.#spent += reserved; throw new Error("Invalid evaluation charge"); }
    if (charged > reserved) { this.#spent += reserved; throw new Error("Evaluation charge exceeds its reservation"); }
    this.#spent += charged; this.#remaining += reserved - charged;
  }
  /** An unresolved read cannot prove that no money moved, so its reservation stays consumed. */
  forfeit(reservation: EvaluationReservation): void {
    const reserved = this.#open.get(reservation);
    if (reserved === undefined) throw new Error("Unknown or already used evaluation reservation");
    this.#open.delete(reservation); this.#spent += reserved;
  }
  get snapshot() {
    const reserved = [...this.#open.values()].reduce((sum, value) => sum + value, BigInt(0));
    return { totalMicros: this.totalMicros, consumedMicros: this.#spent.toString(), reservedMicros: reserved.toString(),
      remainingMicros: this.#remaining.toString() };
  }
}

export interface CounterfactualRead extends CounterfactualCandidate {
  status: "read" | "failed" | "allowance-exhausted";
  /** Evaluation money consumed for this row, including a forfeited reservation after a failure. */
  consumedMicros: string;
}
export interface CounterfactualResult {
  policy: typeof COUNTERFACTUAL_POLICY;
  runId: string;
  reads: CounterfactualRead[];
  evaluationConsumedMicros: string;
  /** The only funding this runner can hold. It has no user-budget or creator-reward capability. */
  funding: "evaluation-allowance";
  rewardEligible: false;
}

/**
 * Read the planned sample one source at a time. The reader receives the candidate and its
 * evaluation reservation, and must report what it charged. A failed read forfeits its
 * reservation and the run continues; a charge above the reservation stops the whole sample.
 */
export async function runCounterfactualSample(plan: CounterfactualPlan, allowance: EvaluationAllowance,
  read: (candidate: CounterfactualCandidate, reservation: EvaluationReservation) => Promise<{ chargedMicros: string }>,
): Promise<CounterfactualResult> {
  exactFields(plan, ["policy", "runId", "allowanceMicros", "sampleLimit", "eligibleSkips", "omittedForAllowance", "sample", "plannedMicros"]);
  auditString(plan.runId); auditArray(plan.sample, MAX_COUNTERFACTUAL_SAMPLE);
  if (plan.policy !== COUNTERFACTUAL_POLICY || !(allowance instanceof EvaluationAllowance)) throw new Error("Invalid counterfactual plan");
  const runId = plan.runId, declaredAllowance = micros(plan.allowanceMicros);
  if (!Number.isSafeInteger(plan.sampleLimit) || plan.sampleLimit < 1 || plan.sampleLimit > MAX_COUNTERFACTUAL_SAMPLE
    || plan.sample.length > plan.sampleLimit || !Number.isSafeInteger(plan.eligibleSkips) || plan.eligibleSkips < plan.sample.length
    || !Number.isSafeInteger(plan.omittedForAllowance) || plan.omittedForAllowance < 0
    || plan.omittedForAllowance > plan.eligibleSkips - plan.sample.length || micros(allowance.totalMicros) > declaredAllowance)
    throw new Error("Invalid counterfactual plan bounds");
  const seen = new Set<string>();
  // Snapshot every row and validate the complete plan before any injected reader or await.
  for (let index = 0; index < plan.sample.length; index++) {
    const field = Object.getOwnPropertyDescriptor(plan.sample, String(index));
    if (!field || !("value" in field)) throw new Error("Invalid counterfactual sample row");
  }
  const sample = plan.sample.map(candidate => {
    exactFields(candidate, ["sourceId", "itemId", "contentVersion", "quotedPriceMicros"]);
    auditString(candidate.sourceId); auditString(candidate.itemId); auditString(candidate.contentVersion);
    const row = { sourceId: candidate.sourceId, itemId: candidate.itemId, contentVersion: candidate.contentVersion,
      quotedPriceMicros: micros(candidate.quotedPriceMicros).toString() };
    const key = identity(row)!;
    if (seen.has(key)) throw new Error("Repeated counterfactual identity");
    seen.add(key); return row;
  });
  const planned = sample.reduce((sum, row) => sum + micros(row.quotedPriceMicros), BigInt(0));
  if (planned !== micros(plan.plannedMicros) || planned > declaredAllowance) throw new Error("Invalid counterfactual plan total");
  const reads: CounterfactualRead[] = [];
  let consumed = BigInt(0);
  for (const row of sample) {
    const reservation = allowance.reserve(row.quotedPriceMicros);
    if (!reservation) { reads.push({ ...row, status: "allowance-exhausted", consumedMicros: "0" }); continue; }
    let charged: string;
    try {
      const outcome = await read({ ...row }, reservation);
      exactFields(outcome, ["chargedMicros"]); charged = outcome.chargedMicros;
    }
    catch {
      allowance.forfeit(reservation); consumed += micros(row.quotedPriceMicros);
      reads.push({ ...row, status: "failed", consumedMicros: row.quotedPriceMicros }); continue;
    }
    allowance.settle(reservation, charged);
    consumed += micros(charged);
    reads.push({ ...row, status: "read", consumedMicros: micros(charged).toString() });
  }
  return { policy: COUNTERFACTUAL_POLICY, runId, reads, evaluationConsumedMicros: consumed.toString(),
    funding: "evaluation-allowance", rewardEligible: false };
}
