import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deliverableSha256 } from "./deliverable-contract";
import { loadDeliverableCorpus } from "./deliverable-corpus";
import { buildRetainedQualityScorecard, compareRetainedQualityScorecards } from "./retained-quality-scorecard";

const canonical = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
function inputs() {
  const corpus = structuredClone(loadDeliverableCorpus(fileURLToPath(new URL("../../scripts/fixtures/deliverable-corpus-v1.json", import.meta.url))));
  // Preserve the original two-case comparison tests as an explicit historical subset.
  corpus.cases = corpus.cases.slice(0, 2); corpus.manifest.cases = corpus.manifest.cases.slice(0, 2);
  corpus.corpusSha256 = deliverableSha256(canonical(corpus.manifest));
  const inventory = { version: 1, capturedAt: "2026-10-09T10:00:00.000Z", source: "public-github-open-issue-list",
    issues: [230, 238, 217, 331].map(number => ({ number, title: `Public issue ${number}`,
      url: `https://github.com/tang-vu/keryx/issues/${number}` })) };
  const coverage = { version: 1, id: "test-quality-subset", scope: "selected-open-answer-quality-issues",
    inventorySha256: deliverableSha256(canonical(inventory)),
    issues: [{ number: 230, requiredKinds: ["single-page"], caseIds: ["rfc-public-20261009"] },
      { number: 238, requiredKinds: ["single-page"], caseIds: ["mdn-public-20261009"] },
      { number: 217, requiredKinds: ["newest-release"], caseIds: [] },
      { number: 331, requiredKinds: ["single-page"], caseIds: [] }],
    removals: [] as { caseId: string; reason: string; recordedAt: string; previousSuiteSha256: string }[] };
  const inspection = { inspectedAt: "2026-10-10T10:00:00.000Z", inspectorCommit: "a".repeat(40),
    inspectorSourceSha256: "b".repeat(64), runtime: "v24.21.0" };
  return { corpus, inventory, coverage, inspection };
}
function refresh(input: ReturnType<typeof inputs>) {
  for (let index = 0; index < input.corpus.cases.length; index++) {
    const c = input.corpus.cases[index];
    c.sha256 = deliverableSha256(canonical(c.snapshot));
    input.corpus.manifest.cases[index] = { file: c.file, sha256: c.sha256, contract: structuredClone(c.contract) };
  }
  input.corpus.corpusSha256 = deliverableSha256(canonical(input.corpus.manifest));
  input.coverage.inventorySha256 = deliverableSha256(canonical(input.inventory));
}
const policy = { version: 1, id: "fixture-diagnostic-policy", metric: "deterministic-contract-pass-rate",
  allowedDropBasisPoints: 4999, rationale: "Synthetic unit-test comparison only.", evidenceSha256: "c".repeat(64) };

describe("retained scorecard composition", () => {
  it("includes all eight actual public captures, every missing binding and five language denominators", () => {
    const read = (file: string) => JSON.parse(readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8"));
    const result = buildRetainedQualityScorecard({
      corpus: loadDeliverableCorpus(fileURLToPath(new URL("../../scripts/fixtures/deliverable-corpus-v1.json", import.meta.url))),
      inventory: read("../../fixtures/evals/quality/open-issues-20261009.json"),
      coverage: read("../../fixtures/evals/quality/coverage-v1.json"),
      inspection: { ...inputs().inspection, inspectedAt: "2026-10-10T17:00:00.000Z" } });
    expect(result.overall).toEqual({ cases: 8, deterministicPasses: 0, deterministicFailures: 8,
      deterministicPassRate: 0, semanticUnjudged: 8, languageUnjudged: 8, usefulAnswerRate: null });
    expect(result.byLanguage.map(row => [row.language, row.cases])).toEqual([["de", 1], ["en", 3], ["es", 1], ["pt-BR", 1], ["vi", 2]]);
    expect(result.coverage.missingKinds).toEqual([]);
    expect(result.coverage.completeOpenIssueCoverage).toBe(false);
    expect(result.cases.every(row => row.historicalCaptureAllowance === null && !row.deliverableAccepted)).toBe(true);
    expect(result.failures.find(row => row.id === "arxiv-public-20261009")?.failedChecks).toContain("retainedTargetBindings");
    expect(result.cases.find(row => row.id === "nasa-public-20261009")?.checks.sentenceCount.status).toBe("UNJUDGED");
  });
  it.each(["teacher-public-c700-e719b085", "newest-public-c700-76fa4ed9"])(
    "keeps the archived refusal %s bound to its new capture and all missing targets", id => {
      const corpus = loadDeliverableCorpus(fileURLToPath(new URL("../../scripts/fixtures/deliverable-corpus-v1.json", import.meta.url)));
      const c = corpus.cases.find(row => row.snapshot.id === id)!;
      expect(c.snapshot.bindings).toEqual([]);
      expect(c.contract.requiredBindings).toEqual([]);
      expect(c.contract.targets.length).toBeGreaterThan(0);
      expect(c.contract.format).toEqual({});
      expect(c.snapshot.provenance.deployedCommit).toBe("c70006182a4d187b2c8b82f17ce9dc671a4b6c6c");
      expect(c.snapshot.provenance.capturedAt.startsWith("2026-10-10T")).toBe(true);
      const read = (file: string) => JSON.parse(readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8"));
      const result = buildRetainedQualityScorecard({ corpus, inventory: read("../../fixtures/evals/quality/open-issues-20261009.json"),
        coverage: read("../../fixtures/evals/quality/coverage-v1.json"),
        inspection: { ...inputs().inspection, inspectedAt: "2026-10-10T17:00:00.000Z" } });
      const grade = result.cases.find(row => row.id === id)!;
      expect(grade.checks.retainedTargetBindings.status).toBe("FAIL");
      for (const check of ["bulletCount", "wordLimit", "sentenceCount", "language", "requiredFacts"])
        expect(grade.checks[check].status).toBe("UNJUDGED");
      expect(grade.deliverableAccepted).toBe(false);
    });
  it("refuses successor receipt capture metadata dated after the inspection", () => {
    const corpus = structuredClone(loadDeliverableCorpus(fileURLToPath(new URL("../../scripts/fixtures/deliverable-corpus-v1.json", import.meta.url))));
    corpus.cases[2].snapshot.provenance.retainedReceipt!.capturedAt = "2027-01-01T00:00:00.000Z";
    const c = corpus.cases[2]; c.sha256 = deliverableSha256(canonical(c.snapshot));
    corpus.manifest.cases[2] = { file: c.file, sha256: c.sha256, contract: c.contract };
    corpus.corpusSha256 = deliverableSha256(canonical(corpus.manifest));
    const read = (file: string) => JSON.parse(readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8"));
    expect(() => buildRetainedQualityScorecard({ corpus, inventory: read("../../fixtures/evals/quality/open-issues-20261009.json"),
      coverage: read("../../fixtures/evals/quality/coverage-v1.json"), inspection: inputs().inspection })).toThrow("CAPTURE_AFTER_INSPECTION");
  });
  it("retains both real failures, all denominators and explicit unknown judgments/allowance", () => {
    const result = buildRetainedQualityScorecard(inputs());
    expect(result.overall).toEqual({ cases: 2, deterministicPasses: 0, deterministicFailures: 2,
      deterministicPassRate: 0, semanticUnjudged: 2, languageUnjudged: 2, usefulAnswerRate: null });
    expect(result.byLanguage.map(r => [r.language, r.cases, r.usefulAnswerRate])).toEqual([["en", 1, null], ["pt-BR", 1, null]]);
    expect(result.byKind.find(r => r.kind === "single-page")?.cases).toBe(2);
    expect(result.byKind.filter(r => r.kind !== "single-page").every(r => r.cases === 0 && r.deterministicPassRate === null)).toBe(true);
    expect(result.failures.map(r => r.id)).toEqual(["mdn-public-20261009", "rfc-public-20261009"]);
    expect(result.cases.every(c => !c.deliverableAccepted && c.checks.language.status === "UNJUDGED" && c.checks.requiredFacts.status === "UNJUDGED")).toBe(true);
    expect(result.historicalCaptureAllowance).toBeNull();
    expect(result.inspectionCalls).toEqual({ model: 0, search: 0, payment: 0, database: 0 });
    expect(result.coverage).toMatchObject({ completeOpenIssueCoverage: false, issuesWithoutRetainedCases: [217, 331] });
  });
  it("does not collapse exact requested-language variants or discard failed cases", () => {
    const input = inputs(); input.corpus.cases[1].contract.requestedLanguage = "pt"; refresh(input);
    expect(buildRetainedQualityScorecard(input).byLanguage.map(r => r.language)).toEqual(["pt", "pt-BR"]);
  });
  it("requires the supported Node metadata floor, including Node 22.19 rather than 22.0", () => {
    for (const runtime of ["v22.0.0", "v22.18.9", "v20.19.0", "v23.9.0"]) {
      const input = inputs(); input.inspection.runtime = runtime;
      expect(() => buildRetainedQualityScorecard(input)).toThrow("INVALID_SCORECARD_INPUT");
    }
    for (const runtime of ["v22.19.0", "v22.22.0", "v24.0.0", "v24.21.0"]) {
      const input = inputs(); input.inspection.runtime = runtime;
      expect(buildRetainedQualityScorecard(input).inspection.runtime).toBe(runtime);
    }
  });
  it("refuses changed fixture/manifest bytes and missing cases instead of changing denominators", () => {
    const changed = inputs(); changed.corpus.cases[0].snapshot.answer += " tamper";
    expect(() => buildRetainedQualityScorecard(changed)).toThrow("SCORECARD_CASE_SET_MISMATCH");
    const absent = inputs(); absent.corpus.cases.pop();
    expect(() => buildRetainedQualityScorecard(absent)).toThrow("SCORECARD_CASE_SET_MISMATCH");
    const manifest = inputs(); manifest.corpus.corpusSha256 = "d".repeat(64);
    expect(() => buildRetainedQualityScorecard(manifest)).toThrow("SCORECARD_INPUT_DIGEST_MISMATCH");
  });
  it("refuses duplicate cases, issue identities and self-labelled coverage", () => {
    const duplicate = inputs(); duplicate.corpus.cases.push(duplicate.corpus.cases[0]);
    expect(() => buildRetainedQualityScorecard(duplicate)).toThrow("DUPLICATE_SCORECARD_CASE");
    const issue = inputs(); issue.inventory.issues[0].url = "https://github.com/tang-vu/keryx/issues/999"; refresh(issue);
    expect(() => buildRetainedQualityScorecard(issue)).toThrow("QUALITY_ISSUE_IDENTITY_MISMATCH");
    const fake = inputs(); fake.coverage.issues[2].caseIds.push("mdn-public-20261009");
    expect(() => buildRetainedQualityScorecard(fake)).toThrow("UNBOUND_QUALITY_ISSUE_CASE");
  });
  it("requires every declared case issue in the registry and refuses unknown/duplicate references", () => {
    const missing = inputs(); missing.coverage.issues = missing.coverage.issues.filter(i => i.number !== 238);
    expect(() => buildRetainedQualityScorecard(missing)).toThrow("UNREGISTERED_SCORECARD_CASE");
    const unknown = inputs(); unknown.coverage.issues[0].number = 999;
    expect(() => buildRetainedQualityScorecard(unknown)).toThrow("UNKNOWN_QUALITY_ISSUE");
    const duplicate = inputs(); duplicate.coverage.issues[0].caseIds.push("rfc-public-20261009");
    expect(() => buildRetainedQualityScorecard(duplicate)).toThrow("DUPLICATE_ISSUE_CASE");
  });
  it("refuses extra private/acceptance fields, accessors, cycles and oversized input", () => {
    expect(() => buildRetainedQualityScorecard({ ...inputs(), inspection: { ...inputs().inspection, privateWallet: "hidden" } })).toThrow("INVALID_SCORECARD_INPUT");
    const fields = inputs(); Object.assign(fields.corpus.cases[0].snapshot, { deliverableAccepted: true });
    expect(() => buildRetainedQualityScorecard(fields)).toThrow("INVALID_SCORECARD_INPUT");
    const accessor = inputs(); Object.defineProperty(accessor.coverage, "secret", { enumerable: true, get() { throw new Error("must not execute"); } });
    expect(() => buildRetainedQualityScorecard(accessor)).toThrow("INVALID_SCORECARD_INPUT");
    const cycle = inputs(); Object.assign(cycle.coverage, { cycle: cycle.coverage });
    expect(() => buildRetainedQualityScorecard(cycle)).toThrow("INVALID_SCORECARD_INPUT");
    const large = inputs(); large.inventory.issues[0].title = "a".repeat(1048577);
    expect(() => buildRetainedQualityScorecard(large)).toThrow("INVALID_SCORECARD_INPUT");
  });
  it("refuses future capture/inventory and removals without honest bounded reasons", () => {
    const future = inputs(); future.inspection.inspectedAt = "2026-01-01T00:00:00.000Z";
    expect(() => buildRetainedQualityScorecard(future)).toThrow("INVENTORY_AFTER_INSPECTION");
    const capture = inputs(); capture.corpus.cases[0].snapshot.provenance.capturedAt = "2027-01-01T00:00:00.000Z"; refresh(capture);
    expect(() => buildRetainedQualityScorecard(capture)).toThrow("CAPTURE_AFTER_INSPECTION");
    const removed = inputs(); removed.coverage.removals.push({ caseId: "old-case", reason: " ", recordedAt: removed.inspection.inspectedAt, previousSuiteSha256: "a".repeat(64) });
    expect(() => buildRetainedQualityScorecard(removed)).toThrow("INVALID_SCORECARD_INPUT");
    removed.coverage.removals[0].reason = "A test reason."; removed.coverage.removals[0].caseId = "mdn-public-20261009";
    expect(() => buildRetainedQualityScorecard(removed)).toThrow("INVALID_CASE_REMOVAL");
  });
});

describe("explicit deterministic diagnostic comparison", () => {
  it("does not turn a new inspector commit or absent policy into a release trend", () => {
    const first = inputs(), second = inputs(); second.inspection.inspectorCommit = "c".repeat(40);
    expect(compareRetainedQualityScorecards(first, second)).toMatchObject({ status: "NOT_COMPARABLE", reason: "NO_SUPPLIED_DIAGNOSTIC_POLICY" });
    expect(compareRetainedQualityScorecards(first, second, policy)).toMatchObject({ status: "NOT_COMPARABLE", reason: "SAME_RETAINED_CAPTURES", releaseQualityRegression: "NOT_COMPARABLE" });
  });
  it("refuses undocumented removal and keeps even documented changed suites incomparable", () => {
    const first = inputs(), second = inputs(); second.corpus.cases.pop(); second.corpus.manifest.cases.pop();
    second.coverage.issues[0].caseIds = []; refresh(second);
    expect(() => compareRetainedQualityScorecards(first, second, policy)).toThrow("UNDOCUMENTED_CASE_REMOVAL");
    second.coverage.removals.push({ caseId: "rfc-public-20261009", reason: "Synthetic case-removal test only.",
      recordedAt: second.inspection.inspectedAt, previousSuiteSha256: buildRetainedQualityScorecard(first).suiteDefinitionSha256 });
    expect(compareRetainedQualityScorecards(first, second, policy)).toMatchObject({ status: "NOT_COMPARABLE", reason: "CHANGED_SUITE" });
  });
  it("requires a failing-case removal ledger even when no diagnostic policy is supplied", () => {
    const first = inputs(), second = inputs(); second.corpus.cases.pop(); second.corpus.manifest.cases.pop();
    second.coverage.issues[0].caseIds = []; refresh(second);
    expect(() => compareRetainedQualityScorecards(first, second)).toThrow("UNDOCUMENTED_CASE_REMOVAL");
    second.coverage.removals.push({ caseId: "rfc-public-20261009", reason: "Synthetic no-policy removal regression only.",
      recordedAt: second.inspection.inspectedAt, previousSuiteSha256: "d".repeat(64) });
    expect(() => compareRetainedQualityScorecards(first, second)).toThrow("UNDOCUMENTED_CASE_REMOVAL");
    second.coverage.removals[0].previousSuiteSha256 = buildRetainedQualityScorecard(first).suiteDefinitionSha256;
    expect(compareRetainedQualityScorecards(first, second)).toMatchObject({ status: "NOT_COMPARABLE",
      reason: "NO_SUPPLIED_DIAGNOSTIC_POLICY", releaseQualityRegression: "NOT_COMPARABLE", operationalOrSemanticAcceptance: false });
  });
  it("uses exact count arithmetic at the supplied threshold without semantic promotion", () => {
    const first = inputs(); first.corpus.cases[1].contract.format.maxWhitespaceWords = 300; refresh(first);
    const second = structuredClone(first), c = second.corpus.cases[1];
    const addition = " extra".repeat(10); c.snapshot.answer = addition + c.snapshot.answer;
    c.snapshot.answerSha256 = deliverableSha256(c.snapshot.answer);
    c.snapshot.bulletRegion.end += addition.length;
    c.snapshot.bulletRegion.sha256 = deliverableSha256(c.snapshot.answer.slice(0, c.snapshot.bulletRegion.end));
    c.snapshot.provenance.capturedAt = "2026-10-10T00:00:00.000Z"; refresh(second);
    expect(compareRetainedQualityScorecards(first, second, policy)).toMatchObject({ status: "DETERMINISTIC_DIAGNOSTIC_ONLY", regressionFlagged: true,
      releaseQualityRegression: "NOT_COMPARABLE", operationalOrSemanticAcceptance: false, policyIsOwnerAgreementAttestation: false });
    expect(compareRetainedQualityScorecards(first, second, { ...policy, allowedDropBasisPoints: 5000 })).toMatchObject({ regressionFlagged: false });
    expect(() => compareRetainedQualityScorecards(first, second, { ...policy, allowedDropBasisPoints: -1 })).toThrow("INVALID_SCORECARD_INPUT");
  });
});
