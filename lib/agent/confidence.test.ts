/**
 * Confidence became a field partway through the run log's life. The backfill is the load-bearing
 * part: every archived dispatch predating the field must still show its badge, read from the
 * verdict trace step, without a recompute.
 */

import { describe, it, expect } from "vitest";
import { deriveConfidence } from "./confidence";
import type { QueryRun, TraceStep } from "../types";

function run(over: Partial<QueryRun>): QueryRun {
  return {
    id: "r1",
    question: "q",
    budget: 0.05,
    engine: "heuristic",
    subClaims: [],
    decisions: [],
    citations: [],
    answer: "a",
    totalSpent: 0,
    totalToCreators: 0,
    trace: [],
    createdAt: "2026-07-21T00:00:00.000Z",
    ...over,
  };
}

const verdictStep = (level: string, reason: string): TraceStep => ({
  phase: "verdict",
  message: `Confidence: ${level} — ${reason}.`,
  detail: { level, reason },
  ts: 1,
});

describe("deriveConfidence", () => {
  it("prefers the first-class field", () => {
    const c = deriveConfidence(run({ confidence: { level: "High", reason: "3 sources" } }));
    expect(c).toEqual({ level: "High", reason: "3 sources" });
  });

  it("backfills from the verdict trace step when the field is absent", () => {
    const c = deriveConfidence(
      run({ trace: [{ phase: "decompose", message: "", ts: 0 }, verdictStep("Moderate", "1 source cited")] }),
    );
    expect(c).toEqual({ level: "Moderate", reason: "1 source cited" });
  });

  it("returns null when neither field nor verdict step exists", () => {
    expect(deriveConfidence(run({ trace: [{ phase: "decompose", message: "", ts: 0 }] }))).toBeNull();
  });

  it("ignores a verdict step carrying a level outside the known set", () => {
    // A malformed/old detail shape must not surface a garbage badge.
    const c = deriveConfidence(
      run({ trace: [{ phase: "verdict", message: "", detail: { level: "Certain" }, ts: 1 }] }),
    );
    expect(c).toBeNull();
  });

  it("reads the last verdict step when more than one is present", () => {
    const c = deriveConfidence(
      run({ trace: [verdictStep("Low", "thin"), verdictStep("High", "corroborated")] }),
    );
    expect(c!.level).toBe("High");
  });
});
