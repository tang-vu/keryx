import { afterEach, describe, expect, it, vi } from "vitest";
import { buildArchive, buildArchiveStream } from "./answers-archive";
import type { QueryRun } from "./types";

const scan = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ getDb: async () => ({ iterateRecentQueries: scan }) }));

function fixture(id: string, extra: Partial<QueryRun> = {}): QueryRun {
  return { id, question: "What is Arc?", budget: 1, engine: "heuristic", subClaims: [],
    decisions: [], citations: [{ marker: "S1", sourceId: "s1", sourceName: "Source", weight: 1, reward: 0.1, rationale: "Evidence" }],
    answer: "An **answer** [S1].", totalSpent: 0.2, totalToCreators: 0.1, trace: [],
    createdAt: "2026-09-01T00:00:00.000Z", ...extra };
}
async function* stream(runs: QueryRun[]) { yield* runs; }
afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); scan.mockReset(); });

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

  it("shares concurrent rebuilds and keeps the complete cache after a partial failure", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    scan.mockImplementationOnce(async function* () { await gate; yield fixture("good"); });
    const { getArchiveCached } = await import("./answers-archive-cache");
    const first = getArchiveCached(), concurrent = getArchiveCached();
    await Promise.resolve();
    expect(scan).toHaveBeenCalledTimes(1);
    expect(scan).toHaveBeenCalledWith(2500);
    release();
    const original = await first;
    expect(await concurrent).toBe(original);
    now += 600_001;
    scan.mockImplementationOnce(async function* () { yield fixture("partial"); throw new Error("Read failed"); });
    expect(await getArchiveCached()).toBe(original);
    scan.mockImplementationOnce(() => stream([fixture("recovered")]));
    expect((await getArchiveCached())[0].id).toBe("recovered");
    expect(scan).toHaveBeenCalledTimes(3);
  });

  it("does not expose a partial archive on an initial read failure", async () => {
    scan.mockImplementation(async function* () { yield fixture("partial"); throw new Error("Read failed"); });
    const { getArchiveCached } = await import("./answers-archive-cache");
    expect(await getArchiveCached()).toEqual([]);
  });
});
