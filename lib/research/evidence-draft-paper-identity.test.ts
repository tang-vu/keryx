import { describe, expect, it } from "vitest";
import { buildEvidenceDraft, parseEvidenceDraftRequest } from "./evidence-draft";
import { exportEvidenceDraft } from "./evidence-draft-export";
import { evidenceDraftTool } from "./evidence-draft-tool";
import { evidenceDraftFixture } from "./fixtures/evidence-draft";
import { SEED_EVIDENCE_FINGERPRINTS } from "./seed-evidence-fingerprints";

function pdfRead(suffix = "") {
  const input = evidenceDraftFixture();
  const readUrl = input.workspace.entries[0].paper.url.replace("/abs/", "/pdf/") + suffix;
  input.reports[0].citations[0].itemUrl = readUrl;
  input.reports[0].evidence![0].itemUrl = readUrl;
  return { input, readUrl };
}

describe("same-version arXiv retained evidence", () => {
  it.each(["", ".pdf"])("reuses a versioned PDF%s read under its saved landing record", suffix => {
    const { input, readUrl } = pdfRead(suffix);
    const before = structuredClone(input), draft = buildEvidenceDraft(input);
    expect(draft.excerpts).toHaveLength(1);
    expect(draft.excerpts[0]).toMatchObject({ paperUrl: input.workspace.entries[0].paper.url,
      readUrl, quote: input.reports[0].evidence![0].quote,
      contentVersion: input.reports[0].evidence![0].contentVersion });
    expect(draft.reading.unknown).toEqual([]);
    expect(draft.claims[0].status).toBe("assessment-pending");
    expect(input).toEqual(before);
  });

  it("assembles and exports PDF excerpts with one matching bibliography record and the original read URL", () => {
    const { input, readUrl } = pdfRead();
    input.assembly = { mode: "append" };
    const result = evidenceDraftTool({ draft: input });
    expect("structuredContent" in result).toBe(true);
    if (!("structuredContent" in result)) return;
    expect(result.structuredContent!.draft.excerpts).toHaveLength(1);
    const outputs = exportEvidenceDraft(input);
    expect(outputs.referenceCount).toBe(1);
    expect(outputs.markdown).toContain(input.reports[0].evidence![0].quote);
    expect(outputs.markdown).toContain(`[retained read](<${readUrl}>)`);
    expect(outputs.latex).toContain(`Retained read URL: ${readUrl}`);
    expect(outputs.ris).toContain(`UR  - ${input.workspace.entries[0].paper.url}`);
    expect(outputs.bibtex).toContain(input.workspace.entries[0].paper.url);
  });

  it("still requires literal citation and evidence read URLs to agree", () => {
    const { input } = pdfRead();
    input.reports[0].citations[0].itemUrl = input.workspace.entries[0].paper.url;
    expect(buildEvidenceDraft(input).excerpts).toEqual([]);
  });

  it.each(["source", "item", "content-version", "marker", "duplicate-marker", "unqualified", "synthetic", "seed"])("keeps the existing %s exclusion for mapped PDF evidence", mutation => {
    const { input } = pdfRead(), report = input.reports[0], row = report.evidence![0];
    if (mutation === "source") row.sourceId = "another-source";
    if (mutation === "item") row.itemId = "another-item";
    if (mutation === "content-version") row.contentVersion = "changed-body";
    if (mutation === "marker") row.marker = "S2";
    if (mutation === "duplicate-marker") report.citations.push({ ...report.citations[0] });
    if (mutation === "unqualified") row.qualifiesForAnswer = false;
    if (mutation === "synthetic") row.evidenceProvenance = "synthetic-demo";
    if (mutation === "seed") {
      const fingerprint = SEED_EVIDENCE_FINGERPRINTS[0];
      report.evidence!.push({ ...row, itemTitle: fingerprint.itemTitle, itemUrl: fingerprint.itemUrl,
        contentReceipt: { bodyHash: fingerprint.bodyHash } });
    }
    expect(buildEvidenceDraft(input).excerpts).toEqual([]);
  });

  it.each(["unversioned", "other-version", "query", "fragment", "other-host", "html"])("withholds %s PDF substitutions", mutation => {
    const { input, readUrl } = pdfRead();
    const changed = mutation === "unversioned" ? readUrl.replace(/v\d+$/, "")
      : mutation === "other-version" ? readUrl.replace(/v\d+$/, "v99")
      : mutation === "query" ? `${readUrl}?download=1`
      : mutation === "fragment" ? `${readUrl}#page=2`
      : mutation === "other-host" ? readUrl.replace("arxiv.org", "example.org")
      : readUrl.replace("/pdf/", "/html/");
    input.reports[0].citations[0].itemUrl = changed;
    input.reports[0].evidence![0].itemUrl = changed;
    const draft = buildEvidenceDraft(input);
    expect(draft.excerpts).toEqual([]);
    expect(draft.claims[0].status).toBe("source-unavailable");
  });

  it("invalidates an assessment when the original PDF URL changes, even within the same paper version", () => {
    const { input } = pdfRead();
    const excerpt = buildEvidenceDraft(input).excerpts[0];
    expect(excerpt).toBeDefined();
    input.claims[0].excerptIds = [excerpt.id];
    input.claims[0].assessment = { origin: "user-assessment", reviewer: "Reader", reviewedAt: "2026-10-21T00:00:00.000Z",
      verdict: "partly-supported", claimText: input.passage, paperUrls: [...input.claims[0].paperUrls],
      excerptIds: [excerpt.id], excerpts: [excerpt] };
    expect(buildEvidenceDraft(input).claims[0].status).toBe("user-assessed");
    const saved = parseEvidenceDraftRequest(JSON.parse(JSON.stringify(input)));
    expect(buildEvidenceDraft(saved).claims[0].status).toBe("user-assessed");
    for (const row of [...input.reports[0].citations, ...input.reports[0].evidence!]) row.itemUrl += ".pdf";
    expect(() => buildEvidenceDraft(input)).toThrow("unavailable or changed");
  });

  it("preserves the original direct-URL excerpt shape and its assessment contract", () => {
    const input = evidenceDraftFixture(), excerpt = buildEvidenceDraft(input).excerpts[0];
    expect(excerpt).not.toHaveProperty("readUrl");
    expect(excerpt.id).toBe("excerptd28e89c978a6a61b");
    expect(Object.keys(excerpt)).toEqual(["id", "reportId", "paperUrl", "contentVersion", "quote"]);
  });
});
