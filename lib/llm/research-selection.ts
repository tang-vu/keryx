import { randomUUID } from "node:crypto";
import type { Decision } from "../types";
import {
  MAX_SELECTION_DIAGNOSTIC_COUNT, MAX_SELECTION_DIAGNOSTIC_REASONS, SELECTION_DIAGNOSTIC_PROTOCOL,
  parseSelectionDiagnostic, type SelectionDiagnostic, type SelectionRefusalReason,
} from "../research/selection-diagnostic";
import { ReasoningOutputValidationError, type DecideInput, type ReasoningEngine } from "./reasoning-engine";

const MAX_SELECTION_ROWS = MAX_SELECTION_DIAGNOSTIC_COUNT;
export const MAX_SELECTION_DIAGNOSTIC_HISTORY = 16;

/** Terminal local refusal. A further paid model call cannot repair this selection's authority. */
export class ResearchSelectionError extends ReasoningOutputValidationError {
  readonly status = 422;
  readonly code = "research_source_selection_invalid";
  readonly name = "ResearchSelectionError";
  readonly #diagnostic: SelectionDiagnostic;

  constructor(diagnostic: SelectionDiagnostic, outputTokenLimit?: number) {
    super("Source selection could not be validated; this selection did not authorize a source read.", outputTokenLimit);
    const safe = parseSelectionDiagnostic(diagnostic);
    if (!safe || safe.outcome !== "refused") throw new TypeError("Invalid source-selection diagnostic");
    this.#diagnostic = safe;
  }

  get diagnostic(): SelectionDiagnostic { return parseSelectionDiagnostic(this.#diagnostic)!; }
}

/** Optional instrumentation on legacy/custom engines remains absent, never inferred. */
export function readSelectionDiagnostics(engine: Pick<ReasoningEngine, "selectionDiagnostics">): SelectionDiagnostic[] {
  const snapshots = engine.selectionDiagnostics;
  if (!Array.isArray(snapshots)) return [];
  return snapshots.slice(-MAX_SELECTION_DIAGNOSTIC_HISTORY)
    .map(parseSelectionDiagnostic).filter((value): value is SelectionDiagnostic => value !== undefined);
}

function clamp01(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/** The completed response yielded no parseable decision object; retain no response text. */
export function invalidResearchSelectionOutput(input: DecideInput, outputTokenLimit?: number): ResearchSelectionError {
  return new ResearchSelectionError({ protocol: SELECTION_DIAGNOSTIC_PROTOCOL, id: randomUUID(),
    createdAt: new Date().toISOString(), stage: "decide", outcome: "refused",
    counts: { candidateCount: Math.min(input.candidates.length, MAX_SELECTION_DIAGNOSTIC_COUNT),
      targetCount: Math.min(input.subClaims.length, MAX_SELECTION_DIAGNOSTIC_COUNT), decisionCount: 0,
      matchedCandidateCount: 0, validActionableCount: 0, withheldCandidateCount: 0, invalidRowCount: 0 },
    reasons: [{ code: "invalid_output" }],
    truncated: input.candidates.length > MAX_SELECTION_DIAGNOSTIC_COUNT || input.subClaims.length > MAX_SELECTION_DIAGNOSTIC_COUNT }, outputTokenLimit);
}

function rowObject(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !("value" in descriptor))) return;
  return value as Record<string, unknown>;
}

function targetRefusal(row: Record<string, unknown>, targetCount: number): SelectionRefusalReason | undefined {
  if (row.targets === undefined) return "missing_targets";
  if (!Array.isArray(row.targets)) return "targets_not_array";
  if (row.targets.length === 0) return "empty_targets";
  // Iteration also examines sparse slots; Array.every would silently skip an absent index.
  for (const value of row.targets) if (typeof value !== "number" || !Number.isSafeInteger(value)) return "target_non_integer";
  for (const value of row.targets) if (value < 0 || value >= targetCount) return "target_out_of_range";
}

/** Validate whole target lists and isolate only by exact caller-owned candidate identity.
 * Never repair a target, filter an invalid list, reconstruct a source ID or choose among duplicates. */
export function parseResearchSelection(input: DecideInput, output: unknown): { decisions: Decision[]; diagnostic?: SelectionDiagnostic } {
  const object = rowObject(output);
  const supplied = object?.decisions;
  const rows: unknown[] = Array.isArray(supplied) ? supplied : [];
  if (rows.length === 0 && input.candidates.length === 0 && object && (supplied === undefined || Array.isArray(supplied))) return { decisions: [] };

  const reasons: SelectionDiagnostic["reasons"] = [];
  let truncated = false;
  const addReason = (code: SelectionRefusalReason, rowIndex?: number, candidateIndex?: number) => {
    if (reasons.length === MAX_SELECTION_DIAGNOSTIC_REASONS) { truncated = true; return; }
    const reason: SelectionDiagnostic["reasons"][number] = { code };
    if (rowIndex !== undefined) {
      if (rowIndex < MAX_SELECTION_DIAGNOSTIC_COUNT) reason.rowIndex = rowIndex;
      else truncated = true;
    }
    if (candidateIndex !== undefined) {
      if (candidateIndex < MAX_SELECTION_DIAGNOSTIC_COUNT) reason.candidateIndex = candidateIndex;
      else truncated = true;
    }
    reasons.push(reason);
  };
  const counts = { candidateCount: input.candidates.length, targetCount: input.subClaims.length,
    decisionCount: rows.length, matchedCandidateCount: 0, validActionableCount: 0, withheldCandidateCount: 0, invalidRowCount: 0 };
  const diagnostic = (outcome: SelectionDiagnostic["outcome"]): SelectionDiagnostic => {
    const safeCounts = { ...counts };
    for (const key of Object.keys(safeCounts) as (keyof typeof counts)[]) {
      if (safeCounts[key] > MAX_SELECTION_DIAGNOSTIC_COUNT) { safeCounts[key] = MAX_SELECTION_DIAGNOSTIC_COUNT; truncated = true; }
    }
    return { protocol: SELECTION_DIAGNOSTIC_PROTOCOL, id: randomUUID(), createdAt: new Date().toISOString(),
      stage: "decide", outcome, counts: safeCounts, reasons, truncated };
  };
  if (rows.length === 0 || rows.length > MAX_SELECTION_ROWS || input.candidates.length > MAX_SELECTION_ROWS) {
    addReason(rows.length === 0 && object && (supplied === undefined || Array.isArray(supplied)) ? "no_decisions" : "invalid_output");
    counts.invalidRowCount = rows.length;
    throw new ResearchSelectionError(diagnostic("refused"));
  }

  const byId = new Map(input.candidates.map((candidate, index) => [candidate.id, { candidate, index }]));
  const inputDuplicates = new Set<string>();
  const seenInput = new Set<string>();
  for (const candidate of input.candidates) {
    if (seenInput.has(candidate.id)) inputDuplicates.add(candidate.id);
    seenInput.add(candidate.id);
  }
  const groups = new Map<string, { row: Record<string, unknown>; rowIndex: number }[]>();
  const invalidRows = new Set<number>();
  for (const [rowIndex, value] of rows.entries()) {
    const row = rowObject(value);
    if (!row || typeof row.sourceId !== "string") {
      invalidRows.add(rowIndex); addReason("malformed_row", rowIndex); continue;
    }
    if (!byId.has(row.sourceId)) {
      invalidRows.add(rowIndex); addReason("unknown_source", rowIndex); continue;
    }
    const group = groups.get(row.sourceId) ?? [];
    group.push({ row, rowIndex });
    groups.set(row.sourceId, group);
  }
  counts.matchedCandidateCount = groups.size;
  const decisions: Decision[] = [];
  for (const [sourceId, group] of groups) {
    const { candidate, index } = byId.get(sourceId)!;
    let refusal: SelectionRefusalReason | undefined;
    const { row, rowIndex } = group[0];
    if (group.length > 1 || inputDuplicates.has(sourceId)) {
      refusal = "duplicate_source";
      for (const member of group) { invalidRows.add(member.rowIndex); addReason(refusal, member.rowIndex, index); }
    }
    const action = typeof row.action === "string" ? row.action.toUpperCase() : undefined;
    if (!refusal && ((action !== "BUY" && action !== "CACHE" && action !== "SKIP") ||
      (row.rationale !== undefined && typeof row.rationale !== "string"))) refusal = "malformed_row";
    if (!refusal && (action === "BUY" || action === "CACHE")) refusal = targetRefusal(row, input.subClaims.length);
    if (refusal) {
      if (refusal !== "duplicate_source") { invalidRows.add(rowIndex); addReason(refusal, rowIndex, index); }
      counts.withheldCandidateCount++;
      decisions.push({ sourceId: candidate.id, sourceName: candidate.name, action: "SKIP", expectedValue: 0,
        price: candidate.fetchPrice, confidence: 0, rationale: `Selection validator withheld this source (${refusal}); no read authorized.`,
        targets: [], selectionRefusal: refusal });
      continue;
    }
    const validAction = action as Decision["action"];
    if (validAction !== "SKIP") counts.validActionableCount++;
    decisions.push({ sourceId: candidate.id, sourceName: candidate.name, action: validAction,
      expectedValue: clamp01(row.expectedValue), price: candidate.fetchPrice, confidence: clamp01(row.confidence),
      rationale: typeof row.rationale === "string" ? row.rationale : "",
      // SKIP never authorizes a target. Do not propagate unvalidated values even on intentional SKIP.
      targets: validAction === "SKIP" ? [] : [...row.targets as number[]] });
  }
  counts.invalidRowCount = invalidRows.size;
  if (groups.size === 0) addReason("no_matched_decisions");
  if (groups.size === 0 || (counts.invalidRowCount > 0 && counts.validActionableCount === 0)) {
    throw new ResearchSelectionError(diagnostic("refused"));
  }
  return { decisions, ...(reasons.length > 0 ? { diagnostic: diagnostic("partial") } : {}) };
}
