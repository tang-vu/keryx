import { describe, expect, it } from "vitest";
import { buildEvidenceDraft, evidenceDraftReportSchema, parseEvidenceDraftRequest } from "./evidence-draft";
import { exportEvidenceDraft } from "./evidence-draft-export";
import { evidenceDraftFixture } from "./fixtures/evidence-draft";
import type { PdfTextScope } from "../web-research/pdf-text-scope";

const partial: PdfTextScope = { format: "keryx-pdf-text-scope-v1", pagesRead: 20, totalPages: 35, pagesWithoutText: [], textLimitReached: false };
function scoped(scope: PdfTextScope = partial) {
  const input = evidenceDraftFixture();
  for (const row of [input.reports[0].citations[0], input.reports[0].evidence![0]])
    row.webProvenance = { extraction: "pdf", pdfTextScope: structuredClone(scope) };
  const excerpt = buildEvidenceDraft(input).excerpts[0];
  input.themes[0].excerptIds = [excerpt.id]; input.claims[0].excerptIds = [excerpt.id];
  return input;
}
function unselect(input: ReturnType<typeof scoped>) { input.themes[0].excerptIds = []; input.claims[0].excerptIds = []; return input; }

describe("recorded PDF text scope in private drafts", () => {
  it("keeps matched scope through portable restore, selected excerpts and both text exports", () => {
    const input = scoped(), original = structuredClone(input), restored = parseEvidenceDraftRequest(JSON.parse(JSON.stringify(input)));
    const draft = buildEvidenceDraft(restored), exported = exportEvidenceDraft(restored);
    expect(draft.excerpts[0].pdfTextScope).toEqual(partial); expect(draft.claims[0].status).toBe("assessment-pending");
    expect(draft.origin).toBe("caller-supplied-report"); expect(exported.referenceCount).toBe(1);
    for (const text of [exported.markdown, exported.latex]) {
      expect(text).toContain("20 of 35 pages"); expect(text).toContain("page or character limit");
      expect(text).toContain("images and figures were not interpreted");
    }
    expect(input).toEqual(original);
  });
  it.each([
    { ...partial, pagesRead: 3, totalPages: 3, pagesWithoutText: [2] },
    { ...partial, pagesRead: 1, totalPages: 1, textLimitReached: true },
  ])("retains distinct image-gap and character-bound observations: %j", scope => {
    const input = scoped(scope), exported = exportEvidenceDraft(input);
    expect(buildEvidenceDraft(input).excerpts[0].pdfTextScope).toEqual(scope);
    expect(exported.markdown).toContain(`${scope.pagesRead} of ${scope.totalPages} pages`);
    if (scope.pagesWithoutText.length) {
      expect(exported.markdown).toContain("visited pages 2"); expect(exported.markdown).toContain("did not perform OCR");
      expect(exported.markdown).not.toContain("page or character limit stopped");
    } else expect(exported.markdown).toContain("page or character limit stopped");
  });
  it.each(["citation-missing", "evidence-missing", "conflicting", "wrong-kind", "malformed", "contradictory-truncation"] as const)("keeps quotations without inventing page bounds for %s metadata", change => {
    const input = unselect(scoped()), citation = input.reports[0].citations[0], evidence = input.reports[0].evidence![0];
    if (change === "citation-missing") delete citation.webProvenance;
    if (change === "evidence-missing") delete evidence.webProvenance;
    if (change === "conflicting") citation.webProvenance!.pdfTextScope.totalPages = 40;
    if (change === "wrong-kind") Object.assign(citation, { webProvenance: { extraction: "html", pdfTextScope: partial } });
    if (change === "malformed") Object.assign(evidence, { webProvenance: { extraction: "pdf", pdfTextScope: { ...partial, pagesWithoutText: [21] } } });
    if (change === "contradictory-truncation") Object.assign(evidence, { webProvenance: { ...evidence.webProvenance, truncated: false } });
    const draft = buildEvidenceDraft(input);
    expect(draft.excerpts).toHaveLength(1); expect(draft.excerpts[0]).not.toHaveProperty("pdfTextScope");
    expect(draft.excerpts[0].id).toBe(buildEvidenceDraft(evidenceDraftFixture()).excerpts[0].id);
  });
  it("keeps legacy identities and never derives page counts from titles or URLs", () => {
    const input = evidenceDraftFixture(), before = buildEvidenceDraft(input).excerpts;
    input.reports[0].citations[0].itemTitle = "PDF20/35 pages"; input.reports[0].evidence![0].itemTitle = "PDF20/35 pages";
    for (const row of [input.reports[0].citations[0], input.reports[0].evidence![0]]) Object.assign(row, { webProvenance: { extraction: "pdf", truncated: true } });
    expect(buildEvidenceDraft(input).excerpts).toEqual(before);
  });
  it("keeps a quotation selected when only its recorded scope changes", () => {
    const input = scoped(), id = buildEvidenceDraft(input).excerpts[0].id;
    for (const row of [input.reports[0].citations[0], input.reports[0].evidence![0]]) row.webProvenance!.pdfTextScope.pagesRead = 19;
    const draft = buildEvidenceDraft(input);
    expect(draft.excerpts[0].id).toBe(id); expect(draft.themes[0].excerpts[0].pdfTextScope?.pagesRead).toBe(19);
    expect(draft.claims[0].excerpts[0].id).toBe(id);
  });
  it("restores legacy selections while making a legacy assessment stale when optional scope becomes available", () => {
    const input = evidenceDraftFixture(), excerpt = buildEvidenceDraft(input).excerpts[0], claim = input.claims[0];
    input.themes[0].excerptIds = [excerpt.id]; claim.excerptIds = [excerpt.id];
    claim.assessment = { origin: "user-assessment", reviewer: "QA author", reviewedAt: "2026-10-23T00:00:00.000Z", verdict: "supported",
      claimText: input.passage, paperUrls: [...claim.paperUrls], excerptIds: [...claim.excerptIds], excerpts: [structuredClone(excerpt)] };
    expect(buildEvidenceDraft(input).claims[0].status).toBe("user-assessed");
    for (const row of [input.reports[0].citations[0], input.reports[0].evidence![0]]) row.webProvenance = { extraction: "pdf", pdfTextScope: structuredClone(partial) };
    const restored = buildEvidenceDraft(JSON.parse(JSON.stringify(input)));
    expect(restored.themes[0].excerpts[0].id).toBe(excerpt.id); expect(restored.excerpts[0].pdfTextScope).toEqual(partial);
    expect(restored.claims[0].status).toBe("assessment-pending"); expect(restored.claims[0].assessmentStale).toBe(true);
  });
  it.each(["same", "missing", "conflicting"] as const)("merges repeated quotation context with %s PDF metadata", change => {
    const input = scoped(), original = input.reports[0].evidence![0], repeated = structuredClone(original);
    input.reports[0].subClaims.push("A second unverified target"); repeated.claimIndex = 1; repeated.claim = input.reports[0].subClaims[1];
    if (change === "missing") delete repeated.webProvenance;
    else if (change === "conflicting") repeated.webProvenance!.pdfTextScope.totalPages = 40;
    input.reports[0].evidence!.push(repeated);
    const draft = buildEvidenceDraft(input);
    expect(draft.excerpts).toHaveLength(1);
    if (change === "same") expect(draft.excerpts[0].pdfTextScope).toEqual(partial);
    else expect(draft.excerpts[0]).not.toHaveProperty("pdfTextScope");
    expect(draft.themes[0].excerpts[0].id).toBe(input.themes[0].excerptIds[0]);
  });
  it("binds manual assessments to the exact retained scope as well as the quote", () => {
    const input = scoped(), draft = buildEvidenceDraft(input), claim = input.claims[0];
    claim.assessment = { origin: "user-assessment", reviewer: "QA author", reviewedAt: "2026-10-23T00:00:00.000Z", verdict: "supported",
      claimText: input.passage, paperUrls: [...claim.paperUrls], excerptIds: [...claim.excerptIds], excerpts: structuredClone(draft.excerpts) };
    expect(buildEvidenceDraft(input).claims[0].status).toBe("user-assessed");
    claim.assessment.excerpts[0].pdfTextScope!.pagesRead = 19;
    const changed = buildEvidenceDraft(input).claims[0]; expect(changed.status).toBe("assessment-pending"); expect(changed.assessmentStale).toBe(true);
  });
  it("does not inspect getters inside unknown report annotations", () => {
    const report = evidenceDraftFixture().reports[0]; let called = false;
    Object.assign(report.citations[0], { webProvenance: { get extraction() { called = true; throw Error("Getter must remain unread"); } } });
    expect(() => evidenceDraftReportSchema.parse(report)).not.toThrow(); expect(called).toBe(false);
  });
});
