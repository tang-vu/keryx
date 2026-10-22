import { describe, expect, it, vi } from "vitest";
import { workloadPdfArticle } from "./workload-pdf-article";
import { gatheredArticle } from "../web-research/article-reader";
import { executeResearchWorkload, workloadSnapshotHash } from "./research-workload";
import { HeuristicEngine } from "../llm/heuristic-engine";
import type { PdfExtraction } from "../web-research/pdf-reader";
import type { InternalResearchInput } from "./internal-research-input-types";

const result: PdfExtraction = { text: "This is a controlled retained paragraph for scope validation.", pagesRead: 20, totalPages: 35,
  pagesWithoutText: [3], textLimitReached: false, truncated: true };
const url = "https://r99-source-1.workload.invalid/document";
describe("workload PDF capture parity", () => {
  it("retains the observed bounded page scope in production gathered provenance", () => {
    const extraction = structuredClone(result), article = workloadPdfArticle(extraction, "QA PDF", url), gathered = gatheredArticle("qa", article);
    expect(gathered.webProvenance?.pdfTextScope).toEqual({ format: "keryx-pdf-text-scope-v1", pagesRead: 20, totalPages: 35,
      pagesWithoutText: [3], textLimitReached: false });
    expect(gathered.webProvenance?.truncated).toBe(true); expect(article.text).toBe(extraction.text);
    extraction.pagesWithoutText.push(4); expect(article.pdfTextScope?.pagesWithoutText).toEqual([3]);
  });
  it("keeps textless-page gaps separate from truncation", () => {
    const article = workloadPdfArticle({ ...result, pagesRead: 3, totalPages: 3, pagesWithoutText: [2], truncated: false }, "QA PDF", url);
    expect(gatheredArticle("qa", article).webProvenance?.truncated).toBe(false);
    expect(article.pdfTextScope?.pagesWithoutText).toEqual([2]);
  });
  it("retains a character cutoff even when every page was visited", () => {
    const article = workloadPdfArticle({ ...result, pagesRead: 1, totalPages: 1, pagesWithoutText: [], textLimitReached: true }, "QA PDF", url);
    expect(gatheredArticle("qa", article).webProvenance?.pdfTextScope?.textLimitReached).toBe(true);
  });
  it("refuses a changed capture scope before reasoning", async () => {
    const article = workloadPdfArticle(result, "QA PDF", url), snapshotSha256 = workloadSnapshotHash(article);
    article.pdfTextScope!.totalPages = 36;
    const input: InternalResearchInput = { id: "R99", inputKind: "synthetic", question: "What was readable?", targets: [],
      sources: [{ title: "QA PDF" }], expectedArtifact: "Scope", review: [] };
    const engine = new HeuristicEngine(), decompose = vi.spyOn(engine, "decompose");
    await expect(executeResearchWorkload(input, [{ url, title: "QA PDF", observedAt: "2026-10-23T00:00:00.000Z", provenance: "synthetic", article, snapshotSha256 }], engine)).rejects.toThrow("snapshot integrity");
    expect(decompose).not.toHaveBeenCalled();
  });
});
