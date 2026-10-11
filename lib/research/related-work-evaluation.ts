import { z } from "zod";
import { normalizeDoi } from "../scholarly/doi";
import { isWellFormedUtf16 } from "../llm/well-formed-utf16";
import { buildEvidenceDraft } from "./evidence-draft";

/** Offline scorer for issue 283's evaluation criterion.
 *
 * It compares a related-work draft with the works cited by a reference section
 * and counts reviewer judgments of the draft's exported statements. It reads no
 * paper, calls no model and judges nothing itself: an unsupported-statement rate
 * exists only where a named reviewer supplied the judgments. Reviews whose
 * reference section is a synthetic fixture are scored for regression tests and
 * are never included in the reported aggregate. */
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const expertWorkSchema = z.object({
  url: z.string().max(2048).url().refine(isWellFormedUtf16).optional(),
  doi: z.string().max(200).refine(value => normalizeDoi(value) !== undefined).optional(),
}).strict().refine(value => value.url !== undefined || value.doi !== undefined);
const judgmentSchema = z.object({
  statementId: id, verdict: z.enum(["supported", "unsupported"]),
  reviewer: z.string().min(1).max(120).refine(isWellFormedUtf16).refine(value => !!value.trim()),
}).strict();
export const relatedWorkEvaluationSchema = z.object({
  version: z.literal(1), scope: z.literal("related-work-evaluation"),
  reviews: z.array(z.object({
    id, referenceOrigin: z.enum(["expert-written", "synthetic-fixture"]),
    expertWorks: z.array(expertWorkSchema).min(1).max(200),
    /** A version-1 private-evidence-draft packet; validated by the shared draft contract. */
    draft: z.unknown(),
    judgments: z.array(judgmentSchema).max(384),
  }).strict()).min(1).max(50),
}).strict();
export type RelatedWorkEvaluationInput = z.infer<typeof relatedWorkEvaluationSchema>;

const ratio = (numerator: number, denominator: number) => denominator ? numerator / denominator : null;

export function evaluateRelatedWorkDrafts(value: unknown) {
  const input = relatedWorkEvaluationSchema.parse(value);
  if (new Set(input.reviews.map(row => row.id)).size !== input.reviews.length) throw new Error("Duplicate review identifiers");
  const reviews = input.reviews.map(review => {
    const draft = buildEvidenceDraft(review.draft), statements = draft.themes.flatMap(theme => theme.statements);
    const bound = statements.filter(row => row.status === "excerpt-bound");
    // Exact URL or exact normalized DOI only: no title similarity and no cross-version match.
    const works = [...new Map(review.expertWorks.map(work => {
      const doi = work.doi === undefined ? undefined : normalizeDoi(work.doi);
      return [doi ? `doi:${doi}` : `url:${work.url}`, { url: work.url, doi }] as const;
    })).values()];
    const cited = (work: typeof works[number]) => draft.references.some(row =>
      (work.url !== undefined && row.paper.url === work.url) || (work.doi !== undefined && row.paper.doi === work.doi));
    const covered = works.filter(cited).length;
    if (new Set(review.judgments.map(row => row.statementId)).size !== review.judgments.length) throw new Error("Duplicate statement judgments");
    // A judgment can only concern a sentence that is exported with a citation.
    if (review.judgments.some(row => !bound.some(statement => statement.id === row.statementId))) throw new Error("Judgment for a statement that is not exported with a citation");
    const unsupported = review.judgments.filter(row => row.verdict === "unsupported").length;
    return {
      id: review.id, referenceOrigin: review.referenceOrigin,
      expertWorks: works.length, expertWorksCited: covered, coverage: ratio(covered, works.length),
      draftReferences: draft.references.length,
      draftReferencesOutsideExpertList: draft.references.filter(row => !works.some(work =>
        (work.url !== undefined && row.paper.url === work.url) || (work.doi !== undefined && row.paper.doi === work.doi))).length,
      includedWithoutRetainedExcerpt: draft.unread.length,
      statements: { citing: bound.length, authorGap: statements.filter(row => row.status === "author-gap").length,
        withheld: statements.filter(row => row.status === "withheld").length },
      judged: review.judgments.length, unjudged: bound.length - review.judgments.length, unsupported,
      unsupportedStatementRate: ratio(unsupported, review.judgments.length),
      reviewers: [...new Set(review.judgments.map(row => row.reviewer.trim()))].sort(),
    };
  });
  const expert = reviews.filter(row => row.referenceOrigin === "expert-written");
  const sum = (pick: (row: typeof reviews[number]) => number) => expert.reduce((total, row) => total + pick(row), 0);
  const judged = sum(row => row.judged), complete = expert.length > 0 && expert.every(row => row.unjudged === 0 && row.judged > 0);
  return {
    version: 1 as const, scope: "related-work-evaluation" as const,
    notice: "Counts only. Coverage compares exact cited records with the supplied reference sections; the unsupported-statement rate restates supplied reviewer judgments. Reference-section origin, reviewer identity and expertise are asserted by the input and are not verified here.",
    reviews,
    aggregate: {
      /** Measured only when every expert-written review has every citing statement judged. */
      status: complete ? "measured" as const : "not-measured" as const,
      expertReviews: expert.length, syntheticReviewsExcluded: reviews.length - expert.length,
      expertWorks: sum(row => row.expertWorks), expertWorksCited: sum(row => row.expertWorksCited),
      coverage: ratio(sum(row => row.expertWorksCited), sum(row => row.expertWorks)),
      citingStatements: sum(row => row.statements.citing), judged, unjudged: sum(row => row.unjudged),
      unsupported: sum(row => row.unsupported), unsupportedStatementRate: ratio(sum(row => row.unsupported), judged),
    },
  };
}
export type RelatedWorkEvaluation = ReturnType<typeof evaluateRelatedWorkDrafts>;
