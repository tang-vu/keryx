/**
 * Gap retry. What must never break: the engine only re-asks when content has actually arrived since
 * the question failed, it never re-asks the same question twice for one arrival, and it never spends
 * a dispatch rediscovering a hole something already filled.
 */

import { describe, expect, it } from "vitest";
import { newestContent, pickGapRetry } from "./demand-retry";
import type { QueryRun, TraceStep } from "./types";

const DAY = (n: number) => `2026-07-${String(n).padStart(2, "0")}T00:00:00.000Z`;
const CLAIM = "CCTP moves USDC between domains by burn and mint";

function run(id: string, claims: [string, number][], over: Partial<QueryRun> = {}): QueryRun {
  const trace: TraceStep[] = claims.length
    ? [
        {
          phase: "sufficiency",
          message: "",
          ts: 0,
          detail: {
            sufficient: false,
            perClaim: claims.map(([claim, coverage]) => ({ claim, coverage, coveredBy: [] })),
          },
        },
      ]
    : [];
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
    createdAt: DAY(10),
    ...over,
  };
}

describe("pickGapRetry", () => {
  it("re-asks the failed question verbatim, carrying the dispatch it re-tests", () => {
    const failed = run("r1", [[CLAIM, 0.1]], { createdAt: DAY(10) });
    expect(pickGapRetry([failed], DAY(12))).toMatchObject({
      queryId: "r1",
      question: "question r1",
      claim: CLAIM,
      coverage: 0.1,
    });
  });

  it("does not re-ask when nothing has arrived since the question failed", () => {
    const failed = run("r1", [[CLAIM, 0.1]], { createdAt: DAY(12) });
    expect(pickGapRetry([failed], DAY(10))).toBeNull();
    expect(pickGapRetry([failed], DAY(12))).toBeNull(); // same instant is not "since"
  });

  it("does not re-ask when the corpus holds nothing dated at all", () => {
    expect(pickGapRetry([run("r1", [[CLAIM, 0.1]])], undefined)).toBeNull();
  });

  it("takes the most-recurring hole first — the one most worth closing", () => {
    const runs = [
      run("r1", [["EIP-712 typed signing authorises x402 payments", 0.3]], { createdAt: DAY(10) }),
      run("r2", [["EIP-712 typed signing authorises x402 payments", 0.3]], { createdAt: DAY(10) }),
      run("r3", [["Arc reaches finality under one second", 0]], { createdAt: DAY(10) }),
    ];
    expect(pickGapRetry(runs, DAY(12))?.claim).toBe(
      "EIP-712 typed signing authorises x402 payments",
    );
  });

  it("never re-buys a hole a later dispatch already filled", () => {
    const failed = run("r1", [[CLAIM, 0.1]], { createdAt: DAY(10) });
    const filled = run("r2", [[CLAIM, 0.9]], { createdAt: DAY(11) });
    expect(pickGapRetry([failed, filled], DAY(12))).toBeNull();
  });

  it("re-asks a hole whose earlier coverage has since regressed", () => {
    // Covered on day 10, missed again on day 12: the fill predates the failure, so it proves
    // nothing about today and the claim is genuinely open again.
    const covered = run("r1", [[CLAIM, 0.9]], { createdAt: DAY(10) });
    const missed = run("r2", [[CLAIM, 0.1]], { createdAt: DAY(12) });
    expect(pickGapRetry([covered, missed], DAY(13))?.queryId).toBe("r2");
  });

  it("does not re-ask twice for one arrival when the retry measured nothing", () => {
    // The reasoning provider was down: the retry recorded neither coverage nor a miss, so the gap
    // looks untouched. Without the retry ledger the engine would re-ask it every single tick.
    const failed = run("r1", [[CLAIM, 0.1]], { createdAt: DAY(10) });
    const silentRetry = run("r2", [], {
      createdAt: DAY(13),
      question: "question r1",
      retryOf: "r1",
    });
    expect(pickGapRetry([failed, silentRetry], DAY(12))).toBeNull();
  });

  it("becomes eligible again once newer content lands after that retry", () => {
    const failed = run("r1", [[CLAIM, 0.1]], { createdAt: DAY(10) });
    const silentRetry = run("r2", [], {
      createdAt: DAY(13),
      question: "question r1",
      retryOf: "r1",
    });
    expect(pickGapRetry([failed, silentRetry], DAY(14))?.queryId).toBe("r1");
  });

  it("is null when the corpus answered everything it was asked", () => {
    expect(pickGapRetry([run("r1", [[CLAIM, 0.9]])], DAY(12))).toBeNull();
  });
});

describe("newestContent", () => {
  it("takes the newest publication date on the shelf", () => {
    expect(newestContent({ a: DAY(10), b: DAY(14), c: DAY(12) }, [], DAY(20))).toBe(DAY(14));
  });

  it("counts a newly listed source, whose posts are all back-dated", () => {
    // The case this feature exists for: a creator lists an established blog against an open claim.
    // Every post predates the failed dispatch; registration day is when the corpus actually gained it.
    expect(newestContent({ a: DAY(3) }, [{ createdAt: DAY(15) }], DAY(20))).toBe(DAY(15));
  });

  it("ignores dates in the future", () => {
    // Feeds do stamp items ahead of time, and one such item would sit above every dispatch forever,
    // making every gap permanently retryable.
    expect(newestContent({ a: DAY(10), b: DAY(28) }, [{ createdAt: DAY(26) }], DAY(20))).toBe(
      DAY(10),
    );
  });

  it("is undefined when nothing carries a date", () => {
    expect(newestContent({}, [{}], DAY(20))).toBeUndefined();
  });
});
