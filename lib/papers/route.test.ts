import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const search = vi.hoisted(() => vi.fn(async () => ({ version: 1, scope: "bibliography-only", groups: [], totalWorks: 0, catalogRecords: 40, providers: [] })));
vi.mock("./search", () => ({ searchPaperLibrary: search }));
vi.mock("../db", () => ({ getDb: () => { throw new Error("Bibliography must not access the database"); } }));
const request = (query: string, caller = "test") => new NextRequest(`https://keryx.cc/api/papers?${query}`, { headers: { "cf-connecting-ip": caller } });
describe("public bibliography route", () => {
  beforeEach(() => vi.clearAllMocks());
  it("serves curated metadata without provider admission and keeps original filters", async () => {
    const { GET } = await import("../../app/api/papers/route");
    const req = request("author=Researcher&year=2024"); const response = await GET(req);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(search).toHaveBeenCalledWith({ q: "", author: "Researcher", year: "2024" }, { live: false, signal: req.signal });
  });
  it("refuses malformed and over-budget exact intent before search", async () => {
    const { GET } = await import("../../app/api/papers/route");
    for (const query of ["year=999", "doi=bad", "search=1&q=", "q=x&q=y", "search=1&q=10.1234/a+10.1234/b+arxiv+2601.12345v1"])
      expect((await GET(request(query))).status).toBe(400);
    expect(search).not.toHaveBeenCalled();
  });
  it("caps live calls in RAM, returns Retry-After, and still allows offline browsing", async () => {
    const { GET } = await import("../../app/api/papers/route");
    for (let index = 0; index < 3; index++) expect((await GET(request("search=1&q=agents", "quota-caller"))).status).toBe(200);
    const blocked = await GET(request("search=1&q=agents", "quota-caller"));
    expect(blocked.status).toBe(429); expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(search).toHaveBeenCalledTimes(3);
    const { readHostedPaperLookup } = await import("./hosted-lookup");
    expect(() => readHostedPaperLookup({ query: "agents", searchRepositories: true }, "quota-caller")).toThrow("admission busy");
    expect(search).toHaveBeenCalledTimes(3);
    await readHostedPaperLookup({ query: "agents" }, "quota-caller");
    expect(search).toHaveBeenCalledTimes(4);
    expect((await GET(request("q=agents", "quota-caller"))).status).toBe(200);
  });
});
