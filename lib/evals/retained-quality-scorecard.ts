import { z } from "zod";
import { boundedPortableCopy } from "../research/bounded-portable-json";
import { deliverableContractSchema, deliverableSnapshotSchema, deliverableSha256, DeliverableInputError } from "./deliverable-contract";
import { gradeDeliverableCorpus } from "./deliverable-corpus";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const kind = z.enum(["single-page", "exact-metadata", "comparison", "teaching-note", "newest-release"]);
const kinds = kind.options;
const entry = z.object({ file: z.string().regex(/^deliverable-[a-z0-9-]+\.json$/),
  sha256: digest, contract: deliverableContractSchema }).strict();
const corpusSchema = z.object({
  manifest: z.object({ version: z.literal(1), id, description: z.string().min(1).max(1024),
    cases: z.array(entry).min(1).max(32) }).strict(),
  cases: z.array(entry.extend({ snapshot: deliverableSnapshotSchema }).strict()).min(1).max(32),
  corpusSha256: digest,
}).strict();
const issueSchema = z.object({ number: z.number().int().positive(), title: z.string().min(1).max(256),
  url: z.string().regex(/^https:\/\/github\.com\/tang-vu\/keryx\/issues\/[1-9]\d*$/) }).strict();
export const qualityIssueInventorySchema = z.object({ version: z.literal(1), capturedAt: z.string().datetime(),
  source: z.literal("public-github-open-issue-list"), issues: z.array(issueSchema).min(1).max(128) }).strict();
export const qualityCoverageSchema = z.object({ version: z.literal(1), id,
  scope: z.literal("selected-open-answer-quality-issues"), inventorySha256: digest,
  issues: z.array(z.object({ number: z.number().int().positive(),
    requiredKinds: z.array(kind).min(1).max(5), caseIds: z.array(id).max(32) }).strict()).min(1).max(128),
  removals: z.array(z.object({ caseId: id, reason: z.string().trim().min(1).max(1024),
    recordedAt: z.string().datetime(), previousSuiteSha256: digest }).strict()).max(32),
}).strict();
const inspectionSchema = z.object({ inspectedAt: z.string().datetime(), inspectorCommit: z.string().regex(/^[a-f0-9]{40}$/),
  inspectorSourceSha256: digest, runtime: z.string().regex(/^v(?:22|24|2[5-9]|[3-9]\d)\.\d+\.\d+$/) }).strict();
const policySchema = z.object({ version: z.literal(1), id,
  metric: z.literal("deterministic-contract-pass-rate"), allowedDropBasisPoints: z.number().int().min(0).max(10000),
  rationale: z.string().trim().min(1).max(1024), evidenceSha256: digest }).strict();

export type RetainedQualityInputs = { corpus: unknown; inventory: unknown; coverage: unknown; inspection: unknown };
const canonical = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  try { return schema.parse(boundedPortableCopy(value, 1048576)); }
  catch { throw new DeliverableInputError("INVALID_SCORECARD_INPUT"); }
}
function unique(values: (string | number)[], error: string) {
  if (new Set(values).size !== values.length) throw new DeliverableInputError(error);
}

/** Pure retained-data inspection. Recompute grades; caller PASS/acceptance fields have no schema. */
export function buildRetainedQualityScorecard(inputs: RetainedQualityInputs) {
  const corpus = parse(corpusSchema, inputs.corpus), inventory = parse(qualityIssueInventorySchema, inputs.inventory);
  const coverage = parse(qualityCoverageSchema, inputs.coverage), inspection = parse(inspectionSchema, inputs.inspection);
  if (Date.parse(inventory.capturedAt) > Date.parse(inspection.inspectedAt))
    throw new DeliverableInputError("INVENTORY_AFTER_INSPECTION");
  if (deliverableSha256(canonical(corpus.manifest)) !== corpus.corpusSha256 ||
      deliverableSha256(canonical(inventory)) !== coverage.inventorySha256)
    throw new DeliverableInputError("SCORECARD_INPUT_DIGEST_MISMATCH");
  unique(corpus.cases.map(c => c.contract.id), "DUPLICATE_SCORECARD_CASE");
  unique(corpus.cases.map(c => c.file), "DUPLICATE_SCORECARD_CASE");
  unique(inventory.issues.map(i => i.number), "DUPLICATE_QUALITY_ISSUE");
  unique(coverage.issues.map(i => i.number), "DUPLICATE_QUALITY_ISSUE");
  unique(coverage.removals.map(r => r.caseId), "DUPLICATE_CASE_REMOVAL");
  if (corpus.manifest.cases.length !== corpus.cases.length) throw new DeliverableInputError("SCORECARD_CASE_SET_MISMATCH");
  for (let index = 0; index < corpus.cases.length; index++) {
    const row = corpus.cases[index], expected = corpus.manifest.cases[index];
    if (canonical({ file: row.file, sha256: row.sha256, contract: row.contract }) !== canonical(expected) ||
        deliverableSha256(canonical(row.snapshot)) !== row.sha256)
      throw new DeliverableInputError("SCORECARD_CASE_SET_MISMATCH");
    if (Date.parse(row.snapshot.provenance.capturedAt) > Date.parse(inspection.inspectedAt))
      throw new DeliverableInputError("CAPTURE_AFTER_INSPECTION");
  }
  const publicIssues = new Map(inventory.issues.map(i => [i.number, i]));
  for (const issue of inventory.issues) {
    if (issue.url !== `https://github.com/tang-vu/keryx/issues/${issue.number}`)
      throw new DeliverableInputError("QUALITY_ISSUE_IDENTITY_MISMATCH");
  }
  const casesById = new Map(corpus.cases.map(c => [c.contract.id, c]));
  for (const issue of coverage.issues) {
    unique(issue.caseIds, "DUPLICATE_ISSUE_CASE");
    unique(issue.requiredKinds, "DUPLICATE_ISSUE_KIND");
    if (!publicIssues.has(issue.number)) throw new DeliverableInputError("UNKNOWN_QUALITY_ISSUE");
    for (const caseId of issue.caseIds) {
      const c = casesById.get(caseId);
      if (!c || !c.contract.issues.includes(issue.number) || !issue.requiredKinds.includes(c.contract.kind))
        throw new DeliverableInputError("UNBOUND_QUALITY_ISSUE_CASE");
    }
  }
  for (const c of corpus.cases) {
    for (const issue of c.contract.issues) {
      if (!coverage.issues.some(i => i.number === issue && i.caseIds.includes(c.contract.id)))
        throw new DeliverableInputError("UNREGISTERED_SCORECARD_CASE");
    }
  }
  for (const removal of coverage.removals) {
    if (casesById.has(removal.caseId) || Date.parse(removal.recordedAt) > Date.parse(inspection.inspectedAt))
      throw new DeliverableInputError("INVALID_CASE_REMOVAL");
  }
  const graded = gradeDeliverableCorpus(corpus);
  const cases = graded.cases.map(c => ({ ...c, historicalCaptureAllowance: null,
    historicalCaptureAllowanceStatus: "UNKNOWN" as const }));
  const summarize = (selected: typeof cases) => ({ cases: selected.length,
    deterministicPasses: selected.filter(c => c.deterministicContractPassed).length,
    deterministicFailures: selected.filter(c => !c.deterministicContractPassed).length,
    deterministicPassRate: selected.length ? selected.filter(c => c.deterministicContractPassed).length / selected.length : null,
    semanticUnjudged: selected.length, languageUnjudged: selected.length, usefulAnswerRate: null });
  const issueCoverage = coverage.issues.map(i => ({ ...publicIssues.get(i.number)!, requiredKinds: i.requiredKinds,
    caseIds: i.caseIds, missingKinds: i.requiredKinds.filter(k => !i.caseIds.some(caseId => casesById.get(caseId)!.contract.kind === k)),
    semanticAcceptance: "UNJUDGED" as const }));
  const definition = corpus.cases.map(c => ({ id: c.contract.id, contract: c.contract }));
  const captures = cases.map(c => ({ id: c.id, fixtureSha256: corpus.cases.find(row => row.contract.id === c.id)!.sha256,
    provenance: c.provenance }));
  return { version: 1, scope: "retained-public-snapshot-inspection" as const, inspection,
    corpusId: corpus.manifest.id, corpusSha256: corpus.corpusSha256,
    suiteDefinitionSha256: deliverableSha256(canonical(definition)),
    captureFingerprintSha256: deliverableSha256(canonical(captures)),
    inventorySha256: coverage.inventorySha256, coverageRegistrySha256: deliverableSha256(canonical(coverage)),
    inspectionCalls: { model: 0, search: 0, payment: 0, database: 0 },
    historicalCaptureAllowanceStatus: "UNKNOWN" as const, historicalCaptureAllowance: null,
    overall: summarize(cases),
    byKind: kinds.map(k => ({ kind: k, ...summarize(cases.filter(c => c.kind === k)) })),
    byLanguage: [...new Set(cases.map(c => c.requestedLanguage))].sort().map(language =>
      ({ language, ...summarize(cases.filter(c => c.requestedLanguage === language)) })),
    failures: cases.filter(c => !c.deterministicContractPassed).map(c => ({ id: c.id, issues: c.issues,
      failedChecks: Object.entries(c.checks).filter(([, check]) => check.status === "FAIL").map(([name]) => name) })),
    coverage: { scope: coverage.scope, inventoryCapturedAt: inventory.capturedAt, issues: issueCoverage,
      missingKinds: kinds.filter(k => !cases.some(c => c.kind === k)),
      issuesWithoutRetainedCases: issueCoverage.filter(i => !i.caseIds.length).map(i => i.number),
      completeOpenIssueCoverage: false },
    removals: coverage.removals, cases,
    releaseQualityRegression: { status: "NOT_COMPARABLE" as const, reason: "No independent semantic/language rubric and agreed useful-answer margin." },
    operationalOrSemanticAcceptance: false,
  };
}

/** A supplied policy compares deterministic contracts only; it grants no release/semantic acceptance. */
export function compareRetainedQualityScorecards(previous: RetainedQualityInputs, current: RetainedQualityInputs, policyInput?: unknown) {
  const before = buildRetainedQualityScorecard(previous), after = buildRetainedQualityScorecard(current);
  const policy = policyInput === undefined ? null : parse(policySchema, policyInput);
  const common = { metric: "deterministic-contract-pass-rate", releaseQualityRegression: "NOT_COMPARABLE",
    operationalOrSemanticAcceptance: false, policyIsOwnerAgreementAttestation: false };
  if (!policy) return { ...common, status: "NOT_COMPARABLE", reason: "NO_SUPPLIED_DIAGNOSTIC_POLICY" };
  if (before.suiteDefinitionSha256 !== after.suiteDefinitionSha256) {
    const removed = before.cases.filter(c => !after.cases.some(a => a.id === c.id));
    if (removed.some(c => !after.removals.some(r => r.caseId === c.id && r.previousSuiteSha256 === before.suiteDefinitionSha256)))
      throw new DeliverableInputError("UNDOCUMENTED_CASE_REMOVAL");
    return { ...common, status: "NOT_COMPARABLE", reason: "CHANGED_SUITE" };
  }
  if (before.captureFingerprintSha256 === after.captureFingerprintSha256)
    return { ...common, status: "NOT_COMPARABLE", reason: "SAME_RETAINED_CAPTURES" };
  const left = before.overall, right = after.overall;
  const numerator = left.deterministicPasses * right.cases - right.deterministicPasses * left.cases;
  const flagged = numerator * 10000 > policy.allowedDropBasisPoints * left.cases * right.cases;
  return { ...common, status: "DETERMINISTIC_DIAGNOSTIC_ONLY", policy,
    regressionFlagged: flagged, before: left, after: right };
}
