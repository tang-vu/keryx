import { z } from "zod";
import { boundedPortableCopy } from "./bounded-portable-json";
import { compareSavedResearch, MAX_COMPARISON_TARGETS, type ReportComparison, type TargetMatch } from "./report-comparison";

export const MAX_COMPARISON_PLAN_BYTES = 65_536;
const index = z.number().int().min(0).max(MAX_COMPARISON_TARGETS - 1);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const planSchema = z.object({
  format: z.literal("keryx-report-matching-v1"),
  beforeDigest: digest, afterDigest: digest,
  matches: z.array(z.object({ beforeClaimIndex: index, afterClaimIndex: index }).strict()).max(MAX_COMPARISON_TARGETS),
}).strict().refine(plan => new Set(plan.matches.map(pair => pair.beforeClaimIndex)).size === plan.matches.length
  && new Set(plan.matches.map(pair => pair.afterClaimIndex)).size === plan.matches.length);
export type ReportComparisonPlan = z.infer<typeof planSchema>;
export class ReportComparisonPlanError extends Error {
  constructor(public readonly code: "invalid-matching-plan" | "matching-receipts-mismatch") {
    super(code); this.name = "ReportComparisonPlanError";
  }
}

function parsePlan(raw: string): ReportComparisonPlan {
  try {
    if (typeof raw !== "string" || raw.length > MAX_COMPARISON_PLAN_BYTES
      || new TextEncoder().encode(raw).length > MAX_COMPARISON_PLAN_BYTES) throw new Error();
    return planSchema.parse(boundedPortableCopy(JSON.parse(raw.replace(/^\uFEFF/u, "")), MAX_COMPARISON_PLAN_BYTES));
  } catch { throw new ReportComparisonPlanError("invalid-matching-plan"); }
}

function boundMatches(plan: ReportComparisonPlan, comparison: ReportComparison): TargetMatch[] {
  if (plan.beforeDigest !== comparison.before.digest || plan.afterDigest !== comparison.after.digest)
    throw new ReportComparisonPlanError("matching-receipts-mismatch");
  if (plan.matches.some(pair => !comparison.before.targets.some(target => target.claimIndex === pair.beforeClaimIndex)
    || !comparison.after.targets.some(target => target.claimIndex === pair.afterClaimIndex)))
    throw new ReportComparisonPlanError("invalid-matching-plan");
  return plan.matches;
}

/** Small portable selection, without report text, source URLs or local filenames.
 * Digests bind caller-selected order, not authorship or semantic equivalence. */
export function createReportComparisonPlan(comparison: ReportComparison, matches?: TargetMatch[]): ReportComparisonPlan {
  const pairs = matches ?? comparison.targets.flatMap(target => target.before && target.after
    ? [{ beforeClaimIndex: target.before.claimIndex, afterClaimIndex: target.after.claimIndex }] : []);
  const parsed = planSchema.safeParse({ format: "keryx-report-matching-v1", beforeDigest: comparison.before.digest,
    afterDigest: comparison.after.digest, matches: pairs });
  if (!parsed.success) throw new ReportComparisonPlanError("invalid-matching-plan");
  boundMatches(parsed.data, comparison);
  return parsed.data;
}

/** Apply only to a comparison produced from already checksum-checked receipts. */
export function restoreReportComparisonPlan(raw: string, comparison: ReportComparison): TargetMatch[] {
  return boundMatches(parsePlan(raw), comparison);
}

/** CLI/local MCP use exactly the same binding and matching engine as the browser.
 * Explicit empty selections remain empty; a plan and separate matches are ambiguous. */
export async function compareResearchWithPlan(input: { before: string; after: string; matches?: TargetMatch[]; matchingPlan?: string }) {
  if (input.matchingPlan === undefined) return compareSavedResearch(input);
  if (input.matches !== undefined) throw new ReportComparisonPlanError("invalid-matching-plan");
  const plan = parsePlan(input.matchingPlan);
  const comparison = await compareSavedResearch({ before: input.before, after: input.after, matches: [] });
  const matches = boundMatches(plan, comparison);
  return compareSavedResearch({ before: input.before, after: input.after, matches });
}
