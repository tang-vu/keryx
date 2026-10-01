import { describe, expect, it, vi } from "vitest";
import { normalizeDoi, questionDois } from "./doi";
import { crossrefLookup, crossrefRecord } from "./crossref";
import { parseArxiv, arxivSearch } from "./arxiv";
import { discoverScholarly } from "./discovery";

const time = "2026-10-01T00:00:00Z";
const work = { DOI: "10.1234/exact", title: ["Measured <i>result</i>"], type: "journal-article", author: [{ given: "Ada", family: "Lovelace" }, { name: "Research Group" }],
  "container-title": ["Test Journal"], published: { "date-parts": [[2026, 2, 28]] }, volume: "2", issue: "1", page: "3-9" };
const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
<title>arXiv query</title><entry><id>http://arxiv.org/abs/1706.03762v7</id><title>Attention Is All You Need</title>
<published>2017-06-12T17:57:34Z</published><author><name>Ashish Vaswani</name></author><author><name>Noam Shazeer</name></author>
<summary>This is a search preview, not paper evidence.</summary><arxiv:doi>10.1234/exact</arxiv:doi></entry></feed>`;

describe("scholarly discovery boundaries", () => {
  it("normalizes exact DOI syntax and conserves balanced suffix parentheses in prose", () => {
    expect(normalizeDoi("https://doi.org/10.1234/A%28B%29")).toBe("10.1234/a(b)");
    expect(questionDois("Compare (10.1234/a(b)) and 10.5678/c." )).toEqual(["10.1234/a(b)", "10.5678/c"]);
    expect(questionDois("Compare https://doi.org/10.1234/a%28b%29 and 10.5678/c.")).toEqual(["10.1234/a(b)", "10.5678/c"]);
    for (const value of ["https://doi.org@127.0.0.1/10.1234/a", "10.1234/a?secret", "10.1234/a\nmore", "10.1234/" ]) expect(normalizeDoi(value)).toBeUndefined();
  });
  it("retains observed structured authors and partial dates without inferred peer review or rights", () => {
    expect(crossrefRecord(work, time)).toMatchObject({ doi: "10.1234/exact", title: "Measured result", authors: ["Ada Lovelace", "Research Group"],
      authorNames: [{ given: "Ada", family: "Lovelace" }, { literal: "Research Group" }], peerReview: "unknown", workType: "journal-article", publishedDate: "2026-02-28" });
    expect(crossrefRecord({ ...work, published: { "date-parts": [[2026, 2, 31]] } }, time)?.publishedDate).toBeUndefined();
    expect(crossrefRecord({ ...work, published: { "date-parts": [[2026]] } }, time)?.publishedDate).toBe("2026");
    expect(crossrefRecord({ ...work, DOI: "not-doi" }, time)).toBeUndefined();
    expect(crossrefRecord({ ...work, type: "posted-content" }, time)?.workType).toBe("other");
    expect(crossrefRecord({ ...work, type: "posted-content", subtype: "preprint" }, time)?.workType).toBe("preprint");
  });
  it("resolves only the requested exact DOI and never accepts a replacement record", async () => {
    const fetcher = vi.fn(async (_url: string) => JSON.stringify({ message: work }));
    expect(await crossrefLookup("lookup", "10.1234/other", undefined, fetcher)).toEqual([]);
    expect(await crossrefLookup("lookup", "10.1234/exact", undefined, fetcher)).toHaveLength(1);
    expect(fetcher.mock.calls[0][0]).toBe("https://api.crossref.org/works/10.1234%2Fother");
  });
  it("observes versioned arXiv records, retains every bounded author and never treats abstract preview as read evidence", async () => {
    const records = await parseArxiv(atom, time);
    expect(records[0]).toMatchObject({ arxivId: "1706.03762v7", authors: ["Ashish Vaswani", "Noam Shazeer"], workType: "preprint", peerReview: "unknown", publishedDate: "2017-06-12" });
    expect(records[0]).not.toHaveProperty("evidenceScope"); expect(JSON.stringify(records)).not.toContain("search preview");
    const result = await discoverScholarly("attention transformers", true, undefined, async url => url.includes("crossref") ? JSON.stringify({ message: { items: [work] } }) : atom);
    expect(result.candidates.size).toBe(2);
    for (const candidate of result.candidates.values()) expect(candidate).toMatchObject({ sourceKind: "public-reference", fetchPrice: 0, cached: false, item: { contentVersion: "unread" } });
  });
  it("refuses entity declarations, excessive bytes, malformed XML and unversioned repository identities", async () => {
    for (const xml of [atom.replace("<feed", '<!DOCTYPE feed [<!ENTITY x SYSTEM "file:///secret">]><feed'), "x".repeat(250001), "<feed><entry>"])
      await expect(parseArxiv(xml, time)).rejects.toThrow();
    expect(await parseArxiv(atom.replaceAll("1706.03762v7", "1706.03762"), time)).toEqual([]);
    expect(await parseArxiv(atom.replace("http://arxiv.org/abs/", "https://evil.example/abs/"), time)).toEqual([]);
    await expect(parseArxiv(atom.replace("http://www.w3.org/2005/Atom", "https://evil.example/atom"), time)).rejects.toThrow("namespaces");
    await expect(parseArxiv(atom.replace("http://arxiv.org/schemas/atom", "https://evil.example/doi"), time)).rejects.toThrow("namespaces");
    await expect(parseArxiv(atom.replace("<entry>", '<entry xmlns="https://evil.example/entry">'), time)).rejects.toThrow("namespaces");
  });
  it("retains provider contributor count and marks truncation for large collaboration records", async () => {
    const record = crossrefRecord({ ...work, author: Array.from({ length: 60 }, (_, index) => ({ given: "Given", family: "Family " + index })) }, time)!;
    expect(record.authors).toHaveLength(50); expect(record).toMatchObject({ authorCount: 60, authorsTruncated: true });
    const xml = atom.replace("<summary>", Array.from({ length: 60 }, (_, index) => `<author><name>Author ${index}</name></author>`).join("") + "<summary>");
    const [arxiv] = await parseArxiv(xml, time);
    expect(arxiv.authors).toHaveLength(50); expect(arxiv).toMatchObject({ authorCount: 62, authorsTruncated: true });
  });
  it("uses literal relevant terms and encoded URL parameters rather than exact natural-language phrases or injected operators", async () => {
    const fetcher = vi.fn(async (_url: string) => atom);
    await arxivSearch('How do transformer attention mechanisms work? OR id:secret', undefined, fetcher);
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.searchParams.get("max_results")).toBe("6");
    expect(url.searchParams.get("search_query")).toContain('all:"transformer" OR all:"attention"');
    expect(url.searchParams.get("search_query")).not.toContain("id:secret");
  });
  it("bounds exact comparison lookup to two DOIs, paces requests and aborts before the second lookup", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(async (url: string) => JSON.stringify({ message: { ...work, DOI: decodeURIComponent(new URL(url).pathname.slice(7)) } }));
      const promise = discoverScholarly("Compare 10.1234/one with 10.1234/two and 10.1234/three", false, undefined, fetcher);
      await vi.advanceTimersByTimeAsync(1100);
      const result = await promise;
      expect(fetcher).toHaveBeenCalledTimes(2); expect(result.resolvedDois).toBe(2); expect(result.candidates.size).toBe(2);
      const controller = new AbortController();
      const cancelled = discoverScholarly("Compare 10.1234/one and 10.1234/two", false, controller.signal, fetcher);
      await vi.advanceTimersByTimeAsync(0); controller.abort();
      await cancelled; expect(fetcher).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
  });
  it("contains rate-limit, timeout and malformed provider failures without inventing absence or sources", async () => {
    const result = await discoverScholarly("attention", true, undefined, async url => { if (url.includes("crossref")) throw new Error("429 internal secret"); return "malformed"; });
    expect(result).toMatchObject({ succeeded: 0, unavailable: 2 }); expect(result.candidates.size).toBe(0);
  });
});
