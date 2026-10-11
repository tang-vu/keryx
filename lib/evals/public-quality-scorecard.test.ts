import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { projectPublicQualityScorecard } from "./public-quality-scorecard";
import { frozenPublicQualityScorecards } from "./frozen-public-quality-scorecards";
import { buildRetainedQualityScorecard } from "./retained-quality-scorecard";
import { loadDeliverableCorpus } from "./deliverable-corpus";
import { QualityScorecard } from "../../components/keryx/quality-scorecard";
import { qualityMessages } from "../../locales/en/quality";

vi.mock("@/components/keryx/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/components/keryx/site-footer", () => ({ SiteFooter: () => null }));
import QualityPage, { metadata } from "../../app/quality/page";

const file = (name: string) => fileURLToPath(new URL(`../../fixtures/evals/quality/${name}`, import.meta.url));
const read = (name: string) => JSON.parse(readFileSync(file(name), "utf8"));
const latest = () => read("scorecard-20261010-eight.json");
type MutableArtifact = ReturnType<typeof latest>;

describe("dated public quality projection", () => {
  it("agrees with the existing pure inspector on the real eight-case corpus", () => {
    const recorded = latest();
    const recomputed = buildRetainedQualityScorecard({
      corpus: loadDeliverableCorpus(fileURLToPath(new URL("../../scripts/fixtures/deliverable-corpus-v1.json", import.meta.url))),
      inventory: read("open-issues-20261009.json"), coverage: read("coverage-v1.json"), inspection: recorded.inspection,
    });
    expect(projectPublicQualityScorecard(recomputed)).toEqual(projectPublicQualityScorecard(recorded));
    const card = projectPublicQualityScorecard(recorded);
    expect(card.overall).toEqual({ cases: 8, deterministicPasses: 0, deterministicFailures: 8, deterministicPassRate: 0,
      semanticUnjudged: 8, languageUnjudged: 8, usefulAnswerRate: null });
    expect(card.byKind.map(r => [r.kind, r.cases, r.deterministicFailures])).toEqual([
      ["single-page", 4, 4], ["exact-metadata", 1, 1], ["comparison", 1, 1], ["teaching-note", 1, 1], ["newest-release", 1, 1],
    ]);
    expect(card.byLanguage.map(r => [r.language, r.cases])).toEqual([["de", 1], ["en", 3], ["es", 1], ["pt-BR", 1], ["vi", 2]]);
    expect(card.cases.map(r => r.id)).toEqual(["case-01", "case-02", "case-03", "case-04", "case-05", "case-06", "case-07", "case-08"]);
    expect(card.coverage.issues.filter(r => !r.caseIds.length).map(r => r.number)).toEqual([158, 169, 172, 181]);
    expect(card.coverage.inventoryCapturedAt).toBe("2026-10-09T12:27:34.006Z");
    expect(card.cases[6]).toMatchObject({ capturedAt: "2026-10-10T16:47:32.654Z",
      recordedCommit: "c70006182a4d187b2c8b82f17ce9dc671a4b6c6c", receipt: { capturedAt: "2026-10-10T16:47:33.147Z" } });
  });

  it("pins all four unchanged canonical raw artifacts, including their single LF at EOF", () => {
    const names = ["scorecard-20261010-eight.json", "scorecard-20261010.json", "scorecard-20261009-corrected.json", "scorecard-20261009.json"];
    const snapshots = frozenPublicQualityScorecards();
    expect(snapshots.map(s => s.scorecard.overall.cases)).toEqual([8, 6, 2, 2]);
    snapshots.forEach((snapshot, i) => {
      const bytes = readFileSync(file(names[i]));
      expect(bytes.toString("utf8")).toBe(JSON.stringify(JSON.parse(bytes.toString("utf8")), null, 2) + "\n");
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(snapshot.artifactSha256);
      expect(snapshot.scorecard.releaseQualityRegression).toBe("NOT_COMPARABLE");
      expect(snapshot.scorecard.historicalCaptureAllowance).toBeNull();
      expect(snapshot.scorecard.operationalOrSemanticAcceptance).toBe(false);
      expect(snapshot.scorecard.removals).toEqual([]);
    });
    const original = snapshots[3].scorecard, corrected = snapshots[2].scorecard;
    expect(original.captureFingerprintSha256).toBe(corrected.captureFingerprintSha256);
    expect(original.inspection.inspectedAt).not.toBe(corrected.inspection.inspectedAt);
    expect(original.byKind.filter(r => r.cases === 0).every(r => r.deterministicPassRate === null)).toBe(true);
  });

  it("excludes private text, URLs, run IDs and free-form diagnostics from projection and rendered HTML", () => {
    const source = latest();
    const sentinel = "PRIVATE_QUESTION_ANSWER_WALLET_PERSON_TOKEN_SOURCE_JOURNAL";
    const privateUrl = "https://private.invalid/dispatch/secret-run-identity";
    source.question = source.answer = source.wallet = source.journal = sentinel;
    source.inspection.internalJournal = sentinel;
    source.coverage.issues.forEach((row: Record<string, unknown>) => { row.title = sentinel; row.url = privateUrl; });
    source.removalNotes = sentinel;
    source.cases.forEach((row: MutableArtifact) => {
      row.question = row.answer = row.excerpt = row.wallet = row.person = row.token = row.sourceId = row.runId = sentinel;
      row.provenance.reportUrl = row.provenance.privateUrl = privateUrl;
      Object.values(row.checks).forEach(c => { (c as { detail: string }).detail = sentinel; });
      if (row.provenance.retainedReceipt) row.provenance.retainedReceipt.journal = sentinel;
    });
    const card = projectPublicQualityScorecard(source);
    const serialized = JSON.stringify(card);
    const html = renderToStaticMarkup(createElement(QualityScorecard, { id: "oct10-eight", artifactSha256: "a".repeat(64), scorecard: card }));
    for (const output of [serialized, html]) {
      expect(output).not.toContain(sentinel);
      expect(output).not.toContain(privateUrl);
      expect(output).not.toMatch(/\/dispatch\/|reportUrl|runId|sourceId|questionSha256|internalJournal/);
      expect(output).not.toContain("teacher-public-c700-e719b085");
    }
    expect(card.coverage.issues[0].url).toBe("https://github.com/tang-vu/keryx/issues/128");
    expect(card.cases[0].checks[0]).toEqual({ name: "nonemptyAnswer", status: "PASS" });
  });

  it.each([
    (s: MutableArtifact) => { s.cases[0].id = "unreviewed-private-case"; },
    (s: MutableArtifact) => { s.cases[0].requestedLanguage = "PRIVATE_LANGUAGE"; },
    (s: MutableArtifact) => { s.cases[0].provenance.deployedCommit = "https://private.invalid"; },
    (s: MutableArtifact) => { s.cases[0].checks.language.status = "PASS"; },
    (s: MutableArtifact) => { s.cases[0].checks.requiredFacts.status = "PASS"; },
    (s: MutableArtifact) => { s.cases[0].deterministicContractPassed = true; },
    (s: MutableArtifact) => { s.overall.cases = 7; },
    (s: MutableArtifact) => { s.cases.pop(); },
    (s: MutableArtifact) => { s.cases[1] = s.cases[0]; },
    (s: MutableArtifact) => { s.coverage.issues[0].caseIds = [s.cases[0].id]; },
    (s: MutableArtifact) => { s.historicalCaptureAllowanceStatus = "KNOWN"; s.historicalCaptureAllowance = 0; },
    (s: MutableArtifact) => { s.overall.usefulAnswerRate = 0; },
    (s: MutableArtifact) => { s.removals.push({ caseId: "private", reason: "private reason" }); },
    (s: MutableArtifact) => { s.cases[0].provenance.capturedAt = "2030-01-01T00:00:00.000Z"; },
    (s: MutableArtifact) => { s.cases[2].provenance.retainedReceipt.capturedAt = "2030-01-01T00:00:00.000Z"; },
  ])("refuses unreviewed publication or contradictory evidence without echoing values", mutate => {
    const source = latest(); mutate(source);
    expect(() => projectPublicQualityScorecard(source)).toThrow("INVALID_PUBLIC_SCORECARD");
  });

  it("renders the real route with separately dated archives and honest metadata", () => {
    const html = renderToStaticMarkup(createElement(QualityPage));
    expect(html).toContain(qualityMessages.introduction);
    expect(html).toContain(qualityMessages.trend);
    expect(html.includes(qualityMessages.coverageLimit.replaceAll("'", "&#x27;"))).toBe(true);
    expect(html).toContain("2026-10-10T16:59:22.754Z");
    expect(html).toContain("2026-10-09T12:33:38.255Z");
    expect(html).toContain("UNKNOWN");
    expect(html).toContain("UNJUDGED");
    expect(html).toContain("https://github.com/tang-vu/keryx/issues/287");
    expect(html).not.toMatch(/\/dispatch\/|mdn-public-20261009|76fa4ed9|6c41b95d-7877/);
    expect(metadata.alternates).toEqual({ canonical: "/quality", languages: { "x-default": "/quality", en: "/quality" } });
    expect(JSON.stringify(metadata)).not.toMatch(/\/dispatch\/|case-01|UNKNOWN_PRIVATE/);
  });

  it("refuses oversized, cyclic and accessor inputs without executing private hooks", () => {
    const accessor = latest();
    const getter = vi.fn(() => { throw new Error("PRIVATE_GETTER_TEXT"); });
    Object.defineProperty(accessor, "privateQuestion", { enumerable: true, get: getter });
    const cycle = latest(); cycle.journal = cycle;
    const oversized = latest(); oversized.question = "q".repeat(1048577);
    for (const input of [accessor, cycle, oversized]) {
      expect(() => projectPublicQualityScorecard(input)).toThrow("INVALID_PUBLIC_SCORECARD");
    }
    expect(getter).not.toHaveBeenCalled();
  });
});
