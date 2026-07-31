/**
 * Dispatch health. What must never break: the two failure shapes that actually happened on
 * 2026-07-25 both raise an alarm (runs answered by the heuristic while a model was configured;
 * runs that pay no creator), and a quiet-but-honest window never does.
 */

import { describe, expect, it } from "vitest";
import { assessDispatchHealth, type DispatchAlarmCode } from "./dispatch-health";
import type { QueryRun } from "@/lib/types";

const NOW = new Date("2026-07-25T12:00:00.000Z");

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 3_600_000).toISOString();
}

function run(over: Partial<QueryRun> = {}): QueryRun {
  return {
    id: "q1",
    question: "does a stablecoin settle instantly?",
    budget: 0.05,
    engine: "llm:deepseek:deepseek-v4-flash",
    subClaims: ["a"],
    decisions: [
      {
        sourceId: "s1",
        sourceName: "S1",
        action: "BUY",
        expectedValue: 0.8,
        price: 0.002,
        confidence: 0.7,
        rationale: "on topic",
        targets: [0],
      },
    ],
    citations: [],
    answer: "…",
    totalSpent: 0.004,
    totalToCreators: 0.004,
    trace: [],
    createdAt: hoursAgo(1),
    ...over,
  };
}

function codes(runs: QueryRun[], expectReasoning = true): DispatchAlarmCode[] {
  return assessDispatchHealth(runs, { now: NOW, expectReasoning }).alarms.map((a) => a.code);
}

describe("assessDispatchHealth", () => {
  it("passes a window of model-reasoned, paying dispatches", () => {
    const s = assessDispatchHealth([run(), run(), run(), run()], {
      now: NOW,
      expectReasoning: true,
    });
    expect(s.alarms).toEqual([]);
    expect(s.runs).toBe(4);
    expect(s.modelReasoned).toBe(4);
    expect(s.paying).toBe(4);
    expect(s.creatorPayoutUsdc).toBeCloseTo(0.016, 6);
  });

  it("counts only dispatches inside the window, and reports the newest one regardless", () => {
    const s = assessDispatchHealth(
      [run({ createdAt: hoursAgo(0.5) }), run({ createdAt: hoursAgo(2) }), run({ createdAt: hoursAgo(30) })],
      { now: NOW, windowHours: 6, expectReasoning: true },
    );
    expect(s.runs).toBe(2);
    expect(s.lastDispatchAt).toBe(hoursAgo(0.5));
  });

  it("alarms when nothing has dispatched in the window — that is the daemon, not the agent", () => {
    const s = assessDispatchHealth([run({ createdAt: hoursAgo(20) })], {
      now: NOW,
      windowHours: 6,
      expectReasoning: true,
    });
    expect(s.alarms.map((a) => a.code)).toEqual(["silent"]);
    expect(s.alarms[0].message).toContain(hoursAgo(20));
  });

  // The 2026-07-25 outage, first half: the pick's wire name went stale, so every step fell through.
  it("alarms when a dispatch was answered entirely by the heuristic", () => {
    const fell = run({ engine: "heuristic (fallback from llm:deepseek:deepseek-chat)" });
    expect(codes([fell, run(), run(), run()])).toContain("unreasoned");
  });

  it("stays quiet about heuristic runs on a box with no model credentials", () => {
    const offline = [run({ engine: "heuristic" }), run({ engine: "heuristic" }), run({ engine: "heuristic" })];
    expect(codes(offline, false)).toEqual([]);
  });

  it("alarms when most dispatches lost some step to the fallback", () => {
    const partial = run({ engine: "llm:deepseek:deepseek-v4-flash + heuristic on 2 steps" });
    expect(codes([partial, partial, partial, run()])).toEqual(["degraded"]);
  });

  it("does not call a minority of partial fallbacks degraded", () => {
    const partial = run({ engine: "llm:deepseek:deepseek-v4-flash + heuristic on 1 step" });
    expect(codes([partial, run(), run(), run()])).toEqual([]);
  });

  it("reports cross-provider saves from structured attempt telemetry", () => {
    const saved = run({
      engine: "llm:mimo:mimo-v2.5 (fallback from llm:deepseek:deepseek-v4-flash)",
      reasoningAttempts: [
        {
          step: "synthesize",
          engine: "llm:deepseek:deepseek-v4-flash",
          tier: 0,
          attempt: 1,
          startedAt: NOW.getTime(),
          durationMs: 10,
          outcome: "failed",
          status: 503,
          error: "provider",
        },
        {
          step: "synthesize",
          engine: "llm:mimo:mimo-v2.5",
          tier: 1,
          attempt: 1,
          startedAt: NOW.getTime() + 10,
          durationMs: 20,
          outcome: "served",
        },
      ],
    });
    const summary = assessDispatchHealth([saved], { now: NOW, expectReasoning: true });

    expect(summary.providerFailures).toBe(1);
    expect(summary.providerFailoverSteps).toBe(1);
    expect(summary.servedBy).toEqual([{ engine: "llm:mimo:mimo-v2.5", steps: 1 }]);
    expect(summary.alarms).toEqual([]);
  });

  // The 2026-07-25 outage, second half: decide truncated past its ceiling and parsed to nothing,
  // which read as a deliberately frugal run while every creator earned zero.
  it("alarms when the agent decides nothing and pays nobody", () => {
    const empty = run({ decisions: [], citations: [], totalSpent: 0, totalToCreators: 0 });
    expect(codes([empty, empty, empty])).toEqual(["undecided", "nothing-bought"]);
  });

  it("alarms on a window that decides but never pays", () => {
    const cited = run({ totalSpent: 0, totalToCreators: 0 });
    expect(codes([cited, cited, cited])).toEqual(["nothing-bought"]);
  });

  it("reads nothing into one or two unpaid dispatches — a thin window proves nothing", () => {
    const cited = run({ totalSpent: 0, totalToCreators: 0 });
    expect(codes([cited, cited])).toEqual([]);
  });

  it("clears the spend alarm as soon as one dispatch pays a creator", () => {
    const unpaid = run({ totalSpent: 0, totalToCreators: 0 });
    expect(codes([unpaid, unpaid, run()])).toEqual([]);
  });

  it("treats a missing engine label as unreasoned rather than assuming a model answered", () => {
    // Pre-labelling rows carry no engine; counting them as model-reasoned would launder them.
    const s = assessDispatchHealth([run({ engine: "" }), run(), run()], {
      now: NOW,
      expectReasoning: true,
    });
    expect(s.modelReasoned).toBe(2);
    expect(s.heuristic).toBe(0);
  });
});
