import { describe, expect, it } from "vitest";
import type { EvidenceRecord } from "../types";
import { buildEvidenceMatrix, evidenceMatrixCsv, type EvidenceMatrixInput } from "./evidence-matrix";
import { evidenceMatrixMarkdown } from "./evidence-matrix-markdown";
import { evidenceReadScope } from "./evidence-matrix-read-scope";

const base = { retrievedAt: "2026-10-24T10:00:00Z", publisherGroup: "docs.example", normalizedBodyHash: "b".repeat(64),
  extraction: "html" as const, truncated: false };
const section = { format: "keryx-html-section-scope-v1" as const, fragment: "memory-lifetime", headingLevel: 3,
  htmlStart: 70_000, htmlEnd: 75_000, documentCharacters: 100_000, documentSha256: "a".repeat(64) };
const pdf = { format: "keryx-pdf-text-scope-v1" as const, pagesRead: 3, totalPages: 10, pagesWithoutText: [2], textLimitReached: false };

function fixture(webProvenance?: EvidenceRecord["webProvenance"]): EvidenceMatrixInput {
  const identity = { marker: "S1", sourceId: "docs", sourceName: "Documentation", itemId: "api", itemUrl: "https://docs.example/api?v=2", contentVersion: "v2" };
  return { subClaims: ["Memory lifetime?", "Compatibility?"], citations: [{ ...identity, weight: 1, reward: 0, rationale: "" }],
    evidence: [{ ...identity, claimIndex: 0, claim: "Memory lifetime?", quote: 'Exact "excerpt".\n第二行', support: 0.8,
      qualifiesForAnswer: true, qualifiesForReward: false, webProvenance }] };
}

/** Parse the fully quoted exported cells, including quoted commas and newlines. */
function csvRecords(run: EvidenceMatrixInput) {
  const cells = [...evidenceMatrixCsv(run).matchAll(/"((?:[^"]|"")*)"(,|\r\n)/g)];
  const width = cells.findIndex(cell => cell[2] === "\r\n") + 1;
  expect(cells.length % width).toBe(0);
  const names = cells.slice(0, width).map(cell => cell[1]);
  const records: Record<string, string>[] = [];
  for (let index = width; index < cells.length; index += width) {
    expect(cells[index + width - 1][2]).toBe("\r\n");
    records.push(Object.fromEntries(cells.slice(index, index + width).map((cell, column) => [names[column], cell[1].replaceAll('""', '"')])));
  }
  return records;
}

describe("portable evidence read scope", () => {
  it("keeps a late HTML heading's exact fragment, original bounds and digest in both exports", () => {
    const run = fixture({ ...base, htmlSectionScope: section }), before = JSON.stringify(run);
    const [record, gap] = csvRecords(run), markdown = evidenceMatrixMarkdown(run);
    expect(record.read_scope).toBe("HTML heading section only; whole-document coverage not established");
    expect(JSON.parse(record.html_section_scope)).toEqual(section);
    expect(record.extraction).toBe("html");
    expect(record.retrieved_at).toBe(base.retrievedAt);
    expect(record.normalized_body_sha256).toBe(base.normalizedBodyHash);
    expect(record.extracted_text_truncated).toBe("false");
    expect(record.exact_excerpt).toBe(run.evidence![0].quote);
    expect(markdown).toContain(JSON.stringify(section));
    expect(markdown).toContain("UTF-16 HTML offsets");
    expect(markdown).toContain(base.normalizedBodyHash);
    expect(markdown).toContain(base.retrievedAt);
    expect(gap.inspection_status).toBe("No inspectable excerpt recorded");
    expect(gap.read_scope).toBe("");
    expect(JSON.stringify(run)).toBe(before);
  });

  it.each([pdf, { ...pdf, pagesRead: 10, pagesWithoutText: [], textLimitReached: true },
    { ...pdf, totalPages: 3, textLimitReached: false }])("retains PDF text boundaries and textless pages: %j", scope => {
    const run = fixture({ ...base, extraction: "pdf", truncated: scope.pagesRead < scope.totalPages || scope.textLimitReached, pdfTextScope: scope });
    const [record] = csvRecords(run);
    expect(JSON.parse(record.pdf_text_scope)).toEqual(scope);
    expect(record.html_section_scope).toBe("");
    expect(record.read_scope).toBe("PDF text extraction only; images and OCR not established");
    expect(evidenceMatrixMarkdown(run)).toContain(JSON.stringify(scope));
  });

  it("does not infer image/OCR coverage even when all PDF text pages were visited", () => {
    const run = fixture({ ...base, extraction: "pdf", pdfTextScope: { ...pdf, totalPages: 3, pagesWithoutText: [] } });
    expect(csvRecords(run)[0].read_scope).toContain("images and OCR not established");
    expect(evidenceMatrixMarkdown(run)).toContain("An unclipped extraction does not prove that the whole document, images or OCR were read.");
  });

  it.each([undefined, { ...base, extraction: "pdf" as const }, base])("keeps old missing detail unknown: %j", provenance => {
    const run = fixture(provenance), [record] = csvRecords(run);
    expect(record.pdf_text_scope).toBe("");
    expect(record.html_section_scope).toBe("");
    expect(record.read_scope).toBe(provenance ? "Extracted text only; detailed read scope not recorded" : "Not recorded");
    expect(evidenceMatrixMarkdown(run)).toContain("Missing historical scope remains unknown.");
  });

  it.each([
    { ...base, htmlSectionScope: { ...section, htmlEnd: 120_000 } },
    { ...base, extraction: "text", htmlSectionScope: section },
    { ...base, extraction: "pdf", truncated: false, pdfTextScope: pdf },
    { ...base, pdfTextScope: pdf, htmlSectionScope: section },
    { ...base, extraction: "pdf", pdfTextScope: { ...pdf, pagesWithoutText: [3, 2] } },
  ])("refuses malformed or conflicting detail while retaining the excerpt: %j", provenance => {
    const run = fixture(provenance as EvidenceRecord["webProvenance"]), [record] = csvRecords(run);
    expect(record.read_scope).toBe("Invalid or conflicting read-scope metadata");
    expect(record.pdf_text_scope).toBe("");
    expect(record.html_section_scope).toBe("");
    expect(record.exact_excerpt).toBe(run.evidence![0].quote);
    expect(evidenceMatrixMarkdown(run)).not.toContain('"htmlStart"');
  });

  it("does not borrow missing excerpt metadata from another citation or content version", () => {
    const run = fixture();
    run.citations[0].webProvenance = { ...base, htmlSectionScope: section };
    expect(csvRecords(run)[0].read_scope).toBe("Not recorded");
    run.evidence![0].contentVersion = "v1";
    expect(buildEvidenceMatrix(run)[0].evidence).toEqual([]);
    expect(evidenceMatrixMarkdown(run)).not.toContain(JSON.stringify(section));
  });

  it("serializes only approved provenance fields and keeps hostile values literal", () => {
    const provenance = { ...base, retrievedAt: "=HYPERLINK(\"bad\")\n```\n# Spoof", htmlSectionScope: { ...section, fragment: "```#spoof" }, privateToken: "MUST_NOT_EXPORT" };
    const run = fixture(provenance), [record] = csvRecords(run), markdown = evidenceMatrixMarkdown(run);
    expect(record.retrieved_at).toBe("'" + provenance.retrievedAt);
    expect(JSON.parse(record.html_section_scope).fragment).toBe("```#spoof");
    expect(markdown).toContain("Retrieved at:\n\n````\n" + provenance.retrievedAt + "\n````");
    expect(markdown).not.toContain("MUST_NOT_EXPORT");
    expect(evidenceMatrixCsv(run)).not.toContain("MUST_NOT_EXPORT");
  });

  it("refuses metadata accessors without executing them", () => {
    let reads = 0;
    const provenance = { ...base };
    Object.defineProperty(provenance, "htmlSectionScope", { get() { reads++; throw Error("Unexpected getter"); } });
    expect(evidenceReadScope({ webProvenance: provenance }).read_scope).toBe("Not recorded");
    expect(reads).toBe(0);
  });
});
