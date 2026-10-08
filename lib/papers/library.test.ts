import { describe, expect, it, vi } from "vitest";
import { paperRecordSchema, type PaperRecord } from "./types";
import { groupPaperWorks } from "./work-groups";
import { paperMatches } from "./filters";
import { createPaperSearchLimiter, parsePaperRequest } from "./request";
import { paperLookupIntent } from "./intent";

const record: PaperRecord = { title: "A useful research paper", authors: ["José Researcher"], authorCount: 1, authorsTruncated: false,
  repository: "arxiv", arxivId: "2601.12345v1", url: "https://arxiv.org/abs/2601.12345v1", metadataUrl: "https://export.arxiv.org/api/query?id_list=2601.12345v1",
  metadataObservedAt: "2026-10-06T00:00:00.000Z", publicationKind: "preprint", peerReview: "unknown", publishedYear: 2026 };

describe("bibliography-only paper library", () => {
  it("rejects payout/read authority and mismatched or unsafe record destinations", () => {
    expect(paperRecordSchema.parse(record)).toEqual(record);
    const credentialed = new URL(record.url);
    credentialed.username = "fixture-user"; credentialed.password = String(Date.now());
    for (const change of [{ payTo: "0x123" }, { content: "unread" }, { peerReview: "verified" },
      { url: "https://arxiv.org/abs/2601.12345v2" }, { url: credentialed.href },
      { metadataUrl: "https://localhost/metadata" }, { links: [{ label: "PDF", url: "https://127.0.0.1/paper.pdf" }] },
      { authorCount: 5, authorsTruncated: false }]) expect(paperRecordSchema.safeParse({ ...record, ...change }).success).toBe(false);
  });
  it("groups DOI and arXiv aliases transitively without discarding exact observed versions", () => {
    const first = { ...record, doi: "10.1234/work" };
    const second = { ...record, arxivId: "2601.12345v2", url: "https://arxiv.org/abs/2601.12345v2",
      metadataUrl: "https://export.arxiv.org/api/query?id_list=2601.12345v2", publishedYear: 2025 };
    const third: PaperRecord = { ...record, repository: "crossref", arxivId: undefined, doi: first.doi,
      url: "https://doi.org/10.1234/work", metadataUrl: "https://api.crossref.org/works/10.1234%2Fwork" };
    const originals = [first, second, third];
    const groups = groupPaperWorks(originals);
    expect(groups).toHaveLength(1); expect(groups[0].records).toEqual(originals);
    expect(groups[0].records[1].arxivId).toBe("2601.12345v2");
    expect(groupPaperWorks([record, { ...record, url: "https://arxiv.org/abs/2601.99999v1", arxivId: "2601.99999v1",
      metadataUrl: "https://export.arxiv.org/api/query?id_list=2601.99999v1" }])).toHaveLength(2);
    expect(groupPaperWorks([record, { ...record }])[0].records).toHaveLength(1);
  });
  it("matches literal metadata and one contributor name, preserving exact year/DOI semantics", () => {
    const paper = { ...record, doi: "10.1234/work" };
    expect(paperMatches(paper, { q: "useful research", author: "jose researcher", year: "2026", doi: "https://doi.org/10.1234/WORK" })).toBe(true);
    expect(paperMatches(paper, { q: "", year: "2025" })).toBe(false);
    expect(paperMatches(paper, { q: ".*" })).toBe(false);
    expect(paperMatches({ ...paper, authors: ["Alice Smith", "Bob Jones"] }, { q: "", author: "Alice Jones" })).toBe(false);
    expect(paperMatches(paper, { q: "", doi: "invalid" })).toBe(false);
  });
  it("refuses duplicated, oversized and malformed API input before any external operation", () => {
    expect(parsePaperRequest(new URLSearchParams("q=agents&search=1"))).toEqual({ filters: { q: "agents" }, live: true });
    expect(parsePaperRequest(new URLSearchParams())).toEqual({ filters: { q: "" }, live: false });
    for (const query of ["q=a&q=b", `q=${"a".repeat(121)}`, "year=202x", "doi=invalid", "search=true", "search=1&q=.*", "search=1&q="])
      expect(() => parsePaperRequest(new URLSearchParams(query))).toThrow();
  });
  it("limits callers and global searches with finite RAM and without database writes", () => {
    let now = 0; const admit = createPaperSearchLimiter(() => now);
    expect([admit("a"), admit("a"), admit("a")]).toEqual([0, 0, 0]);
    expect(admit("a")).toBe(60);
    expect([admit("b"), admit("c"), admit("d")]).toEqual([0, 0, 0]);
    expect(admit("new-spoofed-ip")).toBe(60);
    now = 60000; expect(admit("a")).toBe(0);
  });
});

vi.mock("./catalog", () => ({ PAPER_CATALOG: [] }));
describe("explicit bounded paper search", () => {
  it("resolves an adjacent arXiv pair only on explicit search and refuses an oversized list before fetching", async () => {
    const { searchPaperLibrary } = await import("./search");
    const ids = ["2606.02668v1", "2607.13716v1"];
    const fetcher = vi.fn(async (_url: string) => '<feed xmlns="http://www.w3.org/2005/Atom">' +
      ids.map(id => `<entry><id>http://arxiv.org/abs/${id}</id><title>Synthetic metadata ${id}</title></entry>`).join("") + '</feed>');
    const filters = { q: `arXiv ${ids[0]} and ${ids[1]}` };
    await searchPaperLibrary(filters, { fetcher, catalog: [] });
    expect(fetcher).not.toHaveBeenCalled();
    const result = await searchPaperLibrary(filters, { live: true, fetcher, catalog: [] });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new URL(fetcher.mock.calls[0][0]).searchParams.get("id_list")).toBe(ids.join(","));
    expect(result.groups.map(group => group.record.arxivId)).toEqual(ids);
    expect(result.scope).toBe("bibliography-only");
    fetcher.mockClear();
    await expect(searchPaperLibrary({ q: `arXiv ${ids[0]}, ${ids[1]}, and 2503.18666v3` }, { live: true, fetcher, catalog: [] })).rejects.toThrow("Split identifiers");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves mixed exact intent and refuses more than two provider operations", async () => {
    expect(paperLookupIntent("2601.12345v2")).toEqual({ query: "arXiv 2601.12345v2", dois: [], arxivIds: ["2601.12345v2"] });
    expect(() => paperLookupIntent("10.1234/a 10.1234/b arxiv 2601.12345v1")).toThrow();
    expect(() => paperLookupIntent("10.1234/a 10.1234/b 10.1234/c")).toThrow();
    expect(() => paperLookupIntent("arxiv 2601.12345v1 arxiv 2601.12346v1 arxiv 2601.12347v1")).toThrow();
    expect(paperLookupIntent("10.1234/a arxiv 2601.12345v1 arxiv 2601.12346v1").arxivIds).toHaveLength(2);
    const { searchPaperLibrary } = await import("./search");
    const fetcher = vi.fn(async (url: string) => new URL(url).hostname === "export.arxiv.org"
      ? '<feed xmlns="http://www.w3.org/2005/Atom"></feed>'
      : JSON.stringify({ message: { DOI: "10.1234/work", title: ["Exact DOI result"] } }));
    const result = await searchPaperLibrary({ q: "10.1234/work arxiv 2601.12345v1" }, { live: true, fetcher, catalog: [] });
    expect(fetcher).toHaveBeenCalledTimes(2); expect(result.providers.map(provider => provider.name)).toEqual(["crossref", "arxiv"]);
    expect(result.providers.map(provider => provider.status)).toEqual(["available", "empty"]);
  });
  it("stops before another provider when cancelled and does not call invalid DOI input", async () => {
    const { searchPaperLibrary } = await import("./search"); const controller = new AbortController();
    const fetcher = vi.fn(async () => { controller.abort(); throw new Error("cancelled"); });
    await searchPaperLibrary({ q: "agents" }, { live: true, fetcher, catalog: [], signal: controller.signal });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockClear();
    await expect(searchPaperLibrary({ q: "", doi: "invalid" }, { live: true, fetcher, catalog: [] })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("makes no request for local browsing and never admits metadata as reading evidence", async () => {
    const { searchPaperLibrary } = await import("./search"); const fetcher = vi.fn();
    const result = await searchPaperLibrary({ q: "research" }, { fetcher, catalog: [record] });
    expect(fetcher).not.toHaveBeenCalled(); expect(result.scope).toBe("bibliography-only");
    expect(result.groups).toHaveLength(1); expect(result.providers).toEqual([]);
    expect(result.groups[0].record).not.toHaveProperty("content");
  });
  it("distinguishes a provider failure from empty results and keeps successful records", async () => {
    const { searchPaperLibrary } = await import("./search");
    const fetcher = vi.fn(async (url: string) => {
      if (new URL(url).hostname === "export.arxiv.org") throw new Error("offline");
      return JSON.stringify({ message: { items: [{ DOI: "10.1234/work", title: ["A returned paper"], author: [{ given: "A", family: "Person" }] }] } });
    });
    const result = await searchPaperLibrary({ q: "agents" }, { live: true, fetcher, catalog: [] });
    expect(fetcher).toHaveBeenCalledTimes(2); expect(result.groups).toHaveLength(1);
    expect(result.providers.map(provider => provider.status)).toEqual(["unavailable", "available"]);
    expect(result.groups[0].record.peerReview).toBe("unknown");
  });
  it("resolves an exact DOI with one fixed lookup and rejects a substituted identity", async () => {
    const { searchPaperLibrary } = await import("./search");
    const fetcher = vi.fn(async (_url: string) => JSON.stringify({ message: { DOI: "10.1234/other", title: ["Wrong paper"] } }));
    const result = await searchPaperLibrary({ q: "10.1234/work" }, { live: true, fetcher, catalog: [] });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][0]).toContain("api.crossref.org/works/10.1234%2Fwork");
    expect(result.providers[0].status).toBe("empty"); expect(result.groups).toEqual([]);
  });
});
