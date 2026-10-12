import { ACTUAL_READ_POLICY, actualReadCheckpoint, numberOperand, operandMicros,
  type CheckpointAction, type CheckpointOutcome, type PlannedReadAction, type ReadCheck } from "./actual-read-policy";
import { canonicalReadPacket, type ActualReadPacket, type ActualReadPacketV1, type ActualReadRecord } from "./actual-read-record";
import type { ActualReadPacketV2 } from "./actual-read-v2";
import type { OptimizerCheckpoint } from "./optimizer-checkpoint";

export const DECISION_INSPECTION_BOUNDARY = "Recorded facts are assertions. Canonical policy agreement does not prove source truth, semantic answer quality, a completed read or confirmed settlement. Verify the separately retained digest to check report integrity.";
export type CandidateDisposition = Exclude<CheckpointAction, "CONTINUE" | "STOP"> | "UNKNOWN";
export interface DecisionInspectionRow extends ActualReadRecord {
  scope: "candidate" | "run";
}
export interface InspectedCandidate {
  candidate: number; lastRound: number; proposal: ActualReadRecord["proposal"]; plan: ActualReadRecord["plan"];
  checkpointDisposition: CandidateDisposition; checkpointRule: CheckpointOutcome["rule"] | "UNKNOWN";
  dispositionSequence: number | null; dispositionRound: number | null;
  finalObservedActions: PlannedReadAction[];
}
export interface DecisionInspection {
  schema: ActualReadPacket["schema"]; policy: ActualReadPacket["policy"]; checkpointPolicy: typeof ACTUAL_READ_POLICY;
  coverage: ActualReadPacket["coverage"]; facts: "recorded-assertions"; integrity: "canonical-policy-consistent";
  rows: DecisionInspectionRow[]; candidates: InspectedCandidate[];
  mappings: ActualReadPacketV2["mappings"]; normalizations: ActualReadPacketV2["normalizations"];
  portfolio: ActualReadPacketV2["portfolio"]; optimizer: OptimizerCheckpoint | null;
  stops: ActualReadPacketV2["stops"];
  totals: { checkpoints: number; candidates: number; unresolvedCandidates: number; continueCheckpoints: number;
    stopCheckpoints: number; byDisposition: Record<CandidateDisposition, number>;
    proposalPlanComparisons: number; proposalPlanDifferences: number };
}

function canonicalPacket(value: unknown): ActualReadPacket | null {
  try { return JSON.parse(canonicalReadPacket(value)) as ActualReadPacket; } catch { return null; }
}

/** Read-only closed-data inspection. Validation is not verification against a trusted digest. */
export function inspectReadDecisions(value: unknown): DecisionInspection | null {
  const packet = canonicalPacket(value);
  if (!packet) return null;
  const extended = packet.schema === 1 ? null : packet;
  const rows = packet.records.map(row => ({ ...row, scope: row.candidate === 0 ? "run" as const : "candidate" as const }));
  const candidates = new Map<number, InspectedCandidate>();
  for (const row of rows) {
    // Candidate zero denotes run-level context, not a source or a model proposal.
    if (row.candidate === 0) continue;
    const previous = candidates.get(row.candidate);
    const candidate: InspectedCandidate = { candidate: row.candidate, lastRound: row.round, proposal: row.proposal,
      plan: row.plan, checkpointDisposition: previous?.checkpointDisposition ?? "UNKNOWN",
      checkpointRule: previous?.checkpointRule ?? "UNKNOWN", dispositionSequence: previous?.dispositionSequence ?? null,
      dispositionRound: previous?.dispositionRound ?? null, finalObservedActions: [] };
    if (row.outcome.action !== "CONTINUE" && row.outcome.action !== "STOP") {
      candidate.checkpointDisposition = row.outcome.action;
      candidate.checkpointRule = row.outcome.rule;
      candidate.dispositionSequence = row.sequence;
      candidate.dispositionRound = row.round;
    } else if (row.check.kind === "review-verdict" && row.check.verdict === "admitted" && candidate.checkpointDisposition === "ESCALATE") {
      // An admitted review is permission to continue; a later delivery checkpoint may be absent.
      candidate.checkpointDisposition = "UNKNOWN";
      candidate.checkpointRule = "UNKNOWN";
      candidate.dispositionSequence = null;
      candidate.dispositionRound = null;
    }
    candidates.set(row.candidate, candidate);
  }
  for (const candidate of candidates.values()) candidate.finalObservedActions = extended?.observations.actions
    .filter(row => row.candidate === candidate.candidate).map(row => row.action) ?? [];
  const byDisposition: Record<CandidateDisposition, number> = { BUY: 0, SKIP: 0, CACHE: 0, FREE: 0, ESCALATE: 0, UNKNOWN: 0 };
  let proposalPlanComparisons = 0, proposalPlanDifferences = 0;
  for (const candidate of candidates.values()) {
    byDisposition[candidate.checkpointDisposition]++;
    if (candidate.proposal !== "UNKNOWN" && candidate.plan !== "UNKNOWN") {
      proposalPlanComparisons++;
      if (candidate.proposal !== candidate.plan) proposalPlanDifferences++;
    }
  }
  return { schema: packet.schema, policy: packet.policy, checkpointPolicy: ACTUAL_READ_POLICY, coverage: packet.coverage,
    facts: "recorded-assertions", integrity: "canonical-policy-consistent", rows, candidates: [...candidates.values()],
    mappings: extended?.mappings ?? [], normalizations: extended?.normalizations ?? [], portfolio: extended?.portfolio ?? null,
    optimizer: packet.schema === 3 ? packet.optimizer : null, stops: extended?.stops ?? [],
    totals: { checkpoints: rows.length, candidates: candidates.size, unresolvedCandidates: byDisposition.UNKNOWN,
      continueCheckpoints: rows.filter(row => row.outcome.action === "CONTINUE").length,
      stopCheckpoints: rows.filter(row => row.outcome.action === "STOP").length + (extended?.stops.length ?? 0),
      byDisposition, proposalPlanComparisons, proposalPlanDifferences } };
}

export interface ReadPolicyOverrides { remainingMicros?: string; attentionLimit?: number }
export interface ReadPolicyComparison {
  sequence: number; candidate: number; round: number; originalCheck: ReadCheck; previewCheck: ReadCheck;
  originalOutcome: CheckpointOutcome; previewOutcome: CheckpointOutcome; changed: boolean;
  recordedAmounts: ActualReadRecord["amounts"];
}
export type ReadPolicyPreview = { status: "unavailable"; reason: "invalid-packet" | "invalid-overrides" | "no-recorded-checkpoints" } | {
  status: "available"; scope: "isolated-recorded-checkpoints"; policy: typeof ACTUAL_READ_POLICY;
  overrides: ReadPolicyOverrides; comparisons: ReadPolicyComparison[]; changedCheckpoints: number;
  alternateTrajectory: "UNKNOWN"; eventualReads: "UNKNOWN"; answerQuality: "UNKNOWN"; settlement: "UNKNOWN";
};

function policyOverrides(value: unknown): { overrides: ReadPolicyOverrides; remainingOperand?: string } | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(value);
    if (!keys.length || keys.some(key => typeof key !== "string" || !["remainingMicros", "attentionLimit"].includes(key) ||
      !("value" in descriptors[key]))) return null;
    const overrides: ReadPolicyOverrides = {};
    let remainingOperand: string | undefined;
    if (descriptors.remainingMicros) {
      const micros: unknown = descriptors.remainingMicros.value;
      if (typeof micros !== "string" || !/^(0|[1-9][0-9]{0,15})$/.test(micros) || BigInt(micros) > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      const padded = micros.padStart(7, "0"), decimal = `${padded.slice(0, -6)}.${padded.slice(-6)}`;
      remainingOperand = numberOperand(Number(decimal));
      // Preserve the Number policy. Refuse an override that loses even one asserted micro.
      if (operandMicros(remainingOperand) !== micros) return null;
      overrides.remainingMicros = micros;
    }
    if (descriptors.attentionLimit) {
      const limit: unknown = descriptors.attentionLimit.value;
      if (!Number.isSafeInteger(limit) || (limit as number) < 0 || (limit as number) > 10000 || Object.is(limit, -0)) return null;
      overrides.attentionLimit = limit as number;
    }
    return { overrides, remainingOperand };
  } catch { return null; }
}

/** Compare existing predicates in isolation. No IO, model/optimizer rerun, authorization or trajectory replay. */
export function previewReadPolicy(value: unknown, inputOverrides: unknown): ReadPolicyPreview {
  const packet = canonicalPacket(value);
  if (!packet) return { status: "unavailable", reason: "invalid-packet" };
  const parsed = policyOverrides(inputOverrides);
  if (!parsed) return { status: "unavailable", reason: "invalid-overrides" };
  const comparisons: ReadPolicyComparison[] = [];
  for (const record of packet.records) {
    const check = record.check;
    let previewCheck: ReadCheck;
    if (check.kind === "budget" && parsed.remainingOperand !== undefined) previewCheck = { ...check, remaining: parsed.remainingOperand };
    else if (check.kind === "attention" && parsed.overrides.attentionLimit !== undefined) previewCheck = { ...check, limit: parsed.overrides.attentionLimit };
    else continue;
    const previewOutcome = actualReadCheckpoint(previewCheck);
    comparisons.push({ sequence: record.sequence, candidate: record.candidate, round: record.round,
      originalCheck: check, previewCheck, originalOutcome: record.outcome, previewOutcome,
      changed: record.outcome.action !== previewOutcome.action || record.outcome.rule !== previewOutcome.rule,
      recordedAmounts: record.amounts });
  }
  if (!comparisons.length) return { status: "unavailable", reason: "no-recorded-checkpoints" };
  return { status: "available", scope: "isolated-recorded-checkpoints", policy: ACTUAL_READ_POLICY,
    overrides: parsed.overrides, comparisons, changedCheckpoints: comparisons.filter(row => row.changed).length,
    alternateTrajectory: "UNKNOWN", eventualReads: "UNKNOWN", answerQuality: "UNKNOWN", settlement: "UNKNOWN" };
}

/** Synthetic showcase only. This contains no run, source, read, signature or payment evidence. */
export function syntheticDecisionShowcasePacket(): ActualReadPacketV1 {
  const records: ActualReadRecord[] = [];
  const add = (candidate: number, proposal: ActualReadRecord["proposal"], plan: ActualReadRecord["plan"], check: ReadCheck,
    priceMicros: string | null = null, remainingMicros: string | null = null) => {
    records.push({ sequence: records.length, candidate, round: 0, proposal, plan, facts: "assertions", check,
      outcome: actualReadCheckpoint(check), amounts: { priceMicros, remainingMicros } });
  };
  add(1, "BUY", "BUY", { kind: "selection", plan: "BUY", external: false }, "2000", "5000");
  add(1, "BUY", "BUY", { kind: "budget", present: true, gathered: false, price: "0.002", remaining: "0.005" }, "2000", "5000");
  add(1, "BUY", "BUY", { kind: "channel", creatorFree: false, cache: false }, "2000", "5000");
  add(2, "BUY", "BUY", { kind: "selection", plan: "BUY", external: false }, "6000", "3000");
  add(2, "BUY", "BUY", { kind: "budget", present: true, gathered: false, price: "0.006", remaining: "0.003" }, "6000", "3000");
  add(3, "CACHE", "CACHE", { kind: "selection", plan: "CACHE", external: false }, "0", "3000");
  add(3, "CACHE", "CACHE", { kind: "channel", creatorFree: false, cache: true }, "0", "3000");
  add(4, "BUY", "BUY", { kind: "review", required: true }, "1000", "3000");
  add(0, "UNKNOWN", "UNKNOWN", { kind: "attention", used: 3, limit: 3 }, null, "3000");
  return JSON.parse(canonicalReadPacket({ schema: 1, policy: ACTUAL_READ_POLICY, coverage: "post-portfolio-checkpoints",
    monetaryAuthority: "qualified-assertions-only", records })) as ActualReadPacketV1;
}
