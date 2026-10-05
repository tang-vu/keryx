/** Shared, browser-safe refusal metadata. Never accepts provider values or source identities. */
export const SELECTION_DIAGNOSTIC_PROTOCOL = "keryx-source-selection-v1" as const;
export const MAX_SELECTION_DIAGNOSTIC_REASONS = 16;
export const MAX_SELECTION_DIAGNOSTIC_COUNT = 10_000;
export const SELECTION_REFUSAL_REASONS = [
  "missing_targets", "empty_targets", "targets_not_array", "target_non_integer", "target_out_of_range",
  "malformed_row", "unknown_source", "duplicate_source", "no_decisions", "no_matched_decisions", "invalid_output",
] as const;
export type SelectionRefusalReason = typeof SELECTION_REFUSAL_REASONS[number];

export interface SelectionDiagnostic {
  protocol: typeof SELECTION_DIAGNOSTIC_PROTOCOL;
  id: string;
  createdAt: string;
  stage: "decide";
  outcome: "partial" | "refused";
  counts: {
    candidateCount: number;
    targetCount: number;
    decisionCount: number;
    matchedCandidateCount: number;
    validActionableCount: number;
    withheldCandidateCount: number;
    invalidRowCount: number;
  };
  reasons: { code: SelectionRefusalReason; rowIndex?: number; candidateIndex?: number }[];
  truncated: boolean;
}

const COUNT_KEYS = ["candidateCount", "targetCount", "decisionCount", "matchedCandidateCount",
  "validActionableCount", "withheldCandidateCount", "invalidRowCount"] as const;

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return;
  // Do not execute arbitrary accessors while exporting an unknown value.
  if (Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !("value" in descriptor))) return;
  return value as Record<string, unknown>;
}

/** Strict validation, explicit field copying and a fresh nested snapshot on every parse. */
export function parseSelectionDiagnostic(value: unknown): SelectionDiagnostic | undefined {
  try {
    const data = record(value);
    if (!data || data.protocol !== SELECTION_DIAGNOSTIC_PROTOCOL || data.stage !== "decide" ||
      (data.outcome !== "partial" && data.outcome !== "refused") || typeof data.truncated !== "boolean" ||
      typeof data.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(data.id) ||
      typeof data.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(data.createdAt) ||
      new Date(data.createdAt).toISOString() !== data.createdAt) return;
    const rawCounts = record(data.counts);
    if (!rawCounts) return;
    const counts = {} as SelectionDiagnostic["counts"];
    for (const key of COUNT_KEYS) {
      const count = rawCounts[key];
      if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > MAX_SELECTION_DIAGNOSTIC_COUNT) return;
      counts[key] = count;
    }
    if (counts.matchedCandidateCount > counts.candidateCount || counts.matchedCandidateCount > counts.decisionCount ||
      counts.validActionableCount + counts.withheldCandidateCount > counts.matchedCandidateCount || counts.invalidRowCount > counts.decisionCount) return;
    if (!Array.isArray(data.reasons) || data.reasons.length === 0 || data.reasons.length > MAX_SELECTION_DIAGNOSTIC_REASONS) return;
    const reasons: SelectionDiagnostic["reasons"] = [];
    for (const value of data.reasons) {
      const reason = record(value);
      if (!reason || typeof reason.code !== "string" || !SELECTION_REFUSAL_REASONS.includes(reason.code as SelectionRefusalReason)) return;
      const safe: SelectionDiagnostic["reasons"][number] = { code: reason.code as SelectionRefusalReason };
      for (const key of ["rowIndex", "candidateIndex"] as const) {
        const index = reason[key];
        if (index === undefined) continue;
        const count = key === "rowIndex" ? counts.decisionCount : counts.candidateCount;
        if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || index >= count) return;
        safe[key] = index;
      }
      reasons.push(safe);
    }
    return { protocol: SELECTION_DIAGNOSTIC_PROTOCOL, id: data.id, createdAt: data.createdAt, stage: "decide",
      outcome: data.outcome, counts, reasons, truncated: data.truncated };
  } catch { return; }
}
