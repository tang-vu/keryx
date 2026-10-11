import { z } from "zod";
import { boundedPortableCopy } from "../research/bounded-portable-json";
import type { buildRetainedQualityScorecard } from "./retained-quality-scorecard";

// Reviewed labels are independent of report/run IDs. New cases require source review.
const caseIds = ["mdn-public-20261009", "rfc-public-20261009", "nasa-public-20261009",
  "etag-public-20261009", "arxiv-public-20261009", "sqlite-public-20261009",
  "teacher-public-c700-e719b085", "newest-public-c700-76fa4ed9"] as const;
const publicCaseIds = ["case-01", "case-02", "case-03", "case-04", "case-05", "case-06", "case-07", "case-08"] as const;
export const qualityKinds = ["single-page", "exact-metadata", "comparison", "teaching-note", "newest-release"] as const;
export const qualityChecks = ["nonemptyAnswer", "retainedBindings", "bulletCount", "wordLimit",
  "language", "requiredFacts", "retainedTargetBindings", "sentenceCount"] as const;
const issueNumbers = [128, 158, 169, 172, 181, 211, 212, 217, 230, 231, 238, 276, 331] as const;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const commit = z.string().regex(/^[a-f0-9]{40}$/);
const date = z.string().datetime();
const count = z.number().int().min(0).max(32);
const status = z.enum(["PASS", "FAIL", "UNJUDGED"]);
const check = z.object({ status }); // Deliberately excludes free-form detail.
const checks = z.object({ nonemptyAnswer: check, retainedBindings: check, bulletCount: check,
  wordLimit: check, language: z.object({ status: z.literal("UNJUDGED") }),
  requiredFacts: z.object({ status: z.literal("UNJUDGED") }),
  retainedTargetBindings: check.optional(), sentenceCount: check.optional() });
const kind = z.enum(qualityKinds);
const caseId = z.enum(caseIds);
const issue = z.number().int().refine(value => issueNumbers.includes(value as typeof issueNumbers[number]));
const summary = z.object({ cases: count, deterministicPasses: count, deterministicFailures: count,
  deterministicPassRate: z.number().min(0).max(1).nullable(), semanticUnjudged: count,
  languageUnjudged: count, usefulAnswerRate: z.null() });
const receipt = z.object({ capturedAt: date, rawCaptureSha256: digest, payloadSha256: digest });
// Strip everything outside the explicit public vocabulary at every object boundary.
// This is a projection of the existing pure inspector's result, never a new grader.
const inputSchema = z.object({
  version: z.literal(1), scope: z.literal("retained-public-snapshot-inspection"),
  inspection: z.object({ inspectedAt: date, inspectorCommit: commit, inspectorSourceSha256: digest,
    runtime: z.string().regex(/^v\d+\.\d+\.\d+$/) }),
  corpusSha256: digest, suiteDefinitionSha256: digest, captureFingerprintSha256: digest,
  inventorySha256: digest, coverageRegistrySha256: digest,
  historicalCaptureAllowance: z.null(), historicalCaptureAllowanceStatus: z.literal("UNKNOWN"),
  overall: summary,
  cases: z.array(z.object({ id: caseId, kind, requestedLanguage: z.enum(["de", "en", "es", "pt-BR", "vi"]),
    issues: z.array(issue).min(1).max(16), fixtureSha256: digest,
    provenance: z.object({ capturedAt: date, deployedCommit: commit, rawCaptureSha256: digest,
      retainedReceipt: receipt.optional() }), checks,
    deterministicContractPassed: z.boolean(), deliverableAccepted: z.literal(false),
    historicalCaptureAllowance: z.null(), historicalCaptureAllowanceStatus: z.literal("UNKNOWN"),
  })).min(1).max(8),
  coverage: z.object({ inventoryCapturedAt: date, completeOpenIssueCoverage: z.literal(false),
    issues: z.array(z.object({ number: issue, requiredKinds: z.array(kind).min(1).max(5),
      caseIds: z.array(caseId).max(8), semanticAcceptance: z.literal("UNJUDGED") })).min(1).max(16) }),
  // All four frozen compositions have no removals. Do not publish future unreviewed reasons.
  removals: z.array(z.never()).max(0),
  releaseQualityRegression: z.object({ status: z.literal("NOT_COMPARABLE") }),
  operationalOrSemanticAcceptance: z.literal(false),
});

function unique(values: readonly (number | string)[]) {
  if (new Set(values).size !== values.length) throw new Error("INVALID_PUBLIC_SCORECARD");
}
const safeId = (id: typeof caseIds[number]) => publicCaseIds[caseIds.indexOf(id)];

/** Whitelisted, zero-I/O publication boundary for an already recorded assessment. */
export function projectPublicQualityScorecard(input: ReturnType<typeof buildRetainedQualityScorecard> | unknown) {
  // Generic errors never echo a question, field value, path or identity.
  let copied: unknown;
  try { copied = boundedPortableCopy(input, 1048576); }
  catch { throw new Error("INVALID_PUBLIC_SCORECARD"); }
  const parsed = inputSchema.safeParse(copied);
  if (!parsed.success) throw new Error("INVALID_PUBLIC_SCORECARD");
  const source = parsed.data;
  unique(source.cases.map(row => row.id));
  unique(source.coverage.issues.map(row => row.number));
  const cases = source.cases.map(row => {
    unique(row.issues);
    const failedChecks = qualityChecks.filter(name => row.checks[name]?.status === "FAIL");
    if (row.deterministicContractPassed !== (failedChecks.length === 0) ||
      Date.parse(row.provenance.capturedAt) > Date.parse(source.inspection.inspectedAt) ||
      (row.provenance.retainedReceipt && Date.parse(row.provenance.retainedReceipt.capturedAt) > Date.parse(source.inspection.inspectedAt))) {
      throw new Error("INVALID_PUBLIC_SCORECARD");
    }
    return { id: safeId(row.id), kind: row.kind, requestedLanguage: row.requestedLanguage,
      issues: row.issues, fixtureSha256: row.fixtureSha256,
      // No provenance spread: reportUrl, projection and future fields cannot escape.
      capturedAt: row.provenance.capturedAt, recordedCommit: row.provenance.deployedCommit,
      rawCaptureSha256: row.provenance.rawCaptureSha256,
      receipt: row.provenance.retainedReceipt ? { capturedAt: row.provenance.retainedReceipt.capturedAt,
        rawCaptureSha256: row.provenance.retainedReceipt.rawCaptureSha256,
        payloadSha256: row.provenance.retainedReceipt.payloadSha256 } : null,
      checks: qualityChecks.filter(name => row.checks[name]).map(name => ({ name, status: row.checks[name]!.status })),
      deterministicContractPassed: row.deterministicContractPassed, failedChecks,
      semantic: "UNJUDGED" as const, language: "UNJUDGED" as const,
      historicalCaptureAllowance: null, historicalCaptureAllowanceStatus: "UNKNOWN" as const };
  });
  const summarize = (rows: typeof cases) => {
    const passes = rows.filter(row => row.deterministicContractPassed).length;
    return { cases: rows.length, deterministicPasses: passes, deterministicFailures: rows.length - passes,
      deterministicPassRate: rows.length ? passes / rows.length : null,
      semanticUnjudged: rows.length, languageUnjudged: rows.length, usefulAnswerRate: null };
  };
  const overall = summarize(cases);
  if (JSON.stringify(overall) !== JSON.stringify(source.overall) ||
    Date.parse(source.coverage.inventoryCapturedAt) > Date.parse(source.inspection.inspectedAt)) {
    throw new Error("INVALID_PUBLIC_SCORECARD");
  }
  const coverage = source.coverage.issues.map(row => {
    unique(row.caseIds);
    for (const id of row.caseIds) {
      const c = source.cases.find(c => c.id === id);
      if (!c || !c.issues.includes(row.number) || !row.requiredKinds.includes(c.kind)) throw new Error("INVALID_PUBLIC_SCORECARD");
    }
    return { number: row.number, url: `https://github.com/tang-vu/keryx/issues/${row.number}`,
      requiredKinds: row.requiredKinds, caseIds: row.caseIds.map(safeId),
      missingKinds: row.requiredKinds.filter(k => !row.caseIds.some(id => source.cases.find(c => c.id === id)!.kind === k)) };
  });
  if (source.cases.some(c => c.issues.some(number => !source.coverage.issues.some(i => i.number === number && i.caseIds.includes(c.id))))) {
    throw new Error("INVALID_PUBLIC_SCORECARD");
  }
  return { version: 1, inspection: source.inspection,
    corpusSha256: source.corpusSha256, suiteDefinitionSha256: source.suiteDefinitionSha256,
    captureFingerprintSha256: source.captureFingerprintSha256,
    inventorySha256: source.inventorySha256, coverageRegistrySha256: source.coverageRegistrySha256,
    overall, byKind: qualityKinds.map(kind => ({ kind, ...summarize(cases.filter(c => c.kind === kind)) })),
    byLanguage: [...new Set(cases.map(c => c.requestedLanguage))].sort().map(language =>
      ({ language, ...summarize(cases.filter(c => c.requestedLanguage === language)) })),
    cases, coverage: { inventoryCapturedAt: source.coverage.inventoryCapturedAt, issues: coverage, completeOpenIssueCoverage: false },
    removals: [], historicalCaptureAllowance: null, historicalCaptureAllowanceStatus: "UNKNOWN" as const,
    usefulAnswerRate: null, releaseQualityRegression: "NOT_COMPARABLE" as const, operationalOrSemanticAcceptance: false };
}

export type PublicQualityScorecard = ReturnType<typeof projectPublicQualityScorecard>;
