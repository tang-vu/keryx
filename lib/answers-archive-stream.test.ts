import { afterEach, describe, expect, it, vi } from "vitest";
import { buildArchive, buildArchiveStream } from "./answers-archive";
import type { QueryRun } from "./types";

const scan = vi.hoisted(() => vi.fn());
const publicList = vi.hoisted(() => vi.fn());
const stage=vi.hoisted(()=>({active:true}));
vi.mock("@/lib/db", () => ({ getDb: async () => ({ runPrivacyActive:stage.active,runPrivacy:{list:publicList},iterateRecentQueries: scan }) }));

function fixture(id: string, extra: Partial<QueryRun> = {}): QueryRun {
  return { id, question: "What is Arc?", budget: 1, engine: "heuristic", subClaims: [],
    decisions: [], citations: [{ marker: "S1", sourceId: "s1", sourceName: "Source", weight: 1, reward: 0.1, rationale: "Evidence" }],
    answer: "An **answer** [S1].", totalSpent: 0.2, totalToCreators: 0.1, trace: [],
    createdAt: "2026-09-01T00:00:00.000Z", ...extra };
}
async function* stream(runs: QueryRun[]) { yield* runs; }
afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); scan.mockReset();publicList.mockReset();stage.active=true; });

describe("incremental archive", () => {
  it("preserves ranking, first complete tie, snippets and confidence", async () => {
    const citations = [...fixture("x").citations, { ...fixture("x").citations[0], marker: "S2" }];
    const runs = [fixture("base"), fixture("paid", { totalToCreators: 0.3 }),
      fixture("cited", { citations }), fixture("new", { citations, createdAt: "2026-09-02T00:00:00.000Z", confidence: { level: "Low", reason: "Limited evidence" } }),
      fixture("tie", { citations, createdAt: "2026-09-02T00:00:00.000Z" }),
      fixture("empty", { question: "?" }), fixture("uncited", { citations: [] }),
      fixture("blank", { answer: " " }),
      fixture("other", { question: "Another?", trace: [{ phase: "verdict", detail: { level: "Moderate", reason: "Historical" } } as QueryRun["trace"][number]] })];
    const result = await buildArchiveStream(stream(runs));
    expect(result).toEqual(buildArchive(runs));
    expect(result.map(r => r.id)).toEqual(["new", "other"]);
    expect(result[0]).toMatchObject({ answerSnippet: "An answer .", sourceNames: ["Source"], citationCount: 2, confidence: { level: "Low", reason: "Limited evidence" } });
    expect(result[1].confidence).toEqual({ level: "Moderate", reason: "Historical" });
    expect(result[0]).not.toHaveProperty("trace");
  });

  it("rebuilds each request and refuses stale text after revocation or partial read failure", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    publicList.mockImplementation(async query => {
      if (query.before) return [];
      if (!query.ids) await gate;
      return [fixture("good")];
    });
    const { getArchiveCached } = await import("./answers-archive-cache");
    const first = getArchiveCached(), concurrent = getArchiveCached();
    await vi.waitFor(() => expect(publicList).toHaveBeenCalledTimes(2));
    expect(publicList).toHaveBeenNthCalledWith(1, { take: 32, before: undefined });
    expect(publicList).toHaveBeenNthCalledWith(2, { take: 32, before: undefined });
    release();
    const original = await first;
    expect(original.map(row => row.id)).toEqual(["good"]);
    expect(await concurrent).toEqual(original);
    expect(publicList).toHaveBeenCalledWith({ ids: ["good"], take: 1 });
    expect(publicList).toHaveBeenCalledTimes(6);
    publicList.mockResolvedValueOnce([]);
    expect(await getArchiveCached()).toEqual([]);
    now += 600_001;
    publicList.mockResolvedValueOnce([fixture("partial")]).mockRejectedValueOnce(new Error("Read failed"));
    expect(await getArchiveCached()).toEqual([]);
    publicList.mockImplementation(async query => query.before ? [] : [fixture("recovered")]);
    expect((await getArchiveCached())[0].id).toBe("recovered");
    expect(publicList).toHaveBeenCalledTimes(12);
    expect(scan).not.toHaveBeenCalled();
  });
  it("preserves inactive cache coalescing/stale recovery but never serves that copy after activation",async()=>{
    stage.active=false;let now=1000;vi.spyOn(Date,"now").mockImplementation(()=>now);
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
    scan.mockImplementationOnce(async function*(){await gate;yield fixture("legacy");});
    const {getArchiveCached}=await import("./answers-archive-cache");
    const first=getArchiveCached(),second=getArchiveCached();await vi.waitFor(()=>expect(scan).toHaveBeenCalledTimes(1));
    release();const cached=await first;expect(await second).toBe(cached);
    now+=600001;scan.mockImplementationOnce(async function*(){throw new Error("Unavailable");});expect(await getArchiveCached()).toBe(cached);
    stage.active=true;publicList.mockRejectedValueOnce(new Error("Active unavailable"));expect(await getArchiveCached()).toEqual([]);
    expect(publicList).toHaveBeenCalledTimes(1);expect(scan).toHaveBeenCalledTimes(2);
  });

  it("does not expose a partial archive on an initial read failure", async () => {
    publicList.mockResolvedValueOnce([fixture("partial")]).mockRejectedValueOnce(new Error("Read failed"));
    const { getArchiveCached } = await import("./answers-archive-cache");
    expect(await getArchiveCached()).toEqual([]);
    expect(publicList).toHaveBeenCalledTimes(2);expect(scan).not.toHaveBeenCalled();
  });
});
