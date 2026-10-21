import { describe, expect, it } from "vitest";
import { PAPER_CATALOG } from "../papers/catalog";
import type { PaperRecord } from "../papers/types";
import { retainedPaperRecordUrl } from "./retained-paper-identity";

const paper = (id: string): PaperRecord => ({ ...PAPER_CATALOG[0], repository: "arxiv", arxivId: id,
  url: `https://arxiv.org/abs/${id}`, metadataUrl: `https://arxiv.org/abs/${id}` });

describe("retained read bibliography identity", () => {
  it.each(["1706.03762v7", "0706.0001v2", "hep-th/9901001v1", "cs.AI/0601001v3"])("maps only the explicit %s PDF version", id => {
    const record = paper(id);
    expect(retainedPaperRecordUrl(`https://arxiv.org/pdf/${id}`, [record])).toBe(record.url);
    expect(retainedPaperRecordUrl(`https://arxiv.org/pdf/${id}.pdf`, [record])).toBe(record.url);
  });

  it.each([
    "https://arxiv.org/pdf/1706.03762", "https://arxiv.org/pdf/1706.03762v6",
    "https://arxiv.org/pdf/1706.03762v7?download=1", "https://arxiv.org/pdf/1706.03762v7#page=2",
    "https://arxiv.org/pdf/1706.03762v7/", "https://arxiv.org/html/1706.03762v7",
    "https://export.arxiv.org/pdf/1706.03762v7", "https://example.org/pdf/1706.03762v7",
    "https://arxiv.org@evil.example/pdf/1706.03762v7", "https://user@arxiv.org/pdf/1706.03762v7",
    "https://arxiv.org:443/pdf/1706.03762v7", "http://arxiv.org/pdf/1706.03762v7",
    "https://arxiv.org/abs/1706.03762v7?pdf=1", "https://arxiv.org/pdf/1706.03762v7.PDF",
    "https://arxiv.org/pdf/1706.03762v7/../1706.03762v7", "https://arxiv.org/pdf/%31%37%30%36.03762v7",
  ])("does not substitute %s for a saved exact record", url => {
    expect(retainedPaperRecordUrl(url, [paper("1706.03762v7")])).toBeUndefined();
  });

  it("keeps distinct saved versions distinct and never infers identity from titles or links", () => {
    const older = paper("1706.03762v6"), current = paper("1706.03762v7");
    older.title = current.title;
    older.links = [{ label: "PDF", url: "https://arxiv.org/pdf/1706.03762v7" }];
    expect(retainedPaperRecordUrl("https://arxiv.org/pdf/1706.03762v7", [older])).toBeUndefined();
    expect(retainedPaperRecordUrl("https://arxiv.org/pdf/1706.03762v7", [older, current])).toBe(current.url);
    expect(retainedPaperRecordUrl("https://arxiv.org/pdf/1706.03762v7", [])).toBeUndefined();
  });

  it("preserves exact matching for other repositories", () => {
    const record = PAPER_CATALOG.find(paper => paper.repository !== "arxiv")!;
    expect(record).toBeDefined();
    expect(retainedPaperRecordUrl(record.url, [record])).toBe(record.url);
    expect(retainedPaperRecordUrl(`${record.url}/pdf`, [record])).toBeUndefined();
  });
});
