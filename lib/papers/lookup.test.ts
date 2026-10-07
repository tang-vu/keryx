import { describe, expect, it, vi } from "vitest";
import { createPaperLookupHandler, paperLookupParameters, paperLookupText, validatePaperLookupResult } from "./lookup";
import { fetchPaperLookup } from "./client";
import { paperLibraryHref } from "./handoff";
import { searchPaperLibrary, bibliographicPaper } from "./search";
import { parseArxiv } from "../scholarly/arxiv";
import { crossrefRecord } from "../scholarly/crossref";
import { paperReferencesRis } from "./reference-export";
import type { PaperRecord, PaperSearchResult } from "./types";
import { groupPaperWorks } from "./work-groups";

const time = "2026-10-06T00:00:00.000Z";
const paper: PaperRecord = { title: "Synthetic versioned paper", authors: ["First Author", "Second Author"],
  authorCount: 2, authorsTruncated: false, arxivId: "2005.11401v4", repository: "arxiv",
  url: "https://arxiv.org/abs/2005.11401v4", metadataUrl: "https://export.arxiv.org/api/query?id_list=2005.11401v4",
  metadataObservedAt: time, publicationKind: "preprint", peerReview: "unknown" };
const result = (records: PaperRecord[] = [paper]): PaperSearchResult => ({ version: 1, scope: "bibliography-only",
  groups: groupPaperWorks(records), totalWorks: groupPaperWorks(records).length, catalogRecords: records.length, providers: [] });
const feed = (authors: string) => `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2005.11401v4</id><title>Synthetic paper</title>${authors}</entry></feed>`;

describe("free bibliography lookup", () => {
  it("delivers the retained exact version without provider calls, original bodies or payout authority", async () => {
    const fetcher = vi.fn();
    const handler = createPaperLookupHandler(input => searchPaperLibrary(paperLookupParameters(input).filters, { catalog: [paper], fetcher }));
    const response = await handler({ query: "https://arxiv.org/pdf/2005.11401v4.pdf" });
    expect(fetcher).not.toHaveBeenCalled(); expect(response).not.toHaveProperty("isError");
    expect(response.structuredContent).toEqual(result());
    expect(response.content[0].text).toContain("First listed author in the recorded complete list: First Author");
    expect(response.content[0].text).toContain("existence not established");
    expect(response.content[0].text).toContain("withdrawal/replacement status: unknown");
    expect(response.content[0].text).toContain(time);
    for (const key of ["answer", "citations", "content", "payTo", "settlementId"])
      expect(response.structuredContent?.groups[0].record).not.toHaveProperty(key);
  });

  it.each(["arXiv:2005.11401v4", "arXiv: 2005.11401v4", "arXiv 2005.11401v4"])("normalizes standalone %s for catalog-only API/CLI/tool queries", async query => {
    const parsed = paperLookupParameters({ query });
    expect(parsed.filters.q).toBe("2005.11401v4");
    const fetcher = vi.fn(); const found = await searchPaperLibrary(parsed.filters, { catalog: [paper], fetcher });
    expect(found.totalWorks).toBe(1); expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects invalid semantic input before its reader and never exposes reader errors", async () => {
    const read = vi.fn(async () => result()); const handler = createPaperLookupHandler(read);
    for (const query of [" ", "a".repeat(121), "arxiv 2005.11401v4, 2005.11402v1, 2005.11403v1"])
      expect((await handler({ query })).isError).toBe(true);
    expect(read).not.toHaveBeenCalled();
    read.mockRejectedValueOnce(new Error("PRIVATE provider body"));
    const failed = await handler({ query: "2005.11401v4" });
    expect(failed.isError).toBe(true); expect(failed.content[0].text).not.toContain("PRIVATE");
    expect(failed.content[0].text).toContain("No empty result");
  });

  it("keeps cached provenance when the explicitly requested provider is unavailable", async () => {
    const fetcher = vi.fn(async () => { throw new Error("Synthetic unavailable"); });
    const handler = createPaperLookupHandler(input => {
      const query = paperLookupParameters(input);
      return searchPaperLibrary(query.filters, { catalog: [paper], fetcher, live: query.live });
    });
    const response = await handler({ query: "2005.11401v4", searchRepositories: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(response.structuredContent).toMatchObject({ providers: [{ name: "arxiv", status: "unavailable" }] });
    expect(response.structuredContent?.groups[0].record.metadataObservedAt).toBe(time);
    expect(response.content[0].text).toContain("unavailable; no empty result inferred");
  });

  it.each(["arxiv", "crossref"])("does not promote a later %s contributor after missing or malformed names", async provider => {
    for (const missing of ["", "<i></i>"]) {
      const metadata = provider === "arxiv" ? (await parseArxiv(feed(`<author><name>${missing}</name></author><author><name>Second Author</name></author>`), time))[0]
        : crossrefRecord({ DOI: "10.1234/work", title: ["Synthetic paper"], author: [{ name: missing }, { given: "Second", family: "Author" }] }, time)!;
      const record = bibliographicPaper(metadata);
      expect(record.authors).toEqual(["Second Author"]); expect(record.authorCount).toBe(2); expect(record.authorsTruncated).toBe(true);
      const text = paperLookupText(result([record]));
      expect(text).toContain("First listed author: not established"); expect(text).not.toContain("complete list: Second Author");
      expect(paperReferencesRis([record]).content).toContain("Incomplete contributor list: 1/2");
      expect(paperReferencesRis([record]).content).not.toContain("First listed author");
    }
  });

  it("keeps structured names aligned around an internal gap and withholds incomplete or absent first-author claims", () => {
    const metadata = crossrefRecord({ DOI: "10.1234/work", title: ["Synthetic paper"],
      author: [{ given: "First", family: "Author" }, {}, { name: "Last Group" }] }, time)!;
    expect(metadata.authors).toEqual(["First Author", "Last Group"]);
    expect(metadata.authorNames).toEqual([{ given: "First", family: "Author" }, { literal: "Last Group" }]);
    for (const record of [bibliographicPaper(metadata), { ...paper, authors: [], authorCount: 0 },
      { ...paper, authors: ["First Author"], authorCount: 60, authorsTruncated: true }])
      expect(paperLookupText(result([record]))).toContain("First listed author: not established");
  });

  it("bounds the text list while retaining the structured result's work count", () => {
    const records = Array.from({ length: 9 }, (_, index) => ({ ...paper, arxivId: `2005.1140${index}v4`, url: `https://arxiv.org/abs/2005.1140${index}v4` }));
    expect(paperLookupText(result(records))).toContain("Text shows 8/9 works");
  });

  it("rejects inconsistent snapshot membership, aggregate overflow and raw link line/control injection", () => {
    const another = { ...paper, arxivId: "2005.11401v5", url: "https://arxiv.org/abs/2005.11401v5" };
    const inconsistent = result(); inconsistent.groups[0].records = [another];
    expect(() => validatePaperLookupResult({ query: paper.arxivId! }, inconsistent)).toThrow("not retained");
    const unrelated = { ...paper, arxivId: "2501.12345v1", url: "https://arxiv.org/abs/2501.12345v1" };
    const incoherent = result(); incoherent.groups[0].records.push(unrelated);
    expect(() => validatePaperLookupResult({ query: paper.arxivId! }, incoherent)).toThrow("Incoherent");
    const wrongGroup = result(); wrongGroup.groups[0].id = `paper:${"a".repeat(64)}`;
    expect(() => validatePaperLookupResult({ query: paper.arxivId! }, wrongGroup)).toThrow("Incoherent");
    const overflow = result(); overflow.groups.push({ ...overflow.groups[0], records: Array.from({ length: 112 }, () => paper) }); overflow.totalWorks = 2;
    expect(() => validatePaperLookupResult({ query: paper.arxivId! }, overflow)).toThrow("snapshot bound");
    for (const changed of [{ ...paper, metadataUrl: "https://export.arxiv.org/api/query?x=ok\nINJECTED" },
      { ...paper, links: [{ label: "PDF" as const, url: "https://arxiv.org/pdf/2005.11401v4\t" }] }]) {
      expect(() => validatePaperLookupResult({ query: paper.arxivId! }, result([changed]))).toThrow("exact bibliography link");
      expect(() => paperLookupText(result([changed]))).toThrow("exact bibliography link");
    }
    const alternate = result([paper, another]);
    expect(validatePaperLookupResult({ query: paper.arxivId! }, alternate).groups[0].records).toHaveLength(2);
    const withDoi = { ...paper, doi: "10.1234/work" };
    const splitAliases = { ...result(), groups: [...groupPaperWorks([paper]), ...groupPaperWorks([withDoi])], totalWorks: 2 };
    expect(() => validatePaperLookupResult({ query: paper.arxivId! }, splitAliases)).toThrow("combined bibliography");
    expect(validatePaperLookupResult({ query: paper.arxivId! }, result([paper, withDoi])).groups).toHaveLength(1);
  });
});

describe("GET-only stdio bibliography client", () => {
  it("uses one bounded GET with exact version and no authentication/payment headers", async () => {
    const http = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(result()));
    expect(await fetchPaperLookup("https://synthetic.example", { query: "2005.11401v4" }, http)).toEqual(result());
    expect(http).toHaveBeenCalledTimes(1);
    expect(http.mock.calls[0]).toMatchObject(["https://synthetic.example/api/papers?q=2005.11401v4",
      { method: "GET", redirect: "error", cache: "no-store" }]);
    expect(http.mock.calls[0][1]).not.toHaveProperty("headers"); expect(http.mock.calls[0][1]).not.toHaveProperty("body");
  });

  it("admits explicit metadata search, preserves unavailable and rejects substituted versions", async () => {
    const http = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(result([{ ...paper, arxivId: "2005.11401v5", url: "https://arxiv.org/abs/2005.11401v5" }])));
    await expect(fetchPaperLookup("https://synthetic.example", { query: paper.url, searchRepositories: true }, http)).rejects.toThrow("identity");
    expect(http.mock.calls[0][0]).toContain("q=2005.11401v4&search=1");
    const unavailable = { ...result(), providers: [{ name: "arxiv" as const, status: "unavailable" as const, records: 0 }] };
    http.mockImplementationOnce(async () => Response.json(unavailable));
    expect(await fetchPaperLookup("https://synthetic.example", { query: paper.url, searchRepositories: true }, http)).toEqual(unavailable);
  });

  it("accepts separate members of mixed exact intent and refuses unrelated identities", async () => {
    const crossref = { ...paper, repository: "crossref" as const, arxivId: undefined, doi: "10.1234/work",
      url: "https://doi.org/10.1234/work", metadataUrl: "https://api.crossref.org/works/10.1234%2Fwork" };
    const http = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(result([paper, crossref])));
    expect((await fetchPaperLookup("https://synthetic.example", { query: "10.1234/work arxiv 2005.11401v4", searchRepositories: true }, http)).groups).toHaveLength(2);
    const wrongAlias = { ...paper, doi: "10.1234/work", arxivId: "2005.11401v5", url: "https://arxiv.org/abs/2005.11401v5" };
    http.mockImplementationOnce(async () => Response.json(result([wrongAlias])));
    await expect(fetchPaperLookup("https://synthetic.example", { query: "10.1234/work arxiv 2005.11401v4", searchRepositories: true }, http)).rejects.toThrow("identity");
    http.mockImplementationOnce(async () => Response.json(result([{ ...paper, arxivId: "2501.12345v1", url: "https://arxiv.org/abs/2501.12345v1" }])));
    await expect(fetchPaperLookup("https://synthetic.example", { query: "2005.11401v4" }, http)).rejects.toThrow("identity");
  });

  it("refuses arbitrary origins/input before GET and contains failure/oversized/unsupported responses without retries", async () => {
    const http = vi.fn(async (_url: string, _init?: RequestInit) => new Response("Synthetic unavailable", { status: 503 }));
    for (const origin of ["http://synthetic.example", "https://synthetic.example/path", "https://synthetic.example?secret=1"])
      await expect(fetchPaperLookup(origin, { query: paper.arxivId! }, http)).rejects.toThrow();
    await expect(fetchPaperLookup("https://synthetic.example", { query: "a".repeat(121) }, http)).rejects.toThrow();
    expect(http).not.toHaveBeenCalled();
    await expect(fetchPaperLookup("https://synthetic.example", { query: paper.arxivId! }, http)).rejects.toThrow("unavailable");
    expect(http).toHaveBeenCalledTimes(1);
    http.mockImplementationOnce(async () => new Response(" ".repeat(2_000_001)));
    await expect(fetchPaperLookup("https://synthetic.example", { query: paper.arxivId! }, http)).rejects.toThrow("exceeds 2 MB");
    http.mockImplementationOnce(async () => Response.json({ ...result(), scope: "read-paper" }));
    await expect(fetchPaperLookup("https://synthetic.example", { query: paper.arxivId! }, http)).rejects.toThrow();
    expect(http).toHaveBeenCalledTimes(3);
  });
});

describe("Ask's local free metadata handoff", () => {
  it("carries one explicit identity, without full prose or external-search/automatic-research flags", () => {
    const href = paperLibraryHref("My private question about arXiv 2005.11401v4; please identify its authors");
    expect(href).toBe("/sources?kind=paper&q=2005.11401v4#research-papers");
    expect(paperLibraryHref("https://arxiv.org/pdf/2005.11401v4.pdf")).toBe(href);
    expect(paperLibraryHref("2005.11401v4")).toBe(href);
    expect(paperLibraryHref("What is the DOI 10.1234/work?" )).toBe("/sources?kind=paper&doi=10.1234%2Fwork#research-papers");
    for (const question of ["My private topic", "arxiv 2005.11401v4 and 2005.11402v1", "10.1234/work arxiv 2005.11401v4"])
      expect(paperLibraryHref(question)).toBe("/sources?kind=paper#research-papers");
    expect(href).not.toMatch(/search=|run=|private/);
  });
});
