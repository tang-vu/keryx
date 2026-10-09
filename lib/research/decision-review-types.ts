import { z } from "zod";

export const reviewIdSchema = z.string().uuid();
export const reviewWalletSchema = z.string().regex(/^0x[0-9a-f]{40}$/);
export const reviewNetworkSchema = z.enum(["eip155:5042", "eip155:5042002"]);
export const reviewActionSchema = z.enum(["BUY", "SKIP", "CACHE"]);
export const reviewRuleSchema = z.enum(["model-skip", "selected", "public-read", "external-only", "missing-proposal", "discussion", "preview", "attention", "portfolio", "terms-changed", "duplicate", "rights", "funding-unavailable", "zero-budget", "budget", "sufficient", "assessment-unavailable", "not-admitted", "cache-expired", "cache-selected"]);
export const reviewCohortSchema = z.enum(["outside", "team", "scripted", "unknown"]);
export const REVIEW_POLICY_VERSION = "captured-owner-decisions-v1" as const;
const micros = z.string().regex(/^(0|[1-9][0-9]{0,15})$/).refine(value => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER));
// JS length counts UTF-16 units; refuse lone surrogates rather than normalize them.
const wellFormedText = (value: string) => !/[\uD800-\uDFFF]/u.test(value);
const boundedText = z.string().min(1).max(256).refine(value => wellFormedText(value) && !/[\u0000-\u001f\u007f]/u.test(value));
const reasonText = z.string().max(1000).refine(value => wellFormedText(value) && value === value.trim() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
export const decisionTermsSchema = z.object({
  assetId: boundedText, sourceId: boundedText, owned: z.boolean(),
  itemId: boundedText.optional(), contentVersion: boundedText.optional(),
  network: reviewNetworkSchema, payTo: reviewWalletSchema.optional(),
  priceMicroUsdc: micros, citationBudgetMicroUsdc: micros,
  listPriceMicroUsdc: micros,
  offerId: boundedText.optional(), claimDigest: z.string().regex(/^[0-9a-f]{64}$/).optional(),
}).strict().refine(value => !value.owned || value.payTo !== undefined, "Owned decisions require authoritative payee");
const capturedFields = z.object({
  policyVersion: z.literal(REVIEW_POLICY_VERSION), engine: boundedText, requestedModel: boundedText.nullable(),
  runId: reviewIdSchema, round: z.number().int().min(0).max(8), ordinal: z.number().int().min(0).max(999),
  sourceName: z.string().min(1).max(256).refine(wellFormedText), modelAction: reviewActionSchema.nullable(),
  codeAction: reviewActionSchema, codeRule: reviewRuleSchema,
  terms: decisionTermsSchema, reviewFirst: z.boolean(),
  cohort: reviewCohortSchema, cohortEvidence: boundedText.nullable(),
}).strict();
const cohortBinding = (value: z.infer<typeof capturedFields>) => value.cohort === "unknown" ? value.cohortEvidence === null : value.cohortEvidence !== null;
export const captureDecisionSchema = capturedFields.refine(cohortBinding);
export type DecisionTerms = z.infer<typeof decisionTermsSchema>;
export type CaptureDecision = z.infer<typeof captureDecisionSchema>;
export const reviewVerdictSchema = z.object({
  id: reviewIdSchema, key: reviewIdSchema, context: z.enum(["gate", "opinion"]), value: z.enum(["agree", "disagree"]),
  expectedCode: z.object({ action: reviewActionSchema, rule: reviewRuleSchema }).strict().optional(),
  reason: z.string().trim().pipe(reasonText).optional(),
}).strict().refine(value => value.context === "opinion" ? value.expectedCode !== undefined : value.expectedCode === undefined);
export type ReviewVerdictInput = z.infer<typeof reviewVerdictSchema>;
export const decisionReviewSchema = capturedFields.extend({
  initialCodeAction: reviewActionSchema, initialCodeRule: reviewRuleSchema,
  id: reviewIdSchema, createdAt: z.string().datetime(), expiresAt: z.string().datetime().nullable(),
  state: z.enum(["observed", "held", "approved", "declined", "expired", "consumed", "cancelled"]),
  verdict: z.object({ value: z.enum(["agree", "disagree"]), reason: reasonText.optional(), context: z.enum(["gate", "opinion"]),
    codeAction: reviewActionSchema, codeRule: reviewRuleSchema, createdAt: z.string().datetime() }).strict().nullable(),
}).strict().refine(cohortBinding);
export type DecisionReview = z.infer<typeof decisionReviewSchema>;
export interface DecisionReviewMetrics {
  network: z.infer<typeof reviewNetworkSchema>; since: string; until: string; rule: "captured-owner-decisions-v1";
  cohorts: { cohort: z.infer<typeof reviewCohortSchema>; decisions: number; agrees: number; disagrees: number;
    agreementRate: number | null; modelCodeDifferences: number; codeRefusals: number; refusalReasons: Partial<Record<z.infer<typeof reviewRuleSchema>, number>> }[];
}
export const reviewPeriodSchema = z.object({ network: reviewNetworkSchema,
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/),
}).strict().refine(value => Number.isFinite(Date.parse(value.since)) && Number.isFinite(Date.parse(value.until)) &&
  new Date(value.since).toISOString() === value.since && new Date(value.until).toISOString() === value.until &&
  value.since < value.until && Date.parse(value.until) - Date.parse(value.since) <= 366 * 86_400_000);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
// Partial rule counts, independent of enum-record exhaustiveness in Zod versions.
const refusalCounts = z.record(z.string(), count).refine(value => Object.keys(value).every(key => reviewRuleSchema.safeParse(key).success));
export const decisionReviewMetricsSchema = z.object({ network: reviewNetworkSchema, since: z.string(), until: z.string(), rule: z.literal(REVIEW_POLICY_VERSION),
  cohorts: z.array(z.object({ cohort: reviewCohortSchema, decisions: count, agrees: count, disagrees: count,
    agreementRate: z.number().min(0).max(1).nullable(), modelCodeDifferences: count, codeRefusals: count, refusalReasons: refusalCounts }).strict()).length(4),
}).strict().superRefine((value, ctx) => {
  if (!reviewPeriodSchema.safeParse({ network: value.network, since: value.since, until: value.until }).success) ctx.addIssue({ code: "custom", message: "Invalid period" });
  for (const [index, row] of value.cohorts.entries()) {
    const votes = row.agrees + row.disagrees;
    if (row.cohort !== reviewCohortSchema.options[index] || votes > row.decisions || row.modelCodeDifferences > row.decisions || row.codeRefusals > row.decisions ||
      Object.values(row.refusalReasons).reduce((sum, n) => sum + n, 0) !== row.codeRefusals ||
      (votes === 0 ? row.agreementRate !== null : row.agreementRate === null || Math.abs(row.agreementRate - row.agrees / votes) > 1e-12))
      ctx.addIssue({ code: "custom", message: "Invalid aggregate" });
  }
});
export interface DecisionReviewsStore {
  ready(): Promise<void>;
  capture(owner: string, input: CaptureDecision, now?: number): Promise<DecisionReview>;
  begin(owner: string, id: string, now?: number): Promise<DecisionReview>;
  list(owner: string, runId: string): Promise<DecisionReview[]>;
  read(owner: string, id: string): Promise<DecisionReview | null>;
  verdict(owner: string, input: ReviewVerdictInput, now?: number): Promise<DecisionReview>;
  consume(owner: string, id: string, terms: DecisionTerms, now?: number): Promise<DecisionReview>;
  cancel(owner: string, runId: string): Promise<void>;
  expire(owner: string, id: string, now?: number): Promise<void>;
  observe(owner: string, id: string, action: z.infer<typeof reviewActionSchema>, rule: z.infer<typeof reviewRuleSchema>): Promise<void>;
  metrics(network: string, since: string, until: string): Promise<DecisionReviewMetrics>;
}
export class DecisionReviewError extends Error {
  constructor(readonly code: "review_unavailable" | "review_conflict" | "review_not_found" | "review_expired" | "review_live_required" | "review_unsupported") { super(code); }
}
/** An individual stale source can be withheld without weakening global owner authority. */
export class DecisionReviewSourceChanged extends Error {}
export function reviewOwner(owner: string) { return reviewWalletSchema.parse(owner.toLowerCase()); }
export const REVIEW_WAIT_MS = 60_000;
/** Adapters without an authenticated live browser broker must not drop review intent. */
export function unsupportedDecisionReviewIntent(input: unknown): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  return Object.hasOwn(value, "reviewFirst") && value.reviewFirst !== false ||
    [value.mode, value.researchMode, value.responseMode].some(mode => mode === "review-first" || mode === "reviewFirst");
}
export function unsupportedDecisionReviewFlag(text: string): boolean {
  return /(?:^|\s)--(?:review-first|reviewFirst)(?:\s|=|$)|(?:^|\s)--(?:mode|research-mode)(?:=|\s+)(?:review-first|reviewFirst)(?:\s|$)/u.test(text);
}

/** No tolerance or rounding: scientific/sub-micro and unsafe amounts refuse. */
export function reviewMicros(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0 || Object.is(amount, -0)) throw new DecisionReviewError("review_unavailable");
  const match = String(amount).match(/^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/);
  if (!match) throw new DecisionReviewError("review_unavailable");
  return micros.parse((BigInt(match[1]) * BigInt(1_000_000) + BigInt((match[2] ?? "").padEnd(6, "0"))).toString());
}
export interface AgentDecisionReviews {
  capture(input: Omit<CaptureDecision, "cohort" | "cohortEvidence" | "reviewFirst">): Promise<DecisionReview>;
  admit(record: DecisionReview, currentTerms: () => Promise<DecisionTerms>): Promise<boolean>;
  observe(record: DecisionReview, action: CaptureDecision["codeAction"], rule: CaptureDecision["codeRule"]): Promise<void>;
}
