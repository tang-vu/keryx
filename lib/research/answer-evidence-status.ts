import { MAX_ASK_QUESTION_CHARS } from "../ask-input";
import type { QueryRun } from "../types";
import { buildSourceEvidenceLens } from "./source-evidence-lens";

export type AnswerEvidenceInput = Pick<QueryRun, "id" | "question" | "subClaims" | "citations" | "evidence" | "claimCoverage">;

/** A presentation of retained excerpts and recorded estimates, not a new evidence
 * assessment. Reuse the inspection lens's exact identity/provenance checks. */
export function buildAnswerEvidenceStatus(run: AnswerEvidenceInput) {
  const lens = buildSourceEvidenceLens(run);
  const targets = lens.rows.map(row => {
    const estimates = (run.claimCoverage ?? []).filter(item => item.claimIndex === row.claimIndex && item.claim === row.claim);
    const value = estimates.length === 1 ? estimates[0].coverage : undefined;
    const estimate = typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
    return {
      claimIndex: row.claimIndex,
      claim: row.claim,
      excerpts: row.originalExcerpts,
      estimate,
      // The existing evidence ledger styles estimates below 0.4 as limited.
      // This flag prioritizes inspection only; it cannot qualify any evidence.
      needsInspection: lens.available && (row.originalExcerpts === 0 || estimate !== null && estimate < 0.4),
    };
  });
  return {
    available: lens.available,
    targets,
    withExcerpts: targets.filter(target => target.excerpts > 0).length,
    needsInspection: targets.filter(target => target.needsInspection).length,
  };
}

/** Bound original request data before interpolating it into a localized draft.
 * Keep the target first and enough room for the instructions and original question. */
export function evidenceFollowUpContext(question: string, target: string) {
  const clip = (text: string, limit: number) => {
    const trimmed = text.trim();
    return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/u, "")}…`;
  };
  return { target: clip(target, 1_200), question: clip(question, 500) };
}

/** An ordinary editable ask link. Never add run=1, a budget or a model override. */
export function evidenceFollowUpHref(parentId: string, draft: string): string {
  const q = draft.trim().slice(0, MAX_ASK_QUESTION_CHARS).replace(/[\uD800-\uDBFF]$/u, "");
  const params = new URLSearchParams({ q });
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parentId)) params.set("parent", parentId);
  return `/?${params}`;
}
