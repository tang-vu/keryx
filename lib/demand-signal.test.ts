/**
 * Demand signal. What must never break: a run that measured nothing is never counted as a failure,
 * the run's LAST assessment is the one published (the early checks read 0 because nothing has been
 * bought yet), and every published line keeps the dispatch that proves it.
 */

import { describe, expect, it } from "vitest";
import { buildDemand, claimGaps, finalCoverage } from "./demand-signal";
import type { QueryRun, TraceStep } from "./types";

function step(phase: TraceStep["phase"], detail: unknown): TraceStep {
  return { phase, message: "", detail, ts: 0 };
}

function run(id: string, trace: TraceStep[], over: Partial<QueryRun> = {}): QueryRun {
  return {
    id,
    question: `question ${id}`,
    budget: 0.05,
    engine: "llm:test",
    subClaims: [],
    decisions: [],
    citations: [],
    answer: "",
    totalSpent: 0,
    totalToCreators: 0,
    trace,
    createdAt: "2026-07-25T10:00:00.000Z",
    ...over,
  };
}

/** The shape the sufficiency step stores. */
const suf = (claims: [string, number][]) =>
  step("sufficiency", { sufficient: false, perClaim: claims.map(([claim, coverage]) => ({ claim, coverage, coveredBy: [] })) });

/** The shape the re-evaluation step stores — one step per claim. */
const reeval = (claim: string, coverage: number) =>
  step("reevaluate", { claim, coverage, coveredBy: ["S1"], rationale: "" });

describe("finalCoverage", () => {
  it("takes the last assessment of a claim, not the first", () => {
    const r = run("r1", [suf([["c", 0]]), reeval("c", 0.8)]);
    expect(finalCoverage(r).get("c")).toBe(0.8);
  });

  it("reads both trace shapes", () => {
    const r = run("r1", [suf([["a", 0.2]]), reeval("b", 0.9)]);
    expect([...finalCoverage(r)]).toEqual([
      ["a", 0.2],
      ["b", 0.9],
    ]);
  });

  it("is empty for a run that assessed nothing, and survives junk detail", () => {
    expect(finalCoverage(run("r1", [])).size).toBe(0);
    expect(
      finalCoverage(run("r1", [step("decide", "a string"), step("decide", null), step("decide", { perClaim: "nope" })]))
        .size,
    ).toBe(0);
  });
});

describe("claimGaps", () => {
  it("reports only claims left below the threshold", () => {
    const r = run("r1", [suf([["Gateway batches sub-cent tolls", 0.2], ["USDC settles on Arc", 0.9]])]);
    expect(claimGaps(r).map((g) => g.claim)).toEqual(["Gateway batches sub-cent tolls"]);
  });

  it("carries the dispatch that proves it", () => {
    const r = run("r1", [suf([["Gateway batches sub-cent tolls", 0.2]])]);
    expect(claimGaps(r)[0]).toMatchObject({ queryId: "r1", question: "question r1", coverage: 0.2 });
  });

  it("says nothing at all about a run that measured nothing", () => {
    expect(claimGaps(run("r1", []))).toEqual([]);
  });

  it("drops a claim too thin to name a subject — anyone can ask 'Hi' through a front door", () => {
    const r = run("r1", [suf([["Hi", 0], ["how does it work", 0], ["Gateway settles sub-cent USDC", 0.1]])]);
    expect(claimGaps(r).map((g) => g.claim)).toEqual(["Gateway settles sub-cent USDC"]);
  });
});

describe("buildDemand", () => {
  it("never turns an unmeasured run into a gap", () => {
    const measured = run("r1", [suf([["Gateway batches sub-cent tolls", 0.1]])]);
    const silent = run("r2", []);
    expect(buildDemand([measured, silent]).map((g) => g.claim)).toEqual([
      "Gateway batches sub-cent tolls",
    ]);
  });

  it("collapses the same claim across dispatches, keeping the worst coverage and the newest date", () => {
    const a = run("r1", [suf([["Gateway batches sub-cent tolls", 0.3]])], { createdAt: "2026-07-20T00:00:00.000Z" });
    const b = run("r2", [suf([["Gateway batches sub-cent tolls", 0.1]])], { createdAt: "2026-07-24T00:00:00.000Z" });
    const [gap] = buildDemand([a, b]);
    expect(gap).toMatchObject({
      seen: 2,
      coverage: 0.1,
      queryId: "r2", // the receipt points at the worst occurrence
      createdAt: "2026-07-24T00:00:00.000Z", // but the date says the hole is still open
    });
  });

  it("merges the same hole phrased twice, keeping the worst occurrence whole", () => {
    const a = run("r1", [suf([["CCTP moves USDC between domains by burn and mint.", 0.3]])]);
    const b = run("r2", [suf([["CCTP moves USDC across domains by burn and mint.", 0.1]])]);
    const merged = buildDemand([a, b]);
    expect(merged).toHaveLength(1);
    // Wording, coverage and receipt all come from the worst hit, so the sentence on the board is
    // the one the linked dispatch assessed.
    expect(merged[0]).toMatchObject({
      seen: 2,
      coverage: 0.1,
      claim: "CCTP moves USDC across domains by burn and mint.",
      queryId: "r2",
    });
  });

  it("never folds a claim into its own negation", () => {
    const a = run("r1", [suf([["Batching reduces settlement fees.", 0.2]])]);
    const b = run("r2", [suf([["Batching increases settlement fees.", 0.2]])]);
    expect(buildDemand([a, b])).toHaveLength(2);
  });

  it("ranks a recurring hole above a worse one-off", () => {
    const recurring = [
      run("r1", [suf([["EIP-712 typed signing for x402", 0.3]])]),
      run("r2", [suf([["EIP-712 typed signing for x402", 0.3]])]),
    ];
    const oneOff = run("r3", [suf([["Arc finality under one second", 0]])]);
    expect(buildDemand([...recurring, oneOff]).map((g) => g.claim)).toEqual([
      "EIP-712 typed signing for x402",
      "Arc finality under one second",
    ]);
  });

  it("orders equally recurring holes by how badly they were missed", () => {
    const runs = [run("r1", [suf([["CCTP burn and mint", 0.05], ["Gateway attestation latency", 0.35]])])];
    expect(buildDemand(runs).map((g) => g.claim)).toEqual([
      "CCTP burn and mint",
      "Gateway attestation latency",
    ]);
  });

  it("honours the threshold and the limit", () => {
    const runs = [
      run("r1", [suf([["CCTP burn and mint", 0.1], ["Gateway sub-cent settlement", 0.2], ["Arc block finality", 0.45]])]),
    ];
    expect(buildDemand(runs, { limit: 2 }).map((g) => g.claim)).toEqual([
      "CCTP burn and mint",
      "Gateway sub-cent settlement",
    ]);
    expect(buildDemand(runs, { threshold: 0.5 }).map((g) => g.claim)).toContain("Arc block finality");
  });

  it("is empty when the corpus covered everything it was asked", () => {
    expect(buildDemand([run("r1", [suf([["USDC settles on Arc", 0.9]])])])).toEqual([]);
  });
});
