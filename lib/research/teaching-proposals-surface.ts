import { z } from "zod";
import { boundedPortableCopy } from "./bounded-portable-json";
import type { QueryRun } from "../types";
import { buildEvidenceMatrix } from "./evidence-matrix";
import { proposalSchema, premiseSchema, TEACHING_PROPOSAL_LABELS, type TeachingProposalDelivery } from "./teaching-proposals";
import { teachingProposalRequestSchema, validTeachingProposalRequest, teachingExplanationWordCount } from "./teaching-proposals-request";
import { MIN_REWARD_SUPPORT } from "../agent/evidence-ledger";

const gapSchema = z.object({ reason: z.enum(["invalid-request", "invalid-proposals", "invalid-proposal", "missing-premise",
  "review-unavailable", "review-rejected", "final-premise-withheld", "requested-count", "explanation-word-limit"]),
  proposalId: z.string().regex(/^t[1-6]$/).optional(), kind: z.enum(["activity", "classification-example", "exit-question"]).optional() }).strict();
const deliverySchema = z.object({ version: z.literal(1), request: teachingProposalRequestSchema,
  admittedStatements: z.array(premiseSchema.shape.statement).max(32).refine(rows => new Set(rows.map(row => JSON.stringify(row))).size === rows.length),
  proposals: z.array(z.object({ authority: z.literal("proposed-teaching-only"), label: z.string().max(120),
    proposal: proposalSchema, premises: z.array(premiseSchema).min(1).max(4) }).strict()).max(6),
  gaps: z.array(gapSchema).max(32), explanationWords: z.number().int().nonnegative().max(10000), complete: z.boolean() }).strict();

/** Recorded final factual statements, never a reconstruction of supplier review. */
function retainedTeachingStatements(statements: TeachingProposalDelivery["admittedStatements"], run: QueryRun) {
  const evidence = buildEvidenceMatrix(run).flatMap(row => row.evidence);
  return statements.filter(statement => {
    const coverage = run.claimCoverage?.filter(row => row.claimIndex === statement.claimIndex) ?? [];
    if (coverage.length !== 1 || !(coverage[0].coverage >= MIN_REWARD_SUPPORT) || !coverage[0].coveredBy.includes(statement.marker)) return false;
    const exact = evidence.filter(item => item.claimIndex === statement.claimIndex && item.marker === statement.marker &&
      item.quote === statement.quote && item.evidenceProvenance !== "synthetic-demo" && (item.qualifiesForAnswer ?? item.qualifiesForReward));
    return exact.length > 0 && exact.every(item => !!item.sourceId) &&
      new Set(exact.map(item => JSON.stringify([item.sourceId, item.itemId ?? null, item.itemUrl ?? null, item.contentVersion ?? null]))).size === 1;
  });
}

/** Portable data, not a reconstruction of the private review capability. Filter
 * down to its retained factual dependencies; never create citations or coverage. */
export function projectTeachingProposalDelivery(value: unknown, run: QueryRun): TeachingProposalDelivery | undefined {
  try {
    const parsed = deliverySchema.safeParse(boundedPortableCopy(value, 32000));
    if (!parsed.success) return;
    const delivery = parsed.data;
    if (!validTeachingProposalRequest(delivery.request, run.question)) return;
    if (new Set(delivery.proposals.map(row => row.proposal.id)).size !== delivery.proposals.length) return;
    const statements = retainedTeachingStatements(delivery.admittedStatements, run);
    const gaps = [...delivery.gaps];
    if (statements.length !== delivery.admittedStatements.length) gaps.push({ reason: "final-premise-withheld" });
    const explanationWords = teachingExplanationWordCount(statements);
    const proposals = delivery.proposals.filter(row => {
      const ids = row.premises.map(premise => premise.id);
      const admitted = ids.length === row.proposal.premiseIds.length && new Set(ids).size === ids.length &&
        ids.every(id => row.proposal.premiseIds.includes(id)) &&
        row.label === TEACHING_PROPOSAL_LABELS[delivery.request.language][row.proposal.kind] &&
        (row.proposal.kind !== "activity" || row.proposal.durationMinutes === delivery.request.durationMinutes) &&
        row.premises.every(({ statement }) => statements.some(item => item.claimIndex === statement.claimIndex &&
          item.marker === statement.marker && item.quote === statement.quote && item.text === statement.text));
      if (!admitted) gaps.push({ reason: "final-premise-withheld", proposalId: row.proposal.id, kind: row.proposal.kind });
      return admitted;
    });
    for (const [kind, count] of [["activity", 1], ["classification-example", delivery.request.exampleCount], ["exit-question", 1]] as const) {
      const retainedCount = proposals.filter(row => row.proposal.kind === kind).length;
      if (retainedCount > count) for (let index = proposals.length - 1; index >= 0; index--)
        if (proposals[index].proposal.kind === kind) proposals.splice(index, 1);
      if (retainedCount !== count && !gaps.some(gap => gap.reason === "requested-count" && gap.kind === kind)) gaps.push({ reason: "requested-count", kind });
    }
    if (explanationWords > delivery.request.explanationMaximumWords && !gaps.some(gap => gap.reason === "explanation-word-limit"))
      gaps.push({ reason: "explanation-word-limit" });
    return { ...delivery, admittedStatements: statements, explanationWords, proposals, gaps, complete: gaps.length === 0 };
  } catch { return; }
}
