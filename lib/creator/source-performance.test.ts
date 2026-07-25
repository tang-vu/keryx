/**
 * Source decision feedback. What must never break: the counts only ever come from runs that really
 * named the source, BUY and CACHE stay distinguishable (one settles a toll, the other does not),
 * the price comparison is drawn from the same runs that passed, and a rationale is reproduced
 * verbatim — a paraphrase would be us putting words in the agent's mouth on a creator's own page.
 */

import { describe, expect, it } from "vitest";
import { buildPerformanceIndex } from "./source-performance";
import type { Citation, Decision, QueryRun } from "../types";

function decision(sourceId: string, action: Decision["action"], over: Partial<Decision> = {}): Decision {
  return {
    sourceId,
    sourceName: sourceId.toUpperCase(),
    action,
    expectedValue: 0.5,
    price: 0.002,
    confidence: 0.7,
    rationale: `${action} ${sourceId}`,
    targets: [],
    ...over,
  };
}

function cite(sourceId: string): Citation {
  return { marker: "S1", sourceId, sourceName: sourceId, weight: 1, reward: 0.001, rationale: "" };
}

function run(id: string, decisions: Decision[], citations: Citation[] = [], createdAt = "2026-07-25T10:00:00.000Z"): QueryRun {
  return {
    id,
    question: `question ${id}`,
    budget: 0.05,
    engine: "llm:test",
    subClaims: [],
    decisions,
    citations,
    answer: "",
    totalSpent: 0,
    totalToCreators: 0,
    trace: [],
    createdAt,
  };
}

describe("buildPerformanceIndex", () => {
  it("counts a source only in the runs whose decisions name it", () => {
    const index = buildPerformanceIndex([
      run("r1", [decision("a", "BUY"), decision("b", "SKIP")]),
      run("r2", [decision("b", "BUY")]), // "a" did not exist yet — silence, not a zero
    ]);
    expect(index.a.considered).toBe(1);
    expect(index.b.considered).toBe(2);
  });

  it("keeps a fresh toll apart from a cache reuse", () => {
    const index = buildPerformanceIndex([
      run("r1", [decision("a", "BUY")]),
      run("r2", [decision("a", "CACHE")]),
      run("r3", [decision("a", "SKIP")]),
    ]);
    expect(index.a).toMatchObject({ bought: 1, reused: 1, skipped: 1, considered: 3 });
  });

  it("counts a citation once per run and reports cite-through over the reads, not the weighings", () => {
    const index = buildPerformanceIndex([
      run("r1", [decision("a", "BUY")], [cite("a"), cite("a")]), // two markers, one source
      run("r2", [decision("a", "CACHE")], []),
      run("r3", [decision("a", "SKIP")], []),
    ]);
    expect(index.a.cited).toBe(1);
    expect(index.a.citeThrough).toBe(0.5); // 1 citation over 2 reads (BUY + CACHE)
  });

  it("compares against the median price of what was chosen in the very runs that passed on it", () => {
    const index = buildPerformanceIndex([
      run("r1", [
        decision("a", "SKIP", { price: 0.006 }),
        decision("b", "BUY", { price: 0.001 }),
        decision("c", "BUY", { price: 0.003 }),
      ]),
      // A run it was not in must not move the comparison, however expensive that run was.
      run("r2", [decision("b", "BUY", { price: 0.02 })]),
    ]);
    expect(index.a.rivalPriceOnSkip).toBe(0.002); // median of 0.001 and 0.003
    expect(index.a.price).toBe(0.006);
  });

  it("counts a cache hit as a choice in the comparison — on a warm corpus most reads are cached", () => {
    const index = buildPerformanceIndex([
      run("r1", [decision("a", "SKIP", { price: 0.005 }), decision("b", "CACHE", { price: 0.002 })]),
    ]);
    expect(index.a.rivalPriceOnSkip).toBe(0.002);
  });

  it("leaves the comparison null when the passing run chose nothing at all", () => {
    const index = buildPerformanceIndex([run("r1", [decision("a", "SKIP"), decision("b", "SKIP")])]);
    expect(index.a.rivalPriceOnSkip).toBeNull();
    expect(index.a.recentSkips[0].rivalPrice).toBeNull();
  });

  it("takes the current price from the newest decision, since runs arrive newest-first", () => {
    const index = buildPerformanceIndex([
      run("r2", [decision("a", "SKIP", { price: 0.004 })], [], "2026-07-25T10:00:00.000Z"),
      run("r1", [decision("a", "BUY", { price: 0.001 })], [], "2026-07-01T10:00:00.000Z"),
    ]);
    expect(index.a.price).toBe(0.004);
  });

  it("reproduces the skip rationale verbatim and links it to its dispatch", () => {
    const rationale = "General crypto news; low historical hit rate (8%) and not specific to citations.";
    const index = buildPerformanceIndex([run("r1", [decision("a", "SKIP", { rationale })])]);
    expect(index.a.recentSkips[0]).toMatchObject({ queryId: "r1", question: "question r1", rationale });
  });

  it("keeps at most four skip notes, newest first", () => {
    const runs = ["r1", "r2", "r3", "r4", "r5", "r6"].map((id) =>
      run(id, [decision("a", "SKIP", { rationale: `pass ${id}` })]),
    );
    const index = buildPerformanceIndex(runs);
    expect(index.a.skipped).toBe(6);
    expect(index.a.recentSkips.map((s) => s.queryId)).toEqual(["r1", "r2", "r3", "r4"]);
  });

  it("reports the median expected value on each side of the choice", () => {
    const index = buildPerformanceIndex([
      run("r1", [decision("a", "BUY", { expectedValue: 0.9 })]),
      run("r2", [decision("a", "CACHE", { expectedValue: 0.8 })]),
      run("r3", [decision("a", "SKIP", { expectedValue: 0.2 })]),
      run("r4", [decision("a", "SKIP", { expectedValue: 0.4 })]),
    ]);
    expect(index.a.evChosen).toBeCloseTo(0.85);
    expect(index.a.evSkipped).toBeCloseTo(0.3);
  });

  it("ignores external marketplace endpoints — they have no creator page to feed", () => {
    const index = buildPerformanceIndex([
      run("r1", [decision("ext", "SKIP", { external: true }), decision("a", "BUY")]),
    ]);
    expect(index.ext).toBeUndefined();
    expect(index.a.bought).toBe(1);
  });

  it("survives a run stored before decisions or citations were recorded", () => {
    const bare = { ...run("r0", []), decisions: undefined, citations: undefined } as unknown as QueryRun;
    expect(() => buildPerformanceIndex([bare, run("r1", [decision("a", "BUY")])])).not.toThrow();
    expect(buildPerformanceIndex([bare, run("r1", [decision("a", "BUY")])]).a.bought).toBe(1);
  });
});
