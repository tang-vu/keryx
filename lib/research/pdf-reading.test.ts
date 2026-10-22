import { describe, expect, it } from "vitest";
import { pdfReadingNotice } from "./pdf-reading";
import { gatheredArticle } from "../web-research/article-reader";

const scope = { format: "keryx-pdf-text-scope-v1" as const, pagesRead: 3, totalPages: 5, pagesWithoutText: [2], textLimitReached: false };

describe("PDF read-scope presentation", () => {
  it("distinguishes no extracted text from a factual negative or a completed OCR operation", () => {
    const text = pdfReadingNotice(scope);
    expect(text).toContain("visited 3 of 5 pages"); expect(text).toContain("visited pages 2");
    expect(text).toContain("may be scanned, blank"); expect(text).toContain("page or character limit");
    expect(text).toContain("Only the available PDF text layer was read");
    expect(text).toContain("images and figures were not interpreted");
    expect(text).toContain("same original version"); expect(text).toContain("did not perform OCR");
    expect(text).not.toMatch(/proves|no evidence|claim is false|\[S\d+\]/);
  });
  it("preserves a text-only boundary even when every page yielded text, without inventing a limit", () => {
    const text = pdfReadingNotice({ ...scope, totalPages: 3, pagesWithoutText: [] });
    expect(text).toContain("visited 3 of 3 pages"); expect(text).toContain("images and figures were not interpreted");
    expect(text).not.toMatch(/No text was extracted|limit stopped|OCR/);
    expect(pdfReadingNotice(undefined)).toBe(""); expect(pdfReadingNotice({ pagesRead: 3 })).toBe("");
  });
  it("provides the same observed counts and conditional recovery in Vietnamese", () => {
    const text = pdfReadingNotice(scope, true);
    expect(text).toContain("3/5 trang PDF"); expect(text).toContain("trang đã thử đọc: 2");
    expect(text).toContain("có thể là bản scan, trang trắng"); expect(text).toContain("chưa thực hiện OCR");
    expect(text).not.toContain("PDF text extraction visited");
  });
  it("retains actual PDF metadata and bounds in gathered identity while leaving historical and HTML identity unchanged", () => {
    const base = { text: "Observed original text.", title: "Original", finalUrl: "https://example.org/paper.pdf", kind: "pdf" as const, truncated: false };
    const result = gatheredArticle("public:pdf", { ...base, pdfTextScope: scope });
    expect(result.text).toBe(base.text); expect(result.webProvenance).toMatchObject({ extraction: "pdf", truncated: true, pdfTextScope: scope });
    expect(gatheredArticle("public:old", base).webProvenance).not.toHaveProperty("pdfTextScope");
    expect(gatheredArticle("public:html", { ...base, kind: "html", pdfTextScope: scope }).webProvenance).not.toHaveProperty("pdfTextScope");
    expect(gatheredArticle("public:bad", { ...base, pdfTextScope: {} as never }).webProvenance).not.toHaveProperty("pdfTextScope");
  });
});
