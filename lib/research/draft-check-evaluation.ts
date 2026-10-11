import { buildDraftCheck, type DraftClaimVerdict } from "./draft-check";
import type { DraftCheckEvaluationCase, EvaluationLabel } from "./fixtures/draft-check-evaluation";

export interface DraftCheckEvaluation {
  cases: number;
  /** expected label -> returned verdict -> count */
  confusion: Record<EvaluationLabel, Partial<Record<DraftClaimVerdict, number>>>;
  /** Cases labelled not-found or partly-supported that were returned as supported. */
  falseSupported: string[];
  /** falseSupported over every case whose label is not "supported". */
  falseSupportedRate: number;
  /** Cases labelled supported that were returned as not-found. */
  missedSupported: string[];
  exactAgreement: number;
}

/** Runs each labelled sentence through the public contract with one numeric citation. */
export function evaluateDraftCheck(cases: readonly DraftCheckEvaluationCase[]): DraftCheckEvaluation {
  const confusion: DraftCheckEvaluation["confusion"] = { "supported": {}, "partly-supported": {}, "not-found": {} };
  const falseSupported: string[] = [], missedSupported: string[] = [];
  let agreed = 0;
  for (const row of cases) {
    const check = buildDraftCheck({ version: 1, scope: "private-draft-check", passage: `${row.claim.replace(/\.$/, "")} [1].`,
      references: { format: "list", text: "https://example.org/synthetic-evaluation-source" },
      sources: [{ reference: "ref1", coverage: "full-text", text: row.source }] });
    if (check.claims.length !== 1) throw new Error(`Evaluation case ${row.id} is not one claim`);
    const verdict = check.claims[0].verdict;
    confusion[row.expected][verdict] = (confusion[row.expected][verdict] ?? 0) + 1;
    if (verdict === row.expected) agreed++;
    if (verdict === "supported" && row.expected !== "supported") falseSupported.push(row.id);
    if (verdict === "not-found" && row.expected === "supported") missedSupported.push(row.id);
  }
  const negatives = cases.filter(row => row.expected !== "supported").length;
  return { cases: cases.length, confusion, falseSupported, falseSupportedRate: negatives ? falseSupported.length / negatives : 0,
    missedSupported, exactAgreement: cases.length ? agreed / cases.length : 0 };
}
